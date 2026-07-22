// Phase 3.6 — sidecar-side ToolDispatcher.
//
// Sits between the (Phase 4) MCP server and panelBridge. Owns the
// outbound exec lifecycle: requestId issuing, timeout enforcement,
// cancel routing, latency wall-clock measurement. Pairs with
// panel-side useExtendScriptBridge (Phase 3.5) which owns the
// ES-single-thread FIFO serialization. Two layers, one concern each
// (D-D layer-of-responsibility; mirrored in protocol.ts header jsdoc).
//
// MUTEX RESPONSIBILITY (CLAUDE.md gate §7, per D-D): the "one tool at a
// time against AE" guarantee lives in the PANEL FIFO queue, NOT here. This
// dispatcher deliberately allows multiple concurrent in-flight execs (each
// gets its own requestId + timeout) — see toolDispatcher.test.ts "does not
// serialize". Do NOT add a mutex here; it would double-serialize and stall
// legitimate parallel dispatch while the panel queue already enforces the
// single-threaded ExtendScript constraint.
//
// Late-result handling: when handleIncoming receives a requestId no
// longer in `pending` (cancel/timeout already won the race), the
// message is silently dropped. Test verifies via inflight Map size
// stability, not a separate event — keeps the public log surface
// minimal. If future debugging needs visibility, a `dispatcher:
// late_result` event can be added without changing the silent-drop
// behavior.
//
// Naming: createToolDispatcher (factory) — sidecar has no React, so
// no `use*` prefix. Closure encapsulates the inflight Map without
// exposing it on a class.

import { randomUUID } from "node:crypto";
import {
  DEFAULT_TIMEOUT_MS,
  type ExecMsg,
  type CancelMsg,
  type ResultMsg,
  type ErrorMsg,
  type ResultChunkMsg,
} from "../protocol.js";

// ─── log events (D-D tag = "dispatcher:") ────────────────────────────

export type DispatcherLogEvent =
  | { event: "dispatcher:enter"; requestId: string; tool: string }
  | { event: "dispatcher:exit"; requestId: string; durationMs: number; ok: boolean }
  | { event: "dispatcher:error"; requestId: string; code: string }
  | { event: "dispatcher:timeout"; requestId: string; timeoutMs: number }
  | { event: "dispatcher:cancel"; requestId: string };

// ─── public surface ──────────────────────────────────────────────────

export interface ToolDispatcherDeps {
  /** Send to the primary panel client. Wired in index.ts to
   *  `panelBridge.sendToPrimary`. No-op when no primary connected
   *  (timeout will eventually fire). */
  send(msg: ExecMsg | CancelMsg): void;
  emit?: (e: DispatcherLogEvent) => void;
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  newRequestId?: () => string;
}

export interface ToolDispatcherOptions {
  /** Per-call default. Falls through to DEFAULT_TIMEOUT_MS (30_000)
   *  from protocol.ts — single source of truth for the timeout
   *  constant; no magic numbers in this file. */
  defaultTimeoutMs?: number;
}

export interface ExecRequest {
  tool: string;
  input: unknown;
  /** Override default — D4 destructive tools may need longer. */
  timeoutMs?: number;
}

export type DispatcherResult =
  | { ok: true; data: unknown; durationMs: number }
  | { ok: false; code: string; userMessage: string; developerHint: string; durationMs: number };

export interface ToolDispatcher {
  exec(req: ExecRequest): Promise<DispatcherResult>;
  cancel(requestId: string): void;
  /** Called by panelBridge.onToolResponse when panel sends result/
   *  error/result.chunk. Late arrivals (no matching requestId) are
   *  silently dropped. */
  handleIncoming(msg: ResultMsg | ErrorMsg | ResultChunkMsg): void;
  /** Number of pending requests. Test/debug observability. */
  readonly inflight: number;
}

// ─── factory ─────────────────────────────────────────────────────────

