// Phase 5.1.6 -- sidecar dispatcher adapter for ae_list_effects (read-only).
//
// Mirrors Phase 5.1.5 ae_get_layers/handler.ts. Two domain errors converted
// from dispatcher-generic AEError code strings:
//   AENoActiveCompError  -- compId omitted + activeItem null/non-Composition
//   AENotFoundError      -- compId unknown OR layerIndex out of bounds
//                            (impl.ts dispatches one of two messages so
//                            the handler doesn't need to reconstruct which
//                            one fired -- it just rebuilds the typed
//                            subclass with input echo for the user message)

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError, AENotFoundError } from "../_errors.js";
import {
  aeListEffectsInputSchema,
  aeListEffectsOutputSchema,
  type AeListEffectsInput,
  type AeListEffectsOutput,
} from "./schema.js";

export const ae_list_effects = defineAETool<AeListEffectsInput, AeListEffectsOutput>({
  name: "ae_list_effects",
  description:
    "List effects applied to a layer. layerIndex required (1-based, AE convention). " +
    "compId optional -- defaults to active composition. " +
    "Paginated: optional limit (1-200, default 50) and offset (0-based, default 0). " +
    "Returns { items, total, hasMore, nextOffset } where items[] hold effect metadata " +
    "(matchName, displayName, enabled). matchName is the locale-stable internal id " +
    "(e.g., 'ADBE Gaussian Blur 2'); displayName is the user-facing label in AE Effect " +
    "Controls. nextOffset is the offset for the next page (null on the last page). " +
    "Throws AENoActiveCompError when compId omitted and no active comp; " +
    "AENotFoundError when compId is unknown or layerIndex is out of bounds. " +
    "Layers that don't host effects (Camera/Light/Null) return " +
    "{ items: [], total: 0, hasMore: false, nextOffset: null }.",
  input: aeListEffectsInputSchema,
  output: aeListEffectsOutputSchema,
  handler: async (input: AeListEffectsInput, ctx: ToolCtx): Promise<AeListEffectsOutput> => {
    try {
      return await ctx.panelExec<AeListEffectsOutput>("ae_list_effects", input);
    } catch (e) {
      if (e instanceof AEError) {
        if (e.code === "AENoActiveCompError") {
          throw new AENoActiveCompError({ originalCtx: e.ctx });
        }
        if (e.code === "AENotFoundError") {
          // impl.ts puts the resource label in userMessage already
          // ("Composition not found: 42" or "Layer not found: 5 in
          // comp 42"); we surface it via the typed subclass with the
          // input echo so dispatcher logging stays useful.
          const id = `comp=${input.compId ?? "active"} layer=${input.layerIndex}`;
          throw new AENotFoundError("composition or layer", id, { originalCtx: e.ctx });
        }
      }
      throw e;
    }
  },
});
