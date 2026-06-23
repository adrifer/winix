# Winix

**TypeScript-first system configuration for NixOS, nix-darwin, and Home Manager.**

Winix lets you write system configuration as typed, composable TypeScript fragments and generates a normal Nix flake that `nixos-rebuild`, `darwin-rebuild`, and Home Manager can consume.

```ts
// winix.config.ts
import {
  account,
  defineInputs,
  feature,
  home,
  host,
  input,
  nixos,
  platforms,
  workspace,
} from "@adrifer/winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

const wsl = feature("wsl", () => [
  nixos.imports("nixos-wsl"),
  nixos({ wsl: { enable: true } }),
  nixos.program("nix-ld"),
]);

const shell = feature("shell", () =>
  home.program("zsh", {
    shellAliases: {
      g: "lazygit",
      ...(platforms.nixos.isActive && {
        i: "cd ~/dotfiles/winix && npx @adrifer/winix switch",
      }),
      ...(platforms.darwin.isActive && {
        i: "cd ~/dotfiles/winix && npx @adrifer/winix switch --host macbook",
      }),
    },
  })
);

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
      shell(),
      home.packages("neovim", "ripgrep", "fd"),
    ]),
  ],
});
```

## Why Winix?

- **Use TypeScript as the authoring language.** Compose functions, arrays, objects, conditionals, and package-specific helpers without inventing another DSL.
- **Keep Nix as the output.** Winix writes `.winix/out/flake.nix` and host modules; the final build still runs through Nix.
- **One model for NixOS, nix-darwin, and Home Manager.** Share features across Linux, macOS, WSL, servers, and profiles.
- **Typed helpers for common config.** Use `nixos.networking()`, `home.program()`, `darwin.homebrew()`, `account.user()`, and more.
- **Escape hatches when needed.** Drop to `nix.expr()`, `nixos.raw()`, or `rawModule()` without leaving the system.

> Winix is early software. The core pipeline works end-to-end, but the public API is still evolving.

## Install and create a config

```bash
mkdir my-winix-config
cd my-winix-config
npx @adrifer/winix@latest init
npm install
```

Winix expects Node.js with native TypeScript stripping support for `winix.config.ts` files. Node 22+ is recommended.

If you prefer to set up files yourself instead of using `init`, add the package to your own `package.json`:

```bash
npm install @adrifer/winix
```

The `init` command creates a starter `winix.config.ts`, `tsconfig.json`, `.gitignore`, and package scripts. After `npm install`, the `winix` binary comes from your local `node_modules`, so commands are reproducible through `package-lock.json`.

You can also install it globally, but local project installs are recommended:

```bash
npm install -g @adrifer/winix
```

## CLI

From a Winix project:

```bash
npx @adrifer/winix check                  # validate winix.config.ts
npx @adrifer/winix apply                  # generate .winix/out/
npx @adrifer/winix apply --dry            # print generated Nix without writing files
npx @adrifer/winix apply --diff           # show changes against current .winix/out/
npx @adrifer/winix switch --host my-host  # generate and run nixos-rebuild/darwin-rebuild
npx @adrifer/winix update                 # update generated flake.lock and copy it back
npx @adrifer/winix inspect                # inspect host composition and fragments
```

If you add scripts to your `package.json`, you can use shorter commands:

```json
{
  "scripts": {
    "check": "winix check",
    "apply": "winix apply",
    "dry": "winix apply --dry",
    "switch": "winix switch"
  }
}
```

Generated output lives under:

```text
.winix/out/
  flake.nix
  hosts/
    <host>.nix
```

You can also run the generated flake manually:

```bash
sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#my-host
sudo darwin-rebuild switch --flake path:$(pwd)/.winix/out#macbook
```

## Core concepts

### Workspaces and hosts

A workspace declares inputs and hosts. Each host has exactly one platform and a list of fragments.

```ts
export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
    homeManager: input("github:nix-community/home-manager", {
      follows: { nixpkgs: "nixpkgs" },
    }),
  },
  hosts: [
    host("server", platforms.nixos({ stateVersion: "25.05" }), [
      serverProfile(),
    ]),
    host("macbook", platforms.darwin({ stateVersion: 6, homebrew: true }), [
      macProfile(),
    ]),
  ],
});
```

### Features and profiles

Features are reusable lazy fragments. Profiles are reusable bundles.

```ts
const git = feature("git", () =>
  home.program("git", {
    userName: "Adrian Fernandez",
    userEmail: "me@example.com",
  })
);

const developer = profile("developer", [
  git(),
  home.packages("neovim", "lazygit", "ripgrep"),
]);
```

