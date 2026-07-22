// D7 — ExtendScript AST validator (security gate for ae_run_extendscript).
// CLAUDE.md Validation Gate #1: passes adversarial golden set in
// _validateAst.test.ts. Coverage grows per-tool — every new jsx pattern
// added under src/jsx/aeft/tools/ adds at least one matching positive
// case (Phase 5 sub-step rule).
// Strategy: default-deny — every bare identifier reference must be either
// locally declared or on ALLOWED_GLOBALS (enforced in the ancestor walk),
// PLUS absolute DENY_LIST, `this`/`with`/computed-access blocking, and
// #include preprocess. An identifier that is neither declared nor allowed
// is rejected even if it is not on the deny-list (closes the "unknown
// global slips through" hole where ALLOWED_GLOBALS was defined but never
// consulted).
//
// Scope of validation = per-tool source patterns ONLY, NOT the bolt-cep
// production bundle (dist/cep/jsx/index.js). Reason: the bundle inlines
// json2.js polyfill which uses `eval("(" + text + ")")` intentionally
// inside JSON.parse — the polyfill predates ES5 native JSON and that
// `eval` is the standard json2 implementation. Whole-bundle validation
// would false-alarm on vendored polyfill code that we have no business
// rewriting. If a future ES5+ host removes the polyfill need, revisit.

import { Parser } from "acorn";
import { simple as walk, ancestor } from "acorn-walk";
import type { Node } from "acorn";

// Identifiers that MUST NOT appear anywhere in user-supplied ExtendScript.
// ExtendScript globals that grant FS, network, or arbitrary code execution.
const DENY_LIST = new Set([
  // FS / IO
  "File", "Folder", "FileTemp",
  // Network
  "Socket", "ExternalObject",
  // System / shell
  "system",
  // JS dynamic execution
  "eval", "Function",
  // Reflection
  "arguments",
  // Cross-realm escape
  "globalThis", "window", "self", "global",
  // Indirect Function constructor access
  "constructor",
]);

// Dangerous property names. Even when accessed via dot-notation (obj.constructor),
// these grant Function constructor or prototype-chain escape to the deny-list.
// acorn-walk does NOT visit non-computed property Identifiers as Identifier nodes,
// so deny-list alone misses these — handled in MemberExpression visitor below.
//
// To extend: add new property names here AS YOU FIND BYPASS PATTERNS via
// _validateAst.test.ts adversarial cases. See mistakes.md for the playbook.
const DANGEROUS_PROPS = new Set([
  "constructor",   // (0).constructor → Function constructor
  "__proto__",     // ({}).__proto__.constructor → same path
  "callee",        // arguments.callee
  "caller",        // function.caller
  "prototype",     // (function(){}).prototype.bind.call(...) escape
]);

// AE API surface allow-list. Anything not on this list AND not on the deny-list
// is allowed if it appears as a member access (e.g., comp.layer(1).property("..."))
// but NEVER as a bare global identifier. Globals must be in this set.
const ALLOWED_GLOBALS = new Set([
  // Application root
  "app",
  // Type constructors used in jsx (read-only-ish)
  "KeyframeInterpolationType", "KeyframeEase", "MarkerValue",
  "MaskMode", "MaskFeatherInterpolation", "MaskMotionBlur", "TrackMatteType",
  "BlendingMode", "LayerStyle", "FrameBlendingType",
  "PostRenderAction", "RQItemStatus", "ParameterType", "PropertyType",
  "PropertyValueType", "AlphaMode", "FieldSeparationType", "PulldownPhase",
  "PurgeTarget", "Language", "ImportAsType",
  // Math / Date (pure)
  "Math", "Date", "JSON", "Number", "String", "Array", "Object", "Boolean",
  "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  // Loop / control
  "undefined", "null", "true", "false", "NaN", "Infinity",
  // Pure global functions safe in ExtendScript
  "parseInt", "parseFloat", "isNaN", "isFinite",
  // NOTE: `$` (ExtendScript debug global) is intentionally NOT allowed —
  // it exposes $.evalFile / $.global / $.write (FS + arbitrary eval).
  // NOTE: `this` is blocked via the ThisExpression visitor (top-level
  // `this` is the global object → this.File / this.system escape).
]);

export interface AstFinding {
  line: number;
  col: number;
  reason: string;
  identifier?: string;
}

export interface ValidateResult {
  ok: boolean;
  findings: AstFinding[];
}

// ─── Preprocess: strip / reject #include directives ─────────────────

function preprocessIncludes(source: string): { source: string; rejected: AstFinding[] } {
  const rejected: AstFinding[] = [];
  const lines = source.split(/\r?\n/);
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // ExtendScript-specific preprocess: #include "..." or #target etc.
    if (/^\s*#(include|includepath|target|engine|script|strict)\b/i.test(line)) {
      rejected.push({
        line: i + 1,
        col: 0,
        reason: `ExtendScript preprocess directive '${line.trim().slice(0, 30)}' not allowed`,
      });
      cleaned.push(""); // keep line numbers
    } else {
      cleaned.push(line);
    }
  }
  return { source: cleaned.join("\n"), rejected };
}

// ─── Main validator ─────────────────────────────────────────────────

