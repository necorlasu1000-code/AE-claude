// Phase 5.1.5 -- unit tests for ae_get_layers impl.
//
// 6 cases:
//   1. active comp 없음 (compId 미지정)            -> AENoActiveCompError
//   2. compId 미지정 + active comp + 빈 레이어       -> { layers: [] }
//   3. compId 지정 + comp 존재 + 레이어              -> 레이어 list
//   4. compId 지정 + 미존재                          -> AENotFoundError
//   5. compId 지정 + 매치 item이 Composition 아님   -> AENotFoundError
//   6. 다중 layer subclass 혼재 (type 분류 검증)    -> toString reflection

import { describe, it, expect } from "vitest";
import { ae_get_layers } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockLayer,
  makeMockNonCompItem,
} from "../../../../src/jsx/aeft/tools/_mockApp";

describe("ae_get_layers", () => {
  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = { app: makeMockApp({ activeItem: null }) };
    const parsed = JSON.parse(ae_get_layers("{}", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId omitted + active comp empty -> { layers: [] }", () => {
    const comp = makeMockComp({ id: 1, name: "Main", layers: [] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };
    const parsed = JSON.parse(ae_get_layers("{}", ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ layers: [] });
  });

  it("compId provided + comp exists + layers populated -> array returned", () => {
    const layer1 = makeMockLayer({
      type: "AVLayer",
      index: 1,
      name: "Background",
      matchName: "ADBE Vector Layer",
      enabled: true,
      locked: false,
      inPoint: 0,
      outPoint: 5,
    });
    const layer2 = makeMockLayer({
      type: "TextLayer",
      index: 2,
      name: "Title",
      matchName: "ADBE Text Layer",
      enabled: true,
      locked: false,
      inPoint: 1,
      outPoint: 4,
    });
    const comp = makeMockComp({ id: 42, name: "Hero", layers: [layer1, layer2] });
    // Comp must be in items[] for itemByID to find it.
    const ctx = { app: makeMockApp({ items: [comp] }) };

    const parsed = JSON.parse(ae_get_layers(JSON.stringify({ compId: 42 }), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.layers).toHaveLength(2);
    expect(parsed.output.layers[0]).toEqual({
      index: 1,
      name: "Background",
      matchName: "ADBE Vector Layer",
      type: "AVLayer",
      enabled: true,
      locked: false,
      inPoint: 0,
      outPoint: 5,
    });
    expect(parsed.output.layers[1].type).toBe("TextLayer");
    expect(parsed.output.layers[1].matchName).toBe("ADBE Text Layer");
  });

  it("compId provided + unknown id -> AENotFoundError", () => {
    const comp = makeMockComp({ id: 1, name: "Main" });
    const ctx = { app: makeMockApp({ items: [comp] }) };

    const parsed = JSON.parse(ae_get_layers(JSON.stringify({ compId: 999 }), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/composition not found/i);
  });

  it("compId provided + matched item is not a Composition -> AENotFoundError", () => {
    const folder = makeMockNonCompItem("Folder", { id: 7, name: "Bin" });
    const ctx = { app: makeMockApp({ items: [folder] }) };

    const parsed = JSON.parse(ae_get_layers(JSON.stringify({ compId: 7 }), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
  });

  it("multiple Layer subclass types -> toString reflection classifies each", () => {
    const types = ["AVLayer", "CameraLayer", "LightLayer", "ShapeLayer", "TextLayer"] as const;
    const layers = types.map((t, i) =>
      makeMockLayer({ type: t, index: i + 1, name: t + "_inst", matchName: "ADBE " + t }),
    );
    const comp = makeMockComp({ id: 1, name: "Mix", layers });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_layers("{}", ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output.layers.map((l: { type: string }) => l.type)).toEqual([
      "AVLayer",
      "CameraLayer",
      "LightLayer",
      "ShapeLayer",
      "TextLayer",
    ]);
  });
});
