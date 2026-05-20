import { describe, expect, it } from "vitest";
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
