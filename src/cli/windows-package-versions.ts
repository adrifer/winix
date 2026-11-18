import { createInterface } from "node:readline/promises";

/** Only dotted numeric versions have an unambiguous ordering across Windows installers. */
export function isComparableWindowsPackageVersion(version: string): boolean {
  return /^\d+(?:\.\d+)*$/.test(version);
}

export function compareWindowsPackageVersions(id: string, left: string, right: string): number {
  if (left === right) return 0;
  if (!isComparableWindowsPackageVersion(left) || !isComparableWindowsPackageVersion(right)) {
    throw new Error(`Cannot reliably compare Windows package versions "${left}" and "${right}" for ${id}. Declare an exact version or resolve the package version explicitly.`);
  }
  const a = left.split(".").map(BigInt);
  const b = right.split(".").map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0n) - (b[index] ?? 0n);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
  }
  return 0;
}

export interface WindowsPackageRequirement {
  version: string;
  exact: boolean;
}

export function effectiveWindowsPackageVersion(
  id: string, requirement: WindowsPackageRequirement, installed?: string
): string {
  if (installed === undefined) return requirement.version;
  if (requirement.exact) {
    if (installed !== requirement.version) {
      const observed = isComparableWindowsPackageVersion(installed)
        ? `installed ${installed}` : `installed version reported as non-comparable (${JSON.stringify(installed)})`;
      throw new Error(`Exact version mismatch for ${id}: ${observed}, required ${requirement.version}. Resolve it explicitly; Winix will not silently replace or downgrade it.`);
    }
    return requirement.version;
  }
  if (!isComparableWindowsPackageVersion(installed)) return requirement.version;
  return compareWindowsPackageVersions(id, installed, requirement.version) >= 0 ? installed : requirement.version;
}

export async function confirmWindowsPackageLockUpdate(id: string, installed: string, locked: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  prompt.once("close", () => controller.abort());
  prompt.once("SIGINT", () => controller.abort());
  try {
    const answer = await prompt.question(
      `${id}: installed ${installed}, locked ${locked}. Update winix-windows.lock to ${installed}? [y/N] `,
      { signal: controller.signal },
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
