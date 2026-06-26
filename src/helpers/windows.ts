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
   * an array of handles returned by resource-producing `windows.*` helpers.
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

/** Scope for Windows environment and PATH writes. */
export type WinEnvScope = "user" | "machine";

/** Options shared by `windows.env.*` and `windows.path.*` methods. */
export interface WinEnvOpts {
  scope?: WinEnvScope;
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
        "resource-producing windows.* helpers. Got a value without a " +
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

const REGISTRY_RESOURCE = "Microsoft.Windows/Registry";
const WINDOWS_POWERSHELL_SCRIPT_RESOURCE =
  "Microsoft.DSC.Transitional/WindowsPowerShellScript";
const USER_ENV_KEY_PATH = "HKCU\\Environment";
const MACHINE_ENV_KEY_PATH =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const USER_ENV_REGISTRY_PATH = "HKCU:\\Environment";
const MACHINE_ENV_REGISTRY_PATH =
  "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

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

function normalizeEnvOpts(opts: WinEnvOpts | undefined, helper: string): WinEnvOpts | undefined {
  if (opts === undefined) return undefined;
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error(`${helper} options must be an object when provided`);
  }
  if (
    opts.scope !== undefined &&
    opts.scope !== "user" &&
    opts.scope !== "machine"
  ) {
    throw new Error(
      `${helper} scope "${opts.scope}" is invalid; expected "user" or "machine"`
    );
  }
  return opts;
}

function envScope(opts: WinEnvOpts | undefined): WinEnvScope {
  return opts?.scope ?? "user";
}

function envKeyPath(scope: WinEnvScope): string {
  return scope === "machine" ? MACHINE_ENV_KEY_PATH : USER_ENV_KEY_PATH;
}

function envRegistryPath(scope: WinEnvScope): string {
  return scope === "machine" ? MACHINE_ENV_REGISTRY_PATH : USER_ENV_REGISTRY_PATH;
}

function envTarget(scope: WinEnvScope): "User" | "Machine" {
  return scope === "machine" ? "Machine" : "User";
}

function registryDsc(opts: {
  name: string;
  keyPath: string;
  valueName: string;
  value?: string;
  exists: boolean;
  dependsOn?: ResourceRef[];
}): WinDscResource {
  const properties: WinDscProperties = {
    keyPath: opts.keyPath,
    valueName: opts.valueName,
    _exist: opts.exists,
  };
  if (opts.exists) {
    properties.valueData = { String: opts.value ?? "" };
  }
  const resource: WinDscResource = {
    resourceType: REGISTRY_RESOURCE,
    name: opts.name,
    properties,
  };
  if (opts.dependsOn) resource.dependsOn = opts.dependsOn;
  return withDscToken(resource);
}

function normalizeEnv(
  name: string,
  ensure: "Present" | "Absent",
  value: string | undefined,
  opts: WinEnvOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeEnvOpts(opts, "windows.env.*");
  if (!name || typeof name !== "string") {
    throw new Error("windows.env.*(name) requires a non-empty variable name");
  }
  if (ensure === "Present" && (value === undefined || typeof value !== "string")) {
    throw new Error(`windows.env.set("${name}", value) requires a string value`);
  }
  const scope = envScope(normalizedOpts);
  return registryDsc({
    name: ensure === "Present" ? `Set ${name}` : `Remove ${name}`,
    keyPath: envKeyPath(scope),
    valueName: name,
    value,
    exists: ensure === "Present",
    dependsOn: resolveDependsOn(normalizedOpts?.dependsOn),
  });
}

