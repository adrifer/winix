import { overlay, profile } from "@adrifer/winix";
import { packagesLinux } from "../features/packages";
import { tony } from "../features/user-tony";
import { homeBase } from "./home-base";

/**
 * NixOS profile: the system-level user account, an overlay that pulls
 * a few too-bleeding-edge packages from stable, the Linux-only baseline,
 * and the cross-platform home-base on top.
 */
export const linuxProfile = profile("linux-profile", [
  overlay.stable("nixpkgs-stable"),
  tony(),
  packagesLinux(),
  homeBase(),
]);
