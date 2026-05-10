// Phase 3.3 -- defineJsxTool HOF (ExtendScript-side, mirror of sidecar/src/tools/_define.ts).
//
// Wraps a per-tool fn so panel->jsx round-trip is always:
//   rawInput (string) -> JSON.parse -> fn(input, ctx, h) -> JSON.stringify({ok,output})
// Failure is caught and converted to {ok:false, error:{code,userMessage,developerHint}}
// -- the same shape the panel's useExtendScriptBridge expects. No throws escape
// the wrapper; CSInterface.evalScript callback always sees a JSON string.
//
// Difference from sidecar defineAETool (D4):
//   sidecar: async + zod schema validation + undo group + crash recovery
//   jsx:     sync   + try/catch  + JSON serialize  (ES3 limits -- no Promise,
//                                                   no zod runtime here)
// Validation lives in the sidecar dispatcher; jsx side only enforces shape.
//
// Failure helper usage rule:
//   throw h.fail("AECode", "user-facing", "developer-facing");
// `return h.fail(...)` is FORBIDDEN -- h.fail returns a sentinel that only
// makes sense when thrown (the catch branch detects __jsxFail and converts).
// Returning the sentinel as output would JSON.stringify it as-is and panel
// would see {ok:true, output:{__jsxFail:true,...}} -- silent corruption.
// The sentinel pattern keeps fn bodies linear (no envelope plumbing) while
// still letting Phase 5 30-tool authors raise typed errors with one line.
//
// `app` global: declared ambient so production jsx code (where ExtendScript
// provides `app` as a global) compiles without import. In vitest the global
// is undefined -- tests MUST inject `ctxOverride` so the wrapper never
// touches the bare `app` identifier (test envs would ReferenceError).

declare const app: unknown;

// --- shared item / app shapes (panel-jsx contract) --------------------

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
  /** Phase 5.1.5 -- ae_get_layers iterates LayerCollection. ExtendScript's
   *  comp.layer(i) (1-based). Optional in the type so older fixtures stay
   *  compatible; production AE always populates it. Mock fixtures must
   *  enforce method receiver identity (mistakes #17 -- ExtendScript
   *  SpiderMonkey throws on detached calls). */
  layer?(index: number): JsxLayerLike;
}

// Phase 5.1.5 -- minimum Layer shape used by ae_get_layers and future
// layer-domain tools. Real AE Layer subclasses (AVLayer/CameraLayer/
// LightLayer/ShapeLayer/TextLayer) all extend Layer; we duck-type the
// shared fields here. matchName comes from PropertyBase (Layer extends
// PropertyGroup extends PropertyBase) -- locale-stable internal id like
// "ADBE Vector Layer".
//
// Type discrimination uses Object.prototype.toString.call(layer) (or the
// equivalent layer.toString()) which returns "[object CameraLayer]" etc.
// in production AE. Mock fixtures must override toString to match -- see
// _mockApp.ts makeMockLayer.
export interface JsxLayerLike {
  index: number;
  name: string;
  matchName: string;
  enabled: boolean;
  locked: boolean;
  inPoint: number;
  outPoint: number;
  /** Real AE Layer.toString() returns "[object CameraLayer]" / "[object
   *  AVLayer]" / etc. Mock fixtures override this method to return the
   *  same shape so impl.ts can use a single reflection pattern across
   *  both environments. */
  toString(): string;
  /** Phase 5.1.6 -- ExtendScript Layer.property(matchName) -- looks up a
   *  child PropertyGroup by matchName (e.g., "ADBE Effect Parade").
   *  Optional in the type; production AE always populates it (Layer
   *  extends PropertyGroup extends PropertyBase, both define property()).
   *  Camera/Light/Null layers don't host effects -- production AE may
   *  throw on `layer.property("ADBE Effect Parade")`, so callers should
   *  try/catch and treat throws as "no effects". */
  property?(matchName: string): JsxPropertyGroupLike;
}

// Phase 5.1.6 -- minimum PropertyBase shape (effects + masks + transforms
// + future tool domains all share this). matchName is locale-stable
// (e.g., "ADBE Gaussian Blur 2"); name is the locale-dependent display
// label that the user can rename. enabled controls the property's eyeball
// state. impl.ts ae_list_effects maps PropertyBase.name -> output
// `displayName` field (real AE has no separate displayName property).
//
// Phase 5.1.7 -- expression?/expressionEnabled? optional. Real AE leaf
// `Property extends PropertyBase` adds `expression: string` and
// `expressionEnabled: boolean`; PropertyGroup (effects, masks, transform
// groups) does NOT have these fields. We keep one interface and gate
// access via optionals so 30-tool growth (keyframes, expressions,
// property values) shares a single PropertyLike contract instead of
// branching into Property vs PropertyGroup discriminants. impl.ts
// guards with `expression ?? ""` semantics to handle the missing-field
// case (PropertyGroup invocation, unlikely but typed).
export interface JsxPropertyLike {
  matchName: string;
  /** PropertyBase.name -- locale-dependent, user-renameable. Surfaces as
   *  `displayName` in tool output schemas where that distinction matters. */
  name: string;
  enabled: boolean;
  /** Phase 5.1.7 -- ExtendScript Property.expression. Empty string when
   *  no expression is set. PropertyGroup invocations omit this field;
   *  callers must handle undefined defensively even though leaf Property
   *  always populates it in production AE. */
  expression?: string;
  /** Phase 5.1.7 -- ExtendScript Property.expressionEnabled. Same
   *  optional semantics as expression. */
  expressionEnabled?: boolean;
  /** Phase 5.1.8 -- ExtendScript Property.numKeys. PropertyGroup omits;
   *  leaf Property always populates (0 when no keyframes). Callers must
   *  guard typeof === "number" before iterating. */
  numKeys?: number;
  /** Phase 5.1.8 -- Property.keyTime(keyIndex). 1-based keyIndex. Returns
   *  seconds. Mistakes #17: must be called as property.keyTime(i) directly. */
  keyTime?(keyIndex: number): number;
  /** Phase 5.1.8 -- Property.keyValue(keyIndex). 1-based keyIndex. Return
   *  shape varies by propertyValueType (number / number[] / object). */
  keyValue?(keyIndex: number): unknown;
  /** Phase 5.1.8 -- Property.keyInInterpolationType(keyIndex). Returns
   *  KeyframeInterpolationType int (LINEAR=6612, BEZIER=6613, HOLD=6614). */
  keyInInterpolationType?(keyIndex: number): number;
  /** Phase 5.1.8 -- Property.keyOutInterpolationType(keyIndex). Same as
   *  in-side; AE allows mismatched in/out types. */
  keyOutInterpolationType?(keyIndex: number): number;
}

