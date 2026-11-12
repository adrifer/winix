import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkspaceDef } from "../../core/types.ts";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import type { WinWslSetup } from "../../types/index.ts";

interface Request { setup: WinWslSetup; revision: string; fingerprint: string }
interface Plan { user: string; home: string; checkout: string; host: string }
interface State { version: 1; fingerprint: string; revision: string; step: "initial" | "prepared" | "placed" | "account" | "activated"; plan?: Plan }
interface CommandOptions { cwd?: string; user?: string; home?: string; env?: NodeJS.ProcessEnv }
export type SetupRunner = (command: string, args: string[], options?: CommandOptions) => string;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function linuxDirectory(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && value !== "/" &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    !value.slice(1).split("/").some((part) => part === "" || part === "." || part === "..");
}

export function createWslAccountPlan(
  host: EvaluatedHost, setup: WinWslSetup, architecture: string
): { plan: Plan; accountHost: EvaluatedHost } {
  const usersOptions = object(host.nixos.users);
  const users = object(usersOptions.users);
  const home = object(host.homeManager.home);
  const candidates = Object.keys(users).filter((name) => object(users[name]).isNormalUser === true && name !== "root");
  const selected = setup.user ?? (typeof home.username === "string" ? home.username : candidates.length === 1 ? candidates[0] : undefined);
  if (!selected || !/^[a-z_][a-z0-9_-]*$/.test(selected) || !candidates.includes(selected)) {
    throw new Error("WSL setup must select a declared normal Linux user; specify setup.user when ambiguous");
  }
  const account = object(users[selected]);
  if (account.isSystemUser === true || account.uid === 0) throw new Error("WSL setup cannot select a system/root account");
  const userHome = account.home ?? `/home/${selected}`;
  if (!linuxDirectory(userHome)) throw new Error("Invalid declared Linux home directory");
  if (home.username !== undefined && (home.username !== selected || home.homeDirectory !== userHome)) {
    throw new Error("Selected account and Home Manager username/home directory must agree");
  }
  const checkout = setup.checkout ?? `${userHome}/dotfiles`;
  if (!linuxDirectory(checkout) || !checkout.startsWith(`${userHome}/`)) {
    throw new Error("WSL setup checkout must be inside the declared user's home");
  }
  const nixpkgs = object(host.nixos.nixpkgs);
  if (nixpkgs.hostPlatform !== architecture) throw new Error(`Linux host platform must match the distro architecture (${architecture})`);
  const imports = host.nixos.imports;
  const wslImports = Array.isArray(imports) ? imports.filter(
    (entry): entry is string => typeof entry === "string" && /^inputs\.[a-z0-9._-]+\.nixosModules\.wsl$/i.test(entry)
  ) : [];
  if (object(host.nixos.wsl).enable !== true || wslImports.length !== 1 || typeof object(host.nixos.system).stateVersion !== "string") {
    throw new Error("Setup host must explicitly enable NixOS-WSL, import its input module, and declare system.stateVersion");
  }
  const { packages: _packages, ...bootstrapUser } = account;
  const groupNames = [...(Array.isArray(account.extraGroups) ? account.extraGroups : []),
    ...(typeof account.group === "string" ? [account.group] : [])];
  if (groupNames.some((name) => typeof name !== "string" || !/^[a-z_][a-z0-9_-]*$/.test(name))) throw new Error("Unsupported account group name");
  const declaredGroups = object(usersOptions.groups);
  const groups = Object.fromEntries(groupNames.map((name) => {
    const { members: _members, ...group } = object(declaredGroups[name]);
    return [name, group];
  }));
  const shell = object(account.shell).expr;
  const shellProgram = typeof shell === "string" ? /^pkgs\.(zsh|fish)$/.exec(shell)?.[1] : undefined;
  return {
    plan: { user: selected, home: userHome, checkout, host: setup.host },
    accountHost: {
      name: host.name, homeManager: {}, darwin: {}, windows: {},
      nixos: {
        imports: wslImports, nixpkgs,
        nix: { settings: { "experimental-features": ["nix-command", "flakes"] } },
        system: { stateVersion: object(host.nixos.system).stateVersion },
        wsl: { enable: true, defaultUser: selected },
        users: { users: { [selected]: bootstrapUser }, groups },
        ...(shellProgram ? { programs: { [shellProgram]: { enable: true } } } : {}),
      },
    },
  };
}

