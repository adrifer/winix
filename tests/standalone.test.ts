import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const binary = process.env.WINIX_STANDALONE_TEST_BINARY;

describe.skipIf(!binary)("standalone executable without node_modules", { timeout: 30000 }, () => {
  const run = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync(resolve(binary!), args, {
      cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("loads local TypeScript, Node builtins, type-only subpaths and shared isActive context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary config "));
    try {
      await writeFile(join(directory, "feature.ts"), `
import { feature, platforms } from "@adrifer/winix";
import type { WinWslSetup } from "@adrifer/winix/types";
import { fileURLToPath } from "node:url";
export const base = feature("base", ({ nixos }) => { nixos.packages("git"); });
export const dependent = feature("dependent", ({ nixos }) => {
  if (!base.isActive || !platforms.nixos.isActive) throw new Error("SDK context was duplicated");
  nixos.networking({ hostName: "embedded-context" });
  nixos.environment({ variables: { CONFIG_SOURCE: fileURLToPath(import.meta.url) } });
});
`);
      await writeFile(join(directory, "winix.config.ts"), `
import { host, platforms, workspace } from "@adrifer/winix";
import { base, dependent } from "./feature.ts";
export default workspace({ inputs: {}, hosts: [
  host("test", platforms.nixos({ stateVersion: "25.05" }), [base(), dependent()])
] });
`);
      expect(run(directory, ["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/);
      expect(run(directory, ["check"])).toContain("Configuration valid");
      const output = run(directory, ["apply", "--host", "test", "--dry"]);
      expect(output).toContain('hostName = "embedded-context"');
      expect(output).toContain("feature.ts");
      await expect(readFile(join(directory, ".winix", "out", "flake.nix"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(directory, "node_modules", "@adrifer", "winix", "package.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("fails on missing third-party imports instead of contacting a package registry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary-missing-"));
    try {
      await writeFile(join(directory, ".npmrc"), "registry=http://127.0.0.1:9\n");
      await writeFile(join(directory, "package.json"), '{"dependencies":{"left-pad":"1.3.0"}}');
      await writeFile(join(directory, "winix.config.ts"), 'import "left-pad"; export default {};');
      let failure: unknown;
      try { run(directory, ["check"], { BUN_INSTALL_CACHE_DIR: join(directory, "cache") }); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ status: 1 });
      expect(String((failure as { stderr: string }).stderr)).toContain("Cannot find package 'left-pad'");
      await expect(readFile(join(directory, "bun.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("initializes a config without asking for npm installation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary-init-"));
    try {
      const output = run(directory, ["init"]);
      expect(output).toContain("winix check");
      expect(output).not.toContain("npm install");
      expect(run(directory, ["check"])).toContain("Configuration valid");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("resolves missing and explicitly updated WSL image pins in the compiled process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary-images-"));
    try {
      await writeFile(join(directory, "winix.config.ts"), `
import { host, platforms, workspace } from "@adrifer/winix";
globalThis.fetch = async (url) => {
  if (String(url) !== "https://api.github.com/repos/nix-community/NixOS-WSL/releases/latest") {
    throw new Error("Unexpected network request: " + url);
  }
  return Response.json({ draft: false, prerelease: false, tag_name: "2605.7.2", assets: [
    ...["nixos.wsl", "nixos.aarch64.wsl"].map(name => ({
      name, digest: "sha256:" + "a".repeat(64),
      browser_download_url: "https://github.com/nix-community/NixOS-WSL/releases/download/2605.7.2/" + name
    }))
  ] });
};
export default workspace({ inputs: {}, hosts: [
  host("test", platforms.windows(), ({ windows }) => {
    windows.package({ id: "Microsoft.WSL", version: "2.6.1" });
    windows.wsl();
    windows.wsl.distro("NixOS", { source: "nixos-wsl", installLocation: "D:/WSL/WinixTest" });
  })
] });
`);
      const output = run(directory, ["apply", "--dry", "--host", "test"]);
      expect(output).toContain("2605.7.2");
      expect(output).toContain("nixos.aarch64.wsl");
      expect(run(directory, ["update", "--windows", "nixos-wsl", "--dry"])).toContain("NixOS-WSL images");
      await expect(readFile(join(directory, "winix-windows.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(directory, ".winix", "out", "test", "configuration.winget"))).rejects.toMatchObject({ code: "ENOENT" });
      const lockPath = join(directory, "winix-windows.lock");
      const previous = JSON.stringify({
        version: 1, generatedAt: "2026-01-01T00:00:00.000Z", packages: {},
        wslImages: Object.fromEntries(["x64", "arm64"].map(architecture => [`nixos-wsl/${architecture}`, {
          source: "nixos-wsl", architecture, version: "2405.1", sha256: "b".repeat(64),
          url: "https://github.com/nix-community/NixOS-WSL/releases/download/2405.1/" +
            (architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl"),
          resolvedAt: "2026-01-01T00:00:00.000Z",
        }])),
      });
      await writeFile(lockPath, previous);
      run(directory, ["update", "--windows", "nixos-wsl", "--dry"]);
      expect(await readFile(lockPath, "utf8")).toBe(previous);
      run(directory, ["update", "--windows", "nixos-wsl"]);
      const updated = JSON.parse(await readFile(lockPath, "utf8"));
      for (const architecture of ["x64", "arm64"]) {
        expect(updated.wslImages[`nixos-wsl/${architecture}`]).toMatchObject({
          architecture, version: "2605.7.2", sha256: "a".repeat(64),
        });
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("prepares a checkout launcher, refuses stale pins, and hands off only to a matching optional npm SDK", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary-bootstrap-"));
    try {
      const version = run(directory, ["--version"]).trim();
      await writeFile(join(directory, "package.json"), JSON.stringify({
        type: "module", dependencies: { "@adrifer/winix": version },
      }));
      await writeFile(join(directory, "winix.config.ts"), `
import { host, platforms, workspace } from "@adrifer/winix";
export default workspace({ inputs: {}, hosts: [
  host("test", platforms.nixos({ stateVersion: "25.05" }), [])
] });
`);
      expect(run(directory, ["bootstrap", "--host", "test", "--dry"])).toContain("No config was evaluated");
      const launcher = join(directory, ".winix", "bin", process.platform === "win32" ? "winix.ps1" : "winix");
      await expect(readFile(launcher)).rejects.toMatchObject({ code: "ENOENT" });
      expect(run(directory, ["bootstrap", "--host", "test", "--prepare-only", "--yes"])).toContain("No host activation performed");
      expect(await readFile(launcher, "utf8")).toContain("# Generated by Winix bootstrap");
      expect(run(directory, ["run", "--version"]).trim()).toBe(version);
      if (process.platform === "win32") {
        expect(execFileSync("pwsh", ["-NoLogo", "-NoProfile", "-File", launcher, "--version"], {
          encoding: "utf8", timeout: 30000,
        }).trim()).toBe(version);
      } else {
        expect(execFileSync("bash", [launcher, "--version"], { encoding: "utf8", timeout: 30000 }).trim()).toBe(version);
      }
      await writeFile(join(directory, "package.json"), '{"dependencies":{"@adrifer/winix":"99.0.0"}}');
      expect(() => run(directory, ["run", "--version"])).toThrow();
      const local = join(directory, "node_modules", "@adrifer", "winix");
      await mkdir(join(local, "dist", "cli"), { recursive: true });
      await writeFile(join(local, "package.json"), '{"version":"99.0.0","type":"module"}');
      await writeFile(join(local, "dist", "cli", "index.js"), 'console.log("CHECKOUT_LOCAL_SDK");');
      expect(run(directory, ["run", "--version"]).trim()).toBe("CHECKOUT_LOCAL_SDK");
      await writeFile(join(local, "package.json"), '{"version":"98.0.0","type":"module"}');
      expect(() => run(directory, ["run", "--version"])).toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("prepares the declarative WSL account using the embedded SDK without npm", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix-binary-account-"));
    try {
      await writeFile(join(directory, "flake.lock"), "{}");
      await writeFile(join(directory, "winix.config.ts"), `
import { account, host, input, nixos, platforms, workspace } from "@adrifer/winix";
export default workspace({ inputs: { nixosWsl: input("github:nix-community/NixOS-WSL") }, hosts: [
  host("linux", platforms.nixos({ stateVersion: "25.05", system: "${process.arch === "arm64" ? "aarch64-linux" : "x86_64-linux"}" }), [
    account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }))(),
    nixos.imports("inputs.nixos-wsl.nixosModules.wsl"), nixos({ wsl: { enable: true } })
  ])
] });
`);
      const accountDirectory = join(directory, "account");
      const output = run(directory, [], {
        WINIX_WSL_SETUP_PREPARE: JSON.stringify({
          config: directory, accountDirectory,
          setup: { repository: "https://example.com/dotfiles.git", configDirectory: ".", host: "linux", user: "alice" },
        }),
      });
      expect(output).toContain('WINIX_PLAN:{"user":"alice"');
      const module = await readFile(join(accountDirectory, "hosts", "linux.nix"), "utf8");
      expect(module).toContain('defaultUser = "alice"');
      expect(module).not.toContain("home-manager");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
