import { describe, expect, it } from "vitest";
import {
  evaluate,
  generateNix,
  git,
  host,
  activation,
  ifDarwin,
  ifDarwinAttrs,
  ifLinux,
  ifLinuxAttrs,
  mkDefault,
  mkForce,
  nixStr,
  overlay,
  packages,
  pkg,
  platform,
  program,
  script,
  scriptConcat,
  shell,
  sysctl,
  type Fragment,
  type NixosOptions,
  type ZshOptions,
  user,
  withPkgs,
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
    expect(packages.home("wslu")).toEqual({
      home: { packages: ["wslu"] },
    });
  });

  it("pkg() returns a Nix expression package reference", () => {
    expect(pkg("zsh")).toEqual({
      __winixNixExpr: true,
      expr: "pkgs.zsh",
    });
    expect(pkg("python3Packages.requests")).toEqual({
      __winixNixExpr: true,
      expr: "pkgs.python3Packages.requests",
    });
  });

  it("pkg() renders unquoted in generated Nix output", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          user("adrifer", { shell: pkg("zsh"), stateVersion: "24.05" }),
          { nixos: { environment: { shells: [pkg("zsh")] } } },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain("users.users.adrifer.shell = pkgs.zsh;");
    expect(hostNix).toContain("environment.shells = [ pkgs.zsh ];");
  });

  it("nixStr() interpolates package refs into quoted Nix strings", () => {
    expect(nixStr`${pkg("neovim")}/bin/nvim -d "$LOCAL" "$REMOTE"`).toEqual({
      __winixNixExpr: true,
      expr: '"${pkgs.neovim}/bin/nvim -d \\"$LOCAL\\" \\"$REMOTE\\""',
    });
  });

  it("nixStr() renders plain strings as quoted string content", () => {
    expect(nixStr`hello ${"world"} "${"again"}"`).toEqual({
      __winixNixExpr: true,
      expr: '"hello world \\"again\\""',
    });
    expect(nixStr`literal ${"${HOME}"}`).toEqual({
      __winixNixExpr: true,
      expr: '"literal \\${HOME}"',
    });
  });

  it("activation() produces Home Manager activation fragments and output", () => {
    const fragment = activation("ensureWritableNpmrc", {
      script: "mkdir -p \"$HOME/.config/npm\"",
    });
    expect(fragment).toEqual({
      home: {
        activation: {
          ensureWritableNpmrc: {
            __winixNixExpr: true,
            expr: 'lib.hm.dag.entryAfter [ "writeBoundary" ] \'\'\nmkdir -p "$HOME/.config/npm"\n\'\'',
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
      home: {
        activation: {
          installPkgs: {
            __winixNixExpr: true,
            expr: 'lib.hm.dag.entryAfter [ "writeBoundary" "ensureWritableNpmrc" ] \'\'\nnpm i -g pnpm\n\'\'',
          },
        },
      },
    });
  });

  it("ifDarwin() and ifLinux() render runtime conditional expressions", () => {
    expect(ifDarwin("darwin-only")).toEqual({
      __winixNixExpr: true,
      expr: '(if pkgs.stdenv.isDarwin then "darwin-only" else null)',
    });
    expect(ifLinux("linux-only")).toEqual({
      __winixNixExpr: true,
      expr: '(if pkgs.stdenv.isLinux then "linux-only" else null)',
    });
  });

  it("ifDarwinAttrs() and ifLinuxAttrs() render optionalAttrs expressions", () => {
    expect(ifDarwinAttrs({ gc: "nix-collect-garbage -d" })).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalAttrs pkgs.stdenv.isDarwin { gc = "nix-collect-garbage -d"; })',
    });
    expect(ifLinuxAttrs({ "nix-switch": "sudo nixos-rebuild switch" })).toEqual({
      __winixNixExpr: true,
      expr: '(lib.optionalAttrs pkgs.stdenv.isLinux { nix-switch = "sudo nixos-rebuild switch"; })',
    });
  });

  it("withPkgs() renders arbitrary package lists with pkgs in scope", () => {
    expect(withPkgs(["icu", "zlib", "openssl"])).toEqual({
      __winixNixExpr: true,
      expr: "with pkgs; [ icu zlib openssl ]",
    });
  });

  it("script() renders multiline Nix indented strings", () => {
    expect(script(`
      export BROWSER=wslview
      echo "hello"
    `)).toEqual({
      __winixNixExpr: true,
      expr: '\'\'\n      export BROWSER=wslview\n      echo "hello"\n\'\'',
    });
  });

  it("scriptConcat() joins Nix expressions with plus", () => {
    expect(scriptConcat(script("base"), ifLinux("linux"))).toEqual({
      __winixNixExpr: true,
      expr: '\'\'\nbase\n\'\' + (if pkgs.stdenv.isLinux then "linux" else null)',
    });
  });

  it("mkDefault() and mkForce() render lib option priority calls", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            nixos: {
              wsl: { defaultUser: mkDefault("adrifer") },
              services: { openssh: { enable: mkForce(true) } },
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
            home: {
              username: "adrifer",
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

  it("composes pkg(), mkDefault(), and overlay in one host", () => {
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
          user("adrifer", { shell: pkg("zsh"), stateVersion: "24.05" }),
          { nixos: { wsl: { defaultUser: mkDefault("adrifer") } } },
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
      home: {
        username: "adrifer",
        stateVersion: "24.05",
        home: { homeDirectory: "/home/adrifer" },
        sessionVariables: { EDITOR: "nvim" },
      },
      nixos: {
        users: {
          users: {
            adrifer: {
              shell: "pkgs.zsh",
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
      home: {
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
      home: {
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
      home: {
        sessionVariables: { EDITOR: "nvim" },
        sessionPath: ["$HOME/.local/bin"],
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
      home: { programs: { starship: { enable: true } } },
    });
  });

  it("program() accepts static option types", () => {
    const zshProgram = program<ZshOptions>("zsh", {
      enable: true,
      shellAliases: { g: "lazygit" },
    });

    expect(zshProgram).toEqual({
      home: {
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
      home: { programs: { foo: {} } },
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
      home: { services: { syncthing: { enable: true } } },
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
                extraBin: [{ src: nixStr`${pkg("coreutils")}/bin/mkdir` }],
              },
              programs: {
                "nix-ld": {
                  libraries: withPkgs(["icu", "zlib", "openssl"]),
                },
              },
            },
            home: {
              programs: {
                git: {
                  settings: {
                    difftool: {
                      nvimdiff: {
                        cmd: nixStr`${pkg("neovim")}/bin/nvim -d "$LOCAL" "$REMOTE"`,
                      },
                    },
                  },
                },
                zsh: {
                  shellAliases: ifDarwinAttrs({ gc: "nix-collect-garbage -d" }),
                  initContent: scriptConcat(
                    script("export ZVM_VI_INSERT_ESCAPE_BINDKEY=jj"),
                    ifLinux("export BROWSER=wslview")
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
      'programs.zsh.initContent = \'\'\nexport ZVM_VI_INSERT_ESCAPE_BINDKEY=jj\n\'\' + (if pkgs.stdenv.isLinux then "export BROWSER=wslview" else null);'
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
          packages.home("wslu"),
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
    expect((evaluated.home as any).programs.git.enable).toBe(true);
    expect((evaluated.home as any).programs.zsh.enableCompletion).toBe(false);

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
    expect(hostNix).toContain("sessionVariables.EDITOR = \"nvim\";");
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
