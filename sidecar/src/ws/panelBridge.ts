// PanelBridge — sidecar's WebSocket server. Single primary client policy:
// the first connected client owns write authority (pty.in/pty.resize/exec/cancel).
// Secondary clients receive AEMultiClientRefused and may only consume read-only
// streams (pty.out / sys.heartbeat / sys.version / pty.replay).
//
// All message envelopes go through protocol.ts — D6 single source of truth.
// PtyHost is injected via PtyLike interface (testability + dependency inversion).
// ExecHandler is injected from index.ts (Phase 4 wires it to MCP dispatch).
//
// Bidirectional message routing (Phase 3 design clarification):
//   panel → sidecar : pty.in / pty.resize / exec / cancel / approval.response
//                     / sys.shutdown / sys.heartbeat
//                     (`exec` lands in ExecHandler — Phase 4+ MCP direct path)
//   sidecar → panel : pty.out / pty.replay / sys.version / sys.shutting-down
//                     / approval.request / progress / server.error
//                     /  exec / cancel  (NEW Phase 3 — outbound from
//                                        ToolDispatcher via sendToPrimary)
//   panel → sidecar (Phase 3 NEW)
//                   : result / error / result.chunk
//                     (responses to dispatcher's outbound exec; routed
//                      through the optional `onToolResponse` callback to
//                      ToolDispatcher.handleIncoming)
// Phase 1 only implemented panel→sidecar exec (single-direction). Phase 3
// adds the reverse direction for ExtendScript bridge. ExecHandler retained
// for Phase 4+ MCP direct dispatch.

import { WebSocketServer, WebSocket } from "ws";
import {
  encode,
  decode,
  chunkResult,
  DEFAULT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  type Msg,
  type ExecMsg,
  type CancelMsg,
  type ResultMsg,
  type ErrorMsg,
  type ResultChunkMsg,
  type RequestId,
} from "../protocol.js";
import { AEError } from "../tools/_errors.js";

// ─── Public types ───────────────────────────────────────────────────

export interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  getRecentOutput(maxLines?: number): string[];
}

export interface ExecCtx {
  requestId: RequestId;
  signal: AbortSignal;
  progress: (fraction: number, label?: string) => void;
}

export type ExecHandler = (tool: string, input: unknown, ctx: ExecCtx) => Promise<unknown>;

export interface PanelBridgeOptions {
  pty: PtyLike;
  execHandler: ExecHandler;
  port?: number;                    // 0 = OS-assigned
  host?: string;                    // default "127.0.0.1" (S1: localhost only)
  heartbeatIntervalMs?: number;     // default 10_000
  heartbeatTimeoutMs?: number;      // default 30_000
  watchdogIntervalMs?: number;      // default 5_000
  sidecarVersion?: string;          // default "0.1.0"
  replayLines?: number;             // default 1_000 (subset of ring buffer for reconnect)
  /**
   * Called when a primary client sends sys.shutdown. Wired in index.ts to
   * trigger gracefulShutdown(). Bridge has already broadcast sys.shutting-down
   * before this fires, so external code only needs to start the actual cleanup.
   *
   * ALSO called when the last client disconnects without sending sys.shutdown
   * AND the disconnect grace period elapses without a new connection — this
   * covers the CEP panel-close case where async React cleanup can't finish
   * before panel runtime exits. See Phase 2.8.4 fix-3.
   */
  onShutdownRequest?: (reason?: string) => void;
  /**
   * After the LAST client disconnects, wait this long for a new connection
   * before calling onShutdownRequest("panel-disconnect"). Default 5000 (5s).
   * Set to 0 to disable auto-shutdown on last-disconnect (sys.shutdown remains
   * the only graceful-trigger).
   */
  clientDisconnectGracePeriodMs?: number;
  /**
   * Phase 3 — incoming result/error/result.chunk routing. Wired by index.ts
   * to ToolDispatcher.handleIncoming. When undefined, those message types
   * are still rejected with AEUnexpectedMsg server.error (Phase 1 backward
   * compat — clients shouldn't be sending sidecar-bound responses unless
   * a dispatcher has been wired to receive them).
   */
  onToolResponse?: (msg: ResultMsg | ErrorMsg | ResultChunkMsg) => void;
}

// ─── Internal state ────────────────────────────────────────────────

interface PendingExec {
  abort: AbortController;
  timer: NodeJS.Timeout;
  ws: WebSocket;             // only this client gets the response
  timedOut: boolean;
  cancelledByClient: boolean;
}

interface ClientState {
  lastRecvAt: number;
}

