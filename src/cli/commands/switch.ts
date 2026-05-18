import { hostname } from "node:os";
import { evaluate } from "../../evaluator/index.ts";
import { loadWorkspace } from "../loader.ts";
import { runCommand } from "../run.ts";
import { applyWorkspace } from "./apply.ts";

interface SwitchOptions {
  host?: string;
  dry: boolean;
}

export async function switchCommand(cwd: string, opts: SwitchOptions): Promise<void> {
  const { workspace } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace);
  const hostName = selectHost(evaluated.map((host) => host.name), opts.host);
  const selected = evaluated.find((host) => host.name === hostName);
  if (!selected) throw new Error(`Host "${hostName}" not found`);

  const platform =
    Object.keys(selected.darwin).length > 0 && Object.keys(selected.nixos).length === 0
      ? "darwin"
      : "nixos";

  const result = await applyWorkspace(cwd, {
    host: hostName,
    dry: false,
    diff: false,
  });

  const flake = `path:${result.outDir}#${hostName}`;
  const command =
    platform === "darwin"
      ? ["darwin-rebuild", "switch", "--flake", flake]
      : withSudo(["nixos-rebuild", "switch", "--flake", flake]);

  console.log(`\nRunning: ${command.join(" ")}`);
  await runCommand(command[0], command.slice(1), { dry: opts.dry });
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

function withSudo(command: string[]): string[] {
  if (typeof process.getuid === "function" && process.getuid() === 0) return command;
  return ["sudo", ...command];
}
