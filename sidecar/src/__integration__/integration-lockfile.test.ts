// Phase 2.5.5 — lockfile race + stale detection (scenario 6 + 6b).
//
// Scenario 6 (3-cycle race):
//   sidecar #1 spawn with AE_PID=N → lockfile exists with #1 pid
//   sidecar #2 spawn same AE_PID → exits with code 2, stderr has "lock-held"
//                                 → lockfile unchanged (still #1)
//   sidecar #1 SIGTERM (now works after Phase 2.5.4 tree kill fix)
//                                 → graceful shutdown removes lockfile
//   sidecar #3 spawn same AE_PID → succeeds, lockfile has #3 pid
//
// Scenario 6b (stale recovery):
//   sidecar #4 spawn → lockfile created
//   sidecar #4 SIGKILL'd directly (simulates crash; bypasses shutdown
//             handler) → lockfile orphaned with dead pid
//   sidecar #5 spawn same AE_PID → stale detection (process.kill(deadPid, 0)
//             throws ESRCH) → overwrites lockfile with #5 pid

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSidecar, type SpawnedSidecar } from "./spawn-helper.js";

let sidecars: SpawnedSidecar[] = [];
let lockDir: string;

beforeEach(async () => {
  lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-int-lock-"));
  sidecars = [];
});

afterEach(async (ctx) => {
  for (const s of sidecars) {
    if (ctx.task.result?.state === "fail") {
      console.error(`=== sidecar pid=${s.pid} stderr (last 30) ===\n${s.stderr.slice(-30).join("\n")}\n=== end ===`);
    }
    await s.kill().catch(() => { /* best-effort */ });
  }
  sidecars = [];
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* */ });
});

// ─── Helpers ───────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lockPathFor = (aePid: number) => path.join(lockDir, `sidecar-${aePid}.lock`);

interface LockContent {
  sidecarPid: number;
  aePid: number;
  port: number;
  startedAt: number;
}

async function readLock(aePid: number): Promise<LockContent> {
  const raw = await fs.readFile(lockPathFor(aePid), "utf8");
  return JSON.parse(raw) as LockContent;
}

async function lockExists(aePid: number): Promise<boolean> {
  try { await fs.access(lockPathFor(aePid)); return true; }
  catch { return false; }
}

