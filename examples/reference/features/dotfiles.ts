import { feature, home, nix, platforms } from "@adrifer/winix";

/**
 * Helper: declare a Home Manager XDG config file that symlinks out to
 * the user's `~/dotfiles/<name>/.config/<name>` checkout. This lets you
 * keep editing your dotfiles in their own git repo while still managing
 * the symlinks declaratively.
 */
const dotfile = (name: string) => ({
  source: nix.expr(
    `config.lib.file.mkOutOfStoreSymlink "\${config.home.homeDirectory}/dotfiles/${name}/.config/${name}"`
  ),
  recursive: true,
});

/**
 * @description Out-of-store symlinks for editor/TUI configs from ~/dotfiles
 * @category dotfiles
 */
export const dotfiles = feature("dotfiles", () => ({
  ...home.configFiles({
    nvim: dotfile("nvim"),
    eza: dotfile("eza"),
    lazygit: dotfile("lazygit"),
    yazi: dotfile("yazi"),
    // ghostty terminal lives in dotfiles only on macOS in this setup
    ...(platforms.darwin.isActive && { ghostty: dotfile("ghostty") }),
  }),
}));
