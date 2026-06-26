// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment, ResourceHandle, ResourceRef } from "../core/types.ts";
import type {
  WinDscProperties,
  WinDscResource,
  WinPackage,
  WinPackageSource,
  WinRawCommand,
} from "../types/index.ts";

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
  /**
   * Resources this package must be applied after. Accepts a single handle or
   * an array of handles, both returned by `windows.package(...)` /
   * `windows.raw(...)`.
   */
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinPackageArg = string | WinPackageSpec;

/**
 * Accepted object shape for `windows.raw(...)`.
 */
export interface WinRawCommandSpec {
  name?: string;
  executable: string;
  arguments?: string[];
  /**
   * Resources this command must run after. Accepts a single handle or an array
   * of handles.
   */
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinRawCommandArg = string | WinRawCommandSpec;

/**
 * Accepted object shape for `windows.dsc(...)`, the generic DSC v3 escape
 * hatch. `type` is the fully qualified DSC resource type; `properties` is a
 * free-form JSON-like object serialized verbatim to YAML.
 */
export interface WinDscSpec {
  type: string;
  name?: string;
  properties?: WinDscProperties;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/**
 * Which environment targets an `env`/`path` write applies to. `Process` makes
 * the change visible to the current `winget configure` process; `User` and
 * `Machine` persist it. Defaults to `["Process", "User"]` (per-user, no
 * elevation needed).
 */
export type WinEnvTarget = "Process" | "User" | "Machine";

/** Accepted object shape for `windows.env(...)`. */
export interface WinEnvSpec {
  name: string;
  /** Value to set. Omit with `ensure: "Absent"` to remove the variable. */
  value?: string;
  ensure?: "Present" | "Absent";
  target?: WinEnvTarget[];
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/** Accepted object shape for `windows.path(...)`. */
export interface WinPathSpec {
  /** Directory to ensure on PATH. */
  value: string;
  ensure?: "Present" | "Absent";
  target?: WinEnvTarget[];
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/**
 * Resolve `dependsOn` (a single handle or an array) into the stable resource
 * references the emitter wires up. Throws on a value that is not a Winix
 * resource handle (e.g. a plain fragment or a handle from a non-resource
 * helper), since only resources can be ordered.
 */
function resolveDependsOn(
  dependsOn: ResourceHandle | ResourceHandle[] | undefined
): ResourceRef[] | undefined {
  if (!dependsOn) return undefined;
  const handles = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  if (handles.length === 0) return undefined;
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

/** Stamp a non-enumerable identity token onto a generic DSC resource. */
function withDscToken(resource: WinDscResource): WinDscResource {
  Object.defineProperty(resource, "token", {
    value: Symbol("winix.dsc"),
    enumerable: false,
    configurable: true,
  });
  return resource;
}

const DSC_POWERSHELL_ADAPTER = "Microsoft.DSC/PowerShell";
const PSDSC_ENVIRONMENT = "PSDscResources/Environment";
const DEFAULT_ENV_TARGET: WinEnvTarget[] = ["Process", "User"];

function normalizeDsc(arg: WinDscSpec): WinDscResource {
  if (!arg || typeof arg !== "object") {
    throw new Error("windows.dsc(...) requires a spec object");
  }
  if (!arg.type || typeof arg.type !== "string") {
    throw new Error("windows.dsc({ type }) requires a non-empty resource type");
  }
  const resource: WinDscResource = { resourceType: arg.type };
  if (arg.name !== undefined) {
    if (typeof arg.name !== "string" || arg.name.length === 0) {
      throw new Error("windows.dsc({ name }) must be a non-empty string");
    }
    resource.name = arg.name;
  }
  if (arg.properties !== undefined) {
    if (arg.properties === null || typeof arg.properties !== "object" || Array.isArray(arg.properties)) {
      throw new Error("windows.dsc({ properties }) must be a plain object");
    }
    resource.properties = arg.properties;
  }
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscToken(resource);
}

/**
 * Validate the shared env/path target list. Defaults to per-user when omitted.
 */
function normalizeEnvTarget(target: WinEnvTarget[] | undefined): WinEnvTarget[] {
  if (target === undefined) return DEFAULT_ENV_TARGET;
  if (!Array.isArray(target) || target.length === 0) {
    throw new Error("windows.env/path target must be a non-empty array");
  }
  const valid: WinEnvTarget[] = ["Process", "User", "Machine"];
  for (const t of target) {
    if (!valid.includes(t)) {
      throw new Error(
        `windows.env/path target "${t}" is invalid; expected one of ` +
        valid.join(", ")
      );
    }
  }
  return target;
}

/**
 * Build the `PSDscResources/Environment` adapter resource shared by env and
 * path. `isPath` toggles the resource's `Path: true` flag, which makes the
 * Environment resource APPEND to (rather than replace) the existing value and
 * de-duplicate, giving idempotent PATH management.
 */
function buildEnvironmentDsc(opts: {
  innerName: string;
  variableName: string;
  value?: string;
  ensure: "Present" | "Absent";
  target: WinEnvTarget[];
  isPath: boolean;
  dependsOn?: ResourceRef[];
}): WinDscResource {
  const inner: WinDscProperties = {
    Name: opts.variableName,
    Ensure: opts.ensure,
  };
  if (opts.value !== undefined) inner.Value = opts.value;
  if (opts.isPath) inner.Path = true;
  inner.Target = opts.target;

  const resource: WinDscResource = {
    resourceType: DSC_POWERSHELL_ADAPTER,
    name: opts.innerName,
    properties: {
      resources: [
        {
          name: opts.variableName,
          type: PSDSC_ENVIRONMENT,
          properties: inner,
        },
      ],
    },
  };
  if (opts.dependsOn) resource.dependsOn = opts.dependsOn;
  return withDscToken(resource);
}

function normalizeEnv(arg: WinEnvSpec): WinDscResource {
  if (!arg || typeof arg !== "object") {
    throw new Error("windows.env(...) requires a spec object");
  }
  if (!arg.name || typeof arg.name !== "string") {
    throw new Error("windows.env({ name }) requires a non-empty variable name");
  }
  const ensure = arg.ensure ?? "Present";
  if (ensure === "Present" && (arg.value === undefined || typeof arg.value !== "string")) {
    throw new Error(
      `windows.env("${arg.name}") requires a string value when ensure is "Present"`
    );
  }
  if (arg.value !== undefined && typeof arg.value !== "string") {
    throw new Error(`windows.env("${arg.name}") value must be a string`);
  }
  return buildEnvironmentDsc({
    innerName: `Set ${arg.name}`,
    variableName: arg.name,
    value: arg.value,
    ensure,
    target: normalizeEnvTarget(arg.target),
    isPath: false,
    dependsOn: resolveDependsOn(arg.dependsOn),
  });
}

function normalizePath(arg: WinPathSpec): WinDscResource {
  if (!arg || typeof arg !== "object") {
    throw new Error("windows.path(...) requires a spec object");
  }
  if (!arg.value || typeof arg.value !== "string") {
    throw new Error("windows.path({ value }) requires a non-empty directory");
  }
  return buildEnvironmentDsc({
    innerName: `Path ${arg.value}`,
    variableName: "Path",
    value: arg.value,
    ensure: arg.ensure ?? "Present",
    target: normalizeEnvTarget(arg.target),
    isPath: true,
    dependsOn: resolveDependsOn(arg.dependsOn),
  });
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

  /**
   * Declare an arbitrary DSC v3 resource (escape hatch). The `type` is a fully
   * qualified DSC resource type and `properties` is serialized verbatim to the
   * generated configuration. Use this for resources Winix has no typed helper
   * for, including PSDSC resources via the `Microsoft.DSC/PowerShell` adapter.
   *
   * ```ts
   * windows.dsc({
   *   type: "Microsoft.Windows/Service",
   *   properties: { name: "spooler", startType: "automatic" },
   * });
   * ```
   */
  dsc(arg: WinDscSpec): ResourceHandle;

  /**
   * Manage a user (or machine) environment variable declaratively via the
   * `PSDscResources/Environment` resource (DSC v3 has no native env resource).
   *
   * ```ts
   * windows.env({ name: "EDITOR", value: "nvim" });
   * windows.env({ name: "OLD_VAR", ensure: "Absent" });
   * ```
   */
  env(arg: WinEnvSpec): ResourceHandle;

  /**
   * Ensure a directory is on the PATH, appending idempotently (the underlying
   * Environment resource de-duplicates). A specialized `env` for `Path`.
   *
   * ```ts
   * windows.path({ value: "%USERPROFILE%\\.local\\bin" });
   * ```
   */
  path(arg: WinPathSpec): ResourceHandle;
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
  dsc: (arg: WinDscSpec): ResourceHandle => {
    const resource = normalizeDsc(arg);
    const fragment: Fragment = { windows: { dsc: [resource] } };
    return asHandle(fragment, { kind: "dsc", token: resource.token! });
  },
  env: (arg: WinEnvSpec): ResourceHandle => {
    const resource = normalizeEnv(arg);
    const fragment: Fragment = { windows: { dsc: [resource] } };
    return asHandle(fragment, { kind: "dsc", token: resource.token! });
  },
  path: (arg: WinPathSpec): ResourceHandle => {
    const resource = normalizePath(arg);
    const fragment: Fragment = { windows: { dsc: [resource] } };
    return asHandle(fragment, { kind: "dsc", token: resource.token! });
  },
};
