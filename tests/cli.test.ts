import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  detectConflicts,
  analyzeWorkspace,
  collectEscapeReport,
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
  flakeRefForHost,
  selectHost,
  switchCommand,
  windowsConfigurationForHost,
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

const nixos = platform("linux", () => ({
  nixos: {
    system: { stateVersion: "25.05" },
  },
}));

describe("CLI analysis", () => {
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
});

describe("winix init", () => {
  it("scaffolds project files and refuses to overwrite without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-init-"));
    try {
      await init(dir, { force: false });
      expect(existsSync(join(dir, "winix.config.ts"))).toBe(true);

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
      expect(packageJson.dependencies?.["@adrifer/winix"]).toBe(expected);
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

  it("formats Windows configuration paths for activation", () => {
    // Use path.join for the expected value so the assertion is OS-agnostic:
    // on Windows the separator is "\\", on Linux/CI it is "/". The function
    // itself uses path.join, which produces the right separator per platform
    // (winget on Windows gets backslashes).
    const outDir = join("D:\\winix\\test-config\\.winix\\out");
    expect(windowsConfigurationForHost(outDir, "desktop")).toBe(
      join(outDir, "desktop", "configuration.winget")
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

  it("runs Windows activation through winget configure without sudo", () => {
    expect(activationCommand("windows", "D:\\repo\\.winix\\out\\desktop\\configuration.winget")).toEqual([
      "winget",
      "configure",
      "-f",
      "D:\\repo\\.winix\\out\\desktop\\configuration.winget",
      "--accept-configuration-agreements",
      "--disable-interactivity",
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
      "winget configure` only runs on Windows"
    );
    expect(() => assertUpdateSupported("win32")).toThrow(
      "`winix update` is not supported from native Windows yet"
    );
  });
});

describe("winix apply Windows output", () => {
  it("fails clearly for a floating Windows package with no lock entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-unlocked-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
        ])
      `);

      await expect(
        applyWorkspace(dir, { dry: false, diff: false })
      ).rejects.toThrow(
        'Windows package "Fastfetch-cli.Fastfetch" is not locked'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes configuration.winget, apply.ps1, and inline pins to the lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-apply-windows-"));
    try {
      await writeConfig(dir, `
        host("desktop", platforms.windows(), [
          windows.package({ id: "Fastfetch-cli.Fastfetch", version: "2.45.0" }),
        ])
      `);

      const result = await applyWorkspace(dir, { dry: false, diff: false });
      const hostDir = join(result.outDir, "desktop");
      const config = await readFile(join(hostDir, "configuration.winget"), "utf-8");
      const applyScript = await readFile(join(hostDir, "apply.ps1"), "utf-8");

      expect(config).toContain("processor: dscv3");
      expect(config).toContain("type: Microsoft.WinGet/Package");
      expect(config).toContain('version: "2.45.0"');
      expect(applyScript).toContain("winget configure");
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

      const result = await applyWorkspace(dir, { dry: false, diff: false });
      const config = await readFile(
        join(result.outDir, "desktop", "configuration.winget"),
        "utf-8"
      );

      expect(config).toContain('version: "2.45.0"');
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
      const windowsConfig = await readFile(
        join(result.outDir, "desktop", "configuration.winget"),
        "utf-8"
      );
      const nixHost = await readFile(join(result.outDir, "hosts", "server.nix"), "utf-8");
      const flake = await readFile(join(result.outDir, "flake.nix"), "utf-8");

      expect(windowsConfig).toContain("processor: dscv3");
      expect(windowsConfig).toContain("type: Microsoft.WinGet/Package");
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

      // On non-win32 platforms assertUpdateSupported passes, so the
      // workspace-level guard rejects this before invoking `nix flake update`.
      // On native Windows, the platform guard rejects first because update
      // currently requires the Nix CLI.
      const expectedMessage =
        process.platform === "win32" ? "not supported from native Windows" : "this workspace has no";
      await expect(
        update(dir, { inputs: [], dry: false })
      ).rejects.toThrow(expectedMessage);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("winix switch Windows dry run", () => {
  it("runs winget configure for a Windows host", async () => {
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

      await switchCommand(dir, { host: "desktop", dry: true });
      const configPath = join(dir, ".winix", "out", "desktop", "configuration.winget");
      expect(logs).toContain(
        [
          "winget",
          "configure",
          "-f",
          configPath,
          "--accept-configuration-agreements",
          "--disable-interactivity",
        ].join(" ")
      );
    } finally {
      logSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }

  });
});

async function writeConfig(dir: string, hostsSource: string): Promise<void> {
  const indexUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
  await writeFile(
    join(dir, "winix.config.mjs"),
    `
      import { host, platforms, windows, workspace } from ${JSON.stringify(indexUrl)};

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
