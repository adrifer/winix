import { workspace, host, nixos, platforms, profile } from "@adrifer/winix";
import { inputs } from "./inputs";
import { adrifer } from "./users/adrifer";
import { developer } from "./roles/developer";
import { wsl } from "./features/wsl";
import { workSysctl } from "./features/work-sysctl";
import { homebrew } from "./features/homebrew";

const base = profile("base", [adrifer(), developer()]);

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
      base(),
      wsl({ defaultUser: "adrifer" }),
      workSysctl(),
      nixos.packages("socat", "bubblewrap"),
    ]),

    host("macbook-pro", platforms.darwin({ stateVersion: 6, homebrew: true }), [
      base(),
      homebrew(),
    ]),
  ],
});
