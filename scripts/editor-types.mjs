// Collects the type declarations an editor needs for a Winix config into
// dist/editor-types.json: the Winix SDK (with its bundled NixOS/Home Manager/
// nix-darwin option types), @types/node and undici-types, with their licenses.
// The npm package ships it and standalone executables embed it; Winix writes
// it to a config's ignored .winix/types so editors work without npm.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = {};

async function add(source, target, keep) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = join(source, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") await add(path, posix.join(target, entry.name), keep);
    } else if (entry.isFile() && keep(entry.name)) {
      files[posix.join(target, entry.name)] = await readFile(path, "utf8");
    }
  }
}
const declarations = (name) => name.endsWith(".d.ts");
const packageFiles = (name) => name.endsWith(".d.ts") || name === "package.json" || name === "LICENSE";

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const winix = "node_modules/@adrifer/winix";
if (!existsSync(join(root, "dist", "index.d.ts"))) throw new Error("Run the TypeScript build first: dist/index.d.ts is missing");
files[`${winix}/package.json`] = JSON.stringify({
  name: pkg.name,
  version: process.env.WINIX_BUILD_VERSION ?? pkg.version,
  type: "module",
  types: "./index.d.ts",
  exports: {
    ".": { types: "./index.d.ts" },
    "./types": { types: "./dist/types/index.d.ts" },
    "./types/bundled": { types: "./types/index.d.ts" },
  },
}, null, 2) + "\n";
files[`${winix}/index.d.ts`] = await readFile(join(root, "index.d.ts"), "utf8");
files[`${winix}/LICENSE`] = await readFile(join(root, "LICENSE"), "utf8");
await add(join(root, "types"), `${winix}/types`, declarations);
await add(join(root, "dist"), `${winix}/dist`, declarations);

for (const [name, target] of [["@types/node", "@types/node"], ["undici-types", "node_modules/undici-types"]]) {
  const directory = join(root, "node_modules", ...name.split("/"));
  if (!existsSync(join(directory, "package.json"))) throw new Error(`Missing ${name}; run npm ci`);
  await add(directory, target, packageFiles);
}

const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const hash = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
await writeFile(join(root, "dist", "editor-types.json"), JSON.stringify({ hash, files: sorted }));
console.log(`Editor types: ${Object.keys(sorted).length} files (${hash.slice(0, 12)})`);
