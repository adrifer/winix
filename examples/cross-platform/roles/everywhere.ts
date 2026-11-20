import { profile } from "@adrifer/winix";
import { git } from "../features/cli/git.ts";
import { lazygit } from "../features/cli/lazygit.ts";
import { shell } from "../features/cli/shell.ts";
import { starship } from "../features/cli/starship.ts";

/**
 * Every machine, on every OS. Each feature declares its Linux/macOS and
 * Windows sides; a host gets the ones for its platform.
 */
export const everywhere = profile("everywhere", [shell(), starship(), git(), lazygit()]);
