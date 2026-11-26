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

/** Light or dark color mode. */
export type WinColorMode = "light" | "dark";

/** Folder that a new File Explorer window opens to. */
export type WinExplorerOpenTo = "thisPC" | "home";

/** Taskbar icon alignment. */
export type WinTaskbarAlignment = "left" | "center";

/** How search appears on the taskbar. */
export type WinTaskbarSearchMode = "hidden" | "icon" | "iconAndLabel" | "box";

/** When taskbar buttons for the same application combine. */
export type WinTaskbarGroupingMode = "always" | "whenFull" | "never";

/** Which taskbar shows a window's button across multiple monitors. */
export type WinTaskbarMultiMonMode = "duplicate" | "primaryAndWindow" | "windowOnly";

/** Folder pinned next to the Start menu power button. */
export type WinStartFolder =
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos"
  | "network"
  | "userProfile"
  | "explorer"
  | "settings";

/** Sudo for Windows mode (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Sudo\Enabled`). */
export type WinSudoMode = "disabled" | "newWindow" | "disableInput" | "inline";

/** Theme and color settings (`windows.settings.theme()`). */
export interface WinThemeSettings {
  /**
   * Light or dark mode. One value sets apps and system alike; the object form
   * sets them separately. Applied per-user without elevation.
   */
  colorMode?: WinColorMode | {
    /** Apps' color mode. */
    apps?: WinColorMode;
    /** Taskbar and Start menu color mode. */
    system?: WinColorMode;
  };
  /** Accent color as `"#RRGGBB"`; turns off automatic accent coloring. Applied per-user. */
  accentColor?: string;
  /** Pick the accent color from the wallpaper automatically. Applied elevated. */
  autoColorization?: boolean;
  /** Enable window transparency effects. Applied elevated. */
  transparency?: boolean;
  /** Show the accent color on Start and the taskbar. Applied elevated. */
  accentOnStartAndTaskbar?: boolean;
  /** Show the accent color on title bars and window borders. Applied elevated. */
  accentOnTitleBars?: boolean;
}

/** File Explorer settings (`windows.settings.explorer()`). All per-user, no elevation. */
export interface WinExplorerSettings {
  /** Show file name extensions. */
  showExtensions?: boolean;
  /** Show hidden files (protected operating-system files stay hidden). */
  showHiddenFiles?: boolean;
  /** The folder a new File Explorer window opens to. */
  openTo?: WinExplorerOpenTo;
  /** Show the full folder path in File Explorer's title bar. */
  showFullPathInTitleBar?: boolean;
  /** Use the classic Windows 10 right-click context menu on Windows 11. */
  classicContextMenu?: boolean;
  /** Use compact spacing in File Explorer lists. */
  compactMode?: boolean;
  /** `false` removes Explorer's sign-in delay before starting Run entries and Startup shortcuts. */
  startupDelay?: boolean;
  /** `false` stops Explorer waiting for an idle desktop at sign-in before starting startup entries. */
  waitForIdle?: boolean;
}

/** Taskbar settings (`windows.settings.taskbar()`). */
export interface WinTaskbarSettings {
  /** Taskbar icons on the left or centered. Applied elevated. */
  alignment?: WinTaskbarAlignment;
  /** Hide the taskbar until the pointer reaches it. Applied live per-user. */
  autoHide?: boolean;
  /** How search appears on the taskbar. Applied per-user. */
  search?: WinTaskbarSearchMode;
  /** Show the Task View button. Applied per-user. */
  taskView?: boolean;
  /** Show the Widgets button. Applied per-user. */
  widgets?: boolean;
  /** Show "End task" in the taskbar right-click menu. Applied per-user. */
  endTask?: boolean;
  /** Show unread badges on taskbar icons. Applied elevated. */
  badges?: boolean;
  /** When taskbar buttons of one app combine. Applied elevated. */
  grouping?: WinTaskbarGroupingMode;
  /** Show the taskbar on every display. Applied elevated. */
  multiMonitor?: boolean;
  /** Which taskbar shows a window's button across multiple monitors. Applied elevated. */
  multiMonitorMode?: WinTaskbarMultiMonMode;
}

/** Start menu settings (`windows.settings.start()`). Applied elevated. */
export interface WinStartSettings {
  /** Folders shown next to Start's power button. */
  folders?: WinStartFolder[];
  /** Show recently opened items in Start. */
  showRecent?: boolean;
  /** Show recommendations in Start. */
  showRecommended?: boolean;
}

