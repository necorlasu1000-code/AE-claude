// Phase 5.2.2 -- ae_create_comp ExtendScript impl (write, comp lane 2/3,
// D4 destructive flag + undoGroup wiring first reference).
//
// The defineJsxTool HOF (opts-first form, new in 5.2.2) wraps fn in
// app.beginUndoGroup("ae_create_comp")/endUndoGroup via try/finally.
// This impl never calls begin/endUndoGroup directly -- CLAUDE.md gate
// #2 forbids it (wrapper handles undo group). All 24 future destructive
// tools (5.2.3~5.7) inherit the same pattern; one opts arg, fn body
// stays linear.
//
// Production call surface (types-for-adobe AE 22.0 line 1367):
//   app.project.items.addComp(name, width, height, pixelAspect, duration,
//                             frameRate): CompItem
//
// Mistakes #17 -- items.addComp must be called as a direct member access.
// Detached calls (var fn = items.addComp; fn(...)) lose receiver and
// ExtendScript SpiderMonkey throws. We assign `items` to a local var but
// the .addComp(...) call site stays attached.
//
// bgColor handling: comp.bgColor = [r,g,b] (writable property per
// CompItem class in types-for-adobe AE 22.0 line 1133, type
// ThreeDColorValue per line 1899). Only set when input provides it;
// AE applies the project default (typically black) otherwise.
//
// pixelAspect handling: addComp signature requires the pixelAspect arg
// (no default in the production API). Use input.pixelAspect ?? 1 so
// the schema's optional field is materialized before the addComp call.

import {
  defineJsxTool,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeCreateCompInput {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  bgColor?: [number, number, number];
  pixelAspect?: number;
}

export interface AeCreateCompOutput {
  id: number;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
}

export const ae_create_comp = defineJsxTool<AeCreateCompInput, AeCreateCompOutput>(
  { destructive: true, name: "ae_create_comp" },
  function (input, ctx, _h) {
    // Materialize pixelAspect default before addComp -- the production
    // signature has no default; passing undefined would throw.
    var pixelAspect: number = typeof input.pixelAspect === "number" ? input.pixelAspect : 1;

    // Attached call (mistakes #17). The local `items` var is fine because
    // we still write `items.addComp(...)` -- the receiver is `items`, not
    // a detached function reference.
    var items = ctx.app.project.items;
    var comp = (items as { addComp: NonNullable<typeof items.addComp> }).addComp(
      input.name,
      input.width,
      input.height,
      pixelAspect,
      input.duration,
      input.frameRate,
    );

    // bgColor: write after creation. ThreeDColorValue per types-for-adobe.
    if (input.bgColor) {
      comp.bgColor = input.bgColor;
    }

    return {
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
    };
  },
);
