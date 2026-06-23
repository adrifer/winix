import { feature, home } from "@adrifer/winix";

/**
 * @description Baseline CLI tools available on every host
 * @category baseline
 */
export const packages = feature("packages", () =>
  home.packages(
    "wget",
    "curl",
    "eza",
    "bat",
    "tree",
    "fastfetch",
    "unzip",
    "yazi",
    "ripgrep",
    "fd",
    "jq",
    "openssl",
    "lazygit",
    "gh",
    "mkcert",
    "nixfmt",
    "nixd",
    "python3",
    "gnumake"
  )
);

/**
 * @description Extra Linux-only baseline packages
 * @category baseline
 */
export const packagesLinux = feature("packages-linux", () =>
  home.packages("gcc")
);

/**
 * @description Extra macOS-only baseline packages
 * @category baseline
 */
export const packagesMacos = feature("packages-macos", () =>
  home.packages("nerd-fonts.jetbrains-mono")
);
