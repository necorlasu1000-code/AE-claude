// PtyHost — node-pty wrapper for the sidecar.
//
// Single responsibility: spawn a child process under a pseudo-terminal,
// expose raw I/O (write / onData / resize / kill) plus a ring buffer
// of recent output for panel reconnect replay (P1).
//
// Does NOT import protocol.ts — message wrapping is panelBridge's job.
// This separation lets ptyHost be unit-tested without WebSocket plumbing
// and lets panelBridge pick its own delivery semantics (chunking, batching).
//
// Windows: relies on ConPTY (Win10 1809+ / Win11). winpty fallback unused
// per plan.md and CLAUDE.md. node-pty 1.0+ defaults to ConPTY on supported
// builds; we set useConpty:true explicitly to guard against future default
// changes.

import { spawn, type IPty } from "node-pty";
import { spawn as cpSpawn } from "node:child_process";

export interface PtyHostOptions {
  cmd: string;
  args?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Hard cap (ms) on kill() resolution. Reserved for Phase 2.5.4 — when set,
   * kill() resolves no later than killHardCapMs even if SIGTERM/SIGKILL fail
   * to terminate the underlying ConPTY process. Default: undefined (graceful
   * SIGTERM → SIGKILL after 5s only).
   */
  killHardCapMs?: number;
}

type DataCb = (data: string) => void;
type ExitCb = (code: number, signal?: number) => void;

export class PtyHost {
  // Ring buffer of complete output lines. Sized at 10,000 lines per
  // plan.md GSTACK REVIEW REPORT § Eng P1#6:
  //   - xterm scrollback default = 1,000 → 10× headroom for reconnect replay
  //   - average ~150 bytes/line → ~1.5MB worst-case memory footprint
  //   - covers a 1-week continuous session without unbounded growth
  // Lookup cost is O(1) for getRecentOutput (slice). Push cost amortized
  // O(1); shift() at cap is O(n) but n=10K is negligible at PTY rates.
  private static readonly MAX_LINES = 10_000;

  private pty: IPty | undefined;
  private dataCbs = new Set<DataCb>();
  private exitCbs = new Set<ExitCb>();
  // Reserved for Phase 2.5.4 kill semantics. Stored at construction; not
  // consumed yet. Tests must not regress when this is set.
  private readonly killHardCapMs: number | undefined;

  // Ring buffer + carry-over for incomplete trailing fragment.
  // Newlines split chunks into lines; the final segment of a chunk
  // may be incomplete and is held until the next chunk arrives.
  private buffer: string[] = [];
  private pendingLine = "";

  private _alive = false;

  constructor(opts: PtyHostOptions) {
    this.killHardCapMs = opts.killHardCapMs;
    this.pty = spawn(opts.cmd, opts.args ?? [], {
      name: "xterm-color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env: opts.env ?? (process.env as Record<string, string>),
      encoding: "utf8",
      // ConPTY-only on Windows. winpty fallback is intentionally not used.
      useConpty: true,
    });

    this._alive = true;

    this.pty.onData((data) => {
      this.appendToBuffer(data);
      for (const cb of this.dataCbs) {
        try { cb(data); } catch { /* subscriber error must not crash PTY */ }
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this._alive = false;
      this.pty = undefined;
      for (const cb of this.exitCbs) {
        try { cb(exitCode, signal); } catch { /* same */ }
      }
    });
  }

  get pid(): number | undefined {
    return this.pty?.pid;
  }

  get alive(): boolean {
    return this._alive;
  }

  onData(cb: DataCb): () => void {
    this.dataCbs.add(cb);
    return () => { this.dataCbs.delete(cb); };
  }

  onExit(cb: ExitCb): () => void {
    this.exitCbs.add(cb);
    return () => { this.exitCbs.delete(cb); };
  }

  write(data: string): void {
    if (!this._alive || !this.pty) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this._alive || !this.pty) return;
    this.pty.resize(cols, rows);
  }

