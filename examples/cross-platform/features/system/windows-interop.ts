import { feature, nix } from "@adrifer/winix";

/**
 * For WSL hosts: reach Windows programs without hard-coding the Windows user
 * or drive. The shims find the Windows paths each time they run.
 */
export const windowsInterop = feature("windows-interop", ({ home }) => {
  // `code` inside WSL runs the Windows VS Code CLI.
  home.packages(nix.wsl.windowsBin("code", "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code"));
  // git inside WSL uses Git for Windows' Credential Manager.
  home.wsl.gitCredentialManager();
});
