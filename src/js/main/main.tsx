// AE-Claude panel entry. Phase 2.8.0 sample-removed scaffold.
// TerminalView + useTerminal wiring lands in Phase 2.8.3.

import { useEffect, useState } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import "./main.scss";

const FALLBACK_BG = "#2d2d2d";  // CLAUDE.md design tokens — fallback when AE host theme unavailable

export const App = () => {
  const [bgColor, setBgColor] = useState(FALLBACK_BG);

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

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
      {/* TerminalView mounted in Phase 2.8.3 */}
    </div>
  );
};
