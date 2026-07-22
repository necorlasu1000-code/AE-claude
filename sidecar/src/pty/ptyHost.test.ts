// PtyHost smoke test — verifies node-pty native module + ConPTY/Unix PTY
// roundtrip works in this environment. Spawns a shell, writes "echo hello\r",
// expects "hello" back via onData within 30s.
//
// Platform-aware: cmd.exe on Windows, bash elsewhere.
// This is the Phase 2 #2 verification gate.

import { describe, it, expect } from "vitest";
import { PtyHost } from "./ptyHost.js";

const isWin = process.platform === "win32";
const SHELL = isWin ? "cmd.exe" : "bash";
const SHELL_ARGS = isWin ? [] : ["--norc", "--noprofile"];

describe("PtyHost — spawn + I/O roundtrip", () => {
  it("writes 'echo hello' and receives 'hello' in output", async () => {
    const pty = new PtyHost({ cmd: SHELL, args: SHELL_ARGS, cols: 80, rows: 24 });
    expect(pty.pid).toBeDefined();
    expect(pty.alive).toBe(true);

    let combined = "";
    const matched = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout: did not see 'hello' twice in output. Got: ${JSON.stringify(combined.slice(-200))}`));
      }, 15_000);

      pty.onData((data) => {
        combined += data;
        // ConPTY emits screen-buffer ANSI escapes, not raw text — see mistakes.md.
        // Robust check: 'hello' appears at least twice (once for command echo,
        // once for output). Works on both ConPTY (Windows) and Unix PTY.
        const hits = (combined.match(/hello/g) || []).length;
        if (hits >= 2) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    pty.write("echo hello\r");
    await matched;

    // Fire-and-forget kill: PtyHost.kill's graceful shutdown (SIGTERM → SIGKILL)
    // hangs on Windows ConPTY in some cases — see mistakes.md "PtyHost.kill graceful
    // shutdown ConPTY 호환성 검증". Test cleanup happens via process exit; smoke
    // verification is the I/O roundtrip, not the kill mechanics.
    pty.kill().catch(() => { /* best-effort cleanup */ });
  }, 30_000);

  // mistakes #23 — a subscriber that calls onExit() AFTER the child already
  // exited must still receive the exit (the sidecar wires pty.onExit only
  // after boot-time awaits, during which claude could die). Pre-fix the late
  // callback was added to an empty-at-exit set and never fired.
  it("delivers buffered exit to a late onExit subscriber", async () => {
    const cmd = isWin ? "cmd.exe" : "bash";
    const args = isWin ? ["/c", "exit", "0"] : ["-c", "exit 0"];
    const pty = new PtyHost({ cmd, args, cols: 80, rows: 24 });

    // Wait for the process to actually exit (first subscriber).
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("child did not exit in time")), 15_000);
      pty.onExit(() => { clearTimeout(t); resolve(); });
    });
    expect(pty.alive).toBe(false);

    // Late subscriber — must be invoked synchronously with the buffered exit.
    let lateFired = false;
    pty.onExit(() => { lateFired = true; });
    expect(lateFired).toBe(true);
  }, 30_000);
});
