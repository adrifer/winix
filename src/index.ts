// Public API: what users import from "winix"

export type { Fragment, FragmentFactory, PlatformFactory, LazyFragment, PlatformLazyFragment, FragmentEntry, NixExpr, RawModuleRef, ImportRef, InputDef, InputWithOptions, WorkspaceDef, HostDef, EvalContext } from "./core/types.ts";
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
export { platform, feature, host, workspace, input, defineInputs, escape, raw, rawModule, withContext } from "./sdk/index.ts";
export { evaluate } from "./evaluator/index.ts";
export type { EvaluatedHost } from "./evaluator/index.ts";
export { generateNix } from "./backends/nix/index.ts";
export type { NixOutput } from "./backends/nix/index.ts";
export { packages, program, user, git, zsh, shell, sysctl, pkg, mkAfter, mkBefore, mkDefault, mkForce, overlay, nixStr, activation, ifDarwin, ifLinux, ifDarwinAttrs, ifLinuxAttrs, withPkgs, script, scriptConcat } from "./helpers/index.ts";
export type { PackagesHelper, PackagesOpts, ProgramHelper, UserOpts, GitOpts, ZshOpts, ShellOpts, SysctlSettings, OverlayHelper, ActivationOpts } from "./helpers/index.ts";
