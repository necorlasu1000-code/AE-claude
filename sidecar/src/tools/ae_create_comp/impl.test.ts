// Phase 5.2.2 -- unit tests for ae_create_comp impl (D4 destructive
// flag + undoGroup wiring first reference).
//
// Coverage:
//   1. Happy path: addComp called with correct args, comp.id returned,
//      bgColor unset.
//   2. bgColor supplied: comp.bgColor assigned after addComp.
//   3. pixelAspect default 1 when omitted (production addComp signature
//      requires the arg, so default must be materialized).
//   4. pixelAspect explicit value passes through.
//   5. Undo group wiring: beginUndoGroup("ae_create_comp") + endUndoGroup
//      both called exactly once around the addComp call.
//   6. Error path: addComp throws -> endUndoGroup STILL called (D4
//      try/finally contract; leaving AE in recording state would chain
//      next destructive tool into the same group).
//   7. Receiver guard (mistakes #17): direct items.addComp(...) call form
//      passes the mock's this-binding check.

import { describe, it, expect, vi } from "vitest";
import { ae_create_comp } from "./impl";
import {
  makeMockApp,
  makeMockItemCollection,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_create_comp", () => {
  it("happy path: addComp called with correct args, comp.id surfaced", () => {
    const onAddComp = vi.fn();
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({ nextCompId: 42, onAddComp }),
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "Hero",
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 5,
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      id: 42,
      name: "Hero",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
    });
    // addComp signature order (name, w, h, pixelAspect, duration, frameRate)
    // -- pixelAspect defaults to 1 when omitted from input.
    expect(onAddComp).toHaveBeenCalledTimes(1);
    expect(onAddComp).toHaveBeenCalledWith("Hero", 1920, 1080, 1, 5, 30);
  });

  it("bgColor supplied: comp.bgColor assigned post-addComp", () => {
    // The mock comp object surfaces back through the impl's return path
    // only via output fields (id/name/width/...), so we verify bgColor
    // assignment by inspecting the comp instance directly. We capture it
    // via the addComp return path: makeMockItemCollection's addComp
    // returns a fresh JsxCompItem each call, and the impl mutates it.
    // To inspect, we wrap addComp with a side-channel that snapshots
    // the comp after the impl assigns bgColor.
    let capturedComp: { bgColor?: [number, number, number] } | null = null;
    const collection = makeMockItemCollection({ nextCompId: 7 });
    const realAddComp = collection.addComp!;
    collection.addComp = function (
      this: unknown,
      name: string,
      width: number,
      height: number,
      pixelAspect: number,
      duration: number,
      frameRate: number,
    ) {
      const comp = realAddComp.call(
        collection,
        name,
        width,
        height,
        pixelAspect,
        duration,
        frameRate,
      );
      capturedComp = comp;
      return comp;
    };

    const ctx = {
      app: makeMockApp({
        itemsCollection: collection,
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "BgColored",
          width: 1280,
          height: 720,
          frameRate: 24,
          duration: 3,
          bgColor: [0.5, 0.2, 0.8],
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(capturedComp).not.toBeNull();
    expect(capturedComp!.bgColor).toEqual([0.5, 0.2, 0.8]);
  });

  it("pixelAspect omitted -> default 1 passed to addComp", () => {
    const onAddComp = vi.fn();
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({ onAddComp }),
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "DefaultPx",
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 1,
        }),
        ctx,
      ),
    );
    expect(onAddComp.mock.calls[0]?.[3]).toBe(1);
  });

  it("pixelAspect explicit value passes through to addComp", () => {
    const onAddComp = vi.fn();
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({ onAddComp }),
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "Anamorphic",
          width: 720,
          height: 480,
          frameRate: 29.97,
          duration: 2,
          pixelAspect: 2,
        }),
        ctx,
      ),
    );
    expect(onAddComp.mock.calls[0]?.[3]).toBe(2);
  });

  it("D4 wiring: beginUndoGroup + endUndoGroup called once around addComp", () => {
    const order: string[] = [];
    const beginUndoGroup = vi.fn((label: string) => {
      order.push("begin:" + label);
    });
    const endUndoGroup = vi.fn(() => {
      order.push("end");
    });
    const onAddComp = vi.fn(() => {
      order.push("addComp");
    });
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({ onAddComp }),
        beginUndoGroup,
        endUndoGroup,
      }),
    };
    const parsed = JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "UndoTest",
          width: 100,
          height: 100,
          frameRate: 30,
          duration: 1,
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(true);
    expect(beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(beginUndoGroup).toHaveBeenCalledWith("ae_create_comp");
    expect(endUndoGroup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["begin:ae_create_comp", "addComp", "end"]);
  });

  it("D4 wiring: addComp throws -> endUndoGroup STILL called (finally)", () => {
    const beginUndoGroup = vi.fn();
    const endUndoGroup = vi.fn();
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({
          throwOnAddComp: new Error("AE: invalid dimensions"),
        }),
        beginUndoGroup,
        endUndoGroup,
      }),
    };
    const parsed = JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "ThrowTest",
          width: 9999,
          height: 9999,
          frameRate: 60,
          duration: 1,
        }),
        ctx,
      ),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AEScriptError");
    expect(parsed.error.userMessage).toContain("AE: invalid dimensions");
    // Critical: finally block fires even on fn throw, so endUndoGroup
    // still runs. Without this, the next destructive tool would chain
    // into the orphan group (silent undo mis-attribution).
    expect(beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(endUndoGroup).toHaveBeenCalledTimes(1);
  });

  it("receiver guard: direct items.addComp call form passes mock guard", () => {
    // The impl uses `items.addComp(...)` (attached) -- this should pass
    // the mistakes #17 receiver check. If the impl were ever rewritten
    // to detach (var fn = items.addComp; fn(...)), the mock would throw
    // "Mock this-binding violation" and this test would catch it.
    const ctx = {
      app: makeMockApp({
        itemsCollection: makeMockItemCollection({}),
        beginUndoGroup: vi.fn(),
        endUndoGroup: vi.fn(),
      }),
    };
    const parsed = JSON.parse(
      ae_create_comp(
        JSON.stringify({
          name: "ReceiverOk",
          width: 640,
          height: 480,
          frameRate: 30,
          duration: 1,
        }),
        ctx,
      ),
    );
    expect(parsed.ok).toBe(true);
  });
});
