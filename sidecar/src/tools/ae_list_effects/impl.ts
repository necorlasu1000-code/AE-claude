// Phase 5.1.6 -- ae_list_effects ExtendScript impl (read-only).
//
// Resolution rules:
//   compId omitted    -> app.project.activeItem; null/non-Composition
//                        throws AENoActiveCompError sentinel.
//   compId provided   -> app.project.itemByID(id) try/catch; unknown id
//                        or non-Composition match throws AENotFoundError.
//   layerIndex check  -> 1 <= layerIndex <= comp.numLayers, else
//                        AENotFoundError ("Layer not found: ${idx} in
//                        comp ${compId}"). Pre-validated to avoid
//                        comp.layer(i) production throw on out-of-range.
//
// Effect iteration:
//   layer.property("ADBE Effect Parade") -- production AE may throw on
//   Camera/Light/Null layers (no Effects host). try/catch returns
//   { effects: [] } in that case (semantically correct: zero effects).
//   Successful lookup yields a PropertyGroup; iterate via numProperties +
//   property(i) (1-based, mistakes #17 direct-call pattern).
//
// Each effect output entry:
//   matchName    -- PropertyBase.matchName (locale-stable, e.g.,
//                   "ADBE Gaussian Blur 2")
//   displayName  -- PropertyBase.name (user-renameable, locale-dependent)
//   enabled      -- PropertyBase.enabled (eyeball state)
//
// AST validator (D7) compliance: dot-notation only, no computed member
// access, no system.callSystem/File/Folder/Socket/eval/Function/include.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
  type JsxPropertyGroupLike,
  type JsxPropertyLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeListEffectsInput {
  layerIndex: number;
  compId?: number;
  limit?: number;
  offset?: number;
}

export interface AeEffectEntry {
  matchName: string;
  displayName: string;
  enabled: boolean;
}

export interface AeListEffectsOutput {
  items: AeEffectEntry[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

// Empty result with pagination meta -- shared by the "no effect host" and
// "no parade" early returns (Camera/Light/Null layers).
function emptyEffects(): AeListEffectsOutput {
  return { items: [], total: 0, hasMore: false, nextOffset: null };
}

export const ae_list_effects = defineJsxTool<AeListEffectsInput, AeListEffectsOutput>(
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

    // ---- Look up Effect Parade -------------------------------------------
    // Camera/Light/Null layers don't host effects -- production AE throws
    // on the property lookup. Treat as zero effects (semantically valid).
    var effectsParade: JsxPropertyGroupLike | null = null;
    try {
      // Direct call (NOT var fn = layer.property; fn(...)) -- mistakes #17.
      effectsParade = layer.property!("ADBE Effect Parade");
    } catch (paradeErr) {
      return emptyEffects();
    }
    if (!effectsParade) return emptyEffects();

    // ---- Pagination (gate section 5) -------------------------------------
    // Defaults normally applied by the sidecar zod schema; re-applied here
    // defensively (impl.test.ts calls this directly with raw input).
    var limit = (input && typeof input.limit === "number" && input.limit > 0) ? input.limit : 50;
    if (limit > 200) limit = 200;
    var offset = (input && typeof input.offset === "number" && input.offset > 0) ? input.offset : 0;
    var windowEnd = offset + limit;

    // ---- Iterate effects -------------------------------------------------
    var effects: AeEffectEntry[] = [];
    var total = 0;
    var n = effectsParade.numProperties || 0;

    for (var i = 1; i <= n; i++) {
      // Direct call (NOT var fn = effectsParade.property; fn(i)) -- mistakes #17.
      var eff: JsxPropertyLike = effectsParade.property!(i);
      if (!eff) continue;

      var matchIndex = total;
      total++;
      if (matchIndex >= offset && matchIndex < windowEnd) {
        effects.push({
          matchName: eff.matchName,
          displayName: eff.name,   // PropertyBase.name surfaces as displayName
          enabled: eff.enabled,
        });
      }
    }

    var nextIdx = offset + effects.length;
    var hasMore = nextIdx < total;
    return {
      items: effects,
      total: total,
      hasMore: hasMore,
      nextOffset: hasMore ? nextIdx : null,
    };
  }
);
