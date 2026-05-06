// PanelBridge unit tests — 8 scenarios using mock PtyLike + real ws clients.
// PtyHost itself has its own smoke test; here we focus on bridge logic
// (routing, exec lifecycle, chunking, multi-client policy).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { PanelBridge, type PtyLike, type ExecHandler } from "./panelBridge.js";
import type { Msg, ResultChunkMsg } from "../protocol.js";

// ─── Mock helpers ──────────────────────────────────────────────────

function makeMockPty() {
  const dataCbs = new Set<(data: string) => void>();
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  const buffer: string[] = [];

  const pty: PtyLike & {
    emitData: (data: string) => void;
    writes: string[];
    resizes: Array<[number, number]>;
    setBuffer: (lines: string[]) => void;
  } = {
    write(data: string) { writes.push(data); },
    resize(cols: number, rows: number) { resizes.push([cols, rows]); },
    onData(cb) {
      dataCbs.add(cb);
      return () => { dataCbs.delete(cb); };
    },
    getRecentOutput() { return [...buffer]; },
    emitData(data: string) {
      for (const cb of dataCbs) cb(data);
    },
    writes,
    resizes,
    setBuffer(lines: string[]) { buffer.length = 0; buffer.push(...lines); },
  };
  return pty;
}

// Augmented WS with a backing message queue. All messages from the server
// are pushed to __queue immediately on arrival; nextMessage polls the queue.
// This avoids the race where sys.version arrives before a per-call listener
// is attached and gets dropped.
type Ws = WebSocket & { __queue: Msg[] };

