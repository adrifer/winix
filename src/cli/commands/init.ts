import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

interface InitOptions {
  force: boolean;
}

export async function init(cwd: string, opts: InitOptions): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await writeIfAllowed(join(cwd, "winix.config.ts"), CONFIG, opts.force);
  await writeIfAllowed(join(cwd, "tsconfig.json"), TSCONFIG, opts.force);
  await writeIfAllowed(join(cwd, "package.json"), PACKAGE_JSON, opts.force);
  await writeIfAllowed(join(cwd, ".gitignore"), GITIGNORE, opts.force);
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

const CONFIG = `import { account, host, nixos, platforms, workspace } from "winix";

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

const PACKAGE_JSON = `{
  "type": "module",
  "private": true,
  "dependencies": {
    "winix": "^0.1.0"
  },
  "scripts": {
    "check": "winix check",
    "apply": "winix apply",
    "switch": "winix switch",
  }
}
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
    "node_modules/winix/types/bundled/*.d.ts"
  ]
}
`;
