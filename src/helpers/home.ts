import { posix as pathPosix } from "node:path";
import { normalizeArgs } from "./utils.ts";
import { getOptionalEvalContext } from "../sdk/index.ts";
import { GIT_CREDENTIAL_MANAGER_PATHS, windowsBin } from "./wsl-interop.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment, NixExpr } from "../core/types.ts";
import { escapeNixDoubleQuoted, nixStringLiteral } from "../nix/serialize.ts";
import type { HomeFile, HomeOptions, PackageRef } from "../types/index.ts";

/**
 * Map of Home Manager program names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface HomeProgramOptions {}

/**
 * Map of Home Manager service names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface HomeServiceOptions {}

export interface HomeHelper {
  /** Any Home Manager options, as an object: `home({ programs: { ... } })`. */
  (config: HomeOptions): Fragment;
  /** Import Home Manager modules (`home-manager` module paths or `inputs.x.homeManagerModules.y`). */
  imports(imports: string[]): Fragment;
  imports(...imports: string[]): Fragment;
  /**
   * Enable a Home Manager program, with its options: `programs.<name>` with
   * `enable = true`. Installs the program and writes its config.
   *
   * ```ts
   * home.program("git", { settings: { user: { name: "Alice" } } });
   * ```
   */
  program<const K extends string>(
    name: K,
    opts?: ProgramOptions<HomeProgramOptions, K>
  ): Fragment;
  /** Enable a Home Manager service, with its options: `services.<name>` with `enable = true`. */
  service<const K extends string>(
    name: K,
    opts?: ServiceOptions<HomeServiceOptions, K>
  ): Fragment;
  /** Session environment variables (`home.sessionVariables`). */
  env(vars: Record<string, string | NixExpr>): Fragment;
  /** Add folders to PATH (`home.sessionPath`). */
  path(paths: (string | NixExpr)[]): Fragment;
  path(...paths: (string | NixExpr)[]): Fragment;
  /**
   * Install packages for the user (`home.packages`), by nixpkgs attribute name
   * or `nix.pkg(...)`/`nix.binaryRelease(...)`.
   *
   * ```ts
   * home.packages("ripgrep", "fd");
   * ```
   */
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  /** Files in the home directory (`home.file`), by path relative to it. */
  files(files: Record<string, HomeFile>): Fragment;
  /** One file in ~/.config (`xdg.configFile`). */
  configFile(name: string, opts: HomeFile): Fragment;
  /**
   * Files in ~/.config (`xdg.configFile`), by path relative to it.
   *
   * ```ts
   * home.configFiles({ "lazygit/config.yml": home.symlink("./dotfiles/lazygit/config.yml") });
   * ```
   */
  configFiles(files: Record<string, HomeFile>): Fragment;
  /**
   * Out-of-store symlink source. `~/` paths are home-relative; `./` and
   * `../` paths are relative to the directory holding winix.config.ts.
   */
  symlink(path: string, opts?: Omit<HomeFile, "source" | "text">): HomeFile;
  /** A raw Nix snippet added to the Home Manager module, as written. */
  raw(config: string): Fragment;
  /** A Home Manager activation script (`home.activation.<name>`), run on every switch. */
  activation(name: string, opts: ActivationOpts): Fragment;
  /** Home Manager helpers for NixOS-WSL hosts. */
  wsl: HomeWslHelper;
}

export interface HomeWslHelper {
  /**
   * Use the Windows Git Credential Manager from WSL: enables
   * `programs.git` and sets `credential.helper` to a shim that finds
   * Git for Windows' GCM at run time.
   */
  gitCredentialManager(opts?: HomeWslGitCredentialManagerOpts): Fragment;
}

export interface HomeWslGitCredentialManagerOpts {
  /** Windows paths to try, in order. Defaults to Git for Windows' ucrt64/mingw64 GCM. */
  paths?: readonly string[];
}

type ProgramOpts = Record<string, unknown>;

