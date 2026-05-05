// SidecarLauncher unit tests — mocked spawn + readReadyFile.
// Validates option E (stdout) primary, option B (file polling) fallback,
// timeout, crash detection, and graceful stop semantics.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { SidecarLauncher, sendShutdownOverWs, type LauncherDeps } from "./launcher.js";

// ─── Mock factories ────────────────────────────────────────────────

interface MockProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  pid: number | undefined;
  kill: (sig?: string) => boolean;
}

function makeMockProc(opts: { pid?: number } = {}): MockProc {
  const emitter = new EventEmitter() as MockProc;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.exitCode = null;
  emitter.pid = opts.pid ?? 12345;
  emitter.kill = vi.fn((_sig?: string) => {
    emitter.exitCode = 0;
    setImmediate(() => emitter.emit("exit", 0, null));
    return true;
  });
  return emitter;
}

function makeDeps(overrides: Partial<LauncherDeps> = {}): {
  deps: LauncherDeps;
  spawnSpy: ReturnType<typeof vi.fn>;
  readReadyFileMock: ReturnType<typeof vi.fn>;
  lastProc: { current: MockProc | undefined };
} {
  const lastProc: { current: MockProc | undefined } = { current: undefined };
  const spawnSpy = vi.fn((_cmd: string, _args: readonly string[], _opts: any) => {
    const p = makeMockProc();
    lastProc.current = p;
    return p as unknown as ChildProcess;
  });
  const readReadyFileMock = vi.fn(async (_p: string) => {
    const e = new Error("ENOENT") as NodeJS.ErrnoException;
    e.code = "ENOENT";
    throw e;
  });
  const deps: LauncherDeps = {
    spawn: spawnSpy as any,
    readReadyFile: readReadyFileMock as any,
    homedir: () => "/home/test",
    pathJoin: (...parts: string[]) => parts.join("/"),
    env: { PATH: "/usr/bin" },
    ...overrides,
  };
  return { deps, spawnSpy, readReadyFileMock, lastProc };
}

const READY_JSON = {
  type: "ready",
  port: 54321,
  host: "127.0.0.1",
  pid: 99999,
  version: "0.1.0",
  protocolVersion: 1,
  ts: Date.now(),
  aePid: 11111,
};

// ─── Suite ─────────────────────────────────────────────────────────

