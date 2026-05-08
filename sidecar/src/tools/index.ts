// Phase 5.1.3 — sidecar-side tool registry. Manual import per C1
// (explicit > generated; build-time dir scanning isn't viable for the
// sidecar's ESM/tsx hybrid setup, and explicit imports give static
// analyzers a working call graph).
//
// makeDispatcherExecHandler (sidecar/src/dispatcher/execHandler.ts)
// looks up incoming exec.tool here. Unknown tool names fall through
// to a Phase 4 backward-compat dumb-forward path so panel-direct exec
// (e.g., dev spike button calling tools not yet registered) still
// works without crashing.
//
// Phase 5 30-tool growth pattern: one named import + one object-literal
// entry per tool. Mirror of src/jsx/aeft/tools/index.ts (panel jsx side).

import type { DefinedTool } from "./_define.js";
import { ae_get_active_comp } from "./ae_get_active_comp/handler.js";
import { ae_list_comps } from "./ae_list_comps/handler.js";
import { ae_get_layers } from "./ae_get_layers/handler.js";
import { ae_list_effects } from "./ae_list_effects/handler.js";
import { ae_get_expression } from "./ae_get_expression/handler.js";
import { ae_get_keyframes } from "./ae_get_keyframes/handler.js";

export const tools: Record<string, DefinedTool> = {
  ae_get_active_comp,
  ae_list_comps,
  ae_get_layers,
  ae_list_effects,
  ae_get_expression,
  ae_get_keyframes,
};
