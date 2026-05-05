// SidecarLauncher unit tests — mocked spawn + readReadyFile.
// Validates option E (stdout) primary, option B (file polling) fallback,
// timeout, crash detection, and graceful stop semantics.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { SidecarLauncher, type LauncherDeps } from "./launcher.js";

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
  it("stop: sends sys.shutdown over WS + waits for exit", async () => {
    const { deps, lastProc } = makeDeps();

    // Mock WebSocket: open immediately, ack on send, then wait for close.
    // Must be a `class` (or `function` keyword) — arrow functions don't have
    // [[Construct]] and `new MockWS(...)` would throw.
    const sentMessages: string[] = [];
    const mockWs = {
      send: vi.fn((data: string) => sentMessages.push(data)),
      close: vi.fn(),
      addEventListener: function(this: any, type: string, cb: any) {
        this[`_${type}`] = cb;
      },
    } as any;
    class MockWS {
      constructor(_url: string) { return mockWs as any; }
    }

    const launcher = new SidecarLauncher({ aePid: 11111 }, { ...deps, WebSocket: MockWS as any });

    setImmediate(() => lastProc.current!.stdout.emit("data", JSON.stringify(READY_JSON) + "\n"));
    await launcher.start();

    const stopPromise = launcher.stop(2_000);

    // Drive the mock WS lifecycle.
    await new Promise((r) => setImmediate(r));
    mockWs._open?.();   // open → launcher sends sys.shutdown
    expect(sentMessages.length).toBe(1);
    expect(JSON.parse(sentMessages[0]!)).toMatchObject({ type: "sys.shutdown" });

    mockWs._message?.({ data: JSON.stringify({ type: "sys.shutting-down", ts: Date.now() }) });

    // Now simulate sidecar exiting.
    lastProc.current!.exitCode = 0;
    lastProc.current!.emit("exit", 0, null);

    await stopPromise;
    expect(mockWs.close).toHaveBeenCalled();
  });
});
