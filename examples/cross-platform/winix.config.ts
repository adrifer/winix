/**
 * Cross-platform example: one checkout drives a Windows desktop, the NixOS
 * WSL distro it provisions, and a Mac. The guides in docs/guides quote it.
 *
 *   winix inspect --host DESKTOP     what each feature contributes
 *   winix apply --dry --host wsl-work
 *   winix plan --host DESKTOP        (on the Windows machine)
 */

import { account, defineInputs, host, input, platforms, profile, workspace } from "@adrifer/winix";
import { git } from "./features/git.ts";
import { lazygit } from "./features/lazygit.ts";
import { powershellTerminal } from "./features/powershell-terminal.ts";
import { windowsInterop } from "./features/windows-interop.ts";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", { follows: { nixpkgs: "nixpkgs" } }),
  nixDarwin: input("github:nix-darwin/nix-darwin", { nixName: "nix-darwin", follows: { nixpkgs: "nixpkgs" } }),
  nixosWsl: input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } }),
});

const alice = account.user("alice", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

// Features for every machine. Each one contributes only what applies to the host.
const everywhere = profile("everywhere", [git(), lazygit()]);

const wslWork = host("wsl-work", platforms.wsl({ stateVersion: "25.05" }), [
  alice(),
  everywhere(),
  windowsInterop(),
]);

const macbook = host("macbook", platforms.darwin({ stateVersion: 6 }), [
  alice(),
  everywhere(),
]);

const desktop = host("DESKTOP", platforms.windows(), ({ windows }) => {
  windows.wsl();
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
    default: true,
    setup: {
      // In your own checkout, repository: "self" infers the remote, branch and
      // config directory from Git. The example spells them out.
      repository: "https://github.com/example/dotfiles.git",
      ref: "main",
      configDirectory: "winix",
      host: wslWork,
      user: alice,
    },
  });
  return [everywhere(), powershellTerminal()];
});

export default workspace({ inputs, hosts: [desktop, wslWork, macbook] });
