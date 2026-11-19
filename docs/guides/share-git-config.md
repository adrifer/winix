---
title: Share git config across Windows and WSL
description: One git identity and settings for Git for Windows and Linux git.
---

# Share git config across Windows and WSL

Home Manager's `home.program("git", …)` configures git on Linux, WSL and macOS.
Git for Windows doesn't read that: it reads `%USERPROFILE%\.gitconfig`. Keep the
settings in one TypeScript object and write it to both places.

## The feature

From [`examples/cross-platform/features/git.ts`](../../examples/cross-platform/features/git.ts):

```ts
const settings = {
  init: { defaultBranch: "main" },
  user: { name: "Alice Example", email: "alice@example.com" },
  pull: { rebase: true },
  alias: { lg: "log --graph --oneline --decorate" },
};

/** Applied inside ~/work on every platform. */
const work = { user: { email: "alice@work.example" } };

export const git = feature("git", ({ home, windows }) => {
  // Linux and macOS: Home Manager installs git and writes ~/.config/git/config.
  home.program("git", {
    settings,
    includes: [{ condition: "gitdir:~/work/", contents: work }],
  });

  // Windows: install Git for Windows and write %USERPROFILE%\.gitconfig.
  // An existing file is moved to .gitconfig.bak the first time.
  windows.package("Git.Git");
  windows.file.text(windows.knownFolder.userProfile(".gitconfig-work"), gitConfig(work));
  windows.file.text(windows.knownFolder.userProfile(".gitconfig"), gitConfig({
    ...settings,
    includeIf: { "gitdir:~/work/": { path: "~/.gitconfig-work" } },
  }));
});
```

`gitConfig()` is a small renderer in the same file (copy it into your repo). It
turns `{ section: { key: value, subsection: { key: value } } }` into git's
format, quoting values that need it:

```ini
[init]
	defaultBranch = main
[user]
	name = Alice Example
	email = alice@example.com
[pull]
	rebase = true
[alias]
	lg = log --graph --oneline --decorate
[includeIf "gitdir:~/work/"]
	path = ~/.gitconfig-work
```

It supports one level of subsections and single values per key. Multi-valued
keys (several `fetch` refspecs, say) are not supported; write those by hand.

Home Manager expresses conditional includes as `includes: [{ condition, contents }]`;
in a plain file that is an `[includeIf "<condition>"]` section pointing at a
second file, which is why the work identity gets its own `.gitconfig-work`.

## Credentials

- **Windows:** Git for Windows ships Git Credential Manager and enables it in
  its system config; nothing to declare.
- **WSL:** reuse the same Windows sign-ins with
  `home.wsl.gitCredentialManager()` (see
  [Reach Windows from WSL](pair-windows-and-wsl.md#reach-windows-from-wsl)).
- **macOS/Linux:** set `credential.helper` in `settings` as usual.

Per-platform settings go in the platform's half: add them to the
`home.program` call, or to the object passed to `gitConfig()` for Windows.

## Things to know

- Winix owns `%USERPROFILE%\.gitconfig` now. `git config --global …` on Windows
  edits that file, and the next `winix plan` shows it as a change (`~ apply`)
  that switch would revert. Put settings in the feature instead.
- The first switch moves an existing `.gitconfig` to `.gitconfig.bak`. If a
  `.bak` already exists the switch stops rather than overwrite it.
- Prefer editing an INI file to a TypeScript object? Keep one `gitconfig` file
  in the repo and link it on both sides instead:
  `windows.file.symlink(windows.knownFolder.userProfile(".gitconfig"), "./git/config")`
  and `home.configFiles({ "git/config": home.symlink("./git/config") })`, without
  `home.program("git", { settings })` (Home Manager would also write `git/config`).
  Install git on Linux with `home.packages("git")`.
