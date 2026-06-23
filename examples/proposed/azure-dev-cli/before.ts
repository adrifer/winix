/**
 * Example: Azure Developer CLI (`azd`) as a Winix feature.
 *
 * BEFORE the `nix.binaryRelease` proposal: ~50 lines of raw Nix in a
 * single `nix.expr` blob. Works, but untyped, unstructured, and easy to
 * break when copy-pasted for another CLI.
 *
 * See `after.ts` in the same directory for the post-proposal shape.
 */
import { feature, home, nix } from "@adrifer/winix";

export const azureDevCli = feature("azure-dev-cli", () =>
  home.packages(
    nix.expr(`(let
      version = "1.25.5";
      sources = {
        x86_64-linux = {
          file = "azd-linux-amd64.tar.gz";
          hash = "sha256-h45MPTkA/qTmXV56A3GCjKEnoKx9G1jALEpa81ZNHEk=";
          binary = "azd-linux-amd64";
        };
        aarch64-linux = {
          file = "azd-linux-arm64.tar.gz";
          hash = "sha256-4qKxal8wKt3Uh+Ubrw8TyhD/qL59hKxEGuq91Dxx4hk=";
          binary = "azd-linux-arm64";
        };
        x86_64-darwin = {
          file = "azd-darwin-amd64.zip";
          hash = "sha256-ph7ts7Oy4nVXxu0H79i9Rokp8BDG1d7zan6AhfxZUAY=";
          binary = "azd-darwin-amd64";
        };
        aarch64-darwin = {
          file = "azd-darwin-arm64.zip";
          hash = "sha256-pO+HW/udYlfJRDJdNyD8g0Ftck94X67cU6+rjRDbUcc=";
          binary = "azd-darwin-arm64";
        };
      };
      source = sources.\${pkgs.stdenv.hostPlatform.system};
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "azure-dev-cli";
      inherit version;

      src = pkgs.fetchurl {
        url = "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_\${version}/\${source.file}";
        inherit (source) hash;
      };

      nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.unzip ];

      unpackPhase = ''
        runHook preUnpack
        mkdir source
        case "$src" in
          *.zip)    unzip -q "$src" -d source ;;
          *.tar.gz) tar -xzf "$src" -C source ;;
        esac
        sourceRoot=source
        runHook postUnpack
      '';

      installPhase = ''
        runHook preInstall
        install -Dm755 "\${source.binary}" "$out/bin/azd"
        install -Dm644 NOTICE.txt "$out/share/doc/$pname/NOTICE.txt"
        runHook postInstall
      '';

      meta = {
        description = "Azure Developer CLI";
        homepage = "https://github.com/Azure/azure-dev";
        license = pkgs.lib.licenses.mit;
        mainProgram = "azd";
        platforms = builtins.attrNames sources;
      };
    })`)
  )
);
