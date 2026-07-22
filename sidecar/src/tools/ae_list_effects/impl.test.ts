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

  it("layer with zero effects -> empty page", () => {
    const layer = makeMockLayer({ index: 1, effects: [] });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_list_effects(JSON.stringify({ layerIndex: 1 }), ctx),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ items: [], total: 0, hasMore: false, nextOffset: null });
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
    expect(parsed.output.items).toHaveLength(2);
    expect(parsed.output).toMatchObject({ total: 2, hasMore: false, nextOffset: null });
    expect(parsed.output.items[0]).toEqual({
      matchName: "ADBE Gaussian Blur 2",
      displayName: "Gaussian Blur",
      enabled: true,
    });
    expect(parsed.output.items[1]).toEqual({
      matchName: "ADBE Tint",
      displayName: "Tint (red)",
      enabled: false,
    });
  });

  it("layer without effects host (no .property method) -> empty page", () => {
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
    expect(parsed.output).toEqual({ items: [], total: 0, hasMore: false, nextOffset: null });
  });

  // ── Pagination (gate §5) ──────────────────────────────────────────
  it("limit/offset window effects + report hasMore + nextOffset", () => {
    const effects = [];
    for (let n = 0; n < 4; n++) {
      effects.push(makeMockEffect({ matchName: "ADBE E" + n, name: "E" + n, enabled: true }));
    }
    const layer = makeMockLayer({ index: 1, effects });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const page1 = JSON.parse(ae_list_effects(JSON.stringify({ layerIndex: 1, limit: 3, offset: 0 }), ctx));
    expect(page1.output.items.map((x: { matchName: string }) => x.matchName)).toEqual(["ADBE E0", "ADBE E1", "ADBE E2"]);
    expect(page1.output).toMatchObject({ total: 4, hasMore: true, nextOffset: 3 });

    const page2 = JSON.parse(ae_list_effects(JSON.stringify({ layerIndex: 1, limit: 3, offset: 3 }), ctx));
    expect(page2.output.items.map((x: { matchName: string }) => x.matchName)).toEqual(["ADBE E3"]);
    expect(page2.output).toMatchObject({ total: 4, hasMore: false, nextOffset: null });
  });
});
