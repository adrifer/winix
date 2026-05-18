import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

await rewriteDts("dist");

async function rewriteDts(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteDts(path);
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      const before = await readFile(path, "utf-8");
      const after = before.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
      if (after !== before) {
        await writeFile(path, after);
      }
    }
  }
}
