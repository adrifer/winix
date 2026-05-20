import { home, nixos, darwin, type Fragment } from "winix";

// --- NixOS program helper with typed opts ---
// When NixosProgramOptions is populated (by generated types), these should autocomplete

// Basic enable-only usage (always works)
nixos.program("zsh");
nixos.program("openssh");

// With options (typed when generated types are available)
nixos.program("zsh", { enableCompletion: true });

// Fallback: unknown program name still works with Record<string, unknown>
nixos.program("my-custom-program", { someSetting: true });

// --- NixOS service helper with typed opts ---
nixos.service("openssh", { allowSFTP: true });
nixos.service("my-custom-service", { enable: true });

// --- home.program with typed opts ---
home.program("git", { userName: "test" });
home.program("zsh", { enableCompletion: true });
home.program("custom-thing", { whatever: true });

// --- darwin.program (no generated types yet, fallback only) ---
darwin.program("zsh", { enableSyntaxHighlighting: true });

// --- Verify Fragment output is correct ---
const f1: Fragment = nixos.program("zsh", { enableCompletion: true });
const f2: Fragment = nixos.service("openssh");
const f3: Fragment = home.program("git", { userName: "Me" });

void f1;
void f2;
void f3;
