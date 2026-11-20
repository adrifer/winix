import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { standaloneRuntime, type EditorTypeBundle } from "../runtime.ts";

/**
 * Editor types without npm: the running Winix writes the declarations for its
 * own SDK (plus Node's) to the config's ignored .winix/types, and the config's
 * tsconfig.json maps `@adrifer/winix` there. Every command that loads the
 * config refreshes them, so they always match the Winix that runs it.
 */

export const EDITOR_TYPES_DIRECTORY = ".winix/types";
const STAMP = ".bundle";

/** The compilerOptions a config's tsconfig.json needs to use .winix/types. */
export const EDITOR_COMPILER_OPTIONS = {
  typeRoots: ["./.winix/types/@types"],
  types: ["node"],
  paths: {
    "@adrifer/winix": ["./.winix/types/node_modules/@adrifer/winix/index.d.ts"],
    "@adrifer/winix/types": ["./.winix/types/node_modules/@adrifer/winix/dist/types/index.d.ts"],
    "@adrifer/winix/types/bundled": ["./.winix/types/node_modules/@adrifer/winix/types/index.d.ts"],
  },
};

let cached: Promise<EditorTypeBundle | undefined> | undefined;

/** Embedded in standalone builds; read from the package's dist/ otherwise (absent in an unbuilt source checkout). */
export function editorTypeBundle(): Promise<EditorTypeBundle | undefined> {
  cached ??= (async () => {
    const embedded = standaloneRuntime()?.editorTypes;
    if (embedded) return embedded;
    // dist/cli/editor-types.js -> dist/editor-types.json; src/cli/editor-types.ts -> dist/editor-types.json
    for (const relative of ["../editor-types.json", "../../dist/editor-types.json"]) {
      try {
        return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8")) as EditorTypeBundle;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return undefined;
  })();
  return cached;
}

async function plainDirectory(path: string): Promise<void> {
  try {
    if (!(await lstat(path)).isDirectory()) throw new Error(`Refusing a linked/non-directory path: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: string[] = [];
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), name));
    else files.push(name);
  }
  return files;
}

/**
 * Writes `bundle` to <configDir>/.winix/types unless it is already there.
 * Files are overwritten in place (editors may hold the folder open) and stale
 * ones removed; the stamp is written last, so an interrupted write is redone.
 */
export async function writeEditorTypes(
  configDir: string, bundle?: EditorTypeBundle,
): Promise<"current" | "written" | "unavailable"> {
  bundle ??= await editorTypeBundle();
  if (!bundle) return "unavailable";
  const winix = join(configDir, ".winix");
  const target = join(winix, "types");
  await plainDirectory(winix);
  await plainDirectory(target);
  try {
    if ((await readFile(join(target, STAMP), "utf8")).trim() === bundle.hash) return "current";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of Object.keys(bundle.files)) {
    if (!/^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/.test(name) || name.split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`Invalid editor type path: ${name}`);
    }
  }
  await rm(join(target, STAMP), { force: true });
  for (const [name, content] of Object.entries(bundle.files)) {
    const path = join(target, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  for (const stale of await listFiles(target)) {
    if (stale !== STAMP && !Object.hasOwn(bundle.files, stale)) await rm(join(target, ...stale.split("/")), { force: true });
  }
  await writeFile(join(target, STAMP), `${bundle.hash}\n`);
  return "written";
}

/** Best effort for commands: editor types never fail a check/plan/switch. */
export async function refreshEditorTypes(configDir: string): Promise<void> {
  try {
    await writeEditorTypes(configDir);
  } catch (error) {
    console.error(`Warning: could not update editor types in ${join(configDir, ".winix", "types")}: ${(error as Error).message}`);
  }
}

/** Whether the config's tsconfig.json already points at .winix/types (a plain text check; tsconfig allows comments). */
export async function tsconfigUsesEditorTypes(configDir: string): Promise<boolean | undefined> {
  try {
    return (await readFile(join(configDir, "tsconfig.json"), "utf8")).includes(EDITOR_TYPES_DIRECTORY);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** `winix types`: write them now and say what the tsconfig needs. */
export async function typesCommand(configDir: string): Promise<void> {
  const result = await writeEditorTypes(configDir);
  if (result === "unavailable") {
    throw new Error("This Winix has no editor types bundle (in a Winix source checkout, run npm run build first).");
  }
  console.log(`✓ Editor types ${result === "current" ? "are current" : "written"} in ${join(configDir, ".winix", "types")}`);
  const uses = await tsconfigUsesEditorTypes(configDir);
  if (uses) return;
  console.log(`\n${uses === undefined ? "Create tsconfig.json" : "Add these compilerOptions to tsconfig.json"} so editors use them (no npm needed):`);
  console.log(JSON.stringify({ compilerOptions: EDITOR_COMPILER_OPTIONS }, null, 2));
  console.log('Also exclude ".winix" from "include" globs.');
}
