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
//
// Phase 5.1.7 fix (mistakes #18) -- propertyName field is the display
// name in the current locale (e.g., "Position", "Scale"), NOT the
// internal matchName ("ADBE Position"). ExtendScript's layer.property()
// resolves by display name when called directly on a layer; matchName
// lookup requires walking down PropertyGroup hierarchies. The original
// schema described matchName because types-for-adobe TS types implied
// it, but production AE runtime behavior (verified via user dogfood)
// uses display name. claude's first-attempt accuracy depends on the
// description matching runtime behavior; see mistakes.md #18 for the
// schema-description vs runtime mismatch family.

import { z } from "zod";

export const aeGetExpressionInputSchema = z.object({
  /** 1-based layer index per AE convention. Required. */
  layerIndex: z.number().int().positive(),
  /** Property display name in the current locale (e.g., "Position",
   *  "Scale", "Rotation", "Anchor Point", "Opacity"). NOT the matchName
   *  -- ExtendScript's layer.property() does display-name lookup, not
   *  matchName lookup, when called directly on a Layer. Required. */
  propertyName: z.string().min(1),
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
