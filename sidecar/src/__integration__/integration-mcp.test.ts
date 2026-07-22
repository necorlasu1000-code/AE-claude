// Phase 4.1 — MCP server ↔ PanelBridge in-process integration.
//
// In-process pattern (mirrors integration-dispatcher.test.ts): real
// PanelBridge + real McpWsClient + real setupMcpServer instance, with
// a mock ExecHandler standing in for the panel ExtendScript bridge.
//
// Round-trip under test:
//   MCP CallTool (invoked via McpServer's registered handler)
//     → wsClient.exec
//     → ws send (?role=mcp) → PanelBridge.routeMessage → execHandler
//     → execHandler returns mock data
//     → PanelBridge sends result on the originating ws
//     → wsClient.handleMessage matches requestId → resolves
//     → McpServer callback returns CallToolResult
//
// We don't bring up dispatcher in this test — Phase 3.6 already covers
// dispatcher↔bridge. Here we verify the *mcp side* of the wiring.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PanelBridge, type PtyLike, type ExecHandler } from "../ws/panelBridge.js";
import { McpWsClient } from "../mcp/wsClient.js";
import { setupMcpServer } from "../mcp/server.js";

function makeStubPty(): PtyLike {
  return {
    write() {},
    resize() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    kill() { return Promise.resolve(); },
    killImmediate() { /* unused */ },
    getRecentOutput() { return []; },
  };
}

describe("Phase 4.1 — MCP integration (in-process)", () => {
  let bridge: PanelBridge;
  let port: number;
  let wsClient: McpWsClient;

  beforeEach(async () => {
    bridge = new PanelBridge({
      pty: makeStubPty(),
      execHandler: vi.fn(async () => ({ ok: true })) as unknown as ExecHandler,
      port: 0,
      host: "127.0.0.1",
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 60_000,
      watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());
  });

  afterEach(async () => {
    try { wsClient?.close(); } catch { /* */ }
    await bridge.stop();
  });

  it("MCP CallTool ae_get_active_comp → bridge ExecHandler → MCP CallToolResult round-trip", async () => {
    // Mock execHandler returns deterministic comp data (no real AE bridge).
    const execHandler: ExecHandler = vi.fn(async (tool: string) => {
      expect(tool).toBe("ae_get_active_comp");
      return { name: "Hero Comp", w: 1920, h: 1080, fps: 24 };
    }) as ExecHandler;

    await bridge.stop();
    bridge = new PanelBridge({
      pty: makeStubPty(),
      execHandler,
      port: 0,
      host: "127.0.0.1",
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 60_000,
      watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());

    wsClient = new McpWsClient({ host: "127.0.0.1", port });
    await wsClient.connect();
    const server = setupMcpServer(wsClient);

    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (extra: unknown) => Promise<unknown> }>;
    })._registeredTools;
    const tool = tools["ae_get_active_comp"];
    expect(tool).toBeDefined();

    const callResult = await tool.handler({}) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(callResult.isError).toBeUndefined();
    expect(callResult.content[0].type).toBe("text");
    expect(JSON.parse(callResult.content[0].text)).toMatchObject({
      name: "Hero Comp", w: 1920, h: 1080, fps: 24,
    });
    expect(execHandler).toHaveBeenCalledWith(
      "ae_get_active_comp",
      {},
      expect.any(Object),
    );
  });

  it("ExecHandler throws AENoActiveCompError → MCP CallToolResult isError=true", async () => {
    const execHandler: ExecHandler = vi.fn(async () => {
      const err = new Error("No active composition.") as Error & {
        code?: string; userMessage?: string; developerHint?: string;
      };
      // Mimic AEError shape (panelBridge wraps unknown errors as AEScriptError;
      // here we want the bridge to surface our specific code path).
      err.code = "AENoActiveCompError";
      err.userMessage = "No active composition.";
      err.developerHint = "Open or select a comp first.";
      // Throw an AEError-like object — panelBridge.toErrorMsg checks
      // `e instanceof AEError`; for this integration test, we accept the
      // generic AEScriptError fallback (still produces isError=true MCP result
      // with the original message preserved).
      throw err;
    }) as ExecHandler;

    await bridge.stop();
    bridge = new PanelBridge({
      pty: makeStubPty(),
      execHandler,
      port: 0,
      host: "127.0.0.1",
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 60_000,
      watchdogIntervalMs: 60_000,
    });
    ({ port } = await bridge.start());

    wsClient = new McpWsClient({ host: "127.0.0.1", port });
    await wsClient.connect();
    const server = setupMcpServer(wsClient);

    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (extra: unknown) => Promise<unknown> }>;
    })._registeredTools;
    const callResult = await tools["ae_get_active_comp"].handler({}) as {
      isError?: boolean; content: Array<{ text: string }>;
    };
    expect(callResult.isError).toBe(true);
    // Generic AEScriptError fallback wraps the error message verbatim.
    expect(callResult.content[0].text).toContain("No active composition.");
  });
});
