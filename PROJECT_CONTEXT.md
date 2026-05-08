# PROJECT_CONTEXT.md — AE-Claude Panel Onboarding

> 새로운 Claude 인스턴스가 5분 안에 컨텍스트를 잡고 진행 중인 작업에 즉시 합류하기 위한 단일 진입 문서.
> 의사결정 게이트 + 함정 회피 + 즉시 사용 가능한 인프라 인덱스 + 재진입 명령어.

---

## A. 프로젝트 개요

**AE-Claude Panel** — Adobe After Effects의 `Window > Extensions > AE-Claude` 패널 안에 `claude` CLI 터미널을 임베드하고, MCP 프로토콜로 자연어 → AE 조작을 자동화하는 CEP 확장.

```
AE ↔ CEP Panel (React + xterm.js)
        ↕ WebSocket
  Sidecar Node.js (PTY + MCP server + WS)
        ↕ stdio
     claude CLI (Opus 4.7)
```

**현재 위치 (2026-05-07)**: **Phase 4 ✅ 완료**. 사용자 AE dogfood 4 시나리오 (e/f/g/h) 모두 통과 — 자연어 → ae_get_active_comp MCP full round-trip ✅, 1시간+ idle 안정, panel close 잔존 0. **Phase 5 (30 MCP tool + D8 collocation) 진입 대기.**

