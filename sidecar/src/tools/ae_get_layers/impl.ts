// Phase 5.1.5 -- ae_get_layers ExtendScript impl (read-only).
//
// Resolution rules:
//   compId omitted    -> app.project.activeItem; if null or non-Composition
//                        throw AENoActiveCompError sentinel.
//   compId provided   -> app.project.itemByID(id) wrapped in try/catch;
//                        production AE throws when id is unknown. If the
//                        resolved item is not a Composition, also treat
//                        as not found (AENotFoundError).
//
// Iteration: comp.numLayers + comp.layer(i) (1-based, ItemCollection-style).
// Mistakes #17: comp.layer(i) called directly -- NEVER var fn = comp.layer;
// fn(i). Mock receiver guard catches detached calls at unit-test layer.
//
// Type discrimination: layer.toString() returns "[object CameraLayer]" etc.
// in production AE; mock fixtures override toString to match the same
// shape. Regex extracts the bracketed class name; falls back to "Layer"
// when the string doesn't match (defensive -- production AE always conforms).
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no system.callSystem/File/Folder/Socket/eval/Function/include.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeGetLayersInput {
  compId?: number;
}

export type AeLayerType =
  | "AVLayer"
  | "CameraLayer"
  | "LightLayer"
  | "ShapeLayer"
  | "TextLayer"
  | "Layer";

export interface AeLayerEntry {
  index: number;
  name: string;
  matchName: string;
  type: AeLayerType;
  enabled: boolean;
  locked: boolean;
  inPoint: number;
  outPoint: number;
}

export interface AeGetLayersOutput {
  layers: AeLayerEntry[];
}

// Known Layer subclass names per types-for-adobe AE 22.0. Returned from
// the toString reflection; anything outside this set falls back to "Layer".
function classifyLayerType(s: string): AeLayerType {
  // Match "[object SomeClass]" and capture SomeClass.
  var m = /\[object (\w+)\]/.exec(s);
  if (!m) return "Layer";
  var name = m[1];
  if (name === "AVLayer") return "AVLayer";
  if (name === "CameraLayer") return "CameraLayer";
  if (name === "LightLayer") return "LightLayer";
  if (name === "ShapeLayer") return "ShapeLayer";
  if (name === "TextLayer") return "TextLayer";
  return "Layer";
}

export const ae_get_layers = defineJsxTool<AeGetLayersInput, AeGetLayersOutput>(
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
        // itemByID is optional in JsxProjectLike; ! asserts production AE
        // populates it. Babel strips assertions; ES3 output is plain JS.
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
    }

    // ---- Iterate layers --------------------------------------------------
    var layers: AeLayerEntry[] = [];
    var numLayers = comp.numLayers || 0;

    for (var i = 1; i <= numLayers; i++) {
      // Direct call (NOT var fn = comp.layer; fn(i)) -- mistakes #17.
      // ! asserts production AE populates the optional method.
      var layer: JsxLayerLike = comp.layer!(i);
      if (!layer) continue;

      layers.push({
        index: layer.index,
        name: layer.name,
        matchName: layer.matchName,
        type: classifyLayerType(layer.toString()),
        enabled: layer.enabled,
        locked: layer.locked,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
      });
    }

    return { layers: layers };
  }
);
