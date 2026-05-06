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

**현재 위치 (2026-05-06)**: **Phase 3 ✅ 완료**. 사용자 AE 검증 시나리오 a/b/c/d 모두 통과 (round-trip 6ms, 5분+ idle 안정, 메모리 누수 0, AENoActiveCompError 정확). debug probe revert 완료 (3.9 part 1). **Phase 4 (MCP 서버 + claude CLI PTY) 진입 대기.**

**작업 폴더**: `C:\Users\user\Desktop\성윤\에펙 클로드` (한글 path — 함정 #7)

**진실의 원천**: `plan.md` (전체 비전 + 페이즈 + GSTACK 리뷰 + §14 Phase 2 회고 + §15 Phase 3 회고), `CLAUDE.md` (코딩 게이트, 13 Validation Gates), `mistakes.md` (영구 학습, 12 함정), 본 문서 (온보딩 인덱스 + 재진입 절차).

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
| D-J | PanelBridge multi-role | 단일 ws server에 role "panel" + "mcp" 두 종류 허용. primary/secondary 정책은 role 안에서. **backward compat 강제** (role 미명시 default "panel", Phase 2/3 16 시나리오 그린 유지). role 식별 메커니즘 = 4.1 시작 전 추가 결정 (a sys.identify / b WS subprotocol / c URL query). |
| D-K | claude 출력 채널 분리 | chat = PTY raw → ws → xterm. MCP = stdio JSON-RPC (D-I 별도 entry). 사이드카 main에서 두 채널 만나지 않음. PTY parsing 0. |

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

### Phase 4-7 (다음 이상)
- **Phase 4** ⏳ — MCP 서버 + claude CLI (PTY 교체 + dispatcher MCP wiring) — **다음 진입 대상**
- Phase 5 — 30 MCP tool (D8 collocation 패턴 확립 후 lane 분할 병렬)
- Phase 6 — UX (logger.ts, Recent AI ops 카드, status bar 5상태)
- Phase 7 — ZXP 빌드 + GitHub Actions matrix (D9)

---

## E. 12개 발견 함정 (mistakes.md 인덱스)

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
| **12** | **`sys.heartbeat` 단방향 broadcast + 양방향 watchdog 모순 → panel idle ~35s 후 사이드카 자체 shutdown** | **3.7 follow-up 5** | **useTerminal.ts router에 echo case + Gate §13 (idle scenario gate)** |

### #11 4-faces (Phase 3.7 wiring 발견 누적)

| Face | 가정 (잘못된) | Production ground truth | Fix | Gate |
|---|---|---|---|---|
| (1) panel script generator | mock 짧은 ns ("ns") | dotted ns ("com.aeclaude.panel") | `$[${JSON.stringify(ns)}].tools.X` bracket notation | §9 |
| (2) jsx host 등록 (future-proof) | boilerplate switch literal 매칭 | versioned `BridgeTalk.appName` 가능성 | switch에 `default: host[ns] = aeft` | §10 |
| (3) rollup namespace import | ESM `__proto__: null` 표준 | ExtendScript SpiderMonkey throw | `import * as` 금지, named imports + 객체 literal | §11 |
| (4) jsx file encoding | UTF-8 (no BOM) source | system codepage 추정 (cp949) → invalid byte throw | jsx layer ASCII only, panel layer가 i18n | §12 |

probe 결과 (3a54075)로 face (2)는 `BridgeTalk.appName === "aftereffects"` literal 반환 확인 — fix-2가 실제 root cause 아님. fix-2는 future-proof safety net으로 유지.

---

## F. 핵심 파일 구조 (Phase 3.7 산출 반영)

```
C:\Users\user\Desktop\성윤\에펙 클로드\
├── plan.md                              # 비전 + 페이즈 + §14 Phase 2 회고 + §15 Phase 3 회고
├── CLAUDE.md                            # 13 Validation Gates + D1-D11 + Karpathy 4원칙
├── mistakes.md                          # 12 함정 영구 학습 (#11 4-faces + #12 heartbeat)
├── PROJECT_CONTEXT.md                   # 본 파일
├── eye/                                 # 사용자 스크린샷 dump (gitignored 아님, untracked)
│
├── sidecar/                             # Node.js 사이드카
│   ├── .nvmrc = 20                      # 함정 #2 방어
│   └── src/
│       ├── index.ts                     # 부팅 + dispatcher lazy back-ref wiring (Phase 3.7)
│       ├── protocol.ts                  # D6 typed envelope + Phase 3.1 jsdoc
│       ├── pty/, ws/, lifecycle/        # Phase 2 산출
│       ├── ws/panelBridge.ts            # 양방향 라우팅 + onToolResponse + sendToPrimary (Phase 3.6)
│       ├── dispatcher/                  # Phase 3.6 신규
│       │   ├── toolDispatcher.ts        # createToolDispatcher (request_id + timeout + cancel + latency)
│       │   └── toolDispatcher.test.ts   # 13 cases
│       ├── tools/                       # Phase 1 + 향후 Phase 5
│       │   ├── _define.ts, _errors.ts, _validateAst.ts + .test.ts (Phase 1)
│       └── __integration__/             # Phase 2/3 통합 테스트
│           └── integration-dispatcher.test.ts (Phase 3.6, in-process)
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

## G. 통계 (Phase 3 complete 시점)

| 항목 | 수치 |
|---|---|
| Phase 3 commits (3.1 → 3.9 part 3) | 17 |
| 누적 commits (Phase 0 → 현재) | 43+ |
| Sidecar 테스트 | 95 (was 75 in Phase 2, +20) |
| Panel 테스트 | 44 (was 22 in Phase 2, +22) |
| 총 자동 회귀 테스트 | **139** (was 96 in Phase 2, +43) |
| 영구 등재 함정 (mistakes.md) | **12** (was 9, +3) |
| Validation Gates (CLAUDE.md) | **13** (was 7, +6: §8/§9/§10/§11/§12/§13) |
| Architectural decisions | D1-D11 (10) + D-A~D-G (Phase 3, 7) |

---

## H. 재진입 시 즉시 알아야 할 것 (Phase 3 complete, Phase 4 진입 대기)

### 현재 상태

**Phase 3 ✅ 완료** (2026-05-06, commit `a40acc4` part 1 → part 3 시점). 사용자 AE 검증 시나리오 a/b/c/d 모두 통과 + heartbeat fix로 5분+ idle 유지 확인. **Phase 4 (MCP 서버 + claude PTY) 진입 대기.**

### 검증된 실측치

- Round-trip latency: 6ms (AE 5ms, WS 1ms) — 목표 ≤100ms 대비 **16배 여유**
- Idle 안정성: 5분+ idle 후 사이드카 살아있음 (heartbeat bidirectional echo 작동)
- 메모리 누수: 10회 spike 클릭 변화 0
- 에러 path: AENoActiveCompError 5ms (코드 + latency 정확)
- Production 산출물: localhost:3000 0매치 / `__proto__` 0매치 / non-ASCII 0

### Phase 3에서 흡수된 정정 (3.1 + 3.6 + 3.7 발견)

이전 PROJECT_CONTEXT.md / plan.md / 작업 가설에 있던 부정확한 표현이 실제 작업 중 정정된 항목:

1. **"Phase 3은 새 envelope 타입 추가"** → 사실 `exec`/`result`/`error`는 Phase 1 protocol.ts에 사전 존재. Phase 3.1은 jsdoc만 추가 (ExtendScript bridge envelope으로의 의미 부여). 신규 타입 0.
2. **"panelBridge 양방향 라우팅 의식 부재"** → Phase 1은 단방향 (panel → sidecar)을 의도된 단계로 구현. Phase 3.6에서 sidecar → panel 확장 + `onToolResponse` 추가. **결함 아닌 단계적 진화.**
3. **"ns 형식 가정 (panel script generator)"** → mock 짧은 ns + dotted ns 형식 차이가 production wiring 첫 등장에서 발화. Bracket notation `$[ns]`로 통일 + jsx layer 영어 literal 통일 (file encoding fix). Gate §9/§12로 영구 박힘.

### Phase 4 진입 readiness

**Phase 4 = MCP 서버 + claude CLI PTY 통합.** 다음 sub-step 분할 권장 (3.x 패턴 답습):

- 4.1 MCP server skeleton (사이드카에 stdio MCP server start) — claude CLI 없이 dispatcher만 노출
- 4.2 claude PTY 교체 (cmd.exe → claude CLI) — Phase 2의 PTY 인프라 그대로 사용
- 4.3 첫 tool MCP 노출 (`ae_get_active_comp`) — dispatcher.exec 경유 검증
- 4.4 production wiring + 사용자 검증

**Phase 4 진입 시 챙길 것 (mistakes.md 인덱스)**:
- #4 ConPTY tree kill 재검증 (claude CLI 자식 프로세스)
- #2 Node 24 좀비 (node-pty native ABI)
- #3 .cmd shim (`process.execPath` + entry .mjs 직접 spawn 패턴 유지)
- #11 4-faces — production wiring sub-step에서 비슷한 함정 재발 가능성 (idle scenario Gate §13 강제)
- D3 `ae_run_extendscript` per-call approval modal — 첫 tool로 도입 시 D3 + AST validator 골든셋 동시 검증

### Phase 3 이슈 정리 (모두 해소)

- ~~사이드카 crashed (panel-disconnect grace) 잔존~~ → **함정 #12로 등재 + Phase 3.7 follow-up 5에서 해결** (heartbeat echo).
- ~~debug probe revert 대기~~ → **Phase 3.9 part 1에서 revert 완료** (commit `a40acc4`).
- ~~plan.md §14 Phase 3 회고 추가~~ → **§15 신설 완료** (commit `e448bf0`).

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

## J. 새 웹 Claude에 보낼 메시지 템플릿 (Phase 4 진입용)

```
Phase 3 완료 (commit a40acc4 → part 3까지). 사용자 검증 a/b/c/d 모두 통과.
- round-trip 6ms (목표 100ms 대비 16배 여유)
- 5분+ idle 안정 (heartbeat fix 작동)
- mistakes.md 12 함정 / Validation Gates 13개 / 139 tests

Phase 4 (MCP 서버 + claude CLI PTY 통합) 진입.

요청 사항:
- Phase 4 sub-step 분할 합의 (4.1 MCP skeleton → 4.2 claude PTY → 4.3 첫 tool 노출 → ...)
- 또는 사용자가 정의한 sub-step 순서가 있으면 그것 따라.

진입 전 챙길 mistakes (#4 ConPTY tree kill / #2 Node 24 ABI / #3 .cmd shim /
#11 4-faces 재발 / Gate §13 idle scenario).

D3 ae_run_extendscript per-call approval은 Phase 4 첫 tool로 도입할지 별도?

PROJECT_CONTEXT.md / mistakes.md / CLAUDE.md / plan.md (§15 Phase 3 회고) 모두 최신.
git log --oneline | head -20 로 Phase 3 sub-step + follow-up + 3.9 part 1-3 모두 추적 가능.
```

---

## K. 재진입 절차 (CLI용 — Phase 4 진입 첫 명령어)

새 채팅 또는 같은 채팅 재개 시 이 순서로 실행:

```bash
# 1. 컨텍스트 파일들 빠르게 확인 (CLI 자동)
cd "C:/Users/user/Desktop/성윤/에펙 클로드"
git log --oneline | head -20           # Phase 3 sub-step + follow-up + 3.9 part 1-3 추적
git status -s                           # 깨끗해야 (eye/ untracked만)

# 2. Phase 3 산출물 정합성 (Phase 4 시작 전 baseline)
diff -q dist/cep/jsx/index.js \
        "/c/Users/user/AppData/Roaming/Adobe/CEP/extensions/com.aeclaude.panel/jsx/index.js"
# → 출력 0 = sync OK

# 3. Phase 3 산출물 게이트 (§10/§11/§12 효과 유지)
grep -c "localhost:3000" dist/cep/main/index.html         # → 0 (production build)
grep -c "__proto__" dist/cep/jsx/index.js                  # → 0 (Gate §11)
LC_ALL=C perl -ne 'BEGIN{$c=0} for(split //){$c++ if ord($_)>127} END{print "non-ASCII bytes: $c\n"}' \
  dist/cep/jsx/index.js                                    # → "non-ASCII bytes: 0" (Gate §12)

# 4. 회귀 테스트 baseline (Phase 4 sub-step 시작 전 그린 확인)
source ~/.bashrc && cd sidecar && npm test 2>&1 | tail -3 && cd ..
npm test 2>&1 | tail -3
# → sidecar 95/95 + panel 44/44 = 139/139

# 5. Phase 4 sub-step 합의 후 진입 (메시지 템플릿 §J 참조)
```

### Phase 4 sub-step 진입 권장 순서

```bash
# 4.1 MCP server skeleton (사이드카 stdio MCP server start)
#    - dispatcher.exec를 MCP tool로 노출 (claude CLI 없이 standalone 검증 가능)
#    - 별도 commit "Phase 4.1: MCP server skeleton + dispatcher tool exposure"

# 4.2 claude PTY 교체 (cmd.exe → claude CLI)
#    - mistakes #4 (ConPTY tree kill) 재검증 — claude 자식 프로세스 cleanup
#    - mistakes #2 (Node 24 ABI) 재검증
#    - mistakes #3 (.cmd shim) — claude CLI도 .cmd shim일 수 있음

# 4.3 첫 tool MCP 노출 (ae_get_active_comp)
#    - claude CLI에서 MCP tool 호출 → dispatcher → panel WS exec → ExtendScript → result
#    - 풀 round-trip 검증

# 4.4 production wiring + 사용자 검증 (idle scenario Gate §13 포함)
```

---

## 자주 참조되는 1줄 메모 (chat 도중 빠르게)

- **Phase 3 commit 범위**: `5c6a177` (3.1) → 3.9 part 3 (this commit). 17개. `git log --oneline | grep -E "Phase 3"` 모두 표시.
- **CLAUDE.md Validation Gates 13개**: Security / Undo / Approval / Schema / Pagination / Localhost / Mutex / **Phase exit (build)** / Script generator / jsx host registration / jsx no-namespace-import / jsx ASCII-only / **Idle scenario** (§13 신설).
- **Out of scope (v1.0 금지)**: Premiere / 모바일 원격 / Skill 시스템 / 음성 / SQLite 채팅 히스토리 / UXP / 모델 ID UI 변경.
- **사용자 작업 패턴**: research → plan annotate → CLI implement sub-step + commit + 한 줄 보고 → 사용자 OK → 다음 sub-step.
- **현재 워킹트리 상태**: clean (eye/ untracked만, 사용자 스크린샷 dump). debug probe는 commit `3a54075` + `6f9ee9e`에 박혀있고 `a40acc4` (3.9 part 1)에서 revert됨.

---

**문서 마지막 갱신**: 2026-05-06. Phase 3 complete (3.9 part 3 commit과 함께). Phase 4 진입 대기.

다음 갱신 시점: Phase 4 sub-step 진행하면서 EOD 또는 phase exit.
