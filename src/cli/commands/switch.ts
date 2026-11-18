import { hostname } from "node:os";
import { join, posix } from "node:path";
import type { WorkspaceDef } from "../../core/types.ts";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import { windowsWslSetupTargets } from "../../backends/windows/wsl-setup-runtime.ts";
import { standaloneRuntime } from "../../runtime.ts";
import { createHash } from "node:crypto";
import type { WindowsOptions } from "../../types/index.ts";
import {
  managedWindowsResources, nativeWindowsStateAdapter, reconcileWindows,
  resourceKey, windowsStatePath, windowsStateOwner,
  withWindowsStateLock,
  type WindowsStateAdapter,
} from "../windows-state.ts";
import { evaluate } from "../../evaluator/index.ts";
import { loadWorkspace } from "../loader.ts";
import { runCommand } from "../run.ts";
import {
  activationCommand,
  assertActivationSupported,
  platformForEvaluatedHost,
} from "../activation.ts";
import { applyWorkspace } from "./apply.ts";
import { readWindowsLock, serializeWindowsLock, writeWindowsLock } from "../../backends/windows/lockfile.ts";
import {
  compareWindowsPackageVersions, confirmWindowsPackageLockUpdate, effectiveWindowsPackageVersion,
  isComparableWindowsPackageVersion,
  type WindowsPackageRequirement,
} from "../windows-package-versions.ts";

interface SwitchOptions {
  host?: string;
  dry: boolean;
  yes?: boolean;
  windowsState?: { path: string; adapter: WindowsStateAdapter };
}

export async function switchCommand(cwd: string, opts: SwitchOptions): Promise<void> {
  const { workspace, configDir } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace, { configDir });
  const hostName = selectHost(evaluated.map((host) => host.name), opts.host);
  const selected = evaluated.find((host) => host.name === hostName);
  if (!selected) throw new Error(`Host "${hostName}" not found`);

  const platform = platformForEvaluatedHost(selected);
  if (!opts.dry) {
    assertActivationSupported(platform);
  }

  const statePath = platform === "windows" && process.platform === "win32"
    ? opts.windowsState?.path ?? windowsStatePath() : undefined;
  const performSwitch = async () => {
    const adapter = opts.windowsState?.adapter ?? nativeWindowsStateAdapter;
    const requirements: Record<string, WindowsPackageRequirement> = {};
    const activationVersions: Record<string, string> = {};
    const unknownVersions = new Set<string>();
    const anyVersionPackages = new Set<string>();
    const newer: { id: string; installed: string; locked: string }[] = [];
    const result = await applyWorkspace(cwd, {
      host: hostName,
      dry: opts.dry && platform === "windows",
      diff: false,
      windowsLockDry: opts.dry,
      windowsPackageVersions: statePath ? async (hosts, lock) => {
        const versions: Record<string, string | null> = {};
        for (const host of hosts) {
          for (const resource of managedWindowsResources(host)) {
            if (resource.kind !== "package") continue;
            const pkg = (host.windows as WindowsOptions).packages?.[resource.id];
            if (pkg?.anyVersion) {
              // version: "any": presence only, no version requirement or lock prompt.
              anyVersionPackages.add(resourceKey(resource));
              continue;
            }
            const version = pkg?.version ?? lock.packages[resource.id]?.version;
            if (!version) throw new Error(`Missing package version: ${resource.id}`);
            const requirement = { version, exact: pkg?.version !== undefined };
            const key = resourceKey(resource);
            requirements[key] = requirement;
            const snapshot = await adapter.inspect(resource);
            if (snapshot !== null && !("version" in snapshot)) throw new Error(`Invalid package snapshot: ${resource.id}`);
            const installed = snapshot?.version;
            const effective = effectiveWindowsPackageVersion(resource.id, requirement, installed);
            versions[resource.id] = effective;
            activationVersions[key] = effective;
            if (!requirement.exact && installed !== undefined) {
              if (!isComparableWindowsPackageVersion(installed)) {
                unknownVersions.add(key);
                // Emitting the locked version would make DSC report drift on every
                // run and reinstall it; ensure presence only instead.
                versions[resource.id] = null;
                console.warn(`Warning: ${resource.id} reported a non-comparable installed version (${JSON.stringify(installed)}); ensuring it is installed without enforcing locked version ${version}.`);
              } else if (compareWindowsPackageVersions(resource.id, installed, version) > 0) {
                console.log(`Keeping ${resource.id} ${installed} (locked ${version}).`);
                newer.push({ id: resource.id, installed, locked: version });
              }
            }
          }
        }
        return versions;
      } : undefined,
    });

    const activationTarget =
      platform === "windows"
        ? windowsConfigurationForHost(result.outDir, hostName)
        : flakeRefForHost(result.outDir, hostName);
    const command = activationCommand(platform, activationTarget);

    console.log(`\nRunning: ${command.join(" ")}`);
    const activate = async () => {
      if (statePath && !opts.dry) {
        for (const resource of managedWindowsResources(selected)) {
          if (resource.kind !== "package") continue;
          const key = resourceKey(resource);
          if (anyVersionPackages.has(key)) continue;
          const current = await adapter.inspect(resource);
          if (current !== null) {
            if (!("version" in current)) throw new Error(`Invalid package snapshot: ${resource.id}`);
            effectiveWindowsPackageVersion(resource.id, requirements[key], current.version);
            if (!requirements[key].exact && !unknownVersions.has(key) &&
                isComparableWindowsPackageVersion(current.version) &&
                compareWindowsPackageVersions(resource.id, current.version, activationVersions[key]) > 0) {
              throw new Error(`Package ${resource.id} updated during switch. Rerun switch to keep ${current.version}; refusing stale activation.`);
            }
          }
        }
      }
      await runCommand(command[0], command.slice(1), { dry: opts.dry });
    };
    if (statePath) {
      const desired = managedWindowsResources(selected);
      const windows = selected.windows as WindowsOptions;
      const definitions: Record<string, string> = {};
      const lock = result.windowsLock;
      for (const resource of desired) {
        const definition = resource.kind === "package"
          ? (windows.packages?.[resource.id].anyVersion ? "version:any" : undefined) ??
            windows.packages?.[resource.id].version ?? lock?.packages[resource.id]?.version
          : JSON.stringify(windows.dsc?.find(
            (entry) => entry.winix?.kind === "startup" && entry.winix.name === resource.name
          )?.properties);
        if (!definition) throw new Error(`Missing activation definition: ${resourceKey(resource)}`);
        definitions[resourceKey(resource)] = createHash("sha256").update(definition).digest("hex");
      }
      await reconcileWindows({
        statePath,
        owner: await windowsStateOwner(configDir, hostName),
        desired, definitions,
        packageRequirements: requirements,
        anyVersionPackages,
        dry: opts.dry,
        yes: opts.yes,
        adapter,
        lockHeld: true,
        activate,
      });
      if (!opts.dry && lock) {
        let expected = serializeWindowsLock(lock);
        for (const candidate of newer) {
          const current = await adapter.inspect({
            kind: "package", id: candidate.id, source: lock.packages[candidate.id].source,
          });
          if (!current || !("version" in current) || current.version !== candidate.installed) {
            console.log(`Not updating lock for ${candidate.id}: installed version changed during activation.`);
            continue;
          }
          if (!await confirmWindowsPackageLockUpdate(candidate.id, candidate.installed, candidate.locked)) continue;
          const saved = readWindowsLock(configDir);
          if (!saved || serializeWindowsLock(saved) !== expected) {
            throw new Error("winix-windows.lock changed during switch; refusing to overwrite concurrent changes.");
          }
          const now = new Date().toISOString();
          const updated = {
            ...saved, generatedAt: now, packages: {
              ...saved.packages, [candidate.id]: { ...saved.packages[candidate.id], version: candidate.installed, resolvedAt: now },
            },
          };
          writeWindowsLock(configDir, updated);
          expected = serializeWindowsLock(updated);
          console.log(`Updated winix-windows.lock: ${candidate.id} ${candidate.locked} -> ${candidate.installed}.`);
        }
      }
    } else {
      if (platform === "windows") console.log("Windows removal inventory can only be inspected on native Windows.");
      await activate();
    }
  };
  if (statePath) await withWindowsStateLock(statePath, opts.dry, performSwitch);
  else await performSwitch();
  if (platform === "windows") {
    for (const line of wslNextSteps(workspace, evaluated, selected)) console.log(line);
  }
}

