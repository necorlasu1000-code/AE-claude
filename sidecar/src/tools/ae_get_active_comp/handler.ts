// Phase 5.1.3 — sidecar dispatcher adapter for ae_get_active_comp.
//
// Architecture refactor (replaces Phase 4 mcp/server.ts inline path):
//   handler.ts wraps defineAETool HOF (schema gates + zod validation),
//   delegates the actual ExtendScript execution to ctx.panelExec (which
//   makeDispatcherExecHandler injects as a dispatcher.exec adapter),
//   and converts the panel jsx side's sentinel-string error envelope
//   (`{code: "AENoActiveCompError", ...}`) into the typed AENoActiveCompError
//   subclass so call sites can `catch (e) { if (e instanceof AENoActive...) }`.
//
// Why this layer exists (per mistakes #15 / D-K):
//   - mcp/server.ts is a dumb stdio↔ws relay; domain logic lives in the
//     sidecar main process.
//   - dispatcher.exec returns generic DispatcherResult; AEError taxonomy
//     reattachment is the per-tool author's job (only this handler knows
//     which codes the impl can raise).
//
// Phase 5.1.3 scope keeps the wrapper thin: defineAETool gives us schema
// + timeout + (future) undo group + (future) approval. The handler body
// is just "panelExec → return data, AEError code dispatch". 30 future
// tools follow the same pattern.

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError } from "../_errors.js";
import {
  aeGetActiveCompInputSchema,
  aeGetActiveCompOutputSchema,
  type AeGetActiveCompInput,
  type AeGetActiveCompOutput,
} from "./schema.js";

export const ae_get_active_comp = defineAETool<AeGetActiveCompInput, AeGetActiveCompOutput>({
  name: "ae_get_active_comp",
  description:
    "Get the currently active composition in After Effects. " +
    "Returns the comp's id, name, dimensions, durationSec, frameRate, and numLayers. " +
    "Throws AENoActiveCompError when no comp is selected (typeName !== 'Composition').",
  input: aeGetActiveCompInputSchema,
  output: aeGetActiveCompOutputSchema,
  handler: async (input: AeGetActiveCompInput, ctx: ToolCtx): Promise<AeGetActiveCompOutput> => {
    try {
      return await ctx.panelExec<AeGetActiveCompOutput>("ae_get_active_comp", input);
    } catch (e) {
      if (e instanceof AEError && e.code === "AENoActiveCompError") {
        throw new AENoActiveCompError({ originalCtx: e.ctx });
      }
      throw e;
    }
  },
});
