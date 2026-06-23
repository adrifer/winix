/**
 * Example: Azure Developer CLI (`azd`) as a Winix feature.
 *
 * AFTER the `nix.binaryRelease` proposal: a typed object literal. The
 * generated Nix is byte-identical to `before.ts` for the common case of
 * a single-binary release.
 *
 * See `before.ts` in the same directory for the pre-proposal shape.
 */
import { feature, home, nix } from "@adrifer/winix";

export const azureDevCli = feature("azure-dev-cli", () =>
  home.packages(
    nix.binaryRelease({
      name: "azure-dev-cli",
      version: "1.25.5",
      binary: "azd",
      urlTemplate:
        "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
      platforms: {
        "x86_64-linux": {
          file: "azd-linux-amd64.tar.gz",
          hash: "sha256-h45MPTkA/qTmXV56A3GCjKEnoKx9G1jALEpa81ZNHEk=",
          binary: "azd-linux-amd64",
        },
        "aarch64-linux": {
          file: "azd-linux-arm64.tar.gz",
          hash: "sha256-4qKxal8wKt3Uh+Ubrw8TyhD/qL59hKxEGuq91Dxx4hk=",
          binary: "azd-linux-arm64",
        },
        "x86_64-darwin": {
          file: "azd-darwin-amd64.zip",
          hash: "sha256-ph7ts7Oy4nVXxu0H79i9Rokp8BDG1d7zan6AhfxZUAY=",
          binary: "azd-darwin-amd64",
        },
        "aarch64-darwin": {
          file: "azd-darwin-arm64.zip",
          hash: "sha256-pO+HW/udYlfJRDJdNyD8g0Ftck94X67cU6+rjRDbUcc=",
          binary: "azd-darwin-arm64",
        },
      },
      extraInstall: `install -Dm644 NOTICE.txt "$out/share/doc/$pname/NOTICE.txt"`,
      meta: {
        description: "Azure Developer CLI",
        homepage: "https://github.com/Azure/azure-dev",
        license: "mit",
      },
    })
  )
);
