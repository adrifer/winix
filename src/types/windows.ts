// Windows backend types: the IR carried by fragments under the `windows` key.
//
// These are intentionally minimal for the MVP vertical slice (packages only).
// They will grow to cover env/path/file/raw/dsc/wsl/programs as the backend
// matures. The shape here is the *internal* representation produced by the
// `windows.*` helpers and consumed by the Windows emitter, not the public
// authoring surface.

/**
 * A winget package source. MVP supports the two first-party catalogues.
 * Additional sources (chocolatey, scoop) can plug in later without changing
 * this union's consumers.
 */
export type WinPackageSource = "winget" | "msstore";

/**
 * A single declared Windows package, normalized from any of the
 * `windows.package(...)` call shapes into a stable internal record.
 */
export interface WinPackage {
  /** Winget/msstore package identifier, e.g. "Git.Git". */
  id: string;
  /** Catalogue the id resolves against. Defaults to "winget". */
  source: WinPackageSource;
  /**
   * Absolute version pin. When present, this exact version is emitted to
   * `configuration.winget` regardless of what is available upstream. When
   * absent, the version floats (resolved at `winix update` time via the
   * lockfile in a later milestone).
   */
  version?: string;
  /**
   * When true, the package is installed in an elevated (admin) security
   * context via `metadata.winget.securityContext: elevated`. Required for
   * machine-wide installers (drivers, system services). Defaults to false so
   * per-user packages install without prompting for / requiring elevation,
   * which also avoids the DSC cross-process elevation failure when
   * `winget configure` is run from a non-elevated shell.
   */
  elevated?: boolean;
}

/**
 * The `windows` scope of a Fragment. Deep-merged across all fragments for a
 * host, then handed to the Windows emitter.
 *
 * `packages` is keyed by package id so that merging is idempotent and a later
 * fragment pinning a version overrides an earlier float for the same id.
 */
export interface WindowsOptions extends Record<string, unknown> {
  /** Declared packages, keyed by package id. */
  packages?: Record<string, WinPackage>;
  /** Hostname for the target, set by the platform baseline. */
  hostname?: string;
  /** DSC v3 schema revision the emitted document pins against. */
  schema?: string;
}
