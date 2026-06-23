/**
 * Reference Winix configuration.
 *
 * An anonymized, simplified version of a real-world setup. It covers
 * the two most common shapes:
 *
 *   - A WSL NixOS host with Home Manager.
 *   - A macOS host with nix-darwin + Home Manager + Homebrew.
 *
 * What the file is showing off, in order of how a reader's eye lands:
 *
 *   1. `workspace(...)` is the single entry point: inputs + hosts.
 *   2. Each `host(name, platform, [...fragments])` declares a machine.
 *   3. The fragments list mixes profiles (bundles of features) and
 *      one-offs. They compose by concatenation, not by overrides.
 *
 * From here, dive into:
 *
 *   - `profiles/home-base.ts` for the cross-platform Home Manager baseline
 *   - `features/wsl.ts` for the most option-dense feature in the example
 *   - `features/zsh.ts` for `platforms.darwin.isActive` /
 *     `platforms.nixos.isActive` (platform-conditional fragments)
 */

import { host, platforms, workspace } from "@adrifer/winix";

import { inputs } from "./inputs";
import { linuxProfile } from "./profiles/linux";
import { macosProfile } from "./profiles/macos";
import { wsl } from "./features/wsl";

export default workspace({
  inputs,

  hosts: [
    host("wsl", platforms.nixos({ stateVersion: "25.05" }), [
      linuxProfile(),
      wsl(),
    ]),

    host("macbook-pro", platforms.darwin({ stateVersion: 6, homebrew: true }), [
      macosProfile(),
    ]),
  ],
});
