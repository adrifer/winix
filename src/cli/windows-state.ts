import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { EvaluatedHost } from "../evaluator/index.ts";
import type { WindowsOptions } from "../types/index.ts";
import { powerShellLiteral } from "../helpers/utils.ts";
import { runCommand } from "./run.ts";

export type ManagedResource =
  | { kind: "startup"; name: string }
  | { kind: "package"; id: string; source: string };
export type ResourceSnapshot = { fingerprint: string } | { version: string } | null;
interface Entry {
  resource: ManagedResource;
  owners: string[];
  owned: boolean;
  snapshot: ResourceSnapshot;
  definition: string;
}
interface AppliedState {
  version: 1;
  entries: Record<string, Entry>;
}
export interface WindowsStateAdapter {
  inspect(resource: ManagedResource): Promise<ResourceSnapshot>;
  remove(resource: ManagedResource, snapshot: NonNullable<ResourceSnapshot>): Promise<void>;
}
export interface ReconcileOptions {
  statePath: string;
  owner: string;
  desired: ManagedResource[];
  definitions: Record<string, string>;
  dry: boolean;
  yes?: boolean;
  adapter: WindowsStateAdapter;
  activate(): Promise<void>;
  report?(message: string): void;
  /** CLI switch holds this lock across backend generation as well as activation. */
  lockHeld?: boolean;
}

export function resourceKey(resource: ManagedResource): string {
  return JSON.stringify(resource.kind === "startup"
    ? ["startup", resource.name.toLowerCase()]
    : ["package", resource.source.toLowerCase(), resource.id.toLowerCase()]);
}

export function managedWindowsResources(host: EvaluatedHost): ManagedResource[] {
  const windows = host.windows as WindowsOptions;
  const resources: ManagedResource[] = Object.values(windows.packages ?? {}).map(
    (pkg) => ({ kind: "package", id: pkg.id, source: pkg.source })
  );
  for (const resource of windows.dsc ?? []) {
    if (resource.winix?.kind === "startup") {
      resources.push({ kind: "startup", name: resource.winix.name });
    }
  }
  const keys = new Set<string>();
  for (const resource of resources) {
    const key = resourceKey(resource);
    if (keys.has(key)) throw new Error(`Duplicate managed Windows resource: ${key}`);
    keys.add(key);
  }
  return resources;
}

function sameSnapshot(a: ResourceSnapshot, b: ResourceSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validResource(value: unknown): value is ManagedResource {
  if (!value || typeof value !== "object") return false;
  if ("kind" in value && value.kind === "startup") {
    return "name" in value && typeof value.name === "string" && value.name.length > 0 &&
      !/[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(value.name) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value.name);
  }
  return "kind" in value && value.kind === "package" &&
    "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "source" in value && (value.source === "winget" || value.source === "msstore");
}

export function parseAppliedState(text: string): AppliedState {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("entries" in value) || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
    throw new Error("Invalid Windows applied-state inventory; refusing reconciliation");
  }
  for (const [key, entry] of Object.entries(value.entries)) {
    if (!entry || typeof entry !== "object" || !validResource(entry.resource) ||
        key !== resourceKey(entry.resource) || typeof entry.owned !== "boolean" ||
        typeof entry.definition !== "string" ||
        !Array.isArray(entry.owners) || !entry.owners.every((owner: unknown) => typeof owner === "string") ||
        !(entry.snapshot === null || (entry.resource.kind === "startup"
          ? typeof entry.snapshot?.fingerprint === "string" && /^[a-f0-9]{64}$/.test(entry.snapshot.fingerprint)
          : typeof entry.snapshot?.version === "string" && entry.snapshot.version.length > 0))) {
      throw new Error(`Invalid Windows applied-state entry: ${key}; refusing reconciliation`);
    }
  }
  return value as AppliedState;
}

async function loadState(path: string): Promise<AppliedState> {
  try {
    return parseAppliedState(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, entries: {} };
    }
    throw error;
  }
}

async function saveState(path: string, state: AppliedState): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx" });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function withWindowsStateLock<T>(path: string, dry: boolean, action: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  if (!dry) {
    await mkdir(dirname(path), { recursive: true });
    try {
      await mkdir(lockPath);
    } catch (error) {
      throw new Error(`Cannot lock Windows applied state at ${lockPath}. Another activation may be running; ` +
        "after an interrupted activation, inspect the inventory before manually removing the stale lock.", { cause: error });
    }
  }
  try {
    return await action();
  } finally {
    if (!dry) await rm(lockPath, { recursive: true });
  }
}

