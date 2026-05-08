// Phase 5.1.6 -- unit tests for ae_list_effects impl.
//
// 6 cases:
//   1. compId omitted + no active comp     -> AENoActiveCompError
//   2. compId provided + unknown id        -> AENotFoundError
//   3. layerIndex out of bounds            -> AENotFoundError
//   4. layerIndex valid + layer has zero effects -> { effects: [] }
//   5. layerIndex valid + multiple effects -> all returned with matchName/displayName/enabled
//   6. layer without effects host (no .property method) -> { effects: [] }

import { describe, it, expect } from "vitest";
import { ae_list_effects } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockEffect,
  makeMockLayer,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_list_effects", () => {
  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = { app: makeMockApp({ activeItem: null }) };
    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId provided + unknown id -> AENotFoundError", () => {
    const comp = makeMockComp({ id: 1, name: "Main" });
    const ctx = { app: makeMockApp({ items: [comp] }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1, compId: 999 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/composition not found/i);
  });

  it("layerIndex out of bounds -> AENotFoundError", () => {
    const layer = makeMockLayer({ index: 1, effects: [] });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 5 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/layer not found/i);
  });

  it("layer with zero effects -> { effects: [] }", () => {
    const layer = makeMockLayer({ index: 1, effects: [] });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ effects: [] });
  });

  it("layer with multiple effects -> all returned with matchName/displayName/enabled", () => {
    const blur = makeMockEffect({
      matchName: "ADBE Gaussian Blur 2",
      name: "Gaussian Blur",
      enabled: true,
    });
    const tint = makeMockEffect({
      matchName: "ADBE Tint",
      name: "Tint (red)",   // user-renamed
      enabled: false,
    });
    const layer = makeMockLayer({ index: 1, effects: [blur, tint] });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output.effects).toHaveLength(2);
    expect(parsed.output.effects[0]).toEqual({
      matchName: "ADBE Gaussian Blur 2",
      displayName: "Gaussian Blur",
      enabled: true,
    });
    expect(parsed.output.effects[1]).toEqual({
      matchName: "ADBE Tint",
      displayName: "Tint (red)",
      enabled: false,
    });
  });

  it("layer without effects host (no .property method) -> { effects: [] }", () => {
    // makeMockLayer with effects undefined omits the property method
    // entirely, mirroring Camera/Light/Null layers in production AE
    // that throw on `layer.property("ADBE Effect Parade")`. impl.ts
    // try/catch path returns empty array.
    const layer = makeMockLayer({ index: 1, type: "CameraLayer" });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ effects: [] });
  });
});
