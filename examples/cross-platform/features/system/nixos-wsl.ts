import { feature, type HostDef } from "@adrifer/winix";
import { alice } from "./alice.ts";

/**
 * On a Windows host: WSL, plus a NixOS distro set up on first run as
 * `linuxHost` from this same repository. After that, the distro is managed
 * from inside WSL (`winix switch` there).
 */
export const nixosWsl = feature("nixos-wsl", ({ windows }, linuxHost: HostDef) => {
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
      host: linuxHost,
      user: alice,
    },
  });
});
