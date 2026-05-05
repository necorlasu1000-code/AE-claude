// Phase 3.6 — ToolDispatcher unit tests.
//
// All deps mocked (send / emit / now / setTimeout / clearTimeout /
// newRequestId). Tests exercise the public surface: exec / cancel /
// handleIncoming / inflight.

import { describe, it, expect, vi } from "vitest";
import {
  createToolDispatcher,
  type DispatcherLogEvent,
  type ToolDispatcherDeps,
} from "./toolDispatcher.js";
import type { ExecMsg, CancelMsg } from "../protocol.js";

function makeDeps(overrides?: Partial<ToolDispatcherDeps>): {
  deps: ToolDispatcherDeps;
  sent: Array<ExecMsg | CancelMsg>;
  events: DispatcherLogEvent[];
  ridSeq: { n: number };
  clock: { t: number };
  fireTimer: (handle: TimerHandle) => void;
  setTimeoutSpy: ReturnType<typeof vi.fn>;
  clearTimeoutSpy: ReturnType<typeof vi.fn>;
} {
  const sent: Array<ExecMsg | CancelMsg> = [];
  const events: DispatcherLogEvent[] = [];
  const ridSeq = { n: 0 };
  const clock = { t: 1000 };

  const timers = new Map<TimerHandle, () => void>();
  let nextHandle = 1;
  const setTimeoutSpy = vi.fn((cb: () => void, _ms: number): TimerHandle => {
    const h = nextHandle++ as TimerHandle;
    timers.set(h, cb);
    return h;
  });
  const clearTimeoutSpy = vi.fn((h: TimerHandle) => {
    timers.delete(h);
  });
  const fireTimer = (h: TimerHandle) => {
    const cb = timers.get(h);
    if (cb) cb();
  };

  const deps: ToolDispatcherDeps = {
    send: (msg) => sent.push(msg),
    emit: (e) => events.push(e),
    now: () => clock.t,
    setTimeout: setTimeoutSpy as never,
    clearTimeout: clearTimeoutSpy as never,
    newRequestId: () => `rid-${++ridSeq.n}`,
    ...overrides,
  };
  return { deps, sent, events, ridSeq, clock, fireTimer, setTimeoutSpy, clearTimeoutSpy };
}

type TimerHandle = ReturnType<typeof setTimeout>;

