// Phase 5.3.2 -- zod schema for ae_add_text_layer (write, layer lane 2/9).
//
// Factory surface: LayerCollection.addText(sourceText?): TextLayer (types-
// for-adobe AE 22.0). Unlike addSolid, styling is NOT a factory parameter --
// font / fontSize / fillColor ride the TextDocument round-trip
// (layer.property("Source Text") -> read .value -> mutate -> setValue),
// and position goes through layer.property("Position").setValue([x, y]).
// The impl performs those extra writes only when the matching input field
// is present, so a text-only call touches nothing but addText.
//
// destructive: true on the handler (5.2.2 D4 pattern). HOF auto-wraps the
// whole body -- factory + styling writes -- in ONE undo group named
// "ae_add_text_layer", so a single Ctrl+Z reverts the layer AND its styling.

import { z } from "zod";

export const aeAddTextLayerInputSchema = z.object({
  /** Text content of the layer. Production AE also uses this as the layer
   *  name (Layer panel label). Empty string rejected. */
  text: z.string().min(1),
  /** Font as PostScript name (e.g. "ArialMT", "Arial-BoldMT",
   *  "NotoSansKR-Regular"). NOT the display family name -- TextDocument.font
   *  takes PostScript names. When omitted, keeps AE's character-panel
   *  default. */
  font: z.string().min(1).optional(),
  /** Font size in pixels. AE caps at 1296. When omitted, keeps the
   *  character-panel default. */
  fontSize: z.number().positive().max(1296).optional(),
  /** Fill color as [r, g, b] each in 0-1 range (NOT 0-255 nor hex).
   *  Setting this also enables fill (applyFill). When omitted, keeps the
   *  character-panel default. */
  fillColor: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ])
    .optional(),
  /** Layer position as [x, y] in comp pixel coordinates (Transform >
   *  Position). Negative / out-of-frame values allowed (offscreen).
   *  When omitted, keeps AE's default placement. */
  position: z.tuple([z.number(), z.number()]).optional(),
  /** Target composition by id. When omitted, defaults to the active
   *  composition; if no active comp is selected, returns AENoActiveCompError. */
  compId: z.number().int().positive().optional(),
});
export type AeAddTextLayerInput = z.infer<typeof aeAddTextLayerInputSchema>;

export const aeAddTextLayerOutputSchema = z.object({
  /** Layer index in the comp (1-based). Production AE inserts new text
   *  layers as the topmost layer, so this is typically 1 -- downstream
   *  tools should read this echo rather than assuming. */
  index: z.number().int().positive(),
  /** Layer name (production AE derives it from the source text). */
  name: z.string(),
  /** Container comp id -- pass to follow-up tools without another
   *  ae_get_active_comp roundtrip. */
  compId: z.number().int().positive(),
});
export type AeAddTextLayerOutput = z.infer<typeof aeAddTextLayerOutputSchema>;