export function validateExtendScript(rawSource: string): ValidateResult {
  const findings: AstFinding[] = [];

  // Step 1: preprocess (strip #include / #target — these would crash acorn)
  const { source, rejected } = preprocessIncludes(rawSource);
  findings.push(...rejected);

  // Step 2: parse as ES3 (ExtendScript is ~ES3)
  let ast: Node;
  try {
    ast = Parser.parse(source, {
      ecmaVersion: 3,
      sourceType: "script",
      locations: true,
      allowReserved: true,
    }) as Node;
  } catch (e) {
    findings.push({
      line: 0,
      col: 0,
      reason: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { ok: false, findings };
  }

  // Step 3a: collect all locally-declared binding names (over-approximated
  // as one flat scope — safe for an allow-list: a locally-bound name is
  // treated as allowed everywhere, which at worst permits a reference to an
  // out-of-scope local (a runtime ReferenceError, NOT a capability escape).
  // DENY_LIST stays absolute and overrides local binding regardless.
  const declared = new Set<string>();
  walk(ast, {
    VariableDeclarator(node: any) {
      if (node.id?.type === "Identifier") declared.add(node.id.name);
    },
    FunctionDeclaration(node: any) {
      if (node.id?.type === "Identifier") declared.add(node.id.name);
      for (const p of node.params ?? []) if (p.type === "Identifier") declared.add(p.name);
    },
    FunctionExpression(node: any) {
      if (node.id?.type === "Identifier") declared.add(node.id.name);
      for (const p of node.params ?? []) if (p.type === "Identifier") declared.add(p.name);
    },
    CatchClause(node: any) {
      if (node.param?.type === "Identifier") declared.add(node.param.name);
    },
  });

  // Step 3b: walk with ancestor context. Every Identifier in *reference*
  // position must be either locally declared or on ALLOWED_GLOBALS —
  // default-deny. DENY_LIST is checked first and always wins.
  ancestor(ast, {
    Identifier(node: any, _state: unknown, ancestors: any[]) {
      const name = node.name as string;
      if (DENY_LIST.has(name)) {
        findings.push({
          line: node.loc?.start.line ?? 0,
          col: node.loc?.start.column ?? 0,
          reason: `Use of '${name}' is forbidden (FS/network/eval surface)`,
          identifier: name,
        });
        return;
      }
      // ancestors includes the node itself as the last element.
      const parent = ancestors[ancestors.length - 2];
      if (parent && isNonReferencePosition(node, parent)) return;
      if (declared.has(name) || ALLOWED_GLOBALS.has(name)) return;
      findings.push({
        line: node.loc?.start.line ?? 0,
        col: node.loc?.start.column ?? 0,
        reason: `Reference to '${name}' is not on the AE API allow-list (default-deny)`,
        identifier: name,
      });
    },

    // Block `this` — top-level `this` is the global object, so this.File /
    // this.system / this.eval reach the full deny-list surface via a
    // non-computed member access that the property rules don't cover.
    ThisExpression(node: any) {
      findings.push({
        line: node.loc?.start.line ?? 0,
        col: node.loc?.start.column ?? 0,
        reason: "'this' is not allowed (global-object escape: this.File / this.system)",
      });
    },

    // MemberExpression: two distinct risks handled here.
    //   1. Computed access (obj[expr]) — bypasses static identifier check
    //   2. Non-computed access to dangerous property names (obj.constructor)
    //      — acorn-walk's Identifier visitor doesn't visit non-computed property
    //        nodes as Identifiers, so the allow/deny checks miss them. See DANGEROUS_PROPS.
    MemberExpression(node: any) {
      const prop = node.property;
      if (node.computed) {
        // Allow simple literal index: arr[0]. Anything else is bypass risk.
        if (prop.type === "Literal" && typeof prop.value === "number") {
          return;
        }
        findings.push({
          line: node.loc?.start.line ?? 0,
          col: node.loc?.start.column ?? 0,
          reason: "Computed member access (obj[expr]) not allowed; bypass risk",
        });
      } else if (prop.type === "Identifier" && DANGEROUS_PROPS.has(prop.name)) {
        findings.push({
          line: node.loc?.start.line ?? 0,
          col: node.loc?.start.column ?? 0,
          reason: `Access to '.${prop.name}' is forbidden (Function constructor / prototype escape)`,
          identifier: prop.name,
        });
      }
    },

    // Block 'with' statement (allows scope manipulation to access globals indirectly)
    WithStatement(node: any) {
      findings.push({
        line: node.loc?.start.line ?? 0,
        col: node.loc?.start.column ?? 0,
        reason: "'with' statement not allowed (scope manipulation risk)",
      });
    },

    // Block CallExpression to setTimeout/setInterval with string arg (eval-like)
    CallExpression(node: any) {
      const callee = node.callee;
      if (callee.type === "Identifier" && (callee.name === "setTimeout" || callee.name === "setInterval")) {
        const firstArg = node.arguments[0];
        if (firstArg && firstArg.type === "Literal" && typeof firstArg.value === "string") {
          findings.push({
            line: node.loc?.start.line ?? 0,
            col: node.loc?.start.column ?? 0,
            reason: `${callee.name} with string argument is eval-like; not allowed`,
          });
        }
      }
    },
  });

  return { ok: findings.length === 0, findings };
}

// True when `node` (an Identifier) is a binding/label/property name rather
// than a value reference — those positions are exempt from the allow-list.
function isNonReferencePosition(node: any, parent: any): boolean {
  switch (parent.type) {
    case "MemberExpression":
      // non-computed property name (obj.foo) — not a reference to `foo`
      return parent.property === node && !parent.computed;
    case "Property":
      // object-literal key ({ foo: 1 }) when not computed
      return parent.key === node && !parent.computed;
    case "VariableDeclarator":
      return parent.id === node;
    case "FunctionDeclaration":
    case "FunctionExpression":
      return parent.id === node || (parent.params ?? []).includes(node);
    case "CatchClause":
      return parent.param === node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label === node;
    default:
      return false;
  }
}

// ─── Helper: format findings for ApprovalRequestMsg ─────────────────

export function formatFindings(findings: AstFinding[]): Array<{ line: number; reason: string }> {
  return findings.map((f) => ({ line: f.line, reason: f.reason }));
}
