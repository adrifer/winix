---
title: What Winix owns
description: Why Winix only removes what it created on Windows, how removals are confirmed, and the winix state commands.
sidebar:
  order: 5
---

# What Winix owns

On NixOS and macOS, deleting a declaration removes the thing: Nix rebuilds the
system without it. Windows has no such rebuild, and a PC is full of things
Winix didn't put there. So on Windows Winix follows one rule:

> **Winix only removes what it created.**

## Owned and adopted

When you declare something that isn't on the machine yet, Winix creates it and
records that it **owns** it. When you declare something that's already there,
such as an app you installed last year, Winix **adopts** it: it keeps it as
declared (upgrading it to the lock, say) but never takes the right to remove
it.

| | Declaration removed |
|---|---|
| Package Winix installed, version unchanged | Uninstalled, after you confirm |
| Package Winix installed, version changed since by something else | Refused ("externally modified"); `version: "any"` packages are uninstalled anyway |
| Package that was installed before Winix managed it | Never uninstalled |
| Startup app or shortcut Winix created, unchanged | Removed (a running program isn't stopped) |
| Files, links, PowerShell modules, registry values, PATH entries | Left in place; removal isn't tracked for these yet |
| A WSL distro | Never removed, nor its data |

Losing the record only loses removal rights: Winix never guesses ownership from
what's installed, from generated output or from the lock.

## Removals are confirmed

A plan lists what a switch would remove as `- remove` rows, and anything it
will leave alone with `i`:

```text
  - remove  Old.App (winget package)  no longer declared; uninstalls it
  i 1 resource no longer declared but not created by Winix, so left as it is: Old.Tool (winget package)
```

`winix switch` asks before applying anything:

```text
Remove the item(s) marked "- remove" and continue? [y/N]
```

Declining cancels the whole switch, with nothing applied or removed.
`winix switch --yes` accepts removals for scripts; a non-interactive switch with
removals requires it. A package is also only removed when no other host or
workspace on the machine still declares it.

## Where the record lives

`%LOCALAPPDATA%\Winix\applied-<hash>.json`, per Windows user. It's local state:
not the lock, not something to commit or copy to another PC. It records each
owner (a checkout directory and a host name) and what that owner created.

## The state commands

**Keep something but stop owning it.** Before deleting a declaration for
something you want to keep, release it:

```powershell
winix state forget package winget Example.App
winix state forget startup komorebi
winix state forget startup-app komorebi
```

It stays installed, and deleting its declaration then leaves it alone.

**After moving the checkout or renaming a host**, the old owner's records stay
under the old name. Move them to the current checkout and host:

```powershell
winix state owners                                          # list owners and their ids
winix state migrate-owner <old-owner-id> --host DESKTOP --dry
winix state migrate-owner <old-owner-id> --host DESKTOP --yes
winix plan
```

Run it from the new checkout. It changes only the record, never the machine.
Until you migrate, the old owner still counts as declaring its resources, so a
host rename never turns into a mass uninstall.

## Things to know

- `winix apply`, or running the generated scripts yourself, doesn't record
  ownership or remove anything; only `winix switch` does.
- A switch that fails or is interrupted never grants new ownership. Removal
  progress is saved after each removal, so a retry continues where it stopped.
- Two hosts that share a package must use the same version policy for it.
- Ownership is per Windows user on one machine; other users' Winix runs keep
  their own records.
