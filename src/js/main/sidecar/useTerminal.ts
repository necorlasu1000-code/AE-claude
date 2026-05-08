// useTerminal — React hook bridging launcher → sidecar WebSocket → xterm.
//
// Status state machine:
//   idle      ─ initial                                           ─ before mount
//   starting  ─ launcher.start() in flight                        ─ after mount
//   ready     ─ launcher resolved + ws OPEN                       ─ user can type
//   closing   ─ sys.shutting-down received OR cleanup initiated   ─ winding down
//   stopped   ─ ws closed after closing (graceful)                ─ done OK
//   crashed   ─ launcher.onCrash fired OR ws closed unexpectedly  ─ unexpected exit
//   error     ─ launcher.start() rejected (spawn / timeout / etc) ─ never reached ready
//
// Transitions: idle → starting → {ready, error}; ready → {closing, crashed};
//              closing → stopped; (any) → crashed via onCrash.
//
// Korean / wide CJK characters: xterm core handles wide-width (CJK width 2)
// automatically — no extra config needed. Verified end-to-end in Phase 2.5.2
// (sidecar PTY round-trip works on CP949 console).

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { sendShutdownOverWs, type SidecarLauncher, type CrashInfo, type LauncherOptions } from "./launcher.js";

export type TerminalStatus =
  | "idle"
  | "starting"
  | "ready"
  | "closing"
  | "stopped"
  | "crashed"
  | "error";

// ─── Public option / dep types ─────────────────────────────────────

export interface UseTerminalOptions {
  /** Forwarded to launcher. Omit for sidecar dev mode (no lockfile/watchdog). */
  aePid?: number;
  sidecarCmd?: string;
  sidecarArgs?: string[];
  spawnTimeoutMs?: number;
  debug?: boolean;
  /** Phase 3.7 — receives WS messages this hook does not handle directly
   *  (anything outside pty.out / pty.replay / sys.version / sys.heartbeat /
   *  sys.shutting-down / server.error). Wired by main.tsx to route exec/cancel
   *  into the ExtendScript bridge layer. Default = noop. */
  onUnhandledMessage?: (msg: unknown) => void;
}

/** All external bindings injected. Production caller wires real xterm
 *  classes / WebSocket / SidecarLauncher; tests inject mocks. */
export interface UseTerminalDeps {
  /** xterm Terminal constructor. Production = `@xterm/xterm` Terminal. */
  TerminalCtor: new (opts?: any) => XtermLike;
  /** FitAddon constructor. */
  FitAddonCtor: new () => FitAddonLike;
  /** WebLinksAddon constructor (URL clickability). */
  WebLinksAddonCtor: new () => unknown;
  /** WebglAddon constructor. May fail to construct in some envs — caller's
   *  factory should NOT throw; this hook catches construction failures and
   *  falls back to canvas. */
  WebglAddonCtor: new () => unknown;
  /** WebSocket constructor (panel runtime: globalThis.WebSocket). */
  WebSocketCtor: new (url: string) => WebSocket;
  /** Factory creating a SidecarLauncher. Tests inject mocks via this. */
  launcherFactory: (opts: LauncherOptions) => SidecarLauncher;
  /** ResizeObserver constructor. jsdom doesn't provide one; tests must
   *  inject a mock that records callback for manual triggering. */
  ResizeObserverCtor: new (cb: ResizeObserverCallback) => ResizeObserverLike;
}

export interface UseTerminalResult {
  status: TerminalStatus;
  error: string | undefined;
  /** Tear down + restart full lifecycle. Used by error overlay's Restart button. */
  restart: () => void;
  /** Phase 3.7 — send arbitrary message over the sidecar WS. No-op when
   *  ws not open. Used by main.tsx to send result/error/cancel responses
   *  back to the sidecar dispatcher. Returns true if the send was attempted
   *  (ws OPEN), false otherwise — caller can fall back to local error
   *  handling on false. */
  sendMessage: (msg: unknown) => boolean;
}

// ─── Minimal interfaces (avoid pulling xterm types into hook signature) ──

interface XtermLike {
  open(container: HTMLElement): void;
  write(data: string | Uint8Array): void;
  onData(cb: (data: string) => void): { dispose: () => void };
  onResize(cb: (dims: { cols: number; rows: number }) => void): { dispose: () => void };
  loadAddon(addon: unknown): void;
  dispose(): void;
  readonly cols: number;
  readonly rows: number;
  // Phase 5.1.9 — Ctrl+C / Ctrl+V OS clipboard sync.
  // attachCustomKeyEventHandler runs before xterm's default keypress
  // processing; returning false suppresses xterm default. paste() routes
  // text into the same onData → ws.send pty.in path as typed input, so
  // the sidecar PTY sees pasted content identically to keyboard input.
  attachCustomKeyEventHandler(cb: (e: KeyboardEvent) => boolean): void;
  getSelection(): string;
  clearSelection(): void;
  paste(text: string): void;
}

interface FitAddonLike {
  fit(): void;
}

