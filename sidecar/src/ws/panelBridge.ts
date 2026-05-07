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

import type { IncomingMessage } from "node:http";
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
  type ClientRole,
} from "../protocol.js";
import { AEError } from "../tools/_errors.js";

// ─── Public types ───────────────────────────────────────────────────

export interface PtyLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): () => void;
  /** Phase 4.3 hotfix (mistakes #13 Trap A) — PtyHost has always exposed
   *  onExit but PtyLike omitted it. index.ts main() relies on this hook to
   *  trigger sidecar shutdown when the PTY child dies; without it in the
   *  interface, the `makeDummyPty` fallback ENOENT path runtime-throws
   *  "pty.onExit is not a function". Signature mirrors PtyHost.ExitCb
   *  (signal is `number | undefined` per node-pty's IPty.onExit semantics —
   *  signal absent on Windows ConPTY graceful exit). */
  onExit(cb: (code: number, signal?: number) => void): () => void;
  /** Phase 4.3 hotfix (mistakes #13 Trap A) — PtyHost.kill always existed
   *  but PtyLike omitted it. Sidecar shutdown calls this; dummy is a noop. */
  kill(): Promise<void>;
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
  /**
   * Phase 4.3 — sidecar boot-time error to broadcast to each new client
   * immediately after `sys.version`. Used when claude CLI is missing
   * (ENOENT during PtyHost spawn): the sidecar still boots so the panel
   * can connect and learn why instead of seeing an opaque crash. The
   * panel routes `server.error` through useTerminal's existing handler
   * (sets `error` state, status remains "ready") — no panel-side code
   * change needed. Banner UI is deferred to Phase 6 / 4.3.1.
   * Undefined = Phase 2/3 default behavior (no extra message).
   */
  initialServerError?: { code: string; userMessage: string; developerHint: string };
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
  /** D-J — role identified at WS upgrade by URL query (`?role=mcp`).
   *  Missing query → "panel" default (backward compat: Phase 2/3 17
   *  scenarios connect without query and resolve to panel role). */
  role: ClientRole;
}

// Write-authority message types — primary client only, **per role**.
// Phase 4 D-J split the original WRITE_TYPES into role-specific sets.
const PANEL_WRITES: ReadonlySet<Msg["type"]> = new Set([
  "pty.in",
  "pty.resize",
  "exec",
  "cancel",
  "approval.response",
  "sys.shutdown",          // primary-only per Phase 2.5.5.0 design
]);
const MCP_WRITES: ReadonlySet<Msg["type"]> = new Set([
  "exec",
  "cancel",
  // pty.* / sys.shutdown / approval.response → AERoleNotAllowed for mcp role.
]);

function writesForRole(role: ClientRole): ReadonlySet<Msg["type"]> {
  return role === "mcp" ? MCP_WRITES : PANEL_WRITES;
}

/** Parse role from `req.url` (e.g., `/?role=mcp`). Missing/unknown → "panel".
 *  Backward compat: legacy connect strings have no query → "panel" default. */
function parseRole(rawUrl: string | undefined): ClientRole {
  if (!rawUrl) return "panel";
  const qIdx = rawUrl.indexOf("?");
  if (qIdx < 0) return "panel";
  const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
  return params.get("role") === "mcp" ? "mcp" : "panel";
}

// ─── PanelBridge ───────────────────────────────────────────────────

export class PanelBridge {
  private wss: WebSocketServer | undefined;
  private clients = new Map<WebSocket, ClientState>();
  /** Primary panel client — owns pty.in/pty.resize/exec/cancel/sys.shutdown
   *  authority. Selected as the first connecting `role=panel` client; on
   *  disconnect, the next remaining panel client (insertion order) is promoted. */
  private primaryPanel: WebSocket | undefined;
  /** Primary mcp client — owns exec/cancel authority only. Independent of
   *  primaryPanel (Phase 4 D-J). At most one mcp client per sidecar in
   *  practice (claude CLI spawns one MCP server child); secondary mcp
   *  clients are refused writes the same way secondary panel clients are. */
  private primaryMcp: WebSocket | undefined;
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
        wss.on("connection", (ws, req) => this.handleConnection(ws, req));
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
    this.primaryPanel = undefined;
    this.primaryMcp = undefined;

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

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // New client arrived — cancel any pending auto-shutdown grace timer
    // (the previous panel may have just disconnected and reopened).
    if (this.clientDisconnectTimer) {
      clearTimeout(this.clientDisconnectTimer);
      this.clientDisconnectTimer = undefined;
    }

    const role = parseRole(req.url);
    const state: ClientState = { lastRecvAt: Date.now(), role };
    this.clients.set(ws, state);
    // Per-role primary selection (D-J).
    if (role === "panel" && !this.primaryPanel) this.primaryPanel = ws;
    else if (role === "mcp" && !this.primaryMcp) this.primaryMcp = ws;

    // Greet with sys.version.
    this.sendTo(ws, {
      type: "sys.version",
      protocolVersion: PROTOCOL_VERSION,
      sidecarVersion: this.opts.sidecarVersion ?? "0.1.0",
    });

