export type ActivationPlatform = "nixos" | "darwin";

export function activationCommand(
  platform: ActivationPlatform,
  flake: string,
  isRoot = isCurrentProcessRoot()
): string[] {
  const command =
    platform === "darwin"
      ? ["darwin-rebuild", "switch", "--flake", flake]
      : ["nixos-rebuild", "switch", "--flake", flake];

  return withSudo(command, isRoot);
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