interface PendingEntry {
  resolve: (r: DispatcherResult) => void;
  startTs: number;
  tool: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createToolDispatcher(
  deps: ToolDispatcherDeps,
  options?: ToolDispatcherOptions,
): ToolDispatcher {
  const pending = new Map<string, PendingEntry>();
  const emit = deps.emit ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const setT = deps.setTimeout ?? setTimeout;
  const clearT = deps.clearTimeout ?? clearTimeout;
  const newRid = deps.newRequestId ?? (() => randomUUID());
  const defaultTimeout = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const finalize = (requestId: string, result: DispatcherResult): void => {
    const entry = pending.get(requestId);
    if (!entry) return; // already resolved — race winner
    pending.delete(requestId);
    if (entry.timer) clearT(entry.timer);

    if (!result.ok) {
      emit({ event: "dispatcher:error", requestId, code: result.code });
    }
    emit({ event: "dispatcher:exit", requestId, durationMs: result.durationMs, ok: result.ok });
    entry.resolve(result);
  };

  return {
    exec(req) {
      return new Promise<DispatcherResult>((resolve) => {
        const requestId = newRid();
        const startTs = now();
        const timeoutMs = req.timeoutMs ?? defaultTimeout;

        const timer = setT(() => {
          if (!pending.has(requestId)) return;
          emit({ event: "dispatcher:timeout", requestId, timeoutMs });
          finalize(requestId, {
            ok: false,
            code: "AETimeoutError",
            userMessage: `툴 호출 타임아웃 (${timeoutMs}ms 초과)`,
            developerHint: `tool=${req.tool} no result/error received within ${timeoutMs}ms — panel may be stuck or jsx tool runaway. Consider raising timeoutMs for D4 destructive tools.`,
            durationMs: now() - startTs,
          });
        }, timeoutMs);

        pending.set(requestId, { resolve, startTs, tool: req.tool, timer });

        emit({ event: "dispatcher:enter", requestId, tool: req.tool });

        deps.send({
          type: "exec",
          requestId,
          tool: req.tool,
          input: req.input,
          timeoutMs,
        });
      });
    },

    cancel(requestId) {
      const entry = pending.get(requestId);
      if (!entry) return; // unknown — silently drop (already resolved/timed out)
      emit({ event: "dispatcher:cancel", requestId });
      // Best-effort cancel notification to panel. ExtendScript can't
      // actually abort; panel hook currently ignores cancel (D-D B
      // decision — late result will silent-drop on this side). The
      // notify-then-resolve order matters for telemetry: we want the
      // panel to see cancel before the dispatcher considers the request
      // closed in case Phase 5+ tools want to abort downstream side
      // effects (HTTP, etc).
      try { deps.send({ type: "cancel", requestId }); } catch { /* never throw */ }
      finalize(requestId, {
        ok: false,
        code: "AECancelledError",
        userMessage: "툴 호출 취소됨",
        developerHint: `requestId=${requestId} cancelled by caller before result. ExtendScript may still complete; the late result will be silently dropped by handleIncoming.`,
        durationMs: now() - entry.startTs,
      });
    },

    handleIncoming(msg) {
      const entry = pending.get(msg.requestId);
      if (!entry) return; // late arrival — silent drop (testability via inflight Map)

      if (msg.type === "result") {
        finalize(msg.requestId, {
          ok: true,
          data: msg.data,
          durationMs: now() - entry.startTs,
        });
      } else if (msg.type === "error") {
        finalize(msg.requestId, {
          ok: false,
          code: msg.code,
          userMessage: msg.userMessage,
          developerHint: msg.developerHint,
          durationMs: now() - entry.startTs,
        });
      } else if (msg.type === "result.chunk") {
        // Phase 3.6 — chunk reassembly intentionally NOT implemented.
        // Phase 3 spike + Phase 5 read tools all fit < CHUNK_THRESHOLD_BYTES
        // (10MB, protocol.ts). The phase that introduces large-output tools
        // adds reassembly here + a corresponding test. Until then: drop.
        return;
      }
    },

    get inflight() {
      return pending.size;
    },
  };
}
