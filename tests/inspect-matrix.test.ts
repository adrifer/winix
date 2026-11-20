import { describe, expect, it } from "vitest";
import { feature, host, overlay, platforms, profile, workspace } from "../src/index.ts";
import { analyzeWorkspace, collectIgnoredFragments } from "../src/cli/analysis.ts";
import { inspectMatrix } from "../src/cli/commands/inspect.ts";
import { evaluate } from "../src/evaluator/index.ts";

describe("inspect --matrix", () => {
  it("groups features by role and shows where each applies", () => {
    const tool = feature("tool", ({ home, windows }) => { home.packages("eza"); windows.package("eza-community.eza"); });
    const homeOnly = feature("home-only", ({ home }) => { home.packages("fzf"); });
    const extra = feature("extra", ({ home }) => { home.packages("rustup"); });
    const everywhere = profile("everywhere", [tool(), homeOnly()]);
    const system = profile("system", [overlay.stable("nixpkgs-stable"), extra()]);
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("pc", platforms.windows(), [everywhere()]),
        host("linux", platforms.nixos({ stateVersion: "25.05" }), ({ home }) => {
          home.packages("ffmpeg");
          return [everywhere(), system()];
        }),
      ],
    });
    const analyses = analyzeWorkspace(ws);
    const ignored = collectIgnoredFragments(analyses, evaluate(ws));
    // Shared roles are composed: check (which filters these) stays quiet about home-only on Windows.
    expect(ignored).toEqual([{ host: "pc", fragment: "home-only", scopes: ["homeManager"], composed: true }]);
    expect(inspectMatrix(analyses, ignored).map((line) => line.trimEnd())).toEqual([
      "",
      "                      pc  linux",
      "everywhere",
      "  tool                ●     ●",
      "  home-only           ·     ●",
      "system",
      "  (its own settings)        ●",
      "  extra                     ●",
      "listed on the host",
      "  (inline in linux)         ●",
      "",
      "● applies   · included, nothing for this platform   (blank) not included",
    ]);
  });

  it("keeps profiles usable as before (isActive, id)", () => {
    const role = profile("role", []);
    expect(role.id).toBe("role");
    expect(role().__group).toBe(true);
    expect(role().__id).toBe("role");
  });
});
