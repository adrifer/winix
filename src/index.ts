// Public API: what users import from "winix"

export type { Fragment, FragmentFactory, LazyFragment, FragmentEntry, InputDef, InputWithOptions, WorkspaceDef, HostDef, EvalContext } from "./core/types.js";
export { platform, feature, host, workspace, input, defineInputs, withContext } from "./sdk/index.js";
export { evaluate } from "./evaluator/index.js";
export type { EvaluatedHost } from "./evaluator/index.js";
export { generateNix } from "./backends/nix/index.js";
export type { NixOutput } from "./backends/nix/index.js";
