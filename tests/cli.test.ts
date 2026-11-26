import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readWindowsLock } from "../src/backends/windows/lockfile.ts";
import * as packageVersionPolicy from "../src/cli/windows-package-versions.ts";
import { windowsSourcePath } from "../src/backends/windows/paths.ts";
import {
  detectConflicts,
  analyzeWorkspace,
  collectEscapeReport,
  collectSuspiciousNixReferences,
  findDuplicateHosts,
} from "../src/cli/analysis.js";
import {
  activationCommand,
  assertActivationSupported,
  platformForEvaluatedHost,
} from "../src/cli/activation.js";
import { applyWorkspace } from "../src/cli/commands/apply.js";
import { init, resolveWinixVersionRange } from "../src/cli/commands/init.js";
import {
  installSkill,
  SKILL_WRAPPER,
  SKILL_WRAPPER_PATH,
} from "../src/cli/commands/install.js";
import { check, validateGeneratedNixSyntax } from "../src/cli/commands/check.js";
import {
  flakeRefForHost,
  selectHost,
  switchCommand,
} from "../src/cli/commands/switch.js";
import { assertUpdateSupported, update } from "../src/cli/commands/update.js";
import {
  evaluate,
  host,
  nix,
  nixos as nixosHelpers,
  platform,
  platforms,
  windows,
  workspace,
} from "../src/index.js";
import { authoringApiPaths, renderSkill } from "../src/skill.js";
import { loadWorkspace } from "../src/cli/loader.ts";
import type { WindowsResourceSummary } from "../src/backends/windows/index.ts";
import type { ApplyBatch, ApplyStep, WindowsBatchRunner } from "../src/cli/windows-apply.ts";

/** The resources a Windows host's resources.json lists. */
async function windowsResources(outDir: string, hostName: string): Promise<WindowsResourceSummary[]> {
  const parsed = JSON.parse(await readFile(join(outDir, hostName, "resources.json"), "utf8")) as { resources: WindowsResourceSummary[] };
  return parsed.resources;
}

/** Every script of a Windows host, unescaped, for substring checks. */
async function windowsScripts(outDir: string, hostName: string): Promise<string> {
  return (await windowsResources(outDir, hostName))
    .map((resource) => [resource.testScript ?? "", resource.setScript ?? ""].join("\n")).join("\n");
}

function packageVersion(resources: WindowsResourceSummary[], id: string): string | undefined {
  return resources.find((resource) => resource.package?.id === id)?.package?.version;
}

const nixos = platform("linux", () => ({
  nixos: {
    system: { stateVersion: "25.05" },
  },
}));

