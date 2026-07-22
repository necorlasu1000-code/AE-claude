// Phase 3.5 — useExtendScriptBridge unit tests.
//
// Runs in node env (no jsdom — bridge is pure factory, not a real React hook).
// Inline `vi.fn()` mocks per test (no factory file) — Phase 4/5 may grow a
// shared mock if integration tests need it.

import { describe, it, expect, vi } from "vitest";
import {
  useExtendScriptBridge,
  type BridgeLogEvent,
  type UseExtendScriptBridgeDeps,
} from "./useExtendScriptBridge";

function makeDeps(
  evalScript: (script: string, cb: (raw: string) => void) => void,
  emit?: (e: BridgeLogEvent) => void,
  now?: () => number,
): UseExtendScriptBridgeDeps {
  return {
    csInterface: { evalScript },
    ns: "ns",
    emit,
    now,
  };
}

describe("useExtendScriptBridge", () => {
  it("happy path — jsx {ok:true,output} → ExecResult ok with data", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) => {
      cb('{"ok":true,"output":{"name":"Hero","frameRate":24}}');
    });
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({ requestId: "r1", tool: "ae_get_active_comp", input: {} });

    expect(result).toEqual({ ok: true, data: { name: "Hero", frameRate: 24 } });
    expect(evalScript).toHaveBeenCalledTimes(1);
    expect(evalScript.mock.calls[0][0]).toBe('$["ns"].tools.ae_get_active_comp("{}")');
  });

  it("jsx h.fail {ok:false,error} → ExecResult ok:false branch", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) => {
      cb(JSON.stringify({
        ok: false,
        error: {
          code: "AENoActiveCompError",
          userMessage: "활성 컴프 없음",
          developerHint: "사용자에게 컴프 선택 제안",
        },
      }));
    });
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({ requestId: "r2", tool: "ae_get_active_comp", input: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AENoActiveCompError");
      expect(result.userMessage).toBe("활성 컴프 없음");
      expect(result.developerHint).toBe("사용자에게 컴프 선택 제안");
    }
  });

  it("malformed JSON return → AEResultParseError (보완 3 negative case)", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) => {
      cb("}{garbage not json");
    });
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({ requestId: "r3", tool: "ae_get_active_comp", input: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AEResultParseError");
      expect(result.developerHint).toMatch(/jsx return이 valid JSON 아님/);
    }
  });

  it("valid JSON but wrong shape → AEResultParseError", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) => {
      cb('{"foo":"bar"}'); // no `ok` field
    });
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({ requestId: "r4", tool: "any", input: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AEResultParseError");
      expect(result.developerHint).toMatch(/형식 아님/);
    }
  });

  it("FIFO serialization — concurrent exec(2) calls evalScript once at a time", async () => {
    const callOrder: string[] = [];
    let pendingCb: ((raw: string) => void) | null = null;
    const evalScript = vi.fn((script: string, cb: (raw: string) => void) => {
      callOrder.push("eval:" + script.match(/tools\.(\w+)/)![1]);
      pendingCb = cb;
    });

    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const p1 = bridge.exec({ requestId: "r1", tool: "first", input: {} });
    const p2 = bridge.exec({ requestId: "r2", tool: "second", input: {} });

    // After firing both, only first evalScript should have run (second queued)
    expect(evalScript).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["eval:first"]);
    expect(bridge.inflight).toBe(2);

    // Resolve first call
    pendingCb!('{"ok":true,"output":1}');
    await p1;

    // Now second evalScript fires
    expect(evalScript).toHaveBeenCalledTimes(2);
    expect(callOrder).toEqual(["eval:first", "eval:second"]);
    expect(bridge.inflight).toBe(1);

    // Resolve second
    pendingCb!('{"ok":true,"output":2}');
    await p2;

    expect(bridge.inflight).toBe(0);
  });

  it("emit sequence — happy path: enter → exit(ok:true)", async () => {
    const emit = vi.fn();
    const evalScript = vi.fn((_s: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":{}}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript, emit));

    await bridge.exec({ requestId: "r5", tool: "any", input: {} });

    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "bridge:enter", requestId: "r5", tool: "any" });
    expect(events[1]).toMatchObject({ event: "bridge:exit", requestId: "r5", ok: true });
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emit sequence — error path: enter → error(code) → exit(ok:false)", async () => {
    const emit = vi.fn();
    const evalScript = vi.fn((_s: string, cb: (raw: string) => void) =>
      cb('{"ok":false,"error":{"code":"AENoActiveCompError","userMessage":"x","developerHint":"y"}}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript, emit));

    await bridge.exec({ requestId: "r6", tool: "any", input: {} });

    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe("bridge:enter");
    expect(events[1]).toMatchObject({ event: "bridge:error", requestId: "r6", code: "AENoActiveCompError" });
    expect(events[2]).toMatchObject({ event: "bridge:exit", requestId: "r6", ok: false });
  });

  it("durationMs uses injected `now` — measures wall time between enter and exit", async () => {
    const emit = vi.fn();
    let t = 1000;
    const now = vi.fn(() => t);
    const evalScript = vi.fn((_s: string, cb: (raw: string) => void) => {
      t += 42; // simulate jsx round-trip taking 42ms
      cb('{"ok":true,"output":null}');
    });
    const bridge = useExtendScriptBridge(makeDeps(evalScript, emit, now));

    await bridge.exec({ requestId: "r7", tool: "any", input: {} });

    const exitEvent = emit.mock.calls.find((c) => c[0].event === "bridge:exit")![0];
    expect(exitEvent.durationMs).toBe(42);
  });

  it("default emit (deps.emit undefined) — does not throw, no console.log either", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const evalScript = vi.fn((_s: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":{}}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    await expect(
      bridge.exec({ requestId: "r8", tool: "any", input: {} }),
    ).resolves.toMatchObject({ ok: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("input JSON encoding — nested objects + Korean preserved through double-stringify", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":null}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    await bridge.exec({
      requestId: "r9",
      tool: "ae_create_comp",
      input: { name: "한글 컴프", size: { w: 1920, h: 1080 } },
    });

    const script = evalScript.mock.calls[0][0];
    // Expect: $["ns"].tools.ae_create_comp("<JSON-stringified input>")
    // The string literal arg, when JSON.parsed inside jsx, should yield
    // back the original input JSON.
    const argMatch = script.match(/^\$\["ns"\]\.tools\.ae_create_comp\((.*)\)$/);
    expect(argMatch).toBeTruthy();
    const argLiteral = argMatch![1];
    const inputJsonRecovered = JSON.parse(argLiteral);
    const inputObjRecovered = JSON.parse(inputJsonRecovered);
    expect(inputObjRecovered).toEqual({ name: "한글 컴프", size: { w: 1920, h: 1080 } });
  });

  // mistakes #24 — the U+2028/9 escape shipped as a no-op (single-backslash
  // escape sequence = the raw char itself → split(X).join(X) identity). This
  // test feeds the raw characters through input and asserts the generated
  // script (a) no longer contains them raw, (b) still parses, (c) round-trips.
  it("U+2028/U+2029 in input → escaped in script (no raw line terminators), round-trips", async () => {
    const { Parser } = await import("acorn");
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":null}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const input = { text: "a" + LS + "b" + PS + "c" };
    await bridge.exec({ requestId: "r-ls", tool: "ae_create_comp", input });

    const script = evalScript.mock.calls[0][0] as string;
    // (a) raw line terminators must not survive into the evalScript source.
    expect(script.indexOf(LS)).toBe(-1);
    expect(script.indexOf(PS)).toBe(-1);
    // (b) the source must be parseable (ES3-era grammar; raw U+2028/9 inside
    // a string literal would be a syntax error here, as in ExtendScript).
    expect(() => Parser.parse(script, { ecmaVersion: 5 })).not.toThrow();
    // (c) the double-stringify round-trip still recovers the exact input.
    const argMatch = script.match(/^\$\["ns"\]\.tools\.ae_create_comp\((.*)\)$/);
    expect(argMatch).toBeTruthy();
    const wire = JSON.parse(argMatch![1]);
    expect(JSON.parse(wire)).toEqual(input);
  });

  // mistakes #24 follow-on — JSON.stringify(undefined) returns undefined (not
  // a string); pre-fix the escape chain then threw inside the exec promise
  // executor → unhandled rejection + queue wedged until the watchdog.
  it("input === undefined → no throw, serialized as null, queue stays healthy", async () => {
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":null}'),
    );
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({
      requestId: "r-undef",
      tool: "ae_get_active_comp",
      input: undefined,
    });

    expect(result.ok).toBe(true);
    const script = evalScript.mock.calls[0][0] as string;
    expect(script.endsWith('("null")')).toBe(true);
    expect(bridge.inflight).toBe(0);
  });

  it("invalid tool name → AEInvalidToolName, evalScript never called (injection guard)", async () => {
    const evalScript = vi.fn((_s: string, cb: (raw: string) => void) => cb('{"ok":true,"output":{}}'));
    const bridge = useExtendScriptBridge(makeDeps(evalScript));

    const result = await bridge.exec({
      requestId: "inj",
      tool: "x)(function(){$.evalFile('/evil')})(",
      input: {},
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AEInvalidToolName");
    expect(evalScript).not.toHaveBeenCalled();
    expect(bridge.inflight).toBe(0);
  });

  it("watchdog timeout — callback never fires → AEBridgeTimeout, queue unblocks", async () => {
    vi.useFakeTimers();
    try {
      // First call's callback never fires (simulates AE modal alert hang).
      const evalScript = vi.fn((_s: string, _cb: (raw: string) => void) => {
        /* intentionally never calls cb */
      });
      const bridge = useExtendScriptBridge({ csInterface: { evalScript }, ns: "ns", timeoutMs: 1000 });

      const p1 = bridge.exec({ requestId: "stuck", tool: "ae_get_active_comp", input: {} });
      expect(bridge.inflight).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      const r1 = await p1;
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.code).toBe("AEBridgeTimeout");
      // Queue must be drainable again after the stuck call.
      expect(bridge.inflight).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("late callback after timeout is dropped (no double-resolve)", async () => {
    vi.useFakeTimers();
    try {
      let saved: ((raw: string) => void) | null = null;
      const evalScript = vi.fn((_s: string, cb: (raw: string) => void) => { saved = cb; });
      const emit = vi.fn();
      const bridge = useExtendScriptBridge({ csInterface: { evalScript }, ns: "ns", emit, timeoutMs: 500 });

      const p = bridge.exec({ requestId: "late", tool: "any", input: {} });
      await vi.advanceTimersByTimeAsync(500);
      const r = await p;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("AEBridgeTimeout");

      // Late callback arrives — must be ignored (single settle).
      saved!('{"ok":true,"output":{"late":true}}');
      const exits = emit.mock.calls.map((c) => c[0]).filter((e) => e.event === "bridge:exit");
      expect(exits).toHaveLength(1);
      expect(bridge.inflight).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Phase 3.7 fix verification — production ns with dots ──────────
  // Mock-with-short-ns hides chained-property ambiguity. Use the real
  // production ns ("com.aeclaude.panel") and parse the generated script
  // through acorn to confirm the AST shape is what we intend (not
  // dotted property access on a `com` identifier). Without this, a
  // future ns rename to a dotted value would slip past unit tests and
  // fail at the first AE click. Phase 5 30-tool authors inherit
  // coverage automatically.
  it("real ns with dots — generated script parses + first call shape is $[ns].tools.<tool>(...)", async () => {
    const { Parser } = await import("acorn");
    const evalScript = vi.fn((_script: string, cb: (raw: string) => void) =>
      cb('{"ok":true,"output":{}}'),
    );
    const realNs = "com.aeclaude.panel";
    const bridge = useExtendScriptBridge({
      csInterface: { evalScript },
      ns: realNs,
    });

    await bridge.exec({ requestId: "rid-real-ns", tool: "ae_get_active_comp", input: { x: 1 } });

    const script = evalScript.mock.calls[0][0] as string;

    // 1. Script must be parseable JS (no syntax error).
    expect(() => Parser.parse(script, { ecmaVersion: 5 })).not.toThrow();

    // 2. Single ExpressionStatement → CallExpression at the top.
    const ast = Parser.parse(script, { ecmaVersion: 5 }) as { body: unknown[] };
    expect(ast.body).toHaveLength(1);
    const stmt = ast.body[0] as { type: string; expression: { type: string; callee: unknown; arguments: unknown[] } };
    expect(stmt.type).toBe("ExpressionStatement");
    expect(stmt.expression.type).toBe("CallExpression");

    // 3. callee shape: MemberExpression(MemberExpression($[ns]), tools).<tool>
    //    Innermost object must be `$[<string-literal-ns>]` — bracket
    //    notation, NOT a chained property access on a `com` identifier.
    const callee = stmt.expression.callee as {
      type: string;
      object: { type: string; object: { type: string; object: { type: string; name?: string }; property: { type: string; value?: string }; computed: boolean }; property: { type: string; name: string } };
      property: { type: string; name: string };
    };
    expect(callee.type).toBe("MemberExpression");
    expect(callee.property).toMatchObject({ type: "Identifier", name: "ae_get_active_comp" });

    const tools = callee.object;
    expect(tools.type).toBe("MemberExpression");
    expect(tools.property).toMatchObject({ type: "Identifier", name: "tools" });

    const dollarNs = tools.object;
    expect(dollarNs.type).toBe("MemberExpression");
    expect(dollarNs.computed).toBe(true); // bracket notation
    expect(dollarNs.object).toMatchObject({ type: "Identifier", name: "$" });
    expect(dollarNs.property).toMatchObject({ type: "Literal", value: realNs });
  });
});
