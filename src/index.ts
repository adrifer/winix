// Public API: what users import from "winix"

export type { Fragment, FragmentFactory, PlatformFactory, LazyFragment, PlatformLazyFragment, FragmentEntry, RawModuleRef, ImportRef, InputDef, InputWithOptions, WorkspaceDef, HostDef, EvalContext } from "./core/types.ts";
export { platform, feature, host, workspace, input, defineInputs, rawModule, withContext } from "./sdk/index.ts";
export { evaluate } from "./evaluator/index.ts";
export type { EvaluatedHost } from "./evaluator/index.ts";
export { generateNix } from "./backends/nix/index.ts";
export type { NixOutput } from "./backends/nix/index.ts";
