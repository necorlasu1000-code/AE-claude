// Phase 5.3.1 -- zod schema for ae_add_solid_layer (write, layer lane
// 1/9 -- first sub-step of 5.3, first reuse of 5.2.2 D4 HOF auto-wrap).
//
// Parameter order mirrors LayerCollection.addSolid per types-for-adobe AE
// 22.0 line 1517: addSolid(color, name, width, height, pixelAspect,
// duration?): AVLayer. Schema reorders for user-facing priority:
//   name (required) -> color (required) -> dimensions (default comp) ->
//   pixelAspect (default 1) -> duration (default comp) -> compId (default
//   active).
// Production AE accepts duration as the only optional positional (default
// matches comp duration when omitted); we materialize the default at
// impl-time so the addSolid call always receives an explicit number.
//
// destructive: true on the handler (5.2.2 reuse). HOF auto-wraps fn in
// app.beginUndoGroup("ae_add_solid_layer")/endUndoGroup -- one Ctrl+Z
// reverts the insertion.

import { z } from "zod";

export const aeAddSolidLayerInputSchema = z.object({
  /** Solid layer name (Layer panel + timeline label). Empty string rejected. */
  name: z.string().min(1),
  /** Solid color as ThreeDColorValue: [r, g, b] each in 0-1 range (NOT
   *  0-255 nor hex). Remap if the user gives a different format. */
  color: z.tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ]),
  /** Width in pixels. When omitted, defaults to the target comp's width
   *  (matches AE's "Make Solid" default behavior). Capped at 30000. */
  width: z.number().int().positive().max(30000).optional(),
  /** Height in pixels. When omitted, defaults to the target comp's height. */
  height: z.number().int().positive().max(30000).optional(),
  /** Pixel aspect ratio. Default 1.0 (square pixels). 2.0 widescreen
   *  anamorphic; 1.21 DV anamorphic. */
  pixelAspect: z.number().positive().optional(),
  /** Layer duration in SECONDS (not frames). When omitted, defaults to
   *  the target comp's duration. */
  duration: z.number().positive().optional(),
  /** Target composition by id. When omitted, defaults to the active
   *  composition; if no active comp is selected, returns AENoActiveCompError. */
  compId: z.number().int().positive().optional(),
});
export type AeAddSolidLayerInput = z.infer<typeof aeAddSolidLayerInputSchema>;

export const aeAddSolidLayerOutputSchema = z.object({
  /** Layer index in the comp (1-based). Production AE inserts new solids
   *  as the topmost layer, so this is typically 1 -- but downstream tools
   *  should read this echo rather than assuming. */
  index: z.number().int().positive(),
  /** Echo of the layer name (same as input.name). */
  name: z.string(),
  /** Container comp id. Useful when input.compId was omitted (defaulted
   *  to active comp); claude can pass this id to follow-up tools without
   *  another ae_get_active_comp roundtrip. */
  compId: z.number().int().positive(),
});
export type AeAddSolidLayerOutput = z.infer<typeof aeAddSolidLayerOutputSchema>;
