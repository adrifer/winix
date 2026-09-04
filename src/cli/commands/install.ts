import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SKILL_WRAPPER_PATH = join(".agents", "skills", "winix", "SKILL.md");

interface InstallSkillOptions {
  force: boolean;
}

export async function installSkill(
  cwd: string,
  opts: InstallSkillOptions
): Promise<"installed" | "current"> {
  const path = join(cwd, SKILL_WRAPPER_PATH);
  if (existsSync(path)) {
    const current = await readFile(path, "utf-8");
    if (current === SKILL_WRAPPER) return "current";
    if (!opts.force) {
      throw new Error(`${path} already exists. Re-run with --force to overwrite.`);
    }
  }

  await mkdir(join(cwd, ".agents", "skills", "winix"), { recursive: true });
  await writeFile(path, SKILL_WRAPPER);
  return "installed";
}

export const SKILL_WRAPPER = `---
name: winix
description: Use Winix to create, change, validate, generate, or activate typed system configuration for NixOS, nix-darwin, Home Manager, and Windows. Invoke when the user mentions Winix or asks to work on a Winix configuration.
---

# Winix

The installed Winix binary is the authoritative source for its current agent
instructions. Before answering a Winix question or editing a Winix project,
load the version-matched skill:

\`\`\`bash
winix --skill
\`\`\`

Follow the returned instructions for the rest of the task. Do not rely on a
previously cached or remembered copy. Winix commands, helpers, configuration
structure, platform support, and safety requirements may change between
installed versions.

Running \`winix --skill\` only prints instructions. It does not evaluate a
configuration, generate files, activate a host, or modify the project.
`;
