// D6 — WebSocket protocol envelope (panel ↔ sidecar)
// Single source of truth for both sides. Panel imports this from sidecar/src/protocol.ts.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const CHUNK_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10MB

export type RequestId = string;

// ─── exec / result / error / cancel — ExtendScript bridge (Phase 3) ─
//
// Purpose: round-trip a tool call from the sidecar (Phase 4 MCP server, or
// Phase 3 dev trigger) through the panel into ExtendScript and back.
//
// Layer responsibilities (Phase 3 fix-by-design, mistakes.md "Multi-trigger
// graceful shutdown" sibling principle — single concern per layer):
//   - Sidecar ToolDispatcher: emits ExecMsg, owns requestId matching,
//     timeoutMs enforcement, cancel routing, latency measurement
//     (wall-clock from exec send → result/error receive).
//   - Panel useExtendScriptBridge: receives ExecMsg, enforces ES single-
//     thread serialization via FIFO queue (Mutex gate P4 — ExtendScript
//     is single-threaded, concurrent evalScript is undefined behavior).
//     Calls CSInterface.evalScript(`${ns}.tools.${tool}(${JSON.stringify(input)})`),
//     parses jsx return value, emits ResultMsg or ErrorMsg.
//   - jsx side (defineJsxTool HOF, mirror of sidecar defineAETool D4):
//     wraps tool fn in try/catch, returns deterministic shape:
//       success → '{"ok":true,"output":<output>}'
//       failure → '{"ok":false,"error":{"code","userMessage","developerHint"}}'
//     Panel parses this string (json2.js polyfill ensures JSON in ES3),
//     converts {ok:false,...} into ErrorMsg before WS send.

export interface ExecMsg {
  type: "exec";
  requestId: RequestId;
  /** Tool name — panel uses this to look up the jsx fn at
   *  `<ns>.tools.<tool>` (E7 type safety, D8 collocation). */
  tool: string;
  /** Input payload — zod-validated by sidecar before dispatch.
   *  Panel passes `JSON.stringify(input)` as the only argument to the
   *  jsx fn; jsx side `JSON.parse`s it (json2.js polyfill in ES3). */
  input: unknown;
  /** Override default 30s (D4 destructive tools may need longer).
   *  Enforced by sidecar dispatcher, NOT by panel — panel queue has no
   *  timer of its own (avoids dual-source-of-truth on cancel timing). */
  timeoutMs?: number;
}

export interface ResultMsg {
  type: "result";
  requestId: RequestId;
  /** Output payload — corresponds to the `output` field of the jsx
   *  HOF's `{ok:true,output:<output>}` envelope. zod-validated against
   *  the tool's output schema by sidecar dispatcher before resolving
   *  the caller's promise. */
  data: unknown;
}

export interface ErrorMsg {
  type: "error";
  requestId: RequestId;
  /** AEError subclass code (C2). Phase 3 introduces:
   *    - AEScriptError       — jsx fn threw uncaught (defineJsxTool catch)
   *    - AETimeoutError      — sidecar dispatcher timeoutMs hit
   *    - AECrashedError      — evalScript callback never fired
   *    - AEValidationError   — zod input/output schema rejected
   *    - AEResultParseError  — panel JSON.parse on jsx return failed
   *                            (malformed jsx output, polyfill bug, etc.)
   *    - AEInputParseError   — jsx HOF JSON.parse on rawInput failed
   *                            (panel shouldn't send malformed; defensive)
   *    - AENoActiveCompError — jsx tool found app.project.activeItem
   *                            null or non-CompItem (Folder/Footage) —
   *                            expected UX error, Claude should suggest
   *                            creating or selecting a comp (raised via
   *                            jsx HOF helper `h.fail()`)
   *  Future phases add: AEApprovalDeniedError (D3), AEUndoNotSupportedError
   *  (D4), AEFileLockedError. */
  code: string;
  userMessage: string;      // shown to user
  developerHint: string;    // hint for Claude's next-step decision
  ctx?: Record<string, unknown>;
}

export interface CancelMsg {
  type: "cancel";
  requestId: RequestId;
}

export interface ProgressMsg {
  type: "progress";
  requestId: RequestId;
  fraction: number;         // 0.0 - 1.0
  label?: string;           // e.g., "Processing layer 3 of 10"
}

// ─── chunked result (P5) ────────────────────────────────────────────

export interface ResultChunkMsg {
  type: "result.chunk";
  requestId: RequestId;
  seq: number;              // 0-indexed
  total: number;            // total chunk count
  data: string;             // base64 or JSON fragment
}

// ─── PTY I/O (claude CLI subprocess) ────────────────────────────────

export interface PtyInMsg {
  type: "pty.in";
  data: string;             // user keystrokes from xterm
}

export interface PtyOutMsg {
  type: "pty.out";
  data: string;             // claude stdout/stderr to xterm
}

