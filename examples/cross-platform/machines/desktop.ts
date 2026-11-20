import { host, platforms } from "@adrifer/winix";
import { alice } from "../features/system/alice.ts";
import { nixosWsl } from "../features/system/nixos-wsl.ts";
import { windowsInterop } from "../features/system/windows-interop.ts";
import { dev } from "../roles/dev.ts";
import { everywhere } from "../roles/everywhere.ts";
import { windowsDesktop } from "../roles/windows-desktop.ts";

/** A Windows PC and the NixOS-WSL distro it creates: one machine, two hosts. */
const linux = host("wsl-work", platforms.wsl({ stateVersion: "25.05" }), [
  alice(),
  everywhere(),
  dev(),
  windowsInterop(),
]);

const windows = host("DESKTOP", platforms.windows(), [
  everywhere(),
  dev(),
  windowsDesktop(),
  // The host value, not its name: renaming it can't leave a stale string.
  nixosWsl(linux),
]);

export const desktop = [windows, linux];
