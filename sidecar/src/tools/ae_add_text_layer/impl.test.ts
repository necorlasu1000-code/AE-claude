// Phase 5.3.2 -- unit tests for ae_add_text_layer impl (write, layer
// lane 2/9 -- D4 HOF reuse + first TextDocument round-trip).
//
// Coverage:
//   1.  Happy path (text only): addText called with text, NO style/position
//       writes (setValue untouched), output shape {index, name, compId}.
//   2.  font/fontSize/fillColor -> ONE Source Text setValue with the mutated
//       TextDocument (fillColor also flips applyFill=true).
//   3.  Partial style (fontSize only) -> other doc fields keep mock defaults.
//   4.  position -> Position.setValue([x, y]).
//   5.  compId provided -> itemByID resolution, no active-comp dependency.
//   6.  compId omitted + no active comp -> AENoActiveCompError.
//   7.  compId unknown -> AENotFoundError.
//   8.  compId resolves to non-Composition -> AENotFoundError.
//   9.  D4 wiring: begin/endUndoGroup around the WHOLE body (styling inside).
//   10. D4 wiring on throw: addText throws -> endUndoGroup STILL called.

import { describe, it, expect, vi } from "vitest";
import { ae_add_text_layer } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockLayerCollection,
  makeMockNonCompItem,
} from "../../../../src/jsx/aeft/tools/_mockApp";

function makeCtx(collectionOpts: Parameters<typeof makeMockLayerCollection>[0], compId = 11) {
  const layersCollection = makeMockLayerCollection(collectionOpts);
  const comp = makeMockComp({ id: compId, name: "Hero", layersCollection });
  return {
    comp,
    ctx: {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    },
  };
}

describe("ae_add_text_layer", () => {
  it("text only: addText called, no style/position writes, output shape", () => {
    const onAddText = vi.fn();
    const onSetTextDocument = vi.fn();
    const onSetPosition = vi.fn();
    const { ctx } = makeCtx({ onAddText, onSetTextDocument, onSetPosition });

    const parsed = JSON.parse(
      ae_add_text_layer(JSON.stringify({ text: "Hello AE" }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ index: 1, name: "Hello AE", compId: 11 });
    expect(onAddText).toHaveBeenCalledTimes(1);
    expect(onAddText).toHaveBeenCalledWith("Hello AE");
    // Text-only call must not touch the TextDocument or Position.
    expect(onSetTextDocument).not.toHaveBeenCalled();
    expect(onSetPosition).not.toHaveBeenCalled();
  });

  it("font/fontSize/fillColor -> one Source Text setValue with mutated TextDocument", () => {
    const onSetTextDocument = vi.fn();
    const { ctx } = makeCtx({ onSetTextDocument });

    const parsed = JSON.parse(
      ae_add_text_layer(
        JSON.stringify({
          text: "Styled",
          font: "Arial-BoldMT",
          fontSize: 72,
          fillColor: [1, 0, 0],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(onSetTextDocument).toHaveBeenCalledTimes(1);
    const doc = onSetTextDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.font).toBe("Arial-BoldMT");
    expect(doc.fontSize).toBe(72);
    expect(doc.fillColor).toEqual([1, 0, 0]);
    // fillColor write must also enable fill, or AE silently ignores it.
    expect(doc.applyFill).toBe(true);
  });

  it("partial style (fontSize only): untouched doc fields keep character-panel defaults", () => {
    const onSetTextDocument = vi.fn();
    const { ctx } = makeCtx({ onSetTextDocument });

    ae_add_text_layer(JSON.stringify({ text: "Big", fontSize: 120 }), ctx);

    expect(onSetTextDocument).toHaveBeenCalledTimes(1);
    const doc = onSetTextDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.fontSize).toBe(120);
    // Mock TextDocument defaults stand in for AE's character panel.
    expect(doc.font).toBe("MockDefaultFont");
    expect(doc.applyFill).toBeUndefined();
  });

  it("position -> Position.setValue([x, y])", () => {
    const onSetPosition = vi.fn();
    const onSetTextDocument = vi.fn();
    const { ctx } = makeCtx({ onSetPosition, onSetTextDocument });

    const parsed = JSON.parse(
      ae_add_text_layer(
        JSON.stringify({ text: "Placed", position: [960, 540] }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(onSetPosition).toHaveBeenCalledTimes(1);
    expect(onSetPosition).toHaveBeenCalledWith([960, 540]);
    // position alone must not trigger the TextDocument round-trip.
    expect(onSetTextDocument).not.toHaveBeenCalled();
  });

  it("compId provided: itemByID resolution, no active-comp dependency", () => {
    const onAddText = vi.fn();
    const layersCollection = makeMockLayerCollection({ onAddText });
    const compTarget = makeMockComp({ id: 42, name: "Target", layersCollection });
    const ctx = {
      app: makeMockApp({
        activeItem: null,
        items: [compTarget],
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };

    const parsed = JSON.parse(
      ae_add_text_layer(JSON.stringify({ text: "T", compId: 42 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output.compId).toBe(42);
    expect(onAddText).toHaveBeenCalledWith("T");
  });

  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = {
      app: makeMockApp({
        activeItem: null,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(ae_add_text_layer(JSON.stringify({ text: "X" }), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId unknown -> AENotFoundError", () => {
    const { ctx } = makeCtx({}, 5);
    const parsed = JSON.parse(
      ae_add_text_layer(JSON.stringify({ text: "X", compId: 999 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toContain("999");
  });

  it("compId resolves to non-Composition -> AENotFoundError", () => {
    const folder = makeMockNonCompItem("Folder", { id: 9, name: "Assets" });
    const ctx = {
      app: makeMockApp({
        items: [folder],
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_text_layer(JSON.stringify({ text: "X", compId: 9 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.developerHint).toContain("non-Composition");
  });

  it("D4 wiring: styling happens INSIDE the begin/end undo group", () => {
    const order: string[] = [];
    const beginUndoGroup = vi.fn((label: string) => order.push("begin:" + label));
    const endUndoGroup = vi.fn(() => order.push("end"));
    const onAddText = vi.fn(() => order.push("addText"));
    const onSetTextDocument = vi.fn(() => order.push("setTextDoc"));
    const layersCollection = makeMockLayerCollection({ onAddText, onSetTextDocument });
    const comp = makeMockComp({ id: 1, layersCollection });
    const ctx = {
      app: makeMockApp({ activeItem: comp, beginUndoGroup, endUndoGroup }),
    };

    const parsed = JSON.parse(
      ae_add_text_layer(JSON.stringify({ text: "U", fontSize: 40 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(beginUndoGroup).toHaveBeenCalledWith("ae_add_text_layer");
    expect(order).toEqual(["begin:ae_add_text_layer", "addText", "setTextDoc", "end"]);
  });

  it("D4 wiring on throw: addText throws -> endUndoGroup STILL called", () => {
    const beginUndoGroup = vi.fn();
    const endUndoGroup = vi.fn();
    const layersCollection = makeMockLayerCollection({
      throwOnAddText: new Error("AE: cannot add text layer"),
    });
    const comp = makeMockComp({ id: 1, layersCollection });
    const ctx = {
      app: makeMockApp({ activeItem: comp, beginUndoGroup, endUndoGroup }),
    };

    const parsed = JSON.parse(ae_add_text_layer(JSON.stringify({ text: "B" }), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AEScriptError");
    expect(beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(endUndoGroup).toHaveBeenCalledTimes(1);
  });
});
