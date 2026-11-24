// Windows backend types: the IR carried by fragments under the `windows` key.
//
// These are intentionally minimal for the MVP vertical slice.
// They will grow to cover env/path/file/raw/dsc/wsl/programs as the backend
// matures. The shape here is the *internal* representation produced by the
// `windows.*` helpers and consumed by the Windows emitter, not the public
// authoring surface.

import type { ResourceRef } from "../core/types.ts";

export type WinKnownFolderName =
  | "documents" | "desktop" | "localAppData" | "appData" | "userProfile"
  | "programFiles" | "programFilesX86";

export interface WinKnownFolder {
  kind: "knownFolder";
  folder: WinKnownFolderName;
  path: string;
}

export type WinFilePath = string | WinKnownFolder;

export type WinFontSource = string | {
  url: string;
  sha256?: string;
  /** ZIP member names or recursive extension selectors; defaults to all TTF/OTF files. */
  files?: string[];
} | {
  provider: "nerd-fonts";
  family: string;
  /** Official release tag; omitted tags resolve latest once, then remain locked. */
  version?: string;
};

export interface WinWallpaper {
  /** The image: a path relative to winix.config.ts, an absolute or `%VARIABLE%` path, or a known folder. */
  source: WinFilePath;
  /** How the image fits the screen. Defaults to "Fill". */
  style?: "Fill" | "Fit" | "Stretch" | "Tile" | "Center" | "Span";
}

export interface WinPersonalization {
  /**
   * Light/dark mode. One value sets apps and system alike; the object form
   * sets them separately. Same registry values as windows.setting
   * AppColorMode/SystemColorMode; declare each in one place only.
   */
  colorMode?: "Light" | "Dark" | {
    /** Apps' color mode. */
    apps?: "Light" | "Dark";
    /** The taskbar's and Start's color mode. */
    system?: "Light" | "Dark";
  };
  /** Accent color as "#RRGGBB"; turns off automatic accent coloring. */
  accentColor?: string;
  /** File Explorer options. */
  explorer?: {
    /** Show file name extensions. */
    showExtensions?: boolean;
    /** Show hidden files (protected operating-system files stay hidden). */
    showHiddenFiles?: boolean;
    /** The folder a new Explorer window opens. */
    openTo?: "ThisPC" | "Home";
  };
  /** Taskbar options. */
  taskbar?: {
    /** Hide the taskbar until the pointer reaches it. */
    autoHide?: boolean;
    /** How search shows on the taskbar. */
    search?: "Hidden" | "Icon" | "IconAndLabel" | "Box";
    /** Show the Task View button. */
    taskView?: boolean;
    /** Show the Widgets button. */
    widgets?: boolean;
  };
}

export type WinStartupWindowStyle = "normal" | "minimized" | "maximized";
/** Startup apps can also run console programs without any window. */
export type WinStartupAppWindowStyle = WinStartupWindowStyle | "hidden";

export interface WinStartupExplorerOptions {
  /** false: no delay before Explorer starts Run entries and Startup shortcuts. */
  delay?: boolean;
  /** false: do not wait for the desktop to go idle first. */
  waitForIdle?: boolean;
}

export interface WinStartupCommand {
  /** Absolute/environment-variable path, known-folder path, or application name on PATH. */
  executable: WinFilePath;
  /** Literal arguments; known-folder arguments are resolved during activation. */
  arguments?: WinFilePath[];
  /** Defaults to the current user's home directory. Must exist during activation. */
  workingDirectory?: WinFilePath;
  windowStyle?: WinStartupWindowStyle;
}

export interface WinPowerShellModule {
  name: string;
  /** Omitted repositories inherit the host policy after all fragments merge. */
  repository?: string;
  /** Allow prereleases when resolving the lock; installations still use an exact pin. */
  prerelease?: boolean;
}

export interface WinPowerShellRepositoryPolicy {
  /** Named HTTPS feeds to register for the current Windows user. No credentials in URLs. */
  repositories: Record<string, { uri: string }>;
  /** The repository for modules that don't name one (and for the module windows.setting needs). */
  default: string;
  /** When specified, reject other repositories instead of falling back. */
  allowed?: string[];
}

