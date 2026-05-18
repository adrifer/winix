import type { Fragment } from "../core/types.ts";

export interface PackagesOpts {
  scope?: "nixos" | "home" | "darwin";
}

export interface PackagesHelper {
  (...names: string[]): Fragment;
  (names: string[], opts?: PackagesOpts): Fragment;
  home(...names: string[]): Fragment;
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
    home: (...names: string[]): Fragment => packagesForScope(names, "home"),
    darwin: (...names: string[]): Fragment => packagesForScope(names, "darwin"),
  }
);

function packagesForScope(
  names: string[],
  scope: NonNullable<PackagesOpts["scope"]>
): Fragment {
  return {
    [scope]: { packages: names },
  };
}
