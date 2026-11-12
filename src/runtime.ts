export interface StandaloneAsset {
  name: string;
  sha256: string;
}

export interface StandaloneRuntime {
  version: string;
  linuxAssets: Partial<Record<"x64" | "arm64", StandaloneAsset>>;
}

let standalone: StandaloneRuntime | undefined;

export function configureStandaloneRuntime(runtime: StandaloneRuntime): void {
  if (standalone) throw new Error("Standalone runtime is already configured");
  standalone = runtime;
}

export function standaloneRuntime(): StandaloneRuntime | undefined {
  return standalone;
}
