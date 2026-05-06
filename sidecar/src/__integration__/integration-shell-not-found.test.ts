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
});
