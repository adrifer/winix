type AnyOptions = Record<string, unknown>;

declare const knownOptionsBrand: unique symbol;
type KnownOptionsBrand = { readonly [knownOptionsBrand]?: never };

export type ProgramOptions<Options, K extends string> =
  string extends K
    ? AnyOptions
    : K extends keyof Options ? KnownProgramOptions<Options, K> : AnyOptions;

export type ServiceOptions<Options, K extends string> =
  string extends K
    ? AnyOptions
    : K extends keyof Options ? KnownServiceOptions<Options, K> : AnyOptions;

export type KnownProgramOptions<Options, K extends keyof Options> =
  Omit<Options[K], "enable"> & KnownOptionsBrand;

export type KnownServiceOptions<Options, K extends keyof Options> =
  Omit<Options[K], "enable"> & KnownOptionsBrand;
