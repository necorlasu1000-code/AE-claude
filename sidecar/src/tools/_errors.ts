// C2 — AEError taxonomy. Sidecar throws these; HOF converts to ErrorMsg.

export class AEError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly developerHint: string,
    public readonly ctx?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = code;
  }
}

export class AEScriptError extends AEError {
  constructor(message: string, ctx?: Record<string, unknown>) {
    super(
      "AEScriptError",
      `ExtendScript runtime error: ${message}`,
      "Read the script error and decide whether to retry with corrected code or report failure to the user.",
      ctx,
    );
  }
}

export class AETimeoutError extends AEError {
  constructor(timeoutMs: number, ctx?: Record<string, unknown>) {
    super(
      "AETimeoutError",
      `AE did not respond within ${timeoutMs / 1000}s. Use the Reconnect button.`,
      "AE may be busy or hung. Do not retry automatically; surface to user with Reconnect option.",
      ctx,
    );
  }
}

export class AECrashedError extends AEError {
  constructor(ctx?: Record<string, unknown>) {
    super(
      "AECrashedError",
      "After Effects appears to have crashed. Your work is auto-saved.",
      "AE process killed. Stop dispatching tools; surface backup file path to user.",
      ctx,
    );
  }
}

export class AEValidationError extends AEError {
  constructor(field: string, reason: string, ctx?: Record<string, unknown>) {
    super(
      "AEValidationError",
      `Invalid input: ${field} — ${reason}`,
      `Fix the input '${field}' (${reason}) and retry.`,
      ctx,
    );
  }
}

export class AEApprovalDeniedError extends AEError {
  constructor(tool: string, ctx?: Record<string, unknown>) {
    super(
      "AEApprovalDeniedError",
      "User declined the operation.",
      `User rejected approval for ${tool}. Do not retry; suggest an alternative approach.`,
      ctx,
    );
  }
}

export class AEUndoNotSupportedError extends AEError {
  constructor(tool: string, ctx?: Record<string, unknown>) {
    super(
      "AEUndoNotSupportedError",
      `${tool} cannot be undone (e.g., render queue actions).`,
      "Inform user this action is one-way; consider asking confirmation before re-attempting.",
      ctx,
    );
  }
}

export class AEFileLockedError extends AEError {
  constructor(filePath: string, ctx?: Record<string, unknown>) {
    super(
      "AEFileLockedError",
      `File is locked: ${filePath}`,
      "File in use by another process. Ask user to close it or pick a different path.",
      ctx,
    );
  }
}

// Phase 5.1.3 — domain error raised when an AE tool requires an active
// composition but none is selected (typeName !== "Composition" or
// activeItem null). Mirrors the panel jsx side h.fail("AENoActiveCompError",
// ...) sentinel string. handler.ts converts the dispatcher's generic AEError
// (code === "AENoActiveCompError") into this typed subclass so call sites
// can catch by class instead of code string when needed.
export class AENoActiveCompError extends AEError {
  constructor(ctx?: Record<string, unknown>) {
    super(
      "AENoActiveCompError",
      "No active composition. Select or create a comp in the AE project panel and try again.",
      "app.project.activeItem null or non-Composition (typeName='Folder'|'Footage'). Suggest comp selection/creation, then retry.",
      ctx,
    );
  }
}

// Phase 5.1.5 — generic resource-not-found error. Generalized constructor
// (resource type + identifier) so 30-tool growth reuses one class for all
// dangling-reference cases: comp by id (this commit), future layer by index,
// effect by matchName, marker by index, etc. Distinct from AEValidationError
// (which means the input shape is invalid — here the input shape is fine,
// the referenced resource just doesn't exist).
export class AENotFoundError extends AEError {
  constructor(resource: string, identifier: string | number, ctx?: Record<string, unknown>) {
    super(
      "AENotFoundError",
      `${resource} not found: ${identifier}`,
      `Verify the ${resource} exists. The provided identifier '${identifier}' did not match any ${resource} in scope.`,
      ctx,
    );
  }
}
