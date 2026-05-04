// watchdog.test.ts — 3 scenarios using vi.spyOn(process, "kill") to
// simulate alive/dead parent process.

import { describe, it, expect, vi, afterEach } from "vitest";
import { PidWatchdog } from "./watchdog.js";

afterEach(() => { vi.restoreAllMocks(); });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PidWatchdog", () => {
  // ── 1 ────────────────────────────────────────────────────────────
  it("alive pid: onDeath NOT fired across multiple polls", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const onDeath = vi.fn();
    const wd = new PidWatchdog({ pid: 12345, intervalMs: 30, onDeath });
    wd.start();
    await delay(120);  // ~4 polls
    wd.stop();

    expect(killSpy).toHaveBeenCalled();
    expect(onDeath).not.toHaveBeenCalled();
    expect(wd.triggered).toBe(false);
  });

  // ── 2 ────────────────────────────────────────────────────────────
  it("dead pid: onDeath fires exactly once and watchdog stops auto", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("no such process") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const onDeath = vi.fn();
    const wd = new PidWatchdog({ pid: 99999, intervalMs: 20, onDeath });
    wd.start();
    await delay(100);  // multiple polls would have fired if not for fired-once guard

    expect(onDeath).toHaveBeenCalledTimes(1);
    expect(wd.triggered).toBe(true);
    // Subsequent stops are idempotent.
    wd.stop();
    wd.stop();
  });

  // ── 3 ────────────────────────────────────────────────────────────
  it("stop(): no further polling after stop", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const onDeath = vi.fn();
    const wd = new PidWatchdog({ pid: 12345, intervalMs: 20, onDeath });
    wd.start();
    await delay(50);  // a few polls
    const callsBeforeStop = killSpy.mock.calls.length;
    wd.stop();
    await delay(100);  // wait — no new probes should happen
    const callsAfterStop = killSpy.mock.calls.length;

    expect(callsAfterStop).toBe(callsBeforeStop);
    expect(onDeath).not.toHaveBeenCalled();
  });
});