export interface WinNpmRegistryPolicy {
  /** Named registries: HTTPS URLs without credentials, queries or fragments. */
  registries: Record<string, { uri: string }>;
  /** The registry npm uses by default (`registry` in .npmrc). */
  default: string;
  /** npm scope (including @) mapped to a declared registry name. */
  scopes?: Record<string, string>;
}

export interface WinWslDistro {
  name: string;
  /** The image: "nixos-wsl", the official NixOS-WSL release (pinned in winix-windows.lock). */
  source: "nixos-wsl";
  /** Creation destination; an adopted distro keeps its registered location. */
  installLocation: WinFilePath;
  /** Default selection is managed only for Winix-created distros. */
  default: boolean;
  /** Expected Linux hostname for adoption; defaults to setup.host. */
  host?: string;
  /** First-run setup for Winix-created distros; never run for adopted distros. */
  setup?: WinWslSetup;
  /**
   * Internal: setup.ref was inferred from the config checkout's branch, so it
   * is excluded from the completed-setup fingerprint (switching branches must
   * not invalidate an already-completed distro).
   */
  setupRefFromCheckout?: boolean;
}

export interface WinWslSetup {
  /** Opts into executing trusted repository/npm code inside the distro. HTTPS only; never embed credentials. */
  repository: string;
  /** Branch, tag, full ref, or immutable commit; resolved into winix-windows.lock. Defaults to HEAD. */
  ref?: string;
  configDirectory: string;
  host: string;
  /** Absolute path inside the selected account's home. Defaults to <home>/dotfiles. */
  checkout?: string;
  /** Selects a normal account declared by the Linux host; inferred when unambiguous. */
  user?: string;
}

export interface WinWslConfig {
  /** The `[wsl2]` section of .wslconfig. */
  wsl2?: {
    /** Memory limit for the WSL VM, e.g. "16GB". */
    memory?: string;
    /** Number of virtual processors. */
    processors?: number;
    /** Swap size, e.g. "8GB"; "0" turns swap off. */
    swap?: string;
    /** Reach WSL's localhost ports from Windows. */
    localhostForwarding?: boolean;
    /** How WSL networks: NAT (default), mirrored with Windows, none, or virtio proxy. */
    networkingMode?: "nat" | "mirrored" | "none" | "virtioproxy";
    /** Resolve DNS through Windows instead of a network packet. */
    dnsTunneling?: boolean;
    /** Apply Windows Firewall rules to WSL traffic. */
    firewall?: boolean;
    /** Use Windows' HTTP proxy settings in WSL. */
    autoProxy?: boolean;
    /** Run Linux GUI apps (WSLg). */
    guiApplications?: boolean;
  };
  /** The `[experimental]` section of .wslconfig. */
  experimental?: {
    /** Give unused memory back to Windows. */
    autoMemoryReclaim?: "disabled" | "gradual" | "dropCache";
    /** Shrink new distros' virtual disks automatically. */
    sparseVhd?: boolean;
  };
}

/**
 * A winget package source. MVP supports the two first-party catalogues.
 * Additional sources (chocolatey, scoop) can plug in later without changing
 * this union's consumers.
 */
export type WinPackageSource = "winget" | "msstore";

/**
 * A single declared Windows package, normalized from any of the
 * `windows.package(...)` call shapes into a stable internal record.
 */
export interface WinPackage {
  /** Winget/msstore package identifier, e.g. "Git.Git". */
  id: string;
  /** Catalogue the id resolves against. Defaults to "winget". */
  source: WinPackageSource;
  /**
   * Absolute version pin. When present, switch installs exactly this version
   * regardless of what is available upstream. When absent, the version floats:
   * winix-windows.lock records it and `winix update --windows` refreshes it.
   */
  version?: string;
  /**
   * When true, switch always installs/upgrades the package in its elevated
   * step. Machine-wide installs are detected and elevated automatically; set
   * this for installers that need administrator rights without saying so
   * (drivers, system services).
   */
  elevated?: boolean;
  /**
   * Declared with `version: "any"`: Winix only ensures it is installed. No lock
   * pin, no version comparison, no lock-update prompt, never a downgrade.
   * Removal stays ownership-checked. `version` is then undefined.
   */
  anyVersion?: true;
  /**
   * Resources this package must be applied after, as resolved resource
   * references (from handles passed to `dependsOn`). Emitted as DSC v3
   * `dependsOn` entries. References must belong to the same host.
   */
  dependsOn?: ResourceRef[];
}

