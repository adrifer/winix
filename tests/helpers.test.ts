import { describe, expect, it } from "vitest";
import {
  evaluate,
  account,
  darwin as darwinHelpers,
  generateNix,
  home,
  host,
  nix,
  nixos as nixosHelpers,
  overlay,
  platforms,
  platform,
  profile,
  type Fragment,
  type NixosOptions,
  type ZshOptions,
  workspace,
} from "../src/index.js";

const nixos = platform("linux", () => ({
  nixos: {
    system: { stateVersion: "25.05" },
  },
}));

const darwin = platform("darwin", () => ({
  darwin: {
    system: { stateVersion: 5 },
  },
}));

describe("curated helpers", () => {
  it("platform package helpers target their platform namespaces", () => {
    expect(nixosHelpers({ networking: { hostName: "wsl" } })).toEqual({
      nixos: { networking: { hostName: "wsl" } },
    });
    expect(darwinHelpers({ homebrew: { enable: true } })).toEqual({
      darwin: { homebrew: { enable: true } },
    });
    expect(home({ programs: { git: { enable: true } } })).toEqual({
      homeManager: { programs: { git: { enable: true } } },
    });
    expect(nixosHelpers.imports("nixos-wsl")).toEqual({
      nixos: { imports: ["nixos-wsl"] },
    });
    expect(home.imports("inputs.hunk.homeManagerModules.default")).toEqual({
      homeManager: { imports: ["inputs.hunk.homeManagerModules.default"] },
    });
    expect(darwinHelpers.imports("inputs.nix-homebrew.darwinModules.nix-homebrew")).toEqual({
      darwin: { imports: ["inputs.nix-homebrew.darwinModules.nix-homebrew"] },
    });
    expect(nixosHelpers.packages("ripgrep", "fd")).toEqual({
      nixos: { packages: ["ripgrep", "fd"] },
    });
    expect(darwinHelpers.packages(["jq"])).toEqual({
      darwin: { packages: ["jq"] },
    });
    expect(darwinHelpers.homebrew({ enable: true, casks: ["visual-studio-code"] })).toEqual({
      darwin: { homebrew: { enable: true, casks: ["visual-studio-code"] } },
    });
    expect(darwinHelpers.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] } })).toEqual({
      darwin: { launchd: { user: { agents: { emacs: { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] } } } } } },
    });
    expect(darwinHelpers.launchd.daemon("cleanup", { serviceConfig: { ProgramArguments: ["cleanup"] } })).toEqual({
      darwin: { launchd: { daemons: { cleanup: { serviceConfig: { ProgramArguments: ["cleanup"] } } } } },
    });
    expect(darwinHelpers.defaults({ dock: { autohide: true } })).toEqual({
      darwin: { system: { defaults: { dock: { autohide: true } } } },
    });
    expect(home.packages(["wslu"])).toEqual({
      homeManager: { home: { packages: ["wslu"] } },
    });
  });

  it("nix.pkg() returns a Nix expression package reference", () => {
    expect(nix.pkg("zsh")).toEqual({
      __winixNixExpr: true,
      expr: "pkgs.zsh",
    });
    expect(nix.pkg("python3Packages.requests")).toEqual({
      __winixNixExpr: true,
      expr: "pkgs.python3Packages.requests",
    });
    expect(nix.pkg.stable("wslu")).toEqual({
      __winixNixExpr: true,
      expr: "pkgs.stable.wslu",
    });
  });

  it("nix.pkg() renders unquoted in generated Nix output", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          account.user("adrifer", () => ({ shell: nix.pkg("zsh"), stateVersion: "24.05" }))(),
          { nixos: { environment: { shells: [nix.pkg("zsh")] } } },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain("users.users.adrifer.shell = pkgs.zsh;");
    expect(hostNix).toContain("environment.shells = [ pkgs.zsh ];");
  });

  it("nix.str() interpolates package refs into quoted Nix strings", () => {
    expect(nix.str`${nix.pkg("neovim")}/bin/nvim -d "$LOCAL" "$REMOTE"`).toEqual({
      __winixNixExpr: true,
      expr: '"${pkgs.neovim}/bin/nvim -d \\"$LOCAL\\" \\"$REMOTE\\""',
    });
  });

  it("nix.str() renders plain strings as quoted string content", () => {
    expect(nix.str`hello ${"world"} "${"again"}"`).toEqual({
      __winixNixExpr: true,
      expr: '"hello world \\"again\\""',
    });
    expect(nix.str`literal ${"${HOME}"}`).toEqual({
      __winixNixExpr: true,
      expr: '"literal \\${HOME}"',
    });
  });

  it("home.activation() produces Home Manager activation fragments and output", () => {
    const fragment = home.activation("ensureWritableNpmrc", {
      script: "mkdir -p \"$HOME/.config/npm\"",
    });
    expect(fragment).toEqual({
      homeManager: {
        home: {
          activation: {
            ensureWritableNpmrc: {
              __winixNixExpr: true,
              expr: 'lib.hm.dag.entryAfter [ "writeBoundary" ] \'\'\nmkdir -p "$HOME/.config/npm"\n\'\'',
            },
          },
        },
      },
    });

    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("wsl-work", nixos(), [fragment])],
    });
    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain(
      "home.activation.ensureWritableNpmrc = lib.hm.dag.entryAfter [ \"writeBoundary\" ]"
    );
  });

  it("home.activation() supports custom after dependencies", () => {
    expect(home.activation("installPkgs", { after: ["writeBoundary", "ensureWritableNpmrc"], script: "npm i -g pnpm" })).toEqual({
      homeManager: {
        home: {
          activation: {
            installPkgs: {
              __winixNixExpr: true,
              expr: 'lib.hm.dag.entryAfter [ "writeBoundary" "ensureWritableNpmrc" ] \'\'\nnpm i -g pnpm\n\'\'',
            },
          },
        },
      },
    });
  });

  it("nix.optionalString() renders runtime conditional expressions", () => {
    expect(nix.optionalString(nix.isDarwin, "darwin-only")).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalString pkgs.stdenv.isDarwin "darwin-only")',
    });
    expect(nix.optionalString(nix.isLinux, "linux-only")).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalString pkgs.stdenv.isLinux "linux-only")',
    });
  });

  it("nix.optionalAttrs() renders optionalAttrs expressions", () => {
    expect(nix.optionalAttrs(nix.isDarwin, { gc: "nix-collect-garbage -d" })).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalAttrs pkgs.stdenv.isDarwin { gc = "nix-collect-garbage -d"; })',
    });
    expect(nix.optionalAttrs(nix.isLinux, { "nix-switch": "sudo nixos-rebuild switch" })).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalAttrs pkgs.stdenv.isLinux { nix-switch = "sudo nixos-rebuild switch"; })',
    });
  });

  it("nix.withPkgs() renders arbitrary package lists with pkgs in scope", () => {
    expect(nix.withPkgs(["icu", "zlib", "openssl"])).toEqual({
      __winixNixExpr: true,
      expr: "with pkgs; [ icu zlib openssl ]",
    });
  });

  it("nix.script() renders multiline Nix indented strings", () => {
    expect(nix.script(`
      export BROWSER=wslview
      echo "hello"
    `)).toEqual({
      __winixNixExpr: true,
      expr: '\'\'\n      export BROWSER=wslview\n      echo "hello"\n\'\'',
    });
  });

  it("nix.concat() joins Nix expressions with plus", () => {
    expect(nix.concat(nix.script("base"), nix.optionalString(nix.isLinux, "linux"))).toEqual({
      __winixNixExpr: true,
      expr: '\'\'\nbase\n\'\' + (lib.optionalString pkgs.stdenv.isLinux "linux")',
    });
  });

  it("nix.lib priority helpers render lib option priority calls", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            nixos: {
              wsl: { defaultUser: nix.lib.mkDefault("adrifer") },
              services: { openssh: { enable: nix.lib.mkForce(true) } },
            },
          },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain('wsl.defaultUser = lib.mkDefault "adrifer";');
    expect(hostNix).toContain("services.openssh.enable = lib.mkForce true;");
  });

  it("quotes keys with URLs and special characters in generated Nix output", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            homeManager: {
              home: { username: "adrifer" },
              programs: {
                git: {
                  settings: {
                    credential: {
                      "https://dev.azure.com": { useHttpPath: true },
                      "urn:schemas-microsoft-com:asm.v3": { enabled: true },
                    },
                    versions: {
                      "2.4.0": "enabled",
                    },
                  },
                },
              },
            },
          },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain('programs.git.settings.credential."https://dev.azure.com".useHttpPath = true;');
    expect(hostNix).toContain('programs.git.settings.credential."urn:schemas-microsoft-com:asm.v3".enabled = true;');
    expect(hostNix).toContain('programs.git.settings.versions."2.4.0" = "enabled";');
  });

  it("overlay.stable() produces a stable nixpkgs overlay fragment and output", () => {
    const fragment = overlay.stable("nixpkgs-stable");
    expect(fragment).toEqual({
      nixos: {
        nixpkgs: {
          overlays: [
            {
              __winixNixExpr: true,
              expr: "(final: prev: { stable = import inputs.nixpkgs-stable { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; })",
            },
          ],
        },
      },
      darwin: {
        nixpkgs: {
          overlays: [
            {
              __winixNixExpr: true,
              expr: "(final: prev: { stable = import inputs.nixpkgs-stable { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; })",
            },
          ],
        },
      },
    });

    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        nixpkgsStable: {
          url: "github:NixOS/nixpkgs/nixos-25.11",
          nixName: "nixpkgs-stable",
        },
      },
      hosts: [host("wsl-work", nixos(), [fragment])],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain(
      "nixpkgs.overlays = [ (final: prev: { stable = import inputs.nixpkgs-stable { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; }) ];"
    );
  });

  it("overlay.darwin.stable() produces a darwin stable nixpkgs overlay fragment and output", () => {
    const fragment = overlay.darwin.stable("nixpkgs-stable");
    expect(fragment).toEqual({
      darwin: {
        nixpkgs: {
          overlays: [
            {
              __winixNixExpr: true,
              expr: "(final: prev: { stable = import inputs.nixpkgs-stable { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; })",
            },
          ],
        },
      },
    });

    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        nixpkgsStable: {
          url: "github:NixOS/nixpkgs/nixos-25.11",
          nixName: "nixpkgs-stable",
        },
      },
      hosts: [host("macbook-pro", darwin(), [fragment])],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain(
      "nixpkgs.overlays = [ (final: prev: { stable = import inputs.nixpkgs-stable { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; }) ];"
    );
  });

  it("overlay.stable() composes with darwin hosts without emitting NixOS-only scope", () => {
    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        nixpkgsStable: {
          url: "github:NixOS/nixpkgs/nixos-25.11",
          nixName: "nixpkgs-stable",
        },
      },
      hosts: [host("macbook-pro", darwin(), [overlay.stable("nixpkgs-stable")])],
    });

    const [evaluated] = evaluate(ws);
    expect(evaluated.nixos).toEqual({});
    expect((evaluated.darwin as any).nixpkgs.overlays).toHaveLength(1);

    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("nixpkgs.overlays = [ (final: prev:");
    expect(hostNix).not.toContain("home-manager.useGlobalPkgs");
  });

  it("composes nix.pkg(), nix.lib.mkDefault(), and overlay in one host", () => {
    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        nixpkgsStable: {
          url: "github:NixOS/nixpkgs/nixos-25.11",
          nixName: "nixpkgs-stable",
        },
      },
      hosts: [
        host("wsl-work", nixos(), [
          overlay.stable("nixpkgs-stable"),
          account.user("adrifer", () => ({ shell: nix.pkg("zsh"), stateVersion: "24.05" }))(),
          { nixos: { wsl: { defaultUser: nix.lib.mkDefault("adrifer") } } },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain("{ config, lib, pkgs, inputs, ... }:");
    expect(hostNix).toContain("nixpkgs.overlays = [ (final: prev:");
    expect(hostNix).toContain("users.users.adrifer.shell = pkgs.zsh;");
    expect(hostNix).toContain('wsl.defaultUser = lib.mkDefault "adrifer";');
  });

  it("home.program() maps zsh options to Home Manager", () => {
    expect(
      home.program("zsh", {
        shellAliases: { g: "lazygit" },
        plugins: [{ name: "zsh-vi-mode" }],
        defaultKeymap: "viins",
        initExtra: "bindkey -v",
        envExtra: "export ZDOTDIR=$HOME",
      })
    ).toEqual({
      homeManager: {
        programs: {
            zsh: {
              enable: true,
              shellAliases: { g: "lazygit" },
              plugins: [{ name: "zsh-vi-mode" }],
              defaultKeymap: "viins",
            initExtra: "bindkey -v",
            envExtra: "export ZDOTDIR=$HOME",
          },
        },
      },
    });
  });

  it("nixos.sysctl() maps kernel settings to NixOS boot.kernel.sysctl", () => {
    expect(nixosHelpers.boot({ kernelModules: ["tcp_bbr"] })).toEqual({
      nixos: { boot: { kernelModules: ["tcp_bbr"] } },
    });
    expect(nixosHelpers.networking({ hostName: "demo", firewall: { allowedTCPPorts: [80, 443] } })).toEqual({
      nixos: { networking: { hostName: "demo", firewall: { allowedTCPPorts: [80, 443] } } },
    });
    expect(nixosHelpers.environment({ systemPackages: ["vim"], variables: { EDITOR: "vim" } })).toEqual({
      nixos: { environment: { systemPackages: ["vim"], variables: { EDITOR: "vim" } } },
    });
    expect(nixosHelpers.users({ users: { root: { shell: nix.pkg("bash") } } })).toEqual({
      nixos: { users: { users: { root: { shell: nix.pkg("bash") } } } },
    });
    expect(nixosHelpers.system({ stateVersion: "25.05" })).toEqual({
      nixos: { system: { stateVersion: "25.05" } },
    });
    expect(nixosHelpers.i18n({ defaultLocale: "en_US.UTF-8" })).toEqual({
      nixos: { i18n: { defaultLocale: "en_US.UTF-8" } },
    });
    expect(nixosHelpers.time({ timeZone: "America/Los_Angeles" })).toEqual({
      nixos: { time: { timeZone: "America/Los_Angeles" } },
    });
    expect(
      nixosHelpers.sysctl({
        "fs.inotify.max_user_watches": 1048576,
        "net.ipv4.ip_forward": "1",
      })
    ).toEqual({
      nixos: {
        boot: {
          kernel: {
            sysctl: {
              "fs.inotify.max_user_watches": 1048576,
              "net.ipv4.ip_forward": "1",
            },
          },
        },
      },
    });
  });

  it("home.program() maps to enabled Home Manager programs", () => {
    expect(home.program("starship")).toEqual({
      homeManager: { programs: { starship: { enable: true } } },
    });
  });

  it("home.program() accepts static option types and explicit enable overrides", () => {
    const zshOptions: ZshOptions = {
      enable: false,
      shellAliases: { g: "lazygit" },
    };
    const zshProgram = home.program("zsh", zshOptions);

    expect(zshProgram).toEqual({
      homeManager: {
        programs: {
          zsh: {
            enable: false,
            shellAliases: { g: "lazygit" },
          },
        },
      },
    });
  });

  it("Fragment accepts common static NixOS option types", () => {
    const nixosOptions: NixosOptions = {
      networking: { hostName: "wsl" },
      wsl: { enable: true, defaultUser: "adrifer" },
    };
    const fragment: Fragment = { nixos: nixosOptions };

    expect(fragment.nixos?.networking?.hostName).toBe("wsl");
  });

  it("home.service() maps to enabled Home Manager services", () => {
    expect(home.service("syncthing")).toEqual({
      homeManager: { services: { syncthing: { enable: true } } },
    });
  });

  it("profile() accepts nested fragments without spread boilerplate", () => {
    const tools = profile("tools", [
      home.packages("ripgrep"),
      [home.program("starship")],
    ]);
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("wsl-work", nixos(), [tools()])],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.homeManager as any).home.packages).toContain("ripgrep");
    expect((evaluated.homeManager as any).programs.starship.enable).toBe(true);
  });

  it("platforms.nixos() provides a typed default NixOS platform", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable", homeManager: "github:nix-community/home-manager" },
      hosts: [host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [])],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.nixos as any).networking.hostName).toBe("wsl-work");
    expect((evaluated.nixos as any).system.stateVersion).toBe("25.05");
    expect((evaluated.nixos as any).homeManager.useGlobalPkgs).toBe(true);
  });

  it("account.user() configures Home Manager, NixOS users, and WSL default user", () => {
    const wsl = profile("wsl", []);
    const adrifer = account.user("adrifer", () => ({
      admin: true,
      shell: "zsh",
      stateVersion: "25.05",
      wslDefault: true,
    }));
    const media = account.group("media", () => ({ members: [adrifer, "jellyfin"] }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", platforms.nixos(), [
          wsl(),
          adrifer(),
          media(),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.homeManager as any).home.username).toBe("adrifer");
    expect((evaluated.nixos as any).users.users.adrifer.extraGroups).toContain("wheel");
    expect((evaluated.nixos as any).users.groups.media.members).toEqual(["adrifer", "jellyfin"]);
    expect((evaluated.nixos as any).programs.zsh.enable).toBe(true);
    expect((evaluated.nixos as any).wsl.defaultUser).toEqual(nix.lib.mkDefault("adrifer"));
  });

  it("account.user() configures darwin primaryUser, environment.shells, and programs", () => {
    const adrifer = account.user("adrifer", () => ({
      admin: true,
      shell: "zsh",
      stateVersion: "25.05",
    }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", platforms.darwin(), [adrifer()])],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.darwin as any).system.primaryUser).toBe("adrifer");
    expect((evaluated.darwin as any).environment.shells).toEqual([nix.pkg("zsh")]);
    expect((evaluated.darwin as any).programs.zsh.enable).toBe(true);
    expect((evaluated.darwin as any).users.users.adrifer.home).toBe("/Users/adrifer");
    expect((evaluated.darwin as any).users.users.adrifer.shell).toEqual(nix.pkg("zsh"));
  });

  it("intent helpers map common system patterns", () => {
    expect(nixosHelpers.service("openssh", { settings: { PermitRootLogin: "no" } })).toEqual({
      nixos: { services: { openssh: { enable: true, settings: { PermitRootLogin: "no" } } } },
    });
    expect(nixosHelpers.service("nginx")).toEqual({
      nixos: { services: { nginx: { enable: true } } },
    });
    expect(nixosHelpers.systemd({ services: { demo: { description: "Demo" } } })).toEqual({
      nixos: { systemd: { services: { demo: { description: "Demo" } } } },
    });
    expect(nixosHelpers.systemd({ timers: { demo: { wantedBy: ["timers.target"] } } })).toEqual({
      nixos: { systemd: { timers: { demo: { wantedBy: ["timers.target"] } } } },
    });
    expect(nixosHelpers.systemd.service("demo", { description: "Demo" })).toEqual({
      nixos: { systemd: { services: { demo: { description: "Demo" } } } },
    });
    expect(nixosHelpers.systemd.timer("demo", { wantedBy: ["timers.target"] })).toEqual({
      nixos: { systemd: { timers: { demo: { wantedBy: ["timers.target"] } } } },
    });
    expect(nixosHelpers.systemd.userService("demo", { description: "User Demo" })).toEqual({
      nixos: { systemd: { user: { services: { demo: { description: "User Demo" } } } } },
    });
    expect(nixosHelpers.systemd.tmpfiles(["d /srv/demo 0755 root root -"])).toEqual({
      nixos: { systemd: { tmpfiles: { rules: ["d /srv/demo 0755 root root -"] } } },
    });
    expect(home.env({ EDITOR: "nvim" })).toEqual({
      homeManager: { home: { sessionVariables: { EDITOR: "nvim" } } },
    });
    expect(home.path("~/.local/bin")).toEqual({
      homeManager: { home: { sessionPath: ["~/.local/bin"] } },
    });
    expect(home.configFile("nvim/init.lua", { text: "vim.o.number = true" })).toEqual({
      homeManager: { xdg: { configFile: { "nvim/init.lua": { text: "vim.o.number = true" } } } },
    });
    expect(home.files({ ".zshenv": { text: "source ~/.zshrc" } })).toEqual({
      homeManager: { home: { file: { ".zshenv": { text: "source ~/.zshrc" } } } },
    });
    expect(home.symlink("~/dotfiles/nvim/.config/nvim", { recursive: true })).toEqual({
      recursive: true,
      source: {
        __winixNixExpr: true,
        expr: 'config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/dotfiles/nvim/.config/nvim"',
      },
    });
    expect(home.program("fzf", { enableZshIntegration: true })).toEqual({
      homeManager: { programs: { fzf: { enable: true, enableZshIntegration: true } } },
    });
    expect(home.service("syncthing", { enable: false })).toEqual({
      homeManager: { services: { syncthing: { enable: false } } },
    });
    expect(nixosHelpers.nix({ gc: { automatic: true, dates: "weekly", options: "--delete-older-than 14d" } })).toEqual({
      nixos: { nix: { gc: { automatic: true, dates: "weekly", options: "--delete-older-than 14d" } } },
    });
    expect(nixosHelpers.fonts({ packages: ["noto-fonts"], enableDefaultPackages: false })).toEqual({
      nixos: { fonts: { packages: ["noto-fonts"], enableDefaultPackages: false } },
    });
    expect(nixosHelpers.security({ rtkit: { enable: true } })).toEqual({
      nixos: { security: { rtkit: { enable: true } } },
    });
    expect(nixosHelpers.virtualisation({ podman: { enable: true } })).toEqual({
      nixos: { virtualisation: { podman: { enable: true } } },
    });
    expect(nixosHelpers.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" })).toEqual({
      nixos: {
        virtualisation: {
          ociContainers: {
            containers: {
              demo: { image: "docker.io/library/nginx" },
            },
          },
        },
      },
    });
    expect(darwinHelpers.nix({ gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } } })).toEqual({
      darwin: { nix: { gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } } } },
    });
    expect(darwinHelpers.security({ pam: { services: { sudo_local: { touchIdAuth: true } } } })).toEqual({
      darwin: { security: { pam: { services: { sudo_local: { touchIdAuth: true } } } } },
    });
  });

  it("new DX helpers compose in generated Nix output", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            nixos: {
              wsl: {
                extraBin: [{ src: nix.bin("coreutils", "mkdir") }],
              },
              programs: {
                "nix-ld": {
                  libraries: nix.withPkgs(["icu", "zlib", "openssl"]),
                },
              },
            },
            homeManager: {
              programs: {
                git: {
                  settings: {
                    difftool: {
                      nvimdiff: {
                        cmd: nix.str`${nix.pkg("neovim")}/bin/nvim -d "$LOCAL" "$REMOTE"`,
                      },
                    },
                  },
                },
                zsh: {
                  shellAliases: nix.optionalAttrs(nix.isDarwin, { gc: "nix-collect-garbage -d" }),
                  initContent: nix.concat(
                    nix.script("export ZVM_VI_INSERT_ESCAPE_BINDKEY=jj"),
                    nix.optionalString(nix.isLinux, "export BROWSER=wslview")
                  ),
                },
              },
            },
          },
          home.activation("ensureWritableNpmrc", {
            script: "mkdir -p \"${config.home.homeDirectory}/.config/npm\"",
          }),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain('wsl.extraBin = [ { src = "${pkgs.coreutils}/bin/mkdir"; } ];');
    expect(hostNix).toContain("programs.nix-ld.libraries = with pkgs; [ icu zlib openssl ];");
    expect(hostNix).toContain(
      'programs.git.settings.difftool.nvimdiff.cmd = "${pkgs.neovim}/bin/nvim -d \\"$LOCAL\\" \\"$REMOTE\\"";'
    );
    expect(hostNix).toContain(
      'programs.zsh.shellAliases = (lib.optionalAttrs pkgs.stdenv.isDarwin { gc = "nix-collect-garbage -d"; });'
    );
    expect(hostNix).toContain(
      'programs.zsh.initContent = \'\'\nexport ZVM_VI_INSERT_ESCAPE_BINDKEY=jj\n\'\' + (lib.optionalString pkgs.stdenv.isLinux "export BROWSER=wslview");'
    );
    expect(hostNix).toContain("home.activation.ensureWritableNpmrc = lib.hm.dag.entryAfter");
  });

  it("helpers compose through evaluation and Nix generation", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          account.user("adrifer", () => ({ shell: "zsh", stateVersion: "24.05" }))(),
          nixosHelpers.packages("ripgrep"),
          home.packages("wslu"),
          home.program("git", {
            userName: "Adrian Fernandez Garcia",
            extraConfig: { init: { defaultBranch: "main" } },
            includes: [
              {
                condition: "gitdir:~/work/",
                contents: { user: { email: "adrifer@microsoft.com" } },
              },
            ],
          }),
          home.program("zsh", {
            shellAliases: { g: "lazygit" },
            enableCompletion: false,
            plugins: [{ name: "zsh-vi-mode" }],
          }),
          home.env({ EDITOR: "nvim" }),
          home.program("starship"),
          nixosHelpers.service("openssh"),
          home.service("syncthing"),
          nixosHelpers.sysctl({ "fs.inotify.max_user_watches": 1048576 }),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.homeManager as any).programs.git.enable).toBe(true);
    expect((evaluated.homeManager as any).programs.zsh.enableCompletion).toBe(false);

    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ ripgrep ];");
    expect(hostNix).toContain("users.users.adrifer.shell = pkgs.zsh;");
    expect(hostNix).toContain("home.packages = with pkgs; [ wslu ];");
    expect(hostNix).toContain("programs.git.extraConfig.init.defaultBranch = \"main\";");
    expect(hostNix).toContain(
      "programs.git.includes = [ { condition = \"gitdir:~/work/\"; contents.user.email = \"adrifer@microsoft.com\"; } ];"
    );
    expect(hostNix).toContain("programs.zsh.shellAliases.g = \"lazygit\";");
    expect(hostNix).toContain("programs.zsh.plugins = [ { name = \"zsh-vi-mode\"; } ];");
    expect(hostNix).toContain("programs.starship.enable = true;");
    expect(hostNix).toContain("services.openssh.enable = true;");
    expect(hostNix).toContain("services.syncthing.enable = true;");
    expect(hostNix).toContain("home.sessionVariables.EDITOR = \"nvim\";");
    expect(hostNix).toContain("\"fs.inotify.max_user_watches\" = 1048576;");
  });

  it("darwin.packages() composes with darwin hosts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", darwin(), [darwinHelpers.packages("mas")])],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ mas ];");
  });

  it("nixos.virtualisation.ociContainer() emits oci-containers", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          nixosHelpers.virtualisation({ ociContainers: { backend: "podman" } }),
          nixosHelpers.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" }),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain('virtualisation.oci-containers.backend = "podman";');
    expect(hostNix).toContain('virtualisation.oci-containers.containers.demo.image = "docker.io/library/nginx";');
  });

  it("nixos.systemd named helpers emit unit collections", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          nixosHelpers.systemd.service("demo", { serviceConfig: { Type: "oneshot" }, script: "echo demo" }),
          nixosHelpers.systemd.timer("demo", { wantedBy: ["timers.target"] }),
          nixosHelpers.systemd.userService("user-demo", { description: "User Demo" }),
          nixosHelpers.systemd.tmpfiles(["d /srv/demo 0755 root root -"]),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain('systemd.services.demo.serviceConfig.Type = "oneshot";');
    expect(hostNix).toContain('systemd.services.demo.script = "echo demo";');
    expect(hostNix).toContain('systemd.timers.demo.wantedBy = [ "timers.target" ];');
    expect(hostNix).toContain('systemd.user.services.user-demo.description = "User Demo";');
    expect(hostNix).toContain('systemd.tmpfiles.rules = [ "d /srv/demo 0755 root root -" ];');
  });

  it("darwin.defaults() emits system defaults", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", darwin(), [darwinHelpers.defaults({ dock: { autohide: true } })])],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("system.defaults.dock.autohide = true;");
  });

  it("plain darwin fragments compose with darwin hosts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("macbook-pro", darwin(), [
          { darwin: { homebrew: { enable: true } } },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("homebrew.enable = true;");
  });
});
