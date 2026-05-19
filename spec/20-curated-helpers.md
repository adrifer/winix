# Spec 20 — Curated Authoring Helpers

## Overview

First-party helpers that wrap common NixOS/Home Manager/nix-darwin patterns into
ergonomic, typed functions. These live in `src/helpers/` and are exported from `winix`.

Users can always fall back to raw fragment objects for anything not covered.

## Design Principles

1. **Helpers return `Fragment`** — they compose just like any other fragment.
2. **Opinionated but overridable** — sensible defaults, all options optional.
3. **No magic** — a helper is sugar over the same fragment shape users write manually.
4. **Scope-aware** — each helper knows whether it targets `nixos`, `homeManager`, or `darwin`.
5. **Typed options** — each helper has a dedicated interface exported from `winix`.

## Helpers to Implement

### `packages(...names: string[]): Fragment`

System-level packages (NixOS `environment.systemPackages` / darwin `environment.systemPackages`).

```ts
packages("ripgrep", "fd", "jq")
// → { nixos: { packages: ["ripgrep", "fd", "jq"] } }
// On darwin hosts: { darwin: { packages: ["ripgrep", "fd", "jq"] } }
```

**Behavior:** Returns `nixos.packages` by default. When composed into a darwin-only host
(no NixOS platform), the evaluator already routes to `darwin`. The helper is scope-agnostic —
it puts packages in the appropriate top-level key based on a `scope` option or defaults to
`nixos` (the backend already handles the `packages` → `environment.systemPackages` mapping).

Options:
```ts
interface PackagesOpts {
  scope?: "nixos" | "homeManager" | "darwin"; // default: "nixos"
}
```

Overload: `packages.homeManager(...names)` → shorthand for `{ homeManager: { home: { packages: [...] } } }`

### `user(username: string, opts?: UserOpts): Fragment`

Declares the Home Manager user and common user-level settings.

```ts
user("adrifer", {
  shell: "zsh",
  homeDirectory: "/home/adrifer",
  stateVersion: "24.05",
})
```

Options:
```ts
interface UserOpts {
  shell?: string;           // login shell program name (e.g. "zsh")
  homeDirectory?: string;   // override home dir (default: /home/<username>)
  stateVersion?: string;    // HM stateVersion
  sessionVariables?: Record<string, string>;
}
```

Output:
```ts
{
  homeManager: {
    home: {
      username,
      ...(opts.stateVersion && { stateVersion: opts.stateVersion }),
      ...(opts.homeDirectory && { homeDirectory: opts.homeDirectory }),
      ...(opts.sessionVariables && { sessionVariables: opts.sessionVariables }),
    },
  },
  nixos: {
    ...(opts.shell && { users: { users: { [username]: { shell: `pkgs.${opts.shell}` } } } }),
  },
}
```

### `git(opts: GitOpts): Fragment`

Git configuration via Home Manager `programs.git`.

```ts
git({
  userName: "Adrian Fernandez Garcia",
  userEmail: "tracker086@outlook.com",
  defaultBranch: "main",
  difftool: "nvimdiff",
  includes: [
    { condition: "gitdir:~/work/", user: { email: "adrifer@microsoft.com" } },
  ],
})
```

Options:
```ts
interface GitOpts {
  userName?: string;
  userEmail?: string;
  defaultBranch?: string;
  difftool?: string;
  signing?: { key: string; format?: "ssh" | "gpg" };
  aliases?: Record<string, string>;
  extraConfig?: Record<string, unknown>;
  includes?: GitInclude[];
}

interface GitInclude {
  condition?: string;
  user?: { name?: string; email?: string };
  contents?: Record<string, unknown>;
}
```

Output: `{ homeManager: { programs: { git: { enable: true, ...mappedOpts } } } }`

### `zsh(opts?: ZshOpts): Fragment`

Zsh shell with common plugins and settings via Home Manager `programs.zsh`.

```ts
zsh({
  aliases: { g: "lazygit", n: "nvim" },
  plugins: ["zsh-vi-mode"],
  viMode: true,
})
```

Options:
```ts
interface ZshOpts {
  aliases?: Record<string, string>;
  plugins?: string[];         // plugin names (resolved to HM plugin objects)
  viMode?: boolean;           // enable vi-mode (default: false)
  autosuggestions?: boolean;  // default: true
  completion?: boolean;       // default: true
  syntaxHighlighting?: boolean; // default: true
  initExtra?: string;         // extra zshrc lines
  envExtra?: string;          // extra zshenv lines
}
```

Defaults: `autosuggestions: true`, `completion: true`, `syntaxHighlighting: true`.

Output: `{ homeManager: { programs: { zsh: { enable: true, ...mappedOpts } } } }`

### `shell(opts: ShellOpts): Fragment`

Cross-cutting shell environment (env vars, PATH additions). Scope: Home Manager.

```ts
shell({
  env: { EDITOR: "nvim", BROWSER: "wslview" },
  path: ["$HOME/.local/bin", "$HOME/go/bin"],
})
```

Options:
```ts
interface ShellOpts {
  env?: Record<string, string>;
  path?: string[];
}
```

Output:
```ts
{
  homeManager: {
    home: {
      sessionVariables: opts.env,
      sessionPath: opts.path,
    },
  },
}
```

### `sysctl(settings: Record<string, number | string>): Fragment`

NixOS kernel sysctl settings.

```ts
sysctl({ "net.core.rmem_max": 2500000, "fs.inotify.max_user_watches": 1048576 })
```

Output: `{ nixos: { boot: { kernel: { sysctl: settings } } } }`

## File Structure

```
src/helpers/
├── index.ts          # re-exports all helpers
├── packages.ts
├── user.ts
├── git.ts
├── zsh.ts
├── shell.ts
└── sysctl.ts
```

All exported from `src/index.ts` (the public API entry point).

## Testing

Each helper needs tests verifying:
1. Default output shape is correct
2. All options are respected
3. Composes correctly with other fragments in a host
4. Type-checks (no `any` leaks)

Add tests to `tests/helpers.test.ts`.

## Migration of Examples

After implementing, update `examples/reference/features/` to use the new helpers
where appropriate. The existing `feature("git", ...)` etc. should still work (helpers
are additive), but examples should showcase the cleaner API.

## Non-Goals (for this task)

- Type generation from nixpkgs (P2)
- camelCase → kebab-case mapping (separate task)
- Additional `nix.expr()` escape-hatch coverage (separate task)
- Platform-aware auto-routing (helpers are explicit about scope)
