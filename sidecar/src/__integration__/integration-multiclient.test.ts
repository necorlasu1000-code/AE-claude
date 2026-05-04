// Phase 2.5.3 — multi-client integration scenario 5.
//
// Real sidecar + 2 real WS clients. Validates the primary-only write policy
// (panelBridge.ts) end-to-end and the demote/promote behavior on disconnect:
//
//   a-connect → a-greeting → b-connect → b-greeting →
//   b-pty-in-refused → b-resize-refused → b-exec-refused →
//   broadcast-to-b (B receives A's pty.out output, read-only path) →
//   a-close → b-write-after-promote (B becomes primary, write goes through)
//
// Stage labels in the failure message identify which boundary broke.

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { spawnIsolatedSidecar, type SpawnedSidecar } from "./spawn-helper.js";
import type { Msg } from "../protocol.js";

// ─── per-test isolation ────────────────────────────────────────────

let sidecar: SpawnedSidecar | undefined;
let lockDir: string;
let wsA: Ws | undefined;
let wsB: Ws | undefined;

beforeEach(async () => {
  lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-int-multi-"));
});

afterEach(async (ctx) => {
  if (wsA) { try { wsA.close(); } catch { /* */ } }
  if (wsB) { try { wsB.close(); } catch { /* */ } }
  if (sidecar) {
    if (ctx.task.result?.state === "fail") {
      console.error(`=== sidecar stderr (last 50 lines) ===\n${sidecar.stderr.slice(-50).join("\n")}\n=== end stderr ===`);
    }
    await sidecar.kill().catch(() => { /* best-effort */ });
    sidecar = undefined;
  }
  wsA = undefined;
  wsB = undefined;
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
});

// ─── WS helpers ────────────────────────────────────────────────────

type Ws = WebSocket & { __queue: Msg[] };

async function openWs(url: string): Promise<Ws> {
  const ws = new WebSocket(url) as Ws;
  ws.__queue = [];
  ws.on("message", (raw: WebSocket.RawData) => {
    try { ws.__queue.push(JSON.parse(raw.toString()) as Msg); } catch { /* */ }
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

/** Drop all pty.out messages currently queued. Used to ignore prompt noise. */
function drainPtyOut(ws: Ws) {
  ws.__queue = ws.__queue.filter((m) => m.type !== "pty.out");
}

/** Read pty.out chunks until `text` appears in cumulative output, or timeout. */
async function waitForPtyText(ws: Ws, text: string, timeoutMs: number): Promise<{ found: boolean; accumulated: string }> {
  let acc = "";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const m = await nextMessage(ws, (x) => x.type === "pty.out", 1_000);
      if (m.type === "pty.out") {
        acc += m.data;
        if (acc.includes(text)) return { found: true, accumulated: acc };
      }
    } catch { /* sub-timeout, keep iterating until total budget done */ }
  }
  return { found: false, accumulated: acc };
}

// ─── Suite ─────────────────────────────────────────────────────────

describe("integration multi-client (Phase 2.5.3)", () => {
  it("scenario 5: secondary write refused, broadcast delivered, promotes on primary disconnect", async () => {
    let stage = "boot";
    try {
      sidecar = await spawnIsolatedSidecar(lockDir);

      stage = "a-connect";
      wsA = await openWs(`ws://127.0.0.1:${sidecar.port}`);
      stage = "a-greeting";
      await nextMessage(wsA, (m) => m.type === "sys.version", 5_000);

      stage = "b-connect";
      wsB = await openWs(`ws://127.0.0.1:${sidecar.port}`);
      stage = "b-greeting";
      await nextMessage(wsB, (m) => m.type === "sys.version", 5_000);

      // ── B refused on three write-authority message types ──
      stage = "b-pty-in-refused";
      send(wsB, { type: "pty.in", data: "echo secondary\r" });
      const ref1 = await nextMessage(wsB, (m) => m.type === "server.error", 3_000);
      expect(ref1.type).toBe("server.error");
      if (ref1.type === "server.error") expect(ref1.code).toBe("AEMultiClientRefused");

      stage = "b-resize-refused";
      send(wsB, { type: "pty.resize", cols: 100, rows: 30 });
      const ref2 = await nextMessage(wsB, (m) => m.type === "server.error", 3_000);
      expect(ref2.type).toBe("server.error");
      if (ref2.type === "server.error") expect(ref2.code).toBe("AEMultiClientRefused");

      stage = "b-exec-refused";
      // exec returns ErrorMsg (has requestId), not server.error.
      send(wsB, { type: "exec", requestId: "r-b-1", tool: "stub", input: {} });
      const ref3 = await nextMessage(wsB, (m) => m.type === "error", 3_000);
      expect(ref3.type).toBe("error");
      if (ref3.type === "error") {
        expect(ref3.code).toBe("AEMultiClientRefused");
        expect(ref3.requestId).toBe("r-b-1");
      }

      // ── B still receives pty.out broadcasts (read-only path is open) ──
      stage = "broadcast-to-b";
      drainPtyOut(wsA);
      drainPtyOut(wsB);
      const broadcastMarker = "broadcast-marker-9bc7";
      send(wsA, { type: "pty.in", data: `echo ${broadcastMarker}\r` });
      const aSeen = await waitForPtyText(wsA, broadcastMarker, 8_000);
      const bSeen = await waitForPtyText(wsB, broadcastMarker, 8_000);
      if (!aSeen.found) {
        throw new Error(`A did not see broadcast marker. Acc last 200: ${JSON.stringify(aSeen.accumulated.slice(-200))}`);
      }
      if (!bSeen.found) {
        throw new Error(`B did not see broadcast marker (read-only broadcast failed). Acc last 200: ${JSON.stringify(bSeen.accumulated.slice(-200))}`);
      }

      // ── A closes, B promotes ──
      stage = "a-close";
      wsA.close();
      // Allow server to process the close event (primary slot promotion).
      // panelBridge.handleConnection's ws.on("close") is synchronous-ish but
      // runs after the WS protocol close handshake completes.
      await delay(300);

      // ── B writes after promotion ──
      stage = "b-write-after-promote";
      drainPtyOut(wsB);
      const promoteMarker = "promoted-marker-3f1d";
      send(wsB, { type: "pty.in", data: `echo ${promoteMarker}\r` });
      const result = await waitForPtyText(wsB, promoteMarker, 8_000);
      if (!result.found) {
        throw new Error(
          `B post-promotion write was not echoed back. The promotion may not have happened.\n` +
          `  B queue depth at end: ${wsB.__queue.length}\n` +
          `  B last 200 chars: ${JSON.stringify(result.accumulated.slice(-200))}`,
        );
      }
      // No refusal envelope received.
      const refusalAfterPromote = wsB.__queue.find((m) => m.type === "server.error" || (m.type === "error" && (m as { code?: string }).code === "AEMultiClientRefused"));
      expect(refusalAfterPromote).toBeUndefined();
    } catch (e) {
      throw new Error(
        `Scenario 5 failed at stage='${stage}'.\n` +
        `  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 40_000);
});
