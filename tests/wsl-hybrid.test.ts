import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { account, evaluate, generateNix, host, home, nix, platforms, workspace, input } from "../src/index.ts";
import { httpsCloneUrl, inferWslSetupRepository, type GitRunner } from "../src/helpers/wsl-repository.ts";
import { windowsWslSetupTargets } from "../src/backends/windows/wsl-setup-runtime.ts";
import { wslSetupFingerprint } from "../src/backends/windows/wsl-setup.ts";
import { wslNextSteps } from "../src/cli/commands/switch.ts";
import type { WindowsOptions, WinWslDistro } from "../src/types/index.ts";
import type { WinWslSetupSpec } from "../src/helpers/windows.ts";

const nixosWsl = input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } });
const alice = account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05", wslDefault: true }));

function distroOf(host: { windows: Record<string, unknown> }): WinWslDistro {
  const resource = ((host.windows as WindowsOptions).dsc ?? []).find((entry) => entry.winix?.kind === "wsl-distro");
  if (resource?.winix?.kind !== "wsl-distro") throw new Error("no distro");
  return resource.winix.distro;
}

function pair(setup: (linux: ReturnType<typeof host>) => WinWslSetupSpec, linuxPlatform = platforms.wsl({ stateVersion: "25.05" })) {
  const linux = host("wsl-work", linuxPlatform, [alice()]);
  const desktop = host("desktop", platforms.windows(), ({ windows }) => {
    windows.wsl();
    windows.wsl.distro("NixOS", { source: "nixos-wsl", installLocation: "C:\\WSL\\NixOS", setup: setup(linux) });
  });
  return workspace({ inputs: { nixpkgs: "nixos-unstable", nixosWsl, homeManager: "github:nix-community/home-manager" }, hosts: [desktop, linux] });
}

describe("platforms.wsl", () => {
  it("imports and enables NixOS-WSL on a NixOS host", () => {
    const [linux] = evaluate(workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl({ stateVersion: "25.05" }), [alice()])] }));
    expect(linux.nixos.imports).toEqual([
      "inputs.home-manager.nixosModules.home-manager", "inputs.nixos-wsl.nixosModules.wsl",
    ]);
    expect(linux.nixos.wsl).toMatchObject({ enable: true, defaultUser: { expr: 'lib.mkDefault "alice"' } });
    expect(linux.nixos.system).toEqual({ stateVersion: "25.05" });
    expect(linux.nixos.networking).toEqual({ hostName: "wsl" });
  });

  it("honors a custom input name and homeManager: false", () => {
    const [linux] = evaluate(workspace({ inputs: {}, hosts: [
      host("wsl", platforms.wsl({ input: "wsl-module", homeManager: false }), []),
    ] }));
    expect(linux.nixos.imports).toEqual(["inputs.wsl-module.nixosModules.wsl"]);
    expect(() => platforms.wsl({ input: "bad name" }).__resolve()).toThrow("Nix input name");
  });

  it("is active only on WSL hosts while NixOS stays active", async () => {
    const { feature } = await import("../src/index.ts");
    const seen: Record<string, [boolean, boolean]> = {};
    const probe = feature("probe", ({ platforms: p }) => {
      seen[p.nixos.isActive && p.wsl.isActive ? "both" : p.nixos.isActive ? "nixos" : "other"] =
        [p.nixos.isActive, p.wsl.isActive];
    });
    evaluate(workspace({ inputs: {}, hosts: [
      host("wsl", platforms.wsl(), [probe()]),
      host("server", platforms.nixos(), [probe()]),
      host("desktop", platforms.windows(), [probe()]),
    ] }));
    expect(seen).toEqual({ both: [true, true], nixos: [true, false], other: [false, false] });
  });

  it("warns when an imported module's input is not declared", () => {
    const ws = workspace({ inputs: { nixpkgs: "nixos-unstable", homeManager: "github:nix-community/home-manager" }, hosts: [
      host("wsl", platforms.wsl({ stateVersion: "25.05" }), []),
    ] });
    const output = generateNix(ws, evaluate(ws));
    expect(output.warnings).toEqual([
      expect.stringMatching(/^wsl: module import uses inputs\.nixos-wsl, but workspace inputs do not include nixos-wsl \(e\.g\. nixosWsl: input/),
    ]);
    const declared = workspace({ ...ws, inputs: { ...ws.inputs, nixosWsl } });
    expect(generateNix(declared, evaluate(declared)).warnings).toEqual([]);
    expect(generateNix(declared, evaluate(declared)).hosts["wsl.nix"]).toContain("inputs.nixos-wsl.nixosModules.wsl");
  });
});

