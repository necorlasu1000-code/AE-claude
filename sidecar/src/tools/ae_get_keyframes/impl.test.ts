// Phase 5.1.8 -- unit tests for ae_get_keyframes impl.
//
// Phase 5.1.7 fix-2 reference (mistakes #18) -- propertyName is display name.
// MockLayerOpts.properties keys are display names; matchName field on the
// property body stays separate.

import { describe, it, expect } from "vitest";
import { ae_get_keyframes } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockLayer,
  makeMockProperty,
} from "../../../../src/jsx/aeft/tools/_mockApp";

const baseInput = {
  layerIndex: 1,
  propertyName: "Position",
};

describe("ae_get_keyframes", () => {
  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = { app: makeMockApp({ activeItem: null }) };
    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId provided + unknown id -> AENotFoundError", () => {
    const comp = makeMockComp({ id: 1, name: "Main" });
    const ctx = { app: makeMockApp({ items: [comp] }) };

    const parsed = JSON.parse(
      ae_get_keyframes(JSON.stringify({ ...baseInput, compId: 999 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/composition not found/i);
  });

  it("layerIndex out of bounds -> AENotFoundError", () => {
    const layer = makeMockLayer({ index: 1, properties: {} });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_get_keyframes(JSON.stringify({ ...baseInput, layerIndex: 5 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/layer not found/i);
  });

  it("propertyName not found on layer -> AENotFoundError", () => {
    const layer = makeMockLayer({
      index: 1,
      properties: {
        "Anchor Point": makeMockProperty({ matchName: "ADBE Anchor Point", name: "Anchor Point" }),
      },
    });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/property/i);
    expect(parsed.error.userMessage).toMatch(/Position/);
  });

  it("property numKeys 0 -> { keyframes: [] }", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [],   // numKeys = 0
    });
    const layer = makeMockLayer({ index: 1, properties: { Position: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ keyframes: [] });
  });

  it("single keyframe -> 1 entry with correct interpolation", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [
        { time: 1.5, value: [100, 200], inInterp: 6612, outInterp: 6613 },
      ],
    });
    const layer = makeMockLayer({ index: 1, properties: { Position: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.keyframes).toHaveLength(1);
    expect(parsed.output.keyframes[0]).toEqual({
      index: 1,
      time: 1.5,
      value: [100, 200],
      interpolation: { in: "LINEAR", out: "BEZIER" },
    });
  });

  it("multiple keyframes -> all returned in order", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [
        { time: 0,   value: [0, 0],     inInterp: 6612, outInterp: 6612 },
        { time: 1,   value: [100, 0],   inInterp: 6613, outInterp: 6613 },
        { time: 2.5, value: [200, 100], inInterp: 6614, outInterp: 6614 },
      ],
    });
    const layer = makeMockLayer({ index: 1, properties: { Position: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.keyframes).toHaveLength(3);
    expect(parsed.output.keyframes[0].time).toBe(0);
    expect(parsed.output.keyframes[1].time).toBe(1);
    expect(parsed.output.keyframes[2].time).toBe(2.5);
    expect(parsed.output.keyframes[0].index).toBe(1);
    expect(parsed.output.keyframes[1].index).toBe(2);
    expect(parsed.output.keyframes[2].index).toBe(3);
  });

  it("interpolation int -> string mapping (LINEAR=6612 / BEZIER=6613 / HOLD=6614)", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [
        { time: 0, value: 0, inInterp: 6612, outInterp: 6614 }, // LINEAR / HOLD
        { time: 1, value: 1, inInterp: 6613, outInterp: 6612 }, // BEZIER / LINEAR
        { time: 2, value: 2, inInterp: 6614, outInterp: 6613 }, // HOLD / BEZIER
      ],
    });
    const layer = makeMockLayer({ index: 1, properties: { Position: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.keyframes[0].interpolation).toEqual({ in: "LINEAR", out: "HOLD" });
    expect(parsed.output.keyframes[1].interpolation).toEqual({ in: "BEZIER", out: "LINEAR" });
    expect(parsed.output.keyframes[2].interpolation).toEqual({ in: "HOLD", out: "BEZIER" });
  });

  it("unknown interp int -> falls back to BEZIER (AE default)", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [
        { time: 0, value: 0, inInterp: 9999, outInterp: 8888 },
      ],
    });
    const layer = makeMockLayer({ index: 1, properties: { Position: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_keyframes(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.keyframes[0].interpolation).toEqual({ in: "BEZIER", out: "BEZIER" });
  });

  it("value shape varies (number / array / object) -> passes through unchanged", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Whatever",
      name: "Whatever",
      keyframes: [
        { time: 0, value: 42 },
        { time: 1, value: [1, 2, 3, 4] },                  // color-ish
        { time: 2, value: { custom: "shape data" } },      // object
      ],
    });
    const layer = makeMockLayer({ index: 1, properties: { Whatever: prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_get_keyframes(JSON.stringify({ layerIndex: 1, propertyName: "Whatever" }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output.keyframes[0].value).toBe(42);
    expect(parsed.output.keyframes[1].value).toEqual([1, 2, 3, 4]);
    expect(parsed.output.keyframes[2].value).toEqual({ custom: "shape data" });
  });

  // mistakes #17 regression guard -- mock receiver guard ensures detached
  // method calls fail at unit-test layer. impl.ts must call
  // property.keyTime(i) directly, NOT var fn = property.keyTime; fn(i).
  it("mock receiver guard fires on detached method call (mistakes #17 regression)", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      keyframes: [{ time: 0, value: 0, inInterp: 6613, outInterp: 6613 }],
    });

    // Direct call on receiver: succeeds.
    expect(() => prop.keyTime!(1)).not.toThrow();

    // Detached call: receiver guard throws.
    const detached = prop.keyTime!;
    expect(() => detached(1)).toThrow(/this-binding/i);
  });
});
