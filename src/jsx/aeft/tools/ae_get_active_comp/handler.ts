// Phase 3.3 -- first ExtendScript bridge tool (read-only spike).
//
// Returns metadata about the currently active composition. Used by Phase 4
// MCP server as the first endpoint to verify the panel<->jsx round-trip
// works end-to-end before destructive tools land in Phase 5.
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no `system.callSystem`/`File`/`Folder`/`Socket`/`eval`/`Function`
// calls. Type discrimination via `typeName` (string compare) instead of
// `instanceof CompItem` -- instanceof works in real AE but ReferenceErrors
// in vitest (no AE class globals).

import { defineJsxTool, JsxCompItem } from "../_define";

export type AeGetActiveCompInput = Record<string, never>;

export interface AeGetActiveCompOutput {
  name: string;
  id: number;
  durationSec: number;
  frameRate: number;
  width: number;
  height: number;
  numLayers: number;
}

export const ae_get_active_comp = defineJsxTool<AeGetActiveCompInput, AeGetActiveCompOutput>(
  function (_input, ctx, h) {
    var item = ctx.app.project.activeItem;

    if (!item || item.typeName !== "Composition") {
      throw h.fail(
        "AENoActiveCompError",
        "No active composition. Select or create a comp in the AE project panel and try again.",
        "app.project.activeItem null or non-Composition (typeName='Folder'|'Footage'). Suggest comp selection/creation, then retry."
      );
    }

    var comp = item as JsxCompItem;
    return {
      name: comp.name,
      id: comp.id,
      durationSec: comp.duration,
      frameRate: comp.frameRate,
      width: comp.width,
      height: comp.height,
      numLayers: comp.numLayers,
    };
  }
);
