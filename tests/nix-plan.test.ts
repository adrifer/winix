import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareNixosSystems, describeBuild, diffTrees, drvName, formatNixPlan, nixosToplevel, nixPlanSummary,
  normalizeStorePaths, parseDiffClosures, parseDryActivate, parseDryRun,
  type CommandResult, type NixPlanRunner,
} from "../src/cli/nix-plan.ts";

const HASH = "a".repeat(32);
const HASH2 = "b".repeat(32);

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "winix-nix-plan-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function files(root: string, entries: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

describe("parsing Nix output", () => {
  it("splits store names into name and version like Nix", () => {
    expect(drvName(`/nix/store/${HASH}-bash-interactive-5.3p20`)).toEqual({ name: "bash-interactive", version: "5.3p20" });
    expect(drvName(`/nix/store/${HASH}-home-manager-path`)).toEqual({ name: "home-manager-path", version: "" });
    expect(drvName("nixos-system-wsl-26.11.20261113.d5cc683")).toEqual({ name: "nixos-system-wsl", version: "26.11.20261113.d5cc683" });
  });

  it("reads what a build would do", () => {
    expect(parseDryRun([
      "these 12 derivations will be built:",
      `  /nix/store/${HASH}-x.drv`,
      "these 340 paths will be fetched (1.2 GiB download, 4.5 GiB unpacked):",
    ].join("\n"))).toEqual({ build: 12, fetch: 340, download: "1.2 GiB" });
    expect(parseDryRun("this derivation will be built:\nthis path will be fetched (3.1 MiB download, 9 MiB unpacked):"))
      .toEqual({ build: 1, fetch: 1, download: "3.1 MiB" });
    expect(parseDryRun("")).toEqual({ build: 0, fetch: 0 });
    expect(describeBuild({ build: 0, fetch: 0 })).toBe("already built");
    expect(describeBuild({ build: 2, fetch: 5, download: "10 MiB" })).toBe("2 to build, 5 to download (10 MiB)");
  });

  it("reads nix store diff-closures, colours and all", () => {
    const output = [
      "lazygit: 0.66.2 → 0.66.3, \x1b[31;1m8.5 KiB\x1b[0m",
      "code: ∅ → ε",
      "git-credential-manager: ε → ∅",
      "nix-cmd: 2.34.9, 2.35.3 → 2.35.6, \x1b[32;1m-1.1 MiB\x1b[0m",
      "source: \x1b[31;1m897.5 KiB\x1b[0m",
      "tzdata: 2026e → ∅",
    ].join("\n");
    expect(parseDiffClosures(output)).toEqual([
      { name: "lazygit", from: ["0.66.2"], to: ["0.66.3"] },
      { name: "code", from: [], to: [""] },
      { name: "git-credential-manager", from: [""], to: [] },
      { name: "nix-cmd", from: ["2.34.9", "2.35.3"], to: ["2.35.6"] },
      { name: "tzdata", from: ["2026e"], to: [] },
    ]);
  });

  it("reads NixOS's dry activation", () => {
    expect(parseDryActivate([
      "would stop the following units: old.service",
      "would NOT stop the following changed units: getty@tty1.service",
      "would activate the configuration...",
      "would restart systemd",
      "would restart the following units: sshd.service, nix-daemon.service",
      "would start the following units: syncthing.service",
      "would reload the following units: dbus.service",
    ].join("\n"))).toEqual({
      start: ["syncthing.service"], stop: ["old.service"], restart: ["sshd.service", "nix-daemon.service"],
      reload: ["dbus.service"], keep: ["getty@tty1.service"], restartSystemd: true, estimated: false,
    });
  });

  it("ignores store hashes and dependency versions when comparing config files", () => {
    expect(normalizeStorePaths(`ExecStart=/nix/store/${HASH}-openssh-9.9p1/bin/sshd`))
      .toBe(normalizeStorePaths(`ExecStart=/nix/store/${HASH2}-openssh-10.0p2/bin/sshd`));
    expect(normalizeStorePaths("PermitRootLogin no")).not.toBe(normalizeStorePaths("PermitRootLogin yes"));
  });

  it("builds the toplevel attribute with POSIX paths", () => {
    expect(nixosToplevel("D:\\repo\\.winix\\out", "wsl-work"))
      .toBe('path:D:/repo/.winix/out#nixosConfigurations."wsl-work".config.system.build.toplevel');
  });
});