describe("WSL setup references", () => {
  it("accepts host and account values instead of matching strings", () => {
    const ws = pair((linux) => ({
      repository: "https://github.com/example/dotfiles.git", ref: "main", configDirectory: "winix", host: linux, user: alice,
    }));
    const evaluated = evaluate(ws);
    expect(distroOf(evaluated[0]).setup).toEqual({
      repository: "https://github.com/example/dotfiles.git", ref: "main", configDirectory: "winix", host: "wsl-work", user: "alice",
    });
    expect(windowsWslSetupTargets(ws, evaluated, [evaluated[0]])).toEqual([{
      windowsHost: "desktop", distro: "NixOS", setup: distroOf(evaluated[0]).setup,
      plan: { user: "alice", home: "/home/alice", checkout: "/home/alice/dotfiles", host: "wsl-work" },
    }]);
  });

  it("rejects values that are not hosts or accounts", () => {
    expect(() => evaluate(pair(() => ({
      repository: "https://github.com/example/dotfiles.git", configDirectory: "winix", host: { name: "x" } as never,
    })))).toThrow("WSL setup host must be a host name or a host(...) value");
    expect(() => evaluate(pair((linux) => ({
      repository: "https://github.com/example/dotfiles.git", configDirectory: "winix", host: linux, user: { kind: "account.group", name: "x" } as never,
    })))).toThrow("WSL setup user must be a Linux account name");
    expect(() => evaluate(pair((linux) => ({ repository: "https://github.com/example/dotfiles.git", host: linux }))))
      .toThrow('configDirectory is required unless repository is "self"');
  });

  it("validates the full Linux setup plan offline", () => {
    const ws = pair((linux) => ({
      repository: "https://github.com/example/dotfiles.git", configDirectory: "winix", host: linux,
    }), platforms.nixos({ stateVersion: "25.05" }));
    const evaluated = evaluate(ws);
    expect(() => windowsWslSetupTargets(ws, evaluated, [evaluated[0]])).toThrow(
      'Windows host "desktop", WSL distro "NixOS", Linux host "wsl-work": Setup host must explicitly enable NixOS-WSL'
    );
    const outside = pair((linux) => ({
      repository: "https://github.com/example/dotfiles.git", configDirectory: "winix", host: linux, checkout: "/srv/dotfiles",
    }));
    const outsideHosts = evaluate(outside);
    expect(() => windowsWslSetupTargets(outside, outsideHosts, [outsideHosts[0]])).toThrow("checkout must be inside the declared user's home");
  });

  it("prints how to apply later Linux changes after switch", () => {
    const ws = pair((linux) => ({
      repository: "https://github.com/example/dotfiles.git", configDirectory: "winix", host: linux,
    }));
    const evaluated = evaluate(ws);
    expect(wslNextSteps(ws, evaluated, evaluated[0])).toEqual([
      "",
      "WSL: Linux hosts are activated separately from Windows.",
      "  NixOS → wsl-work: apply Linux changes inside the distro with",
      "    wsl.exe -d NixOS --cd /home/alice/dotfiles/winix -- npm exec -- winix switch --host wsl-work",
    ]);
    const plain = workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), ({ windows }) => {
      windows.wsl();
      windows.wsl.distro("Adopted", { source: "nixos-wsl", installLocation: "C:\\WSL\\A", host: "wsl" });
      windows.wsl.distro("Manual", { source: "nixos-wsl", installLocation: "C:\\WSL\\M" });
    })] });
    const plainHosts = evaluate(plain);
    expect(wslNextSteps(plain, plainHosts, plainHosts[0]).slice(2)).toEqual([
      "  Adopted → wsl: from the distro's checkout, run npm exec -- winix switch --host wsl",
      "  Manual: Linux activation is manual (no setup declared)",
    ]);
    const none = evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [])] }));
    expect(wslNextSteps(workspace({ inputs: {}, hosts: [] }), none, none[0])).toEqual([]);
  });
});

