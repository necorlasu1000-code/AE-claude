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

import { PanelBridge, type ExecCtx, type ExecHandler } from "./ws/panelBridge.js";
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

  const isWin = process.platform === "win32";
  const defaultShell = isWin ? "cmd.exe" : "bash";
  const defaultShellArgs = isWin ? [] : ["--norc", "--noprofile"];

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

async function main(): Promise<void> {
  const cfg = parseConfig();
  logDebug(cfg, "config:", cfg);

  const pty = new PtyHost({
    cmd: cfg.shell,
    args: cfg.shellArgs,
    cols: 80,
    rows: 24,
    killHardCapMs: cfg.killHardCapMs,
  });

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
