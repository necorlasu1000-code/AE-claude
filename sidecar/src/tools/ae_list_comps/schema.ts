// Phase 5.1.4 — zod schema for ae_list_comps (read-only, MVP 1/5).
//
// Output shape: { comps: AeCompEntry[] } — array wrapping under `comps` key
// per Phase 5.0 (D-N) lane convention (single object → top-level fields,
// collection → wrapper key). Each entry mirrors ae_get_active_comp's output
// (id/name/dimensions/durationSec/frameRate/numLayers) so claude can re-use
// the same comp shape across single-active and list flows without learning
// a second schema.

import { z } from "zod";

export const aeListCompsInputSchema = z.object({});
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
  comps: z.array(aeCompEntrySchema),
});
export type AeListCompsOutput = z.infer<typeof aeListCompsOutputSchema>;
