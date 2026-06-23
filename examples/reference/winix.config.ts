import { workspace, host, nixos, platforms, profile } from "@adrifer/winix";
import { inputs } from "./inputs";
import { tony } from "./users/tony";
import { developer } from "./roles/developer";
import { wsl } from "./features/wsl";
import { devSysctl } from "./features/dev-sysctl";
import { homebrew } from "./features/homebrew";

const base = profile("base", [tony(), developer()]);

export default workspace({
  inputs,

  hosts: [
    host("wsl", platforms.nixos({ stateVersion: "25.05" }), [
      base(),
      wsl({ defaultUser: "tony" }),
      devSysctl(),
      nixos.packages("socat", "bubblewrap"),
    ]),

    host("workstation", platforms.darwin({ stateVersion: 6, homebrew: true }), [
      base(),
      homebrew(),
    ]),
  ],
});
