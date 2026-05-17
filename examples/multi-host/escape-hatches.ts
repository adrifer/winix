/**
 * Example: escape hatches in practice.
 * Shows all three levels of escape hatches in a real config.
 */
import { workspace, host, raw, rawModule, escape } from "winix";
import { inputs } from "./inputs";
import { nixos } from "./fragments/platforms";
import { user } from "./fragments/user";
import { wsl } from "./fragments/wsl";
import { developer } from "./fragments/developer";
import { packages } from "winix/fragments";
import { type Fragment } from "winix";

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", [
      nixos({ stateVersion: "25.05" }),
      user("adrifer"),
      developer(),
      wsl({ defaultUser: "adrifer" }),

      // Level 2: rawModule — legacy .nix file not yet migrated
      rawModule("./legacy/vscode-path.nix"),

      // Level 1: raw — inline Nix for a quick one-off
      raw.nixos(`
        environment.variables.DOTNET_ROOT = "''${pkgs.dotnet-sdk_9}/share/dotnet";
      `),

      // Normal typed fragments work alongside escape hatches
      packages(["socat", "bubblewrap"]),
    ]),
  ],
});

/**
 * Level 3: escape() inside a typed fragment.
 * Most of the fragment is typed, but initContent needs raw Nix.
 */
function vsCodePath(): Fragment {
  return {
    nixos: {
      environment: {
        interactiveShellInit: escape(`
          win_home="$(wslpath -w "$HOME")"
          win_home_slash="''${win_home//\\\\//}"
          win_user="''${win_home_slash##*/}"

          hardcoded_bin="/mnt/c/Users/track/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
          user_bin="/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"

          for d in "$hardcoded_bin" "$user_bin"; do
            if [ -d "$d" ]; then
              case ":$PATH:" in
                *":$d:"*) ;;
                *) PATH="$PATH:$d" ;;
              esac
            fi
          done
          export PATH
        `),
      },
    },
  };
}
