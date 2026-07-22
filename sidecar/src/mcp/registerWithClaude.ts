// registerWithClaude — 사이드카 부팅 시 ae-mcp stdio server를 claude CLI에 등록.
//
// Phase 4.2 (D-I + D-J):
//   - 사이드카가 ws port를 결정한 직후 (bridge.start() 후) 호출.
//   - 매 부팅마다 remove + add 패턴 (idempotent 가짜 보장):
//       1. `claude mcp remove ae-mcp` — 없으면 exit 1 + "No MCP server found"
//          (silent fail tolerance, 무시).
//       2. `claude mcp add ae-mcp -e AE_CLAUDE_WS_PORT=<port> -- node <abs path>`.
//   - claude CLI 부재 (ENOENT) → 사이드카 부팅 계속 + 구조화 로그
//     `mcp:register:claude-not-found`. Phase 4.3 PTY 교체 시 명확한 에러.
//   - --scope local (default) 사용. 등록은 cwd의 project key에 묶임 — 사용자
//     는 같은 cwd에서 claude를 실행해야 ae-mcp 보임. cwd는 호출자 결정.
//
// runCommand DI: 단위 테스트는 mock runCommand 주입. 프로덕션은 node:child_process
// spawn (shell:false — claude.exe는 .exe 진짜 바이너리, 점검 1에서 검증됨).

import { spawn } from "node:child_process";

const CLAUDE_BIN = "claude";
const MCP_NAME = "ae-mcp";

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the invocation was killed by the RUN_COMMAND_TIMEOUT_MS cap.
   *  A timed-out `remove` means claude itself is wedged (auth/config lock),
   *  so the caller skips `add` instead of burning a second timeout. */
  timedOut?: boolean;
}

/** Spawn a command and capture stdout/stderr/exit. ENOENT (binary missing)
 *  rejects with the underlying spawn error so callers can detect missing
 *  CLI separately from non-zero exit. */
export type RunCommand = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<RunCommandResult>;

export type LogEvent =
  | { event: "mcp:register:start"; port: number; cwd: string; spawnCommand: string; spawnArgs: string[] }
  | { event: "mcp:register:remove-result"; exitCode: number }
  | { event: "mcp:register:add-result"; exitCode: number; stderr: string }
  | { event: "mcp:register:success" }
  | { event: "mcp:register:claude-not-found" }
  | { event: "mcp:register:add-failed"; stderr: string }
  | { event: "mcp:register:timeout"; step: "remove" | "add" }
  | { event: "mcp:register:unexpected"; message: string };

export interface RegisterMcpOptions {
  /** Sidecar ws port to embed as AE_CLAUDE_WS_PORT env on the registered entry. */
  port: number;
  /** Command claude CLI will spawn for the MCP server (e.g. "node"). Phase
   *  4.4 fix-2 (mistakes #14 Aspect B): replaces the older serverEntryPath
   *  field so dev (tsx) and prod (dist) modes can pass distinct shapes:
   *    dev  → cmd="node",  args=[<tsx_cli_abs>, <src/mcp/server.ts_abs>]
   *    prod → cmd="node",  args=[<dist/mcp/server.js_abs>]
   *  Mirrors the sidecar's own factories.ts SIDECAR_CMD/SIDECAR_ARGS pair. */
  spawnCommand: string;
  /** Args after spawnCommand. See spawnCommand jsdoc for dev/prod shapes. */
  spawnArgs: string[];
  /** Working directory for the `claude mcp add` invocation. The `--scope local`
   *  (default) entry is keyed by this cwd, so it must match the cwd the user
   *  later runs `claude` from (typically the panel project root, currently
   *  realized as the sidecar spawn cwd per Phase 2.8.4 fix-1 / 함정 #7). */
  cwd: string;
  /** DI for tests. */
  runCommand?: RunCommand;
  /** Structured-log emitter. Default no-op so the helper is dependency-free. */
  logger?: (event: LogEvent) => void;
}

export interface RegisterMcpResult {
  ok: boolean;
  /** Why the registration didn't complete. Absent on success. */
  reason?: "claude-not-found" | "add-failed" | "timeout" | "unexpected";
}

