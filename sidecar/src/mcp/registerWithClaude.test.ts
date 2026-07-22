// registerWithClaude unit tests — mock RunCommand DI.
//
// Covers:
//   - happy path: remove (exit 0 or 1 silent) + add (exit 0) → ok
//   - remove silent fail (exit 1, "no MCP server found") + add success
//   - claude CLI 부재 (ENOENT throw on first call) → ok=false claude-not-found
//   - add fail (exit 1) → ok=false add-failed
//   - 명령 형식 검증: claude mcp remove ae-mcp / claude mcp add ae-mcp -e <env> -- node <path>
//   - unexpected throw (non-ENOENT) → ok=false unexpected

import { describe, it, expect, vi } from "vitest";
import {
  registerMcpWithClaude,
  type LogEvent,
  type RunCommand,
  type RunCommandResult,
} from "./registerWithClaude.js";

function makeRunner(impl: (cmd: string, args: string[]) => RunCommandResult | Promise<RunCommandResult> | Error): {
  run: RunCommand;
  calls: Array<{ cmd: string; args: string[]; cwd: string }>;
} {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const run: RunCommand = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const result = impl(cmd, args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { run, calls };
}

const PROD_ENTRY = "C:/abs/path/sidecar/dist/mcp/server.js";
const CWD = "C:/Users/user/Desktop/proj";
const PROD_SPAWN = { spawnCommand: "node", spawnArgs: [PROD_ENTRY] };

describe("registerMcpWithClaude", () => {
  it("happy path (prod mode): remove (exit 0) + add (exit 0) → ok=true + logs success", async () => {
    const { run, calls } = makeRunner((_cmd, args) => {
      if (args[1] === "remove") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[1] === "add") return { exitCode: 0, stdout: "Added stdio MCP server", stderr: "" };
      return { exitCode: 99, stdout: "", stderr: "unexpected" };
    });
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 12345, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      cmd: "claude", args: ["mcp", "remove", "ae-mcp"], cwd: CWD,
    });
    expect(calls[1]).toEqual({
      cmd: "claude",
      args: ["mcp", "add", "ae-mcp", "-e", "AE_CLAUDE_WS_PORT=12345", "--", "node", PROD_ENTRY],
      cwd: CWD,
    });
    const events = log.mock.calls.map((c) => c[0].event);
    expect(events).toContain("mcp:register:start");
    expect(events).toContain("mcp:register:success");
  });

  // Phase 4.4 fix-2 (mistakes #14 Aspect B) — dev mode passes a multi-arg
  // spawn shape (node + tsx_cli + src/mcp/server.ts) so claude can spawn the
  // MCP entry without requiring a sidecar dist build.
  it("happy path (dev/tsx mode): multi-arg spawn shape forwarded verbatim", async () => {
    const { run, calls } = makeRunner((_cmd, args) => {
      if (args[1] === "remove") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[1] === "add") return { exitCode: 0, stdout: "Added", stderr: "" };
      return { exitCode: 99, stdout: "", stderr: "" };
    });
    const TSX_CLI = "C:/abs/sidecar/node_modules/tsx/dist/cli.mjs";
    const SRC_ENTRY = "C:/abs/sidecar/src/mcp/server.ts";

    const result = await registerMcpWithClaude({
      port: 9000,
      spawnCommand: "node",
      spawnArgs: [TSX_CLI, SRC_ENTRY],
      cwd: CWD,
      runCommand: run,
    });

    expect(result).toEqual({ ok: true });
    expect(calls[1]).toEqual({
      cmd: "claude",
      args: [
        "mcp", "add", "ae-mcp",
        "-e", "AE_CLAUDE_WS_PORT=9000",
        "--", "node", TSX_CLI, SRC_ENTRY,
      ],
      cwd: CWD,
    });
  });

  it("remove silent fail (exit 1) + add success → ok=true (idempotent guarantee)", async () => {
    const { run } = makeRunner((_cmd, args) => {
      if (args[1] === "remove") return { exitCode: 1, stdout: "", stderr: "No MCP server found with name: \"ae-mcp\"" };
      if (args[1] === "add") return { exitCode: 0, stdout: "Added", stderr: "" };
      return { exitCode: 99, stdout: "", stderr: "" };
    });
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: true });
    // remove exit 1 logged (informational), add succeeded → success.
    const removeEvent = log.mock.calls.find((c) => c[0].event === "mcp:register:remove-result");
    expect(removeEvent?.[0]).toMatchObject({ event: "mcp:register:remove-result", exitCode: 1 });
  });

  it("claude not found (ENOENT throw on remove) → ok=false claude-not-found", async () => {
    const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    const { run, calls } = makeRunner(() => enoent);
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: false, reason: "claude-not-found" });
    expect(calls).toHaveLength(1);   // didn't try `add` after ENOENT
    const events = log.mock.calls.map((c) => c[0].event);
    expect(events).toContain("mcp:register:claude-not-found");
    expect(events).not.toContain("mcp:register:success");
  });

  it("claude as .cmd shim (EINVAL throw, Node 20.12+ CVE-2024-27980) → claude-not-found", async () => {
    // npm-installed `claude.cmd` refuses to spawn without shell:true and throws
    // EINVAL (not ENOENT). Must map to the same install-hint UX, not "unexpected".
    const einval = Object.assign(new Error("spawn claude EINVAL"), { code: "EINVAL" });
    const { run } = makeRunner(() => einval);
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: false, reason: "claude-not-found" });
    const events = log.mock.calls.map((c) => c[0].event);
    expect(events).toContain("mcp:register:claude-not-found");
  });

  it("add fail (exit 1) → ok=false add-failed + stderr surfaced in log", async () => {
    const { run } = makeRunner((_cmd, args) => {
      if (args[1] === "remove") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[1] === "add") return { exitCode: 1, stdout: "", stderr: "Some claude config error" };
      return { exitCode: 99, stdout: "", stderr: "" };
    });
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: false, reason: "add-failed" });
    const failEvent = log.mock.calls.find((c) => c[0].event === "mcp:register:add-failed");
    expect(failEvent?.[0]).toMatchObject({ event: "mcp:register:add-failed", stderr: "Some claude config error" });
  });

  it("unexpected throw (non-ENOENT) → ok=false unexpected + log message", async () => {
    const { run } = makeRunner(() => new Error("EACCES — permission denied"));
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: false, reason: "unexpected" });
    const unexpectedEvent = log.mock.calls.find((c) => c[0].event === "mcp:register:unexpected");
    expect(unexpectedEvent?.[0]).toMatchObject({ event: "mcp:register:unexpected", message: expect.stringContaining("EACCES") });
  });

  it("ENOENT on add (rare race: claude vanished between remove and add) → claude-not-found", async () => {
    const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    const { run } = makeRunner((_cmd, args) => {
      if (args[1] === "remove") return { exitCode: 1, stdout: "", stderr: "No MCP server found" };
      if (args[1] === "add") return enoent;
      return { exitCode: 99, stdout: "", stderr: "" };
    });
    const log = vi.fn<(e: LogEvent) => void>();

    const result = await registerMcpWithClaude({
      port: 7000, ...PROD_SPAWN, cwd: CWD, runCommand: run, logger: log,
    });

    expect(result).toEqual({ ok: false, reason: "claude-not-found" });
    const notFoundEvents = log.mock.calls.filter((c) => c[0].event === "mcp:register:claude-not-found");
    expect(notFoundEvents).toHaveLength(1);
  });
});
