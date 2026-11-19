import { feature } from "@adrifer/winix";

/**
 * The same prompt everywhere: Starship reads ~/.config/starship.toml on every
 * platform. Not attached to a host in this example (powershell-terminal links
 * the file on Windows); docs/guides/powershell-and-terminal.md shows it, and
 * tests/cross-platform-example.test.ts evaluates it.
 */
export const starship = feature("starship", ({ home, windows }) => {
  home.program("starship");
  home.configFiles({ "starship.toml": home.symlink("./dotfiles/starship/starship.toml") });
  windows.package("Starship.Starship");
  windows.file.symlink(windows.knownFolder.userProfile(".config\\starship.toml"), "./dotfiles/starship/starship.toml");
});
