// Phase 2.5.2 — encoding discovery (Korean PTY round-trip).
//
// Sends `echo 한글\r` through the sidecar PTY and observes what comes back.
// On failure, dumps:
//   - input UTF-8 hex
//   - response chunks count + total bytes
//   - last 300 chars as both string and UTF-8 hex
//   - last 80 code points (U+XXXX form)
//   - mojibake pattern detection (??/U+FFFD)
// This information drives the fix selection (fix candidates ranked in
// mistakes.md "Phase 2 후속 / 한글 인코딩 검증 필요").

import { describe, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Buffer } from "node:buffer";
import { WebSocket } from "ws";
import { spawnIsolatedSidecar, type SpawnedSidecar } from "./spawn-helper.js";
import type { Msg } from "../protocol.js";

let sidecar: SpawnedSidecar | undefined;
let lockDir: string;

beforeEach(async () => {
  lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-int-encoding-"));
});

afterEach(async (ctx) => {
  if (sidecar) {
    if (ctx.task.result?.state === "fail") {
      console.error(`=== sidecar stderr (last 50 lines) ===\n${sidecar.stderr.slice(-50).join("\n")}\n=== end stderr ===`);
    }
    await sidecar.kill().catch(() => { /* best-effort */ });
    sidecar = undefined;
  }
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
});

// ─── WS helpers (same pattern as integration-basic) ────────────────

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

// ─── Diagnostic formatters ─────────────────────────────────────────

function toUtf8Hex(s: string): string {
  return Buffer.from(s, "utf8").toString("hex");
}

function codePointsList(s: string): string {
  return Array.from(s).map((c) => {
    const cp = c.codePointAt(0) ?? 0;
    return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  }).join(" ");
}

// ─── Suite ─────────────────────────────────────────────────────────

describe("integration encoding (Phase 2.5.2)", () => {
  it("scenario 4: PTY Korean round-trip — 'echo 한글' should appear twice in output", async () => {
    let stage = "boot";
    try {
      sidecar = await spawnIsolatedSidecar(lockDir);
      stage = "ws-connect";
      const ws = await openWs(`ws://127.0.0.1:${sidecar.port}`);
      stage = "ws-greeting";
      await nextMessage(ws, (m) => m.type === "sys.version", 5_000);

      // Brief settle so the shell prompt is fully drawn before our input.
      // Without this, the prompt's ANSI cursor escapes can interleave with
      // the echoed input and confuse downstream diagnosis.
      await delay(200);

      stage = "pty-send";
      const input = "echo 한글\r";
      send(ws, { type: "pty.in", data: input });

      stage = "pty-collect";
      let combined = "";
      let chunkCount = 0;
      const collectStart = Date.now();
      const collectUntilMs = 10_000;

      while (Date.now() - collectStart < collectUntilMs) {
        try {
          const m = await nextMessage(ws, (x) => x.type === "pty.out", 2_000);
          if (m.type === "pty.out") {
            combined += m.data;
            chunkCount++;
            // Success criterion: '한글' appears at least twice (command echo + result).
            const hits = (combined.match(/한글/g) || []).length;
            if (hits >= 2) {
              ws.close();
              return;
            }
          }
        } catch {
          // 2s sub-timeout. Keep iterating until 10s total budget exhausted
          // OR break if no chunks arrived for a while.
          break;
        }
      }

      ws.close();

      // ─── DIAGNOSIS ───────────────────────────────────────────────
      const koreanHits = (combined.match(/한글/g) || []).length;
      const replacementChar = (combined.match(/�/g) || []).length;
      const questionMarkRuns = (combined.match(/\?{2,}/g) || []).length;
      const lastWindow = combined.slice(-300);
      const elapsedMs = Date.now() - collectStart;

      throw new Error(
        `Korean PTY round-trip did NOT see '한글' twice within ${elapsedMs}ms.\n` +
        `  Stages: boot ✓ → ws-connect ✓ → ws-greeting ✓ → pty-send ✓ → pty-collect partial\n` +
        `  Chunks received: ${chunkCount}\n` +
        `  Total bytes (UTF-8): ${Buffer.byteLength(combined, "utf8")}\n` +
        `  '한글' hits: ${koreanHits} (expected ≥2)\n` +
        `  U+FFFD (replacement char) count: ${replacementChar}\n` +
        `  '??'-run count (CP949→UTF8 fail typical pattern): ${questionMarkRuns}\n` +
        `\n` +
        `  Input string: ${JSON.stringify(input)}\n` +
        `  Input UTF-8 hex: ${toUtf8Hex(input)}\n` +
        `\n` +
        `  Last 300 chars (string): ${JSON.stringify(lastWindow)}\n` +
        `  Last 300 chars (UTF-8 hex): ${toUtf8Hex(lastWindow)}\n` +
        `  Last 80 code points: ${codePointsList(lastWindow.slice(-80))}\n`,
      );
    } catch (e) {
      throw new Error(
        `Scenario 4 failed at stage='${stage}'.\n` +
        `  Reason: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, 25_000);
});