describe("diffTrees", () => {
  it("lists added, changed and removed files, ignoring rebuilt store paths", async () => {
    const root = await tempDir();
    await files(join(root, "old"), {
      "ssh/sshd_config": "PermitRootLogin no\n",
      "profile": `PATH=/nix/store/${HASH}-bash-5.2/bin`,
      "gone.conf": "x",
      "systemd/system/a.service": "old",
    });
    await files(join(root, "new"), {
      "ssh/sshd_config": "PermitRootLogin yes\n",
      "profile": `PATH=/nix/store/${HASH2}-bash-5.3/bin`,
      "fresh.conf": "y",
      "systemd/system/a.service": "new",
    });
    expect(diffTrees(join(root, "old"), join(root, "new"), ["systemd/system"])).toEqual([
      { path: "fresh.conf", action: "add" },
      { path: "gone.conf", action: "remove" },
      { path: "ssh/sshd_config", action: "change" },
    ]);
    expect(diffTrees(undefined, join(root, "new"), ["systemd/system"]).map((change) => change.action))
      .toEqual(["add", "add", "add"]);
    expect(diffTrees(join(root, "old"), join(root, "old"))).toEqual([]);
  });
});

function fakeRunner(responses: (command: string, args: string[]) => Partial<CommandResult> | undefined): NixPlanRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    capture: async (command, args) => {
      calls.push([command, ...args].join(" "));
      return { code: 0, stdout: "", stderr: "", ...responses(command, args) };
    },
    run: async () => { throw new Error("not expected"); },
  };
}

async function fakeSystems(root: string) {
  const current = join(root, "current");
  const built = join(root, "built");
  await files(current, {
    "nixos-version": "26.11.20261107.f4a03c0\n",
    "sw/.keep": "",
    "etc/ssh/sshd_config": "PermitRootLogin no\n",
    "etc/systemd/system/sshd.service": `ExecStart=/nix/store/${HASH}-openssh-9.9p1/bin/sshd`,
    "etc/systemd/system/old.service": "x",
    "etc/systemd/system/idle.service": "a",
  });
  await files(built, {
    "nixos-version": "26.11.20261113.d5cc683\n",
    "sw/.keep": "",
    "etc/ssh/sshd_config": "PermitRootLogin yes\n",
    "etc/systemd/system/sshd.service": `ExecStart=/nix/store/${HASH2}-openssh-10.0p2/bin/sshd`,
    "etc/systemd/system/idle.service": "b",
    "etc/systemd/system/syncthing.service": "y",
    "etc/systemd/system/multi-user.target.wants/syncthing.service": "y",
  });
  const profiles = join(root, "profiles");
  await files(profiles, { "system-41-link": "", "system-42-link": "", "per-user": "" });
  return { current, built, profiles };
}

describe("winix plan for a NixOS host", () => {
  it("shows the command, without building, on a machine without Nix", async () => {
    const { switchCommand } = await import("../src/cli/commands/switch.ts");
    const { pathToFileURL } = await import("node:url");
    const dir = await tempDir();
    const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
    await writeFile(join(dir, "winix.config.mjs"), `
      import { host, platforms, workspace } from ${JSON.stringify(sdk)};
      export default workspace({ inputs: { nixpkgs: "nixos-unstable" }, hosts: [host("wsl", platforms.nixos(), [])] });
    `);
    const runner = fakeRunner((command) => (command === "nix" ? { code: 127 } : undefined));
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    try {
      await switchCommand(dir, { host: "wsl", dry: true, nixRunner: runner });
    } finally {
      console.log = log;
    }
    expect(lines.join("\n")).toContain("Would run:");
    // Native Windows never builds a NixOS host; elsewhere, missing Nix is the reason.
    if (process.platform !== "win32") {
      expect(runner.calls).toEqual(["nix --version"]);
      expect(lines.join("\n")).toContain("Not built: Nix isn't installed here");
    } else {
      expect(runner.calls).toEqual([]);
    }
  });
});