/**
 * The Linux side of a Windows host's WSL distros is activated separately.
 * Tell the user exactly how, using the setup plan when there is one.
 */
export function wslNextSteps(
  workspace: WorkspaceDef, evaluated: EvaluatedHost[], windowsHost: EvaluatedHost,
): string[] {
  const distros = ((windowsHost.windows as WindowsOptions).dsc ?? [])
    .flatMap((resource) => resource.winix?.kind === "wsl-distro" ? [resource.winix.distro] : []);
  if (distros.length === 0) return [];
  const planned = new Map(windowsWslSetupTargets(workspace, evaluated, [windowsHost]).map((target) => [target.distro, target]));
  const standalone = standaloneRuntime();
  const winix = standalone ? `/var/lib/winix/runtime/${standalone.version}/winix` : "npm exec -- winix";
  const lines = ["", "WSL: Linux hosts are activated separately from Windows."];
  for (const distro of distros) {
    const target = planned.get(distro.name);
    if (target) {
      const directory = posix.join(target.plan.checkout, target.setup.configDirectory);
      lines.push(
        `  ${distro.name} → ${target.plan.host}: apply Linux changes inside the distro with`,
        `    wsl.exe -d ${distro.name} --cd ${directory} -- ${winix} switch --host ${target.plan.host}`,
      );
    } else if (distro.host) {
      lines.push(`  ${distro.name} → ${distro.host}: from the distro's checkout, run ${winix} switch --host ${distro.host}`);
    } else {
      lines.push(`  ${distro.name}: Linux activation is manual (no setup declared)`);
    }
  }
  return lines;
}

export function selectHost(
  hosts: string[],
  requested?: string,
  currentHostname = hostname()
): string {
  if (requested) {
    if (!hosts.includes(requested)) {
      throw new Error(
        `Host "${requested}" not found. Available hosts:\n` +
        hosts.map((host) => `  - ${host}`).join("\n")
      );
    }

    return requested;
  }

  if (hosts.length === 1) return hosts[0];
  if (hosts.includes(currentHostname)) return currentHostname;

  throw new Error(
    `Current hostname "${currentHostname}" does not match a configured host. ` +
    "`winix switch` needs --host. Available hosts:\n" +
    hosts.map((host) => `  - ${host}`).join("\n")
  );
}

export function flakeRefForHost(outDir: string, hostName: string): string {
  return `path:${outDir.replace(/\\/g, "/")}#${hostName}`;
}

export function windowsConfigurationForHost(outDir: string, hostName: string): string {
  return join(outDir, hostName, "configuration.winget");
}
