// Public API: what users import from "winix"

export type { Fragment, FragmentFactory, InputDef, InputWithOptions, WorkspaceDef, HostDef } from "./core/types.js";
export { platform, feature, host, workspace, input, defineInputs, withContext } from "./sdk/index.js";
export { evaluate } from "./evaluator/index.js";
export { generateNix } from "./backends/nix/index.js";
