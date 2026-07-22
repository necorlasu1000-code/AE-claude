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
    "Add a new solid color layer to a composition. Specify name and " +
    "color (RGB array [r, g, b] in 0-1 range, NOT 0-255 -- remap if " +
    "user gives hex/255). Optional: width and height (pixels, max " +
    "30000, default = comp dimensions matching AE 'Make Solid' " +
    "default), pixelAspect (default 1.0 square pixels), duration " +
    "(SECONDS not frames, default = comp duration), compId (default " +
    "= active composition). Returns { index (1-based, typically 1 " +
    "since AE inserts solids as topmost layer), name, compId } -- " +
    "use compId in follow-up tools to avoid re-resolving the active " +
    "comp. DESTRUCTIVE: wraps in undo group named 'ae_add_solid_" +
    "layer' so a single Ctrl+Z reverts. " +
    "Throws AENoActiveCompError when compId omitted and no active " +
    "comp; AENotFoundError when compId is unknown or resolves to a " +
    "non-Composition item.",
  input: aeAddSolidLayerInputSchema,
  output: aeAddSolidLayerOutputSchema,
  handler: async (input: AeAddSolidLayerInput, ctx: ToolCtx): Promise<AeAddSolidLayerOutput> => {
    return await ctx.panelExec<AeAddSolidLayerOutput>("ae_add_solid_layer", input);
  },
});
