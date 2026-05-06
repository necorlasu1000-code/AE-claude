// MCP server unit tests — setupMcpServer factory + toCallToolResult helper.
// We don't bring up a real StdioServerTransport (process.stdin/stdout side
// effects); we exercise the registered tool callback directly via the
// McpServer's underlying Server instance, which is the same path the SDK
// invokes for incoming CallToolRequest.

import { describe, it, expect, vi } from "vitest";
import { setupMcpServer, toCallToolResult } from "./server.js";
import type { ResultMsg, ErrorMsg } from "../protocol.js";

describe("toCallToolResult", () => {
  it("ResultMsg → JSON-stringified text content block, no isError", () => {
    const result: ResultMsg = {
      type: "result",
      requestId: "rid-1",
      data: { name: "Hero", w: 1920, h: 1080 },
    };
    const out = toCallToolResult(result);
    expect(out.isError).toBeUndefined();
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ name: "Hero", w: 1920, h: 1080 }),
    });
  });

  it("ErrorMsg → isError=true, code+userMessage+hint preserved", () => {
    const err: ErrorMsg = {
      type: "error",
      requestId: "rid-2",
      code: "AENoActiveCompError",
      userMessage: "No active composition.",
      developerHint: "Open or select a comp first.",
    };
    const out = toCallToolResult(err);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("AENoActiveCompError");
    expect(out.content[0].text).toContain("No active composition.");
    expect(out.content[0].text).toContain("Open or select a comp first.");
  });
});

describe("setupMcpServer", () => {
  it("registers ae_get_active_comp tool — wsClient.exec called on invocation", async () => {
    const exec = vi.fn(async () => ({
      type: "result",
      requestId: "rid",
      data: { name: "Active", w: 1920, h: 1080 },
    }) satisfies ResultMsg);

    const server = setupMcpServer({ exec });

    // The SDK stores registered tools in a private plain object keyed by
    // tool name (sdk/server/mcp.js — `this._registeredTools = {}`). We
    // introspect that for unit-level coverage; integration test invokes
    // the same path through the SDK's CallToolRequest handler.
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (extra: unknown) => unknown }>;
    })._registeredTools;
    expect("ae_get_active_comp" in tools).toBe(true);

    const tool = tools["ae_get_active_comp"];
    // No inputSchema → handler signature is (extra) only.
    const callResult = await tool.handler({});

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("ae_get_active_comp", {});
    expect(callResult).toMatchObject({
      content: [{ type: "text", text: JSON.stringify({ name: "Active", w: 1920, h: 1080 }) }],
    });
  });

  it("ErrorMsg from wsClient.exec → callback returns isError result", async () => {
    const exec = vi.fn(async () => ({
      type: "error",
      requestId: "rid",
      code: "AENoActiveCompError",
      userMessage: "No active composition.",
      developerHint: "Select or create a comp.",
    }) satisfies ErrorMsg);

    const server = setupMcpServer({ exec });
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (extra: unknown) => unknown }>;
    })._registeredTools;
    const tool = tools["ae_get_active_comp"];
    const callResult = await tool.handler({}) as { isError?: boolean; content: Array<{ text: string }> };

    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toContain("AENoActiveCompError");
  });
});
