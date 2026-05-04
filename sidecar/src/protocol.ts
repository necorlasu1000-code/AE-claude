// D6 — WebSocket protocol envelope (panel ↔ sidecar)
// Single source of truth for both sides. Panel imports this from sidecar/src/protocol.ts.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const CHUNK_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10MB

export type RequestId = string;

// ─── exec / result / error / cancel ─────────────────────────────────

export interface ExecMsg {
  type: "exec";
  requestId: RequestId;
  tool: string;             // panel uses tool name to look up jsx function (E7 type safety)
  input: unknown;           // zod-validated by sidecar before dispatch
  timeoutMs?: number;       // override default (D4 destructive tools may need longer)
}

export interface ResultMsg {
  type: "result";
  requestId: RequestId;
  data: unknown;            // zod-validated against tool's output schema
}

export interface ErrorMsg {
  type: "error";
  requestId: RequestId;
  code: string;             // C2: AEScriptError, AETimeoutError, AECrashedError, AEValidationError, AEApprovalDeniedError, AEUndoNotSupportedError, AEFileLockedError
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
  | CancelMsg
  | ProgressMsg
  | ResultChunkMsg
  | PtyInMsg
  | PtyOutMsg
  | PtyResizeMsg
  | PtyReplayMsg
  | HeartbeatMsg
  | VersionMsg
  | ApprovalRequestMsg
  | ApprovalResponseMsg;

// ─── (de)serialization ──────────────────────────────────────────────
// JSON over WebSocket. No custom binary protocol — keep boring (CLAUDE.md base
// principle 2 + D9: choose-boring-tech).

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
