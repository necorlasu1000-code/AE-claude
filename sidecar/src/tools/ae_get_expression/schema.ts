// Phase 5.1.7 -- zod schema for ae_get_expression (read-only, MVP 4/5
// expression lane).
//
// Output shape: { expression: string, enabled: boolean }. Single property
// returned -- not collection -- so top-level fields (per Phase 5.0 D-N
// lane convention: collection -> wrapper key, single object -> top-level).
//
// `expression` is the raw source string (empty when no expression set);
// `enabled` mirrors Property.expressionEnabled (false when expression is
// stored but currently disabled via the eyeball UI).

import { z } from "zod";

export const aeGetExpressionInputSchema = z.object({
  /** 1-based layer index per AE convention. Required. */
  layerIndex: z.number().int().positive(),
  /** PropertyBase.matchName -- locale-stable internal id (e.g.,
   *  "ADBE Position", "ADBE Anchor Point", "ADBE Opacity"). Required. */
  propertyMatchName: z.string().min(1),
  /** Composition id (Item.id). Omit to use app.project.activeItem. When
   *  omitted and no active comp exists, AENoActiveCompError is raised. */
  compId: z.number().optional(),
});
export type AeGetExpressionInput = z.infer<typeof aeGetExpressionInputSchema>;

export const aeGetExpressionOutputSchema = z.object({
  expression: z.string(),
  enabled: z.boolean(),
});
export type AeGetExpressionOutput = z.infer<typeof aeGetExpressionOutputSchema>;
