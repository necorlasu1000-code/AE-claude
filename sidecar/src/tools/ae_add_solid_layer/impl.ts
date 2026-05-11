// Phase 5.3.1 -- ae_add_solid_layer ExtendScript impl (write, layer lane
// 1/9 -- 5.3 lane first sub-step, D4 HOF reuse).
//
// Production call surface (types-for-adobe AE 22.0 line 1517):
//   comp.layers.addSolid(color, name, width, height, pixelAspect,
//                        duration?): AVLayer
//
// HOF wraps fn in app.beginUndoGroup("ae_add_solid_layer")/endUndoGroup
// via the opts-first defineJsxTool form. impl body has 0 boilerplate
// for undo wiring -- the 5.2.2 architecture DRY payoff.
//
// Resolution:
//   compId provided   -> app.project.itemByID(id) + typeName guard
//   compId omitted    -> app.project.activeItem; AENoActiveCompError when
//                        null or non-Composition.
//
// Defaults from target comp:
//   width        -> comp.width
//   height       -> comp.height
//   pixelAspect  -> 1.0 (square pixels, AE default)
//   duration     -> comp.duration
//
// Mistakes #17 -- comp.layers and layers.addSolid are both attached
// member accesses. Detached calls (var add = layers.addSolid; add(...))
// fail at the mock receiver guard.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeAddSolidLayerInput {
  name: string;
  color: [number, number, number];
  width?: number;
  height?: number;
  pixelAspect?: number;
  duration?: number;
  compId?: number;
}

export interface AeAddSolidLayerOutput {
  index: number;
  name: string;
  compId: number;
}

export const ae_add_solid_layer = defineJsxTool<AeAddSolidLayerInput, AeAddSolidLayerOutput>(
  { destructive: true, name: "ae_add_solid_layer" },
  function (input, ctx, h) {
    var project = ctx.app.project;

    // ---- Resolve target comp ---------------------------------------------
    var comp: JsxCompItem;
    if (input.compId !== undefined && input.compId !== null) {
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
    } else {
      var item = project.activeItem;
      if (!item || item.typeName !== "Composition") {
        throw h.fail(
          "AENoActiveCompError",
          "No active composition. Select a comp or pass compId.",
          "compId omitted and app.project.activeItem is null/non-Composition."
        );
      }
      comp = item as JsxCompItem;
    }

    // ---- Materialize defaults from comp ----------------------------------
    var width: number = typeof input.width === "number" ? input.width : comp.width;
    var height: number = typeof input.height === "number" ? input.height : comp.height;
    var pixelAspect: number = typeof input.pixelAspect === "number" ? input.pixelAspect : 1;
    var duration: number = typeof input.duration === "number" ? input.duration : comp.duration;

    // ---- Add solid layer -------------------------------------------------
    // Attached member access (mistakes #17). comp.layers is the LayerCollection
    // getter; .addSolid(...) is the production AE factory. Cast widens through
    // the optional method on JsxLayerCollectionLike (production AE always
    // populates; tests inject the same shape via makeMockLayerCollection).
    // Pattern mirrors 5.2.2 ae_create_comp's items.addComp cast.
    var layers = comp.layers;
    var layer: JsxLayerLike = (layers as { addSolid: NonNullable<NonNullable<typeof layers>["addSolid"]> }).addSolid(
      input.color,
      input.name,
      width,
      height,
      pixelAspect,
      duration,
    );

    return {
      index: layer.index,
      name: layer.name,
      compId: comp.id,
    };
  },
);