export async function prepareWslAccount(
  configDirectory: string, accountDirectory: string, setup: WinWslSetup,
  embeddedSdk?: typeof import("../../index.ts")
): Promise<Plan> {
  const configName = [];
  for (const name of ["winix.config.ts", "winix.config.js", "winix.config.mjs"]) {
    if (await exists(join(configDirectory, name))) configName.push(name);
  }
  if (configName.length !== 1) throw new Error("WSL setup configDirectory must contain exactly one Winix config file");
  const sdk = embeddedSdk ?? await import(nativeRun(process.execPath, [
    "--input-type=module", "--eval", 'console.log(import.meta.resolve("@adrifer/winix"))',
  ], { cwd: configDirectory })) as typeof import("../../index.ts");
  const workspace = (await import(pathToFileURL(join(configDirectory, configName[0])).href)).default as WorkspaceDef;
  if (!workspace || !Array.isArray(workspace.hosts)) throw new Error("Invalid Winix workspace");
  const targets = workspace.hosts.filter((host) => host.name === setup.host && host.platform.__id === "nixos");
  if (targets.length !== 1) throw new Error(`WSL setup target "${setup.host}" must identify one NixOS host`);
  const [evaluated] = sdk.evaluate({ ...workspace, hosts: targets });
  const architecture = process.arch === "x64" ? "x86_64-linux" : process.arch === "arm64" ? "aarch64-linux" : "";
  const { plan, accountHost } = createWslAccountPlan(evaluated, setup, architecture);
  const output = sdk.generateNix(workspace, [accountHost]);
  await fs.mkdir(join(accountDirectory, "hosts"), { recursive: true });
  await fs.writeFile(join(accountDirectory, "flake.nix"), output["flake.nix"]);
  for (const [name, content] of Object.entries(output.hosts)) await fs.writeFile(join(accountDirectory, "hosts", name), content);
  await fs.copyFile(join(configDirectory, "flake.lock"), join(accountDirectory, "flake.lock"));
  return plan;
}

