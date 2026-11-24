/**
 * True when an evaluated host targets the Windows backend.
 */
export function isWindowsHost(host: {
  /** Merged Windows options on the evaluated host. */
  windows?: Record<string, unknown>;
}): boolean {
  return Boolean(host.windows && Object.keys(host.windows).length > 0);
}
