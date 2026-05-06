// Phase 3.6 — ToolDispatcher ↔ PanelBridge in-process integration.
//
// Unlike the other __integration__ tests in this folder (which spawn a
// real sidecar process via spawn-helper), this test wires real
// PanelBridge + real ToolDispatcher in-process and uses a mock panel
// WebSocket client to verify both directions:
//   - sidecar→panel round-trip: dispatcher.exec → panelBridge.sendToPrimary
//                                → mock panel sends result → onToolResponse
//                                → dispatcher resolves
//   - panel→sidecar smoke (backward compat): mock panel sends exec →
//                                            panelBridge.execHandler invoked
//                                            (Phase 4+ MCP direct path retained)
// Reasoning: dispatcher isn't wired into the actual sidecar entry point
// until Phase 3.7 (spike trigger) / Phase 4 (MCP). In-process testing
// here verifies the contract surface NOW, decoupled from the wiring
// timeline.
//
// Wiring pattern: lazy back-reference. dispatcher.send needs bridge,
// bridge.onToolResponse needs dispatcher — circular. Solved by
// declaring `let bridge` first, capturing it in dispatcher.send via
// closure (resolved at call time, not creation time), then setting
// bridge with onToolResponse: dispatcher.handleIncoming. Production
// wiring in index.ts (Phase 3.7/4) follows the same pattern.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { PanelBridge, type PtyLike, type ExecHandler } from "../ws/panelBridge.js";
import { createToolDispatcher, type ToolDispatcher } from "../dispatcher/toolDispatcher.js";
import type { Msg } from "../protocol.js";

function makeStubPty(): PtyLike {
  return {
    write() { /* unused */ },
    resize() { /* unused */ },
    onData() { return () => {}; },
    onExit() { return () => {}; },
    kill() { return Promise.resolve(); },
    getRecentOutput() { return []; },
  };
}

type Ws = WebSocket & { __queue: Msg[] };

async function openWs(url: string): Promise<Ws> {
  const ws = new WebSocket(url) as Ws;
  ws.__queue = [];
  ws.on("message", (raw: WebSocket.RawData) => {
    try { ws.__queue.push(JSON.parse(raw.toString()) as Msg); } catch { /* skip */ }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nextMessage(ws: Ws, predicate?: (m: Msg) => boolean, timeoutMs = 3000): Promise<Msg> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = ws.__queue.findIndex((m) => !predicate || predicate(m));
    if (idx >= 0) {
      const [msg] = ws.__queue.splice(idx, 1) as [Msg];
      return msg;
    }
    await delay(10);
  }
  throw new Error("timeout waiting for message");
}

function send(ws: WebSocket, msg: Msg) { ws.send(JSON.stringify(msg)); }

/** Wire dispatcher + bridge with lazy back-reference (mirrors production
 *  wiring in index.ts). Returns started bridge, dispatcher, and port. */
async function wireDispatcherAndBridge(opts?: { execHandler?: ExecHandler }): Promise<{
  bridge: PanelBridge;
  dispatcher: ToolDispatcher;
  port: number;
}> {
  let bridge: PanelBridge;
  const dispatcher = createToolDispatcher({
    send: (msg) => bridge.sendToPrimary(msg),
  });
  bridge = new PanelBridge({
    pty: makeStubPty(),
    execHandler: opts?.execHandler ?? (vi.fn() as unknown as ExecHandler),
    port: 0,
    heartbeatIntervalMs: 1_000_000,
    heartbeatTimeoutMs: 1_000_000,
    onToolResponse: dispatcher.handleIncoming,
  });
  const { port } = await bridge.start();
  return { bridge, dispatcher, port };
}

describe("ToolDispatcher ↔ PanelBridge integration (Phase 3.6)", () => {
  let bridge: PanelBridge | undefined;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = undefined;
    }
  });

  it("sidecar→panel round-trip: dispatcher.exec → mock panel result → resolve", async () => {
    const wired = await wireDispatcherAndBridge();
    bridge = wired.bridge;
    const { dispatcher, port } = wired;

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    const promise = dispatcher.exec({ tool: "ae_get_active_comp", input: { foo: "bar" } });

    const execOnPanel = await nextMessage(ws, (m) => m.type === "exec");
    expect(execOnPanel.type).toBe("exec");
    if (execOnPanel.type === "exec") {
      expect(execOnPanel.tool).toBe("ae_get_active_comp");
      expect(execOnPanel.input).toEqual({ foo: "bar" });

      send(ws, {
        type: "result",
        requestId: execOnPanel.requestId,
        data: { name: "Hero", frameRate: 24 },
      });
    }

    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "Hero", frameRate: 24 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(dispatcher.inflight).toBe(0);
    ws.close();
  });

  it("sidecar→panel error path: dispatcher.exec → mock panel error → ok:false", async () => {
    const wired = await wireDispatcherAndBridge();
    bridge = wired.bridge;
    const { dispatcher, port } = wired;

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    const promise = dispatcher.exec({ tool: "ae_get_active_comp", input: {} });

    const execOnPanel = await nextMessage(ws, (m) => m.type === "exec");
    if (execOnPanel.type === "exec") {
      send(ws, {
        type: "error",
        requestId: execOnPanel.requestId,
        code: "AENoActiveCompError",
        userMessage: "활성 컴프 없음",
        developerHint: "사용자에게 컴프 선택 제안",
      });
    }

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AENoActiveCompError");
      expect(result.userMessage).toBe("활성 컴프 없음");
    }
    ws.close();
  });

  it("panel→sidecar ExecHandler smoke: mock panel sends exec → ExecHandler invoked (backward compat)", async () => {
    const execHandler = vi.fn(async () => ({ result: "from-execHandler" }));
    const wired = await wireDispatcherAndBridge({
      execHandler: execHandler as unknown as ExecHandler,
    });
    bridge = wired.bridge;
    const { port } = wired;

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "exec", requestId: "rid-incoming", tool: "legacy.tool", input: { x: 1 } });

    const reply = await nextMessage(ws, (m) => m.type === "result");
    expect(reply).toMatchObject({
      type: "result",
      requestId: "rid-incoming",
      data: { result: "from-execHandler" },
    });
    expect(execHandler).toHaveBeenCalledWith(
      "legacy.tool",
      { x: 1 },
      expect.objectContaining({ requestId: "rid-incoming" }),
    );
    ws.close();
  });
});
