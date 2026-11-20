---
title: CLI
description: Every winix command and option.
---

# CLI

From a Winix project:

```bash
npx @adrifer/winix check                  # validate winix.config.ts
npx @adrifer/winix apply                  # generate .winix/out/
npx @adrifer/winix apply --dry            # print generated Nix without writing files
npx @adrifer/winix apply --diff           # unified diff against the current .winix/out/
npx @adrifer/winix plan --host my-pc      # what switch would change on this Windows machine
npx @adrifer/winix switch --host my-host  # generate and run nixos-rebuild/darwin-rebuild
npx @adrifer/winix update                 # update generated flake.lock and copy it back
npx @adrifer/winix inspect --host my-pc   # each feature and what it declares
npx @adrifer/winix scaffold feature lazygit  # features/lazygit.ts, home.* and windows.* side by side
npx @adrifer/winix --skill                # print version-matched agent instructions
```

If you add scripts to your `package.json`, you can use shorter commands:

```json
{
  "scripts": {
    "check": "winix check",
    "apply": "winix apply",
    "dry": "winix apply --dry",
    "switch": "winix switch"
  }
}
```

Generated output lives under:

```text
.winix/out/
  flake.nix
  hosts/
    <host>.nix
```

You can also run the generated flake manually:

```bash
sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#my-host
sudo darwin-rebuild switch --flake path:$(pwd)/.winix/out#macbook
```
