// lockfile.test.ts — 5 scenarios covering stale detection, alive refusal,
// auto-mkdir, race resolution, and best-effort release.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  acquireLock,
  releaseLock,
  getLockPath,
  getLockDir,
  writeReadyFile,
  deleteReadyFile,
  getReadyFilePath,
  type LockContent,
} from "./lockfile.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lockfile-test-"));
  process.env.AE_CLAUDE_LOCK_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.AE_CLAUDE_LOCK_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const baseContent = (overrides: Partial<LockContent> = {}): LockContent => ({
  sidecarPid: 99999,
  aePid: 11111,
  port: 54321,
  startedAt: Date.now(),
  ...overrides,
});

describe("lockfile", () => {
  // ── 1 ────────────────────────────────────────────────────────────
  it("auto-creates lock directory if missing", async () => {
    const nestedTmp = path.join(tmpDir, "deep", "nested");
    process.env.AE_CLAUDE_LOCK_DIR = nestedTmp;

    // Directory doesn't exist yet.
    await expect(fs.access(nestedTmp)).rejects.toBeDefined();

    const content = baseContent();
    const lockPath = await acquireLock(content);

    expect(lockPath).toBe(getLockPath(content.aePid));
    expect(lockPath.startsWith(nestedTmp)).toBe(true);
    const written = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockContent;
    expect(written).toEqual(content);
  });

  // ── 2 ────────────────────────────────────────────────────────────
  it("detects stale lock (sidecar pid dead) and overwrites", async () => {
    // Plant a lock pointing to a definitely-dead PID.
    // Use 2147483646 (near INT32_MAX) — extremely unlikely to be a live PID
    // on any system. process.kill(huge, 0) → ESRCH on Win/Mac/Linux.
    const stale = baseContent({ sidecarPid: 2147483646, port: 11111 });
    await fs.mkdir(getLockDir(), { recursive: true });
    await fs.writeFile(getLockPath(stale.aePid), JSON.stringify(stale));

    const fresh = baseContent({ sidecarPid: process.pid, port: 22222 });
    const lockPath = await acquireLock(fresh);

    const written = JSON.parse(await fs.readFile(lockPath, "utf8")) as LockContent;
    expect(written.port).toBe(22222);
    expect(written.sidecarPid).toBe(process.pid);
  });

  // ── 3 ────────────────────────────────────────────────────────────
  it("refuses when alive sidecar holds the lock (AELockHeld)", async () => {
    // Plant a lock pointing to OUR PID — we are alive, so it should be refused.
    const alive = baseContent({ sidecarPid: process.pid });
    await fs.mkdir(getLockDir(), { recursive: true });
    await fs.writeFile(getLockPath(alive.aePid), JSON.stringify(alive));

    const newAttempt = baseContent({ sidecarPid: process.pid, port: 33333 });
    await expect(acquireLock(newAttempt)).rejects.toMatchObject({ code: "AELockHeld" });

    // Original lock untouched.
    const after = JSON.parse(await fs.readFile(getLockPath(alive.aePid), "utf8")) as LockContent;
    expect(after.port).toBe(alive.port);
  });

  // ── 4 ────────────────────────────────────────────────────────────
  it("race: parallel acquires for same aePid → exactly one succeeds", async () => {
    // Both attempts target the same aePid with different ports.
    const a = baseContent({ sidecarPid: process.pid, port: 44444 });
    const b = baseContent({ sidecarPid: process.pid, port: 55555 });

    // Run in parallel. fs.writeFile {flag:"wx"} guarantees only one creates the
    // file. The loser must throw (either AELockHeld on first wx fail or
    // AELockRaceLost on retry collision).
    const results = await Promise.allSettled([acquireLock(a), acquireLock(b)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(["AELockHeld", "AELockRaceLost"]).toContain(
      (rejection.reason as NodeJS.ErrnoException).code,
    );
  });

  // ── 6 (Phase 2.6 ready file fallback) ────────────────────────────
  it("ready file: write creates dir + JSON file, delete is idempotent", async () => {
    const aePid = 22222;
    const readyContent = { type: "ready", port: 12345, pid: process.pid, ts: Date.now() };

    await writeReadyFile(aePid, readyContent);
    const readyPath = getReadyFilePath(aePid);
    const written = JSON.parse(await fs.readFile(readyPath, "utf8"));
    expect(written).toEqual(readyContent);

    expect(await deleteReadyFile(aePid)).toBe(true);
    expect(await deleteReadyFile(aePid)).toBe(false);  // ENOENT swallowed
  });

  // ── 5 ────────────────────────────────────────────────────────────
  it("releaseLock: removes file, swallows ENOENT/EACCES (best-effort)", async () => {
    const content = baseContent({ sidecarPid: process.pid });
    await acquireLock(content);
    expect(await releaseLock(content.aePid)).toBe(true);

    // File is gone. Second release returns false (ENOENT swallowed).
    expect(await releaseLock(content.aePid)).toBe(false);

    // EACCES branch: spy on fs.unlink to simulate permission failure.
    await acquireLock(content);
    const unlinkSpy = vi.spyOn(fs, "unlink").mockRejectedValueOnce(
      Object.assign(new Error("perm"), { code: "EACCES" }),
    );
    expect(await releaseLock(content.aePid)).toBe(false);
    unlinkSpy.mockRestore();

    // Cleanup the real lock for hygiene.
    await releaseLock(content.aePid);
  });
});
