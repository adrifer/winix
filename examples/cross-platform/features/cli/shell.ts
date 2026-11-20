import { feature } from "@adrifer/winix";

/**
 * One alias table for both shells. A string is the same command in zsh and
 * PowerShell; otherwise spell each out (`pwsh` is a function body, with the
 * arguments in $args). Leave a shell out to skip the alias there.
 */
type Alias = string | { zsh?: string; pwsh?: string };

const aliases: Record<string, Alias> = {
  g: "lazygit",
  gs: "git status",
  "..": { zsh: "cd ..", pwsh: "Set-Location .." },
};

const zshAliases = Object.fromEntries(Object.entries(aliases).flatMap(([name, alias]) => {
  const command = typeof alias === "string" ? alias : alias.zsh;
  return command ? [[name, command]] : [];
}));

const powershellAliases = Object.entries(aliases).flatMap(([name, alias]) => {
  const body = typeof alias === "string" ? `& ${alias} @args` : alias.pwsh;
  return body ? [`function ${name} { ${body} }`] : [];
}).join("\n") + "\n";

/** zsh on Linux, WSL and macOS; PowerShell 7 on Windows; the same aliases in both. */
export const shell = feature("shell", ({ home, windows }) => {
  home.program("zsh", { shellAliases: zshAliases });

  windows.package("Microsoft.PowerShell");
  // Installed from PSGallery and pinned in winix-windows.lock.
  const icons = windows.powershell.module("Terminal-Icons");
  // Generated from the table above; the profile dot-sources it.
  const aliasFile = windows.file.text(
    windows.knownFolder.userProfile(".config\\powershell\\aliases.ps1"),
    powershellAliases,
  );
  // Documents\PowerShell\Microsoft.PowerShell_profile.ps1, following OneDrive redirection.
  windows.powershell.profile("./dotfiles/powershell/Microsoft.PowerShell_profile.ps1", {
    dependsOn: [icons, aliasFile],
  });
});
