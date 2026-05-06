// Sidecar entry point — assembles PtyHost + PanelBridge + lifecycle (lockfile + watchdog).
//
// LAUNCHER CONTRACT (CLAUDE.md A1, P1#3):
//   First line on stdout is a JSON object the panel launcher parses to find
//   the WebSocket port:
//     {"type":"ready","port":<n>,"host":"127.0.0.1","pid":<n>,"version":"0.1.0","ts":<n>}
//   No other text precedes it. All subsequent logs go to stderr (debug only).
//
// SHUTDOWN ORDER (graceful, max 10s):
//   1. clearInterval on watchdog (stop polling)
//   2. await bridge.stop()    — abort in-flight exec, close clients, close WSS
//   3. pty.kill()             — fire-and-forget (ConPTY hang risk, mistakes.md)
//   4. releaseLock(aePid)     — best-effort delete
//   5. process.exit(0)
//   If steps 2-4 don't complete in 10s, setTimeout forces process.exit(1).
//
// DEV MODE:
//   When AE_CLAUDE_AE_PID is unset → no lockfile, no watchdog. The sidecar
//   runs as an unsupervised process for unit/integration testing.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PanelBridge, type ExecCtx, type ExecHandler, type PtyLike } from "./ws/panelBridge.js";
import { createToolDispatcher, type ToolDispatcher } from "./dispatcher/toolDispatcher.js";
import { PtyHost } from "./pty/ptyHost.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import {
  acquireLock,
  releaseLock,
  writeReadyFile,
  deleteReadyFile,
  type LockContent,
} from "./lifecycle/lockfile.js";
import { PidWatchdog } from "./lifecycle/watchdog.js";
import { registerMcpWithClaude } from "./mcp/registerWithClaude.js";
import { resolveShellPath } from "./shellResolve.js";
import { AEError } from "./tools/_errors.js";

const SIDECAR_VERSION = "0.1.0";
const SHUTDOWN_TIMEOUT_MS = 10_000;

interface Config {
  port: number;
  host: string;
  shell: string;
  shellArgs: string[];
  aePid: number | undefined;
  debug: boolean;
  disableWatchdog: boolean;
  watchdogIntervalMs: number;
  // Reserved for Phase 2.5.4 — currently passed to PtyHost.killHardCapMs
  // for storage only. Not consumed in PtyHost.kill yet.
  killHardCapMs: number | undefined;
}

function parseConfig(): Config {
  const env = process.env;
  const argv = process.argv.slice(2);
  const argMap = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        argMap.set(a.slice(2), next);
        i++;
      } else {
        argMap.set(a.slice(2), "true");
      }
    }
  }

  // Phase 4.3 D-K — production default shell is `claude` (the chat CLI
  // whose stdio drives the panel xterm). Integration tests in
  // sidecar/src/__integration__/ override this via spawn-helper's
  // env.AE_CLAUDE_SHELL=cmd.exe (Windows) / bash (else) so Phase 2's
  // PTY echo / encoding / multi-client / lockfile / watchdog scenarios
  // keep their original semantics. PtyHost itself is unchanged — same
  // node-pty spawn + ConPTY tree-kill (mistakes #4, Phase 2.5.4).
  const defaultShell = "claude";
  const defaultShellArgs = ["--model", "claude-opus-4-7"];

  const isWin = process.platform === "win32";
  void isWin;  // reserved for future per-OS branches; currently unified.

  const port = Number(argMap.get("port") ?? env.AE_CLAUDE_PORT ?? 0);
  const host = argMap.get("host") ?? env.AE_CLAUDE_HOST ?? "127.0.0.1";
  const shellOverride = argMap.get("shell") ?? env.AE_CLAUDE_SHELL;
  const aePidRaw = argMap.get("ae-pid") ?? env.AE_CLAUDE_AE_PID;
  const aePid = aePidRaw && aePidRaw !== "true" ? Number(aePidRaw) : undefined;

  const watchdogRaw = Number(env.AE_CLAUDE_WATCHDOG_INTERVAL_MS);
  const watchdogIntervalMs = Number.isFinite(watchdogRaw) && watchdogRaw > 0 ? watchdogRaw : 60_000;

  const killHardCapRaw = Number(env.AE_CLAUDE_KILL_HARD_CAP_MS);
  const killHardCapMs = Number.isFinite(killHardCapRaw) && killHardCapRaw > 0 ? killHardCapRaw : undefined;

  return {
    port,
    host,
    shell: shellOverride || defaultShell,
    shellArgs: shellOverride ? [] : defaultShellArgs,
    aePid: aePid && Number.isFinite(aePid) && aePid > 0 ? aePid : undefined,
    debug: !!env.AE_CLAUDE_DEBUG,
    disableWatchdog: argMap.get("no-ae-watchdog") === "true" || !!env.AE_CLAUDE_DISABLE_WATCHDOG,
    watchdogIntervalMs,
    killHardCapMs,
  };
}

