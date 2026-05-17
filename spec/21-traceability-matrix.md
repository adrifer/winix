# Traceability matrix

| Existing scenario | Current mechanism | Winix concept | Backend target | Requirement |
|---|---|---|---|---|
| Dendritic feature composition | flake-parts/import tree | Branch graph | All | Required |
| Cross-platform feature output | Nix modules published from feature files | Feature with platform resources | Nix/Darwin/Home Manager | Required |
| NixOS host | `nixosSystem` | Host branch | NixOS | Required |
| macOS host | `darwinSystem` | Host branch | nix-darwin | Required |
| Home Manager user config | Home Manager modules | User-scoped resources | Home Manager | Required |
| WSL interop | NixOS WSL module + shell hooks | WSL profile/features | NixOS/Windows | Required |
| WSL Git Credential Manager | shell wrapper to `.exe` | Package/script resource | NixOS/WSL | Required |
| Work sysctls | host kernel sysctl | System setting resource | NixOS | Required |
| Syncthing LXC | NixOS service + timer | Service/task resources | NixOS/systemd | Required |
| Shell aliases/functions | zsh init/Home Manager | Shell resources | Home Manager/Windows profile | Required |
| Session variables | `home.sessionVariables` | Environment resource | Home Manager/Windows | Required |
| PATH entries | `home.sessionPath` | PATH resource | Home Manager/Windows | Required |
| Activation DAG | `home.activation` | Activation graph | Home Manager | Required |
| System activation | `system.activationScripts` | Activation graph | NixOS | Required |
| Nix GC defaults | Nix options | Feature resource | NixOS/Darwin | Required |
| Host GC override | host option override | Override semantics | NixOS/Darwin | Required |
| Dual nixpkgs channels | flake inputs | Input/channel resource | Nix | Required |
| Overlays | flake overlays | Overlay resource | Nix | Required |
| `allowUnfree` | nixpkgs config | Nixpkgs setting | Nix | Required |
| Platform conditionals | `pkgs.stdenv.isDarwin` | Capability/platform guard | All | Required |
| Raw Nix module | direct Nix code | Escape hatch | Nix | Required |
| Git staging flake issue | operational workaround | CLI diagnostic | Nix | Required |
| Windows packages | not in current dotfiles | Winget package resource | Windows | Required for parity |
| Windows desired state | not in current dotfiles | DSC resource | Windows | Required for parity |

