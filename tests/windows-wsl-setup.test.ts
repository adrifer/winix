import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { account, evaluate, host, nixos, platforms, windows, workspace } from "../src/index.ts";
import { createWslAccountPlan } from "../src/backends/windows/wsl-setup-runtime.ts";
import { normalizeWslSetup } from "../src/helpers/windows.ts";
import { emptyWindowsLock, readWindowsLock, resolveWindowsWslRepositories, serializeWindowsLock } from "../src/backends/windows/lockfile.ts";
import { resolveWslRepository, wslRepositoryKey, wslSetupPrelude } from "../src/backends/windows/wsl-setup.ts";
import { applyWorkspace } from "../src/cli/commands/apply.ts";
import { update } from "../src/cli/commands/update.ts";
import { pathToFileURL } from "node:url";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const linuxAvailable = process.platform === "linux" || (process.platform === "win32" && (() => {
  try { execFileSync("wsl.exe", ["--", "node", "--version"], { stdio: "ignore", timeout: 15000 }); return true; }
  catch { return false; }
})());

const setup = normalizeWslSetup({
  repository: "https://github.com/example/dotfiles.git", ref: "main",
  configDirectory: "winix", host: "linux", user: "alice", checkout: "/home/alice/dotfiles",
});
const revision = "a".repeat(40);
const pin = { repository: setup.repository, ref: setup.ref!, revision, resolvedAt: "2026-11-12T00:00:00.000Z" };
function windowsHosts() {
  return evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), ({ windows }) => {
    windows.package({ id: "Microsoft.WSL", version: "3.0.5" });
    windows.wsl();
    windows.wsl.distro("NixOS", { source: "nixos-wsl", installLocation: "C:\\WSL\\NixOS", setup });
  })] }));
}
function linuxHost() {
  const alice = account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }));
  return evaluate(workspace({ inputs: {}, hosts: [host("linux", platforms.nixos({ stateVersion: "25.05" }), [
    alice(), nixos.imports("inputs.nixos-wsl.nixosModules.wsl"), nixos({ wsl: { enable: true } }),
  ])] }))[0];
}

