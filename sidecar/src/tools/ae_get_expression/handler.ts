// Phase 5.1.7 -- sidecar dispatcher adapter for ae_get_expression (read-only).
//
// Mirrors Phase 5.1.5/5.1.6 pattern. Two domain errors converted from
// dispatcher-generic AEError code strings:
//   AENoActiveCompError  -- compId omitted + activeItem null/non-Composition
//   AENotFoundError      -- compId unknown OR layerIndex out of bounds OR
//                            propertyMatchName not present on the layer.
//                            impl.ts encodes which one fired in the
//                            sentinel userMessage; handler reattaches the
//                            typed subclass with the input echo.

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError, AENotFoundError } from "../_errors.js";
import {
  aeGetExpressionInputSchema,
  aeGetExpressionOutputSchema,
  type AeGetExpressionInput,
  type AeGetExpressionOutput,
} from "./schema.js";

export const ae_get_expression = defineAETool<AeGetExpressionInput, AeGetExpressionOutput>({
  name: "ae_get_expression",
  description:
    "Get expression on a property of a layer. propertyName is the display name " +
    "in the current locale (e.g., 'Position', 'Scale', 'Rotation', 'Anchor Point', " +
    "'Opacity') -- NOT the internal matchName. ExtendScript's layer.property() " +
    "uses display-name lookup when called directly on a Layer. " +
    "Returns expression source string and enabled flag. " +
    "compId optional -- defaults to active composition. " +
    "Returns { expression: '', enabled: false } when no expression is set on the property. " +
    "Throws AENoActiveCompError when compId omitted and no active comp; " +
    "AENotFoundError when compId is unknown, layerIndex is out of bounds, " +
    "or propertyName is not present on the layer.",
  input: aeGetExpressionInputSchema,
  output: aeGetExpressionOutputSchema,
  handler: async (input: AeGetExpressionInput, ctx: ToolCtx): Promise<AeGetExpressionOutput> => {
    try {
      return await ctx.panelExec<AeGetExpressionOutput>("ae_get_expression", input);
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
