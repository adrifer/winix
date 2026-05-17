# CLI

The CLI owns evaluation orchestration, validation, generation, activation, and diagnostics.

## Commands

### `winix init`

Scaffold a new Winix project:

```bash
winix init
# Creates: winix.config.ts, inputs.ts, fragments/, tsconfig.json, .gitignore
# Detects existing flake.nix → offers migration path
# Runs winix types generate automatically
```

### `winix check`

Validate without side effects:

```bash
winix check                   # Typecheck + validate fragments + detect conflicts
winix check --strict          # Scalar conflicts are errors (not just warnings)
winix check --escape-report   # Show escape hatch debt and typed coverage %
winix check --json            # Machine-readable output for agents
```

### `winix apply`

Generate backend output files into `.winix/out/`:

```bash
winix apply                   # Generate all hosts
winix apply --host wsl-work   # Generate single host
winix apply --dry             # Show what would be generated without writing
winix apply --diff            # Show diff against current .winix/out/ content
```

Output directory structure:
```
.winix/
  out/
    flake.nix
    flake.lock
    hosts/
      wsl-work.nix
      macbook-pro.nix
    modules/
      ...
```

`.winix/` is gitignored by default.

### `winix switch`

Generate + activate (apply + system rebuild):

```bash
winix switch                  # apply + nixos-rebuild switch (or darwin-rebuild switch)
winix switch --host wsl-work  # Single host
winix switch --boot           # nixos-rebuild boot (activate on next reboot)
winix switch --test           # nixos-rebuild test (activate without adding to bootloader)
```

Equivalent to:
```bash
winix apply && sudo nixos-rebuild switch --flake .winix/out
```

### `winix types generate`

Generate TypeScript type definitions from declared inputs:

```bash
winix types generate              # Full type generation from inputs
winix types generate --scope used # Only options used in current fragments
winix types generate --scope full # All available NixOS + HM options
winix types generate --add services.tailscale  # Add specific module types
```

### `winix migrate`

Helper for converting escape hatches to typed fragments:

```bash
winix migrate                         # Suggestions for all rawModules
winix migrate ./legacy/wsl.nix        # Convert specific file → typed fragment
```

### `winix inspect`

Introspection for debugging and agent consumption:

```bash
winix inspect graph --json            # Fragment dependency/composition graph
winix inspect fragments --json        # All fragments with metadata and categories
winix inspect host wsl-work           # What fragments compose this host
winix inspect host wsl-work --json    # Machine-readable
winix inspect provenance <path>       # Where does this option value come from?
```

## Responsibilities

- Discover workspace config (`winix.config.ts`)
- Invoke TypeScript evaluator (two-pass: collection + evaluation)
- Validate IR (type checking, conflict detection)
- Detect host platform for `switch`
- Detect backend capabilities
- Generate backend output files
- Dispatch activation commands
- Handle elevation (sudo for rebuild)
- Report diagnostics with source provenance
- Expose stable JSON output for agents

## Output directory

Generated files live in `.winix/out/`, which is:
- Gitignored by default (generated, not source of truth)
- Recreated on every `apply` or `switch`
- Inspectable for debugging (`ls .winix/out/`)
- The flake target for `nixos-rebuild --flake .winix/out`

## Git and Nix flakes

When using Nix flakes, Winix must detect new untracked files that would be invisible to Nix evaluation. It should warn or fail with a clear message and suggested command rather than producing confusing backend errors.

## Exit codes

- `0`: success
- `1`: validation or apply failure
- `2`: usage error
- `3`: unsupported capability
- `4`: evaluator failure
