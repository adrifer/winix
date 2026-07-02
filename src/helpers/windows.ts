// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment, ResourceHandle, ResourceRef } from "../core/types.ts";
import type {
  WinDscProperties,
  WinDscMetadata,
  WinDscResource,
  WinPackage,
  WinPackageSource,
  WinRawCommand,
  WinSettings,
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

/** Options for `windows.setting(...)`. */
export interface WinSettingOpts {
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/** Scope for Windows environment and PATH writes. */
export type WinEnvScope = "user" | "machine";

/** Options shared by `windows.env.*` and `windows.path.*` methods. */
export interface WinEnvOpts {
  scope?: WinEnvScope;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinFileEncoding = "utf8" | "utf8bom" | "ascii";

/** Options shared by `windows.file.*` methods. */
export interface WinFileOpts {
  force?: boolean;
  backup?: boolean;
  recursive?: boolean;
  elevate?: boolean;
  encoding?: WinFileEncoding;
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

/** Stamp internal typed-helper metadata without affecting public equality/YAML. */
function withDscMetadata(
  resource: WinDscResource,
  metadata: WinDscMetadata
): WinDscResource {
  Object.defineProperty(resource, "winix", {
    value: metadata,
    enumerable: false,
    configurable: true,
  });
  return resource;
}

const REGISTRY_RESOURCE = "Microsoft.Windows/Registry";
const WINDOWS_POWERSHELL_SCRIPT_RESOURCE =
  "Microsoft.DSC.Transitional/WindowsPowerShellScript";
const WINDOWS_SETTINGS_RESOURCE = "Microsoft.Windows.Settings/WindowsSettings";
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

const BOOLEAN_WINDOWS_SETTINGS = new Set([
  "DeveloperMode",
  "SetTimeZoneAutomatically",
  "EnableTransparency",
  "ShowAccentColorOnStartAndTaskbar",
  "ShowAccentColorOnTitleBarsAndWindowBorders",
  "AutoColorization",
  "ShowRecentList",
  "ShowRecommendedList",
  "TaskbarBadges",
  "DesktopTaskbarBadges",
  "TaskbarMultiMon",
  "DesktopTaskbarMultiMon",
  "NotifyOnUsbErrors",
  "NotifyOnWeakCharger",
]);
const COLOR_MODE_VALUES = ["Light", "Dark"] as const;
const TASKBAR_ALIGNMENT_VALUES = ["Left", "Center"] as const;
const TASKBAR_GROUPING_VALUES = ["Always", "WhenFull", "Never"] as const;
const TASKBAR_MULTI_MON_MODE_VALUES = ["Duplicate", "PrimaryAndWindow", "WindowOnly"] as const;
const START_FOLDER_VALUES = [
  "Documents",
  "Downloads",
  "Music",
  "Pictures",
  "Videos",
  "Network",
  "UserProfile",
  "Explorer",
  "Settings",
] as const;
const WINDOWS_SETTING_VALIDATORS: Record<string, (value: unknown, key: string) => WinDscProperties[string]> = {
  TaskbarAlignment: enumSettingValidator(TASKBAR_ALIGNMENT_VALUES),
  AppColorMode: enumSettingValidator(COLOR_MODE_VALUES),
  SystemColorMode: enumSettingValidator(COLOR_MODE_VALUES),
  TimeZone: stringSettingValidator,
  StartFolders: startFoldersSettingValidator,
  TaskbarGroupingMode: enumSettingValidator(TASKBAR_GROUPING_VALUES),
  TaskbarMultiMonMode: enumSettingValidator(TASKBAR_MULTI_MON_MODE_VALUES),
  DesktopTaskbarMultiMonMode: enumSettingValidator(TASKBAR_MULTI_MON_MODE_VALUES),
};
for (const key of BOOLEAN_WINDOWS_SETTINGS) {
  WINDOWS_SETTING_VALIDATORS[key] = booleanSettingValidator;
}

function supportedWindowsSettings(): string[] {
  return Object.keys(WINDOWS_SETTING_VALIDATORS).sort();
}

function booleanSettingValidator(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`windows.setting({ ${key} }) must be a boolean`);
  }
  return value;
}

function stringSettingValidator(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`windows.setting({ ${key} }) must be a non-empty string`);
  }
  return value;
}

