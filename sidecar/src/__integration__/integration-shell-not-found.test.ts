// Phase 4.3 integration — sidecar boots successfully even when the
// configured shell binary is missing from PATH. The bridge surfaces the
// failure via `initialServerError` so the panel sees an actionable
// AEShellNotFoundError message instead of a launcher onCrash.
//
// This complements the unit-level scenario 22 in panelBridge.test.ts
// (bridge wiring) by verifying the end-to-end path: real PtyHost spawn
// → ENOENT caught in main() → dummy PtyLike fallback → bridge emits
// initialServerError on connect.

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { spawnSidecar, type SpawnedSidecar } from "./spawn-helper.js";
import type { Msg } from "../protocol.js";

const NONEXISTENT_SHELL = "nonexistent-bin-xyz-12345";
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

async function nextMessage(ws: Ws, predicate: (m: Msg) => boolean, timeoutMs = 3_000): Promise<Msg> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = ws.__queue.findIndex(predicate);
    if (idx >= 0) {
      const [msg] = ws.__queue.splice(idx, 1);
      return msg!;
    }
    await delay(20);
  }
  throw new Error("nextMessage timeout");
}

describe("integration shell-not-found (Phase 4.3)", () => {
  let sidecar: SpawnedSidecar | undefined;

  afterEach(async () => {
    if (sidecar) {
      try { await sidecar.kill(); } catch { /* */ }
      sidecar = undefined;
    }
  });

  it("invalid AE_CLAUDE_SHELL → sidecar boots + server.error AEShellNotFoundError on connect", async () => {
    sidecar = await spawnSidecar({
      env: { AE_CLAUDE_SHELL: NONEXISTENT_SHELL },
    });
    expect(typeof sidecar.port).toBe("number");
    expect(sidecar.port).toBeGreaterThan(0);

    const ws = await openWs(`ws://127.0.0.1:${sidecar.port}/`);
    await nextMessage(ws, (m) => m.type === "sys.version");

    const err = await nextMessage(ws, (m) => m.type === "server.error");
    expect(err).toMatchObject({
      type: "server.error",
      code: "AEShellNotFoundError",
    });
    if (err.type === "server.error") {
      expect(err.userMessage).toContain(NONEXISTENT_SHELL);
    }
    ws.close();
  });

  // Phase 4.3 hotfix (mistakes #13) — the original integration test only
  // verified ready JSON + sys.version + server.error, all of which arrive
  // before main()'s `pty.onExit(...)` call near the end of boot. A type
  // mismatch on PtyLike (Trap A) would still let the sidecar emit those
  // messages and then fatal-exit a few ms later, leaving the test green
  // but production broken. This second scenario verifies the sidecar is
  // still alive after the boot sequence completes.
  it("invalid AE_CLAUDE_SHELL → sidecar stays alive past boot (no late fatal)", async () => {
    sidecar = await spawnSidecar({
      env: { AE_CLAUDE_SHELL: NONEXISTENT_SHELL },
    });

    const ws = await openWs(`ws://127.0.0.1:${sidecar.port}/`);
    await nextMessage(ws, (m) => m.type === "sys.version");
    await nextMessage(ws, (m) => m.type === "server.error");

    // Wait past the entire main() body (PtyHost catch → bridge.start →
    // ready JSON → mcp register → watchdog → pty.onExit hook). On a clean
    // boot all of this completes within ~1s. If main() throws after ready
    // JSON (the Trap A failure mode), the sidecar process exits and the
    // ws connection is closed by the OS within roughly the same window.
    await new Promise((r) => setTimeout(r, 1500));

    expect(ws.readyState).toBe(1 /* OPEN */);
    // Send a heartbeat round-trip to confirm the sidecar is actively
    // responding, not just lingering in TIME_WAIT.
    ws.send(JSON.stringify({ type: "sys.heartbeat", ts: Date.now() }));
    // No assertion on the heartbeat reply — sidecar broadcasts its own
    // heartbeat on a 10s cadence; we only need to know our send didn't
    // EPIPE / ECONNRESET. Peek the queue once more.
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).toBe(1);

    ws.close();
  });
});