    // Phase 4.3 — boot-time server error (e.g., claude CLI missing).
    if (this.opts.initialServerError) {
      this.sendTo(ws, {
        type: "server.error",
        code: this.opts.initialServerError.code,
        userMessage: this.opts.initialServerError.userMessage,
        developerHint: this.opts.initialServerError.developerHint,
      });
    }

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
      // Promote next same-role client on primary disconnect (D-J).
      // Map iteration order = insertion order, so first matching role wins.
      if (this.primaryPanel === ws) {
        this.primaryPanel = this.findFirstByRole("panel");
      }
      if (this.primaryMcp === ws) {
        this.primaryMcp = this.findFirstByRole("mcp");
      }
      // Abort any pending exec from this ws (response can no longer be delivered).
      for (const [requestId, p] of this.pending) {
        if (p.ws === ws) {
          try { p.abort.abort(); } catch { /* best-effort */ }
          clearTimeout(p.timer);
          this.pending.delete(requestId);
        }
      }

      // Last *panel* client just left and we're not already shutting down:
      // start grace timer. Phase 5.1.2 (mistakes #16) — D-J multi-role
      // introduced mcp clients into the same `clients` map, but the mcp
      // client's lifecycle is owned by claude CLI's stdio child (not the
      // panel runtime). When the CEP panel closes, panel ws disconnects
      // but mcp ws stays attached because the sidecar (and therefore
      // claude CLI / MCP server / PTY) is still alive. The pre-fix
      // `clients.size === 0` condition would have kept the grace timer
      // dormant, leaving 4 zombie processes per cycle. We gate on
      // panel-only presence so mcp clients can never block shutdown.
      // mcp's own lifecycle naturally tears down via PTY tree-kill
      // during gracefulShutdown.
      const grace = this.opts.clientDisconnectGracePeriodMs ?? 5_000;
      const panelStillPresent = this.findFirstByRole("panel") !== undefined;
      if (!this.stopping && !panelStillPresent && grace > 0) {
        this.clientDisconnectTimer = setTimeout(() => {
          this.clientDisconnectTimer = undefined;
          if (this.stopping || this.findFirstByRole("panel") !== undefined) return;
          try { this.opts.onShutdownRequest?.("panel-disconnect"); }
          catch { /* never throw from timer */ }
        }, grace);
      }
    });

    ws.on("error", () => {
      /* close fires after error; cleanup happens there */
    });
  }

  private findFirstByRole(role: ClientRole): WebSocket | undefined {
    for (const [ws, state] of this.clients) {
      if (state.role === role) return ws;
    }
    return undefined;
  }

  // ─── Message routing ─────────────────────────────────────────────

  private routeMessage(ws: WebSocket, msg: Msg): void {
    const state = this.clients.get(ws);
    if (!state) return;  // raced with close — drop silently

    // D-J: role-aware authority.
    //  1. If the type is in this role's WRITES set, must be the role's primary.
    //  2. Else if it's a write type for the *other* role, refuse with
    //     AERoleNotAllowed (e.g., mcp client sending pty.in).
    //  3. Else fall through to switch (read-only types: heartbeat, etc.).
    const allowed = writesForRole(state.role);
    if (allowed.has(msg.type)) {
      const primary = state.role === "mcp" ? this.primaryMcp : this.primaryPanel;
      if (ws !== primary) {
        this.refuseSecondary(ws, msg);
        return;
      }
    } else if (PANEL_WRITES.has(msg.type) || MCP_WRITES.has(msg.type)) {
      this.refuseRoleNotAllowed(ws, msg, state.role);
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

  private refuseRoleNotAllowed(ws: WebSocket, msg: Msg, role: ClientRole): void {
    const userMessage = `Message type '${msg.type}' not allowed for role '${role}'.`;
    const developerHint = role === "mcp"
      ? "MCP role accepts exec/cancel only. PTY and shutdown are panel-only."
      : `Role '${role}' does not accept this message type.`;
    if (msg.type === "exec") {
      // Shouldn't happen — exec is in both roles' WRITES — but handle defensively.
      this.sendTo(ws, {
        type: "error",
        requestId: msg.requestId,
        code: "AERoleNotAllowed",
        userMessage,
        developerHint,
      });
    } else {
      this.sendTo(ws, {
        type: "server.error",
        code: "AERoleNotAllowed",
        userMessage,
        developerHint,
        ctx: { role, refusedType: msg.type },
      });
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
   * panel client. No-op when no primary panel is connected (dispatcher
   * exec will then time out via its own setTimeout — single source of
   * truth for cancel timing per D-D layer-of-responsibility).
   *
   * Phase 4 D-J: routes to `primaryPanel` only (the ExtendScript bridge
   * lives in the CEP panel runtime). The mcp client never receives
   * outbound exec — it issues *inbound* exec to the dispatcher and
   * receives result/error responses tied to its own requestId via the
   * normal response path (sendTo on the originating ws).
   */
  sendToPrimary(msg: ExecMsg | CancelMsg): void {
    if (this.primaryPanel) this.sendTo(this.primaryPanel, msg);
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
