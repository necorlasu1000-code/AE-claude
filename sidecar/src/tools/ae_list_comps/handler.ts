// Phase 5.1.4 — sidecar dispatcher adapter for ae_list_comps (read-only).
//
// Mirrors Phase 5.1.3 ae_get_active_comp/handler.ts. Read-only list tools
// have no domain-specific sentinel conversion — empty project returns
// { items: [], total: 0, hasMore: false, nextOffset: null } from the impl,
// no AE error path beyond the generic dispatcher AEError (timeout, etc.)
// which propagates unchanged. Paginated per gate §5.

import { defineAETool, type ToolCtx } from "../_define.js";
import {
  aeListCompsInputSchema,
  aeListCompsOutputSchema,
  type AeListCompsInput,
  type AeListCompsOutput,
} from "./schema.js";

export const ae_list_comps = defineAETool<AeListCompsInput, AeListCompsOutput>({
  name: "ae_list_comps",
  description:
    "List compositions in the active After Effects project (paginated: limit/offset). " +
    "Returns { items, total, hasMore, nextOffset }; items[] hold comp metadata " +
    "(id, name, dimensions, durationSec, frameRate, numLayers).",
  input: aeListCompsInputSchema,
  output: aeListCompsOutputSchema,
  handler: async (input: AeListCompsInput, ctx: ToolCtx): Promise<AeListCompsOutput> => {
    return await ctx.panelExec<AeListCompsOutput>("ae_list_comps", input);
  },
});
