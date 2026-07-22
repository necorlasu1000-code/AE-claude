// SidecarLauncher — spawns the sidecar Node process from the CEP panel.
//
// Phase 2.6 design:
//   - Option E primary: bolt-cep node.ts's child_process.spawn (verified
//     in spike 2 — see mistakes.md "Phase 2.6 spike 결과").
//   - Option B fallback: ready JSON file polling at <lockDir>/ready-<aePid>.json
//     (sidecar writes both stdout and file; whichever arrives first wins).
//   - Crash detection via process.exit event when stop() wasn't called.
//   - Graceful shutdown via WS sys.shutdown (Phase 2.5.5.0). The launcher
//     itself doesn't open a long-lived WS — that's the terminal hook's job.
//     stop() opens a one-shot WS just to send sys.shutdown + wait for ack.
//
// Dependency injection: this module does NOT import bolt-cep node.ts directly.
// All Node.js primitives come through `LauncherDeps`. A factory wrapper
// (createLauncher) provides production deps from cep/node; tests inject mocks.
// This isolation lets vitest run launcher logic without panel runtime.

import type { ChildProcess, SpawnOptions } from "node:child_process";

// ─── Public types ───────────────────────────────────────────────────

export interface LauncherOptions {
  /** Parent AE process id (for lockfile + watchdog identity). When omitted,
   *  the sidecar runs in dev mode — no lockfile, no watchdog. Use the omit
   *  path when AE pid can't be obtained (CSInterface exposes no PID API
   *  by default; CTC be retrieved via ExtendScript fallback). */
  aePid?: number;
  /** Spawn command. Default `node` (PATH lookup via shell:true). For production
   *  ZXP, override to absolute path of bundled portable Node. */
  cmd?: string;
  /** Args after cmd. Default points to the sidecar dist entry — production
   *  default; dev callers should override (e.g., tsx + src/index.ts path). */
  args?: string[];
  /** Working directory. Default = sidecar package root (resolveSidecarRoot). */
  cwd?: string;
  /** Lock + ready file directory. Default `<homedir>/.ae-claude-panel`. */
  lockDir?: string;
  /** Spawn-to-ready timeout. Default 15s. */
  spawnTimeoutMs?: number;
  /** Polling interval for the ready-file fallback. Default 250ms. */
  readyFilePollMs?: number;
  /** Forward AE_CLAUDE_DEBUG=1 to sidecar. */
  debug?: boolean;
  /** Watchdog interval override (forwarded as ENV). */
  watchdogIntervalMs?: number;
}

export interface SidecarReady {
  port: number;
  sidecarPid: number;
  host: string;
  version: string;
  protocolVersion: number;
}

export interface CrashInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string[];
  reason: "exit" | "spawn-error";
}

// ─── Dependency injection surface ──────────────────────────────────

export interface LauncherDeps {
  spawn: (cmd: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  /** Returns ready JSON file content if exists; throws/rejects on ENOENT. */
  readReadyFile: (path: string) => Promise<string>;
  homedir: () => string;
  pathJoin: (...parts: string[]) => string;
  /** Optional clock for tests. Default = real setTimeout.
   *  Return type uses `ReturnType<typeof setTimeout>` so the handle
   *  paired with `clearTimeout` keeps its native shape (DOM `number`,
   *  Node `Timeout`) — this matters at the only call site that stores
   *  the handle for later cancel (waitForExit at line ~295). */
  setTimeout?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Provided by the factory; NOT used in tests. ENV passthrough for spawn. */
  env?: NodeJS.ProcessEnv;
}

// ─── Implementation ────────────────────────────────────────────────

export class SidecarLauncher {
  private proc: ChildProcess | undefined;
  private stderr: string[] = [];
  private stoppedNormally = false;
  private crashCbs = new Set<(info: CrashInfo) => void>();
  private readonly opts: {
    aePid: number | undefined;
    cmd: string | undefined;
    args: string[] | undefined;
    cwd: string | undefined;
    lockDir: string;
    spawnTimeoutMs: number;
    readyFilePollMs: number;
    debug: boolean;
    watchdogIntervalMs: number | undefined;
  };

  constructor(opts: LauncherOptions, private readonly deps: LauncherDeps) {
    this.opts = {
      aePid: opts.aePid,
      cmd: opts.cmd,
      args: opts.args,
      cwd: opts.cwd,
      lockDir: opts.lockDir ?? this.defaultLockDir(),
      spawnTimeoutMs: opts.spawnTimeoutMs ?? 15_000,
      readyFilePollMs: opts.readyFilePollMs ?? 250,
      debug: opts.debug ?? false,
      watchdogIntervalMs: opts.watchdogIntervalMs,
    };
  }

