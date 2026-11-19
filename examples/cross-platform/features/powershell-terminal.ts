import { feature } from "@adrifer/winix";

/**
 * PowerShell 7 with a Starship prompt and Windows Terminal settings, all kept
 * in this checkout. Handles passed to `dependsOn` make the profile and the
 * Terminal settings land after the things they reference.
 */
export const powershellTerminal = feature("powershell-terminal", ({ windows }) => {
  windows.package("Microsoft.PowerShell");
  const starship = windows.package("Starship.Starship");
  const terminal = windows.package("Microsoft.WindowsTerminal");
  const font = windows.package("DEVCOM.JetBrainsMonoNerdFont");
  // Installed from PSGallery and pinned in winix-windows.lock.
  const icons = windows.powershell.module("Terminal-Icons");

  const prompt = windows.file.symlink(
    windows.knownFolder.userProfile(".config\\starship.toml"),
    "./dotfiles/starship/starship.toml",
  );
  // Documents\PowerShell\Microsoft.PowerShell_profile.ps1, following OneDrive redirection.
  windows.powershell.profile("./dotfiles/powershell/Microsoft.PowerShell_profile.ps1", {
    dependsOn: [icons, starship, prompt],
  });
  // The packaged Terminal's LocalState\settings.json. Use { channel: "preview" } for Terminal Preview.
  windows.terminal.settings("./dotfiles/terminal/settings.json", {
    dependsOn: [terminal, font],
  });
});
