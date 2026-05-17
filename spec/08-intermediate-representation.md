# Intermediate representation

The Winix IR is the stable contract between TypeScript authoring and Rust execution.

## Format

- JSON.
- Versioned with `irVersion`.
- Schema-validated.
- Rust types are canonical.
- JSON Schema is generated from Rust and consumed by the TypeScript SDK.

## Top-level shape

```json
{
  "irVersion": "0.1.0",
  "workspace": {},
  "hosts": [],
  "branches": [],
  "resources": [],
  "activationGraph": {},
  "diagnostics": []
}
```

## Resource requirements

Each resource must include:

- `id`
- `kind`
- `scope`
- `targets`
- `value`
- `merge`
- `capabilities`
- `provenance`

## Provenance

Provenance should include:

- source file
- export name
- branch path
- resource constructor
- merge history
- raw backend origin if applicable

## Capability annotations

Backends consume only resources whose required capabilities they declare. Unsupported resources produce diagnostics before apply.

## Versioning

Breaking IR changes require a major version. The CLI must reject unsupported IR versions with a clear migration message.

