#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const mode = process.argv[2];
const args = process.argv.slice(3);

if (mode !== "stable" && mode !== "preview") {
  fail("Usage: npm run release:stable|release:preview -- [--patch|--minor|--major] [--from-branch] [--dry-run]");
}

const dryRun = args.includes("--dry-run");
const fromBranch = args.includes("--from-branch");
const bumpFlags = args.filter((arg) => ["--patch", "--minor", "--major"].includes(arg));

if (bumpFlags.length > 1) {
  fail("Use only one version bump flag: --patch, --minor, or --major.");
}

const explicitBump = bumpFlags[0]?.slice(2);
const defaultBump = "patch";

run("git", ["fetch", "--tags", "--quiet"]);

const branch = git(["branch", "--show-current"]);
const status = git(["status", "--porcelain"]);
const packageVersion = parseVersion(readPackageVersion());

// Stable releases must always come from main so that `latest` on npm always
// corresponds to main's history. Preview releases may opt into running from a
// feature branch with --from-branch: git tags are global to the repo and point
// at a specific commit regardless of branch, so a -preview.N tag on a feature
// branch's HEAD is valid and lets that exact commit be published to the npm
// `preview` dist-tag (for trying a branch before merging it). The clean-tree
// requirement is kept in all cases.
if (mode === "stable" && branch !== "main") {
  fail(`Stable releases must be created from main. Current branch is ${branch || "(detached)"}.`);
}

if (mode === "preview" && branch !== "main" && !fromBranch) {
  fail(
    `Preview releases default to main (current branch is ${branch || "(detached)"}).\n` +
    `To publish a preview from this branch's current commit, pass --from-branch.`
  );
}

if (status !== "") {
  fail("Working tree must be clean before creating a release.");
}

if (!packageVersion) {
  fail("package.json version must be a stable or preview semver version.");
}

const tags = git(["tag", "--list", "v*"])
  .split("\n")
  .map((tag) => tag.trim())
  .filter(Boolean)
  .map(parseTag)
  .filter(Boolean)
  .sort(compareVersions);

const versions = [...tags, packageVersion].sort(compareVersions);
const stableVersions = versions.filter((tag) => tag.preview === undefined);
const latest = versions.at(-1);
const latestStable = stableVersions.at(-1);
const nextVersion = mode === "stable"
  ? nextStableVersion({ latest, latestStable, explicitBump, defaultBump })
  : nextPreviewVersion({ latest, latestStable, explicitBump, defaultBump });
const nextTag = `v${formatVersion(nextVersion)}`;

if (tags.some((tag) => formatVersion(tag) === formatVersion(nextVersion))) {
  fail(`Tag ${nextTag} already exists.`);
}

console.log(`Creating ${mode} release ${nextTag}`);

if (dryRun) {
  console.log("Dry run only; no files, commits, tags, or remotes were changed.");
  process.exit(0);
}

run("npm", ["run", "check"]);
run("npm", ["test", "--", "--run"]);

if (mode === "stable") {
  run("npm", ["version", formatVersion(nextVersion), "--no-git-tag-version"]);
  run("npm", ["run", "build"]);
  run("npm", ["pack", "--dry-run"]);
  run("git", ["add", "package.json", "package-lock.json"]);
  run("git", ["commit", "-m", `release: ${nextTag}`]);
  run("git", ["tag", "-a", nextTag, "-m", nextTag]);
  run("git", ["push", "origin", `HEAD:${branch}`]);
  run("git", ["push", "origin", nextTag]);
} else {
  run("npm", ["run", "build"]);
  run("npm", ["pack", "--dry-run"]);
  run("git", ["tag", "-a", nextTag, "-m", nextTag]);
  run("git", ["push", "origin", nextTag]);
}

console.log(`Release tag ${nextTag} pushed (from ${branch || "detached HEAD"}). GitHub Actions will publish it to npm.`);

function nextStableVersion({ latest, latestStable, explicitBump, defaultBump }) {
  if (!latest && !latestStable) {
    return bumpVersion({ major: 0, minor: 0, patch: 0 }, explicitBump ?? defaultBump);
  }

  if (latest?.preview !== undefined && !explicitBump) {
    return withoutPreview(latest);
  }

  return bumpVersion(withoutPreview(latestStable ?? latest), explicitBump ?? defaultBump);
}

function nextPreviewVersion({ latest, latestStable, explicitBump, defaultBump }) {
  if (latest?.preview !== undefined && !explicitBump) {
    return { ...latest, preview: latest.preview + 1 };
  }

  return {
    ...bumpVersion(withoutPreview(latestStable ?? latest ?? { major: 0, minor: 0, patch: 0 }), explicitBump ?? defaultBump),
    preview: 0,
  };
}

function bumpVersion(version, bump) {
  if (bump === "major") {
    return { major: version.major + 1, minor: 0, patch: 0 };
  }

  if (bump === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  }

  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function withoutPreview(version) {
  return { major: version.major, minor: version.minor, patch: version.patch };
}

function parseTag(tag) {
  if (!tag.startsWith("v")) {
    return undefined;
  }

  return parseVersion(tag.slice(1));
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(version);

  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preview: match[4] === undefined ? undefined : Number(match[4]),
  };
}

function compareVersions(a, b) {
  for (const part of ["major", "minor", "patch"]) {
    const diff = a[part] - b[part];
    if (diff !== 0) {
      return diff;
    }
  }

  if (a.preview === undefined && b.preview === undefined) {
    return 0;
  }

  if (a.preview === undefined) {
    return 1;
  }

  if (b.preview === undefined) {
    return -1;
  }

  return a.preview - b.preview;
}

function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.preview === undefined ? base : `${base}-preview.${version.preview}`;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readPackageVersion() {
  const json = execFileSync("node", [
    "-p",
    "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version",
  ], { encoding: "utf8" });

  return json.trim();
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