function logDebug(cfg: Config, ...args: unknown[]): void {
  if (cfg.debug) console.error("[sidecar]", ...args);
}

// Phase 4 stub: real exec dispatch wires to MCP tool registry.
const stubExecHandler: ExecHandler = async (tool: string, _input: unknown, _ctx: ExecCtx) => {
  throw new AEError(
    "AENotImplementedError",
    `Tool '${tool}' is not wired yet (Phase 4 MCP integration pending).`,
    "Phase 2 sidecar exposes PTY + WS only. exec messages will return errors until Phase 4.",
    { phase: 2, tool },
  );
};

// Phase 4.3 — when the configured shell binary isn't on PATH, the sidecar
// still boots so the panel can connect and learn why instead of seeing an
// opaque crash. The dummy PtyLike satisfies PanelBridge's interface with
// noop semantics: panel-side input is silently discarded, no PTY output
// ever reaches the broadcast loop. The bridge surfaces the failure via
// `initialServerError` (one server.error message per new connection).
function makeDummyPty(): PtyLike {
  return {
    write() { /* discard */ },
    resize() { /* noop */ },
    onData() { return () => { /* nothing to unsubscribe */ }; },
    onExit() { return () => { /* dummy never exits */ }; },
    kill() { return Promise.resolve(); },
    getRecentOutput() { return []; },
  };
}

/** Phase 4.4 fix-2 (mistakes #14 Aspect B) — resolve the spawn shape claude
 *  CLI should use when launching ae-mcp's stdio entry. Mirrors the sidecar
 *  main's own dev/prod split (factories.ts SIDECAR_CMD/SIDECAR_ARGS):
 *
 *    dev (tsx)  : import.meta.url ends in `/src/index.ts` →
 *                 cmd "node", args [tsx_cli_abs, src/mcp/server.ts_abs]
 *    prod (dist): import.meta.url ends in `/dist/index.js` →
 *                 cmd "node", args [dist/mcp/server.js_abs]
 *
 *  claude spawns this MCP entry as a plain `node` child — tsx is NOT in its
 *  lookup, so dev mode must hand claude the tsx cli explicitly. Phase 7
 *  ZXP packaging naturally lands in prod mode without code changes. */
function resolveMcpSpawn(): { cmd: string; args: string[] } {
  const sidecarDir = dirname(fileURLToPath(import.meta.url));
  const isSrcMode = /[\\/]src$/.test(sidecarDir);
  if (isSrcMode) {
    const sidecarRoot = dirname(sidecarDir);
    return {
      cmd: "node",
      args: [
        join(sidecarRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(sidecarRoot, "src", "mcp", "server.ts"),
      ],
    };
  }
  return {
    cmd: "node",
    args: [join(sidecarDir, "mcp", "server.js")],
  };
}

/** Detect "shell binary not found" from a spawn error. node-pty surfaces
 *  ENOENT either via the standard `code` property (Linux/macOS path) or
 *  via a message containing "ENOENT" / "not found" (Windows ConPTY path).
 *  Anything else is treated as an unexpected error and re-thrown. */
function isShellNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const message = String((e as { message?: unknown }).message ?? "").toLowerCase();
  return message.includes("enoent") || message.includes("not found");
}

