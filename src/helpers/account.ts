import type { Fragment, FragmentFactory, NixExpr } from "../core/types.ts";
import type { PackageRef } from "../types/index.ts";
import { feature, getEvalContext } from "../sdk/index.ts";
import { nix } from "./nix.ts";

export interface AccountOpts {
  /** On NixOS, add the user to `wheel`. */
  admin?: boolean;
  /** Login shell, by package name ("zsh") or reference. Also enables the shell's NixOS or nix-darwin program. */
  shell?: string | PackageRef;
  /** The user's full name or description. */
  description?: string;
  /** The home directory. Defaults to /home/<name>, or /Users/<name> on macOS. */
  homeDirectory?: string;
  /** Same as `homeDirectory`. */
  home?: string;
  /** Home Manager's `home.stateVersion`: the release this user's Home Manager setup started on. */
  stateVersion?: string;
  /** Home Manager session variables. */
  sessionVariables?: Record<string, string>;
  /** NixOS groups to add the user to. */
  groups?: string[];
  /** More NixOS groups (merged with `groups`). */
  extraGroups?: string[];
  /** The user id. */
  uid?: number;
  /** The primary group id (macOS). */
  gid?: number;
  /** The primary group (NixOS). */
  group?: string;
  /** A normal (login) user. Defaults to true unless `isSystemUser`. */
  isNormalUser?: boolean;
  /** A system user, without a login. */
  isSystemUser?: boolean;
  /** Packages for this user (NixOS). */
  packages?: PackageRef[];
  /** SSH keys that may log in as this user. */
  openssh?: {
    /** Public keys, as text. */
    authorizedKeys?: string[];
    /** Files with public keys. */
    authorizedKeyFiles?: string[];
  };
  /** A file with the user's hashed password (NixOS). */
  hashedPasswordFile?: string;
  /** More Home Manager configuration for this user, as a fragment. */
  homeManager?: Fragment;
  /** Make the user `wsl.defaultUser` on NixOS-WSL, unless the host sets one. */
  wslDefault?: boolean;
}

export interface AccountUserRef {
  readonly kind: "account.user";
  readonly name: string;
}

export type AccountGroupMember = AccountUserRef | string;

export interface AccountUserFactory<T extends unknown[] = []>
  extends FragmentFactory<T>,
    AccountUserRef {}

export interface AccountGroupFactory<T extends unknown[] = []> extends FragmentFactory<T> {
  readonly kind: "account.group";
  readonly name: string;
}

export interface AccountGroupOpts extends Record<string, unknown> {
  /** The group id. */
  gid?: number;
  /** Users in the group, by name or by their `account.user` value. */
  members?: AccountGroupMember[];
}

export interface AccountNamespace {
  /**
   * A user on NixOS and macOS hosts, with its Home Manager configuration (so
   * `home.*` has someone to apply to). Call the result to include it in a
   * host; pass it to a WSL distro's `setup.user`.
   *
   * ```ts
   * export const alice = account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }));
   * host("wsl", platforms.wsl({ stateVersion: "25.05" }), [alice()]);
   * ```
   */
  user<T extends unknown[]>(
    name: string,
    factory: (...args: T) => AccountOpts
  ): AccountUserFactory<T>;
  /** A group on NixOS and macOS hosts. */
  group<T extends unknown[]>(
    name: string,
    factory?: (...args: T) => AccountGroupOpts
  ): AccountGroupFactory<T>;
}

export const account: AccountNamespace = {
  user: <T extends unknown[]>(
    name: string,
    factory: (...args: T) => AccountOpts
  ): AccountUserFactory<T> => {
    const fn = feature(`account:user:${name}`, (_ctx, ...args: T) =>
      accountFragment(name, factory(...args))
    ) as AccountUserFactory<T>;
    defineMetadata(fn, "name", name);
    defineMetadata(fn, "kind", "account.user");
    return fn;
  },
  group: <T extends unknown[]>(
    name: string,
    factory: (...args: T) => AccountGroupOpts = (() => ({})) as (...args: T) => AccountGroupOpts
  ): AccountGroupFactory<T> => {
    const fn = feature(`account:group:${name}`, (_ctx, ...args: T) =>
      groupFragment(name, factory(...args))
    ) as AccountGroupFactory<T>;
    defineMetadata(fn, "name", name);
    defineMetadata(fn, "kind", "account.group");
    return fn;
  },
};