function enumSettingValidator<T extends readonly string[]>(
  allowed: T
): (value: unknown, key: string) => T[number] {
  return (value, key) => {
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new Error(
        `windows.setting({ ${key} }) must be one of: ${allowed.join(", ")}`
      );
    }
    return value as T[number];
  };
}

function startFoldersSettingValidator(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(
      `windows.setting({ ${key} }) must be an array of: ${START_FOLDER_VALUES.join(", ")}`
    );
  }
  const invalid = value.find((entry) => !START_FOLDER_VALUES.includes(entry));
  if (invalid) {
    throw new Error(
      `windows.setting({ ${key} }) contains unsupported folder "${invalid}". ` +
        `Supported folders: ${START_FOLDER_VALUES.join(", ")}.`
    );
  }
  return value;
}

function normalizeSetting(
  settings: WinSettings,
  opts: WinSettingOpts | undefined
): WinDscResource {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("windows.setting(settings) requires a settings object");
  }
  if (opts !== undefined && (opts === null || typeof opts !== "object" || Array.isArray(opts))) {
    throw new Error("windows.setting options must be an object when provided");
  }

  const properties: WinDscProperties = {};
  for (const [key, value] of Object.entries(settings)) {
    const validator = WINDOWS_SETTING_VALIDATORS[key];
    if (!validator) {
      throw new Error(
        `windows.setting(...) does not support setting "${key}". ` +
        `Supported settings: ${supportedWindowsSettings().join(", ")}.`
      );
    }
    properties[key] = validator(value, key);
  }

  if (Object.keys(properties).length === 0) {
    throw new Error("windows.setting(settings) requires at least one supported setting");
  }

  const resource: WinDscResource = {
    resourceType: WINDOWS_SETTINGS_RESOURCE,
    name: "Windows Settings",
    properties,
    elevated: true,
  };
  const deps = resolveDependsOn(opts?.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscMetadata(withDscToken(resource), { kind: "setting" });
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
  scope: WinEnvScope;
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
  return withDscMetadata(withDscToken(resource), {
    kind: "env",
    action: opts.exists ? "set" : "remove",
    name: opts.valueName,
    value: opts.value,
    scope: opts.scope,
  });
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
    scope,
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
  return withDscMetadata(withDscToken(resource), {
    kind: "path",
    action: ensure === "Present" ? "add" : "remove",
    value,
    scope,
  });
}

function normalizeFileOpts(opts: WinFileOpts | undefined, helper: string): WinFileOpts {
  if (opts === undefined) return {};
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error(`${helper} options must be an object when provided`);
  }
  for (const key of ["force", "backup", "recursive", "elevate"] as const) {
    if (opts[key] !== undefined && typeof opts[key] !== "boolean") {
      throw new Error(`${helper} option "${key}" must be a boolean`);
    }
  }
  if (
    opts.encoding !== undefined &&
    opts.encoding !== "utf8" &&
    opts.encoding !== "utf8bom" &&
    opts.encoding !== "ascii"
  ) {
    throw new Error(
      `${helper} encoding "${opts.encoding}" is invalid; expected "utf8", "utf8bom", or "ascii"`
    );
  }
  return opts;
}

function fileDsc(
  name: string,
  properties: WinDscProperties,
  opts: WinFileOpts
): WinDscResource {
  const resource: WinDscResource = {
    resourceType: WINDOWS_POWERSHELL_SCRIPT_RESOURCE,
    name,
    properties,
  };
  const deps = resolveDependsOn(opts.dependsOn);
  if (deps) resource.dependsOn = deps;
  if (opts.elevate) resource.elevated = true;
  return withDscToken(resource);
}

