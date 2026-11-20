import { hostname } from "node:os";
import { posix } from "node:path";
import type { WorkspaceDef } from "../../core/types.ts";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import { windowsWslSetupTargets } from "../../backends/windows/wsl-setup-runtime.ts";
import { standaloneRuntime } from "../../runtime.ts";
import { createHash } from "node:crypto";
import type { WindowsOptions } from "../../types/index.ts";
import {
  inspectResources, managedWindowsResources, nativeWindowsStateAdapter, reconcileWindows,
  resourceKey, windowsStatePath, windowsStateOwner,
  withWindowsStateLock,
  type ResourceSnapshot,
  type WindowsStateAdapter,
} from "../windows-state.ts";
import {
  formatWindowsPlan, nativeWindowsPlanChecker, planWindowsResources,
  runningPackagesError, type PlannedResource, type RunningProcess, type WindowsPlanChecker,
} from "../windows-plan.ts";
import {
  applyWindowsBatches, formatApplySummary, nativeWindowsBatchRunner, planApplyBatches, type WindowsBatchRunner,
} from "../windows-apply.ts";
import * as progress from "../progress.ts";
import { colorEnabled, plural } from "../style.ts";
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
  offline?: boolean;
  locked?: boolean;
  windowsState?: { path: string; adapter: WindowsStateAdapter };
  /** Live checks for the plan; defaults to native checks unless the state adapter is replaced. */
  planChecker?: WindowsPlanChecker;
  /** Applies Windows changes; defaults to the native PowerShell runner. */
  windowsRunner?: WindowsBatchRunner;
}

export async function switchCommand(cwd: string, opts: SwitchOptions): Promise<void> {
  // Feedback from the first moment; each phase replaces the spinner text.
  progress.spin("Loading configuration");
  try {
    await runSwitch(cwd, opts);
  } finally {
    progress.stop();
  }
}

