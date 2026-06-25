// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment } from "../core/types.ts";
import type { WinPackage, WinPackageSource, WinRawCommand } from "../types/index.ts";

/**
 * Accepted call shapes for `windows.package(...)`.
 *
 * - `"Git.Git"`            → sugar for `{ source: "winget", id: "Git.Git" }`
 * - `{ id, source?, version? }` → explicit form
 */
export interface WinPackageSpec {
  id: string;
  source?: WinPackageSource;
  version?: string;
  elevated?: boolean;
}

export type WinPackageArg = string | WinPackageSpec;

/**
 * Accepted object shape for `windows.raw(...)`.
 */
export interface WinRawCommandSpec {
  name?: string;
  executable: string;
  arguments?: string[];
}

export type WinRawCommandArg = string | WinRawCommandSpec;

function normalizePackage(arg: WinPackageArg): WinPackage {
  if (typeof arg === "string") {
    if (arg.length === 0) {
      throw new Error("windows.package(id) requires a non-empty package id");
    }
    return { id: arg, source: "winget" };
  }

  if (!arg || typeof arg !== "object") {
    throw new Error("windows.package(...) requires an id string or a spec object");
  }
  if (!arg.id || typeof arg.id !== "string") {
    throw new Error("windows.package({ id }) requires a non-empty id");
  }

  const pkg: WinPackage = {
    id: arg.id,
    source: arg.source ?? "winget",
  };
  if (arg.version !== undefined) {
    if (typeof arg.version !== "string" || arg.version.length === 0) {
      throw new Error(`windows.package("${arg.id}") version must be a non-empty string`);
    }
    pkg.version = arg.version;
  }
  if (arg.elevated !== undefined) {
    pkg.elevated = arg.elevated;
  }
  return pkg;
}

function normalizeRawCommand(arg: WinRawCommandArg): WinRawCommand {
  if (typeof arg === "string") {
    if (arg.length === 0) {
      throw new Error("windows.raw(command) requires a non-empty command string");
    }
    return { executable: "powershell", arguments: ["-Command", arg] };
  }

  if (!arg || typeof arg !== "object") {
    throw new Error("windows.raw(...) requires a command string or a spec object");
  }
  if (!arg.executable || typeof arg.executable !== "string") {
    throw new Error("windows.raw({ executable }) requires a non-empty executable");
  }

  const command: WinRawCommand = {
    executable: arg.executable,
  };
  if (arg.name !== undefined) {
    if (typeof arg.name !== "string" || arg.name.length === 0) {
      throw new Error("windows.raw({ name }) must be a non-empty string");
    }
    command.name = arg.name;
  }
  if (arg.arguments !== undefined) {
    if (
      !Array.isArray(arg.arguments) ||
      arg.arguments.some((value) => typeof value !== "string")
    ) {
      throw new Error("windows.raw({ arguments }) must be an array of strings");
    }
    command.arguments = arg.arguments;
  }
  return command;
}

export interface WindowsHelper {
  /**
   * Declare a winget/msstore package.
   *
   * ```ts
   * windows.package("Git.Git")
   * windows.package({ source: "msstore", id: "9NKSQGP7F2NH" })
   * windows.package({ id: "Git.Git", version: "2.44.0" })
   * ```
   */
  package(arg: WinPackageArg): Fragment;

  /**
   * Run an arbitrary command on every Windows apply via DSC v3's
   * `Microsoft.DSC.Transitional/RunCommandOnSet` resource.
   *
   * This is an escape hatch, not a declarative/idempotent helper:
   * `RunCommandOnSet` has no real test phase, so the command runs on every
   * `winget configure` apply. Prefer typed helpers when available.
   *
   * ```ts
   * windows.raw("New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin")
   * windows.raw({ executable: "pwsh", arguments: ["-Command", "Write-Host hi"] })
   * windows.raw({ name: "make-bin-dir", executable: "cmd", arguments: ["/c", "mkdir", "foo"] })
   * ```
   */
  raw(arg: WinRawCommandArg): Fragment;
}

export const windows: WindowsHelper = {
  package: (arg: WinPackageArg): Fragment => {
    const pkg = normalizePackage(arg);
    return { windows: { packages: { [pkg.id]: pkg } } };
  },
  raw: (arg: WinRawCommandArg): Fragment => {
    const command = normalizeRawCommand(arg);
    return { windows: { commands: [command] } };
  },
};