/**
 * A raw Windows command to run through DSC v3's transitional command resource.
 */
export interface WinRawCommand {
  /** Optional stable resource name. When omitted, the emitter generates one. */
  name?: string;
  /** Executable to invoke, e.g. "powershell", "pwsh", or "cmd". */
  executable: string;
  /** Arguments passed to the executable, in order. */
  arguments?: string[];
  /**
   * Unique identity token for this command, so a handle returned by
   * `windows.raw(...)` can be referenced in another resource's `dependsOn`.
   * Survives fragment merging (commands are concatenated by reference, never
   * cloned). Non-enumerable in spirit; carried internally only.
   */
  token?: symbol;
  /**
   * Resources this command must run after, as resolved resource references.
   * Emitted as DSC v3 `dependsOn`. References must belong to the same host.
   */
  dependsOn?: ResourceRef[];
}

/**
 * A generic DSC v3 resource, produced by `windows.dsc(...)` and by the typed
 * helpers built on top of it (env/path). This is the escape hatch's IR: it
 * carries an arbitrary DSC resource `type` and a free-form `properties` object
 * that the emitter serializes verbatim as YAML.
 *
 * Typed helpers (env/path) construct native DSC resources internally:
 * `Microsoft.Windows/Registry` for env and
 * `Microsoft.DSC.Transitional/PowerShellScript` for PATH/files/modules.
 */
export interface WinDscResource {
  /**
   * Fully qualified DSC resource type, e.g. `Microsoft.Windows/Registry` or
   * `Microsoft.Windows/Service`.
   */
  resourceType: string;
  /**
   * Optional friendly name. When omitted, the emitter generates one
   * (`dsc N` in declaration order), sanitized to the DSC name charset.
   */
  name?: string;
  /**
   * Free-form DSC resource properties, serialized verbatim to YAML. May be a
   * deeply nested object (e.g. the adapter's `resources:` array). Restricted to
   * JSON-like values (string/number/boolean/null/array/object).
   */
  properties?: WinDscProperties;
  /**
   * When true, switch applies the resource in its elevated step (one UAC
   * prompt for all elevated work).
   */
  elevated?: boolean;
  /**
   * Unique identity token so a handle returned by `windows.dsc(...)`,
   * `windows.env.*(...)`, or `windows.path.*(...)` can be referenced in another
   * resource's `dependsOn`. Non-enumerable in spirit; carried internally only.
   */
  token?: symbol;
  /**
   * Internal metadata for typed helpers. The emitter uses this to perform
   * host-level rewrites that require seeing multiple resources together (for
   * example resolving Winix-managed env var references in PATH entries). This
   * must never be serialized to the generated DSC YAML.
   */
  winix?: WinDscMetadata;
  /**
   * Resources this resource must be applied after, as resolved references.
   * Emitted as DSC v3 `dependsOn`. References must belong to the same host.
   */
  dependsOn?: ResourceRef[];
}

export type WinDscMetadata =
  | { kind: "fonts"; sources: WinFontSource[] }
  | { kind: "wallpaper"; wallpaper: WinWallpaper }
  | {
      kind: "optional-features";
      names: string[];
      enabled: boolean;
    }
  | {
      kind: "wsl-distro";
      distro: WinWslDistro;
    }
  | {
      kind: "startup";
      name: string;
    }
  | {
      kind: "startup-app";
      name: string;
    }
  | {
      kind: "startup-explorer";
      label: string;
    }
  | {
      kind: "env";
      action: "set" | "remove";
      name: string;
      value?: string;
      scope: "user" | "machine";
    }
  | {
      kind: "path";
      action: "add" | "remove";
      value: string;
      scope: "user" | "machine";
    }
  | {
      kind: "setting";
    }
  | {
      kind: "powershell-module";
      module: WinPowerShellModule;
    }
  | {
      kind: "file";
      action: "text" | "symlink" | "copy" | "remove";
      target: WinFilePath;
      source?: string;
      content?: string;
      encoding: "utf8" | "utf8bom" | "ascii";
      force: boolean;
      backup: boolean;
      recursive: boolean;
      wslConfig?: boolean;
    };

