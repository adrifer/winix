import { feature } from "winix";
import { inputs } from "../inputs";

interface WslOpts {
  defaultUser?: string;
}

/**
 * @description WSL integration with NixOS-WSL module, nix-ld, clipboard, and interop
 * @category platform
 */
export const wsl = feature("wsl", (opts?: WslOpts) => ({
  nixos: {
    imports: [inputs.nixosWsl],
    wsl: {
      enable: true,
      defaultUser: opts?.defaultUser,
      extraBin: [
        "coreutils/mkdir",
        "coreutils/cat",
        "coreutils/whoami",
        "coreutils/ls",
        "busybox/addgroup",
        "su/groupadd",
        "su/usermod",
      ],
      wslConf: {
        interop: { enabled: true, appendWindowsPath: false },
      },
      interop: { register: true },
    },
    packages: ["wl-clipboard"],
    programs: {
      nixLd: {
        enable: true,
        libraries: ["icu", "zlib", "openssl"],
      },
    },
  },
  home: {
    packages: ["wslu"],
    shell: {
      env: { BROWSER: "wslview" },
    },
  },
}));