describe("CLI analysis", () => {
  it("warns once per wholly ignored feature, and fails strict checks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-check-scopes-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("check exited"); });
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          feature("home-only", ({ home }) => { home.packages("git"); home.program("git"); })(),
          feature("portable", ({ home, windows }) => { home.packages("git"); windows.package("Git.Git"); })(),
          feature("empty", () => {})(),
        ]),
        host("server", platforms.nixos({ homeManager: false }), [
          feature("win-only", ({ windows }) => { windows.package("Git.Git"); })(),
          feature("home-disabled", ({ home }) => { home.packages("git"); })(),
        ]),
        host("mac", platforms.darwin(), [
          feature("win-only", ({ windows }) => { windows.package("Git.Git"); })(),
        ]),
        // Shared profiles span platforms: their inapplicable members are expected.
        host("roles", platforms.windows(), [
          profile("everywhere", [
            feature("tool-home", ({ home }) => { home.packages("eza"); })(),
            feature("tool-both", ({ home, windows }) => { home.packages("eza"); windows.package("eza-community.eza"); })(),
          ])(),
        ]),
        // The callback form lists features on the host itself: still warned.
        host("callback", platforms.windows(), () => [
          feature("listed-home", ({ home }) => { home.packages("git"); })(),
        ])
      `);
      await check(dir, { strict: false, escapeReport: false });
      expect(exit).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().filter((message) => message.includes("ignored scopes"))).toEqual([
        "Warning: desktop home-only: no applicable configuration (ignored scopes: homeManager).",
        "Warning: server win-only: no applicable configuration (ignored scopes: windows).",
        "Warning: server home-disabled: no applicable configuration (ignored scopes: homeManager).",
        "Warning: mac win-only: no applicable configuration (ignored scopes: windows).",
        "Warning: callback listed-home: no applicable configuration (ignored scopes: homeManager).",
      ]);
      await expect(check(dir, { strict: true, escapeReport: false })).rejects.toThrow("check exited");
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith("  Strict check failed");
    } finally {
      log.mockRestore(); warn.mockRestore(); error.mockRestore(); exit.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects duplicate hosts and scalar conflicts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { networking: { hostName: "first" } }, __id: "base" },
          { nixos: { networking: { hostName: "second" } }, __id: "override" },
        ]),
        host("wsl", nixos(), []),
      ],
    });

    describe("winix check generated syntax", () => {
      const output = {
        "flake.nix": "{ outputs = _: {}; }\n",
        hosts: { "wsl.nix": "{ ... }: {}\n" },
        rawModules: [],
        warnings: [],
      };

      it("parses every generated Nix source", () => {
        const parsed: string[] = [];
        validateGeneratedNixSyntax(output, (source) => {
          parsed.push(source);
          return { error: undefined, status: 0, stderr: "" };
        });

        expect(parsed).toEqual([output["flake.nix"], output.hosts["wsl.nix"]]);
      });

      it("reports the generated file containing invalid Nix syntax", () => {
        expect(() =>
          validateGeneratedNixSyntax(output, (source) => ({
            error: undefined,
            status: source === output.hosts["wsl.nix"] ? 1 : 0,
            stderr: source === output.hosts["wsl.nix"] ? "syntax error, unexpected '}'" : "",
          }))
        ).toThrow(
          "Generated Nix syntax is invalid in hosts/wsl.nix:\nsyntax error, unexpected '}'"
        );
      });

      it("skips syntax parsing when nix-instantiate is unavailable", () => {
        expect(() =>
          validateGeneratedNixSyntax(output, () => ({
            error: Object.assign(new Error("not found"), { code: "ENOENT" }),
            status: null,
            stderr: "",
          }))
        ).not.toThrow();
      });
    });

    expect(findDuplicateHosts(ws)).toEqual(["wsl"]);
    const conflicts = detectConflicts(analyzeWorkspace(ws));
    expect(conflicts).toEqual([
      expect.objectContaining({
        host: "wsl",
        scope: "nixos",
        path: "networking.hostName",
        firstFragment: "base",
        secondFragment: "override",
      }),
    ]);
  });

  it("hints at arrays when Nix list expressions replace each other", async () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { programs: { "nix-ld": { libraries: nix.withPkgs(["icu", "zlib"]) } } }, __id: "base" },
          { nixos: { programs: { "nix-ld": { libraries: nix.withPkgs(["icu"]) } } }, __id: "dotnet" },
          { nixos: { networking: { hostName: "first" } }, __id: "one" },
          { nixos: { networking: { hostName: "second" } }, __id: "two" },
        ]),
      ],
    });

    const conflicts = detectConflicts(analyzeWorkspace(ws));
    expect(conflicts.find((c) => c.path === "programs.nix-ld.libraries")?.hint)
      .toContain('[nix.pkg("icu")]');
    expect(conflicts.find((c) => c.path === "networking.hostName")?.hint).toBeUndefined();
  });

  it("appends package arrays and dedupes equal Nix expressions", () => {
    const [evaluated] = evaluate(workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { programs: { "nix-ld": { libraries: [nix.pkg("icu"), nix.pkg("zlib")] } } } },
          { nixos: { programs: { "nix-ld": { libraries: [nix.pkg("stdenv.cc.cc.lib"), nix.pkg("icu")] } } } },
        ]),
      ],
    }));
    const libraries = (evaluated.nixos as { programs: { "nix-ld": { libraries: { expr: string }[] } } })
      .programs["nix-ld"].libraries;
    expect(libraries.map((library) => library.expr))
      .toEqual(["pkgs.icu", "pkgs.zlib", "pkgs.stdenv.cc.cc.lib"]);
  });

  it("reports raw blocks, raw modules, and escape expressions before merge", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { users: { users: { root: { shell: nix.expr("pkgs.bash") } } } } },
          nixosHelpers.raw("services.openssh.enable = true;"),
        ]),
      ],
    });

    const report = collectEscapeReport(analyzeWorkspace(ws));
    expect(report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "escape", path: "users.users.root.shell" }),
        expect.objectContaining({ kind: "raw", path: "__raw.0" }),
      ])
    );
  });

  it("recommends typed helpers for suspicious literal Nix references", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          {
            homeManager: {
              home: {
                sessionVariables: {
                  CONFIG: "${config.home.homeDirectory}/.config/app",
                  TOOL: "${pkgs.hello}/bin/hello",
                  MIXED: "prefix ${lib.escapeShellArg} suffix",
                  DIRECT: "${pkgs.hello}",
                  SAFE: nix.str`${nix.pkg("hello")}/bin/hello`,
                  ORDINARY: "${HOME}/bin",
                },
              },
            },
          },
        ]),
      ],
    });

    const diagnostics = collectSuspiciousNixReferences(analyzeWorkspace(ws));
    expect(diagnostics).toEqual([
      expect.objectContaining({
        path: "home.sessionVariables.CONFIG",
        reference: "config.home.homeDirectory",
        recommendation: 'Use nix.homePath(".config/app").',
      }),
      expect.objectContaining({
        path: "home.sessionVariables.TOOL",
        reference: "pkgs.hello",
        recommendation: 'Use nix.pkgPath("hello", "bin/hello").',
      }),
      expect.objectContaining({
        path: "home.sessionVariables.MIXED",
        reference: "lib.escapeShellArg",
        recommendation: expect.stringContaining("nix.str"),
      }),
      expect.objectContaining({
        path: "home.sessionVariables.DIRECT",
        reference: "pkgs.hello",
        recommendation: 'Use nix.expr("pkgs.hello").',
      }),
    ]);
  });
});

describe("winix init", () => {
  it("scaffolds project files and refuses to overwrite without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-init-"));
    try {
      await init(dir, { force: false });
      expect(existsSync(join(dir, "winix.config.ts"))).toBe(true);
      expect(await readFile(join(dir, SKILL_WRAPPER_PATH), "utf-8")).toBe(
        SKILL_WRAPPER
      );

      const packageJson = await readFile(join(dir, "package.json"), "utf-8");
      expect(packageJson).toContain('"@adrifer/winix"');
      expect(packageJson).toContain('"check": "winix check"');
      expect(packageJson).toContain('"apply": "winix apply"');
      expect(packageJson).toContain('"switch": "winix switch"');

      await expect(init(dir, { force: false })).rejects.toThrow("already exists");
      await writeFile(join(dir, "winix.config.ts"), "custom");
      await init(dir, { force: true });
      expect(await readFile(join(dir, "winix.config.ts"), "utf-8")).not.toBe("custom");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pins @adrifer/winix to the current package version in the generated package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-init-version-"));
    try {
      await init(dir, { force: false });
      const packageJson = JSON.parse(
        await readFile(join(dir, "package.json"), "utf-8")
      ) as { dependencies?: Record<string, string> };
      const expected = await resolveWinixVersionRange();
      expect(expected).toMatch(/^\^\d+\.\d+\.\d+/);
      expect(packageJson.dependencies?.["@adrifer/winix"]).toBe(expected.replace(/^\^/, ""));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("winix skill", () => {
  it("documents every current public authoring helper", () => {
    const skill = renderSkill();
    for (const api of authoringApiPaths()) {
      expect(skill, `missing ${api}`).toContain(api);
    }
  });

  it("prints instructions without wrapper frontmatter", () => {
    const skill = renderSkill();
    expect(skill.startsWith("# Winix\n")).toBe(true);
    expect(skill).toContain("winix.config.ts");
    expect(skill).toContain("winix check");
    expect(skill).toContain("windows.file.symlink()");
    expect(skill).not.toContain("name: winix");
  });

  it("installs, preserves, and force-refreshes the wrapper", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-skill-"));
    try {
      await expect(installSkill(dir, { force: false })).resolves.toBe("installed");
      const path = join(dir, SKILL_WRAPPER_PATH);
      expect(await readFile(path, "utf-8")).toBe(SKILL_WRAPPER);
      await expect(installSkill(dir, { force: false })).resolves.toBe("current");

      await writeFile(path, "custom");
      await expect(installSkill(dir, { force: false })).rejects.toThrow(
        "already exists"
      );
      await expect(installSkill(dir, { force: true })).resolves.toBe("installed");
      expect(await readFile(path, "utf-8")).toBe(SKILL_WRAPPER);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("winix switch host selection", () => {
  it("uses requested host, singleton host, or current hostname match", () => {
    expect(selectHost(["wsl", "wsl-work"], "wsl-work", "other")).toBe("wsl-work");
    expect(selectHost(["only-host"], undefined, "other")).toBe("only-host");
    expect(selectHost(["wsl", "wsl-work"], undefined, "wsl")).toBe("wsl");
  });

  it("requires --host when current hostname does not match any configured host", () => {
    expect(() => selectHost(["wsl", "wsl-work"], undefined, "other")).toThrow(
      'Current hostname "other" does not match a configured host'
    );
  });

  it("formats flake refs with POSIX separators for Nix", () => {
    expect(flakeRefForHost("D:\\winix\\test-config\\.winix\\out", "wsl-work")).toBe(
      "path:D:/winix/test-config/.winix/out#wsl-work"
    );
  });

});

describe("activation commands", () => {
  it("detects Windows hosts from evaluated host output", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ]),
      ],
    });

    const [desktop] = evaluate(ws);
    expect(platformForEvaluatedHost(desktop)).toBe("windows");
  });

  it("runs NixOS and nix-darwin activation through sudo when not root", () => {
    expect(activationCommand("nixos", "path:/repo/.winix/out#wsl", false, "linux")).toEqual([
      "sudo",
      "nixos-rebuild",
      "switch",
      "--flake",
      "path:/repo/.winix/out#wsl",
    ]);
    expect(
      activationCommand("darwin", "path:/repo/.winix/out#macbook-pro", false, "darwin")
    ).toEqual([
      "sudo",
      "darwin-rebuild",
      "switch",
      "--flake",
      "path:/repo/.winix/out#macbook-pro",
    ]);
  });

  it("does not prefix activation commands with sudo when already root", () => {
    expect(activationCommand("darwin", "path:/repo/.winix/out#macbook-pro", true)).toEqual([
      "darwin-rebuild",
      "switch",
      "--flake",
      "path:/repo/.winix/out#macbook-pro",
    ]);
  });

  it("does not prefix dry-run activation commands with sudo on native Windows", () => {
    expect(
      activationCommand("nixos", "path:C:/repo/.winix/out#wsl", false, "win32")
    ).toEqual([
      "nixos-rebuild",
      "switch",
      "--flake",
      "path:C:/repo/.winix/out#wsl",
    ]);
  });

  it("fails clearly for native Windows activation and flake updates", () => {
    expect(() => assertActivationSupported("nixos", "win32")).toThrow(
      "NixOS activation is not supported from native Windows yet"
    );
    expect(() => assertActivationSupported("darwin", "win32")).toThrow(
      "nix-darwin activation is not supported from native Windows yet"
    );
    expect(() => assertActivationSupported("windows", "win32")).not.toThrow();
    expect(() => assertActivationSupported("windows", "linux")).toThrow(
      "Windows activation is only supported on native Windows"
    );
    expect(() => assertUpdateSupported("win32")).toThrow(
      "needs the Nix CLI: run it from WSL, Linux, or macOS"
    );
  });
});

describe("winix apply Windows output", () => {
  it("auto-resolves a missing floating package, writes the lock, and emits it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-autolock-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      const result = await applyWorkspace(
        dir,
        {
          dry: false,
          diff: false,
          resolveWindowsPackageVersion: () => "2.65.1",
        }
      );
      const config = await windowsResources(result.outDir, "desktop");
      const lock = JSON.parse(await readFile(join(dir, "winix-windows.lock"), "utf-8")) as {
        packages: Record<string, { version: string }>;
      };

      expect(packageVersion(config, "Fastfetch-cli.Fastfetch")).toBe("2.65.1");
      expect(lock.packages["Fastfetch-cli.Fastfetch"].version).toBe("2.65.1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not re-resolve packages already in the lock (deterministic, offline)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-locked-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      // Pre-seed the lock so the package is already resolved.
      await writeFile(
        join(dir, "winix-windows.lock"),
        JSON.stringify(
          {
            version: 1,
            generatedAt: "2026-01-01T00:00:00.000Z",
            packages: {
              "Fastfetch-cli.Fastfetch": {
                source: "winget",
                version: "2.0.0",
                resolvedAt: "2026-01-01T00:00:00.000Z",
              },
            },
          },
          null,
          2
        ) + "\n"
      );

      // A resolver that throws if called proves apply stays offline for
      // already-locked entries.
      const result = await applyWorkspace(dir, {
        dry: false,
        diff: false,
        resolveWindowsPackageVersion: () => {
          throw new Error("resolver must not be called for already-locked packages");
        },
      });
      const config = await windowsResources(result.outDir, "desktop");

      // Emits the locked version verbatim, no network call.
      expect(packageVersion(config, "Fastfetch-cli.Fastfetch")).toBe("2.0.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("auto-resolves missing packages on dry-run without writing the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-dry-autolock-"));
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args.join(" "));
    });
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      await applyWorkspace(
        dir,
        {
          dry: true,
          diff: false,
          resolveWindowsPackageVersion: () => "2.65.1",
        }
      );

      expect(existsSync(join(dir, "winix-windows.lock"))).toBe(false);
      expect(warnings.join("\n")).toContain(
        "Would update winix-windows.lock with resolved Windows package versions"
      );
      expect(warnings.join("\n")).toContain("Fastfetch-cli.Fastfetch winget 2.65.1");
    } finally {
      warnSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes resources.json and inline pins to the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package({ id: "Fastfetch-cli.Fastfetch", version: "2.45.0" }),
        ])
      `);

      const result = await applyWorkspace(dir, { dry: false, diff: false });
      const hostDir = join(result.outDir, "desktop");
      const config = await windowsResources(result.outDir, "desktop");

      expect(config).toEqual([expect.objectContaining({ type: "winget/package", name: "Fastfetch cli Fastfetch" })]);
      expect(packageVersion(config, "Fastfetch-cli.Fastfetch")).toBe("2.45.0");
      expect(existsSync(join(hostDir, "configuration.winget"))).toBe(false);
      expect(existsSync(join(hostDir, "apply.ps1"))).toBe(false);
      const lock = JSON.parse(await readFile(join(dir, "winix-windows.lock"), "utf-8")) as {
        packages?: Record<string, { version?: string }>;
      };
      expect(lock.packages?.["Fastfetch-cli.Fastfetch"]?.version).toBe("2.45.0");
      expect(existsSync(join(result.outDir, "hosts"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits the locked version for a floating Windows package with a lock entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-locked-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);
      await writeWindowsLock(dir, {
        "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.45.0" },
      });

      const calls: string[] = [];
      const result = await applyWorkspace(dir, {
        dry: false,
        diff: false,
        resolveWindowsPackageVersion: (id) => {
          calls.push(id);
          throw new Error("already-locked packages must not be resolved");
        },
      });
      const config = await windowsResources(result.outDir, "desktop");

      expect(packageVersion(config, "Fastfetch-cli.Fastfetch")).toBe("2.45.0");
      expect(calls).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes both Nix and Windows outputs for a mixed workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-mixed-"));
    try {
      await writeConfig(dir, `
        host("server", platforms.nixos(), []),
        host("desktop", platforms.windows(), [
          windows.package({ id: "Fastfetch-cli.Fastfetch", version: "2.45.0" }),
        ])
      `);

      const result = await applyWorkspace(dir, { dry: false, diff: false });
      const windowsConfig = await windowsResources(result.outDir, "desktop");
      const nixHost = await readFile(join(result.outDir, "hosts", "server.nix"), "utf-8");
      const flake = await readFile(join(result.outDir, "flake.nix"), "utf-8");

      expect(windowsConfig).toEqual([expect.objectContaining({ type: "winget/package" })]);
      expect(nixHost).toContain("Generated by Winix");
      expect(flake).toContain("nixosConfigurations.server");
      expect(flake).not.toContain("desktop");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update fails clearly for a Windows-only workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-windows-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      // Off Windows, plain update means the flake lock, which this workspace lacks.
      await expect(
        update(dir, { inputs: [], dry: false, platform: "linux" })
      ).rejects.toThrow("this workspace has no");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update on native Windows updates winix-windows.lock and notes the flake lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-native-windows-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ]),
        host("server", platforms.nixos({ stateVersion: "25.05" }), [])
      `);

      await update(dir, {
        inputs: [],
        dry: false,
        platform: "win32",
        resolveWindowsPackageVersion: () => "2.65.1",
      });

      const lock = JSON.parse(await readFile(join(dir, "winix-windows.lock"), "utf-8")) as {
        packages: Record<string, { version: string }>;
      };
      expect(lock.packages["Fastfetch-cli.Fastfetch"].version).toBe("2.65.1");
      expect(log.mock.calls.map(([line]) => String(line)).join("\n"))
        .toContain("run `winix update` from WSL, Linux or macOS");
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update on native Windows still needs Nix for a workspace without Windows hosts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-native-nix-"));
    try {
      await writeConfig(dir, `
        host("server", platforms.nixos({ stateVersion: "25.05" }), [])
      `);
      await expect(
        update(dir, { inputs: [], dry: false, platform: "win32" })
      ).rejects.toThrow("needs the Nix CLI");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update --windows resolves floating packages and writes the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-windows-resolve-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
          windows.package("eza-community.eza"),
        ])
      `);

      const calls: string[] = [];
      await update(dir, {
        inputs: [],
        dry: false,
        windows: true,
        resolveWindowsPackageVersion: (id) => {
          calls.push(id);
          return id === "Fastfetch-cli.Fastfetch" ? "2.65.1" : "0.23.4";
        },
      });

      const lock = JSON.parse(await readFile(join(dir, "winix-windows.lock"), "utf-8")) as {
        packages: Record<string, { version: string }>;
      };
      expect(calls.sort()).toEqual(["Fastfetch-cli.Fastfetch", "eza-community.eza"]);
      expect(lock.packages["Fastfetch-cli.Fastfetch"].version).toBe("2.65.1");
      expect(lock.packages["eza-community.eza"].version).toBe("0.23.4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update --windows does not resolve inline-pinned packages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-windows-pinned-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package({ id: "Fastfetch-cli.Fastfetch", version: "2.45.0" }),
        ])
      `);

      await update(dir, {
        inputs: [],
        dry: false,
        windows: true,
        resolveWindowsPackageVersion: () => {
          throw new Error("inline pins must not be resolved");
        },
      });

      const lock = JSON.parse(await readFile(join(dir, "winix-windows.lock"), "utf-8")) as {
        packages: Record<string, { version: string }>;
      };
      expect(lock.packages["Fastfetch-cli.Fastfetch"].version).toBe("2.45.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update --windows --dry resolves and reports without writing the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-windows-dry-"));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      await update(dir, {
        inputs: [],
        dry: true,
        windows: true,
        resolveWindowsPackageVersion: () => "2.65.1",
      });

      expect(existsSync(join(dir, "winix-windows.lock"))).toBe(false);
      expect(logs.join("\n")).toContain("resolved  Fastfetch-cli.Fastfetch winget 2.65.1 (new)");
      expect(logs.join("\n")).toContain("Dry run: winix-windows.lock would be updated.");
    } finally {
      logSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("winix update --windows reports packages that are already up to date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-update-windows-uptodate-"));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);
      await writeWindowsLock(dir, {
        "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.65.1" },
      });

      await update(dir, {
        inputs: [],
        dry: false,
        windows: true,
        resolveWindowsPackageVersion: () => "2.65.1",
      });

      expect(logs.join("\n")).toContain("up to date  Fastfetch-cli.Fastfetch winget 2.65.1");
      expect(logs.join("\n")).toContain("winix-windows.lock is already up to date.");
    } finally {
      logSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Font CLI locking", () => {
  it("previews without writes, pins fonts, reuses pins offline and updates only fonts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-font-cli-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), ({ windows }) => {
          windows.fonts({ sources: [{ provider: "nerd-fonts", family: "JetBrainsMono" }] });
        })
      `);
      const pin = {
        url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.zip",
        version: "v3.5.1", format: "zip" as const, sha256: "a".repeat(64), resolvedAt: new Date().toISOString(),
      };
      await applyWorkspace(dir, { dry: true, diff: false, resolveWindowsFont: async () => pin });
      expect(readWindowsLock(dir)).toBeNull();
      expect(existsSync(join(dir, ".winix", "out"))).toBe(false);
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsFont: async () => pin });
      const before = readWindowsLock(dir)!;
      const offline = vi.fn(async () => { throw new Error("offline"); });
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsFont: offline });
      expect(offline).not.toHaveBeenCalled();
      const next = { ...pin, version: "v3.5.2", url: pin.url.replace("v3.5.1", "v3.5.2"), sha256: "b".repeat(64) };
      await update(dir, { windows: true, inputs: ["fonts"], dry: true, resolveWindowsFont: async () => next });
      expect(readWindowsLock(dir)).toEqual(before);
      await update(dir, { windows: true, inputs: ["fonts"], dry: false, resolveWindowsFont: async () => next });
      expect(Object.values(readWindowsLock(dir)!.fonts!)[0].version).toBe("v3.5.2");
      expect(readWindowsLock(dir)!.packages).toEqual(before.packages);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("PowerShell module CLI locking", () => {
  it("pins implicit Settings from the approved feed, reuses it offline and updates it explicitly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-settings-cli-"));
    const uri = "https://packages.example.com/powershell/v3/index.json";
    try {
      await writeConfig(dir, `
        host("work", platforms.windows(), ({ windows }) => {
          windows.settings.developer({ mode: true });
          windows.powershell.module("Terminal-Icons");
          windows.powershell.repositories({
            repositories: { approved: { uri: ${JSON.stringify(uri)} } },
            default: "approved", allowed: ["approved"],
          });
        })
      `);
      const resolve = vi.fn((name: string) => name === "Microsoft.Windows.Settings" ? "0.1.0-alpha.6" : "0.11.0");
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsModuleVersion: resolve });
      expect(resolve).toHaveBeenCalledWith("Microsoft.Windows.Settings", "approved", uri, true);
      const before = readWindowsLock(dir)!;
      const offline = () => { throw new Error("offline"); };
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsModuleVersion: offline });
      expect(readWindowsLock(dir)).toEqual(before);
      const resolveUpdate = vi.fn(() => "0.1.0-alpha.7");
      await update(dir, {
        inputs: ["Microsoft.Windows.Settings"], windows: true, dry: true,
        resolveWindowsModuleVersion: resolveUpdate,
      });
      expect(resolveUpdate).toHaveBeenCalledExactlyOnceWith("Microsoft.Windows.Settings", "approved", uri, true);
      expect(readWindowsLock(dir)).toEqual(before);
      await update(dir, {
        inputs: ["Microsoft.Windows.Settings"], windows: true, dry: false,
        resolveWindowsModuleVersion: resolveUpdate,
      });
      for (const [key, pin] of Object.entries(before.modules!)) {
        expect(readWindowsLock(dir)!.modules![key].version).toBe(
          key.startsWith("microsoft.windows.settings") ? "0.1.0-alpha.7" : pin.version);
      }
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsModuleVersion: offline });
      const output = await windowsScripts(join(dir, ".winix", "out"), "work");
      expect(output).toContain("$version = '0.1.0-alpha.7'");
      expect(output).toContain("-Repository 'approved'");
      expect(output).not.toContain("PSGallery");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("updates a named module across personal and work sources without changing unrelated pins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-module-work-cli-"));
    const uri = "https://packages.example.com/powershell/v3/index.json";
    try {
      await writeConfig(dir, `
        host("personal", platforms.windows(), [
          windows.powershell.module("Terminal-Icons"),
          windows.powershell.module("posh-git"),
        ]),
        host("work", platforms.windows(), ({ windows }) => {
          windows.powershell.module("Terminal-Icons");
          windows.powershell.repositories({
            repositories: { approved: { uri: ${JSON.stringify(uri)} } },
            default: "approved",
            allowed: ["approved"],
          });
        })
      `);
      const resolve = vi.fn(() => "0.11.0");
      await applyWorkspace(dir, {
        host: "work", dry: false, diff: false, resolveWindowsModuleVersion: resolve,
      });
      expect(resolve).toHaveBeenCalledExactlyOnceWith("Terminal-Icons", "approved", uri, false);
      await applyWorkspace(dir, {
        dry: false, diff: false, resolveWindowsModuleVersion: () => "0.11.0",
      });
      const before = readWindowsLock(dir)!;
      const updateModule = vi.fn(() => "0.12.0");
      await update(dir, {
        inputs: ["terminal-icons"], windows: true, dry: false,
        resolveWindowsModuleVersion: updateModule,
      });
      expect(updateModule).toHaveBeenCalledTimes(2);
      const after = readWindowsLock(dir)!;
      expect(Object.values(after.modules!).filter((entry) => entry.version === "0.12.0")).toHaveLength(2);
      expect(after.modules?.["posh-git"]).toEqual(before.modules?.["posh-git"]);
      await applyWorkspace(dir, {
        host: "work", dry: false, diff: false,
        resolveWindowsModuleVersion: () => { throw new Error("offline"); },
      });
      const output = await windowsScripts(join(dir, ".winix", "out"), "work");
      expect(output).not.toContain("PSGallery");
      expect(output).toContain("-Repository 'approved'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pins on first apply, reuses pins offline, and updates only a named module", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-module-cli-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package({ id: "Git.Git", version: "2.44.0" }),
          windows.powershell.module("Terminal-Icons"),
          windows.powershell.module("posh-git"),
          windows.file.copy("%USERPROFILE%\\\\profile.ps1", "../windows/profile.ps1"),
        ])
      `);
      const resolve = vi.fn(() => "0.11.0");
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsModuleVersion: resolve });
      expect(resolve).toHaveBeenCalledTimes(2);
      const original = readWindowsLock(dir)!;
      expect(original.modules?.["terminal-icons"].version).toBe("0.11.0");
      expect(original.packages["Git.Git"].version).toBe("2.44.0");
      const output = await windowsScripts(join(dir, ".winix", "out"), "desktop");
      expect(output).toContain(windowsSourcePath(join(dir, "..", "windows", "profile.ps1")));
      await applyWorkspace(dir, {
        dry: false, diff: false,
        resolveWindowsModuleVersion: () => { throw new Error("offline"); },
      });
      expect(readWindowsLock(dir)).toEqual(original);
      await update(dir, {
        inputs: ["terminal-icons"], dry: false, windows: true,
        resolveWindowsPackageVersion: () => { throw new Error("must not resolve packages"); },
        resolveWindowsModuleVersion: (name) => {
          expect(name).toBe("Terminal-Icons");
          return "0.12.0";
        },
      });
      const updated = readWindowsLock(dir)!;
      expect(updated.modules?.["terminal-icons"].version).toBe("0.12.0");
      expect(updated.modules?.["posh-git"]).toEqual(original.modules?.["posh-git"]);
      expect(updated.packages).toEqual(original.packages);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write dry-run or failed module resolutions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-module-cli-dry-"));
    try {
      await writeConfig(dir, `host("desktop", platforms.windows(), [
        windows.powershell.module("Terminal-Icons"),
      ])`);
      await applyWorkspace(dir, {
        dry: true, diff: false, resolveWindowsModuleVersion: () => "0.11.0",
      });
      expect(readWindowsLock(dir)).toBeNull();
      await update(dir, {
        inputs: [], windows: true, dry: true, resolveWindowsModuleVersion: () => "0.11.0",
      });
      expect(readWindowsLock(dir)).toBeNull();
      await applyWorkspace(dir, {
        dry: false, diff: false, resolveWindowsModuleVersion: () => "0.11.0",
      });
      const before = await readFile(join(dir, "winix-windows.lock"), "utf8");
      await expect(update(dir, {
        inputs: [], windows: true, dry: false,
        resolveWindowsModuleVersion: () => { throw new Error("repository unavailable"); },
      })).rejects.toThrow("repository unavailable");
      expect(await readFile(join(dir, "winix-windows.lock"), "utf8")).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** A batch runner that records what switch asks it to apply. */
function fakeWindowsRunner(onStep: (step: ApplyStep) => void | Promise<void> = () => {}) {
  const batches: ApplyBatch[] = [];
  const runner: WindowsBatchRunner = {
    run: vi.fn(async (batch: ApplyBatch) => {
      batches.push(batch);
      for (const step of batch.steps) await onStep(step);
      return batch.steps.map((step) => ({ name: step.name, status: "applied" as const }));
    }),
  };
  return { runner, batches, steps: () => batches.flatMap((batch) => batch.steps) };
}

describe("winix switch Windows dry run", () => {
  it("prints a plan instead of the generated files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-switch-windows-"));
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package({ id: "Fastfetch-cli.Fastfetch", version: "2.45.0" }),
        ])
      `);

      await switchCommand(dir, {
        host: "desktop", dry: true,
        windowsState: {
          path: join(dir, "applied.json"),
          adapter: { inspect: async () => null, remove: async () => { throw new Error("Dry run must not remove"); } },
        },
      });
      const output = logs.join("\n");
      expect(output).not.toContain("winget configure");
      // A plan, not the generated files. Machine checks need native Windows.
      if (process.platform === "win32") {
        expect(output).toContain("winix switch would apply only this change.");
        expect(output).toContain("Plan for desktop: 1 change, 0 unchanged");
        expect(output).toMatch(/\+ install\s+Fastfetch-cli\.Fastfetch\s+2\.45\.0/);
      } else {
        expect(output).toContain("Plan for desktop (not checked against a machine: machine checks need native Windows)");
        expect(output).toContain("Declares 1 package.");
        expect(output).toContain("winix switch on that Windows machine would check this resource and apply only what is out of date.");
      }
      expect(output).not.toContain('"resources"');
    } finally {
      logSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }

  });
});

