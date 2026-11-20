// The host this checkout was bootstrapped for, kept in the (ignored) .winix
// directory so `winix switch` needs no --host on a PC whose Windows name does
// not match a declared host (a fresh install is DESKTOP-XXXXXXX).

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function rememberedHostPath(configDir: string): string {
  return join(configDir, ".winix", "host");
}

export function readRememberedHost(configDir: string): string | undefined {
  const path = rememberedHostPath(configDir);
  if (!existsSync(path)) return undefined;
  const host = readFileSync(path, "utf8").trim();
  return host && !/[\0\r\n]/.test(host) ? host : undefined;
}

export async function rememberHost(configDir: string, host: string): Promise<void> {
  await mkdir(join(configDir, ".winix"), { recursive: true });
  await writeFile(rememberedHostPath(configDir), `${host}\n`, "utf8");
}
