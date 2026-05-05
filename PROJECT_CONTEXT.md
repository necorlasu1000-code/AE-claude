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

**현재 위치 (2026-05-05 EOD)**: **Phase 3.7 follow-up 4 적용** (jsx ASCII-only fix). 사용자 AE 검증 대기 — fix가 root cause를 차단했는지 확정 필요. debug probe 코드는 main.tsx에 잔존 (commit `3a54075`), 검증 후 별도 revert commit으로 제거.

**작업 폴더**: `C:\Users\user\Desktop\성윤\에펙 클로드` (한글 path — 함정 #7)

**진실의 원천**: `plan.md` (전체 비전 + 페이즈 + GSTACK 리뷰), `CLAUDE.md` (코딩 게이트, 12 Validation Gates), `mistakes.md` (영구 학습, 11 함정), 본 문서 (온보딩 인덱스 + 재진입 절차).

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

## C. Architectural Decisions (D1-D11 + Phase 3 D-A~D-G)

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

---

## D. Phase 진행 상태

### ✅ Phase 0-2 완료 (이전, 96 tests)
- Phase 0: 환경 셋업
- Phase 1: 사이드카 foundation (protocol.ts, defineAETool HOF, AST validator + 골든셋)
- Phase 2: 패널 ↔ 사이드카 WS + xterm + cmd.exe + graceful shutdown (96 tests, 9 traps)

### ⏳ Phase 3 — ExtendScript 브릿지 (진행 중, 137 tests)

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
| 3.7 follow-up | jsx host[ns] default-case (BridgeTalk versioned 대비) | `ecd9d2c` | ✅ |
| 3.7 follow-up 2 | `import * as` 제거 (rollup `__proto__: null` 차단) | `a9f2167` | ✅ |
| 3.7 follow-up 3 (debug) | panel inline ExtendScript probe (PROBE_FRAGMENTS 15개) | `3a54075` | ⚠️ **revert 대기** |
| 3.7 follow-up 4 | **jsx ASCII-only literals** (file encoding root cause fix) | `6f9ee9e` | ✅ **검증 대기** |
| **3.8** | 사용자 AE 검증 (시나리오 a/b/c/d) | — | ⏳ **다음** |
| 3.9 | 정리 (debug probe revert + §H 정정 누적 + Phase 3 회고) | — | |

### Phase 4-7 (다음다음 이상)
- Phase 4 — MCP 서버 + claude CLI (PTY 교체 + dispatcher MCP wiring)
- Phase 5 — 30 MCP tool (D8 collocation 패턴 확립 후 lane 분할 병렬)
- Phase 6 — UX (logger.ts, Recent AI ops 카드, status bar 5상태)
- Phase 7 — ZXP 빌드 + GitHub Actions matrix (D9)

---

## E. 11개 발견 함정 (mistakes.md 인덱스)

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
| **10** | **`npm test` 통과만으로 phase 닫음 → production tsc 타입 에러 늦게 발견** | **2 follow-up** | **Validation Gate §8: phase exit = `npm test` AND `npm run build` 둘 다** |
| **11** | **production wiring 시점에 mock/boilerplate/build-tool/source 가정이 ES3 ExtendScript 환경 차이에 시험됨 — 4 faces** | **3.7** | **각 face마다 fix + Gate §9-§12** |

### #11 4-faces (Phase 3.7 wiring 발견 누적)

| Face | 가정 (잘못된) | Production ground truth | Fix | Gate |
|---|---|---|---|---|
| (1) panel script generator | mock 짧은 ns ("ns") | dotted ns ("com.aeclaude.panel") | `$[${JSON.stringify(ns)}].tools.X` bracket notation | §9 |
| (2) jsx host 등록 (future-proof) | boilerplate switch literal 매칭 | versioned `BridgeTalk.appName` 가능성 | switch에 `default: host[ns] = aeft` | §10 |
| (3) rollup namespace import | ESM `__proto__: null` 표준 | ExtendScript SpiderMonkey throw | `import * as` 금지, named imports + 객체 literal | §11 |
| (4) jsx file encoding | UTF-8 (no BOM) source | system codepage 추정 (cp949) → invalid byte throw | jsx layer ASCII only, panel layer가 i18n | §12 |

---

## F. 핵심 파일 구조 (Phase 3.7 산출 반영)

```
C:\Users\user\Desktop\성윤\에펙 클로드\
├── plan.md                              # 비전 + 페이즈 + §14 Phase 2 회고
├── CLAUDE.md                            # 12 Validation Gates + D1-D11 + Karpathy 4원칙
├── mistakes.md                          # 11 함정 영구 학습 (#11이 가장 큰 — 4-faces)
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
│   ├── main.tsx                         # bridge wiring + dev 버튼 + DEBUG probe ⚠️ revert 대기 (3.7 follow-up 3)
│   └── sidecar/
│       ├── launcher.ts + .test.ts       # SidecarLauncher
│       ├── factories.ts                 # production wiring (cwd + 상대 args)
│       ├── useTerminal.ts + .test.ts    # 7-state hook + onUnhandledMessage + sendMessage (Phase 3.7)
│       ├── useExtendScriptBridge.ts + .test.ts  # Phase 3.5 — FIFO + envelope + emit + acorn AST 검증
│       └── TerminalView.tsx             # devSlot prop (Phase 3.7)
│
└── (Phase 7 산출 예정)
    ├── .github/workflows/release.yml    # D9 Win/Mac matrix
    └── evals/golden/
```

---

## G. 통계 (Phase 3.7 follow-up 4 시점)

| 항목 | 수치 |
|---|---|
| Phase 3 commits (3.1 → 3.7 follow-up 4) | 14 |
| 누적 commits (Phase 0 → 현재) | 40+ |
| Sidecar 테스트 | 94 (was 75 in Phase 2) |
| Panel 테스트 | 43 (was 22 in Phase 2) |
| 총 자동 회귀 테스트 | **137** |
| 영구 등재 함정 (mistakes.md) | **11** (was 9) |
| Validation Gates (CLAUDE.md) | **12** (was 7) |
| Architectural decisions | D1-D11 (10) + D-A~D-G (Phase 3, 7) |

---

## H. 재진입 시 즉시 알아야 할 것 (2026-05-06 아침 시작점)

### 현재 상태

**Phase 3.7 follow-up 4 적용 완료 (commit `6f9ee9e`)**: jsx layer ASCII only fix. dist/cep/jsx/index.js non-ASCII byte 0 (was 600). 사용자 AE 검증 대기 중.

### 사용자가 어제 EOD 직전 본 상태

- AE 재시작 후에도 panel load 시 첫 alert: **`TypeError: Cannot convert to ... jsx/index.js`** 발생
- ready 후 몇 초 후 사이드카 crashed (별도 이슈, panel-disconnect grace)
- **probe 결과 `typeof $["com.aeclaude.panel"]` = `"undefined"`** (host[ns] 등록 안 됨)
- polyfill 정상 (`Date.prototype.toJSON = "function"`), BridgeTalk OK
- → 4번째 면 (file encoding) 가설 채택, fix-4 적용

### 사용자가 오늘 아침 해볼 것

1. **AE 완전 재시작** (panel reopen만으론 ExtendScript 캐시)
2. panel 열리면 상단 DEBUG panel + spike 버튼 보이는지 확인
3. **첫 alert 안 뜨는지** — 1차 가설 확정 신호
4. probe 결과 panel UI에서 보고: 특히 `typeof $["com.aeclaude.panel"]` 결과
5. spike 클릭 → `Total: Xms (AE: Yms, WS: Zms)` 녹색 = 풀 round-trip 동작

### 다음 분기

**시나리오 P (검증 통과)**:
- 시나리오 a (정상) ✅
- 시나리오 b (h.fail no active comp) — comp 없는 상태에서 spike → AENoActiveCompError 메시지
- 시나리오 c (5+회 long-running 메모리 누수 0)
- 시나리오 d (latency p95 ≤100ms)
- 모두 통과 → **3.9 정리 진입**:
  - debug probe revert (PROBE_FRAGMENTS / probes state / ProbePanel 제거)
  - PROJECT_CONTEXT.md §H 정정 누적 (3.1 + 3.6 + 3.7 발견)
  - plan.md §14 Phase 3 회고 추가
  - 3.9 commit "Phase 3 complete"

**시나리오 F (검증 fail)**:
- probe 결과로 추가 진단:
  - `$["com.aeclaude.panel"]` 여전히 undefined → 추가 hidden encoding/syntax 원인
  - 또는 다른 throw site
- 옵션 B (UTF-8 BOM 추가) 또는 더 깊은 진단

**별도 이슈 (3.9 또는 별도 phase에서 다룸)**:
- 사이드카 crashed (panel-disconnect grace) 잔존 시 — 진단 필요. 현재 가설: jsx 평가 fail이 panel runtime에 영향? 또는 PanelBridge가 ws.close 받았는데 disconnect grace timer가 발화한 정상 동작.

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

## J. 새 웹 Claude에 보낼 메시지 템플릿 (오늘 아침용)

```
어제 Phase 3.7 follow-up 4 (jsx ASCII-only fix) 적용 후 멈춤. 
오늘 아침 AE 검증 결과 보고:

1. AE 완전 재시작 했음.
2. panel 열렸을 때:
   - 첫 alert (TypeError: Cannot convert to ...): [있다 / 없다]
   - DEBUG panel probe 결과 (특히 핵심 라인):
     typeof $["com.aeclaude.panel"] → [object / undefined / 다른]
     (다른 14개 fragment 결과 한 줄씩 또는 변화 있는 것만)
3. spike 버튼 클릭 결과:
   - 녹색 latency 표시: "Total: Xms (AE: Yms, WS: Zms)"
   - 또는 빨강 에러 코드 + 메시지

PROJECT_CONTEXT.md / mistakes.md / CLAUDE.md / plan.md 모두 EOD 시점 최신.
git log --oneline | head -15 로 commit 추적 가능.

검증 통과 시: 3.9 정리 (debug probe revert + Phase 3 회고) 진입.
검증 fail 시: probe 결과로 추가 진단.
```

---

## K. 재진입 절차 (CLI용 — 오늘 아침 첫 명령어)

새 채팅 또는 같은 채팅 재개 시 이 순서로 실행:

```bash
# 1. 컨텍스트 파일들 빠르게 확인 (CLI 자동)
cd "C:/Users/user/Desktop/성윤/에펙 클로드"
git log --oneline | head -15           # 최근 commits — 어디까지 왔는지
git status -s                           # 깨끗해야 (eye/ untracked만)

# 2. 빌드/sync 정합성 (이전 작업 잔존 검증)
diff -q dist/cep/jsx/index.js \
        "/c/Users/user/AppData/Roaming/Adobe/CEP/extensions/com.aeclaude.panel/jsx/index.js"
# → 출력 0 = sync OK

# 3. 산출물 ASCII-only 검증 (Phase 3.7 follow-up 4 효과 유지)
LC_ALL=C perl -ne 'BEGIN{$c=0} for(split //){$c++ if ord($_)>127} END{print "non-ASCII bytes: $c\n"}' \
  dist/cep/jsx/index.js
# → "non-ASCII bytes: 0" 기대

# 4. 회귀 테스트 (검증이 fail이어서 추가 fix 필요 시)
source ~/.bashrc && cd sidecar && npm test 2>&1 | tail -3 && cd ..
npm test 2>&1 | tail -3
# → sidecar 94/94 + panel 43/43

# 5. 사용자 검증 결과 받으면 분기 (메시지 템플릿 §J 참조)
```

### 검증 통과 시 (3.9 정리 절차)

```bash
# 1. debug probe revert (3a54075의 main.tsx 변경분 되돌림)
#    main.tsx에서 PROBE_FRAGMENTS / probes state / useEffect probe / ProbePanel 제거
#    devSlot은 유지 (3.7 본 산출물의 일부)
#    → 별도 commit "Phase 3.9: revert debug probe (3a54075)"

# 2. PROJECT_CONTEXT.md §H 정정 누적 (3.1 + 3.6 + 3.7 발견 흡수)

# 3. plan.md §14에 Phase 3 회고 sub-section 추가 (Phase 2 회고 패턴 따라):
#    - 통계 (commits, tests, traps)
#    - 발견 + 해결 함정 (#10 + #11 4 faces)
#    - architectural learning (D-A~D-G)
#    - Phase 4 진입 준비 노트

# 4. 최종 commit "Phase 3 complete: ExtendScript bridge end-to-end (137 tests, 2 traps documented)"

# 5. PROJECT_CONTEXT.md 다시 갱신 (Phase 3 ✅ 완료 표시 + Phase 4 다음 status)
```

### 검증 fail 시 (추가 진단 절차)

```bash
# probe 결과를 보고:
# - $["com.aeclaude.panel"] 여전히 undefined → file encoding 외 다른 원인
#   → 옵션 B (UTF-8 BOM 추가) 시도 또는 panel inspector 콘솔 직접 평가
# - $["com.aeclaude.panel"]는 object지만 spike 클릭 시 fail → 다른 layer 문제
#   → useExtendScriptBridge / dispatcher / panelBridge wiring 재점검

# 추가 진단 필요 시:
LC_ALL=C perl -ne '...' dist/cep/jsx/index.js   # 현재 산출물 상태
sed -n 'N,Mp' dist/cep/jsx/index.js              # IIFE 특정 line 확인
```

---

## 자주 참조되는 1줄 메모 (chat 도중 빠르게)

- **Phase 3 commit 범위**: `5c6a177` (3.1) → `6f9ee9e` (3.7 follow-up 4). 14개. `git log --oneline | grep "Phase 3"` 모두 표시.
- **CLAUDE.md Validation Gates 12개**: Security / Undo / Approval / Schema / Pagination / Localhost / Mutex / **Phase exit (build)** / Script generator / jsx host registration / jsx no-namespace-import / jsx ASCII-only.
- **Out of scope (v1.0 금지)**: Premiere / 모바일 원격 / Skill 시스템 / 음성 / SQLite 채팅 히스토리 / UXP / 모델 ID UI 변경.
- **사용자 작업 패턴**: research → plan annotate → CLI implement sub-step + commit + 한 줄 보고 → 사용자 OK → 다음 sub-step.
- **현재 워킹트리 상태**: clean (eye/ untracked만, 사용자 스크린샷 dump). debug probe는 commit `3a54075` + `6f9ee9e`에 박혀있음.

---

## 미세 메모 누적 (3.9 정리 시 흡수)

지금 액션 X, Phase 3.9 정리 commit에서 처리:

- **§H 정정 누적**: 3.1 (`exec/result` 이미 protocol.ts에 있어서 새 type 추가 X) + 3.6 (panelBridge 양방향 — Phase 1이 단방향만 의도된 단계적 진화) + 3.7 (jsx file encoding 함정) → §H 통합 정정 commit.
- **PROJECT_CONTEXT.md "use prefix" 표기**: 일부 진짜 React hook (useTerminal), 일부 순수 factory (useExtendScriptBridge). 각 jsdoc에 표기.
- **PROJECT_CONTEXT.md namespace import 의식 부재** (3.1 발견 시 의도된 단계적 진화) — 함정 등재 X, §H 메모 흡수.
- **debug probe (3a54075) revert**: main.tsx에서 PROBE_FRAGMENTS / probes state / probe useEffect / ProbePanel 제거. devSlot은 본 산출물이라 유지.
- **3.6 dispatcher 미래 메모**: timeoutMs default 30s를 protocol.ts DEFAULT_TIMEOUT_MS 상수로 박음 (이미 적용 ✅).

---

**문서 마지막 갱신**: 2026-05-05 EOD. Phase 3.7 follow-up 4 commit (`6f9ee9e`) 직후. 사용자 AE 검증 대기 중.

다음 갱신 시점: 검증 통과 후 3.9 commit과 같이.
