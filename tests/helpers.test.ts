import { describe, expect, it } from "vitest";
import {
  evaluate,
  account,
  firewall,
  generateNix,
  git,
  home,
  host,
  activation,
  nix,
  overlay,
  packages,
  platforms,
  platform,
  program,
  programs,
  profile,
  service,
  services,
  shell,
  sysctl,
  systemd,
  type Fragment,
  type NixosOptions,
  type ZshOptions,
  user,
  workspace,
  zsh,
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
  it("packages() targets NixOS by default and supports explicit scopes", () => {
    expect(packages("ripgrep", "fd")).toEqual({
      nixos: { packages: ["ripgrep", "fd"] },
    });
    expect(packages(["jq"], { scope: "darwin" })).toEqual({
      darwin: { packages: ["jq"] },
    });
    expect(packages(["wslu"], { scope: "homeManager" })).toEqual({
      homeManager: { home: { packages: ["wslu"] } },
    });
    expect(packages.homeManager("wslu")).toEqual({
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
          user("adrifer", { shell: nix.pkg("zsh"), stateVersion: "24.05" }),
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

  it("activation() produces Home Manager activation fragments and output", () => {
    const fragment = activation("ensureWritableNpmrc", {
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

  it("activation() supports custom after dependencies", () => {
    expect(activation("installPkgs", { after: ["writeBoundary", "ensureWritableNpmrc"], script: "npm i -g pnpm" })).toEqual({
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
          user("adrifer", { shell: nix.pkg("zsh"), stateVersion: "24.05" }),
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

  it("user() declares Home Manager user settings and optional NixOS shell", () => {
    expect(
      user("adrifer", {
        shell: "zsh",
        homeDirectory: "/home/adrifer",
        stateVersion: "24.05",
        sessionVariables: { EDITOR: "nvim" },
      })
    ).toEqual({
      homeManager: {
        home: {
          username: "adrifer",
          stateVersion: "24.05",
          homeDirectory: "/home/adrifer",
          sessionVariables: { EDITOR: "nvim" },
        },
      },
      nixos: {
        users: {
          users: {
            adrifer: {
              shell: {
                __winixNixExpr: true,
                expr: "pkgs.zsh",
              },
            },
          },
        },
      },
    });
  });

  it("git() maps common options into Home Manager programs.git", () => {
    expect(
      git({
        userName: "Adrian Fernandez Garcia",
        userEmail: "tracker086@outlook.com",
        defaultBranch: "main",
        difftool: "nvimdiff",
        aliases: { co: "checkout" },
        signing: { key: "ssh-ed25519 AAA", format: "ssh" },
        extraConfig: { push: { autoSetupRemote: true } },
        includes: [
          {
            condition: "gitdir:~/work/",
            user: { email: "adrifer@microsoft.com" },
          },
        ],
      })
    ).toEqual({
      homeManager: {
        programs: {
          git: {
            enable: true,
            userName: "Adrian Fernandez Garcia",
            userEmail: "tracker086@outlook.com",
            aliases: { co: "checkout" },
            signing: { key: "ssh-ed25519 AAA", format: "ssh" },
            extraConfig: {
              init: { defaultBranch: "main" },
              diff: { tool: "nvimdiff" },
              push: { autoSetupRemote: true },
            },
            includes: [
              {
                condition: "gitdir:~/work/",
                contents: {
                  user: { email: "adrifer@microsoft.com" },
                },
              },
            ],
          },
        },
      },
    });
  });

  it("zsh() applies defaults and maps ergonomic options to Home Manager", () => {
    expect(
      zsh({
        aliases: { g: "lazygit" },
        plugins: ["zsh-vi-mode"],
        viMode: true,
        initExtra: "bindkey -v",
        envExtra: "export ZDOTDIR=$HOME",
      })
    ).toEqual({
      homeManager: {
        programs: {
          zsh: {
            enable: true,
            enableCompletion: true,
            autosuggestion: { enable: true },
            syntaxHighlighting: { enable: true },
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

  it("shell() maps environment and PATH settings to Home Manager", () => {
    expect(shell({ env: { EDITOR: "nvim" }, path: ["$HOME/.local/bin"] })).toEqual({
      homeManager: {
        home: {
          sessionVariables: { EDITOR: "nvim" },
          sessionPath: ["$HOME/.local/bin"],
        },
      },
    });
  });

  it("sysctl() maps kernel settings to NixOS boot.kernel.sysctl", () => {
    expect(
      sysctl({
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

  it("program() maps to Home Manager programs by default", () => {
    expect(program("starship", { enable: true })).toEqual({
      homeManager: { programs: { starship: { enable: true } } },
    });
  });

  it("program() accepts static option types", () => {
    const zshProgram = program<ZshOptions>("zsh", {
      enable: true,
      shellAliases: { g: "lazygit" },
    });

    expect(zshProgram).toEqual({
      homeManager: {
        programs: {
          zsh: {
            enable: true,
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

  it("program() supports empty options", () => {
    expect(program("foo")).toEqual({
      homeManager: { programs: { foo: {} } },
    });
  });

  it("program.service() maps to NixOS services", () => {
    expect(
      program.service("openssh", {
        enable: true,
        settings: { PermitRootLogin: "no" },
      })
    ).toEqual({
      nixos: {
        services: {
          openssh: {
            enable: true,
            settings: { PermitRootLogin: "no" },
          },
        },
      },
    });
  });

  it("program.nixos() maps to top-level NixOS options", () => {
    expect(
      program.nixos("nix", {
        settings: { "experimental-features": "nix-command flakes" },
      })
    ).toEqual({
      nixos: {
        nix: {
          settings: { "experimental-features": "nix-command flakes" },
        },
      },
    });
  });

  it("program.darwin() maps to top-level nix-darwin options", () => {
    expect(program.darwin("homebrew", { enable: true })).toEqual({
      darwin: { homebrew: { enable: true } },
    });
  });

  it("program.homeService() maps to Home Manager services", () => {
    expect(program.homeService("syncthing", { enable: true })).toEqual({
      homeManager: { services: { syncthing: { enable: true } } },
    });
  });

  it("profile() accepts nested fragments without spread boilerplate", () => {
    const tools = profile("tools", [
      packages.homeManager("ripgrep"),
      [programs.enable("starship")],
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

  it("account() configures Home Manager, NixOS users, and WSL default user", () => {
    const wsl = profile("wsl", []);
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", platforms.nixos(), [
          wsl(),
          account("adrifer", { admin: true, shell: "zsh", stateVersion: "25.05", wslDefault: true }),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.homeManager as any).home.username).toBe("adrifer");
    expect((evaluated.nixos as any).users.users.adrifer.extraGroups).toContain("wheel");
    expect((evaluated.nixos as any).wsl.defaultUser).toEqual(nix.lib.mkDefault("adrifer"));
  });

  it("intent helpers map common system patterns", () => {
    expect(services.enable("openssh", { settings: { PermitRootLogin: "no" } })).toEqual({
      nixos: { services: { openssh: { enable: true, settings: { PermitRootLogin: "no" } } } },
    });
    expect(service("nginx")).toEqual({
      nixos: { services: { nginx: { enable: true } } },
    });
    expect(systemd.service("demo", { description: "Demo" })).toEqual({
      nixos: { systemd: { services: { demo: { description: "Demo" } } } },
    });
    expect(systemd.timer("demo", { wantedBy: ["timers.target"] })).toEqual({
      nixos: { systemd: { timers: { demo: { wantedBy: ["timers.target"] } } } },
    });
    expect(firewall.tcp(80, 443)).toEqual({
      nixos: { networking: { firewall: { allowedTCPPorts: [80, 443] } } },
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
    expect(nix.gc({ olderThan: "14d" })).toEqual({
      nixos: { nix: { gc: { automatic: true, dates: "weekly", options: "--delete-older-than 14d" } } },
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
          activation("ensureWritableNpmrc", {
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
          user("adrifer", { shell: "zsh", stateVersion: "24.05" }),
          packages("ripgrep"),
          packages.homeManager("wslu"),
          git({
            userName: "Adrian Fernandez Garcia",
            defaultBranch: "main",
            includes: [
              {
                condition: "gitdir:~/work/",
                user: { email: "adrifer@microsoft.com" },
              },
            ],
          }),
          zsh({
            aliases: { g: "lazygit" },
            completion: false,
            plugins: ["zsh-vi-mode"],
          }),
          shell({ env: { EDITOR: "nvim" } }),
          program("starship", { enable: true }),
          program.service("openssh", { enable: true }),
          program.homeService("syncthing", { enable: true }),
          sysctl({ "fs.inotify.max_user_watches": 1048576 }),
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

  it("packages.darwin() composes with darwin hosts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", darwin(), [packages.darwin("mas")])],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ mas ];");
  });

  it("program.darwin() composes with darwin hosts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("macbook-pro", darwin(), [
          program.darwin("homebrew", { enable: true }),
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["macbook-pro.nix"];
    expect(hostNix).toContain("homebrew.enable = true;");
  });
});
