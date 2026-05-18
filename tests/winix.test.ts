import { describe, it, expect } from "vitest";
import {
  platform,
  feature,
  host,
  workspace,
  input,
  defineInputs,
  withContext,
  evaluate,
  generateNix,
  rawModule,
} from "../src/index.js";

// --- Define test fragments (mirrors examples/reference) ---

const nixos = platform("linux", (opts?: { stateVersion?: string }) => ({
  nixos: {
    nixpkgs: { hostPlatform: "x86_64-linux", config: { allowUnfree: true } },
    nix: { settings: { experimentalFeatures: ["nix-command", "flakes"] } },
    system: { stateVersion: opts?.stateVersion },
  },
}));

const wsl = feature("wsl", (opts?: { defaultUser?: string }) => ({
  nixos: {
    wsl: { enable: true, defaultUser: opts?.defaultUser },
    packages: ["wl-clipboard"],
  },
  home: {
    packages: ["wslu"],
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

const zsh = feature("zsh", () => ({
  home: {
    programs: {
      zsh: {
        enable: true,
        aliases: {
          g: "lazygit",
          ...(nixos.isActive && { i: "sudo nixos-rebuild switch" }),
        },
      },
    },
  },
}));

// --- Tests ---

describe("SDK helpers", () => {
  it("platform() creates lazy descriptor with .isActive", () => {
    const result = nixos({ stateVersion: "25.05" });
    expect(result.__lazy).toBe(true);
    expect(result.__platform).toBe(true);
    expect(result.__id).toBe("linux");
    // Resolve to get the actual fragment
    const resolved = withContext({ platform: "linux" }, () => result.__resolve());
    expect(resolved).toHaveProperty("nixos");
  });

  it("feature() creates lazy descriptor with .isActive", () => {
    const result = wsl({ defaultUser: "adrifer" });
    expect(result.__lazy).toBe(true);
    expect(result.__id).toBe("wsl");
    // Resolve to get the actual fragment
    const resolved = withContext({ platform: "linux", features: ["wsl"] }, () => result.__resolve());
    expect(resolved).toHaveProperty("nixos");
  });

  it(".isActive works inside withContext", () => {
    withContext({ platform: "linux", features: ["wsl"] }, () => {
      expect(nixos.isActive).toBe(true);
      expect(wsl.isActive).toBe(true);
    });

    withContext({ platform: "darwin", features: [] }, () => {
      expect(nixos.isActive).toBe(false);
      expect(wsl.isActive).toBe(false);
    });
  });
});

describe("Evaluator", () => {
  it("merges fragments for a host", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos({ stateVersion: "25.05" }), [
          wsl({ defaultUser: "adrifer" }),
          workSysctl(),
        ]),
      ],
    });

    const [result] = evaluate(ws);

    expect(result.name).toBe("wsl-work");
    expect(result.nixos).toHaveProperty("nixpkgs");
    expect(result.nixos).toHaveProperty("wsl");
    expect(result.nixos).toHaveProperty("boot");
    expect((result.nixos as any).wsl.defaultUser).toBe("adrifer");
    expect((result.nixos as any).system.stateVersion).toBe("25.05");
  });

  it("arrays are appended and deduped", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("test", nixos(), [
          wsl(),
          { nixos: { packages: ["socat"] } },
        ]),
      ],
    });

    const [result] = evaluate(ws);
    const packages = (result.nixos as any).packages;
    expect(packages).toContain("wl-clipboard");
    expect(packages).toContain("socat");
  });

  it("resolves nested composite fragments (Feature returning Fragment[])", () => {
    // developer() returns [git(), neovim()] which are themselves lazy
    const git = feature("git", () => ({
      home: { programs: { git: { enable: true } } },
    }));

    const neovimFeat = feature("neovim", () => ({
      home: { packages: ["neovim"] },
    }));

    const developer = feature("developer", (): any => [
      git(),
      neovimFeat(),
    ]);

    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("test", nixos(), [developer()]),
      ],
    });

    const [result] = evaluate(ws);
    expect((result.home as any).programs.git.enable).toBe(true);
    expect((result.home as any).packages).toContain("neovim");
  });

  it("platform conditionals resolve correctly", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [zsh()]),
      ],
    });

    const [result] = evaluate(ws);
    const aliases = (result.home as any).programs.zsh.aliases;
    expect(aliases.g).toBe("lazygit");
    expect(aliases.i).toBe("sudo nixos-rebuild switch");
  });
});

