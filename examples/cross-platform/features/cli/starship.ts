import { feature } from "@adrifer/winix";

/** The same prompt everywhere: Starship reads ~/.config/starship.toml on every platform. */
export const starship = feature("starship", ({ home, windows }) => {
  home.program("starship");
  home.configFiles({ "starship.toml": home.symlink("./dotfiles/starship/starship.toml") });
  windows.package("Starship.Starship");
  windows.file.symlink(windows.knownFolder.userProfile(".config\\starship.toml"), "./dotfiles/starship/starship.toml");
});
