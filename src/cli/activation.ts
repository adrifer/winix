export type ActivationPlatform = "nixos" | "darwin";

export function activationCommand(
  platform: ActivationPlatform,
  flake: string,
  isRoot = isCurrentProcessRoot(),
  osPlatform: NodeJS.Platform = process.platform
): string[] {
  const command =
    platform === "darwin"
      ? ["darwin-rebuild", "switch", "--flake", flake]
      : ["nixos-rebuild", "switch", "--flake", flake];

  if (osPlatform === "win32") return command;
  return withSudo(command, isRoot);
}

export function assertActivationSupported(
  platform: ActivationPlatform,
  osPlatform: NodeJS.Platform = process.platform
): void {
  if (osPlatform !== "win32") return;

  const target = platform === "darwin" ? "nix-darwin" : "NixOS";
  const supportedEnvironment = platform === "darwin" ? "macOS" : "WSL or Linux";
  throw new Error(
    `${target} activation is not supported from native Windows yet. ` +
    "Use `winix apply` or `winix apply --dry` to generate output, then run " +
    `\`winix switch\` from ${supportedEnvironment}.`
  );
}

export function platformForEvaluatedHost(host: {
  nixos: Record<string, unknown>;
  darwin: Record<string, unknown>;
}): ActivationPlatform {
  return Object.keys(host.darwin).length > 0 && Object.keys(host.nixos).length === 0
    ? "darwin"
    : "nixos";
}

function withSudo(command: string[], isRoot: boolean): string[] {
  if (isRoot) return command;
  return ["sudo", ...command];
}

function isCurrentProcessRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}
