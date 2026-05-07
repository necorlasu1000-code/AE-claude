# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project-Specific Guidelines — AE-Claude Panel

이 프로젝트에서는 위 4원칙(Think / Simplicity / Surgical / Goal-driven)을 베이스로, 아래 결정과 규칙이 우선합니다.
충돌 시 프로젝트 규칙 > Karpathy 베이스. (베이스의 의도를 거스르는 게 아니라 도메인 특수성으로 보강.)

### What this project is

AE의 `Window > Extensions > AE-Claude` 패널에 Claude Code CLI 터미널을 띄우고, MCP를 통해 자연어로 AE를 조작하는 CEP 확장.
4-process 아키텍처: AE ↔ CEP Panel (React+xterm.js) ↔ Sidecar Node.js (PTY+MCP+WS) ↔ claude CLI.
전체 비전·페이즈·MCP tool 카탈로그는 `plan.md` 참조. 본 파일은 코딩 시 게이트 역할.

### Architectural Decisions (D1–D9 + D11 + Phase 3 D-A~D-G + Phase 4 D-H~D-K)

| ID | Topic | Decision | 코드에서 의미 |
|---|---|---|---|
| D1 | Approach | In-Panel Terminal + Sidecar (full integration) | 패널 내부에 xterm 임베드, 외부 터미널 의존 X |
| D2 | Review mode | HOLD SCOPE | 신규 기능 추가 금지 — plan.md §1-13 범위 내에서만 |
| D3 | `ae_run_extendscript` 안전 | per-call approval + AST allow-list (FS/네트워크/system.callSystem 차단) | escape hatch는 항상 사용자 승인 + AST 검사 통과 후에만 실행 |
| D4 | Undo + crash recovery | tool당 1 undoGroup + 세션 시작 자동저장 + 5 tool마다 incremental save | 모든 destructive tool은 `defineAETool` HOF로 wrapping |
| D5 | Packaging | self-signed ZXP + Node 바이너리 동봉 | 첫 실행에 인터넷 의존 X, ZXPInstaller 우회 안내 |
| D6 | WS 프로토콜 | typed envelope (discriminated union) + request_id + cancel/progress/chunking/heartbeat | `sidecar/src/protocol.ts`가 single source of truth, panel/sidecar 양쪽 import |
| D7 | AST validator | acorn + adversarial test suite (per-tool 골든셋 누적, indirection/computed/eval/include 차단) | 새 ExtendScript 코드 추가 시 골든셋 통과 필수 |
| D8 | Tool 코드 조직 | per-tool collocation: `tools/<ae_name>/{schema, handler, impl.jsx, test}` | tool 추가 = 1 디렉토리 추가. 도메인별 분할 금지 |
| D9 | Distribution | portable Node 20 + node_modules + GitHub Actions Win/Mac matrix | `pkg`/`bun --compile`/SEA 사용 금지 — deprecation 위험 |
| D-H | claude CLI 인증 | claude CLI에 위임 (auto-detect: `ANTHROPIC_API_KEY` env inherit / OAuth fallback) | 사이드카에 인증 코드 0. spawn 시 env 그대로 inherit. dev = API key, 사용자 = OAuth — 분기 X |
| D-I | MCP server process 모델 | claude CLI가 spawn하는 별도 stdio entry script (`sidecar/src/mcp/server.ts`) | 사이드카 main은 PTY+WS만. MCP server는 standalone child. entry script가 panel WS에 reverse-connect → dispatcher.exec 라우팅 → result envelope → MCP response. main 사이드카 stdio는 launcher contract용 그대로 |
| D-J | PanelBridge multi-role | 단일 ws server에 role "panel" + "mcp" 두 종류 client 허용. primary/secondary 정책은 **role 안에서** 독립 적용 (panel primary, mcp primary 각자 separate). **backward compat 강제**: role 미명시 = `"panel"` default. Phase 2/3 17 시나리오 모두 그린 유지. 명시 시만 새 동작. **role 식별 = URL query `?role=mcp`** (panel client는 query 미명시 → default "panel" → 기존 connect URL 변경 0). | PanelBridge에 ClientState.role 추가. handleConnection 시 `req.url`에서 query.role 파싱. WRITE_TYPES 라우팅이 role-aware (panel primary = pty.in/exec, mcp primary = exec only). lockfile / heartbeat / shutdown은 한 곳에서 관리. role-disallowed type은 새 server.error code `AERoleNotAllowed`로 거부. |
| D-K | claude 출력 채널 분리 | chat 채널 = PTY raw 통과 (사이드카 main → ws → xterm). MCP 채널 = stdio JSON-RPC (D-I 별도 entry가 독립 처리). 두 채널은 사이드카 main에서 만나지 않음 | 사이드카 main은 PTY parsing 0. claude CLI 출력 형식 변경에 dependency 0. xterm UX 향상은 addon만 영향 |

