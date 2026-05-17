import { workspace, host } from "winix";
import { inputs } from "./inputs";
import { nixos, darwin } from "./fragments/platforms";
import { user } from "./fragments/user";
import { developer } from "./fragments/developer";
import { wsl } from "./fragments/wsl";
import { workSysctl } from "./fragments/work-sysctl";
import { homebrew } from "./fragments/homebrew";
import { packages } from "winix/fragments";

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", [
      nixos({ stateVersion: "25.05" }),
      user("adrifer"),
      developer(),
      wsl({ defaultUser: "adrifer" }),
      workSysctl(),
      packages(["socat", "bubblewrap"]),
    ]),

    host("macbook-pro", [
      darwin({ stateVersion: 6 }),
      user("adrifer"),
      developer(),
      homebrew(),
    ]),
  ],
});
