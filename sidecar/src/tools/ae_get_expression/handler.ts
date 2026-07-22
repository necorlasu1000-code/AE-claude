// Phase 5.1.7 -- sidecar dispatcher adapter for ae_get_expression (read-only).
//
// Mirrors Phase 5.1.5/5.1.6 pattern. Two domain errors converted from
// dispatcher-generic AEError code strings:
//   AENoActiveCompError  -- compId omitted + activeItem null/non-Composition
//   AENotFoundError      -- compId unknown OR layerIndex out of bounds OR
//                            propertyName not present on the layer.
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
    "Get expression on a property of a layer. propertyName is the property " +
    "name as shown in the After Effects panel timeline (display name in current " +
    "locale). Examples: 'Position', 'Scale', 'Rotation', 'Anchor Point', 'Opacity'. " +
    "Do NOT use internal matchNames (e.g., 'ADBE Position') -- ExtendScript's " +
    "layer.property() lookup uses display name only. " +
    "Returns expression source string and enabled flag. " +
    "compId optional -- defaults to active composition. " +
    "Returns { expression: '', enabled: false } when no expression is set. " +
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
