import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain ES module script, without type declarations.
import { generateApiDocs, OUTPUT } from "../scripts/api-docs.mjs";

describe("API reference (docs/api)", () => {
  const { files, missing } = generateApiDocs() as { files: Map<string, string>; missing: string[] };

  it("documents every public helper and option", () => {
    // Add a doc comment where it's declared, then run npm run api-docs.
    expect(missing).toEqual([]);
  });

  it("is up to date with the source (npm run api-docs)", () => {
    expect(readdirSync(OUTPUT).sort()).toEqual([...files.keys()].sort());
    for (const [file, content] of files) {
      // A Windows checkout may have CRLF line endings.
      expect(readFileSync(join(OUTPUT, file), "utf8").replace(/\r\n/g, "\n"), `docs/api/${file} is out of date: run npm run api-docs`).toBe(content);
    }
  });
}, 60000);
