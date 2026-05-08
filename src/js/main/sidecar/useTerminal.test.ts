// @vitest-environment jsdom
//
// useTerminal hook unit tests — 8 scenarios with mocked xterm/WebSocket/launcher.
// jsdom provides document; ResizeObserver is NOT in jsdom, so we inject a mock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useTerminal, type UseTerminalDeps } from "./useTerminal.js";

// ─── Mocks ─────────────────────────────────────────────────────────

interface MockTerminalState {
  cols: number;
  rows: number;
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  _dataCbs: ((d: string) => void)[];
  _resizeCbs: ((d: { cols: number; rows: number }) => void)[];
  _writes: string[];
  _fireData(d: string): void;
  _fireResize(cols: number, rows: number): void;
  // Phase 5.1.9 keybinding surface
  _selection: string;
  _keyHandler: ((e: KeyboardEvent) => boolean) | undefined;
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
}

let lastTerminal: MockTerminalState | undefined;

class MockTerminal {
  cols = 80;
  rows = 24;
  open = vi.fn();
  write: ReturnType<typeof vi.fn>;
  dispose = vi.fn();
  loadAddon = vi.fn();
  _dataCbs: ((d: string) => void)[] = [];
  _resizeCbs: ((d: { cols: number; rows: number }) => void)[] = [];
  _writes: string[] = [];
  // Phase 5.1.9 — Ctrl+C / Ctrl+V keybinding test surface.
  _selection = "";
  _keyHandler: ((e: KeyboardEvent) => boolean) | undefined = undefined;
  attachCustomKeyEventHandler = vi.fn((cb: (e: KeyboardEvent) => boolean) => {
    this._keyHandler = cb;
  });
  getSelection = vi.fn(() => this._selection);
  clearSelection = vi.fn(() => { this._selection = ""; });
  // paste() in real xterm fires onData with the pasted text -- mirror that
  // so the test can verify ws.send pty.in is invoked end-to-end.
  paste: ReturnType<typeof vi.fn>;

  constructor() {
    const writes = this._writes;
    this.write = vi.fn((d: string) => { writes.push(d); });
    const dataCbs = this._dataCbs;
    this.paste = vi.fn((text: string) => {
      for (const c of dataCbs) c(text);
    });
    lastTerminal = this as unknown as MockTerminalState;
  }
  onData(cb: (d: string) => void) {
    this._dataCbs.push(cb);
    return { dispose: () => {} };
  }
  onResize(cb: (d: { cols: number; rows: number }) => void) {
    this._resizeCbs.push(cb);
    return { dispose: () => {} };
  }
  _fireData(d: string) { for (const c of this._dataCbs) c(d); }
  _fireResize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    for (const c of this._resizeCbs) c({ cols, rows });
  }
}

class MockFitAddon { fit = vi.fn(); }
class MockWebLinks {}
class MockWebgl {}

// Tracks all WebSocket instances created during a test.
let lastWs: MockWebSocket | undefined;
class MockWebSocket {
  url: string;
  readyState = 0;  // CONNECTING
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    setImmediate(() => this._fire("close", new Event("close")));
  });
  private listeners: Record<string, ((ev: any) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    lastWs = this;
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: any) => void) {
    const arr = this.listeners[type];
    if (arr) {
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  _fire(type: string, ev: any) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  _open() { this.readyState = 1; this._fire("open", new Event("open")); }
  _message(payload: unknown) {
    this._fire("message", { data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
  _close() { this.readyState = 3; this._fire("close", new Event("close")); }
}

class MockResizeObserver {
  static last: MockResizeObserver | undefined;
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    MockResizeObserver.last = this;
  }
}

// Mock launcher (Phase 2.6 pattern, simplified).
function makeMockLauncher(opts: {
  startResult?: { port: number; sidecarPid: number; host: string; version: string; protocolVersion: number };
  startReject?: Error;
} = {}) {
  const startResult = opts.startResult ?? {
    port: 12345,
    sidecarPid: 99,
    host: "127.0.0.1",
    version: "0.1.0",
    protocolVersion: 1,
  };
  const crashCbs: ((info: any) => void)[] = [];
  const launcher = {
    start: vi.fn(() => opts.startReject ? Promise.reject(opts.startReject) : Promise.resolve(startResult)),
    stop: vi.fn(() => Promise.resolve()),
    onCrash: vi.fn((cb: (info: any) => void) => { crashCbs.push(cb); return () => {}; }),
    _fireCrash: (info: any) => { for (const c of crashCbs) c(info); },
  };
  return launcher;
}

function makeDeps(launcher = makeMockLauncher()): { deps: UseTerminalDeps; launcher: ReturnType<typeof makeMockLauncher> } {
  const launcherFactory = vi.fn(() => launcher as any);
  const deps: UseTerminalDeps = {
    TerminalCtor: MockTerminal as any,
    FitAddonCtor: MockFitAddon as any,
    WebLinksAddonCtor: MockWebLinks as any,
    WebglAddonCtor: MockWebgl as any,
    WebSocketCtor: MockWebSocket as any,
    launcherFactory,
    ResizeObserverCtor: MockResizeObserver as any,
  };
  return { deps, launcher };
}

// Helper hook wrapper — provides a real container div + the hook under test.
function useWrapped(options: any, deps: UseTerminalDeps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Synchronously attach a div so ref.current is populated before useEffect.
  if (!containerRef.current) {
    containerRef.current = document.createElement("div");
  }
  const result = useTerminal(containerRef, options, deps);
  return { containerRef, ...result };
}

// Phase 5.1.9 — clipboard mock. jsdom doesn't ship navigator.clipboard;
// stubbed per test so writeText/readText calls are observable. Tests not
// related to clipboard ignore these mocks (no assertion = no effect).
let clipboardMock: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };

beforeEach(() => {
  lastTerminal = undefined;
  lastWs = undefined;
  MockResizeObserver.last = undefined;
  vi.clearAllMocks();
  clipboardMock = {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  };
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: clipboardMock,
  });
});