interface ResizeObserverLike {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseTerminalOptions,
  deps: UseTerminalDeps,
): UseTerminalResult {
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [restartCount, setRestartCount] = useState(0);

  // Refs — survive re-renders without triggering them.
  const terminalRef = useRef<XtermLike | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const launcherRef = useRef<SidecarLauncher | null>(null);
  const observerRef = useRef<ResizeObserverLike | null>(null);

  // Effect deps: only `restartCount` re-runs the lifecycle. `options` and
  // `deps` are assumed stable (caller's responsibility — useMemo in App).
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) {
      setStatus("error");
      setError("Container ref not attached at mount time");
      return;
    }

    setStatus("starting");
    setError(undefined);

    // Debug logger — only fires when options.debug is true. Removed in
    // production via dead-code elimination (the `if (debug)` short-circuits).
    const debug = options.debug === true;
    const log = (...args: unknown[]) => { if (debug) console.log("[useTerminal]", ...args); };
    log("mount → starting");

    // ── 1. xterm Terminal + addons ────────────────────────────────
    // Theme follows CLAUDE.md design tokens (panel UI dark).
    const terminal: XtermLike = new deps.TerminalCtor({
      fontFamily: '"JetBrains Mono", Consolas, Menlo, monospace',
      fontSize: 14,
      theme: {
        background: "#2d2d2d",
        foreground: "#e8e8e8",
        cursor: "#e8e8e8",
      },
      cursorBlink: true,
      scrollback: 1000,
      allowProposedApi: true,
    });
    terminalRef.current = terminal;

    const fitAddon = new deps.FitAddonCtor();
    const webLinksAddon = new deps.WebLinksAddonCtor();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // WebGL addon may fail in sandboxed/jsdom envs — fall back silently.
    try {
      const webglAddon = new deps.WebglAddonCtor();
      terminal.loadAddon(webglAddon);
    } catch { /* canvas renderer fallback */ }

    terminal.open(container);

    // Phase 5.1.9 — Ctrl+C / Ctrl+V keybindings synced with OS clipboard.
    //   Ctrl+C with selection → writeText(selection) + clear both selection
    //                           models, suppress xterm default (no SIGINT 0x03).
    //   Ctrl+C without selection → fall through to xterm default (SIGINT
    //                           preserved — claude CLI interrupt works).
    //   Ctrl+V → readText() → terminal.paste(text); paste fires onData →
    //            ws.send pty.in, identical path to typed input.
    //
    // Phase 5.1.9 fix-1 (mistakes #20) — dual selection model check.
    // xterm 6.x uses canvas/webgl renderer (no DOM nodes per cell); its
    // selectionService captures mouse drags inside the canvas via internal
    // state, exposed by terminal.getSelection(). BUT in CEP/CEF the user's
    // drag may land on the wrapper DOM node and engage native browser
    // selection instead, leaving terminal.getSelection() empty. Without a
    // fallback, Ctrl+C falls through to SIGINT (clears claude's input
    // line) even though the user "sees" highlighted text. Check both
    // sources; clear whichever fired.
    //
    // CEP runs CEF (Chromium-based); navigator.clipboard.writeText/readText
    // work in user-gesture context (keypress qualifies). No additional CSP
    // entries required for CEP 11+ (After Effects 22.0+ host).
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
      if (!ctrl) return true;
      const key = e.key.toLowerCase();
      if (key === "c") {
        const xtermSel = terminal.getSelection();
        let nativeSel = "";
        if (typeof window !== "undefined" && typeof window.getSelection === "function") {
          const s = window.getSelection();
          nativeSel = s ? s.toString() : "";
        }
        const sel = xtermSel || nativeSel;
        if (sel.length > 0) {
          // fire-and-forget; failure leaves user with the visual selection
          // missed clipboard write — better than blocking the UI thread
          // or throwing inside an event listener.
          void navigator.clipboard.writeText(sel).catch(() => { /* */ });
          if (xtermSel) terminal.clearSelection();
          if (nativeSel && typeof window !== "undefined" && typeof window.getSelection === "function") {
            const s = window.getSelection();
            if (s) s.removeAllRanges();
          }
          return false;
        }
        return true; // no selection → SIGINT pass-through
      }
      if (key === "v") {
        void navigator.clipboard.readText()
          .then((text) => { if (text) terminal.paste(text); })
          .catch(() => { /* clipboard read denied or empty — silent */ });
        return false;
      }
      return true;
    });

    // Initial fit. Container may be 0×0 on first paint — fitAddon throws,
    // caught here. ResizeObserver handles subsequent (real) sizes.
    try { fitAddon.fit(); } catch { /* */ }

    // ── 2. ResizeObserver (skip 0-cell frames to avoid spurious sends) ──
    const observer = new deps.ResizeObserverCtor(() => {
      try {
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        if (cols >= 1 && rows >= 1 && wsRef.current?.readyState === 1) {
          wsRef.current.send(JSON.stringify({ type: "pty.resize", cols, rows }));
        }
      } catch { /* fit may fail during transitions */ }
    });
    observer.observe(container);
    observerRef.current = observer;

    // ── 3. Launcher + WebSocket lifecycle (async) ────────────────
    const launcher = deps.launcherFactory({
      aePid: options.aePid,
      cmd: options.sidecarCmd,
      args: options.sidecarArgs,
      spawnTimeoutMs: options.spawnTimeoutMs,
      debug: options.debug,
    });
    launcherRef.current = launcher;

    launcher.onCrash((info: CrashInfo) => {
      if (cancelled) return;
      setStatus("crashed");
      const tail = info.stderr.slice(-3).join("\n");
      setError(`Sidecar crashed (code=${info.code}, signal=${info.signal})${tail ? "\n" + tail : ""}`);
    });

    void (async () => {
      try {
        log("launcher.start() called");
        const ready = await launcher.start();
        if (cancelled) return;
        log("launcher ready:", ready);

        const ws = new deps.WebSocketCtor(`ws://${ready.host}:${ready.port}`);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          if (cancelled) return;
          log("ws open");
          setStatus("ready");
          // Initial resize sync — server doesn't know our dims yet.
          try {
            const cols = terminal.cols;
            const rows = terminal.rows;
            if (cols >= 1 && rows >= 1) {
              ws.send(JSON.stringify({ type: "pty.resize", cols, rows }));
            }
          } catch { /* */ }
        });

        ws.addEventListener("message", (ev: MessageEvent) => {
          if (cancelled) return;
          let msg: { type?: string; [k: string]: unknown };
          try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); }
          catch { return; }
          // ── WS message routing ─────────────────────────────────────
          // HANDLED (Phase 2 #7, +sys.heartbeat in Phase 3.7 follow-up 5):
          //   pty.out / pty.replay   → terminal.write
          //   sys.version             → noop (status already set on `open`)
          //   sys.heartbeat           → echo back (sidecar watchdog needs
          //                             our send to refresh lastRecvAt)
          //   sys.shutting-down       → status = closing
          //   server.error            → surface to user
          // FORWARDED (Phase 3.7) to onUnhandledMessage:
          //   exec / cancel           → ExtendScript bridge layer (main.tsx)
          //   result / result.chunk   — (panel does not receive these)
          //   error                   — exec-paired error (panel does not receive)
          //   progress                — exec progress streaming
          //   approval.request        — D3 escape hatch dialog (Phase 4)
          let handled = true;
          switch (msg?.type) {
            case "pty.out":
              if (typeof msg.data === "string") terminal.write(msg.data);
              break;
            case "pty.replay":
              if (Array.isArray(msg.lines)) {
                terminal.write((msg.lines as string[]).join("\r\n") + "\r\n");
              }
              break;
            case "sys.version":
              break;
            case "sys.heartbeat":
              // Echo: sidecar's watchdog (panelBridge.ts:562) closes idle
              // clients whose lastRecvAt is stale; our liveness signal is
              // whatever we send back. See protocol.ts HeartbeatMsg jsdoc.
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "sys.heartbeat", ts: Date.now() }));
              }
              break;
            case "sys.shutting-down":
              setStatus("closing");
              break;
            case "server.error":
              setError(`${msg.code}: ${msg.userMessage}`);
              break;
            default:
              handled = false;
          }
          if (!handled && options.onUnhandledMessage) {
            try { options.onUnhandledMessage(msg); }
            catch { /* never throw from message handler */ }
          }
        });

        ws.addEventListener("close", () => {
          if (cancelled) return;
          log("ws close");
          // Closing → stopped is the graceful path; otherwise unexpected.
          setStatus((prev) => (prev === "closing" ? "stopped" : "crashed"));
        });

        ws.addEventListener("error", (ev) => {
          log("ws error", ev);
          // close event will follow with the cleanup
        });

        // ── Terminal → WS ────────────────────────────────────────
        terminal.onData((data: string) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "pty.in", data }));
          }
        });
        terminal.onResize((dims) => {
          if (dims.cols >= 1 && dims.rows >= 1 && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "pty.resize", cols: dims.cols, rows: dims.rows }));
          }
        });
      } catch (e) {
        if (cancelled) return;
        log("startup failed:", e);
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    // ── 4. Cleanup (unmount or restart) ──────────────────────────
    return () => {
      log("cleanup begin");
      cancelled = true;
      observerRef.current?.disconnect();
      observerRef.current = null;

      const ws = wsRef.current;
      const launcher = launcherRef.current;
      const term = terminalRef.current;
      wsRef.current = null;
      launcherRef.current = null;
      terminalRef.current = null;

      // Fire-and-forget graceful shutdown. useEffect cleanup is sync; we
      // detach from React but let the kill chain settle in background.
      void (async () => {
        if (ws && ws.readyState === 1) {
          try { await sendShutdownOverWs(ws, "panel-cleanup"); } catch { /* */ }
        } else if (ws) {
          try { ws.close(); } catch { /* */ }
        }
        if (launcher) {
          try { await launcher.stop(8_000); } catch { /* */ }
        }
        if (term) {
          try { term.dispose(); } catch { /* */ }
        }
      })();
    };
    // restartCount only — options/deps assumed stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartCount]);

  return {
    status,
    error,
    restart: () => {
      setRestartCount((n) => n + 1);
    },
    sendMessage: (msg: unknown) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(msg)); return true; }
      catch { return false; }
    },
  };
}
