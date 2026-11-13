import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapCheckout, localWinixCommand, nodeTypeArguments, pinnedWinixVersion,
} from "../src/cli/commands/bootstrap.ts";
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
    expect(() => nodeTypeArguments("v22.12.0")).toThrow("Node >=22.13");
    expect(() => nodeTypeArguments("v26.0.0-rc.1")).toThrow("stable Node");
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
