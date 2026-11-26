import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { evaluate, generateNix, host, platforms, workspace } from "../src/index.ts";
import { generateWindows } from "../src/backends/windows/index.ts";
import { emptyWindowsLock, reconcileInlinePins, resolveMissingWindowsLockEntries, windowsLockGaps } from "../src/backends/windows/lockfile.ts";
import { normalizeWinSettings } from "../src/helpers/windows-settings.ts";
import { reconcileWindows, resourceKey, type ManagedResource, type ResourceSnapshot } from "../src/cli/windows-state.ts";
import {
  isRuntimePackage, packageDeclaration, packageSearch, parseWingetExport, windowsImport,
} from "../src/cli/commands/windows-packages.ts";
import type { WindowsOptions, WinDscResource } from "../src/types/index.ts";

function windowsHost(body: Parameters<typeof host>[2], platform = platforms.windows()) {
  return evaluate(workspace({ hosts: [host("desktop", platform, body as never)] }), { configDir: "D:\\dotfiles\\winix" })[0];
}
const dscOf = (h: { windows: Record<string, unknown> }) => (h.windows as WindowsOptions).dsc ?? [];
const fileMeta = (resource: WinDscResource) => resource.winix?.kind === "file" ? resource.winix : undefined;

describe('windows.package version: "any"', () => {
  it("accepts both call shapes and rejects contradictions", () => {
    const h = windowsHost(({ windows }) => {
      windows.package("Valve.Steam", { version: "any" });
      windows.package({ id: "Google.Chrome", version: "any", elevated: true });
    });
    const packages = (h.windows as WindowsOptions).packages!;
    expect(packages["Valve.Steam"]).toEqual({ id: "Valve.Steam", source: "winget", anyVersion: true });
    expect(packages["Google.Chrome"]).toMatchObject({ anyVersion: true, elevated: true });
    expect(packages["Google.Chrome"].version).toBeUndefined();
    for (const version of ["latest", "*"]) {
      expect(() => windowsHost(({ windows }) => { windows.package("A.B", { version }); }))
        .toThrow(`version "${version}" is not supported; use "any"`);
    }
    expect(() => windowsHost(({ windows }) => { windows.package({ id: "A.B" }, {}); }))
      .toThrow("takes an id string");
  });

  it("is never locked and is emitted presence-only", () => {
    const h = windowsHost(({ windows }) => {
      windows.package("Valve.Steam", { version: "any" });
      windows.package("Git.Git");
    });
    const resolved = resolveMissingWindowsLockEntries(emptyWindowsLock(), [h], (id) => `${id.length}.0`);
    expect(Object.keys(resolved.lock.packages)).toEqual(["Git.Git"]);
    expect(windowsLockGaps(emptyWindowsLock(), [h]).map((gap) => gap.id)).toEqual(["Git.Git"]);
    const mixed = windowsHost(({ windows }) => {
      windows.package("Valve.Steam", { version: "any" });
      windows.package("Valve.Steam", { version: "1.0" });
    });
    expect(() => reconcileInlinePins(emptyWindowsLock(), [mixed])).toThrow('both version "any" and version "1.0"');
    expect(() => generateWindows([mixed], emptyWindowsLock())).toThrow("Declare one version policy per package");
    const resources = generateWindows([h], resolved.lock).resources.desktop;
    expect(resources.find((resource) => resource.package?.id === "Valve.Steam")?.package).toMatchObject({ anyVersion: true, version: undefined });
    expect(resources.find((resource) => resource.package?.id === "Git.Git")?.package?.version).toBe("7.0");
  });
});

