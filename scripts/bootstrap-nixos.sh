#!/usr/bin/env bash
set -euo pipefail

winix_require_nixos() {
  if [[ ! -r /etc/os-release ]] || ! (source /etc/os-release; [[ "${ID:-}" == nixos ]]); then
    printf '%s\n' 'Winix bootstrap requires an existing NixOS installation (including NixOS-WSL).' >&2
    return 1
  fi
}

winix_bootstrap_nixos() {
  if [[ $# -gt 0 ]]; then
    if [[ $# -eq 1 && ( "$1" == --help || "$1" == -h ) ]]; then
      printf '%s\n' \
        'Usage: bash bootstrap-nixos.sh' \
        'Open a temporary Git, Node.js 24/npm, and Bash environment on NixOS.' \
        'Nix downloads may populate the store; no profile or system configuration is changed.' \
        'Clone your configuration, install its npm dependencies, and run Winix yourself.' \
        'Type exit to leave the environment. No Winix installation or activation is performed.'
      return
    fi
    printf '%s\n' 'Usage: bash bootstrap-nixos.sh [--help]' >&2
    return 2
  fi

  winix_require_nixos || return
  if ! command -v nix >/dev/null 2>&1; then
    printf '%s\n' 'Nix is unavailable. Restore the NixOS Nix installation/PATH before running this bootstrap.' >&2
    return 1
  fi

  # Keep the bootstrap independent of mutable registries and user channels.
  local nixpkgs='github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f'
  export NIX_CONFIG="${NIX_CONFIG:+$NIX_CONFIG$'\n'}extra-experimental-features = nix-command flakes"
  printf '%s\n' \
    'Opening the Winix prerequisite shell (Git, Node.js 24/npm, Bash).' \
    'The first run may download packages to the Nix store.' \
    'No repositories are cloned, npm dependencies installed, or hosts activated.' \
    'Clone your config into a permanent location and run npm install and Winix yourself.' \
    'Type exit to leave. Declare permanent tools/Nix settings in your own configuration.'

  exec nix shell --no-write-lock-file \
    "$nixpkgs#git" \
    "$nixpkgs#nodejs_24" \
    "$nixpkgs#bashInteractive" \
    --command bash --noprofile --norc -i
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  winix_bootstrap_nixos "$@"
fi
