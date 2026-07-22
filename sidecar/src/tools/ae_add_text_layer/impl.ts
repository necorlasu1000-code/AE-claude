// Phase 5.3.2 -- ae_add_text_layer ExtendScript impl (write, layer lane 2/9).
//
// Production call surface:
//   comp.layers.addText(sourceText?): TextLayer   (factory)
//   textLayer.property("Source Text")             (TextDocument leaf Property)
//     .value -> TextDocument; mutate font / fontSize / fillColor / applyFill;
//     .setValue(doc)                              (write back -- REQUIRED;
//                                                  field writes on the read
//                                                  doc alone do nothing)
//   textLayer.property("Position").setValue([x, y])
//
// The TextDocument round-trip only runs when at least one style field
// (font / fontSize / fillColor) is present; position likewise. A text-only
// call is exactly one addText.
//
// HOF wraps the WHOLE body in app.beginUndoGroup("ae_add_text_layer")/
// endUndoGroup -- factory + styling revert together on one Ctrl+Z.
//
// Mistakes #17 -- every call is an attached member access
// (comp.layers.addText / layer.property / prop.setValue). Mock fixtures
// enforce receiver identity.

import {
  defineJsxTool,
  type JsxCompItem,
  type JsxItemLike,
  type JsxLayerLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeAddTextLayerInput {
  text: string;
  font?: string;
  fontSize?: number;
  fillColor?: [number, number, number];
  position?: [number, number];
  compId?: number;
}

export interface AeAddTextLayerOutput {
  index: number;
  name: string;
  compId: number;
}

// TextDocument fields this tool touches. Production AE's TextDocument has
// many more; we duck-type only the mutation surface.
interface JsxTextDocumentLike {
  font?: string;
  fontSize?: number;
  fillColor?: [number, number, number];
  applyFill?: boolean;
}

export const ae_add_text_layer = defineJsxTool<AeAddTextLayerInput, AeAddTextLayerOutput>(
  { destructive: true, name: "ae_add_text_layer" },
  function (input, ctx, h) {
    var project = ctx.app.project;

    // ---- Resolve target comp (5.3.1 pattern) -----------------------------
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

    // ---- Add text layer --------------------------------------------------
    // Attached member access (mistakes #17). Cast widens through the
    // optional method (production AE always populates; tests inject via
    // makeMockLayerCollection) -- mirrors 5.3.1 addSolid cast.
    var layers = comp.layers;
    var layer: JsxLayerLike = (layers as { addText: NonNullable<NonNullable<typeof layers>["addText"]> }).addText(
      input.text,
    );

    // ---- Style pass (TextDocument round-trip, only when needed) ----------
    var wantsStyle =
      input.font !== undefined ||
      input.fontSize !== undefined ||
      input.fillColor !== undefined;
    if (wantsStyle) {
      var sourceText = layer.property!("Source Text");
      // Read-mutate-write: production AE only applies TextDocument changes
      // via setValue; mutating the read doc alone is a no-op.
      var doc = (sourceText.value || {}) as JsxTextDocumentLike;
      if (input.font !== undefined) doc.font = input.font;
      if (input.fontSize !== undefined) doc.fontSize = input.fontSize;
      if (input.fillColor !== undefined) {
        // Without applyFill=true a fill-less character style silently
        // ignores fillColor.
        doc.applyFill = true;
        doc.fillColor = input.fillColor;
      }
      sourceText.setValue!(doc);
    }

    // ---- Position pass ---------------------------------------------------
    if (input.position !== undefined) {
      var positionProp = layer.property!("Position");
      positionProp.setValue!(input.position);
    }

    return {
      index: layer.index,
      name: layer.name,
      compId: comp.id,
    };
  },
);
