import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { workspace } from "../src/index.js";
import { detectNixpkgsChannel } from "../src/cli/types-gen/download.js";
import { emitGeneratedTypes } from "../src/cli/types-gen/emitter.js";
import { generateTypes } from "../src/cli/types-gen/index.js";
import { nixTypeToTs, parseOptions } from "../src/cli/types-gen/parser.js";

describe("types generate parser", () => {
  it("maps common Nix option type strings to TypeScript", () => {
    expect(nixTypeToTs("boolean")).toBe("boolean");
    expect(nixTypeToTs("signed integer")).toBe("number");
    expect(nixTypeToTs("unsigned integer")).toBe("number");
    expect(nixTypeToTs("package")).toBe("PackageRef");
    expect(nixTypeToTs("absolute path")).toBe("string");
    expect(nixTypeToTs("strings concatenated with \"\\n\"")).toBe("string");
    expect(nixTypeToTs("null or string")).toBe("string | null");
    expect(nixTypeToTs("list of signed integer")).toBe("number[]");
    expect(nixTypeToTs("list of package")).toBe("PackageRef[] | NixExpr");
    expect(nixTypeToTs("attribute set of string")).toBe("Record<string, string>");
    expect(nixTypeToTs("attribute set of (submodule)")).toBe("Record<string, unknown>");
    expect(nixTypeToTs("one of \"yes\", \"no\"")).toBe("\"no\" | \"yes\"");
    expect(nixTypeToTs("submodule")).toBe("Record<string, unknown>");
    expect(nixTypeToTs("anything surprising")).toBe("unknown");
  });

  it("parses visible options and skips hidden/internal entries", () => {
    const parsed = parseOptions({
      "services.openssh.enable": {
        type: "boolean",
        loc: ["services", "openssh", "enable"],
      },
      "internal.option": {
        type: "string",
        internal: true,
      },
      "hidden.option": {
        type: "string",
        visible: false,
      },
    });

    expect(parsed).toEqual([
      {
        path: ["services", "openssh", "enable"],
        tsType: "boolean",
        nixType: "boolean",
      },
    ]);
  });
});

describe("types generate emitter", () => {
  it("emits nested d.ts output with quoted keys and depth caps", () => {
    const emitted = emitGeneratedTypes([
      { path: ["services", "openssh", "enable"], tsType: "boolean", nixType: "boolean" },
      { path: ["programs", "nix-ld", "enable"], tsType: "boolean", nixType: "boolean" },
      {
        path: ["a", "b", "c", "d", "e"],
        tsType: "string",
        nixType: "string",
      },
    ]);

    expect(emitted.nixos).toContain("export interface NixosGenerated");
    expect(emitted.nixos).toContain("openssh?:");
    expect(emitted.nixos).toContain("\"nix-ld\"?:");
    expect(emitted.nixos).toContain("d?: Record<string, unknown>;");
    expect(emitted.index).toContain("declare module \"winix/types\"");
    expect(emitted.stats).toEqual({ options: 3, namespaces: 3 });
  });
});

describe("types generate orchestration", () => {
  it("detects nixpkgs channels from workspace inputs", () => {
    expect(detectNixpkgsChannel({ nixpkgs: "nixos-unstable" })).toBe("nixos-unstable");
    expect(detectNixpkgsChannel({ nixpkgs: "nixpkgs-unstable" })).toBe("nixos-unstable");
    expect(detectNixpkgsChannel({ nixpkgs: "github:NixOS/nixpkgs/nixos-25.05" })).toBe(
      "nixos-25.05"
    );
  });

  it("generates files from a fetched options.json response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-types-gen-"));
    const optionsJson = JSON.stringify({
      "services.openssh.enable": {
        type: "boolean",
        loc: ["services", "openssh", "enable"],
      },
    });
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { etag: "sample" },
        });
      }
      return new Response(optionsJson, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await generateTypes({
        workspace: workspace({ inputs: { nixpkgs: "nixos-unstable" }, hosts: [] }),
        configDir: dir,
        fetchImpl,
      });

      expect(result.options).toBe(1);
      expect(await readFile(join(dir, ".winix/types/generated/nixos.d.ts"), "utf-8")).toContain(
        "openssh"
      );
      expect(await readFile(join(dir, ".winix/types/generated/index.d.ts"), "utf-8")).toContain(
        "NixosOptions"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
