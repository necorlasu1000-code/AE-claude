// Phase 5.1.4 — zod schema for ae_list_comps (read-only, MVP 1/5).
//
// Output shape: { comps: AeCompEntry[] } — array wrapping under `comps` key
// per Phase 5.0 (D-N) lane convention (single object → top-level fields,
// collection → wrapper key). Each entry mirrors ae_get_active_comp's output
// (id/name/dimensions/durationSec/frameRate/numLayers) so claude can re-use
// the same comp shape across single-active and list flows without learning
// a second schema.

import { z } from "zod";

// Pagination gate (CLAUDE.md §5): every ae_list_* tool caps its output so a
// large project can't blow up Claude's context. limit max 200 / default 50,
// offset 0-based, output = { items, total, hasMore, nextOffset }.
export const aeListCompsInputSchema = z.object({
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type AeListCompsInput = z.infer<typeof aeListCompsInputSchema>;

export const aeCompEntrySchema = z.object({
  id: z.number(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  frameRate: z.number(),
  numLayers: z.number(),
});
export type AeCompEntry = z.infer<typeof aeCompEntrySchema>;

export const aeListCompsOutputSchema = z.object({
  items: z.array(aeCompEntrySchema),
  /** Total comps in the project (before pagination). */
  total: z.number().int().nonnegative(),
  /** True when more comps exist past this page. */
  hasMore: z.boolean(),
  /** Offset to pass for the next page, or null when this is the last page. */
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type AeListCompsOutput = z.infer<typeof aeListCompsOutputSchema>;
