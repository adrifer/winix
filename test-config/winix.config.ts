// Realistic test config: minimal WSL NixOS host
import { workspace, host, platform, feature, input, defineInputs } from "../src/index.ts";

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

// --- Platform ---
const nixos = platform("linux", (opts?: { stateVersion?: string }) => ({
  nixos: {
    imports: ["home-manager"],
    nixpkgs: { hostPlatform: "x86_64-linux", config: { allowUnfree: true } },
    nix: { settings: { "experimental-features": ["nix-command", "flakes"] } },
    system: { stateVersion: opts?.stateVersion },
    homeManager: { useGlobalPkgs: true, useUserPackages: true },
  },
}));

// --- Features ---
const wsl = feature("wsl", (opts?: { defaultUser?: string }) => ({
  nixos: {
    imports: ["nixos-wsl"],
    wsl: {
      enable: true,
      defaultUser: opts?.defaultUser ?? "adrifer",
    },
    networking: { hostName: "wsl-work" },
  },
}));

const workSysctl = feature("work-sysctl", () => ({
  nixos: {
    boot: {
      kernel: {
        sysctl: {
          "net.ipv4.ip_unprivileged_port_start": 443,
          "fs.inotify.max_user_watches": 1048576,
          "fs.inotify.max_user_instances": 1024,
          "fs.inotify.max_queued_events": 65536,
        },
      },
    },
  },
}));

const user = feature("user", () => ({
  nixos: {
    users: { users: { adrifer: { isNormalUser: true } } },
  },
  home: {
    username: "adrifer",
  },
}));

const packages = feature("packages", () => ({
  nixos: {
    environment: {
      systemPackages: ["socat", "bubblewrap"],
    },
  },
}));

const git = feature("git", () => ({
  home: {
    programs: { git: { enable: true, userName: "Adrian Fernandez Garcia" } },
  },
}));

const neovim = feature("neovim", () => ({
  home: {
    packages: ["neovim"],
    sessionVariables: { EDITOR: "nvim" },
  },
}));

const developer = feature("developer", (): any => [
  git(),
  neovim(),
]);

// --- Workspace ---
export default workspace({
  inputs,
  hosts: [
    host("wsl-work", nixos({ stateVersion: "25.05" }), [
      wsl({ defaultUser: "adrifer" }),
      user(),
      workSysctl(),
      packages(),
      developer(),
    ]),
  ],
});
