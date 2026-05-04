// Phase 2.5.4 — ConPTY kill discovery scenario 8.
//
// Hypothesis (mistakes.md "PtyHost.kill graceful shutdown ConPTY 호환성 검증"):
//   On Windows ConPTY, SIGTERM is ignored by cmd.exe → 5s graceful timer
//   fires → SIGKILL fallback. If even SIGKILL hangs through node-pty's
//   ConPTY layer, PtyHost.kill never resolves and shutdown hangs.
//
// This test runs PtyHost.kill() against a freshly-spawned shell and:
//   - measures resolve time
//   - polls the child pid every 500ms (process.kill(pid, 0)) to track when
//     the underlying process actually dies independent of node-pty's view
//   - 12s outer timeout — anything beyond that is a hang
// On HANG: dumps observation timeline so we can decide which boundary
// failed (SIGTERM ignored / SIGKILL ignored / node-pty exit event lost).

import { describe, it, expect, afterEach } from "vitest";
import { PtyHost } from "../pty/ptyHost.js";

let pty: PtyHost | undefined;

afterEach(() => {
  // Emergency cleanup: do NOT await PtyHost.kill (it may be the thing
  // that hangs). Send SIGKILL to the underlying pid directly.
  if (pty && pty.alive) {
    const pid = pty.pid;
    if (pid !== undefined) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }
  pty = undefined;
});

const isWin = process.platform === "win32";
const SHELL = isWin ? "cmd.exe" : "bash";
const SHELL_ARGS: string[] = isWin ? [] : ["--norc", "--noprofile"];

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

describe("integration ConPTY kill (Phase 2.5.4)", () => {
  it("scenario 8: PtyHost.kill resolves within 12s and child process is dead", async () => {
    pty = new PtyHost({ cmd: SHELL, args: SHELL_ARGS, cols: 80, rows: 24 });
    expect(pty.alive).toBe(true);
    const childPid = pty.pid;
    expect(childPid).toBeDefined();

    // Brief settle: ensure the shell process is fully up before we kill.
    // ConPTY initialization takes ~50-100ms; killing too early can confuse
    // the diagnosis ("did SIGTERM fire before the shell was ready?").
    await new Promise((r) => setTimeout(r, 300));
    expect(isPidAlive(childPid!)).toBe(true);

    const start = Date.now();
    let killResolveTime: number | undefined;
    const observations: Array<{ tMs: number; aliveOs: boolean; aliveHost: boolean }> = [];

    // Sample child PID liveness every 500ms while we wait for kill to resolve.
    const observeTimer = setInterval(() => {
      observations.push({
        tMs: Date.now() - start,
        aliveOs: isPidAlive(childPid!),
        aliveHost: pty?.alive ?? false,
      });
    }, 500);

    let hung = false;
    try {
      const killPromise = pty.kill().then(() => {
        killResolveTime = Date.now() - start;
      });

      const hangTimeout = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("__hang__")), 12_000);
      });

      try {
        await Promise.race([killPromise, hangTimeout]);
      } catch (e) {
        if (e instanceof Error && e.message === "__hang__") {
          hung = true;
        } else {
          throw e;
        }
      }
    } finally {
      clearInterval(observeTimer);
    }

    // ─── Diagnostic dump (always log; useful even on PASS) ─────────
    const timeline = observations
      .map((o) => `${String(o.tMs).padStart(5)}ms: os=${o.aliveOs ? "ALIVE" : "DEAD"} host=${o.aliveHost ? "ALIVE" : "DEAD"}`)
      .join("\n    ");
    const summary =
      `  childPid=${childPid}\n` +
      `  killResolveTime=${killResolveTime !== undefined ? killResolveTime + "ms" : "NEVER (hung)"}\n` +
      `  observations:\n    ${timeline || "(no samples)"}\n` +
      `  final PtyHost.alive=${pty.alive}, OS pid alive=${childPid !== undefined ? isPidAlive(childPid) : "?"}`;

    if (hung) {
      // Emergency cleanup before throwing.
      if (childPid !== undefined && isPidAlive(childPid)) {
        try { process.kill(childPid, "SIGKILL"); } catch { /* */ }
      }
      throw new Error(`PtyHost.kill HUNG (>12s). Diagnosis:\n${summary}`);
    }

    // PASS path — surface timing for the human reading the test log.
    console.log(`[scenario 8 PASS]\n${summary}`);

    expect(killResolveTime).toBeDefined();
    expect(killResolveTime!).toBeLessThan(12_000);
    expect(pty.alive).toBe(false);
    // Underlying process must actually be dead. Allow a small grace window
    // (50ms) for OS reaping after node-pty's exit event.
    let osDead = false;
    for (let i = 0; i < 5; i++) {
      if (!isPidAlive(childPid!)) { osDead = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(osDead).toBe(true);
  }, 20_000);
});
