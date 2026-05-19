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
export { platform, feature, profile, host, workspace, input, defineInputs, raw, rawModule, withContext } from "./sdk/index.ts";
export { evaluate } from "./evaluator/index.ts";
export type { EvaluatedHost } from "./evaluator/index.ts";
export { generateNix } from "./backends/nix/index.ts";
export type { NixOutput } from "./backends/nix/index.ts";
export { account, activation, firewall, git, home, nix, overlay, packages, platforms, program, programs, service, services, shell, sysctl, systemd, user, zsh } from "./helpers/index.ts";
export type { AccountOpts, ActivationOpts, DarwinPlatformOpts, FirewallHelper, GitOpts, HomeHelper, NixGcHelperOpts, NixNamespace, NixosPlatformOpts, OverlayHelper, PackagesHelper, PackagesOpts, PkgHelper, PlatformsHelper, ProgramHelper, ProgramsHelper, ScriptHelper, ServicesHelper, ShellOpts, SysctlSettings, SystemdHelper, UserOpts, ZshOpts } from "./helpers/index.ts";