describe("Nix backend", () => {
  it("generates flake.nix with inputs", () => {
    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        homeManager: input("github:nix-community/home-manager", {
          follows: { nixpkgs: "nixpkgs" },
        }),
      },
      hosts: [host("wsl-work", nixos(), [])],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);

    expect(output["flake.nix"]).toContain("nixpkgs.url");
    expect(output["flake.nix"]).toContain("home-manager.url");
    expect(output["flake.nix"]).toContain("home-manager.inputs.nixpkgs.follows");
    expect(output["flake.nix"]).toContain("nixosConfigurations.wsl-work");
  });

  it("generates host module with merged config", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos({ stateVersion: "25.05" }), [
          workSysctl(),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("stateVersion");
    expect(hostNix).toContain("25.05");
    expect(hostNix).toContain("boot.kernel.sysctl");
    expect(hostNix).toContain("1048576");
  });

  it("renders NixOS and Home Manager package lists with pkgs scope", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          wsl({ defaultUser: "adrifer" }),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ wl-clipboard ];");
    expect(hostNix).toContain("home.packages = with pkgs; [ wslu ];");
    expect(hostNix).not.toContain("[ \"wl-clipboard\" ]");
    expect(hostNix).not.toContain("[ \"wslu\" ]");
  });

  it("renders nix-darwin package lists as system packages with pkgs scope", () => {
    const darwin = platform("darwin", () => ({
      darwin: {
        packages: ["mas"],
      },
    }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", darwin(), [])],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["macbook-pro.nix"];

    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ mas ];");
    expect(hostNix).not.toContain("[ \"mas\" ]");
  });

  it("renders Home Manager programs inside the user module", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            home: {
              username: "adrifer",
              programs: {
                git: {
                  enable: true,
                  userName: "Adrian Fernandez Garcia",
                },
              },
            },
          },
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("home-manager.users.adrifer = { pkgs, ... }: {");
    expect(hostNix).toContain("programs.git.enable = true;");
    expect(hostNix).toContain("programs.git.userName = \"Adrian Fernandez Garcia\";");
    expect(hostNix).not.toContain("home.programs.git.enable");
  });

  it("renders rawModule imports and preserves mapped imports", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { nixos: { imports: ["home-manager"] } },
          rawModule("./legacy/foo.nix"),
          rawModule("./legacy/foo.nix"),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("inputs.home-manager.nixosModules.home-manager");
    expect(hostNix).toContain("../raw-modules/legacy/foo.nix");
    expect(hostNix.match(/\.\.\/raw-modules\/legacy\/foo\.nix/g)).toHaveLength(1);
    expect(output.rawModules).toEqual([{ path: "legacy/foo.nix" }]);
  });

  it("renders rawModule.home imports inside the Home Manager user module", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { home: { username: "adrifer" } },
          rawModule.home("./legacy/home.nix"),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("home-manager.users.adrifer = { pkgs, ... }: {");
    expect(hostNix).toContain("    imports = [\n      ../raw-modules/legacy/home.nix\n    ];");
    expect(output.rawModules).toEqual([{ path: "legacy/home.nix" }]);
  });

  it("renders rawModule.darwin imports in top-level darwin imports", () => {
    const darwin = platform("darwin", () => ({
      darwin: {
        system: { stateVersion: 5 },
      },
    }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("macbook-pro", darwin(), [
          rawModule.darwin("./legacy/mac.nix"),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["macbook-pro.nix"];

    expect(hostNix).toContain("  imports = [\n    ../raw-modules/legacy/mac.nix\n  ];");
    expect(output.rawModules).toEqual([{ path: "legacy/mac.nix" }]);
  });

  it("rejects invalid rawModule paths", () => {
    expect(() => rawModule("")).toThrow("must not be empty");
    expect(() => rawModule("/legacy/foo.nix")).toThrow("workspace-relative");
    expect(() => rawModule("../legacy/foo.nix")).toThrow("must not escape");
    expect(() => rawModule("legacy/../foo.nix")).toThrow("must not escape");
    expect(() => rawModule("legacy\\foo.nix")).toThrow("POSIX path");
    expect(() => rawModule("legacy/foo.txt")).toThrow(".nix");
  });
});
