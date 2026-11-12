import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const target = args[0] ?? "all";
const version = process.env.WINIX_BUILD_VERSION ?? JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(version)) throw new Error("Invalid standalone release version");
const targets = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "windows-x64": "bun-windows-x64-baseline",
  "windows-arm64": "bun-windows-arm64",
};
if (target !== "all" && !Object.hasOwn(targets, target)) throw new Error(`Unknown standalone target: ${target}`);
const output = join(root, "artifacts");
await mkdir(output, { recursive: true });
const assets = {};
const checksums = [];
for (const [platform, bunTarget] of Object.entries(targets)) {
  if (target !== "all" && target !== platform) continue;
  const name = `winix-${platform}${platform.startsWith("windows") ? ".exe" : ""}`;
  const runtimeDirectory = process.env.WINIX_BUN_RUNTIME_DIRECTORY;
  execFileSync("bun", [
    "build", join(root, "scripts", "standalone.ts"), "--compile", `--target=${bunTarget}`,
    "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--compile-exec-argv=--no-install",
    ...(runtimeDirectory ? [`--compile-executable-path=${join(runtimeDirectory, platform, platform.startsWith("windows") ? "bun.exe" : "bun")}`] : []),
    "--define", `WINIX_BUILD_VERSION=${JSON.stringify(version)}`,
    "--define", `WINIX_LINUX_ASSETS=${JSON.stringify(assets)}`,
    "--outfile", join(output, name),
  ], { cwd: root, stdio: "inherit" });
  const sha256 = createHash("sha256").update(await readFile(join(output, name))).digest("hex");
  if (platform.startsWith("linux-")) assets[platform.slice(6)] = { name, sha256 };
  checksums.push(`${sha256}  ${name}`);
}
for (const name of ["LICENSE", "NOTICE.txt"]) {
  await copyFile(join(root, name), join(output, name));
  checksums.push(`${createHash("sha256").update(await readFile(join(output, name))).digest("hex")}  ${name}`);
}
await writeFile(join(output, target === "all" ? "SHA256SUMS" : `SHA256SUMS-${target}`), checksums.join("\n") + "\n");
console.log(`Built standalone Winix ${version} (${target})`);
