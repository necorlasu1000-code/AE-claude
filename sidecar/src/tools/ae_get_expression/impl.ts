// Phase 5.1.7 -- ae_get_expression ExtendScript impl (read-only).
//
// Resolution rules:
//   compId omitted    -> app.project.activeItem; null/non-Composition
//                        throws AENoActiveCompError sentinel.
//   compId provided   -> app.project.itemByID(id) try/catch; unknown id
//                        or non-Composition match throws AENotFoundError.
//   layerIndex check  -> 1 <= layerIndex <= comp.numLayers, else
//                        AENotFoundError. Pre-validated so comp.layer(i)
//                        production throw on out-of-range never fires.
//   property lookup   -> layer.property(propertyMatchName) try/catch;
//                        production AE throws or returns null on unknown
//                        matchName. Both branches map to AENotFoundError.
//
// Output mapping:
//   expression          := property.expression ("" when no expression set)
//   enabled             := property.expressionEnabled (false when stored
//                          but disabled via eyeball)
//
// Mistakes #17: every method call (project.itemByID, comp.layer,
// layer.property) is invoked directly on the receiver. Mock fixtures
// enforce this at unit-test layer.
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no system.callSystem/File/Folder/Socket/eval/Function/include.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
  type JsxPropertyLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeGetExpressionInput {
  layerIndex: number;
  propertyMatchName: string;
  compId?: number;
}

export interface AeGetExpressionOutput {
  expression: string;
  enabled: boolean;
}

export const ae_get_expression = defineJsxTool<AeGetExpressionInput, AeGetExpressionOutput>(
  function (input, ctx, h) {
    var project = ctx.app.project;

    // ---- Resolve target comp ---------------------------------------------
    var comp: JsxCompItem;
    if (input.compId === undefined || input.compId === null) {
      var item = project.activeItem;
      if (!item || item.typeName !== "Composition") {
        throw h.fail(
          "AENoActiveCompError",
          "No active composition. Select a comp or pass compId.",
          "compId omitted and app.project.activeItem is null/non-Composition."
        );
      }
      comp = item as JsxCompItem;
    } else {
      var resolved: JsxItemLike | null = null;
      try {
        resolved = project.itemByID!(input.compId);
      } catch (lookupErr) {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compId,
          "app.project.itemByID(" + input.compId + ") threw (" +
            ((lookupErr && (lookupErr as { message?: string }).message) || String(lookupErr)) +
            ")."
        );
      }
      if (!resolved || resolved.typeName !== "Composition") {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compId,
          "itemByID(" + input.compId + ") matched a non-Composition or null."
        );
      }
      comp = resolved as JsxCompItem;
    }

    // ---- layerIndex bounds check (pre-validate) --------------------------
    var numLayers = comp.numLayers || 0;
    if (input.layerIndex < 1 || input.layerIndex > numLayers) {
      throw h.fail(
        "AENotFoundError",
        "Layer not found: " + input.layerIndex + " in comp " +
          (input.compId !== undefined ? input.compId : "active"),
        "layerIndex must be 1 <= idx <= comp.numLayers (" + numLayers + ")."
      );
    }

    // Direct call (NOT var fn = comp.layer; fn(i)) -- mistakes #17.
    var layer: JsxLayerLike = comp.layer!(input.layerIndex);

    // ---- Look up property by matchName -----------------------------------
    var property: JsxPropertyLike | null = null;
    try {
      // Direct call (NOT var fn = layer.property; fn(...)) -- mistakes #17.
      property = layer.property!(input.propertyMatchName);
    } catch (lookupErr) {
      throw h.fail(
        "AENotFoundError",
        "Property '" + input.propertyMatchName + "' not found on layer " + input.layerIndex,
        "layer.property('" + input.propertyMatchName + "') threw (" +
          ((lookupErr && (lookupErr as { message?: string }).message) || String(lookupErr)) +
          ")."
      );
    }
    if (!property) {
      throw h.fail(
        "AENotFoundError",
        "Property '" + input.propertyMatchName + "' not found on layer " + input.layerIndex,
        "layer.property('" + input.propertyMatchName + "') returned null."
      );
    }

    // ---- Map output ------------------------------------------------------
    // expression / expressionEnabled are JsxPropertyLike optionals; in
    // production AE they are always populated on leaf Property objects but
    // missing on PropertyGroup. Defensive defaults preserve a valid output
    // shape even if the user passes a PropertyGroup matchName by mistake.
    var expression = typeof property.expression === "string" ? property.expression : "";
    var enabled = property.expressionEnabled === true;

    return { expression: expression, enabled: enabled };
  }
);