describe('applied state for version: "any" packages', () => {
  const pkg: ManagedResource = { kind: "package", source: "winget", id: "Valve.Steam" };
  const key = resourceKey(pkg);

  async function withState(run: (apply: (opts?: { any?: boolean; owner?: string; desired?: ManagedResource[] }) => Promise<string[]>,
    actual: Map<string, ResourceSnapshot>, remove: ReturnType<typeof vi.fn>) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "winix-any-version-"));
    const actual = new Map<string, ResourceSnapshot>();
    const remove = vi.fn(async (resource: ManagedResource) => { actual.delete(resourceKey(resource)); });
    try {
      await run(async ({ any = true, owner = "A/desktop", desired = [pkg] } = {}) => {
        const reports: string[] = [];
        await reconcileWindows({
          statePath: join(dir, "applied.json"), owner, desired,
          definitions: Object.fromEntries(desired.map((resource) => [resourceKey(resource), "version:any"])),
          anyVersionPackages: any ? new Set(desired.map(resourceKey)) : undefined,
          packageRequirements: any ? undefined : { [key]: { version: "1.0", exact: false } },
          dry: false, yes: true, report: (line) => reports.push(line),
          adapter: { inspect: async (resource) => actual.get(resourceKey(resource)) ?? null, remove },
          activate: async () => { if (!actual.has(key)) actual.set(key, { version: "1.0" }); },
        });
        return reports;
      }, actual, remove);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("treats self-updates as expected, including when removing the declaration", async () => {
    await withState(async (apply, actual, remove) => {
      await apply();
      actual.set(key, { version: "Unknown" });
      expect(await apply()).toContain(`Keeping package (version: any): ${key} Unknown`);
      actual.set(key, { version: "2.0" });
      await apply({ desired: [] });
      expect(remove).toHaveBeenCalledOnce();
    });
  });

  it("refuses to mix update policies across owners", async () => {
    await withState(async (apply) => {
      await apply({ owner: "A/desktop" });
      await expect(apply({ owner: "B/laptop", any: false })).rejects.toThrow("Conflicting package update policies");
    });
  });
});

describe("named Windows paths", () => {
  it("adds Program Files known folders", () => {
    const h = windowsHost(({ windows }) => {
      windows.file.symlink(windows.knownFolder.programFiles("komorebi/komorebi.json"), "../k.json");
    });
    expect(fileMeta(dscOf(h)[0])?.target).toEqual({ kind: "knownFolder", folder: "programFiles", path: "komorebi/komorebi.json" });
    expect(JSON.stringify(dscOf(h)[0].properties)).toContain("GetFolderPath('ProgramFiles')");
  });

  it("targets the PowerShell profile and Terminal settings, as links or copies", () => {
    const h = windowsHost(({ windows }) => {
      windows.powershell.profile("../powershell/profile.ps1");
      windows.powershell.profile("../powershell/legacy.ps1", { shell: "windowspowershell", mode: "copy" });
      windows.terminal.settings("../terminal/settings.json", { channel: "preview", backup: true });
      windows.terminal.settings("../terminal/stable.json");
    });
    const files = dscOf(h).map(fileMeta);
    expect(files.map((file) => [file?.action, file?.target])).toEqual([
      ["symlink", { kind: "knownFolder", folder: "documents", path: "PowerShell/Microsoft.PowerShell_profile.ps1" }],
      ["copy", { kind: "knownFolder", folder: "documents", path: "WindowsPowerShell/Microsoft.PowerShell_profile.ps1" }],
      ["symlink", { kind: "knownFolder", folder: "localAppData", path: "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json" }],
      ["symlink", { kind: "knownFolder", folder: "localAppData", path: "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json" }],
    ]);
    expect(files[2]?.backup).toBe(true);
    expect(() => windowsHost(({ windows }) => { windows.terminal.settings("../x.json", { channel: "canary" as never }); }))
      .toThrow('channel must be "stable" or "preview"');
    expect(() => windowsHost(({ windows }) => { windows.powershell.profile("../x.ps1", { mode: "hardlink" as never }); }))
      .toThrow('mode must be "symlink" or "copy"');
  });

  it("resolves config-relative values with windows.configPath", () => {
    let paths: string[] = [];
    windowsHost(({ windows }) => { paths = [windows.configPath(), windows.configPath(".."), windows.configPath("../windows")]; });
    expect(paths).toEqual(["D:\\dotfiles\\winix", "D:\\dotfiles", "D:\\dotfiles\\windows"]);
    expect(() => evaluate(workspace({ hosts: [host("desktop", platforms.windows(), ({ windows }) => {
      windows.env.set("X", windows.configPath(".."));
    })] }))).toThrow("windows.configPath needs the config directory");
  });
});

