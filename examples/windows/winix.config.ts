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
 *   - `windows.env.set/remove(...)` manages registry-backed user/machine
 *     environment variables via the native Microsoft.Windows/Registry resource.
 *   - `windows.path.add/remove(...)` manages PATH entries surgically with an
 *     idempotent WindowsPowerShellScript resource.
 *   - `windows.dsc(...)` is the escape hatch: declare any DSC v3 resource by
 *     type + properties when no typed helper exists.
 *   - `dependsOn` orders resources using the handle returned by each helper.
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
    host("desktop", platforms.windows(), ({ windows }) => {
      // --- Packages (winget) ---
      // Floating declarations are emitted from winix-windows.lock.
      // `winix update --windows` refreshes the lock.
      windows.package("Fastfetch-cli.Fastfetch");
      windows.package("eza-community.eza");

      // Microsoft Store source.
      // windows.package({ source: "msstore", id: "9NKSQGP7F2NH" });

      // Pinned to an exact version.
      // windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" });

      // Elevated: installs in an admin context. Use only for packages that
      // genuinely need machine-wide install rights.
      // windows.package({ id: "Some.Driver", elevated: true });

      // --- Environment variables ---
      // A user environment variable (default scope: "user"; no elevation).
      windows.env.set("EDITOR", "nvim");

      // Remove a variable you no longer want.
      // windows.env.remove("OLD_TOOL_HOME");

      // Machine-scope variables write HKLM and require an elevated apply.
      // windows.env.set("JAVA_HOME", "C:\\Program Files\\Java\\jdk", { scope: "machine" });

      // --- PATH entries ---
      // Appends idempotently to the user PATH without normalizing other entries.
      windows.path.add("%USERPROFILE%\\.local\\bin");

      // Remove a PATH entry without touching the rest of PATH.
      // windows.path.remove("%USERPROFILE%\\.old-bin");

      // --- Ordering with dependsOn ---
      // The handle returned by any helper can be passed to another resource's
      // `dependsOn` to force apply order within this host.
      const cargoHome = windows.env.set("CARGO_HOME", "%USERPROFILE%\\.cargo");
      windows.path.add("%CARGO_HOME%\\bin", { dependsOn: [cargoHome] });

      // --- Escape hatch: any DSC v3 resource ---
      // When no typed helper exists, declare the resource directly. `properties`
      // is emitted verbatim, so this targets native DSC v3 resources like
      // Microsoft.Windows/Service straight from the bundled resource set.
      // windows.dsc({
      //   type: "Microsoft.Windows/Service",
      //   properties: { name: "spooler", startType: "automatic" },
      // });
    }),
  ],
});
