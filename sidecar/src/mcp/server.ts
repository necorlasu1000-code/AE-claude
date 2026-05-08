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
import { aeGetActiveCompInputSchema } from "../tools/ae_get_active_comp/schema.js";
import { aeListCompsInputSchema } from "../tools/ae_list_comps/schema.js";
import { aeGetLayersInputSchema } from "../tools/ae_get_layers/schema.js";
import { aeListEffectsInputSchema } from "../tools/ae_list_effects/schema.js";
import { aeGetExpressionInputSchema } from "../tools/ae_get_expression/schema.js";

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

  // Phase 5.1.3 — inputSchema sourced from collocated zod schema (D8).
  // The MCP SDK's registerTool accepts a ZodRawShape; aeGetActiveCompInputSchema
  // is z.object({}) so .shape is `{}` — functionally equivalent to omitting
  // the field, but explicit so the 30-tool growth pattern (5.2~) lands here
  // with a single-line edit per tool (one named import + one shape ref).
  //
  // Server.ts stays a dumb stdio↔ws relay: domain logic (defineAETool wrap,
  // schema validation, AENoActiveCompError sentinel conversion) lives in
  // sidecar main's tools/ae_get_active_comp/handler.ts, reached via the
  // tools registry inside makeDispatcherExecHandler (D-K spirit — mcp =
  // protocol relay, sidecar main = domain).
  server.registerTool(
    "ae_get_active_comp",
    {
      description:
        "Get the currently active composition in After Effects. " +
        "Returns the comp's id, name, dimensions, durationSec, frameRate, and numLayers. " +
        "Throws AENoActiveCompError when no comp is selected.",
      inputSchema: aeGetActiveCompInputSchema.shape,
    },
    async () => {
      const out = await wsClient.exec("ae_get_active_comp", {});
      return toCallToolResult(out);
    },
  );

  // Phase 5.1.4 — ae_list_comps (read-only, MVP 1/5, comp lane).
  server.registerTool(
    "ae_list_comps",
    {
      description:
        "List all compositions in the active After Effects project. " +
        "Returns array of comp metadata (id, name, dimensions, durationSec, frameRate, numLayers). " +
        "Empty project returns { comps: [] } with no error.",
      inputSchema: aeListCompsInputSchema.shape,
    },
    async () => {
      const out = await wsClient.exec("ae_list_comps", {});
      return toCallToolResult(out);
    },
  );

  // Phase 5.1.5 — ae_get_layers (read-only, MVP 2/5, layer lane).
  server.registerTool(
    "ae_get_layers",
    {
      description:
        "List layers in a composition. compId optional -- defaults to active composition. " +
        "Returns array of layer metadata (index, name, matchName, type, enabled, locked, inPoint, outPoint). " +
        "matchName is locale-stable internal id (e.g. 'ADBE Vector Layer'); " +
        "type discriminates Layer subclass (AVLayer/CameraLayer/LightLayer/ShapeLayer/TextLayer). " +
        "Throws AENoActiveCompError when compId omitted and no active comp; AENotFoundError when compId is unknown.",
      inputSchema: aeGetLayersInputSchema.shape,
    },
    async (rawInput) => {
      const out = await wsClient.exec("ae_get_layers", rawInput ?? {});
      return toCallToolResult(out);
    },
  );

  // Phase 5.1.6 — ae_list_effects (read-only, MVP 3/5, effect lane).
  server.registerTool(
    "ae_list_effects",
    {
      description:
        "List effects applied to a layer. layerIndex required (1-based, AE convention). " +
        "compId optional -- defaults to active composition. " +
        "Returns array of effect metadata (matchName, displayName, enabled). " +
        "matchName is locale-stable internal id (e.g., 'ADBE Gaussian Blur 2'); " +
        "displayName is the user-facing label in AE Effect Controls. " +
        "Throws AENoActiveCompError when compId omitted and no active comp; " +
        "AENotFoundError when compId is unknown or layerIndex is out of bounds. " +
        "Layers that don't host effects (Camera/Light/Null) return { effects: [] }.",
      inputSchema: aeListEffectsInputSchema.shape,
    },
    async (rawInput) => {
      const out = await wsClient.exec("ae_list_effects", rawInput ?? {});
      return toCallToolResult(out);
    },
  );

  // Phase 5.1.7 — ae_get_expression (read-only, MVP 4/5, expression lane).
  server.registerTool(
    "ae_get_expression",
    {
      description:
        "Get expression on a property of a layer. propertyMatchName is locale-stable " +
        "internal id (e.g., 'ADBE Position', 'ADBE Anchor Point', 'ADBE Opacity'). " +
        "Returns expression source string and enabled flag. " +
        "compId optional -- defaults to active composition. " +
        "Returns { expression: '', enabled: false } when no expression is set. " +
        "Throws AENoActiveCompError when compId omitted and no active comp; " +
        "AENotFoundError when compId is unknown, layerIndex is out of bounds, " +
        "or propertyMatchName is not present on the layer.",
      inputSchema: aeGetExpressionInputSchema.shape,
    },
    async (rawInput) => {
      const out = await wsClient.exec("ae_get_expression", rawInput ?? {});
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