describe.skipIf(process.platform !== "win32")("winix switch Windows ownership", () => {
  it.each([true, false])("switches presence-only after an unknown observation (dry: %s)", async (dry) => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-unknown-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const confirm = vi.spyOn(packageVersionPolicy, "confirmWindowsPackageLockUpdate");
    const fake = fakeWindowsRunner();
    try {
      await writeConfig(dir, 'host("desktop", platforms.windows(), [windows.package("Example.App")])');
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1, generatedAt: "2026-11-13T00:00:00Z",
        packages: { "Example.App": { version: "7", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" } },
      }));
      const inspect = vi.fn(async () => ({ version: "Unknown" }))
        .mockResolvedValueOnce({ version: "Unknown" })
        .mockResolvedValueOnce({ version: "Unknown" })
        .mockResolvedValueOnce({ version: "8" });
      await switchCommand(dir, {
        host: "desktop", dry, windowsRunner: fake.runner,
        windowsState: { path: join(dir, "applied.json"), adapter: { inspect, remove: vi.fn() } },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Example\.App.*Unknown.*without enforcing locked version 7/));
      // Presence-only: installed, so nothing to apply (a locked version would reinstall on every run).
      expect(fake.runner.run).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(readWindowsLock(dir)?.packages["Example.App"].version).toBe("7");
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("= 1 unchanged (1 package)");
      expect(output).toContain("Plan for desktop: no changes, 1 unchanged");
      if (!dry) expect(output).toContain("Nothing to change.");
    } finally {
      log.mockRestore(); warn.mockRestore(); confirm.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["stale", "failed", "concurrent"] as const)("does not update locks after %s activation state", async (failure) => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-lock-safety-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const confirm = vi.spyOn(packageVersionPolicy, "confirmWindowsPackageLockUpdate").mockImplementation(async () => {
      const lock = readWindowsLock(dir)!;
      lock.packages["Other.App"] = { version: "2", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" };
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify(lock));
      return true;
    });
    const runner: WindowsBatchRunner = {
      run: vi.fn(async (batch: ApplyBatch) => batch.steps.map((step) => failure === "failed"
        ? { name: step.name, status: "failed" as const, error: "activation failed" }
        : { name: step.name, status: "applied" as const })),
    };
    let inspections = 0;
    try {
      // The raw command runs on every switch, so there is always something to apply.
      await writeConfig(dir, `host("desktop", platforms.windows(), [
        windows.package("Example.App"), windows.raw({ name: "probe", executable: "cmd.exe" }),
      ])`);
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1, generatedAt: "2026-11-13T00:00:00Z",
        packages: { "Example.App": { version: "7", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" } },
      }));
      const switching = switchCommand(dir, {
        host: "desktop", dry: false, windowsRunner: runner,
        windowsState: {
          path: join(dir, "inventory.json"),
          adapter: {
            // The initial inventory is reused by the plan; the post-activation check is the second inspection.
            inspect: async () => ({ version: failure === "stale" && ++inspections >= 2 ? "9" : "8" }),
            remove: async () => { throw new Error("Must not uninstall"); },
          },
        },
      });
      if (failure === "stale") await switching;
      else await expect(switching).rejects.toThrow(failure === "failed" ? "did not apply" : "changed during switch");
      expect(readWindowsLock(dir)?.packages["Example.App"].version).toBe("7");
      if (failure !== "concurrent") expect(confirm).not.toHaveBeenCalled();
      else expect(readWindowsLock(dir)?.packages["Other.App"].version).toBe("2");
      if (failure === "stale") {
        expect(log).toHaveBeenCalledWith("Not updating lock for Example.App: installed version changed during activation.");
      }
    } finally {
      log.mockRestore(); confirm.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops before activation when a package it would upgrade is running, then upgrades it in the elevated step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-running-upgrade-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let activated = false;
    const fake = fakeWindowsRunner(() => { activated = true; });
    const running = vi.fn(async (ids: string[]) => new Map(ids.includes("Example.App")
      ? [["Example.App", [{ name: "example.exe", pid: 7 }]]] : []));
    const elevation = vi.fn(async () => new Map([["Example.App", "installed machine-wide"]]));
    const planChecker = { scripts: async () => new Map(), dsc: async () => new Map(), running, elevation };
    try {
      await writeConfig(dir, 'host("desktop", platforms.windows(), [windows.package("Example.App"), windows.package("Current.App")])');
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1,
        packages: {
          "Example.App": { version: "8", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" },
          "Current.App": { version: "2", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" },
        },
      }));
      const windowsState = {
        path: join(dir, "inventory.json"),
        adapter: {
          inspect: async (resource: { id?: string }) => ({
            version: resource.id === "Example.App" ? (activated ? "8" : "7") : "2",
          }),
          remove: async () => { throw new Error("Must not uninstall"); },
        },
      };
      await expect(switchCommand(dir, { host: "desktop", dry: false, windowsState, planChecker, windowsRunner: fake.runner }))
        .rejects.toThrow("Example.App: example.exe, pid 7");
      expect(running).toHaveBeenCalledWith(["Example.App"]);
      expect(fake.runner.run).not.toHaveBeenCalled();

      running.mockResolvedValue(new Map());
      await switchCommand(dir, { host: "desktop", dry: false, windowsState, planChecker, windowsRunner: fake.runner });
      expect(elevation).toHaveBeenLastCalledWith([{ id: "Example.App", source: "winget", action: "upgrade", version: "8" }]);
      // Only the outdated package is applied, in one elevated batch.
      expect(fake.batches).toEqual([{
        elevated: true,
        steps: [expect.objectContaining({ kind: "package", package: { id: "Example.App", source: "winget", version: "8", action: "upgrade" } })],
      }]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Approve the UAC prompt for the change that needs administrator rights"));
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["accept", "decline", "dry"] as const)("keeps a newer package without reinstalling it and %s the optional lock update", async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-upgrade-"));
    const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
    const confirm = vi.spyOn(packageVersionPolicy, "confirmWindowsPackageLockUpdate").mockResolvedValue(mode === "accept");
    const fake = fakeWindowsRunner();
    try {
      await writeConfig(dir, 'host("desktop", platforms.windows(), [windows.package("Example.App")])');
      const lock = {
        version: 1, generatedAt: "2026-11-13T00:00:00Z",
        packages: { "Example.App": { version: "7", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" } },
      };
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify(lock));
      const inventory = join(dir, "inventory.json");
      await switchCommand(dir, {
        dry: mode === "dry", host: "desktop", windowsRunner: fake.runner,
        windowsState: {
          path: inventory,
          adapter: { inspect: async () => ({ version: "8" }), remove: async () => { throw new Error("Must not uninstall"); } },
        },
      });
      expect(fake.runner.run).not.toHaveBeenCalled();
      expect(readWindowsLock(dir)?.packages["Example.App"].version).toBe(mode === "accept" ? "8" : "7");
      if (mode === "dry") {
        expect(confirm).not.toHaveBeenCalled();
        expect(logs.some((line) => line.includes("newer than locked") && line.includes("Example.App"))).toBe(true);
        expect(existsSync(inventory)).toBe(false);
      } else {
        expect(confirm).toHaveBeenCalledWith("Example.App", "8", "7", 0);
        expect(JSON.parse(await readFile(inventory, "utf8")).entries['["package","winget","example.app"]'].owned).toBe(false);
      }
    } finally {
      log.mockRestore(); confirm.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("raises the lock for every remaining package after an 'all' answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-upgrade-all-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const confirm = vi.spyOn(packageVersionPolicy, "confirmWindowsPackageLockUpdate")
      .mockResolvedValueOnce(false).mockResolvedValueOnce("all");
    const fake = fakeWindowsRunner();
    try {
      await writeConfig(dir, `host("desktop", platforms.windows(), [
        windows.package("A.App"), windows.package("B.App"), windows.package("C.App"), windows.package("D.App"),
      ])`);
      const pin = { version: "7", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" };
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1, generatedAt: "2026-11-13T00:00:00Z",
        packages: { "A.App": pin, "B.App": pin, "C.App": pin, "D.App": pin },
      }));
      await switchCommand(dir, {
        dry: false, host: "desktop", windowsRunner: fake.runner,
        windowsState: {
          path: join(dir, "inventory.json"),
          adapter: { inspect: async () => ({ version: "8" }), remove: async () => { throw new Error("Must not uninstall"); } },
        },
      });
      // Declined A, answered "all" at B: B, C and D are raised without more questions.
      expect(confirm.mock.calls).toEqual([["A.App", "8", "7", 3], ["B.App", "8", "7", 2]]);
      const versions = Object.fromEntries(Object.entries(readWindowsLock(dir)!.packages).map(([id, entry]) => [id, entry.version]));
      expect(versions).toEqual({ "A.App": "7", "B.App": "8", "C.App": "8", "D.App": "8" });
    } finally {
      log.mockRestore(); confirm.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("raises the lock for every newer package without asking with --update-versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-update-versions-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const confirm = vi.spyOn(packageVersionPolicy, "confirmWindowsPackageLockUpdate");
    const fake = fakeWindowsRunner();
    try {
      await writeConfig(dir, `host("desktop", platforms.windows(), [
        windows.package("A.App"), windows.package("B.App"),
      ])`);
      const pin = { version: "7", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" };
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1, generatedAt: "2026-11-13T00:00:00Z", packages: { "A.App": pin, "B.App": pin },
      }));
      await switchCommand(dir, {
        dry: false, host: "desktop", updateVersions: true, windowsRunner: fake.runner,
        windowsState: {
          path: join(dir, "inventory.json"),
          adapter: { inspect: async () => ({ version: "8" }), remove: async () => { throw new Error("Must not uninstall"); } },
        },
      });
      expect(confirm).not.toHaveBeenCalled();
      const versions = Object.fromEntries(Object.entries(readWindowsLock(dir)!.packages).map(([id, entry]) => [id, entry.version]));
      expect(versions).toEqual({ "A.App": "8", "B.App": "8" });
    } finally {
      log.mockRestore(); confirm.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a package winget cannot upgrade and still applies what depends on it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-package-unmatched-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fake = fakeWindowsRunner();
    try {
      await writeConfig(dir, `host("desktop", platforms.windows(), ({ windows }) => {
        const pwsh = windows.package("Microsoft.PowerShell");
        windows.raw({ name: "after pwsh", executable: "cmd.exe", dependsOn: pwsh });
      })`);
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        version: 1, generatedAt: "2026-11-13T00:00:00Z",
        packages: { "Microsoft.PowerShell": { version: "7.7.0.0", source: "winget", resolvedAt: "2026-11-13T00:00:00Z" } },
      }));
      await switchCommand(dir, {
        dry: false, host: "desktop", windowsRunner: fake.runner,
        planChecker: {
          scripts: async () => new Map(), dsc: async () => new Map(),
          unmatched: async () => new Set(["Microsoft.PowerShell"]),
        },
        windowsState: {
          path: join(dir, "inventory.json"),
          adapter: { inspect: async () => ({ version: "7.6.10.0" }), remove: async () => { throw new Error("Must not uninstall"); } },
        },
      });
      // No upgrade is attempted; the dependent command runs; the older version passes verification.
      const steps = fake.batches.flatMap((batch) => batch.steps);
      expect(steps.map((step) => step.kind)).toEqual(["command"]);
      expect(steps[0].dependsOn).toEqual([]);
      expect(readWindowsLock(dir)?.packages["Microsoft.PowerShell"].version).toBe("7.7.0.0");
      expect(log.mock.calls.flat().join("\n")).toContain("winget cannot upgrade it to 7.7.0.0; switch keeps it");
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["startup", "startup-app", "package"] as const)("records successful %s activation and automatically removes a deleted declaration only on a real switch", async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "winix-switch-state-"));
    let present = false;
    const snapshot = kind === "package" ? { version: "1.0" } : { fingerprint: "a".repeat(64) };
    const key = kind === "package" ? '["package","winget","example.app"]' : `["${kind}","probe"]`;
    const fake = fakeWindowsRunner(() => { present = true; });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const remove = vi.fn(async () => { present = false; });
    const windowsState = {
      path: join(dir, "inventory.json"),
      adapter: { inspect: async () => present ? snapshot : null, remove },
    };
    try {
      const declaration = kind === "package" ? 'windows.package({ id: "Example.App", version: "1.0" })'
        : `windows.startup.${kind === "startup" ? "shortcut" : "app"}("probe", { executable: "pwsh.exe" })`;
      await writeConfig(dir, `host("desktop", platforms.windows(), [${declaration}])`);
      await switchCommand(dir, { dry: false, windowsState, windowsRunner: fake.runner });
      expect(present).toBe(true);
      expect(fake.steps().map((step) => step.kind)).toEqual(kind === "package" ? ["package"] : ["script"]);
      expect(JSON.parse(await readFile(windowsState.path, "utf8")).entries[key].owned).toBe(true);
      const loaded = await loadWorkspace(dir);
      loaded.workspace.hosts[0] = host("desktop", platforms.windows(), []);
      logs.mockClear();
      await switchCommand(dir, { dry: true, windowsState, windowsRunner: fake.runner });
      expect(remove).not.toHaveBeenCalled();
      // The removal is part of the plan, labelled like everything else.
      const label = { startup: "Startup shortcut probe", "startup-app": "Startup app probe (sign-in task)", package: "Example.App (winget package)" }[kind];
      const dryOutput = logs.mock.calls.flat().join("\n");
      expect(dryOutput).toContain(`  - remove  ${label}  no longer declared${kind === "package" ? "; uninstalls it" : ""}`);
      expect(dryOutput).toContain('winix switch would remove the item marked "- remove" (after asking).');
      expect(dryOutput).not.toContain('["');
      vi.stubGlobal("process", { ...process, stdin: { isTTY: false }, stdout: { isTTY: false } });
      try {
        await expect(switchCommand(dir, { dry: false, windowsState, windowsRunner: fake.runner })).rejects.toThrow("use --yes");
      } finally { vi.unstubAllGlobals(); }
      expect(remove).not.toHaveBeenCalled();
      await switchCommand(dir, { dry: false, yes: true, windowsState, windowsRunner: fake.runner });
      expect(remove).toHaveBeenCalledTimes(1);
      expect(present).toBe(false);
    } finally {
      logs.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeConfig(dir: string, hostsSource: string): Promise<void> {
  const indexUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  await writeFile(
    join(dir, "winix.config.mjs"),
    `
      import { feature, host, platforms, profile, windows, workspace } from ${JSON.stringify(indexUrl)};

      export default workspace({
        inputs: { nixpkgs: "nixos-unstable" },
        hosts: [
          ${hostsSource}
        ],
      });
    `
  );
}

async function writeWindowsLock(
  dir: string,
  packages: Record<string, { source: "winget" | "msstore"; version: string }>
): Promise<void> {
  await writeFile(
    join(dir, "winix-windows.lock"),
    JSON.stringify(
      {
        version: 1,
        generatedAt: "2026-06-24T18:37:00.000Z",
        packages: Object.fromEntries(
          Object.entries(packages).map(([id, entry]) => [
            id,
            {
              source: entry.source,
              version: entry.version,
              resolvedAt: "2026-06-24T18:37:00.000Z",
            },
          ])
        ),
      },
      null,
      2
    ) + "\n"
  );
}
