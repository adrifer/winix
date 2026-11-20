import { profile } from "@adrifer/winix";
import { node } from "../features/dev/node.ts";

/** Machines I develop on (here: not the Mac). */
export const dev = profile("dev", [node()]);
