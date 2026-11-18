import { feature, home, nix, nixos } from "@adrifer/winix";
import { playwright } from "./playwright";

/**
 * Helper for the WSL `extraBin` list: surface a single executable from
 * a nixpkgs derivation under `/bin` so Windows-side tools (like the WSL
 * launcher itself) can find them on a fresh boot before the nix profile
 * is in PATH.
 */
const bin = (packageName: string, executable: string) => ({
  src: nix.bin(packageName, executable),
});

/**
 * @description NixOS-WSL host: WSL config, extraBin, nix-ld libraries, and shims for Windows VS Code Insiders and Git Credential Manager
 * @category platform
 */
export const wsl = feature("wsl", () => [
  // We don't have a dedicated nixos.wsl() helper (per the helper rules:
  // no aliases for nested options). Going through `nixos({...})` keeps
  // the shape close to what you'd write in Nix while still letting the
  // surrounding code stay typed.
  nixos({
    // platforms.wsl() already imports the NixOS-WSL module and sets
    // wsl.enable; this feature only tunes it.
    wsl: {
      wslConf: {
        interop: {
          enabled: true,
          appendWindowsPath: false,
        },
      },
      interop: {
        register: true,
      },
      extraBin: [
        bin("coreutils", "mkdir"),
        bin("coreutils", "cat"),
        bin("coreutils", "whoami"),
        bin("coreutils", "ls"),
        bin("busybox", "addgroup"),
        bin("su", "groupadd"),
        bin("su", "usermod"),
      ],
    },
  }),

  // Lets you paste/copy across Windows + Linux apps via the Wayland
  // clipboard protocol.
  nixos.packages("wl-clipboard"),

  // nix-ld lets you run dynamically linked binaries (npm globals,
  // language servers, etc.) inside a NixOS environment by providing
  // a fallback dynamic loader.
  nixos.program("nix-ld", {
    libraries: nix.withPkgs(["icu", "zlib", "openssl"]),
  }),

  // wslu provides wsl-aware variants of xdg-open, wslview, etc.
  // Pinned to the stable channel because the unstable build occasionally
  // breaks the WSL interop assumptions wslu relies on.
  home.packages(nix.pkg.stable("wslu")),

  // Windows apps reached through interop. The shims resolve the Windows
  // user profile at run time, so no Windows user name is hard-coded.
  home.packages(
    nix.wsl.windowsBin(
      "code-insiders",
      "%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders",
    ),
  ),
  // Use Git for Windows' Credential Manager as the git credential helper.
  home.wsl.gitCredentialManager(),

  playwright(),
]);