function nativeRun(command: string, args: string[], options: CommandOptions = {}): string {
  const env = {
    ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never",
    WINIX_WSL_SETUP_REQUEST: "", WINIX_WSL_SETUP_PREPARE: "", ...options.env,
  };
  const argv = options.user ? [
    "-u", options.user, "--", "env", `HOME=${options.home}`, `PATH=${process.env.PATH}`,
    command, ...args,
  ] : args;
  const result = spawnSync(options.user ? "runuser" : command, argv, {
    cwd: options.cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(
    `${command} failed (${result.status}): ${result.stderr}\n${result.stdout}`
  ), { status: result.status });
  return result.stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try { await fs.lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function safeDirectory(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    if (await exists(current)) {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe setup directory: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  await fs.rename(temporary, path);
}

export async function runWslSetup(
  request: Request,
  options: { stateDirectory?: string; run?: SetupRunner; isRoot?: () => boolean; readWslConfig?: () => Promise<string>; standalone?: boolean; executable?: string } = {}
): Promise<void> {
  if (process.platform !== "linux" || !(options.isRoot ?? (() => process.getuid?.() === 0))()) {
    throw new Error("WSL setup coordinator requires Linux root; repository/npm commands run unprivileged");
  }
  const run = options.run ?? nativeRun;
  const executable = options.executable ?? process.execPath;
  const stateDirectory = options.stateDirectory ?? "/var/lib/winix/wsl-setup";
  await safeDirectory(stateDirectory);
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o711 });
  const directoryStat = await fs.stat(stateDirectory);
  if (directoryStat.uid !== process.getuid?.() || (directoryStat.mode & 0o022)) throw new Error("Unsafe WSL setup state ownership/permissions");
  const lockPath = join(stateDirectory, "run.lock");
  let lock;
  try { lock = await fs.open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("WSL setup is running or was interrupted. Inspect run.lock before manually recovering it.");
    throw error;
  }
  try {
    await lock.writeFile(String(process.pid));
    const statePath = join(stateDirectory, "state.json");
    if (await exists(statePath)) {
      const stat = await fs.lstat(statePath);
      if (!stat.isFile() || stat.uid !== directoryStat.uid || (stat.mode & 0o022)) throw new Error("Unsafe WSL setup state file");
    }
    const state: State = await exists(statePath) ? JSON.parse(await fs.readFile(statePath, "utf8")) : {
      version: 1, fingerprint: request.fingerprint, revision: request.revision, step: "initial",
    };
    if (!state || state.version !== 1 || state.fingerprint !== request.fingerprint ||
        !["initial", "prepared", "placed", "account", "activated"].includes(state.step) ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(state.revision)) {
      throw new Error("Conflicting/corrupt WSL setup state; refusing to overwrite");
    }
    await atomicJson(statePath, state);
    const runtimePath = join(stateDirectory, "runtime.mjs");
    if (!options.standalone) {
      if (!process.env.WINIX_WSL_SETUP_RUNTIME && !options.run) throw new Error("Missing WSL setup runtime payload");
      const runtimeTemporary = `${runtimePath}.${randomUUID()}.tmp`;
      await fs.writeFile(runtimeTemporary, Buffer.from(process.env.WINIX_WSL_SETUP_RUNTIME ?? "", "base64"), { flag: "wx", mode: 0o444 });
      await fs.rename(runtimeTemporary, runtimePath);
    }
    const work = join(stateDirectory, "work");
    const repository = join(work, "repository");
    const accountDirectory = join(work, "account");
    const save = async (step: State["step"]) => { state.step = step; await atomicJson(statePath, state); };
    const passwd = (user: string): { uid: string; gid: string; home: string } | undefined => {
      let output;
      try { output = run("getent", ["passwd", user]); }
      catch (error) { if ((error as { status?: number }).status === 2) return undefined; throw error; }
      const fields = output.split(":");
      if (fields[0] !== user || !/^[1-9]\d*$/.test(fields[2]) || !/^\d+$/.test(fields[3]) || !fields[5]?.startsWith("/")) {
        throw new Error(`Invalid/non-root account expected: ${user}`);
      }
      return { uid: fields[2], gid: fields[3], home: fields[5] };
    };
    const verify = (checkout: string, user: string, home: string) => {
      const git = (args: string[]) => run("git", args, { cwd: checkout, user, home });
      if (git(["remote", "get-url", "origin"]) !== request.setup.repository ||
          git(["rev-parse", "HEAD"]) !== state.revision) throw new Error("Checkout identity/revision changed; refusing reset");
      if (git(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("WSL setup checkout is dirty; refusing reset");
    };
    const prepare = (config: string, user: string, home: string): Plan => {
      const prepared = run(executable, options.standalone ? [] : ["--experimental-transform-types", "--no-warnings", runtimePath], {
        user, home, cwd: config,
        env: { WINIX_WSL_SETUP_PREPARE: JSON.stringify({ config, accountDirectory, setup: request.setup }) },
      });
      const plans = prepared.split(/\r?\n/).filter((line) => line.startsWith("WINIX_PLAN:"));
      if (plans.length !== 1) throw new Error("Linux configuration did not produce exactly one setup plan");
      return JSON.parse(plans[0].slice("WINIX_PLAN:".length));
    };
    if (state.step === "initial") {
      console.log("WSL setup: preparing the locked repository as the image's nixos user");
      const initial = passwd("nixos");
      if (!initial) throw new Error("Fresh NixOS-WSL image must provide its initial nixos account");
      await fs.mkdir(accountDirectory, { recursive: true });
      run("chown", ["-R", "--no-dereference", `${initial.uid}:${initial.gid}`, "--", work]);
      const asInitial: CommandOptions = { user: "nixos", home: initial.home };
      await safeDirectory(repository);
      if (!await exists(repository) || (await fs.readdir(repository)).length === 0) {
        run("git", ["init", `--object-format=${state.revision.length === 64 ? "sha256" : "sha1"}`, "--", repository], asInitial);
      }
      await safeDirectory(join(repository, ".git"));
      if (!await exists(join(repository, ".git"))) throw new Error("Unrecognized staging checkout; refusing adoption");
      const git = (args: string[]) => run("git", args, { ...asInitial, cwd: repository });
      const remotes = git(["remote"]).split(/\r?\n/).filter(Boolean);
      if (!remotes.includes("origin")) git(["remote", "add", "origin", request.setup.repository]);
      if (git(["remote", "get-url", "origin"]) !== request.setup.repository) throw new Error("Conflicting staging repository");
      if (git(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("Staging checkout is dirty; refusing reset");
      let existingHead: string | undefined;
      try { existingHead = git(["rev-parse", "--verify", "HEAD"]); }
      catch (error) { if ((error as { status?: number }).status !== 128) throw error; }
      if (existingHead && existingHead !== state.revision) throw new Error("Staging revision changed; refusing reset");
      git(["fetch", "--depth=1", "--no-tags", "origin", state.revision]);
      git(["checkout", "--detach", state.revision]);
      verify(repository, "nixos", initial.home);
      const config = await fs.realpath(join(repository, request.setup.configDirectory));
      const inside = relative(await fs.realpath(repository), config);
      if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("configDirectory escapes the checkout");
      for (const name of options.standalone ? ["flake.lock"] : ["package-lock.json", "package.json", "flake.lock"]) {
        if (!await exists(join(config, name))) throw new Error(`WSL setup requires committed ${name} in configDirectory`);
      }
      if (!options.standalone) run("npm", ["ci", "--no-audit", "--no-fund"], { ...asInitial, cwd: config });
      verify(repository, "nixos", initial.home);
      state.plan = prepare(config, "nixos", initial.home);
      await save("prepared");
    }
    const plan = state.plan;
    if (!plan || typeof plan.user !== "string" || !/^[a-z_][a-z0-9_-]*$/.test(plan.user) || plan.user === "root" ||
        plan.host !== request.setup.host || !linuxDirectory(plan.home) || !linuxDirectory(plan.checkout) ||
        !plan.checkout.startsWith(`${plan.home}/`) ||
        (request.setup.user !== undefined && request.setup.user !== plan.user) ||
        (request.setup.checkout !== undefined && request.setup.checkout !== plan.checkout)) {
      throw new Error("Invalid recorded WSL account/checkout plan");
    }
    if (state.step === "prepared") {
      await safeDirectory(plan.checkout);
      if (await exists(plan.checkout)) {
        if (await exists(repository)) throw new Error("WSL setup checkout already exists; refusing adoption/overwrite");
        // A crash between rename and recording the next stage is resumable.
        const initial = passwd("nixos");
        if (!initial) throw new Error("Cannot verify the interrupted checkout move without the initial account");
        await safeDirectory(join(plan.checkout, ".git"));
        verify(plan.checkout, "nixos", initial.home);
      } else {
        await fs.mkdir(dirname(plan.checkout), { recursive: true });
        await fs.rename(repository, plan.checkout);
      }
      await save("placed");
    }
    if (state.step === "placed") {
      await safeDirectory(join(plan.checkout, ".git"));
      const initial = passwd("nixos");
      const owner = initial ?? passwd(plan.user);
      if (!owner) throw new Error("Cannot verify checkout ownership before account activation");
      if (!initial) run("chown", ["-R", "--no-dereference", `${owner.uid}:${owner.gid}`, "--", plan.checkout]);
      const ownerName = initial ? "nixos" : plan.user;
      verify(plan.checkout, ownerName, owner.home);
      await safeDirectory(accountDirectory);
      run("chown", ["-R", "--no-dereference", `${owner.uid}:${owner.gid}`, "--", accountDirectory]);
      // Re-evaluate after moving: account file paths can depend on import.meta.url.
      const placedPlan = prepare(join(plan.checkout, request.setup.configDirectory), ownerName, owner.home);
      if (!placedPlan || (["user", "home", "checkout", "host"] as const).some((key) => placedPlan[key] !== plan[key])) {
        throw new Error("Linux account plan changed after placing the checkout; refusing activation");
      }
      verify(plan.checkout, ownerName, owner.home);
      console.log("WSL setup: activating the declarative account-only NixOS configuration");
      run("nixos-rebuild", ["switch", "--flake", `path:${accountDirectory}#${plan.host}`, "--no-write-lock-file"]);
      await save("account");
    }
    const account = passwd(plan.user);
    if (!account || account.home !== plan.home) throw new Error("Activated Linux account/home does not match the setup plan");
    await safeDirectory(plan.checkout);
    run("chown", ["-R", "--no-dereference", `${account.uid}:${account.gid}`, "--", plan.checkout]);
    for (let parent = dirname(plan.checkout); ; parent = dirname(parent)) {
      run("chown", [`${account.uid}:${account.gid}`, "--", parent]);
      if (parent === plan.home) break;
    }
    const asUser: CommandOptions = { user: plan.user, home: plan.home, cwd: join(plan.checkout, request.setup.configDirectory) };
    verify(plan.checkout, plan.user, plan.home);
    if (state.step === "account") {
      console.log("WSL setup: generating and activating the full Linux host");
      if (options.standalone) run(executable, ["apply", "--host", plan.host], asUser);
      else run("npm", ["exec", "--offline", "--", "winix", "apply", "--host", plan.host], asUser);
      const flake = `path:${join(asUser.cwd!, ".winix", "out")}`;
      const defaultUser = run("nix", ["eval", "--raw", "--no-write-lock-file", `${flake}#nixosConfigurations.${JSON.stringify(plan.host)}.config.wsl.defaultUser`], asUser);
      if (defaultUser !== plan.user) throw new Error("Full Linux host must select the setup account as wsl.defaultUser");
      run("nixos-rebuild", ["switch", "--flake", `${flake}#${plan.host}`, "--no-write-lock-file"]);
      await save("activated");
    }
    const wslConfig = await (options.readWslConfig ?? (() => fs.readFile("/etc/wsl.conf", "utf8")))();
    let userSection = false;
    const matchesDefault = wslConfig.split(/\r?\n/).some((line) => {
      const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (section) { userSection = section[1] === "user"; return false; }
      return userSection && new RegExp(`^\\s*default\\s*=\\s*${plan.user}\\s*$`).test(line);
    });
    if (!matchesDefault) {
      throw new Error("Linux activation did not configure the expected WSL default user");
    }
    verify(plan.checkout, plan.user, plan.home);
    const completeTemporary = join(stateDirectory, `complete.${randomUUID()}.tmp`);
    await fs.writeFile(completeTemporary, `${request.fingerprint}\n${plan.user}\n${plan.checkout}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(completeTemporary, join(stateDirectory, "complete"));
    console.log("WSL setup complete. Restart WSL manually if needed for its default-user setting; no shutdown was performed.");
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

export async function dispatchWslSetup(embeddedSdk?: typeof import("../../index.ts")): Promise<void> {
  if (process.env.WINIX_WSL_SETUP_PREPARE) {
    const { config, accountDirectory, setup } = JSON.parse(process.env.WINIX_WSL_SETUP_PREPARE);
    console.log("WINIX_PLAN:" + JSON.stringify(await prepareWslAccount(config, accountDirectory, setup, embeddedSdk)));
  } else if (process.env.WINIX_WSL_SETUP_REQUEST) {
    await runWslSetup(JSON.parse(Buffer.from(process.env.WINIX_WSL_SETUP_REQUEST, "base64").toString("utf8")), {
      standalone: embeddedSdk !== undefined,
      executable: embeddedSdk ? process.env.WINIX_STANDALONE_EXECUTABLE : undefined,
    });
  } else {
    throw new Error("Missing WSL setup request");
  }
}
