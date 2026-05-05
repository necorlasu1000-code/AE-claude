// AE-Claude panel entry. Phase 3.7 — production wiring of useExtendScriptBridge
// + dev spike trigger button + layer-decomposed latency display.
// Cleanup chain on unmount (handled inside useTerminal):
//   sendShutdownOverWs → launcher.stop → terminal.dispose
//
// Phase 3 wiring (this file's new responsibility):
//   sidecar→panel exec       → onUnhandledMessage → bridge.exec(input)
//   panel→sidecar result/err → terminal.sendMessage(msg)
//   bridge.exit telemetry    → lastBridgeMsRef (panel-side AE round-trip)
//   spike result.durationMs  → spike.totalMs (sidecar full round-trip
//                              measured locally because panel calls
//                              bridge.exec directly here, not through
//                              the dispatcher; same number as panel
//                              wall-clock since they share the same
//                              ws boundary)
//   ws hop+queue derived     → totalMs - bridgeMs (clamped ≥ 0)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import "./main.scss";

import { TerminalView } from "./sidecar/TerminalView";
import { useTerminal, type UseTerminalOptions } from "./sidecar/useTerminal";
import { createPanelDeps, SIDECAR_CMD, SIDECAR_ARGS } from "./sidecar/factories";
import {
  useExtendScriptBridge,
  type BridgeLogEvent,
  type ExecResult,
} from "./sidecar/useExtendScriptBridge";

const FALLBACK_BG = "#2d2d2d";  // CLAUDE.md design tokens — fallback when AE host theme unavailable
const IS_DEV = import.meta.env?.DEV ?? false;

// bolt-cep namespace used by jsx — host[ns].tools.<tool>(rawInput).
// Value must match cep.config.ts `id` (= src/shared/shared.ts `ns` =
// `config.id`). Contains DOTS, so useExtendScriptBridge generates
// bracket-notation `$["com.aeclaude.panel"].tools.<tool>(...)` — see
// mistakes.md #11 for the chained-property-access trap. Re-stated
// here rather than imported to avoid pulling cep.config into the
// panel runtime path; if the id changes, both must update.
const NS = "com.aeclaude.panel";

interface SpikeMeasurement {
  ok: boolean;
  totalMs: number;            // panel wall-clock from bridge.exec call → result
  bridgeMs: number | null;    // bridge:exit durationMs (AE round-trip only)
  result: ExecResult | null;
}

