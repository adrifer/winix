// Test config for CLI validation
import { workspace, host, platform, feature } from "../src/index.ts";

const nixos = platform("linux", (opts?: { stateVersion?: string }) => ({
  nixos: {
    nixpkgs: { hostPlatform: "x86_64-linux", config: { allowUnfree: true } },
    nix: { settings: { experimentalFeatures: ["nix-command", "flakes"] } },
    system: { stateVersion: opts?.stateVersion },
  },
}));

const workSysctl = feature("work-sysctl", () => ({
  nixos: {
    boot: {
      kernel: {
        sysctl: {
          "fs.inotify.max_user_watches": 1048576,
          "fs.inotify.max_user_instances": 1024,
        },
      },
    },
  },
}));

const git = feature("git", () => ({
  home: { programs: { git: { enable: true } } },
}));

const neovim = feature("neovim", () => ({
  home: { packages: ["neovim"], sessionVariables: { EDITOR: "nvim" } },
}));

const developer = feature("developer", (): any => [
  git(),
  neovim(),
]);

export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
  },
  hosts: [
    host("wsl-work", [
      nixos({ stateVersion: "25.05" }),
      workSysctl(),
      developer(),
    ]),
  ],
});
