// Phase 5.1.6 -- zod schema for ae_list_effects (read-only, MVP 3/5 effect lane).
//
// Output shape: { effects: AeEffectEntry[] } -- collection wrapper key
// per Phase 5.0 (D-N) lane convention. Each entry exposes locale-stable
// matchName (e.g., "ADBE Gaussian Blur 2") + locale-dependent displayName
// (PropertyBase.name; user-renameable) + enabled flag.
//
// matchName is the stable id claude should use for cross-locale references
// (effect lookup, expression generation, etc.); displayName is what the
// user sees in the AE Effect Controls panel.

import { z } from "zod";

export const aeListEffectsInputSchema = z.object({
  /** 1-based layer index per AE convention. Required. */
  layerIndex: z.number().int().positive(),
  /** Composition id (Item.id). Omit to use app.project.activeItem. When
   *  omitted and no active comp exists, AENoActiveCompError is raised. */
  compId: z.number().optional(),
});
export type AeListEffectsInput = z.infer<typeof aeListEffectsInputSchema>;

export const aeEffectEntrySchema = z.object({
  matchName: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
});
export type AeEffectEntry = z.infer<typeof aeEffectEntrySchema>;

export const aeListEffectsOutputSchema = z.object({
  effects: z.array(aeEffectEntrySchema),
});
export type AeListEffectsOutput = z.infer<typeof aeListEffectsOutputSchema>;
