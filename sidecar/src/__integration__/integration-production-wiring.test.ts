// Phase 4.4 fix-4 (mistakes #15) — production wiring assembly point coverage.
//
// Earlier integration tests inject mock execHandlers (integration-mcp,
// integration-dispatcher, panelBridge.test). They prove every individual
// edge of the wiring graph but bypass the actual assembly: index.ts's
// `execHandler: makeDispatcherExecHandler(dispatcher)`. Phase 4.1's commit
// left a `stubExecHandler` that throws AENotImplementedError for ~150
// commits while every test stayed green.
//
// This test stands in as the regression guard for that exact assembly:
// real PanelBridge + real ToolDispatcher + real makeDispatcherExecHandler,
// mock panel client (?role=panel) + mock mcp client (?role=mcp). The
// mcp side sends an exec; the panel side observes the forwarded exec and
// replies; the mcp side observes the result. If anyone replaces the
// helper with a stub or breaks the lazy back-reference, this test fails.

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { PanelBridge, type PtyLike } from "../ws/panelBridge.js";
import { createToolDispatcher } from "../dispatcher/toolDispatcher.js";
import { makeDispatcherExecHandler } from "../dispatcher/execHandler.js";
import type { Msg } from "../protocol.js";

function makeStubPty(): PtyLike {
  return {
    write() {},
    resize() {},
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
    try { ws.__queue.push(JSON.parse(raw.toString()) as Msg); } catch { /* */ }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nextMessage(
  ws: Ws,
  predicate?: (m: Msg) => boolean,
  timeoutMs = 3000,
): Promise<Msg> {
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

/** Wire the production assembly: dispatcher + makeDispatcherExecHandler +
 *  PanelBridge with the lazy back-reference. Mirrors index.ts main(). */
async function wireProduction(): Promise<{ bridge: PanelBridge; port: number }> {
  let bridge: PanelBridge;
  const dispatcher = createToolDispatcher({
    send: (msg) => bridge.sendToPrimary(msg),
  });
  bridge = new PanelBridge({
    pty: makeStubPty(),
    execHandler: makeDispatcherExecHandler(dispatcher),
    port: 0,
    heartbeatIntervalMs: 1_000_000,
    heartbeatTimeoutMs: 1_000_000,
    onToolResponse: dispatcher.handleIncoming,
  });
  const { port } = await bridge.start();
  return { bridge, port };
}

describe("Phase 4.4 fix-4 — production wiring (mistakes #15)", () => {
  let bridge: PanelBridge | undefined;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
      bridge = undefined;
    }
  });

  it("mcp role exec → dispatcher → panel role exec → result → mcp result (round-trip)", async () => {
    const wired = await wireProduction();
    bridge = wired.bridge;
    const { port } = wired;

    // Panel role (default) connects first → becomes primary panel client.
    const panelWs = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(panelWs, (m) => m.type === "sys.version");

    // MCP role connects → becomes primary mcp client.
    const mcpWs = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    await nextMessage(mcpWs, (m) => m.type === "sys.version");

    // MCP client sends exec. PanelBridge.handleExec → makeDispatcherExecHandler
    // → dispatcher.exec → sendToPrimary forwards to panelWs.
    send(mcpWs, {
      type: "exec",
      requestId: "mcp-rid-1",
      tool: "ae_get_active_comp",
      input: { foo: "bar" },
    });

    // Panel observes the dispatcher-forwarded exec (its requestId is the
    // dispatcher's internal one, NOT "mcp-rid-1"). The dispatcher allocates
    // a fresh UUID per exec — so we filter by tool, not by requestId.
    const execOnPanel = await nextMessage(panelWs, (m) => m.type === "exec");
    expect(execOnPanel.type).toBe("exec");
    if (execOnPanel.type !== "exec") return;
    expect(execOnPanel.tool).toBe("ae_get_active_comp");
    expect(execOnPanel.input).toEqual({ foo: "bar" });
    expect(execOnPanel.requestId).not.toBe("mcp-rid-1");

    // Panel replies with a result on the dispatcher's requestId.
    send(panelWs, {
      type: "result",
      requestId: execOnPanel.requestId,
      data: { name: "Hero", w: 1920, h: 1080 },
    });

    // MCP observes the bridge's response on the original mcp-rid-1.
    const resultOnMcp = await nextMessage(mcpWs, (m) =>
      m.type === "result" && m.requestId === "mcp-rid-1",
    );
    expect(resultOnMcp).toMatchObject({
      type: "result",
      requestId: "mcp-rid-1",
      data: { name: "Hero", w: 1920, h: 1080 },
    });

    panelWs.close();
    mcpWs.close();
  });

  it("mcp role exec → panel error → mcp error (AEError code preserved through dispatcher)", async () => {
    const wired = await wireProduction();
    bridge = wired.bridge;
    const { port } = wired;

    const panelWs = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(panelWs, (m) => m.type === "sys.version");
    const mcpWs = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    await nextMessage(mcpWs, (m) => m.type === "sys.version");

    send(mcpWs, {
      type: "exec",
      requestId: "mcp-rid-err",
      tool: "ae_get_active_comp",
      input: {},
    });

    const execOnPanel = await nextMessage(panelWs, (m) => m.type === "exec");
    if (execOnPanel.type !== "exec") return;

    send(panelWs, {
      type: "error",
      requestId: execOnPanel.requestId,
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
    });

    // Bridge re-emits as error on the mcp side. The code/userMessage/
    // developerHint triple flows through dispatcher → makeDispatcherExecHandler
    // (throws AEError) → PanelBridge.toErrorMsg (instanceof check preserves it).
    const errOnMcp = await nextMessage(mcpWs, (m) =>
      m.type === "error" && m.requestId === "mcp-rid-err",
    );
    expect(errOnMcp).toMatchObject({
      type: "error",
      requestId: "mcp-rid-err",
      code: "AENoActiveCompError",
      userMessage: "활성 컴프 없음",
      developerHint: "사용자에게 컴프 선택 제안",
    });

    panelWs.close();
    mcpWs.close();
  });
});
