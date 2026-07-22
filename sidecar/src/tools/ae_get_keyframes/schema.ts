// Phase 5.1.8 -- zod schema for ae_get_keyframes (read-only, MVP 5/5
// keyframe lane).
//
// Output shape: { items, total, hasMore, nextOffset } -- pagination gate
// (CLAUDE.md section 5) envelope, same as ae_list_* / ae_get_layers (a
// dense wiggle bake can easily hold thousands of keys). Each entry exposes the 1-based
// keyframe index, time (in seconds), value (raw -- shape varies by
// PropertyValueType: number / [n,n] / [n,n,n] / [n,n,n,n] for
// OneD/TwoD/ThreeD/Color, or {} for TextDocument/Shape/MarkerValue),
// and interpolation type (in/out separate -- Phase 5.1.1 option B).
//
// Phase 5.1.7 fix-2 (mistakes #19) pattern -- description fields here are
// dev annotations; production source claude reads is the registerTool
// description in mcp/server.ts.
//
// propertyName follows the Phase 5.1.7 fix display-name lookup contract
// (mistakes #18) -- ExtendScript's layer.property(name) on a Layer
// resolves by display name, not matchName.

import { z } from "zod";

export const aeGetKeyframesInputSchema = z.object({
  /** 1-based layer index per AE convention. Required. */
  layerIndex: z.number().int().positive(),
  /** Property display name in the current locale (e.g., "Position",
   *  "Scale", "Rotation", "Anchor Point", "Opacity"). NOT the matchName --
   *  layer.property() does display-name lookup. Required. */
  propertyName: z.string().min(1),
  /** Composition id (Item.id). Omit to use app.project.activeItem. When
   *  omitted and no active comp exists, AENoActiveCompError is raised. */
  compId: z.number().optional(),
  // Pagination gate (CLAUDE.md section 5).
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type AeGetKeyframesInput = z.infer<typeof aeGetKeyframesInputSchema>;

/** KeyframeInterpolationType enum names from types-for-adobe AE 22.0:
 *  LINEAR=6612, BEZIER=6613, HOLD=6614. impl.ts maps the raw int returned
 *  by keyInInterpolationType / keyOutInterpolationType to these strings.
 *  Unknown ints fall back to "BEZIER" (AE's default keyframe interpolation). */
export const aeKeyframeInterpolationSchema = z.enum(["LINEAR", "BEZIER", "HOLD"]);
export type AeKeyframeInterpolation = z.infer<typeof aeKeyframeInterpolationSchema>;

export const aeKeyframeEntrySchema = z.object({
  /** 1-based keyframe index (matches AE's keyTime/keyValue arg convention). */
  index: z.number().int().positive(),
  /** Keyframe time in seconds (Property.keyTime return). */
  time: z.number(),
  /** Raw keyframe value. Shape varies by Property.propertyValueType --
   *  OneD=number, TwoD/ThreeD=number[], COLOR=[r,g,b,a], TEXT_DOCUMENT/
   *  SHAPE/MARKER=object. Consumer inspects shape based on the property's
   *  known valueType (claude knows from prior context). */
  value: z.unknown(),
  /** Interpolation types for this keyframe, separated for in/out edges
   *  (Phase 5.1.1 option B -- AE allows mismatched in/out types). */
  interpolation: z.object({
    in: aeKeyframeInterpolationSchema,
    out: aeKeyframeInterpolationSchema,
  }),
});
export type AeKeyframeEntry = z.infer<typeof aeKeyframeEntrySchema>;

export const aeGetKeyframesOutputSchema = z.object({
  items: z.array(aeKeyframeEntrySchema),
  /** Total keyframes on the property (before pagination). */
  total: z.number().int().nonnegative(),
  /** True when more keyframes exist past this page. */
  hasMore: z.boolean(),
  /** Offset to pass for the next page, or null when this is the last page. */
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type AeGetKeyframesOutput = z.infer<typeof aeGetKeyframesOutputSchema>;