// Write-authority message types — primary client only.
const WRITE_TYPES: ReadonlySet<Msg["type"]> = new Set([
  "pty.in",
  "pty.resize",
  "exec",
  "cancel",
  "approval.response",
  "sys.shutdown",          // primary-only per Phase 2.5.5.0 design
]);

// ─── PanelBridge ───────────────────────────────────────────────────

export class PanelBridge {
  private wss: WebSocketServer | undefined;
  private clients = new Map<WebSocket, ClientState>();
  private primary: WebSocket | undefined;
  private pending = new Map<RequestId, PendingExec>();

  private heartbeatTimer: NodeJS.Timeout | undefined;
  private watchdogTimer: NodeJS.Timeout | undefined;
  private ptyUnsubscribe: (() => void) | undefined;
  /** Timer set when last client disconnects; canceled if new client connects. */
  private clientDisconnectTimer: NodeJS.Timeout | undefined;
  /** Set true when stop() begins so client-disconnect grace doesn't double-fire shutdown. */
  private stopping = false;

  constructor(private readonly opts: PanelBridgeOptions) {}

  get listening(): boolean {
    return this.wss !== undefined;
  }

  get port(): number | undefined {
    const addr = this.wss?.address();
    return typeof addr === "object" && addr !== null ? addr.port : undefined;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async start(): Promise<{ port: number }> {
    if (this.wss) throw new Error("PanelBridge already started");

    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? "127.0.0.1",
        port: this.opts.port ?? 0,
      });

      const onError = (e: Error) => {
        wss.close();
        reject(e);
      };
      wss.once("error", onError);
      wss.once("listening", () => {
        wss.off("error", onError);
        this.wss = wss;
        this.setupPtyForward();
        this.setupHeartbeat();
        this.setupWatchdog();
        wss.on("connection", (ws) => this.handleConnection(ws));
        wss.on("error", () => {
          /* runtime errors after listen — individual ws errors handle themselves */
        });
        const addr = wss.address();
        const port = typeof addr === "object" && addr !== null ? addr.port : 0;
        resolve({ port });
      });
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    if (this.clientDisconnectTimer) {
      clearTimeout(this.clientDisconnectTimer);
      this.clientDisconnectTimer = undefined;
    }
    this.ptyUnsubscribe?.();
    this.ptyUnsubscribe = undefined;

    for (const p of this.pending.values()) {
      try { p.abort.abort(); } catch { /* best-effort */ }
      clearTimeout(p.timer);
    }
    this.pending.clear();

    for (const ws of this.clients.keys()) {
      try { ws.close(1001, "server stopping"); } catch { /* best-effort */ }
    }
    this.clients.clear();
    this.primary = undefined;

