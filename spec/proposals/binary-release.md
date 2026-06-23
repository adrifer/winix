# Proposal: `nix.binaryRelease()` helper

> **Status:** `draft`
> **Owner:** unassigned
> **Target:** Winix v0.2

## Motivation

A common pattern for custom packages today is wrapping a single prebuilt
binary release published on GitHub (or similar) per `(os, arch)`. Examples:
`azure-dev-cli` (`azd`), `gh`, `kubectl`, `terraform`, `direnv`, `pulumi`,
`ngrok`, `oh-my-posh`, etc. Most of these share the same `mkDerivation`
shape:

- Pick a tarball/zip per platform.
- Fetch it with `pkgs.fetchurl`.
- Unpack (`tar -xzf` on Linux, `unzip` on macOS).
- `install -Dm755` the binary into `$out/bin/<name>`.
- Add a `meta` block.

Today this lands in user configs as a ~50-line `nix.expr(...)` blob with no
typing, no compile-time validation, and no shared abstraction across the
half-dozen CLIs the same user is likely to install. See
[the `azure-dev-cli` example](#example-azure-developer-cli) for the dolor.

The existing `nix.expr` escape hatch is necessary and stays. This proposal
adds a dedicated helper for the single most common custom-package shape so
that 80% of binary-release CLIs become a small typed object literal instead
of a raw Nix blob.

## Non-goals

- **Not a general `mkDerivation` builder.** That would mean re-typing the
  entire stdenv surface (phases, hooks, stdenv variants, propagated inputs,
  passthru, overrides…). `nix.binaryRelease` is opinionated: one binary,
  one fetch, one install step.
- **Not a replacement for nixpkgs.** If a package is already in nixpkgs and
  reasonably recent, use it from there. This helper is for CLIs that ship
  ahead of nixpkgs, are missing from nixpkgs, or pin to a specific version
  the user owns.
- **Not a build-from-source helper.** No `cargo`, no `go`, no `make`. If you
  need to compile, drop down to `nix.expr` or write a real nixpkgs derivation.
- **Not a fetchers framework.** Only `pkgs.fetchurl` is targeted. Adding
  `fetchFromGitHub`, `fetchzip`, etc. is a separate, smaller proposal.

## Proposed API

```ts
import { feature, home, nix } from "@adrifer/winix";

export const azureDevCli = feature("azure-dev-cli", () =>
  home.packages(
    nix.binaryRelease({
      name: "azure-dev-cli",
      version: "1.25.5",
      binary: "azd",
      urlTemplate:
        "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
      platforms: {
        "x86_64-linux":  { file: "azd-linux-amd64.tar.gz", hash: "sha256-h45MPTkA/qTmXV56A3GCjKEnoKx9G1jALEpa81ZNHEk=", binary: "azd-linux-amd64" },
        "aarch64-linux": { file: "azd-linux-arm64.tar.gz", hash: "sha256-4qKxal8wKt3Uh+Ubrw8TyhD/qL59hKxEGuq91Dxx4hk=", binary: "azd-linux-arm64" },
        "x86_64-darwin": { file: "azd-darwin-amd64.zip",   hash: "sha256-ph7ts7Oy4nVXxu0H79i9Rokp8BDG1d7zan6AhfxZUAY=", binary: "azd-darwin-amd64" },
        "aarch64-darwin":{ file: "azd-darwin-arm64.zip",   hash: "sha256-pO+HW/udYlfJRDJdNyD8g0Ftck94X67cU6+rjRDbUcc=", binary: "azd-darwin-arm64" },
      },
      extraInstall: `install -Dm644 NOTICE.txt "$out/share/doc/$pname/NOTICE.txt"`,
      meta: {
        description: "Azure Developer CLI",
        homepage: "https://github.com/Azure/azure-dev",
        license: "mit",
      },
    })
  )
);
```

### Type

```ts
type Arch = "x86_64-linux" | "aarch64-linux" | "x86_64-darwin" | "aarch64-darwin";

interface BinaryReleasePlatform {
  /** Filename to download (substituted into `urlTemplate`'s `{file}`). */
  file: string;
  /** SRI hash (`sha256-...`) of the downloaded archive. */
  hash: string;
  /** Optional: name of the extracted binary, if it differs from `binary`.
   *  Defaults to `binary`. */
  binary?: string;
  /** Optional: vendor-specific platform tag substituted into `urlTemplate`'s
   *  `{platform}` (e.g. `"linux_amd64"`, `"apple_universal"`). */
  platform?: string;
}

interface BinaryReleaseMeta {
  description: string;
  homepage?: string;
  /** SPDX-style license id; renders as `pkgs.lib.licenses.<id>`. Pass a
   *  `NixExpr` for special cases. */
  license?: string | NixExpr;
  /** Defaults to `binary`. */
  mainProgram?: string;
}

interface BinaryReleaseCompletions {
  /** Command that prints the bash completion script when run. */
  bash?: string;
  /** Command that prints the fish completion script when run. */
  fish?: string;
  /** Command that prints the zsh completion script when run. */
  zsh?: string;
}

interface BinaryReleaseOpts {
  /** `pname` for the derivation. */
  name: string;
  /** `version` for the derivation. */
  version: string;
  /** Final binary name placed in `$out/bin/<binary>`. */
  binary: string;
  /** URL with `{version}`, `{file}` and optional `{platform}` placeholders.
   *  Must contain at least one of `{file}` or `{platform}`. */
  urlTemplate: string;
  /** One entry per supported `(os, arch)`. At least one required. */
  platforms: Partial<Record<Arch, BinaryReleasePlatform>>;
  /** Extra install lines appended after the main `install -Dm755`. */
  extraInstall?: string;
  /** Opt-in: add `autoPatchelfHook` to `nativeBuildInputs` on Linux for
   *  ELF binaries that link against shared libraries. */
  linuxPatchelf?: boolean;
  /** Extra `buildInputs` to expose on Linux only (typically shared libs
   *  needed by `autoPatchelfHook`, e.g. `["stdenv.cc.cc"]`). Strings are
   *  resolved under `pkgs.`; `NixExpr` values are emitted as-is. */
  linuxBuildInputs?: (string | NixExpr)[];
  /** Default `true`: emits `dontStrip = pkgs.stdenv.hostPlatform.isDarwin;`
   *  to avoid breaking signed Darwin binaries. Set `false` to opt out. */
  dontStripDarwin?: boolean;
  /** Shell completion script generation. Each entry is the command (or
   *  absolute path) that prints the completion script for that shell.
   *  Adds `installShellFiles` to `nativeBuildInputs` and runs
   *  `installShellCompletion` in `postInstall` (guarded by `canExecute`). */
  completions?: BinaryReleaseCompletions;
  meta: BinaryReleaseMeta;
}

nix.binaryRelease(opts: BinaryReleaseOpts): NixExpr;
```

### Generated Nix shape

`nix.binaryRelease(...)` emits a `pkgs.stdenvNoCC.mkDerivation` expression
shaped like:

```nix
(let
  version = "1.25.5";
  sources = {
    x86_64-linux  = { file = "..."; hash = "..."; binary = "..."; };
    aarch64-linux = { ... };
    x86_64-darwin = { ... };
    aarch64-darwin = { ... };
  };
  source = sources.${pkgs.stdenv.hostPlatform.system};
in pkgs.stdenvNoCC.mkDerivation {
  pname = "azure-dev-cli";
  inherit version;

  src = pkgs.fetchurl {
    url  = "https://.../azure-dev-cli_${version}/${source.file}";
    hash = source.hash;
  };

  nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.unzip ];

  unpackPhase = ''
    runHook preUnpack
    mkdir source
    case "$src" in
      *.zip)    unzip -q "$src" -d source ;;
      *.tar.gz) tar -xzf "$src" -C source ;;
      *.tgz)    tar -xzf "$src" -C source ;;
    esac
    sourceRoot=source
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 "${source.binary}" "$out/bin/azd"
    <extraInstall>
    runHook postInstall
  '';

  meta = {
    description = "Azure Developer CLI";
    homepage    = "https://github.com/Azure/azure-dev";
    license     = pkgs.lib.licenses.mit;
    mainProgram = "azd";
    platforms   = builtins.attrNames sources;
  };
})
```

This is the exact shape that hand-written examples like `azd` use today, so
adoption is a 1:1 replacement and there is no risk of behavior drift on
migration.

## Extended capabilities

Three real-world patterns surfaced from a survey of similar nixpkgs
recipes (`ngrok`, `1password-cli`, `direnv`, `aws-vault`, `kubelogin`,
`devbox`, javy) are folded into this proposal as opt-in fields, all
additive and retro-compatible:

### 1. `{platform}` placeholder for vendor URLs

Some vendors do not encode the full filename in the URL; they encode the
`(os, arch)` tag separately (e.g. `op_linux_amd64_v2.34.1.zip` where
`linux_amd64` is the platform tag and the version repeats). Adding an
optional `platform` per entry and `{platform}` in `urlTemplate` covers
these without dropping to `nix.expr`. Either `{file}` or `{platform}`
must be present.

### 2. `linuxPatchelf` + `linuxBuildInputs` (autoPatchelfHook)

Linux ELF binaries that link against shared libraries need `patchelf` to
be usable on NixOS. The canonical fix is `autoPatchelfHook` plus the
relevant shared libraries as `buildInputs`. Both are guarded by
`lib.optionals stdenv.hostPlatform.isLinux` so darwin remains untouched.
`linuxBuildInputs` accepts plain strings (resolved under `pkgs.`) or raw
`NixExpr` for unusual cases.

### 3. `dontStripDarwin` (default `true`)

Darwin code signatures live inside the binary; stripping invalidates the
signature and makes the binary refuse to run. Most binary releases for
darwin need `dontStrip = pkgs.stdenv.hostPlatform.isDarwin;`. Default
on; opt out with `dontStripDarwin: false`.

### 4. `completions` map

CLIs typically ship a `<cmd> completion <shell>` entry point. Passing a
`completions` map adds `installShellFiles` to `nativeBuildInputs` and
emits a `postInstall` guarded by `canExecute` (so cross-compilation
doesn't try to run the foreign binary). Supports `bash`, `fish`, `zsh`;
any subset is fine.

### Combined example (1Password CLI)

```ts
nix.binaryRelease({
  name: "1password-cli",
  version: "2.34.1",
  binary: "op",
  urlTemplate:
    "https://cache.agilebits.com/dist/1P/op2/pkg/v{version}/op_{platform}_v{version}.zip",
  platforms: {
    "x86_64-linux":  { platform: "linux_amd64", file: "op_linux_amd64_v2.34.1.zip", hash: "sha256-..." },
    "aarch64-linux": { platform: "linux_arm64", file: "op_linux_arm64_v2.34.1.zip", hash: "sha256-..." },
  },
  linuxPatchelf: true,
  linuxBuildInputs: ["stdenv.cc.cc"],
  completions: {
    bash: "$out/bin/op completion bash",
    fish: "$out/bin/op completion fish",
    zsh:  "$out/bin/op completion zsh",
  },
  meta: {
    description: "1Password command-line tool",
    homepage: "https://developer.1password.com/docs/cli/",
    license: nix.expr("pkgs.lib.licenses.unfree"),
  },
});
```

The generated Nix mirrors the `nixpkgs/_1password-cli` recipe closely.
See `examples/proposed/1password-cli/after.ts` in this PR for the
complete file.

## What this helper does NOT do

- **Single archive layout.** `unpackPhase` assumes the binary is at the
  archive root (after the canonical `mkdir source` step). For archives with
  nested directories, drop to `nix.expr`.
- **Platform-specific install steps.** If `darwin` needs a different
  `installPhase` than `linux`, drop to `nix.expr`. `extraInstall` is appended
  unconditionally to all platforms.
- **Patching or wrapping beyond `autoPatchelfHook`.** Pure copy-and-go plus
  optional `autoPatchelfHook` is the entire surface.
- **Universal binaries.** Each `(os, arch)` is a separate entry. For
  vendors that ship an apple_universal binary (1password darwin), repeat
  the same `platform`/`file`/`hash` in both darwin entries.
- **Checksums.** The user supplies SRI hashes. Validating them at TypeScript
  evaluation time is out of scope.
- **Vendored Go/Rust source builds.** This helper is for prebuilt
  binaries only. `buildGoModule`-style packages (e.g. `direnv`, `devbox`,
  `aws-vault`, `kubelogin`) belong in a separate proposal
  (`nix.buildGoModule`).
- **Multi-archive darwin formats** (`.pkg` with xar+cpio). Drop to
  `nix.expr`.

If any of these limitations bite, escape to `nix.expr`. The Winix design
goal is "small typed helpers + good escape hatch", not "every shape".

## Compile-time guarantees

- `platforms` is typed as `Partial<Record<Arch, ...>>`, so typos like
  `"x86-64-linux"` are caught.
- Empty `platforms` is a runtime error (matches the Nix behavior: nothing to
  select from).
- `urlTemplate` is a string; `{version}` and `{file}` are substituted at Nix
  evaluation time (so `version` and `file` can reference Nix bindings). The
  helper validates that the template contains `{file}` (the platform-specific
  piece) at build time.

## Example: Azure Developer CLI

### Before (current `nix.expr` blob, ~50 lines)

See `examples/proposed/azure-dev-cli/before.ts` (added in this PR).

### After (this proposal, ~20 lines)

See `examples/proposed/azure-dev-cli/after.ts` (added in this PR).

The migrated file is the same shape but typed, structured, and ready for
the next CLI the user installs (just copy + edit the platform map and the
URL template).

## Migration path

1. Land `nix.binaryRelease` (this proposal). Additive only; no existing API
   changes.
2. Users opt in per package on their own schedule.
3. Once a handful of real packages use it, harvest common shapes (e.g.
   `nix.binaryRelease.fromGitHub` shorthand that fills `urlTemplate`
   automatically) into a follow-up proposal.

## Open questions

- **Naming.** `binaryRelease` vs `binary` vs `prebuiltCli` vs `release`.
  Current bias: `binaryRelease` reads correctly at the call site
  (`nix.binaryRelease({...})`) and leaves room for sibling helpers
  (`nix.fromGitHubRelease`, `nix.fromNpm`).
- **Escape hatch for `meta.license`.** Today `license` is a string mapped to
  `pkgs.lib.licenses.<id>`. Should we also accept a `NixExpr` for users
  on weird licenses? Bias: yes, accept both.
- **Default `extraInstall`.** Several CLIs ship a `LICENSE` and/or `NOTICE`
  next to the binary. Auto-install them if present? Bias: no; explicit
  `extraInstall` keeps the helper deterministic.

## Out of scope (follow-up proposals)

- `nix.fetchFromGitHub` / `nix.fetchzip` typed fetcher helpers.
- `nix.platform.select` + `nix.when` small typed conditionals (these would
  be useful on their own but are not needed for `binaryRelease`).
- `nix.fromGitHubRelease` shorthand layered on top of `binaryRelease`
  (auto-fills `urlTemplate` from `{owner, repo, tag}`).
- **`nix.buildGoModule(...)`** — many CLIs the user installs are Go projects
  built from source with `buildGoModule` (e.g. `direnv`, `devbox`,
  `aws-vault`, `kubelogin`). Different shape (compiles vs. fetches) so
  doesn't fit here, but worth a dedicated proposal.
- **External versions JSON** (`importJSON ./versions.json` pattern). Useful
  for auto-update bots but adds maintenance surface. Re-evaluate once we
  have an auto-updater in Winix itself.