  private defaultLockDir(): string {
    return this.deps.pathJoin(this.deps.homedir(), ".ae-claude-panel");
  }

  /** Spawn sidecar and wait for ready signal (stdout JSON OR ready file, whichever arrives first). */
  async start(): Promise<SidecarReady> {
    if (this.proc) throw new Error("SidecarLauncher already started");

    const cmd = this.opts.cmd ?? "node";
    const args = this.opts.args ?? [];

    // Build env. aePid omission → sidecar dev mode (no lockfile, no watchdog).
    const env: NodeJS.ProcessEnv = {
      ...(this.deps.env ?? {}),
      AE_CLAUDE_LOCK_DIR: this.opts.lockDir,
      ...(this.opts.aePid !== undefined
        ? { AE_CLAUDE_AE_PID: String(this.opts.aePid) }
        : {}),
      ...(this.opts.debug ? { AE_CLAUDE_DEBUG: "1" } : {}),
      ...(this.opts.watchdogIntervalMs !== undefined
        ? { AE_CLAUDE_WATCHDOG_INTERVAL_MS: String(this.opts.watchdogIntervalMs) }
        : {}),
    };

    this.proc = this.deps.spawn(cmd, args, {
      cwd: this.opts.cwd,
      env,
      shell: true,           // Windows PATH lookup safety
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // stderr capture for debugging
    this.proc.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line) this.stderr.push(line);
      }
    });

    // crash detection: exit not preceded by stop()
    this.proc.once("exit", (code, signal) => {
      if (!this.stoppedNormally) {
        this.fireCrash({ code, signal, stderr: [...this.stderr], reason: "exit" });
      }
    });

    this.proc.once("error", (e: Error) => {
      this.fireCrash({
        code: null,
        signal: null,
        stderr: [...this.stderr, `spawn error: ${e.message}`],
        reason: "spawn-error",
      });
    });

    // Race: stdout ready, file ready, timeout.
    const stdoutPromise = this.waitForStdoutReady();
    const filePromise = this.waitForReadyFile();
    const timeoutPromise = this.timeoutPromise(this.opts.spawnTimeoutMs);

