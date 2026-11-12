import { hostname } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { WindowsOptions } from "../../types/index.ts";
import {
  managedWindowsResources, nativeWindowsStateAdapter, reconcileWindows,
  resourceKey, windowsStatePath,
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

interface SwitchOptions {
  host?: string;
  dry: boolean;
  yes?: boolean;
  windowsState?: { path: string; adapter: WindowsStateAdapter };
}

export async function switchCommand(cwd: string, opts: SwitchOptions): Promise<void> {
  const { workspace, configDir } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace);
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
    const result = await applyWorkspace(cwd, {
      host: hostName,
      dry: opts.dry && platform === "windows",
      diff: false,
      windowsLockDry: opts.dry,
    });

    const activationTarget =
      platform === "windows"
        ? windowsConfigurationForHost(result.outDir, hostName)
        : flakeRefForHost(result.outDir, hostName);
    const command = activationCommand(platform, activationTarget);

    console.log(`\nRunning: ${command.join(" ")}`);
    const activate = () => runCommand(command[0], command.slice(1), { dry: opts.dry });
    if (statePath) {
      const desired = managedWindowsResources(selected);
      const windows = selected.windows as WindowsOptions;
      const definitions: Record<string, string> = {};
      const lock = result.windowsLock;
      for (const resource of desired) {
        const definition = resource.kind === "package"
          ? windows.packages?.[resource.id].version ?? lock?.packages[resource.id]?.version
          : JSON.stringify(windows.dsc?.find(
            (entry) => entry.winix?.kind === "startup" && entry.winix.name === resource.name
          )?.properties);
        if (!definition) throw new Error(`Missing activation definition: ${resourceKey(resource)}`);
        definitions[resourceKey(resource)] = createHash("sha256").update(definition).digest("hex");
      }
      await reconcileWindows({
        statePath,
        owner: JSON.stringify([(await realpath(configDir)).toLowerCase(), hostName]),
        desired, definitions,
        dry: opts.dry,
        yes: opts.yes,
        adapter: opts.windowsState?.adapter ?? nativeWindowsStateAdapter,
        lockHeld: true,
        activate,
      });
    } else {
      if (platform === "windows") console.log("Windows removal inventory can only be inspected on native Windows.");
      await activate();
    }
  };
  if (statePath) await withWindowsStateLock(statePath, opts.dry, performSwitch);
  else await performSwitch();
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
