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
});
