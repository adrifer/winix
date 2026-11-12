import { host, platforms, workspace } from "../../src/index.ts";

export default workspace({
  inputs: {},
  hosts: [
    host("windows-shell", platforms.windows(), ({ windows }) => {
      const developerMode = windows.setting({ DeveloperMode: true });
      const icons = windows.powershell.module("Terminal-Icons");
      const wslRuntime = windows.package({ id: "Microsoft.WSL", version: "2.6.1" });
      const wslSetup = windows.wsl({ config: { wsl2: { memory: "16GB", processors: 8 } }, backup: true });
      windows.wsl.distro("NixOS", {
        source: "nixos-wsl",
        installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
        default: true,
        dependsOn: [wslSetup, wslRuntime],
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
        { backup: true, dependsOn: [icons, developerMode] },
      );
      windows.startup.command("Winix README", {
        executable: "notepad.exe",
        arguments: [windows.knownFolder.documents("Winix\\README.md")],
        dependsOn: readme,
        backup: true,
      });
    }),
  ],
});
