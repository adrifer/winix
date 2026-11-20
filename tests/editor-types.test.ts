import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorTypeBundle, tsconfigUsesEditorTypes, typesCommand, writeEditorTypes } from "../src/cli/editor-types.ts";
import { init } from "../src/cli/commands/init.ts";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

const built = existsSync(new URL("../dist/editor-types.json", import.meta.url));

describe("editor types in .winix/types", () => {
  it("writes a bundle once, then rewrites only changes and removes stale files", async () => {
    const config = await directory("winix-types-");
    const first = { hash: "one", files: { "a/b.d.ts": "export {};\n", "c.d.ts": "declare const c: 1;\n" } };
    expect(await writeEditorTypes(config, first)).toBe("written");
    expect(await readFile(join(config, ".winix", "types", "a", "b.d.ts"), "utf8")).toBe("export {};\n");
    expect(await writeEditorTypes(config, first)).toBe("current");
    const second = { hash: "two", files: { "a/b.d.ts": "export declare const b: 2;\n" } };
    expect(await writeEditorTypes(config, second)).toBe("written");
    expect(await readFile(join(config, ".winix", "types", "a", "b.d.ts"), "utf8")).toContain("b: 2");
    expect(existsSync(join(config, ".winix", "types", "c.d.ts"))).toBe(false);
    expect((await readFile(join(config, ".winix", "types", ".bundle"), "utf8")).trim()).toBe("two");
    await expect(writeEditorTypes(config, { hash: "bad", files: { "../escape.d.ts": "" } })).rejects.toThrow("Invalid editor type path");
  });

  it.skipIf(!built)("ships the Winix SDK, bundled option types and Node types", async () => {
    const bundle = (await editorTypeBundle())!;
    expect(bundle.hash).toMatch(/^[a-f0-9]{64}$/);
    for (const file of [
      "node_modules/@adrifer/winix/index.d.ts", "node_modules/@adrifer/winix/dist/index.d.ts",
      "node_modules/@adrifer/winix/types/bundled/nixos.d.ts", "node_modules/@adrifer/winix/dist/types/index.d.ts",
      "@types/node/index.d.ts", "@types/node/LICENSE", "node_modules/undici-types/index.d.ts",
    ]) expect(Object.hasOwn(bundle.files, file), file).toBe(true);
  });

  it.skipIf(!built)("type-checks an init config with only .winix/types (no node_modules), catching wrong options", async () => {
    const config = await directory("winix-editor-");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await init(config, { force: false });
    expect(existsSync(join(config, "node_modules"))).toBe(false);
    expect(await tsconfigUsesEditorTypes(config)).toBe(true);
    await mkdir(join(config, "features"));
    await writeFile(join(config, "features", "tools.ts"), `
import { readdirSync } from "node:fs";
import { feature } from "@adrifer/winix";
import type { WinWslSetup } from "@adrifer/winix/types";
export const tools = feature("tools", ({ nixos, home }) => {
  nixos.program("nix-ld", { libraries: [] });
  home.packages(...readdirSync(".").filter((name) => name.endsWith(".pkg")));
});
export type Setup = WinWslSetup;
`);
    await writeFile(join(config, "features", "wrong.ts"), `
import { feature } from "@adrifer/winix";
export const wrong = feature("wrong", ({ nixos }) => { nixos.program("nix-ld", { libraries: 42 }); });
`);
    const parsed = ts.getParsedCommandLineOfConfigFile(join(config, "tsconfig.json"), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(String(diagnostic.messageText)); },
    })!;
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const problems = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
      file: diagnostic.file?.fileName.replaceAll("\\", "/").split("/").slice(-2).join("/"),
      text: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
    expect(parsed.fileNames.some((file) => file.includes(".winix"))).toBe(false);
    expect(problems.filter((problem) => problem.file !== "features/wrong.ts")).toEqual([]);
    expect(problems.find((problem) => problem.file === "features/wrong.ts")?.text).toMatch(/not assignable to type/);
  }, 60000);

  it.skipIf(!built)("winix types reports the tsconfig change a config still needs", async () => {
    const config = await directory("winix-types-command-");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await writeFile(join(config, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }');
    await typesCommand(config);
    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("Editor types written");
    expect(output).toContain("Add these compilerOptions");
    expect(output).toContain("./.winix/types/node_modules/@adrifer/winix/index.d.ts");
    log.mockClear();
    await typesCommand(config);
    expect(String(log.mock.calls[0][0])).toContain("are current");
  });
});