export interface ActivationOpts {
  /** DAG dependencies. Defaults to ["writeBoundary"]. */
  after?: string[];
  /** Shell script body. Nix interpolations such as ${config.home.homeDirectory} are passed through. */
  script: string;
}

export const home: HomeHelper = Object.assign(
  (config: HomeOptions): Fragment => ({ homeManager: config }),
  {
    program: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      homeManager: { programs: { [name]: { enable: true, ...opts } } },
    }),
    imports: (...args: string[] | [string[]]): Fragment => ({
      homeManager: { imports: normalizeArgs(args) },
    }),
    service: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      homeManager: { services: { [name]: { enable: true, ...opts } } },
    }),
    env: (vars: Record<string, string | NixExpr>): Fragment => ({
      homeManager: { home: { sessionVariables: vars } },
    }),
    path: (...args: (string | NixExpr)[] | [(string | NixExpr)[]]): Fragment => ({
      homeManager: { home: { sessionPath: normalizeArgs(args) } },
    }),
    packages: (...args: PackageRef[] | [PackageRef[]]): Fragment => ({
      homeManager: { home: { packages: normalizeArgs(args) } },
    }),
    files: (files: Record<string, HomeFile>): Fragment => ({
      homeManager: { home: { file: files } },
    }),
    configFile: (name: string, opts: HomeFile): Fragment => ({
      homeManager: { xdg: { configFile: { [name]: opts } } },
    }),
    configFiles: (files: Record<string, HomeFile>): Fragment => ({
      homeManager: { xdg: { configFile: files } },
    }),
    symlink: (path: string, opts: Omit<HomeFile, "source" | "text"> = {}): HomeFile => ({
      ...opts,
      source: {
        __winixNixExpr: true,
        expr: `config.lib.file.mkOutOfStoreSymlink ${homePathToNixString(path)}`,
      },
    }),
    raw: (config: string): Fragment => ({ homeManager: { __raw: [config] } }),
    wsl: {
      gitCredentialManager: (opts: HomeWslGitCredentialManagerOpts = {}): Fragment => {
        const shim = windowsBin("git-credential-manager", opts.paths ?? GIT_CREDENTIAL_MANAGER_PATHS);
        return {
          homeManager: {
            programs: {
              git: {
                enable: true,
                settings: {
                  credential: {
                    helper: { __winixNixExpr: true, expr: `"\${${shim.expr}}/bin/git-credential-manager"` } as NixExpr,
                  },
                },
              },
            },
          },
        };
      },
    },
    activation: (name: string, opts: ActivationOpts): Fragment => {
      const after = opts.after ?? ["writeBoundary"];
      const afterList = after.map((s) => nixStringLiteral(s)).join(" ");
      return {
        homeManager: {
          home: {
            activation: {
              [name]: {
                __winixNixExpr: true,
                expr: `lib.hm.dag.entryAfter [ ${afterList} ] ''\n${opts.script}\n''`,
              } as NixExpr,
            },
          },
        },
      };
    },
  }
);

function homePathToNixString(path: string): string {
  if (path.startsWith("~/")) {
    return '"${config.home.homeDirectory}/' + escapeNixDoubleQuoted(path.slice(2)) + '"';
  }
  if (path.startsWith("./") || path.startsWith("../")) {
    return nixStringLiteral(configRelativePath(path));
  }
  return nixStringLiteral(path);
}

/**
 * Resolve a "./" or "../" path against the directory holding winix.config.ts,
 * matching how Windows file sources resolve. The result is an absolute POSIX
 * path into the checkout, so out-of-store symlinks follow the working tree.
 */
function configRelativePath(path: string): string {
  const configDir = getOptionalEvalContext()?.configDir;
  if (!configDir) {
    throw new Error(
      `home.symlink("${path}"): config-relative paths need the config directory; ` +
        "evaluate the workspace through the Winix CLI"
    );
  }
  const base = configDir.replace(/\\/g, "/");
  return pathPosix.normalize(pathPosix.join(base, path)).replace(/\/+$/, "");
}
