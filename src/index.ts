// Public API: what users import from "winix"

export type { Fragment, FragmentFactory, PlatformFactory, ProfileFactory, LazyFragment, PlatformLazyFragment, FragmentEntry, FragmentResult, NixExpr, RawModuleRef, ImportRef, InputDef, InputWithOptions, WorkspaceDef, HostDef, EvalContext } from "./core/types.ts";
export type {
  Attrs,
  BootOptions,
  DarwinNetworking,
  DarwinOptions,
  DarwinSecurity,
  DarwinSystem,
  EnvironmentOptions,
  FirewallOptions,
  FzfOptions,
  GitInclude,
  GitOptions,
  HomeActivation,
  HomebrewOptions,
  HomeConfig,
  HomeOptions,
  HomePrograms,
  NeovimOptions,
  NetworkingOptions,
  NixConfig,
  NixGcOptions,
  NixHomebrewOptions,
  NixOptions,
  NixpkgsOptions,
  NixPrimitive,
  NixSettings,
  NixValue,
  NixosOptions,
  PackageRef,
  Script,
  ServicesOptions,
  StarshipOptions,
  SystemdOptions,
  SystemdService,
  SystemdTimer,
  TmuxOptions,
  UserOptions,
  UsersOptions,
  WslOptions,
  XdgFile,
  XdgOptions,
  ZoxideOptions,
  ZshOptions,
} from "./types/index.ts";
export { platform, feature, profile, host, workspace, input, defineInputs, rawModule, withContext } from "./sdk/index.ts";
export { evaluate } from "./evaluator/index.ts";
export type { EvaluatedHost } from "./evaluator/index.ts";
export { generateNix } from "./backends/nix/index.ts";
export type { NixOutput } from "./backends/nix/index.ts";
export { account, darwin, home, nix, nixos, overlay, platforms } from "./helpers/index.ts";
export type { AccountOpts, ActivationOpts, DarwinHelper, DarwinPlatformOpts, DarwinProgramOptions, DarwinServiceOptions, HomeHelper, HomeProgramOptions, HomeServiceOptions, NixGcHelperOpts, NixNamespace, NixosHelper, NixosPlatformOpts, NixosProgramOptions, NixosServiceOptions, OverlayHelper, PkgHelper, PlatformsHelper, ScriptHelper, SysctlSettings } from "./helpers/index.ts";
