import { plugin } from "bun";
import * as sdk from "../src/index.ts";
import { configureStandaloneRuntime } from "../src/runtime.ts";

declare const WINIX_BUILD_VERSION: string;
declare const WINIX_LINUX_ASSETS: Parameters<typeof configureStandaloneRuntime>[0]["linuxAssets"];

plugin({
  name: "winix-embedded-sdk",
  setup(build) {
    build.module("@adrifer/winix", () => ({
      loader: "object",
      exports: { ...sdk },
    }));
  },
});

configureStandaloneRuntime({
  version: WINIX_BUILD_VERSION,
  linuxAssets: WINIX_LINUX_ASSETS,
});

if (process.env.WINIX_WSL_SETUP_PREPARE || process.env.WINIX_WSL_SETUP_REQUEST) {
  const { dispatchWslSetup } = await import("../src/backends/windows/wsl-setup-runtime.ts");
  await dispatchWslSetup(sdk);
} else {
  await import("../src/cli/index.ts");
}
