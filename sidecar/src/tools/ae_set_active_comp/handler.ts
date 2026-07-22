// Phase 5.2.3 -- sidecar dispatcher adapter for ae_set_active_comp
// (write, comp lane 3/3 -- 5.2 comp lane completion).
//
// destructive: false (NOT a D4 candidate). Changing the active comp is
// UI state -- production AE does not register an undo step for it. Adding
// destructive: true would inject an empty "ae_set_active_comp" entry into
// Edit > Undo (Ctrl+Z would revert nothing visible, confusing the user).
// dogfood verification item: confirm AE Edit > Undo menu is NOT mutated
// by this tool.
//
// Resolution rules live in impl.ts (jsx side):
//   compId provided -> app.project.itemByID(id) + typeName guard
//   compName only   -> iterate project.item(i), typeName==="Composition" +
//                      name===compName, first match wins
//   both undefined  -> schema refine rejects upstream (AEValidationError)
//
// AENotFoundError throw path: itemByID throws for unknown id, OR the
// resolved item is not a Composition, OR no name match across all items.

import { defineAETool, type ToolCtx } from "../_define.js";
import {
  aeSetActiveCompInputSchema,
  aeSetActiveCompOutputSchema,
  type AeSetActiveCompInput,
  type AeSetActiveCompOutput,
} from "./schema.js";

export const ae_set_active_comp = defineAETool<AeSetActiveCompInput, AeSetActiveCompOutput>({
  name: "ae_set_active_comp",
  // destructive: false -- viewer state is not undo-tracked in production AE.
  description:
    "Set the active composition by opening it in the After Effects " +
    "viewer panel. Either compId (numeric Item ID, unambiguous, takes " +
    "precedence) or compName (display name, first matching Composition " +
    "wins) must be provided -- supply at least one. Use compId when " +
    "known (e.g., from ae_list_comps or ae_create_comp output) -- " +
    "compName is ambiguous if duplicates exist. Returns the activated " +
    "composition's id and name. NOT destructive: production AE does " +
    "not register changing the active comp in the undo stack, so this " +
    "tool also leaves Edit > Undo untouched. " +
    "Throws AENotFoundError when compId is unknown, when compId " +
    "resolves to a non-Composition item (Folder/Footage), or when " +
    "no Composition matches compName.",
  input: aeSetActiveCompInputSchema,
  output: aeSetActiveCompOutputSchema,
  handler: async (input: AeSetActiveCompInput, ctx: ToolCtx): Promise<AeSetActiveCompOutput> => {
    return await ctx.panelExec<AeSetActiveCompOutput>("ae_set_active_comp", input);
  },
});
