import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

interface InitOptions {
  force: boolean;
}

export async function init(cwd: string, opts: InitOptions): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await writeIfAllowed(join(cwd, "winix.config.ts"), CONFIG, opts.force);
  await writeIfAllowed(join(cwd, "package.json"), PACKAGE_JSON, opts.force);
  await writeIfAllowed(join(cwd, ".gitignore"), GITIGNORE, opts.force);
  console.log("✓ Initialized Winix project");
}

async function writeIfAllowed(path: string, content: string, force: boolean): Promise<void> {
  if (existsSync(path) && !force) {
    throw new Error(`${path} already exists. Re-run with --force to overwrite.`);
  }
  await writeFile(path, content);
}

const CONFIG = `import { host, packages, platform, user, workspace } from "winix";

const nixos = platform("nixos", () => ({
  nixos: {
    imports: ["home-manager"],
    nixpkgs: { hostPlatform: "x86_64-linux" },
    nix: { settings: { "experimental-features": ["nix-command", "flakes"] } },
    homeManager: { useGlobalPkgs: true, useUserPackages: true },
  },
}));

export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
    homeManager: {
      url: "github:nix-community/home-manager",
      follows: { nixpkgs: "nixpkgs" },
    },
  },
  hosts: [
    host("my-host", nixos(), [
      user("adrifer", { homeDirectory: "/home/adrifer", stateVersion: "25.05" }),
      packages("git", "curl"),
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
    "switch": "winix switch"
  }
}
`;

const GITIGNORE = `.winix/
node_modules/
`;
