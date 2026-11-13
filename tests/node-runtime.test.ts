import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { nodeTypeArguments } from "../src/cli/node.ts";

const runtimes: string[] = process.env.WINIX_NODE_TEST_BINARIES
  ? JSON.parse(process.env.WINIX_NODE_TEST_BINARIES)
  : [process.execPath];

describe.each(runtimes)("npm launcher on %s", (node) => {
  it("generates a syntax-valid WSL setup payload without transformation or executing setup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix node payload "));
    try {
      const version = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
      const setup = { repository: "https://example.com/dotfiles.git", ref: "main", configDirectory: "winix", host: "linux" };
      const pin = { repository: setup.repository, ref: setup.ref, revision: "a".repeat(40), resolvedAt: "2026-11-13T00:00:00.000Z" };
      const program = `
import { wslSetupPrelude } from ${JSON.stringify(pathToFileURL(resolve("src", "backends", "windows", "wsl-setup.ts")).href)};
console.log(JSON.stringify(wslSetupPrelude(${JSON.stringify(setup)}, ${JSON.stringify(pin)})));
`;
      const prelude: string[] = JSON.parse(execFileSync(node, [
        ...nodeTypeArguments(version), "--no-warnings", "--input-type=module", "--eval", program,
      ], { encoding: "utf8", timeout: 30000 }));
      const encoded = prelude.join("\n").match(/WINIX_WSL_SETUP_RUNTIME='+([A-Za-z0-9+/=]+)'/)?.[1];
      if (!encoded) throw new Error("WSL setup payload was not generated");
      const payload = join(directory, "runtime.mjs");
      await writeFile(payload, Buffer.from(encoded, "base64"));
      execFileSync(node, ["--check", payload], { stdio: "pipe", timeout: 30000 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("runs local typed imports with compatible arguments and preserves CLI arguments and exit status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "winix npm launcher "));
    try {
      await mkdir(join(directory, "scripts"));
      await mkdir(join(directory, "dist", "cli"), { recursive: true });
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      await writeFile(join(directory, "scripts", "winix.mjs"), await readFile(join(process.cwd(), "scripts", "winix.mjs")));
      const helper = await readFile(join(process.cwd(), "src", "cli", "node.ts"), "utf8");
      await writeFile(join(directory, "dist", "cli", "node.js"),
        ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
      await writeFile(join(directory, "typed.ts"), 'export const value: string = "typed import loaded";');
      await writeFile(join(directory, "dist", "cli", "index.js"), `
import { value } from "../../typed.ts";
console.log(JSON.stringify({ value, args: process.argv.slice(2), flags: process.execArgv }));
if (process.argv.includes("--fail")) process.exitCode = 7;
`);
      const version = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
      const bin = join(directory, "scripts", "winix.mjs");
      const result = JSON.parse(execFileSync(node, [bin, "check", "--host", "host with spaces"], { encoding: "utf8" }));
      expect(result.value).toBe("typed import loaded");
      expect(result.args).toEqual(["check", "--host", "host with spaces"]);
      expect(result.flags).toEqual([...nodeTypeArguments(version), "--no-warnings"]);
      let failed: unknown;
      try { execFileSync(node, [bin, "--fail"], { stdio: "pipe" }); }
      catch (error) { failed = error; }
      expect(failed).toMatchObject({ status: 7 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.skipIf(!process.env.WINIX_NODE_TEST_BINARIES).each(["erasable", "enum"])("runs the built npm CLI against %s TypeScript with the documented support", async (syntax) => {
    const directory = await mkdtemp(join(tmpdir(), "winix npm config "));
    try {
      await writeFile(join(directory, "package.json"), '{"type":"module"}');
      await writeFile(join(directory, "feature.ts"), `
import { feature } from ${JSON.stringify(pathToFileURL(resolve("dist", "index.js")).href)};
${syntax === "enum"
  ? 'enum Hostname { Value = "npm-typed-host" }; const hostname = Hostname.Value;'
  : 'const hostname: string = "npm-typed-host";'}
export const config = feature("config", ({ nixos }) => { nixos.networking({ hostName: hostname }); });
`);
      await writeFile(join(directory, "winix.config.ts"), `
import { host, platforms, workspace } from ${JSON.stringify(pathToFileURL(resolve("dist", "index.js")).href)};
import { config } from "./feature.ts";
export default workspace({ inputs: {}, hosts: [
  host("test", platforms.nixos({ stateVersion: "25.05" }), [config()])
] });
`);
      const result = spawnSync(node, [resolve("scripts", "winix.mjs"), "check"], {
        cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
      });
      const version = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
      if (syntax === "enum" && version.startsWith("v26.")) {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TypeScript enum is not supported in strip-only mode");
      } else {
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("Configuration valid");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