  /**
   * ConPTY-safe graceful kill.
   *
   * Background (Phase 2.5.4 discovery): on Windows ConPTY, both SIGTERM and
   * the SIGKILL fallback through node-pty's `pty.kill(signal)` are silently
   * ignored — onExit never fires and the child stays alive indefinitely.
   *
   * Strategy:
   *   1. SIGTERM via node-pty (works on bash; ignored by ConPTY — harmless)
   *   2. After 1s, OS-level TREE kill (bypasses node-pty entirely):
   *      - Windows: `taskkill /F /T /PID <pid>` — force, tree (children too)
   *      - Unix: `process.kill(-pid, "SIGKILL")` — process group
   *      Tree kill protects against Phase 4 (claude CLI may spawn its own
   *      children — killing only the parent leaves zombies).
   *   3. Hard cap (`killHardCapMs`, default 8s): resolve the Promise no
   *      matter what, marking _alive=false defensively. Prevents shutdown
   *      hangs even if both kill paths fail.
   */
  async kill(): Promise<void> {
    if (!this._alive || !this.pty) return;
    const pty = this.pty;
    const pid = pty.pid;
    const hardCap = this.killHardCapMs ?? 8_000;

    return new Promise<void>((resolve) => {
      let resolved = false;
      let treeKillTimer: NodeJS.Timeout | undefined;
      let hardCapTimer: NodeJS.Timeout | undefined;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (treeKillTimer) clearTimeout(treeKillTimer);
        if (hardCapTimer) clearTimeout(hardCapTimer);
        resolve();
      };

      // 1. onExit subscriber — fires when child actually dies (any path).
      const off = this.onExit(() => { off(); finish(); });

      // 2. Graceful SIGTERM via node-pty.
      try { pty.kill("SIGTERM"); } catch { /* may already be dead */ }

      // 3. After 1s, escalate to OS-level tree kill.
      treeKillTimer = setTimeout(() => {
        if (resolved || pid === undefined) return;
        this.osTreeKill(pid);
      }, 1_000);

      // 4. Hard cap — guarantee resolve() so shutdown doesn't hang.
      hardCapTimer = setTimeout(() => {
        this._alive = false;
        this.pty = undefined;
        finish();
      }, hardCap);
    });
  }

  /** OS-level tree kill. Best-effort: errors are swallowed — hard cap covers
   *  the worst case. Spawned helper processes (taskkill) get their own 3s
   *  timeout so they can't hang either. */
  private osTreeKill(pid: number): void {
    if (process.platform === "win32") {
      try {
        const tk = cpSpawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
          windowsHide: true,
          stdio: "ignore",
          detached: false,
        });
        const tkSelfTimer = setTimeout(() => {
          try { tk.kill("SIGKILL"); } catch { /* */ }
        }, 3_000);
        tkSelfTimer.unref();
        tk.once("exit", () => clearTimeout(tkSelfTimer));
        tk.on("error", () => { /* taskkill missing or already-dead pid — ignore */ });
      } catch { /* spawn itself failed — hard cap will catch it */ }
    } else {
      // Negative pid = process group. node-pty puts the child in its own
      // session, so killpg targets the shell + all its descendants.
      try { process.kill(-pid, "SIGKILL"); } catch {
        // Fallback: child may not be a group leader.
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    }
  }

  /** Last `maxLines` complete output lines. Used by panelBridge on reconnect (P1). */
  getRecentOutput(maxLines: number = PtyHost.MAX_LINES): string[] {
    const n = Math.min(maxLines, this.buffer.length);
    return this.buffer.slice(this.buffer.length - n);
  }

  private appendToBuffer(chunk: string): void {
    const combined = this.pendingLine + chunk;
    const lines = combined.split(/\r?\n/);
    // Last element may be a partial line with no terminating newline yet.
    this.pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      this.buffer.push(line);
      if (this.buffer.length > PtyHost.MAX_LINES) {
        this.buffer.shift();
      }
    }
  }
}
