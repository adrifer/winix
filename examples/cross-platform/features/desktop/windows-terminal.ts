import { feature } from "@adrifer/winix";

/**
 * Windows Terminal with a Nerd Font, its settings kept in this checkout. The
 * handles in `dependsOn` install both before the settings that name them land.
 */
export const windowsTerminal = feature("windows-terminal", ({ windows }) => {
  const terminal = windows.package("Microsoft.WindowsTerminal");
  const font = windows.package("DEVCOM.JetBrainsMonoNerdFont");
  // The packaged Terminal's LocalState\settings.json. Use { channel: "preview" } for Terminal Preview.
  windows.terminal.settings("./dotfiles/terminal/settings.json", {
    dependsOn: [terminal, font],
  });
});
