import type { Fragment, LazyFragment } from "../core/types.ts";
import type { PackageRef } from "../types/index.ts";
import { feature, getEvalContext } from "../sdk/index.ts";
import { nix } from "./nix.ts";

export interface AccountOpts {
  admin?: boolean;
  shell?: string | PackageRef;
  homeDirectory?: string;
  stateVersion?: string;
  sessionVariables?: Record<string, string>;
  groups?: string[];
  uid?: number;
  wslDefault?: boolean;
}

export function account(username: string, opts: AccountOpts = {}): LazyFragment {
  return feature(`account:${username}`, () => accountFragment(username, opts))();
}

function accountFragment(username: string, opts: AccountOpts): Fragment {
  const ctx = getEvalContext();
  const isDarwin = ctx.platform === "darwin";
  const isNixos = ctx.platform === "nixos" || ctx.platform === "linux";
  const isWsl = ctx.activeIds.has("wsl");
  const usesHomebrew = ctx.activeIds.has("homebrew");
  const homeDirectory =
    opts.homeDirectory ?? (isDarwin ? `/Users/${username}` : `/home/${username}`);
  const shell = normalizeShell(opts.shell);
  const groups = unique([
    ...(opts.admin && isNixos ? ["wheel"] : []),
    ...(opts.groups ?? []),
  ]);

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
    },
    ...(isNixos && {
      nixos: {
        users: {
          users: {
            [username]: {
              isNormalUser: true,
              ...(groups.length > 0 && { extraGroups: groups }),
              ...(opts.uid !== undefined && { uid: opts.uid }),
              ...(shell && { shell }),
            },
          },
          ...(shell && { defaultUserShell: shell }),
        },
        ...(opts.wslDefault &&
          isWsl && {
            wsl: {
              defaultUser: nix.lib.mkDefault(username),
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
              ...(shell && { shell }),
            },
          },
        },
        ...(usesHomebrew && { "nix-homebrew": { user: username } }),
      },
    }),
  };
}

function normalizeShell(shell: AccountOpts["shell"]): PackageRef | undefined {
  if (!shell) return undefined;
  return typeof shell === "string" ? nix.pkg(shell) : shell;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
