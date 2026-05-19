import type { Fragment } from "../core/types.ts";
import type { GitInclude as ProgramGitInclude, GitOptions } from "../types/index.ts";

export interface GitOpts {
  userName?: GitOptions["userName"];
  userEmail?: GitOptions["userEmail"];
  defaultBranch?: string;
  difftool?: string;
  settings?: GitOptions["settings"];
  signing?: GitOptions["signing"];
  aliases?: GitOptions["aliases"];
  extraConfig?: GitOptions["extraConfig"];
  includes?: GitInclude[];
}

export interface GitInclude extends ProgramGitInclude {
  condition?: string;
  user?: { name?: string; email?: string };
}

export function git(opts: GitOpts = {}): Fragment {
  const extraConfig = mergeRecords(
    {
      ...(opts.defaultBranch && { init: { defaultBranch: opts.defaultBranch } }),
      ...(opts.difftool && { diff: { tool: opts.difftool } }),
    },
    opts.extraConfig ?? {}
  );

  return {
    homeManager: {
      programs: {
        git: {
            enable: true,
            ...(opts.userName && { userName: opts.userName }),
            ...(opts.userEmail && { userEmail: opts.userEmail }),
            ...(opts.settings && { settings: opts.settings }),
            ...(Object.keys(extraConfig).length > 0 && { extraConfig }),
          ...(opts.signing && { signing: opts.signing }),
          ...(opts.aliases && { aliases: opts.aliases }),
          ...(opts.includes && { includes: opts.includes.map(formatInclude) }),
        },
      },
    },
  };
}

function formatInclude(include: GitInclude): Record<string, unknown> {
  return {
    ...(include.condition && { condition: include.condition }),
    contents: mergeRecords(
      include.user ? { user: include.user } : {},
      include.contents ?? {}
    ),
  };
}

function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeRecords(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
