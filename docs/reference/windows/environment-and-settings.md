---
title: Environment and settings
description: Environment variables, PATH, Windows settings, optional features, and the DSC and command escape hatches.
sidebar:
  order: 3
---

# Environment and settings

## Environment variables

```ts
windows.env.set("EDITOR", "code --wait");
windows.env.set("JAVA_HOME", "C:\\Program Files\\Java\\jdk-21", { scope: "machine" });
windows.env.remove("OLD_VAR");
```

`scope` is `"user"` (default) or `"machine"`; machine variables need
administrator rights and join the elevated step. Programs already running keep
their old environment; new terminals see the change.

## PATH

```ts
windows.path.add("%USERPROFILE%\\.local\\bin");
windows.path.remove("%USERPROFILE%\\.old-bin");
```

Adds or removes one entry, leaving the rest of `PATH` as it is. Takes `scope`
like `env`.

## Windows settings

```ts
// Declare several areas together:
windows.settings({
  theme: { colorMode: "dark", accentColor: "#336699" },
  explorer: { showExtensions: true, openTo: "thisPC", compactMode: true },
  taskbar: { alignment: "left", search: "hidden", widgets: false, endTask: true },
  developer: { mode: true, sudo: "inline", longPaths: true },
  clipboard: { history: true },
  keyboard: { repeatDelay: 0, repeatSpeed: 31 },
  mouse: { speed: 12, enhancePointerPrecision: false },
});

// Or call one section directly:
windows.settings.developer({ mode: true, sudo: "inline", longPaths: true });
windows.settings.explorer({ showExtensions: true, classicContextMenu: true });
windows.settings.keyboard({ repeatDelay: 0, repeatSpeed: 31 });
```

`windows.settings()` and its 10 section helpers (`theme`, `explorer`, `taskbar`,
`start`, `developer`, `clipboard`, `time`, `keyboard`, `mouse`, `notifications`)
accept the exact same options. Only the values you declare change.

Per-user settings apply without administrator rights; machine-wide settings
automatically join `winix switch`'s single elevated step. Winix only installs
and locks the `Microsoft.Windows.Settings` PowerShell module when a host
declares a key backed by it.

### `theme` — `windows.settings.theme()`

| Option | Values | Elevated |
|---|---|---|
| `colorMode` | `"light"`, `"dark"`, or `{ apps?, system? }` | No |
| `accentColor` | `"#RRGGBB"` (cannot be combined with `autoColorization: true`) | No |
| `autoColorization` | `true` / `false` (pick accent color from wallpaper) | Yes |
| `transparency` | `true` / `false` | Yes |
| `accentOnStartAndTaskbar` | `true` / `false` | Yes |
| `accentOnTitleBars` | `true` / `false` | Yes |

### `explorer` — `windows.settings.explorer()`

All File Explorer options are per-user (no elevation). Winix never restarts Explorer;
some changes take effect after signing out.

