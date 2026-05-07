// Phase 5.1.3 — handler.ts (sidecar dispatcher adapter) unit tests.
//
// Mocks ToolCtx.panelExec to bypass the real dispatcher → ws → ExtendScript
// round-trip; verifies defineAETool wrap behavior (input/output schema
// validation, ctx.panelExec call site, AEError sentinel-string → typed
// AENoActiveCompError conversion).

import { describe, it, expect, vi } from "vitest";
import { ae_get_active_comp } from "./handler.js";
import { AEError, AENoActiveCompError, AEValidationError } from "../_errors.js";
import type { ToolCtx } from "../_define.js";

function makeCtx(panelExec: ToolCtx["panelExec"]): ToolCtx {
  return {
    panelExec,
    progress: () => { /* unused */ },
    signal: new AbortController().signal,
    requestId: "test-rid",
  };
}

const validOutput = {
  id: 42,
  name: "Hero",
  width: 1920,
  height: 1080,
  durationSec: 5,
  frameRate: 30,
  numLayers: 7,
};

describe("ae_get_active_comp handler (defineAETool wrap)", () => {
  it("happy path — panelExec returns valid output → handler.invoke resolves with same data", async () => {
    const panelExec = vi.fn(async () => validOutput) as unknown as ToolCtx["panelExec"];
    const ctx = makeCtx(panelExec);

    const out = await ae_get_active_comp.invoke({}, ctx);

    expect(out).toEqual(validOutput);
    expect(panelExec).toHaveBeenCalledWith("ae_get_active_comp", {});
  });

  it("input schema — extra unknown keys are stripped (zod default), panelExec receives empty object", async () => {
    // aeGetActiveCompInputSchema = z.object({}) — strict() not applied,
    // so unknown keys are stripped during parse. The panelExec call site
    // sees the parsed (empty) input, not the raw `{ extra: 1 }`.
    const panelExec = vi.fn(async () => validOutput) as unknown as ToolCtx["panelExec"];
    const ctx = makeCtx(panelExec);

    await ae_get_active_comp.invoke({ extra: 1 }, ctx);

    expect(panelExec).toHaveBeenCalledWith("ae_get_active_comp", {});
  });

  it("output schema — panelExec returns malformed data → AEScriptError thrown by defineAETool", async () => {
    // defineAETool wraps output mismatch as AEScriptError (see _define.ts:invoke).
    // Tests the sidecar-side validation gate: a buggy ExtendScript impl that
    // returns the wrong shape gets caught here before reaching the bridge.
    const panelExec = vi.fn(async () => ({
      id: "not-a-number",   // schema says z.number()
      name: "Hero",
      width: 1920,
      height: 1080,
      durationSec: 5,
      frameRate: 30,
      numLayers: 7,
    })) as unknown as ToolCtx["panelExec"];
    const ctx = makeCtx(panelExec);

    await expect(ae_get_active_comp.invoke({}, ctx)).rejects.toMatchObject({
      code: "AEScriptError",
    });
  });

  it("AENoActiveCompError — panelExec throws AEError(code='AENoActiveCompError') → handler re-throws typed AENoActiveCompError", async () => {
    const panelExec = vi.fn(async () => {
      throw new AEError(
        "AENoActiveCompError",
        "활성 컴프 없음",
        "사용자에게 컴프 선택 제안",
      );
    }) as unknown as ToolCtx["panelExec"];
    const ctx = makeCtx(panelExec);

    await expect(ae_get_active_comp.invoke({}, ctx)).rejects.toBeInstanceOf(AENoActiveCompError);

    // Verify the typed instance carries the canonical code/userMessage/developerHint
    // (set by AENoActiveCompError constructor — NOT just forwarding the original
    // strings, since handler.ts constructs a fresh subclass instance).
    try {
      await ae_get_active_comp.invoke({}, ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(AENoActiveCompError);
      expect((e as AEError).code).toBe("AENoActiveCompError");
      expect((e as AEError).userMessage).toMatch(/no active comp/i);
    }
  });

  it("other AEError codes — passes through unchanged (no per-code conversion)", async () => {
    // handler.ts only intercepts AENoActiveCompError. Any other code
    // (e.g., AETimeoutError from dispatcher race) propagates as-is so
    // the caller sees the actual failure, not a misleading domain error.
    const panelExec = vi.fn(async () => {
      throw new AEError("AETimeoutError", "타임아웃", "dispatcher race");
    }) as unknown as ToolCtx["panelExec"];
    const ctx = makeCtx(panelExec);

    try {
      await ae_get_active_comp.invoke({}, ctx);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AEError);
      expect(e).not.toBeInstanceOf(AENoActiveCompError);
      expect((e as AEError).code).toBe("AETimeoutError");
    }
  });

  it("DefinedTool surface — exposes name/description/schemas for registry consumers", () => {
    expect(ae_get_active_comp.name).toBe("ae_get_active_comp");
    expect(ae_get_active_comp.description).toMatch(/active composition/i);
    expect(ae_get_active_comp.inputSchema).toBeDefined();
    expect(ae_get_active_comp.outputSchema).toBeDefined();
  });
});
