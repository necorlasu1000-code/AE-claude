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
