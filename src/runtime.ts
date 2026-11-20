export interface StandaloneAsset {
  name: string;
  sha256: string;
}

/** Type declarations for editors, keyed by path under a config's .winix/types. */
export interface EditorTypeBundle {
  hash: string;
  files: Record<string, string>;
}

export interface StandaloneRuntime {
  version: string;
  linuxAssets: Partial<Record<"x64" | "arm64", StandaloneAsset>>;
  /** Embedded by release builds; absent in custom/test runtimes. */
  editorTypes?: EditorTypeBundle;
}

let standalone: StandaloneRuntime | undefined;

export function configureStandaloneRuntime(runtime: StandaloneRuntime): void {
  if (standalone) throw new Error("Standalone runtime is already configured");
  standalone = runtime;
}

export function standaloneRuntime(): StandaloneRuntime | undefined {
  return standalone;
}
