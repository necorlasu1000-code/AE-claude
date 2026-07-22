// Phase 5.3.2 -- sidecar dispatcher adapter for ae_add_text_layer
// (write, layer lane 2/9 -- second reuse of the 5.2.2/5.3.1 D4 pattern).
//
// destructive: true -- the jsx-side defineJsxTool HOF auto-wraps the whole
// impl body (addText factory + TextDocument styling + Position write) in
// app.beginUndoGroup("ae_add_text_layer")/endUndoGroup via try/finally, so
// one Ctrl+Z reverts the layer together with its styling.
//
// AENoActiveCompError throw path: input.compId omitted AND no active
// composition (activeItem null or non-Composition).
// AENotFoundError throw path: input.compId provided but unknown OR
// resolves to a non-Composition item.

import { defineAETool, type ToolCtx } from "../_define.js";
import { AEError, AENoActiveCompError, AENotFoundError } from "../_errors.js";
import {
  aeAddTextLayerInputSchema,
  aeAddTextLayerOutputSchema,
  type AeAddTextLayerInput,
  type AeAddTextLayerOutput,
} from "./schema.js";

export const ae_add_text_layer = defineAETool<AeAddTextLayerInput, AeAddTextLayerOutput>({
  name: "ae_add_text_layer",
  destructive: true,
  description:
    "Add a new text layer to a composition. Specify text (the layer's " +
    "content; AE also uses it as the layer name). Optional styling: font " +
    "(PostScript name, e.g. 'ArialMT' or 'NotoSansKR-Regular' -- NOT the " +
    "display family name), fontSize (pixels, max 1296), fillColor (RGB " +
    "array [r, g, b] in 0-1 range, NOT 0-255 -- remap if user gives " +
    "hex/255; setting it also enables fill), position ([x, y] comp pixel " +
    "coordinates, Transform > Position), compId (default = active " +
    "composition). Omitted style fields keep AE's character-panel " +
    "defaults. Returns { index (1-based, typically 1 since AE inserts as " +
    "topmost layer), name, compId } -- use compId in follow-up tools to " +
    "avoid re-resolving the active comp. DESTRUCTIVE: wraps layer " +
    "creation AND styling in one undo group named 'ae_add_text_layer' so " +
    "a single Ctrl+Z reverts both. " +
    "Throws AENoActiveCompError when compId omitted and no active comp; " +
    "AENotFoundError when compId is unknown or resolves to a " +
    "non-Composition item.",
  input: aeAddTextLayerInputSchema,
  output: aeAddTextLayerOutputSchema,
  handler: async (input: AeAddTextLayerInput, ctx: ToolCtx): Promise<AeAddTextLayerOutput> => {
    try {
      return await ctx.panelExec<AeAddTextLayerOutput>("ae_add_text_layer", input);
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
