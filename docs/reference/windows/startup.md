---
title: Startup
description: Programs that start when you sign in - logon tasks, Startup-folder shortcuts, and Explorer's startup pacing.
sidebar:
  order: 4
---

# Startup

```ts
const komorebi = windows.package("LGUG2Z.komorebi");
const config = windows.file.symlink(windows.knownFolder.userProfile("komorebi.json"), "./dotfiles/komorebi.json");

windows.startup.app("komorebi", {
  executable: windows.knownFolder.programFiles("komorebi\\bin\\komorebic-no-console.exe"),
  arguments: ["start", "--config", config],
  windowStyle: "hidden",
  dependsOn: komorebi,
});
```

## Startup apps

`windows.startup.app(name, spec)` starts a program when you sign in, through a
per-user "At log on" task in Task Scheduler's `\Winix\` folder.

| Option | |
|---|---|
| `executable` | An absolute or `%VARIABLE%` path, a known folder, a program name on `PATH`, or a `windows.file` handle. Must exist when the switch runs. |
| `arguments` | An array of arguments, passed as they are (with standard Windows quoting). Known folders and file handles resolve to their paths. |
| `workingDirectory` | Default: your user profile. |
| `windowStyle` | `"normal"` (default), `"minimized"`, `"maximized"`, or `"hidden"` for a console program with no window at all. |
| `delay` | Seconds to wait after sign-in. |
| `dependsOn` | Handles to apply first, such as the package. |

Why a task and not the Startup folder: logon tasks start right after sign-in,
while Windows opens the Startup folder last, one item at a time, after every
other startup entry, which can take minutes. The task runs as you (not
elevated), without a time limit, on battery, and never as a second instance.
Registering it needs no administrator rights.

Logon tasks are listed in Task Scheduler, not in Settings → Apps → Startup.

## Startup shortcuts

```ts
windows.startup.shortcut("my-tool", { executable: "my-tool.exe" });
```

`<name>.lnk` in your Startup folder, with the same `executable`, `arguments`,
`workingDirectory` and `dependsOn`; `windowStyle` is `normal`, `minimized` or
`maximized`. An existing, different shortcut is moved to
`%LOCALAPPDATA%\Winix\startup-backups\` (outside the Startup folder, since
Windows would try to open a `.bak` there at sign-in); `backup: false` refuses
instead and `force: true` replaces it without a backup.

## Both kinds

- They only register the entry: nothing starts, stops or restarts during a
  switch.
- They run at sign-in, as you; this isn't for services, elevated programs or
  all users.
- Winix removes the entries it created when you delete their declarations,
  without stopping the running program
  ([What Winix owns](../../concepts/ownership.md)).
- Keep names unique per host.

## Explorer's pacing

```ts
windows.settings.explorer({ startupDelay: false, waitForIdle: false });
```

Explorer waits before starting Run entries and Startup shortcuts, and waits for
the desktop to go idle. `startupDelay: false` and `waitForIdle: false` turn
those off; `true` restores the Windows default.