function normalizePath(
  value: string,
  ensure: "Present" | "Absent",
  opts: WinEnvOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeEnvOpts(opts, "windows.path.*");
  if (!value || typeof value !== "string") {
    throw new Error("windows.path.*(value) requires a non-empty directory");
  }
  const scope = envScope(normalizedOpts);
  const resource: WinDscResource = {
    resourceType: WINDOWS_POWERSHELL_SCRIPT_RESOURCE,
    name: `${ensure === "Present" ? "Add" : "Remove"} ${value} ${
      ensure === "Present" ? "to" : "from"
    } PATH`,
    properties: buildPathScriptProperties({
      dir: value,
      scope,
      action: ensure === "Present" ? "add" : "remove",
    }),
  };
  const deps = resolveDependsOn(normalizedOpts?.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscToken(resource);
}

function buildPathScriptProperties(opts: {
  dir: string;
  scope: WinEnvScope;
  action: "add" | "remove";
}): WinDscProperties {
  const registryPath = envRegistryPath(opts.scope);
  const target = envTarget(opts.scope);
  const quotedDir = psSingleQuoted(opts.dir);
  const quotedRegistryPath = psSingleQuoted(registryPath);
  const quotedTarget = psSingleQuoted(target);
  const presentCheck =
    opts.action === "add"
      ? "$entries -contains $dir"
      : "-not ($entries -contains $dir)";

  return {
    getScript: [
      `$registryPath = ${quotedRegistryPath}`,
      "Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
    ].join("\n"),
    testScript: [
      `$dir = ${quotedDir}`,
      `$registryPath = ${quotedRegistryPath}`,
      "$current = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "$entries = if ([string]::IsNullOrEmpty($current)) { @() } else { $current -split ';' }",
      presentCheck,
    ].join("\n"),
    setScript: [
      `$dir = ${quotedDir}`,
      `$registryPath = ${quotedRegistryPath}`,
      `$target = ${quotedTarget}`,
      "$key = Get-Item -Path $registryPath",
      "$originalKind = $null",
      "try { $originalKind = $key.GetValueKind('Path') } catch { $originalKind = $null }",
      "$current = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "$entries = if ([string]::IsNullOrEmpty($current)) { @() } else { $current -split ';' }",
      ...(opts.action === "add"
        ? [
            "if ($entries -notcontains $dir) {",
            "  $new = if ([string]::IsNullOrEmpty($current)) { $dir } else { \"$current;$dir\" }",
            "  [Environment]::SetEnvironmentVariable('Path', $new, $target)",
            "}",
          ]
        : [
            "if ($entries -contains $dir) {",
            "  $new = ($entries | Where-Object { $_ -ne $dir }) -join ';'",
            "  [Environment]::SetEnvironmentVariable('Path', $new, $target)",
            "}",
          ]),
      "$afterKey = Get-Item -Path $registryPath",
      "$afterValue = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "if ($originalKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString -and $afterKey.GetValueKind('Path') -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {",
      "  Set-ItemProperty -Path $registryPath -Name 'Path' -Value $afterValue -Type ExpandString",
      "}",
    ].join("\n"),
  };
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface WinEnvNamespace {
  set(name: string, value: string, opts?: WinEnvOpts): ResourceHandle;
  remove(name: string, opts?: WinEnvOpts): ResourceHandle;
}

export interface WinPathNamespace {
  add(value: string, opts?: WinEnvOpts): ResourceHandle;
  remove(value: string, opts?: WinEnvOpts): ResourceHandle;
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
   * for.
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
   * Manage a user/machine environment variable declaratively via the native
   * `Microsoft.Windows/Registry` DSC resource.
   *
   * ```ts
   * windows.env.set("EDITOR", "nvim");
   * windows.env.remove("OLD_VAR");
   * ```
   */
  env: WinEnvNamespace;

  /**
   * Ensure a directory is on the PATH, appending/removing surgically via an
   * idempotent `Microsoft.DSC.Transitional/WindowsPowerShellScript` resource.
   *
   * ```ts
   * windows.path.add("%USERPROFILE%\\.local\\bin");
   * windows.path.remove("%USERPROFILE%\\.old-bin");
   * ```
   */
  path: WinPathNamespace;
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

function dscHandle(resource: WinDscResource): ResourceHandle {
  const fragment: Fragment = { windows: { dsc: [resource] } };
  return asHandle(fragment, { kind: "dsc", token: resource.token! });
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
  env: {
    set: (name: string, value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizeEnv(name, "Present", value, opts)),
    remove: (name: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizeEnv(name, "Absent", undefined, opts)),
  },
  path: {
    add: (value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizePath(value, "Present", opts)),
    remove: (value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizePath(value, "Absent", opts)),
  },
};
