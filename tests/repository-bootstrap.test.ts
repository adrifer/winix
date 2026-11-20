import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  bootstrapCheckout, ensureWindowsRuntime, localWinixCommand, nodeTypeArguments, pinnedWinixVersion,
  userPathScript, windowsCommandShim, windowsLauncher, type BootstrapDeps,
} from "../src/cli/commands/bootstrap.ts";
import { readRememberedHost } from "../src/cli/host-memory.ts";
import { selectHost } from "../src/cli/commands/switch.ts";
import { resolveWinixVersionRange } from "../src/cli/commands/init.ts";
import { execFileSync } from "node:child_process";
import { checkoutWslRevision } from "../src/backends/windows/wsl-setup-runtime.ts";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(version: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "winix-bootstrap-"));
  temporary.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({
    dependencies: { "@adrifer/winix": version },
  }));
  return directory;
}

describe("checkout-pinned bootstrap", () => {
  it("accepts only exact versions and matching official SDK release assets", () => {
    expect(pinnedWinixVersion("0.3.0-preview.1")).toBe("0.3.0-preview.1");
    expect(pinnedWinixVersion("https://github.com/adrifer/winix/releases/download/v0.3.0-preview.1/adrifer-winix-0.3.0-preview.1.tgz")).toBe("0.3.0-preview.1");
    for (const spec of [undefined, "^0.3.0", "~0.3.0", "latest", "file:../winix",
      "https://example.com/winix.tgz",
      "https://github.com/adrifer/winix/releases/download/v0.3.0/adrifer-winix-0.2.3.tgz"]) {
      expect(() => pinnedWinixVersion(spec)).toThrow();
    }
  });

  it("keeps standalone only when its version matches; a mismatched installed SDK is an explicit error", async () => {
    const directory = await fixture("0.3.0");
    expect(await localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix")).toEqual({
      command: "verified-winix", args: [],
    });
    await expect(localWinixCommand(directory, "0.3.0", "0.2.3", "old-winix")).rejects.toThrow("Rerun the repository bootstrap");
    const local = join(directory, "node_modules", "@adrifer", "winix");
    await mkdir(local, { recursive: true });
    await writeFile(join(local, "package.json"), '{"version":"0.2.3"}');
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix")).rejects.toThrow("Run npm ci");
    await writeFile(join(local, "package.json"), '{"version":"0.3.0"}');
    expect((await localWinixCommand(directory, "0.3.0", "0.2.3", "old-winix")).args).toContain(join(local, "dist", "cli", "index.js"));
    await writeFile(join(local, "package.json"), "{corrupt");
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix")).rejects.toThrow();
    await writeFile(join(local, "package.json"), "null");
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix")).rejects.toThrow("invalid package metadata");
    await rm(join(local, "package.json"));
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix")).rejects.toThrow("incomplete");
  });

  it("fetches the pinned release when the pin moved past the executable", async () => {
    const directory = await fixture("0.3.0");
    const fetchRuntime = vi.fn(async (version: string) => `runtime-${version}.exe`);
    expect(await localWinixCommand(directory, "0.3.1", "0.3.0", "old-winix", fetchRuntime)).toEqual({ command: "runtime-0.3.1.exe", args: [] });
    expect(fetchRuntime).toHaveBeenCalledWith("0.3.1");
    expect(await localWinixCommand(directory, "0.3.0", "0.3.0", "winix", fetchRuntime)).toEqual({ command: "winix", args: [] });
    expect(fetchRuntime).toHaveBeenCalledTimes(1);
  });

  it("downloads a Windows runtime only when it matches the release checksum", async () => {
    const directory = await fixture("0.3.0");
    const binary = Buffer.from("verified winix");
    const sum = createHash("sha256").update(binary).digest("hex");
    const fake = (sums: string) => vi.fn(async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS")
      ? new Response(sums) : new Response(binary)) as unknown as typeof fetch;
    await expect(ensureWindowsRuntime(directory, "0.3.1", fake(`${"0".repeat(64)}  winix-windows-x64.exe\n`), "x64"))
      .rejects.toThrow("checksum mismatch");
    expect(existsSync(join(directory, ".winix", "runtime", "0.3.1", "winix.exe"))).toBe(false);
    const request = fake(`${sum}  winix-windows-arm64.exe\n${sum.toUpperCase()}  winix-windows-x64.exe\n`);
    const path = await ensureWindowsRuntime(directory, "0.3.1", request, "x64");
    expect(path).toBe(join(directory, ".winix", "runtime", "0.3.1", "winix.exe"));
    expect(readFileSync(path, "utf8")).toBe("verified winix");
    expect(vi.mocked(request).mock.calls.map(([url]) => String(url))).toEqual([
      "https://github.com/adrifer/winix/releases/download/v0.3.1/SHA256SUMS",
      "https://github.com/adrifer/winix/releases/download/v0.3.1/winix-windows-x64.exe",
    ]);
    // Present: reused without downloading again.
    await ensureWindowsRuntime(directory, "0.3.1", request, "x64");
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });

  it("prunes older runtimes after a download, keeping the running and launcher fallback ones", async () => {
    const directory = await fixture("0.3.0");
    const runtime = join(directory, ".winix", "runtime");
    for (const version of ["0.2.9", "0.3.0", "0.3.1-preview.1", "notes"]) {
      await mkdir(join(runtime, version), { recursive: true });
      await writeFile(join(runtime, version, "winix.exe"), "old");
    }
    await mkdir(join(directory, ".winix", "bin"), { recursive: true });
    await writeFile(join(directory, ".winix", "bin", "winix.ps1"),
      windowsLauncher(join(runtime, "0.2.9", "winix.exe")).replaceAll("\n", "\r\n"));
    const binary = Buffer.from("new winix");
    const sum = createHash("sha256").update(binary).digest("hex");
    const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS")
      ? new Response(`${sum}  winix-windows-x64.exe\n`) : new Response(binary)) as unknown as typeof fetch;
    await ensureWindowsRuntime(directory, "0.3.2", request, "x64", join(runtime, "0.3.0", "winix.exe"));
    expect(readdirSync(runtime).sort()).toEqual(["0.2.9", "0.3.0", "0.3.2", "notes"]);
  });

  it("explains both ways out of a stale node_modules SDK", async () => {
    const directory = await fixture("0.3.1");
    await mkdir(join(directory, "node_modules", "@adrifer", "winix"), { recursive: true });
    await writeFile(join(directory, "node_modules", "@adrifer", "winix", "package.json"), JSON.stringify({ version: "0.3.0" }));
    await expect(localWinixCommand(directory, "0.3.1", "0.3.1", "winix")).rejects.toThrow("delete node_modules to use the downloaded release");
  });

  it("asks nothing after the script's consent, chooses and remembers the host, and lets switch show the plan", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    const run = vi.fn(async () => {});
    const deps: BootstrapDeps = {
      candidateHosts: vi.fn(async () => ["work-devbox", "work-devbox-2"]),
      askHost: vi.fn(async () => "work-devbox-2"),
      installCommand: vi.fn(async () => {}),
    };
    await bootstrapCheckout(directory, { yes: false, prepareOnly: false, dry: false, confirmed: true }, run, deps);
    expect(deps.askHost).toHaveBeenCalledWith(["work-devbox", "work-devbox-2"]);
    expect(run.mock.calls).toEqual([[directory, ["check"]], [directory, ["switch", "--host", "work-devbox-2"]]]);
    expect(readRememberedHost(directory)).toBe("work-devbox-2");
    // A rerun (after a restart) reuses the remembered host without asking.
    run.mockClear();
    await bootstrapCheckout(directory, { yes: false, prepareOnly: true, dry: false, confirmed: true }, run, deps);
    expect(deps.askHost).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([[directory, ["check"]], [directory, ["switch", "--dry", "--host", "work-devbox-2"]]]);
    // switch uses the remembered host when the machine name matches none.
    expect(selectHost(["work-devbox", "work-devbox-2"], undefined, "DESKTOP-1234567", "work-devbox-2")).toBe("work-devbox-2");
    expect(selectHost(["work-devbox", "work-devbox-2"], "work-devbox", "DESKTOP-1234567", "work-devbox-2")).toBe("work-devbox");
    expect(() => selectHost(["a", "b"], undefined, "DESKTOP-1234567", "gone")).toThrow("winix bootstrap remembers it");
  });

  it("generates a launcher that prefers the pinned runtime and a per-user command that runs it", () => {
    const launcher = windowsLauncher("C:\\Users\\o'neil\\winix.exe");
    expect(launcher).toContain("$executable = 'C:\\Users\\o''neil\\winix.exe'");
    expect(launcher).toContain("'.winix\\runtime\\' + $Matches[1] + '\\winix.exe'");
    expect(launcher).toContain("& $executable run @args");
    const shim = windowsCommandShim("D:\\dotfiles\\winix\\.winix\\bin\\winix.ps1");
    expect(shim).toContain('-ExecutionPolicy Bypass -File "D:\\dotfiles\\winix\\.winix\\bin\\winix.ps1" %*');
    expect(shim).toContain("rem Generated by Winix bootstrap");
    const path = userPathScript("C:\\Users\\me\\AppData\\Local\\Winix\\bin");
    expect(path).toContain("DoNotExpandEnvironmentNames");
    expect(path).toContain("$key.SetValue('Path', (@($entries) + $dir) -join ';', $kind)");
  });

  it("prepares in check/preview order and stops before activation in prepare-only mode", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    const run = vi.fn(async () => {});
    await bootstrapCheckout(directory, { host: "test-machine", yes: true, prepareOnly: true, dry: false }, run);
    expect(run.mock.calls).toEqual([
      [directory, ["check"]],
      [directory, ["switch", "--dry", "--host", "test-machine"]],
    ]);
    run.mockClear();
    await bootstrapCheckout(directory, { host: "test-machine", yes: true, prepareOnly: false, dry: false }, run);
    expect(run.mock.calls.at(-1)).toEqual([directory, ["switch", "--host", "test-machine", "--yes"]]);
  });

  it("never evaluates config in dry-run or with an incompatible executable; failures stop before activation", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    await writeFile(join(directory, "winix.config.ts"), 'throw new Error("DO NOT EVALUATE");');
    const run = vi.fn(async () => {});
    await bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: false, dry: true }, run);
    expect(run).not.toHaveBeenCalled();
    await writeFile(join(directory, "package.json"), '{"dependencies":{"@adrifer/winix":"99.0.0"}}');
    await expect(bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: true, dry: false }, run)).rejects.toThrow("Checkout requires");
    expect(run).not.toHaveBeenCalled();
    await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { "@adrifer/winix": (await resolveWinixVersionRange()).replace(/^\^/, "") } }));
    run.mockRejectedValue(new Error("preview failed"));
    await expect(bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: false, dry: false }, run)).rejects.toThrow("preview failed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("supports both Node transform-type releases and Node 26 without its removed flag", () => {
    expect(nodeTypeArguments("v22.13.0")).toEqual(["--experimental-transform-types"]);
    expect(nodeTypeArguments("v24.0.0")).toEqual(["--experimental-transform-types"]);
    expect(nodeTypeArguments("v26.0.0")).toEqual([]);
    expect(() => nodeTypeArguments("v22.12.0")).toThrow("Node 22.13+");
    expect(() => nodeTypeArguments("v26.0.0-rc.1")).toThrow("stable Node");
    for (const version of ["v23.0.0", "v25.0.0", "v28.0.0"]) {
      expect(() => nodeTypeArguments(version)).toThrow("stable Node");
    }
  });

  it.each(["main", "HEAD", "refs/heads/main", "refs/tags/first", "commit"])(
    "keeps locked first-run contents and full history when provisioning ref %s", async (ref) => {
      const directory = await fixture("0.3.0");
      const origin = join(directory, "origin");
      const checkout = join(directory, "checkout");
      await mkdir(origin);
      await mkdir(checkout);
      const git = (cwd: string) => (args: string[]) => execFileSync("git", args, {
        cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" },
      }).trim();
      const remote = git(origin);
      remote(["init", "--initial-branch=main"]);
      remote(["config", "user.name", "Bootstrap test"]);
      remote(["config", "user.email", "test@example.invalid"]);
      await writeFile(join(origin, "config"), "first");
      remote(["add", "."]);
      remote(["-c", "commit.gpgsign=false", "commit", "-m", "locked"]);
      const revision = remote(["rev-parse", "HEAD"]);
      remote(["tag", "first"]);
      await writeFile(join(origin, "config"), "newer upstream");
      remote(["add", "."]);
      remote(["-c", "commit.gpgsign=false", "commit", "-m", "newer"]);
      const current = remote(["rev-parse", "HEAD"]);
      const local = git(checkout);
      local(["init", "--initial-branch=main"]);
      local(["remote", "add", "origin", origin]);
      checkoutWslRevision(local, ref === "commit" ? revision : ref, revision);
      expect(local(["rev-parse", "HEAD"])).toBe(revision);
      expect(local(["rev-parse", "--is-shallow-repository"])).toBe("false");
      if (ref === "commit" || ref === "refs/tags/first") {
        expect(() => local(["symbolic-ref", "--short", "HEAD"])).toThrow();
      } else {
        expect(local(["symbolic-ref", "--short", "HEAD"])).toBe("main");
        expect(local(["rev-parse", "@{upstream}"])).toBe(current);
        checkoutWslRevision(local, ref, revision, revision);
        expect(local(["rev-parse", "HEAD"])).toBe(revision);
        local(["pull", "--ff-only"]);
        expect(local(["rev-parse", "HEAD"])).toBe(current);
      }
    }, 15000,
  );
});
