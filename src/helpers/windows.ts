// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment, ResourceHandle, ResourceRef } from "../core/types.ts";
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
  /** Resources this package must be applied after (handles from other calls). */
  dependsOn?: ResourceHandle[];
}

export type WinPackageArg = string | WinPackageSpec;

/**
 * Accepted object shape for `windows.raw(...)`.
 */
export interface WinRawCommandSpec {
  name?: string;
  executable: string;
  arguments?: string[];
  /** Resources this command must run after (handles from other calls). */
  dependsOn?: ResourceHandle[];
}

export type WinRawCommandArg = string | WinRawCommandSpec;

/**
 * Resolve an array of resource handles passed to `dependsOn` into the stable
 * resource references the emitter wires up. Throws on a value that is not a
 * Winix resource handle (e.g. a plain fragment or a handle from a non-resource
 * helper), since only resources can be ordered.
 */
function resolveDependsOn(handles: ResourceHandle[] | undefined): ResourceRef[] | undefined {
  if (!handles || handles.length === 0) return undefined;
  const refs: ResourceRef[] = [];
  for (const handle of handles) {
    const ref = (handle as Partial<ResourceHandle>)?.__winixHandle;
    if (!ref) {
      throw new Error(
        "windows.*(dependsOn) expects resource handles returned by " +
        "windows.package(...) or windows.raw(...). Got a value without a " +
        "resource identity."
      );
    }
    refs.push(ref);
  }
  return refs;
}

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
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) pkg.dependsOn = deps;
  return pkg;
}

function normalizeRawCommand(arg: WinRawCommandArg): WinRawCommand {
  if (typeof arg === "string") {
    if (arg.length === 0) {
      throw new Error("windows.raw(command) requires a non-empty command string");
    }
    return withToken({
      executable: "powershell",
      arguments: ["-Command", arg],
    });
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
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) command.dependsOn = deps;
  return withToken(command);
}

/**
 * Stamp a non-enumerable identity token onto a command so a handle can
 * reference it via `dependsOn`. Non-enumerable so it never shows up in deep
 * equality checks, JSON, or the emitted YAML; it is read only by the helper
 * (to build the handle ref) and the emitter (to resolve names).
 */
function withToken(command: WinRawCommand): WinRawCommand {
  Object.defineProperty(command, "token", {
    value: Symbol("winix.command"),
    enumerable: false,
    configurable: true,
  });
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
  package(arg: WinPackageArg): ResourceHandle;

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
  raw(arg: WinRawCommandArg): ResourceHandle;
}

/**
 * Attach a resource identity to a fragment, turning it into a handle that can
 * be passed to another resource's `dependsOn`. The `__winixHandle` marker is
 * non-enumerable so it never leaks into the merged IR or emitted output.
 */
function asHandle(fragment: Fragment, ref: ResourceRef): ResourceHandle {
  Object.defineProperty(fragment, "__winixHandle", {
    value: ref,
    enumerable: false,
    configurable: true,
  });
  return fragment as ResourceHandle;
}

export const windows: WindowsHelper = {
  package: (arg: WinPackageArg): ResourceHandle => {
    const pkg = normalizePackage(arg);
    const fragment: Fragment = { windows: { packages: { [pkg.id]: pkg } } };
    return asHandle(fragment, { kind: "package", id: pkg.id });
  },
  raw: (arg: WinRawCommandArg): ResourceHandle => {
    const command = normalizeRawCommand(arg);
    const fragment: Fragment = { windows: { commands: [command] } };
    return asHandle(fragment, { kind: "command", token: command.token! });
  },
};