**작업 폴더**: `C:\Users\user\Desktop\성윤\에펙 클로드` (한글 path — 함정 #7)

**진실의 원천**: `plan.md` (전체 비전 + 페이즈 + GSTACK 리뷰 + Phase 2/3/4 회고), `CLAUDE.md` (코딩 게이트, 13 Validation Gates), `mistakes.md` (영구 학습, **15 함정**), 본 문서 (온보딩 인덱스 + 재진입 절차).

---

## B. 사용자 (Operator) 정보

- 한국 영상 PD/감독 + 개발자. 의사결정 + 사용자 검증 담당. **Claude Code CLI가 실제 코딩 실행**.
- **터스(terse) 한국어 선호**. 영어 키워드는 그대로 두기 (예: "Phase 3.5 통과 OK").
- **추측 fix 싫어함** — 빨강 테스트 → 진단 → 빨강 테스트 → 초록 사이클 강제. Karpathy 원칙 4 (Goal-Driven Execution).
- **"Stop when confused" 원칙** — 막히면 우회/창의적 해결 시도 전에 사용자에게 보고. 추측으로 fragile fix 금지.
- **결정 게이트마다 명시적 OK 신호 받기**. "다음 phase 진입 OK" / "이 fix OK" 같은 한 줄 컨펌 후에만 진행.
- 한 phase 끝마다 commit + 한 줄 보고 + 멈춤. 다음 진입 별도 신호.
- 매 단위 작업은 mistakes.md에 영구 등재 (root cause + fix + 예방 + 검증). 재학습 0이 목표.
- **백업 옵션이 더 깔끔하면 사전 컨펌**: 추천 vs 백업 갈래에서 백업이 명확히 더 깔끔하면 코딩 전 한 줄 컨펌 박음.

**커뮤니케이션 패턴**:
- 짧은 보고 선호. 끝맺음 1-2 문장 (변경 + 다음 단계).
- 결정 필요 시 옵션 제시 + 추천 + 이유 + 트레이드오프 1줄. 결정은 사용자가 한다.
- 작업 도중 새 발견 → 즉시 보고. 진행 우선 후 보고 X.

---

## C. Architectural Decisions (D1-D11 + Phase 3 D-A~D-G + Phase 4 D-H~D-K)

### D1-D11 (D10 점프됨, 10개)

| # | Topic | Decision | 코드에서 의미 |
|---|---|---|---|
| D1 | Approach | In-Panel Terminal + Sidecar | xterm 패널 임베드 |
| D2 | Review mode | HOLD SCOPE | 신규 기능 추가 금지 — plan.md §1-13 범위 |
| D3 | `ae_run_extendscript` 안전 | per-call approval + AST allow-list | escape hatch는 사용자 승인 + AST 통과 후만 |
| D4 | Undo + crash recovery | tool당 1 undoGroup + 자동저장 + 5 tool마다 incremental | 모든 destructive tool은 `defineAETool` HOF |
| D5 | Packaging | self-signed ZXP + Node 동봉 | 인터넷 의존 없는 첫 실행 |
| D6 | WS 프로토콜 | typed envelope + request_id + cancel/progress/chunking/heartbeat | `sidecar/src/protocol.ts` single source of truth |
| D7 | AST validator | acorn + per-tool 골든셋 누적 | jsx 패턴은 validator 통과해야 |
| D8 | Tool 코드 조직 | per-tool collocation: `tools/<ae_name>/{schema,handler,impl,test}` | tool 추가 = 1 디렉토리 |
| D9 | Distribution | portable Node 20 + GitHub Actions Win/Mac matrix | `pkg`/`bun --compile`/SEA 사용 X |
| ~D10~ | (점프됨) | — | — |
| D11 | First-run onboarding | auto-detect + inline progress + 실패 시만 다이얼로그 | 4-step wizard 금지 |

### Phase 3 결정 게이트 (D-A ~ D-G, lock-in)

| # | Topic | Decision |
|---|---|---|
| D-A | Bridge hook 위치 | 별도 `useExtendScriptBridge` (useTerminal과 분리) |
| D-B | jsx 합본 방식 | bolt-cep `vite-cep-plugin` 자동 |
| D-C | jsx namespace | `ns.tools.ae_*` sub-namespace |
| D-D | Mutex 큐 책임 분리 | panel hook = ES single-thread 직렬화 / sidecar dispatcher = request_id + timeout + cancel + latency |
| D-E | spike trigger | 패널 dev 버튼 (D-E A) + 통합 테스트 (D-E C) |
| D-F | AEError 변환 | jsx HOF `defineJsxTool` + h.fail sentinel throw |
| D-G | latency 측정 | dispatcher wall-clock (sidecar 측 end-to-end) + bridge wall-clock (panel 측 evalScript only) — layer 분해 표시 |

### Phase 4 결정 게이트 (D-H ~ D-K, 4.0 lock-in)

| # | Topic | Decision |
|---|---|---|
| D-H | claude CLI 인증 | claude CLI에 위임 (auto-detect: `ANTHROPIC_API_KEY` env inherit / OAuth fallback). 사이드카 인증 코드 0. |
| D-I | MCP server process 모델 | claude CLI가 spawn하는 별도 stdio entry script `sidecar/src/mcp/server.ts`. 사이드카 main과 분리. ws reverse-connect → dispatcher.exec. |
| D-J | PanelBridge multi-role | 단일 ws server에 role "panel" + "mcp" 두 종류 허용. primary/secondary 정책은 role 안에서. **backward compat 강제** (role 미명시 default "panel", Phase 2/3 17 시나리오 그린 유지). **role 식별 = URL query `?role=mcp`** (4.1 lock-in). role-disallowed 메시지는 server.error `AERoleNotAllowed`. |
| D-K | claude 출력 채널 분리 | chat = PTY raw → ws → xterm. MCP = stdio JSON-RPC (D-I 별도 entry). 사이드카 main에서 두 채널 만나지 않음. PTY parsing 0. |

### Phase 5 결정 게이트 (D-L ~ D-N, 5.0 lock-in)

| # | Topic | Decision |
|---|---|---|
| D-L | `ae_run_extendscript` 도입 시점 | Phase 5.6 별도 sub-step (last) — 29 tool 패턴 누적 후 escape hatch 위에 얹기. AST validator 골든셋 (D7) + approval modal (D11) + `needsApproval: true` flag (유일). 첫 도입 시 두 패턴 동시 디버깅 risk 회피. |
| D-M | D8 collocation 이동 시점 | 5.1 첫 작업으로 `ae_get_active_comp`을 `src/jsx/aeft/tools/` (panel spike) → `sidecar/src/tools/<ae_name>/{schema.ts, handler.ts, impl.jsx, test.ts}` 정식 위치 이동 + vite-cep-plugin 합본 config. 첫 reference example 역할. Gate §11 (`__proto__` 0) / §12 (non-ASCII 0) / Phase 4 dogfood (e/f) 회귀 확인. |
| D-N | lane 분할 전략 | 5.1 MVP 5 직렬 → 5.2~5.5 25 병렬 lane (그룹 5개: 컴프 / 레이어 / 키프레임 / 이펙트 / 익스프레션). tool 개별 명세는 5.2 진입 시 별도 합의. 매 5 tool dogfood loop + Gate §13 idle. |

---

## D. Phase 진행 상태

### ✅ Phase 0-2 완료 (이전, 96 tests)
- Phase 0: 환경 셋업
- Phase 1: 사이드카 foundation (protocol.ts, defineAETool HOF, AST validator + 골든셋)
- Phase 2: 패널 ↔ 사이드카 WS + xterm + cmd.exe + graceful shutdown (96 tests, 9 traps)

### ✅ Phase 3 — ExtendScript 브릿지 완료 (139 tests, 2026-05-06)

| # | Sub-step | Commit | 상태 |
|---|---|---|---|
| 3.0 | 결정 게이트 D-A~D-G | (no commit) | ✅ |
| 3.1 | protocol.ts exec/result jsdoc | `5c6a177` | ✅ |
| Phase 2 follow-up | launcher.ts type fix + Gate §8 (build 게이트) | `d5898b2` | ✅ |
| 3.2 | json2 polyfill → `_polyfills/` 위치 | `69e8377` | ✅ |
| 3.3 | defineJsxTool HOF + ae_get_active_comp + mock | `b1a7a08` | ✅ |
| 3.4 | D7 골든셋 case 추가 + "30+" 표기 정정 | `67d3385` | ✅ |
| 3.4 follow-up | Gate §1 wrap rule 추가 | `e25995b` | ✅ |
| 3.5 | useExtendScriptBridge hook (FIFO + envelope + emit) | `397a893` | ✅ |
| 3.6 | ToolDispatcher + panelBridge 양방향 + AECancelledError | `abf9651` | ✅ |
| 3.7 | production wiring (sidecar index.ts + main.tsx) + dev 버튼 + `$[ns]` bracket fix | `b282d01` | ✅ |
| 3.7 follow-up | jsx host[ns] default-case (BridgeTalk versioned 대비, future-proof) | `ecd9d2c` | ✅ |
| 3.7 follow-up 2 | `import * as` 제거 (rollup `__proto__: null` 차단) | `a9f2167` | ✅ |
| 3.7 follow-up 3 (debug) | panel inline ExtendScript probe (PROBE_FRAGMENTS 15개) | `3a54075` | ✅ (3.9 part 1에서 revert) |
| 3.7 follow-up 4 | **jsx ASCII-only literals** (file encoding root cause fix) | `6f9ee9e` | ✅ |
| EOD doc | PROJECT_CONTEXT.md 재진입 컨텍스트 | `e3d7954` | ✅ |
| 3.7 follow-up 5 | **panel sys.heartbeat echo** (idle timeout fix, 함정 #12) | `89511a7` | ✅ |
| **3.8** | **사용자 AE 검증 (시나리오 a/b/c/d 모두 통과)** | — | ✅ |
| 3.9 part 1 | debug probe revert (main.tsx 정리) | `a40acc4` | ✅ |
| 3.9 part 2 | plan.md §15 Phase 3 회고 | `e448bf0` | ✅ |
| 3.9 part 3 | PROJECT_CONTEXT.md 갱신 + §H 정정 누적 + §J Phase 4 메시지 | (this commit) | ✅ |

**Phase 3.8 검증 결과** (2026-05-06):
- 시나리오 a (정상 round-trip): 6ms (AE 5ms, WS 1ms) ✅
- 시나리오 b (h.fail no active comp): AENoActiveCompError 5ms ✅
- 시나리오 c (10회 클릭 메모리 변화 0) ✅
- 시나리오 d (latency p95 ≤100ms): 6ms = 16배 여유 ✅
- 추가: 5분+ idle 후 사이드카 살아있음 (heartbeat fix 검증) ✅

### ✅ Phase 4 — MCP 서버 + claude PTY 통합 완료 (sidecar 132 + panel 44, 2026-05-07)

| # | Sub-step | Commit | 상태 |
|---|---|---|---|
| 4.0 | 결정 게이트 D-H~D-K + backward compat 강제 | `541c759` | ✅ |
| 4.1 | MCP server skeleton + dispatcher tool exposure | `7abcfd1` | ✅ |
| 4.2 | claude mcp add auto-registration on sidecar boot | `4400f8c` | ✅ |
| 4.3 | PTY shell cmd.exe → claude (production) + spawn-helper integration override | `e4238b9` | ✅ |
| 4.3 hotfix | PtyLike onExit (Trap A) + sidecar build gate (Trap B, 함정 #13) | `f7e1575` | ✅ |
| 4.4 fix | node-pty PATH lookup via `which` (mistakes #14 Aspect A) | `3bdd6ae` | ✅ |
| 4.4 fix-2 | MCP entry path dev/prod resolution (Aspect B) | `9889af0` | ✅ |
| 4.4 fix-3 | MCP entry guard dev/prod suffix (Aspect C) | `d9028cc` | ✅ |
| 4.4 fix-4 | wire ExecHandler → dispatcher.exec (mistakes #15 신설) | `da691a1` | ✅ |
| **4.5** | **Phase 4 회고 + 문서 갱신** | (this commit) | ✅ |

**Phase 4 dogfood 결과** (2026-05-07):
- (e) "안녕" chat sanity ✅
- (f) "현재 컴프 알려줘" → ae_get_active_comp MCP full round-trip ✅ (Phase 4 본질 검증)
- (g) 1시간+ idle 후 chat + tool 정상 동작 ✅ (#12 heartbeat 회귀 0)
- (h) panel close 후 잔존 0 ✅ (#4 ConPTY tree kill 회귀 0)
- 보조: claude 자체 내장 PowerShell tool 정상 — Phase 4 wiring이 ae-mcp만 영향.

### Phase 5 진행 중 — 30 MCP tool + D8 collocation 패턴 확립

| # | Sub-step | Commit | 상태 |
|---|---|---|---|
| 5.0 | 결정 게이트 D-L/D-M/D-N lock-in (2026-05-07) | `0d06ea7` | ✅ |
| 5.1.0 | vite-cep-plugin alias config (옵션 B) — `@aeTools` rollup alias dormant 등록 | `7977d27` | ✅ |
| 5.1.1 | `ae_get_active_comp` D-M 단순 이동 (옵션 A + C) — alias first encounter + CLAUDE.md D8 표 sync | `711fd6d` | ✅ |
| 5.1.2 | 좀비 fix (mistakes #16) — D-J multi-role grace timer panel-only count gate | `87226ae` | ✅ |
| 5.1.3 | Architecture refactor — handler.ts (defineAETool wrap) + AENoActiveCompError 클래스 (글로벌 _errors.ts) + tools registry + makeDispatcherExecHandler 확장 (registry lookup + ctx.panelExec wiring) + mcp/server.ts inputSchema | `ecae373` | ✅ |
| 5.1.4 | `ae_list_comps` (read-only, MVP 1/5 컴프 lane) — D8 4파일 collocation 첫 신규 tool. JsxProjectLike 추출 + _mockApp.ts items[] 확장 | `a157ae9` | ✅ |
| 5.1.4 fix | mistakes #17 — ExtendScript this-binding (project.item 직접 호출) + _mockApp.ts receiver guard (30 tool 공통) | `26dd304` | ✅ |
| 5.1.5 | `ae_get_layers` (read-only, MVP 2/5 레이어 lane) — AENotFoundError 신설 + JsxLayerLike + makeMockLayer + comp.layer receiver guard + Object.prototype.toString reflection | `690fcf1` | ✅ |
| 5.1.6 | `ae_list_effects` (read-only, MVP 3/5 이펙트 lane) — JsxPropertyLike/JsxPropertyGroupLike + makeMockEffect/makeMockEffectsParade + Effect Parade try/catch (Camera/Light/Null layer fail mode 우회) + layerIndex 사전 검증 | `2e498a5` | ✅ |
| 5.1.7 | `ae_get_expression` (read-only, MVP 4/5 익스프레션 lane) — JsxPropertyLike 확장 (expression?/expressionEnabled?) + makeMockProperty + MockLayerOpts.properties map + propertyMatchName not-found → AENotFoundError | (본 commit) | ✅ |
| 5.1.8 | `ae_get_keyframes` (MVP 5/5 키프레임 lane) | | ⏳ **다음 진입 대상** |
| 5.2 | 컴프 lane (병렬) | | |
| 5.3 | 레이어 lane (병렬) | | |
| 5.4 | 키프레임 lane (병렬) | | |
| 5.5 | 이펙트 lane (병렬, 익스프레션 분배) | | |
| 5.6 | `ae_run_extendscript` 도입 (D3 + D-L) — AST 골든셋 + approval modal + `needsApproval: true` | | |

### Phase 6-7 (다음 이상)
- Phase 6 — UX (logger.ts, Recent AI ops 카드, status bar 5상태)
- Phase 7 — ZXP 빌드 + GitHub Actions matrix (D9)

---

## E. 17개 발견 함정 (mistakes.md 인덱스)

| # | 함정 한 줄 | Phase | 해결 메커니즘 |
|---|---|---|---|
| 1 | bash non-interactive에서 `.bashrc` 자동 source 안 됨 | 0 | `BASH_ENV` setx + 명령 prefix |
| 2 | `npm install`이 시스템 Node 24로 빌드 (fnm 미발동) | 0 | `sidecar/.nvmrc=20` + `source ~/.bashrc &&` prefix |
| 3 | Node 20.12+ `spawn` EINVAL on `.cmd` (CVE-2024-27980) | 2.5.1 | `process.execPath` + `tsx/dist/cli.mjs` 직접 |
| 4 | ConPTY가 SIGTERM/SIGKILL 모두 무시 | 2.5.4 | OS-level tree kill (`taskkill /F /T`) + 8s hard cap |
| 5 | Windows `process.kill` SIGTERM = TerminateProcess (graceful 불가) | 2.5.5 | WS-level `sys.shutdown` 메시지 |
| 6 | bolt-cep `npm run dev` ENOENT | 2.6 | `mkdir -p dist/cep/main` 사전 |
| 7 | spawn shell:true + Windows 한글/공백 path → cmd.exe args 잘림 | 2.8.4 | spawn `cwd: SIDECAR_ROOT` + 상대 args |
| 8 | React StrictMode가 useTerminal 두 번 invoke → 사이드카 double-spawn race | 2.8.4 | `<React.StrictMode>` 제거 |
| 9 | Panel close → React unmount async cleanup이 `sys.shutdown` 미도달 → 좀비 | 2.8.4 | PanelBridge disconnect grace timer (5s) |
| 10 | `npm test` 통과만으로 phase 닫음 → production tsc 타입 에러 늦게 발견 | 2 follow-up | Validation Gate §8: phase exit = `npm test` AND `npm run build` 둘 다 |
| 11 | production wiring 시점에 mock/boilerplate/build-tool/source 가정이 ES3 ExtendScript 환경 차이에 시험됨 — 4 faces | 3.7 | 각 face마다 fix + Gate §9-§12 |
| 12 | `sys.heartbeat` 단방향 broadcast + 양방향 watchdog 모순 → panel idle ~35s 후 사이드카 자체 shutdown | 3.7 follow-up 5 | useTerminal.ts router에 echo case + Gate §13 (idle scenario gate) |
| 13 | PtyLike interface가 onExit/kill 누락 + 사이드카 tsc 별도 미실행 → tsx runtime에서만 발현 | 4.3 hotfix | PtyLike에 onExit + kill 추가 + Gate §8 monorepo 양쪽 build 명시 |
| 14 | production wiring 첫 등장 — dev/prod 분기 누락 family (3 aspects) | 4.4 fix/fix-2/fix-3 | Aspect A: which 사전 lookup / Aspect B: resolveMcpSpawn dev/prod / Aspect C: entry guard suffix list |
| **15** | **production assembly point가 단위/통합 mock 외부 — 모든 test green이지만 production fail** | **4.4 fix-4** | **makeDispatcherExecHandler helper 추출 + production-equivalent integration test** |
| **16** | **D-J multi-role grace timer 회귀 — `clients.size === 0` 조건이 mcp 포함 → panel close 시 좀비 4개 누적. Phase 4 dogfood (h) 통과는 시간 변수 우연** | **5.1.2** | **panel-only count gate (`findFirstByRole("panel")`) + scenario 15/16 회귀 가드. 새 메타 family — "검증 절차 시간 변수 누락"** |
| **17** | **ExtendScript SpiderMonkey method this-binding 강제 — `var fn = obj.method; fn(i)` detach 시 production AE throw "Function global.item() cannot work with this class". vitest mock vanilla JS는 receiver 미강제 → 4 case 그린이지만 production fail** | **5.1.4 fix** | **impl.ts: `project.item!(i)` 직접 호출. _mockApp.ts: receiver guard (`this !== project` throw) — 30 tool 공통 자동 가드. impl.test.ts regression case. 메타 family = #11/#13/#14 mock vs production 시뮬 정확도** |

### #11 4-faces (Phase 3.7 wiring 발견 누적)

| Face | 가정 (잘못된) | Production ground truth | Fix | Gate |
|---|---|---|---|---|
| (1) panel script generator | mock 짧은 ns ("ns") | dotted ns ("com.aeclaude.panel") | `$[${JSON.stringify(ns)}].tools.X` bracket notation | §9 |
| (2) jsx host 등록 (future-proof) | boilerplate switch literal 매칭 | versioned `BridgeTalk.appName` 가능성 | switch에 `default: host[ns] = aeft` | §10 |
| (3) rollup namespace import | ESM `__proto__: null` 표준 | ExtendScript SpiderMonkey throw | `import * as` 금지, named imports + 객체 literal | §11 |
| (4) jsx file encoding | UTF-8 (no BOM) source | system codepage 추정 (cp949) → invalid byte throw | jsx layer ASCII only, panel layer가 i18n | §12 |

probe 결과 (3a54075)로 face (2)는 `BridgeTalk.appName === "aftereffects"` literal 반환 확인 — fix-2가 실제 root cause 아님. fix-2는 future-proof safety net으로 유지.

### #14 3-aspects (Phase 4.4 layered fix)

| Aspect | 가정 (잘못된) | Production ground truth | Fix |
|---|---|---|---|
| A: spawn 메커니즘 | node-pty PATH lookup OK (child_process.spawn처럼) | node-pty는 PATH lookup X — bare `claude`로 ENOENT | `resolveShellPath` (which 사전 lookup) |
| B: MCP entry path | dist build 산출물 가정 | dev mode = src/.ts (.js 존재 X) | `resolveMcpSpawn` (import.meta.url 기반 dev/prod 분기) |
| C: entry guard suffix | `.js` suffix만 체크 | dev tsx는 `.ts` suffix → guard skip → MCP server 등록 X | suffix list에 `.ts` 두 줄 (forward + backslash) |

### #15 vs #11/#13/#14 메타 family 비교

- #11/#13/#14 family: **외부 의존성 시뮬레이션 정확도** 함정 (ES3 SpiderMonkey / node-pty PATH / dev vs prod build artifact / entry guard suffix). 단위 mock + integration override가 production ground truth와 어긋남.
- #15 family: **production assembly point가 mock 외부**. wiring code가 main()에 inline + 모든 test가 mock execHandler 직접 주입 → 그 wiring 자체는 dormant 상태로 통과.

두 family 모두 dogfood가 catch — 단 fix 방향 다름. #11/#13/#14 → 외부에 더 가까운 검증 layer 추가. #15 → helper 추출 + production-equivalent integration test.

---

## F. 핵심 파일 구조 (Phase 4 산출 반영)

```
C:\Users\user\Desktop\성윤\에펙 클로드\
├── plan.md                              # 비전 + 페이즈 + Phase 2/3/4 회고 + GSTACK 리뷰
├── CLAUDE.md                            # 13 Validation Gates + D1-D11 + D-A~D-K + Karpathy 4원칙
├── mistakes.md                          # 15 함정 영구 학습 (#11 4-faces + #14 3-aspects + #15 신설)
├── PROJECT_CONTEXT.md                   # 본 파일
├── eye/                                 # 사용자 스크린샷 dump (gitignored 아님, untracked)
│
├── sidecar/                             # Node.js 사이드카
│   ├── .nvmrc = 20                      # 함정 #2 방어
│   └── src/
│       ├── index.ts                     # 부팅 + dispatcher lazy back-ref + makeDispatcherExecHandler wiring (Phase 4.4 fix-4)
│       ├── protocol.ts                  # D6 typed envelope + Phase 3.1 jsdoc
│       ├── shellResolve.ts              # which 사전 lookup (Phase 4.4 fix, 함정 #14 Aspect A)
│       ├── pty/, lifecycle/             # Phase 2 산출
│       ├── ws/panelBridge.ts            # 양방향 라우팅 + onToolResponse + sendToPrimary + role-aware (Phase 3.6 + Phase 4.1 D-J)
│       ├── dispatcher/                  # Phase 3.6 + Phase 4.4 fix-4
│       │   ├── toolDispatcher.ts        # createToolDispatcher (request_id + timeout + cancel + latency)
│       │   ├── toolDispatcher.test.ts   # 13 cases
│       │   ├── execHandler.ts           # makeDispatcherExecHandler adapter (Phase 4.4 fix-4, mistakes #15)
│       │   └── execHandler.test.ts      # 3 unit cases
│       ├── mcp/                         # Phase 4.1 + 4.2 + 4.4 fix-3
│       │   ├── server.ts                # MCP stdio entry (D-I) + dev/prod entry guard suffix (Phase 4.4 fix-3)
│       │   ├── server.test.ts           # 4 cases
│       │   ├── wsClient.ts              # ?role=mcp reverse-connect + FIFO exec queue
│       │   ├── wsClient.test.ts         # cases
│       │   ├── registerWithClaude.ts    # claude mcp add idempotent + spawnCommand/spawnArgs API (Phase 4.2 + 4.4 fix-2)
│       │   └── registerWithClaude.test.ts
│       ├── tools/                       # Phase 1 + 향후 Phase 5
│       │   ├── _define.ts, _errors.ts, _validateAst.ts + .test.ts (Phase 1)
│       └── __integration__/             # Phase 2/3/4 통합 테스트
│           ├── integration-dispatcher.test.ts (Phase 3.6)
│           ├── integration-mcp.test.ts  (Phase 4.1)
│           ├── integration-shell-not-found.test.ts (Phase 4.3)
│           └── integration-production-wiring.test.ts (Phase 4.4 fix-4, mistakes #15 회귀 가드)
│
├── src/jsx/                             # ExtendScript (ES3, target=es3, ASCII only — Phase 3.7 follow-up 4)
│   ├── _polyfills/json2.js              # ES3 JSON polyfill (Phase 3.2)
│   ├── index.ts                         # host[ns] = aeft + switch default fallback (Phase 3.7 follow-up)
│   ├── aeft/
│   │   ├── aeft.ts                      # named imports (no `import * as`) + tools sub-namespace
│   │   └── tools/                       # Phase 3.3 collocation
│   │       ├── _define.ts               # defineJsxTool HOF + h.fail sentinel
│   │       ├── _mockApp.ts              # makeMockApp/makeMockComp (test-only, tree-shaken)
│   │       ├── index.ts                 # named export 단일 entry per tool
│   │       └── ae_get_active_comp/
│   │           ├── handler.ts           # impl (ASCII only)
│   │           └── handler.test.ts      # 7 cases
│
├── src/js/main/                         # CEP panel React 앱
│   ├── index-react.tsx                  # entry (StrictMode 제거됨 — 함정 #8)
│   ├── main.tsx                         # bridge wiring + dev 버튼 (devSlot 유지, debug probe revert됨 3.9 part 1)
│   └── sidecar/
│       ├── launcher.ts + .test.ts       # SidecarLauncher
│       ├── factories.ts                 # production wiring (cwd + 상대 args)
│       ├── useTerminal.ts + .test.ts    # 7-state hook + onUnhandledMessage + sendMessage + sys.heartbeat echo (Phase 3.7 follow-up 5)
│       ├── useExtendScriptBridge.ts + .test.ts  # Phase 3.5 — FIFO + envelope + emit + acorn AST 검증
│       └── TerminalView.tsx             # devSlot prop (Phase 3.7)
│
└── (Phase 7 산출 예정)
    ├── .github/workflows/release.yml    # D9 Win/Mac matrix
    └── evals/golden/
```

---

## G. 통계 (Phase 4 complete 시점)

| 항목 | 수치 |
|---|---|
| Phase 4 commits (4.0 → 4.4 fix-4 + 4.5) | 10 |
| 누적 commits (Phase 0 → 현재) | 55+ |
| Sidecar 테스트 | **132** (was 95 in Phase 3, +37: dispatcher execHandler 3 + integration-mcp 2 + integration-shell-not-found 2 + registerWithClaude 6 + wsClient + server.test + integration-production-wiring 2 + 등) |
| Panel 테스트 | 44 (변경 0) |
| 총 자동 회귀 테스트 | **176** (was 139 in Phase 3, +37) |
| 영구 등재 함정 (mistakes.md) | **15** (was 12, +3: #13 + #14 family + #15) |
| Validation Gates (CLAUDE.md) | 13 (변경 0 — Phase 4는 기존 게이트 적용) |
| Architectural decisions | D1-D11 (10) + D-A~D-G (Phase 3, 7) + D-H~D-K (Phase 4, 4) |

---

## H. 재진입 시 즉시 알아야 할 것 (Phase 5.1.7 ✅, 5.1.8 진입 대기)

### 현재 상태

**Phase 5.1.7 ✅ `ae_get_expression` 추가 완료** (2026-05-08, 본 commit). MVP 4/5 익스프레션 lane.

5.1.7 신규 추가:
- 4파일 collocation: `sidecar/src/tools/ae_get_expression/{schema, handler, impl, impl.test}`
- `JsxPropertyLike` 확장 — `expression?: string` + `expressionEnabled?: boolean` optional (real AE `Property extends PropertyBase`의 expression/expressionEnabled 미러). 30 tool 누적 시 별도 interface 분리 X — single PropertyLike contract 유지
- `_mockApp.ts`: `makeMockProperty` helper (expression-bearing leaf, makeMockEffect와 별개) + `MockLayerOpts.properties` map (matchName→Property lookup, layer.property(matchName) 직접 lookup 시뮬)
- `MockLayerOpts.properties` 우선순위: matchName === "ADBE Effect Parade" → effects parade / 외 matchName → properties map / 둘 다 없으면 throw (production AE fail mode 미러)

5.1.7 검증된 패턴:
- compId 사전 검증 → activeItem fallback → itemByID try/catch → layerIndex bounds → property(matchName) try/catch → fail 시 AENotFoundError ("composition / layer / property" generic resource label)
- output 매핑: `property.expression` (없으면 `""`) + `property.expressionEnabled` (defensive `=== true` 비교 — undefined/false 둘 다 false로 처리)
- 7 cases: AENoActiveCompError / AENotFoundError compId / AENotFoundError layerIndex / AENotFoundError propertyMatchName / 빈 expression / wiggle / disabled

함정 인덱스 변경 없음 (17 그대로 — 5.1.7은 #17 패턴 적용 사례).

**Phase 5.1.8 (`ae_get_keyframes`, MVP 5/5 키프레임 lane) 진입 대기.** 5.1.4/5.1.5/5.1.6/5.1.7 패턴 안정 — 매 tool마다 4파일 + 3 registry 1줄 + 필요 시 `_mockApp.ts` 추가 fixture (keyframe: PropertyBase.numKeys + keyTime/keyValue/keyInInterpolationType/keyOutInterpolationType 등). 키프레임은 leaf Property에 부착된 array-like accessor — 5.1.7 PropertyLike 확장 또는 별도 sub-interface 결정 필요 (5.1.8 진입 시).

### 검증된 실측치

- MCP full round-trip: 자연어 → claude → ae-mcp → dispatcher → panel WS → ExtendScript → result → claude 자연어 응답 동작 (정확한 latency는 Phase 5에서 측정)
- Phase 3 round-trip latency 6ms 그대로 유지 (Phase 4는 MCP 한 hop 추가만)
- Idle 안정성: 1시간+ idle 후 chat + tool 정상 동작 (#12 heartbeat 회귀 0)
- panel close 후 잔존 0 (#4 ConPTY tree kill 회귀 0)
- 보조: claude 자체 내장 PowerShell tool 정상 — Phase 4 wiring이 ae-mcp만 영향, 다른 MCP/tool에 부작용 0
- Production 산출물: localhost:3000 0매치 / `__proto__` 0매치 / non-ASCII 0 (Phase 3 게이트 유지)

### Phase 4에서 흡수된 정정

1. **"Phase 4 sub-step 4.7~ 분리"** → 실제로 4.0/4.1/4.2/4.3/4.4 + layered fix 4개로 진행. 4.4 dogfood가 production wiring first encounter 함정 4개 (which / entry path / entry guard / dispatcher wiring) layered로 발현. plan.md "4.7~" 표현은 회고 시점에 4.4 fix-N으로 바뀜.
2. **"D-J role-aware routing 작업 시 dispatcher 통과 자동 wiring"** 가정 → 사실 4.1 commit은 stubExecHandler를 그대로 둠. plan.md D-I (line 596)에 "dispatcher.exec 통과" 명시되어 있었으나 코드 누락 — 4.4 fix-4에서 layered 발견 (mistakes #15 신설).
3. **"Phase 4의 PTY 교체로 #4 ConPTY tree kill 재검증 필요"** → claude PTY로 교체 후에도 OS-level tree kill 동작. Phase 2의 인프라 그대로 사용.
4. **"#11 4-faces가 Phase 4에서 재발할 수 있다"** → 4 faces 자체는 ExtendScript layer 함정이라 재발 없음. 단 같은 메타 패턴 (production wiring first encounter)이 다른 layer에서 발현 — #14 family (3 aspects, 외부 의존성 시뮬) + #15 (production assembly point DI gap) 신설.

### Phase 5 진입 readiness (5.0 ✅, 5.1 진입 대기)

**Phase 5.0 결정 게이트 ✅ lock-in 완료**:
- **D-L**: `ae_run_extendscript` = Phase 5.6 별도 sub-step (last) — 29 tool 패턴 누적 후 escape hatch 위에 얹기
- **D-M**: 5.1 첫 작업으로 `ae_get_active_comp` panel spike → `sidecar/src/tools/<ae_name>/{schema.ts, handler.ts, impl.jsx, test.ts}` 정식 위치 이동 + vite-cep-plugin 합본 config
- **D-N**: 5.1 MVP 5 직렬 → 5.2~5.5 25 병렬 lane (그룹 5개: 컴프 / 레이어 / 키프레임 / 이펙트 / 익스프레션)

**Phase 5.1 진입 시 첫 작업 (D-M 이동)**:
- `src/jsx/aeft/tools/ae_get_active_comp/`  →  `sidecar/src/tools/ae_get_active_comp/{schema.ts, handler.ts, impl.jsx, test.ts}`
- vite-cep-plugin config 수정 — `sidecar/src/tools/*/impl.jsx`를 panel jsx bundle로 합본
- Gate §11 (`__proto__` 0) / §12 (non-ASCII 0) / Phase 4 dogfood (e/f) 회귀 확인

**Phase 5.1+ 진입 시 챙길 것 (mistakes.md 인덱스)**:
- #11 4-faces — 새 jsx tool 추가 시 ASCII only / namespace import 금지 / host 등록 default fallback 같은 게이트 §10/§11/§12 자동 적용
- #15 — 새 wiring 추가 시 production-equivalent integration test 신규 시나리오 + helper 추출 패턴 유지
- D3 + AST validator (D7) — Phase 5.6 진입 시 골든셋에 case 추가 + needsApproval 적용 (D-L)
- D4 destructive tool wrapping — `defineAETool({destructive: true})` 자동 undoGroup
- Validation Gate §13 idle scenario — 매 5 tool마다 dogfood loop + 1분+ idle 확인

### Phase 4 이슈 정리 (모두 해소)

- ~~ae-mcp `× failed` (panel /mcp)~~ → **Phase 4.4 fix → fix-4 layered로 catch + #14 family 3 aspects + #15 신설** (commit `da691a1`)
- ~~사이드카 boot crash (PtyLike onExit 미구현)~~ → **Phase 4.3 hotfix #13 등재 + Gate §8 monorepo 양쪽 build 명시** (commit `f7e1575`)
- ~~debug probe 잔여~~ → fix-1 commit에 자연 정리됨 (sidecar/src 안 0 매치 확인)
- ~~plan.md Phase 4 회고 추가~~ → **이 commit (4.5)에서 추가 완료**

---

## I. 작업 환경

| 항목 | 값 | 메모 |
|---|---|---|
| OS | Windows 11 Home | |
| Shell | Git Bash (Unix syntax) | unix path / forward slash |
| Node 매니저 | fnm | system 24 / project 20 |
| BASH_ENV | `C:\Users\user\.bashrc` (setx 영구) | 함정 #1 방어 — `source ~/.bashrc &&` prefix |
| 프로젝트 path | `C:\Users\user\Desktop\성윤\에펙 클로드` | 한글 + 공백 |
| AE extension path | `C:\Users\user\AppData\Roaming\Adobe\CEP\extensions\com.aeclaude.panel\` | bolt-cep dev mode auto-sync from `dist/cep/` |
| Editor | VS Code 미설치 | Claude Code CLI가 직접 파일 수정 |

---

## J. 새 웹 Claude에 보낼 메시지 템플릿 (Phase 5 진입용)

```
Phase 4 완료 (commit da691a1 4.4 fix-4 → 4.5 회고). 사용자 dogfood (e/f/g/h) 모두 통과.
- "현재 컴프 알려줘" → ae_get_active_comp MCP full round-trip ✅ (Phase 4 본질 검증)
- 1시간+ idle 안정 (#12 heartbeat 회귀 0)
- panel close 잔존 0 (#4 ConPTY tree kill 회귀 0)
- mistakes.md 15 함정 (#13 + #14 family 3 aspects + #15 신설) / Validation Gates 13개 / 176 tests

Phase 5 (30 MCP tool + D8 collocation 패턴 확립) 진입.

요청 사항:
- Phase 5 sub-step 분할 합의 (5.0 결정 게이트 → 5.1 MVP 5 tool 직렬 → 5.2~ 25 tool 병렬 lane)
- 5.0 결정 게이트 — D3 ae_run_extendscript 도입 시점 / D8 collocation ae_get_active_comp 포함 여부 / lane 전략
- 또는 사용자가 정의한 sub-step 순서가 있으면 그것 따라.

진입 전 챙길 mistakes:
- #11 4-faces — 새 jsx tool 추가 시 Gate §10/§11/§12 자동 적용
- #15 — 새 wiring 추가 시 production-equivalent integration test + helper 추출 패턴 유지
- #14 family — Phase 7 ZXP 패키징 시 dev/prod 분기 helper들 (resolveShellPath / resolveMcpSpawn / entry guard suffix) 모두 자동 prod mode 전환

D3 + AST validator (D7) 첫 destructive tool 진입 시점은 5.0 게이트에서 결정.

PROJECT_CONTEXT.md / mistakes.md / CLAUDE.md / plan.md (Phase 4 회고) 모두 최신.
git log --oneline | head -20 로 Phase 4 sub-step (4.0~4.4 fix-4 + 4.5) 모두 추적 가능.
```

---

## K. 재진입 절차 (CLI용 — Phase 5 진입 첫 명령어)

새 채팅 또는 같은 채팅 재개 시 이 순서로 실행:

```bash
# 1. 컨텍스트 파일들 빠르게 확인 (CLI 자동)
cd "C:/Users/user/Desktop/성윤/에펙 클로드"
git log --oneline | head -20           # Phase 4 sub-step (4.0 → 4.5) 모두 추적
git status -s                           # 깨끗해야 (eye/ untracked만)

# 2. Phase 4 산출물 정합성 (Phase 5 시작 전 baseline)
diff -q dist/cep/jsx/index.js \
        "/c/Users/user/AppData/Roaming/Adobe/CEP/extensions/com.aeclaude.panel/jsx/index.js"
# → 출력 0 = sync OK

# 3. Phase 4 산출물 게이트 (§10/§11/§12 효과 유지)
grep -c "localhost:3000" dist/cep/main/index.html         # → 0 (production build)
grep -c "__proto__" dist/cep/jsx/index.js                  # → 0 (Gate §11)
LC_ALL=C perl -ne 'BEGIN{$c=0} for(split //){$c++ if ord($_)>127} END{print "non-ASCII bytes: $c\n"}' \
  dist/cep/jsx/index.js                                    # → "non-ASCII bytes: 0" (Gate §12)

# 4. 회귀 테스트 baseline (Phase 5 sub-step 시작 전 그린 확인)
source ~/.bashrc && cd sidecar && npm run build && npm test 2>&1 | tail -3 && cd ..
npm run build && npm test 2>&1 | tail -3
# → sidecar 132/132 + panel 44/44 = 176/176 (Gate §8 monorepo 양쪽 build 명시 — #13 방어)

# 5. Phase 4 ae-mcp 등록 baseline 확인 (claude CLI 측)
#    - .claude.json projects[<cwd>].mcpServers.ae-mcp 엔트리 존재 확인
#    - 사이드카 부팅 시 자동 idempotent remove + add (Phase 4.2)
#    - 첫 panel 띄우면 /mcp로 ae-mcp ✓ connected 보일 것

# 6. Phase 5 sub-step 합의 후 진입 (메시지 템플릿 §J 참조)
```

### Phase 5 sub-step 진입 권장 순서

```bash
# 5.0 ✅ 결정 게이트 (이 commit, D-L/D-M/D-N lock-in)
#    - D-L: ae_run_extendscript = Phase 5.6 별도 sub-step (last)
#    - D-M: 5.1 첫 작업으로 ae_get_active_comp을 sidecar/src/tools/로 이동 + vite-cep-plugin 합본 config
#    - D-N: 5.1 MVP 5 직렬 → 5.2~5.5 25 병렬 lane (컴프/레이어/키프레임/이펙트/익스프레션)

# 5.1 ⏳ MVP 5 tool 직렬 — collocation 패턴 확립
#    - 첫 작업 (D-M): ae_get_active_comp panel→sidecar 이동 + vite-cep-plugin 합본
#      Gate §11 (__proto__ 0) / §12 (non-ASCII 0) / Phase 4 dogfood (e/f) 회귀 확인
#    - 4 새 tool: 각 lane reference example 1개씩 (컴프/레이어/키프레임/이펙트, 익스프레션은 5.2~5.5 분배)
#    - tools/<ae_name>/{schema.ts, handler.ts, impl.jsx, test.ts} 4파일 패턴 첫 적용
#    - 각 tool마다 dispatcher 통과 round-trip 검증 + golden case 1+ + integration test
#    - mistakes #11 4-faces / #15 (production assembly point) 자동 가드 적용

# 5.2~5.5 25 tool 병렬 lane (D8 덕분에 lane 충돌 0)
#    - 5.2 컴프 / 5.3 레이어 / 5.4 키프레임 / 5.5 이펙트 lane (익스프레션은 분배)
#    - tool 개별 명세는 5.2 진입 시 별도 합의
#    - 매 5 tool마다 dogfood loop + idle scenario Gate §13 확인

# 5.6 ae_run_extendscript 도입 (D3 + D-L)
#    - 29 tool 패턴 누적 후 escape hatch 위에 얹기
#    - AST validator 골든셋 (D7) + approval modal (D11) + needsApproval: true flag (유일)
```

---

## 자주 참조되는 1줄 메모 (chat 도중 빠르게)

- **Phase 4 commit 범위**: `541c759` (4.0) → 4.5 (this commit). 10개. `git log --oneline | grep -E "Phase 4"` 모두 표시.
- **CLAUDE.md Validation Gates 13개**: Security / Undo / Approval / Schema / Pagination / Localhost / Mutex / **Phase exit (monorepo 양쪽 build)** / Script generator / jsx host registration / jsx no-namespace-import / jsx ASCII-only / **Idle scenario**.
- **Out of scope (v1.0 금지)**: Premiere / 모바일 원격 / Skill 시스템 / 음성 / SQLite 채팅 히스토리 / UXP / 모델 ID UI 변경.
- **사용자 작업 패턴**: research → plan annotate → CLI implement sub-step + commit + 한 줄 보고 → 사용자 OK → 다음 sub-step. **추측 fix 금지** — root cause 확정 후 fix 옵션 + 사용자 OK → 코딩.
- **현재 워킹트리 상태**: clean (eye/ + sidecar/.claude/ untracked만). Phase 4 layered fix 4개 모두 commit됨. probe 잔여 0 (sidecar/src 0 매치).
- **메타 학습 — layered dogfood loop**: production wiring first encounter sub-step (Phase 4.4)은 단일 dogfood로 모든 함정 catch 불가능. fix-N 후 다음 dogfood loop에서 다음 layer가 reachable. Phase 5+ 30 tool 추가 시도 같은 패턴 가정.

---

**문서 마지막 갱신**: 2026-05-07. Phase 4 complete (4.5 commit과 함께). Phase 5 진입 대기.

다음 갱신 시점: Phase 5 sub-step 진행하면서 EOD 또는 phase exit.
