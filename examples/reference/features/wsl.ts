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
 * @description NixOS-WSL host: WSL config, extraBin, nix-ld libraries, and PATH glue for Windows VS Code Insiders
 * @category platform
 */
export const wsl = feature("wsl", () => [
  // We don't have a dedicated nixos.wsl() helper (per the helper rules:
  // no aliases for nested options). Going through `nixos({...})` keeps
  // the shape close to what you'd write in Nix while still letting the
  // surrounding code stay typed.
  nixos({
    imports: ["inputs.nixos-wsl.nixosModules.wsl"],
    wsl: {
      enable: true,
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
    environment: {
      // Derive the Windows username from $HOME (no cmd.exe shell-out)
      // and add VS Code Insiders to PATH if Windows has it installed.
      // This is the canonical 'shell out to Nix when TypeScript would
      // be uglier than the original Bash' moment.
      interactiveShellInit: nix.script(`
        win_home="$(wslpath -w "$HOME")"
        win_home_slash="''\${win_home//\\\\//}"
        win_user="''\${win_home_slash##*/}"

        user_bin="/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
        if [ -d "$user_bin" ]; then
          case ":$PATH:" in
            *":$user_bin:"*) ;;
            *) PATH="$PATH:$user_bin" ;;
          esac
        fi

        export PATH
      `),
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

  // GitHub-credential-manager-on-Windows trick: write a tiny wrapper
  // that shells out to the Windows install of GCM. This way we don't
  // depend on any work-only credential helpers.
  home.program("git", {
    settings: {
      credential: {
        helper: nix.str`${nix.expr(`pkgs.writeShellScriptBin "git-credential-manager-windows" ''
          "/mnt/c/Program Files/Git/mingw64/bin/git-credential-manager.exe" "$@"
        ''`)}/bin/git-credential-manager-windows`,
      },
    },
  }),

  playwright(),
]);
