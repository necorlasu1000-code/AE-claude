// C1 — defineAETool HOF. Wraps every AE tool with:
//   - zod input/output validation (schema gate)
//   - undoGroup wrapping for destructive ops (D4)
//   - D3 approval dispatch for needsApproval tools
//   - timeout enforcement (default 30s)
//   - error class normalization to AEError taxonomy (C2)
//
// Tool authors call defineAETool({...}) once; the HOF handles all gates.

import { z } from "zod";
import {
  AEError,
  AEValidationError,
  AETimeoutError,
  AEScriptError,
  AEApprovalDeniedError,
} from "./_errors.js";
import { DEFAULT_TIMEOUT_MS, type RequestId } from "../protocol.js";

// ─── ToolCtx: passed to handler ─────────────────────────────────────

export interface ToolCtx {
  /** Dispatch ExtendScript to panel. Panel looks up jsx fn by tool name (E7). */
  panelExec: <T>(toolName: string, input: unknown) => Promise<T>;
  /** Send progress update to panel + (eventually) Claude's MCP stream. */
  progress: (fraction: number, label?: string) => void;
  /** Cancel signal. Caller checks .aborted before each step. */
  signal: AbortSignal;
  /** Generate or pass through requestId for correlation. */
  requestId: RequestId;
}

export interface ToolDef<I, O> {
  name: string;
  description: string;
  input: z.ZodSchema<I>;
  output: z.ZodSchema<O>;
  handler: (input: I, ctx: ToolCtx) => Promise<O>;
  /** D4: wrap in app.beginUndoGroup/endUndoGroup. Default false (read-only tools). */
  destructive?: boolean;
  /** D3: send approval.request to panel before execution. Default false. ONLY ae_run_extendscript should set true. */
  needsApproval?: boolean;
  /** Override default 30s timeout for long-running tools (e.g., render). */
  timeoutMs?: number;
}

export interface DefinedTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<unknown>;
  outputSchema: z.ZodSchema<unknown>;
  /** Sidecar entry point — MCP server calls this. */
  invoke: (rawInput: unknown, ctx: ToolCtx) => Promise<unknown>;
}

export function defineAETool<I, O>(def: ToolDef<I, O>): DefinedTool {
  const timeout = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: def.name,
    description: def.description,
    inputSchema: def.input,
    outputSchema: def.output,

    async invoke(rawInput: unknown, ctx: ToolCtx): Promise<unknown> {
      // 1. Input validation (Schema gate — CLAUDE.md gate #4)
      const inputParsed = def.input.safeParse(rawInput);
      if (!inputParsed.success) {
        const first = inputParsed.error.errors[0];
        throw new AEValidationError(
          first?.path.join(".") || "input",
          first?.message || "schema mismatch",
          { fullErrors: inputParsed.error.errors },
        );
      }

      // 2. Approval gate (D3) — only for ae_run_extendscript
      if (def.needsApproval) {
        // Implementation note: panel dispatches approval.request, awaits user click.
        // Sidecar layer receives approval.response and resolves a pending Promise.
        // This is wired in panelBridge.ts (Phase 2). For now, throw if reached without wiring.
        throw new Error(
          "Approval gate not wired yet (Phase 2 panelBridge.ts). " +
            "needsApproval=true tool invoked without approval handler.",
        );
      }

      // 3. Timeout race
      const timeoutPromise = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new AETimeoutError(timeout)), timeout);
        ctx.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
      });

      // 4. Undo group wrapping (D4) — delegated to panel side via tool call envelope.
      // Panel jsx wraps in app.beginUndoGroup(undoLabel)/endUndoGroup with try/finally.
      // Sidecar just sets ctx.requestId and trusts panel to wrap. This avoids RPC roundtrip
      // for begin/end (would be 3 calls instead of 1).

      // 5. Execute handler
      try {
        const result = await Promise.race([
          def.handler(inputParsed.data, ctx),
          timeoutPromise,
        ]);

        // 6. Output validation
        const outputParsed = def.output.safeParse(result);
        if (!outputParsed.success) {
          throw new AEScriptError("Tool output failed schema validation", {
            tool: def.name,
            errors: outputParsed.error.errors,
          });
        }
        return outputParsed.data;
      } catch (e) {
        if (e instanceof AEError) throw e;
        // Wrap unknown errors as AEScriptError so MCP gets structured response.
        throw new AEScriptError(
          e instanceof Error ? e.message : String(e),
          { tool: def.name, original: e },
        );
      }
    },
  };
}
