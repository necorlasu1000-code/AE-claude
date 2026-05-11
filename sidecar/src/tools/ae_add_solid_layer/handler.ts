// Phase 5.3.1 -- sidecar dispatcher adapter for ae_add_solid_layer
// (write, layer lane 1/9 -- 5.3 lane first sub-step, D4 HOF reuse first
// activation).
//
// destructive: true (5.2.2 pattern reuse). The jsx-side defineJsxTool
// HOF auto-wraps fn in app.beginUndoGroup("ae_add_solid_layer")/
// endUndoGroup via try/finally. impl.ts body stays linear (0 boilerplate
// lines for undo wiring) -- this is the DRY payoff of the 5.2.2
// architecture decision (24 future destructive tools inherit).
//
// AENoActiveCompError throw path: input.compId omitted AND no active
// composition is selected (typeName !== "Composition" or activeItem null).
// AENotFoundError throw path: input.compId provided but unknown OR
// resolves to a non-Composition item.

import { defineAETool, type ToolCtx } from "../_define.js";
import {
  aeAddSolidLayerInputSchema,
  aeAddSolidLayerOutputSchema,
  type AeAddSolidLayerInput,
  type AeAddSolidLayerOutput,
} from "./schema.js";

export const ae_add_solid_layer = defineAETool<AeAddSolidLayerInput, AeAddSolidLayerOutput>({
  name: "ae_add_solid_layer",
  destructive: true,
  description:
    "Add a new solid color layer to a composition. The jsx HOF wraps in " +
    "an undo group named 'ae_add_solid_layer' so a single Ctrl+Z reverts.",
  input: aeAddSolidLayerInputSchema,
  output: aeAddSolidLayerOutputSchema,
  handler: async (input: AeAddSolidLayerInput, ctx: ToolCtx): Promise<AeAddSolidLayerOutput> => {
    return await ctx.panelExec<AeAddSolidLayerOutput>("ae_add_solid_layer", input);
  },
});
