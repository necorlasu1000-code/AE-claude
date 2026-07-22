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

**현재 위치 (2026-07-23)**: **Phase 5.3.2 ✅ ae_add_text_layer 완료** (write, 레이어 lane 2/9 — addText factory + TextDocument round-trip 첫 도입). 5.2 컴프 lane 3/3 ✅, 5.3.1 solid ✅. 그 사이 심층 리뷰 fix 패스 2회 완료 (§G-0/§G-0-b — mistakes #21~#25, server.ts registry 루프 전환, 도그푸딩 검증 2026-07-23 ✅). **다음 진입 대상: 5.3.3 ae_add_shape_layer**. D-N lane 분할: 30 tool 한정 + 직렬 + 5.2~5.7 6 lane sub-phase + 5.8 escape hatch. 등록 위치는 registry 루프 도입으로 3곳 (sidecar tools/index.ts + jsx tools/index.ts + jsx aeft.ts; server.ts 자동).

**작업 폴더**: `C:\Users\user\Desktop\성윤\에펙 클로드` (한글 path — 함정 #7)

**진실의 원천**: `plan.md` (전체 비전 + 페이즈 + GSTACK 리뷰 + Phase 2/3/4 회고 + Phase 5 MVP), `CLAUDE.md` (코딩 게이트, 13 Validation Gates), `mistakes.md` (영구 학습, **20 함정**), 본 문서 (온보딩 인덱스 + 재진입 절차).

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
| D-N | lane 분할 전략 | 5.1 MVP 5 직렬 → **5.2~5.7 24 신규 tool 직렬 lane** (옵션 A) + 5.8 escape hatch. **2026-05-10 5.2 진입 시 사용자 결정**: 옵션 1 (30 tool 한정 — ae_audio_to_markers + 임포트/익스포트 4 = 5 tool v1.5+ deferred), 옵션 2 (이펙트 영역 ae_list_effects 5.1.6 + ae_list_available_effects 신규 둘 다 별도), 6 lane (컴프/레이어/키프레임/이펙트/익스프레션/마커). lane 안 read → write 순서 (D-Q E1). 5.2.2 ae_create_comp = D4 destructive flag + undoGroup wiring reference example. 매 lane 종료마다 dogfood loop + Gate §13 idle. |

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
| 5.1.7 | `ae_get_expression` (read-only, MVP 4/5 익스프레션 lane) — JsxPropertyLike 확장 (expression?/expressionEnabled?) + makeMockProperty + MockLayerOpts.properties map + propertyMatchName not-found → AENotFoundError | `6ed8f08` | ✅ |
| 5.1.7 fix | mistakes #18 — schema description vs production runtime 차이. propertyMatchName → propertyName + description 정정 + mock display-name keyed + 회귀 case | `1ad3feb` | ✅ |
| 5.1.7 fix-2 | mistakes #19 — description duplication / single source of truth 위반. server.ts:127-134 정정 (production source) + handler.ts JSDoc cleanup + dist grep scope 검증. root cause fix (description 통합)는 5.2 진입 전 검토 | `8909a6e` | ✅ |
| 5.1.8 | `ae_get_keyframes` (MVP 5/5 키프레임 lane) — 4파일 collocation + JsxPropertyLike 키프레임 영역 확장 (numKeys / keyTime / keyValue / keyIn/Out InterpolationType optional + receiver guards) + KeyframeInterpolationType int → enum string 매핑 (LINEAR=6612 / BEZIER=6613 / HOLD=6614) + value: z.unknown + 11 cases. **jsx 양쪽 등록 패턴 발견** (aeft/tools/index.ts + aeft.ts named import + object literal 양쪽 필수) | `b206d7a` | ✅ |
| 5.1.9 | xterm Ctrl+C / Ctrl+V OS clipboard 연동 (dogfood UX) — attachCustomKeyEventHandler + navigator.clipboard.writeText/readText + Ctrl+C 분기 (selection → copy / no selection → SIGINT pass) + Ctrl+V terminal.paste → ws.send pty.in. panel test 37 → 41 | `3ae033b` | ✅ |
| 5.1.9 fix-1 | mistakes #20 face-1 — terminal.getSelection 빈 문자열 시 window.getSelection.toString fallback. 두 selection 모델 모두 check + 양쪽 clearSelection/removeAllRanges. panel 41 → 42 | `aff9f85` | ✅ |
| 5.1.9 fix-2 | mistakes #20 face-2 — node_modules @xterm/xterm/css/xterm.css `.xterm{user-select:none}` library 기본 룰 발견. src/js/index.scss `.xterm{user-select:text!important}` override (vite bundle order index.scss → xterm.css 후순위 패배 → !important 필수, dist CSS @1324 vs @2972 검증) | `314a2d1` | ✅ |
| 5.1.9 보류 | Ctrl+C copy fix-3 (사용자 dogfood 결과 fail 시 진단 — Step 2 xterm 옵션 / Step 3 debug logger + CEP DevTools). paste / SIGINT / 좀비 0 모두 ✅ | | ⏸ |
| 5.2 진입 update | plan.md / PROJECT_CONTEXT / mistakes 인덱스 update + 사용자 결정 4건 박음 (옵션 1 + 옵션 2 + 옵션 A + 별도 commit 우선) | `fcc7f30` | ✅ |
| **5.2.1** | **ae_get_project_info** (read, 컴프 lane 1/3) — 4파일 collocation + 6 field 출력 (file/numItems/bitsPerChannel/expressionEngine/displayStartFrame/hostVersion) + JsxFileLike 신설 + JsxAppLike.version + JsxProjectLike 5.2.1 fields optional + 6 cases. Project 전역 (AENoActiveCompError 의존성 X). Gate §12 자동 catch (header comment 한글 → 영어 정정) | `91549e8` | ✅ |
| **5.2.2** | **ae_create_comp** (write 첫 진입, D4 destructive flag + undoGroup wiring reference example) | | ⏳ **다음 진입 대상** |
| 5.2.3 | ae_set_active_comp (write) | | |
| 5.3 | 레이어 lane (9 신규 write: solid / text / shape / null / adjustment / set_layer_property / duplicate / delete / reorder) | | |
| 5.4 | 키프레임 lane (3 신규 write: set_keyframe / set_keyframe_easing / remove_keyframe) | | |
| 5.5 | 이펙트 lane (5 신규: list_available_effects read → describe_effect read → apply_effect write → set_effect_property write → remove_effect write) | | |
| 5.6 | 익스프레션 lane (2 신규 write: set_expression → remove_expression) | | |
| 5.7 | 마커 lane (2 신규: list_markers read → add_marker write) | | |
| 5.8 | `ae_run_extendscript` 도입 (D3 + D-L) — escape hatch, AST 골든셋 + approval modal + `needsApproval: true` flag (유일) | | |

### Phase 6-7 (다음 이상)
- Phase 6 — UX (logger.ts, Recent AI ops 카드, status bar 5상태)
- Phase 7 — ZXP 빌드 + GitHub Actions matrix (D9)

---

## E. 20개 발견 함정 (mistakes.md 인덱스)

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
| **18** | **schema description vs production AE runtime 차이 — `propertyMatchName: "ADBE Position"` (TS type 추론 spec) → claude first-attempt fail × 5. layer.property() 실제 동작은 display-name lookup. types-for-adobe만 보고 spec 박은 결과** | **5.1.7 fix** | **`propertyName` 인자명 변경 + description 정정 (display-name 명시) + mock `properties` map jsdoc "KEYED BY DISPLAY NAME" 명시 + 회귀 case (matchName-shaped → fail, display-name → 성공). 새 메타 family — "spec / description 정확도가 production runtime 검증 필요"** |
| **19** | **description duplication / single source of truth 위반 — fix-1이 zod schema + handler.ts description 정정했지만 production source는 `mcp/server.ts` inline description. claude는 server.ts만 본다 → fix-1이 dead code만 정정** | **5.1.7 fix-2** | **server.ts:127-134 description 정정 (사용자 spec, negative example "Do NOT use 'ADBE Position'") + handler.ts:7 JSDoc cleanup + dist grep 검증 (server.js scope `propertyMatchName` 0). #15 family lineage (production assembly point가 fix scope 밖). root cause fix 후보 (description 통합) 5.2 진입 전 별도 검토** |
| **20** | **xterm.js keybinding selection dual-source 함정 — 2 face. (face-1) terminal.getSelection() 단일 source 가정 vs CEF 환경 native browser selection도 engage 가능. (face-2) `node_modules/@xterm/xterm/css/xterm.css` 라이브러리 기본 `.xterm{user-select:none}` 룰이 native selection 차단 — fix-1 native fallback도 미달. 두 layer 모두 fix해야 작동** | **5.1.9 fix-1 + fix-2** | **face-1: useTerminal.ts:172-218 Ctrl+C 분기에 window.getSelection fallback (xtermSel \|\| nativeSel) + 양쪽 clear (clearSelection/removeAllRanges) + #18 fallback test case. face-2: src/js/index.scss `.xterm{user-select:text!important}` override (vite bundle order 후순위 패배 → !important 필수, dist CSS byte position 검증). #11/#15/#19 family lineage — fix scope 한 layer만 보면 production 미달 메타. UX 영역 dogfood loop 명시 학습** |

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

## G-0. 심층 코드 리뷰 fix 패스 (2026-07-22, Phase 5.3.1 이후)

외부 감사(4-영역 심층 리뷰: 코어/MCP/툴/패널) 결과를 반영한 fix 패스. Phase 5.3.1(`a2692a8`)에서 진행 중이던 시점에 리뷰 → 7개 commit으로 HIGH/게이트 위반 처리. **모든 phase-exit 게이트 재통과**: sidecar 230 tests / panel 45 tests / 양쪽 build green / jsx dist `__proto__`=0, non-ASCII=0, alert=0, 10 tool 등록.

| Fix | commit | 내용 | mistakes |
|---|---|---|---|
| 1 | `3f76c01` | grace 타이머 취소 panel-only (connect 방향) — mcp 재접속이 좀비 유발 | **#21** (#16 재발) |
| 2 | `92f0ad1` | AST validator allow-list 실제 강제 + `this`/`$`/dot 우회 차단 (골든셋 42→50) | **#22** |
| 3 | `296f2a6` | 패널 브리지 방어 타임아웃 + tool 이름 화이트리스트 + U+2028/9 escape (panel 42→45) | — |
| 4 | `35e7aa9` | 부팅 배선 순서 재구성 + registerMcp stdin ignore+타임아웃 + late pty.onExit 버퍼 + await kill + unhandledRejection + localhost gate + routeMessage try/catch | **#23** (4 aspect) |
| 5 | `46aad83` | ae_list_* 페이지네이션 게이트 §5 (limit/offset/{items,total,hasMore,nextOffset}) + server.ts rawInput 포워딩 버그 + PtyHost.killImmediate abort 경로 | — |
| 6 | `09cdb90` | 죽은 코드 청소 (helloWorld/alert, hello* 6, samples.ts, getAppNameSafely, 템플릿 에셋 12, lib/utils ppro/aeft) + jsx 주석 ASCII화 (§/em-dash, __proto__ 토큰) + @types/which devDeps | — (F6 해소) |
| 7 | `55f75c4` | Mutex gate §7 문구를 D-D와 정합화 (직렬화=panel FIFO, dispatcher는 동시 in-flight 허용) | — |

**핵심 발견 3건 (Critical)**: (a) mcp 접속이 grace 타이머 role-blind 취소 → #16 재발 (#21). (b) `ALLOWED_GLOBALS` 정의만 되고 미참조 → validator가 deny-list 전용으로 동작, `this.File`/`$.evalFile`/임의 unknown global 통과 (#22, 5.8 escape hatch 전 필수였음). (c) 패널 브리지 큐가 evalScript 콜백 미발화 시 영구 스톨 + jsx에 `alert()` 포함 `helloWorld` 잔재가 트리거 → 방어 타임아웃 + alert 제거.

**미처리(의도적 보류, 개별 검증 필요)**: 패널 package.json 추측성 미사용 devDeps 9종 (rollup-plugin-*/babel-preset-env 등 — 각각 build 확인 후 제거 권장, 추측 fix 회피). Phase 7 ZXP 프로덕션 사이드카 패키징(절대경로 박힘/Node·node_modules 미동봉 — D5/D9 설계 확정 필요), cep.config 인증서 플레이스홀더, requiredRuntimeVersion 9.0→11.0, vite.es.config watchRollup 즉시 close — 모두 Phase 7 진입 시 처리 대상으로 문서화.

### G-0-b. 2차 더블체크 + 잔여 전량 처리 패스 (2026-07-22 저녁)

G-0 fix 패스 자체를 더블체크한 결과 **fix 커밋 2개에서 실동작 안 하는 버그 3건 발견 → 수정**, 이어서 G-0의 잔여/보류 항목을 전량 처리.

| commit | 내용 | mistakes |
|---|---|---|
| `4f94928` | 296f2a6의 U+2028/9 escape가 런타임 no-op(단일 백슬래시=원시 문자)이었음 → `\\u2028` 정정 + undefined input 가드 + 회귀 테스트 2 | **#24** |
| `6853741` | 46aad83의 killImmediate taskkill이 detached:false라 process.exit(2)와 동반 사망(실기기 재현) → detached+unref + spawn 옵션 단언 테스트 + PtyLike mock 3곳 갱신 | **#25** |
| `0d2abf0` | 부팅 좀비 윈도우 완전 폐쇄: 안전망 배선을 PTY spawn 직후로, buffered-exit 가드 4곳, main().catch에서 bootPty.killImmediate(bridge.start 실패 누수), 크래시 exit code 1 구분, registerMcp tree-kill + `code ?? 0` 마스킹 제거 + timeout reason | #23 마무리 |
| `b813d0e` | sendToPrimary fail-fast(AEPanelNotConnectedError, 30s 낭비 제거), ae_get_layers/ae_get_keyframes §5 페이지네이션(게이트 문구도 collection 전체로 확장), **server.ts 10개 registerTool 블록 → tools registry 루프** (#19 root fix — description 정본은 handler.ts로 단일화, 신규 툴 시 server.ts 수정 0줄) | #19 root |
| `d9ea412` | WS Origin 게이트(브라우저 발 접속 1008 거부 — loopback만으론 못 막던 표면), lockfile stale 정리 TOCTOU(rename 원자 claim), McpWsClient 자동 재연결(backoff), server.ts stdin end/close 훅, pty.out panel-only, launcher start-실패 crash 덮어쓰기, main.tsx 텔레메트리 Map 누수 | — |
| (청소) | 미사용 devDeps 19종 제거(빌드 검증 완료 — G-0의 "9종 추측" 항목 해소), stale 주석 4곳(ptyHost killHardCapMs "미사용" 거짓 주석 포함), jsx utils/utils.ts(dispatchTS) 삭제, README helloWorld 예제 정정, vite.es.config watchRollup 즉시 close 버그 fix | — |

**검증**: sidecar **238** tests / panel **47** tests / 양쪽 tsc + build 그린 / jsx dist 게이트(proto=0, alert=0, non-ASCII=0, 10툴 전부 번들 확인).

**남은 알려진 항목 (Phase 7 진입 시)**: ZXP 사이드카 패키징(D5/D9), cep.config 인증서, requiredRuntimeVersion 9.0→11.0. **설계 리마인더**: wsClient result.chunk 소비자는 여전히 의도적 미구현 (large-output 툴 도입 시 + 테스트와 함께).

## G. 통계 (Phase 5.2.1 complete 시점, 2026-05-10)

| 항목 | 수치 |
|---|---|
| Phase 5 commits (5.0 → 5.2.1) | 19+ |
| 누적 commits (Phase 0 → 현재) | 76+ |
| Sidecar 테스트 | **191** (was 185 in 5.1.8, +6: 5.2.1 ae_get_project_info 6 cases — saved/unsaved/defaults/extendscript engine/32-bit + non-zero displayStart/korean filename) |
| Panel 테스트 | **42** (변경 0 — 5.2.1 sidecar-only) |
| 총 자동 회귀 테스트 | **233** (was 227 in 5.1.8, +6) |
| 영구 등재 함정 (mistakes.md) | **20** (변경 0 — 5.2.1에서 Gate §12 자동 catch 1회 정정, mistakes 등재 기준 미달) |
| Validation Gates (CLAUDE.md) | **14** (was 13 in Phase 4, +§14 jsx 양쪽 등록 — 5.1.8 발견) |
| Architectural decisions | D1-D11 (10) + D-A~D-G (Phase 3, 7) + D-H~D-K (Phase 4, 4) + D-L~D-N (Phase 5, 3) |
| Phase 5 tool 진행 | ✅ 7/30 (MVP baseline `ae_get_active_comp` + MVP 5/5 + 5.2.1 `ae_get_project_info`). 잔여 23 신규 + 1 escape hatch (5.8) |

---

## H. 재진입 시 즉시 알아야 할 것 (Phase 5.2.1 ✅, 5.2.2 진입 대기)

### 현재 상태

**Phase 5.2.1 ✅ ae_get_project_info 완료** (2026-05-10, `91549e8`). 컴프 lane 1/3 (read-only). 6 field 출력 (file{path,name}|null / numItems / bitsPerChannel / expressionEngine / displayStartFrame / hostVersion). **다음 진입 대상: 5.2.2 ae_create_comp** (write 첫 진입, D4 destructive flag + undoGroup wiring reference example).

5.1 완료 mile-stone (`fcc7f30` 5.2 진입 update + 사용자 결정 4건 박음): MVP 5/5 + UX 부분.

5.1 sub-step 진행 (확정 commit):
- **5.1.4** (`a157ae9`) ae_list_comps + JsxProjectLike + items[] mock
- **5.1.4 fix** (`26dd304`) mistakes #17 ExtendScript this-binding (project.item 직접 호출 + receiver guard, 30 tool 공통 mock policy)
- **5.1.5** (`690fcf1`) ae_get_layers + AENotFoundError + JsxLayerLike + makeMockLayer + Object.prototype.toString reflection (Layer subclass 분류)
- **5.1.6** (`2e498a5`) ae_list_effects + JsxPropertyLike/JsxPropertyGroupLike + Effect Parade try/catch (Camera/Light/Null fail mode)
- **5.1.7** (`6ed8f08`) ae_get_expression + JsxPropertyLike 확장 (expression?/expressionEnabled?) + makeMockProperty + MockLayerOpts.properties
- **5.1.7 fix** (`1ad3feb`) mistakes #18 schema description vs runtime (propertyMatchName → propertyName, display-name lookup)
- **5.1.7 fix-2** (`8909a6e`) mistakes #19 description duplication (server.ts production source single source of truth)
- **5.1.8** (`b206d7a`) ae_get_keyframes + JsxPropertyLike 키프레임 영역 확장 + KeyframeInterpolationType int → enum string (LINEAR/BEZIER/HOLD) + **jsx 양쪽 등록 패턴 발견** (aeft/tools/index.ts + aeft.ts named import + object literal 양쪽 필수)
- **5.1.9** (`3ae033b`) xterm Ctrl+C/V OS clipboard 연동 (panel test 37 → 41)
- **5.1.9 fix-1** (`aff9f85`) mistakes #20 face-1 native selection fallback (panel 41 → 42)
- **5.1.9 fix-2** (`314a2d1`) mistakes #20 face-2 xterm.css user-select:none override (CSS layer)

함정 인덱스: 19 → 20. mistakes #20는 **2 face** — face-1 (code-side fallback) + face-2 (CSS layer enabling). 같은 root question("native selection 활성화")의 multi-layer fix. fix-2 없이 fix-1 단독 작동 X.

**5.1 통합 학습**:
- types-for-adobe TS type만 보고 schema spec 박지 말 것 — production runtime semantic (display name lookup, locale 의존, instance method receiver 강제)은 TS type에 표현 안 됨 (#18)
- description의 production source는 `mcp/server.ts` registerTool block — single source of truth. handler.ts/schema.ts description은 dev annotation only (#19)
- description fix 시 dist grep scope 명시 — production 노출 source의 dist 산출물 (`dist/mcp/server.js`) 직접 grep (#19)
- xterm/캔버스 기반 UI 키바인딩 작성 시 두 selection 모델 모두 check + library 기본 CSS도 `node_modules/<pkg>/**/*.css` grep scope 확장 (#20)
- **jsx 양쪽 등록 패턴** (5.1.8 발견): 신규 tool 추가 시 `src/jsx/aeft/tools/index.ts` (alias re-export) + `src/jsx/aeft/aeft.ts` (named import + object literal — gate §11 패턴) 양쪽 필수. 한쪽만 박으면 jsx bundle에 함수 0 매치 (gate §11 안 잡힘 — namespace import는 정상이지만 등록 누락)
- **multi-layer fix 메타**: UX 기능 (keybinding/clipboard/CSS)은 code + CSS + 환경 권한 multi-layer로 wiring. 한 layer fix 후 dogfood 그린 ≠ 정답 (#20 face-1 → face-2 layered loop)
- root cause fix 후보 (description 통합, 5.2 진입 전 별도 검토): zod `.describe()` import / handler.ts ToolDef.description lookup / 두 곳 const string 추출 — **5.2 진행 중 점진 도입 또는 보류 결정** (현재는 mistakes #19 패턴 그대로 server.ts에서 single source 유지)

### Phase 5.2 진입 명세 (사용자 결정 4건 확정 후 — 2026-05-10)

**D-N lane 분할 결정 결과**:
- 옵션 1 — 30 tool 한정 (ae_audio_to_markers + 임포트/익스포트 4 = 5 tool v1.5+ deferred)
- 옵션 2 — 이펙트 영역 ae_list_effects (5.1.6 layer 적용) + ae_list_available_effects (catalog) 둘 다 별도 tool 보유
- 옵션 A — 직렬 (5.2~5.7 6 lane sub-phase, lane 한 번에 1개)
- 별도 commit 우선 — 5.2 진입 전 plan.md / PROJECT_CONTEXT / mistakes 인덱스 + 사용자 결정 박음 commit (본 commit)

**5.2~5.7 24 신규 tool lane 매핑**:

| Lane | sub-phase | 신규 | tools |
|---|---|---|---|
| 컴프 | 5.2 | 3 | 5.2.1 ae_get_project_info (read) → 5.2.2 ae_create_comp (**write 첫 진입 D4 reference**) → 5.2.3 ae_set_active_comp (write) |
| 레이어 | 5.3 | 9 | 5.3.1~5.3.9: ae_add_solid_layer / ae_add_text_layer / ae_add_shape_layer / ae_add_null_layer / ae_add_adjustment_layer / ae_set_layer_property / ae_duplicate_layer / ae_delete_layer / ae_reorder_layer (모두 write) |
| 키프레임 | 5.4 | 3 | 5.4.1 ae_set_keyframe → 5.4.2 ae_set_keyframe_easing → 5.4.3 ae_remove_keyframe (모두 write) |
| 이펙트 | 5.5 | 5 | 5.5.1 ae_list_available_effects (read) → 5.5.2 ae_describe_effect (read) → 5.5.3 ae_apply_effect (write) → 5.5.4 ae_set_effect_property (write) → 5.5.5 ae_remove_effect (write) |
| 익스프레션 | 5.6 | 2 | 5.6.1 ae_set_expression → 5.6.2 ae_remove_expression (모두 write) |
| 마커 | 5.7 | 2 | 5.7.1 ae_list_markers (read) → 5.7.2 ae_add_marker (write) |
| Escape Hatch | 5.8 | 1 | ae_run_extendscript (D3 + D-L, AST 골든셋 + approval modal + needsApproval flag) |

**D-Q read → write 진입 순서 (lane 안)**: 5.2.1 read → 5.2.2 write 첫 진입 (D4 destructive + undoGroup wiring reference). 5.5.1/5.5.2 read 먼저, 5.5.3+ write. 5.7.1 read 먼저, 5.7.2 write.

**5.2.1 ✅ 완료 결과** (`91549e8`):
- 4파일 collocation + 6 field 출력 + JsxFileLike 신설 + JsxAppLike.version + JsxProjectLike 5.2.1 fields optional + makeMockProject/makeMockApp 확장 + 6 cases
- Project 전역 (AENoActiveCompError 의존성 X — thinnest handler in registry)
- Gate §12 jsx ASCII-only 자동 catch 1회 (header comment "컴프 lane" 한글 → 영어 정정 후 0 매치)
- 등록 4 위치 모두 박음 (sidecar tools/index.ts + mcp/server.ts + jsx tools/index.ts + aeft.ts) — Gate §14 ae_get_project_info 4 매치
- sidecar test 185 → 191 (+6) / panel test 42 그대로

**5.2.2 진입 명세** (다음 작업):
- `sidecar/src/tools/ae_create_comp/{schema,handler,impl,impl.test}.ts` 4파일
- input: name (string) / width (positive int) / height (positive int) / pixelAspect (default 1) / duration (positive number, seconds) / frameRate (positive number, fps) — types-for-adobe Project.items.addComp 시그니처 따라 (사이드 콜 가능)
- 추가 옵션: bgColor ([r,g,b] 0-1 normalized) / setActive (boolean, 생성 후 active 설정 여부)
- output: { compId: number } — 생성된 CompItem.id (다음 호출에 compId로 사용)
- **D4 destructive flag wiring 첫 검증** — `defineAETool({destructive: true, ...})` flag + handler 내부에서 자동 `app.beginUndoGroup` / `app.endUndoGroup` wrap. 사용자 옵션 C 결정: 5.2.2 안에서 함께 박음 (별도 sub-step 분할 X)
- ExtendScript: `app.project.items.addComp(name, w, h, pixelAspect, duration, frameRate)` — 1-based ItemCollection 메서드. mistakes #17 패턴 (this binding) 적용 — `var addCompFn = app.project.items.addComp; addCompFn(...)` 금지, 직접 호출
- **AST validator (D7) 골든셋에 case 1+ 추가** — 새 ExtendScript 코드 패턴 (items.addComp + property access 체인)이 _validateAst.test.ts 골든셋 통과 확인
- mock fixture 확장: ItemCollection.addComp method (receiver guard + items[] push) + 새 CompItem id 할당 로직
- 등록 4 위치 (5.1.8 발견 양쪽 등록 패턴)
- mistakes 적용: #17 (this binding) + #18 (production runtime — 사용자 dogfood 후 description 정확도 검증) + #19 (server.ts single source) + #20 (해당 없음, UX 영역) + Gate §14 (jsx 양쪽 등록)

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

### Phase 5 신규 tool 추가 가이드 (5.1.4~5.1.8 패턴 누적)

**1. sidecar collocation 4파일** (`sidecar/src/tools/<ae_name>/`):
- `schema.ts` — zod input/output (description은 dev annotation only, 5.1.7 fix-2 #19)
- `handler.ts` — `defineAETool` HOF + AENoActiveCompError / AENotFoundError 재사용 (5.1.5 신설)
- `impl.ts` — ExtendScript ES3, types-for-adobe, ASCII only (gate §12), this binding 가드 (5.1.4 fix #17), display name lookup (5.1.7 fix #18)
- `impl.test.ts` — vitest mock-AE, receiver guard 자동 catch

**2. 등록 4 위치** (한 군데라도 누락 = jsx bundle 0 매치 또는 dispatcher unknown tool):
- `sidecar/src/tools/index.ts` — `import { ae_X } from "./ae_X/handler.js"` + `tools` registry entry
- `sidecar/src/mcp/server.ts` — `aeXInputSchema` import + `server.registerTool` block (**production description single source**, 5.1.7 fix-2 #19)
- `src/jsx/aeft/tools/index.ts` — `export { ae_X } from "@aeTools/ae_X/impl"` (alias re-export)
- `src/jsx/aeft/aeft.ts` — named import + tools 객체 literal entry (gate §11, **5.1.8 발견 — index.ts 등록만으로는 부족**)

**3. mock fixture 확장** (필요 시):
- `src/jsx/aeft/tools/_mockApp.ts` — 새 ExtendScript object/method 추가 시 `MockXxxOpts` + `makeMockX` + receiver guard 패턴 (mistakes #17, 30 tool 공통)
- `src/jsx/aeft/tools/_define.ts` — `JsxXxxLike` interface 새 field optional (5.1.5/5.1.6/5.1.7/5.1.8 누적)

**4. dogfood loop**:
- 4파일 → registry 4 위치 → mock fixture → sidecar test +N + panel test 변경 0 → sidecar build green → panel build green → gate §10 (localhost:3000) / §11 (__proto__) / §12 (non-ASCII) 0/0/0 → dist grep (alias 합본 + server.js description block) → commit
- 사용자 dogfood 재검증 (panel reload + 단일 호출 first-attempt + 좀비 0)
- dogfood fail 시 mistakes 신규 entry 등재 후 fix sub-step

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

## K. 재진입 절차 (CLI용 — Phase 5.2.2 진입 첫 명령어)

새 채팅 또는 같은 채팅 재개 시 이 순서로 실행:

```bash
# 1. 컨텍스트 파일 확인 (CLI 자동)
cd "C:/Users/user/Desktop/성윤/에펙 클로드"
git log --oneline | head -10           # 최근: 91549e8 (5.2.1) → fcc7f30 (5.2 update) → 314a2d1 (5.1.9 fix-2)
git status -s                           # eye/ + sidecar/.claude/ untracked만 = clean

# 2. 회귀 테스트 baseline (Gate §8 monorepo 양쪽 build 명시)
source ~/.bashrc && cd sidecar && npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -3 && cd ..
# → sidecar 191/191 그린 + tsc strict 그린

npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -3
# → panel 42/42 그린 + vite build 그린

# 3. 산출물 게이트 (§10/§11/§12/§14)
grep -c "localhost:3000" dist/cep/main/index.html         # → 0 (Gate §10)
node -e "const f=require('fs').readFileSync('dist/cep/jsx/index.js','utf8');const b=require('fs').readFileSync('dist/cep/jsx/index.js');let n=0;for(const c of b){if(c>=0x80)n++;}console.log('__proto__:',(f.match(/__proto__/g)||[]).length);console.log('non-ASCII bytes:',n);console.log('ae_get_project_info:',(f.match(/ae_get_project_info/g)||[]).length);"
# → __proto__: 0 (§11) / non-ASCII bytes: 0 (§12) / ae_get_project_info: 4 (§14 양쪽 등록)

# 4. 5.2.1 production source 검증 (mistakes #19 single source pattern)
node -e "const f=require('fs').readFileSync('sidecar/dist/mcp/server.js','utf8');const start=f.indexOf('server.registerTool(\"ae_get_project_info\"');const end=f.indexOf('return server',start);console.log('block bytes:',f.substring(start,end).length);"
# → block bytes: ~1065 (description single source 박힘)
```

### 다음 진입 명령어 (Phase 5.2.2 ae_create_comp)

```
Phase 5.2.2 진입 — ae_create_comp (write 첫 진입, D4 destructive flag + undoGroup wiring reference example, 컴프 lane 2/3).

5.2.1 ae_get_project_info ✅ 완료 (commit 91549e8). 사용자 dogfood 통과 (또는 dogfood 결과 보고 후 진입).

작업:
1. types-for-adobe AE 22.0 ItemCollection.addComp 시그니처 자율 조사 (name, w, h, pixelAspect, duration, frameRate)
2. sidecar/src/tools/ae_create_comp/ 4파일 collocation
3. **D4 destructive flag 첫 검증** — defineAETool({destructive: true}) flag + handler 내부 app.beginUndoGroup/endUndoGroup 자동 wrap. 사용자 옵션 C 결정 (5.2.2 안에서 함께 박음, 별도 sub-step 분할 X)
4. AST validator (D7) 골든셋 case +1 (items.addComp 패턴)
5. mock fixture 확장 — ItemCollection.addComp method + receiver guard + items[] push + 새 CompItem id 할당
6. 등록 4 위치 (5.1.8 발견 양쪽 등록 패턴 + Gate §14)
7. server.ts description single source (mistakes #19) + ASCII only (Gate §12) + this binding (mistakes #17)
8. sidecar test +N / panel test 42 그대로 / Gate §10/§11/§12/§14 0/0/0/1+
9. 사용자 dogfood 검증 (panel reload + 자연어 "1920x1080 30fps 5초 컴프 만들어줘" → ae_create_comp 호출 → 실제 컴프 생성 + undo group 작동 확인)

추측 fix 금지. ItemCollection.addComp 시그니처 / undoGroup wiring 정확도 / D4 flag 동작 회의 시 보고 후 멈춤.
```

### Phase 5 sub-step 진행 표 (전체)

| sub-phase | tool | type | 상태 | commit |
|---|---|---|---|---|
| 5.1.1 | ae_get_active_comp | R | ✅ baseline | `711fd6d` |
| 5.1.4 | ae_list_comps | R | ✅ MVP 1/5 | `a157ae9` (+`26dd304` fix #17) |
| 5.1.5 | ae_get_layers | R | ✅ MVP 2/5 | `690fcf1` |
| 5.1.6 | ae_list_effects | R | ✅ MVP 3/5 | `2e498a5` |
| 5.1.7 | ae_get_expression | R | ✅ MVP 4/5 | `6ed8f08` (+`1ad3feb` fix #18, +`8909a6e` fix-2 #19) |
| 5.1.8 | ae_get_keyframes | R | ✅ MVP 5/5 | `b206d7a` |
| 5.1.9 | xterm Ctrl+C/V UX | UX | ✅ paste/SIGINT/좀비, copy 보류 | `3ae033b` (+`aff9f85` fix-1 #20 face-1, +`314a2d1` fix-2 #20 face-2) |
| 5.2 update | 사용자 결정 4건 박음 | docs | ✅ | `fcc7f30` |
| **5.2.1** | **ae_get_project_info** | **R** | **✅ 컴프 lane 1/3** | **`91549e8`** |
| 5.2.2 | ae_create_comp | W | ⏳ **다음 진입 대상** (D4 reference) | |
| 5.2.3 | ae_set_active_comp | W | | |
| 5.3.1~5.3.9 | 레이어 lane 9 (모두 W) | W | | |
| 5.4.1~5.4.3 | 키프레임 lane 3 (모두 W) | W | | |
| 5.5.1~5.5.5 | 이펙트 lane 5 (R/R/W/W/W) | R+W | | |
| 5.6.1~5.6.2 | 익스프레션 lane 2 (모두 W) | W | | |
| 5.7.1~5.7.2 | 마커 lane 2 (R/W) | R+W | | |
| 5.8 | ae_run_extendscript | escape | (D3 + D-L) | |

---

## 자주 참조되는 1줄 메모 (chat 도중 빠르게)

- **Phase 4 commit 범위**: `541c759` (4.0) → 4.5 (this commit). 10개. `git log --oneline | grep -E "Phase 4"` 모두 표시.
- **CLAUDE.md Validation Gates 13개**: Security / Undo / Approval / Schema / Pagination / Localhost / Mutex / **Phase exit (monorepo 양쪽 build)** / Script generator / jsx host registration / jsx no-namespace-import / jsx ASCII-only / **Idle scenario**.
- **Out of scope (v1.0 금지)**: Premiere / 모바일 원격 / Skill 시스템 / 음성 / SQLite 채팅 히스토리 / UXP / 모델 ID UI 변경.
- **사용자 작업 패턴**: research → plan annotate → CLI implement sub-step + commit + 한 줄 보고 → 사용자 OK → 다음 sub-step. **추측 fix 금지** — root cause 확정 후 fix 옵션 + 사용자 OK → 코딩.
- **현재 워킹트리 상태**: clean (eye/ + sidecar/.claude/ untracked만). Phase 4 layered fix 4개 모두 commit됨. probe 잔여 0 (sidecar/src 0 매치).
- **메타 학습 — layered dogfood loop**: production wiring first encounter sub-step (Phase 4.4)은 단일 dogfood로 모든 함정 catch 불가능. fix-N 후 다음 dogfood loop에서 다음 layer가 reachable. Phase 5+ 30 tool 추가 시도 같은 패턴 가정.

---

**문서 마지막 갱신**: 2026-05-10 EOD. Phase 5.2.1 ✅ 완료 (`91549e8`, ae_get_project_info read 6 field). 다음 진입 대상 = 5.2.2 ae_create_comp (write 첫 진입, D4 destructive flag + undoGroup wiring reference example).

다음 갱신 시점: 5.2.2 진입 또는 5.2 lane 종료 (5.2.3 후).
