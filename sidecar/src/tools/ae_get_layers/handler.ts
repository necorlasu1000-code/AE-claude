// Phase 5.1.5 -- sidecar dispatcher adapter for ae_get_layers (read-only).
//
// Mirrors Phase 5.1.3/5.1.4 pattern. Two domain errors converted from
// dispatcher-generic AEError code strings:
//   AENoActiveCompError  -- compId omitted + app.project.activeItem null
//                            or non-Composition. Reuses Phase 5.1.3 class.
//   AENotFoundError      -- compId provided but app.project.itemByID(id)
//                            throws (no item with that id, or item is not
//                            a Composition). Phase 5.1.5 new class.

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError, AENotFoundError } from "../_errors.js";
import {
  aeGetLayersInputSchema,
  aeGetLayersOutputSchema,
  type AeGetLayersInput,
  type AeGetLayersOutput,
} from "./schema.js";

export const ae_get_layers = defineAETool<AeGetLayersInput, AeGetLayersOutput>({
  name: "ae_get_layers",
  description:
    "List layers in a composition. compId optional -- defaults to active composition. " +
    "Returns array of layer metadata (index, name, matchName, type, enabled, locked, inPoint, outPoint). " +
    "matchName is locale-stable internal id (e.g. 'ADBE Vector Layer'); type discriminates Layer subclass " +
    "(AVLayer/CameraLayer/LightLayer/ShapeLayer/TextLayer). " +
    "Throws AENoActiveCompError when compId omitted and no active comp; AENotFoundError when compId is unknown.",
  input: aeGetLayersInputSchema,
  output: aeGetLayersOutputSchema,
  handler: async (input: AeGetLayersInput, ctx: ToolCtx): Promise<AeGetLayersOutput> => {
    try {
      return await ctx.panelExec<AeGetLayersOutput>("ae_get_layers", input);
    } catch (e) {
      if (e instanceof AEError) {
        if (e.code === "AENoActiveCompError") {
          throw new AENoActiveCompError({ originalCtx: e.ctx });
        }
        if (e.code === "AENotFoundError") {
          const compId = input.compId !== undefined ? input.compId : "?";
          throw new AENotFoundError("composition", compId, { originalCtx: e.ctx });
        }
      }
      throw e;
    }
  },
});