export async function forgetWindowsResource(
  path: string, resource: ManagedResource, dry: boolean
): Promise<void> {
  if (!validResource(resource)) throw new Error("Invalid resource identity");
  await withWindowsStateLock(path, dry, async () => {
    const state = await loadState(path);
    const key = resourceKey(resource);
    const entry = state.entries[key];
    if (!entry) throw new Error(`No recorded resource: ${key}`);
    if (!dry) {
      // Keep other owners' requirements; release deletion rights only.
      entry.owned = false;
      await saveState(path, state);
    }
    console.log(`${dry ? "Would release" : "Released"} Winix removal ownership: ${key}. No resource was deleted.`);
  });
}

export async function confirmWindowsRemovals(yes = false): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Switch requires removal confirmation. Preview with switch --dry, then use --yes for noninteractive execution.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  prompt.once("close", () => controller.abort());
  prompt.once("SIGINT", () => controller.abort());
  try {
    const answer = await prompt.question("Continue with switch? [y/N] ", { signal: controller.signal });
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new Error("Switch cancelled. No activation or removal was performed.");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Switch cancelled. No activation or removal was performed.", { cause: error });
    }
    throw error;
  } finally {
    prompt.close();
  }
}

/**
 * One user/machine inventory, serialized across workspaces. Ownership is granted
 * only after successful activation and never inferred from version locks.
 */
export async function reconcileWindows(opts: ReconcileOptions): Promise<void> {
  const report = opts.report ?? console.log;
  const desired = new Map(opts.desired.map((resource) => [resourceKey(resource), resource]));
  if (desired.size !== opts.desired.length) throw new Error("Duplicate managed Windows resources");
  const reconcile = async () => {
    const state = await loadState(opts.statePath);
    const before = new Map<string, ResourceSnapshot>();
    for (const [key, resource] of desired) {
      const current = await opts.adapter.inspect(resource);
      before.set(key, current);
      const entry = state.entries[key];
      if (typeof opts.definitions[key] !== "string") throw new Error(`Missing resource definition: ${key}`);
      if (entry?.owners.some((owner) => owner !== opts.owner) && entry.definition !== opts.definitions[key]) {
        throw new Error(`Conflicting declaration for resource required by another workspace/host: ${key}`);
      }
      if (entry?.owned && current !== null && !sameSnapshot(current, entry.snapshot)) {
        throw new Error(`Managed resource changed outside Winix: ${key}. Restore it or explicitly resolve ownership before activation.`);
      }
    }
    const removals: [string, Entry, ResourceSnapshot][] = [];
    for (const [key, entry] of Object.entries(state.entries)) {
      if (!entry.owners.includes(opts.owner) && entry.owners.length > 0) continue;
      if (desired.has(key)) continue;
      const others = entry.owners.filter((owner) => owner !== opts.owner);
      if (others.length > 0) continue;
      if (!entry.owned) {
        report(`Leaving externally owned resource untouched: ${key}`);
        continue;
      }
      const current = await opts.adapter.inspect(entry.resource);
      if (current !== null && !sameSnapshot(current, entry.snapshot)) {
        throw new Error(`Refusing to remove externally modified resource: ${key}. Resolve ownership explicitly.`);
      }
      report(`${current === null ? "Already absent" : opts.dry ? "Would remove" : "Planned removal"}: ${key}`);
      removals.push([key, entry, current]);
    }
    if (opts.dry) {
      await opts.activate();
      return;
    }
    if (removals.some(([, , current]) => current !== null)) {
      report("Package uninstallers may remove application data.");
      await confirmWindowsRemovals(opts.yes);
    }
    await opts.activate();
    // Capture all desired outcomes before committing any new ownership.
    const after = new Map<string, ResourceSnapshot>();
    for (const [key, resource] of desired) {
      const current = await opts.adapter.inspect(resource);
      if (current === null) throw new Error(`Activation succeeded but managed resource is missing: ${key}`);
      const entry = state.entries[key];
      if (entry && entry.owners.some((owner) => owner !== opts.owner) && !sameSnapshot(current, entry.snapshot)) {
        throw new Error(`Activation changed a resource required by another workspace/host: ${key}`);
      }
      after.set(key, current);
    }
    for (const entry of Object.values(state.entries)) {
      entry.owners = entry.owners.filter((owner) => owner !== opts.owner);
    }
    for (const [key, resource] of desired) {
      const previous = state.entries[key];
      const initial = before.get(key) ?? null;
      const current = after.get(key)!;
      state.entries[key] = {
        resource,
        owners: [...(previous?.owners ?? []), opts.owner],
        owned: previous?.owned === true || initial === null ||
          (resource.kind === "startup" && !sameSnapshot(initial, current)),
        snapshot: current,
        definition: opts.definitions[key],
      };
    }
    await saveState(opts.statePath, state);
    for (const [key, entry, observed] of removals) {
      // Recheck immediately before a destructive operation, not just at plan time.
      const current = await opts.adapter.inspect(entry.resource);
      if (!sameSnapshot(current, observed)) throw new Error(`Resource changed after removal planning: ${key}`);
      if (current !== null) {
        await opts.adapter.remove(entry.resource, current);
        if (await opts.adapter.inspect(entry.resource) !== null) throw new Error(`Resource still exists after removal: ${key}`);
      }
      delete state.entries[key];
      await saveState(opts.statePath, state);
      report(`Removed: ${key}`);
    }
    for (const [key, entry] of Object.entries(state.entries)) {
      if (!entry.owned && entry.owners.length === 0) delete state.entries[key];
    }
    await saveState(opts.statePath, state);
  };
  if (opts.lockHeld) await reconcile();
  else await withWindowsStateLock(opts.statePath, opts.dry, reconcile);
}