describe("inferred startup dependencies", () => {
  it.each(["app", "shortcut"] as const)("uses a file handle's target and orders the startup %s after it", (helper) => {
    const h = windowsHost(({ windows }) => {
      const tool = windows.package("LGUG2Z.komorebi");
      const config = windows.file.symlink(windows.knownFolder.userProfile("komorebi.json"), "../komorebi.json");
      windows.startup[helper]("komorebi", {
        executable: windows.knownFolder.programFiles("komorebi/bin/komorebic-no-console.exe"),
        arguments: ["start", "--config", config],
        dependsOn: tool,
      });
    });
    const [link, startup] = dscOf(h);
    expect(startup.dependsOn).toEqual([
      { kind: "package", id: "LGUG2Z.komorebi" },
      { kind: "dsc", token: link.token },
    ]);
    expect(JSON.stringify(startup.properties)).toContain("Join-Path $root 'komorebi.json'");
  });
});

describe("default backup of existing targets", () => {
  it("backs up by default; backup: false fails instead and force deletes", () => {
    const h = windowsHost(({ windows }) => {
      windows.file.symlink(windows.knownFolder.userProfile("a"), "../a");
      windows.file.copy(windows.knownFolder.userProfile("b"), "../b", { backup: false });
      windows.file.text(windows.knownFolder.userProfile("c"), "c", { force: true });
      windows.file.text(windows.knownFolder.userProfile("d"), "d", { force: true, backup: true });
      windows.powershell.profile("../profile.ps1");
      windows.wsl({ config: { wsl2: { memory: "8GB" } } });
      windows.startup.shortcut("tool", { executable: "pwsh.exe" });
      windows.startup.shortcut("strict", { executable: "pwsh.exe", backup: false });
    });
    const files = dscOf(h).map(fileMeta).filter((file) => file !== undefined);
    expect(files.map((file) => [file.backup, file.force])).toEqual([
      [true, false], [false, false], [false, true], [true, true], [true, false], [true, false],
    ]);
    const startups = dscOf(h).filter((resource) => resource.winix?.kind === "startup").map((resource) => JSON.stringify(resource.properties));
    // Startup backups leave the Startup folder (sign-in would try to open a .lnk.bak there).
    expect(startups[0]).toContain("Winix\\\\startup-backups");
    expect(startups[0]).not.toContain("Move-WinixExistingTarget $target");
    expect(startups[1]).toContain("Move-WinixExistingTarget $target $false $false");
    expect(startups[1]).not.toContain("startup-backups");
  });

  it("no longer accepts platforms.windows defaults", () => {
    const h = windowsHost(() => {}, platforms.windows({ defaults: { file: { backup: false } } } as never));
    expect(JSON.stringify(h.windows)).not.toContain("defaults");
  });
});

describe("settings theme colorMode", () => {
  const personalize = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
  it("sets apps and system together or separately", () => {
    expect(normalizeWinSettings({ theme: { colorMode: "dark" } }).personalizationDwords).toEqual([
      { path: personalize, name: "AppsUseLightTheme", value: 0 },
      { path: personalize, name: "SystemUsesLightTheme", value: 0 },
    ]);
    expect(normalizeWinSettings({ theme: { colorMode: { system: "light" } } }).personalizationDwords).toEqual([
      { path: personalize, name: "SystemUsesLightTheme", value: 1 },
    ]);
    expect(() => normalizeWinSettings({ theme: { colorMode: "blue" as never } })).toThrow("colorMode must be");
    expect(() => normalizeWinSettings({ theme: { colorMode: {} } })).toThrow("colorMode must be");
  });
});