/** Developer and machine-wide OS toggles (`windows.settings.developer()`). Applied elevated. */
export interface WinDeveloperSettings {
  /** Developer Mode, which allows symlinks without elevation (`windows.file.symlink()` auto-depends on `mode: true`). */
  mode?: boolean;
  /** Sudo for Windows mode (`"disabled"`, `"newWindow"`, `"disableInput"`, or `"inline"`). */
  sudo?: WinSudoMode;
  /** Enable Win32 long paths (paths over 260 characters). */
  longPaths?: boolean;
}

/** Per-user Windows clipboard settings (`windows.settings.clipboard()`). No elevation. */
export interface WinClipboardSettings {
  /** Enable Clipboard History (`Win+V`). */
  history?: boolean;
}

/** Time zone settings (`windows.settings.time()`). Applied elevated. */
export interface WinTimeSettings {
  /** Windows time zone ID (for example `"Pacific Standard Time"` or `"W. Europe Standard Time"`). */
  zone?: string;
  /** Set the time zone automatically from location. */
  automaticZone?: boolean;
}

/** Per-user keyboard repeat settings (`windows.settings.keyboard()`). Applied live without sign-out or elevation. */
export interface WinKeyboardSettings {
  /** Delay before a held key starts repeating: `0` (shortest) to `3` (longest). */
  repeatDelay?: 0 | 1 | 2 | 3;
  /** Repeat rate for a held key: `0` (slowest) to `31` (fastest). */
  repeatSpeed?: number;
}

/** Per-user mouse pointer and button settings (`windows.settings.mouse()`). Applied live without sign-out or elevation. */
export interface WinMouseSettings {
  /** Pointer speed from `1` (slowest) to `20` (fastest); Windows default is `10`. */
  speed?: number;
  /** Enable "Enhance pointer precision" (mouse acceleration). */
  enhancePointerPrecision?: boolean;
  /** Swap the primary and secondary mouse buttons. */
  swapButtons?: boolean;
}

/** Windows system notification settings (`windows.settings.notifications()`). Applied elevated. */
export interface WinNotificationSettings {
  /** Notify about USB connection problems. */
  usbErrors?: boolean;
  /** Notify when a charger is too weak. */
  weakCharger?: boolean;
}

/** Unified Windows OS settings accepted by `windows.settings()`. */
export interface WinSettings {
  /** Theme, color mode, accent color, and transparency. */
  theme?: WinThemeSettings;
  /** File Explorer options and sign-in startup delay. */
  explorer?: WinExplorerSettings;
  /** Taskbar layout, visibility, search, and multi-monitor options. */
  taskbar?: WinTaskbarSettings;
  /** Start menu folders and lists. */
  start?: WinStartSettings;
  /** Developer Mode, Sudo for Windows, and Win32 long paths. */
  developer?: WinDeveloperSettings;
  /** Clipboard History (`Win+V`). */
  clipboard?: WinClipboardSettings;
  /** Windows time zone and automatic time zone detection. */
  time?: WinTimeSettings;
  /** Keyboard repeat delay and repeat speed. */
  keyboard?: WinKeyboardSettings;
  /** Mouse pointer speed, pointer precision, and button swap. */
  mouse?: WinMouseSettings;
  /** USB and weak-charger system notifications. */
  notifications?: WinNotificationSettings;
}

/** Registry value kind for `windows.registry.set()`. */
export type WinRegistryValueType =
  | "string"
  | "expandString"
  | "dword"
  | "qword"
  | "multiString"
  | "binary";

/** Value accepted by `windows.registry.set()`. */
export type WinRegistryValue = string | number | string[] | number[];

export type WinStartupWindowStyle = "normal" | "minimized" | "maximized";
/** Startup apps can also run console programs without any window. */
export type WinStartupAppWindowStyle = WinStartupWindowStyle | "hidden";

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
  /** The repository for modules that don't name one (and for the module windows.settings needs). */
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
      kind: "system";
      label: string;
      enablesDeveloperMode?: boolean;
    }
  | {
      kind: "time";
      label: string;
    }
  | {
      kind: "clipboard";
      label: string;
    }
  | {
      kind: "input";
      label: string;
    }
  | {
      kind: "registry";
      action: "set" | "remove";
      keyPath: string;
      valueName?: string;
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