async function runSwitch(cwd: string, opts: SwitchOptions): Promise<void> {
  const started = Date.now();
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
    /** Installed package snapshots by id, for the dry-run plan. */
    const packageInventory = new Map<string, ResourceSnapshot>();
    /** The same snapshots by resourceKey, so reconciliation does not inventory every package again. */
    const knownSnapshots = new Map<string, ResourceSnapshot>();
    const windowsDry = opts.dry && platform === "windows";
    const result = await applyWorkspace(cwd, {
      host: hostName,
      // Evaluated once, above; generation reuses it.
      loaded: { workspace, configDir, hosts: evaluated },
      dry: windowsDry,
      print: !windowsDry,
      compact: true,
      diff: false,
      offline: opts.offline,
      locked: opts.locked,
      windowsLockDry: opts.dry,
      windowsPackageVersions: statePath ? async (hosts, lock) => {
        const versions: Record<string, string | null> = {};
        for (const host of hosts) {
          const tracked = managedWindowsResources(host).filter((resource) => resource.kind === "package");
          // One inventory for every package, reused by the plan, activation and reconciliation.
          const inventory = await progress.step("Reading installed packages",
            () => inspectResources(adapter, tracked), `Read ${plural(tracked.length, "installed package")}`);
          for (const resource of tracked) {
            const snapshot = inventory.get(resourceKey(resource)) ?? null;
            knownSnapshots.set(resourceKey(resource), snapshot);
            if (resource.kind === "package") packageInventory.set(resource.id, snapshot);
          }
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
            const snapshot = inventory.get(key) ?? null;
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
                // The plan reports these ("newer than locked").
                newer.push({ id: resource.id, installed, locked: version });
              }
            }
          }
        }
        return versions;
      } : undefined,
    });

    // Nothing may draw over activation output (nixos-rebuild inherits the terminal).
    progress.stop();
    const command = platform === "windows" ? undefined : activationCommand(platform, flakeRefForHost(result.outDir, hostName));
    const summaries = result.windowsOutput?.resources[hostName] ?? [];
    const checker = opts.planChecker ?? (opts.windowsState ? undefined : nativeWindowsPlanChecker);
    const live = statePath !== undefined;
    let planned: PlannedResource[] = [];
    if (platform === "windows") {
      // One plan, checked against the machine, for the preview and for activation.
      const checked = summaries.filter((resource) => !resource.package && resource.category !== "command").length;
      planned = live
        ? await progress.step(`Checking ${plural(checked, "resource")} on this machine`,
          () => planWindowsResources(summaries, packageInventory, checker), `Checked ${plural(checked, "resource")} on this machine`)
        : await planWindowsResources(summaries, undefined, undefined);
      // Packages newer than locked are kept; show the lock beside the installed version.
      for (const entry of planned) {
        const kept = newer.find((candidate) => candidate.id === entry.resource.package?.id);
        if (kept && entry.state === "ok") {
          entry.detail = `${kept.installed} (locked ${kept.locked}; switch offers to update the lock)`;
        }
      }
      console.log("");
      for (const line of formatWindowsPlan(hostName, planned, {
        live, reason: live ? undefined : "machine checks need native Windows", color: colorEnabled(),
      })) console.log(line);
    } else if (command) {
      console.log(`\nRunning: ${command.join(" ")}`);
    }
    const ownership: string[] = [];
    const activate = async (): Promise<void | { changed: boolean }> => {
      if (statePath && !opts.dry) {
        const running = new Map<string, RunningProcess[]>(planned.flatMap((entry) =>
          entry.running?.length ? [[entry.resource.package!.id, entry.running] as [string, RunningProcess[]]] : []));
        if (running.size > 0) throw new Error(runningPackagesError(running));
        const prompts = new Map(planned.flatMap((entry) =>
          entry.elevation ? [[entry.resource.package!.id, entry.elevation] as [string, string]] : []));
        const batches = planApplyBatches(planned, prompts);
        if (batches.length === 0) {
          console.log("\nNothing to change.");
          return { changed: false };
        }
        const total = batches.reduce((count, batch) => count + batch.steps.length, 0);
        console.log(`\nApplying ${plural(total, "change")}:`);
        const outcome = await applyWindowsBatches(batches, opts.windowsRunner ?? nativeWindowsBatchRunner, applyProgress());
        progress.stop();
        const labels = new Map(summaries.map((resource) => [resource.name, resource.package?.id ?? resource.label]));
        for (const line of formatApplySummary(outcome, labels)) console.log(line);
        if (outcome.failed.length > 0) {
          throw new Error(`${plural(outcome.failed.length, "Windows change")} did not apply; fix the errors above and rerun winix switch.`);
        }
        return { changed: outcome.results.some((entry) => entry.status === "applied") };
      }
      if (opts.dry || !command) return;
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
      const after = await reconcileWindows({
        statePath,
        owner: await windowsStateOwner(configDir, hostName),
        desired, definitions,
        packageRequirements: requirements,
        anyVersionPackages,
        dry: opts.dry,
        yes: opts.yes,
        adapter,
        lockHeld: true,
        knownSnapshots,
        activate,
        verify: (work) => progress.step("Verifying the result", work, `Verified ${plural(desired.length, "managed resource")}`),
        ...(windowsDry ? { report: (message: string) => ownership.push(message) } : {}),
      });
      if (!opts.dry && lock && after) {
        let expected = serializeWindowsLock(lock);
        for (const candidate of newer) {
          const current = after.get(resourceKey({ kind: "package", id: candidate.id, source: lock.packages[candidate.id].source }));
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
            ...saved, packages: {
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
    if (windowsDry) {
      if (ownership.length > 0) {
        console.log("\nRemovals and ownership (Winix applied-state inventory):");
        for (const line of ownership) console.log(`  ${line}`);
      }
      console.log(`\n${dryRunSummary(planned, live)}`);
    } else if (opts.dry && command) {
      console.log(`\nWould run: ${command.join(" ")}`);
    }
  };
  if (statePath) await withWindowsStateLock(statePath, opts.dry, performSwitch);
  else await performSwitch();
  if (platform === "windows") {
    for (const line of wslNextSteps(workspace, evaluated, selected)) console.log(line);
    if (!opts.dry && statePath) console.log(`\nDone in ${progress.formatDuration(Date.now() - started)}.`);
  }
}

/** The last line of a Windows dry run, consistent with the plan header's counts. */
export function dryRunSummary(planned: PlannedResource[], live = true): string {
  if (!live) {
    return `winix switch on that Windows machine would check ${planned.length === 1 ? "this resource" : `these ${planned.length} resources`} and apply only what is out of date.`;
  }
  const changes = planned.filter((entry) => entry.state === "change").length;
  const unchecked = planned.filter((entry) => entry.state === "unknown").length;
  const conflicts = planned.filter((entry) => entry.state === "conflict").length;
  if (conflicts > 0) return `winix switch would stop before changing anything: resolve the ${plural(conflicts, "conflict")} first.`;
  if (changes === 0 && unchecked === 0) return "winix switch would change nothing.";
  const apply = changes === 0 ? "would apply nothing" : `would apply only ${changes === 1 ? "this change" : `these ${changes} changes`}`;
  const check = unchecked === 0 ? ""
    : `, and check ${unchecked === 1 ? "the unchecked one" : `the ${unchecked} unchecked ones`} as it applies (applying ${unchecked === 1 ? "it" : "them"} if needed)`;
  return `winix switch ${apply}${check}.`;
}

/**
 * Show the apply runner's progress: a spinner with the step in progress (and
 * while waiting for the UAC prompt), then one line per finished step. Without
 * an interactive terminal, start and finish lines are printed as they come.
 */
export function applyProgress(
  // Look console.log up per line: the spinner wraps it to clear itself first.
  print: (line: string) => void = (line) => console.log(line),
): (line: string) => void {
  let current: string | undefined;
  let started = Date.now();
  progress.spin("Applying");
  return (line) => {
    const start = /^ {2}~ (\S+)\s+(.+)$/.exec(line);
    if (start) {
      current = `${start[1]} ${start[2]}`;
      started = Date.now();
      if (!progress.isInteractive()) print(`  ~ ${current}`);
      progress.spin(current);
      return;
    }
    const done = /^ {4}✓ /.test(line);
    const failed = /^ {4}✗ /.test(line);
    if ((done || failed) && current) {
      progress.stop();
      const elapsed = progress.formatDuration(Date.now() - started);
      print(done ? `  ✓ ${current} (${elapsed})` : `  ✗ ${current} (${elapsed}): ${line.slice(line.indexOf(": ") + 2)}`);
      current = undefined;
      progress.spin("Applying");
      return;
    }
    print(line);
    if (/approve the UAC prompt/.test(line)) progress.spin("Waiting for administrator approval (UAC)");
  };
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