### Validation Gates (코드 작성 시 자동 통과해야)

이 게이트들은 PR/커밋 전에 통과해야 한다. 우회 금지.

1. **Security gate** — `tools/_validateAst.test.ts`의 adversarial 골든셋 통과 (D7).
   새 `tools/<ae_name>/impl.jsx` 추가 시 validator를 통과하는 패턴인지 사전 확인 + 해당 패턴을 case 1+ 로 골든셋에 추가.
   `system.callSystem`/`File`/`Folder`/`Socket`/`eval`/`Function`/`#include`/computed member access는 사용 금지.
   골든셋 case는 실제 handler wrap 구조 (`function tool(_input, ctx, h) {...}`) 미러링 필수 — top-level `return`은 acorn ECMA-262 parse error로 reject됨.

2. **Undo gate** — destructive tool은 `defineAETool({destructive: true})` 명시 (D4).
   handler 안에서 `app.beginUndoGroup` 직접 호출 금지 — wrapper가 처리.

3. **Approval gate** — `ae_run_extendscript`만 `needsApproval: true` (D3).
   다른 tool에 `needsApproval: true` 추가하지 말 것 — 사용자 마찰 누적.

4. **Schema gate** — input/output 양쪽 zod schema 필수 (C2).
   handler가 throw하면 `AEError` 서브클래스로만 — `code/userMessage/developerHint` 트리플.

5. **Pagination gate** — 모든 `ae_list_*`: `limit: max(200).default(50)` + `{items, total, hasMore, nextOffset}` (P2).
   list 결과 무제한 반환 금지 — Claude context 폭발 방지.

6. **Localhost gate** — WebSocket binding은 `127.0.0.1` only.
   `0.0.0.0` 사용 시 LAN 공격면. 미래 원격 접속은 인증 모듈 추가 후에만.

7. **Mutex gate** — `ToolDispatcher`에서 in-flight tool call 1개 강제 (P4).
   ExtendScript single-threaded이므로 panel 측 evalScript 큐는 FIFO.