async function openWs(url: string): Promise<Ws> {
  const ws = new WebSocket(url) as Ws;
  ws.__queue = [];
  ws.on("message", (raw: WebSocket.RawData) => {
    try { ws.__queue.push(JSON.parse(raw.toString()) as Msg); } catch { /* skip malformed */ }
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
    await delay(20);
  }
  throw new Error("timeout waiting for message" + (predicate ? " matching predicate" : ""));
}

function send(ws: WebSocket, msg: Msg) { ws.send(JSON.stringify(msg)); }

// ─── Suite ─────────────────────────────────────────────────────────

describe("PanelBridge", () => {
  let bridge: PanelBridge;
  let port: number;
  let pty: ReturnType<typeof makeMockPty>;
  let execHandler: ExecHandler;
  let url: string;

  beforeEach(async () => {
    pty = makeMockPty();
    execHandler = vi.fn(async () => ({ ok: true })) as ExecHandler;
    bridge = new PanelBridge({
      pty,
      execHandler,
      port: 0,
      host: "127.0.0.1",
      heartbeatIntervalMs: 60_000,    // disable noise during tests
      heartbeatTimeoutMs: 60_000,
      watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    url = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await bridge.stop();
  });

  // ── 1 ────────────────────────────────────────────────────────────
  it("greets new client with sys.version", async () => {
    const ws = await openWs(url);
    const msg = await nextMessage(ws, (m) => m.type === "sys.version");
    expect(msg.type).toBe("sys.version");
    if (msg.type === "sys.version") {
      expect(msg.protocolVersion).toBe(1);
      expect(msg.sidecarVersion).toMatch(/\d+\.\d+\.\d+/);
    }
    ws.close();
  });

  // ── 2 ────────────────────────────────────────────────────────────
  it("forwards pty.in to pty.write", async () => {
    const ws = await openWs(url);
    await nextMessage(ws, (m) => m.type === "sys.version");
    send(ws, { type: "pty.in", data: "ls\r" });
    await delay(50);
    expect(pty.writes).toEqual(["ls\r"]);
    ws.close();
  });

  // ── 3 ────────────────────────────────────────────────────────────
  it("broadcasts pty.out when pty emits data", async () => {
    const ws = await openWs(url);
    await nextMessage(ws, (m) => m.type === "sys.version");
    const out = nextMessage(ws, (m) => m.type === "pty.out");
    pty.emitData("hello world\r\n");
    const msg = await out;
    expect(msg.type).toBe("pty.out");
    if (msg.type === "pty.out") expect(msg.data).toBe("hello world\r\n");
    ws.close();
  });

  // ── 4 ────────────────────────────────────────────────────────────
  it("exec: handler resolve → result message", async () => {
    execHandler = vi.fn(async (tool: string, input: unknown) => ({ tool, echoed: input })) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "exec", requestId: "r1", tool: "ae_get_active_comp", input: { foo: 1 } });
    const result = await nextMessage(ws, (m) => m.type === "result");
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.requestId).toBe("r1");
      expect(result.data).toEqual({ tool: "ae_get_active_comp", echoed: { foo: 1 } });
    }
    ws.close();
  });

  // ── 5 ────────────────────────────────────────────────────────────
  it("exec: timeout → AETimeoutError", async () => {
    let neverResolve: () => void;
    execHandler = vi.fn(() => new Promise(() => { neverResolve = () => {}; })) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "exec", requestId: "r2", tool: "slow", input: {}, timeoutMs: 200 });
    const err = await nextMessage(ws, (m) => m.type === "error", 2000);
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.requestId).toBe("r2");
      expect(err.code).toBe("AETimeoutError");
    }
    ws.close();
  });

  // ── 6 ────────────────────────────────────────────────────────────
  it("exec: cancel → handler signal aborts + AECancelledError", async () => {
    let capturedSignal: AbortSignal | undefined;
    execHandler = vi.fn(async (_tool, _input, ctx) => {
      capturedSignal = ctx.signal;
      await new Promise((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { ok: true };
    }) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "exec", requestId: "r3", tool: "long", input: {} });
    await delay(50);
    expect(capturedSignal?.aborted).toBe(false);
    send(ws, { type: "cancel", requestId: "r3" });
    const err = await nextMessage(ws, (m) => m.type === "error");
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.code).toBe("AECancelledError");
      expect(err.requestId).toBe("r3");
    }
    expect(capturedSignal?.aborted).toBe(true);
    ws.close();
  });

  // ── 7 ────────────────────────────────────────────────────────────
  it("exec: oversized result → result.chunk sequence", async () => {
    // Use a small CHUNK_THRESHOLD by returning >10MB. Build a string just over 10MB.
    const big = "x".repeat(11 * 1024 * 1024);
    execHandler = vi.fn(async () => big) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "exec", requestId: "r4", tool: "big", input: {}, timeoutMs: 30_000 });

    const chunks: ResultChunkMsg[] = [];
    // Collect first chunk to learn `total`, then collect the rest.
    const first = await nextMessage(ws, (m) => m.type === "result.chunk" && m.requestId === "r4", 10_000);
    if (first.type !== "result.chunk") throw new Error("expected result.chunk");
    chunks.push(first);
    const total = first.total;
    expect(total).toBeGreaterThanOrEqual(2);
    while (chunks.length < total) {
      const m = await nextMessage(ws, (x) => x.type === "result.chunk" && x.requestId === "r4", 10_000);
      if (m.type === "result.chunk") chunks.push(m);
    }
    expect(chunks.length).toBe(total);
    chunks.sort((a, b) => a.seq - b.seq);
    expect(chunks.map((c) => c.seq)).toEqual([...Array(total).keys()]);
    ws.close();
  }, 15_000);

  // ── 9 ────────────────────────────────────────────────────────────
  it("UTF-8 round-trip: Korean + emoji in exec input echoed byte-identical", async () => {
    // Echo handler — returns input verbatim. Validates that JSON.stringify
    // (panel side, simulated by send()) → text frame → JSON.parse (sidecar
    // decode()) → handler echo → encode() → text frame → JSON.parse (test
    // assertion) preserves multi-byte characters.
    execHandler = vi.fn(async (_tool: string, input: unknown) => input) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    const payload = {
      compName: "오프닝 타이틀_v3",
      layerName: "배경 솔리드 #1",
      emoji: "🎬✨",
      mixed: "Logo - 로고 합성 - シーン1",
    };
    send(ws, { type: "exec", requestId: "r9", tool: "echo", input: payload });
    const result = await nextMessage(ws, (m) => m.type === "result");
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.requestId).toBe("r9");
      expect(result.data).toEqual(payload);
    }
    ws.close();
  });

  // ── 10 ───────────────────────────────────────────────────────────
  it("UTF-8 pty.in: Korean string forwards to pty.write byte-identical", async () => {
    const ws = await openWs(url);
    await nextMessage(ws, (m) => m.type === "sys.version");
    const koreanInput = "한글 입력 테스트\r";
    send(ws, { type: "pty.in", data: koreanInput });
    await delay(50);
    // Sidecar must NOT mangle the string between WS decode and pty.write.
    // (If pty.write itself drops bytes due to OS code page, that's a separate
    // concern handled by the "Phase 2 후속 / 한글 인코딩 검증 필요" mistakes.md
    // entry — verified at #5/#8 with real PTY.)
    expect(pty.writes).toEqual([koreanInput]);
    ws.close();
  });

  // ── 11 ───────────────────────────────────────────────────────────
  it("scenario 11: sys.shutdown from primary triggers onShutdownRequest + broadcasts ack to all clients", async () => {
    const onShutdownRequest = vi.fn();
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
      onShutdownRequest,
    });
    ({ port } = await bridge.start());

    const wsA = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsA, (m) => m.type === "sys.version");
    const wsB = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsB, (m) => m.type === "sys.version");

    // Secondary client's sys.shutdown is refused (write authority).
    send(wsB, { type: "sys.shutdown", reason: "from-secondary" });
    const refused = await nextMessage(wsB, (m) => m.type === "server.error");
    expect(refused.type).toBe("server.error");
    if (refused.type === "server.error") expect(refused.code).toBe("AEMultiClientRefused");
    expect(onShutdownRequest).not.toHaveBeenCalled();

    // Primary's sys.shutdown: handler fires, BOTH clients receive ack.
    send(wsA, { type: "sys.shutdown", reason: "from-primary" });

    const ackA = await nextMessage(wsA, (m) => m.type === "sys.shutting-down");
    const ackB = await nextMessage(wsB, (m) => m.type === "sys.shutting-down");
    expect(ackA.type).toBe("sys.shutting-down");
    expect(ackB.type).toBe("sys.shutting-down");
    if (ackA.type === "sys.shutting-down") expect(ackA.reason).toBe("from-primary");

    expect(onShutdownRequest).toHaveBeenCalledTimes(1);
    expect(onShutdownRequest).toHaveBeenCalledWith("from-primary");

    wsA.close();
    wsB.close();
  });

  // ── 12 ───────────────────────────────────────────────────────────
  it("scenario 12: last client disconnect + grace elapses → onShutdownRequest('panel-disconnect')", async () => {
    const onShutdownRequest = vi.fn();
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
      onShutdownRequest,
      clientDisconnectGracePeriodMs: 60,    // short grace for fast tests
    });
    ({ port } = await bridge.start());

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    ws.close();
    // Wait past the grace window. onShutdownRequest fires after grace
    // elapses with zero clients still attached.
    await delay(150);
    expect(onShutdownRequest).toHaveBeenCalledTimes(1);
    expect(onShutdownRequest).toHaveBeenCalledWith("panel-disconnect");
  });

  // ── 13 ───────────────────────────────────────────────────────────
  it("scenario 13: client reconnects within grace → onShutdownRequest NOT called", async () => {
    const onShutdownRequest = vi.fn();
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
      onShutdownRequest,
      clientDisconnectGracePeriodMs: 200,
    });
    ({ port } = await bridge.start());

    const wsA = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsA, (m) => m.type === "sys.version");

    wsA.close();
    await delay(50);    // mid-grace: timer is pending but hasn't fired

    // New panel reconnects (e.g., user reopened the CEP panel) — should
    // cancel the pending grace timer.
    const wsB = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsB, (m) => m.type === "sys.version");

    // Wait past the original grace window — onShutdownRequest must NOT fire.
    await delay(250);
    expect(onShutdownRequest).not.toHaveBeenCalled();
    wsB.close();
  });

  // ── 14 (mistakes.md #12) ─────────────────────────────────────────
  // Heartbeat-timeout-driven close path: idle client never echoes
  // sys.heartbeat → watchdog observes stale lastRecvAt → sidecar issues
  // ws.close(1001, "heartbeat timeout") → grace elapses → onShutdownRequest
  // ("panel-disconnect"). This complements scenario 12 (active close from
  // client) and scenario 13 (reconnect-within-grace) by covering the
  // sidecar-initiated close trigger.
  it("scenario 14: idle client (no heartbeat echo) → watchdog closes + 'panel-disconnect' fires", async () => {
    const onShutdownRequest = vi.fn();
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000,        // disable broadcast (irrelevant here)
      heartbeatTimeoutMs: 100,            // tight: watchdog closes after 100ms idle
      watchdogIntervalMs: 50,             // check every 50ms
      onShutdownRequest,
      clientDisconnectGracePeriodMs: 80,
    });
    ({ port } = await bridge.start());

    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    // Idle: no pty.in / heartbeat echo / any send. Watchdog should close
    // the connection within ~150ms (timeout + watchdog tick latency).
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      // Safety bail (test timeout default still applies).
      setTimeout(() => resolve(), 1000);
    });
    expect(ws.readyState).toBe(3 /* CLOSED */);

    // Grace (80ms) past close → onShutdownRequest("panel-disconnect").
    await delay(150);
    expect(onShutdownRequest).toHaveBeenCalledWith("panel-disconnect");
  });

  // ── 8 ────────────────────────────────────────────────────────────
  it("multi-client: secondary's pty.in refused with AEMultiClientRefused", async () => {
    const wsA = await openWs(url);
    await nextMessage(wsA, (m) => m.type === "sys.version");

    const wsB = await openWs(url);
    await nextMessage(wsB, (m) => m.type === "sys.version");

    const refusal = nextMessage(wsB, (m) => m.type === "server.error");
    send(wsB, { type: "pty.in", data: "secondary input\r" });
    const msg = await refusal;
    expect(msg.type).toBe("server.error");
    if (msg.type === "server.error") {
      expect(msg.code).toBe("AEMultiClientRefused");
    }
    expect(pty.writes).toEqual([]);  // mock pty NOT written

    // Primary still works
    send(wsA, { type: "pty.in", data: "primary input\r" });
    await delay(50);
    expect(pty.writes).toEqual(["primary input\r"]);

    wsA.close();
    wsB.close();
  });

  // ─── Phase 3 — bidirectional ToolDispatcher integration points ────

  it("scenario 14: panel sends result/error/result.chunk → onToolResponse fires", async () => {
    const calls: Msg[] = [];
    bridge = new PanelBridge({
      pty: makeMockPty(),
      execHandler: vi.fn() as unknown as ExecHandler,
      port: 0,
      heartbeatIntervalMs: 1_000_000,
      heartbeatTimeoutMs: 1_000_000,
      onToolResponse: (m) => calls.push(m),
    });
    const { port } = await bridge.start();
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "result", requestId: "rid-1", data: { hello: "world" } });
    send(ws, { type: "error", requestId: "rid-2", code: "AEScriptError", userMessage: "x", developerHint: "y" });
    send(ws, { type: "result.chunk", requestId: "rid-3", seq: 0, total: 2, data: "{\"a" });
    await delay(80);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ type: "result", requestId: "rid-1" });
    expect(calls[1]).toMatchObject({ type: "error", requestId: "rid-2", code: "AEScriptError" });
    expect(calls[2]).toMatchObject({ type: "result.chunk", requestId: "rid-3", seq: 0, total: 2 });
    ws.close();
  });

  it("scenario 15: onToolResponse undefined → server.error AEUnexpectedMsg (backward compat)", async () => {
    bridge = new PanelBridge({
      pty: makeMockPty(),
      execHandler: vi.fn() as unknown as ExecHandler,
      port: 0,
      heartbeatIntervalMs: 1_000_000,
      heartbeatTimeoutMs: 1_000_000,
      // onToolResponse intentionally omitted
    });
    const { port } = await bridge.start();
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    send(ws, { type: "result", requestId: "rid-orphan", data: 42 });
    const reply = await nextMessage(ws, (m) => m.type === "server.error");
    expect(reply.type).toBe("server.error");
    if (reply.type === "server.error") {
      expect(reply.code).toBe("AEUnexpectedMsg");
      expect(reply.developerHint).toMatch(/no dispatcher wired/);
    }
    ws.close();
  });

  it("scenario 16: sendToPrimary delivers exec only to primary, not secondaries", async () => {
    bridge = new PanelBridge({
      pty: makeMockPty(),
      execHandler: vi.fn() as unknown as ExecHandler,
      port: 0,
      heartbeatIntervalMs: 1_000_000,
      heartbeatTimeoutMs: 1_000_000,
    });
    const { port } = await bridge.start();

    const wsA = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsA, (m) => m.type === "sys.version");
    const wsB = await openWs(`ws://127.0.0.1:${port}`);
    await nextMessage(wsB, (m) => m.type === "sys.version");

    bridge.sendToPrimary({
      type: "exec",
      requestId: "rid-out-1",
      tool: "ae_get_active_comp",
      input: {},
    });

    const primaryGot = await nextMessage(wsA, (m) => m.type === "exec");
    expect(primaryGot).toMatchObject({ type: "exec", requestId: "rid-out-1", tool: "ae_get_active_comp" });

    // wsB (secondary) should NOT receive the exec — verify queue stays empty
    // for a short window (no timeout-based flake; either it arrives in 80ms
    // or it never arrives because it was never sent).
    await delay(80);
    const execOnB = wsB.__queue.find((m) => m.type === "exec");
    expect(execOnB).toBeUndefined();

    wsA.close();
    wsB.close();
  });

  // ── 18 (Phase 4.1 D-J) ────────────────────────────────────────────
  // ?role=mcp client connects → state.role = "mcp", greeted with sys.version
  // identically to a panel client (greeting is role-agnostic — it identifies
  // the sidecar, not the client). The fact that sys.version is received
  // confirms the upgrade succeeded with the role query.
  it("scenario 18: mcp client connects via ?role=mcp and is greeted with sys.version", async () => {
    const wsMcp = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    const greeting = await nextMessage(wsMcp, (m) => m.type === "sys.version");
    expect(greeting.type).toBe("sys.version");
    wsMcp.close();
  });

  // ── 19 (Phase 4.1 D-J) ────────────────────────────────────────────
  // Per-role primary independence: a panel client and an mcp client connect
  // simultaneously; each is the primary of its own role. Both can issue
  // exec calls — the panel exec is forwarded to ExecHandler exactly once
  // for each (no AEMultiClientRefused cross-role).
  it("scenario 19: panel primary + mcp primary independent, both can exec", async () => {
    const calls: Array<{ tool: string; input: unknown }> = [];
    const handler: ExecHandler = vi.fn(async (tool, input) => {
      calls.push({ tool, input });
      return { from: tool };
    }) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler: handler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());

    const wsPanel = await openWs(`ws://127.0.0.1:${port}/`);
    await nextMessage(wsPanel, (m) => m.type === "sys.version");
    const wsMcp = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    await nextMessage(wsMcp, (m) => m.type === "sys.version");

    // panel primary issues exec
    send(wsPanel, { type: "exec", requestId: "rid-panel-1", tool: "ae_panel_tool", input: {} });
    const panelResult = await nextMessage(wsPanel, (m) => m.type === "result");
    expect(panelResult).toMatchObject({ type: "result", requestId: "rid-panel-1" });

    // mcp primary issues exec — succeeds independently (not refused)
    send(wsMcp, { type: "exec", requestId: "rid-mcp-1", tool: "ae_mcp_tool", input: {} });
    const mcpResult = await nextMessage(wsMcp, (m) => m.type === "result");
    expect(mcpResult).toMatchObject({ type: "result", requestId: "rid-mcp-1" });

    expect(calls).toEqual([
      { tool: "ae_panel_tool", input: {} },
      { tool: "ae_mcp_tool", input: {} },
    ]);
    wsPanel.close();
    wsMcp.close();
  });

  // ── 20 (Phase 4.1 D-J) ────────────────────────────────────────────
  // mcp role is restricted to exec/cancel writes. pty.in is panel-only;
  // an mcp client sending pty.in must receive AERoleNotAllowed (not
  // AEMultiClientRefused — they're the role primary, just on the wrong
  // message type).
  it("scenario 20: mcp client pty.in refused with AERoleNotAllowed", async () => {
    const wsMcp = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    await nextMessage(wsMcp, (m) => m.type === "sys.version");

    send(wsMcp, { type: "pty.in", data: "ls\r" });
    const reply = await nextMessage(wsMcp, (m) => m.type === "server.error");
    expect(reply.type).toBe("server.error");
    if (reply.type === "server.error") {
      expect(reply.code).toBe("AERoleNotAllowed");
      expect(reply.ctx).toMatchObject({ role: "mcp", refusedType: "pty.in" });
    }
    wsMcp.close();
  });

  // ── 22 (Phase 4.3) ────────────────────────────────────────────────
  // initialServerError option: when set, every newly connected client
  // receives a server.error envelope right after sys.version. Used by
  // index.ts to surface "claude CLI not found" without crashing the
  // sidecar. The panel routes server.error through useTerminal's existing
  // setError handler — no panel-side change required.
  it("scenario 22: initialServerError → broadcast to each new client after sys.version", async () => {
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
      initialServerError: {
        code: "AEShellNotFoundError",
        userMessage: "Shell 'claude' not found in PATH.",
        developerHint: "Install Claude Code CLI.",
      },
    });
    ({ port } = await bridge.start());

    const ws = await openWs(`ws://127.0.0.1:${port}/`);
    // Order: sys.version first, then server.error.
    const greet = await nextMessage(ws, (m) => m.type === "sys.version");
    expect(greet.type).toBe("sys.version");
    const err = await nextMessage(ws, (m) => m.type === "server.error");
    expect(err).toMatchObject({
      type: "server.error",
      code: "AEShellNotFoundError",
      userMessage: "Shell 'claude' not found in PATH.",
      developerHint: "Install Claude Code CLI.",
    });
    ws.close();

    // Second client also receives the same error (broadcast per-connect).
    const ws2 = await openWs(`ws://127.0.0.1:${port}/`);
    await nextMessage(ws2, (m) => m.type === "sys.version");
    const err2 = await nextMessage(ws2, (m) => m.type === "server.error");
    expect(err2).toMatchObject({ type: "server.error", code: "AEShellNotFoundError" });
    ws2.close();
  });

  // ── 21 (Phase 4.1 D-J) ────────────────────────────────────────────
  // mcp role's only writes are exec + cancel. cancel from mcp aborts an
  // in-flight exec issued by that same mcp client (handler signal fires).
  it("scenario 21: mcp cancel aborts in-flight mcp exec", async () => {
    let abortFired = false;
    const handler: ExecHandler = vi.fn(async (_tool, _input, ctx) => {
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => { abortFired = true; resolve(); }, { once: true });
        // Long-running — only abort path resolves it within the test.
        setTimeout(resolve, 5_000);
      });
      throw new Error("__abort");
    }) as ExecHandler;
    await bridge.stop();
    bridge = new PanelBridge({
      pty, execHandler: handler, port: 0, host: "127.0.0.1",
      heartbeatIntervalMs: 60_000, heartbeatTimeoutMs: 60_000, watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());

    const wsMcp = await openWs(`ws://127.0.0.1:${port}/?role=mcp`);
    await nextMessage(wsMcp, (m) => m.type === "sys.version");

    send(wsMcp, { type: "exec", requestId: "rid-mcp-cancel", tool: "ae_long_tool", input: {} });
    await delay(30);  // allow handler to start + register abort listener
    send(wsMcp, { type: "cancel", requestId: "rid-mcp-cancel" });

    const err = await nextMessage(wsMcp, (m) => m.type === "error");
    expect(err).toMatchObject({
      type: "error", requestId: "rid-mcp-cancel", code: "AECancelledError",
    });
    expect(abortFired).toBe(true);
    wsMcp.close();
  });
});
