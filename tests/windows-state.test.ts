import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { describe, expect, it, vi } from "vitest";
import {
  parseAppliedState, reconcileWindows, resourceKey, forgetWindowsResource, confirmWindowsRemovals,
  type ManagedResource, type ResourceSnapshot,
} from "../src/cli/windows-state.ts";

vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));

async function withConfirmation(answer: string, run: () => Promise<void>) {
  const readline = await vi.importActual<typeof import("node:readline/promises")>("node:readline/promises");
  const prompt = readline.createInterface({ input: new PassThrough(), output: new PassThrough() });
  vi.mocked(createInterface).mockReturnValue(prompt);
  const question = vi.spyOn(prompt, "question").mockResolvedValue(answer);
  vi.stubGlobal("process", { ...process, stdin: { isTTY: true }, stdout: { isTTY: true } });
  try {
    await run();
    expect(question).toHaveBeenCalledWith("Continue with switch? [y/N] ", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  } finally {
    prompt.close();
    question.mockRestore();
    vi.mocked(createInterface).mockReset();
    vi.unstubAllGlobals();
  }
}

const startup: ManagedResource = { kind: "startup", name: "example" };
const pkg: ManagedResource = { kind: "package", source: "winget", id: "Example.App" };
const shortcut = { fingerprint: "a".repeat(64) };
const changed = { fingerprint: "b".repeat(64) };
const installed = { version: "1.0" };

async function fixture(run: (fixture: {
  statePath: string;
  actual: Map<string, ResourceSnapshot>;
  apply(desired: ManagedResource[], options?: {
    owner?: string; dry?: boolean; yes?: boolean; activate?: () => Promise<void>; definition?: string;
  }): Promise<void>;
  remove: ReturnType<typeof vi.fn>;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "winix-state-"));
  const actual = new Map<string, ResourceSnapshot>();
  const statePath = join(dir, "applied.json");
  const remove = vi.fn(async (resource: ManagedResource) => { actual.delete(resourceKey(resource)); });
  try {
    await run({
      statePath, actual, remove,
      apply: (desired, options = {}) => reconcileWindows({
        statePath, owner: options.owner ?? "workspace-A/desktop", desired,
        definitions: Object.fromEntries(desired.map((resource) => [resourceKey(resource), options.definition ?? "same"])),
        dry: options.dry ?? false,
        yes: options.yes ?? true,
        adapter: { inspect: async (resource) => actual.get(resourceKey(resource)) ?? null, remove },
        report: () => {},
        activate: options.activate ?? (async () => {
          for (const resource of desired) actual.set(resourceKey(resource), resource.kind === "startup" ? shortcut : installed);
        }),
      }),
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("Windows applied-state reconciliation", () => {
  it.each(["close", "SIGINT"])("cancels confirmation when the prompt receives %s", async (event) => {
    const readline = await vi.importActual<typeof import("node:readline/promises")>("node:readline/promises");
    const prompt = readline.createInterface({ input: new PassThrough(), output: new PassThrough() });
    vi.mocked(createInterface).mockReturnValue(prompt);
    vi.stubGlobal("process", { ...process, stdin: { isTTY: true }, stdout: { isTTY: true } });
    try {
      queueMicrotask(() => { event === "close" ? prompt.close() : prompt.emit("SIGINT"); });
      await expect(confirmWindowsRemovals()).rejects.toThrow("Switch cancelled");
    } finally {
      prompt.close();
      vi.mocked(createInterface).mockReset();
      vi.unstubAllGlobals();
    }
  });

  it("refuses noninteractive removals before activation or inventory changes unless --yes is provided", async () => fixture(async (f) => {
    await f.apply([pkg, startup]);
    const saved = await readFile(f.statePath, "utf8");
    const activate = vi.fn();
    vi.stubGlobal("process", { ...process, stdin: { isTTY: false }, stdout: { isTTY: false } });
    try {
      await expect(f.apply([], { yes: false, activate })).rejects.toThrow("use --yes");
      expect(activate).not.toHaveBeenCalled();
      expect(f.remove).not.toHaveBeenCalled();
      expect(await readFile(f.statePath, "utf8")).toBe(saved);
      await f.apply([], { yes: true, activate });
      expect(activate).toHaveBeenCalledTimes(1);
      expect(f.remove).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  }));

  it.each(["", "n", "anything"])("cancels the entire switch for confirmation %j", async (answer) => fixture(async (f) => {
    await f.apply([pkg, startup]);
    const saved = await readFile(f.statePath, "utf8");
    const activate = vi.fn();
    await withConfirmation(answer, async () => {
      await expect(f.apply([], { yes: false, activate })).rejects.toThrow("Switch cancelled");
    });
    expect(activate).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(await readFile(f.statePath, "utf8")).toBe(saved);
  }));

  it.each(["y", " YES "])("confirms removals once before activation for %j", async (answer) => fixture(async (f) => {
    await f.apply([pkg, startup]);
    const activate = vi.fn(async () => { expect(f.remove).not.toHaveBeenCalled(); });
    await withConfirmation(answer, async () => {
      await f.apply([], { yes: false, activate });
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenCalledTimes(2);
  }));

  it("does not require confirmation for dry runs, switches without removals, or already absent resources", async () => fixture(async (f) => {
    const prompt = vi.mocked(createInterface);
    await f.apply([pkg, startup], { yes: false });
    await f.apply([], { dry: true, yes: false });
    f.actual.clear();
    await f.apply([], { yes: false });
    expect(f.remove).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  }));
  it("automatically removes unused owned packages and unchanged shortcuts, with a read-only dry preview", async () => fixture(async (f) => {
    await f.apply([startup, pkg]);
    const saved = await readFile(f.statePath, "utf8");
    await f.apply([], { dry: true });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.actual.get(resourceKey(startup))).toEqual(shortcut);
    expect(f.actual.get(resourceKey(pkg))).toEqual(installed);
    expect(await readFile(f.statePath, "utf8")).toBe(saved);
    await f.apply([]);
    expect(f.actual.has(resourceKey(startup))).toBe(false);
    expect(f.actual.has(resourceKey(pkg))).toBe(false);
    expect(f.remove).toHaveBeenCalledTimes(2);
  }));

  it("does not adopt pre-existing packages or unchanged shortcuts, or touch unrelated resources", async () => fixture(async (f) => {
    const outside: ManagedResource = { kind: "startup", name: "manual" };
    f.actual.set(resourceKey(pkg), installed);
    f.actual.set(resourceKey(startup), shortcut);
    f.actual.set(resourceKey(outside), shortcut);
    await f.apply([pkg, startup]);
    await f.apply([]);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.actual.size).toBe(3);
  }));

  it("owns a pre-existing shortcut only when successful activation actually replaces it", async () => fixture(async (f) => {
    f.actual.set(resourceKey(startup), changed);
    await f.apply([startup]);
    await f.apply([]);
    expect(f.remove).toHaveBeenCalledTimes(1);
  }));

  it("protects shared requirements and rejects conflicting declarations before activation", async () => fixture(async (f) => {
    await f.apply([pkg, startup]);
    await f.apply([pkg, startup], { owner: "workspace-B/desktop" });
    const activate = vi.fn();
    await expect(f.apply([pkg], { definition: "conflicting", activate })).rejects.toThrow("Conflicting declaration");
    expect(activate).not.toHaveBeenCalled();
    await f.apply([]);
    expect(f.remove).not.toHaveBeenCalled();
    await f.apply([], { owner: "workspace-B/desktop" });
    expect(f.remove).toHaveBeenCalledTimes(2);
  }));

  it("refuses drift for desired and removed resources without updating state", async () => fixture(async (f) => {
    await f.apply([startup, pkg]);
    const saved = await readFile(f.statePath, "utf8");
    f.actual.set(resourceKey(startup), changed);
    await expect(f.apply([])).rejects.toThrow("externally modified");
    await expect(f.apply([startup])).rejects.toThrow("changed outside Winix");
    expect(await readFile(f.statePath, "utf8")).toBe(saved);
    expect(f.remove).not.toHaveBeenCalled();
  }));

  it("does not uninstall an externally upgraded owned package", async () => fixture(async (f) => {
    await f.apply([pkg]);
    f.actual.set(resourceKey(pkg), { version: "2.0" });
    await expect(f.apply([])).rejects.toThrow("externally modified");
    expect(f.remove).not.toHaveBeenCalled();
  }));

  it("makes dry runs read-only and leaves ownership untouched after failed activation", async () => fixture(async (f) => {
    await f.apply([startup]);
    const saved = await readFile(f.statePath, "utf8");
    await f.apply([], { dry: true, activate: async () => {} });
    expect(await readFile(f.statePath, "utf8")).toBe(saved);
    await expect(f.apply([], { activate: async () => { throw new Error("activation failed"); } })).rejects.toThrow("activation failed");
    expect(await readFile(f.statePath, "utf8")).toBe(saved);
    expect(f.remove).not.toHaveBeenCalled();
  }));

  it("rechecks before removal and preserves pending ownership after a removal failure", async () => fixture(async (f) => {
    await f.apply([startup]);
    await expect(f.apply([], { activate: async () => { f.actual.set(resourceKey(startup), changed); } })).rejects.toThrow("changed after removal planning");
    expect(f.remove).not.toHaveBeenCalled();
    f.actual.set(resourceKey(startup), shortcut);
    f.remove.mockRejectedValueOnce(new Error("locked"));
    await expect(f.apply([])).rejects.toThrow("locked");
    expect(parseAppliedState(await readFile(f.statePath, "utf8")).entries[resourceKey(startup)].owned).toBe(true);
    await f.apply([]);
    expect(f.actual.has(resourceKey(startup))).toBe(false);
  }));

  it("fails closed on malformed state and never activates", async () => fixture(async (f) => {
    await writeFile(f.statePath, '{"version":99,"entries":{}}');
    const activate = vi.fn();
    await expect(f.apply([], { activate })).rejects.toThrow("Invalid Windows applied-state");
    expect(activate).not.toHaveBeenCalled();
  }));

  it("releases ownership without deleting the resource or losing other owners' requirements", async () => fixture(async (f) => {
    await f.apply([pkg]);
    await f.apply([pkg], { owner: "workspace-B/desktop" });
    const saved = await readFile(f.statePath, "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await forgetWindowsResource(f.statePath, pkg, true);
      expect(await readFile(f.statePath, "utf8")).toBe(saved);
      await forgetWindowsResource(f.statePath, pkg, false);
      const state = parseAppliedState(await readFile(f.statePath, "utf8"));
      expect(state.entries[resourceKey(pkg)].owned).toBe(false);
      expect(state.entries[resourceKey(pkg)].owners).toHaveLength(2);
      await f.apply([]);
      await f.apply([], { owner: "workspace-B/desktop" });
      expect(f.actual.get(resourceKey(pkg))).toEqual(installed);
      expect(f.remove).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  }));

  it("does not claim partially installed packages on activation failure and rejects concurrent writers", async () => fixture(async (f) => {
    await expect(f.apply([pkg], { activate: async () => {
      f.actual.set(resourceKey(pkg), installed);
      throw new Error("partial failure");
    } })).rejects.toThrow("partial failure");
    await f.apply([pkg]);
    await f.apply([]);
    expect(f.remove).not.toHaveBeenCalled();
    await mkdir(f.statePath + ".lock");
    await expect(f.apply([])).rejects.toThrow("Cannot lock");
  }));
});
