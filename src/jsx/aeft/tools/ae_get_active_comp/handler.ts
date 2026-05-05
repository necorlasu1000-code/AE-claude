// Phase 3.3 — first ExtendScript bridge tool (read-only spike).
//
// Returns metadata about the currently active composition. Used by Phase 4
// MCP server as the first endpoint to verify the panel↔jsx round-trip
// works end-to-end before destructive tools land in Phase 5.
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no `system.callSystem`/`File`/`Folder`/`Socket`/`eval`/`Function`
// calls. Type discrimination via `typeName` (string compare) instead of
// `instanceof CompItem` — instanceof works in real AE but ReferenceErrors
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
        "활성 컴프가 없습니다. AE 프로젝트 패널에서 컴프를 선택하거나 새 컴프를 생성한 뒤 다시 시도하세요.",
        "app.project.activeItem null 또는 비-Composition (typeName='Folder'|'Footage'). 사용자에게 컴프 선택/생성 제안 후 재시도."
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