// ─── Suite ─────────────────────────────────────────────────────────

describe("useTerminal", () => {
  // ── 1 ────────────────────────────────────────────────────────────
  it("mount: status starts at 'starting' and launcher.start is called", async () => {
    const { deps, launcher } = makeDeps();
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    expect(result.current.status).toBe("starting");
    await waitFor(() => expect(launcher.start).toHaveBeenCalledTimes(1));
  });

  // ── 2 ────────────────────────────────────────────────────────────
  it("start resolves → MockWebSocket constructed at correct URL", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    expect(lastWs!.url).toBe("ws://127.0.0.1:12345");
  });

  // ── 3 ────────────────────────────────────────────────────────────
  it("ws open → status 'ready' + initial pty.resize sent", async () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    // Initial resize message should have been sent on open.
    const sends = lastWs!.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const resize = sends.find((m) => m.type === "pty.resize");
    expect(resize).toBeDefined();
    expect(resize.cols).toBe(80);
    expect(resize.rows).toBe(24);
  });

  // ── 4 ────────────────────────────────────────────────────────────
  it("WS pty.out → terminal.write called with payload", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(lastTerminal).toBeDefined());
    act(() => { lastWs!._message({ type: "pty.out", data: "hello\r\n" }); });
    expect(lastTerminal!._writes).toContain("hello\r\n");
  });

  // ── 5 ────────────────────────────────────────────────────────────
  it("terminal.onData (user input) → ws.send pty.in envelope", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(lastTerminal).toBeDefined());

    const sendCallsBefore = lastWs!.send.mock.calls.length;
    act(() => { lastTerminal!._fireData("ls\r"); });
    const sendCallsAfter = lastWs!.send.mock.calls.length;
    expect(sendCallsAfter).toBe(sendCallsBefore + 1);
    const sent = JSON.parse(lastWs!.send.mock.calls[sendCallsAfter - 1]![0] as string);
    expect(sent).toEqual({ type: "pty.in", data: "ls\r" });
  });

  // ── 6 ────────────────────────────────────────────────────────────
  it("terminal.onResize → ws.send pty.resize envelope (cols/rows)", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(lastTerminal).toBeDefined());

    const before = lastWs!.send.mock.calls.length;
    act(() => { lastTerminal!._fireResize(120, 40); });
    expect(lastWs!.send.mock.calls.length).toBe(before + 1);
    const sent = JSON.parse(lastWs!.send.mock.calls[before]![0] as string);
    expect(sent).toEqual({ type: "pty.resize", cols: 120, rows: 40 });
  });

  // ── 7 ────────────────────────────────────────────────────────────
  it("unmount: ResizeObserver disconnected, launcher.stop called", async () => {
    const { deps, launcher } = makeDeps();
    const { unmount } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(lastTerminal).toBeDefined());

    const observer = MockResizeObserver.last!;
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
    // Cleanup chain: sendShutdownOverWs → launcher.stop. The shutdown helper
    // waits for sys.shutting-down ack (default 5s timeout). Simulate the ack
    // so the chain completes without 5s real delay.
    await new Promise((r) => setImmediate(r));
    act(() => { lastWs!._message({ type: "sys.shutting-down", ts: Date.now() }); });
    // Flush microtasks for ws.close → launcher.stop.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(launcher.stop).toHaveBeenCalled();
  });

  // ── 8 ────────────────────────────────────────────────────────────
  it("launcher.onCrash fires → status 'crashed' + error contains stderr", async () => {
    const launcher = makeMockLauncher();
    const { deps } = makeDeps(launcher);
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      launcher._fireCrash({
        code: 137,
        signal: "SIGKILL",
        stderr: ["panic: AE crashed", "  at sidecar.exit"],
        reason: "exit",
      });
    });
    await waitFor(() => expect(result.current.status).toBe("crashed"));
    expect(result.current.error).toMatch(/panic: AE crashed/);
  });

  // ── 9 (bonus per spec) ───────────────────────────────────────────
  it("launcher.start rejects → status 'error' + message preserved", async () => {
    const launcher = makeMockLauncher({ startReject: new Error("spawn ENOENT") });
    const { deps } = makeDeps(launcher);
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("spawn ENOENT");
  });

  // ── 10 (Phase 3.7) — onUnhandledMessage forwarding ───────────────
  it("onUnhandledMessage receives msgs not handled by hook router (e.g. exec)", async () => {
    const launcher = makeMockLauncher();
    const { deps } = makeDeps(launcher);
    const onUnhandledMessage = vi.fn();
    const { result } = renderHook(() =>
      useWrapped({ aePid: 11111, onUnhandledMessage }, deps),
    );
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // exec is NOT handled by useTerminal — should forward
    act(() => {
      lastWs!._message({ type: "exec", requestId: "rid-1", tool: "ae_get_active_comp", input: {} });
    });
    expect(onUnhandledMessage).toHaveBeenCalledTimes(1);
    expect(onUnhandledMessage.mock.calls[0][0]).toMatchObject({
      type: "exec", requestId: "rid-1", tool: "ae_get_active_comp",
    });

    // pty.out IS handled — should NOT forward
    act(() => { lastWs!._message({ type: "pty.out", data: "hi\r\n" }); });
    expect(onUnhandledMessage).toHaveBeenCalledTimes(1);

    // cancel is NOT handled — should forward
    act(() => { lastWs!._message({ type: "cancel", requestId: "rid-1" }); });
    expect(onUnhandledMessage).toHaveBeenCalledTimes(2);
    expect(onUnhandledMessage.mock.calls[1][0]).toMatchObject({ type: "cancel", requestId: "rid-1" });
  });

  // ── 11 (Phase 3.7) — sendMessage round-trip ───────────────────────
  it("sendMessage(msg) → ws.send called with JSON-stringified msg when ready, false when not ready", async () => {
    const launcher = makeMockLauncher();
    const { deps } = makeDeps(launcher);
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const sendCountBefore = lastWs!.send.mock.calls.length;
    let returned = false;
    act(() => {
      returned = result.current.sendMessage({
        type: "result",
        requestId: "rid-1",
        data: { name: "Hero" },
      });
    });
    expect(returned).toBe(true);
    expect(lastWs!.send.mock.calls.length).toBe(sendCountBefore + 1);
    const lastSend = JSON.parse(lastWs!.send.mock.calls[lastWs!.send.mock.calls.length - 1][0] as string);
    expect(lastSend).toMatchObject({ type: "result", requestId: "rid-1", data: { name: "Hero" } });

    // Close ws → sendMessage returns false
    act(() => { lastWs!._close(); });
    let returnedAfterClose = true;
    act(() => {
      returnedAfterClose = result.current.sendMessage({ type: "result", requestId: "rid-2", data: {} });
    });
    expect(returnedAfterClose).toBe(false);
  });

  // ── 12 (Phase 3.7) — onUnhandledMessage absent → default noop, no throw ──
  it("onUnhandledMessage absent → unhandled msgs silently dropped", async () => {
    const launcher = makeMockLauncher();
    const { deps } = makeDeps(launcher);
    const { result } = renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(() => {
      act(() => { lastWs!._message({ type: "exec", requestId: "rid-x", tool: "any", input: {} }); });
    }).not.toThrow();
    expect(result.current.status).toBe("ready"); // unchanged
  });

  // ── 13 (Phase 3.7 follow-up 5) — sys.heartbeat echo ─────────────────
  // Why: sidecar's watchdog (panelBridge.ts:562) closes idle clients whose
  // lastRecvAt has not advanced past heartbeatTimeoutMs. The hook must echo
  // sys.heartbeat back so our send refreshes the watchdog clock — without
  // this, the panel is closed at ~30s + 5s grace and the sidecar shuts down
  // on "panel-disconnect" even though the panel is fully alive (mistakes #12).
  it("sys.heartbeat received → echoed back via ws.send + not forwarded to onUnhandledMessage", async () => {
    const launcher = makeMockLauncher();
    const { deps } = makeDeps(launcher);
    const onUnhandledMessage = vi.fn();
    const { result } = renderHook(() =>
      useWrapped({ aePid: 11111, onUnhandledMessage }, deps),
    );
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const sendCountBefore = lastWs!.send.mock.calls.length;
    act(() => { lastWs!._message({ type: "sys.heartbeat", ts: Date.now() }); });

    expect(lastWs!.send.mock.calls.length).toBe(sendCountBefore + 1);
    const echoed = JSON.parse(
      lastWs!.send.mock.calls[lastWs!.send.mock.calls.length - 1][0] as string,
    );
    expect(echoed.type).toBe("sys.heartbeat");
    expect(typeof echoed.ts).toBe("number");
    // Heartbeat is HANDLED — must not leak to the unhandled forwarder.
    expect(onUnhandledMessage).not.toHaveBeenCalled();
  });

  // ── 14 (Phase 5.1.9) — Ctrl+C with selection → OS clipboard copy ─────
  it("Ctrl+C with selection → writeText(selection) + clearSelection + suppress xterm default", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastTerminal).toBeDefined());

    // Hook attached the handler during mount.
    expect(lastTerminal!.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
    const handler = lastTerminal!._keyHandler!;
    expect(handler).toBeDefined();

    lastTerminal!._selection = "selected text";
    const e = { type: "keydown", ctrlKey: true, metaKey: false, altKey: false, key: "c" } as unknown as KeyboardEvent;
    const result = handler(e);

    expect(result).toBe(false);                                     // suppress SIGINT
    expect(clipboardMock.writeText).toHaveBeenCalledWith("selected text");
    expect(lastTerminal!.clearSelection).toHaveBeenCalledTimes(1);
  });

  // ── 15 (Phase 5.1.9) — Ctrl+C without selection → SIGINT pass-through ──
  it("Ctrl+C without selection → handler returns true (xterm default SIGINT preserved)", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastTerminal).toBeDefined());
    const handler = lastTerminal!._keyHandler!;

    lastTerminal!._selection = "";
    const e = { type: "keydown", ctrlKey: true, metaKey: false, altKey: false, key: "c" } as unknown as KeyboardEvent;
    const result = handler(e);

    expect(result).toBe(true);                                       // SIGINT path
    expect(clipboardMock.writeText).not.toHaveBeenCalled();
    expect(lastTerminal!.clearSelection).not.toHaveBeenCalled();
  });

  // ── 16 (Phase 5.1.9) — Ctrl+V → readText + paste → ws.send pty.in ────
  it("Ctrl+V → readText() → terminal.paste(text) → ws.send pty.in", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastWs).toBeDefined());
    act(() => { lastWs!._open(); });
    await waitFor(() => expect(lastTerminal).toBeDefined());
    const handler = lastTerminal!._keyHandler!;

    clipboardMock.readText.mockResolvedValue("clipped");
    const sendCallsBefore = lastWs!.send.mock.calls.length;

    const e = { type: "keydown", ctrlKey: true, metaKey: false, altKey: false, key: "v" } as unknown as KeyboardEvent;
    const result = handler(e);

    expect(result).toBe(false);                                       // suppress xterm default
    expect(clipboardMock.readText).toHaveBeenCalledTimes(1);
    // readText is async — flush microtasks for the .then(paste) chain.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(lastTerminal!.paste).toHaveBeenCalledWith("clipped");
    // paste fires onData → ws.send pty.in (one additional send beyond the
    // initial pty.resize sent on ws open).
    const newSends = lastWs!.send.mock.calls.slice(sendCallsBefore).map((c) => JSON.parse(c[0] as string));
    expect(newSends).toContainEqual({ type: "pty.in", data: "clipped" });
  });

  // ── 17 (Phase 5.1.9) — non-Ctrl key → handler returns true (untouched) ──
  it("non-Ctrl key (or Ctrl+other) → handler returns true; clipboard untouched", async () => {
    const { deps } = makeDeps();
    renderHook(() => useWrapped({ aePid: 11111 }, deps));
    await waitFor(() => expect(lastTerminal).toBeDefined());
    const handler = lastTerminal!._keyHandler!;

    // Plain 'a' keypress
    const a = { type: "keydown", ctrlKey: false, metaKey: false, altKey: false, key: "a" } as unknown as KeyboardEvent;
    expect(handler(a)).toBe(true);

    // Ctrl+A (select-all xterm default)
    const ctrlA = { type: "keydown", ctrlKey: true, metaKey: false, altKey: false, key: "a" } as unknown as KeyboardEvent;
    expect(handler(ctrlA)).toBe(true);

    // keyup for Ctrl+C with selection — must not fire copy on keyup.
    lastTerminal!._selection = "x";
    const keyup = { type: "keyup", ctrlKey: true, metaKey: false, altKey: false, key: "c" } as unknown as KeyboardEvent;
    expect(handler(keyup)).toBe(true);

    expect(clipboardMock.writeText).not.toHaveBeenCalled();
    expect(clipboardMock.readText).not.toHaveBeenCalled();
  });
});