    return new Promise((resolve) => {
      const wss = this.wss;
      this.wss = undefined;
      if (!wss) {
        resolve();
        return;
      }
      wss.close(() => resolve());
    });
  }

  // ─── Connection lifecycle ────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    // New client arrived — cancel any pending auto-shutdown grace timer
    // (the previous panel may have just disconnected and reopened).
    if (this.clientDisconnectTimer) {
      clearTimeout(this.clientDisconnectTimer);
      this.clientDisconnectTimer = undefined;
    }

    const state: ClientState = { lastRecvAt: Date.now() };
    this.clients.set(ws, state);
    if (!this.primary) this.primary = ws;

    // Greet with sys.version.
    this.sendTo(ws, {
      type: "sys.version",
      protocolVersion: PROTOCOL_VERSION,
      sidecarVersion: this.opts.sidecarVersion ?? "0.1.0",
    });

    // Replay recent PTY output for reconnect (P1).
    const recent = this.opts.pty.getRecentOutput(this.opts.replayLines ?? 1_000);
    if (recent.length > 0) {
      this.sendTo(ws, { type: "pty.replay", lines: recent });
    }

    ws.on("message", (raw) => {
      state.lastRecvAt = Date.now();
      let msg: Msg;
      try {
        msg = decode(raw.toString());
      } catch (e) {
        this.sendTo(ws, {
          type: "server.error",
          code: "AEParseError",
          userMessage: "Invalid message envelope",
          developerHint: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      this.routeMessage(ws, msg);
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.primary === ws) {
        // Promote any remaining client (Map iteration order = insertion order).
        const next = this.clients.keys().next();
        this.primary = next.done ? undefined : next.value;
      }
      // Abort any pending exec from this ws (response can no longer be delivered).
      for (const [requestId, p] of this.pending) {
        if (p.ws === ws) {
          try { p.abort.abort(); } catch { /* best-effort */ }
          clearTimeout(p.timer);
          this.pending.delete(requestId);
        }
      }

      // Last client just left and we're not already shutting down: start grace
      // timer. If a new connection arrives within the grace window the timer
      // is canceled in handleConnection. Otherwise onShutdownRequest fires —
      // index.ts wires this to gracefulShutdown, releasing the lockfile.
      // Fixes Phase 2.8.4 zombie sidecars when CEP panel closes (no chance
      // for the React unmount cleanup to send sys.shutdown synchronously).
      const grace = this.opts.clientDisconnectGracePeriodMs ?? 5_000;
      if (!this.stopping && this.clients.size === 0 && grace > 0) {
        this.clientDisconnectTimer = setTimeout(() => {
          this.clientDisconnectTimer = undefined;
          if (this.stopping || this.clients.size > 0) return;
          try { this.opts.onShutdownRequest?.("panel-disconnect"); }
          catch { /* never throw from timer */ }
        }, grace);
      }
    });

    ws.on("error", () => {
      /* close fires after error; cleanup happens there */
    });
  }

  // ─── Message routing ─────────────────────────────────────────────

  private routeMessage(ws: WebSocket, msg: Msg): void {
    if (WRITE_TYPES.has(msg.type) && ws !== this.primary) {
      this.refuseSecondary(ws, msg);
      return;
    }

    switch (msg.type) {
      case "pty.in":
        this.opts.pty.write(msg.data);
        return;
      case "pty.resize":
        this.opts.pty.resize(msg.cols, msg.rows);
        return;
      case "exec":
        void this.handleExec(ws, msg);
        return;
      case "cancel": {
        const p = this.pending.get(msg.requestId);
        if (p) {
          p.cancelledByClient = true;
          try { p.abort.abort(); } catch { /* already aborted */ }
        }
        return;
      }
      case "sys.heartbeat":
        // lastRecvAt already updated; no ack — both sides emit on their own cadence.
        return;
      case "approval.response":
        // Phase 4 stub. ae_run_extendscript approval is not wired until then.
        console.warn(
          `[panelBridge] approval.response received before Phase 4 wiring (requestId=${msg.requestId})`,
        );
        return;
      case "sys.shutdown": {
        // Primary-only (already gated by WRITE_TYPES). Broadcast ack first
        // so all clients see the close-is-intentional signal, THEN notify
        // external handler to start the actual shutdown sequence.
        this.broadcast({ type: "sys.shutting-down", ts: Date.now(), reason: msg.reason });
        try { this.opts.onShutdownRequest?.(msg.reason); } catch { /* never throw from router */ }
        return;
      }
      // Phase 3 — panel → sidecar response of dispatcher's outbound exec.
      // Routed to onToolResponse if a dispatcher is wired; otherwise
      // treated as Phase 1 backward-compat AEUnexpectedMsg.
      case "result":
      case "result.chunk":
      case "error":
        if (this.opts.onToolResponse) {
          try { this.opts.onToolResponse(msg); }
          catch { /* never throw from router */ }
        } else {
          this.sendTo(ws, {
            type: "server.error",
            code: "AEUnexpectedMsg",
            userMessage: "Unexpected message type from client",
            developerHint: `'${msg.type}' requires onToolResponse handler (no dispatcher wired)`,
          });
        }
        return;
      // Outgoing-only types: clients shouldn't send these.
      case "server.error":
      case "progress":
      case "pty.out":
      case "pty.replay":
      case "sys.version":
      case "sys.shutting-down":
      case "approval.request":
        this.sendTo(ws, {
          type: "server.error",
          code: "AEUnexpectedMsg",
          userMessage: "Unexpected message type from client",
          developerHint: `'${msg.type}' is sidecar-to-panel only`,
        });
        return;
    }
  }

  private refuseSecondary(ws: WebSocket, msg: Msg): void {
    const userMessage = "Another panel is already connected.";
    const developerHint =
      "This sidecar serves a single primary panel. Wait for the primary to disconnect.";

    if (msg.type === "exec") {
      this.sendTo(ws, {
        type: "error",
        requestId: msg.requestId,
        code: "AEMultiClientRefused",
        userMessage,
        developerHint,
      });
    } else {
      this.sendTo(ws, {
        type: "server.error",
        code: "AEMultiClientRefused",
        userMessage,
        developerHint,
        ctx: { refusedType: msg.type },
      });
    }
  }

  // ─── exec handling ───────────────────────────────────────────────

  private async handleExec(ws: WebSocket, msg: ExecMsg): Promise<void> {
    const { requestId, tool, input, timeoutMs } = msg;

    if (this.pending.has(requestId)) {
      this.sendTo(ws, {
        type: "error",
        requestId,
        code: "AEDuplicateRequest",
        userMessage: "Duplicate requestId in flight",
        developerHint: "Use a unique requestId per exec call.",
      });
      return;
    }

    const abort = new AbortController();
    const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pending: PendingExec = {
      abort,
      ws,
      timedOut: false,
      cancelledByClient: false,
      timer: setTimeout(() => {
        pending.timedOut = true;
        try { abort.abort(); } catch { /* already aborted */ }
      }, effectiveTimeout),
    };
    this.pending.set(requestId, pending);

    const ctx: ExecCtx = {
      requestId,
      signal: abort.signal,
      progress: (fraction, label) => {
        this.sendTo(ws, { type: "progress", requestId, fraction, label });
      },
    };

    // Race handler against abort. Server-side enforcement: even if the handler
    // ignores AbortSignal (e.g., a hung native call), we still emit an error
    // response when the abort fires (timeout or client cancel).
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new Error("__abort"));
      if (abort.signal.aborted) onAbort();
      else abort.signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      const result = await Promise.race([
        this.opts.execHandler(tool, input, ctx),
        abortPromise,
      ]);
      // Chunk if oversized.
      const out = chunkResult(requestId, result);
      if (Array.isArray(out)) {
        for (const chunk of out) this.sendTo(ws, chunk);
      } else {
        this.sendTo(ws, out);
      }
    } catch (e) {
      this.sendTo(ws, this.toErrorMsg(requestId, e, pending));
    } finally {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
    }
  }

  private toErrorMsg(
    requestId: RequestId,
    e: unknown,
    pending: PendingExec,
  ): Msg {
    if (pending.timedOut) {
      return {
        type: "error",
        requestId,
        code: "AETimeoutError",
        userMessage: "Operation timed out.",
        developerHint: "Either the AE process is busy or the tool handler hung. Surface to the user.",
      };
    }
    if (pending.cancelledByClient) {
      return {
        type: "error",
        requestId,
        code: "AECancelledError",
        userMessage: "Operation cancelled by user.",
        developerHint: "User clicked Stop. Do not retry automatically.",
      };
    }
    if (e instanceof AEError) {
      return {
        type: "error",
        requestId,
        code: e.code,
        userMessage: e.userMessage,
        developerHint: e.developerHint,
        ctx: e.ctx,
      };
    }
    return {
      type: "error",
      requestId,
      code: "AEScriptError",
      userMessage: e instanceof Error ? e.message : String(e),
      developerHint: "Unexpected error from execHandler. Inspect ctx.original.",
      ctx: { original: e instanceof Error ? { name: e.name, message: e.message } : String(e) },
    };
  }

  // ─── Send / broadcast ────────────────────────────────────────────

  /**
   * Phase 3 — outbound exec/cancel from ToolDispatcher to the primary
   * panel client. No-op when no primary is connected (dispatcher exec
   * will then time out via its own setTimeout — single source of truth
   * for cancel timing per D-D layer-of-responsibility).
   */
  sendToPrimary(msg: ExecMsg | CancelMsg): void {
    if (this.primary) this.sendTo(this.primary, msg);
  }

  private sendTo(ws: WebSocket, msg: Msg): void {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(encode(msg)); } catch { /* socket may have closed mid-send */ }
    }
  }

  private broadcast(msg: Msg): void {
    const data = encode(msg);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch { /* best-effort */ }
      }
    }
  }

  // ─── Background timers ──────────────────────────────────────────

  private setupPtyForward(): void {
    this.ptyUnsubscribe = this.opts.pty.onData((data) => {
      this.broadcast({ type: "pty.out", data });
    });
  }

  private setupHeartbeat(): void {
    const interval = this.opts.heartbeatIntervalMs ?? 10_000;
    this.heartbeatTimer = setInterval(() => {
      this.broadcast({ type: "sys.heartbeat", ts: Date.now() });
    }, interval);
  }

  private setupWatchdog(): void {
    const timeout = this.opts.heartbeatTimeoutMs ?? 30_000;
    const interval = this.opts.watchdogIntervalMs ?? 5_000;
    this.watchdogTimer = setInterval(() => {
      const now = Date.now();
      for (const [ws, state] of this.clients) {
        if (now - state.lastRecvAt > timeout) {
          try { ws.close(1001, "heartbeat timeout"); } catch { /* best-effort */ }
        }
      }
    }, interval);
  }
}
