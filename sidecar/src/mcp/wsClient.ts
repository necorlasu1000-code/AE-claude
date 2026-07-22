// McpWsClient — reverse-connect to the sidecar main ws as ?role=mcp client.
//
// Phase 4 D-J: the MCP server entry script (mcp/server.ts, spawned by claude
// CLI as a stdio child) opens a ws to sidecar main using `?role=mcp`. Tool
// calls received over MCP stdio are translated to ExecMsg and sent here;
// the matching ResultMsg / ErrorMsg arrives back on the same ws and resolves
// the pending exec promise.
//
// Single in-flight tracking is requestId-keyed (Map). Timeout is owned by
// this client (DEFAULT_TIMEOUT_MS from protocol.ts — single source of truth
// per Phase 3.6 dispatcher precedent). On timeout we synthesize an ErrorMsg
// (no real bridge error came back) so callers can uniformly handle the result.
//
// Heartbeat echo (mistakes.md #12 — Phase 3.7 follow-up 5 pattern): receiving
// `sys.heartbeat` from the sidecar triggers an echo back so the watchdog's
// lastRecvAt advances and the mcp client isn't auto-closed at idle timeout.

import { WebSocket } from "ws";
import {
  DEFAULT_TIMEOUT_MS,
  type ExecMsg,
  type ResultMsg,
  type ErrorMsg,
} from "../protocol.js";

export interface McpWsClientOptions {
  host?: string;        // default "127.0.0.1"
  port: number;
  /** Per-call default timeout. Falls through to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

interface PendingExec {
  resolve: (msg: ResultMsg | ErrorMsg) => void;
  timer: NodeJS.Timeout;
}

/** Lightweight WebSocket interface — tests inject mocks via `wsCtor`. */
type WsCtor = new (url: string) => WsLike;
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (raw: { toString(): string }) => void): void;
  on(event: "close", cb: () => void): void;
  once(event: "open" | "error", cb: (err?: Error) => void): void;
}

export class McpWsClient {
  private ws: WsLike | undefined;
  private pending = new Map<string, PendingExec>();
  private idCounter = 0;
  // Reconnect state (audit item): without this, a sidecar restart (panel
  // reopen, crash recovery) left this MCP child connectionless for the rest
  // of the claude session — every tool call failed until claude itself was
  // restarted. On unexpected close we retry with capped backoff; exec()
  // keeps its fail-fast "not connected" answer between attempts.
  private closedByUser = false;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs = 1_000;

  constructor(
    private readonly opts: McpWsClientOptions,
    private readonly wsCtor: WsCtor = WebSocket as unknown as WsCtor,
  ) {}

  async connect(): Promise<void> {
    const host = this.opts.host ?? "127.0.0.1";
    const url = `ws://${host}:${this.opts.port}/?role=mcp`;
    const ws = new this.wsCtor(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e?: Error) => reject(e ?? new Error("ws error")));
    });
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    this.reconnectDelayMs = 1_000;   // successful connect resets backoff
    try {
      ws.on("close", () => this.scheduleReconnect());
    } catch { /* injected test mock without close support — no reconnect */ }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Issue an exec call to the sidecar. Resolves with either ResultMsg
   *  (success) or ErrorMsg (handler error / timeout / bridge error). The
   *  caller (mcp/server.ts) inspects msg.type to decide MCP response shape. */
  exec(tool: string, input: unknown): Promise<ResultMsg | ErrorMsg> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) {
      return Promise.resolve({
        type: "error",
        requestId: this.nextId(),
        code: "AECrashedError",
        userMessage: "Sidecar bridge not connected.",
        developerHint: "McpWsClient.connect() not called or ws closed.",
      });
    }
    const requestId = this.nextId();
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<ResultMsg | ErrorMsg>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          type: "error",
          requestId,
          code: "AETimeoutError",
          userMessage: "Tool exec timed out.",
          developerHint: `${timeoutMs}ms elapsed without response from sidecar.`,
        });
      }, timeoutMs);
      this.pending.set(requestId, { resolve, timer });

      const msg: ExecMsg = { type: "exec", requestId, tool, input };
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          type: "error",
          requestId,
          code: "AECrashedError",
          userMessage: "Failed to send exec to sidecar.",
          developerHint: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    try { this.ws?.close(1000, "client close"); } catch { /* best-effort */ }
    this.ws = undefined;
  }

  private nextId(): string {
    this.idCounter += 1;
    return `mcp-${Date.now()}-${this.idCounter}`;
  }

  private handleMessage(data: string): void {
    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(data); }
    catch { return; }

    if (msg.type === "result" || msg.type === "error") {
      const requestId = msg.requestId as string | undefined;
      if (!requestId) return;
      const p = this.pending.get(requestId);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(requestId);
      // Type narrowed by msg.type check above; the indexed parsed shape
      // doesn't structurally satisfy ResultMsg|ErrorMsg's required fields,
      // so route through `unknown` (callers downstream gate on msg.type
      // again before using requestId/data/code/userMessage).
      p.resolve(msg as unknown as ResultMsg | ErrorMsg);
      return;
    }
    if (msg.type === "sys.heartbeat") {
      // Echo back — keeps sidecar's watchdog lastRecvAt fresh (mistakes #12).
      const ws = this.ws;
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: "sys.heartbeat", ts: Date.now() })); }
        catch { /* best-effort */ }
      }
      return;
    }
    // sys.version / sys.shutting-down / pty.* / server.error / progress —
    // mcp client doesn't act on them. server.error untied to a requestId
    // is connection-level (e.g., AERoleNotAllowed for unexpected sends);
    // we don't expect those in normal flow.
  }
}
