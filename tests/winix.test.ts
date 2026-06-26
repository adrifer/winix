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
  darwin as darwinHelpers,
  home,
  nixos as nixosHelpers,
  nix,
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

const wsl = feature("wsl", (_ctx, opts?: { defaultUser?: string }) => ({
  nixos: {
    wsl: { enable: true, defaultUser: opts?.defaultUser },
    packages: ["wl-clipboard"],
  },
  homeManager: {
    home: {
      packages: ["wslu"],
    },
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
  homeManager: {
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
    // developer() returns [gitFeature(), neovim()] which are themselves lazy
    const gitFeature = feature("git", () => ({
      homeManager: { programs: { git: { enable: true } } },
    }));

    const neovimFeat = feature("neovim", () => ({
      homeManager: { home: { packages: ["neovim"] } },
    }));

    const developer = feature("developer", (): any => [
      gitFeature(),
      neovimFeat(),
    ]);

    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("test", nixos(), [developer()]),
      ],
    });

    const [result] = evaluate(ws);
    expect((result.homeManager as any).programs.git.enable).toBe(true);
    expect((result.homeManager as any).home.packages).toContain("neovim");
  });

  it("platform conditionals resolve correctly", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [zsh()]),
      ],
    });

    const [result] = evaluate(ws);
    const aliases = (result.homeManager as any).programs.zsh.aliases;
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
            homeManager: {
              home: { username: "adrifer" },
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

    expect(hostNix).toContain("home-manager.users.adrifer = { config, lib, pkgs, ... }: {");
    expect(hostNix).toContain("programs.git.enable = true;");
    expect(hostNix).toContain("programs.git.userName = \"Adrian Fernandez Garcia\";");
    expect(hostNix).not.toContain("home.programs.git.enable");
  });

  it("renders rawModule imports and preserves explicit imports", () => {
    const ws = workspace({
      inputs: {
        nixpkgs: "nixos-unstable",
        homeManager: "github:nix-community/home-manager",
      },
      hosts: [
        host("wsl-work", nixos(), [
          { nixos: { imports: ["inputs.home-manager.nixosModules.home-manager"] } },
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

  it("renders rawModule.homeManager imports inside the Home Manager user module", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { homeManager: { home: { username: "adrifer" } } },
          rawModule.homeManager("./legacy/home.nix"),
        ]),
      ],
    });

    const evaluated = evaluate(ws);
    const output = generateNix(ws, evaluated);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("home-manager.users.adrifer = { config, lib, pkgs, ... }: {");
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

  it("renders nix.expr() values as verbatim Nix expressions", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            nixos: {
              users: {
                users: {
                  adrifer: {
                    shell: nix.expr("pkgs.zsh"),
                  },
                },
              },
              environment: {
                systemPackages: ["git", nix.expr("nodejs_20")],
              },
            },
            homeManager: {
              home: { username: "adrifer" },
              programs: {
                zsh: {
                  initExtra: nix.expr("''\nexport EDITOR=nvim\n''"),
                },
              },
            },
          },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    const output = generateNix(ws, [evaluated]);
    const hostNix = output.hosts["wsl-work.nix"];

    expect(hostNix).toContain("users.users.adrifer.shell = pkgs.zsh;");
    expect(hostNix).toContain("environment.systemPackages = with pkgs; [ git nodejs_20 ];");
    expect(hostNix).toContain("programs.zsh.initExtra = ''\nexport EDITOR=nvim\n'';");
  });

  it("treats nix.expr() values as merge atoms with last value winning", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { nixos: { services: { demo: { value: nix.expr("pkgs.old") } } } },
          { nixos: { services: { demo: { value: nix.expr("pkgs.new") } } } },
        ]),
      ],
    });

    const [evaluated] = evaluate(ws);
    expect((evaluated.nixos as any).services.demo.value).toEqual(nix.expr("pkgs.new"));
    const hostNix = generateNix(ws, [evaluated]).hosts["wsl-work.nix"];
    expect(hostNix).toContain("services.demo.value = pkgs.new;");
  });

  it("renders nixos.raw/home.raw/darwin.raw fragments verbatim", () => {
    const linuxWs = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { homeManager: { home: { username: "adrifer" } } },
          nixosHelpers.raw("environment.variables.FOO = \"bar\";"),
          home.raw("programs.zsh.initExtra = ''\necho raw\n'';"),
        ]),
      ],
    });
    const linuxHostNix = generateNix(linuxWs, evaluate(linuxWs)).hosts["wsl-work.nix"];
    expect(linuxHostNix).toContain("environment.variables.FOO = \"bar\";");
    expect(linuxHostNix).toContain("programs.zsh.initExtra = ''\n    echo raw\n    '';");

    const darwin = platform("darwin", () => ({
      darwin: { nixpkgs: { hostPlatform: "x86_64-darwin" } },
    }));
    const darwinWs = workspace({
      inputs: { nixpkgs: "nixos-unstable", nixDarwin: "github:nix-darwin/nix-darwin" },
      hosts: [host("macbook-pro", darwin(), [darwinHelpers.raw("system.activationScripts.example.text = \"echo hello\";")])],
    });
    const darwinHostNix = generateNix(darwinWs, evaluate(darwinWs)).hosts["macbook-pro.nix"];
    expect(darwinHostNix).toContain("system.activationScripts.example.text = \"echo hello\";");
  });

  it("maps known camelCase option paths to kebab-case Nix paths", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          {
            nixos: {
              nix: { settings: { experimentalFeatures: ["nix-command", "flakes"] } },
              programs: { nixLd: { enable: true, libraries: ["icu"] } },
              services: { openSsh: { enable: true } },
            },
            homeManager: {
              home: { username: "adrifer" },
              programs: {
                git: { userName: "Adrian Fernandez Garcia" },
                zsh: { syntaxHighlighting: { enable: true } },
              },
            },
          },
        ]),
      ],
    });

    const hostNix = generateNix(ws, evaluate(ws)).hosts["wsl-work.nix"];
    expect(hostNix).toContain("nix.settings.experimental-features = [ \"nix-command\" \"flakes\" ];");
    expect(hostNix).toContain("programs.nix-ld.enable = true;");
    expect(hostNix).toContain("programs.nix-ld.libraries = [ \"icu\" ];");
    expect(hostNix).toContain("services.open-ssh.enable = true;");
    expect(hostNix).toContain("programs.git.userName = \"Adrian Fernandez Garcia\";");
    expect(hostNix).toContain("programs.zsh.syntaxHighlighting.enable = true;");
    expect(hostNix).not.toContain("programs.git.user-name");
    expect(hostNix).not.toContain("programs.zsh.syntax-highlighting");
  });

  it("uses nixpkgs.hostPlatform for generated flake systems", () => {
    const linux = platform("linux", () => ({
      nixos: { nixpkgs: { hostPlatform: "aarch64-linux" } },
    }));
    const darwin = platform("darwin", () => ({
      darwin: { nixpkgs: { hostPlatform: "x86_64-darwin" } },
    }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable", nixDarwin: "github:nix-darwin/nix-darwin" },
      hosts: [
        host("linux-arm", linux(), []),
        host("mac-intel", darwin(), []),
      ],
    });

    const flakeNix = generateNix(ws, evaluate(ws))["flake.nix"];
    expect(flakeNix).toContain("nixosConfigurations.linux-arm");
    expect(flakeNix).toContain("system = \"aarch64-linux\";");
    expect(flakeNix).toContain("darwinConfigurations.mac-intel");
    expect(flakeNix).toContain("system = \"x86_64-darwin\";");
  });

  it("warns when darwin hosts are generated without a nix-darwin input", () => {
    const darwin = platform("darwin", () => ({
      darwin: { system: { stateVersion: 6 } },
    }));
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("macbook-pro", darwin(), [])],
    });

    const output = generateNix(ws, evaluate(ws));
    expect(output.warnings).toContain(
      "darwin host detected but workspace inputs do not include nix-darwin"
    );
  });

  it("warns when home-manager imports are generated without a home-manager input", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl-work", nixos(), [
          { nixos: { imports: ["inputs.home-manager.nixosModules.home-manager"] } },
        ]),
      ],
    });

    const output = generateNix(ws, evaluate(ws));
    expect(output.warnings).toContain(
      "home-manager module import detected but workspace inputs do not include home-manager"
    );
  });
});

