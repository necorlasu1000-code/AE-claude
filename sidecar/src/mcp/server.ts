// MCP server entry — claude CLI spawns this as a stdio child (Phase 4 D-I).
//
// Registration pattern:
//   1. claude CLI runs `claude mcp add ae-mcp node <abs path to dist/mcp/server.js>
//      --env AE_CLAUDE_WS_PORT=<port>` (Phase 4.2 sub-step automates this).
//   2. On every claude session start, claude spawns this script with the
//      stored env. Stdin/stdout become the MCP JSON-RPC transport.
//   3. This script reverse-connects to the running sidecar main via
//      `ws://127.0.0.1:<port>/?role=mcp` (D-J), translates each MCP
//      CallTool request to an ExecMsg, and converts the matching ResultMsg
//      / ErrorMsg back to an MCP CallToolResult.
//
// Phase 4.1 scope: `ae_get_active_comp` only (1 read-only tool). Phase 5
// expands to 30 tools — each is a fresh `registerTool` call with its own
// zod input schema. The server↔ws hop stays the same.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ResultMsg, ErrorMsg } from "../protocol.js";
import { McpWsClient } from "./wsClient.js";

const SERVER_NAME = "ae-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Attach all `ae_*` tools to a fresh `McpServer`. Pure factory — no transport
 * connection or stdio side effects, so unit tests can inject a mock wsClient
 * and inspect the registered handlers without spawning a real sidecar.
 */
export function setupMcpServer(wsClient: Pick<McpWsClient, "exec">): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "ae_get_active_comp",
    {
      description:
        "Get the currently active composition in After Effects. " +
        "Returns null when no comp is active or selected.",
      // No input — empty schema (registerTool accepts undefined inputSchema).
    },
    async () => {
      const out = await wsClient.exec("ae_get_active_comp", {});
      return toCallToolResult(out);
    },
  );

  return server;
}

/** Translate the bridge's ResultMsg / ErrorMsg into an MCP CallToolResult.
 *  ResultMsg.data is JSON-stringified into a single text content block;
 *  ErrorMsg becomes an isError=true result with a `code: userMessage` line
 *  (developerHint preserved as a second line for Claude's planning). */
export function toCallToolResult(msg: ResultMsg | ErrorMsg): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  if (msg.type === "result") {
    return {
      content: [{ type: "text", text: JSON.stringify(msg.data) }],
    };
  }
  return {
    content: [{
      type: "text",
      text: `${msg.code}: ${msg.userMessage}\nhint: ${msg.developerHint}`,
    }],
    isError: true,
  };
}

// ─── Entry (only when invoked directly via `node server.js`) ─────────
// Skipped during vitest import (vi treats this as a regular module — no
// `import.meta.url === main` check fires). The `await` at top level is
// fine: this file is ESM (sidecar package.json type=module).

// Entry guard suffix list (Phase 4.4 fix-3, mistakes #14 Aspect C):
//   prod build → process.argv[1] = "<sidecar>/dist/mcp/server.js"     → .js match
//   dev (tsx)  → process.argv[1] = "<sidecar>/src/mcp/server.ts"      → .ts match
// Both forward / backward slash variants because index.ts resolveMcpSpawn
// stores Windows-style backslash paths in claude's mcp registry, but unit
// tests / future POSIX dogfood paths use forward slashes. Missing either
// extension silently no-ops the McpServer.connect call → claude marks the
// stdio child as `× failed`.
const isEntry = process.argv[1] && (
  process.argv[1].endsWith("/mcp/server.js") ||
  process.argv[1].endsWith("\\mcp\\server.js") ||
  process.argv[1].endsWith("/mcp/server.ts") ||
  process.argv[1].endsWith("\\mcp\\server.ts")
);

if (isEntry) {
  const portRaw = process.env.AE_CLAUDE_WS_PORT;
  const host = process.env.AE_CLAUDE_WS_HOST ?? "127.0.0.1";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    console.error("AE_CLAUDE_WS_PORT env required (sidecar main ws port)");
    process.exit(2);
  }

  const wsClient = new McpWsClient({ host, port });
  await wsClient.connect();

  const server = setupMcpServer(wsClient);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Lifecycle: claude CLI signals shutdown by closing stdio. The transport
  // emits onclose; McpServer.close() then resolves.
  process.on("SIGTERM", () => { wsClient.close(); process.exit(0); });
  process.on("SIGINT",  () => { wsClient.close(); process.exit(0); });
}
