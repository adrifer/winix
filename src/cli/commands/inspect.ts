import type { Fragment, ResourceRef } from "../../core/types.ts";
import type { WinDscResource, WinPackage, WindowsOptions } from "../../types/index.ts";
import { describeWindowsDscResource } from "../../backends/windows/index.ts";
import { evaluate } from "../../evaluator/index.ts";
import { analyzeWorkspace, applicableScopes, collectIgnoredFragments, type HostAnalysis } from "../analysis.ts";
import { loadWorkspace } from "../loader.ts";

const NIX_SCOPES = ["nixos", "homeManager", "darwin"] as const;

export async function inspect(cwd: string, opts: { host?: string; matrix?: boolean } = {}): Promise<void> {
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
  if (opts.matrix) {
    for (const line of inspectMatrix(selected, ignored)) console.log(line);
    return;
  }
  for (const analysis of selected) {
    const index = analyses.indexOf(analysis);
    const ignoredLabels = ignored.filter((item) => item.host === analysis.name).map((item) => item.fragment);
    for (const line of inspectHost(analysis, ignoredLabels, applicableScopes(analysis, evaluated[index]))) {
      console.log(line);
    }
  }
}

/**
 * One host as a feature -> contributions tree. Effects of one feature are
 * grouped under it (a feature with 15 effects is listed once), each group says
 * which scopes apply on this host, and Windows resources show their dependsOn
 * edges. Scopes the platform does not apply (the windows.* half of a
 * cross-platform feature on Linux, say) are named but not expanded.
 */
export function inspectHost(
  analysis: HostAnalysis, ignoredLabels: string[] = [], applicable?: ReadonlySet<string>,
): string[] {
  const groups = new Map<string, Fragment[]>();
  for (const { label, fragment } of analysis.fragments) {
    if (fragment.__platform) continue;
    groups.set(label, [...(groups.get(label) ?? []), fragment]);
  }
  const names = windowsResourceNames(analysis.fragments.map((record) => record.fragment));
  const lines = ["", analysis.name, `  platform: ${analysis.platform}${analysis.variant ? ` (${analysis.variant})` : ""}`];
  lines.push(`  composition: ${[...groups.keys()].join(" > ") || "(empty)"}`);
  for (const [label, fragments] of groups) {
    const scopes: string[] = NIX_SCOPES.filter((scope) => fragments.some((fragment) => hasContent(fragment[scope])));
    const windowsLines = fragments.flatMap((fragment) => fragment.windows ? describeWindows(fragment.windows as WindowsOptions, names) : []);
    if (windowsLines.length > 0 || fragments.some((fragment) => hasContent(fragment.windows))) scopes.push("windows");
    const applies = (scope: string) => !applicable || applicable.has(scope);
    const used = scopes.filter(applies);
    const skipped = scopes.filter((scope) => !applies(scope));
    const note = ignoredLabels.includes(label)
      ? "  (no applicable configuration on this platform; ignored)"
      : skipped.length > 0 ? `  (not on this platform: ${skipped.join(", ")})` : "";
    lines.push(`  ${label}  [${(ignoredLabels.includes(label) ? scopes : used).join(", ") || "empty"}]${note}`);
    const expand = (scope: string) => applies(scope) || ignoredLabels.includes(label);
    for (const scope of NIX_SCOPES) {
      if (!expand(scope)) continue;
      const keys = new Set<string>();
      for (const fragment of fragments) Object.keys(fragment[scope] ?? {}).forEach((key) => keys.add(key));
      if (keys.size > 0) lines.push(`    ${scope}: ${[...keys].join(", ")}`);
    }
    if (expand("windows")) for (const line of windowsLines) lines.push(`    ${line}`);
  }
  return lines;
}

/**
 * Features x hosts: ● the feature applies on that host, · it is included but
 * has nothing for that platform (the other OS's half of a shared role), blank
 * when not included. Rows are grouped by the host-level entry (usually a
 * role/profile) they came through; features listed on hosts directly come last.
 */
export function inspectMatrix(
  analyses: HostAnalysis[], ignored: { host: string; fragment: string }[],
): string[] {
  const extras = "listed on the host";
  const rows = new Map<string, { group: string; cells: Map<string, "applies" | "ignored"> }>();
  for (const analysis of analyses) {
    for (const { label, fragment, via } of analysis.fragments) {
      if (fragment.__platform) continue;
      const row = rows.get(label) ?? { group: via ?? extras, cells: new Map() };
      const state = ignored.some((item) => item.host === analysis.name && item.fragment === label) ? "ignored" : "applies";
      row.cells.set(analysis.name, state);
      rows.set(label, row);
    }
  }
  const groups = [...new Set([...rows.values()].map((row) => row.group))]
    .sort((a, b) => Number(a === extras) - Number(b === extras));
  const labelWidth = Math.max(...[...rows.keys()].map((label) => label.length + 2), ...groups.map((group) => group.length), 20);
  const hosts = analyses.map((analysis) => analysis.name);
  const cell = (text: string, width: number) => {
    const left = Math.floor((width - text.length) / 2);
    return " ".repeat(left) + text + " ".repeat(width - text.length - left);
  };
  const line = (first: string, cells: string[]) =>
    `${first.padEnd(labelWidth)}  ${cells.map((text, index) => cell(text, hosts[index].length)).join("  ")}`.trimEnd();
  const lines = ["", line("", hosts)];
  for (const group of groups) {
    lines.push(group);
    for (const [label, row] of rows) {
      if (row.group !== group) continue;
      const shown = label === group ? "(its own settings)"
        : /:inline(\[\d+\])?$/.test(label) ? `(inline in ${label.replace(/:inline(\[\d+\])?$/, "")})` : label;
      lines.push(line(`  ${shown}`, hosts.map((name) => {
        const state = row.cells.get(name);
        return state === "applies" ? "●" : state === "ignored" ? "·" : "";
      })));
    }
  }
  lines.push("", "● applies   · included, nothing for this platform   (blank) not included");
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