export const App = () => {
  const [bgColor, setBgColor] = useState(FALLBACK_BG);

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // ─── ExtendScript bridge (Phase 3.5) ──────────────────────────────
  // Track bridge:exit durationMs for layer-decomposed latency display.
  const lastBridgeMsRef = useRef<Map<string, number>>(new Map());

  // CSInterface lookup deferred to call time so this module imports cleanly
  // outside CEP (vitest, etc). When absent, exec() returns AECrashedError;
  // dev button is gated on IS_DEV anyway.
  const bridge = useMemo(
    () =>
      useExtendScriptBridge({
        csInterface: {
          evalScript: (script, callback) => {
            const w = window as unknown as {
              __adobe_cep__?: { evalScript(s: string, cb: (r: string) => void): void };
            };
            if (w.__adobe_cep__) {
              w.__adobe_cep__.evalScript(script, callback);
            } else {
              callback(JSON.stringify({
                ok: false,
                error: {
                  code: "AECrashedError",
                  userMessage: "CSInterface 미주입 — panel runtime 외부",
                  developerHint: "vitest 또는 dev 외 환경에서 호출됨",
                },
              }));
            }
          },
        },
        ns: NS,
        emit: (e: BridgeLogEvent) => {
          if (e.event === "bridge:exit") {
            lastBridgeMsRef.current.set(e.requestId, e.durationMs);
          }
        },
      }),
    [],
  );

  // ─── useTerminal — receives WS, forwards exec via callback ────────
  // sendMessage closure access via ref (assigned after hook return).
  const terminalRef = useRef<ReturnType<typeof useTerminal> | null>(null);

  const onUnhandledMessage = useCallback((msgRaw: unknown) => {
    const msg = msgRaw as { type?: string; requestId?: string; tool?: string; input?: unknown };
    if (msg?.type !== "exec") return;
    if (!msg.requestId || !msg.tool) return;

    void bridge
      .exec({ requestId: msg.requestId, tool: msg.tool, input: msg.input })
      .then((result: ExecResult) => {
        const t = terminalRef.current;
        if (!t) return;
        if (result.ok) {
          t.sendMessage({ type: "result", requestId: msg.requestId!, data: result.data });
        } else {
          t.sendMessage({
            type: "error",
            requestId: msg.requestId!,
            code: result.code,
            userMessage: result.userMessage,
            developerHint: result.developerHint,
          });
        }
      });
  }, [bridge]);

  const deps = useMemo(() => createPanelDeps(), []);
  const opts = useMemo<UseTerminalOptions>(() => ({
    aePid: undefined,
    sidecarCmd: SIDECAR_CMD,
    sidecarArgs: SIDECAR_ARGS,
    debug: IS_DEV,
    onUnhandledMessage,
  }), [onUnhandledMessage]);

  const terminal = useTerminal(containerRef, opts, deps);
  terminalRef.current = terminal;

  // ─── Dev spike trigger (Phase 3.7 D-E option A) ───────────────────
  const [spike, setSpike] = useState<SpikeMeasurement | null>(null);
  const [spikeBusy, setSpikeBusy] = useState(false);

  const runSpike = useCallback(async () => {
    if (spikeBusy) return;
    setSpikeBusy(true);
    try {
      const requestId = `spike-${Date.now()}`;
      const startTotal = Date.now();
      const result = await bridge.exec({
        requestId,
        tool: "ae_get_active_comp",
        input: {},
      });
      const totalMs = Date.now() - startTotal;
      const bridgeMs = lastBridgeMsRef.current.get(requestId) ?? null;
      lastBridgeMsRef.current.delete(requestId);
      setSpike({ ok: result.ok, totalMs, bridgeMs, result });
    } finally {
      setSpikeBusy(false);
    }
  }, [bridge, spikeBusy]);

  const devSlot = IS_DEV ? (
    <DevSpikeControls
      ready={terminal.status === "ready"}
      busy={spikeBusy}
      onClick={runSpike}
      spike={spike}
    />
  ) : undefined;

  return (
    <div
      className="app"
      style={{
        backgroundColor: bgColor,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TerminalView
        containerRef={containerRef}
        status={terminal.status}
        error={terminal.error}
        onRestart={terminal.restart}
        devSlot={devSlot}
      />
    </div>
  );
};

// ─── Dev controls subcomponent ──────────────────────────────────────
// Out of production zxp via the IS_DEV gate above; vite replaces
// `import.meta.env.DEV` with a literal `false` in production builds,
// so dead-code elimination drops the dev branch + this entire component.

interface DevSpikeControlsProps {
  ready: boolean;
  busy: boolean;
  onClick: () => void;
  spike: SpikeMeasurement | null;
}

function DevSpikeControls({ ready, busy, onClick, spike }: DevSpikeControlsProps) {
  const label = busy ? "Running…" : "Run ae_get_active_comp";

  let latencyText = "";
  if (spike) {
    if (spike.ok && spike.bridgeMs !== null) {
      const wsMs = Math.max(0, spike.totalMs - spike.bridgeMs);
      latencyText = ` Total: ${spike.totalMs}ms (AE: ${spike.bridgeMs}ms, WS hop+queue: ${wsMs}ms)`;
    } else if (spike.ok) {
      latencyText = ` Total: ${spike.totalMs}ms (AE: —, WS hop+queue: —)`;
    } else {
      const errCode = spike.result && !spike.result.ok ? spike.result.code : "?";
      latencyText = ` ${errCode} (${spike.totalMs}ms)`;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={!ready || busy}
        style={{
          padding: "2px 8px",
          fontSize: 11,
          background: ready && !busy ? "#4a9eff" : "#3a3a3a",
          color: "#fff",
          border: "none",
          borderRadius: 3,
          cursor: ready && !busy ? "pointer" : "default",
        }}
      >
        {label}
      </button>
      {latencyText && (
        <span
          style={{
            fontSize: 11,
            color: spike?.ok ? "#9ad77f" : "#e85a5a",
            fontFamily: '"JetBrains Mono", Consolas, monospace',
          }}
        >
          {latencyText}
        </span>
      )}
    </>
  );
}
