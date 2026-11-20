import { host, platforms } from "@adrifer/winix";
import { alice } from "../features/system/alice.ts";
import { everywhere } from "../roles/everywhere.ts";

/** A Mac with nix-darwin. */
export const macbook = host("macbook", platforms.darwin({ stateVersion: 6 }), [
  alice(),
  everywhere(),
]);