8. **Phase exit gate** — phase 종료 commit 전에 **`npm test` (sidecar + panel 모두 green) AND `npm run build` (production tsc strict + vite build) 둘 다 통과** 강제.
   test만 그린이면 vitest tsx 트랜스파일이 strict 타입 검사를 skip해서 production 빌드에서 늦게 터지는 함정 발생 (mistakes.md #10). 두 게이트는 직렬, 빌드까지 그린 확인 후에만 phase 닫는 commit 작성.
   **monorepo build 양쪽 명시 실행 필수** (mistakes.md #13): `npm run build`를 panel root에서만 실행하면 panel tsc + vite만 거치고 **사이드카 tsc는 안 거침** → tsx runtime에서만 발현하는 type 미스매치 (PtyLike 같은 interface 누락 method) 모두 silent. 양쪽 build를 directory 명시:
   ```bash
   cd sidecar && npm run build && cd ..   # 사이드카 strict tsc
   npm run build                            # panel tsc + vite
   ```
   둘 다 그린이어야 phase exit. CI 부재 환경에서는 매 phase commit 시 둘 다 명시 실행하는 게 유일한 자동 가드.

9. **Script generator gate** — panel-side ExtendScript script generator (useExtendScriptBridge 등)는 **production ns 값** (`cep.config.ts:id` = dot 포함 식별자)으로 unit test에서 호출 형식 검증.
   짧은 ns 가정 (`"ns"`)은 dot 없어서 chained property access vs bracket notation ambiguity 자체가 안 드러남 — acorn parse + AST 구조 검증으로 `$["..."].tools.<tool>(...)` 형태 확인 필수 (mistakes.md #11). 신규 jsx tool 추가 시 이 검증 패턴 상속.

10. **jsx host registration gate** — `src/jsx/index.ts` host[ns] 등록은 **production AE 환경 (versioned `BridgeTalk.appName` 반환 포함)에서 무조건 보장**. bolt-cep boilerplate의 multi-host switch에만 의존 X — switch case literal 매칭 실패 시에도 host[ns] = aeft 실행되도록 default fallback 강제 (AE-only 프로젝트, D2 hold scope).
    panel script generator gate (§9)와 함께 같은 메타 함정 (mock/boilerplate 가정 vs production ground truth 형식 차이)의 양면 — 둘 모두 production wiring 시점에서만 드러나므로 자동 가드 필수.

11. **jsx no-namespace-import gate** — `src/jsx/` 하위 파일에서 **`import * as X` (ESM namespace import) 사용 금지**. rollup이 namespace import를 `{ __proto__: null, ...members }` 패턴으로 합성 → ExtendScript SpiderMonkey가 prototype null 설정 시도 시 throw (mistakes.md #11 third face). 대신 named imports + 객체 literal로 sub-namespace 구성:
    ```ts
    import { ae_get_active_comp } from "./tools";
    export const tools = { ae_get_active_comp };
    ```
    Phase 5 30 tool 추가 시 같은 패턴 — 한 named import + 한 객체 literal entry per tool.
    매 phase exit에 산출물 `grep -c "__proto__" dist/cep/jsx/index.js` 0 매치 확인 (panel `npm run build` 후).

12. **jsx ASCII-only literals gate** — `src/jsx/` 하위 string literal은 **ASCII only**. 한국어/non-ASCII는 panel layer만 사용. ExtendScript engine은 산출 jsx file의 BOM 없는 UTF-8 source를 system codepage (Windows Korean = cp949)로 디코딩 시도 → non-ASCII literal에서 SyntaxError/TypeError throw, IIFE 중단, host[ns] = aeft 미도달 (mistakes.md #11 fourth face).
    분리 원칙: jsx layer = machine-friendly 영어 메시지 (Claude/MCP가 읽음). panel layer = human i18n (Phase 6 UX, 한국어/다국어 panel UI에서 처리).
    매 phase exit에 산출물 non-ASCII grep 확인 (panel `npm run build` 후):
    ```bash
    grep -cP '[\x80-\xFF]' dist/cep/jsx/index.js  # → 0 expected
    ```

13. **Idle scenario gate** — phase exit 검증에 **long-running idle (1분+ 무입력 후 정상 동작)** 시나리오 포함 필수. active interaction (입력/명령 실행)만 검증하면 timer-driven close path (heartbeat watchdog, lockfile renewal, GC 등)가 dormant 상태로 통과 (mistakes.md #12). Phase 4-7 진입 전 phase 검증 시나리오 정의 시 자동 적용.
    구현 가이드라인:
    - bidirectional liveness ping은 양쪽 wiring 둘 다 단위 테스트로 검증 (sidecar broadcast + panel echo).
    - timer-driven close path는 panelBridge.test.ts에 누적 (active disconnect path와 별도 시나리오).
    - 사용자 dogfood 시 panel 1분+ idle 두기 → 사이드카 살아있는지 항상 확인.

### Directory Rules (D8 collocation)

```
ae-claude-panel/
├── sidecar/src/
│   ├── protocol.ts                      # D6 typed envelope (panel과 공유)
│   ├── tools/
│   │   ├── _define.ts                   # defineAETool HOF (C1)
│   │   ├── _validateAst.ts              # D7 AST validator
│   │   ├── _validateAst.test.ts         # adversarial 골든셋 (per-tool 누적)
│   │   ├── ae_create_comp/
│   │   │   ├── schema.ts                # zod input/output
│   │   │   ├── handler.ts               # sidecar handler
│   │   │   ├── impl.jsx                 # ExtendScript impl
│   │   │   ├── test.ts                  # mock-AE 단위 테스트
│   │   │   └── README.md                # tool 1줄 설명 + example
│   │   └── ae_*/...                     # 30개, 동일 shape
│   ├── pty/, mcp/, ws/, utils/
│   └── index.ts
├── src/js/main/                         # CEP panel (React)
│   └── (protocol.ts를 sidecar에서 import)
├── src/jsx/                             # 빌드 시점에 tools/*/impl.jsx 합본
│   └── _polyfills/json2.js              # ES3 JSON polyfill (C3)
├── tests/_helpers/mockAe.ts             # WebSocket fixture responder (T1)
├── evals/golden/                        # LLM eval suite (P3#19)
├── .github/workflows/release.yml        # D9 Win/Mac matrix
└── plan.md                              # 비전 + 페이즈 + GSTACK REVIEW REPORT
```

**금지 패턴:**
- 도메인별 분할 (`src/jsx/aeft/comp.ts`, `sidecar/src/mcp/tools/comp.ts` 같이 흩기). plan.md §5의 원안은 D8로 폐기됨.
- tool당 schema와 impl을 다른 폴더에 두기. 한 폴더에 collocate.
- `tools/` 외부에 ae_* 함수 정의.

### Phase Structure (plan.md §8 기반, 우선순위 순)

| Phase | 산출물 | 검증 | 상태 |
|---|---|---|---|
| 0 | bolt-cep 부팅, regedit `PlayerDebugMode=1`, AE script 권한 | 빈 패널이 AE에 뜨는지 | ✅ 완료 |
| 1 | `protocol.ts` (D6), `_define.ts` (C1), `_validateAst.ts` + 골든셋 (D7) | 단위 테스트 100%, adversarial 골든셋 모두 통과 | ✅ 완료 |
| 2 | 패널 ↔ 사이드카 WS 연결, xterm 마운트, cmd.exe 인터랙션, graceful shutdown | 패널에서 `dir` 명령 결과 보임, resize 동작, 좀비 0 | ✅ 완료 (2026-05-05, 96 tests, 9 mistakes 등재) |
| 3 | ExtendScript 브릿지 (`{type:'exec', tool, input}` ↔ jsx 함수 lookup) | 왕복 latency ≤100ms, 에러 path 검증 | ✅ 완료 (2026-05-06, 139 tests, 12 mistakes) |
| 4 | MCP 서버 + claude PTY, `ae_get_active_comp` 첫 tool | 패널에서 "현재 프로젝트 정보" → tool 호출 → 응답 | ✅ 완료 (2026-05-07, sidecar 132 + panel 44, 15 mistakes, dogfood e/f/g/h ✅) |
| 5 | MVP 5 tool (collocation 패턴 확립), 그 후 25 tool 병렬 | mock-AE 풀 스택 테스트 + manual 5 시나리오 | ⏳ 다음 |
| 6 | UX (status bar 5 상태, "Recent AI ops" 카드, Stop 버튼, onboarding) | 매뉴얼 QA 체크리스트 | |
| 7 | ZXP 빌드 + GitHub Actions matrix (D9) + 릴리즈 | Win-x64/Mac-x64/Mac-arm64 ZXP 자동 생성 | |

**규칙**: Phase 1 (foundation)은 직렬. Phase 5는 lane 분할 가능 (D8 덕분에 25-tool 병렬 충돌 0).

**Phase 2 → 3 진입 시 주의** (mistakes.md 9개 함정 체득): Windows spawn shell:true는 항상 cwd + 상대 경로 (#7). React StrictMode 금지 (#8). 사이드카 종료 경로 4개 보유 — 단일 경로 의존 금지 (#9 + Phase 2.5.4/5.6). Phase 4의 PTY 교체 후 #4 (ConPTY tree kill) 재검증 필수. 자세한 회고는 `plan.md` §14.

### Design Tokens (CEP panel UI, locked in plan-design-review)

D11 결정 + 7-pass review 결과. plan.md "Design Review" 섹션의 와이어프레임 + 5상태 매트릭스 참조.

- **Color**: AE host theme sync via CSInterface. CSS variables `--bg/--fg/--accent/--warn/--error/--muted/--border`. Fallback when host theme unavailable: dark (`#2d2d2d`/`#e8e8e8`) and light (`#f5f5f5`/`#1a1a1a`). Accent `#4a9eff`, warn `#f4b942`, error `#e85a5a`.
- **Font**:
  - Terminal: `JetBrains Mono` 14px, fallback `Consolas, Menlo, monospace`
  - UI: `Source Sans 3` (Adobe bundled), fallback `-apple-system, sans-serif`
  - **NEVER `system-ui` as primary** (AI Slop blacklist 11)
- **Spacing scale**: 4 / 8 / 12 / 16 / 24 px. Component padding 12px default.
- **Radius**: 4px (cards/buttons) / 8px (modals) / 0px (panel chrome). 균일 큰 radius 금지.
- **Motion**: 150-200ms ease-out for state transitions. Status bar dot color 즉시 (no transition). `prefers-reduced-motion: reduce` 시 0ms.
- **Iconography**: lucide-icons monochrome single-color, 16px default. **Emoji 디자인 금지** (이모지를 카드 아이콘에 사용 X).
- **Status indicator** (색 + 모양 동시, 색맹 호환): ● 초록=OK, ○ 회색=idle, ◐ 노랑=partial, ◍ 빨강=error.

### Information Architecture (panel layout, Pass 1)

3-tier 시각 계층:
1. **Header (24px, 지속적)**: status dots + actions (Stop/Restart/Logs)
2. **Terminal (60-70%, 지배적)**: xterm 입출력 — 주 인터랙션
3. **Recent AI ops cards (15%, 보조)**: 가로 스크롤, click=AE select

이 비율을 깨지 말 것 — 카드가 터미널보다 커지면 visual hierarchy 무너짐.

### UX Patterns (lock-in)

- **Approval dialogs (D3)**: in-panel modal. ESC=Reject, Enter inert (실수 승인 방지). Focus default=Reject. "Don't ask again" 체크박스 **금지**.
- **Empty states**: "No X yet. Try: '<예시 1>' or '<예시 2>'" 패턴 — warmth + 2 primary action examples.
- **Error states**: actionable 메시지 — `❌ <문제>. <fix 방법> or [Action]`. 모호한 "Something went wrong" 금지.
- **Status indication**: 색상만으로 의미 전달 금지. 항상 색 + 모양 + 텍스트(또는 aria-label) 트리플.
- **Onboarding (D11=B)**: 성공 경로 조용 (1초 내 "Ready"), 실패 단계만 자세한 안내. 4-step wizard 만들지 말 것.

### Responsive Breakpoints (panel)

| Width | Behavior |
|---|---|
| < 320px | 미지원 (xterm < 40 col) |
| 320-399px | Terminal only, Recent AI ops 카드 hide |
| 400-479px | 카드 표시, 헤더 단축 (action 텍스트 → icon) |
| ≥ 480px | 풀 UI, 헤더 텍스트 전체 |

### Coding conventions

- TypeScript strict mode, no `any` (사이드카+패널). ExtendScript는 ES3, types-for-adobe로 타입 보강.
- Error 처리는 `AEError` 서브클래스로 (C2). 일반 `Error`/`throw "string"` 금지.
- 로그는 구조화 JSON으로 `~/.ae-claude-panel/logs/{date}.jsonl` (CEO P1#6). `console.log` 직접 사용 금지.
- `evalScript` 직접 호출 금지 — 항상 `defineAETool` HOF 거쳐야 (undo group + 에러 변환 일관성).
- 새 tool 추가 시 `tests/_helpers/mockAe.ts`에 fixture 응답 추가 + `evals/golden/`에 1+ 골든 케이스.

### Out of scope (v1.0에서 작성 금지)

CEO HOLD scope (D2). 아래는 v1.5+ 항목:
- Premiere Pro 지원 (Multi-host routing, E5)
- 모바일/원격 접속 (인증 모듈 + WS 외부 노출)
- Skill 시스템 (`/skills/` 워크플로우 라이브러리)
- 음성 입력 (Web Speech API 통합)
- SQLite 채팅 히스토리
- UXP 마이그레이션 (CEO L1, v2.0)
- 모델 ID UI 변경 (CEO P3#18)

이 항목들은 코딩하지 말 것. 필요해 보이면 먼저 사용자에게 확인 (Karpathy 원칙 1).

### Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

- Architecture / 구현 검증 → `/plan-eng-review`
- 패널 UI 5상태 디자인 → `/plan-design-review` (아직 미실행)
- 보안 감사 → `/cso`
- 버그/에러 → `/investigate`
- 코드 리뷰 → `/review`
- Ship/release → `/ship` → `/land-and-deploy`
- 진행 저장 → `/context-save`, 재개 → `/context-restore`
