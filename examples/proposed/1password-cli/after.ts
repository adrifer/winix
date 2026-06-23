/**
 * Example: 1Password CLI (`op`) as a Winix feature.
 *
 * This exercises the extended `nix.binaryRelease` surface:
 *   - `{platform}` placeholder in `urlTemplate` (vendor uses `linux_amd64`
 *     etc. instead of a per-file URL fragment)
 *   - `linuxPatchelf` + `linuxBuildInputs` for autoPatchelfHook on Linux
 *   - `completions` for bash/fish/zsh
 *   - `meta.license` as a `NixExpr` (unfree license)
 *   - `dontStripDarwin` default (kept on; darwin binary is code-signed)
 *
 * The generated Nix closely mirrors the upstream `nixpkgs/_1password-cli`
 * recipe.
 */
import { feature, home, nix } from "@adrifer/winix";

export const onePasswordCli = feature("1password-cli", () =>
  home.packages(
    nix.binaryRelease({
      name: "1password-cli",
      version: "2.34.1",
      binary: "op",
      urlTemplate:
        "https://cache.agilebits.com/dist/1P/op2/pkg/v{version}/op_{platform}_v{version}.zip",
      platforms: {
        "x86_64-linux": {
          platform: "linux_amd64",
          file: "op_linux_amd64_v2.34.1.zip",
          hash: "sha256-oAABMlwwv5X91TT6FK2aPpg+e2CvmHT1rqIVRTjQNCQ=",
        },
        "aarch64-linux": {
          platform: "linux_arm64",
          file: "op_linux_arm64_v2.34.1.zip",
          hash: "sha256-uEukRq71eeayvNguD9XepvP1Br5AkE2Ag/Chv2idf4A=",
        },
      },
      linuxPatchelf: true,
      linuxBuildInputs: ["stdenv.cc.cc"],
      completions: {
        bash: "$out/bin/op completion bash",
        fish: "$out/bin/op completion fish",
        zsh: "$out/bin/op completion zsh",
      },
      meta: {
        description: "1Password command-line tool",
        homepage: "https://developer.1password.com/docs/cli/",
        license: nix.expr("pkgs.lib.licenses.unfree"),
      },
    })
  )
);