function powershell(script: string): string {
  return execFileSync("pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from("$ErrorActionPreference = 'Stop'\n" + script, "utf16le").toString("base64"),
  ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 }).trim();
}

function startupPathScript(name: string): string {
  return `$root = [Environment]::GetFolderPath('Startup')
if (-not $root) { throw 'Windows Startup folder is unavailable' }
$path = Join-Path $root ${powerShellLiteral(name + ".lnk")}`;
}

function packageState(resource: Extract<ManagedResource, { kind: "package" }>): ResourceSnapshot {
  const result: unknown = JSON.parse(execFileSync("dsc", [
    "resource", "get", "--resource", "Microsoft.WinGet/Package", "--file", "-",
  ], {
    encoding: "utf8", input: JSON.stringify({ id: resource.id, source: resource.source }),
    stdio: ["pipe", "pipe", "pipe"], timeout: 60000,
  }));
  if (!result || typeof result !== "object" || !("actualState" in result) ||
      !result.actualState || typeof result.actualState !== "object") throw new Error("Invalid package inventory response");
  const state = result.actualState;
  if (!("id" in state) || typeof state.id !== "string" ||
      state.id.toLowerCase() !== resource.id.toLowerCase() ||
      !("source" in state) || typeof state.source !== "string" ||
      state.source.toLowerCase() !== resource.source.toLowerCase()) {
    throw new Error(`Package inventory identity mismatch for ${resource.id}`);
  }
  if ("_exist" in state && state._exist === false) return null;
  if (!("_exist" in state) || state._exist !== true || !("version" in state) ||
      typeof state.version !== "string" || !state.version) {
    throw new Error(`Cannot determine installed version of ${resource.id}; refusing ownership tracking`);
  }
  return { version: state.version };
}

export const nativeWindowsStateAdapter: WindowsStateAdapter = {
  async inspect(resource) {
    if (resource.kind === "package") return packageState(resource);
    const hash = powershell(`${startupPathScript(resource.name)}
if (Test-Path -LiteralPath $path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Startup entry is not a file: $path" }
  (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}`);
    if (!hash) return null;
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid startup fingerprint");
    return { fingerprint: hash };
  },
  async remove(resource, snapshot) {
    if (resource.kind === "package") {
      if (!("version" in snapshot)) throw new Error("Missing package version for uninstall");
      await runCommand("winget", [
        "uninstall", "--id", resource.id, "--exact", "--source", resource.source,
        "--version", snapshot.version, "--silent", "--disable-interactivity",
      ]);
    } else {
      if (!("fingerprint" in snapshot)) throw new Error("Missing shortcut fingerprint for removal");
      powershell(`${startupPathScript(resource.name)}
if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne ${powerShellLiteral(snapshot.fingerprint)}) {
  throw 'Startup entry changed before removal'
}
Remove-Item -LiteralPath $path`);
    }
  },
};

export function windowsStatePath(): string {
  const identity: unknown = JSON.parse(powershell(`
@{
  LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
  Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
} | ConvertTo-Json -Compress`));
  if (!identity || typeof identity !== "object" || !("LocalAppData" in identity) ||
      typeof identity.LocalAppData !== "string" || !identity.LocalAppData ||
      !("Sid" in identity) || typeof identity.Sid !== "string" || !/^S-[0-9-]+$/.test(identity.Sid)) {
    throw new Error("Cannot determine Windows user inventory location");
  }
  const scope = createHash("sha256").update(hostname() + "\0" + identity.Sid).digest("hex");
  return join(identity.LocalAppData, "Winix", `applied-${scope}.json`);
}
