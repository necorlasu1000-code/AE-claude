// McpWsClient unit tests — inline MockWebSocket factory pattern (3.5 useExtendScriptBridge style).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpWsClient } from "./wsClient.js";

// ─── MockWebSocket ─────────────────────────────────────────────────

let lastWs: MockWebSocket | undefined;

class MockWebSocket {
  url: string;
  readyState = 0;  // CONNECTING
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    setImmediate(() => this._fire("close"));
  });
  private listeners: Record<string, ((arg?: unknown) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    lastWs = this;
  }
  on(event: string, cb: (arg?: unknown) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }
  once(event: string, cb: (arg?: unknown) => void): void {
    const wrapper = (arg?: unknown) => {
      cb(arg);
      const arr = this.listeners[event];
      if (arr) {
        const i = arr.indexOf(wrapper);
        if (i >= 0) arr.splice(i, 1);
      }
    };
    (this.listeners[event] ??= []).push(wrapper);
  }
  _fire(event: string, arg?: unknown): void {
    for (const cb of this.listeners[event] ?? []) cb(arg);
  }
  _open(): void { this.readyState = 1; this._fire("open"); }
  _message(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this._fire("message", { toString: () => data });
  }
}

beforeEach(() => {
  lastWs = undefined;
  vi.clearAllMocks();
});

// ─── Suite ─────────────────────────────────────────────────────────

describe("McpWsClient", () => {
  it("connect: opens ws with ?role=mcp query and resolves on open", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const connectP = client.connect();
    expect(lastWs).toBeDefined();
    expect(lastWs!.url).toBe("ws://127.0.0.1:12345/?role=mcp");
    lastWs!._open();
    await connectP;  // resolves once 'open' fires
  });

  it("connect: rejects when ws emits error before open", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const connectP = client.connect();
    expect(lastWs).toBeDefined();
    lastWs!._fire("error", new Error("ECONNREFUSED"));
    await expect(connectP).rejects.toThrow(/ECONNREFUSED/);
  });

  it("exec: sends ExecMsg with auto-generated requestId, resolves with matching ResultMsg", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    const execP = client.exec("ae_get_active_comp", { foo: "bar" });
    // ws.send called with exec envelope
    expect(lastWs!.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(lastWs!.send.mock.calls[0][0] as string);
    expect(sent).toMatchObject({ type: "exec", tool: "ae_get_active_comp", input: { foo: "bar" } });
    expect(typeof sent.requestId).toBe("string");

    // sidecar replies result on the same requestId
    lastWs!._message({ type: "result", requestId: sent.requestId, data: { name: "Hero", w: 1920 } });
    const result = await execP;
    expect(result).toMatchObject({ type: "result", requestId: sent.requestId, data: { name: "Hero", w: 1920 } });
  });

  it("exec: resolves with ErrorMsg on matching error response", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    const execP = client.exec("ae_get_active_comp", {});
    const sent = JSON.parse(lastWs!.send.mock.calls[0][0] as string);
    lastWs!._message({
      type: "error", requestId: sent.requestId,
      code: "AENoActiveCompError",
      userMessage: "No active composition.",
      developerHint: "Open or select a comp first.",
    });
    const out = await execP;
    expect(out).toMatchObject({ type: "error", code: "AENoActiveCompError" });
  });

  it("exec: timeoutMs hit → resolves with synthesized AETimeoutError (no real response)", async () => {
    vi.useFakeTimers();
    const client = new McpWsClient({ port: 12345, timeoutMs: 100 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    const execP = client.exec("ae_slow_tool", {});
    vi.advanceTimersByTime(150);
    const out = await execP;
    expect(out).toMatchObject({ type: "error", code: "AETimeoutError" });
    vi.useRealTimers();
  });

  it("exec: returns AECrashedError when ws not open", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    // Skip connect — readyState stays CONNECTING (0)
    const out = await client.exec("ae_any", {});
    expect(out).toMatchObject({ type: "error", code: "AECrashedError" });
  });

  it("heartbeat: sys.heartbeat received → echoes back with ts (mistakes #12 pattern)", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    const sendCountBefore = lastWs!.send.mock.calls.length;
    lastWs!._message({ type: "sys.heartbeat", ts: 100 });

    expect(lastWs!.send.mock.calls.length).toBe(sendCountBefore + 1);
    const echoed = JSON.parse(lastWs!.send.mock.calls[sendCountBefore][0] as string);
    expect(echoed.type).toBe("sys.heartbeat");
    expect(typeof echoed.ts).toBe("number");
  });

  it("close: clears pending timers + closes ws", async () => {
    const client = new McpWsClient({ port: 12345, timeoutMs: 5000 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    void client.exec("ae_dangling", {});  // pending exec
    expect(lastWs!.send).toHaveBeenCalled();

    client.close();
    expect(lastWs!.close).toHaveBeenCalled();
    // No assertion on the dangling promise — close() doesn't reject pending
    // (callers should drop the client; subsequent exec yields AECrashedError).
  });

  it("response with unknown requestId is silently ignored (no throw)", async () => {
    const client = new McpWsClient({ port: 12345 }, MockWebSocket as never);
    const p = client.connect();
    lastWs!._open();
    await p;

    expect(() => {
      lastWs!._message({ type: "result", requestId: "rid-orphan", data: 42 });
    }).not.toThrow();
  });
});
