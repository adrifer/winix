// Realistic test config: minimal WSL NixOS host
import { account, feature, home, host, input, defineInputs, nixos, platforms, profile, workspace } from "../src/index.ts";

// --- Inputs ---
const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

// --- Features ---
const wsl = feature("wsl", () => ({
  nixos: {
    imports: ["nixos-wsl"],
    wsl: {
      enable: true,
    },
  },
}));

const workSysctl = feature("work-sysctl", () =>
  nixos.sysctl({
    "net.ipv4.ip_unprivileged_port_start": 443,
    "fs.inotify.max_user_watches": 1048576,
    "fs.inotify.max_user_instances": 1024,
    "fs.inotify.max_queued_events": 65536,
  })
);

const git = feature("git", () =>
  home.program("git", { userName: "Adrian Fernandez Garcia" })
);

const neovim = feature("neovim", () => ({
  homeManager: {
    home: {
      packages: ["neovim"],
      sessionVariables: { EDITOR: "nvim" },
    },
  },
}));

const developer = profile("developer", [
  git(),
  neovim(),
]);

// --- Workspace ---
export default workspace({
  inputs,
  hosts: [
    host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
      wsl(),
      account.user("adrifer", () => ({ admin: true, shell: "zsh", stateVersion: "25.05", wslDefault: true }))(),
      workSysctl(),
      nixos.packages("socat", "bubblewrap"),
      developer(),
    ]),
  ],
});