    try {
      const ready = await Promise.race([stdoutPromise, filePromise, timeoutPromise]);
      return {
        port: ready.port,
        sidecarPid: ready.pid ?? this.proc.pid ?? 0,
        host: ready.host,
        version: ready.version,
        protocolVersion: ready.protocolVersion,
      };
    } catch (e) {
      // start failed — clean up the spawned process (it may have started but
      // never emitted ready). Mark the kill as intentional FIRST: without
      // this, the SIGKILL fires the 'exit' handler → fireCrash("Sidecar
      // crashed") overwrites/races the detailed start error (timeout +
      // captured stderr) the caller is about to receive.
      this.stoppedNormally = true;
      if (this.proc && this.proc.exitCode === null) {
        try { this.proc.kill("SIGKILL"); } catch { /* */ }
      }
      throw e;
    }
  }

  /**
   * Wait for the sidecar process to exit. Caller is expected to have already
   * sent sys.shutdown via the long-lived WS (use `sendShutdownOverWs` helper).
   * If the sidecar doesn't exit within `timeoutMs`, SIGKILL is sent and the
   * promise resolves.
   *
   * Phase 2.7.0 design change: the launcher no longer opens its own WS for
   * sys.shutdown. WS lifecycle is owned by the consumer (useTerminal hook),
   * which sends sys.shutdown on its existing PTY connection — avoiding the
   * AEMultiClientRefused issue that would arise from a second connection.
   */
  async stop(timeoutMs = 8_000): Promise<void> {
    this.stoppedNormally = true;
    if (!this.proc || this.proc.exitCode !== null) return;
    await this.waitForExit(timeoutMs);
  }

  onCrash(cb: (info: CrashInfo) => void): () => void {
    this.crashCbs.add(cb);
    return () => { this.crashCbs.delete(cb); };
  }

  // ─── private ──────────────────────────────────────────────────────

  private lastReadyPort: number | undefined;   // kept for diagnostics; not used by stop()
  private lastReadyHost: string | undefined;

  private fireCrash(info: CrashInfo): void {
    for (const cb of this.crashCbs) {
      try { cb(info); } catch { /* never throw from launcher */ }
    }
  }

  private async waitForStdoutReady(): Promise<RawReady> {
    return new Promise<RawReady>((resolve, reject) => {
      let buf = "";
      const onData = (chunk: Buffer | string) => {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl).trim();
        this.proc?.stdout?.off("data", onData);
        try {
          const parsed = JSON.parse(line);
          if (parsed?.type !== "ready") {
            reject(new Error(`unexpected ready JSON shape: ${line.slice(0, 200)}`));
            return;
          }
          this.lastReadyPort = parsed.port;
          this.lastReadyHost = parsed.host;
          resolve(parsed as RawReady);
        } catch (e) {
          reject(new Error(`malformed ready JSON: ${line.slice(0, 200)}`));
        }
      };
      this.proc?.stdout?.on("data", onData);
    });
  }

  private async waitForReadyFile(): Promise<RawReady> {
    // Dev mode: no aePid → no ready file written by sidecar → never resolve.
    // The Promise.race in start() will be settled by stdout or timeout.
    if (this.opts.aePid === undefined) {
      return new Promise<RawReady>(() => { /* never resolves */ });
    }

    const filePath = this.deps.pathJoin(this.opts.lockDir, `ready-${this.opts.aePid}.json`);
    const interval = this.opts.readyFilePollMs;

    return new Promise<RawReady>((resolve, reject) => {
      const tick = async () => {
        try {
          const raw = await this.deps.readReadyFile(filePath);
          const parsed = JSON.parse(raw);
          if (parsed?.type === "ready") {
            this.lastReadyPort = parsed.port;
            this.lastReadyHost = parsed.host;
            resolve(parsed as RawReady);
            return;
          }
        } catch {
          // ENOENT — keep polling
        }
        (this.deps.setTimeout ?? setTimeout)(() => { void tick(); }, interval);
        // No cancel registration — outer race handles cancellation; this loop
        // will simply settle silently after Promise.race winner resolves.
      };
      void tick();
    });
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      (this.deps.setTimeout ?? setTimeout)(() => {
        reject(new Error(
          `Sidecar spawn timeout (${ms}ms). stderr last 30:\n${this.stderr.slice(-30).join("\n")}`,
        ));
      }, ms);
    });
  }

  private async waitForExit(timeoutMs: number): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    return new Promise<void>((resolve) => {
      const t = (this.deps.setTimeout ?? setTimeout)(() => {
        // proc still alive after timeout — force SIGKILL and resolve
        if (this.proc && this.proc.exitCode === null) {
          try { this.proc.kill("SIGKILL"); } catch { /* */ }
        }
        resolve();
      }, timeoutMs);
      this.proc?.once("exit", () => {
        (this.deps.clearTimeout ?? clearTimeout)(t);
        resolve();
      });
    });
  }

}

// ─── Standalone helper ─────────────────────────────────────────────

/**
 * Send `sys.shutdown` over an existing OPEN WebSocket and wait for the
 * `sys.shutting-down` ack. Does NOT open a new connection — caller passes
 * the long-lived PTY connection so the sidecar's multi-client policy
 * doesn't refuse a second client.
 *
 * Resolves on:
 *   - `sys.shutting-down` ack received → ws.close() + resolve
 *   - `ackTimeoutMs` elapsed → ws.close() + resolve (best-effort)
 *   - ws error → ws.close() + resolve
 *
 * Never rejects. Caller may still await `launcher.stop()` separately to
 * wait for the actual process exit.
 */
export async function sendShutdownOverWs(
  ws: WebSocket,
  reason?: string,
  ackTimeoutMs = 5_000,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* */ }
      resolve();
    };

    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg?.type === "sys.shutting-down") {
          clearTimeout(timer);
          ws.removeEventListener?.("message", onMessage);
          finish();
        }
      } catch { /* ignore */ }
    };
    const onError = () => {
      clearTimeout(timer);
      finish();
    };

    const timer = setTimeout(finish, ackTimeoutMs);
    ws.addEventListener?.("message", onMessage);
    ws.addEventListener?.("error", onError);

    const sendShutdown = () => {
      try {
        ws.send(JSON.stringify({ type: "sys.shutdown", reason }));
      } catch {
        clearTimeout(timer);
        finish();
      }
    };

    // readyState === 1 is WebSocket.OPEN per RFC 6455. Hardcoded so this
    // module works in both panel runtime (where global WebSocket exists)
    // and node-based unit tests (where it doesn't).
    if (ws.readyState === 1) {
      sendShutdown();
    } else {
      const onOpen = () => {
        ws.removeEventListener?.("open", onOpen);
        sendShutdown();
      };
      ws.addEventListener?.("open", onOpen);
    }
  });
}

// ─── Internal types ────────────────────────────────────────────────

interface RawReady {
  type: "ready";
  port: number;
  host: string;
  pid?: number;
  version: string;
  protocolVersion: number;
  ts: number;
  aePid: number | null;
}