describe('WSL setup repository "self"', () => {
  function fakeGit(responses: Record<string, string | Error>): GitRunner {
    return (args) => {
      const response = responses[args.join(" ")];
      if (response === undefined || response instanceof Error) throw response ?? new Error(`unexpected git ${args.join(" ")}`);
      return response;
    };
  }

  it("infers the tracked remote, upstream branch and config directory", () => {
    const configDir = join(tmpdir(), "repo", "winix");
    expect(inferWslSetupRepository(configDir, fakeGit({
      "rev-parse --show-toplevel": join(tmpdir(), "repo"),
      "symbolic-ref --quiet --short HEAD": "feature",
      "config --get branch.feature.remote": "upstream",
      "config --get branch.feature.merge": "refs/heads/feat/windows",
      "remote get-url upstream": "git@github.com:example/dotfiles.git",
    }))).toEqual({ repository: "https://github.com/example/dotfiles.git", ref: "feat/windows", configDirectory: "winix" });
  });

  it("uses origin and the commit for a detached checkout at the repository root", () => {
    const root = join(tmpdir(), "repo");
    expect(inferWslSetupRepository(root, fakeGit({
      "rev-parse --show-toplevel": root,
      "symbolic-ref --quiet --short HEAD": new Error("detached"),
      "rev-parse HEAD": "c".repeat(40),
      "remote get-url origin": "https://token@github.com/example/dotfiles",
    }))).toEqual({ repository: "https://github.com/example/dotfiles", ref: "c".repeat(40), configDirectory: "." });
  });

  it("explains a checkout without a usable remote", () => {
    const root = join(tmpdir(), "repo");
    expect(() => inferWslSetupRepository(root, fakeGit({
      "rev-parse --show-toplevel": new Error("not a repo"),
    }))).toThrow("not inside a Git checkout");
    expect(() => inferWslSetupRepository(root, fakeGit({
      "rev-parse --show-toplevel": root, "symbolic-ref --quiet --short HEAD": "main",
      "config --get branch.main.remote": new Error("unset"), "config --get branch.main.merge": new Error("unset"),
      "remote get-url origin": new Error("missing"),
    }))).toThrow('the checkout has no "origin" remote');
    expect(() => inferWslSetupRepository(root, fakeGit({
      "rev-parse --show-toplevel": root, "symbolic-ref --quiet --short HEAD": "main",
      "config --get branch.main.remote": new Error("unset"), "config --get branch.main.merge": new Error("unset"),
      "remote get-url origin": "/srv/git/dotfiles",
    }))).toThrow("is not an HTTPS or SSH Git URL");
  });

  it.each([
    ["git@github.com:example/dotfiles.git", "https://github.com/example/dotfiles.git"],
    ["ssh://git@github.com:22/example/dotfiles.git", "https://github.com/example/dotfiles.git"],
    ["git@ssh.dev.azure.com:v3/org/project/repo", "https://dev.azure.com/org/project/_git/repo"],
    ["https://org@dev.azure.com/org/project/_git/repo", "https://dev.azure.com/org/project/_git/repo"],
  ])("converts %s to HTTPS", (remote, expected) => {
    expect(httpsCloneUrl(remote)).toBe(expected);
  });

  it("rejects non-HTTPS remotes", () => {
    expect(() => httpsCloneUrl("git://example.com/repo.git")).toThrow("must use HTTPS or SSH");
  });

  it("resolves from a real checkout through the CLI config directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "winix-self-"));
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      git("init", "-q", "-b", "main");
      git("remote", "add", "origin", "git@github.com:example/dotfiles.git");
      const ws = pair((linux) => ({ repository: "self", host: linux }));
      const configDir = join(root, "winix");
      await mkdir(configDir);
      const [desktop] = evaluate(ws, { configDir });
      expect(distroOf(desktop)).toMatchObject({
        setup: { repository: "https://github.com/example/dotfiles.git", ref: "main", configDirectory: "winix", host: "wsl-work" },
        setupRefFromCheckout: true,
      });
      const [pinned] = evaluate(pair((linux) => ({ repository: "self", ref: "release", host: linux })), { configDir });
      expect(distroOf(pinned).setup?.ref).toBe("release");
      expect(distroOf(pinned).setupRefFromCheckout).toBeUndefined();
      expect(() => evaluate(ws)).toThrow('repository "self" needs the config directory');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Several real git processes; slow on a busy Windows machine.
  }, 30000);

  it("keeps the completion fingerprint stable across inferred branches only", () => {
    const base = { repository: "https://github.com/example/dotfiles.git", ref: "main", configDirectory: "winix", host: "wsl" };
    expect(wslSetupFingerprint(base, true)).toBe(wslSetupFingerprint({ ...base, ref: "other" }, true));
    expect(wslSetupFingerprint(base)).not.toBe(wslSetupFingerprint({ ...base, ref: "other" }));
  });
});

