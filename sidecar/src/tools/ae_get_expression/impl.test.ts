// Phase 5.1.7 -- unit tests for ae_get_expression impl.
//
// 7 cases:
//   1. compId omitted + no active comp           -> AENoActiveCompError
//   2. compId provided + unknown id              -> AENotFoundError
//   3. layerIndex out of bounds                  -> AENotFoundError
//   4. propertyMatchName not found on layer      -> AENotFoundError
//   5. expression empty + enabled false          -> { expression: "", enabled: false }
//   6. expression set + enabled true             -> { expression: "wiggle(2,30)", enabled: true }
//   7. expression set + disabled (eyeball off)   -> { expression: "...", enabled: false }

import { describe, it, expect } from "vitest";
import { ae_get_expression } from "./impl";
import {
  makeMockApp,
  makeMockComp,
  makeMockLayer,
  makeMockProperty,
} from "../../../../src/jsx/aeft/tools/_mockApp";

const baseInput = {
  layerIndex: 1,
  propertyMatchName: "ADBE Position",
};

describe("ae_get_expression", () => {
  it("compId omitted + no active comp -> AENoActiveCompError", () => {
    const ctx = { app: makeMockApp({ activeItem: null }) };
    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("compId provided + unknown id -> AENotFoundError", () => {
    const comp = makeMockComp({ id: 1, name: "Main" });
    const ctx = { app: makeMockApp({ items: [comp] }) };

    const parsed = JSON.parse(
      ae_get_expression(JSON.stringify({ ...baseInput, compId: 999 }), ctx),
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
      ae_get_expression(JSON.stringify({ ...baseInput, layerIndex: 5 }), ctx),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/layer not found/i);
  });

  it("propertyMatchName not found on layer -> AENotFoundError", () => {
    const layer = makeMockLayer({
      index: 1,
      properties: { "ADBE Anchor Point": makeMockProperty({ matchName: "ADBE Anchor Point" }) },
    });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(
      ae_get_expression(JSON.stringify(baseInput), ctx),   // ADBE Position not in map
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/property/i);
    expect(parsed.error.userMessage).toMatch(/ADBE Position/);
  });

  it("expression empty + enabled false -> { expression: '', enabled: false }", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      expression: "",
      expressionEnabled: false,
    });
    const layer = makeMockLayer({ index: 1, properties: { "ADBE Position": prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ expression: "", enabled: false });
  });

  it("expression set + enabled true -> source string + enabled=true", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      expression: "wiggle(2, 30)",
      expressionEnabled: true,
    });
    const layer = makeMockLayer({ index: 1, properties: { "ADBE Position": prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      expression: "wiggle(2, 30)",
      enabled: true,
    });
  });

  it("expression stored + currently disabled (eyeball off) -> enabled=false", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      expression: "time * 100",
      expressionEnabled: false,
    });
    const layer = makeMockLayer({ index: 1, properties: { "ADBE Position": prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({
      expression: "time * 100",
      enabled: false,
    });
  });
});
