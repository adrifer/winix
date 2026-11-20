import { feature } from "@adrifer/winix";

/**
 * One tool, every platform. Each namespace applies only where it makes sense:
 * `home.*` on NixOS, WSL and macOS (Home Manager), `windows.*` on Windows
 * hosts. `winix inspect --host <name>` shows what a host actually gets.
 */
export const lazygit = feature("lazygit", ({ home, windows, platforms }) => {
  // Same program, two package managers: a nixpkgs attribute and a winget id.
  home.packages("lazygit");
  windows.package("JesseDuffield.lazygit");

  // Same config file from this checkout, linked live on both sides.
  // Sources starting with ./ or ../ are relative to winix.config.ts.
  const config = home.symlink("./dotfiles/lazygit/config.yml");
  if (platforms.darwin.isActive) {
    // lazygit reads Application Support on macOS.
    home.files({ "Library/Application Support/lazygit/config.yml": config });
  } else {
    home.configFiles({ "lazygit/config.yml": config });
  }
  windows.file.symlink(windows.knownFolder.localAppData("lazygit\\config.yml"), "./dotfiles/lazygit/config.yml");
});
