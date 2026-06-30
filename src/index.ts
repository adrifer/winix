// Public API: what users import from "@adrifer/winix"

export type { Fragment, FragmentFactory, PlatformFactory, ProfileFactory, LazyFragment, PlatformLazyFragment, FragmentEntry, FragmentResult, NixExpr, RawModuleRef, ImportRef, InputDef, InputWithOptions, WorkspaceDef, HostDef, EvalContext } from "./core/types.ts";
export type {
  Attrs,
  BootOptions,
  DarwinNetworking,
  DarwinOptions,
  DarwinSecurity,
  DarwinDefaults,
  DarwinSystem,
  EnvironmentOptions,
  FirewallOptions,
  FontsOptions,
  FzfOptions,
  GitInclude,
  GitOptions,
  HomeActivation,
  HomebrewOptions,
  HomeConfig,
  HomeFile,
  HomeOptions,
  I18nOptions,
  LaunchdAgentOptions,
  LaunchdOptions,
  NeovimOptions,
  NetworkingOptions,
  NixConfig,
  NixGcOptions,
  NixHomebrewOptions,
  NixOptions,
  NixpkgsOptions,
  NixosSecurityOptions,
  NixosSystemOptions,
  NixPrimitive,
  NixSettings,
  NixValue,
  NixosOptions,
  OciContainerOptions,
  PackageRef,
  Script,
  ServicesOptions,
  StarshipOptions,
  SystemdOptions,
  SystemdService,
  SystemdTimer,
  TimeOptions,
  TmuxOptions,
  UserOptions,
  UsersOptions,
  VirtualisationOptions,
  WslOptions,
  XdgFile,
  XdgOptions,
  ZoxideOptions,
  ZshOptions,
  WindowsOptions,
  WinPackage,
  WinPackageSource,
  WinRawCommand,
  WinSettings,
  WinColorMode,
  WinTaskbarAlignment,
} from "./types/index.ts";
export { platform, feature, profile, host, workspace, input, defineInputs, rawModule, withContext } from "./sdk/index.ts";
export type { WinixContext } from "./sdk/context.ts";
export { evaluate } from "./evaluator/index.ts";
export type { EvaluatedHost } from "./evaluator/index.ts";
export { generateNix } from "./backends/nix/index.ts";
export type { NixOutput } from "./backends/nix/index.ts";
export { generateWindows, isWindowsHost } from "./backends/windows/index.ts";
export type { WindowsOutput, WindowsHostOutput } from "./backends/windows/index.ts";
export { account, darwin, home, nix, nixos, overlay, platforms, windows } from "./helpers/index.ts";
export type { AccountGroupFactory, AccountGroupMember, AccountGroupOpts, AccountNamespace, AccountOpts, AccountUserFactory, AccountUserRef, ActivationOpts, BinaryReleaseArch, BinaryReleaseCompletions, BinaryReleaseMeta, BinaryReleaseOpts, BinaryReleasePlatform, DarwinHelper, DarwinPlatformOpts, DarwinProgramOptions, DarwinServiceOptions, HomeHelper, HomeProgramOptions, HomeServiceOptions, LaunchdHelper, NixNamespace, NixosHelper, NixosPlatformOpts, NixosProgramOptions, NixosServiceOptions, OverlayHelper, PkgHelper, PlatformsHelper, ScriptHelper, SysctlSettings, SystemdHelper, VirtualisationHelper, WindowsHelper, WindowsPlatformOpts, WinEnvNamespace, WinEnvOpts, WinEnvScope, WinFileEncoding, WinFileNamespace, WinFileOpts, WinPackageArg, WinPackageSpec, WinPathNamespace, WinRawCommandArg, WinRawCommandSpec, WinSettingOpts } from "./helpers/index.ts";
