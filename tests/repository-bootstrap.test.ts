import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  bootstrapCheckout, ensureLinuxRuntime, ensureWindowsRuntime, localWinixCommand, nodeTypeArguments, pinnedWinixVersion,
  routeRun, type BootstrapDeps, type RouteDeps,
} from "../src/cli/commands/bootstrap.ts";
import {
  installWinixCommand, linuxCommandShim, rememberCheckout, rememberedCheckout, userPathScript, windowsCommandShim,
  type HomeEnvironment, type InstallCommandDeps,
} from "../src/cli/winix-home.ts";
import { readRememberedHost } from "../src/cli/host-memory.ts";
import { selectHost } from "../src/cli/commands/switch.ts";
import { resolveWinixVersionRange } from "../src/cli/commands/init.ts";
import { execFileSync } from "node:child_process";
import { checkoutWslRevision } from "../src/backends/windows/wsl-setup-runtime.ts";
import * as runtime from "../src/runtime.ts";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(version: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "winix-bootstrap-"));
  temporary.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({
    dependencies: { "@adrifer/winix": version },
  }));
  return directory;
}

describe("checkout-pinned bootstrap", () => {
  it("accepts only exact versions and matching official SDK release assets", () => {
    expect(pinnedWinixVersion("0.3.0-preview.1")).toBe("0.3.0-preview.1");
    expect(pinnedWinixVersion("https://github.com/adrifer/winix/releases/download/v0.3.0-preview.1/adrifer-winix-0.3.0-preview.1.tgz")).toBe("0.3.0-preview.1");
    for (const spec of [undefined, "^0.3.0", "~0.3.0", "latest", "file:../winix",
      "https://example.com/winix.tgz",
      "https://github.com/adrifer/winix/releases/download/v0.3.0/adrifer-winix-0.2.3.tgz"]) {
      expect(() => pinnedWinixVersion(spec)).toThrow();
    }
  });

  it("runs the pinned release and never infers another Winix from node_modules", async () => {
    const directory = await fixture("0.3.0");
    expect(await localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix", undefined, "")).toEqual({
      command: "verified-winix", args: [],
    });
    await expect(localWinixCommand(directory, "0.3.0", "0.2.3", "old-winix", undefined, "")).rejects.toThrow("Rerun the repository bootstrap");
    // An installed (even stale or broken) node_modules SDK is ignored.
    const local = join(directory, "node_modules", "@adrifer", "winix");
    await mkdir(local, { recursive: true });
    await writeFile(join(local, "package.json"), '{"version":"0.2.3"}');
    expect(await localWinixCommand(directory, "0.3.0", "0.3.0", "verified-winix", undefined, "")).toEqual({
      command: "verified-winix", args: [],
    });
  });

  it("runs another Winix only when WINIX_SDK names it: source checkouts first, then dist", async () => {
    const directory = await fixture("0.3.0");
    const sdk = join(directory, "winix-source");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "winix", undefined, sdk)).rejects.toThrow("not a Winix package directory");
    await mkdir(join(sdk, "dist", "cli"), { recursive: true });
    await writeFile(join(sdk, "package.json"), '{"name":"left-pad","version":"1.0.0"}');
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "winix", undefined, sdk)).rejects.toThrow("not the @adrifer/winix package");
    await writeFile(join(sdk, "package.json"), '{"name":"@adrifer/winix","version":"0.9.9"}');
    await expect(localWinixCommand(directory, "0.3.0", "0.3.0", "winix", undefined, sdk)).rejects.toThrow("neither src/cli/index.ts nor dist/cli/index.js");
    await writeFile(join(sdk, "dist", "cli", "index.js"), "");
    // Version mismatches are fine: WINIX_SDK is an explicit choice (relative to the checkout).
    expect((await localWinixCommand(directory, "0.3.0", "0.2.3", "old-winix", undefined, "winix-source")).args)
      .toEqual(["--no-warnings", join(sdk, "dist", "cli", "index.js")]);
    await mkdir(join(sdk, "src", "cli"), { recursive: true });
    await writeFile(join(sdk, "src", "cli", "index.ts"), "");
    expect((await localWinixCommand(directory, "0.3.0", "0.3.0", "winix", undefined, sdk)).args)
      .toEqual(["--no-warnings", join(sdk, "src", "cli", "index.ts")]);
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toContain("this checkout pins 0.3.0");
  });

  it("fetches the pinned release when the pin moved past the executable", async () => {
    const directory = await fixture("0.3.0");
    const fetchRuntime = vi.fn(async (version: string) => `runtime-${version}.exe`);
    expect(await localWinixCommand(directory, "0.3.1", "0.3.0", "old-winix", fetchRuntime, "")).toEqual({ command: "runtime-0.3.1.exe", args: [] });
    expect(fetchRuntime).toHaveBeenCalledWith("0.3.1");
    expect(await localWinixCommand(directory, "0.3.0", "0.3.0", "winix", fetchRuntime, "")).toEqual({ command: "winix", args: [] });
    expect(fetchRuntime).toHaveBeenCalledTimes(1);
  });

  it("downloads a Windows runtime only when it matches the release checksum", async () => {
    const directory = await fixture("0.3.0");
    const binary = Buffer.from("verified winix");
    const sum = createHash("sha256").update(binary).digest("hex");
    const fake = (sums: string) => vi.fn(async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS")
      ? new Response(sums) : new Response(binary)) as unknown as typeof fetch;
    await expect(ensureWindowsRuntime(directory, "0.3.1", fake(`${"0".repeat(64)}  winix-windows-x64.exe\n`), "x64"))
      .rejects.toThrow("checksum mismatch");
    expect(existsSync(join(directory, ".winix", "runtime", "0.3.1", "winix.exe"))).toBe(false);
    const request = fake(`${sum}  winix-windows-arm64.exe\n${sum.toUpperCase()}  winix-windows-x64.exe\n`);
    const path = await ensureWindowsRuntime(directory, "0.3.1", request, "x64");
    expect(path).toBe(join(directory, ".winix", "runtime", "0.3.1", "winix.exe"));
    expect(readFileSync(path, "utf8")).toBe("verified winix");
    expect(vi.mocked(request).mock.calls.map(([url]) => String(url))).toEqual([
      "https://github.com/adrifer/winix/releases/download/v0.3.1/SHA256SUMS",
      "https://github.com/adrifer/winix/releases/download/v0.3.1/winix-windows-x64.exe",
    ]);
    // Present: reused without downloading again.
    await ensureWindowsRuntime(directory, "0.3.1", request, "x64");
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });

  it("prunes older runtimes after a download, keeping the running and launcher fallback ones", async () => {
    const directory = await fixture("0.3.0");
    const runtime = join(directory, ".winix", "runtime");
    for (const version of ["0.2.9", "0.3.0", "0.3.1-preview.1", "notes"]) {
      await mkdir(join(runtime, version), { recursive: true });
      await writeFile(join(runtime, version, "winix.exe"), "old");
    }
    // A launcher from an older bootstrap still falls back to its executable.
    await mkdir(join(directory, ".winix", "bin"), { recursive: true });
    await writeFile(join(directory, ".winix", "bin", "winix.ps1"),
      `# Generated by Winix bootstrap\r\n$executable = '${join(runtime, "0.2.9", "winix.exe")}'\r\n& $executable run @args\r\n`);
    const binary = Buffer.from("new winix");
    const sum = createHash("sha256").update(binary).digest("hex");
    const request = vi.fn(async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS")
      ? new Response(`${sum}  winix-windows-x64.exe\n`) : new Response(binary)) as unknown as typeof fetch;
    await ensureWindowsRuntime(directory, "0.3.2", request, "x64", join(runtime, "0.3.0", "winix.exe"));
    expect(readdirSync(runtime).sort()).toEqual(["0.2.9", "0.3.0", "0.3.2", "notes"]);
  });

  it("asks nothing after the script's consent, chooses and remembers the host, and lets switch show the plan", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    const run = vi.fn(async () => {});
    const deps: BootstrapDeps = {
      candidateHosts: vi.fn(async () => ["work-devbox", "work-devbox-2"]),
      askHost: vi.fn(async () => "work-devbox-2"),
      installCommand: vi.fn(async () => {}),
    };
    await bootstrapCheckout(directory, { yes: false, prepareOnly: false, dry: false, confirmed: true }, run, deps);
    expect(deps.askHost).toHaveBeenCalledWith(["work-devbox", "work-devbox-2"]);
    expect(run.mock.calls).toEqual([[directory, ["check"]], [directory, ["switch", "--host", "work-devbox-2"]]]);
    expect(readRememberedHost(directory)).toBe("work-devbox-2");
    // A rerun (after a restart) reuses the remembered host without asking.
    run.mockClear();
    await bootstrapCheckout(directory, { yes: false, prepareOnly: true, dry: false, confirmed: true }, run, deps);
    expect(deps.askHost).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([[directory, ["check"]], [directory, ["switch", "--dry", "--host", "work-devbox-2"]]]);
    // switch uses the remembered host when the machine name matches none.
    expect(selectHost(["work-devbox", "work-devbox-2"], undefined, "DESKTOP-1234567", "work-devbox-2")).toBe("work-devbox-2");
    expect(selectHost(["work-devbox", "work-devbox-2"], "work-devbox", "DESKTOP-1234567", "work-devbox-2")).toBe("work-devbox");
    expect(() => selectHost(["a", "b"], undefined, "DESKTOP-1234567", "gone")).toThrow("winix bootstrap remembers it");
  });

  it("generates a per-user command that runs the installed Winix's router", () => {
    const shim = windowsCommandShim("C:\\Users\\me\\AppData\\Local\\Winix\\runtime\\0.4.0\\winix.exe");
    expect(shim).toBe([
      "@echo off", "rem Generated by Winix bootstrap",
      '"C:\\Users\\me\\AppData\\Local\\Winix\\runtime\\0.4.0\\winix.exe" run %*', "exit /b %ERRORLEVEL%", "",
    ].join("\r\n"));
    expect(linuxCommandShim("/home/o'neil/.local/share/winix/runtime/0.4.0/winix"))
      .toBe(`#!/usr/bin/env bash\n# Generated by Winix bootstrap\nexec '/home/o'\\''neil/.local/share/winix/runtime/0.4.0/winix' run "$@"\n`);
    const path = userPathScript("C:\\Users\\me\\AppData\\Local\\Winix\\bin");
    expect(path).toContain("DoNotExpandEnvironmentNames");
    expect(path).toContain("$key.SetValue('Path', (@($entries) + $dir) -join ';', $kind)");
  });

  it("prepares in check/preview order and stops before activation in prepare-only mode", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    const run = vi.fn(async () => {});
    await bootstrapCheckout(directory, { host: "test-machine", yes: true, prepareOnly: true, dry: false }, run);
    expect(run.mock.calls).toEqual([
      [directory, ["check"]],
      [directory, ["switch", "--dry", "--host", "test-machine"]],
    ]);
    run.mockClear();
    await bootstrapCheckout(directory, { host: "test-machine", yes: true, prepareOnly: false, dry: false }, run);
    expect(run.mock.calls.at(-1)).toEqual([directory, ["switch", "--host", "test-machine", "--yes"]]);
  });

  it("never evaluates config in dry-run or with an incompatible executable; failures stop before activation", async () => {
    const directory = await fixture((await resolveWinixVersionRange()).replace(/^\^/, ""));
    await writeFile(join(directory, "winix.config.ts"), 'throw new Error("DO NOT EVALUATE");');
    const run = vi.fn(async () => {});
    await bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: false, dry: true }, run);
    expect(run).not.toHaveBeenCalled();
    await writeFile(join(directory, "package.json"), '{"dependencies":{"@adrifer/winix":"99.0.0"}}');
    await expect(bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: true, dry: false }, run)).rejects.toThrow("Checkout requires");
    expect(run).not.toHaveBeenCalled();
    await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { "@adrifer/winix": (await resolveWinixVersionRange()).replace(/^\^/, "") } }));
    run.mockRejectedValue(new Error("preview failed"));
    await expect(bootstrapCheckout(directory, { host: "test", yes: true, prepareOnly: false, dry: false }, run)).rejects.toThrow("preview failed");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("supports both Node transform-type releases and Node 26 without its removed flag", () => {
    expect(nodeTypeArguments("v22.13.0")).toEqual(["--experimental-transform-types"]);
    expect(nodeTypeArguments("v24.0.0")).toEqual(["--experimental-transform-types"]);
    expect(nodeTypeArguments("v26.0.0")).toEqual([]);
    expect(() => nodeTypeArguments("v22.12.0")).toThrow("Node 22.13+");
    expect(() => nodeTypeArguments("v26.0.0-rc.1")).toThrow("stable Node");
    for (const version of ["v23.0.0", "v25.0.0", "v28.0.0"]) {
      expect(() => nodeTypeArguments(version)).toThrow("stable Node");
    }
  });

  it.each(["main", "HEAD", "refs/heads/main", "refs/tags/first", "commit"])(
    "keeps locked first-run contents and full history when provisioning ref %s", async (ref) => {
      const directory = await fixture("0.3.0");
      const origin = join(directory, "origin");
      const checkout = join(directory, "checkout");
      await mkdir(origin);
      await mkdir(checkout);
      const git = (cwd: string) => (args: string[]) => execFileSync("git", args, {
        cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" },
      }).trim();
      const remote = git(origin);
      remote(["init", "--initial-branch=main"]);
      remote(["config", "user.name", "Bootstrap test"]);
      remote(["config", "user.email", "test@example.invalid"]);
      await writeFile(join(origin, "config"), "first");
      remote(["add", "."]);
      remote(["-c", "commit.gpgsign=false", "commit", "-m", "locked"]);
      const revision = remote(["rev-parse", "HEAD"]);
      remote(["tag", "first"]);
      await writeFile(join(origin, "config"), "newer upstream");
      remote(["add", "."]);
      remote(["-c", "commit.gpgsign=false", "commit", "-m", "newer"]);
      const current = remote(["rev-parse", "HEAD"]);
      const local = git(checkout);
      local(["init", "--initial-branch=main"]);
      local(["remote", "add", "origin", origin]);
      checkoutWslRevision(local, ref === "commit" ? revision : ref, revision);
      expect(local(["rev-parse", "HEAD"])).toBe(revision);
      expect(local(["rev-parse", "--is-shallow-repository"])).toBe("false");
      if (ref === "commit" || ref === "refs/tags/first") {
        expect(() => local(["symbolic-ref", "--short", "HEAD"])).toThrow();
      } else {
        expect(local(["symbolic-ref", "--short", "HEAD"])).toBe("main");
        expect(local(["rev-parse", "@{upstream}"])).toBe(current);
        checkoutWslRevision(local, ref, revision, revision);
        expect(local(["rev-parse", "HEAD"])).toBe(revision);
        local(["pull", "--ff-only"]);
        expect(local(["rev-parse", "HEAD"])).toBe(current);
      }
    }, 15000,
  );
});