describe("optional inputs", () => {
  it("allows Windows-only workspaces without inputs and warns for Nix hosts without nixpkgs", () => {
    const windowsOnly = workspace({ hosts: [host("desktop", platforms.windows(), [])] });
    expect(generateNix(windowsOnly, evaluate(windowsOnly)).warnings).toEqual([]);
    const nixos = workspace({ hosts: [host("server", platforms.nixos({ homeManager: false }), [])] });
    expect(generateNix(nixos, evaluate(nixos)).warnings).toEqual([
      'server: NixOS/nix-darwin hosts need a nixpkgs input, e.g. inputs: { nixpkgs: "nixos-unstable" }',
    ]);
  });
});

describe("winget authoring commands", () => {
  const exported = JSON.stringify({ Sources: [
    { SourceDetails: { Name: "winget" }, Packages: [
      { PackageIdentifier: "Git.Git" }, { PackageIdentifier: "Valve.Steam" }, { PackageIdentifier: "Microsoft.VCRedist.2015+.x64" },
    ] },
    { SourceDetails: { Name: "msstore" }, Packages: [{ PackageIdentifier: "9NBLGGH4NNS1" }] },
    { SourceDetails: { Name: "other" }, Packages: [{ PackageIdentifier: "Ignored" }] },
  ] });

  it("parses winget export and renders declarations", () => {
    expect(parseWingetExport(exported)).toEqual([
      { id: "Git.Git", source: "winget" }, { id: "Valve.Steam", source: "winget" },
      { id: "Microsoft.VCRedist.2015+.x64", source: "winget" }, { id: "9NBLGGH4NNS1", source: "msstore" },
    ]);
    expect(packageDeclaration({ id: "Git.Git", source: "winget" })).toBe('windows.package("Git.Git");');
    expect(packageDeclaration({ id: "9N", source: "msstore" })).toBe('windows.package({ source: "msstore", id: "9N" });');
    expect([isRuntimePackage("Microsoft.VCRedist.2015+.x64"), isRuntimePackage("Microsoft.WindowsAppRuntime.1.8"),
      isRuntimePackage("Microsoft.VisualStudioCode")]).toEqual([true, true, false]);
  });

  it("imports the difference between installed and declared packages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-import-test-"));
    try {
      const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      await writeFile(join(dir, "winix.config.mjs"), `
import { workspace, host, platforms } from ${JSON.stringify(sdk)};
export default workspace({ hosts: [host("desktop", platforms.windows(), ({ windows }) => {
  windows.package("git.git"); windows.package("Missing.App");
})] });`);
      const lines: string[] = [];
      const run = vi.fn((args: string[]) => {
        require("node:fs").writeFileSync(args[args.indexOf("--output") + 1], exported);
        return "";
      });
      await windowsImport(dir, { run, print: (line) => lines.push(line) });
      expect(run.mock.calls[0][0]).toEqual(expect.arrayContaining(["export", "--accept-source-agreements"]));
      const text = lines.join("\n");
      expect(text).toContain("Host desktop: 4 installed winget/msstore package(s), 2 declared.");
      expect(text).toContain('windows.package("Valve.Steam");');
      expect(text).toContain('windows.package({ source: "msstore", id: "9NBLGGH4NNS1" });');
      expect(text).not.toContain('windows.package("Git.Git")');
      expect(text).toContain("Shared runtimes, usually installed as dependencies (1)");
      expect(text).toContain("winget Missing.App");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("searches winget and explains how to declare a result", () => {
    const lines: string[] = [];
    packageSearch("komorebi", (args) => { expect(args.slice(0, 3)).toEqual(["search", "--query", "komorebi"]); return "results\n"; },
      (line) => lines.push(line));
    expect(lines[0]).toBe("results");
    expect(lines[1]).toContain('windows.package("<Id>")');
    expect(() => packageSearch(" ")).toThrow("Usage: winix windows search <query>");
  });
});
