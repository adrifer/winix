# Escape hatches

Escape hatches allow Winix to represent backend-specific behavior before a typed abstraction exists. They provide a gradual migration path: start with raw Nix, convert to typed fragments over time.

## Design principles

- Every escape hatch is a fragment (same shape, same composition model).
- Escape hatches are never silently ignored.
- Unsupported escape hatches fail during planning.
- Raw code must not run during TypeScript evaluation.
- The compiler should warn (not error) about escape hatch usage to encourage migration.

## Three levels of escape

### Level 1: `nixos.raw()` / `home.raw()` / `darwin.raw()` — inline Nix expressions

For quick hacks or things that don't fit any typed fragment:

```ts
import { home, nixos } from "@adrifer/winix";

host("wsl-work", nixos(), [
  wsl(),
  nixos.raw(`
    environment.interactiveShellInit = '''
      win_home="$(wslpath -w "$HOME")"
      win_user="''${win_home##*/}"
      export PATH="$PATH:/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
    ''';
  `),
  home.raw(`
    programs.zsh.initContent = '''
      export BROWSER=wslview
      precmd_functions+=(keep_current_path)
    ''';
  `),
]);
```

Variants:

| Function | Target scope |
|----------|-------------|
| `nixos.raw(expr)` | NixOS configuration |
| `home.raw(expr)` | Home Manager configuration |
| `darwin.raw(expr)` | nix-darwin configuration |

The expression is passed verbatim to the Nix backend. No TypeScript type
checking occurs on the content. `.raw()` accepts raw Nix strings only; typed
option objects use the callable helpers instead:

```ts
nixos({ networking: { hostName: "wsl" } })
home({ programs: { git: { enable: true } } })
darwin({ homebrew: { enable: true } })
```

### Level 2: `rawModule()` — existing .nix files

For migration: reference an existing Nix module file without rewriting it:

```ts
import { rawModule } from "@adrifer/winix";

host("wsl-work", nixos(), [
  rawModule("./legacy/vscode-path.nix"),
  rawModule("./legacy/git-credential.nix"),
  // Typed fragments for everything else:
  developer(),
  workSysctl(),
]);
```

Variants:

| Function | Target |
|----------|--------|
| `rawModule(path)` | NixOS module |
| `rawModule.homeManager(path)` | Home Manager module |
| `rawModule.darwin(path)` | nix-darwin module |

The path is workspace-relative. The compiler includes the file as-is in the generated output. This enables incremental migration: start with everything as `rawModule`, convert one file at a time to typed fragments.

### Level 3: `nix.expr()` — inline Nix within typed fragments

For when 90% of a fragment is typed but one value needs a Nix expression:

```ts
import { nix } from "@adrifer/winix";

export function wsl(opts?: WslOpts): Fragment {
  return {
    nixos: {
      wsl: { enable: true, defaultUser: opts?.defaultUser },
      packages: ["wl-clipboard"],
    },
    homeManager: {
      shell: {
        initContent: nix.expr(`
          export BROWSER=wslview

          keep_current_path() {
            printf "\\e]9;9;%s\\e\\\\" "$(wslpath -w "$PWD")"
          }
          precmd_functions+=(keep_current_path)
        `),
      },
    },
  };
}
```

`nix.expr()` marks a value as a Nix literal expression. The compiler emits it without quoting or interpretation. The TypeScript type is opaque (`NixExpr`), so it can be assigned to any compatible option field. Prefer narrower helpers like `nix.pkg()`, `nix.str()`, `nix.script()`, and `nix.lib.*` when they fit.

## Summary table

| Escape | Scope | Use case |
|--------|-------|----------|
| `nixos.raw()` / `home.raw()` / `darwin.raw()` | Top-level fragment | Quick hacks, one-off config |
| `rawModule(path)` | Top-level fragment | Migration, existing .nix files |
| `nix.expr(\`...\`)` | Value within a typed fragment | One field needs a Nix expression |

## Diagnostics

The compiler emits warnings (not errors) for escape hatch usage:

```
⚠ wsl.ts:15 — nix.expr() used in home.shell.initContent
  Consider extracting to a typed fragment when stable.

⚠ winix.config.ts:8 — rawModule("./legacy/vscode-path.nix")
  2 raw modules remain. Run `winix migrate` for conversion suggestions.
```

## Escape report

A dedicated command shows escape hatch "debt":

```bash
winix check --escape-report

# Escape Hatch Report
# ────────────────────
# Raw fragments (*.raw):    1
# Raw modules (rawModule):  2
# Inline escapes (nix.expr):  3
# ────────────────────
# Typed coverage: 87%
```

## Migration story

1. **Day 1:** Use `rawModule()` for all existing .nix files. Everything works as before.
2. **Week 1:** Convert simple modules (packages, sysctl, git) to typed fragments.
3. **Ongoing:** Complex modules with Nix logic stay as `*.raw("...")` or `nix.expr()` until types cover them or `winix types generate` adds support. Typed object fragments use `nixos({...})`, `home({...})`, or `darwin({...})`.

## Backend-specific escape hatches

For non-Nix backends (future):

| Function | Target |
|----------|--------|
| `raw.dsc(resource)` | Windows DSC resource |
| `raw.powershell(script)` | Windows PowerShell task |
| `raw.registry(key, value)` | Windows registry |

These follow the same pattern: a fragment function that passes content verbatim to the target backend.

## Requirements for all escape hatches

- Source provenance tracked (file + line where the escape was declared).
- Plans clearly mark resources as raw/backend-specific.
- Backend capability requirements are explicit (a `raw.dsc()` fragment requires the Windows backend).
- Escape hatches compose with typed fragments in the same host list without special ordering.
