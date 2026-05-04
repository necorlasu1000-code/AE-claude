// Phase 2.5.1 — basic integration scenarios.
//
// Spawns a real sidecar process (tsx) and verifies:
//   #1: ready JSON on stdout has valid port + pid + dev-mode aePid=null
//   #2: WS client connects and receives sys.version greeting
//   #3: PTY ASCII echo round-trips through sidecar (pty.in → pty.out)
//
// Failure messages explicitly identify which stage broke (boot / WS / PTY).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { spawnIsolatedSidecar, type SpawnedSidecar } from "./spawn-helper.js";
import type { Msg } from "../protocol.js";

// ─── per-test isolation ────────────────────────────────────────────

let sidecar: SpawnedSidecar | undefined;
let lockDir: string;

beforeEach(async () => {
  lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-int-basic-"));
});

afterEach(async (ctx) => {
  if (sidecar) {
    if (ctx.task.result?.state === "fail") {
      console.error(
        `=== sidecar stderr (last 50 lines) ===\n${sidecar.stderr.slice(-50).join("\n")}\n=== end stderr ===`,
      );
    }
    await sidecar.kill().catch(() => { /* best-effort */ });
    sidecar = undefined;
  }
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
});

// ─── WS client helpers (same pattern as panelBridge.test.ts) ───────

type Ws = WebSocket & { __queue: Msg[] };

async function openWs(url: string): Promise<Ws> {
  const ws = new WebSocket(url) as Ws;
  ws.__queue = [];
  ws.on("message", (raw: WebSocket.RawData) => {
    try { ws.__queue.push(JSON.parse(raw.toString()) as Msg); } catch { /* skip */ }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nextMessage(ws: Ws, predicate?: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = ws.__queue.findIndex((m) => !predicate || predicate(m));
    if (idx >= 0) return ws.__queue.splice(idx, 1)[0] as Msg;
    await delay(20);
  }
  throw new Error("timeout waiting for message" + (predicate ? " matching predicate" : ""));
}

function send(ws: WebSocket, msg: Msg) { ws.send(JSON.stringify(msg)); }

// ─── Suite ─────────────────────────────────────────────────────────

describe("integration basic (Phase 2.5.1)", () => {
  // ── 1 ────────────────────────────────────────────────────────────
  it("scenario 1: spawn → ready JSON has valid port + pid + dev-mode aePid=null", async () => {
    sidecar = await spawnIsolatedSidecar(lockDir);
    expect(sidecar.port).toBeGreaterThan(0);
    expect(sidecar.port).toBeLessThan(65536);
    expect(sidecar.pid).toBeGreaterThan(0);
    // Dev mode: no AE_CLAUDE_AE_PID → no parent supervision → aePid=null in ready JSON
    expect(sidecar.aePid).toBeNull();
  }, 20_000);

  // ── 2 ────────────────────────────────────────────────────────────
  it("scenario 2: WS connect → sys.version greeting received", async () => {
    sidecar = await spawnIsolatedSidecar(lockDir);
    const url = `ws://127.0.0.1:${sidecar.port}`;
    const ws = await openWs(url);
    const msg = await nextMessage(ws, (m) => m.type === "sys.version", 5_000);
    expect(msg.type).toBe("sys.version");
    if (msg.type === "sys.version") {
      expect(msg.protocolVersion).toBe(1);
      expect(msg.sidecarVersion).toMatch(/^\d+\.\d+\.\d+/);
    }
    ws.close();
  }, 20_000);

  // ── 3 ────────────────────────────────────────────────────────────
  it("scenario 3: PTY ASCII echo round-trip (pty.in 'echo hello\\r' → pty.out 'hello' x2)", async () => {
    // Stage labels are echoed in the failure message so we can tell which
    // boundary broke: sidecar boot, WS handshake, or PTY data flow.
    let stage: string = "boot";
    try {
      sidecar = await spawnIsolatedSidecar(lockDir);
      stage = "ws-connect";
      const ws = await openWs(`ws://127.0.0.1:${sidecar.port}`);
      stage = "ws-greeting";
      await nextMessage(ws, (m) => m.type === "sys.version", 5_000);
      stage = "pty-send";
      send(ws, { type: "pty.in", data: "echo hello\r" });

      stage = "pty-collect";
      let combined = "";
      const collectStart = Date.now();
      while (Date.now() - collectStart < 15_000) {
        const m = await nextMessage(ws, (x) => x.type === "pty.out", 16_000);
        if (m.type === "pty.out") {
          combined += m.data;
          const hits = (combined.match(/hello/g) || []).length;
          if (hits >= 2) {
            ws.close();
            return; // success: command echo + output result
          }
        }
      }

      throw new Error(
        `PTY echo did not complete within 15s.\n` +
        `  Stages reached: boot ✓ → ws-connect ✓ → ws-greeting ✓ → pty-send ✓ → pty-collect timeout\n` +
        `  hello count: ${(combined.match(/hello/g) || []).length} (expected ≥2)\n` +
        `  Last 200 chars: ${JSON.stringify(combined.slice(-200))}`,
      );
    } catch (e) {
      throw new Error(
        `Scenario 3 failed at stage='${stage}'.\n` +
        `  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 25_000);
});
