// spawn-helper.ts — Phase 2.5 integration test helper.
//
// Spawns a real sidecar process via tsx, parses the ready JSON line from
// stdout, captures stderr for debugging, and exposes a controlled kill().
//
// Used by every integration-*.test.ts file in this directory.

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// sidecar/ package root (3 levels up from src/__integration__/spawn-helper.ts)
const SIDECAR_ROOT = path.resolve(__dirname, "..", "..");

// Direct path to tsx's ES module entry point.
// We DON'T use node_modules/.bin/tsx.cmd: Node 20.12.2+ rejects spawning .cmd
// files with shell:false (CVE-2024-27980 fix). Running via process.execPath
// (current node) + tsx's cli.mjs avoids the shim entirely and is cross-platform.
// See mistakes.md "Node 20.12+ child_process.spawn EINVAL on Windows .cmd".
const TSX_CLI = path.join(SIDECAR_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

export interface ReadyEnvelope {
  type: "ready";
  port: number;
  host: string;
  pid: number;
  version: string;
  protocolVersion: number;
  aePid: number | null;
  ts: number;
}

export interface SpawnedSidecar {
  /** Bound WebSocket port (from ready JSON). */
  readonly port: number;
  /** Sidecar process pid. */
  readonly pid: number;
  /** Parent AE pid (from ready JSON, may be null in dev mode). */
  readonly aePid: number | null;
  /** Live stderr buffer. Tests dump this on failure. */
  readonly stderr: string[];
  /** Underlying child process for advanced use (avoid in normal tests). */
  readonly proc: ChildProcess;
  /** Exit code, null until exit. */
  readonly exitCode: number | null;
  /** Exit signal, null unless killed by signal. */
  readonly exitSignal: NodeJS.Signals | null;
  /** Resolves when sidecar exits. */
  readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /**
   * Kill the sidecar. Sends `signal` (default SIGTERM), waits up to 5s for
   * graceful exit, then SIGKILL fallback. Resolves when process actually exits.
   */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

export interface SpawnSidecarOptions {
  /** Extra env to merge with process.env. Use undefined to unset a key. */
  env?: Record<string, string | undefined>;
  /** Extra CLI args (passed after src/index.ts). */
  args?: string[];
  /** How long to wait for ready JSON. Default 15s (tsx cold start). */
  spawnTimeoutMs?: number;
  /** Override cwd. Default = sidecar package root. */
  cwd?: string;
}

/**
 * Spawn a sidecar process and wait for its ready JSON. On timeout or early
 * exit, throws with stderr dumped into the message for diagnosis.
 */
export async function spawnSidecar(opts: SpawnSidecarOptions = {}): Promise<SpawnedSidecar> {
  // Build env: start from process.env, layer overrides, drop undefined keys.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  const proc = spawn(process.execPath, [TSX_CLI, "src/index.ts", ...(opts.args ?? [])], {
    cwd: opts.cwd ?? SIDECAR_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  const stderr: string[] = [];
  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line) stderr.push(line);
    }
  });

  const state = {
    exitCode: null as number | null,
    exitSignal: null as NodeJS.Signals | null,
  };
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.once("exit", (code, signal) => {
      state.exitCode = code;
      state.exitSignal = signal;
      resolve({ code, signal });
    });
  });

  // Read first newline-terminated line from stdout, parse as ready JSON.
  const ready = await new Promise<ReadyEnvelope>((resolve, reject) => {
    let buf = "";
    const timeoutMs = opts.spawnTimeoutMs ?? 15_000;
    const timer = setTimeout(() => {
      proc.stdout?.off("data", onData);
      reject(new Error(
        `sidecar spawn timeout after ${timeoutMs}ms.\n` +
        `--- stderr (last 30 lines) ---\n${stderr.slice(-30).join("\n")}`,
      ));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      proc.stdout?.off("data", onData);
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(line) as ReadyEnvelope;
        if (parsed.type !== "ready" || typeof parsed.port !== "number") {
          reject(new Error(`unexpected ready JSON: ${line}`));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`malformed ready JSON: ${line}\n  parse error: ${e instanceof Error ? e.message : String(e)}`));
      }
    };
    proc.stdout?.on("data", onData);

    // If process exits before ready JSON, reject with stderr.
    proc.once("exit", (code, signal) => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      reject(new Error(
        `sidecar exited before ready (code=${code}, signal=${signal}).\n` +
        `--- stderr ---\n${stderr.join("\n")}`,
      ));
    });
  });

  const kill = async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
    if (state.exitCode !== null || state.exitSignal !== null) return;
    try { proc.kill(signal); } catch { /* may already be dead */ }
    const fallback = setTimeout(() => {
      if (state.exitCode === null && state.exitSignal === null) {
        try { proc.kill("SIGKILL"); } catch { /* same */ }
      }
    }, 5_000);
    fallback.unref();
    await exitPromise;
    clearTimeout(fallback);
  };

  return {
    port: ready.port,
    pid: ready.pid,
    aePid: ready.aePid,
    stderr,
    proc,
    get exitCode() { return state.exitCode; },
    get exitSignal() { return state.exitSignal; },
    exitPromise,
    kill,
  } satisfies SpawnedSidecar;
}

/**
 * Convenience wrapper: spawn sidecar with isolated lockfile dir + watchdog
 * disabled by default, suitable for tests that don't need parent supervision.
 */
export async function spawnIsolatedSidecar(
  lockDir: string,
  extra: SpawnSidecarOptions = {},
): Promise<SpawnedSidecar> {
  return spawnSidecar({
    ...extra,
    env: {
      AE_CLAUDE_LOCK_DIR: lockDir,
      AE_CLAUDE_DEBUG: "1",
      ...(extra.env ?? {}),
    },
  });
}
