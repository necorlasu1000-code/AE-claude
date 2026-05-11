// Phase 5.3.1 -- unit tests for ae_add_solid_layer impl (write, layer
// lane 1/9 -- D4 HOF reuse first activation).
//
// Coverage:
//   1. Happy path (active comp + defaults): addSolid called with comp
//      width/height/duration + pixelAspect=1.
//   2. Explicit width/height/pixelAspect/duration override defaults.
//   3. compId provided -> itemByID resolution, no active-comp dependency.
//   4. compId omitted + no active comp -> AENoActiveCompError.
//   5. compId unknown -> AENotFoundError.
//   6. compId resolves to non-Composition -> AENotFoundError.
//   7. D4 wiring: beginUndoGroup("ae_add_solid_layer") + endUndoGroup
//      called around addSolid (5.2.2 HOF auto-wrap reuse).
//   8. D4 wiring on throw: addSolid throws -> endUndoGroup STILL called.
//   9. Receiver guard (#17): direct comp.layers.addSolid(...) form passes.

import { describe, it, expect, vi } from "vitest";
import { ae_add_solid_layer } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockLayerCollection,
  makeMockNonCompItem,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_add_solid_layer", () => {
  it("active comp + defaults: addSolid called with comp dimensions/duration + pixelAspect=1", () => {
    const onAddSolid = vi.fn();
    const layersCollection = makeMockLayerCollection({ onAddSolid });
    const comp = makeMockComp({
      id: 11,
      name: "Hero",
      width: 1920,
      height: 1080,
      duration: 5,
      frameRate: 30,
      layersCollection,
    });
    const ctx = {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "BG",
          color: [0, 0, 1],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      index: 1,
      name: "BG",
      compId: 11,
    });
    expect(onAddSolid).toHaveBeenCalledTimes(1);
    // addSolid signature: (color, name, width, height, pixelAspect, duration)
    expect(onAddSolid).toHaveBeenCalledWith([0, 0, 1], "BG", 1920, 1080, 1, 5);
  });

  it("explicit width/height/pixelAspect/duration override comp defaults", () => {
    const onAddSolid = vi.fn();
    const layersCollection = makeMockLayerCollection({ onAddSolid });
    const comp = makeMockComp({
      id: 12,
      width: 1920,
      height: 1080,
      duration: 5,
      layersCollection,
    });
    const ctx = {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "Tiny",
          color: [1, 0, 0],
          width: 100,
          height: 200,
          pixelAspect: 2,
          duration: 3,
        }),
        ctx,
      ),
    );
    expect(onAddSolid).toHaveBeenCalledWith([1, 0, 0], "Tiny", 100, 200, 2, 3);
  });

  it("compId provided: itemByID resolution, no active-comp dependency", () => {
    const onAddSolid = vi.fn();
    const layersCollection = makeMockLayerCollection({ onAddSolid });
    const compTarget = makeMockComp({
      id: 42,
      name: "Target",
      width: 1280,
      height: 720,
      duration: 10,
      layersCollection,
    });
    const ctx = {
      app: makeMockApp({
        activeItem: null,
        items: [compTarget],
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "Solid",
          color: [0, 1, 0],
          compId: 42,
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output.compId).toBe(42);
    expect(onAddSolid).toHaveBeenCalledWith([0, 1, 0], "Solid", 1280, 720, 1, 10);
  });

  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = {
      app: makeMockApp({
        activeItem: null,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "NoComp",
          color: [1, 1, 1],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId unknown -> AENotFoundError", () => {
    const layersCollection = makeMockLayerCollection({});
    const comp = makeMockComp({ id: 5, layersCollection });
    const ctx = {
      app: makeMockApp({
        items: [comp],
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "Solid",
          color: [0.5, 0.5, 0.5],
          compId: 999,
        }),
        ctx,
      ),
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
      ae_add_solid_layer(
        JSON.stringify({
          name: "Solid",
          color: [1, 1, 1],
          compId: 9,
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.developerHint).toContain("non-Composition");
  });

  it("D4 wiring: beginUndoGroup + endUndoGroup called around addSolid (5.2.2 HOF reuse)", () => {
    const order: string[] = [];
    const beginUndoGroup = vi.fn((label: string) => {
      order.push("begin:" + label);
    });
    const endUndoGroup = vi.fn(() => {
      order.push("end");
    });
    const onAddSolid = vi.fn(() => {
      order.push("addSolid");
    });
    const layersCollection = makeMockLayerCollection({ onAddSolid });
    const comp = makeMockComp({ id: 1, layersCollection });
    const ctx = {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup,
        endUndoGroup,
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "Solid",
          color: [0, 0, 0],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(beginUndoGroup).toHaveBeenCalledWith("ae_add_solid_layer");
    expect(endUndoGroup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["begin:ae_add_solid_layer", "addSolid", "end"]);
  });

  it("D4 wiring on throw: addSolid throws -> endUndoGroup STILL called", () => {
    const beginUndoGroup = vi.fn();
    const endUndoGroup = vi.fn();
    const layersCollection = makeMockLayerCollection({
      throwOnAddSolid: new Error("AE: invalid solid"),
    });
    const comp = makeMockComp({ id: 1, layersCollection });
    const ctx = {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup,
        endUndoGroup,
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "Bad",
          color: [1, 1, 1],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AEScriptError");
    expect(beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(endUndoGroup).toHaveBeenCalledTimes(1);
  });

  it("receiver guard: direct comp.layers.addSolid form passes mock check", () => {
    const onAddSolid = vi.fn();
    const layersCollection = makeMockLayerCollection({ onAddSolid });
    const comp = makeMockComp({ id: 1, layersCollection });
    const ctx = {
      app: makeMockApp({
        activeItem: comp,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_add_solid_layer(
        JSON.stringify({
          name: "RG",
          color: [0.5, 0.5, 0.5],
        }),
        ctx,
      ),
    );
    expect(parsed.ok).toBe(true);
    expect(onAddSolid).toHaveBeenCalledTimes(1);
  });
});
