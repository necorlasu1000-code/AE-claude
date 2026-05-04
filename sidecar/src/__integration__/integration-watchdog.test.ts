// Phase 2.5.6 — AE death watchdog scenarios 7 + 7b.
//
// Scenario 7 (death detection):
//   spawn mock parent (kept alive by setInterval) → spawn sidecar with
//   AE_CLAUDE_AE_PID=<mockPid> + AE_CLAUDE_WATCHDOG_INTERVAL_MS=2000 →
//   verify lockfile present → SIGKILL mock parent → sidecar must
//   self-shutdown within 12s (watchdog probe + onDeath → gracefulShutdown
//   → releaseLock + tree kill + process.exit) → lockfile removed +
//   stderr shows 'ae-process-dead'.
//
// Scenario 7b (no false positives):
//   same setup, but parent stays alive for 5s → sidecar must NOT
//   self-shutdown during that window → THEN kill parent → sidecar
//   shuts down. Validates watchdog doesn't fire onDeath while parent
//   is still reachable.

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSidecar, type SpawnedSidecar } from "./spawn-helper.js";

let sidecar: SpawnedSidecar | undefined;
let mockParent: ChildProcess | undefined;
let lockDir: string;

beforeEach(async () => {
  lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-int-watch-"));
});

afterEach(async (ctx) => {
  if (sidecar) {
    if (ctx.task.result?.state === "fail") {
      console.error(`=== sidecar pid=${sidecar.pid} stderr (last 50 lines) ===\n${sidecar.stderr.slice(-50).join("\n")}\n=== end ===`);
    }
    // sidecar may already be exited (scenario 7 happy path)
    if (sidecar.exitCode === null) {
      await sidecar.kill().catch(() => { /* */ });
    }
    sidecar = undefined;
  }
  if (mockParent && mockParent.exitCode === null && mockParent.pid !== undefined) {
    try { process.kill(mockParent.pid, "SIGKILL"); } catch { /* already dead */ }
  }
  mockParent = undefined;
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* */ });
});

// ─── Helpers ───────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spawnMockParent(): ChildProcess {
  // Long-running noop process. setInterval keeps the event loop busy,
  // so it stays alive until SIGKILL.
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: false,
    windowsHide: true,
  });
}

function lockPathFor(aePid: number): string {
  return path.join(lockDir, `sidecar-${aePid}.lock`);
}

async function lockExists(aePid: number): Promise<boolean> {
  try { await fs.access(lockPathFor(aePid)); return true; }
  catch { return false; }
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

async function waitForExit(s: SpawnedSidecar, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return Promise.race([
    s.exitPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`sidecar did not exit within ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

// ─── Suite ─────────────────────────────────────────────────────────

describe("integration watchdog (Phase 2.5.6)", () => {
  // ── scenario 7 ───────────────────────────────────────────────────
  it("scenario 7: AE death → watchdog detects → sidecar self-shutdown + lockfile removed", async () => {
    let stage = "boot";
    try {
      stage = "mock-parent-spawn";
      mockParent = spawnMockParent();
      const mockPid = mockParent.pid;
      if (mockPid === undefined) throw new Error("mock parent has no pid");
      expect(isPidAlive(mockPid)).toBe(true);

      stage = "sidecar-spawn";
      sidecar = await spawnSidecar({
        env: {
          AE_CLAUDE_LOCK_DIR: lockDir,
          AE_CLAUDE_AE_PID: String(mockPid),
          AE_CLAUDE_WATCHDOG_INTERVAL_MS: "2000",  // fast probing for tests
          AE_CLAUDE_DEBUG: "1",
        },
      });
      expect(sidecar.aePid).toBe(mockPid);

      stage = "lockfile-exists";
      expect(await lockExists(mockPid)).toBe(true);

      stage = "kill-mock-parent";
      process.kill(mockPid, "SIGKILL");
      // brief wait for OS to actually mark it dead before sidecar polls
      await delay(50);
      expect(isPidAlive(mockPid)).toBe(false);

      stage = "sidecar-self-shutdown";
      // Watchdog interval=2s, probe is on interval boundary, then onDeath
      // → gracefulShutdown (bridge.stop + tree kill ~2s + releaseLock).
      // 12s budget covers worst case.
      const exitResult = await waitForExit(sidecar, 12_000);
      expect(exitResult.code).toBe(0);  // graceful

      stage = "lockfile-removed";
      await delay(100);  // fs flush after releaseLock
      expect(await lockExists(mockPid)).toBe(false);

      stage = "stderr-trace";
      const stderrJoined = sidecar.stderr.join("\n");
      expect(stderrJoined).toMatch(/ae-process-dead/);
    } catch (e) {
      throw new Error(
        `Scenario 7 failed at stage='${stage}'.\n  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 25_000);

  // ── scenario 7b ──────────────────────────────────────────────────
  it("scenario 7b: alive parent → sidecar does NOT self-shutdown over 5s window", async () => {
    let stage = "boot";
    try {
      stage = "mock-parent-spawn";
      mockParent = spawnMockParent();
      const mockPid = mockParent.pid;
      if (mockPid === undefined) throw new Error("mock parent has no pid");

      stage = "sidecar-spawn";
      sidecar = await spawnSidecar({
        env: {
          AE_CLAUDE_LOCK_DIR: lockDir,
          AE_CLAUDE_AE_PID: String(mockPid),
          AE_CLAUDE_WATCHDOG_INTERVAL_MS: "1000",  // even faster — 5 polls in 5s
          AE_CLAUDE_DEBUG: "1",
        },
      });

      stage = "watch-window";
      // 5 watchdog probes during this window. None should see the parent
      // as dead, so onDeath should NOT fire.
      await delay(5_000);
      expect(sidecar.exitCode).toBeNull();           // still running
      expect(sidecar.exitSignal).toBeNull();
      expect(await lockExists(mockPid)).toBe(true);  // lockfile intact

      stage = "kill-and-confirm-shutdown";
      // Now kill parent — sidecar should detect on next probe and shut down.
      process.kill(mockPid, "SIGKILL");
      const exitResult = await waitForExit(sidecar, 12_000);
      expect(exitResult.code).toBe(0);

      stage = "post-shutdown-checks";
      await delay(100);
      expect(await lockExists(mockPid)).toBe(false);
    } catch (e) {
      throw new Error(
        `Scenario 7b failed at stage='${stage}'.\n  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 25_000);
});
