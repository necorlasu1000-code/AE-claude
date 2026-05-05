// Production wiring for useTerminal — assembles real xterm classes,
// real WebSocket, real ResizeObserver, and a real SidecarLauncher with
// bolt-cep node.ts deps. Tests bypass this file entirely (they construct
// UseTerminalDeps manually from mocks).
//
// Module dependency notes (panel runtime):
//   - @xterm/xterm Terminal       — works in jsdom + browser, NOT pure node
//   - @xterm/addon-fit             — DOM-dependent (measures container)
//   - @xterm/addon-web-links       — DOM-dependent (decorates output)
//   - @xterm/addon-webgl           — requires WebGL context; falls back to canvas
//   - WebSocket / ResizeObserver  — globals in panel runtime
//   - bolt-cep node.ts (cep_node)  — requires panel runtime; throws at import
//                                    time outside CEP. Tests must NOT import
//                                    factories.ts.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { child_process, fs, path, os } from "../../lib/cep/node";
import { SidecarLauncher, type LauncherDeps } from "./launcher.js";
import type { UseTerminalDeps } from "./useTerminal.js";

// ─── Build-time injection ──────────────────────────────────────────
// vite.config.ts `define` replaces this token at build time with the
// absolute path to the sidecar/ folder in the repo. If you see
// `undefined` at runtime, the define plugin didn't run — see
// mistakes.md "vite define 미주입 가능성".
declare const __DEV_SIDECAR_ROOT__: string;

/** SIDECAR_ROOT precedence: ENV (production ZXP) > vite define (dev). */
function resolveSidecarRoot(): string {
  // Panel runtime exposes process via cep_node bridge.
  const env = (typeof window !== "undefined" && (window as any).cep_node?.process?.env) || {};
  return env.AE_CLAUDE_SIDECAR_ROOT || __DEV_SIDECAR_ROOT__;
}

const SIDECAR_ROOT = resolveSidecarRoot();

/**
 * Default sidecar spawn command. Dev path uses `node` + tsx CLI.
 * Production (ZXP) override via env or pass explicit cmd/args to
 * useTerminal options.
 *
 * Pattern matches Phase 2.5 spawn-helper:
 *   - shell:true is set in launcher itself for Windows PATH lookup
 *   - process.execPath is panel-runtime Node, NOT system Node — so we
 *     use `"node"` and let shell resolve to the user's PATH-installed Node
 *   - Phase 2.6 spike confirmed `child_process.spawn("node", [...], {shell:true})`
 *     works in panel runtime
 */
export const SIDECAR_CMD = "node";
export const SIDECAR_ARGS: string[] = [
  path.join(SIDECAR_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(SIDECAR_ROOT, "src", "index.ts"),
];

// ─── Launcher factory ──────────────────────────────────────────────

const launcherDeps: LauncherDeps = {
  spawn: child_process.spawn as any,
  readReadyFile: (p: string) => fs.promises.readFile(p, "utf8"),
  homedir: os.homedir,
  pathJoin: path.join,
  env: (typeof window !== "undefined" && (window as any).cep_node?.process?.env) || {},
};

/** Construct UseTerminalDeps for panel runtime. App.tsx wraps in useMemo. */
export function createPanelDeps(): UseTerminalDeps {
  return {
    TerminalCtor: Terminal as any,
    FitAddonCtor: FitAddon as any,
    WebLinksAddonCtor: WebLinksAddon as any,
    WebglAddonCtor: WebglAddon as any,
    WebSocketCtor: WebSocket,
    launcherFactory: (opts) => new SidecarLauncher(opts, launcherDeps),
    ResizeObserverCtor: globalThis.ResizeObserver,
  };
}
