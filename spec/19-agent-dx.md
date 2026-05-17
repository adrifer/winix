# Agent DX

Winix should be easy for coding agents to inspect, modify, and validate.

## Repository conventions

Agents should find:

- workspace entrypoint at `winix.config.ts`
- hosts under `winix/hosts`
- users under `winix/users`
- roles under `winix/roles`
- features under `winix/features`
- platform baselines under `winix/platforms`

## Machine-readable commands

Required stable commands:

```sh
winix check --json
winix eval --json
winix plan --json
winix inspect graph --json
winix inspect resources --json
winix inspect provenance <resource-id> --json
```

## Agent-safe edit patterns

- Add a resource with a stable ID.
- Add a feature file and explicitly import it.
- Extend a host with a named branch.
- Resolve a conflict with explicit override metadata.
- Avoid broad rewrites of generated files.

## JSON diagnostics

Diagnostics must include:

- code
- severity
- message
- resource ID
- branch path
- source file
- suggested fix
- backend capability involved

