# Winix — Roadmap

Currently shipping v0.1.x. Focused on making the authoring experience excellent for both humans and AI agents.

## Next

- **Winix Skill** — installable Skill for AI agents (Claude, etc.) to write Winix configs correctly. Available via `winix install skill` in any Winix project, or `winix init` when scaffolding.
- **`winix scaffold feature <name>`** — generate a typed feature template ready for an LLM (or human) to fill in.
- **Interactive `winix init` wizard** — guide users through platform, channel, Home Manager, example features, and Skill install with prompts (or skip with `--platform`, `--channel`, `--features`, `--skill` flags for power users).
- **Starlight docs site** — replace the long README with a proper documentation site at [starlight.astro.build](https://starlight.astro.build).
- **Windows integration** *(design phase)* — bring NixOS-style declarative system management to Windows. Winget, registry, scheduled tasks, PowerShell, DSC. One of the original motivations behind Winix.

## Later

- **Init presets beyond the wizard** — first-class `--preset minimal`, `--preset wsl`, etc. once we see what real users actually pick.

## Maybe / exploratory

- VS Code extension / LSP (live Nix preview, jump-to-NixOS-docs, smart snippets — most other LSP value is already covered by TS types).
- Plugin/extension API (third-party fragments distributed as npm packages).
- Multi-machine orchestration (apply to N hosts over SSH).
- `winix doctor` diagnostic command.
- Merge modifiers (`override`, `prepend`, `replace`, `without`).
- Home Manager / nix-darwin standalone backends.

## Shipped (v0.1.x)

The current API includes the full fragment/helper model, NixOS + nix-darwin + Home Manager support, the `nix.*` namespace, intent helpers, dynamic type generation for ~24k options, and a working `apply` / `switch` / `update` / `check` CLI.

See [GitHub Releases](https://github.com/adrifer/winix/releases) for per-version notes, and [`spec/`](./spec/) for the design documents.

## Known Issues

- Needs Node 22+ with native `.ts` execution.
- Home Manager config is inline in host module (not split file).
