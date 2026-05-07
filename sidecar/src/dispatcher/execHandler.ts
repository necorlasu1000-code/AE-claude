// makeDispatcherExecHandler — adapter from PanelBridge.ExecHandler to
// ToolDispatcher.exec. Phase 4.4 fix-4 (mistakes #15).
//
// Why this exists: PanelBridge.handleExec calls a single ExecHandler for
// every incoming exec from any role. The MCP role's exec must reach the
// real dispatcher (which forwards to the panel role's primary client →
// ExtendScript → result), not a stub. This helper is the production
// assembly point that wires the two together; main()'s index.ts injects
// it into PanelBridge construction.
//
// Failure semantics:
//   dispatcher.exec resolves with DispatcherResult { ok, ... } — never
//   throws (timeouts/cancel/error all become ok=false). The bridge
//   contract says ExecHandler can EITHER return a value OR throw an
//   AEError. So:
//     ok=true  → return result.data    (bridge sends `result` envelope)
//     ok=false → throw new AEError     (bridge sends `error` envelope via
//                                       toErrorMsg, preserving code +
//                                       userMessage + developerHint)
//
// The dispatcher's own ctx fields (signal/progress/requestId from the
// originating mcp ws) are intentionally unused here: the dispatcher
// assigns its own internal requestId for the panel-side hop, and signal
// propagation across the two queues is a Phase 5+ concern (currently
// dispatcher-side timeout is the upper bound).

import type { ToolDispatcher } from "./toolDispatcher.js";
import type { ExecHandler } from "../ws/panelBridge.js";
import { AEError } from "../tools/_errors.js";

export function makeDispatcherExecHandler(dispatcher: ToolDispatcher): ExecHandler {
  return async (tool, input, _ctx) => {
    const result = await dispatcher.exec({ tool, input });
    if (result.ok) return result.data;
    throw new AEError(
      result.code,
      result.userMessage,
      result.developerHint,
      { tool, durationMs: result.durationMs },
    );
  };
}
