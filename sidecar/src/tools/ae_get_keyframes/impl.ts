// Phase 5.1.8 -- ae_get_keyframes ExtendScript impl (read-only, MVP 5/5).
//
// Phase 5.1.7 fix-2 reference (mistakes #18) -- propertyName is the display
// name in the current locale (e.g., "Position", "Scale"). layer.property()
// resolves by display name when called directly on a Layer.
//
// Resolution rules (mirror 5.1.7):
//   compId omitted    -> app.project.activeItem; null/non-Composition
//                        throws AENoActiveCompError sentinel.
//   compId provided   -> app.project.itemByID(id) try/catch; unknown id
//                        or non-Composition match throws AENotFoundError.
//   layerIndex check  -> 1 <= layerIndex <= comp.numLayers, else
//                        AENotFoundError.
//   property lookup   -> layer.property(propertyName) try/catch; unknown
//                        display name maps to AENotFoundError.
//
// Output mapping:
//   numKeys = 0  -> { keyframes: [] }
//   numKeys > 0  -> iterate 1..numKeys, call keyTime/keyValue/
//                   keyInInterpolationType/keyOutInterpolationType per
//                   index. Map int interpolation type to enum string.
//
// KeyframeInterpolationType int -> string mapping (types-for-adobe AE 22.0):
//   6612 -> "LINEAR"
//   6613 -> "BEZIER"
//   6614 -> "HOLD"
//   other -> "BEZIER" (AE default; unknown future enum values fall back).
// Self-contained constants used instead of the ambient global so unit
// tests don't need to mock the AE host's KeyframeInterpolationType enum.
//
// Mistakes #17: every method call (project.itemByID, comp.layer,
// layer.property, property.keyTime/Value/InInterp/OutInterp) is invoked
// directly on the receiver. Mock fixtures enforce this at unit-test layer.
//
// AST validator (D7) compliance: dot-notation only.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
  type JsxPropertyLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeGetKeyframesInput {
  layerIndex: number;
  propertyName: string;
  compId?: number;
}

export type AeKeyframeInterpolation = "LINEAR" | "BEZIER" | "HOLD";

export interface AeKeyframeEntry {
  index: number;
  time: number;
  value: unknown;
  interpolation: {
    in: AeKeyframeInterpolation;
    out: AeKeyframeInterpolation;
  };
}

export interface AeGetKeyframesOutput {
  keyframes: AeKeyframeEntry[];
}

// types-for-adobe AE 22.0 KeyframeInterpolationType enum values.
var INTERP_LINEAR = 6612;
var INTERP_BEZIER = 6613;
var INTERP_HOLD = 6614;

function mapInterp(raw: number): AeKeyframeInterpolation {
  if (raw === INTERP_LINEAR) return "LINEAR";
  if (raw === INTERP_HOLD) return "HOLD";
  // BEZIER (6613) is AE's default; unknown future enum values also fall
  // back here so the schema's z.enum stays clean.
  return "BEZIER";
}

export const ae_get_keyframes = defineJsxTool<AeGetKeyframesInput, AeGetKeyframesOutput>(
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
          "compId omitted and app.project.activeItem is null/non-Composition.",
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
            ").",
        );
      }
      if (!resolved || resolved.typeName !== "Composition") {
        throw h.fail(
          "AENotFoundError",
          "Composition not found: " + input.compId,
          "itemByID(" + input.compId + ") matched a non-Composition or null.",
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
        "layerIndex must be 1 <= idx <= comp.numLayers (" + numLayers + ").",
      );
    }

    // Direct call (mistakes #17).
    var layer: JsxLayerLike = comp.layer!(input.layerIndex);

    // ---- Look up property by display name --------------------------------
    var property: JsxPropertyLike | null = null;
    try {
      property = layer.property!(input.propertyName);
    } catch (lookupErr) {
      throw h.fail(
        "AENotFoundError",
        "Property '" + input.propertyName + "' not found on layer " + input.layerIndex,
        "layer.property('" + input.propertyName + "') threw (" +
          ((lookupErr && (lookupErr as { message?: string }).message) || String(lookupErr)) +
          ").",
      );
    }
    if (!property) {
      throw h.fail(
        "AENotFoundError",
        "Property '" + input.propertyName + "' not found on layer " + input.layerIndex,
        "layer.property('" + input.propertyName + "') returned null.",
      );
    }

    // ---- Iterate keyframes -----------------------------------------------
    // PropertyGroup invocation (e.g., user passes "Effects" by mistake)
    // returns a group with no numKeys field -- treat as 0 keyframes
    // rather than throw. Leaf Property always has numKeys (0 or more).
    var numKeys = (typeof property.numKeys === "number") ? property.numKeys : 0;
    var keyframes: AeKeyframeEntry[] = [];
    for (var i = 1; i <= numKeys; i++) {
      // Direct calls only -- mistakes #17.
      var t = property.keyTime!(i);
      var v = property.keyValue!(i);
      var inRaw = property.keyInInterpolationType!(i);
      var outRaw = property.keyOutInterpolationType!(i);
      keyframes.push({
        index: i,
        time: t,
        value: v,
        interpolation: {
          in: mapInterp(inRaw),
          out: mapInterp(outRaw),
        },
      });
    }

    return { keyframes: keyframes };
  },
);