describe("WSL first-run setup declarations and locks", () => {
  it("rejects credentials, path escapes, unsafe refs and privileged account selection", () => {
    for (const invalid of [
      { repository: "file:///tmp/repo" }, { repository: "https://user:secret@example.com/repo" },
      { repository: "https://example.com/repo?token=secret" }, { configDirectory: "../outside" },
      { configDirectory: "C:\\repo" }, { ref: "--upload-pack=bad" }, { ref: "main..other" },
      { checkout: "/home/alice/../root" }, { checkout: "///" }, { user: "root" },
    ]) expect(() => normalizeWslSetup({ ...setup, ...invalid })).toThrow();
    expect(normalizeWslSetup({ ...setup, ref: undefined }).ref).toBe("HEAD");
  });

  it("resolves exact branches and peeled tags without accepting ambiguous names", () => {
    const git = vi.mocked(execFileSync);
    git.mockClear();
    expect(resolveWslRepository(setup.repository, revision)).toBe(revision);
    expect(git).not.toHaveBeenCalled();
    git.mockReturnValueOnce(`${revision}\trefs/heads/main\n`);
    expect(resolveWslRepository(setup.repository, "main")).toBe(revision);
    expect(git.mock.calls.at(-1)?.[1]).toEqual([
      "ls-remote", "--exit-code", "--", setup.repository, "refs/heads/main", "refs/tags/main", "refs/tags/main^{}",
    ]);
    git.mockReturnValueOnce(`${"b".repeat(40)}\trefs/tags/v1\n${revision}\trefs/tags/v1^{}\n`);
    expect(resolveWslRepository(setup.repository, "refs/tags/v1")).toBe(revision);
    git.mockReturnValueOnce(`${"b".repeat(40)}\trefs/tags/main\n${revision}\trefs/heads/main\n`);
    expect(() => resolveWslRepository(setup.repository, "main")).toThrow("Ambiguous");
    git.mockImplementationOnce(() => { throw new Error("lookup failed"); });
    expect(() => resolveWslRepository(setup.repository, "main")).toThrow("lookup failed");
  });

  it("pins and reuses commits, refreshes explicitly and preserves prior locks on failure", async () => {
    const original = emptyWindowsLock();
    const resolver = vi.fn(() => revision);
    const evaluated = windowsHosts();
    const result = resolveWindowsWslRepositories(original, [...evaluated, ...evaluated], resolver, new Date());
    const key = wslRepositoryKey(setup);
    expect(result.lock.wslRepositories?.[key].revision).toBe(revision);
    expect(original.wslRepositories).toBeUndefined();
    expect(resolveWindowsWslRepositories(result.lock, windowsHosts(), resolver, new Date(), true).changed).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(1);
    const changed = resolveWindowsWslRepositories(result.lock, windowsHosts(), () => "b".repeat(40));
    expect(changed.lock.wslRepositories?.[key].revision).toBe("b".repeat(40));
    expect(() => resolveWindowsWslRepositories(result.lock, windowsHosts(), () => "invalid")).toThrow("revision");
    expect(result.lock.wslRepositories?.[key].revision).toBe(revision);
    const dir = await mkdtemp(join(tmpdir(), "winix-setup-lock-"));
    try {
      await writeFile(join(dir, "winix-windows.lock"), serializeWindowsLock(result.lock));
      expect(readWindowsLock(dir)?.wslRepositories).toEqual(result.lock.wslRepositories);
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        ...result.lock, wslRepositories: { [key]: { ...pin, repository: "https://user:secret@example.com/repo" } },
      }));
      expect(() => readWindowsLock(dir)).toThrow("repository pin");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rejects ambiguous/system accounts, inconsistent homes and missing WSL declarations", () => {
    const ambiguous = linuxHost();
    ambiguous.homeManager = {};
    ambiguous.nixos.users = { users: { alice: { isNormalUser: true }, bob: { isNormalUser: true } } };
    expect(() => createWslAccountPlan(ambiguous, { ...setup, user: undefined }, "x86_64-linux")).toThrow("ambiguous");
    for (const invalid of [{ isNormalUser: true, isSystemUser: true }, { isNormalUser: true, uid: 0 }]) {
      const evaluated = linuxHost();
      evaluated.nixos.users = { users: { alice: invalid } };
      expect(() => createWslAccountPlan(evaluated, setup, "x86_64-linux")).toThrow("system/root");
    }
    const mismatch = linuxHost();
    mismatch.homeManager.home = { username: "alice", homeDirectory: "/home/someone-else" };
    expect(() => createWslAccountPlan(mismatch, setup, "x86_64-linux")).toThrow("agree");
    const noWsl = linuxHost();
    noWsl.nixos.wsl = { enable: false };
    expect(() => createWslAccountPlan(noWsl, setup, "x86_64-linux")).toThrow("explicitly enable");
  });

  it("loads the repository's installed SDK and produces a minimal account flake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-account-prepare-"));
    try {
      const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      const config = join(dir, "config");
      const installed = join(config, "node_modules", "@adrifer", "winix");
      await mkdir(installed, { recursive: true });
      await writeFile(join(installed, "package.json"), JSON.stringify({
        type: "module", exports: { ".": { types: "./index.d.ts", import: "./index.mjs" } },
      }));
      await writeFile(join(installed, "index.mjs"), `export * from ${JSON.stringify(sdk)};`);
      await writeFile(join(config, "package.json"), "{}");
      await writeFile(join(config, "flake.lock"), "{}");
      await writeFile(join(config, "winix.config.mjs"), `
import {account,host,input,nixos,platforms,workspace} from ${JSON.stringify(sdk)};
const alice=account.user("alice",()=>({admin:true,shell:"zsh",stateVersion:"25.05"}));
export default workspace({inputs:{nixosWsl:input("github:nix-community/NixOS-WSL")},hosts:[
host("linux",platforms.nixos({stateVersion:"25.05",system:${JSON.stringify(process.arch === "arm64" ? "aarch64-linux" : "x86_64-linux")}}),[
alice(),nixos.imports("inputs.nixos-wsl.nixosModules.wsl"),nixos({wsl:{enable:true}})
])]});`);
      const output = join(dir, "account");
      const runtime = pathToFileURL(join(process.cwd(), "src", "backends", "windows", "wsl-setup-runtime.ts")).href;
      const plan = execFileSync(process.execPath, ["--experimental-transform-types", "--no-warnings", "--input-type=module", "--eval", `
import {prepareWslAccount} from ${JSON.stringify(runtime)};
console.log(JSON.stringify(await prepareWslAccount(${JSON.stringify(config)},${JSON.stringify(output)},${JSON.stringify(setup)})));
`], { encoding: "utf8", timeout: 15000 });
      expect(plan).toContain('"user":"alice"');
      const module = await readFile(join(output, "hosts", "linux.nix"), "utf8");
      expect(module).toContain("experimental-features");
      expect(module).toContain('defaultUser = "alice"');
      expect(module).not.toContain("home-manager");
      expect(await readFile(join(output, "flake.lock"), "utf8")).toBe("{}");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("derives the account from Linux declarations and excludes Home Manager from the preparatory activation", () => {
    const evaluated = linuxHost();
    const result = createWslAccountPlan(evaluated, { ...setup, user: undefined }, "x86_64-linux");
    expect(result.plan).toEqual({ user: "alice", home: "/home/alice", checkout: "/home/alice/dotfiles", host: "linux" });
    expect(result.accountHost.homeManager).toEqual({});
    expect(result.accountHost.nixos).not.toHaveProperty("homeManager");
    expect(result.accountHost.nixos).toMatchObject({
      wsl: { enable: true, defaultUser: "alice" },
      users: { users: { alice: { isNormalUser: true, extraGroups: ["wheel"] } } },
      programs: { zsh: { enable: true } },
    });
    expect(() => createWslAccountPlan(evaluated, { ...setup, user: "missing" }, "x86_64-linux")).toThrow("declared");
    expect(() => createWslAccountPlan(evaluated, { ...setup, checkout: "/tmp/dotfiles" }, "x86_64-linux")).toThrow("inside");
    expect(() => createWslAccountPlan(evaluated, setup, "aarch64-linux")).toThrow("architecture");
  });

  it("generates UTF-8 stdin transport and a read-only, first-run completion probe", () => {
    const script = wslSetupPrelude(setup, pin).join("\n");
    expect(script).toContain("RedirectStandardInput = $true");
    expect(script).toContain("StandardInputEncoding = [Text.UTF8Encoding]::new($false)");
    expect(script).toContain("exit 3");
    expect(script).toContain("getent passwd");
    expect(script).not.toContain("--shutdown");
    expect(script).not.toContain("--unregister");
    expect(() => wslSetupPrelude(setup, { ...pin, revision: "invalid" })).toThrow("pin");
  });

  it.skipIf(!linuxAvailable)("emits valid Bash for both probe and setup, with no mutation during an incomplete probe", () => {
    const script = wslSetupPrelude(setup, pin).join("\n");
    const encoded = /\$script = if \(\$TestOnly\) \{ '((?:[^']|'')*)' \} else \{ '((?:[^']|'')*)' \}/s.exec(script);
    expect(encoded).not.toBeNull();
    const probe = encoded![1].replaceAll("''", "'");
    const activate = encoded![2].replaceAll("''", "'");
    const bash = (input: string, args: string[]) => execFileSync(
      process.platform === "win32" ? "wsl.exe" : "bash",
      process.platform === "win32" ? ["--", "bash", ...args] : args,
      { input, encoding: "utf8", timeout: 15000 },
    );
    bash(probe, ["-n"]);
    bash(activate, ["-n"]);
    // Redirect only the read-only state lookup into a guaranteed-absent location.
    const missing = `/tmp/winix-absent-probe-${Date.now()}-${process.pid}`;
    try {
      bash(probe.replace("state=/var/lib/winix/wsl-setup", `state=${missing}`) + "\n", ["-s"]);
      throw new Error("Incomplete setup probe unexpectedly succeeded");
    } catch (error) {
      expect(error).toMatchObject({ status: 3 });
    }
  });

  it("previews missing commits without writing and refreshes only selected setup pins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-setup-cli-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sdk = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      await writeFile(join(dir, "winix.config.mjs"), `
import {workspace,host,platforms} from ${JSON.stringify(sdk)};
export default workspace({inputs:{},hosts:[host("desktop",platforms.windows(),({windows})=>{
  windows.package({id:"Microsoft.WSL",version:"3.0.5"}); windows.wsl();
  windows.wsl.distro("NixOS",{source:"nixos-wsl",installLocation:"C:/WSL/NixOS",setup:${JSON.stringify(setup)}});
})]});`);
      const image = (architecture: "x64" | "arm64") => ({
        source: "nixos-wsl" as const, architecture, version: "2605.7.2", sha256: "f".repeat(64),
        url: `https://github.com/nix-community/NixOS-WSL/releases/download/2605.7.2/${architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl"}`,
      });
      await applyWorkspace(dir, { dry: true, diff: false, resolveWindowsWslImage: image, resolveWindowsWslRepository: () => revision });
      await expect(readFile(join(dir, "winix-windows.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsWslImage: image, resolveWindowsWslRepository: () => revision });
      const saved = await readFile(join(dir, "winix-windows.lock"), "utf8");
      await applyWorkspace(dir, { dry: true, diff: false, resolveWindowsWslRepository: () => { throw new Error("must reuse"); } });
      await update(dir, { windows: true, dry: true, inputs: ["wsl-setup"], resolveWindowsWslRepository: () => "b".repeat(40) });
      expect(await readFile(join(dir, "winix-windows.lock"), "utf8")).toBe(saved);
      await update(dir, { windows: true, dry: false, inputs: ["wsl-setup"], resolveWindowsWslRepository: () => "b".repeat(40) });
      expect(readWindowsLock(dir)?.wslRepositories?.[wslRepositoryKey(setup)].revision).toBe("b".repeat(40));
    } finally { log.mockRestore(); warn.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  });
});

