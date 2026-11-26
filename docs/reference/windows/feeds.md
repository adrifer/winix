---
title: Feeds
description: PowerShell modules and the repositories they come from, and npm registries, including approved feeds on work machines.
sidebar:
  order: 6
---

# Feeds

## PowerShell modules

```ts
const icons = windows.powershell.module("Terminal-Icons");
windows.powershell.module("PSReadLine", { prerelease: true });
windows.powershell.module("Internal.Tools", { repository: "approved" });
```

`windows.powershell.module(name, options?)` installs a module for your user
with PowerShell 7 and PSResourceGet, at the version pinned in
`winix-windows.lock` (the latest stable on the first switch).

| Option | |
|---|---|
| `repository` | Where to get it. Default: the host's default repository (below), otherwise PSGallery. |
| `prerelease` | Allow a prerelease pin. |
| `dependsOn` | Handles to install after. A declared `Microsoft.PowerShell` package is added automatically. |

Other installed versions aren't removed. Your profile still imports the module
itself; a plain `Import-Module` can load a newer version installed outside
Winix.

### Approved repositories

A work machine can limit where modules come from, without changing the
features that declare them:

```ts
const workRepositories = feature("work-repositories", ({ windows }) => {
  windows.powershell.repositories({
    repositories: {
      approved: { uri: "https://packages.example.com/powershell/v3/index.json" },
    },
    default: "approved",
    allowed: ["approved"],
  });
});

const work = profile("work", [workRepositories(), windowsShell()]);
```

- `default` is used by every module without a `repository`, and by the module
  elevated `windows.settings()` keys need (`Microsoft.Windows.Settings`).
- `allowed`, when set, fails any module that names another repository, before
  anything is looked up. There's no fallback.
- Hosts without such a feature keep using PSGallery. Two different policies in
  one host are an error.
- It applies to the modules Winix installs, not to raw commands, npm, NuGet or
  WSL.

Feeds are HTTPS URLs without credentials. A feed that needs authentication, or
isn't a NuGet v3 feed, needs a matching PSResourceGet registration you set up
yourself; Winix reuses a registration whose name and URL match, and otherwise
reads the feed anonymously. Looking up versions never creates or changes
registrations; a switch registers the repository before installing from it.
Don't put secrets in the config or the lock.

## npm registries

```ts
windows.npm.registries({
  registries: {
    npmjs: { uri: "https://registry.npmjs.org/" },
    work: { uri: "https://packages.example.com/npm/" },
  },
  default: "work",
  scopes: { "@my-company": "work", "@adrifer": "npmjs" },
});
```

Writes `registry` and the declared `@scope:registry` entries to your user
`.npmrc` (or the file `NPM_CONFIG_USERCONFIG` points to), and nothing else:
authentication, comments and other settings stay. npm doesn't need to be
installed.

- URLs are HTTPS, without credentials. Authentication stays with npm
  (`npm login`, or environment variables the `.npmrc` already refers to).
- There's no `allowed` list here: project `.npmrc` files, environment variables
  and command-line options can still override it.
- Deleting the declaration leaves the settings in `.npmrc`.