describe("Linux standalone runtime and command", () => {
  const verified = (data: string) => {
    const binary = Buffer.from(data);
    const sum = createHash("sha256").update(binary).digest("hex");
    return vi.fn(async (url: string | URL | Request) => String(url).endsWith("SHA256SUMS")
      ? new Response(`${sum}  winix-linux-x64\n${sum}  winix-linux-arm64\n`) : new Response(binary)) as unknown as typeof fetch;
  };

  it("downloads the verified Linux binary behind a wrapper, checks its version and prunes older ones", async () => {
    const directory = await fixture("0.3.0");
    const runtime = join(directory, ".winix", "runtime");
    for (const version of ["0.2.9", "0.3.0", "0.3.1"]) await mkdir(join(runtime, version), { recursive: true });
    // A launcher from an older bootstrap still falls back to its executable.
    await mkdir(join(directory, ".winix", "bin"), { recursive: true });
    await writeFile(join(directory, ".winix", "bin", "winix"),
      `#!/usr/bin/env bash\n# Generated by Winix bootstrap\nexecutable='${join(runtime, "0.2.9", "winix")}'\nexec "$executable" run "$@"\n`);
    const request = verified("linux winix");
    const exec = vi.fn((command: string, args: string[]) => args[0] === "--version" ? "0.3.2\n" : "");
    const wrapper = await ensureLinuxRuntime(directory, "0.3.2", request, "x64", join(runtime, "0.3.0", "winix"), false, exec);
    const binary = join(runtime, "0.3.2", "winix.bin");
    expect(wrapper).toBe(join(runtime, "0.3.2", "winix"));
    expect(readFileSync(binary, "utf8")).toBe("linux winix");
    expect(readFileSync(wrapper, "utf8")).toContain(`exec '${binary}' "$@"`);
    expect(readFileSync(wrapper, "utf8")).toContain(`export WINIX_STANDALONE_EXECUTABLE='${wrapper}'`);
    expect(exec.mock.calls).toEqual([[wrapper, ["--version"]]]);
    expect(vi.mocked(request).mock.calls.map(([url]) => String(url))).toEqual([
      "https://github.com/adrifer/winix/releases/download/v0.3.2/SHA256SUMS",
      "https://github.com/adrifer/winix/releases/download/v0.3.2/winix-linux-x64",
    ]);
    // Kept: the running one (0.3.0), the launcher fallback (0.2.9) and the new one.
    expect(readdirSync(runtime).sort()).toEqual(["0.2.9", "0.3.0", "0.3.2"]);
    // Ready: reused without downloading or running anything again.
    await ensureLinuxRuntime(directory, "0.3.2", request, "x64", wrapper, false, exec);
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("starts the binary through the pinned Nix loader on NixOS and refuses a wrong version", async () => {
    const directory = await fixture("0.3.0");
    const folder = join(directory, ".winix", "runtime", "0.3.2");
    const exec = vi.fn((command: string, args: string[]) => args[0] === "--version" ? "0.3.2" : "");
    const wrapper = await ensureLinuxRuntime(directory, "0.3.2", verified("nixos winix"), "arm64", "/elsewhere/winix", true, exec);
    expect(exec.mock.calls.slice(0, 2)).toEqual([
      ["nix", ["build", "--no-write-lock-file", "--out-link", join(folder, "libc"), "github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f#glibc.out"]],
      ["nix", ["build", "--no-write-lock-file", "--out-link", join(folder, "compiler"), "github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f#stdenv.cc.cc.lib"]],
    ]);
    const content = readFileSync(wrapper, "utf8");
    expect(content).toContain(`exec '${join(folder, "libc", "lib", "ld-linux-aarch64.so.1")}' '--argv0' '${join(folder, "winix.bin")}'`);
    expect(content).toContain(`'--library-path' '${join(folder, "libc", "lib")}:${join(folder, "compiler-lib", "lib")}'`);

    const other = await fixture("0.3.0");
    await expect(ensureLinuxRuntime(other, "0.3.2", verified("x"), "x64", "/elsewhere/winix", false, () => "0.3.1"))
      .rejects.toThrow("reports 0.3.1, expected 0.3.2");
    await expect(ensureLinuxRuntime(other, "0.3.2", verified("x"), "ia32")).rejects.toThrow("No standalone Winix release");
  });

  it("--command-only remembers the host and installs the command without evaluating anything", async () => {
    const directory = await fixture("0.1.0");
    const run = vi.fn(async () => {});
    const deps: BootstrapDeps = {
      candidateHosts: vi.fn(async () => []), askHost: vi.fn(async () => ""), installCommand: vi.fn(async () => {}),
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(bootstrapCheckout(directory, { host: "wsl", yes: false, prepareOnly: false, dry: false, commandOnly: true }, run, deps))
      .rejects.toThrow("needs the standalone Winix executable");
    vi.spyOn(runtime, "standaloneRuntime").mockReturnValue({ version: "0.3.0", linuxAssets: {} } as ReturnType<typeof runtime.standaloneRuntime>);
    await bootstrapCheckout(directory, { host: "wsl", yes: false, prepareOnly: false, dry: false, commandOnly: true }, run, deps);
    expect(run).not.toHaveBeenCalled();
    expect(deps.candidateHosts).not.toHaveBeenCalled();
    expect(readRememberedHost(directory)).toBe("wsl");
    expect(deps.installCommand).toHaveBeenCalledWith(directory);
    // No launcher inside the checkout any more: the per-user command routes.
    expect(existsSync(join(directory, ".winix", "bin"))).toBe(false);
  });
});

describe("winix install command", () => {
  async function home(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "winix-home-"));
    temporary.push(directory);
    return directory;
  }

  function deps(environment: HomeEnvironment, executable: string, overrides: Partial<InstallCommandDeps> = {}): InstallCommandDeps & { lines: string[] } {
    const lines: string[] = [];
    return {
      environment, running: { executable, version: "0.4.0" }, arch: "x64", nixos: false,
      exec: vi.fn((_command: string, args: string[]) => (args[0] === "--version" ? "0.4.0\n" : "")),
      addToPath: vi.fn(), log: (line) => lines.push(line), lines, ...overrides,
    };
  }

  it("on Windows: copies the running winix.exe into %LOCALAPPDATA%\\Winix, writes winix.cmd and adds it to PATH", async () => {
    const local = await home();
    const download = join(local, "Downloads", "winix-windows-x64.exe");
    await mkdir(join(local, "Downloads"));
    await writeFile(download, "winix 0.4.0");
    const environment: HomeEnvironment = { platform: "win32", env: { LOCALAPPDATA: local }, home: local };
    // An older install is removed.
    await mkdir(join(local, "Winix", "runtime", "0.3.0"), { recursive: true });
    const installed = join(local, "Winix", "runtime", "0.4.0", "winix.exe");
    const install = deps(environment, download);
    const command = await installWinixCommand(install);
    expect(command).toBe(join(local, "Winix", "bin", "winix.cmd"));
    expect(readFileSync(installed, "utf8")).toBe("winix 0.4.0");
    expect(readFileSync(command, "utf8")).toContain(`"${installed}" run %*`);
    expect(install.addToPath).toHaveBeenCalledWith(join(local, "Winix", "bin"));
    expect(readdirSync(join(local, "Winix", "runtime"))).toEqual(["0.4.0"]);
    // Rerun from the installed copy: nothing to copy, the command is rewritten.
    await installWinixCommand(deps(environment, installed));
    expect(readFileSync(installed, "utf8")).toBe("winix 0.4.0");
    // A winix.cmd Winix didn't write is never replaced.
    await writeFile(command, "@echo mine");
    await expect(installWinixCommand(deps(environment, installed))).rejects.toThrow("unrecognized winix command");
  });

  it("on Linux: installs the binary behind a wrapper in ~/.local/share/winix and ~/.local/bin/winix", async () => {
    const user = await home();
    const binary = join(user, "winix-linux-x64");
    await writeFile(binary, "linux winix");
    const environment: HomeEnvironment = { platform: "linux", env: { PATH: "/usr/bin" }, home: user };
    const install = deps(environment, binary);
    const command = await installWinixCommand(install);
    const folder = join(user, ".local", "share", "winix", "runtime", "0.4.0");
    const wrapper = join(folder, "winix");
    expect(command).toBe(join(user, ".local", "bin", "winix"));
    expect(readFileSync(join(folder, "winix.bin"), "utf8")).toBe("linux winix");
    expect(readFileSync(wrapper, "utf8")).toContain(`exec '${join(folder, "winix.bin")}' "$@"`);
    expect(readFileSync(command, "utf8")).toBe(linuxCommandShim(wrapper));
    expect(install.exec).toHaveBeenCalledWith(wrapper, ["--version"]);
    expect(install.addToPath).not.toHaveBeenCalled();
    expect(install.lines.at(-1)).toContain("~/.local/bin is not on PATH");
    const onPath = deps({ ...environment, env: { PATH: `/usr/bin${delimiter}${join(user, ".local", "bin")}` } }, wrapper);
    await installWinixCommand(onPath);
    expect(onPath.lines.at(-1)).not.toContain("not on PATH");
  });

  it("remembers the bootstrapped checkout only while it holds a config", async () => {
    const local = await home();
    const environment: HomeEnvironment = { platform: "win32", env: { LOCALAPPDATA: local }, home: local };
    const checkout = join(local, "dotfiles", "winix");
    await mkdir(checkout, { recursive: true });
    await rememberCheckout(checkout, environment);
    expect(rememberedCheckout(environment)).toBeUndefined();
    await writeFile(join(checkout, "winix.config.ts"), "");
    expect(rememberedCheckout(environment)).toBe(checkout);
  });
});

describe("winix run (what the winix command runs)", () => {
  async function routed(cwd: string, args: string[], remembered?: string) {
    const calls: unknown[][] = [];
    const deps: RouteDeps = {
      runCheckout: async (directory, routedArgs) => { calls.push(["checkout", directory, routedArgs]); },
      run: async (_command, commandArgs, opts) => { calls.push(["self", opts?.cwd, commandArgs.slice(-args.length)]); },
      remembered: () => remembered,
    };
    await routeRun(cwd, args, deps);
    return calls;
  }

  it("inside a project runs the version it pins, there", async () => {
    const project = await fixture("0.3.0");
    await writeFile(join(project, "winix.config.ts"), "");
    const nested = join(project, "features");
    await mkdir(nested);
    expect(await routed(nested, ["switch"], "/elsewhere")).toEqual([["checkout", project, ["switch"]]]);
    // A project without an exact pin runs this Winix, in the project.
    await writeFile(join(project, "package.json"), "{}");
    expect(await routed(nested, ["check"])).toEqual([["self", project, ["check"]]]);
  });

  it("outside a project, uses the remembered checkout only for commands that need a project", async () => {
    const somewhere = await mkdtemp(join(tmpdir(), "winix-nowhere-"));
    temporary.push(somewhere);
    expect(await routed(somewhere, ["switch"], "/home/me/dotfiles/winix")).toEqual([["checkout", "/home/me/dotfiles/winix", ["switch"]]]);
    expect(await routed(somewhere, ["--version"], "/home/me/dotfiles/winix")).toEqual([["self", somewhere, ["--version"]]]);
    expect(await routed(somewhere, ["windows", "search", "git"], "/home/me/dotfiles/winix")).toEqual([["self", somewhere, ["windows", "search", "git"]]]);
    expect(await routed(somewhere, ["switch"])).toEqual([["self", somewhere, ["switch"]]]);
  });

  it("always starts a new project in the current folder, even inside another one", async () => {
    const project = await fixture("0.3.0");
    await writeFile(join(project, "winix.config.ts"), "");
    const fresh = join(project, "sandbox");
    await mkdir(fresh);
    expect(await routed(fresh, ["init"], "/elsewhere")).toEqual([["self", fresh, ["init"]]]);
    await expect(routeRun(fresh, ["run", "switch"])).rejects.toThrow("cannot be nested");
  });
});
