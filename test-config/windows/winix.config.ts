import { host, platforms, workspace } from "../../src/index.ts";

export default workspace({
  inputs: {},
  hosts: [
    host("windows-shell", platforms.windows(), ({ windows }) => {
      // Elevated settings (Developer Mode) use the exact module pin in winix-windows.lock.
      windows.settings({
        developer: { mode: true },
        theme: { accentColor: "#336699" },
        explorer: { showExtensions: true, showHiddenFiles: false, openTo: "thisPC" },
        taskbar: { search: "hidden", taskView: true, widgets: false },
      });
      windows.npm.registries({
        registries: { npmjs: { uri: "https://registry.npmjs.org/" } },
        default: "npmjs",
      });
      // Optional declarations; image/font paths resolve relative to this config:
      // windows.wallpaper({ source: "../../wallpapers/desktop.jpg", style: "Fill" });
      // windows.fonts({ sources: [{ provider: "nerd-fonts", family: "JetBrainsMono" }] });
      const icons = windows.powershell.module("Terminal-Icons");
      const wslSetup = windows.wsl({ config: { wsl2: { memory: "16GB", processors: 8 } } });
      windows.wsl.distro("NixOS", {
        source: "nixos-wsl",
        host: "wsl-work",
        installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
        default: true,
        dependsOn: wslSetup,
        // Opt in only with a trusted repository and a released SDK supporting setup:
        // setup: {
        //   repository: "https://github.com/example/dotfiles.git", ref: "main",
        //   configDirectory: "winix", host: "wsl-work",
        //   user: "alice", checkout: "/home/alice/dotfiles",
        // },
      });
      const readme = windows.file.symlink(
        windows.knownFolder.documents("Winix\\README.md"),
        "../../README.md",
        { dependsOn: icons },
      );
      windows.startup.app("Winix README", {
        executable: "notepad.exe",
        arguments: [windows.knownFolder.documents("Winix\\README.md")],
        dependsOn: readme,
      });
    }),
  ],
});
