// Phase 5.1.8 -- sidecar dispatcher adapter for ae_get_keyframes (read-only).
//
// Mirrors Phase 5.1.7 ae_get_expression handler. Two domain errors converted
// from dispatcher-generic AEError code strings:
//   AENoActiveCompError  -- compId omitted + activeItem null/non-Composition
//   AENotFoundError      -- compId unknown OR layerIndex out of bounds OR
//                            propertyName not present on the layer.
//                            impl.ts encodes which one fired in the
//                            sentinel userMessage; handler reattaches the
//                            typed subclass with the input echo.

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError, AENotFoundError } from "../_errors.js";
import {
  aeGetKeyframesInputSchema,
  aeGetKeyframesOutputSchema,
  type AeGetKeyframesInput,
  type AeGetKeyframesOutput,
} from "./schema.js";

export const ae_get_keyframes = defineAETool<AeGetKeyframesInput, AeGetKeyframesOutput>({
  name: "ae_get_keyframes",
  description:
    "Get keyframes on a property of a layer. propertyName is the display name " +
    "in the current locale (e.g., 'Position', 'Scale', 'Rotation', 'Anchor Point', " +
    "'Opacity'). Returns keyframe array with index, time (seconds), value (raw, " +
    "shape varies by propertyValueType), and interpolation (in/out separate). " +
    "compId optional -- defaults to active composition. " +
    "Returns { keyframes: [] } when no keyframes are set on the property. " +
    "Throws AENoActiveCompError when compId omitted and no active comp; " +
    "AENotFoundError when compId is unknown, layerIndex is out of bounds, " +
    "or propertyName is not present on the layer.",
  input: aeGetKeyframesInputSchema,
  output: aeGetKeyframesOutputSchema,
  handler: async (input: AeGetKeyframesInput, ctx: ToolCtx): Promise<AeGetKeyframesOutput> => {
    try {
      return await ctx.panelExec<AeGetKeyframesOutput>("ae_get_keyframes", input);
    } catch (e) {
      if (e instanceof AEError) {
        if (e.code === "AENoActiveCompError") {
          throw new AENoActiveCompError({ originalCtx: e.ctx });
        }
        if (e.code === "AENotFoundError") {
          const id = `comp=${input.compId ?? "active"} layer=${input.layerIndex} property='${input.propertyName}'`;
          throw new AENotFoundError("composition / layer / property", id, { originalCtx: e.ctx });
        }
      }
      throw e;
    }
  },
});
