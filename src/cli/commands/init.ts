import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installSkill } from "./install.ts";

interface InitOptions {
  force: boolean;
}

export async function init(cwd: string, opts: InitOptions): Promise<void> {
  await mkdir(cwd, { recursive: true });
  const versionRange = await resolveWinixVersionRange();
  const packageJson = renderPackageJson(versionRange);
  await writeIfAllowed(join(cwd, "winix.config.ts"), CONFIG, opts.force);
  await writeIfAllowed(join(cwd, "tsconfig.json"), TSCONFIG, opts.force);
  await writeIfAllowed(join(cwd, "package.json"), packageJson, opts.force);
  await writeIfAllowed(join(cwd, ".gitignore"), GITIGNORE, opts.force);
  await installSkill(cwd, { force: opts.force });
  console.log("✓ Initialized Winix project");
  console.log("");
  console.log("Next steps:");
  console.log("  npm install");
}

async function writeIfAllowed(path: string, content: string, force: boolean): Promise<void> {
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists. Re-run with --force to overwrite.`);
  }
  await writeFile(path, content);
}

const FALLBACK_VERSION_RANGE = "^0.1.0";

export async function resolveWinixVersionRange(): Promise<string> {
  try {
    const here = currentDir();
    // Compiled layout: dist/cli/commands/init.js → ../../../package.json
    // Source layout:   src/cli/commands/init.ts  → ../../../package.json
    const pkgPath = join(here, "..", "..", "..", "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && /^\d+\.\d+\.\d+/.test(parsed.version)) {
      return `^${parsed.version}`;
    }
  } catch {
    // fall through to default
  }
  return FALLBACK_VERSION_RANGE;
}

function currentDir(): string {
  const filePath = fileURLToPath(import.meta.url);
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx === -1 ? "." : filePath.slice(0, idx);
}

function renderPackageJson(versionRange: string): string {
  const escaped = JSON.stringify(versionRange);
  return `{
  "type": "module",
  "private": true,
  "dependencies": {
    "@adrifer/winix": ${escaped}
  },
  "scripts": {
    "check": "winix check",
    "apply": "winix apply",
    "switch": "winix switch"
  }
}
`;
}

const CONFIG = `import { account, host, nixos, platforms, workspace } from "@adrifer/winix";

export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
    homeManager: {
      url: "github:nix-community/home-manager",
      follows: { nixpkgs: "nixpkgs" },
    },
  },
  hosts: [
    host("my-host", platforms.nixos({ stateVersion: "25.05" }), [
      account.user("adrifer", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }))(),
      nixos.packages("git", "curl"),
    ]),
  ],
});
`;

const GITIGNORE = `.winix/
node_modules/
`;

const TSCONFIG = `{
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "esnext",
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": [
    "**/*.ts",
    "node_modules/@adrifer/winix/types/bundled/*.d.ts"
  ]
}
`;
