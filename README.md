# Winix

TypeScript-first system configuration for NixOS, nix-darwin, and Home Manager.

Write your system config in TypeScript. Get type safety, autocomplete, and composable fragments. Winix generates valid Nix that `nixos-rebuild` consumes directly.

## Status

**Early prototype.** The core pipeline works end-to-end: TypeScript config → evaluator → Nix code generation → `nixos-rebuild test` ✅

## Quick Example

```ts
// winix.config.ts
import { account, feature, home, host, input, defineInputs, nixos, platforms, workspace } from "winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

const wsl = feature("wsl", () => ({
  nixos: {
    imports: ["nixos-wsl"],
    wsl: { enable: true },
  },
}));

const neovim = feature("neovim", () => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);

export default workspace({
  inputs,
  hosts: [
    host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
      account.user("adrifer", () => ({
        admin: true,
        shell: "zsh",
        stateVersion: "25.05",
        wslDefault: true,
      }))(),
      wsl(),
      nixos.packages("socat", "bubblewrap"),
      neovim(),
    ]),
  ],
});
```

## How It Works

```
winix.config.ts          →  Evaluator (two-pass)  →  .winix/out/
  platform("linux", ...)        collect IDs              flake.nix
  feature("wsl", ...)           resolve with context     hosts/wsl-work.nix
  host("wsl-work", nixos(), [...])  deep merge
```

1. **Fragments** are the building blocks. Everything is a fragment: platforms, features, tools, roles.
2. **Helpers** create fragments: `platforms.nixos()` / `platforms.darwin()` for common bases, `feature(id, factory)` for features, and `profile(id, entries)` for reusable bundles.
3. **`.isActive`** lets fragments conditionally include config based on what other fragments are in the host.
4. **Lazy evaluation** means fragments are resolved after the evaluator knows what's active, so conditionals work naturally.
5. **Nix backend** generates valid `flake.nix` + host modules that `nixos-rebuild` consumes directly.

## Try It

```bash
git clone https://github.com/adrifer/winix.git
cd winix
npm install

# Run tests
npx vitest run

# Generate Nix output (dry run)
cd test-config
node --experimental-transform-types ../src/cli/index.ts apply --dry

# Generate Nix output (write files)
node --experimental-transform-types ../src/cli/index.ts apply

# Apply to system
sudo nixos-rebuild test --flake path:$(pwd)/.winix/out#wsl-work
```

## Key Concepts

### Fragments

Everything is a function that returns configuration data:

```ts
const starship = feature("starship", () => home.program("starship"));
```

### Composite Fragments

A fragment can compose other fragments:

```ts
const developer = feature("developer", () => [
  home.program("git"),
  neovim(),
  starship(),
  shell(),
]);
```

### Platform Conditionals

Use `.isActive` with native TypeScript — no custom DSL:

```ts
const shell = feature("shell", () => ({
  homeManager: {
    programs: {
      zsh: {
        aliases: {
          g: "lazygit",
          ...(platforms.nixos.isActive && {
            i: "sudo nixos-rebuild switch --flake /etc/nixos",
          }),
          ...(platforms.darwin.isActive && {
            i: "sudo darwin-rebuild switch --flake ~/dotfiles",
          }),
        },
      },
    },
  },
}));
```

### Nix Escape Hatches

Use the unified `nix.*` namespace when a value needs to be a Nix expression:

```ts
nix.pkg("zsh")
nix.str`${nix.pkg("neovim")}/bin/nvim`
nix.script`echo hello`
nix.lib.mkDefault("adrifer")
```

### Third-Party Fragments

No plugin system needed. Just export a function:

```ts
// npm: winix-fragment-tailscale
export const tailscale = feature("tailscale", (opts?) => ({
  nixos: { services: { tailscale: { enable: true, ...opts } } },
}));
```

## Project Structure

```
src/
  core/types.ts          # Fragment, LazyFragment, WorkspaceDef, etc.
  sdk/index.ts           # platform(), feature(), host(), workspace()
  evaluator/index.ts     # Two-pass evaluation + deep merge
  backends/nix/index.ts  # Generates flake.nix + host modules
  cli/                   # winix apply, winix check
spec/                    # Design specifications
examples/
  reference/             # Real-world config example
  escape-hatches/        # Escape hatch patterns
  third-party/           # Third-party fragment example
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full task list and design decisions.

## License

MIT
