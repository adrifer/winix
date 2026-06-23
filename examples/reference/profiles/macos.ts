import { overlay, profile } from "@adrifer/winix";
import { homebrew } from "../features/homebrew";
import { macos } from "../features/macos";
import { packagesMacos } from "../features/packages";
import { tony } from "../features/user-tony";
import { homeBase } from "./home-base";

/**
 * macOS profile: nix-darwin system + Home Manager + Homebrew for casks
 * that don't ship in nixpkgs. Same `homeBase` as Linux on top.
 */
export const macosProfile = profile("macos-profile", [
  overlay.stable("nixpkgs-stable"),
  homebrew(),
  macos(),
  tony(),
  packagesMacos(),
  homeBase(),
]);