// Phase 5.1.6 -- PropertyGroup extends PropertyBase. Adds numProperties
// and a 1-based child accessor. ae_list_effects iterates the "ADBE Effect
// Parade" PropertyGroup using these. Future PropertyGroup-domain tools
// (masks, transform sub-groups, expressions) follow the same shape.
//
// Mistakes #17: property(index) MUST be called as group.property(i)
// directly. Detached calls (var fn = group.property; fn(i)) lose the
// receiver and ExtendScript SpiderMonkey throws. Mock fixtures enforce
// receiver identity in _mockApp.ts.
export interface JsxPropertyGroupLike extends JsxPropertyLike {
  numProperties: number;
  property?(index: number): JsxPropertyLike;
}

// Phase 5.1.4 -- extracted to a named interface so 30-tool growth (5.1.4~)
// extends one place instead of inlining shape per tool. Fields stay
// optional so Phase 3.3 ae_get_active_comp callers (only touch
// activeItem) keep type-checking unchanged.
export interface JsxProjectLike {
  activeItem: JsxItemLike | null;
  /** ExtendScript's app.project.numItems -- total items in project pane.
   *  Optional in the type to keep older test fixtures compatible; production
   *  AE always populates it. */
  numItems?: number;
  /** ExtendScript's app.project.item(i) -- 1-based item accessor.
   *  ItemCollection is also indexable via items[i] in real AE; we standardize
   *  on the function-call form for mock simplicity (callable indexable is
   *  awkward in vitest). Optional for the same reason as numItems. */
  item?(index: number): JsxItemLike;
  /** Phase 5.1.5 -- ExtendScript's app.project.itemByID(id). Returns the
   *  matching item; production AE throws when id is not found, so callers
   *  must wrap in try/catch. Optional for fixture compatibility. */
  itemByID?(id: number): JsxItemLike;
  /** Phase 5.2.1 -- app.project.file (ExtendScript File class | null).
   *  null when project is unsaved/new. Property fsName/name are read
   *  directly without method calls. */
  file?: JsxFileLike | null;
  /** Phase 5.2.1 -- color depth bits per channel: 8/16/32. */
  bitsPerChannel?: number;
  /** Phase 5.2.1 -- "extendscript" (legacy) or "javascript-1.0" (modern). */
  expressionEngine?: "extendscript" | "javascript-1.0";
  /** Phase 5.2.1 -- frame numbering start (Project Settings > Display Style). */
  displayStartFrame?: number;
}

/** Phase 5.2.1 -- ExtendScript File class minimal duck-type. fsName +
 *  name are read-only properties (not methods), so this interface only
 *  exposes them as fields. Production File has many more methods (open,
 *  read, write, etc.) but those are out of scope for read-only project
 *  metadata; ae_run_extendscript (Phase 5.8) under D3 + AST validator
 *  is the only path for File method calls. */
export interface JsxFileLike {
  /** Absolute path (Windows backslash on Windows, forward slash POSIX). */
  fsName: string;
  /** Basename (e.g. "MyProject.aep"). */
  name: string;
}

export interface JsxAppLike {
  project: JsxProjectLike;
  /** Phase 5.2.1 -- app.version (e.g. "22.0.0"). Optional for backward
   *  compatibility with Phase 3.3-5.1 mock fixtures that don't populate
   *  it. Production AE always populates. */
  version?: string;
}

export interface JsxToolCtx {
  app: JsxAppLike;
}

// --- envelope shapes --------------------------------------------------

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

// --- failure helper (sentinel) ----------------------------------------

interface JsxFailSentinel {
  __jsxFail: true;
  code: string;
  userMessage: string;
  developerHint: string;
}

export interface JsxToolHelpers {
  /** Returns a sentinel for the wrapper's catch branch. Always use as
   *  `throw h.fail(...)` -- never `return h.fail(...)` (see file header). */
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

// --- HOF --------------------------------------------------------------

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
          userMessage: "Input parse failed: " + pmsg,
          developerHint: "panel->jsx rawInput JSON.parse failed. Validate input before JSON.stringify on panel side.",
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
      // h.fail sentinel -- convert to typed error envelope
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
      // generic uncaught -- wrap as AEScriptError
      var msg = (err && (err as { message?: string }).message) || String(err);
      return JSON.stringify({
        ok: false,
        error: {
          code: "AEScriptError",
          userMessage: "Tool execution failed: " + msg,
          developerHint: "ExtendScript function threw uncaught (h.fail not used). Review handler.",
        },
      } as JsxErr);
    }
  };
}
