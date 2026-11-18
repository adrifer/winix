// Infers a WSL setup repository from the Git checkout that holds winix.config.ts
// (`setup: { repository: "self" }`). Only local, read-only Git queries run here;
// the commit pin is still resolved against the remote into winix-windows.lock.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";

export interface InferredWslRepository {
  /** HTTPS clone URL of the tracked remote. */
  repository: string;
  /** Upstream branch name, or the commit when HEAD is detached. */
  ref: string;
  /** Config directory relative to the repository root, POSIX separators. */
  configDirectory: string;
}

export type GitRunner = (args: string[], cwd: string) => string;

const runGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();

function tryGit(git: GitRunner, args: string[], cwd: string): string | undefined {
  try { return git(args, cwd) || undefined; } catch { return undefined; }
}

export function inferWslSetupRepository(configDir: string, git: GitRunner = runGit): InferredWslRepository {
  const context = `setup.repository "self" (config directory ${configDir})`;
  let toplevel: string;
  try {
    toplevel = git(["rev-parse", "--show-toplevel"], configDir);
  } catch (error) {
    throw new Error(`${context}: not inside a Git checkout`, { cause: error });
  }
  const branch = tryGit(git, ["symbolic-ref", "--quiet", "--short", "HEAD"], configDir);
  let remote = "origin";
  let ref: string;
  if (branch) {
    const upstreamRemote = tryGit(git, ["config", "--get", `branch.${branch}.remote`], configDir);
    const upstreamMerge = tryGit(git, ["config", "--get", `branch.${branch}.merge`], configDir);
    if (upstreamRemote && upstreamRemote !== "." && upstreamMerge?.startsWith("refs/heads/")) {
      remote = upstreamRemote;
      ref = upstreamMerge.slice("refs/heads/".length);
    } else {
      ref = branch;
    }
  } else {
    ref = git(["rev-parse", "HEAD"], configDir);
  }
  const url = tryGit(git, ["remote", "get-url", remote], configDir);
  if (!url) throw new Error(`${context}: the checkout has no "${remote}" remote to clone from`);
  return {
    repository: httpsCloneUrl(url, context),
    ref,
    configDirectory: configDirectoryWithin(toplevel, configDir, context),
  };
}

/** Convert common Git remote forms (HTTPS with userinfo, scp-like SSH, ssh://) to an HTTPS clone URL. */
export function httpsCloneUrl(url: string, context = "setup.repository"): string {
  const trimmed = url.trim();
  const azureSsh = /^(?:ssh:\/\/)?[^@/]+@ssh\.dev\.azure\.com(?::22)?[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/.exec(trimmed);
  if (azureSsh) {
    const [, org, project, repo] = azureSsh;
    return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
  }
  const scp = /^[^@/\s]+@([^:/\s]+):(?!\/)(.+)$/.exec(trimmed);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch {
    throw new Error(`${context}: remote URL "${trimmed}" is not an HTTPS or SSH Git URL`);
  }
  if (parsed.protocol === "ssh:") return `https://${parsed.hostname}${parsed.pathname}`;
  if (parsed.protocol !== "https:") {
    throw new Error(`${context}: remote URL "${trimmed}" must use HTTPS or SSH; set setup.repository explicitly`);
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}

function configDirectoryWithin(toplevel: string, configDir: string, context: string): string {
  const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
  const inside = relative(real(toplevel), real(configDir));
  if (inside.startsWith("..") || /^[a-z]:/i.test(inside) || inside.startsWith(sep)) {
    throw new Error(`${context}: config directory is outside the repository root ${toplevel}`);
  }
  return inside === "" ? "." : inside.split(sep).join("/");
}
