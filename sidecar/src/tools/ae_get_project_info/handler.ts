// Phase 5.2.1 -- sidecar dispatcher adapter for ae_get_project_info (read-only).
//
// Thinnest handler in the registry: no active-comp / not-found error
// conversion needed because Project is global state (always exists for
// any AE host with a project loaded -- even an unsaved untitled project
// is a valid Project with file = null). impl.ts has no AEError throw
// paths in normal operation; the dispatcher catch is purely a safety
// net for unexpected ExtendScript errors (caught generically by the
// HOF chain and surfaced as AEScriptError).

import { defineAETool, type ToolCtx } from "../_define.js";
import {
  aeGetProjectInfoInputSchema,
  aeGetProjectInfoOutputSchema,
  type AeGetProjectInfoInput,
  type AeGetProjectInfoOutput,
} from "./schema.js";

export const ae_get_project_info = defineAETool<AeGetProjectInfoInput, AeGetProjectInfoOutput>({
  name: "ae_get_project_info",
  description:
    "Get After Effects project metadata. No active-comp dependency -- " +
    "works on any project state including empty/unsaved. " +
    "Returns: file ({ path, name } or null when project is unsaved), " +
    "numItems (total items in Project panel), " +
    "bitsPerChannel (color depth: 8 / 16 / 32), " +
    "expressionEngine ('extendscript' for legacy or 'javascript-1.0' for modern -- " +
    "claude expression-writing tools must match this engine), " +
    "displayStartFrame (frame numbering display start), " +
    "and hostVersion (AE host application version, e.g. '22.6.0' -- " +
    "useful for compatibility checks before further tool calls). " +
    "Input: no parameters (empty object).",
  input: aeGetProjectInfoInputSchema,
  output: aeGetProjectInfoOutputSchema,
  handler: async (input: AeGetProjectInfoInput, ctx: ToolCtx): Promise<AeGetProjectInfoOutput> => {
    return await ctx.panelExec<AeGetProjectInfoOutput>("ae_get_project_info", input);
  },
});