export async function registerMcpWithClaude(
  opts: RegisterMcpOptions,
): Promise<RegisterMcpResult> {
  const log = opts.logger ?? (() => {});
  const run = opts.runCommand ?? defaultRunCommand;

  log({
    event: "mcp:register:start",
    port: opts.port,
    cwd: opts.cwd,
    spawnCommand: opts.spawnCommand,
    spawnArgs: opts.spawnArgs,
  });

  // 1. silent remove (silent fail when entry doesn't exist — exit 1).
  let removeResult: RunCommandResult;
  try {
    removeResult = await run(CLAUDE_BIN, ["mcp", "remove", MCP_NAME], { cwd: opts.cwd });
  } catch (e) {
    if (isEnoent(e)) {
      log({ event: "mcp:register:claude-not-found" });
      return { ok: false, reason: "claude-not-found" };
    }
    log({ event: "mcp:register:unexpected", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: "unexpected" };
  }
  log({ event: "mcp:register:remove-result", exitCode: removeResult.exitCode });

  // A timed-out remove means claude is wedged (first-run prompt, config
  // lock) — the add would burn a second 15s timeout for nothing. Bail.
  if (removeResult.timedOut) {
    log({ event: "mcp:register:timeout", step: "remove" });
    return { ok: false, reason: "timeout" };
  }

  // 2. add. Args after `--` are passed to the spawned stdio server entry.
  // Shape: claude mcp add ae-mcp -e KEY=VAL -- <cmd> <...args>
  // dev (tsx) → node <tsx_cli> <src/mcp/server.ts>
  // prod      → node <dist/mcp/server.js>
  const addArgs = [
    "mcp", "add", MCP_NAME,
    "-e", `AE_CLAUDE_WS_PORT=${opts.port}`,
    "--", opts.spawnCommand, ...opts.spawnArgs,
  ];
  let addResult: RunCommandResult;
  try {
    addResult = await run(CLAUDE_BIN, addArgs, { cwd: opts.cwd });
  } catch (e) {
    if (isEnoent(e)) {
      // Edge case: claude was on PATH a moment ago for `remove` but vanished.
      log({ event: "mcp:register:claude-not-found" });
      return { ok: false, reason: "claude-not-found" };
    }
    log({ event: "mcp:register:unexpected", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: "unexpected" };
  }
  log({ event: "mcp:register:add-result", exitCode: addResult.exitCode, stderr: addResult.stderr });

  if (addResult.timedOut) {
    log({ event: "mcp:register:timeout", step: "add" });
    return { ok: false, reason: "timeout" };
  }
  if (addResult.exitCode !== 0) {
    log({ event: "mcp:register:add-failed", stderr: addResult.stderr });
    return { ok: false, reason: "add-failed" };
  }

  log({ event: "mcp:register:success" });
  return { ok: true };
}

function isEnoent(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  // ENOENT = binary missing. EINVAL = Node 20.12+ refuses to spawn a `.cmd`
  // shim without shell:true (CVE-2024-27980); an npm-installed `claude.cmd`
  // hits this. Both mean "claude not runnable as spawned" → surface the same
  // install/setup UX rather than an opaque "unexpected".
  return code === "ENOENT" || code === "EINVAL";
}

// Hard cap for a single `claude mcp` invocation. Without this, a claude that
// blocks on stdin (first-run trust prompt, config lock, auth wait) would hang
// the boot-time `await registerMcpWithClaude(...)` forever — and because the
// sidecar wires its signal handlers / watchdog / pty.onExit AFTER that await,
// a hang there would leave the whole sidecar unshutdownable. stdin is set to
// "ignore" so any prompt reads EOF immediately instead of waiting.
const RUN_COMMAND_TIMEOUT_MS = 15_000;

/** Tree-kill a timed-out `claude mcp` child. plain child.kill("SIGKILL")
 *  reaps only the direct process — a wedged claude's own children (auth
 *  helper, node subprocess) would orphan. Windows: taskkill /F /T,
 *  detached+unref (same rationale as PtyHost.osTreeKill, mistakes #25 —
 *  must not depend on this process staying alive). POSIX: SIGKILL the
 *  child directly (no detached group here; claude rarely nests on POSIX). */
function treeKillChild(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }): void {
  const pid = child.pid;
  if (process.platform === "win32" && pid !== undefined) {
    try {
      const tk = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
        detached: true,
      });
      tk.unref();
      tk.on("error", () => { /* already dead / taskkill missing */ });
      return;
    } catch { /* fall through to plain kill */ }
  }
  try { child.kill("SIGKILL"); } catch { /* best-effort */ }
}

const defaultRunCommand: RunCommand = (cmd, args, { cwd }) => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],   // stdin ignored → no prompt hang
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      treeKillChild(child);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + "\n[timed out after " + RUN_COMMAND_TIMEOUT_MS + "ms]",
        timedOut: true,
      });
    }, RUN_COMMAND_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => {   // ENOENT / EINVAL land here
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // code === null means killed by signal — that is NOT success. `?? 0`
      // here would report ok:true for an externally-killed `claude mcp add`.
      resolve({ exitCode: code ?? (signal ? -1 : 0), stdout, stderr });
    });
  });
};