describe.skipIf(!linuxAvailable)("Linux WSL setup state machine with mocked system commands", () => {
  it("resumes failed activations, protects dirty/colliding checkouts, and never repeats completed builds", () => {
    const source = stripTypeScriptTypes(readFileSync(join(process.cwd(), "src", "backends", "windows", "wsl-setup-runtime.ts"), "utf8"), { mode: "transform" });
    const test = `
const assert = (await import('node:assert/strict')).default;
const syncfs = await import('node:fs');
const os = await import('node:os');
const root = await fs.mkdtemp(join(os.tmpdir(), 'winix-setup-test-'));
try {
  for (const scenario of ['normal', 'account-failure', 'full-failure', 'collision', 'dirty', 'placed-dirty', 'wrong-section', 'revision-drift']) {
    const directory = join(root, scenario);
    const home = join(directory, 'home', 'alice');
    const checkout = join(home, 'dotfiles');
    const config = { repository:'https://example.com/dotfiles.git',ref:'main',configDirectory:'winix',host:'linux',user:'alice',checkout };
    const request = {setup:config, revision:'${revision}',fingerprint:'test-fingerprint'};
    let active = false, accountCalls = 0, fullCalls = 0, checkoutCalls = 0, dirty = false, failed = false, wslReads = 0, preparedAt;
    const calls = [];
    if (scenario === 'collision') { await fs.mkdir(checkout,{recursive:true}); await fs.writeFile(join(checkout,'keep'),'important'); }
    const runner = (command,args,options={})=>{
      calls.push({command,args,options});
      if (command === 'getent') {
        const name = args[1];
        if (name==='alice' && !active) throw Object.assign(new Error('missing'),{status:2});
        return name+':x:'+(process.getuid()||1000)+':'+process.getgid()+':User:'+(name==='alice'?home:join(directory,'initial'))+':/bin/bash';
      }
      if (command==='chown') return '';
      if (command==='git') {
        assert.ok(['init','remote','status','rev-parse','fetch','checkout'].includes(args[0]), 'Unexpected Git mutation');
        if(args[0]==='init') {
          const target=args.at(-1);
          syncfs.mkdirSync(join(target,'.git'),{recursive:true});
          syncfs.mkdirSync(join(target,'winix'),{recursive:true});
          for(const name of ['package.json','package-lock.json','flake.lock']) syncfs.writeFileSync(join(target,'winix',name),'{}');
        }
        if(args[0]==='remote' && args.length===1) return 'origin';
        if(args[0]==='remote' && args[1]==='get-url') return config.repository;
        if(args[0]==='status') return dirty?' M changed.ts':'';
        if(args[0]==='rev-parse') {
          if(scenario==='revision-drift') return 'b'.repeat(40);
          if(!checkoutCalls) throw Object.assign(new Error('no HEAD'),{status:128});
          return request.revision;
        }
        if(args[0]==='checkout') checkoutCalls++;
        return '';
      }
      if(command===process.execPath) { preparedAt=options.cwd;return 'WINIX_PLAN:'+JSON.stringify({user:'alice',home,checkout,host:'linux'}); }
      if(command==='npm') { assert.notEqual(options.user,undefined); return ''; }
      if(command==='nix') return 'alice';
      if(command==='nixos-rebuild') {
        const minimal = args[args.indexOf('--flake')+1].includes('/work/account#');
        if(minimal) {
          assert.equal(preparedAt,join(checkout,'winix'),'Account file paths must refer to the final checkout location');
          accountCalls++;
          if(['account-failure','placed-dirty'].includes(scenario)&&!failed){failed=true;dirty=scenario==='placed-dirty';throw new Error('simulated account interruption');}
          active=true;
        } else {
          fullCalls++;
          if((scenario==='full-failure'||scenario==='dirty')&&!failed){failed=true;dirty=scenario==='dirty';throw new Error('simulated full interruption');}
        }
        return '';
      }
      throw new Error('Unexpected real command: '+command);
    };
    const options = {stateDirectory:join(directory,'state'),run:runner,isRoot:()=>true,
      readWslConfig:async()=>scenario==='wrong-section'&&wslReads++===0?'[network]\\ndefault=alice\\n':'[user]\\ndefault=alice\\n'};
    if(scenario!=='normal') {
      await assert.rejects(runWslSetup(request,options));
      assert.equal(syncfs.existsSync(join(directory,'state','complete')),false);
      assert.equal(syncfs.existsSync(join(directory,'state','run.lock')),false);
    }
    if(scenario==='collision') { assert.equal(await fs.readFile(join(checkout,'keep'),'utf8'),'important');assert.equal(accountCalls,0);continue; }
    if(scenario==='revision-drift') { assert.equal(checkoutCalls,0);assert.equal(accountCalls,0);continue; }
    if(scenario==='dirty'||scenario==='placed-dirty') {
      const before=accountCalls+fullCalls;
      await assert.rejects(runWslSetup(request,options),/dirty/);
      assert.equal(accountCalls+fullCalls,before);
      dirty=false;
    }
    await runWslSetup(request,options);
    assert.equal(checkoutCalls,1);
    const builds=accountCalls+fullCalls;
    await runWslSetup({...request,revision:'b'.repeat(40)},options);
    assert.equal(accountCalls+fullCalls,builds);
    assert.equal(await fs.readFile(join(directory,'state','complete'),'utf8'),'test-fingerprint\\nalice\\n'+checkout+'\\n');
    for(const call of calls.filter(call=>['git','npm',process.execPath].includes(call.command))) assert.ok(call.options.user);
    await assert.rejects(runWslSetup({...request,fingerprint:'changed'},options),/Conflicting/);
  }
  const locked = join(root,'locked');
  await fs.mkdir(locked,{mode:0o711});
  await fs.writeFile(join(locked,'run.lock'),'123');
  await assert.rejects(runWslSetup({setup:{},revision:'${revision}',fingerprint:'test'},
    {stateDirectory:locked,isRoot:()=>true,run:()=>{throw new Error('Unexpected command');}}),/run.lock/);
  assert.equal(await fs.readFile(join(locked,'run.lock'),'utf8'),'123');
  console.log('WINIX_TEST_SUCCESS');
} finally { await fs.rm(root,{recursive:true,force:true}); }
`;
    const command = process.platform === "win32" ? "wsl.exe" : process.execPath;
    const args = process.platform === "win32" ? ["--", "node", "--input-type=module", "-"] : ["--input-type=module", "-"];
    const output = execFileSync(command, args, { input: source + "\n" + test, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    expect(output).toContain("WINIX_TEST_SUCCESS");
  }, 65000);
});
