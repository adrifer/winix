/**
 * Reference Winix configuration for a Windows host.
 *
 * Demonstrates the implemented Windows backend slice:
 *
 *   - `platforms.windows()` declares a Windows machine.
 *   - `windows.package(...)` installs winget packages, in all of its forms:
 *       - bare id (resolved from winix-windows.lock)
 *       - explicit source (msstore)
 *       - inline version pin
 *       - elevated (admin security context)
 *
 * Generate the `configuration.winget` with:
 *
 *   winix apply --host desktop
 *
 * Then apply it on a Windows machine with:
 *
 *   winix switch --host desktop
 */

import { host, platforms, windows, workspace } from "@adrifer/winix";

export default workspace({
  inputs: {
    // Windows hosts do not consume nixpkgs, but `workspace` requires an
    // inputs object. This is a placeholder until inputs are made optional
    // for windows-only workspaces.
    nixpkgs: "github:NixOS/nixpkgs/nixos-unstable",
  },

  hosts: [
    host("desktop", platforms.windows(), [
      // Floating declarations are emitted from winix-windows.lock.
      // Phase 2 will automate refreshing this lock via `winix update --windows`.
      windows.package("Fastfetch-cli.Fastfetch"),
      windows.package("eza-community.eza"),


      // Microsoft Store source.
      // windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),

      // Pinned to an exact version.
      // windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }),

      // Elevated: installs in an admin context. Use only for packages that
      // genuinely need machine-wide install rights.
      // windows.package({ id: "Some.Driver", elevated: true }),
    ]),
  ],
});
