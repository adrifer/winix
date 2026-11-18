// WSL → Windows interop helpers: shims that locate Windows executables at
// runtime, so Linux configs never hard-code the Windows user or drive layout.

import type { NixExpr } from "../core/types.ts";
import { nixStringLiteral } from "../nix/serialize.ts";

/**
 * Default Git Credential Manager locations shipped with Git for Windows.
 */
export const GIT_CREDENTIAL_MANAGER_PATHS = [
  "%ProgramFiles%\\Git\\ucrt64\\bin\\git-credential-manager.exe",
  "%ProgramFiles%\\Git\\mingw64\\bin\\git-credential-manager.exe",
] as const;

/**
 * Build a package containing `bin/<name>`, a shell shim that resolves the
 * first existing Windows path among `targets` and execs it with all arguments.
 * Targets are Windows paths, absolute (`C:\...`) or starting with an
 * environment variable (`%LOCALAPPDATA%\...`), expanded through `cmd.exe`
 * interop at run time and converted with `wslpath`.
 */
export function windowsBin(name: string, targets: string | readonly string[]): NixExpr {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)) {
    throw new Error("nix.wsl.windowsBin requires an executable name containing only letters, numbers, '.', '_', '+' or '-'");
  }
  const list = (typeof targets === "string" ? [targets] : [...(targets ?? [])]).map(normalizeWindowsTarget);
  if (list.length === 0) throw new Error(`nix.wsl.windowsBin("${name}") requires at least one Windows path`);
  const quoted = list.map((target) => `'${target}'`).join(" ");
  const script = [
    "wslpath=/bin/wslpath",
    `[ -x "$wslpath" ] || wslpath=$(command -v wslpath) || { echo '${name}: wslpath not found; this shim only works inside WSL' >&2; exit 127; }`,
    `cmd=$("$wslpath" -u 'C:\\Windows\\System32\\cmd.exe' 2>/dev/null)`,
    "resolve() {",
    '  local win=$1',
    '  case "$win" in',
    "    *%*)",
    '      [ -n "$cmd" ] && [ -x "$cmd" ] || return 1',
    // cmd.exe cannot run from a WSL (UNC) working directory.
    '      win=$(cd "${cmd%/*}" && "$cmd" /d /c "echo $win" 2>/dev/null) || return 1',
    "      win=${win%$'\\r'}",
    "      case \"$win\" in *%*) return 1 ;; esac",
    "      ;;",
    "  esac",
    '  "$wslpath" -u "$win" 2>/dev/null',
    "}",
    `for candidate in ${quoted}; do`,
    '  if target=$(resolve "$candidate") && [ -n "$target" ] && [ -f "$target" ]; then',
    '    exec "$target" "$@"',
    "  fi",
    "done",
    `echo '${name}: Windows executable not found at: ${list.join(", ")}' >&2`,
    "exit 127",
  ].join("\n");
  return {
    __winixNixExpr: true,
    expr: `(pkgs.writeShellScriptBin ${nixStringLiteral(name)} ''\n${escapeIndentedString(script)}\n'')`,
  };
}

function normalizeWindowsTarget(target: unknown): string {
  if (typeof target !== "string") throw new Error("nix.wsl.windowsBin paths must be strings");
  const path = target.replace(/\//g, "\\");
  if (!/^(?:[A-Za-z]:\\|%[A-Za-z_][A-Za-z0-9_()]*%\\)/.test(path)) {
    throw new Error(`nix.wsl.windowsBin path "${target}" must be absolute (C:\\...) or start with an environment variable (%LOCALAPPDATA%\\...)`);
  }
  // Paths are embedded in single-quoted shell words and echoed through cmd.exe.
  if (/['"&|<>^\r\n\0`]/.test(path)) {
    throw new Error(`nix.wsl.windowsBin path "${target}" contains unsupported characters`);
  }
  return path;
}

/** Escape text for a Nix indented string (`'' ... ''`). */
function escapeIndentedString(text: string): string {
  return text.replace(/''/g, "'''").replace(/\$\{/g, "''${");
}
