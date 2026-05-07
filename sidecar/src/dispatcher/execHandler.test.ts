// makeDispatcherExecHandler unit tests — mock dispatcher, verify the
// ok=true → data return / ok=false → AEError throw conversion.

import { describe, it, expect, vi } from "vitest";
import { makeDispatcherExecHandler } from "./execHandler.js";
import type { ToolDispatcher, DispatcherResult } from "./toolDispatcher.js";
import { AEError } from "../tools/_errors.js";

function makeMockDispatcher(impl: () => DispatcherResult | Promise<DispatcherResult>): {
  dispatcher: ToolDispatcher;
  execMock: ReturnType<typeof vi.fn>;
} {
  const execMock = vi.fn(async () => impl());
  const dispatcher: ToolDispatcher = {
    exec: execMock,
    cancel: vi.fn(),
    handleIncoming: vi.fn(),
    get inflight() { return 0; },
  };
  return { dispatcher, execMock };
}

const fakeCtx = {
  requestId: "rid-test",
  signal: new AbortController().signal,
  progress: () => { /* unused */ },
};

describe("makeDispatcherExecHandler", () => {
  it("ok=true → returns data, dispatcher.exec called with {tool, input}", async () => {
    const { dispatcher, execMock } = makeMockDispatcher(() => ({
      ok: true, data: { name: "Hero", w: 1920 }, durationMs: 42,
    }));
    const handler = makeDispatcherExecHandler(dispatcher);

    const out = await handler("ae_get_active_comp", { foo: "bar" }, fakeCtx);

    expect(out).toEqual({ name: "Hero", w: 1920 });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledWith({
      tool: "ae_get_active_comp",
      input: { foo: "bar" },
    });
  });

  it("ok=false → throws AEError with code/userMessage/developerHint preserved", async () => {
    const { dispatcher } = makeMockDispatcher(() => ({
      ok: false,
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
      durationMs: 17,
    }));
    const handler = makeDispatcherExecHandler(dispatcher);

    await expect(handler("ae_get_active_comp", {}, fakeCtx)).rejects.toMatchObject({
      name: "AENoActiveCompError",
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
    });

    // Verify the throw is an AEError instance (panelBridge.toErrorMsg checks
    // `e instanceof AEError` to preserve the code/userMessage/developerHint
    // triple — a plain Error would be wrapped as AEScriptError fallback).
    try {
      await handler("ae_get_active_comp", {}, fakeCtx);
    } catch (e) {
      expect(e).toBeInstanceOf(AEError);
    }
  });

  it("ok=false AETimeoutError → throws AEError with same code", async () => {
    // Verifies any DispatcherResult.code passes through unchanged — no
    // hard-coded code list. Timeout is the most common ok=false in prod.
    const { dispatcher } = makeMockDispatcher(() => ({
      ok: false,
      code: "AETimeoutError",
      userMessage: "툴 호출 타임아웃 (30000ms 초과)",
      developerHint: "tool=ae_get_active_comp ...",
      durationMs: 30_000,
    }));
    const handler = makeDispatcherExecHandler(dispatcher);

    await expect(handler("ae_get_active_comp", {}, fakeCtx)).rejects.toMatchObject({
      code: "AETimeoutError",
    });
  });
});
