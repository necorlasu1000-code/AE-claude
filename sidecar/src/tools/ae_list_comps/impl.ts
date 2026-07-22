// Phase 5.1.4 -- ae_list_comps ExtendScript impl (read-only).
//
// Iterates app.project.item(1..numItems) (1-based per ExtendScript
// ItemCollection convention), filters CompItem via typeName check (NOT
// instanceof -- vitest mock env lacks AE class globals so instanceof
// CompItem ReferenceErrors; same constraint Phase 3.3 ae_get_active_comp
// codified). Empty project returns the empty page envelope with no error.
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

export interface AeListCompsInput {
  limit?: number;
  offset?: number;
}

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
  items: AeCompEntry[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export const ae_list_comps = defineJsxTool<AeListCompsInput, AeListCompsOutput>(
  function (input, ctx, _h) {
    // Pagination (gate section 5). Defaults normally applied by sidecar zod
    // schema, but re-apply here defensively (impl.test.ts calls this directly
    // with raw input, and a future non-validated caller must stay bounded).
    var limit = (input && typeof input.limit === "number" && input.limit > 0) ? input.limit : 50;
    if (limit > 200) limit = 200;
    var offset = (input && typeof input.offset === "number" && input.offset > 0) ? input.offset : 0;
    var windowEnd = offset + limit;

    var items: AeCompEntry[] = [];
    var project = ctx.app.project;
    var numItems = project.numItems || 0;
    var total = 0;

    for (var i = 1; i <= numItems; i++) {
      // Direct call (NOT var fn = project.item; fn(i)) -- see file header
      // mistakes #17. Type assertion via `!` because JsxProjectLike.item
      // is optional but production AE always populates it.
      var item = project.item!(i);
      if (item && item.typeName === "Composition") {
        // total counts ALL comps; only push the ones inside [offset, windowEnd)
        // so the returned payload is bounded regardless of project size.
        var matchIndex = total;
        total++;
        if (matchIndex >= offset && matchIndex < windowEnd) {
          var comp = item as JsxCompItem;
          items.push({
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
    }

    var nextIdx = offset + items.length;
    var hasMore = nextIdx < total;
    return {
      items: items,
      total: total,
      hasMore: hasMore,
      nextOffset: hasMore ? nextIdx : null,
    };
  }
);
