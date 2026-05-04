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
});