export interface PtyResizeMsg {
  type: "pty.resize";
  cols: number;
  rows: number;
}

export interface PtyReplayMsg {
  type: "pty.replay";
  lines: string[];          // P1: ring buffer last N lines on reconnect
}

// ─── system / heartbeat ─────────────────────────────────────────────

export interface HeartbeatMsg {
  type: "sys.heartbeat";
  ts: number;               // sender's epoch ms
}

export interface VersionMsg {
  type: "sys.version";
  protocolVersion: number;  // PROTOCOL_VERSION
  sidecarVersion: string;   // semver
}

// Server-initiated error not paired with a client request (no requestId).
// Used for connection-level errors: AEMultiClientRefused, AEParseError,
// AEUnexpectedMsg. ErrorMsg requires requestId and is reserved for exec responses.
export interface ServerErrorMsg {
  type: "server.error";
  code: string;
  userMessage: string;
  developerHint: string;
  ctx?: Record<string, unknown>;
}

// Client→Server: graceful shutdown request. Primary client only (write authority).
// Production use: panel close → panel sends sys.shutdown → sidecar releases lockfile.
// Test use: integration-lockfile.test.ts triggers sidecar shutdown without OS signals
// (Windows has no graceful SIGTERM). See mistakes.md "node-pty Signals not supported"
// + Phase 2.5.5.0 commit notes.
export interface ShutdownRequestMsg {
  type: "sys.shutdown";
  reason?: string;          // free-form, logged on sidecar side
}

// Server→All clients: shutdown ack. Broadcast immediately on receipt of
// sys.shutdown, BEFORE the actual shutdown sequence starts. Clients use
// this to know the connection is about to close intentionally (vs error).
export interface ShuttingDownMsg {
  type: "sys.shutting-down";
  ts: number;
  reason?: string;
}

// ─── D3 approval gate (panel-side) ──────────────────────────────────

export interface ApprovalRequestMsg {
  type: "approval.request";
  requestId: RequestId;
  tool: string;             // e.g., "ae_run_extendscript"
  reason: string;           // Claude's intent (one sentence)
  script: string;           // raw ExtendScript code preview
  astOk: boolean;           // D7 validator result
  astFindings?: Array<{ line: number; reason: string }>;
  undoLabel?: string;       // D4 undoGroup label preview
}

export interface ApprovalResponseMsg {
  type: "approval.response";
  requestId: RequestId;
  approved: boolean;
}

// ─── envelope union ─────────────────────────────────────────────────

export type Msg =
  | ExecMsg
  | ResultMsg
  | ErrorMsg
  | ServerErrorMsg
  | CancelMsg
  | ProgressMsg
  | ResultChunkMsg
  | PtyInMsg
  | PtyOutMsg
  | PtyResizeMsg
  | PtyReplayMsg
  | HeartbeatMsg
  | VersionMsg
  | ShutdownRequestMsg
  | ShuttingDownMsg
  | ApprovalRequestMsg
  | ApprovalResponseMsg;

// ─── (de)serialization ──────────────────────────────────────────────
// JSON over WebSocket TEXT frames. No custom binary protocol — keep boring
// (CLAUDE.md base principle 2 + D9: choose-boring-tech).
//
// Encoding contract:
//   - encode() ALWAYS returns a string. ws.send(string) emits a text frame
//     with UTF-8 payload (RFC 6455 §5.6). Both endpoints MUST send text frames
//     to guarantee round-trip of non-ASCII (Korean comp/layer names, emoji
//     in tool input/output) without BOM detection or encoding negotiation.
//   - decode() takes the string from ws message handler. The ws library
//     decodes the binary text frame to UTF-8 string before calling our
//     handler when frame type is text — so we never see raw bytes here.
//   - Binary frames (Buffer / ArrayBuffer) are NOT used. If we ever need
//     to ship raw bytes, base64-encode inside a string field of an
//     existing message type rather than introducing a binary envelope.

export function encode(msg: Msg): string {
  return JSON.stringify(msg);
}

export function decode(raw: string): Msg {
  const parsed = JSON.parse(raw) as Msg;
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new Error("Invalid message envelope");
  }
  return parsed;
}

// ─── chunking helper (P5) ───────────────────────────────────────────

export function chunkResult(requestId: RequestId, data: unknown, threshold = CHUNK_THRESHOLD_BYTES): ResultMsg | ResultChunkMsg[] {
  const json = JSON.stringify(data);
  if (json.length <= threshold) {
    return { type: "result", requestId, data };
  }
  const total = Math.ceil(json.length / threshold);
  const chunks: ResultChunkMsg[] = [];
  for (let seq = 0; seq < total; seq++) {
    chunks.push({
      type: "result.chunk",
      requestId,
      seq,
      total,
      data: json.slice(seq * threshold, (seq + 1) * threshold),
    });
  }
  return chunks;
}
