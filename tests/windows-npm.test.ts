import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluate, generateWindows, host, platforms, windows, workspace } from "../src/index.ts";
import { npmRegistryEntries } from "../src/helpers/windows-npm.ts";
import { npmRegistryProperties } from "../src/backends/windows/npm.ts";
import { powerShellLiteral as quote } from "../src/helpers/utils.ts";

const policy = {
  registries: { public: { uri: "https://registry.npmjs.org" }, work: { uri: "https://packages.example.com/npm/" } },
  default: "work", scopes: { "@adrifer": "public" },
};
const pwsh = (() => {
  try { execFileSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

describe("Windows npm registries", () => {
  it("resolves named default and scoped registries after fragment merging", () => {
    const hosts = evaluate(workspace({ inputs: {}, hosts: [host("work", platforms.windows(), ({ windows }) => {
      windows.npm.registries({ registries: policy.registries, default: "public" });
      windows.npm.registries(policy);
    })] }));
    expect(npmRegistryEntries(hosts[0].windows.npm!.registries!)).toEqual({
      registry: "https://packages.example.com/npm/", "@adrifer:registry": "https://registry.npmjs.org/",
    });
    const output = generateWindows(hosts).hosts.work["configuration.winget"];
    expect(output).toContain("npm registries");
    expect(output).toContain("NPM_CONFIG_USERCONFIG");
    expect(output).not.toContain("Register-PSResourceRepository");
  });

  it("rejects invalid scopes, unknown names, insecure URLs and unsupported policy fields", () => {
    expect(() => windows.npm.registries({ ...policy, default: "missing" })).toThrow("not declared");
    expect(() => windows.npm.registries({ ...policy, scopes: { company: "work" } })).toThrow("scope");
    expect(() => windows.npm.registries({
      registries: { work: { uri: "https://user:password@example.com/npm" } }, default: "work",
    })).toThrow("credentials");
    expect(() => windows.npm.registries({
      registries: { work: { uri: "http://example.com/npm" } }, default: "work",
    })).toThrow("HTTPS");
    expect(() => npmRegistryEntries({ ...policy, allowed: ["work"] } as typeof policy)).toThrow("Unknown");
  });

  it.skipIf(!pwsh)("preserves authentication/comments, removes managed duplicates, and is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "winix-npm-config-"));
    try {
      const path = join(dir, ".npmrc");
      const original = "# my config\r\nregistry=https://old.example.com/\r\nregistry=https://other.example.com/\r\n" +
        "//packages.example.com/npm/:_authToken=${TEST_TOKEN}\r\nalways-auth=true\r\n@other:registry=https://other.example.com/\r\n";
      writeFileSync(path, original);
      const properties = npmRegistryProperties(npmRegistryEntries(policy));
      const script = join(dir, "test.ps1");
      writeFileSync(script, `
$env:NPM_CONFIG_USERCONFIG = ${quote(path)}
$test = [scriptblock]::Create(${quote(String(properties.testScript))})
$set = [scriptblock]::Create(${quote(String(properties.setScript))})
if (& $test) { throw 'Unexpected initial match' }
& $set
if (-not (& $test)) { throw 'Registry configuration did not match' }
$before = [IO.File]::ReadAllBytes($env:NPM_CONFIG_USERCONFIG)
& $set
$after = [IO.File]::ReadAllBytes($env:NPM_CONFIG_USERCONFIG)
if ([Convert]::ToBase64String($before) -ne [Convert]::ToBase64String($after)) { throw 'Non-idempotent configuration' }
Write-Output 'checked'
`);
      expect(execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], { encoding: "utf8", timeout: 30000 }).trim()).toBe("checked");
      const result = readFileSync(path, "utf8");
      expect(result).toContain("//packages.example.com/npm/:_authToken=${TEST_TOKEN}\r\n");
      expect(result).toContain("always-auth=true\r\n");
      expect(result).toContain("@other:registry=https://other.example.com/\r\n");
      expect(result).toContain("registry=https://packages.example.com/npm/\r\n");
      expect(result).toContain("@adrifer:registry=https://registry.npmjs.org/\r\n");
      expect(result).not.toContain("old.example.com");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.skipIf(!pwsh)("creates a missing userconfig without invoking npm", () => {
    const dir = mkdtempSync(join(tmpdir(), "winix-npm-create-"));
    try {
      const path = join(dir, "nested", ".npmrc");
      const script = join(dir, "test.ps1");
      const properties = npmRegistryProperties(npmRegistryEntries(policy));
      writeFileSync(script, `$env:NPM_CONFIG_USERCONFIG = ${quote(path)}\n${properties.setScript}`);
      execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], { stdio: "pipe", timeout: 30000 });
      expect(readFileSync(path, "utf8")).toContain("registry=https://packages.example.com/npm/");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
