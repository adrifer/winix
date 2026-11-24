import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareWinixVersions, pinFor, upgrade, upgradeNotice, type UpgradeDeps } from "../src/cli/commands/upgrade.ts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function project(spec: string, extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "winix-upgrade-"));
  dirs.push(dir);
  await writeFile(join(dir, "winix.config.ts"), "export default {}");
  await writeFile(join(dir, "package.json"), `{\n  "type": "module",\n  "dependencies": {\n    "@adrifer/winix": "${spec}"\n  }\n}\n`);
  for (const [name, content] of Object.entries(extra)) await writeFile(join(dir, name), content);
  return dir;
}

function deps(latest: string, releases: string[] = [latest]): UpgradeDeps & { lines: string[] } {
  const lines: string[] = [];
  return { latest: async () => latest, exists: async (version) => releases.includes(version), log: (line) => lines.push(line), lines };
}

const url = (version: string) => `https://github.com/adrifer/winix/releases/download/v${version}/adrifer-winix-${version}.tgz`;

describe("winix upgrade", () => {
  it("orders releases, previews before their stable release", () => {
    expect(compareWinixVersions("0.4.0", "0.3.9")).toBeGreaterThan(0);
    expect(compareWinixVersions("0.3.10", "0.3.9")).toBeGreaterThan(0);
    expect(compareWinixVersions("0.4.0-preview.2", "0.4.0")).toBeLessThan(0);
    expect(compareWinixVersions("0.4.0-preview.2", "0.4.0-preview.1")).toBeGreaterThan(0);
    expect(pinFor("0.3.5", "0.4.0")).toBe("0.4.0");
    expect(pinFor(url("0.3.5"), "0.4.0")).toBe(url("0.4.0"));
  });

  it("moves a version pin to the latest release, keeping the file's formatting", async () => {
    const dir = await project("0.3.5");
    const upgrade040 = deps("0.4.0");
    await upgrade(dir, { dry: false }, upgrade040);
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(
      `{\n  "type": "module",\n  "dependencies": {\n    "@adrifer/winix": "0.4.0"\n  }\n}\n`);
    expect(upgrade040.lines[0]).toContain("Winix 0.3.5 → 0.4.0");
    expect(upgrade040.lines.join("\n")).toContain("CHANGELOG.md");
  });

  it("keeps the release tarball form, and says when npm's lock needs updating", async () => {
    const dir = await project(url("0.3.5"), { "package-lock.json": '{"packages":{"node_modules/@adrifer/winix":{}},"x":"@adrifer/winix"}' });
    const run = deps("0.4.0");
    await upgrade(dir, { dry: false }, run);
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain(`"@adrifer/winix": "${url("0.4.0")}"`);
    expect(run.lines.at(-1)).toContain("run npm install");
  });

  it("changes nothing in a dry run, when already latest, or when pinned past the latest", async () => {
    for (const [spec, latest, dry, expected] of [
      ["0.3.5", "0.4.0", true, "Dry run"],
      ["0.4.0", "0.4.0", false, "already pinned"],
      ["0.5.0-preview.1", "0.4.0", false, "newer than the latest release"],
    ] as const) {
      const dir = await project(spec);
      const before = await readFile(join(dir, "package.json"), "utf8");
      const run = deps(latest);
      await upgrade(join(dir), { dry }, run);
      expect(await readFile(join(dir, "package.json"), "utf8")).toBe(before);
      expect(run.lines.join("\n")).toContain(expected);
    }
  });

  it("moves to a named release (also an older one) and refuses one that doesn't exist", async () => {
    const dir = await project("0.3.5");
    const nested = join(dir, "features");
    await mkdir(nested);
    await upgrade(nested, { dry: false, version: "v0.3.4" }, deps("0.4.0", ["0.3.4", "0.4.0"]));
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain('"@adrifer/winix": "0.3.4"');
    await expect(upgrade(dir, { dry: false, version: "9.9.9" }, deps("0.4.0"))).rejects.toThrow("isn't a release");
    await expect(upgrade(dir, { dry: false, version: "latest" }, deps("0.4.0"))).rejects.toThrow("Not a Winix release version");
  });

  it("fails clearly outside a project or with a floating pin", async () => {
    const empty = await mkdtemp(join(tmpdir(), "winix-upgrade-empty-"));
    dirs.push(empty);
    await expect(upgrade(empty, { dry: true }, deps("0.4.0"))).rejects.toThrow("No winix.config.ts");
    await expect(upgrade(await project("^0.3.0"), { dry: true }, deps("0.4.0"))).rejects.toThrow("exact version");
  });

  it("winix update mentions a newer Winix and never fails because of it", async () => {
    const dir = await project("0.3.5");
    const lines: string[] = [];
    await upgradeNotice(dir, { latest: async () => "0.4.0", log: (line) => lines.push(line) });
    expect(lines).toEqual(["\nWinix 0.4.0 is available (this config pins 0.3.5): winix upgrade"]);
    lines.length = 0;
    await upgradeNotice(dir, { latest: async () => "0.3.5", log: (line) => lines.push(line) });
    await upgradeNotice(dir, { latest: async () => { throw new Error("offline"); }, log: (line) => lines.push(line) });
    expect(lines).toEqual([]);
  });
});
