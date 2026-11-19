import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import example from "../examples/cross-platform/winix.config.ts";
import { gitConfig } from "../examples/cross-platform/features/git.ts";
import { evaluate, generateWindows, host, platforms, workspace } from "../src/index.ts";
import { starship } from "../examples/cross-platform/features/starship.ts";
import { generateNix } from "../src/backends/nix/index.ts";
import { readWindowsLock, windowsLockPinGaps } from "../src/backends/windows/lockfile.ts";
import { validateWindowsWslSetupTargets } from "../src/backends/windows/wsl-setup-runtime.ts";
import { isWindowsHost } from "../src/backends/windows/host.ts";
import type { WindowsOptions } from "../src/types/windows.ts";
import { analyzeWorkspace, applicableScopes, collectIgnoredFragments } from "../src/cli/analysis.ts";
import { inspectHost } from "../src/cli/commands/inspect.ts";

// The guides in docs/guides quote this example; keep them in sync.
const configDir = resolve("examples", "cross-platform");

describe("cross-platform example (docs/guides)", () => {
  const hosts = evaluate(example, { configDir });
  const windowsHosts = hosts.filter(isWindowsHost);

  it("passes the same validation as winix check, with a complete lock", () => {
    expect(hosts.map((host) => host.name)).toEqual(["DESKTOP", "wsl-work", "macbook"]);
    validateWindowsWslSetupTargets(example, hosts, windowsHosts);
    expect(windowsLockPinGaps(readWindowsLock(configDir), windowsHosts)).toEqual([]);
    const analyses = analyzeWorkspace(example, { configDir });
    expect(collectIgnoredFragments(analyses, hosts)).toEqual([]);
  });

  it("writes one git config for Windows from the shared settings", () => {
    const output = generateWindows(windowsHosts, readWindowsLock(configDir)!, configDir);
    expect(output.warnings).toEqual([]);
    const resources = output.resources.DESKTOP;
    const labels = resources.map((resource) => resource.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Git.Git", "JesseDuffield.lazygit", "write userProfile\\.gitconfig", "write userProfile\\.gitconfig-work",
      "link localAppData\\lazygit\\config.yml -> ./dotfiles/lazygit/config.yml",
      "link documents\\PowerShell\\Microsoft.PowerShell_profile.ps1 -> ./dotfiles/powershell/Microsoft.PowerShell_profile.ps1",
      "WSL distro NixOS (wsl-work)",
    ]));
    const files = ((windowsHosts[0].windows as WindowsOptions).dsc ?? []).flatMap((resource) =>
      resource.winix?.kind === "file" && resource.winix.action === "text" ? [resource.winix] : []);
    const gitconfig = files.find((file) => typeof file.target !== "string" && file.target.path === ".gitconfig");
    expect(gitconfig?.content).toBe([
      "[init]", "\tdefaultBranch = main",
      "[user]", "\tname = Alice Example", "\temail = alice@example.com",
      "[pull]", "\trebase = true",
      "[alias]", "\tlg = log --graph --oneline --decorate",
      '[includeIf "gitdir:~/work/"]', "\tpath = ~/.gitconfig-work", "",
    ].join("\n"));
    const doc = output.hosts.DESKTOP["configuration.winget"];
    expect(doc).toContain(resolve(configDir, "dotfiles", "lazygit", "config.yml"));
  });

  it("renders the same settings through Home Manager on WSL and macOS", () => {
    const nix = generateNix(example, hosts.filter((host) => !isWindowsHost(host)));
    const wsl = nix.hosts["wsl-work.nix"];
    const mac = nix.hosts["macbook.nix"];
    for (const host of [wsl, mac]) {
      expect(host).toContain("defaultBranch = \"main\"");
      expect(host).toContain("gitdir:~/work/");
      expect(host).toContain("lazygit");
    }
    expect(wsl).toContain("\"lazygit/config.yml\"");
    expect(mac).toContain("\"Library/Application Support/lazygit/config.yml\"");
    expect(wsl).toContain("credential");
    expect(mac).not.toContain("Git for Windows");
  });

  it("inspect shows what each host actually gets", () => {
    const analyses = analyzeWorkspace(example, { configDir });
    const mac = analyses.findIndex((analysis) => analysis.name === "macbook");
    const lines = inspectHost(analyses[mac], [], applicableScopes(analyses[mac], hosts[mac]));
    expect(lines).toContain("  git  [homeManager]  (not on this platform: windows)");
    expect(lines.join("\n")).not.toContain("package Git.Git");
    const wsl = analyses.findIndex((analysis) => analysis.name === "wsl-work");
    expect(inspectHost(analyses[wsl], [], applicableScopes(analyses[wsl], hosts[wsl]))).toContain("  platform: nixos (wsl)");
  });
});

describe("starship feature (powershell-and-terminal guide)", () => {
  it("links one prompt file on Linux and Windows", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable", homeManager: { url: "github:nix-community/home-manager", follows: { nixpkgs: "nixpkgs" } } },
      hosts: [
        host("linux", platforms.nixos({ stateVersion: "25.05" }), [starship()]),
        host("desktop", platforms.windows(), [starship()]),
      ],
    });
    const [linux, desktop] = evaluate(ws, { configDir });
    const nix = generateNix(ws, [linux]).hosts["linux.nix"];
    expect(nix).toContain("programs.starship");
    expect(nix).toContain(`${configDir.replaceAll("\\", "/")}/dotfiles/starship/starship.toml`);
    const output = generateWindows([desktop], { version: 1, packages: {
      "Starship.Starship": { source: "winget", version: "1.23.0", resolvedAt: "x" },
    } }, configDir);
    expect(output.resources.desktop.map((resource) => resource.label)).toEqual(expect.arrayContaining([
      "Starship.Starship", "link userProfile\\.config\\starship.toml -> ./dotfiles/starship/starship.toml",
    ]));
  });
});

describe("gitConfig()", () => {
  it("renders sections, subsections and quoted values", () => {
    expect(gitConfig({
      user: { name: "Alice Example", email: "a@example.com" },
      core: { autocrlf: false, comment: "has # hash", path: "C:\\tools \"x\"" },
      credential: { "https://dev.azure.com": { useHttpPath: true } },
    })).toBe([
      "[user]", "\tname = Alice Example", "\temail = a@example.com",
      "[core]", "\tautocrlf = false", '\tcomment = "has # hash"', '\tpath = "C:\\\\tools \\"x\\""',
      '[credential "https://dev.azure.com"]', "\tuseHttpPath = true", "",
    ].join("\n"));
  });

  it("refuses nesting git cannot express", () => {
    expect(() => gitConfig({ a: { b: { c: { d: 1 } } } })).toThrow("one subsection level");
  });
});
