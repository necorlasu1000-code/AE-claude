// Phase 3.3 — unit tests for the first jsx bridge tool.
//
// Runs under root vitest config (node env). Tests exercise the wrapper
// envelope shape via the public `(rawInput, ctxOverride) => string` surface,
// not internals — same way the panel's useExtendScriptBridge will call it
// in Phase 3.5.

import { describe, it, expect } from "vitest";
import { ae_get_active_comp } from "./handler";
import { makeMockApp, makeMockComp, makeMockNonCompItem } from "../_mockApp";

describe("ae_get_active_comp", () => {
  it("happy path — returns active comp metadata in {ok:true,output} envelope", () => {
    const ctx = {
      app: makeMockApp({
        activeItem: makeMockComp({
          name: "Hero Shot",
          id: 42,
          duration: 5.5,
          frameRate: 24,
          width: 3840,
          height: 2160,
          numLayers: 7,
        }),
      }),
    };

    const raw = ae_get_active_comp("{}", ctx);
    expect(typeof raw).toBe("string");

    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      ok: true,
      output: {
        name: "Hero Shot",
        id: 42,
        durationSec: 5.5,
        frameRate: 24,
        width: 3840,
        height: 2160,
        numLayers: 7,
      },
    });
  });

  it("h.fail — null activeItem → AENoActiveCompError", () => {
    const ctx = { app: makeMockApp({ activeItem: null }) };

    const parsed = JSON.parse(ae_get_active_comp("{}", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
    expect(parsed.error.userMessage).toMatch(/활성 컴프|active comp/i);
    expect(typeof parsed.error.developerHint).toBe("string");
    expect(parsed.error.developerHint.length).toBeGreaterThan(0);
  });

  it("h.fail — Folder activeItem (non-comp) → AENoActiveCompError", () => {
    const ctx = {
      app: makeMockApp({
        activeItem: makeMockNonCompItem("Folder", { name: "Bin" }),
      }),
    };

    const parsed = JSON.parse(ae_get_active_comp("{}", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("h.fail — Footage activeItem (non-comp) → AENoActiveCompError", () => {
    const ctx = {
      app: makeMockApp({
        activeItem: makeMockNonCompItem("Footage", { name: "input.mp4" }),
      }),
    };

    const parsed = JSON.parse(ae_get_active_comp("{}", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AENoActiveCompError");
  });

  it("malformed rawInput → AEInputParseError", () => {
    const ctx = { app: makeMockApp({ activeItem: makeMockComp() }) };

    const parsed = JSON.parse(ae_get_active_comp("not-json", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AEInputParseError");
    expect(parsed.error.userMessage).toMatch(/입력|input/i);
  });

  it("empty string rawInput → AEInputParseError", () => {
    const ctx = { app: makeMockApp({ activeItem: makeMockComp() }) };

    const parsed = JSON.parse(ae_get_active_comp("", ctx));

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("AEInputParseError");
  });

  it("returns parseable JSON string (panel JSON.parse never fails on valid jsx output)", () => {
    const ctx = { app: makeMockApp({ activeItem: makeMockComp() }) };

    const raw = ae_get_active_comp("{}", ctx);

    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
