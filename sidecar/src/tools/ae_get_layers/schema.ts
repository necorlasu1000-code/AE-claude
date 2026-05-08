// Phase 5.1.5 -- zod schema for ae_get_layers (read-only, MVP 2/5 layer lane).
//
// Output shape: { layers: AeLayerEntry[] } -- array wrapping under `layers`
// key per Phase 5.0 (D-N) lane convention. Each entry includes matchName
// (locale-stable internal id from PropertyBase, e.g. "ADBE Vector Layer")
// so claude can reference layers in i18n environments where layer.name
// is the user's localized label.
//
// type field enum: AE Layer subclass class names per types-for-adobe AE 22.0.
// Values match Object.prototype.toString.call(layer) extraction in impl.ts.

import { z } from "zod";

export const aeGetLayersInputSchema = z.object({
  /** Composition id (Item.id). Omit to use app.project.activeItem. When
   *  omitted and no active comp exists, AENoActiveCompError is raised. */
  compId: z.number().optional(),
});
export type AeGetLayersInput = z.infer<typeof aeGetLayersInputSchema>;

export const aeLayerTypeSchema = z.enum([
  "AVLayer",
  "CameraLayer",
  "LightLayer",
  "ShapeLayer",
  "TextLayer",
  "Layer",
]);
export type AeLayerType = z.infer<typeof aeLayerTypeSchema>;

export const aeLayerEntrySchema = z.object({
  index: z.number(),
  name: z.string(),
  matchName: z.string(),
  type: aeLayerTypeSchema,
  enabled: z.boolean(),
  locked: z.boolean(),
  inPoint: z.number(),
  outPoint: z.number(),
});
export type AeLayerEntry = z.infer<typeof aeLayerEntrySchema>;

export const aeGetLayersOutputSchema = z.object({
  layers: z.array(aeLayerEntrySchema),
});
export type AeGetLayersOutput = z.infer<typeof aeGetLayersOutputSchema>;
