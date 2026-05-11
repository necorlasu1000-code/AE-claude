// Phase 5.2.2 -- sidecar dispatcher adapter for ae_create_comp (write,
// comp lane 2/3 -- D4 destructive flag + undoGroup wiring first reference).
//
// destructive: true is the new flag introduced in 5.2.2. It is consumed
// by the panel-side defineJsxTool HOF (src/jsx/aeft/tools/_define.ts);
// the sidecar HOF currently leaves the begin/end undoGroup pair to jsx
// layer (D-K spirit -- sidecar main parses no AE-side semantics, just
// relays envelopes). Setting destructive: true here is documentation
// for human reviewers + future tooling (e.g., audit-mode that lists
// every destructive tool in the registry).
//
// AENoActiveCompError is NOT a possible throw -- ae_create_comp does
// not depend on an active composition (it creates one fresh). The only
// throw path is ItemCollection.addComp itself failing (production AE
// can throw on invalid dimensions, OOM, or write-locked project), and
// the HOF wrapping path converts that to AEScriptError automatically.

import { defineAETool, type ToolCtx } from "../_define.js";
import {
  aeCreateCompInputSchema,
  aeCreateCompOutputSchema,
  type AeCreateCompInput,
  type AeCreateCompOutput,
} from "./schema.js";

export const ae_create_comp = defineAETool<AeCreateCompInput, AeCreateCompOutput>({
  name: "ae_create_comp",
  destructive: true,
  description:
    "Create a new composition in the After Effects project. Wraps in an " +
    "undo group named 'ae_create_comp' so a single Ctrl+Z reverts the " +
    "creation. Returns the new CompItem's id (use it as compId in " +
    "subsequent layer/effect calls).",
  input: aeCreateCompInputSchema,
  output: aeCreateCompOutputSchema,
  handler: async (input: AeCreateCompInput, ctx: ToolCtx): Promise<AeCreateCompOutput> => {
    return await ctx.panelExec<AeCreateCompOutput>("ae_create_comp", input);
  },
});