describe("ToolDispatcher", () => {
  it("happy path — exec → handleIncoming(result) → DispatcherResult.ok with durationMs", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);

    const promise = dispatcher.exec({ tool: "ae_get_active_comp", input: {} });

    // exec sent to panel with allocated requestId
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]).toMatchObject({
      type: "exec",
      requestId: "rid-1",
      tool: "ae_get_active_comp",
      input: {},
    });
    expect(dispatcher.inflight).toBe(1);

    // simulate panel round-trip: 50ms elapsed, result arrives
    ctx.clock.t += 50;
    dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: { name: "Hero" } });

    const result = await promise;
    expect(result).toEqual({ ok: true, data: { name: "Hero" }, durationMs: 50 });
    expect(dispatcher.inflight).toBe(0);

    // emit sequence: enter → exit(ok:true)
    const events = ctx.events.map((e) => e.event);
    expect(events).toEqual(["dispatcher:enter", "dispatcher:exit"]);
    expect(ctx.events[1]).toMatchObject({ event: "dispatcher:exit", requestId: "rid-1", durationMs: 50, ok: true });
  });

  it("error path — exec → handleIncoming(error) → ok:false with code/userMsg/devHint", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    const promise = dispatcher.exec({ tool: "ae_get_active_comp", input: {} });

    ctx.clock.t += 12;
    dispatcher.handleIncoming({
      type: "error",
      requestId: "rid-1",
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
    });

    const result = await promise;
    expect(result).toEqual({
      ok: false,
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
      durationMs: 12,
    });

    // emit sequence: enter → error → exit(ok:false)
    const events = ctx.events.map((e) => e.event);
    expect(events).toEqual(["dispatcher:enter", "dispatcher:error", "dispatcher:exit"]);
    expect(ctx.events[1]).toMatchObject({ event: "dispatcher:error", code: "AENoActiveCompError" });
  });

  it("timeout — no result before timeout fires → AETimeoutError + durationMs equals timeoutMs", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    const promise = dispatcher.exec({ tool: "any", input: {}, timeoutMs: 5000 });

    expect(ctx.setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(ctx.setTimeoutSpy.mock.calls[0][1]).toBe(5000);

    // advance clock + fire timer
    ctx.clock.t += 5000;
    ctx.fireTimer(1 as TimerHandle);

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AETimeoutError");
      expect(result.durationMs).toBe(5000);
      expect(result.developerHint).toMatch(/no result\/error received within 5000ms/);
    }

    const events = ctx.events.map((e) => e.event);
    expect(events).toEqual(["dispatcher:enter", "dispatcher:timeout", "dispatcher:error", "dispatcher:exit"]);
    expect(dispatcher.inflight).toBe(0);
  });

  it("default timeout falls through to DEFAULT_TIMEOUT_MS (30s) when neither option nor req sets one", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    void dispatcher.exec({ tool: "any", input: {} });

    expect(ctx.setTimeoutSpy.mock.calls[0][1]).toBe(30_000);
    expect(ctx.sent[0]).toMatchObject({ type: "exec", timeoutMs: 30_000 });
  });

  it("cancel — in-flight exec → cancel msg sent + AECancelledError resolve + timer cleared", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    const promise = dispatcher.exec({ tool: "any", input: {} });

    ctx.clock.t += 7;
    dispatcher.cancel("rid-1");

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AECancelledError");
      expect(result.durationMs).toBe(7);
    }

    // cancel msg sent to panel (best-effort)
    expect(ctx.sent.some((m) => m.type === "cancel" && m.requestId === "rid-1")).toBe(true);
    // timer cleared
    expect(ctx.clearTimeoutSpy).toHaveBeenCalledWith(1);

    const events = ctx.events.map((e) => e.event);
    expect(events).toEqual(["dispatcher:enter", "dispatcher:cancel", "dispatcher:error", "dispatcher:exit"]);
    expect(dispatcher.inflight).toBe(0);
  });

  it("cancel unknown requestId — silent no-op (no events, no send)", () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);

    dispatcher.cancel("rid-nonexistent");

    expect(ctx.sent).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);
  });

  it("late result silent drop — handleIncoming after cancel does NOT throw or grow inflight", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    void dispatcher.exec({ tool: "any", input: {} });

    dispatcher.cancel("rid-1");
    expect(dispatcher.inflight).toBe(0);

    // Late arrival — should be silently dropped
    expect(() => {
      dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: { late: true } });
    }).not.toThrow();
    expect(dispatcher.inflight).toBe(0);

    // No further events emitted by the late drop (event count unchanged after drop)
    const eventsBeforeDrop = ctx.events.length;
    dispatcher.handleIncoming({ type: "error", requestId: "rid-1", code: "x", userMessage: "y", developerHint: "z" });
    expect(ctx.events.length).toBe(eventsBeforeDrop);
  });

  it("late result silent drop — after timeout, late result does NOT resolve a fresh promise", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    const promise = dispatcher.exec({ tool: "any", input: {}, timeoutMs: 100 });

    ctx.clock.t += 100;
    ctx.fireTimer(1 as TimerHandle);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AETimeoutError");
    expect(dispatcher.inflight).toBe(0);

    dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: "ignored" });
    expect(dispatcher.inflight).toBe(0);
  });

  it("handleIncoming unknown requestId — silent drop, never throws", () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);

    expect(() => {
      dispatcher.handleIncoming({ type: "result", requestId: "rid-orphan", data: "x" });
      dispatcher.handleIncoming({ type: "error", requestId: "rid-orphan", code: "x", userMessage: "y", developerHint: "z" });
      dispatcher.handleIncoming({ type: "result.chunk", requestId: "rid-orphan", seq: 0, total: 1, data: "x" });
    }).not.toThrow();
  });

  it("result.chunk silent ignore (Phase 3.6 reassembly intentionally not implemented)", () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);
    void dispatcher.exec({ tool: "any", input: {} });

    dispatcher.handleIncoming({ type: "result.chunk", requestId: "rid-1", seq: 0, total: 2, data: "{\"a" });
    // request still pending; chunk silently dropped
    expect(dispatcher.inflight).toBe(1);

    // resolution still works via plain result
    dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: { a: 1 } });
    expect(dispatcher.inflight).toBe(0);
  });

  it("concurrent exec — multiple in-flight, each resolves independently", async () => {
    const ctx = makeDeps();
    const dispatcher = createToolDispatcher(ctx.deps);

    const p1 = dispatcher.exec({ tool: "first", input: {} });
    const p2 = dispatcher.exec({ tool: "second", input: {} });
    const p3 = dispatcher.exec({ tool: "third", input: {} });

    expect(dispatcher.inflight).toBe(3);
    expect(ctx.sent).toHaveLength(3); // each sent immediately — dispatcher does not serialize

    ctx.clock.t += 10;
    dispatcher.handleIncoming({ type: "result", requestId: "rid-2", data: "second-result" });
    expect(dispatcher.inflight).toBe(2);

    ctx.clock.t += 10;
    dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: "first-result" });
    expect(dispatcher.inflight).toBe(1);

    ctx.clock.t += 10;
    dispatcher.handleIncoming({ type: "result", requestId: "rid-3", data: "third-result" });
    expect(dispatcher.inflight).toBe(0);

    expect((await p1)).toMatchObject({ ok: true, data: "first-result", durationMs: 20 });
    expect((await p2)).toMatchObject({ ok: true, data: "second-result", durationMs: 10 });
    expect((await p3)).toMatchObject({ ok: true, data: "third-result", durationMs: 30 });
  });

  it("default emit (deps.emit undefined) — no throw, no console output", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ctx = makeDeps({ emit: undefined });
    const dispatcher = createToolDispatcher(ctx.deps);
    const promise = dispatcher.exec({ tool: "any", input: {} });
    dispatcher.handleIncoming({ type: "result", requestId: "rid-1", data: 1 });
    await promise;

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("randomUUID default — newRequestId not injected → real uuid issued", async () => {
    const ctx = makeDeps({ newRequestId: undefined });
    const dispatcher = createToolDispatcher(ctx.deps);
    void dispatcher.exec({ tool: "any", input: {} });

    expect(ctx.sent[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
