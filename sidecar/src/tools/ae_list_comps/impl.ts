// Phase 5.1.4 -- ae_list_comps ExtendScript impl (read-only).
//
// Iterates app.project.item(1..numItems) (1-based per ExtendScript
// ItemCollection convention), filters CompItem via typeName check (NOT
// instanceof -- vitest mock env lacks AE class globals so instanceof
// CompItem ReferenceErrors; same constraint Phase 3.3 ae_get_active_comp
// codified). Empty project returns { comps: [] } with no error.
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no system.callSystem/File/Folder/Socket/eval/Function/include.
// Type assertion `project.item as` strips at babel preset-typescript
// transform (ES3 output is plain JS), used only because JsxProjectLike's
// item is optional in the type but always populated in production AE.

import { defineJsxTool, JsxCompItem, JsxItemLike } from "../../../../src/jsx/aeft/tools/_define";

export type AeListCompsInput = Record<string, never>;

export interface AeCompEntry {
  id: number;
  name: string;
  width: number;
  height: number;
  durationSec: number;
  frameRate: number;
  numLayers: number;
}

export interface AeListCompsOutput {
  comps: AeCompEntry[];
}

export const ae_list_comps = defineJsxTool<AeListCompsInput, AeListCompsOutput>(
  function (_input, ctx, _h) {
    var comps: AeCompEntry[] = [];
    var project = ctx.app.project;
    var numItems = project.numItems || 0;
    var itemFn = project.item as (index: number) => JsxItemLike;

    for (var i = 1; i <= numItems; i++) {
      var item = itemFn(i);
      if (item && item.typeName === "Composition") {
        var comp = item as JsxCompItem;
        comps.push({
          id: comp.id,
          name: comp.name,
          width: comp.width,
          height: comp.height,
          durationSec: comp.duration,
          frameRate: comp.frameRate,
          numLayers: comp.numLayers,
        });
      }
    }

    return { comps: comps };
  }
);