describe("Context injection", () => {
  it("injects the declaration namespaces into a feature callback", () => {
    let seen: string[] = [];
    const f = feature("ctx-probe", (ctx) => {
      // Reset each call (the factory may run more than once during evaluation).
      seen = ["home", "nixos", "darwin", "windows", "platforms"].filter(
        (key) => key in ctx
      );
      // nix/account/overlay are intentionally NOT injected (file-level globals).
      for (const absent of ["nix", "account", "overlay"]) {
        if (absent in ctx) seen.push(`UNEXPECTED:${absent}`);
      }
      return ctx.home.program("git");
    });

    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    const [result] = evaluate(ws);

    expect(seen).toEqual(["home", "nixos", "darwin", "windows", "platforms"]);
    expect((result.homeManager as any).programs.git.enable).toBe(true);
  });

  it("context namespaces behave identically to the global imports", () => {
    // Destructured-from-context and global home produce the same fragment.
    const viaContext = feature("via-context", ({ home: h }) => h.program("git"));
    const viaGlobal = feature("via-global", () => home.program("git"));

    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("a", nixos({ stateVersion: "25.05" }), [viaContext()]),
        host("b", nixos({ stateVersion: "25.05" }), [viaGlobal()]),
      ],
    });
    const [a, b] = evaluate(ws);
    expect(a.homeManager).toEqual(b.homeManager);
  });

  it("context platforms.isActive reflects the evaluating host", () => {
    // The local test platform is registered with id "linux" (see top of file),
    // so platforms.darwin.isActive must be false while evaluating it.
    const results: boolean[] = [];
    const f = feature("plat-probe", ({ platforms }) => {
      results.push(platforms.darwin.isActive);
      return home.program("git");
    });
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    evaluate(ws);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((v) => v === false)).toBe(true);
  });

  it("host accepts a callback body with injected context (inline declarations)", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("inline", nixos({ stateVersion: "25.05" }), ({ home: h, nixos: n }) => [
          h.packages("socat", "bubblewrap"),
          n.imports("some-module"),
        ]),
      ],
    });
    const [result] = evaluate(ws);
    expect((result.homeManager as any).home.packages).toEqual(["socat", "bubblewrap"]);
    expect((result.nixos as any).imports).toContain("some-module");
  });

  it("host callback and array forms produce equivalent results", () => {
    const arrayForm = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("x", nixos({ stateVersion: "25.05" }), [home.packages("jq")]),
      ],
    });
    const callbackForm = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("x", nixos({ stateVersion: "25.05" }), ({ home: h }) => h.packages("jq")),
      ],
    });
    const [a] = evaluate(arrayForm);
    const [b] = evaluate(callbackForm);
    expect(a.homeManager).toEqual(b.homeManager);
  });
});