| Option | Values |
|---|---|
| `showExtensions` | `true` / `false` |
| `showHiddenFiles` | `true` / `false` (protected system files stay hidden) |
| `openTo` | `"thisPC"` or `"home"` |
| `showFullPathInTitleBar` | `true` / `false` |
| `classicContextMenu` | `true` / `false` (restore classic Windows 10 right-click menu) |
| `compactMode` | `true` / `false` (reduce spacing between rows) |
| `startupDelay` | `true` / `false` (`false` removes Explorer's sign-in startup delay; `true` restores default) |
| `waitForIdle` | `true` / `false` (`false` stops Explorer waiting for idle at sign-in; `true` restores default) |

### `taskbar` — `windows.settings.taskbar()`

| Option | Values | Elevated |
|---|---|---|
| `alignment` | `"left"`, `"center"` | Yes |
| `autoHide` | `true` / `false` (applied live) | No |
| `search` | `"hidden"`, `"icon"`, `"iconAndLabel"`, `"box"` | No |
| `taskView` | `true` / `false` | No |
| `widgets` | `true` / `false` | No |
| `endTask` | `true` / `false` (show "End task" on taskbar right-click) | No |
| `badges` | `true` / `false` | Yes |
| `grouping` | `"always"`, `"whenFull"`, `"never"` | Yes |
| `multiMonitor` | `true` / `false` | Yes |
| `multiMonitorMode` | `"duplicate"`, `"primaryAndWindow"`, `"windowOnly"` | Yes |

### `start` — `windows.settings.start()` (elevated)

| Option | Values |
|---|---|
| `folders` | Array of `"documents"`, `"downloads"`, `"music"`, `"pictures"`, `"videos"`, `"network"`, `"userProfile"`, `"explorer"`, `"settings"` |
| `showRecent` | `true` / `false` |
| `showRecommended` | `true` / `false` |

### `developer` — `windows.settings.developer()` (elevated)

| Option | Values |
|---|---|
| `mode` | `true` / `false` (Windows Developer Mode; same-host symlinks automatically depend on `mode: true`) |
| `sudo` | `"disabled"`, `"newWindow"`, `"disableInput"`, `"inline"` (Sudo for Windows, Windows 11 24H2+) |
| `longPaths` | `true` / `false` (enable Win32 paths over 260 characters; new processes see the change) |

### `clipboard` — `windows.settings.clipboard()`

| Option | Values |
|---|---|
| `history` | `true` / `false` (per-user `Win+V` Clipboard History; no elevation) |

### `time` — `windows.settings.time()` (elevated)

| Option | Values |
|---|---|
| `zone` | A Windows time zone ID, e.g. `"W. Europe Standard Time"` |
| `automaticZone` | `true` / `false` |

### `keyboard` — `windows.settings.keyboard()`

Applied live per-user via `SystemParametersInfo` (no sign-out or elevation).

| Option | Values |
|---|---|
| `repeatDelay` | `0` (shortest) to `3` (longest) |
| `repeatSpeed` | `0` (slowest) to `31` (fastest) |

### `mouse` — `windows.settings.mouse()`

Applied live per-user via `SystemParametersInfo` (no sign-out or elevation).

| Option | Values |
|---|---|
| `speed` | `1` (slowest) to `20` (fastest); Windows default is `10` |
| `enhancePointerPrecision` | `true` / `false` (mouse acceleration) |
| `swapButtons` | `true` / `false` (swap primary and secondary mouse buttons) |

### `notifications` — `windows.settings.notifications()` (elevated)

| Option | Values |
|---|---|
| `usbErrors` | `true` / `false` |
| `weakCharger` | `true` / `false` |

## Registry

```ts
windows.registry.set("HKCU\\Software\\MyApp", "Theme", "dark");
windows.registry.set("HKLM\\SOFTWARE\\MyApp", "Enabled", 1);
windows.registry.set("HKCU\\Software\\MyApp", "Path", "%USERPROFILE%\\bin", { type: "expandString" });
windows.registry.remove("HKCU\\Software\\MyApp", "LegacyFlag");
windows.registry.remove("HKCU\\Software\\OldApp");
```

Declarative registry management through Microsoft's native
`Microsoft.Windows/Registry` DSC resource. Use standard hive prefixes
(`HKCU\...`, `HKLM\...`, `HKCR\...`, `HKU\...`, `HKCC\...`) without a
PowerShell colon. Machine hives join the elevated step automatically unless
overridden with `{ elevated }`.

Value types are inferred from JavaScript types (`string` → `"string"`, `number`
→ `"dword"`, `string[]` → `"multiString"`, `number[]` → `"binary"`), or set
explicitly with `opts.type` (`"string"`, `"expandString"`, `"dword"`, `"qword"`,
`"multiString"`, `"binary"`). Pass `""` as `valueName` to target the key's
`(Default)` value. Prefer [`windows.settings()`](#windows-settings) when a typed
setting exists.

## Optional features

```ts
windows.optionalFeature("Microsoft-Windows-Subsystem-Linux");
windows.optionalFeature("TelnetClient", { enabled: false });
```

Enables a Windows optional feature (`enabled: false` disables it). Needs
administrator rights. When Windows asks for a restart, what depends on the
feature waits: restart yourself and switch again. Deleting the declaration
leaves the feature as it is. `windows.wsl()` declares the features WSL needs
for you.

## Escape hatches

For anything without a helper.

**A DSC resource**, with its properties passed through as written:

```ts
windows.dsc({
  type: "Microsoft.Windows/Service",
  properties: { name: "spooler", startType: "automatic" },
});
```

DSC checks and sets it like any other resource, so it shows in the plan only
when it differs.

**A command**, run on every switch:

```ts
windows.raw("New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin");
windows.raw({ executable: "npm", arguments: ["install", "--global", "typescript"], dependsOn: node });
```

A string runs in PowerShell 7 (`pwsh`), without a profile; `executable` runs a
program directly. A raw command has no check, so it shows as `~ run` in every
plan and runs on every switch: make it safe to repeat, and prefer a helper
when there is one.

Both take `dependsOn` and return a handle.