function accountFragment(username: string, opts: AccountOpts): Fragment {
  const ctx = getEvalContext();
  const isDarwin = ctx.platform === "darwin";
  const isNixos = ctx.platform === "nixos" || ctx.platform === "linux";
  const usesHomebrew = ctx.activeIds.has("homebrew");
  const homeDirectory =
    opts.homeDirectory ?? opts.home ?? (isDarwin ? `/Users/${username}` : `/home/${username}`);
  const shell = normalizeShell(opts.shell);
  const nixosShellProgram = nixosShellProgramFor(opts.shell);
  const groups = unique([
    ...(opts.admin && isNixos ? ["wheel"] : []),
    ...(opts.groups ?? []),
    ...(opts.extraGroups ?? []),
  ]);
  const homeManager = opts.homeManager?.homeManager ?? opts.homeManager;

  return {
    homeManager: {
      home: {
        username,
        homeDirectory,
        ...(opts.stateVersion && { stateVersion: opts.stateVersion }),
        ...(opts.sessionVariables && { sessionVariables: opts.sessionVariables }),
      },
      programs: {
        homeManager: { enable: true },
      },
      ...(isPlainObject(homeManager) && homeManager),
    },
    ...(isNixos && {
      ...(opts.wslDefault && { __wslDefaultUser: username }),
      nixos: {
        users: {
          users: {
            [username]: {
              isNormalUser: opts.isNormalUser ?? !opts.isSystemUser,
              ...(opts.isSystemUser !== undefined && { isSystemUser: opts.isSystemUser }),
              ...(opts.description && { description: opts.description }),
              ...(groups.length > 0 && { extraGroups: groups }),
              ...(opts.uid !== undefined && { uid: opts.uid }),
              ...(opts.group && { group: opts.group }),
              ...(opts.packages && { packages: opts.packages }),
              ...(shell && { shell }),
              ...(opts.openssh && { openssh: normalizeOpenSsh(opts.openssh) }),
              ...(opts.hashedPasswordFile && { hashedPasswordFile: opts.hashedPasswordFile }),
            },
          },
          ...(shell && { defaultUserShell: shell }),
        },
        ...(nixosShellProgram && {
          programs: {
            [nixosShellProgram]: { enable: true },
          },
        }),
      },
    }),
    ...(isDarwin && {
      darwin: {
        system: { primaryUser: username },
        users: {
          users: {
            [username]: {
              home: homeDirectory,
              ...(opts.description && { description: opts.description }),
              ...(opts.uid !== undefined && { uid: opts.uid }),
              ...(opts.gid !== undefined && { gid: opts.gid }),
              ...(shell && { shell }),
              ...(opts.openssh && { openssh: normalizeOpenSsh(opts.openssh) }),
            },
          },
        },
        ...(shell && {
          environment: { shells: [shell] },
          programs: {
            ...(nixosShellProgram && { [nixosShellProgram]: { enable: true } }),
          },
        }),
        ...(usesHomebrew && { "nix-homebrew": { user: username } }),
      },
    }),
  };
}

function groupFragment(name: string, opts: AccountGroupOpts): Fragment {
  const ctx = getEvalContext();
  const isDarwin = ctx.platform === "darwin";
  const isNixos = ctx.platform === "nixos" || ctx.platform === "linux";
  const members = opts.members?.map(memberName);
  const group = {
    ...omit(opts, ["members"]),
    ...(members && { members }),
  };

  return {
    ...(isNixos && { nixos: { users: { groups: { [name]: group } } } }),
    ...(isDarwin && { darwin: { users: { groups: { [name]: group } } } }),
  };
}

function normalizeShell(shell: AccountOpts["shell"]): PackageRef | undefined {
  if (!shell) return undefined;
  return typeof shell === "string" ? nix.pkg(shell) : shell;
}

function nixosShellProgramFor(shell: AccountOpts["shell"]): string | undefined {
  const name = shellName(shell);
  return name === "zsh" || name === "fish" ? name : undefined;
}

function shellName(shell: AccountOpts["shell"]): string | undefined {
  if (typeof shell === "string") return shell;
  if (isNixExpr(shell)) return shell.expr.match(/^pkgs\.([A-Za-z0-9_-]+)$/)?.[1];
  return undefined;
}

function isNixExpr(value: unknown): value is NixExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<NixExpr>).__winixNixExpr === true &&
    typeof (value as Partial<NixExpr>).expr === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOpenSsh(openssh: NonNullable<AccountOpts["openssh"]>): Record<string, unknown> {
  return {
    authorizedKeys: {
      ...(openssh.authorizedKeys && { keys: openssh.authorizedKeys }),
      ...(openssh.authorizedKeyFiles && { keyFiles: openssh.authorizedKeyFiles }),
    },
  };
}

function memberName(member: AccountGroupMember): string {
  return typeof member === "string" ? member : member.name;
}

function defineMetadata<T extends object, K extends string, V>(target: T, key: K, value: V): void {
  Object.defineProperty(target, key, { value, configurable: true, enumerable: false });
}

function omit<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  keys: readonly K[]
): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