describe("Effect registration", () => {
  it("registers declarations by effect with no return statement", () => {
    const f = feature("effects", ({ home, nixos }) => {
      home.program("git");
      home.packages("jq", "ripgrep");
      nixos.imports("some-module");
      // no return
    });
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    const [result] = evaluate(ws);
    expect((result.homeManager as any).programs.git.enable).toBe(true);
    expect((result.homeManager as any).home.packages).toEqual(["jq", "ripgrep"]);
    expect((result.nixos as any).imports).toContain("some-module");
  });

  it("effect form and return form produce identical output", () => {
    const viaEffect = feature("via-effect", ({ home }) => {
      home.program("git");
      home.packages("jq");
    });
    const viaReturn = feature("via-return", ({ home }) => [
      home.program("git"),
      home.packages("jq"),
    ]);
    const wsE = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [viaEffect()])],
    });
    const wsR = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [viaReturn()])],
    });
    const [e] = evaluate(wsE);
    const [r] = evaluate(wsR);
    expect(e.homeManager).toEqual(r.homeManager);
  });

  it("does not double-count a fragment that is both called and returned", () => {
    // The body registers git by effect AND returns it. It must appear once.
    const f = feature("mixed", ({ home }) => {
      const g = home.program("git");
      home.packages("jq");
      return g; // already collected as an effect
    });
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    const [result] = evaluate(ws);
    // git enabled once, jq present: a duplicate would still merge to the same
    // shape, so assert the package list too (arrays append+dedupe).
    expect((result.homeManager as any).programs.git.enable).toBe(true);
    expect((result.homeManager as any).home.packages).toEqual(["jq"]);
  });

  it("mixes effect declarations with an additional returned fragment", () => {
    // Some declared by effect, one extra only returned (not called for effect).
    const f = feature("mix2", ({ home }) => {
      home.program("git");
      // env is built but only returned, never registered via the context call
      return { homeManager: { sessionVariables: { EDITOR: "nvim" } } } as any;
    });
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    const [result] = evaluate(ws);
    expect((result.homeManager as any).programs.git.enable).toBe(true);
    expect((result.homeManager as any).sessionVariables.EDITOR).toBe("nvim");
  });

  it("global helper usage outside a body is unaffected (no collector)", () => {
    // Using the global home in a plain array entry must not be collected by any
    // ambient sink; it is just a fragment value.
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [home.program("git"), home.packages("jq")])],
    });
    const [result] = evaluate(ws);
    expect((result.homeManager as any).programs.git.enable).toBe(true);
    expect((result.homeManager as any).home.packages).toEqual(["jq"]);
  });

  it("host callback body supports effect declarations", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("inline", nixos({ stateVersion: "25.05" }), ({ home, nixos: n }) => {
          home.packages("socat");
          n.imports("mod-a");
          // no return
        }),
      ],
    });
    const [result] = evaluate(ws);
    expect((result.homeManager as any).home.packages).toEqual(["socat"]);
    expect((result.nixos as any).imports).toContain("mod-a");
  });

  it("does not treat non-fragment helper returns (HomeFile) as collectible effects", () => {
    // home.symlink(...) returns a HomeFile ({ source: NixExpr }) with no scope
    // key. The collector must ignore it (only the configFiles fragment that
    // consumes it carries it into homeManager). This pins the tightened
    // looksLikeFragment heuristic: a bare HomeFile is not swept up, and the
    // symlink reaches output only through xdg.configFile.
    const f = feature("symlink-file", ({ home }) => {
      const link = home.symlink("~/dotfiles/nvim");
      home.program("git"); // a genuine effect, alongside the non-fragment value
      return home.configFiles({ nvim: link });
    });
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [host("h", nixos({ stateVersion: "25.05" }), [f()])],
    });
    const [result] = evaluate(ws);
    const hm = result.homeManager as any;
    // The symlink landed under xdg.configFile.nvim (via configFiles)...
    expect(hm.xdg.configFile.nvim.source.__winixNixExpr).toBe(true);
    expect(hm.programs.git.enable).toBe(true);
    // ...and the bare HomeFile did not leak its `source` key anywhere else.
    expect((result as any).source).toBeUndefined();
    expect(hm.source).toBeUndefined();
    // Output is exactly the two intended keys under homeManager, nothing extra.
    expect(Object.keys(hm).sort()).toEqual(["programs", "xdg"]);
  });
});
