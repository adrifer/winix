import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const binary = process.env.WINIX_STANDALONE_TEST_BINARY;

describe.skipIf(!binary)("standalone executable without node_modules", () => {
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
