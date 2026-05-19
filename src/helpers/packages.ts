import type { Fragment } from "../core/types.ts";

export interface PackagesOpts {
  scope?: "nixos" | "homeManager" | "darwin";
}

export interface PackagesHelper {
  (...names: string[]): Fragment;
  (names: string[], opts?: PackagesOpts): Fragment;
  homeManager(...names: string[]): Fragment;
  darwin(...names: string[]): Fragment;
}

export const packages: PackagesHelper = Object.assign(
  (...args: string[] | [string[], PackagesOpts?]): Fragment => {
    if (Array.isArray(args[0])) {
      const [names, opts] = args as [string[], PackagesOpts?];
      return packagesForScope(names, opts?.scope ?? "nixos");
    }

    return packagesForScope(args as string[], "nixos");
  },
  {
    homeManager: (...names: string[]): Fragment => packagesForScope(names, "homeManager"),
    darwin: (...names: string[]): Fragment => packagesForScope(names, "darwin"),
  }
);

function packagesForScope(
  names: string[],
  scope: NonNullable<PackagesOpts["scope"]>
): Fragment {
  if (scope === "homeManager") {
    return {
      homeManager: { home: { packages: names } },
    };
  }

  return {
    [scope]: { packages: names },
  };
}