Fragments can return one fragment or an array of fragments:

```ts
const neovim = feature("neovim", () => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);
```

### Platform-aware configuration

Fragments can ask whether another platform or feature is active.

```ts
const shell = feature("shell", () =>
  home.program("zsh", {
    shellAliases: {
      ...(platforms.nixos.isActive && { rebuild: "sudo nixos-rebuild switch" }),
      ...(platforms.darwin.isActive && { rebuild: "sudo darwin-rebuild switch" }),
    },
  })
);
```

### Account helpers

`account.user()` wires together platform users and Home Manager users.

```ts
const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

host("wsl", platforms.nixos({ stateVersion: "25.05" }), [
  adrifer(),
]);
```

### Curated helpers

Winix includes helpers for common Nix namespaces:

```ts
nixos.imports("nixos-wsl")
nixos.networking({ hostName: "server", firewall: { allowedTCPPorts: [22, 443] } })
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })
nixos.systemd.service("backup", { script: "echo backup" })
nixos.users({ users: { root: { shell: nix.pkg("bash") } } })
nixos.system({ stateVersion: "25.05" })

home.program("zsh", { enableCompletion: true })
home.configFiles({ nvim: home.symlink("~/dotfiles/nvim/.config/nvim") })
home.activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })

darwin.defaults({ dock: { autohide: true } })
darwin.homebrew({ enable: true, casks: ["visual-studio-code"] })
darwin.launchd.agent("emacs", {
  serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] },
})
```

Plain object fragments are still supported for options that do not have helpers yet.

### Nix escape hatches

Use `nix.*` when a value needs to be a Nix expression:

```ts
nix.pkg("zsh")
nix.bin("git", "git")
nix.str`${nix.pkg("neovim")}/bin/nvim`
nix.script`
  echo "hello from activation"
`
nix.lib.mkForce(["https://cache.nixos.org/"])
```

For prebuilt single-binary CLI releases (the `azd`, `gh`, `kubectl`,
`1password` family), use `nix.binaryRelease()` instead of hand-rolling
the `stdenvNoCC.mkDerivation` boilerplate:

```ts
home.packages(
  nix.binaryRelease({
    name: "azure-dev-cli",
    version: "1.25.5",
    binary: "azd",
    urlTemplate:
      "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
    platforms: {
      "x86_64-linux":  { file: "azd-linux-amd64.tar.gz",  hash: "sha256-..." },
      "aarch64-linux": { file: "azd-linux-arm64.tar.gz",  hash: "sha256-..." },
      "x86_64-darwin": { file: "azd-darwin-amd64.zip",    hash: "sha256-..." },
      "aarch64-darwin":{ file: "azd-darwin-arm64.zip",    hash: "sha256-..." },
    },
    meta: {
      description: "Azure Developer CLI",
      homepage: "https://github.com/Azure/azure-dev",
      license: "mit",
    },
  }),
);
```

Supports per-platform `{platform}` URL placeholders (for vendors whose
URLs aren't just `${file}`), shell completions via `installShellFiles`,
optional `autoPatchelfHook` on Linux, and a validated `meta.license`
(rejects SPDX-style ids like `MIT`/`Apache-2.0` at TS-eval time so misuse
surfaces immediately, not at Nix build time). Pass `nix.expr(...)` for
licenses that aren't a simple `pkgs.lib.licenses.<id>` lookup. See
[`spec/proposals/binary-release.md`](spec/proposals/binary-release.md)
for the full reference.

For bigger migrations, import existing Nix modules:

```ts
rawModule("./legacy/system.nix")
rawModule.homeManager("./legacy/home.nix")
rawModule.darwin("./legacy/darwin.nix")
```

## Generated Nix

Winix evaluates fragments in two passes:

1. Collect active fragment IDs so `.isActive` works.
2. Resolve lazy fragments and deep-merge the results.
3. Generate a flake and one host module per host.

Objects merge recursively, arrays append, and scalar values use last-wins semantics.

## Type generation

Winix ships bundled option augmentations and can generate/update local option types:

```bash
winix types generate
winix types generate nixos
winix types generate home-manager
winix types generate darwin
```

## Project status

Winix is currently best suited for personal configurations and experimentation. The core workflow is functional, but expect API refinements before a stable `1.0`.

## Development

Only clone this repository if you want to work on Winix itself. For normal configuration usage, install `@adrifer/winix` from npm as shown above.

```bash
git clone https://github.com/adrifer/winix.git
cd winix
npm install
npm run check
npm test -- --run
npm run build
```

## License

MIT
