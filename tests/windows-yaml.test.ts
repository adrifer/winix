import { describe, expect, it } from "vitest";
import { yamlLines, yamlEntry, yamlScalar } from "../src/backends/windows/yaml.ts";

const render = (value: Parameters<typeof yamlLines>[0]): string =>
  yamlLines(value).join("\n");

describe("windows yaml serializer", () => {
  describe("scalars", () => {
    it("emits plain tokens unquoted", () => {
      expect(yamlScalar("Present")).toBe("Present");
      expect(yamlScalar("winget")).toBe("winget");
      expect(yamlScalar("Git.Git")).toBe("Git.Git");
      expect(yamlScalar("Microsoft.DSC/PowerShell")).toBe("Microsoft.DSC/PowerShell");
    });

    it("quotes strings with spaces or YAML-significant chars", () => {
      expect(yamlScalar("Set EDITOR")).toBe('"Set EDITOR"');
      expect(yamlScalar("C:\\Users\\me")).toBe('"C:\\\\Users\\\\me"');
      expect(yamlScalar("a: b")).toBe('"a: b"');
    });

    it("quotes strings that look like other YAML types", () => {
      expect(yamlScalar("true")).toBe('"true"');
      expect(yamlScalar("123")).toBe('"123"');
      expect(yamlScalar("null")).toBe('"null"');
      expect(yamlScalar("1.0")).toBe('"1.0"');
    });

    it("renders real booleans, numbers, and null unquoted", () => {
      expect(yamlScalar(true)).toBe("true");
      expect(yamlScalar(false)).toBe("false");
      expect(yamlScalar(42)).toBe("42");
      expect(yamlScalar(null)).toBe("null");
    });

    it("throws on non-finite numbers", () => {
      expect(() => yamlScalar(Infinity)).toThrow(/non-finite/);
      expect(() => yamlScalar(NaN)).toThrow(/non-finite/);
    });
  });

  describe("objects", () => {
    it("renders a flat mapping", () => {
      expect(render({ Name: "EDITOR", Value: "nvim", Ensure: "Present" })).toBe(
        ["Name: EDITOR", "Value: nvim", "Ensure: Present"].join("\n")
      );
    });

    it("renders nested mappings with indentation", () => {
      expect(render({ winget: { processor: "dscv3" } })).toBe(
        ["winget:", "  processor: dscv3"].join("\n")
      );
    });

    it("renders an empty object inline", () => {
      expect(render({})).toBe("{}");
      expect(render({ properties: {} })).toBe("properties: {}");
    });
  });

  describe("arrays", () => {
    it("renders a scalar array as a block sequence", () => {
      expect(yamlEntry("Target", ["Process", "User"], 0).join("\n")).toBe(
        ["Target:", "- Process", "- User"].join("\n")
      );
    });

    it("renders an empty array inline", () => {
      expect(yamlEntry("resources", [], 0).join("\n")).toBe("resources: []");
    });

    it("renders an array of objects (block sequence of mappings)", () => {
      const value = {
        resources: [
          {
            name: "EDITOR",
            type: "PSDscResources/Environment",
            properties: { Name: "EDITOR", Value: "nvim" },
          },
        ],
      };
      expect(render(value)).toBe(
        [
          "resources:",
          "- name: EDITOR",
          "  type: PSDscResources/Environment",
          "  properties:",
          "    Name: EDITOR",
          "    Value: nvim",
        ].join("\n")
      );
    });

    it("hoists the first key of an object item onto the dash line", () => {
      expect(render([{ a: 1, b: 2 }])).toBe(
        ["- a: 1", "  b: 2"].join("\n")
      );
    });
  });

  describe("the PSDSC adapter shape (env/path target)", () => {
    it("renders the full Microsoft.DSC/PowerShell wrapper", () => {
      const properties = {
        resources: [
          {
            name: "Set EDITOR",
            type: "PSDscResources/Environment",
            properties: {
              Name: "EDITOR",
              Value: "nvim",
              Ensure: "Present",
              Target: ["Process", "User"],
            },
          },
        ],
      };
      expect(render(properties)).toBe(
        [
          "resources:",
          '- name: "Set EDITOR"',
          "  type: PSDscResources/Environment",
          "  properties:",
          "    Name: EDITOR",
          "    Value: nvim",
          "    Ensure: Present",
          "    Target:",
          "    - Process",
          "    - User",
        ].join("\n")
      );
    });
  });
});
