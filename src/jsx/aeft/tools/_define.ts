// Phase 3.3 — defineJsxTool HOF (ExtendScript-side, mirror of sidecar/src/tools/_define.ts).
//
// Wraps a per-tool fn so panel→jsx round-trip is always:
//   rawInput (string) → JSON.parse → fn(input, ctx, h) → JSON.stringify({ok,output})
// Failure is caught and converted to {ok:false, error:{code,userMessage,developerHint}}
// — the same shape the panel's useExtendScriptBridge expects. No throws escape
// the wrapper; CSInterface.evalScript callback always sees a JSON string.
//
// Difference from sidecar defineAETool (D4):
//   sidecar: async + zod schema validation + undo group + crash recovery
//   jsx:     sync   + try/catch  + JSON serialize  (ES3 limits — no Promise,
//                                                   no zod runtime here)
// Validation lives in the sidecar dispatcher; jsx side only enforces shape.
//
// Failure helper usage rule:
//   throw h.fail("AECode", "user-facing", "developer-facing");
// `return h.fail(...)` is FORBIDDEN — h.fail returns a sentinel that only
// makes sense when thrown (the catch branch detects __jsxFail and converts).
// Returning the sentinel as output would JSON.stringify it as-is and panel
// would see {ok:true, output:{__jsxFail:true,...}} — silent corruption.
// The sentinel pattern keeps fn bodies linear (no envelope plumbing) while
// still letting Phase 5 30-tool authors raise typed errors with one line.
//
// `app` global: declared ambient so production jsx code (where ExtendScript
// provides `app` as a global) compiles without import. In vitest the global
// is undefined — tests MUST inject `ctxOverride` so the wrapper never
// touches the bare `app` identifier (test envs would ReferenceError).

declare const app: unknown;

// ─── shared item / app shapes (panel-jsx contract) ────────────────────

export interface JsxItemLike {
  /** AE Item.typeName: "Composition" | "Folder" | "Footage". Phase 3
   *  helpers use this for duck-typing instead of `instanceof CompItem`,
   *  which would ReferenceError in vitest (no AE class globals). */
  typeName: string;
  name: string;
  id: number;
}

export interface JsxCompItem extends JsxItemLike {
  typeName: "Composition";
  duration: number;
  frameRate: number;
  width: number;
  height: number;
  numLayers: number;
}

export interface JsxAppLike {
  project: {
    activeItem: JsxItemLike | null;
  };
}

export interface JsxToolCtx {
  app: JsxAppLike;
}

// ─── envelope shapes ──────────────────────────────────────────────────

export interface JsxOk<O> {
  ok: true;
  output: O;
}

export interface JsxErr {
  ok: false;
  error: {
    code: string;          // matches protocol.ts ErrorMsg.code enum
    userMessage: string;
    developerHint: string;
  };
}

// ─── failure helper (sentinel) ────────────────────────────────────────

interface JsxFailSentinel {
  __jsxFail: true;
  code: string;
  userMessage: string;
  developerHint: string;
}

export interface JsxToolHelpers {
  /** Returns a sentinel for the wrapper's catch branch. Always use as
   *  `throw h.fail(...)` — never `return h.fail(...)` (see file header). */
  fail(code: string, userMessage: string, developerHint: string): JsxFailSentinel;
}

const helpers: JsxToolHelpers = {
  fail: function (code, userMessage, developerHint) {
    return {
      __jsxFail: true,
      code: code,
      userMessage: userMessage,
      developerHint: developerHint,
    };
  },
};

// ─── HOF ──────────────────────────────────────────────────────────────

export type JsxToolFn<I, O> = (input: I, ctx: JsxToolCtx, h: JsxToolHelpers) => O;

/** Wraps a tool fn into a `(rawInput, ctxOverride?) => string` callable.
 *  Panel calls with rawInput only; tests pass ctxOverride to inject mock app. */
export function defineJsxTool<I, O>(
  fn: JsxToolFn<I, O>
): (rawInput: string, ctxOverride?: JsxToolCtx) => string {
  return function (rawInput, ctxOverride) {
    var input: I;
    try {
      input = JSON.parse(rawInput);
    } catch (parseErr) {
      var pmsg = (parseErr && (parseErr as { message?: string }).message) || String(parseErr);
      return JSON.stringify({
        ok: false,
        error: {
          code: "AEInputParseError",
          userMessage: "입력 데이터 형식 오류: " + pmsg,
          developerHint: "panel→jsx rawInput JSON.parse 실패. panel 측 JSON.stringify 직전 input 검증.",
        },
      } as JsxErr);
    }

    var ctx: JsxToolCtx;
    if (ctxOverride) {
      ctx = ctxOverride;
    } else {
      // production: ExtendScript provides `app` as a global. In vitest this
      // branch is unreachable because tests always pass ctxOverride.
      ctx = { app: app as JsxAppLike };
    }

    try {
      var output = fn(input, ctx, helpers);
      return JSON.stringify({ ok: true, output: output } as JsxOk<O>);
    } catch (err) {
      // h.fail sentinel — convert to typed error envelope
      if (err && (err as JsxFailSentinel).__jsxFail === true) {
        var s = err as JsxFailSentinel;
        return JSON.stringify({
          ok: false,
          error: {
            code: s.code,
            userMessage: s.userMessage,
            developerHint: s.developerHint,
          },
        } as JsxErr);
      }
      // generic uncaught — wrap as AEScriptError
      var msg = (err && (err as { message?: string }).message) || String(err);
      return JSON.stringify({
        ok: false,
        error: {
          code: "AEScriptError",
          userMessage: "툴 실행 중 오류: " + msg,
          developerHint: "ExtendScript 함수가 throw한 예외 (h.fail 미사용). handler 검토.",
        },
      } as JsxErr);
    }
  };
}
