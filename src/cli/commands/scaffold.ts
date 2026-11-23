// winix scaffold feature <name> — a cross-platform feature template.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { findConfig } from "../loader.ts";

export interface ScaffoldResult {
  path: string;
  exportName: string;
}

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function featureExportName(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Write `features/<name>.ts` next to winix.config.ts. The template puts the
 * Home Manager and Windows halves side by side, because a tool declared in
 * one place for every platform is the pattern people most often get wrong.
 */
export async function scaffoldFeature(cwd: string, name: string, opts: { force?: boolean } = {}): Promise<ScaffoldResult> {
  if (!NAME.test(name)) {
    throw new Error(`Feature names are lowercase words separated by dashes (e.g. "lazygit", "dev-tools"); got "${name}".`);
  }
  const config = findConfig(cwd);
  if (!config) throw new Error("No winix.config.ts found here or in a parent directory. Run winix init first.");
  const path = join(dirname(config), "features", `${name}.ts`);
  if (existsSync(path) && !opts.force) throw new Error(`${path} already exists. Re-run with --force to overwrite.`);
  await mkdir(dirname(path), { recursive: true });
  const exportName = featureExportName(name);
  await writeFile(path, featureTemplate(name, exportName));
  return { path, exportName };
}

export function featureTemplate(name: string, exportName: string): string {
  return `import { feature } from "@adrifer/winix";

/**
 * ${name}: declared once for every platform.
 *
 * Each namespace applies only where it makes sense: home.* on NixOS, WSL and
 * macOS (Home Manager), windows.* on Windows hosts, nixos.* / darwin.* on those
 * systems. A host ignores the rest, so keep both halves here instead of
 * splitting the tool into per-platform files. \`winix inspect --host <name>\`
 * shows what each host gets.
 *
 * To fill in (agents too):
 * - Package names differ per platform: a nixpkgs attribute for home.packages,
 *   a winget id for windows.package (find it with \`winix windows search ${name}\`).
 * - Paths starting with ./ or ../ are relative to winix.config.ts, on both sides.
 * - Order Windows resources by passing the handles helpers return to dependsOn.
 * - Delete the TODO lines you don't need; uncomment the ones you do.
 */
export const ${exportName} = feature(${JSON.stringify(name)}, ({ home, windows, platforms }) => {
  // --- Linux, WSL and macOS (Home Manager) ---
  // TODO: the nixpkgs attribute, or home.program(${JSON.stringify(name)}, { ... }) when Home Manager has a module.
  // home.packages(${JSON.stringify(name)});
  // TODO: link config from this checkout.
  // home.configFiles({ ${JSON.stringify(`${name}/config`)}: home.symlink(${JSON.stringify(`./dotfiles/${name}/config`)}) });

  // --- Windows ---
  // TODO: the winget id (winix windows search ${name}).
  // windows.package("Publisher.Package");
  // TODO: link the same file into the Windows location the tool reads.
  // windows.file.symlink(windows.knownFolder.appData(${JSON.stringify(`${name}\\config`)}), ${JSON.stringify(`./dotfiles/${name}/config`)});

  // --- Per-platform differences ---
  if (platforms.darwin.isActive) {
    // TODO: macOS-only details, e.g. a different config location.
  }
});
`;
}

export function scaffoldNextSteps(configDir: string, result: ScaffoldResult): string[] {
  const file = relative(configDir, result.path).replaceAll("\\", "/");
  return [
    `✓ Created ${file}`,
    "",
    "Next:",
    `  1. Fill in the TODOs in ${file}.`,
    `  2. Import it where you compose hosts or profiles (path shown from winix.config.ts):`,
    `       import { ${result.exportName} } from "./${file}";`,
    `     and add ${result.exportName}() to a profile or host.`,
    "  3. winix inspect --host <name>   (what each host gets from it)",
    "     winix check",
  ];
}
