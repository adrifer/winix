import { execFileSync } from "node:child_process";
import type { WinPackageSource } from "../../types/index.ts";

export type WingetShowRunner = (id: string, source: WinPackageSource) => string;

export const WINGET_RESOLUTION_WINDOWS_ONLY_MESSAGE =
  "winget version resolution is only available on Windows. " +
  "Run `winix update --windows` on a Windows machine.";

export function resolveWingetVersion(
  id: string,
  source: WinPackageSource,
  runWingetShow: WingetShowRunner = runWingetShowCommand,
  osPlatform: NodeJS.Platform = process.platform
): string {
  assertWingetResolutionSupported(osPlatform);

  let output: string;
  try {
    output = runWingetShow(id, source);
  } catch (err) {
    throw wingetError(id, source, err);
  }

  return parseWingetShowVersion(id, source, output);
}

export function assertWingetResolutionSupported(
  osPlatform: NodeJS.Platform = process.platform
): void {
  if (osPlatform === "win32") return;
  throw new Error(WINGET_RESOLUTION_WINDOWS_ONLY_MESSAGE);
}

export function parseWingetShowVersion(
  id: string,
  source: WinPackageSource,
  output: string
): string {
  if (/No package found/i.test(output)) {
    throw new Error(`Windows package "${id}" was not found in source "${source}".`);
  }

  const versionLine = output
    .split(/\r?\n/)
    .find((line) => /^\s*Version\s*:/i.test(line));
  const version = versionLine?.replace(/^\s*Version\s*:/i, "").trim();
  if (version) return version;

  throw new Error(
    `winget show did not report a Version for Windows package "${id}" ` +
    `from source "${source}".`
  );
}

function runWingetShowCommand(id: string, source: WinPackageSource): string {
  return execFileSync(
    "winget",
    ["show", "--id", id, "--source", source, "--exact"],
    { encoding: "utf-8" }
  );
}

function wingetError(id: string, source: WinPackageSource, err: unknown): Error {
  if (isNodeError(err) && err.code === "ENOENT") {
    return new Error(WINGET_RESOLUTION_WINDOWS_ONLY_MESSAGE);
  }

  const output = wingetErrorOutput(err);
  if (/No package found/i.test(output)) {
    return new Error(`Windows package "${id}" was not found in source "${source}".`);
  }

  const details = output.trim() || (err instanceof Error ? err.message : String(err));
  return new Error(
    `Failed to resolve Windows package "${id}" from source "${source}" with winget: ` +
    details
  );
}

function wingetErrorOutput(err: unknown): string {
  if (!isObject(err)) return "";
  const stdout = bufferOrStringToString(err.stdout);
  const stderr = bufferOrStringToString(err.stderr);
  return [stdout, stderr].filter(Boolean).join("\n");
}

function bufferOrStringToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf-8");
  return "";
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