function normalizeFileText(
  target: string,
  content: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.text");
  if (!target || typeof target !== "string") {
    throw new Error("windows.file.text(target) requires a non-empty target path");
  }
  if (typeof content !== "string") {
    throw new Error("windows.file.text(target, content) requires string content");
  }
  const encoding = normalizedOpts.encoding ?? "utf8";
  return fileDsc(
    `Write file ${target}`,
    buildFileTextScriptProperties({
      target,
      content,
      encoding,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  );
}

function normalizeFileSymlink(
  target: string,
  source: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.symlink");
  if (!target || typeof target !== "string") {
    throw new Error("windows.file.symlink(target) requires a non-empty target path");
  }
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.symlink(target, source) requires a non-empty source path");
  }
  return fileDsc(
    `Link file ${target}`,
    buildFileSymlinkScriptProperties({
      target,
      source,
      recursive: normalizedOpts.recursive ?? false,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  );
}

function normalizeFileCopy(
  target: string,
  source: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.copy");
  if (!target || typeof target !== "string") {
    throw new Error("windows.file.copy(target) requires a non-empty target path");
  }
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.copy(target, source) requires a non-empty source path");
  }
  return fileDsc(
    `Copy file ${target}`,
    buildFileCopyScriptProperties({
      target,
      source,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  );
}

function normalizeFileRemove(
  target: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.remove");
  if (!target || typeof target !== "string") {
    throw new Error("windows.file.remove(target) requires a non-empty target path");
  }
  return fileDsc(
    `Remove file ${target}`,
    buildFileRemoveScriptProperties({ target }),
    normalizedOpts
  );
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

function buildFileTextScriptProperties(opts: {
  target: string;
  content: string;
  encoding: WinFileEncoding;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = [
    `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
    `$content = ${psSingleQuoted(opts.content)}`,
    `$encoding = ${psSingleQuoted(opts.encoding)}`,
    `$force = ${psBoolean(opts.force)}`,
    `$backup = ${psBoolean(opts.backup)}`,
  ];
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::ReadAllText($target) } else { '' }",
    ].join("\n"),
    testScript: [
      ...fileTextPrelude(),
      ...vars,
      "$desired = Get-WinixTextBytes $content $encoding",
      "if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $false }",
      "$actual = [IO.File]::ReadAllBytes($target)",
      "Test-WinixBytesEqual $actual $desired",
    ].join("\n"),
    setScript: [
      ...fileTextPrelude(),
      ...vars,
      "$desired = Get-WinixTextBytes $content $encoding",
      "if (Test-Path -LiteralPath $target -PathType Leaf) {",
      "  $actual = [IO.File]::ReadAllBytes($target)",
      "  if (Test-WinixBytesEqual $actual $desired) { return }",
      "}",
      "Move-WinixExistingTarget $target $force $backup",
      "Ensure-WinixParentDirectory $target",
      "[IO.File]::WriteAllBytes($target, $desired)",
    ].join("\n"),
  };
}

function buildFileSymlinkScriptProperties(opts: {
  target: string;
  source: string;
  recursive: boolean;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = fileScriptVars({
    target: opts.target,
    source: opts.source,
    recursive: opts.recursive,
    force: opts.force,
    backup: opts.backup,
  });
  return {
    getScript: [
      ...fileSymlinkPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { (Get-Item -LiteralPath $target -Force).LinkType } else { '' }",
    ].join("\n"),
    testScript: [
      ...fileSymlinkPrelude(),
      ...vars,
      "if ($recursive) { Test-WinixRecursiveSymlink $source $target } else { Test-WinixSymlink $source $target }",
    ].join("\n"),
    setScript: [
      ...fileSymlinkPrelude(),
      ...vars,
      "Assert-WinixCanCreateSymlink",
      "if (-not (Test-Path -LiteralPath $source)) { throw \"Source path does not exist: $source\" }",
      "if ($recursive) {",
      "  Set-WinixRecursiveSymlink $source $target $force $backup",
      "} else {",
      "  Set-WinixSymlink $source $target $force $backup",
      "}",
    ].join("\n"),
  };
}

function buildFileCopyScriptProperties(opts: {
  target: string;
  source: string;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = fileScriptVars({
    target: opts.target,
    source: opts.source,
    force: opts.force,
    backup: opts.backup,
  });
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { $target } else { '' }",
    ].join("\n"),
    testScript: [
      ...fileCopyPrelude(),
      ...vars,
      "Test-WinixCopy $source $target",
    ].join("\n"),
    setScript: [
      ...fileCopyPrelude(),
      ...vars,
      "if (-not (Test-Path -LiteralPath $source)) { throw \"Source path does not exist: $source\" }",
      "if (Test-WinixCopy $source $target) { return }",
      "Move-WinixExistingTarget $target $force $backup",
      "Ensure-WinixParentDirectory $target",
      "if (Test-Path -LiteralPath $source -PathType Container) {",
      "  New-Item -ItemType Directory -Force -Path $target | Out-Null",
      "  Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force",
      "} else {",
      "  Copy-Item -LiteralPath $source -Destination $target -Force",
      "}",
    ].join("\n"),
  };
}

function buildFileRemoveScriptProperties(opts: { target: string }): WinDscProperties {
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { $target } else { '' }",
    ].join("\n"),
    testScript: [
      ...filePathPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "-not (Test-Path -LiteralPath $target)",
    ].join("\n"),
    setScript: [
      ...filePathPrelude(),
      `$target = Expand-WinixPath ${psSingleQuoted(opts.target)}`,
      "if (-not (Test-Path -LiteralPath $target)) { return }",
      "$item = Get-Item -LiteralPath $target -Force",
      "if ($item.PSIsContainer -and $null -eq $item.LinkType) {",
      "  throw \"Refusing to remove real directory: $target\"",
      "}",
      "Remove-Item -LiteralPath $target -Force",
    ].join("\n"),
  };
}

function fileScriptVars(values: Record<string, string | boolean>): string[] {
  return Object.entries(values).map(([name, value]) =>
    typeof value === "boolean"
      ? `$${name} = ${psBoolean(value)}`
      : `$${name} = Expand-WinixPath ${psSingleQuoted(value)}`
  );
}

function filePathPrelude(): string[] {
  return [
    "function Expand-WinixPath([string]$Path) { [Environment]::ExpandEnvironmentVariables($Path) }",
  ];
}

function fileTextPrelude(): string[] {
  return [
    ...filePathPrelude(),
    "function Ensure-WinixParentDirectory([string]$Path) {",
    "  $parent = Split-Path -Parent $Path",
    "  if (-not [string]::IsNullOrEmpty($parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }",
    "}",
    "function Test-WinixBytesEqual([byte[]]$Actual, [byte[]]$Desired) {",
    "  if ($Actual.Length -ne $Desired.Length) { return $false }",
    "  for ($i = 0; $i -lt $Actual.Length; $i++) { if ($Actual[$i] -ne $Desired[$i]) { return $false } }",
    "  return $true",
    "}",
    "function Get-WinixTextBytes([string]$Content, [string]$EncodingName) {",
    "  if ($EncodingName -eq 'ascii') { return [byte[]][Text.Encoding]::ASCII.GetBytes($Content) }",
    "  $encoder = [Text.UTF8Encoding]::new($EncodingName -eq 'utf8bom')",
    "  return [byte[]]($encoder.GetPreamble() + $encoder.GetBytes($Content))",
    "}",
    ...fileMoveTargetPrelude(),
  ];
}

function fileMoveTargetPrelude(): string[] {
  return [
    "function Move-WinixExistingTarget([string]$Path, [bool]$Force, [bool]$Backup) {",
    "  if (-not (Test-Path -LiteralPath $Path)) { return }",
    "  if ($Backup) {",
    "    $backupPath = \"$Path.bak\"",
    "    if (Test-Path -LiteralPath $backupPath) { throw \"Backup target already exists: $backupPath\" }",
    "    Move-Item -LiteralPath $Path -Destination $backupPath",
    "    return",
    "  }",
    "  if (-not $Force) { throw \"Target already exists and differs: $Path. Pass force: true or backup: true.\" }",
    "  $item = Get-Item -LiteralPath $Path -Force",
    "  if ($item.PSIsContainer -and $null -eq $item.LinkType) {",
    "    $children = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)",
    "    if ($children.Count -gt 0) { throw \"Refusing to delete populated directory: $Path. Move it manually or use backup: true.\" }",
    "  }",
    "  Remove-Item -LiteralPath $Path -Force -Recurse",
    "}",
  ];
}

function fileSymlinkPrelude(): string[] {
  return [
    ...filePathPrelude(),
    "function Ensure-WinixParentDirectory([string]$Path) {",
    "  $parent = Split-Path -Parent $Path",
    "  if (-not [string]::IsNullOrEmpty($parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }",
    "}",
    ...fileMoveTargetPrelude(),
    "function Test-WinixSymlink([string]$Source, [string]$Target) {",
    "  if (-not (Test-Path -LiteralPath $Target)) { return $false }",
    "  $item = Get-Item -LiteralPath $Target -Force",
    "  ($item.LinkType -eq 'SymbolicLink') -and [string]::Equals([string]$item.Target, $Source, [StringComparison]::OrdinalIgnoreCase)",
    "}",
    "function Invoke-WinixMklink([string]$Source, [string]$Target) {",
    "  Ensure-WinixParentDirectory $Target",
    "  $isDirectory = Test-Path -LiteralPath $Source -PathType Container",
    "  $flag = if ($isDirectory) { '/D ' } else { '' }",
    "  & $env:ComSpec /c \"mklink $flag`\"$Target`\" `\"$Source`\"\"",
    "  if ($LASTEXITCODE -ne 0) { throw \"mklink failed with exit code $LASTEXITCODE\" }",
    "}",
    "function Set-WinixSymlink([string]$Source, [string]$Target, [bool]$Force, [bool]$Backup) {",
    "  if (Test-WinixSymlink $Source $Target) { return }",
    "  Move-WinixExistingTarget $Target $Force $Backup",
    "  Invoke-WinixMklink $Source $Target",
    "}",
    "function Get-WinixRelativePath([string]$Root, [string]$Path) {",
    "  $prefix = $Root.TrimEnd('\\') + '\\'",
    "  $Path.Substring($prefix.Length)",
    "}",
    "function Test-WinixRecursiveSymlink([string]$Source, [string]$Target) {",
    "  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return $false }",
    "  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { return $false }",
    "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
    "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
    "    $relative = Get-WinixRelativePath $root $dir.FullName",
    "    if (-not (Test-Path -LiteralPath (Join-Path $Target $relative) -PathType Container)) { return $false }",
    "  }",
    "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
    "    $relative = Get-WinixRelativePath $root $file.FullName",
    "    if (-not (Test-WinixSymlink $file.FullName (Join-Path $Target $relative))) { return $false }",
    "  }",
    "  return $true",
    "}",
    "function Set-WinixRecursiveSymlink([string]$Source, [string]$Target, [bool]$Force, [bool]$Backup) {",
    "  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw \"Recursive symlink source must be a directory: $Source\" }",
    "  if (Test-WinixRecursiveSymlink $Source $Target) { return }",
    "  Move-WinixExistingTarget $Target $Force $Backup",
    "  New-Item -ItemType Directory -Force -Path $Target | Out-Null",
    "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
    "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
    "    New-Item -ItemType Directory -Force -Path (Join-Path $Target (Get-WinixRelativePath $root $dir.FullName)) | Out-Null",
    "  }",
    "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
    "    Set-WinixSymlink $file.FullName (Join-Path $Target (Get-WinixRelativePath $root $file.FullName)) $Force $Backup",
    "  }",
    "}",
    "function Assert-WinixCanCreateSymlink {",
    "  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()",
    "  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }",
    "  $devMode = Get-ItemPropertyValue -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue",
    "  if ($devMode -eq 1) { return }",
    "  throw 'Creating Windows symlinks requires elevation or Developer Mode. Enable Developer Mode in Windows Settings, or pass elevate: true.'",
    "}",
  ];
}

function fileCopyPrelude(): string[] {
  return [
    ...fileTextPrelude(),
    "function Get-WinixRelativePath([string]$Root, [string]$Path) {",
    "  $prefix = $Root.TrimEnd('\\') + '\\'",
    "  $Path.Substring($prefix.Length)",
    "}",
    "function Test-WinixCopy([string]$Source, [string]$Target) {",
    "  if (-not (Test-Path -LiteralPath $Source) -or -not (Test-Path -LiteralPath $Target)) { return $false }",
    "  if (Test-Path -LiteralPath $Source -PathType Leaf) {",
    "    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { return $false }",
    "    return Test-WinixBytesEqual ([IO.File]::ReadAllBytes($Target)) ([IO.File]::ReadAllBytes($Source))",
    "  }",
    "  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { return $false }",
    "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
    "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
    "    if (-not (Test-Path -LiteralPath (Join-Path $Target (Get-WinixRelativePath $root $dir.FullName)) -PathType Container)) { return $false }",
    "  }",
    "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
    "    $targetFile = Join-Path $Target (Get-WinixRelativePath $root $file.FullName)",
    "    if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { return $false }",
    "    if (-not (Test-WinixBytesEqual ([IO.File]::ReadAllBytes($targetFile)) ([IO.File]::ReadAllBytes($file.FullName)))) { return $false }",
    "  }",
    "  return $true",
    "}",
  ];
}

function psBoolean(value: boolean): string {
  return value ? "$true" : "$false";
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

export interface WinFileNamespace {
  text(target: string, content: string, opts?: WinFileOpts): ResourceHandle;
  symlink(target: string, source: string, opts?: WinFileOpts): ResourceHandle;
  copy(target: string, source: string, opts?: WinFileOpts): ResourceHandle;
  remove(target: string, opts?: WinFileOpts): ResourceHandle;
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
   * Manage Windows OS settings through the native
   * `Microsoft.Windows.Settings/WindowsSettings` DSC resource. The emitter
   * automatically ensures the required `Microsoft.Windows.Settings` module is
   * installed and wires settings resources to depend on it.
   *
   * ```ts
   * windows.setting({ DeveloperMode: true });
   * windows.setting({ SystemColorMode: "Dark", TaskbarAlignment: "Left" });
   * ```
   */
  setting(settings: WinSettings, opts?: WinSettingOpts): ResourceHandle;

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

  /**
   * Manage files, copies, and dotfile symlinks declaratively via an idempotent
   * `Microsoft.DSC.Transitional/WindowsPowerShellScript` resource.
   *
   * ```ts
   * windows.file.text("%USERPROFILE%\\.gitconfig", "[user]\n");
   * windows.file.symlink("%LOCALAPPDATA%\\nvim", "%USERPROFILE%\\dotfiles\\nvim");
   * windows.file.copy("%APPDATA%\\tool\\config.json", ".\\config.json");
   * windows.file.remove("%USERPROFILE%\\.oldrc");
   * ```
   */
  file: WinFileNamespace;
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
  setting: (settings: WinSettings, opts?: WinSettingOpts): ResourceHandle =>
    dscHandle(normalizeSetting(settings, opts)),
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
  file: {
    text: (target: string, content: string, opts?: WinFileOpts): ResourceHandle =>
      dscHandle(normalizeFileText(target, content, opts)),
    symlink: (target: string, source: string, opts?: WinFileOpts): ResourceHandle =>
      dscHandle(normalizeFileSymlink(target, source, opts)),
    copy: (target: string, source: string, opts?: WinFileOpts): ResourceHandle =>
      dscHandle(normalizeFileCopy(target, source, opts)),
    remove: (target: string, opts?: WinFileOpts): ResourceHandle =>
      dscHandle(normalizeFileRemove(target, opts)),
  },
};
