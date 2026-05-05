// TerminalView — minimal presentation wrapper for the xterm-mounted div.
// Owns layout + status indicator + error overlay. The hook (useTerminal)
// owns everything else. App.tsx (Phase 2 #8) will compose them.

import type { RefObject } from "react";
import type { TerminalStatus } from "./useTerminal.js";

export interface TerminalViewProps {
  containerRef: RefObject<HTMLDivElement | null>;
  status: TerminalStatus;
  error: string | undefined;
  onRestart: () => void;
}

const STATUS_COLOR: Record<TerminalStatus, string> = {
  idle: "#6b6b6b",
  starting: "#f4b942",
  ready: "#4a9eff",
  closing: "#f4b942",
  stopped: "#6b6b6b",
  crashed: "#e85a5a",
  error: "#e85a5a",
};

const STATUS_LABEL: Record<TerminalStatus, string> = {
  idle: "Idle",
  starting: "Starting…",
  ready: "Ready",
  closing: "Closing…",
  stopped: "Stopped",
  crashed: "Crashed",
  error: "Error",
};

export function TerminalView({ containerRef, status, error, onRestart }: TerminalViewProps) {
  const showErrorOverlay = (status === "crashed" || status === "error") && !!error;
  return (
    <div
      className="terminal-wrapper"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        position: "relative",
        background: "#2d2d2d",
      }}
    >
      <div
        className="terminal-status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 11,
          color: "#e8e8e8",
          background: "#1f1f1f",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          className="status-dot"
          aria-label={`Sidecar status: ${STATUS_LABEL[status]}`}
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: STATUS_COLOR[status],
          }}
        />
        <span className="status-label">{STATUS_LABEL[status]}</span>
      </div>
      <div
        ref={containerRef}
        className="terminal-container"
        style={{ flex: 1, minHeight: 200 }}
      />
      {showErrorOverlay && (
        <div
          className="terminal-error"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(45,45,45,0.92)",
            color: "#e8e8e8",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "stretch",
            gap: 12,
            zIndex: 10,
          }}
        >
          <pre
            style={{
              fontFamily: '"JetBrains Mono", Consolas, Menlo, monospace',
              fontSize: 12,
              whiteSpace: "pre-wrap",
              maxHeight: "60%",
              overflow: "auto",
              margin: 0,
              padding: 8,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 4,
              border: "1px solid rgba(232,90,90,0.4)",
            }}
          >
            {error}
          </pre>
          <button
            onClick={onRestart}
            style={{
              padding: "6px 12px",
              background: "#4a9eff",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
              alignSelf: "flex-end",
            }}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
}