async function main(): Promise<void> {
  const cfg = parseConfig();
  logDebug(cfg, "config:", cfg);

  // PtyHost is eager — node-pty spawn() runs in the constructor. ENOENT
  // (shell missing from PATH) lands here. Phase 4.3 D-K policy: surface
  // a server.error to the panel rather than crashing the sidecar, so the
  // user sees an actionable message ("Install Claude Code CLI") instead
  // of an opaque launcher onCrash. The fallback dummy PtyLike keeps the
  // rest of the boot graph (lockfile, WS, MCP register) working uniformly.
  let pty: PtyLike;
  let initialServerError: { code: string; userMessage: string; developerHint: string } | undefined;
  // Phase 4.4 fix (mistakes #14) — resolve PATH before node-pty spawn.
  // node-pty (unlike child_process.spawn) does NOT do PATH lookup, so a bare
  // command like "claude" fails with ENOENT even when the binary is on PATH
  // and reachable from a regular shell. resolveShellPath returns the input
  // unchanged on lookup failure (fail-safe), preserving the existing dummyPty
  // ENOENT path below as the single source of "shell not found" UX.
  const resolvedShell = resolveShellPath(cfg.shell);
  try {
    pty = new PtyHost({
      cmd: resolvedShell,
      args: cfg.shellArgs,
      cols: 80,
      rows: 24,
      killHardCapMs: cfg.killHardCapMs,
    });
  } catch (e) {
    if (isShellNotFound(e)) {
      pty = makeDummyPty();
      initialServerError = {
        code: "AEShellNotFoundError",
        userMessage: `Shell '${cfg.shell}' not found in PATH.`,
        developerHint: cfg.shell === "claude"
          ? "Install Claude Code CLI: https://docs.claude.com/en/docs/claude-code/quickstart"
          : "Verify the AE_CLAUDE_SHELL value or PATH.",
      };
      logDebug(cfg, "PTY spawn ENOENT — sidecar boots with dummy PTY:", cfg.shell);
    } else {
      throw e;   // unexpected; let the caller / process crash handler surface it
    }
  }

  // Forward declare shutdown so PanelBridge can call it via onShutdownRequest.
  // Actual implementation is set further down (after watchdog setup). The
  // ref-cell pattern keeps the wiring clean without a class restructure.
  const shutdownRef: { fn: (reason: string) => void } = {
    fn: () => { /* replaced before PanelBridge can fire onShutdownRequest */ },
  };

  // Phase 3.7 — ToolDispatcher with lazy back-reference to bridge.
  // dispatcher.send needs bridge; bridge.onToolResponse needs dispatcher.
  // Resolve via closure: declare bridge first (let), capture in dispatcher.send
  // (resolved at call time), then assign bridge with onToolResponse wired to
  // dispatcher.handleIncoming. Mirrors the in-process integration test pattern
  // (sidecar/src/__integration__/integration-dispatcher.test.ts wireDispatcherAndBridge).
  // dispatcher is module-internal — exported when Phase 4 MCP layer needs it.
  let bridge: PanelBridge;
  const dispatcher: ToolDispatcher = createToolDispatcher({
    send: (msg) => bridge.sendToPrimary(msg),
  });

  bridge = new PanelBridge({
    pty,
    execHandler: stubExecHandler,
    port: cfg.port,
    host: cfg.host,
    sidecarVersion: SIDECAR_VERSION,
    onShutdownRequest: (reason) => shutdownRef.fn("panel-shutdown" + (reason ? ":" + reason : "")),
    onToolResponse: dispatcher.handleIncoming,
    initialServerError,
  });
  // Reference dispatcher to keep tsc happy during Phase 3.7 — Phase 4 MCP
  // layer reads/exports it. No runtime cost.
  void dispatcher;

  const { port: actualPort } = await bridge.start();
  logDebug(cfg, "bridge listening on", `${cfg.host}:${actualPort}`);

  // Lockfile (only if we have a parent AE PID — dev mode skips).
  let lockHeld = false;
  if (cfg.aePid !== undefined) {
    const content: LockContent = {
      sidecarPid: process.pid,
      aePid: cfg.aePid,
      port: actualPort,
      startedAt: Date.now(),
    };
    try {
      await acquireLock(content);
      lockHeld = true;
      logDebug(cfg, "lock acquired for AE pid", cfg.aePid);
    } catch (e) {
      // If another live sidecar holds the lock, abort cleanly.
      console.error(JSON.stringify({
        type: "fatal",
        reason: "lock-held",
        message: e instanceof Error ? e.message : String(e),
      }));
      await bridge.stop();
      pty.kill().catch(() => { /* best-effort */ });
      process.exit(2);
    }
  }

  // Emit ready JSON on stdout (launcher contract — option E primary).
  const ready = {
    type: "ready",
    port: actualPort,
    host: cfg.host,
    pid: process.pid,
    version: SIDECAR_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    aePid: cfg.aePid ?? null,
    ts: Date.now(),
  };
  process.stdout.write(JSON.stringify(ready) + "\n");

  // Option B fallback: also write ready JSON to <lockDir>/ready-<aePid>.json
  // for launchers whose stdout capture fails or races. Only when supervised
  // (aePid set); dev mode skips since there's no parent to read it.
  if (cfg.aePid !== undefined) {
    try {
      await writeReadyFile(cfg.aePid, ready);
      logDebug(cfg, "ready file written:", cfg.aePid);
    } catch (e) {
      // Non-fatal — stdout path still works. Just log and move on.
      logDebug(cfg, "ready file write failed (non-fatal):", e);
    }
  }

  // ── Phase 4.2 — claude mcp add (idempotent via remove + add) ──────
  // Register the ae-mcp stdio server entry so claude CLI auto-spawns it
  // on every claude invocation in this cwd. Failures (claude not found,
  // add error) are non-fatal: the sidecar boots normally and Phase 4.3
  // surfaces a clearer error when claude PTY actually starts.
  //
  // Phase 4.4 fix-2 (mistakes #14 Aspect B): dev/prod entry resolution.
  // This file is `<sidecar>/dist/index.js` after `npm run build`, or
  // `<sidecar>/src/index.ts` under tsx dev (factories.ts SIDECAR_ARGS).
  // claude spawns the MCP entry as a plain `node` child — tsx is NOT in
  // its lookup. Dev mode therefore must point claude at `node <tsx_cli>
  // <src/mcp/server.ts>` so the same tsx instance the sidecar already
  // ships at `node_modules/tsx/dist/cli.mjs` does the .ts → JS step.
  // Prod mode just hands claude `node <dist/mcp/server.js>` directly.
  // Selection key: import.meta.url path ending in `/src` vs anything else.
  try {
    const { cmd, args } = resolveMcpSpawn();
    const result = await registerMcpWithClaude({
      port: actualPort,
      spawnCommand: cmd,
      spawnArgs: args,
      // cwd: process.cwd() matches Phase 2.8.4 fix-1 (panel spawns sidecar
      // with cwd: SIDECAR_ROOT, 함정 #7). The --scope local entry is keyed
      // by this cwd; the user must run `claude` from the same cwd to see
      // ae-mcp. Phase 4.3 claude PTY spawn will use the same cwd.
      cwd: process.cwd(),
      logger: (e) => logDebug(cfg, JSON.stringify(e)),
    });
    if (!result.ok) {
      logDebug(cfg, `mcp register: ${result.reason} — sidecar boot continues`);
    }
  } catch (e) {
    // registerMcpWithClaude is designed not to throw, but defensive net
    // ensures the sidecar always boots even on a contract violation.
    logDebug(cfg, `mcp register: unexpected throw — sidecar boot continues`, e);
  }

  // ── Shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logDebug(cfg, "shutdown:", reason);

    const forceTimer = setTimeout(() => {
      logDebug(cfg, "shutdown timeout — force exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();  // don't keep event loop alive solely for this timer

    (async () => {
      watchdog?.stop();
      await bridge.stop().catch((e) => logDebug(cfg, "bridge.stop err:", e));
      pty.kill().catch(() => { /* best-effort, ConPTY can hang */ });
      if (lockHeld && cfg.aePid !== undefined) {
        await releaseLock(cfg.aePid).catch(() => { /* best-effort */ });
        await deleteReadyFile(cfg.aePid).catch(() => { /* best-effort */ });
      }
      clearTimeout(forceTimer);
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (e) => {
    console.error(JSON.stringify({ type: "uncaught", message: e.message, stack: e.stack }));
    shutdown("uncaughtException");
  });

  // Wire panelBridge.onShutdownRequest → real shutdown function. Until this
  // line, the ref-cell holds a no-op placeholder, so a sys.shutdown received
  // before this point would silently do nothing — but bridge.start() is
  // already complete, the only window is between bridge.start and here.
  shutdownRef.fn = shutdown;

  // ── AE PID watchdog ──────────────────────────────────────────────
  let watchdog: PidWatchdog | undefined;
  if (cfg.aePid !== undefined && !cfg.disableWatchdog) {
    watchdog = new PidWatchdog({
      pid: cfg.aePid,
      intervalMs: cfg.watchdogIntervalMs,
      onDeath: () => shutdown("ae-process-dead"),
    });
    watchdog.start();
    logDebug(cfg, "watchdog started for AE pid", cfg.aePid, "interval", cfg.watchdogIntervalMs);
  }

  // PTY exit also triggers shutdown — claude process died.
  pty.onExit((code, signal) => {
    logDebug(cfg, "pty exited:", { code, signal });
    shutdown(`pty-exit-${code}`);
  });
}

main().catch((e) => {
  console.error(JSON.stringify({
    type: "fatal",
    reason: "startup-failed",
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  }));
  process.exit(3);
});
