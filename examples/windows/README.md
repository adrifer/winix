# Windows example

Demonstrates the implemented Windows backend slice: declaring a Windows host
with `platforms.windows()` and installing winget packages with
`windows.package(...)`.

> **Status:** This is the validated MVP slice (packages only). The CLI does
> not yet wire the Windows backend into `winix apply`, so for now you generate
> the `configuration.winget` with the included script. See
> `spec/proposals/windows-backend.md` for the full plan.

## What it shows

`winix.config.ts` declares one host (`desktop`) and installs packages in every
supported form:

```ts
host("desktop", platforms.windows(), [
  windows.package("Fastfetch-cli.Fastfetch"),                       // float
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),       // msstore
  windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }), // pinned
  // windows.package({ id: "Some.Driver", elevated: true }),        // admin context
])
```

## Generate

From the repo root, after building the package:

```bash
npm run build
node examples/windows/generate.mjs
```

This writes the bundle to `examples/windows/out/desktop/`:

- `configuration.winget` — native DSC v3 document
- `apply.ps1` — thin entry point that calls `winget configure`

## Apply (on a Windows machine)

Copy the `out/desktop/` folder to your Windows box, then:

```powershell
winget configure -f .\configuration.winget --accept-configuration-agreements
```

Or run the generated entry point, which adds `--disable-interactivity` for an
unattended apply:

```powershell
pwsh -File .\apply.ps1
```

## Notes

- **Elevation is opt-in.** Packages install in the current user context by
  default. Add `elevated: true` only for packages that need admin (machine-wide
  installers, drivers). Defaulting to elevated makes `winget configure` fail
  from a non-elevated shell.
- **Determinism.** Packages are emitted sorted by id, so the document is stable
  regardless of declaration order.
