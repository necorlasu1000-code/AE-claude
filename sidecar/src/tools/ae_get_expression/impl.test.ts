// Phase 5.1.7 -- unit tests for ae_get_expression impl.
//
// Phase 5.1.7 fix (mistakes #18): propertyName is display-name (e.g.,
// "Position"), NOT matchName ("ADBE Position"). Mock MockLayerOpts.properties
// keys mirror production AE's layer.property(name) lookup -- index by
// display name. matchName field on the property body stays separate
// (PropertyBase.matchName, locale-stable internal id, unchanged).

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
  propertyName: "Position",
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

  it("propertyName not found on layer -> AENotFoundError", () => {
    // Display-name keyed map -- "Position" lookup misses ("Anchor Point" only).
    const layer = makeMockLayer({
      index: 1,
      properties: {
        "Anchor Point": makeMockProperty({ matchName: "ADBE Anchor Point", name: "Anchor Point" }),
      },
    });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENotFoundError");
    expect(parsed.error.userMessage).toMatch(/property/i);
    expect(parsed.error.userMessage).toMatch(/Position/);
  });

  // mistakes #18 regression guard -- internal matchName ("ADBE Position")
  // must NOT resolve when the mock keys mirror production AE's
  // display-name lookup contract. If a future impl change accidentally
  // walks the matchName fallback, this test surfaces it.
  it("matchName-shaped input ('ADBE Position') misses display-name lookup -> AENotFoundError (mistakes #18 regression case)", () => {
    const positionProp = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",   // display name
      expression: "wiggle(2, 30)",
      expressionEnabled: true,
    });
    const layer = makeMockLayer({
      index: 1,
      properties: { "Position": positionProp },   // display-name keyed
    });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    // First attempt with matchName -- production AE returns null/throws.
    const matchNameAttempt = JSON.parse(
      ae_get_expression(
        JSON.stringify({ layerIndex: 1, propertyName: "ADBE Position" }),
        ctx,
      ),
    );
    expect(matchNameAttempt.ok).toBe(false);
    expect(matchNameAttempt.error.code).toBe("AENotFoundError");

    // Same property is reachable via display name.
    const displayNameAttempt = JSON.parse(
      ae_get_expression(
        JSON.stringify({ layerIndex: 1, propertyName: "Position" }),
        ctx,
      ),
    );
    expect(displayNameAttempt.ok).toBe(true);
    expect(displayNameAttempt.output).toEqual({
      expression: "wiggle(2, 30)",
      enabled: true,
    });
  });

  it("expression empty + enabled false -> { expression: '', enabled: false }", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      expression: "",
      expressionEnabled: false,
    });
    const layer = makeMockLayer({ index: 1, properties: { "Position": prop } });
    const comp = makeMockComp({ id: 1, name: "Main", layers: [layer] });
    const ctx = { app: makeMockApp({ activeItem: comp }) };

    const parsed = JSON.parse(ae_get_expression(JSON.stringify(baseInput), ctx));

    expect(parsed.ok).toBe(true);
    expect(parsed.output).toEqual({ expression: "", enabled: false });
  });

  it("expression set + enabled true -> source string + enabled=true", () => {
    const prop = makeMockProperty({
      matchName: "ADBE Position",
      name: "Position",
      expression: "wiggle(2, 30)",
      expressionEnabled: true,
    });
    const layer = makeMockLayer({ index: 1, properties: { "Position": prop } });
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
      name: "Position",
      expression: "time * 100",
      expressionEnabled: false,
    });
    const layer = makeMockLayer({ index: 1, properties: { "Position": prop } });
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
