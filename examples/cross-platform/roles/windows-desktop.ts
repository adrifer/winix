import { profile } from "@adrifer/winix";
import { windowsTerminal } from "../features/desktop/windows-terminal.ts";

/** Every Windows PC. A role can be single-OS too. */
export const windowsDesktop = profile("windows-desktop", [windowsTerminal()]);
