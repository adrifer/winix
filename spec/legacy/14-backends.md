# Backends

Backends lower IR resources into platform-specific plans and apply operations.

## Backend contract

Each backend must declare:

- name
- version
- target platforms
- capabilities
- required external tools
- detection method
- supported resource kinds
- plan support
- apply support
- rollback support, if any
- diagnostics format

## Capability tiers

| Tier | Meaning |
|---|---|
| declarative | Backend can model desired state and test current state. |
| idempotent | Backend command can be safely repeated. |
| imperative | Backend can run command but cannot fully prove state. |
| unsupported | Backend cannot represent the resource. |

## Lifecycle

1. Detect backend.
2. Validate capabilities.
3. Lower IR resources.
4. Produce plan.
5. Apply operations.
6. Report result.

Backend-specific specs must not redefine this contract; they only specialize it.

