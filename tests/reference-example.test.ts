import { describe, expect, it } from "vitest";
import referenceWorkspace from "../examples/reference/winix.config.ts";
import { evaluate, generateNix } from "../src/index.ts";

describe("reference example integration", () => {
  it("generates stable Nix output for examples/reference", () => {
    const evaluated = evaluate(referenceWorkspace);
    const output = generateNix(referenceWorkspace, evaluated);

    expect(evaluated.map((host) => host.name)).toEqual(["wsl", "macbook-pro"]);
    expect(output.warnings).toEqual([]);
    expect(output.rawModules).toEqual([]);
    expect({
      "flake.nix": output["flake.nix"],
      "hosts/wsl.nix": output.hosts["wsl.nix"],
      "hosts/macbook-pro.nix": output.hosts["macbook-pro.nix"],
    }).toMatchSnapshot();
  });
});
