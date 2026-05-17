import { type Fragment } from "winix";
import { inputs } from "../inputs";

interface WslOpts {
  defaultUser?: string;
}

/**
 * @description WSL integration with NixOS-WSL module, nix-ld, clipboard, and interop
 * @example wsl({ defaultUser: "adrifer" })
 * @category platform
 */
export function wsl(opts?: WslOpts): Fragment {
  return {
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
      programs: {
        git: {
          credentialHelper: "git-credential-manager-windows",
        },
      },
      shell: {
        env: { BROWSER: "wslview" },
      },
    },
  };
}
