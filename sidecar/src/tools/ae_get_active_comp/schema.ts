// Phase 5.1.1 (D-M, option A) -- zod schema for ae_get_active_comp.
//
// Lock-in: Phase 3.3 output format (top-level fields, durationSec name,
// numLayers included). Phase 4 dogfood (e/f) verified this format
// end-to-end via natural-language "current comp" -> MCP -> panel jsx
// -> AE -> result envelope -> claude response.
//
// Currently dormant: mcp/server.ts (Phase 4) registers the tool inline
// without schema validation (no input fields, output trusted). Phase 5.1.2
// architecture refactor will introduce sidecar handler.ts (defineAETool
// wrapper) that imports these schemas + AENoActiveCompError class +
// ctx.panelExec wiring.

import { z } from "zod";

export const aeGetActiveCompInputSchema = z.object({});
export type AeGetActiveCompInput = z.infer<typeof aeGetActiveCompInputSchema>;

export const aeGetActiveCompOutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  frameRate: z.number(),
  numLayers: z.number(),
});
export type AeGetActiveCompOutput = z.infer<typeof aeGetActiveCompOutputSchema>;
