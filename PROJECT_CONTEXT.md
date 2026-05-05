# PROJECT_CONTEXT.md — AE-Claude Panel Onboarding

> 새로운 Claude 인스턴스가 5분 안에 컨텍스트를 잡고 Phase 3에 즉시 합류하기 위한 단일 진입 문서.
> 의사결정 게이트 + 함정 회피 + 즉시 사용 가능한 인프라 인덱스.

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

**현재 위치**: Phase 2 완료 (2026-05-05), **Phase 3 진입 직전**.
**작업 폴더**: `C:\Users\user\Desktop\성윤\에펙 클로드` (한글 path — 함정 #7 참조)
**진실의 원천**: `plan.md` (전체 비전 + 페이즈 + GSTACK 리뷰), `CLAUDE.md` (코딩 게이트), `mistakes.md` (영구 학습), 본 문서 (온보딩 인덱스)

---

## B. 사용자 (Operator) 정보

- 한국 영상 PD/감독 + 개발자. 의사결정 + 사용자 검증 담당. **Claude Code CLI가 실제 코딩 실행**.
- **터스(terse) 한국어 선호**. 영어 키워드는 그대로 두기 (예: "Phase 2 통과 OK").
- **추측 fix 싫어함** — 빨강 테스트 → 진단 → 빨강 테스트 → 초록 사이클 강제. Karpathy 원칙 4 (Goal-Driven Execution).
- **"Stop when confused" 원칙** — 막히면 우회/창의적 해결 시도 전에 사용자에게 보고. 추측으로 fragile fix 금지.
- **결정 게이트마다 명시적 OK 신호 받기**. "다음 phase 진입 OK" / "이 fix OK" 같은 한 줄 컨펌 후에만 진행.
- 한 phase 끝마다 commit + 한 줄 보고 + 멈춤. 다음 진입 별도 신호.
- 매 단위 작업은 mistakes.md에 영구 등재 (root cause + fix + 예방 + 검증). 재학습 0이 목표.

**커뮤니케이션 패턴**:
- 짧은 보고 선호. 끝맺음 1-2 문장 (변경 + 다음 단계).
- 결정 필요 시 옵션 제시 + 추천 + 이유 + 트레이드오프 1줄. 결정은 사용자가 한다.
- 작업 도중 새 발견 → 즉시 보고. 진행 우선 후 보고 X.

---

## C. Architectural Decisions (D1–D11, **D10 없음 — 점프됨**)

10개 결정 모두 lock-in. 변경 시 사용자 OK 필수.

| # | Topic | Decision | 코드에서 의미 |
|---|---|---|---|
| D1 | Approach | In-Panel Terminal + Sidecar (full integration) | xterm 패널 임베드, 외부 터미널 의존 X |
| D2 | Review mode | HOLD SCOPE | 신규 기능 추가 금지 — plan.md §1-13 범위 내에서만 |
| D3 | `ae_run_extendscript` 안전 | per-call approval + AST allow-list | escape hatch는 사용자 승인 + AST 통과 후만 |
| D4 | Undo + crash recovery | tool당 1 undoGroup + 세션 시작 자동저장 + 5 tool마다 incremental save | 모든 destructive tool은 `defineAETool` HOF wrapping |
| D5 | Packaging | self-signed ZXP + Node 바이너리 동봉 | 인터넷 의존 없는 첫 실행, ZXPInstaller 우회 |
| D6 | WS 프로토콜 | typed envelope (discriminated union) + request_id + cancel/progress/chunking/heartbeat | `sidecar/src/protocol.ts` single source of truth |
| D7 | AST validator | acorn + adversarial test suite (30+ injection 골든셋) | jsx 패턴은 validator 통과해야 |
| D8 | Tool 코드 조직 | per-tool collocation: `tools/<ae_name>/{schema,handler,impl.jsx,test}` | tool 추가 = 1 디렉토리 추가, 도메인별 분할 금지 |
| D9 | Distribution | portable Node 20 + node_modules + GitHub Actions Win/Mac matrix | `pkg`/`bun --compile`/SEA 사용 금지 |
| ~D10~ | (점프됨) | — | — |
| D11 | First-run onboarding | auto-detect + inline progress + 실패 시만 다이얼로그 | 4-step wizard 금지, 1초 내 "Ready" |

**참고**: D10이 없는 건 의도된 것. plan.md GSTACK REVIEW REPORT 섹션 참조.

---

## D. Phase 진행 상태

### ✅ Phase 0 — 환경 셋업 (완료)
- bolt-cep boilerplate (React + Vite + TS), regedit `PlayerDebugMode=1`, AE script 권한
- 빈 패널이 AE에 뜨는지 확인 완료

### ✅ Phase 1 — 사이드카 foundation (완료)
- `sidecar/src/protocol.ts` — D6 typed envelope, panel/sidecar 양쪽 import (single source of truth)
- `sidecar/src/tools/_define.ts` — `defineAETool` HOF (D4 undo group + crash recovery wrapping)
- `sidecar/src/tools/_validateAst.ts` + `_validateAst.test.ts` — D7 AST validator + 30+ adversarial 골든셋 (constructor / __proto__ / callee / caller / prototype 우회 차단)
- `sidecar/src/tools/_errors.ts` — `AEError` 서브클래스 (code/userMessage/developerHint 트리플)

### ✅ Phase 2 — 패널 ↔ 사이드카 연결 (완료 2026-05-05, 96 tests)
- `sidecar/src/pty/ptyHost.ts` — node-pty + ConPTY tree kill (taskkill /F /T) + 8s hard cap
- `sidecar/src/ws/panelBridge.ts` — primary client + multi-client refusal + heartbeat + chunking + sys.shutdown + disconnect grace timer (5s)
- `sidecar/src/lifecycle/lockfile.ts` + `watchdog.ts` — 단일 인스턴스 강제 + AE death watchdog (부모 PID 폴링, 3s 후 self-shutdown)
- `sidecar/src/index.ts` — 부팅, lockfile, ready file, gracefulShutdown
- `src/js/main/sidecar/launcher.ts` — `child_process.spawn` 사이드카 spawn + ready signal + sendShutdownOverWs
- `src/js/main/sidecar/factories.ts` — production wiring (cwd: SIDECAR_ROOT + 상대 args)
- `src/js/main/sidecar/useTerminal.ts` — 7-state machine (idle/starting/ready/closing/stopped/crashed/error), xterm + WS routing
- `src/js/main/sidecar/TerminalView.tsx` — xterm UI wrapper
- 검증: 시나리오 a(cmd.exe 진입) / b(dir 한글 출력) / c(resize) / d(echo 한글) / e(panel close 좀비 0) 모두 ✅

### ⏳ Phase 3 — ExtendScript 브릿지 (다음)
- 사이드카가 `{type:"tool.exec", tool, input}` WS 전송 → 패널이 `evalScript(jsx함수())` 호출 → 결과 `{type:"tool.result", ...}`로 회신
- 첫 spike tool: `ae_get_active_comp` (read-only, side-effect 없음 — Phase 4 MCP 전 검증)
- ES3 polyfill (`src/jsx/_polyfills/json2.js`) 합본 — JSON 사용 보장
- AST validator 통과 패턴만 jsx 합본
- 검증: 왕복 latency ≤100ms, 에러 path (jsx throw → AEError 변환), 5+회 long-running 후 메모리 누수 0

### Phase 4 (다음다음) — MCP 서버 + claude CLI
- `@modelcontextprotocol/sdk` stdio MCP 서버를 사이드카에 추가
- PTY를 cmd.exe → `claude --model claude-opus-4-7`로 교체
- 첫 endpoint tool `ae_get_active_comp`을 MCP로 노출 → 패널에서 "현재 컴프 알려줘" 자연어 → tool 호출

### Phase 5 — 30 MCP tool (collocation 패턴 확립 후 병렬)
- MVP 5 tool 먼저 (D8 패턴 굳힘) → 나머지 25 tool lane 분할 병렬

---

## E. 9개 발견 함정 (mistakes.md 인덱스)

각 함정은 mistakes.md에 root cause + fix + 예방 + 검증으로 영구 등재. 재학습 0.

| # | 함정 한 줄 | Phase | 해결 메커니즘 |
|---|---|---|---|
| 1 | bash non-interactive에서 `.bashrc` 자동 source 안 됨 | 0 | `BASH_ENV` setx 영구 등록 + 명령 prefix `source ~/.bashrc &&` |
| 2 | `npm install`이 시스템 Node 24로 빌드 (fnm 미발동) | 0 | `sidecar/.nvmrc=20` + `source ~/.bashrc &&` 명령 prefix |
| 3 | Node 20.12+ `spawn` EINVAL on `.cmd` (CVE-2024-27980) | 2.5.1 | `process.execPath` + `tsx/dist/cli.mjs` 직접 spawn |
| 4 | ConPTY가 SIGTERM/SIGKILL 모두 무시 (12s hang) | 2.5.4 | OS-level tree kill (`taskkill /F /T`) + 8s hard cap |
| 5 | Windows `process.kill` SIGTERM = TerminateProcess (graceful 불가) | 2.5.5 | WS-level `sys.shutdown` 메시지 신설 |
| 6 | bolt-cep `npm run dev` ENOENT (`dist/cep/main/index.html`) | 2.6 | `mkdir -p dist/cep/main` 사전 생성 |
| 7 | spawn shell:true + Windows 한글/공백 path → cmd.exe args 잘림 | 2.8.4 | spawn `cwd: SIDECAR_ROOT` + 상대 경로 args |
| 8 | React StrictMode가 useTerminal 두 번 invoke → 사이드카 double-spawn race | 2.8.4 | `<React.StrictMode>` 제거 (CEP에선 SSR/concurrent 무관) |
| 9 | Panel close → React unmount async cleanup이 못 끝나 `sys.shutdown` 미도달 → 사이드카 좀비 | 2.8.4 | PanelBridge disconnect grace timer (5s) → self-shutdown |

**아키텍처 학습 (Phase 2 결산)**:
- 사이드카 종료 경로 4개: `sys.shutdown` (명시적) / AE death watchdog / panel-disconnect grace / OS tree kill. **단일 경로 의존 금지** — Phase 4+에서 claude CLI 추가해도 이 다중 경로 유지.
- Windows spawn shell:true → 항상 cwd + 상대 경로 페어링.
- CEP panel runtime은 fnm hook 없음 — production은 portable Node 동봉 (D9), dev는 시스템 Node.

---

## F. 핵심 파일 구조

```
C:\Users\user\Desktop\성윤\에펙 클로드\
├── plan.md                              # 비전 + 페이즈 + GSTACK 리뷰 + §14 Phase 2 회고
├── CLAUDE.md                            # 코딩 게이트 (Karpathy 4원칙 + D1-D11 + Validation Gates 7개)
├── mistakes.md                          # 영구 학습 로그 (9 entries)
├── PROJECT_CONTEXT.md                   # 본 파일 (새 Claude 온보딩)
├── package.json, vite.config.ts, ...    # bolt-cep + 우리 추가
│
├── sidecar/                             # Phase 2 산출 — Node.js 사이드카
│   ├── .nvmrc = 20                      # 함정 #2 방어
│   └── src/
│       ├── index.ts                     # 부팅 + lockfile + watchdog + gracefulShutdown wiring
│       ├── protocol.ts                  # D6 typed envelope (panel과 공유, single source of truth)
│       ├── pty/
│       │   ├── ptyHost.ts               # node-pty + ConPTY tree kill (#4 fix)
│       │   └── ptyHost.test.ts
│       ├── ws/
│       │   ├── panelBridge.ts           # primary client + heartbeat + sys.shutdown + disconnect grace (#9 fix)
│       │   └── panelBridge.test.ts      # 13 시나리오
│       ├── lifecycle/
│       │   ├── lockfile.ts + .test.ts   # 단일 인스턴스
│       │   └── watchdog.ts + .test.ts   # AE death detect
│       ├── tools/                       # Phase 1 산출 + Phase 5에서 ae_*/* 추가 예정
│       │   ├── _define.ts               # defineAETool HOF (D4)
│       │   ├── _errors.ts               # AEError 서브클래스
│       │   ├── _validateAst.ts          # D7 AST validator
│       │   └── _validateAst.test.ts     # 30+ 골든셋
│       └── __integration__/             # 통합 테스트 (74 sidecar 테스트 중 일부)
│
├── src/js/main/                         # CEP panel React 앱
│   ├── index-react.tsx                  # entry — StrictMode 제거됨 (#8 fix)
│   ├── main.tsx                         # App — createPanelDeps + useTerminal + TerminalView
│   ├── jsdom-env.test.ts                # 환경 sanity
│   └── sidecar/
│       ├── launcher.ts + .test.ts       # SidecarLauncher class (DI 주입 가능)
│       ├── factories.ts                 # production wiring (cwd + 상대 args, #7 fix)
│       ├── useTerminal.ts + .test.ts    # 7-state hook + xterm + WS router
│       └── TerminalView.tsx             # xterm UI wrapper
│
├── src/jsx/                             # ExtendScript (ES3, types-for-adobe)
│   ├── aeft/                            # AE-specific entry (Phase 3에서 확장)
│   ├── lib/, utils/
│   └── (Phase 3 추가 예정: _polyfills/json2.js + tools/*/impl.jsx 합본)
│
├── tests/_helpers/                      # mock-AE WebSocket fixture (Phase 5용 준비)
│
└── (Phase 7 산출 예정)
    ├── .github/workflows/release.yml    # D9 Win/Mac matrix
    └── evals/golden/                    # LLM eval suite
```

---

## G. 통계 (Phase 2 완료 시점)

| 항목 | 수치 |
|---|---|
| Commits (Phase 0 → Phase 2.8.4 fix-3) | 30+ (Phase 2만 26개) |
| Sidecar 자동 테스트 | 74 |
| Panel 자동 테스트 | 22 |
| 총 자동 회귀 테스트 | **96** |
| 영구 등재 함정 (mistakes.md) | **9** |
| Architectural decisions 추가 | 0 (D1–D11 사전 확정 유지) |

---

## H. Phase 3 진입 시 즉시 알아야 할 것

### 첫 작업

**ExtendScript 브릿지 정립** — WS message router에 새 envelope 타입 (`tool.exec` / `tool.result`) 추가 + 패널이 받아서 `evalScript()` 호출 + 결과 회신. 첫 endpoint tool `ae_get_active_comp` (read-only).

설계 요약:

```
사이드카 (테스트용 가짜 호출 또는 Phase 4 MCP)
   │  WS  {type: "tool.exec", request_id, tool: "ae_get_active_comp", input: {}}
   ▼
panelBridge.ts (Phase 2 자산, 새 핸들러만 추가)
   │
   ▼
useTerminal.ts WS message router (새 case 추가)
   │
   ▼
CSInterface.evalScript("aeft.tools.ae_get_active_comp(JSON.stringify(input))")
   │
   ▼ ExtendScript (ES3, jsx 합본)
   │
   ▼ JSON.stringify(result)  ← _polyfills/json2.js 의존
   │
   ▼ panel으로 콜백
   │
   ▼ panelBridge로 다시 송신
   │  WS  {type: "tool.result", request_id, ok: true, output: {...}}
   ▼
사이드카가 request_id로 매칭 → resolve
```

### 사용 가능한 인프라 (Phase 2 자산 — 새로 만들 필요 없음)

- **`protocol.ts`**: typed envelope. Phase 3은 `ToolExecMsg` / `ToolResultMsg` 타입만 추가, 기존 sys.* / pty.* 유지.
- **`panelBridge.ts`**: primary client + request_id 라우팅 완비. 새 메시지 타입 핸들러만 추가.
- **`useTerminal.ts`** (또는 별도 hook): WS message router 패턴 확립됨. `tool.exec` 수신 → `evalScript` 호출 → `tool.result` 송신 path 추가.
- **`defineAETool` HOF**: D4 (undo group + crash recovery)에 자동 wiring. Phase 3 첫 tool도 이 HOF 통과.
- **`_validateAst.ts`**: jsx 코드 합본 전 검증 (이미 D7 골든셋 30+ 통과). 새 jsx 패턴은 이걸 통과해야.
- **`AEError`**: `code` / `userMessage` / `developerHint` 트리플. jsx에서 throw → AEError로 변환.

### 주의사항 (mistakes.md에서 미리 챙길 것)

1. **ExtendScript ES3 한계** — `JSON.stringify` 없음. `src/jsx/_polyfills/json2.js` 빌드 합본 필수.
2. **AST validator (D7)** — `system.callSystem` / `File` / `Folder` / `Socket` / `eval` / `Function` / `#include` / computed member access 절대 금지. 새 jsx 패턴은 `_validateAst.test.ts` 골든셋과 동일 룰로 사전 검증.
3. **`evalScript` 콜백 reference 누수** — long-running 5+ 호출 후 메모리 그래프 확인 (Phase 3 spike에서 측정).
4. **Mutex gate (P4)** — ExtendScript single-threaded. 동시 `evalScript` 호출 금지. 패널 측 큐는 FIFO.
5. **왕복 latency ≤100ms** — Phase 3 검증 기준 (plan.md §8).
6. **구조화 로그** — `console.log` 직접 X, `~/.ae-claude-panel/logs/{date}.jsonl` JSON line. (CLAUDE.md Coding conventions 참조)
7. **localhost gate** — WS binding `127.0.0.1` only. `0.0.0.0` 절대 X.

### 사용자 작업 패턴

사용자는 다음 흐름으로 일한다:
1. **research.md 또는 GSTACK 리뷰 산출** — 요건 + 트레이드오프 정리
2. **plan.md 업데이트** — phase 단위 산출물 + 검증 명세
3. **annotate** — phase 안에 sub-step 분할 (예: "2.8.4 fix-3")
4. **implement** — Claude Code CLI가 sub-step 1개씩 진행 + commit + 한 줄 보고
5. **사용자 검증** — 매 phase 끝에 사용자가 시나리오 직접 실행 (AE 같은 외부 의존 시스템). 통과 후 "phase 통과 OK" 신호.
6. **다음 phase 진입은 별도 OK** — 진행 우선 후 사용자 알리기 X.

---

## I. 작업 환경

| 항목 | 값 | 메모 |
|---|---|---|
| OS | Windows 11 Home (10.0.26200) | |
| Shell | Git Bash (Unix syntax) + PowerShell (가능) | bash 명령은 unix 경로 (`/dev/null`, forward slash) |
| Node 매니저 | fnm | system Node 24 / project Node 20 |
| Node (system) | v24.13.1 | panel runtime이 픽업하는 것 (Phase 2 dev) |
| Node (sidecar 강제) | v20 (`sidecar/.nvmrc=20`) | npm install + 테스트 실행 시 |
| BASH_ENV | `C:\Users\user\.bashrc` (setx 영구) | 함정 #1 방어 — 모든 npm/test 명령 `source ~/.bashrc &&` prefix 권장 |
| 프로젝트 path | `C:\Users\user\Desktop\성윤\에펙 클로드` | 한글 + 공백 — 함정 #7 (spawn cwd로 회피) |
| Editor | VS Code 미설치. Claude Code CLI가 직접 파일 수정 | 사용자가 vim/nano 같은 인터랙티브 편집기 안 씀 |
| AE 버전 | (사용자가 직접 검증, 버전 미기록 — Phase 검증 시 확인 가능) | CSInterface 11.x 전제 (PlayerDebugMode CSXS.11) |
| Git | 로컬 only (Phase 7 전엔 remote 없음) | commit 메시지: 영어 + 한국어 혼용 OK |
| Test runner | vitest (sidecar + panel 별도 config) | jsdom env (panel) + node env (sidecar) |

**Bash 명령 예시 (정확한 패턴)**:

```bash
# 사이드카 테스트 (Node 20 강제)
source ~/.bashrc && cd "C:/Users/user/Desktop/성윤/에펙 클로드/sidecar" && npm test

# 패널 테스트 (Node 20도 OK)
source ~/.bashrc && cd "C:/Users/user/Desktop/성윤/에펙 클로드" && npm test

# 둘 다 동시 (sidecar 끝나야 panel 시작 — 의존성)
source ~/.bashrc && cd sidecar && npm test && cd .. && npm test
```

---

## J. 새 웹 Claude에 보낼 메시지 템플릿

**사용자가 새 채팅창에 붙여넣을 첫 메시지**:

```
Phase 3 진입한다.

프로젝트 컨텍스트 전체는 `C:\Users\user\Desktop\성윤\에펙 클로드\PROJECT_CONTEXT.md`에 있어.
먼저 그 파일 읽고, 필요시 mistakes.md / plan.md / CLAUDE.md 참조해서
Phase 3 (ExtendScript 브릿지) 설계 요약부터 보여줘.

설계 보여주고 멈춰. 내가 OK 신호 줄 때까지 코딩 시작 X.

작업 패턴:
- 결정 게이트마다 옵션 + 추천 + 트레이드오프 1줄 → 내 OK 후 진행
- sub-step 1개 끝마다 commit + 한 줄 보고 + 멈춤
- 막히면 추측 fix 금지, 즉시 보고
- 회귀 테스트 매번 (sidecar 74 + panel 22 = 96) green 유지

CLAUDE.md 게이트 + mistakes.md 9개 함정 영구 박혀있으니 우회/재학습 0 목표.
```

---

## 자주 참조되는 1줄 메모 (chat 도중 빠르게 봐야 할 것들)

- **Phase 2 commit 범위**: `Phase 2.0` (32ff696) → `Phase 2 complete` (047b8c9). `git log --oneline | grep -i phase` 하면 26개 다 나옴.
- **CLAUDE.md Validation Gates 7개**: Security / Undo / Approval / Schema / Pagination / Localhost / Mutex.
- **Out of scope (v1.0 금지)**: Premiere / 모바일 원격 / Skill 시스템 / 음성 / SQLite 채팅 히스토리 / UXP 마이그레이션 / 모델 ID UI 변경. 필요해 보이면 사용자 확인 먼저.
- **Skill routing** (Claude Code 내부 슬래시 명령): `/plan-eng-review` (아키텍처) / `/cso` (보안) / `/investigate` (버그) / `/review` (코드 리뷰) / `/ship` → `/land-and-deploy` (릴리즈) / `/context-save`+`/context-restore` (세션 저장/재개).

---

**문서 마지막**: 2026-05-05, Phase 2 완료 직후. Phase 3 진입 시 이 문서 + plan.md §14 회고 + mistakes.md 9 entries 면 충분.

다음 phase 진입 시 본 문서 끝에 Phase 3 진행 표시 + 새 함정 (있다면) 인덱스 추가 예정.