describe("compareNixosSystems", () => {
  it("reports packages, /etc, version, generation and estimated services", async () => {
    const root = await tempDir();
    const { current, built, profiles } = await fakeSystems(root);
    const runner = fakeRunner((command, args) => {
      if (command === "nix") {
        return {
          stdout: [
            "lazygit: 0.66.2 → 0.66.3, 8.5 KiB",
            "ripgrep: ∅ → 14.1.1, 5.0 MiB",
            "neofetch: 7.1.0 → ∅, -300 KiB",
            "glibc: 2.40 → 2.41, 1 KiB",
            "nixos-system-wsl: 26.11.20261107.f4a03c0 → 26.11.20261113.d5cc683",
          ].join("\n"),
        };
      }
      if (command === "nix-store") {
        return {
          stdout: [`/nix/store/${HASH}-lazygit-0.66.2`, `/nix/store/${HASH}-ripgrep-14.1.1`, `/nix/store/${HASH}-neofetch-7.1.0`].join("\n"),
        };
      }
      if (command === "sudo") return { code: 1 };
      if (command === "systemctl") return { stdout: args.slice(1).map((unit) => (unit === "idle.service" ? "inactive" : "active")).join("\n") };
      return undefined;
    });
    const plan = await compareNixosSystems({ host: "wsl", built, runner, paths: { current, profiles }, isRoot: false });
    expect(plan.same).toBe(false);
    expect(plan.version).toEqual({ from: "26.11.20261107.f4a03c0", to: "26.11.20261113.d5cc683" });
    expect(plan.generation).toBe(43);
    expect(plan.packages).toEqual([
      { name: "ripgrep", action: "install", to: "14.1.1" },
      { name: "lazygit", action: "upgrade", from: "0.66.2", to: "0.66.3" },
      { name: "neofetch", action: "remove", from: "7.1.0" },
    ]);
    expect(plan.dependencies).toBe(1);
    expect(plan.etc).toEqual([{ path: "ssh/sshd_config", action: "change" }]);
    expect(plan.services).toEqual({
      start: ["syncthing.service"], stop: ["old.service"], restart: ["sshd.service"], reload: [], keep: [],
      restartSystemd: false, estimated: true,
    });
    expect(plan.reboot).toBe(false);

    const output = formatNixPlan(plan);
    expect(output[0]).toBe("Plan for wsl: 7 changes");
    expect(output).toEqual(expect.arrayContaining([
      "  NixOS 26.11.20261107.f4a03c0 → 26.11.20261113.d5cc683",
      "  Packages",
      "    + install  ripgrep   14.1.1",
      "    ~ upgrade  lazygit   0.66.2 → 0.66.3",
      "    - remove   neofetch  7.1.0",
      "    = 1 dependency changed version",
      "  /etc",
      "    ~ change  ssh/sshd_config",
      "  Services (estimated: sudo needs a password)",
      "    - stop     old.service",
      "    ~ restart  sshd.service",
      "    + start    syncthing.service",
    ]));
    expect(nixPlanSummary(plan)).toBe("winix switch would activate this as generation 43 (undo with sudo nixos-rebuild switch --rollback).");
  });

  it("uses NixOS's dry activation when sudo needs no password", async () => {
    const root = await tempDir();
    const { current, built, profiles } = await fakeSystems(root);
    await files(built, { "bin/switch-to-configuration": "#!/bin/sh" });
    const runner = fakeRunner((command, args) => {
      if (command === "sudo" && args[1] === "true") return { code: 0 };
      if (command === "sudo") return { stderr: "would restart the following units: sshd.service\n" };
      return undefined;
    });
    const plan = await compareNixosSystems({ host: "wsl", built, runner, paths: { current, profiles }, isRoot: false });
    expect(plan.services?.estimated).toBe(false);
    expect(plan.services?.restart).toEqual(["sshd.service"]);
    expect(runner.calls).toContain(`sudo -n ${join(built, "bin", "switch-to-configuration")} dry-activate`);
  });

  it("says no changes when the build is the running system", async () => {
    const root = await tempDir();
    const { built, profiles } = await fakeSystems(root);
    const runner = fakeRunner(() => undefined);
    const plan = await compareNixosSystems({ host: "wsl", built, runner, paths: { current: built, profiles } });
    expect(plan.same).toBe(true);
    expect(formatNixPlan(plan)).toEqual(["Plan for wsl: no changes"]);
    expect(nixPlanSummary(plan)).toBe("winix switch would change nothing.");
    expect(runner.calls).toEqual([]);
  });

  it("builds but doesn't compare on a machine that isn't running NixOS", async () => {
    const root = await tempDir();
    const { built, profiles } = await fakeSystems(root);
    const plan = await compareNixosSystems({
      host: "wsl", built, runner: fakeRunner(() => undefined), paths: { current: join(root, "missing"), profiles },
    });
    expect(plan.current).toBeUndefined();
    expect(formatNixPlan(plan)).toEqual(["Plan for wsl (built; not compared: this machine isn't running NixOS)"]);
  });

  it("flags a kernel change (WSL systems have no kernel of their own)", async () => {
    const root = await tempDir();
    const { current, built, profiles } = await fakeSystems(root);
    // In the store these are links; two separate files stand for two different kernels.
    await files(current, { kernel: "k1" });
    await files(built, { kernel: "k2" });
    const plan = await compareNixosSystems({
      host: "wsl", built, runner: fakeRunner((command) => (command === "sudo" ? { code: 1 } : undefined)),
      paths: { current, profiles }, isRoot: false,
    });
    expect(plan.reboot).toBe(true);
    expect(formatNixPlan(plan).at(-1)).toContain("restart the machine");
  });
});
