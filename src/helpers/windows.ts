// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment, ResourceHandle, ResourceRef } from "../core/types.ts";
import { resolve, win32, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { powerShellLiteral as psSingleQuoted } from "./utils.ts";
import type {
  WinDscProperties,
  WinDscMetadata,
  WinDscResource,
  WinPackage,
  WinPackageSource,
  WinRawCommand,
  WinSettings,
  WinFilePath,
  WinKnownFolder,
  WinKnownFolderName,
  WinStartupCommand,
  WinWslConfig,
  WinWslDistro,
  WinWslSetup,
  WinPowerShellRepositoryPolicy,
} from "../types/index.ts";
import { validatePowerShellRepositoryPolicy } from "./windows-repositories.ts";

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

export interface WinPowerShellModuleOpts {
  /** Registered repository; inherits the host policy, otherwise PSGallery. */
  repository?: string;
  /** Include prereleases during lock resolution. Defaults to stable releases only. */
  prerelease?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinStartupCommandSpec extends WinStartupCommand {
  backup?: boolean;
  force?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinStartupNamespace {
  command(name: string, spec: WinStartupCommandSpec): ResourceHandle;
}

export interface WinOptionalFeatureOpts {
  enabled?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinWslDistroSpec extends Omit<WinWslDistro, "name" | "default"> {
  default?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinWslOpts extends Pick<WinFileOpts, "backup" | "force" | "dependsOn"> {
  config?: WinWslConfig;
}

export interface WinWslNamespace {
  /** Declare the locked Microsoft.WSL package, required features, and optional .wslconfig. */
  (opts?: WinWslOpts): ResourceHandle;
  /** Create an absent distro or adopt a matching WSL 2/NixOS/Linux hostname registration. */
  distro(name: string, spec: WinWslDistroSpec): ResourceHandle;
}

const KNOWN_FOLDERS = {
  documents: "MyDocuments",
  desktop: "Desktop",
  localAppData: "LocalApplicationData",
  appData: "ApplicationData",
  userProfile: "UserProfile",
} as const;

function knownFolder(folder: WinKnownFolderName, path = ""): WinKnownFolder {
  if (!Object.hasOwn(KNOWN_FOLDERS, folder)) {
    throw new Error(`Unknown Windows known folder "${folder}"`);
  }
  if (typeof path !== "string" || win32.isAbsolute(path) || /^[a-z]:/i.test(path) ||
      path.split(/[\\/]/).includes("..")) {
    throw new Error("windows.knownFolder path must be relative and cannot contain '..'");
  }
  return { kind: "knownFolder", folder, path };
}

function validFilePath(value: WinFilePath): boolean {
  if (typeof value === "string") return value.length > 0;
  if (!value || value.kind !== "knownFolder") return false;
  knownFolder(value.folder, value.path);
  return true;
}

function filePathLabel(value: WinFilePath): string {
  return typeof value === "string" ? value : `${value.folder}\\${value.path}`;
}

export function filePathExpression(value: WinFilePath): string {
  if (typeof value === "string") return `Expand-WinixPath ${psSingleQuoted(value)}`;
  const folder = psSingleQuoted(KNOWN_FOLDERS[value.folder]);
  return `& { $root = [Environment]::GetFolderPath(${folder}); ` +
    `if ([string]::IsNullOrWhiteSpace($root)) { throw 'Windows known folder is unavailable: ${value.folder}' }; ` +
    (value.path ? `Join-Path $root ${psSingleQuoted(value.path)}` : "$root") + " }";
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
      executable: "pwsh",
      arguments: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", arg],
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
const POWERSHELL_SCRIPT_RESOURCE =
  "Microsoft.DSC.Transitional/PowerShellScript";
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
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
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

function scriptDsc(
  name: string,
  properties: WinDscProperties,
  opts: WinFileOpts
): WinDscResource {
  const resource: WinDscResource = {
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
    name,
    properties,
  };
  const deps = resolveDependsOn(opts.dependsOn);
  if (deps) resource.dependsOn = deps;
  if (opts.elevate) resource.elevated = true;
  return withDscToken(resource);
}

function normalizeFileText(
  target: WinFilePath,
  content: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.text");
  if (!validFilePath(target)) {
    throw new Error("windows.file.text(target) requires a non-empty target path");
  }
  if (typeof content !== "string") {
    throw new Error("windows.file.text(target, content) requires string content");
  }
  const encoding = normalizedOpts.encoding ?? "utf8";
  return withFileMetadata(scriptDsc(
    `Write file ${filePathLabel(target)}`,
    buildFileTextScriptProperties({
      target,
      content,
      encoding,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "text", target, normalizedOpts, undefined, content);
}

function normalizeFileSymlink(
  target: WinFilePath,
  source: string | URL,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.symlink");
  if (!validFilePath(target)) {
    throw new Error("windows.file.symlink(target) requires a non-empty target path");
  }
  source = source instanceof URL ? fileURLToPath(source) : source;
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.symlink(target, source) requires a non-empty source path");
  }
  return withFileMetadata(scriptDsc(
    `Link file ${filePathLabel(target)}`,
    buildFileSymlinkScriptProperties({
      target,
      source,
      recursive: normalizedOpts.recursive ?? false,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "symlink", target, normalizedOpts, source);
}

function normalizeFileCopy(
  target: WinFilePath,
  source: string | URL,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.copy");
  if (!validFilePath(target)) {
    throw new Error("windows.file.copy(target) requires a non-empty target path");
  }
  source = source instanceof URL ? fileURLToPath(source) : source;
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.copy(target, source) requires a non-empty source path");
  }
  return withFileMetadata(scriptDsc(
    `Copy file ${filePathLabel(target)}`,
    buildFileCopyScriptProperties({
      target,
      source,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "copy", target, normalizedOpts, source);
}

function normalizeFileRemove(
  target: WinFilePath,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.remove");
  if (!validFilePath(target)) {
    throw new Error("windows.file.remove(target) requires a non-empty target path");
  }
  return withFileMetadata(scriptDsc(
    `Remove file ${filePathLabel(target)}`,
    buildFileRemoveScriptProperties({ target }),
    normalizedOpts
  ), "remove", target, normalizedOpts);
}

function withFileMetadata(
  resource: WinDscResource,
  action: "text" | "symlink" | "copy" | "remove",
  target: WinFilePath,
  opts: WinFileOpts,
  source?: string,
  content?: string
): WinDscResource {
  return withDscMetadata(resource, {
    kind: "file", action, target, source, content,
    encoding: opts.encoding ?? "utf8",
    force: opts.force ?? false,
    backup: opts.backup ?? false,
    recursive: opts.recursive ?? false,
  });
}

/** Rebuild scripts after the emitter supplies the config directory. */
export function resolveWindowsFileProperties(
  resource: WinDscResource,
  configDir?: string,
  sourcePath: (path: string) => string = (path) => path
): WinDscProperties | undefined {
  const file = resource.winix;
  if (file?.kind !== "file") return resource.properties;
  let source = file.source;
  if (source !== undefined && !/%[^%]+%/.test(source) &&
      !win32.isAbsolute(source) && !posix.isAbsolute(source)) {
    if (!configDir) throw new Error("Relative Windows file sources require a configDir when calling generateWindows.");
    if (/^[a-z]:/i.test(source)) throw new Error(`Drive-relative Windows source is ambiguous: ${source}`);
    source = /^[a-z]:[\\/]|^[\\/]{2}/i.test(configDir)
      ? win32.resolve(configDir, source)
      : posix.isAbsolute(configDir)
        ? posix.resolve(configDir, source.replaceAll("\\", "/"))
        : resolve(configDir, source);
  }
  if (source !== undefined && !/%[^%]+%/.test(source)) source = sourcePath(source);
  switch (file.action) {
    case "text": return buildFileTextScriptProperties({ ...file, content: file.content! });
    case "remove": return buildFileRemoveScriptProperties(file);
    case "symlink": return buildFileSymlinkScriptProperties({ ...file, source: source! });
    case "copy": return buildFileCopyScriptProperties({ ...file, source: source! });
  }
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
  target: WinFilePath;
  content: string;
  encoding: WinFileEncoding;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = [
    `$target = ${filePathExpression(opts.target)}`,
    `$content = ${psSingleQuoted(opts.content)}`,
    `$encoding = ${psSingleQuoted(opts.encoding)}`,
    `$force = ${psBoolean(opts.force)}`,
    `$backup = ${psBoolean(opts.backup)}`,
  ];
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
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
  target: WinFilePath;
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
      `$target = ${filePathExpression(opts.target)}`,
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
  target: WinFilePath;
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
      `$target = ${filePathExpression(opts.target)}`,
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

function buildFileRemoveScriptProperties(opts: { target: WinFilePath }): WinDscProperties {
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { $target } else { '' }",
    ].join("\n"),
    testScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "-not (Test-Path -LiteralPath $target)",
    ].join("\n"),
    setScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (-not (Test-Path -LiteralPath $target)) { return }",
      "$item = Get-Item -LiteralPath $target -Force",
      "if ($item.PSIsContainer -and $null -eq $item.LinkType) {",
      "  throw \"Refusing to remove real directory: $target\"",
      "}",
      "Remove-Item -LiteralPath $target -Force",
    ].join("\n"),
  };
}

function fileScriptVars(values: Record<string, WinFilePath | boolean>): string[] {
  return Object.entries(values).map(([name, value]) =>
    typeof value === "boolean"
      ? `$${name} = ${psBoolean(value)}`
      : `$${name} = ${filePathExpression(value)}`
  );
}

export function filePathPrelude(): string[] {
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

function normalizeStartupCommand(name: string, spec: WinStartupCommandSpec): WinDscResource {
  const helper = "windows.startup.command";
  if (typeof name !== "string" || !name.trim() || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.length > 251) {
    throw new Error(`${helper} requires a valid shortcut name without path separators or reserved Windows names`);
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`${helper} requires a command specification`);
  }
  normalizeFileOpts(spec, helper);
  for (const [key, value] of [
    ["executable", spec.executable],
    ["workingDirectory", spec.workingDirectory ?? knownFolder("userProfile")],
  ] as const) {
    if (!validFilePath(value) || /\0/.test(filePathLabel(value))) {
      throw new Error(`${helper} ${key} requires a non-empty path or application name`);
    }
  }
  if (spec.arguments !== undefined && (!Array.isArray(spec.arguments) || spec.arguments.some(
    (value) => (typeof value !== "string" && !validFilePath(value)) || /\0/.test(filePathLabel(value))
  ))) {
    throw new Error(`${helper} arguments must be strings or known-folder paths without null characters`);
  }
  const styles = { normal: 1, minimized: 7, maximized: 3 } as const;
  const style = spec.windowStyle ?? "normal";
  if (!Object.hasOwn(styles, style)) {
    throw new Error(`${helper} windowStyle must be normal, minimized, or maximized`);
  }
  const args = (spec.arguments ?? []).map((value) =>
    typeof value === "string" ? psSingleQuoted(value) : `(${filePathExpression(value)})`
  );
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    ...filePathPrelude(),
    ...fileMoveTargetPrelude(),
    String.raw`function ConvertTo-WinixArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}`,
    "$startup = [Environment]::GetFolderPath('Startup')",
    "if ([string]::IsNullOrWhiteSpace($startup)) { throw 'Windows Startup folder is unavailable' }",
    `$target = Join-Path $startup ${psSingleQuoted(`${name}.lnk`)}`,
    `$executable = ${filePathExpression(spec.executable)}`,
    String.raw`if ($executable -notmatch '[/\\:]') {`,
    "  $commands = @(Get-Command -Name $executable -CommandType Application -ErrorAction Stop)",
    "  if ($commands.Count -ne 1) { throw \"Startup application name is ambiguous: $executable\" }",
    "  $executable = $commands[0].Source",
    "}",
    "if (-not [IO.Path]::IsPathFullyQualified($executable)) { throw \"Startup executable must be an absolute path or application name: $executable\" }",
    "if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw \"Startup executable is missing: $executable\" }",
    "$executable = (Resolve-Path -LiteralPath $executable).ProviderPath",
    `$workingDirectory = ${filePathExpression(spec.workingDirectory ?? knownFolder("userProfile"))}`,
    "if (-not [IO.Path]::IsPathFullyQualified($workingDirectory) -or -not (Test-Path -LiteralPath $workingDirectory -PathType Container)) { throw \"Startup working directory must be an existing absolute directory: $workingDirectory\" }",
    "$workingDirectory = (Resolve-Path -LiteralPath $workingDirectory).ProviderPath",
    `$arguments = (@(${args.join(", ")}) | ForEach-Object { ConvertTo-WinixArgument $_ }) -join ' '`,
    `$windowStyle = ${styles[style]}`,
    // WScript.Shell uses ANSI for shortcut arguments; Shell.Application preserves Unicode.
    "$shell = New-Object -ComObject Shell.Application",
    "function Get-WinixStartupLink([string]$Path) {",
    "  $folder = $shell.NameSpace((Split-Path -Parent $Path))",
    "  if ($null -eq $folder) { throw \"Unable to read shortcut directory: $Path\" }",
    "  $item = $folder.ParseName((Split-Path -Leaf $Path))",
    "  if ($null -eq $item) { throw \"Unable to read shortcut: $Path\" }",
    "  return $item.GetLink()",
    "}",
    "function Test-WinixStartup([string]$Path = $target) {",
    "  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }",
    "  $link = Get-WinixStartupLink $Path",
    "  return $link.Path -ieq $executable -and $link.Arguments -ceq $arguments -and $link.WorkingDirectory -ieq $workingDirectory -and $link.ShowCommand -eq $windowStyle",
    "}",
  ];
  return withDscMetadata(scriptDsc(`Startup ${name}`, {
    getScript: [...prelude, "@{ Path = $target; InDesiredState = (Test-WinixStartup) }"].join("\n"),
    testScript: [...prelude, "Test-WinixStartup"].join("\n"),
    setScript: [
      ...prelude,
      "if (Test-WinixStartup) { return }",
      "$stagingDirectory = Join-Path ([IO.Path]::GetTempPath()) ('winix-startup-' + [guid]::NewGuid().ToString('N'))",
      "[IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null",
      "try {",
      "  $stagingPath = Join-Path $stagingDirectory 'shortcut.lnk'",
      "  $seed = (New-Object -ComObject WScript.Shell).CreateShortcut($stagingPath)",
      "  $seed.TargetPath = $env:ComSpec",
      "  $seed.Save()",
      "  $link = Get-WinixStartupLink $stagingPath",
      "  $link.Path = $executable",
      "  $link.Arguments = $arguments",
      "  $link.WorkingDirectory = $workingDirectory",
      "  $link.ShowCommand = $windowStyle",
      "  $link.Save()",
      "  if (-not (Test-WinixStartup $stagingPath)) { throw \"Startup shortcut verification failed: $stagingPath\" }",
      "  [IO.Directory]::CreateDirectory($startup) | Out-Null",
      `  Move-WinixExistingTarget $target ${psBoolean(spec.force ?? false)} ${psBoolean(spec.backup ?? false)}`,
      "  Move-Item -LiteralPath $stagingPath -Destination $target",
      "} finally { Remove-Item -LiteralPath $stagingDirectory -Recurse -Force }",
      "if (-not (Test-WinixStartup)) { throw \"Startup shortcut verification failed: $target\" }",
    ].join("\n"),
  }, spec), { kind: "startup", name });
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
  text(target: WinFilePath, content: string, opts?: WinFileOpts): ResourceHandle;
  symlink(target: WinFilePath, source: string | URL, opts?: WinFileOpts): ResourceHandle;
  copy(target: WinFilePath, source: string | URL, opts?: WinFileOpts): ResourceHandle;
  remove(target: WinFilePath, opts?: WinFileOpts): ResourceHandle;
}

export interface WindowsHelper {
  optionalFeature(name: string, opts?: WinOptionalFeatureOpts): ResourceHandle;
  wsl: WinWslNamespace;
  /** Manage named current-user Startup shortcuts without running the commands during apply. */
  startup: WinStartupNamespace;
  /** Resolve a user folder on the target machine during activation. */
  knownFolder: {
    [Folder in WinKnownFolderName]: (path?: string) => WinKnownFolder;
  };
  powershell: {
    /** Select and optionally restrict feeds for Winix-managed modules on this host. */
    repositories(policy: WinPowerShellRepositoryPolicy): Fragment;
    /** Install a current-user PowerShell 7 module using winix-windows.lock. */
    module(name: string, opts?: WinPowerShellModuleOpts): ResourceHandle;
  };
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
   * Command strings run in PowerShell 7 (`pwsh`); explicit executables are preserved.
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
   * idempotent `Microsoft.DSC.Transitional/PowerShellScript` resource.
   *
   * ```ts
   * windows.path.add("%USERPROFILE%\\.local\\bin");
   * windows.path.remove("%USERPROFILE%\\.old-bin");
   * ```
   */
  path: WinPathNamespace;

  /**
   * Manage files, copies, and dotfile symlinks declaratively via an idempotent
   * `Microsoft.DSC.Transitional/PowerShellScript` resource.
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
  optionalFeature: (name, opts = {}) => optionalFeatures([name], opts),
  wsl: Object.assign(
    (opts: WinWslOpts = {}): ResourceHandle => {
      normalizeFileOpts(opts, "windows.wsl");
      const content = opts.config === undefined ? undefined : serializeWslConfig(opts.config);
      const runtime = windows.package("Microsoft.WSL");
      const dependencies = opts.dependsOn === undefined ? []
        : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
      const enabled = optionalFeatures(
        ["Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform"], { dependsOn: [runtime, ...dependencies] }
      );
      enabled.windows!.packages = runtime.windows!.packages;
      if (content === undefined) return enabled;
      const resource = normalizeFileText(knownFolder("userProfile", ".wslconfig"), content, {
        backup: opts.backup, force: opts.force, dependsOn: opts.dependsOn,
      });
      if (resource.winix?.kind === "file") resource.winix.wslConfig = true;
      resource.name = "WSL configuration";
      resource.dependsOn = [enabled.__winixHandle, ...(resource.dependsOn ?? [])];
      const configured = dscHandle(resource);
      configured.windows!.packages = enabled.windows!.packages;
      configured.windows!.dsc!.unshift(...enabled.windows!.dsc!);
      return configured;
    },
    {
      distro: (name: string, spec: WinWslDistroSpec): ResourceHandle => {
        if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
          throw new Error("windows.wsl.distro requires a distro name containing only letters, numbers, '.', '_' or '-'");
        }
        if (!spec || spec.source !== "nixos-wsl" || !validFilePath(spec.installLocation) ||
            (typeof spec.installLocation === "string" &&
              (!win32.isAbsolute(spec.installLocation) && !spec.installLocation.startsWith("%"))) ||
            (spec.default !== undefined && typeof spec.default !== "boolean")) {
          throw new Error("windows.wsl.distro requires source 'nixos-wsl', an absolute/environment/known-folder installLocation, and an optional boolean default");
        }
        if (spec.host !== undefined && (typeof spec.host !== "string" ||
            !/^[a-z0-9][a-z0-9._-]*$/i.test(spec.host))) {
          throw new Error("windows.wsl.distro host must be a valid expected Linux hostname");
        }
        return dscHandle(withDscMetadata(withDscToken({
          resourceType: POWERSHELL_SCRIPT_RESOURCE,
          name: `WSL distro ${name}`,
          dependsOn: resolveDependsOn(spec.dependsOn),
        }), { kind: "wsl-distro", distro: {
          name, source: spec.source, installLocation: spec.installLocation, default: spec.default ?? false,
          ...(spec.host === undefined ? {} : { host: spec.host }),
          ...(spec.setup === undefined ? {} : { setup: normalizeWslSetup(spec.setup) }),
        } }));
      },
    },
  ),
  startup: {
    command: (name, spec) => dscHandle(normalizeStartupCommand(name, spec)),
  },
  knownFolder: {
    documents: (path) => knownFolder("documents", path),
    desktop: (path) => knownFolder("desktop", path),
    localAppData: (path) => knownFolder("localAppData", path),
    appData: (path) => knownFolder("appData", path),
    userProfile: (path) => knownFolder("userProfile", path),
  },
  powershell: {
    repositories: (policy) => {
      validatePowerShellRepositoryPolicy(policy);
      return { windows: { powershell: { repositories: policy } } };
    },
    module: (name, opts = {}) => {
      if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        throw new Error("windows.powershell.module requires a module name without wildcards or paths");
      }
      if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
        throw new Error("windows.powershell.module options must be an object");
      }
      const repository = opts.repository;
      if (repository !== undefined && (typeof repository !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(repository))) {
        throw new Error("windows.powershell.module repository must be a registered repository name");
      }
      if (opts.prerelease !== undefined && typeof opts.prerelease !== "boolean") {
        throw new Error("windows.powershell.module prerelease must be a boolean");
      }
      const resource = withDscMetadata(withDscToken({
        resourceType: POWERSHELL_SCRIPT_RESOURCE,
        name: `PowerShell module ${name}`,
        dependsOn: resolveDependsOn(opts.dependsOn),
      }), { kind: "powershell-module", module: {
        name, repository, ...(opts.prerelease !== undefined ? { prerelease: opts.prerelease } : {}),
      } });
      return dscHandle(resource);
    },
  },
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
    text: (target, content, opts): ResourceHandle =>
      dscHandle(normalizeFileText(target, content, opts)),
    symlink: (target, source, opts): ResourceHandle =>
      dscHandle(normalizeFileSymlink(target, source, opts)),
    copy: (target, source, opts): ResourceHandle =>
      dscHandle(normalizeFileCopy(target, source, opts)),
    remove: (target, opts): ResourceHandle =>
      dscHandle(normalizeFileRemove(target, opts)),
  },
};

export function normalizeWslSetup(setup: WinWslSetup): WinWslSetup {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) {
    throw new Error("windows.wsl.distro setup must be an object");
  }
  let url: URL;
  try { url = new URL(setup.repository); } catch { throw new Error("WSL setup repository must be an HTTPS Git URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WSL setup repository must be HTTPS without credentials, query, or fragment");
  }
  const ref = setup.ref ?? "HEAD";
  if (typeof ref !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/i.test(ref) || ref.includes("..") ||
      ref.endsWith("/") || ref.includes("//")) throw new Error("Invalid WSL setup Git ref");
  if (typeof setup.configDirectory !== "string" || !setup.configDirectory ||
      setup.configDirectory.startsWith("/") || /^[a-z]:/i.test(setup.configDirectory) || /[\\\x00-\x1f\x7f]/.test(setup.configDirectory) ||
      setup.configDirectory.split("/").includes("..")) throw new Error("WSL setup configDirectory must stay inside the repository");
  if (typeof setup.host !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(setup.host)) throw new Error("Invalid WSL setup host");
  if (setup.user !== undefined && (typeof setup.user !== "string" ||
      !/^[a-z_][a-z0-9_-]*$/.test(setup.user) || setup.user === "root")) throw new Error("WSL setup user must be a non-root Linux account");
  if (setup.checkout !== undefined && (typeof setup.checkout !== "string" || !setup.checkout.startsWith("/") ||
      /^\/+$/.test(setup.checkout) || /[\\\x00-\x1f\x7f]/.test(setup.checkout) ||
      setup.checkout.split("/").some((part) => part === ".." || part === "."))) throw new Error("WSL setup checkout must be an absolute Linux directory");
  return {
    repository: url.href, ref, configDirectory: posix.normalize(setup.configDirectory), host: setup.host,
    ...(setup.checkout === undefined ? {} : { checkout: posix.normalize(setup.checkout).replace(/\/+$/, "") }),
    ...(setup.user === undefined ? {} : { user: setup.user }),
  };
}

function optionalFeatures(names: string[], opts: WinOptionalFeatureOpts): ResourceHandle {
  if (!opts || typeof opts !== "object" || Array.isArray(opts) ||
      (opts.enabled !== undefined && typeof opts.enabled !== "boolean") ||
      names.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name))) {
    throw new Error("windows.optionalFeature requires a Windows feature name and boolean enabled option");
  }
  return dscHandle(withDscMetadata(withDscToken({
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
    name: `Windows features ${names.join(" ")}`,
    elevated: true,
    dependsOn: resolveDependsOn(opts.dependsOn),
  }), { kind: "optional-features", names, enabled: opts.enabled ?? true }));
}

function serializeWslConfig(config: WinWslConfig): string {
  const allowed: Record<string, Record<string, string | readonly string[]>> = {
    wsl2: {
      memory: "positive-size", swap: "size", processors: "integer",
      localhostForwarding: "boolean", dnsTunneling: "boolean", firewall: "boolean",
      autoProxy: "boolean", guiApplications: "boolean",
      networkingMode: ["nat", "mirrored", "none", "virtioproxy"],
    },
    experimental: { autoMemoryReclaim: ["disabled", "gradual", "dropCache"], sparseVhd: "boolean" },
  };
  if (!config || typeof config !== "object" || Array.isArray(config) || !Object.keys(config).length) {
    throw new Error("windows.wsl config must be a non-empty configuration object");
  }
  const lines: string[] = [];
  for (const [section, entries] of Object.entries(config)) {
    if (!Object.hasOwn(allowed, section) || !entries || typeof entries !== "object" ||
        Array.isArray(entries) || !Object.keys(entries).length) throw new Error(`Invalid .wslconfig section: ${section}`);
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(entries)) {
      const rule = allowed[section][key];
      const valid = Array.isArray(rule) ? rule.includes(value) :
        rule === "boolean" ? typeof value === "boolean" :
        rule === "integer" ? typeof value === "number" && Number.isSafeInteger(value) && value > 0 :
        rule === "positive-size" ? typeof value === "string" && /^[1-9]\d*(?:MB|GB)$/i.test(value) :
        rule === "size" ? typeof value === "string" && /^(?:0|(?:0|[1-9]\d*)(?:MB|GB))$/i.test(value) : false;
      if (!valid) throw new Error(`Invalid .wslconfig option: ${section}.${key}`);
      lines.push(`${key}=${String(value)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
