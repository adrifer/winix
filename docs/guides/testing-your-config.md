---
title: Test your configuration
description: Write fast unit tests for features, platform guards and generated Nix or Windows output with Vitest.
sidebar:
  order: 8
---

# Test your configuration

Because a Winix config is plain TypeScript, you can unit-test your features and
hosts without running `nixos-rebuild` or touching Windows. Winix exports
[`evaluate()`](../api/evaluation.md#evaluate),
[`generateNix()`](../api/evaluation.md#generatenix),
[`generateWindows()`](../api/evaluation.md#generatewindows),
[`isWindowsHost()`](../api/evaluation.md#iswindowshost) and
[`withContext()`](../api/evaluation.md#withcontext) for this.

## Test a full host with evaluate()

Import your workspace (or build a minimal one with the features under test) and
assert on the merged result or the generated backend files:

```ts
import { describe, expect, it } from "vitest";
import { evaluate, generateNix, generateWindows, isWindowsHost } from "@adrifer/winix";
import config from "../winix.config.ts";

describe("winix config", () => {
  const evaluated = evaluate(config, { configDir: process.cwd() });

  it("emits valid Nix for every Nix host", () => {
    const nixHosts = evaluated.filter((h) => !isWindowsHost(h));
    const output = generateNix(config, nixHosts);

    expect(output.warnings).toEqual([]);
    expect(output.hosts["wsl-work.nix"]).toContain("programs.git.enable = true;");
  });

  it("declares expected Windows packages", () => {
    const output = generateWindows(evaluated);
    const desktop = output.resources["DESKTOP"];

    expect(desktop.some((r) => r.package?.id === "JesseDuffield.lazygit")).toBe(true);
  });
});
```

Pass `configDir` to `evaluate()` whenever your features use config-relative
helpers such as `home.symlink("./dotfiles/nvim")` or WSL `setup: { repository: "self" }`.

## Test platform and feature guards with withContext()

Inside a feature, `platforms.<name>.isActive` and `myFeature.isActive` read the
active evaluation context. Outside `evaluate()`, wrap assertions in
`withContext()` to test branches directly:

```ts
import { describe, expect, it } from "vitest";
import { platforms, withContext } from "@adrifer/winix";

describe("platform guards", () => {
  it("marks both nixos and wsl active on WSL hosts", () => {
    withContext({ platform: "nixos", variant: "wsl", features: ["dev"] }, () => {
      expect(platforms.nixos.isActive).toBe(true);
      expect(platforms.wsl.isActive).toBe(true);
      expect(platforms.windows.isActive).toBe(false);
    });
  });
});
```

`withContext()` restores the previous context when the callback returns or
throws, so tests stay isolated.

## Snapshot generated output

Checking a snapshot of `output.hosts["wsl-work.nix"]` or
`output.hosts["DESKTOP"]["resources.json"]` catches accidental changes when
refactoring shared roles or features:

```ts
it("matches the generated host module", () => {
  const output = generateNix(config, evaluated);
  expect(output.hosts["wsl-work.nix"]).toMatchSnapshot();
});
```

Every signature and option for the programmatic API:
[API: Evaluation and backends](../api/evaluation.md).