describe("config-relative home.symlink", () => {
  it("resolves ./ and ../ against the config directory", () => {
    const ws = workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl(), ({ home }) => {
      home.configFiles({
        nvim: home.symlink("../nvim/.config/nvim", { recursive: true }),
        local: home.symlink("./files/local.conf"),
        tilde: home.symlink("~/dotfiles/x"),
      });
    })] });
    const [linux] = evaluate(ws, { configDir: "D:\\dotfiles\\winix" });
    const files = (linux.homeManager.xdg as { configFile: Record<string, { source: { expr: string } }> }).configFile;
    expect(files.nvim.source.expr).toBe('config.lib.file.mkOutOfStoreSymlink "D:/dotfiles/nvim/.config/nvim"');
    expect(files.local.source.expr).toBe('config.lib.file.mkOutOfStoreSymlink "D:/dotfiles/winix/files/local.conf"');
    expect(files.tilde.source.expr).toBe('config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/dotfiles/x"');
    const [posix] = evaluate(ws, { configDir: "/home/alice/dotfiles/winix" });
    expect((posix.homeManager.xdg as { configFile: Record<string, { source: { expr: string } }> }).configFile.nvim.source.expr)
      .toBe('config.lib.file.mkOutOfStoreSymlink "/home/alice/dotfiles/nvim/.config/nvim"');
    expect(() => evaluate(ws)).toThrow('home.symlink("../nvim/.config/nvim"): config-relative paths need the config directory');
  });
});