describe("SidecarLauncher", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── 1 ────────────────────────────────────────────────────────────
  it("start: stdout ready JSON resolves with port + sidecarPid", async () => {
    const { deps, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ aePid: 11111 }, deps);

    const startPromise = launcher.start();
    // simulate sidecar emitting ready JSON on stdout next tick
    setImmediate(() => {
      lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n");
    });

    const ready = await startPromise;
    expect(ready.port).toBe(54321);
    expect(ready.sidecarPid).toBe(99999);
    expect(ready.host).toBe("127.0.0.1");
    expect(ready.protocolVersion).toBe(1);
  });

  // ── 2 ────────────────────────────────────────────────────────────
  it("start: spawn invoked with AE_CLAUDE_AE_PID + AE_CLAUDE_LOCK_DIR env", async () => {
    const { deps, spawnSpy, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ aePid: 22222, lockDir: "/tmp/locks", debug: true }, deps);

    setImmediate(() => lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n"));
    await launcher.start();

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [, , spawnOpts] = spawnSpy.mock.calls[0]!;
    expect((spawnOpts as any).env.AE_CLAUDE_AE_PID).toBe("22222");
    expect((spawnOpts as any).env.AE_CLAUDE_LOCK_DIR).toBe("/tmp/locks");
    expect((spawnOpts as any).env.AE_CLAUDE_DEBUG).toBe("1");
    expect((spawnOpts as any).shell).toBe(true);
  });

  // ── 3 ────────────────────────────────────────────────────────────
  it("start: file fallback wins when stdout doesn't deliver ready", async () => {
    const { deps, readReadyFileMock } = makeDeps();
    // After 2 ENOENT polls, file is "found" with READY_JSON.
    readReadyFileMock.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
                    .mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
                    .mockResolvedValueOnce(JSON.stringify(READY_JSON));

    const launcher = new SidecarLauncher(
      { aePid: 11111, readyFilePollMs: 10, spawnTimeoutMs: 2_000 },
      deps,
    );
    // Don't emit anything on stdout — only file path can resolve.
    const ready = await launcher.start();
    expect(ready.port).toBe(54321);
    expect(readReadyFileMock).toHaveBeenCalled();
  });

  // ── 4 ────────────────────────────────────────────────────────────
  it("start: timeout when neither stdout nor file deliver ready", async () => {
    const { deps, lastProc } = makeDeps();
    const launcher = new SidecarLauncher(
      { aePid: 11111, spawnTimeoutMs: 200, readyFilePollMs: 50 },
      deps,
    );
    // Emit some stderr noise so timeout error includes context.
    setImmediate(() => lastProc.current!.stderr.emit("data", "boot error: missing flag\n"));

    await expect(launcher.start()).rejects.toThrow(/Sidecar spawn timeout/);
  });

  // ── 5 ────────────────────────────────────────────────────────────
  it("start: malformed ready JSON rejects with helpful message", async () => {
    const { deps, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ aePid: 11111, spawnTimeoutMs: 1_000 }, deps);

    const promise = launcher.start();
    setImmediate(() => lastProc.current!.stdout.emit("data", "not-json-at-all\n"));

    await expect(promise).rejects.toThrow(/malformed ready JSON/);
  });

  // ── 6 ────────────────────────────────────────────────────────────
  it("crash detection: process exits before stop() → onCrash fires with stderr", async () => {
    const { deps, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ aePid: 11111 }, deps);
    const onCrash = vi.fn();
    launcher.onCrash(onCrash);

    setImmediate(() => lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n"));
    await launcher.start();

    // Now simulate sidecar dying unexpectedly.
    lastProc.current!.stderr.emit("data", "panic: AE crashed\n");
    lastProc.current!.exitCode = 137;
    lastProc.current!.emit("exit", 137, "SIGKILL");

    // Allow microtask queue to flush the synchronous exit listener.
    await new Promise((r) => setImmediate(r));
    expect(onCrash).toHaveBeenCalledTimes(1);
    const info = onCrash.mock.calls[0]![0];
    expect(info.code).toBe(137);
    expect(info.signal).toBe("SIGKILL");
    expect(info.reason).toBe("exit");
    expect(info.stderr.join("\n")).toMatch(/panic: AE crashed/);
  });

  // ── 7 ────────────────────────────────────────────────────────────
  it("stop: waits for proc exit (caller is responsible for sys.shutdown)", async () => {
    const { deps, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ aePid: 11111 }, deps);

    setImmediate(() => lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n"));
    await launcher.start();

    const stopPromise = launcher.stop(2_000);

    // Caller would have already sent sys.shutdown over the long-lived PTY ws;
    // here we just simulate the resulting natural exit.
    setImmediate(() => {
      lastProc.current!.exitCode = 0;
      lastProc.current!.emit("exit", 0, null);
    });

    await stopPromise;
    // No unexpected SIGKILL on graceful path — kill spy untouched.
    expect((lastProc.current!.kill as any).mock.calls.length).toBe(0);
  });

  // ── 8: aePid optional → dev mode ─────────────────────────────────
  it("aePid omitted: AE_CLAUDE_AE_PID env not set (sidecar dev mode)", async () => {
    const { deps, spawnSpy, lastProc } = makeDeps();
    const launcher = new SidecarLauncher({ /* no aePid */ }, deps);

    setImmediate(() => lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n"));
    await launcher.start();

    const [, , spawnOpts] = spawnSpy.mock.calls[0]!;
    expect((spawnOpts as any).env).not.toHaveProperty("AE_CLAUDE_AE_PID");
    // LOCK_DIR still set (sidecar uses it as test-isolation hint, harmless in dev mode)
    expect((spawnOpts as any).env.AE_CLAUDE_LOCK_DIR).toBeDefined();
  });
});

// ─── sendShutdownOverWs helper ─────────────────────────────────────

describe("sendShutdownOverWs", () => {
  function makeMockWs() {
    const listeners: Record<string, ((ev: any) => void)[]> = {};
    return {
      readyState: 1,                                // WebSocket.OPEN (RFC 6455)
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: function(type: string, cb: (ev: any) => void) {
        (listeners[type] ??= []).push(cb);
      },
      removeEventListener: function(type: string, cb: (ev: any) => void) {
        const arr = listeners[type];
        if (arr) {
          const i = arr.indexOf(cb);
          if (i >= 0) arr.splice(i, 1);
        }
      },
      _fire: (type: string, ev: any) => {
        for (const cb of listeners[type] ?? []) cb(ev);
      },
    };
  }

  it("sends sys.shutdown immediately when ws OPEN, resolves on shutting-down ack", async () => {
    const ws = makeMockWs();
    const promise = sendShutdownOverWs(ws as any, "panel-close");

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ws.send.mock.calls[0]![0] as string)).toEqual({
      type: "sys.shutdown",
      reason: "panel-close",
    });

    ws._fire("message", { data: JSON.stringify({ type: "sys.shutting-down", ts: Date.now() }) });
    await promise;
    expect(ws.close).toHaveBeenCalled();
  });

  it("resolves on ack timeout if no shutting-down arrives", async () => {
    const ws = makeMockWs();
    await sendShutdownOverWs(ws as any, "no-ack-test", 50);
    expect(ws.send).toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalled();
  });
});
