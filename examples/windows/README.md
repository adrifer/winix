# Windows example

A reference for the lower-level Windows helpers: every form of
`windows.package(...)`, raw commands with `windows.raw(...)`, environment and
PATH with `windows.env.*` / `windows.path.*`, and any DSC v3 resource with
`windows.dsc(...)`. For a whole config (files, PowerShell, Terminal, WSL),
see [`examples/cross-platform`](../cross-platform) and the
[Windows reference](../../docs/reference/windows.md).

## What it shows

`winix.config.ts` declares one host (`desktop`) and installs packages in every
supported form:

```ts
host("desktop", platforms.windows(), [
  windows.package("Fastfetch-cli.Fastfetch"),                       // locked in winix-windows.lock
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),       // msstore
  windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }), // pinned
  // windows.package({ id: "Some.Driver", elevated: true }),        // always in the elevated step
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

This writes `.winix/out/desktop/resources.json`: every resource with its
name, dependencies, elevation, and how `winix switch` checks and applies it.

## Raw commands and ordering

`windows.raw(...)` runs an arbitrary command on every switch. It accepts a
command string (run in PowerShell 7) or an explicit `{ executable, arguments }`
object.

Every `windows.*` resource helper returns a **handle**. Capture
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

## Environment variables, PATH, and the DSC escape hatch

`windows.env.*(...)` and `windows.path.*(...)` manage environment state
declaratively using built-in Windows DSC resources. Environment variables use
`Microsoft.Windows/Registry`; PATH entries use an idempotent
`Microsoft.DSC.Transitional/PowerShellScript` so PATH can be appended to
or pruned without clobbering unrelated entries.

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  windows.env.set("EDITOR", "nvim");
  windows.env.remove("OLD_TOOL_HOME");
  windows.path.add("%USERPROFILE%\\.local\\bin");
  windows.path.remove("%USERPROFILE%\\.old-bin");
  windows.env.set("JAVA_HOME", "C:\\Program Files\\Java\\jdk", { scope: "machine" });
});
```

- **Scopes.** The default is `scope: "user"` (`HKCU\Environment`), which does
  not require elevation. Use `scope: "machine"` for machine-wide values
  (`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`), which
  switch applies in its elevated step.
- **PATH is idempotent and surgical.** `windows.path.add(...)` appends the
  requested entry only when missing, and `windows.path.remove(...)` removes only
  that exact entry. Winix does not de-duplicate, reorder, trim, or normalize the
  rest of PATH.

When no typed helper exists, `windows.dsc(...)` declares any DSC v3 resource by
`type` + `properties`. Switch checks it with `dsc config test` and applies it
with `dsc config set`, passing the properties verbatim, so it targets native
DSC v3 resources (or any PSDSC resource via the adapter) directly:

```ts
windows.dsc({
  type: "Microsoft.Windows/Service",
  properties: { name: "spooler", startType: "automatic" },
});
```

`windows.dsc(...)` also returns a handle, so generic resources participate in
`dependsOn` ordering like every other helper.

Each resource gets a stable name of letters, numbers and spaces: a package's
name is its **sanitized** id (`OpenJS.NodeJS` → `OpenJS NodeJS`) with the real
id kept in `package.id`, and an id-less raw command gets a generated
`command N`. `dependsOn` lists those names. A handle from one host passed to
another host's `dependsOn` is a hard error at generation time.

## Apply (on a Windows machine)

Run:

```powershell
winix switch --host desktop
```

Switch checks every resource against the machine and applies only what is out
of date. Work that needs administrator rights runs in one elevated step (one
UAC prompt). Preview it first with `winix plan --host desktop`.

## Notes

- **Elevation is detected.** Machine-wide installs and packages without a
  per-user installer join switch's elevated step automatically. Add
  `elevated: true` only for installers that need admin without saying so
  (drivers, system services).
- **Determinism.** Packages are listed sorted by id and versions come from
  `winix-windows.lock`, so `resources.json` is stable regardless of declaration
  order.
