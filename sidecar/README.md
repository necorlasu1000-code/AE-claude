# sidecar — AE-Claude Panel Node.js sidecar

3-process orchestrator: PTY host (claude CLI) + MCP server (stdio) + WebSocket bridge (panel ↔ sidecar).

## Phase 1 (current)

Foundation modules per CLAUDE.md Phase 1 gate:

- `src/protocol.ts` — D6 typed envelope (panel + sidecar shared)
- `src/tools/_errors.ts` — C2 AEError taxonomy
- `src/tools/_validateAst.ts` — D7 ExtendScript AST validator (security gate)
- `src/tools/_validateAst.test.ts` — adversarial golden set (per-tool case 누적)
- `src/tools/_define.ts` — C1 `defineAETool` HOF

## Setup

```bash
cd sidecar
npm install
npm test          # adversarial golden set must pass (CLAUDE.md gate #1)
npm run typecheck
```

## What's NOT here yet

Per phase order in CLAUDE.md:

- Phase 2: `pty/`, `ws/panelBridge.ts`, `index.ts` entry
- Phase 3: ExtendScript bridge end-to-end test
- Phase 4: MCP server + claude PTY spawn + `claude mcp add` registration
- Phase 5: 30 `tools/ae_*/` collocation directories (D8)

## Conventions

- See repo-root `CLAUDE.md` for Validation Gates (1-7), Directory Rules, and Coding Conventions.
- All tool definitions go through `defineAETool` HOF. Never call `evalScript` directly.
- New ExtendScript code MUST pass `_validateAst.test.ts` adversarial set.
