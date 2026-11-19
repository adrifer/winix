import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { featureExportName, scaffoldFeature, scaffoldNextSteps } from "../src/cli/commands/scaffold.ts";
import { loadWorkspace } from "../src/cli/loader.ts";
import { evaluate } from "../src/index.ts";
import { analyzeWorkspace, collectIgnoredFragments } from "../src/cli/analysis.ts";
import type { WindowsOptions } from "../src/types/windows.ts";

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "winix-scaffold-"));
  const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  await writeFile(join(dir, "winix.config.ts"), `
    import { host, platforms, workspace } from ${JSON.stringify(sdk)};
    import { devTools } from "./features/dev-tools.ts";
    export default workspace({
      inputs: { nixpkgs: "nixos-unstable", homeManager: { url: "github:nix-community/home-manager", follows: { nixpkgs: "nixpkgs" } } },
      hosts: [
        host("desktop", platforms.windows(), [devTools()]),
        host("linux", platforms.nixos({ stateVersion: "25.05" }), [devTools()]),
      ],
    });
  `);
  return dir;
}

/** Point the template's SDK import at the source tree, as the vitest alias does for examples. */
async function useSourceSdk(path: string): Promise<string> {
  const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  const text = (await readFile(path, "utf8")).replace('"@adrifer/winix"', JSON.stringify(sdk));
  await writeFile(path, text);
  return text;
}

describe("winix scaffold feature", () => {
  it("writes a template that evaluates as-is, before any TODO is filled in", async () => {
    const dir = await project();
    try {
      const result = await scaffoldFeature(join(dir), "dev-tools");
      expect(result).toEqual({ path: join(dir, "features", "dev-tools.ts"), exportName: "devTools" });
      const text = await useSourceSdk(result.path);
      expect(text).toContain('export const devTools = feature("dev-tools", ({ home, windows, platforms }) => {');
      expect(text).toContain("winix package search dev-tools");
      const { workspace, configDir } = await loadWorkspace(dir);
      const hosts = evaluate(workspace, { configDir });
      const ignored = collectIgnoredFragments(analyzeWorkspace(workspace, { configDir }), hosts);
      expect(ignored).toEqual([]);
      expect(scaffoldNextSteps(dir, result)).toEqual([
        "✓ Created features/dev-tools.ts",
        "",
        "Next:",
        "  1. Fill in the TODOs in features/dev-tools.ts.",
        "  2. Import it where you compose hosts or profiles (path shown from winix.config.ts):",
        '       import { devTools } from "./features/dev-tools.ts";',
        "     and add devTools() to a profile or host.",
        "  3. winix inspect --host <name>   (what each host gets from it)",
        "     winix check",
      ]);
      await expect(scaffoldFeature(dir, "dev-tools")).rejects.toThrow("already exists");
      await expect(scaffoldFeature(dir, "dev-tools", { force: true })).resolves.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("its commented lines are valid declarations for both platforms", async () => {
    const dir = await project();
    try {
      const { path } = await scaffoldFeature(dir, "dev-tools");
      const text = await useSourceSdk(path);
      await writeFile(path, text
        .replace('// home.packages("dev-tools");', 'home.packages("ripgrep");')
        .replace("// home.configFiles(", "home.configFiles(")
        .replace('// windows.package("Publisher.Package");', 'windows.package("BurntSushi.ripgrep.MSVC");')
        .replace("// windows.file.symlink(", "windows.file.symlink("));
      const { workspace, configDir } = await loadWorkspace(dir);
      const [desktop, linux] = evaluate(workspace, { configDir });
      const win = desktop.windows as WindowsOptions;
      expect(Object.keys(win.packages ?? {})).toEqual(["BurntSushi.ripgrep.MSVC"]);
      expect(win.dsc?.map((resource) => resource.winix?.kind)).toEqual(["file"]);
      expect(JSON.stringify(linux.homeManager)).toContain("dev-tools/config");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("validates names and needs a project", async () => {
    expect(featureExportName("my-dev-tools2")).toBe("myDevTools2");
    await expect(scaffoldFeature(process.cwd(), "Bad_Name")).rejects.toThrow("lowercase words separated by dashes");
    const empty = await mkdtemp(join(tmpdir(), "winix-scaffold-empty-"));
    try {
      await expect(scaffoldFeature(empty, "tools")).rejects.toThrow("No winix.config.ts found");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
