// makeDispatcherExecHandler — adapter from PanelBridge.ExecHandler to
// ToolDispatcher.exec. Phase 4.4 fix-4 (mistakes #15) + Phase 5.1.3
// (tools registry lookup + ToolCtx construction).
//
// Why this exists: PanelBridge.handleExec calls a single ExecHandler for
// every incoming exec from any role. The MCP role's exec must reach the
// real dispatcher (which forwards to the panel role's primary client →
// ExtendScript → result), not a stub. This helper is the production
// assembly point that wires the two together; main()'s index.ts injects
// it into PanelBridge construction.
//
// Phase 5.1.3 layer: tool name lookup against sidecar/src/tools/index.ts
// registry. Registered tools (defineAETool-wrapped) get schema validation
// + ctx.panelExec injection; the wrapped handler then calls panelExec
// which itself goes back through dispatcher.exec → panel ws. This adds
// one wrapping layer on top of the Phase 4 dumb-forward path — but the
// fallback path (unknown tool) is preserved so panel-direct exec (dev
// spike button, etc.) keeps working without refactor.
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
// Registered tool path: defineAETool's invoke does its own zod validation
// + handler call; thrown AEError subclasses propagate unchanged to the
// bridge (toErrorMsg preserves code/userMessage/developerHint).
//
// The originating bridge ExecCtx fields (signal/progress/requestId from
// the mcp ws) feed into the constructed ToolCtx — the dispatcher's own
// internal requestId for the panel-side hop is separate (created inside
// dispatcher.exec). Signal propagation across the two queues is a Phase
// 5+ concern (currently dispatcher-side timeout is the upper bound).

import type { ToolDispatcher } from "./toolDispatcher.js";
import type { ExecHandler, ExecCtx } from "../ws/panelBridge.js";
import { AEError } from "../tools/_errors.js";
import { tools } from "../tools/index.js";
import type { ToolCtx } from "../tools/_define.js";

/** Adapter: sidecar dispatcher.exec → ctx.panelExec contract.
 *  ToolCtx.panelExec returns T (or throws AEError); dispatcher.exec
 *  resolves DispatcherResult. Conversion mirrors the unregistered-tool
 *  fallback below — same code path semantics; just inverted on the
 *  return type. Reused so every defineAETool handler sees the same
 *  panel-bridge contract regardless of the calling role. */
function makePanelExec(dispatcher: ToolDispatcher): ToolCtx["panelExec"] {
  return async <T>(toolName: string, input: unknown): Promise<T> => {
    const result = await dispatcher.exec({ tool: toolName, input });
    if (result.ok) return result.data as T;
    throw new AEError(
      result.code,
      result.userMessage,
      result.developerHint,
      { tool: toolName, durationMs: result.durationMs },
    );
  };
}

export function makeDispatcherExecHandler(dispatcher: ToolDispatcher): ExecHandler {
  const panelExec = makePanelExec(dispatcher);

  return async (tool, input, bridgeCtx: ExecCtx) => {
    const registered = tools[tool];

    if (registered) {
      // Phase 5.1.3 — defineAETool path. Construct ToolCtx from bridge ctx
      // + dispatcher panelExec adapter, then invoke. defineAETool internally
      // runs zod input validation, race-with-timeout, output validation,
      // and AEError normalization (see _define.ts:invoke).
      const toolCtx: ToolCtx = {
        panelExec,
        progress: bridgeCtx.progress,
        signal: bridgeCtx.signal,
        requestId: bridgeCtx.requestId,
      };
      return await registered.invoke(input, toolCtx);
    }

    // Fallback: Phase 4 dumb forward for tools not yet registered (or
    // panel-direct exec from dev spike button). Same semantics as before
    // 5.1.3 — schema validation skipped, raw dispatcher.exec result.
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
