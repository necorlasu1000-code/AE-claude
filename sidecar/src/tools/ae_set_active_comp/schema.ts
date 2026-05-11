// Phase 5.2.3 -- zod schema for ae_set_active_comp (write, comp lane 3/3
// -- 5.2 comp lane completion).
//
// Resolution rules:
//   1. compId provided (takes precedence over compName) -> itemByID lookup
//   2. compName only -> iterate project items, first typeName==="Composition"
//      + name===compName match wins (production AE allows duplicate names;
//      first match in Project panel order is deterministic enough for
//      first-attempt accuracy).
//   3. Both undefined -> AEValidationError (refine), surfaced BEFORE impl
//      runs (sidecar HOF input validation gate). No silent default-to-first
//      because the intent is ambiguous and an implicit pick would hide
//      claude's mistake.
//
// destructive: false on the handler -- changing active composition is UI
// state in production AE, NOT undo-tracked. Wrapping in an undo group
// would inject an empty/no-op entry into Edit > Undo (user-visible noise:
// "ae_set_active_comp" appears but Ctrl+Z reverts nothing). Matches AE's
// native behavior.

import { z } from "zod";

// Note: the "either compId or compName must be provided" rule is enforced
// at the jsx impl layer (h.fail AEValidationError) rather than via a zod
// .refine(...) here. Reason: MCP server.ts wires inputSchema by reading
// .shape on the exported schema -- ZodEffects (the wrapper produced by
// .refine) doesn't expose .shape directly. Keeping the schema as a plain
// ZodObject preserves the existing 5.1.x registration convention. The
// extra hop (sidecar HOF accepts {}, jsx layer rejects with
// AEValidationError) is a one-time WS roundtrip cost on an obvious
// caller error -- acceptable for first-attempt accuracy.
export const aeSetActiveCompInputSchema = z.object({
  /** Numeric Item ID (CompItem.id). Unambiguous; takes precedence when
   *  both compId and compName are supplied. Stable across the session;
   *  obtain via ae_list_comps, ae_create_comp output, or ae_get_active_comp. */
  compId: z.number().int().positive().optional(),
  /** Display name (CompItem.name) as shown in the Project panel.
   *  Production AE allows duplicates -- first match in panel order wins.
   *  Use compId for unambiguous reference when known. */
  compName: z.string().min(1).optional(),
});
export type AeSetActiveCompInput = z.infer<typeof aeSetActiveCompInputSchema>;

export const aeSetActiveCompOutputSchema = z.object({
  /** Echo of the activated comp's id (resolved from compId or compName). */
  id: z.number().int().positive(),
  /** Echo of the activated comp's name. */
  name: z.string(),
});
export type AeSetActiveCompOutput = z.infer<typeof aeSetActiveCompOutputSchema>;