export type WinColorMode = "Light" | "Dark";
export type WinTaskbarAlignment = "Left" | "Center";
export type WinTaskbarGroupingMode = "Always" | "WhenFull" | "Never";
export type WinTaskbarMultiMonMode = "Duplicate" | "PrimaryAndWindow" | "WindowOnly";
export type WinStartFolder =
  | "Documents"
  | "Downloads"
  | "Music"
  | "Pictures"
  | "Videos"
  | "Network"
  | "UserProfile"
  | "Explorer"
  | "Settings";

/**
 * Typed Windows OS settings exposed by
 * `Microsoft.Windows.Settings/WindowsSettings`.
 */
export interface WinSettings {
  /** Taskbar icons on the left or centered. */
  TaskbarAlignment?: WinTaskbarAlignment;
  /** Apps' light or dark mode. */
  AppColorMode?: WinColorMode;
  /** Windows' own light or dark mode (taskbar, Start). */
  SystemColorMode?: WinColorMode;
  /** Developer Mode, which allows symlinks without elevation (Winix orders it before every symlink). */
  DeveloperMode?: boolean;
  /** Set the time zone from the location. */
  SetTimeZoneAutomatically?: boolean;
  /** Windows time zone ID. Winix validates only that this is non-empty; the target validates the ID. */
  TimeZone?: string;
  /** Transparency effects. */
  EnableTransparency?: boolean;
  /** Accent color on Start and the taskbar. */
  ShowAccentColorOnStartAndTaskbar?: boolean;
  /** Accent color on title bars and window borders. */
  ShowAccentColorOnTitleBarsAndWindowBorders?: boolean;
  /** Pick the accent color from the wallpaper. */
  AutoColorization?: boolean;
  /** Folders shown next to Start's power button. */
  StartFolders?: WinStartFolder[];
  /** Recently opened items in Start. */
  ShowRecentList?: boolean;
  /** Recommendations in Start. */
  ShowRecommendedList?: boolean;
  /** Badges (unread counts) on taskbar apps. */
  TaskbarBadges?: boolean;
  /** Windows' DesktopTaskbarBadges setting: like TaskbarBadges. */
  DesktopTaskbarBadges?: boolean;
  /** When taskbar buttons of one app combine. */
  TaskbarGroupingMode?: WinTaskbarGroupingMode;
  /** Show the taskbar on every display. */
  TaskbarMultiMon?: boolean;
  /** Windows' DesktopTaskbarMultiMon setting: like TaskbarMultiMon. */
  DesktopTaskbarMultiMon?: boolean;
  /** Which taskbar shows a window's button with several displays. */
  TaskbarMultiMonMode?: WinTaskbarMultiMonMode;
  /** Windows' DesktopTaskbarMultiMonMode setting: like TaskbarMultiMonMode. */
  DesktopTaskbarMultiMonMode?: WinTaskbarMultiMonMode;
  /** Notify about USB connection problems. */
  NotifyOnUsbErrors?: boolean;
  /** Notify when a charger is too weak. */
  NotifyOnWeakCharger?: boolean;
}

/** JSON-like value accepted in generic DSC `properties`. */
export type WinDscPropertyValue =
  | string
  | number
  | boolean
  | null
  | WinDscPropertyValue[]
  | { [key: string]: WinDscPropertyValue };

export type WinDscProperties = { [key: string]: WinDscPropertyValue };

/**
 * The `windows` scope of a Fragment. Deep-merged across all fragments for a
 * host, then handed to the Windows emitter.
 *
 * `packages` is keyed by package id so that merging is idempotent and a later
 * fragment pinning a version overrides an earlier float for the same id.
 *
 * `commands` is an ordered list because raw commands can repeat and declaration
 * order controls apply order.
 */
export interface WindowsOptions extends Record<string, unknown> {
  npm?: { registries?: WinNpmRegistryPolicy };
  powershell?: { repositories?: WinPowerShellRepositoryPolicy };
  /** Declared packages, keyed by package id. */
  packages?: Record<string, WinPackage>;
  /** Raw commands to run on apply, in declaration order. */
  commands?: WinRawCommand[];
  /**
   * Generic DSC resources (from `windows.dsc(...)` and the env/path helpers),
   * in declaration order. Ordered because they have no natural key and order
   * can carry meaning; `dependsOn` expresses hard ordering.
   */
  dsc?: WinDscResource[];
  /** Hostname for the target, set by the platform baseline. */
  hostname?: string;
}
