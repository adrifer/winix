// `winix upgrade [version]`: move the project's Winix pin (package.json
// "@adrifer/winix") to the latest release, or to the one named. `winix update`
// never changes Winix; it only says when a newer release exists.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { findConfig } from "../loader.ts";
import { pinnedWinixVersion } from "./bootstrap.ts";

const REPOSITORY = "https://github.com/adrifer/winix";
const API = "https://api.github.com/repos/adrifer/winix/releases";
export const CHANGELOG_URL = `${REPOSITORY}/blob/main/CHANGELOG.md`;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/;

export interface UpgradeDeps {
  /** The latest stable release, e.g. "0.4.0". */
  latest(): Promise<string>;
  /** Whether a release with this version exists. */
  exists(version: string): Promise<boolean>;
  log(line: string): void;
}

async function getRelease(path: string): Promise<{ tag_name?: unknown } | undefined> {
  const response = await fetch(`${API}/${path}`, {
    headers: { "User-Agent": "winix", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${API}/${path}`);
  return await response.json() as { tag_name?: unknown };
}

export const defaultUpgradeDeps: UpgradeDeps = {
  latest: async () => {
    const tag = String((await getRelease("latest"))?.tag_name ?? "").replace(/^v/, "");
    if (!VERSION.test(tag)) throw new Error(`Unexpected latest Winix release: ${tag || "none"}`);
    return tag;
  },
  exists: async (version) => (await getRelease(`tags/v${version}`)) !== undefined,
  log: (line) => console.log(line),
};

/** Orders release versions; a preview comes before its stable release. */
export function compareWinixVersions(a: string, b: string): number {
  const [pa, pb] = [VERSION.exec(a), VERSION.exec(b)];
  if (!pa || !pb) throw new Error(`Not a Winix release version: ${pa ? b : a}`);
  for (let index = 1; index <= 3; index++) {
    const diff = Number(pa[index]) - Number(pb[index]);
    if (diff !== 0) return diff;
  }
  const [preA, preB] = [pa[4], pb[4]];
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return Number(preA) - Number(preB);
}

/** The same pin in the form the project already uses: a version, or the release tarball URL. */
export function pinFor(spec: string, version: string): string {
  return /^\d/.test(spec) ? version : `${REPOSITORY}/releases/download/v${version}/adrifer-winix-${version}.tgz`;
}

async function projectPin(cwd: string): Promise<{ directory: string; file: string; text: string; spec: string; version: string }> {
  const config = findConfig(cwd);
  if (!config) throw new Error("No winix.config.ts here or in a parent folder.");
  const directory = dirname(config);
  const file = join(directory, "package.json");
  if (!existsSync(file)) throw new Error(`${file} doesn't exist; winix init creates it with the Winix pin.`);
  const text = await readFile(file, "utf8");
  const pkg = JSON.parse(text) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  const spec = pkg.dependencies?.["@adrifer/winix"] ?? pkg.devDependencies?.["@adrifer/winix"];
  const version = pinnedWinixVersion(spec);
  return { directory, file, text, spec: spec as string, version };
}

export async function upgrade(
  cwd: string, opts: { dry: boolean; version?: string }, deps: UpgradeDeps = defaultUpgradeDeps,
): Promise<void> {
  const pin = await projectPin(cwd);
  let target: string;
  if (opts.version !== undefined) {
    target = opts.version.replace(/^v/, "");
    if (!VERSION.test(target)) throw new Error(`Not a Winix release version: ${opts.version}`);
    if (!(await deps.exists(target))) throw new Error(`Winix ${target} isn't a release (see ${REPOSITORY}/releases).`);
  } else {
    target = await deps.latest();
  }
  const where = `${pin.directory}`;
  const order = compareWinixVersions(target, pin.version);
  if (order === 0) {
    deps.log(`Winix ${pin.version} is already pinned${opts.version ? "" : ", the latest release"} (${where}).`);
    return;
  }
  if (order < 0 && opts.version === undefined) {
    deps.log(`Winix ${pin.version} is pinned, newer than the latest release (${target}); nothing to do (${where}).`);
    return;
  }
  const next = pinFor(pin.spec, target);
  const pattern = new RegExp(`("@adrifer/winix"\\s*:\\s*")${pin.spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(")`);
  if (!pattern.test(pin.text)) throw new Error(`Couldn't find the @adrifer/winix pin in ${pin.file}.`);
  deps.log(`Winix ${pin.version} → ${target}${order < 0 ? " (older)" : ""} in ${pin.file}`);
  deps.log(`Changes: ${CHANGELOG_URL}`);
  if (opts.dry) {
    deps.log("Dry run: package.json was not changed.");
    return;
  }
  await writeFile(pin.file, pin.text.replace(pattern, `$1${next}$2`));
  deps.log("");
  deps.log(`Next: winix plan (downloads Winix ${target}), then commit package.json; other machines get it with git pull.`);
  const lock = join(pin.directory, "package-lock.json");
  if (existsSync(lock) && (await readFile(lock, "utf8")).includes("\"@adrifer/winix\"")) {
    deps.log("package-lock.json still records the old version: run npm install if you run Winix through npm.");
  }
}

/** The line `winix update` ends with when a newer Winix exists. Never fails the update. */
export async function upgradeNotice(cwd: string, deps: Pick<UpgradeDeps, "latest" | "log"> = defaultUpgradeDeps): Promise<void> {
  try {
    const pin = await projectPin(cwd);
    const latest = await deps.latest();
    if (compareWinixVersions(latest, pin.version) > 0) {
      deps.log(`\nWinix ${latest} is available (this config pins ${pin.version}): winix upgrade`);
    }
  } catch {
    // Offline, no pin, or GitHub unreachable: say nothing.
  }
}
