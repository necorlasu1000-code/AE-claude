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
//
// Phase 5.1.4 fix (mistakes #17) -- call project.item(i) directly. Detaching
// the method into a local variable (var fn = project.item; fn(i)) loses
// the `this` binding to project; ExtendScript SpiderMonkey enforces this
// strictly and throws "Function global.item() cannot work with this class".
// vitest mock under sloppy/strict JS does NOT enforce method-receiver
// identity, so the bug rode through unit tests until the user dogfood
// caught it. _mockApp.ts now also enforces the receiver check so future
// detach-then-call mistakes fail at the unit-test layer.

import { defineJsxTool, JsxCompItem } from "../../../../src/jsx/aeft/tools/_define";

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

    for (var i = 1; i <= numItems; i++) {
      // Direct call (NOT var fn = project.item; fn(i)) -- see file header
      // mistakes #17. Type assertion via `!` because JsxProjectLike.item
      // is optional but production AE always populates it.
      var item = project.item!(i);
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