/** Recover the shell script from a `pkgs.writeShellScriptBin "<name>" '' ... ''` expression. */
function shimScript(expr: string): string {
  const match = /^\(pkgs\.writeShellScriptBin "[^"]+" ''\n([\s\S]*)\n''\)$/.exec(expr);
  if (!match) throw new Error(`unexpected expression: ${expr}`);
  return match[1].replace(/''\$\{/g, "${").replace(/'''/g, "''");
}

describe("nix.wsl.windowsBin", () => {
  it("builds an escaped shim package", () => {
    const shim = nix.wsl.windowsBin("code-insiders", "%LOCALAPPDATA%/Programs/Microsoft VS Code Insiders/bin/code-insiders");
    expect(shim.expr).toMatch(/^\(pkgs\.writeShellScriptBin "code-insiders" ''\n/);
    expect(shim.expr).not.toMatch(/[^']\$\{/);
    const script = shimScript(shim.expr);
    expect(script).toContain("for candidate in '%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders'; do");
    expect(script).toContain('win=$(cd "${cmd%/*}" && "$cmd" /d /c "echo $win" </dev/null 2>/dev/null) || return 1');
    const generated = generateNix(workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl(), [home.packages(shim)])] }),
      evaluate(workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl(), [home.packages(shim)])] })));
    expect(generated.hosts["wsl.nix"]).toContain('home.packages = with pkgs; [ (pkgs.writeShellScriptBin "code-insiders" \'\'');
  });

  it.each([
    ["bad name", "C:\\x.exe", "executable name"],
    ["tool", [], "at least one Windows path"],
    ["tool", "relative\\tool.exe", "must be absolute"],
    ["tool", "C:\\it's\\tool.exe", "unsupported characters"],
    ["tool", "%APPDATA%\\a&b.exe", "unsupported characters"],
  ])("rejects %s / %s", (name, paths, message) => {
    expect(() => nix.wsl.windowsBin(name, paths as string | string[])).toThrow(message);
  });

  it.skipIf(process.platform === "win32")("runs the first existing Windows executable", async () => {
    const root = await mkdtemp(join(tmpdir(), "winix-shim-"));
    try {
      const drive = join(root, "c");
      const bin = join(root, "bin");
      for (const dir of [join(drive, "Windows", "System32"), join(drive, "Users", "alice", "AppData", "Local", "Tool"), bin]) {
        await mkdir(dir, { recursive: true });
      }
      // Fake interop: wslpath maps C:\ to $root/c; cmd.exe expands %LOCALAPPDATA%.
      await writeFile(join(bin, "wslpath"), `#!/bin/sh\n[ "$1" = -u ] || exit 2\nprintf '%s\\n' "$2" | sed -e 's|^C:|${drive}|' -e 's|\\\\|/|g'\n`);
      // Like WSL interop, the fake cmd.exe drains stdin.
      await writeFile(join(drive, "Windows", "System32", "cmd.exe"), `#!/bin/sh\ncat >/dev/null\nprintf '%s\\r\\n' "$(printf '%s' "$3" | sed -e 's|^echo ||' -e 's|%LOCALAPPDATA%|C:\\\\Users\\\\alice\\\\AppData\\\\Local|')"\n`);
      await writeFile(join(drive, "Users", "alice", "AppData", "Local", "Tool", "tool.exe"), `#!/bin/sh\necho "tool:$*"\ncat\n`);
      for (const file of [join(bin, "wslpath"), join(drive, "Windows", "System32", "cmd.exe"), join(drive, "Users", "alice", "AppData", "Local", "Tool", "tool.exe")]) {
        await chmod(file, 0o755);
      }
      const script = shimScript(nix.wsl.windowsBin("tool", ["C:\\Missing\\tool.exe", "%LOCALAPPDATA%\\Tool\\tool.exe"]).expr);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      const run = (body: string, args: string[], input = "") => {
        try {
          return { status: 0, stdout: execFileSync("bash", ["-c", body, "tool", ...args], { env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }) };
        } catch (error) {
          const failure = error as { status: number; stderr: string };
          return { status: failure.status, stdout: failure.stderr };
        }
      };
      if (execFileSync("sh", ["-c", "[ -x /bin/wslpath ] && echo yes || echo no"], { encoding: "utf8" }).trim() === "yes") return;
      // The target still gets stdin (git sends a credential helper protocol=/host=).
      expect(run(script, ["a b", "c"], "protocol=https\nhost=example.com\n"))
        .toEqual({ status: 0, stdout: "tool:a b c\nprotocol=https\nhost=example.com\n" });
      const missing = shimScript(nix.wsl.windowsBin("tool", ["%NOPE%\\tool.exe"]).expr);
      expect(run(missing, [])).toEqual({ status: 127, stdout: "tool: Windows executable not found at: %NOPE%\\tool.exe\n" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("home.wsl.gitCredentialManager", () => {
  it("points git at a Git for Windows GCM shim", () => {
    const ws = workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl(), ({ home }) => {
      home.wsl.gitCredentialManager();
    })] });
    const [linux] = evaluate(ws);
    const git = (linux.homeManager.programs as { git: { enable: boolean; settings: { credential: { helper: { expr: string } } } } }).git;
    expect(git.enable).toBe(true);
    expect(git.settings.credential.helper.expr).toMatch(/^"\$\{\(pkgs\.writeShellScriptBin "git-credential-manager" ''\n[\s\S]*''\)\}\/bin\/git-credential-manager"$/);
    expect(git.settings.credential.helper.expr).toContain("'%ProgramFiles%\\Git\\ucrt64\\bin\\git-credential-manager.exe' '%ProgramFiles%\\Git\\mingw64\\bin\\git-credential-manager.exe'");
    const custom = evaluate(workspace({ inputs: {}, hosts: [host("wsl", platforms.wsl(), [
      home.wsl.gitCredentialManager({ paths: ["D:\\Tools\\gcm.exe"] }),
    ])] }))[0];
    expect(JSON.stringify(custom.homeManager)).toContain("D:\\\\Tools\\\\gcm.exe");
    expect(generateNix(ws, [linux]).hosts["wsl.nix"]).toContain('programs.git.settings.credential.helper = "${(pkgs.writeShellScriptBin "git-credential-manager"');
  });
});
