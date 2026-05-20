import { feature, home, nix, nixos } from "winix";

interface WslOpts {
  defaultUser?: string;
}

/**
 * @description WSL integration with NixOS-WSL module, nix-ld, clipboard, and interop
 * @category platform
 */
export const wsl = feature("wsl", (opts?: WslOpts) => [
  nixos({
    imports: ["nixos-wsl"],
    wsl: {
      enable: true,
      defaultUser: opts?.defaultUser,
      extraBin: [
        { src: nix.bin("coreutils", "mkdir") },
        { src: nix.bin("coreutils", "cat") },
        { src: nix.bin("coreutils", "whoami") },
        { src: nix.bin("coreutils", "ls") },
        { src: nix.bin("busybox", "addgroup") },
        { src: nix.bin("su", "groupadd") },
        { src: nix.bin("su", "usermod") },
      ],
      wslConf: {
        interop: { enabled: true, appendWindowsPath: false },
      },
      interop: { register: true },
    },
  }),
  nixos.packages("wl-clipboard"),
  nixos.program("nixLd", {
    libraries: nix.withPkgs(["icu", "zlib", "openssl"]),
  }),
  home.packages(nix.pkg.stable("wslu")),
  home.env({ BROWSER: "wslview" }),
]);
