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
windows.setting({ DeveloperMode: true });
windows.setting({ SystemColorMode: "Dark", AppColorMode: "Dark", TaskbarAlignment: "Left" });
```

Through Microsoft's `Microsoft.Windows.Settings` DSC resource. Winix installs
its PowerShell module and pins it in `winix-windows.lock`; settings run in the
elevated step.

| Setting | Values |
|---|---|
| `DeveloperMode` | `true` / `false` |
| `AppColorMode`, `SystemColorMode` | `"Light"`, `"Dark"` |
| `TaskbarAlignment` | `"Left"`, `"Center"` |
| `TaskbarGroupingMode` | `"Always"`, `"WhenFull"`, `"Never"` |
| `TaskbarMultiMonMode`, `DesktopTaskbarMultiMonMode` | `"Duplicate"`, `"PrimaryAndWindow"`, `"WindowOnly"` |
| `TaskbarBadges`, `DesktopTaskbarBadges`, `TaskbarMultiMon`, `DesktopTaskbarMultiMon` | `true` / `false` |
| `TimeZone` | A Windows time zone id, e.g. `"W. Europe Standard Time"` |
| `SetTimeZoneAutomatically` | `true` / `false` |
| `EnableTransparency`, `AutoColorization`, `ShowAccentColorOnStartAndTaskbar`, `ShowAccentColorOnTitleBarsAndWindowBorders` | `true` / `false` |
| `StartFolders` | Folders next to the Start power button: `"Documents"`, `"Downloads"`, `"Music"`, `"Pictures"`, `"Videos"`, `"Network"`, `"UserProfile"`, `"Explorer"`, `"Settings"` |
| `ShowRecentList`, `ShowRecommendedList` | `true` / `false` (Start menu) |
| `NotifyOnUsbErrors`, `NotifyOnWeakCharger` | `true` / `false` |

Color mode and accent colors can also be set with
[`windows.personalization()`](appearance-and-fonts.md); declare each value in
one place only.

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
