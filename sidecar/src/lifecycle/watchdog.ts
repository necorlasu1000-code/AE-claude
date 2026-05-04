// PidWatchdog — parent AE process liveness check.
//
// E4 mechanism: poll process.kill(pid, 0) at interval. Signal 0 = permission
// probe (no actual signal sent). On any error other than EPERM (which means
// "alive but not ours"), treat as dead and fire onDeath once.
//
// Cross-platform: Node's process.kill(pid, 0) works on Win/Mac/Linux.
// onDeath fires AT MOST ONCE per watchdog instance.

export interface PidWatchdogOptions {
  pid: number;
  intervalMs?: number;       // default 60_000
  onDeath: () => void;
}

export class PidWatchdog {
  private timer: NodeJS.Timeout | undefined;
  private fired = false;

  constructor(private readonly opts: PidWatchdogOptions) {}

  start(): void {
    if (this.timer) return;
    const interval = this.opts.intervalMs ?? 60_000;
    this.timer = setInterval(() => this.probe(), interval);
    // Immediate first probe so we don't wait a full interval to detect
    // an already-dead parent at startup.
    this.probe();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** True after onDeath has been fired. */
  get triggered(): boolean {
    return this.fired;
  }

  private probe(): void {
    if (this.fired) return;
    if (this.isAlive(this.opts.pid)) return;
    this.fired = true;
    this.stop();
    try { this.opts.onDeath(); } catch { /* never throw from watchdog */ }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // EPERM = process exists but we can't signal it — still alive from
      // our perspective. ESRCH (or anything else) = dead.
      if (code === "EPERM") return true;
      return false;
    }
  }
}
