# Windows example

Demonstrates the implemented Windows backend slice: declaring a Windows host
with `platforms.windows()`, installing winget packages with
`windows.package(...)`, and running arbitrary commands with `windows.raw(...)`.

> **Status:** This is the validated MVP slice (packages plus raw commands).
> Only `windows.package` and `windows.raw` exist publicly today. See
> `spec/proposals/windows-backend.md` for the full plan.

## What it shows

`winix.config.ts` declares one host (`desktop`) and installs packages in every
supported form:

```ts
host("desktop", platforms.windows(), [
  windows.package("Fastfetch-cli.Fastfetch"),                       // locked in winix-windows.lock
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),       // msstore
  windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }), // pinned
  // windows.package({ id: "Some.Driver", elevated: true }),        // admin context
])
```

## Generate

From this directory:

```bash
winix apply --host desktop
```

The checked-in `winix-windows.lock` pins floating Windows packages for
reproducible generation. Until `winix update --windows` lands in phase 2,
add new floating packages to that lockfile manually or give them an inline
`version`.

This writes the bundle to `.winix/out/desktop/`:

- `configuration.winget` — native DSC v3 document
- `apply.ps1` — thin entry point that calls `winget configure`

## Raw commands and ordering

`windows.raw(...)` runs an arbitrary command on every apply (via DSC v3's
`Microsoft.DSC.Transitional/RunCommandOnSet`). It accepts a command string or
an explicit `{ executable, arguments }` object.

Both `windows.package(...)` and `windows.raw(...)` return a **handle**. Capture
it only when something must be applied after it, and pass it to `dependsOn`
(a single handle or an array of handles):

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  const node = windows.package("OpenJS.NodeJS");
  windows.raw({
    executable: "npm",
    arguments: ["install", "--global", "typescript"],
    dependsOn: node, // run after Node is installed
  });
});
```

In the emitted DSC v3 document, each resource gets a name that satisfies the
schema's `^[a-zA-Z0-9 ]+$` rule: a package's name is its **sanitized** id
(`OpenJS.NodeJS` → `OpenJS NodeJS`) with the real id kept in `properties.id`
(what winget reads), and an id-less raw command gets a generated `command N`.
`dependsOn` is rendered as `[resourceId('<type>', '<name>')]`. A handle from one
host passed to another host's `dependsOn` is a hard error at generation time.

## Apply (on a Windows machine)

Run:

```powershell
winix switch --host desktop
```

That invokes `winget configure` on the generated configuration. You can also
run the generated entry point directly:

```powershell
pwsh -File .\.winix\out\desktop\apply.ps1
```

## Notes

- **Elevation is opt-in.** Packages install in the current user context by
  default. Add `elevated: true` only for packages that need admin (machine-wide
  installers, drivers). Defaulting to elevated makes `winget configure` fail
  from a non-elevated shell.
- **Determinism.** Packages are emitted sorted by id and versions come from
  `winix-windows.lock`, so the document is stable regardless of declaration
  order.
