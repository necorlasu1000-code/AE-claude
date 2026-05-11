// Phase 5.2.3 -- ae_set_active_comp ExtendScript impl (write, comp lane
// 3/3 -- 5.2 comp lane completion).
//
// Production call surface:
//   app.project.itemByID(id): _ItemClasses                 (line 1789)
//   app.project.item(i): _ItemClasses                      (1-based)
//   app.project.numItems: number
//   CompItem.openInViewer(): Viewer | null                 (line 1174)
//
// Project.activeItem is readonly in types-for-adobe AE 22.0 (line 1723),
// so openInViewer() is the only sanctioned path to set active. The
// returned Viewer object is ignored -- viewer.setActive() is unnecessary
// for the "make this comp active" intent (openInViewer alone does that).
//
// HOF wrapping: defineJsxTool(fn) -- NO opts (read-only-equivalent for
// undo tracking). This impl is "write" semantically (mutates UI state)
// but NOT undo-tracked, so it uses the legacy fn-only form. Handler
// also sets destructive: false. See handler.ts comment for rationale.
//
// Resolution priority:
//   1. compId provided      -> itemByID lookup, try/catch for unknown id
//   2. compName only        -> iterate project.item(i), name + typeName
//                              match; first hit wins
//   3. Both undefined       -> schema refine upstream rejects before this
//                              fn runs (AEValidationError); defensive
//                              h.fail still here in case schema is bypassed.
//
// Mistakes #17 -- attached method calls only. project.itemByID(...) and
// project.item(...) and comp.openInViewer() all read the receiver via the
// dot. Mock fixtures enforce receiver identity at the unit-test layer.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeSetActiveCompInput {
  compId?: number;
  compName?: string;
}

export interface AeSetActiveCompOutput {
  id: number;
  name: string;
}

export const ae_set_active_comp = defineJsxTool<AeSetActiveCompInput, AeSetActiveCompOutput>(
  function (input, ctx, h) {
    var project = ctx.app.project;

    var comp: JsxCompItem | null = null;

    // ---- Resolve target comp ---------------------------------------------
    if (input.compId !== undefined && input.compId !== null) {
      // Path 1: compId takes precedence. itemByID throws for unknown id.
      var resolved: JsxItemLike | null = null;
      try {
        resolved = project.itemByID!(input.compId);
      } catch (lookupErr) {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compId,
          "app.project.itemByID(" + input.compId + ") threw (" +
            ((lookupErr && (lookupErr as { message?: string }).message) || String(lookupErr)) +
            "). Verify the compId exists."
        );
      }
      if (!resolved || resolved.typeName !== "Composition") {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compId,
          "app.project.itemByID(" + input.compId + ") returned a non-Composition item or null."
        );
      }
      comp = resolved as JsxCompItem;
    } else if (typeof input.compName === "string" && input.compName.length > 0) {
      // Path 2: compName scan. Iterate Project items 1-based; first match
      // by typeName + name wins. Production AE allows duplicate comp names;
      // panel-order first hit is deterministic for first-attempt accuracy.
      var numItems = typeof project.numItems === "number" ? project.numItems : 0;
      for (var i = 1; i <= numItems; i++) {
        var candidate: JsxItemLike = project.item!(i);
        if (
          candidate &&
          candidate.typeName === "Composition" &&
          candidate.name === input.compName
        ) {
          comp = candidate as JsxCompItem;
          break;
        }
      }
      if (!comp) {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compName,
          "No item with typeName='Composition' + name='" + input.compName +
            "' found by scanning app.project.item(1..numItems). Use compId for unambiguous reference."
        );
      }
    } else {
      // Defensive: schema refine should catch this, but if a future code
      // path bypasses validation, surface a clear error rather than panic.
      throw h.fail(
        "AEValidationError",
        "Either compId or compName must be provided.",
        "Both fields undefined; schema refine should have rejected upstream."
      );
    }

    // ---- Open in viewer (set active) -------------------------------------
    // Production AE: openInViewer makes Project.activeItem = comp + brings
    // the Composition panel forward. Return value (Viewer | null) is
    // ignored -- callers only need the activation side effect.
    comp.openInViewer!();

    return {
      id: comp.id,
      name: comp.name,
    };
  }
);
