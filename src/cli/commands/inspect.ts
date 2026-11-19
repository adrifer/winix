import type { Fragment, ResourceRef } from "../../core/types.ts";
import type { WinDscResource, WinPackage, WindowsOptions } from "../../types/index.ts";
import { describeWindowsDscResource } from "../../backends/windows/index.ts";
import { evaluate } from "../../evaluator/index.ts";
import { analyzeWorkspace, collectIgnoredFragments, type HostAnalysis } from "../analysis.ts";
import { loadWorkspace } from "../loader.ts";

const NIX_SCOPES = ["nixos", "homeManager", "darwin"] as const;

export async function inspect(cwd: string, opts: { host?: string } = {}): Promise<void> {
  const { workspace, configPath, configDir } = await loadWorkspace(cwd);
  const analyses = analyzeWorkspace(workspace, { configDir });
  const evaluated = evaluate(workspace, { configDir });
  const ignored = collectIgnoredFragments(analyses, evaluated);
  const selected = opts.host ? analyses.filter((analysis) => analysis.name === opts.host) : analyses;
  if (opts.host && selected.length === 0) {
    throw new Error(`Host "${opts.host}" not found. Available hosts:\n${analyses.map((analysis) => `  - ${analysis.name}`).join("\n")}`);
  }

  console.log(`Config: ${configPath}`);
  console.log(`Hosts: ${analyses.length}`);
  for (const analysis of selected) {
    for (const line of inspectHost(analysis, ignored.filter((item) => item.host === analysis.name).map((item) => item.fragment))) {
      console.log(line);
    }
  }
}

/**
 * One host as a feature -> contributions tree. Effects of one feature are
 * grouped under it (a feature with 15 effects is listed once), each group says
 * which scopes it targets, and Windows resources show their dependsOn edges.
 */
export function inspectHost(analysis: HostAnalysis, ignoredLabels: string[] = []): string[] {
  const groups = new Map<string, Fragment[]>();
  for (const { label, fragment } of analysis.fragments) {
    if (fragment.__platform) continue;
    groups.set(label, [...(groups.get(label) ?? []), fragment]);
  }
  const names = windowsResourceNames(analysis.fragments.map((record) => record.fragment));
  const lines = ["", analysis.name, `  platform: ${analysis.platform}`];
  lines.push(`  composition: ${[...groups.keys()].join(" > ") || "(empty)"}`);
  for (const [label, fragments] of groups) {
    const scopes: string[] = NIX_SCOPES.filter((scope) => fragments.some((fragment) => hasContent(fragment[scope])));
    const windowsLines = fragments.flatMap((fragment) => fragment.windows ? describeWindows(fragment.windows as WindowsOptions, names) : []);
    if (windowsLines.length > 0 || fragments.some((fragment) => hasContent(fragment.windows))) scopes.push("windows");
    const note = ignoredLabels.includes(label) ? "  (no applicable configuration on this platform; ignored)" : "";
    lines.push(`  ${label}  [${scopes.join(", ") || "empty"}]${note}`);
    for (const scope of NIX_SCOPES) {
      const keys = new Set<string>();
      for (const fragment of fragments) Object.keys(fragment[scope] ?? {}).forEach((key) => keys.add(key));
      if (keys.size > 0) lines.push(`    ${scope}: ${[...keys].join(", ")}`);
    }
    for (const line of windowsLines) lines.push(`    ${line}`);
  }
  return lines;
}

function hasContent(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "object" || Object.keys(value).length > 0);
}

/** Labels for dependsOn targets, from every Windows resource the host declares. */
function windowsResourceNames(fragments: Fragment[]): { dsc: Map<symbol, string>; commands: Map<symbol, string> } {
  const dsc = new Map<symbol, string>();
  const commands = new Map<symbol, string>();
  for (const fragment of fragments) {
    const win = fragment.windows as WindowsOptions | undefined;
    for (const resource of win?.dsc ?? []) if (resource.token) dsc.set(resource.token, describeWindowsDscResource(resource).label);
    for (const command of win?.commands ?? []) {
      if (command.token) commands.set(command.token, `command ${command.name ?? command.executable}`);
    }
  }
  return { dsc, commands };
}

function describeWindows(win: WindowsOptions, names: ReturnType<typeof windowsResourceNames>): string[] {
  const lines: string[] = [];
  const after = (refs: ResourceRef[] | undefined) => {
    if (!refs || refs.length === 0) return "";
    const targets = refs.map((ref) => ref.kind === "package" ? `package ${ref.id}`
      : ref.kind === "command" ? names.commands.get(ref.token) ?? "a command"
      : names.dsc.get(ref.token) ?? "a resource");
    return `  <- after ${[...new Set(targets)].join(", ")}`;
  };
  for (const pkg of Object.values(win.packages ?? {}) as WinPackage[]) {
    const policy = pkg.anyVersion ? " (version: any)" : pkg.version ? ` ${pkg.version} (exact)` : "";
    lines.push(`package ${pkg.id}${policy}${pkg.elevated ? " [elevated]" : ""}${after(pkg.dependsOn)}`);
  }
  for (const resource of win.dsc ?? [] as WinDscResource[]) {
    const { label } = describeWindowsDscResource(resource);
    lines.push(`${label}${resource.elevated ? " [elevated]" : ""}${after(resource.dependsOn)}`);
  }
  for (const command of win.commands ?? []) {
    lines.push(`command ${command.name ?? [command.executable, ...(command.arguments ?? [])].join(" ")}${after(command.dependsOn)}`);
  }
  if (win.npm?.registries) lines.push("npm registries");
  if (win.powershell?.repositories) lines.push("PowerShell repositories");
  if (win.hostname) lines.push(`hostname ${win.hostname}`);
  return lines;
}
