// Phase 3.5 — panel-side ExtendScript bridge.
//
// Wraps CSInterface.evalScript with three concerns:
//   1. FIFO queue (Mutex gate P4 / D-D panel-side responsibility) — ExtendScript
//      is single-threaded; concurrent evalScript is undefined behavior. We
//      serialize at the panel boundary so callers can fire exec() freely.
//   2. Envelope parsing — jsx defineJsxTool always returns a string of
//      `{ok:true,output}` or `{ok:false,error}`. Convert to ExecResult.
//      Malformed JSON or wrong shape becomes AEResultParseError (matches
//      protocol.ts ErrorMsg.code enum).
//   3. Structured emit — `[bridge:enter/exit/error]` events fire through a
//      caller-injected `emit` callback. Default = noop (no console.log per
//      CLAUDE.md "console.log 직접 사용 금지" — emit helper is the layer).
//      Phase 6 logger.ts will hook into the same callback shape; emit
//      itself doesn't change.
//
// NOT a React hook despite the `use` prefix — pure factory, no useState/
// useEffect. Callers wrap in useMemo if they need stable identity across
// renders. Tests run in node env (no jsdom needed).
//
// timeoutMs/cancel intentionally absent — sidecar ToolDispatcher (Phase 3.6)
// owns timeout enforcement and cancel routing. Single source of truth for
// cancel timing prevents the panel queue and the dispatcher fighting over
// who fires the abort.

interface CSInterfaceLike {
  evalScript(script: string, callback: (result: string) => void): void;
}

// ─── log events (D-D layer-of-responsibility tag = "bridge:") ──────────

export type BridgeLogEvent =
  | { event: "bridge:enter"; requestId: string; tool: string }
  | { event: "bridge:exit"; requestId: string; durationMs: number; ok: boolean }
  | { event: "bridge:error"; requestId: string; code: string };

// ─── public surface ───────────────────────────────────────────────────

export interface ExecRequest {
  requestId: string;
  tool: string;
  input: unknown;
}

export type ExecResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; userMessage: string; developerHint: string };

export interface UseExtendScriptBridgeDeps {
  csInterface: CSInterfaceLike;
  /** bolt-cep namespace (panel reads from `host[ns]`). Production = the ns
   *  exported from src/shared/shared.ts; tests pass any string. */
  ns: string;
  /** Default = noop. Phase 6 logger.ts wires here. */
  emit?: (event: BridgeLogEvent) => void;
  /** Injectable clock for durationMs measurement. Default = Date.now. */
  now?: () => number;
}

export interface UseExtendScriptBridgeOptions {
  // reserved — D4 destructive tools may grow per-call options here later
}

export interface UseExtendScriptBridgeResult {
  exec(req: ExecRequest): Promise<ExecResult>;
  /** queue depth (queued + currently processing). Test/debug observability. */
  readonly inflight: number;
}

// ─── factory ──────────────────────────────────────────────────────────

interface QueueItem {
  req: ExecRequest;
  resolve: (r: ExecResult) => void;
}

export function useExtendScriptBridge(
  deps: UseExtendScriptBridgeDeps,
  _options?: UseExtendScriptBridgeOptions,
): UseExtendScriptBridgeResult {
  const queue: QueueItem[] = [];
  let processing = false;
  const emit = deps.emit ?? (() => {});
  const now = deps.now ?? (() => Date.now());

  const drain = (): void => {
    if (processing || queue.length === 0) return;
    processing = true;
    const item = queue.shift()!;
    const { req, resolve } = item;
    const startTs = now();

    emit({ event: "bridge:enter", requestId: req.requestId, tool: req.tool });

    // Build the evalScript call: `$["<ns>"].tools.<tool>(<rawInput-as-string-literal>)`.
    //
    // BRACKET NOTATION on `$["..."]` is required: the actual ns value
    // (cep.config.ts `id` = "com.aeclaude.panel") contains dots — direct
    // identifier access `com.aeclaude.panel.tools.X(...)` would parse as
    // chained property access and ReferenceError on `com is undefined`.
    // jsx side already registers via `host[ns] = aeft` (src/jsx/index.ts),
    // so bracket lookup recovers the same object. ExtendScript globals
    // expose the global object as `$` (host = $ when running in AE).
    //
    // Two JSON.stringify are required: one for the wire (jsx side
    // JSON.parse will recover the input), one to embed the wire string
    // as a JS string literal inside the evalScript source.
    const inputJson = JSON.stringify(req.input);
    const inputLiteral = JSON.stringify(inputJson);
    const script = `$[${JSON.stringify(deps.ns)}].tools.${req.tool}(${inputLiteral})`;

    deps.csInterface.evalScript(script, (raw) => {
      const durationMs = now() - startTs;
      const result = parseEnvelope(raw);

      if (!result.ok) {
        emit({ event: "bridge:error", requestId: req.requestId, code: result.code });
      }
      emit({ event: "bridge:exit", requestId: req.requestId, durationMs, ok: result.ok });

      resolve(result);
      processing = false;
      drain();
    });
  };

  return {
    exec(req) {
      return new Promise<ExecResult>((resolve) => {
        queue.push({ req, resolve });
        drain();
      });
    },
    get inflight() {
      return queue.length + (processing ? 1 : 0);
    },
  };
}

// ─── envelope parser (exported for direct test if needed) ──────────────

function parseEnvelope(raw: string): ExecResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      code: "AEResultParseError",
      userMessage: "jsx 응답 JSON 파싱 실패",
      developerHint:
        "jsx return이 valid JSON 아님 — defineJsxTool wrap 누락 또는 polyfill 미동작 가능. raw=" +
        raw.slice(0, 200) +
        " err=" +
        String(e),
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "ok" in parsed
  ) {
    const env = parsed as { ok: unknown; output?: unknown; error?: unknown };
    if (env.ok === true) {
      return { ok: true, data: env.output };
    }
    if (env.ok === false && typeof env.error === "object" && env.error !== null) {
      const err = env.error as { code?: unknown; userMessage?: unknown; developerHint?: unknown };
      return {
        ok: false,
        code: typeof err.code === "string" ? err.code : "AEScriptError",
        userMessage: typeof err.userMessage === "string" ? err.userMessage : "(missing userMessage)",
        developerHint: typeof err.developerHint === "string" ? err.developerHint : "(missing developerHint)",
      };
    }
  }

  // shape malformed despite JSON.parse success
  return {
    ok: false,
    code: "AEResultParseError",
    userMessage: "jsx 응답 형식 오류",
    developerHint:
      "jsx return이 {ok,output}/{ok,error} 형식 아님: " + raw.slice(0, 200),
  };
}
