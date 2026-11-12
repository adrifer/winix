import { execFileSync } from "node:child_process";

/** DSC consumes Windows paths even when the configuration is generated in WSL. */
export function windowsSourcePath(
  path: string,
  osPlatform: NodeJS.Platform = process.platform,
  wslDistribution = process.env.WSL_DISTRO_NAME,
  convert = (source: string): string => execFileSync("wslpath", ["-w", source], { encoding: "utf8" })
): string {
  if (osPlatform !== "linux" || !wslDistribution || !path.startsWith("/")) return path;
  try {
    const converted = convert(path).trim();
    if (!/^(?:[a-z]:\\|\\\\)/i.test(converted)) {
      throw new Error("wslpath did not return an absolute Windows path");
    }
    return converted;
  } catch (error) {
    throw new Error(
      `Cannot translate Windows file source "${path}" from WSL: ` +
      (error instanceof Error ? error.message : String(error)),
      { cause: error }
    );
  }
}
