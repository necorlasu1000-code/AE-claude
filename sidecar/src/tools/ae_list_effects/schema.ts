// Phase 5.1.6 -- zod schema for ae_list_effects (read-only, MVP 3/5 effect lane).
//
// Output shape: { items, total, hasMore, nextOffset } -- pagination gate
// (CLAUDE.md section 5) envelope. Each item exposes locale-stable
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
  // Pagination gate (CLAUDE.md §5) — a heavily-stacked layer can carry many
  // effects; cap the page so Claude's context stays bounded.
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type AeListEffectsInput = z.infer<typeof aeListEffectsInputSchema>;

export const aeEffectEntrySchema = z.object({
  matchName: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
});
export type AeEffectEntry = z.infer<typeof aeEffectEntrySchema>;

export const aeListEffectsOutputSchema = z.object({
  items: z.array(aeEffectEntrySchema),
  /** Total effects on the layer (before pagination). */
  total: z.number().int().nonnegative(),
  /** True when more effects exist past this page. */
  hasMore: z.boolean(),
  /** Offset to pass for the next page, or null when this is the last page. */
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type AeListEffectsOutput = z.infer<typeof aeListEffectsOutputSchema>;
