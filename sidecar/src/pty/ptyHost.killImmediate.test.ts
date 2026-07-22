// mistakes #25 — killImmediate()'s taskkill helper MUST be spawned
// detached + unref'd. The lock-held abort path (index.ts) calls
// process.exit(2) synchronously right after killImmediate(); a
// non-detached child sits in libuv's kill-on-job-close job object and is
// terminated WITH this process — before it can reap the claude tree —
// silently re-creating the exact zombie the abort path exists to prevent.
// Pre-fix this shipped with detached:false and passed every test because
// no test asserted the spawn options.
//
// Windows-only: the POSIX branch uses process.kill(-pid) directly.

import { describe, it, expect, vi } from "vitest";

const spawnCalls: Array<{ cmd: string; args: string[]; opts: Record<string, unknown> }> = [];
const fakeChild = {
  unref: vi.fn(),
  kill: vi.fn(),
  once: vi.fn(),
  on: vi.fn(),
};

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
      spawnCalls.push({ cmd, args, opts });
      return fakeChild;
    },
  };
});

import { PtyHost } from "./ptyHost.js";

const isWin = process.platform === "win32";

describe("PtyHost.killImmediate — taskkill spawn options (mistakes #25)", () => {
  it.runIf(isWin)(
    "spawns taskkill /F /T detached:true and unrefs it (survives parent process.exit)",
    async () => {
      const pty = new PtyHost({ cmd: "cmd.exe", args: [], cols: 80, rows: 24 });
      const pid = pty.pid;
      expect(pid).toBeDefined();
      expect(pty.alive).toBe(true);

      pty.killImmediate();

      const tkCall = spawnCalls.find((c) => c.cmd === "taskkill");
      expect(tkCall).toBeDefined();
      expect(tkCall!.args).toEqual(["/F", "/T", "/PID", String(pid)]);
      // The two properties that make the helper survive our process.exit:
      expect(tkCall!.opts.detached).toBe(true);
      expect(fakeChild.unref).toHaveBeenCalled();

      expect(pty.alive).toBe(false);
      // taskkill was mocked away, so reap the real cmd.exe via node-pty's
      // own kill (best-effort; process exit covers the rest, same policy as
      // the smoke test).
      pty.kill().catch(() => { /* best-effort cleanup */ });
    },
    30_000,
  );
});