function envFor(aePid: number) {
  return {
    AE_CLAUDE_LOCK_DIR: lockDir,
    AE_CLAUDE_AE_PID: String(aePid),
    AE_CLAUDE_DEBUG: "1",
    // Disable watchdog: this test uses synthetic AE_PIDs (12345/12346 etc)
    // that don't correspond to a live process. Without this, watchdog's
    // first probe sees ESRCH and triggers shutdown ('ae-process-dead'),
    // which removes the lockfile mid-test and breaks the race assertion.
    // Watchdog itself is verified separately in scenario 7 (Phase 2.5.6).
    AE_CLAUDE_DISABLE_WATCHDOG: "1",
  };
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

// ─── Suite ─────────────────────────────────────────────────────────

describe("integration lockfile race (Phase 2.5.5)", () => {
  // ── scenario 6 ───────────────────────────────────────────────────
  it("scenario 6: race → graceful shutdown removes lock → respawn", async () => {
    let stage = "boot";
    try {
      const aePid = 12345;

      stage = "sidecar1-spawn";
      const s1 = await spawnSidecar({ env: envFor(aePid) });
      sidecars.push(s1);
      expect(s1.aePid).toBe(aePid);

      stage = "sidecar1-lockfile-exists";
      expect(await lockExists(aePid)).toBe(true);
      const lock1 = await readLock(aePid);
      expect(lock1.sidecarPid).toBe(s1.pid);
      expect(lock1.aePid).toBe(aePid);
      expect(lock1.port).toBe(s1.port);

      stage = "sidecar2-refused";
      let s2Error = "";
      try {
        const s2 = await spawnSidecar({ env: envFor(aePid), spawnTimeoutMs: 8_000 });
        sidecars.push(s2);
        throw new Error("sidecar2 unexpectedly succeeded — expected lock refusal");
      } catch (e) {
        s2Error = e instanceof Error ? e.message : String(e);
      }
      // spawn-helper rejects with this exact phrase + stderr dump on early exit
      expect(s2Error).toContain("exited before ready");
      expect(s2Error).toContain("code=2");  // index.ts uses exit code 2 for lock-held
      expect(s2Error).toMatch(/lock-held|AELockHeld|already running/i);

      stage = "sidecar2-lockfile-untouched";
      const lockAfterRefuse = await readLock(aePid);
      expect(lockAfterRefuse.sidecarPid).toBe(s1.pid);
      expect(lockAfterRefuse.port).toBe(s1.port);

      stage = "sidecar1-shutdown";
      // Use WS sys.shutdown (Phase 2.5.5.0) instead of SIGTERM. On Windows,
      // process.kill SIGTERM is mapped to TerminateProcess and the sidecar's
      // signal handler doesn't run → lockfile stays. sys.shutdown triggers
      // gracefulShutdown via the panelBridge.onShutdownRequest callback,
      // which DOES run releaseLock.
      await s1.sendShutdown("test-cleanup");
      await delay(100);          // fs flush after releaseLock (best-effort)

      stage = "sidecar1-lockfile-removed";
      expect(await lockExists(aePid)).toBe(false);

      stage = "sidecar3-spawn";
      const s3 = await spawnSidecar({ env: envFor(aePid) });
      sidecars.push(s3);
      expect(s3.aePid).toBe(aePid);

      stage = "sidecar3-lockfile-new-pid";
      const lock3 = await readLock(aePid);
      expect(lock3.sidecarPid).toBe(s3.pid);
      expect(lock3.sidecarPid).not.toBe(s1.pid);
      expect(lock3.port).toBe(s3.port);
    } catch (e) {
      throw new Error(
        `Scenario 6 failed at stage='${stage}'.\n  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 40_000);

  // ── scenario 6b: stale lock detection ────────────────────────────
  it("scenario 6b: SIGKILL leaves orphan lockfile, next spawn detects stale + overwrites", async () => {
    let stage = "boot";
    try {
      const aePid = 12346;

      stage = "sidecar4-spawn";
      const s4 = await spawnSidecar({ env: envFor(aePid) });
      sidecars.push(s4);
      expect(await lockExists(aePid)).toBe(true);
      const s4Pid = s4.pid;

      stage = "sidecar4-forcekill";
      // forceKill bypasses ALL cleanup — simulates a sidecar crash.
      // Lockfile is intentionally left orphaned for the next sidecar
      // to detect as stale.
      await s4.forceKill();
      await delay(50);          // grace for any in-flight fs ops

      stage = "sidecar4-lock-orphaned";
      // Lockfile still present, holds the now-dead s4 pid.
      expect(await lockExists(aePid)).toBe(true);
      const orphan = await readLock(aePid);
      expect(orphan.sidecarPid).toBe(s4Pid);
      // Confirm the OS pid is actually dead.
      expect(isPidAlive(s4Pid)).toBe(false);

      stage = "sidecar5-stale-detected";
      // acquireLock should see EEXIST → read existing → isProcessAlive(s4Pid)
      // returns false (ESRCH) → unlink + write new lock with #5 pid.
      const s5 = await spawnSidecar({ env: envFor(aePid) });
      sidecars.push(s5);
      expect(s5.port).toBeGreaterThan(0);

      stage = "sidecar4-lockfile-overwritten";
      const lock5 = await readLock(aePid);
      expect(lock5.sidecarPid).toBe(s5.pid);
      expect(lock5.sidecarPid).not.toBe(s4Pid);
      expect(lock5.port).toBe(s5.port);
    } catch (e) {
      throw new Error(
        `Scenario 6b failed at stage='${stage}'.\n  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 40_000);
});
