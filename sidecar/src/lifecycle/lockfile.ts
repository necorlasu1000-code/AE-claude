// Lockfile — 사이드카 ↔ AE 1:1 인스턴스 보장.
//
// 배치: ~/.ae-claude-panel/sidecar-{aePid}.lock
//   - Windows: %USERPROFILE%\.ae-claude-panel\... (os.homedir())
//   - Mac/Linux: $HOME/.ae-claude-panel/...
//   os.homedir()로 cross-platform 보장. AE_CLAUDE_LOCK_DIR ENV로 test override.
//
// Race-safe write: fs.writeFile with flag:"wx" — exclusive create. 두 sidecar가
// 동시에 같은 aePid로 acquire 시도해도 EEXIST로 한쪽만 성공.
// stale lock (sidecarPid가 죽은 프로세스): unlink + retry.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface LockContent {
  sidecarPid: number;
  aePid: number;
  port: number;
  startedAt: number;
}

export function getLockDir(): string {
  return process.env.AE_CLAUDE_LOCK_DIR || path.join(os.homedir(), ".ae-claude-panel");
}

export function getLockPath(aePid: number): string {
  return path.join(getLockDir(), `sidecar-${aePid}.lock`);
}

/** Best-effort liveness check via signal-0 probe. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // ESRCH = no such process. EPERM = exists but not ours (still alive).
    if (code === "EPERM") return true;
    return false;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Acquire lock for the given aePid. Throws if a live sidecar already holds
 * the lock. Stale locks (sidecar dead) are silently overwritten.
 *
 * @returns the lock file path on success.
 */
export async function acquireLock(content: LockContent): Promise<string> {
  const lockPath = getLockPath(content.aePid);
  await ensureDir(getLockDir());
  const payload = JSON.stringify(content);

  // First attempt: exclusive create.
  try {
    await fs.writeFile(lockPath, payload, { flag: "wx", encoding: "utf8" });
    return lockPath;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }

  // Existed. Read holder, check liveness.
  let existing: LockContent;
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    existing = JSON.parse(raw) as LockContent;
  } catch {
    // Corrupt lock file — treat as stale.
    await fs.unlink(lockPath).catch(() => { /* race */ });
    return acquireLock(content); // single retry
  }

  if (typeof existing.sidecarPid === "number" && isProcessAlive(existing.sidecarPid)) {
    const err = new Error(
      `Another sidecar (pid=${existing.sidecarPid}, port=${existing.port}) is already running for AE pid=${content.aePid}`,
    );
    (err as NodeJS.ErrnoException).code = "AELockHeld";
    throw err;
  }

  // Stale — atomically claim the right to clear it via rename (only ONE
  // process can succeed on a given source path), then wx-create. A plain
  // unlink here had a TOCTOU: P1 unlink+wx-create wins, then P2's queued
  // unlink deletes P1's FRESH lock and P2's wx-create also succeeds —
  // both sidecars believe they hold the lock. rename moves exactly the
  // observed stale file; a process whose rename fails (ENOENT — someone
  // else claimed it) just falls through to wx-create and loses via EEXIST.
  const staleClaim = lockPath + `.stale-${process.pid}`;
  try {
    await fs.rename(lockPath, staleClaim);
    await fs.unlink(staleClaim).catch(() => { /* best-effort cleanup */ });
  } catch { /* another process claimed the stale file first */ }
  try {
    await fs.writeFile(lockPath, payload, { flag: "wx", encoding: "utf8" });
    return lockPath;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      // Another process acquired the freshly-vacant slot in the gap. Treat as live.
      const err = new Error(`Lost race for AE pid=${content.aePid} lock`);
      (err as NodeJS.ErrnoException).code = "AELockRaceLost";
      throw err;
    }
    throw e;
  }
}

/**
 * Release lock for given aePid. Best-effort: ENOENT or EACCES are swallowed.
 * Returns true if file was removed by us, false if it was already gone or
 * we lacked permission (we still consider the release "done" from caller's POV).
 */
export async function releaseLock(aePid: number): Promise<boolean> {
  const lockPath = getLockPath(aePid);
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return false;
    throw e;
  }
}

// ─── Ready file (Phase 2.6 — option B fallback for launcher) ────────
//
// Sidecar writes the ready JSON to BOTH stdout (option E primary path,
// captured by panel launcher's child_process.stdout listener) AND a file
// at <lockDir>/ready-<aePid>.json (option B fallback for environments
// where stdout listener fails or has timing issues).
//
// Same lockDir reuse: file lives next to the lockfile, cleaned up by
// gracefulShutdown alongside releaseLock.

export function getReadyFilePath(aePid: number): string {
  return path.join(getLockDir(), `ready-${aePid}.json`);
}

/** Write ready signal to file. Caller passes the same JSON they emit to stdout. */
export async function writeReadyFile(aePid: number, ready: object): Promise<void> {
  await ensureDir(getLockDir());
  await fs.writeFile(getReadyFilePath(aePid), JSON.stringify(ready), { encoding: "utf8" });
}

/** Best-effort delete during gracefulShutdown. ENOENT is fine (already gone). */
export async function deleteReadyFile(aePid: number): Promise<boolean> {
  try {
    await fs.unlink(getReadyFilePath(aePid));
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return false;
    throw e;
  }
}
