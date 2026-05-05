// AE-Claude panel entry. Phase 2.8.3 — real useTerminal wiring.
// Cleanup chain on unmount (handled inside useTerminal):
//   sendShutdownOverWs → launcher.stop → terminal.dispose
// Phase 2 #8 simplification: no separate beforeunload hook; CEP panel
// close triggers React unmount, which runs the cleanup above.

import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import "./main.scss";

import { TerminalView } from "./sidecar/TerminalView";
import { useTerminal, type UseTerminalOptions } from "./sidecar/useTerminal";
import { createPanelDeps, SIDECAR_CMD, SIDECAR_ARGS } from "./sidecar/factories";

const FALLBACK_BG = "#2d2d2d";  // CLAUDE.md design tokens — fallback when AE host theme unavailable

export const App = () => {
  const [bgColor, setBgColor] = useState(FALLBACK_BG);

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // useMemo: deps and opts must be stable across renders so useTerminal's
  // useEffect doesn't re-fire on every state change. (Hook only re-runs on
  // the internal restartCount counter.)
  const deps = useMemo(() => createPanelDeps(), []);
  const opts = useMemo<UseTerminalOptions>(() => ({
    aePid: undefined,                  // dev mode — Phase 4/5 may revisit AE pid acquisition
    sidecarCmd: SIDECAR_CMD,
    sidecarArgs: SIDECAR_ARGS,
    debug: import.meta.env?.DEV ?? false,
  }), []);

  const terminal = useTerminal(containerRef, opts, deps);

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
      />
    </div>
  );
};
