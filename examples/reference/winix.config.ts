import { workspace, host, packages } from "winix";
import { inputs } from "./inputs";
import { nixos } from "./platforms/linux";
import { darwin } from "./platforms/darwin";
import { adrifer } from "./users/adrifer";
import { developer } from "./roles/developer";
import { wsl } from "./features/wsl";
import { workSysctl } from "./features/work-sysctl";
import { homebrew } from "./features/homebrew";

const base = [adrifer(), developer()];

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", nixos({ stateVersion: "25.05" }), [
      ...base,
      wsl({ defaultUser: "adrifer" }),
      workSysctl(),
      packages("socat", "bubblewrap"),
    ]),

    host("macbook-pro", darwin({ stateVersion: 6 }), [
      ...base,
      homebrew(),
    ]),
  ],
});
