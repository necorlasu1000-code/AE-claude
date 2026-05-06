// resolveShellPath — node-pty PATH lookup gap fix (mistakes.md #14).
//
// Why this exists: `child_process.spawn` does PATH lookup automatically when
// given a bare command like "claude". `node-pty` does NOT — it calls Win32
// ConPTY directly with the path verbatim, so spawning "claude" fails with
// "File not found" even when claude.exe is on PATH and reachable from a
// regular shell. This helper plugs the gap by resolving the binary to its
// absolute path before PtyHost is constructed.
//
// Production verification (Phase 4.4 dogfood, mistakes #14):
//   registerWithClaude (child_process.spawn "claude") → resolves OK
//   PtyHost           (node-pty spawn "claude")        → ENOENT (failed)
// Same sidecar process, same env, same cwd — the only difference is the
// spawn mechanism. PATH lookup absence is a node-pty contract, not a bug.
//
// Fail-safe behavior: if `which` throws (binary truly missing), this helper
// returns the input unchanged. PtyHost will then throw the standard ENOENT
// in its constructor, main() catches it, and falls through to the dummyPty
// fallback that surfaces an `AEShellNotFoundError` server.error to the
// panel. This is intentional design — the resolver never short-circuits the
// "claude not installed" UX path.
//
// Cross-platform: `which` npm package handles Windows / macOS / Linux PATH
// semantics (incl. PATHEXT extension matching on Windows). v1.0 is AE-only
// (Windows + macOS via D2 hold scope), but the helper is portable for v1.5+.

import { isAbsolute } from "node:path";
import which from "which";

// `which` v6 ships as CJS with `module.exports = which; which.sync = ...`.
// ESM-style `import { sync }` doesn't see static properties on the default
// export, so reach for the sync API via the default import.
const defaultWhichSync: WhichFn = (cmd: string) => which.sync(cmd);

/** Whichlike function for DI. Production = which.sync; tests inject mocks. */
export type WhichFn = (cmd: string) => string;

/** Resolve a shell binary to an absolute path. Absolute input passes through
 *  untouched; relative input is run through PATH lookup. On lookup failure,
 *  returns the input as-is so downstream PtyHost ENOENT → dummyPty fallback
 *  remains the single source of "shell not found" error semantics. */
export function resolveShellPath(
  shell: string,
  whichFn: WhichFn = defaultWhichSync,
): string {
  if (isAbsolute(shell)) return shell;
  try {
    return whichFn(shell);
  } catch {
    return shell;
  }
}
