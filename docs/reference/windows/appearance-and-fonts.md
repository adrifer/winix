---
title: Appearance and fonts
description: Color mode, accent color, Explorer and taskbar options, wallpaper, and fonts including Nerd Fonts.
sidebar:
  order: 5
---

# Appearance and fonts

All of these apply to your user and need no administrator rights.

## Personalization

```ts
windows.personalization({
  colorMode: "Dark",
  accentColor: "#336699",
  explorer: { showExtensions: true, showHiddenFiles: false, openTo: "ThisPC" },
  taskbar: { autoHide: false, search: "Hidden", taskView: true, widgets: false },
});
```

| Option | Values |
|---|---|
| `colorMode` | `"Light"`, `"Dark"`, or `{ apps, system }` to set them separately |
| `accentColor` | `"#RRGGBB"`; turns off automatic accent color |
| `explorer.showExtensions`, `explorer.showHiddenFiles` | `true` / `false` (protected system files stay hidden) |
| `explorer.openTo` | `"ThisPC"` or `"Home"` |
| `taskbar.autoHide`, `taskbar.taskView`, `taskbar.widgets` | `true` / `false` |
| `taskbar.search` | `"Hidden"`, `"Icon"`, `"IconAndLabel"`, `"Box"` |

Only the values you declare change. Some take effect after signing out, and
some depend on the Windows version and policy; Winix never restarts Explorer.
`colorMode` writes the same values as `windows.setting({ AppColorMode, SystemColorMode })`:
declare them in one place.

## Wallpaper

```ts
windows.wallpaper({ source: "./wallpapers/desktop.jpg", style: "Fill" });
```

`source` is a path relative to `winix.config.ts` or a known folder. `style` is
`"Fill"` (default), `"Fit"`, `"Stretch"`, `"Tile"`, `"Center"` or `"Span"`. One
image for the whole desktop. Editing the image file is detected, since Winix
caches it by content.

## Fonts

```ts
windows.fonts({
  sources: [
    "./fonts/MyFont-Regular.ttf",
    { url: "https://example.com/releases/v1/fonts.zip", files: ["**/*.ttf"] },
    { provider: "nerd-fonts", family: "JetBrainsMono" },
  ],
});
```

| Source | |
|---|---|
| A path | A `.ttf` or `.otf` file in your repository. |
| `{ url, files?, sha256? }` | An HTTPS `.ttf`, `.otf` or `.zip`. `files` picks members of a ZIP by path or `**/*.ttf` / `**/*.otf` (default: every font). `sha256` is a checksum you trust; without it, the first download's checksum is recorded. |
| `{ provider: "nerd-fonts", family, version? }` | A Nerd Fonts release. `version: "vX.Y.Z"` picks a release; otherwise the latest is pinned once. |

Find Nerd Fonts names with:

```powershell
winix windows fonts JetBrains
```

Downloads are pinned in the `fonts` section of `winix-windows.lock` and checked
on install; `winix update fonts` moves the pins. Fonts install for your user.
Font files that already exist with different content aren't overwritten, so
updating a pin can need you to remove the old font first. The family name your
terminal or editor needs comes from the font itself and is reported on install.
Deleting a declaration leaves the fonts installed.

A Nerd Font is also available as a WinGet package (for example
`DEVCOM.JetBrainsMonoNerdFont`), which installs machine-wide.
