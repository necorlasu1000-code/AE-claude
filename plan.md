# AE-Claude Panel — Plan

After Effects 패널 안에 Claude Code CLI 터미널을 띄우고, MCP를 통해 자연어로 AE를 조작하는 CEP 확장.

---

## 1. 목표

- AE의 `Window > Extensions > AE-Claude` 메뉴로 패널 호출
- 패널 내부에 완전한 인터랙티브 터미널 (xterm.js)
- 그 터미널에서 `claude` CLI(Opus 4.7) 자동 실행
- Claude가 등록된 MCP tool로 현재 AE 프로젝트를 직접 조작 (컴프 생성, 레이어 추가, 키프레임, 이펙트, 익스프레션, 마커, 렌더 큐 등)
- 사용자는 채팅만 — 별도 터미널/외부 IDE 불필요

---

## 2. 아키텍처

```
┌─ After Effects ───────────────────────────────────────────┐
│                                                            │
│  ┌─ CEP Panel (React + Vite) ──────────────────────────┐  │
│  │                                                       │ │
│  │  xterm.js (터미널 UI)                                 │ │
│  │       ▲                                               │ │
│  │       │ WebSocket (stdio bridge)                     │ │
│  │       ▼                                               │ │
│  │  CSInterface.evalScript() ◀─── ExtendScript 실행 콜  │ │
│  │       │                                               │ │
│  │       ▼                                               │ │
│  │  ExtendScript (jsx) → AE 직접 조작                   │ │
│  └──────────┬───────────────────────▲────────────────────┘ │
│             │                        │                      │
└─────────────┼────────────────────────┼──────────────────────┘
              │                        │
   WebSocket  │                        │ WebSocket
  (PTY I/O)   │                        │ (run-script 요청)
              ▼                        │
       ┌──────────────────────────────────┐
       │  Sidecar Node.js Process          │
       │  (CEP가 system.callSystem으로 기동)│
       │                                    │
       │  ┌─ PTY Host (node-pty) ────────┐  │
       │  │   spawn: claude --model       │  │
       │  │          claude-opus-4-7      │  │
       │  └───────────────────────────────┘  │
       │                                    │
       │  ┌─ MCP Server (FastMCP/SDK) ───┐   │
       │  │   stdio transport             │   │
       │  │   tools: ae.*                 │   │
       │  │   ↓ tool 호출 시 ↓            │   │
       │  │   WebSocket → CEP Panel       │   │
       │  │   → ExtendScript 결과 회신    │   │
       │  └───────────────────────────────┘   │
       └────────────────────────────────────┘
                       │
                       │ stdio
                       ▼
                   claude CLI (자식 프로세스)
```

**왜 사이드카 분리:**

- CEP 11/12의 내장 Node는 15라 `node-pty` prebuilt 안 맞음 → 별도 Node.js 프로세스가 안전
- MCP 서버는 stdio로 `claude`에 붙어야 하므로 PTY host와 같은 프로세스에 두는 게 깔끔
- AE UI 블로킹 회피 (Node 사이드카가 무거운 작업 전담)
- 향후 CLI를 외부 터미널이나 모바일에서도 붙일 수 있음 (확장성)

---

## 3. 기술 스택

### CEP 패널 (Frontend)

| 라이브러리                 | 용도                                                       |
| -------------------------- | ---------------------------------------------------------- |
| **bolt-cep**               | CEP 보일러플레이트 (Vite + React + TS, ZXP 패키징, evalTS) |
| **@xterm/xterm**           | 터미널 렌더러                                              |
| **@xterm/addon-fit**       | 패널 리사이즈 시 터미널 자동 핏                            |
| **@xterm/addon-web-links** | 출력 안의 URL 클릭 가능                                    |
| **@xterm/addon-webgl**     | GPU 가속 렌더링                                            |
| **types-for-adobe**        | ExtendScript AE 타입 정의                                  |
| **CSInterface.js**         | CEP ↔ ExtendScript 브릿지 (Bolt 내장)                     |

### 사이드카 (Backend Node.js)

| 라이브러리                    | 용도                                      |
| ----------------------------- | ----------------------------------------- |
| **node-pty**                  | PTY 스폰 (claude CLI를 의사터미널에 띄움) |
| **@modelcontextprotocol/sdk** | MCP 서버 구현                             |
| **ws**                        | CEP 패널 ↔ 사이드카 WebSocket            |
| **zod**                       | MCP tool input 스키마                     |
| **execa**                     | 보조 child_process 호출                   |

### 패키징

- **Bolt CEP의 ZXP 빌드 스크립트** (`yarn zxp`)
- **ZXPInstaller** (사용자가 설치할 때 사용)
- 사이드카 Node 바이너리는 ZXP에 포함하거나 첫 실행 시 다운로드

---

## 4. 참고할 기존 프로젝트

> 직접 fork 아님. 아키텍처와 코드 패턴만 학습 후 새로 빌드.

| 레포                             | 참고 포인트                                            |
| -------------------------------- | ------------------------------------------------------ |
| `hyperbrew/bolt-cep`             | 패널 셸 전체 구조 (이게 베이스)                        |
| `hodor/ae-mcp`                   | MCP ↔ WebSocket ↔ CEP 패턴 — 가장 가까운 레퍼런스 ⭐ |
| `Dakkshin/after-effects-mcp`     | 기본 tool 셋, mcp-bridge-auto.jsx 패턴                 |
| `tigerm/adobe-after-effects-mcp` | 이펙트/키프레임/마커 tool 확장                         |
| `Aodaruma/after-effects-mcp-rs`  | Rust 버전 — 깔끔한 tool 네이밍 컨벤션                  |
| `microsoft/node-pty`             | Windows ConPTY API 사용 예제                           |
| `xtermjs/xterm.js`               | 터미널 + addon 셋업                                    |

특히 **hodor/ae-mcp의 `run_script` + WebSocket 구조**가 본 프로젝트 핵심 통신 패턴과 동일하므로 통신 로직은 이걸 표준으로 삼고, 그 위에 PTY/Claude CLI 통합을 얹는다.

---

## 5. 디렉토리 구조

```
ae-claude-panel/
├── cep.config.ts                    # Bolt CEP 설정 (panel id, AE host)
├── package.json
├── vite.config.ts
├── src/
│   ├── js/
│   │   └── main/
│   │       ├── index.html
│   │       ├── index.tsx            # React 진입점
│   │       ├── App.tsx              # 메인 패널 (xterm + 상태)
│   │       ├── terminal/
│   │       │   ├── TerminalView.tsx # xterm.js 래퍼
│   │       │   └── useTerminal.ts   # PTY WS 연결 hook
│   │       ├── sidecar/
│   │       │   └── launcher.ts      # 사이드카 spawn (CSInterface로)
│   │       └── ws/
│   │           └── jsxBridge.ts     # 사이드카에서 온 run_script 요청 처리
│   └── jsx/
│       ├── index.ts                 # ExtendScript 진입점
│       └── aeft/
│           ├── aeft.ts              # 모든 AE tool 함수 export
│           ├── comp.ts              # 컴프 관련
│           ├── layer.ts             # 레이어
│           ├── effect.ts            # 이펙트
│           ├── keyframe.ts          # 키프레임
│           ├── expression.ts        # 익스프레션
│           ├── render.ts            # 렌더 큐
│           └── project.ts           # 프로젝트 메타
├── sidecar/                          # 별도 Node.js 프로세스
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 # 진입점 (PTY + MCP + WS 동시 기동)
│       ├── pty/
│       │   └── ptyHost.ts           # node-pty로 claude CLI 스폰
│       ├── mcp/
│       │   ├── server.ts            # MCP 서버 셋업 (stdio)
│       │   └── tools/
│       │       ├── comp.ts
│       │       ├── layer.ts
│       │       ├── effect.ts
│       │       ├── keyframe.ts
│       │       ├── render.ts
│       │       └── runScript.ts     # 범용 ExtendScript 실행 (escape hatch)
│       ├── ws/
│       │   └── panelBridge.ts       # CEP 패널과 WebSocket
│       └── utils/
│           └── claudeMcpRegister.ts # claude mcp add 자동 호출
├── docs/
│   ├── architecture.md
│   ├── extending-tools.md
│   └── troubleshooting.md
└── plan.md                           # 이 문서
```

---

## 6. MCP Tool 카탈로그 (1차 구현)

모든 tool 이름은 `ae_*` 프리픽스로 통일. 기본 ID 기반 타겟팅 (compId/layerId).

### 프로젝트 / 컴프

- `ae_get_project_info` — 프로젝트 메타 (FPS, 해상도, 컴프 수)
- `ae_list_comps` — 모든 컴프 목록
- `ae_create_comp` — 새 컴프 (name, w, h, fps, duration, bgColor)
- `ae_get_active_comp` — 현재 활성 컴프 정보
- `ae_set_active_comp` — 활성 컴프 변경

### 레이어

- `ae_list_layers` — 컴프 안의 레이어 목록
- `ae_add_solid_layer` — 솔리드 추가
- `ae_add_text_layer` — 텍스트 (font, size, color, position)
- `ae_add_shape_layer` — rect/ellipse/star/polygon
- `ae_add_null_layer`
- `ae_add_adjustment_layer`
- `ae_set_layer_property` — 위치/회전/스케일/불투명도/앵커
- `ae_duplicate_layer`
- `ae_delete_layer`
- `ae_reorder_layer`

### 키프레임 / 애니메이션

- `ae_set_keyframe` — 특정 시간에 프로퍼티 키 설정
- `ae_get_keyframes` — 레이어/프로퍼티의 모든 키 조회
- `ae_set_keyframe_easing` — easyEaseIn/Out, custom bezier
- `ae_remove_keyframe`

### 이펙트

- `ae_list_available_effects` — 설치된 이펙트 카탈로그
- `ae_apply_effect` — 레이어에 이펙트 추가 (matchName 기반)
- `ae_describe_effect` — 이펙트 파라미터 메타
- `ae_set_effect_property` — 이펙트 파라미터 값 변경
- `ae_remove_effect`

### 익스프레션

- `ae_set_expression` — 프로퍼티에 익스프레션 적용
- `ae_get_expression`
- `ae_remove_expression`

### 마커 / 음원

- `ae_add_marker`
- `ae_list_markers`
- `ae_audio_to_markers` — 오디오 피크 자동 마커화 (waveform 분석)

### 임포트 / 익스포트

- `ae_import_file` — 파일 임포트
- `ae_add_to_render_queue` — 렌더 큐 추가
- `ae_set_render_settings`
- `ae_start_render`

### Escape Hatch

- `ae_run_extendscript` — 임의 ExtendScript 실행 (Claude가 직접 코드 작성하는 케이스)

각 tool은 zod 스키마 + 상세 description. Claude가 정확히 사용하도록 description에 example 포함.

---

## 7. 주요 통신 시퀀스

### 7-1. 패널 부팅

1. 사용자가 AE에서 `Window > Extensions > AE-Claude` 클릭
2. CEP 패널 로드 → `index.tsx` 진입
3. `launcher.ts`가 ExtendScript의 `system.callSystem()`으로 사이드카 Node 프로세스 기동
4. 사이드카가 다음을 동시 시작:
   - WebSocket 서버 (포트 자동 할당, 패널에 통보)
   - MCP stdio 서버
   - `claude mcp add ae-mcp ...` 자동 등록 (이미 등록돼 있으면 skip)
   - PTY로 `claude` CLI 스폰 (`--model claude-opus-4-7`)
5. 패널이 WebSocket 연결 → xterm.js와 PTY I/O 양방향 바인딩
6. 사용자에게 Claude CLI 프롬프트 표시

### 7-2. 사용자 채팅 → AE 조작

1. 사용자가 xterm에 "현재 컴프에 페이드인 만들어줘" 입력
2. xterm `onData` → WebSocket → 사이드카 PTY → claude CLI stdin
3. Claude가 MCP tool 호출 결정 (`ae_get_active_comp` → `ae_set_keyframe` x2)
4. MCP stdio로 사이드카 MCP 서버에 tool call 전달
5. 사이드카가 WebSocket으로 패널에 `{type: "exec", script: "..."}`전송
6. 패널이 `evalTS("setKeyframe", {...})`로 ExtendScript 실행
7. AE가 실제로 키프레임 추가
8. 결과 JSON이 반대로 거슬러 사이드카 → MCP → Claude → PTY → xterm 출력

### 7-3. 종료

- 패널 닫힘 이벤트 → 사이드카에 SIGTERM
- 사이드카가 PTY와 MCP 정리 후 종료

---

## 8. 구현 단계 (Phase별)

### Phase 0: 환경 셋업

- `yarn create bolt-cep ae-claude-panel` (React + TS + AE 선택)
- regedit `PlayerDebugMode=1` (CSXS.11)
- AE에서 "Allow Scripts to Write Files and Access Network" 활성
- `yarn dev` 동작 확인 (빈 패널이 AE에 뜨는지)

### Phase 1: 사이드카 프로토타입 (AE 무관)

- `sidecar/`에 별도 Node 프로젝트 생성
- node-pty로 그냥 `bash` 또는 `cmd` 스폰
- WebSocket 서버 띄우고, Node CLI 클라이언트로 PTY I/O 송수신 검증
- 단독으로 `node sidecar/dist/index.js` 실행해서 동작 확인

### Phase 2: 패널 ↔ 사이드카 연결 ✅ (완료 2026-05-05)

- 패널에 xterm.js 마운트
- CSInterface로 사이드카 spawn
- WebSocket으로 PTY I/O 바인딩
- `bash` 스폰해서 패널에서 `ls` 같은 명령 입력 → 결과 보이는지 확인
- resize 동작 (`@xterm/addon-fit` + `pty.resize()`)
- (Windows에선 cmd.exe 스폰. Phase 4에서 claude CLI로 교체)
- **검증**: 시나리오 a~e 모두 ✅ — cmd.exe 자동 진입, dir 한글 출력, 한글 echo, resize, 좀비 0
- **상세 회고는 §14 참조**

### Phase 3: ExtendScript 브릿지 정립

- 사이드카에서 WebSocket으로 `{type:"exec", script:"app.project.numItems"}` 전송
- 패널이 받아서 `evalScript()` → 결과 회신
- 왕복 latency 측정, 에러 핸들링

### Phase 4: MCP 서버 + Claude CLI

- 사이드카에 `@modelcontextprotocol/sdk` MCP 서버 추가 (stdio)
- 첫 tool: `ae_get_project_info` (Phase 3 브릿지 사용)
- 사이드카 부팅 시 `claude mcp add` 자동 실행
- node-pty로 `claude --model claude-opus-4-7` 스폰
- 패널에서 "현재 프로젝트 정보 알려줘" → Claude가 tool 호출 → 응답

### Phase 5: 핵심 tool 구현 (30 MCP tool + D8 collocation)

Sub-step 분할 (결정 게이트 5.0 → MVP 5 직렬 → 25 병렬 lane → escape hatch 마지막). 5.1은 fine-grained로 5.1.0/5.1.1/5.1.2/5.1.3 분할 — collocation alias 도입 / 첫 tool 이동 / 좀비 fix / architecture refactor 순.

- **5.0** ✅ 결정 게이트 D-L/D-M/D-N lock-in (2026-05-07, `0d06ea7`)
- **5.1** ⏳ MVP 5 tool 직렬 — collocation 패턴 확립
  - **5.1.0** ✅ vite-cep-plugin alias config (옵션 B) — `@aeTools` → `sidecar/src/tools/` rollup alias dormant 등록 (`7977d27`)
  - **5.1.1** ✅ `ae_get_active_comp` D-M 단순 이동 (옵션 A + C) — `sidecar/src/tools/ae_get_active_comp/{schema.ts, handler.ts(stub), impl.ts, impl.test.ts}` + alias first encounter + CLAUDE.md D8 표 sync (`711fd6d`)
  - **5.1.2** ✅ 좀비 fix (mistakes #16) — D-J multi-role grace timer 회귀, panel-only count gate (`87226ae`)
  - **5.1.3** ✅ Architecture refactor — handler.ts (defineAETool wrap) + `AENoActiveCompError` 클래스 (글로벌 _errors.ts) + tools registry (sidecar/src/tools/index.ts) + `makeDispatcherExecHandler` 확장 (registry lookup + ctx.panelExec wiring) + mcp/server.ts inputSchema 명시 (`ecae373`)
  - **5.1.4** ✅ `ae_list_comps` (read-only, MVP 1/5 컴프 lane) — D8 4파일 collocation 첫 신규 tool 적용. `JsxProjectLike` 추출 + `_mockApp.ts` items[] 확장 (30 tool 누적 reference 패턴 시작) (`a157ae9`)
  - **5.1.4 fix** ✅ mistakes #17 — ExtendScript this-binding 강제 dogfood 발견. impl.ts `project.item!(i)` 직접 호출 + `_mockApp.ts` receiver guard (30 tool 공통 mock policy) + regression case (`26dd304`)
  - **5.1.5** ✅ `ae_get_layers` (read-only, MVP 2/5 레이어 lane) — 4파일 collocation + `AENotFoundError` 클래스 신설 (글로벌, 30 tool 재사용 family) + `JsxLayerLike`/`JsxCompItem.layer` 추출 + `_mockApp.ts` `makeMockLayer` + `comp.layer` receiver guard + `project.itemByID` mock + `Object.prototype.toString` reflection (Layer subclass 분류) (`690fcf1`)
  - **5.1.6** ✅ `ae_list_effects` (read-only, MVP 3/5 이펙트 lane) — 4파일 collocation + `JsxPropertyLike` / `JsxPropertyGroupLike` 추출 + `JsxLayerLike.property` optional + `makeMockEffect` / `makeMockEffectsParade` + Effect Parade try/catch 우회 (Camera/Light/Null layer fail mode) + layerIndex 사전 검증 (AENotFoundError 재사용) + 6 cases (`2e498a5`)
  - **5.1.7** ✅ `ae_get_expression` (read-only, MVP 4/5 익스프레션 lane) — 4파일 collocation + `JsxPropertyLike` 확장 (expression?/expressionEnabled? optional) + `makeMockProperty` helper + `MockLayerOpts.properties` map + propertyMatchName not-found → AENotFoundError 재사용 + 7 cases (`6ed8f08`)
  - **5.1.7 fix** ✅ mistakes #18 — schema description vs production AE 동작 차이. dogfood 발견 (claude first-attempt fail × 5 → retry 회복). `propertyMatchName` → `propertyName` 인자명 변경 + description 정정 (display-name lookup 명시) + mock `properties` map jsdoc 정정 (KEYED BY DISPLAY NAME) + 회귀 case 1개 (matchName-shaped input → AENotFoundError, display-name → 성공) (본 commit)
  - **5.1.8** ⏳ `ae_get_keyframes` (MVP 5/5 키프레임 lane reference example)
- **5.2~5.5** 25 tool 병렬 lane (D-N 그룹 5개, D8 덕분에 lane 충돌 0)
  - 5.2 컴프 / 5.3 레이어 / 5.4 키프레임 / 5.5 이펙트 (익스프레션은 분배)
  - tool 개별 명세는 5.2 진입 시 별도 합의
  - 매 5 tool마다 dogfood loop + idle scenario Gate §13 확인
- **5.6** `ae_run_extendscript` 도입 (D3 + D-L)
  - 29 tool 패턴 누적 후 escape hatch 위에 얹기
  - AST validator 골든셋 (D7) + approval modal (in-panel, ESC=Reject, D11) + `needsApproval: true` flag (유일)

각 tool은 collocation 4파일 (schema/handler/impl/impl.test) + dispatcher 통과 round-trip 검증 + golden case 1+ + integration test. 단위 테스트는 mock-AE → tool 호출 → 실제 AE 상태 변화 확인.

### Phase 6: UX 다듬기

- 패널 상단에 상태 바 (사이드카 연결, MCP 연결, claude 실행 중 표시)
- "Restart Claude" / "Clear Terminal" 버튼
- 다크/라이트 테마 자동 적용 (AE 테마 동기화)
- 폰트 (JetBrains Mono / D2Coding)
- 로그 패널 (debug 모드)

### Phase 7: 패키징 / 배포

- `yarn zxp`로 ZXP 빌드
- 사이드카 Node.js 바이너리 동봉 (Node 20 portable)
- README + 설치 가이드
- aescripts 형식 ZXP installer 호환 확인
- (선택) GitHub Actions로 자동 릴리스

---

## 9. 알려진 위험 / 대응

| 위험                                                | 대응                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| CEP의 Node 버전 불일치로 node-pty 빌드 실패         | 사이드카 분리로 회피 (이게 본 설계의 핵심 이유)                           |
| Windows ConPTY와 ANSI 시퀀스 미스매치               | xterm.js의 conpty 호환 모드 + Windows 11 / Win10 1809+ 전제               |
| ExtendScript 동기 실행 → AE UI 블로킹               | 무거운 작업은 청크로 분할, 진행 상황 WebSocket으로 스트리밍               |
| `claude mcp add`가 stdio MCP를 매번 재등록          | 사용자 홈의 `.claude.json` 직접 검사 후 idempotent하게 등록               |
| Claude가 잘못된 ExtendScript 호출 → AE 크래시       | 모든 tool 함수에 try/catch + 결과 검증, `ae_run_extendscript`는 위험 명시 |
| AE 프로젝트 미저장 상태에서 자동화 실행 → 작업 손실 | 첫 tool 호출 직전에 "auto-save before AI ops" 옵션 (기본 ON)              |
| WebSocket 포트 충돌                                 | 0번 포트 바인딩 후 OS 할당 포트를 패널에 전달                             |
| 사이드카가 좀비로 남음                              | 패널 unload 이벤트 + 사이드카 heartbeat (10초 timeout)                    |

---

## 10. 미래 확장

- **Premiere Pro 지원** — 사이드카 그대로 두고 CEP 패널만 PPRO host용 manifest 추가 (Bolt CEP는 멀티호스트 지원)
- **모바일/원격 접속** — 사이드카가 이미 WebSocket이라 인증만 추가하면 외부 접속 가능 (cf. Claude Code Remote)
- **Skill 시스템** — `/skills/` 폴더에 자주 쓰는 워크플로우 (예: "유튜브 인트로 자막 일괄 생성") 마크다운으로 저장, 사이드카가 시스템 프롬프트에 자동 주입
- **로컬 히스토리** — 모든 채팅과 실행한 ExtendScript를 SQLite에 저장 → 재현/롤백
- **음성 입력** — Web Speech API로 패널 안에서 마이크 → claude CLI stdin

---

## 11. MVP 정의 (1주차 목표)

다음이 모두 동작하면 MVP 완료:

1. AE에서 `Window > Extensions > AE-Claude` 패널 열림
2. 패널에 터미널 보이고 자동으로 `claude` 프롬프트 진입
3. "1920x1080 30fps 컴프 만들어줘" 입력 시 실제로 컴프 생성됨
4. "그 컴프에 빨간 솔리드 레이어 넣어줘" → 실제로 들어감
5. "그 솔리드 0초~1초 페이드인" → 키프레임 적용됨

---

## 12. 시작 명령

```bash
# 1. 보일러플레이트
yarn create bolt-cep ae-claude-panel
cd ae-claude-panel
# (대화형: AE만 선택, React, TypeScript)

# 2. 사이드카 폴더
mkdir -p sidecar/src/{pty,mcp/tools,ws,utils}
cd sidecar && yarn init -y
yarn add node-pty ws @modelcontextprotocol/sdk zod
yarn add -D typescript tsx @types/node @types/ws

# 3. 패널에 xterm
cd .. && yarn add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-webgl

# 4. CEP 디버그 모드 (Windows)
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f

# 5. 개발 시작
yarn dev   # AE 켜고 Window > Extensions > AE-Claude
```

---

## 13. 다음 액션

Phase 0~1을 한 번에 묶어서 Claude Code CLI에 던질 수 있는 프롬프트 작성. (이 plan.md를 컨텍스트로 첨부)

---

## 14. Phase 2 회고 (2026-05-05)

**Phase 2 완료**: AE의 CEP 패널이 사이드카 Node.js 프로세스를 spawn → WebSocket으로 PTY I/O bridging → xterm.js로 cmd.exe 인터랙션. Phase 3 (ExtendScript 브릿지)의 모든 전제 충족.

### 통계

| 항목                                | 수치                      |
| ----------------------------------- | ------------------------- |
| Commit 수 (Phase 2.0 → 2.8.4 fix-3) | 26                        |
| 사이드카 테스트                     | 74 (Phase 2 시작 시 0)    |
| 패널 테스트                         | 22 (Phase 2 시작 시 0)    |
| 총 자동 회귀 테스트                 | 96                        |
| 발견 + 영구 박힌 함정 (mistakes.md) | 9                         |
| Architectural decisions 추가        | 0 (D1–D11 사전 확정 유지) |

### 발견 + 해결된 함정 9개 (mistakes.md 영구 등재)

| #   | 함정                                                                                        | Phase       | Fix 메커니즘                                                    |
| --- | ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| 1   | bash non-interactive에서 .bashrc 자동 source 안 됨                                          | 0           | BASH_ENV setx 영구 등록                                         |
| 2   | sidecar npm install이 시스템 Node 24로 빌드 (fnm 미발동)                                    | 0           | `sidecar/.nvmrc=20` + 설치 명령에 `source ~/.bashrc &&` prefix  |
| 3   | Node 20.12+ spawn EINVAL on .cmd files (CVE-2024-27980)                                     | 2.5.1       | `process.execPath` + tsx/dist/cli.mjs 직접                      |
| 4   | ConPTY가 SIGTERM/SIGKILL 모두 무시 (12s hang)                                               | 2.5.4       | tree kill (taskkill /F /T) + 8s hard cap                        |
| 5   | Windows process.kill SIGTERM = TerminateProcess (graceful 불가)                             | 2.5.5.0     | WS-level `sys.shutdown` 메시지 신설                             |
| 6   | bolt-cep `npm run dev` ENOENT (`dist/cep/main/index.html`)                                  | 2.6         | `mkdir -p dist/cep/main` 사전 생성 (또는 `npm run build` 1회)   |
| 7   | spawn shell:true + Windows path-with-space/한글 → cmd.exe args 파싱 잘림                    | 2.8.4 fix-1 | spawn cwd: SIDECAR_ROOT + 상대 경로 args                        |
| 8   | React StrictMode가 useTerminal heavy side-effect 두 번 invoke → 사이드카 double-spawn race  | 2.8.4 fix-2 | `<React.StrictMode>` 제거 (CEP에선 SSR/concurrent 무관)         |
| 9   | CEP panel close → React unmount async cleanup이 못 끝나 sys.shutdown 미도달 → 사이드카 좀비 | 2.8.4 fix-3 | PanelBridge disconnect grace timer (5s default) → self-shutdown |

**패턴**: 모든 함정의 root cause가 "추측 → 빨강 테스트 → 진단 → 빨강 테스트 추가 → 초록"의 TDD 사이클로 해소됨. Karpathy 원칙 4 (Goal-Driven Execution)의 적용 효과.

### Architectural learning

- **Multi-trigger graceful shutdown**: Phase 2 끝나면서 사이드카는 4가지 종료 경로 보유 — (1) WS `sys.shutdown` (사용자 명시 close), (2) AE death watchdog (Phase 2.5.6, 부모 PID 폴링), (3) PanelBridge disconnect grace (Phase 2.8.4 fix-3, 5s 후 자동), (4) OS-level tree kill (Phase 2.5.4, hang 시). 단일 경로 의존하지 말 것 — Phase 4의 claude CLI 추가 시 이 다중 경로가 안전망.
- **Windows shell:true 항상 상대 경로 + cwd 페어링**: `process.execPath`나 fnm 절대 경로보다 cwd 기반이 portability 높음. spawn-helper.ts (test) + factories.ts (production) 모두 이 패턴.
- **CEP panel runtime은 fnm hook 없음**: panel runtime의 `child_process.spawn("node")`는 시스템 PATH를 그대로 픽업. 향후 production ZXP 배포 시 portable Node 동봉 (D9)이 정답 — dev에서는 시스템 Node 사용.

### Phase 3 진입 준비

Phase 3 = "ExtendScript 브릿지 정립" — 사이드카가 WS로 `{type:"exec", tool, input}` 전송 → 패널이 `evalScript()`로 ExtendScript 호출 → 결과 회신.

**Phase 2 자산 활용**:

- `sidecar/src/protocol.ts` — D6 typed envelope. Phase 3은 `tool.exec` / `tool.result` envelope 추가만 (기존 sys._ / pty._ 와 통합).
- `sidecar/src/ws/panelBridge.ts` — primary client + request_id 라우팅이 이미 완비. Phase 3은 새 메시지 타입 핸들러만 추가.
- `src/js/main/sidecar/useTerminal.ts` — WS message router 패턴 확립. Phase 3은 `tool.exec` 수신 → `evalScript` 호출 → `tool.result` 송신 path 추가.
- `defineAETool` HOF (Phase 1 확립) — Phase 3 첫 엔드투엔드 tool (`ae_get_active_comp`)이 이 HOF를 통과해서 D4 (undo group + crash recovery)에 자동 wiring.

**Phase 3 진입 시 주의 (mistakes.md에서 미리 챙길 것)**:

- ExtendScript는 ES3. JSON 사용 시 `_polyfills/json2.js` (D8 디렉토리 규칙). vite로 합본 빌드.
- `evalScript` 콜백 reference 누수 위험 — Phase 3 spike에서 long-running 5+ 호출 후 메모리 그래프 확인.
- AST validator (Phase 1 D7) 검증된 패턴만 jsx로 합본. `system.callSystem` / `File` / `Folder` / `Socket` / `eval` / `Function` / `#include` / computed member access 금지.
- 왕복 latency 목표 ≤ 100ms (plan §8 Phase 3 검증 기준).

**Phase 4-5 미리 alert (mistakes.md에 등재된 follow-up)**:

- Phase 4 PTY 교체 시 #4 (ConPTY tree kill) 재검증 — claude CLI가 자식 프로세스 띄우면 tree kill로 모두 정리되는지.
- Phase 4 첫 spawn 후 #2 (Node 24 좀비) 재발 가능성. node-pty native module이 panel runtime이 spawn한 Node 버전과 ABI 일치하는지 확인.
- Phase 5 tool 추가 시 D8 (per-tool collocation) + D7 (AST validator 골든셋 통과) + D4 (`defineAETool` HOF) 일관 적용.

---

## 15. Phase 3 회고 (2026-05-06)

**Phase 3 완료**: 사이드카 ↔ 패널 ↔ ExtendScript 브릿지 production wiring. AE에서 사용자 spike 버튼 클릭 → `ae_get_active_comp` round-trip **6ms** (Phase 3 검증 기준 ≤100ms 대비 16배 여유). 1분+ idle 후 사이드카 살아있음 (heartbeat bidirectional echo). Phase 4 (MCP + claude PTY) 전제 모두 충족.

### 통계

| 항목                                | 수치                          |
| ----------------------------------- | ----------------------------- |
| Commit 수 (Phase 3.1 → 3.9 part 3)  | 17                            |
| 사이드카 테스트                     | 95 (Phase 3 시작 시 74, +21)  |
| 패널 테스트                         | 44 (Phase 3 시작 시 22, +22)  |
| 총 자동 회귀 테스트                 | 139 (Phase 3 시작 시 96, +43) |
| 발견 + 영구 박힌 함정 (mistakes.md) | 3 (#10, #11, #12) — 누적 12   |
| Architectural decisions 추가        | 0 (D1–D11 사전 확정 유지)     |
| Validation Gates 추가               | 6 (§8 phase exit + §9–§13)    |

### 발견 + 해결된 함정 3개 (mistakes.md 영구 등재)

| #   | 함정                                                                                                | Phase                   | Fix 메커니즘                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| 10  | `npm test` 통과만으로 phase 닫음 → production tsc strict + vite build에서 에러 늦게 발견            | Phase 2 → 3 진입 시점   | Gate §8 신설: phase exit 전 npm test + npm run build 둘 다 그린                                          |
| 11  | production ES3 ExtendScript + Windows host 차이가 build-tool/source 가정과 부딪침 (4 faces)         | Phase 3.7 ~ follow-up 4 | Gate §9–§12 신설 (panel script generator / jsx host registration / no namespace import / jsx ASCII-only) |
| 12  | `sys.heartbeat` 단방향 broadcast + 양방향 watchdog 모순 → panel idle ~35s 후 사이드카 자체 shutdown | Phase 3.7 follow-up 5   | useTerminal.ts router에 echo case 추가 + Gate §13 (idle scenario gate)                                   |

### #11의 네 면 통합 정리

함정 #11은 Phase 3.7 production wiring 첫 등장 시점에 **연속 4번 발화** — 각 face가 별개 root cause처럼 보이지만 같은 메타 패턴.

| 면 (commit)                                | 잘못된 가정                                          | production ground truth                               | Fix                                                   |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| (a) panel script generator (b282d01)       | mock 짧은 ns (`"ns"`)                                | dotted ns (`"com.aeclaude.panel"`)                    | bracket notation `$[ns]` + acorn parse 검증 (Gate §9) |
| (b) jsx host 등록 (ecd9d2c — future-proof) | bolt-cep switch가 항상 `"aftereffects"` literal 반환 | versioned `BridgeTalk.appName` 가능성                 | switch에 `default: host[ns] = aeft;` 추가 (Gate §10)  |
| (c) rollup namespace import (a9f2167)      | ESM `import * as`의 `__proto__: null` 표준 패턴      | ExtendScript SpiderMonkey prototype null setter throw | named imports + 객체 literal (Gate §11)               |
| (d) file encoding (6f9ee9e)                | UTF-8 (no BOM) source 기본                           | system codepage 추정 (Windows Korean = cp949)         | jsx layer ASCII only (Gate §12)                       |

**공통 root**: build tool / unit test mock / boilerplate / source code 모두 production ground truth와 형식 차이를 자동 가드 못 함. 모든 면이 production wiring 첫 등장 시점에서만 드러남. probe (3a54075) 결과로 (b)는 fix-2가 실제 root cause 아니었음 확인됨 — `BridgeTalk.appName === "aftereffects"` literal 반환이라 default 도달 안 해도 OK였지만 future-proof safety net으로 유지.

### #12의 통찰: Phase 2 결함이 Phase 3 통합에서 드러남

heartbeat protocol design intent (D6 bidirectional)은 정확했지만 Phase 2 wiring이 broadcast 절반만 구현. Phase 2 검증 시나리오는 모두 active interaction (5초마다 메시지 오감 → `lastRecvAt` 자동 갱신)이라 결함이 dormant. Phase 3 사용자 dogfood (1분+ idle 시나리오)에서 처음 발화 → Gate §13 (idle scenario gate) 신설로 phase exit 시 idle scenario 강제.

**메타 학습**: 단방향 wiring + 양방향 expectation 같은 protocol contract 결함은 단위 테스트의 active path만으론 dormant. timer-driven close path (heartbeat watchdog, lockfile renewal, GC 등)는 별도 시나리오로 panelBridge.test.ts에 누적해야. scenario 14 (idle close path) 추가가 그 패턴.

### Architectural learning

**1. Sub-step 분할 (3.1 → 3.9)의 효과**: Phase 2가 26 commit을 한 단위로 묶었던 것과 대조적으로 Phase 3는 sub-step 단위 진행 — 3.1 protocol jsdoc / 3.2 ES3 polyfill collocation / 3.3 defineJsxTool HOF + 첫 tool / 3.4 D7 골든셋 / 3.5 panel-side bridge / 3.6 dispatcher / 3.7 production wiring + 5 follow-ups / 3.9 정리. 각 sub-step이 독립 검증 + 독립 commit이라 회귀 bisect 정확도 ↑. Phase 4-5에서 동일 패턴 (4.1 MCP server skeleton → 4.2 claude PTY → 4.3 첫 tool MCP 노출 등).

**2. Production wiring 첫 등장의 발견 가치**: Phase 3.7에서 4 faces가 모두 첫 등장에 발화 — Phase 3.8 (사용자 검증) 단계까지 미뤘으면 4 faces를 한 번에 진단해야 했고 root cause 분리가 어려웠을 것. **production wiring sub-step (3.7)을 분리하고 거기서 한 번에 검증한 결정의 가치**. Phase 4의 MCP + claude PTY 통합도 별도 sub-step (4.7~)으로 분리 예정.

**3. 작은 결정 게이트의 누적 효과**: Phase 3.3 시점의 시그니처 합의 (`function tool(_input, ctx, h)` wrap, plain return + try/catch handle, schema/handler/impl.jsx/test 4파일 collocation)가 **Phase 5 30 tool 패턴 확립 0 비용**. 신규 tool 추가 = 1 디렉토리 + 1 골든 case + 1 wrap. 시그니처를 늦게 합의했으면 매 tool 추가마다 패턴 재의논 필요. D8 collocation + D7 골든셋 + D4 HOF의 사전 확정이 이 효과의 토대.

**4. 사용자 "Stop when confused" 강제 효과**: Phase 3.7 follow-up 1~5 동안 매 fix 후 AE 재시작 + 결과 보고 강제 — 가설 정확도 ↑ + 미발견 면 누적 발견 (3.7 → follow-up 5까지 4 + 1 면 5개 누적). Production AE 환경 ground truth는 mock + 단위 테스트로 100% 시뮬 불가능 → CLI가 매번 사전 점검을 사용자에게 의존하는 게 정답. inline ExtendScript probe (3a54075) 패턴은 root cause 가설 검증 시간 ↓에 결정적 — Phase 4 진입 시 같은 패턴 임시 활용 후 revert (3.9 part 1).

### Phase 4 진입 준비

Phase 4 = "MCP 서버 + claude PTY 통합". 사이드카가 MCP 서버를 stdio로 띄우고, AE-tool들을 MCP tool로 노출. claude CLI가 자식 PTY로 실행되어 사용자 입력 ↔ MCP 호출 ↔ AE 조작.

**Phase 3 자산 활용**:

- `sidecar/src/dispatcher/toolDispatcher.ts` (Phase 3.6) — MCP tool call → dispatcher.exec → panel WS exec → ExtendScript → result. MCP 서버는 dispatcher만 호출하면 됨.
- `sidecar/src/protocol.ts` typed envelope (D6) — exec/result/error/cancel/progress chunking + heartbeat (Phase 3 follow-up 5 bidirectional) 모두 완비. Phase 4는 새 envelope 타입 추가 0 또는 최소.
- `defineJsxTool` HOF + collocation 패턴 (Phase 3.3) — Phase 5 30 tool 진입 시 동일 패턴 복제.
- `ae_get_active_comp` 골든 ref tool — D7 validator 골든셋 첫 case (Phase 3.4). 신규 tool은 같은 case 형식으로 추가.
- `useExtendScriptBridge` (Phase 3.5) + `main.tsx` onUnhandledMessage 라우팅 (Phase 3.7) — panel ↔ ExtendScript 라운드트립 완비.

**Phase 4 진입 시 주의 (mistakes.md에서 미리 챙길 것)**:

- PTY 교체 시 #4 (ConPTY tree kill) 재검증 — claude CLI가 자식 프로세스 띄우면 tree kill로 모두 정리되는지.
- 첫 spawn 후 #2 (Node 24 좀비) 재발 가능성. node-pty native module ABI 일치 확인.
- MCP server stdio handshake 시 #3 (.cmd shim 문제) 재발 가능성. `process.execPath` + entry .mjs 직접 spawn 패턴 유지.
- D3 `ae_run_extendscript` per-call approval modal — Phase 4의 첫 tool로 도입 시 D3 + AST validator 골든셋 동시 검증.
- Phase 4 production wiring sub-step (4.7~)에서 #11 4-faces와 비슷한 production-only 함정 재발 가능성. 사용자 dogfood + idle scenario (Gate §13) 강제.

**Phase 5-7 미리 alert**:

- Phase 5 30 tool 추가 시 D8 (collocation) + D7 (골든셋) + D4 (`defineAETool` HOF) 일관 적용. 1 tool = 1 디렉토리 + 1 case + 1 wrap.
- Phase 6 UX (status bar 5상태 + Recent AI ops 카드) — design tokens (CLAUDE.md Design Tokens) 적용. 한국어/다국어 i18n은 panel layer 책임 (jsx layer는 ASCII only — Gate §12).
- Phase 7 ZXP packaging — D9 GitHub Actions matrix + portable Node 20.

### Phase 4 회고 (2026-05-07, MCP 서버 + claude PTY 통합 완료)

Phase 4 sub-step (4.0 → 4.4) + 4개 layered fix + 메타 함정 #15 신설로 9개 commit. 사용자 dogfood 4 시나리오 (e/f/g/h) 모두 ✅ — Phase 4 본질 검증 (자연어 → ae_get_active_comp full round-trip) 통과.

**Sub-step 진행**:

| #          | Commit    | 산출물                                                                      |
| ---------- | --------- | --------------------------------------------------------------------------- |
| 4.0        | `541c759` | 결정 게이트 D-H~D-K + backward compat 강제                                  |
| 4.1        | `7abcfd1` | MCP server skeleton + dispatcher tool exposure                              |
| 4.2        | `4400f8c` | claude mcp add auto-registration on sidecar boot                            |
| 4.3        | `e4238b9` | PTY shell cmd.exe → claude (production) + spawn-helper integration override |
| 4.3 hotfix | `f7e1575` | PtyLike onExit (Trap A) + sidecar build gate (Trap B, 함정 #13)             |
| 4.4 fix    | `3bdd6ae` | node-pty PATH lookup via which (mistakes #14 Aspect A)                      |
| 4.4 fix-2  | `9889af0` | MCP entry path dev/prod resolution (Aspect B)                               |
| 4.4 fix-3  | `d9028cc` | MCP entry guard dev/prod suffix (Aspect C)                                  |
| 4.4 fix-4  | `da691a1` | wire ExecHandler → dispatcher.exec (mistakes #15 신설)                      |

**Dogfood 결과 (4 시나리오 모두 ✅)**:

- (e) "안녕" chat sanity ✅
- (f) "현재 컴프 알려줘" → ae_get_active_comp MCP full round-trip ✅ (Phase 4 본질 검증)
- (g) 1시간+ idle 후 chat + tool 정상 동작 ✅ (#12 heartbeat 회귀 0)
- (h) panel close 후 잔존 0 ✅ (#4 ConPTY tree kill 회귀 0)
- 보조: claude 자체 내장 PowerShell tool 정상 동작 — Phase 4 wiring이 ae-mcp만 영향 (다른 MCP/tool에 부작용 0).

**메타 학습 — layered dogfood loop**: Phase 4.4 한 sub-step에서 4개의 다른 production wiring 함정이 layered로 발현. 각 fix 후 다음 dogfood loop에서 다음 layer가 reachable.

| Fix                    | 함정 family                                                      | 발견 메커니즘                                                             |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 4.4 fix (#14 Aspect A) | dev/prod 분기 — node-pty PATH lookup 부재 vs child_process.spawn | 사이드카가 boot 자체 fail. file probe (절대 ASCII path)로 root cause 단정 |
| 4.4 fix-2 (Aspect B)   | dev/prod 분기 — MCP entry path가 dev에서 src/.js (존재 X)        | panel `/mcp` × failed. `claude mcp get ae-mcp` 진단으로 path 확인         |
| 4.4 fix-3 (Aspect C)   | dev/prod 분기 — MCP entry guard suffix `.js`만 검사              | `.claude.json` 직독으로 args .ts 확인 + entry guard 코드 비교             |
| 4.4 fix-4 (#15 신설)   | production assembly point가 mock 외부 — stubExecHandler 박힘     | panel xterm 안 claude가 git/grep으로 코드 직접 분석 → root cause 짚음     |

**메타 학습 — production wiring first encounter 함정의 두 family**:

- **#11 / #13 / #14 family**: 외부 의존성 시뮬레이션 정확도 (ES3 SpiderMonkey / node-pty PATH / dev vs prod build artifact / entry guard suffix). 단위 mock + integration override가 production ground truth와 어긋남. fix = 외부에 더 가까운 검증 layer 추가 (which 사전 lookup, file probe, dev/prod helper, suffix list 확장).
- **#15 family (신설)**: production assembly point가 mock 외부 위치. wiring code가 main()에 inline + 모든 test가 mock execHandler 직접 주입 → 그 wiring 자체는 dormant 상태로 통과. fix = helper 추출 + helper 단위 테스트 + production-equivalent integration test.

두 family 모두 dogfood가 catch — 단 #11/#13/#14는 외부 의존성 시뮬, #15는 내부 wiring 누락이라 fix 방향이 다름.

**메타 학습 — panel 안 claude를 진단 도구로 활용**: 사용자 dogfood 환경의 panel xterm 안 claude는 사이드카 코드를 git/grep으로 직접 분석할 수 있어, **mock 없는 production root cause 짚기에 가장 효과적**. fix-4 root cause는 panel claude가 직접 짚어옴 (`stubExecHandler` 그대로 throw). 이 패턴은 Phase 5+ 30 tool 추가 시도 dogfood 검증의 핵심 도구로 유지.

**메타 학습 — production assembly point는 helper로 추출**: Phase 5+ 새 wiring 추가 시 main()에 inline wiring 박지 말 것. 한 줄짜리 wiring도 별도 함수 + 단위 테스트 + production-equivalent integration test (production graph 1:1 wired). assembly graph 그 자체의 회귀 방지 가드.

**Phase 4 자산 (Phase 5 활용)**:

- `sidecar/src/mcp/server.ts` — MCP stdio entry. 30 tool 추가 시 `server.registerTool(...)` 한 줄 + dispatcher 통과로 자동 wiring. dispatcher의 generic forward 덕에 schema/handler 사이드카 분리 안 해도 동작.
- `sidecar/src/dispatcher/execHandler.ts` (Phase 4.4 fix-4) — production assembly point helper. Phase 5+에서 여러 dispatcher 추가 시 같은 helper 패턴 복제 (단 현재 1개만 필요).
- `sidecar/src/__integration__/integration-production-wiring.test.ts` — production assembly graph 회귀 방지 가드. 신규 wiring 추가 시 같은 패턴 신규 시나리오 추가.
- `registerMcpWithClaude` (Phase 4.2) + `resolveMcpSpawn` (4.4 fix-2) + `resolveShellPath` (4.4 fix) — Phase 7 ZXP 패키징 시 자동 prod mode 전환 (코드 변경 0).

**Phase 5 진입 시 챙길 것**:

- D8 collocation 정식 확립 — `sidecar/src/tools/<ae_name>/{schema,handler,impl.jsx,test}` 4파일 패턴. ae_get_active_comp은 Phase 3.3 spike 결과 panel jsx side에만 있으므로 Phase 5 첫 tool 작업 시 D8 정식 분리 (또는 그대로 두고 신규 tool부터 D8 적용 — 결정 필요).
- Phase 4의 9 commit + 4 layered fix 패턴이 Phase 5에서 재발할 가능성. 30 tool 추가 시 매 5개마다 dogfood loop + idle scenario Gate §13 확인.
- D3 `ae_run_extendscript` per-call approval modal — Phase 5 첫 destructive tool 도입 시 함께.

---

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status      | Findings                                                                                                               |
| ------------- | --------------------- | ------------------------------- | ---- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 1    | issues_open | HOLD mode, 5 critical decisions (D1-D5), 6 critical gaps registered as P1-P3                                           |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | clean       | 4 implementation decisions (D6-D9), test coverage diagram (~145 cases mapped), distribution pipeline locked in         |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 1    | issues_open | score 3/10 → 8/10, 1 design decision (D11), 7-pass review, 7 surfaces × 5 states matrix added, design tokens locked in |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 0    | skipped     | codex CLI unavailable on this machine                                                                                  |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | n/a         | end-user product, not dev tool                                                                                         |

- **UNRESOLVED:** 0 (10 critical decisions resolved via AskUserQuestion gates: D1-D9 + D11)
- **VERDICT:** CEO + ENG + DESIGN REVIEWED — ready to implement. All required gates passed.

### CEO Decisions (D1–D5)

| #   | Topic                           | Decision                                                                   | Plan delta                                                      |
| --- | ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| D1  | Implementation approach         | A (In-Panel Terminal + Sidecar, full integration)                          | 현재 plan §2-3 그대로 유지                                      |
| D2  | Review mode                     | HOLD SCOPE                                                                 | 확장 0, rigor only                                              |
| D3  | `ae_run_extendscript` 안전 정책 | B (per-call approval + AST allow-list, FS/네트워크/system.callSystem 차단) | §6 escape hatch 명세 보강, 새 모듈 `validateExtendScriptAst.ts` |
| D4  | Undo grouping + crash recovery  | A (tool당 1 undoGroup + 세션 시작 자동저장 + 5 tool마다 점진저장)          | tool wrapper HOF 추가, §9 위험 표 보강                          |
| D5  | Packaging + signing             | A (self-signed ZXP + Node 바이너리 동봉)                                   | §3 패키징 결정 확정                                             |

### Eng Decisions (D6–D9)

| #   | Topic                   | Decision                                                                                                       | Plan delta                                                                     |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| D6  | WebSocket 프로토콜 명세 | A (typed envelope full spec) — discriminated union, request_id correlation, cancel/progress/chunking/heartbeat | 신규 모듈 `sidecar/src/protocol.ts` (~150 LOC) — panel/sidecar 공유 import     |
| D7  | AST validator 구현      | A (acorn + adversarial test suite + indirection 차단 + #include preprocess)                                    | `_validateAst.ts` ~200 LOC + `adversarial.test.ts` 골든셋 (per-tool case 누적) |
| D8  | Tool 코드 조직          | A (per-tool collocation: `tools/<ae_name>/{schema,handler,impl.jsx,test}`)                                     | §5 디렉토리 구조 재설계, 빌드 스크립트로 jsx 합본                              |
| D9  | Distribution pipeline   | B (portable Node 20 + node_modules + GitHub Actions Win/Mac matrix)                                            | §12 시작 명령 + `.github/workflows/release.yml`                                |

### Phase 4 Decisions (D-H ~ D-K, 결정 게이트 4.0)

| #   | Topic                   | Decision                                                                                                                                                                                                         | Plan delta                                                                                                                                                                                         |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-H | claude CLI 인증         | claude CLI에 위임 (auto-detect: `ANTHROPIC_API_KEY` env inherit / OAuth fallback)                                                                                                                                | 사이드카 spawn 시 env 그대로 inherit. 인증 코드 0. dev = API key 빠른 dogfood, 일반 사용자 = 첫 실행 OAuth (claude CLI 자체 처리).                                                                 |
| D-I | MCP server process 모델 | claude CLI가 spawn하는 별도 stdio entry script (`sidecar/src/mcp/server.ts`)                                                                                                                                     | 사이드카 main은 PTY+WS만. MCP server는 standalone child. entry script가 panel WS에 reverse-connect → dispatcher.exec → result envelope → MCP response. 신규 모듈 `sidecar/src/mcp/`.               |
| D-J | PanelBridge multi-role  | 단일 ws server에 role "panel" + "mcp" 두 종류 client 허용. primary/secondary 정책은 role 안에서만 적용. backward compat 강제 (role 미명시 default "panel"). **role 식별 = URL query `?role=mcp`** (4.1 lock-in). | PanelBridge ClientState에 role 추가. handleConnection 시 req.url 파싱. WRITE_TYPES 라우팅이 role-aware. Phase 2/3 17 시나리오 그린 유지. role-disallowed 메시지는 server.error `AERoleNotAllowed`. |
| D-K | claude 출력 채널 분리   | chat 채널 = PTY raw 통과 (사이드카 main → ws → xterm). MCP 채널 = stdio JSON-RPC (D-I 별도 entry 독립). 두 채널은 사이드카 main에서 만나지 않음                                                                  | 사이드카 main은 PTY parsing 0. claude CLI 출력 형식 변경에 dependency 0. xterm UX는 ANSI/링크 addon만 영향.                                                                                        |

**Phase 4 결정 게이트 (4.0) backward compat 강제 사항** (D-J 핵심):

- 기존 PanelBridge 16 시나리오 (Phase 2 13 + Phase 3.6 14/15/16) 모두 그린 유지.
- role 미명시 client = `"panel"` default 처리. 기존 panel runtime은 변경 0.
- 명시 시만 새 동작 (mcp role primary는 exec write 권한 보유, pty.in 거부).
- D-J 4.1 진입 전 role 식별 메커니즘 갈래 (a/b/c) 추가 결정 후 코딩.

**Phase 4 sub-step 진입 전 사전 점검 (4.2 진입 시 코딩 전 답 받기)**:

- `claude mcp add` 사전 점검 4개 — Windows .cmd shim / prompt 동작 / idempotent / 등록 위치 (per-user vs project-local). #11 메타 패턴 (production wiring 첫 등장 함정) 대비.

### Phase 5 Decisions (D-L ~ D-N, 결정 게이트 5.0)

| #   | Topic                           | Decision                                                                                                                                                                                                          | Plan delta                                                                                                                                                                                                                                                  |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-L | `ae_run_extendscript` 도입 시점 | Phase 5.6 별도 sub-step (last) — 29 tool 패턴 누적 후 escape hatch 위에 얹기                                                                                                                                      | §8 Phase 5.6에 sub-step 추가. AST validator 골든셋 (D7) + approval modal (in-panel, ESC=Reject, D11) + `needsApproval: true` flag (유일). 일반 tool collocation 패턴 안정화 후 별도 단계 — 첫 도입 시 두 패턴 동시 디버깅 risk 회피.                        |
| D-M | D8 collocation 이동 시점        | 5.1 첫 작업으로 `ae_get_active_comp`을 `src/jsx/aeft/tools/` (panel spike) → `sidecar/src/tools/<ae_name>/{schema.ts, handler.ts, impl.jsx, test.ts}` 정식 위치 이동 + vite-cep-plugin 합본 config                | §5 디렉토리 구조의 정식 위치 확립. Phase 3.3 spike 위치 폐기. 첫 reference example 역할 — 30 tool이 따라할 패턴이 production 위치에 있어야 lane 분할 시 mistake 0. vite-cep-plugin이 `sidecar/src/tools/*/impl.jsx` 합본. Gate §11 / §12 / Phase 4 dogfood (e/f) 회귀 확인. |
| D-N | lane 분할 전략                  | 5.1 MVP 5 직렬 → 5.2~5.5 25 병렬 lane (그룹 5개: 컴프 / 레이어 / 키프레임 / 이펙트 / 익스프레션)                                                                                                                  | 패턴 확립 → D8 lane 충돌 0 효익 회수. tool 개별 명세는 5.2 진입 시 별도 합의. 매 5 tool마다 dogfood loop + idle scenario Gate §13 확인.                                                                                                                    |

**Phase 5 결정 게이트 (5.0) lock-in 사항**:

- **D-L**: `ae_run_extendscript`는 Phase 5의 마지막 sub-step. 일반 tool 패턴이 29개 누적되어야 AST validator 골든셋 + approval modal 위에 얹는 일이 자연스러움. 첫 도입 시 두 패턴 동시 디버깅 risk 회피.
- **D-M**: Phase 3.3 spike에서 `ae_get_active_comp`이 panel jsx side에 임시 위치. 5.1 시작 시 정식 D8 위치로 이동 — 이후 tool 추가가 production 위치 1개를 reference example로 따라감. vite-cep-plugin 합본 config 변경 (panel rollup이 `sidecar/src/tools/*/impl.jsx` 추가 glob). Gate §11 (`__proto__` 0) / §12 (non-ASCII 0) / Phase 4 dogfood (e/f) 회귀 자동 확인.
- **D-N**: 5.1 MVP 5 직렬 동안 collocation 패턴 안정화 (각 lane reference example 1개씩 — 컴프 / 레이어 / 키프레임 / 이펙트, 익스프레션은 5.2~5.5 분배). 5.2~5.5 25 tool 병렬 lane 진입 시 패턴 충돌 0 (D8 보장). tool 개별 명세 합의는 5.2 진입 시점.

### Eng Architecture Findings (E1–E7) — 위 D6-D9로 모두 해결됨

- **E1** WebSocket 프로토콜 → D6
- **E2** node-pty Mac arm64 prebuilt 매트릭스 → D9 (GitHub Actions runner 별 prebuild 자동)
- **E3** AST validator 구현 → D7
- **E4** Sidecar lifecycle → P1 보강: lockfile `~/.ae-claude-panel/sidecar-{aePid}.lock` + AE PID 1분 폴링
- **E5** Multi-host (PPRO) → v1.0 단일 host (AE) 강제, v1.5에서 tool prefix per host
- **E6** Distribution → D9
- **E7** Type safety 4 layers → D6 공유 schema + D8 collocation으로 자연 해결

### Eng Code Quality Recommendations (단일 옵션)

- **C1** `defineAETool<I,O>({name, description, input, output, handler, destructive?, needsApproval?, timeoutMs?})` HOF — 30 tool boilerplate 제거 + undoGroup 자동 wrapping + D3 dispatch 자동
- **C2** Error class taxonomy: `AEScriptError`, `AETimeoutError`, `AECrashedError`, `AEValidationError`, `AEApprovalDeniedError`, `AEUndoNotSupportedError` — `code/userMessage/developerHint` 트리플
- **C3** json2.js polyfill `src/jsx/_polyfills/json2.js` — ES3 `JSON` 부재 대응
- **C5** D8로 흡수됨

### Eng Performance Recommendations (단일 옵션)

- **P1** 사이드카 측 PTY ring buffer 10K-line, panel reconnect 시 `pty.replay` 메시지로 마지막 N줄
- **P2** 모든 `ae_list_*`: `limit: z.number().min(1).max(200).default(50)`, response `{items, total, hasMore, nextOffset}`
- **P3** Effect catalog 캐시: `~/.ae-claude-panel/cache/effects-{aeBuild}.json`, key = `app.version + plugin folder mtime`
- **P4** `ToolDispatcher` mutex — Claude parallel tool use 시 사이드카 측 FIFO serialize
- **P5** D6에 흡수됨 (10MB cap + chunking)
- **P6** **medium 우선순위, v1.5**: tool description minimal + `ae_help <tool>` 분리

### Test Coverage Diagram (요약)

```
Coverage target:  ~120 unit + 8 E2E + 7 manual + 10 eval cases
Critical security gate:  _validateAst.ts adversarial golden set (per-tool case 누적, CI required)
Mock infra:  tests/_helpers/mockAe.ts (~120 LOC) — WebSocket fixture responder
LLM eval:  evals/golden/{scenario}/{input.txt, expected_tools.json, fixture_responses.json}
ExtendScript:  manual checklist (AE 인스턴스 필요, CI 자동화 불가)
```

전체 테스트 플랜: `~/.gstack/projects/ae-claude-panel/user-no-git-eng-review-test-plan-20260504-135819.md`

### Worktree Parallelization Strategy

| Lane                      | Steps                                                                                                               | Modules                                              | 비고                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| **A** (foundation)        | Phase 0 → Phase 1 사이드카 protocol.ts → \_define.ts → \_validateAst.ts                                             | `sidecar/src/protocol.ts`, `sidecar/src/tools/_*.ts` | 모든 tool의 baseline. 직렬.                                               |
| **B** (panel shell)       | App.tsx, status bar, approval dialog, terminal mount                                                                | `src/js/main/*`                                      | A의 protocol.ts 완료 후 시작 (의존: D6 spec)                              |
| **C** (tool batch 1)      | 5 MVP tool (`ae_get_active_comp`, `ae_create_comp`, `ae_add_solid_layer`, `ae_set_keyframe`, `ae_run_extendscript`) | `tools/ae_get_active_comp/`, ... 5 폴더              | A 완료 후 **5 lane 병렬 가능** (D8 collocation 덕분에 lane 간 conflict 0) |
| **D** (tool batch 2)      | 25개 잔여 tool                                                                                                      | `tools/ae_*/` 25 폴더                                | C 검증 후 **25 lane 병렬 가능**                                           |
| **E** (CI + distribution) | GitHub Actions matrix, ZXP 빌드, release script                                                                     | `.github/workflows/`, `scripts/build-zxp.ts`         | D9. A와 병렬 가능 (의존 X)                                                |
| **F** (LLM eval)          | 골든셋 + eval runner                                                                                                | `evals/`, `tests/_helpers/mockAe.ts`                 | A 완료 후 시작                                                            |

**Conflict flags**: Lane B와 Lane C는 protocol.ts 변경 시 양쪽 영향. D6 spec 락인 후엔 충돌 없음.
**Execution**: A → (B || C 5-lane || E || F) → D 25-lane → 통합 테스트.

### Eng Review Failure Modes Supplement

CEO Failure Modes Registry에 보강:

| Codepath               | Failure                            | Rescued? | Test?                     | User sees           | Action                             |
| ---------------------- | ---------------------------------- | -------- | ------------------------- | ------------------- | ---------------------------------- |
| `protocol.ts` chunking | 청크 손실/순서 뒤섞임              | ❌ → P1  | ❌                        | 응답 깨짐           | seq + total 검증, missing 시 retry |
| `_validateAst.ts`      | adversarial 우회                   | ✅ D7    | ✅ 골든셋 (per-tool 누적) | 차단 + 사유 표시    | CI 회귀                            |
| Sidecar lockfile       | stale lock (이전 AE 프로세스 좀비) | ❌ → E4  | ❌                        | spawn 실패          | PID 폴링 + stale detection         |
| `node-pty` Mac arm64   | prebuilt mismatch                  | ❌ → D9  | ❌                        | 사이드카 spawn 실패 | Actions runner별 prebuild          |
| Tool dispatcher mutex  | deadlock (재귀 호출)               | ❌ → P4  | ⚠ test                   | hang                | reentrant guard, timeout 30s 강제  |

### Outside Voice

Codex CLI 미설치 → Outside Voice 스킵. 사용자가 별도로 `/codex consult` 실행 가능.

---

## Design Review (Pass 1-7 결과, 2026-05-04)

초기 평가 **3/10** → 최종 **8/10**. 7-pass 결과 + D11 결정 + 핵심 표면 와이어프레임 + 5상태 매트릭스 + design tokens.

### Design Decision (D11 — Onboarding)

| #   | Topic                | Decision                                           | 구현 시사점                                                                                                                                                                   |
| --- | -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D11 | First-run onboarding | B (auto-detect + inline progress + 실패 시만 고침) | 패널 열림 시 3개 체크 병렬 실행, 성공 시 1초 내 "Ready" 표시. 실패 단계만 actionable 다이얼로그 (`claude not found at $(which claude). [Install]`). 4-step wizard 만들지 않음 |

### UI Surface 인벤토리 (7개)

| #   | Surface                       | 면적             | 상호작용                                    |
| --- | ----------------------------- | ---------------- | ------------------------------------------- |
| 1   | xterm 터미널                  | ~60%             | 주 입력/출력. `JetBrains Mono` 14px         |
| 2   | 헤더 상태바 (24px)            | ~5%              | 시스템 상태 표시 + 액션 (Stop/Restart/Logs) |
| 3   | Recent AI ops 카드 (80px)     | ~15%             | 가로 스크롤, click=AE select, hover=expand  |
| 4   | D3 승인 다이얼로그 (modal)    | overlay          | 코드 프리뷰 + AST 결과 + Approve/Reject     |
| 5   | Stop 버튼                     | 헤더 일부        | text "Stop" (icon 아님), in-flight cancel   |
| 6   | Onboarding (D11=B)            | 전체 (실패 시만) | auto-detect 우선, 실패 단계별 안내          |
| 7   | 에러 모달 (auto-save 실패 등) | overlay          | warning icon + 진행/취소 분기               |

### Visual Hierarchy (Pass 1)

```
┌─[Header: 시스템 상태 (24px)]─────────────────────┐  지속적
│ ●sidecar ●MCP ●claude    [Stop] [Restart] [Logs] │
├──────────────────────────────────────────────────┤
│                                                    │
│ [Terminal: 주 인터랙션 (60-70%)]                   │  지배적
│  user@ae-claude:~$ ▌                              │
│                                                    │
├──────────────────────────────────────────────────┤
│ [Recent AI ops 카드 (15%)]                         │  보조
│ [card][card][card][card][card]              [›]   │
└──────────────────────────────────────────────────┘
```

### D3 Approval Dialog 와이어프레임

```
   ⚠ Claude wants to run custom ExtendScript
   ─────────────────────────────────────────────────
   Reason: "Apply ease-out to all selected layers' position keyframes"

   Code preview:
   ╭───────────────────────────────────────────────╮
   │  1│ var comp = app.project.activeItem;        │
   │  2│ for (var i = 1; i <= comp.numLayers; ...  │
   │  ... (line numbers + monospace + AE syntax)  │
   ╰───────────────────────────────────────────────╯

   ✅ AST check passed:  app, comp, layer, property — all OK
   ⚠  Will modify: keyframe interpolation on selected layers
   ⓘ  Undo group: "Claude: ease-out keyframes" (single Cmd+Z)

                          [ Reject ]   [ Approve & Run ]
```

**디자인 결정**:

- Modal in-panel (별도 OS 다이얼로그 X) — 컨텍스트 안 끊김
- "Approve & Run" 우측 (긍정 액션 컨벤션), keyboard focus는 **Reject**에 default (안전한 기본)
- AST 차단 시: ❌ + Line N 하이라이트 + 차단 사유, 단일 [Dismiss] 버튼
- ESC = Reject, Enter는 inert (실수 승인 방지)
- "Don't ask again" 체크박스 **없음** (D3=B 매번 승인 필수)

### Recent AI Ops Card 와이어프레임

```
│  Recent AI ops               (3 today, last 5min)         [⌃ Hide]│
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬────┐   │
│  │ ⏱ 2:47pm │ ⏱ 2:46pm │ ⏱ 2:45pm │ ⏱ 2:32pm │ ⏱ 2:31pm │ ›  │   │
│  │ 🎬 ease  │ ➕ solid  │ ⏪ undo   │ 🎞 comp  │ ▶ render│    │   │
│  │ 3 layers │ Red 1080p│ ease-out │ Main 30s │ queue   │    │   │
│  │ ↶ undo   │ ↶ undo   │ ✓ done   │ ↶ undo   │ ✓ done  │    │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴────┘
```

**Empty state**:

```
│  Recent AI ops                                                    │
│  No AI operations yet. Try: "create a 1080p comp" or              │
│  "add a red solid layer" in the terminal above.                   │
```

**디자인 결정**:

- 가로 스크롤 (세로 = 패널 높이 잡아먹음, AE 사이드 패널)
- 카드 폭 ~85px, 5-6개 한 화면
- Click = AE select (`comp.activeItem`, `layer.selected = true`)
- Hover/expand = 상세 (tool name, duration, undo this 버튼)
- Empty = warmth 메시지 + 2 primary action 예시 (Krug "make right choice obvious")
- 패널 폭 < 400px 시 hide

### 5상태 매트릭스 (7 surfaces × 5 states, Pass 2)

| Feature            | LOADING                              | EMPTY                       | ERROR                                                                   | SUCCESS                             | PARTIAL                       |
| ------------------ | ------------------------------------ | --------------------------- | ----------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| 사이드카 부팅      | "Starting sidecar… (3s)" 회색 점     | n/a                         | "❌ claude CLI not found. [Install guide]"                              | 초록 점 + "Ready"                   | 노랑 점 + "MCP not connected" |
| Claude 응답        | xterm 깜빡 `▌` + 우측 spinner        | n/a                         | "❌ API timeout (30s). Retry?"                                          | 응답 출력 + 카드                    | streaming 토큰                |
| Tool 실행          | "🎬 Running ae_set_keyframe…" inline | n/a                         | "❌ AE timeout. Auto-saved at 2:32pm. [Reconnect]"                      | "✓ done (1.2s)" + 카드 + undo label | "3/5 keyframes (2 failed)"    |
| D3 승인            | n/a                                  | n/a                         | AST 차단 ❌ + 사유 + Dismiss                                            | 코드 실행 + 결과 카드               | n/a                           |
| Recent AI ops 카드 | n/a                                  | "No AI ops yet. Try: '...'" | n/a                                                                     | 카드 slide-in 200ms                 | n/a                           |
| Stop 버튼          | "Cancelling…" 회색 처리              | n/a                         | "Already running, can't interrupt ExtendScript. Wait or Force Restart?" | "Cancelled" toast 1.5s              | n/a                           |
| Onboarding (D11=B) | step별 inline spinner                | n/a                         | step별 fix 가이드 + retry/skip                                          | 1초 내 "Ready! Try '...'"           | "✓ claude OK, ⚠ MCP retry"   |

### User Journey 감정 곡선 (Pass 3)

| Step | 행동                     | 감정                 | 디자인 제공                      |
| ---- | ------------------------ | -------------------- | -------------------------------- |
| 1    | Window > Extensions 클릭 | 호기심 + 약간 불안   | 1초 내 패널 표시                 |
| 2    | claude 프롬프트 보임     | 안도 (친숙)          | 익숙한 chrome                    |
| 3    | 첫 명령 입력             | 회의 ("진짜 될까")   | streaming 응답                   |
| 4    | AE에 컴프 생성됨         | 놀람 + 신뢰          | 카드 slide-in 200ms              |
| 5    | 두 번째 명령 → 적용됨    | 자신감               | 카드 누적                        |
| 6    | 잘못된 결과 발생         | 불안 ("AI가 망쳤나") | undo 1번 알림, "Undo this" 버튼  |
| 7    | Cmd+Z → 깨끗하게 복구    | 안도 (안전)          | 카드 회색 처리, "Reverted" badge |
| 8    | 1주일 후 매일 사용       | 효율 / 의존          | 자동 부팅 + 명령 히스토리        |

핵심 변환점: **step 4 (첫 성공)** + **step 7 (첫 안전한 undo)**. 이 두 모먼트의 motion/feedback이 신뢰의 코드.

### AI Slop 차단 결정 (Pass 4)

- **아이콘**: lucide-icons monochrome 16px. 이모지 디자인 X
  - comp=`square`, layer=`layers`, keyframe=`diamond`, effect=`sparkles`, render=`play`, undo=`undo-2`
- **폰트**:
  - 터미널: `JetBrains Mono` 14px
  - UI: `Source Sans 3` (Adobe 무료, AE 번들). Fallback: `-apple-system, sans-serif`. **`system-ui` primary 금지** (CLAUDE.md AI Slop blacklist 11번)
- **컬러 시스템**: AE host 테마 sync via CSInterface, fallback 명시
- **Card style**: 4px radius, no left-border 컬러, no decorative blob
- **카피**: utility 언어만. "Welcome to AE-Claude" 같은 generic carry 금지

### Design Tokens (CSS variables)

```css
:root {
  /* AE host에서 받아옴, fallback 값 */
  --bg: var(--ae-bg, #2d2d2d);
  --fg: var(--ae-fg, #e8e8e8);
  --accent: #4a9eff; /* OK status, primary action */
  --warn: #f4b942; /* MCP partial, validation warning */
  --error: #e85a5a; /* AST 차단, AE crash */
  --muted: #6b6b6b; /* timestamps, dim text */
  --border: rgba(255, 255, 255, 0.08);

  /* Spacing scale (5단계) */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;

  /* Radius */
  --r-card: 4px;
  --r-modal: 8px;
  --r-chrome: 0;

  /* Typography */
  --f-mono: "JetBrains Mono", Consolas, Menlo, monospace;
  --f-ui: "Source Sans 3", -apple-system, sans-serif;
  --t-body: 13px;
  --t-mono: 14px;
  --t-small: 11px;

  /* Motion */
  --m-fast: 150ms;
  --m-normal: 200ms;
  --m-ease: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --m-fast: 0ms;
    --m-normal: 0ms;
  }
}
```

### Status Indicator (색 + 모양 동시 — 색맹 호환, Pass 6)

- ● 초록 (--accent) = OK / connected
- ○ 회색 (--muted) = idle / disconnected
- ◐ 노랑 (--warn) = partial / connecting
- ◍ 빨강 (--error) = error

### Responsive & A11y 명세 (Pass 6)

| Aspect             | 명세                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| 최소 크기          | 320×400px (xterm ~40 col)                                                        |
| 권장 크기          | 480×600px                                                                        |
| Recent AI ops 카드 | 패널 폭 < 400px 시 hide                                                          |
| Keyboard nav       | Tab: 헤더 액션 → terminal → ops 카드 → loop. Esc: modal close. Cmd/Ctrl+L: clear |
| Focus ring         | --accent 2px outline, AE 다크/라이트 양쪽 visible                                |
| Screen reader      | aria-label 모든 status dot, role=dialog/aria-modal modal, role=listitem 카드     |
| Color contrast     | AA (4.5:1) 강제 — body text                                                      |
| Touch target       | 헤더 버튼 32×32px 최소, 카드 60×60px 최소                                        |
| Reduced motion     | `prefers-reduced-motion: reduce` 시 카드 slide-in 즉시 표시                      |

### Approved Mockups

| Surface            | Format          | Path                         | Direction                                                                    |
| ------------------ | --------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| D3 승인 다이얼로그 | ASCII wireframe | plan.md `Design Review` 섹션 | In-panel modal, code preview + AST result + Approve/Reject (focus on Reject) |
| Recent AI ops 카드 | ASCII wireframe | plan.md `Design Review` 섹션 | 가로 스크롤, monochrome icons, hover-expand, click=AE select                 |

(DALL-E mockup 미사용 — OpenAI API 키 미설정 + CEP 패널은 ASCII wireframe이 더 정확. 필요 시 `~/.claude/skills/gstack/design/dist/design setup` 실행.)

### Design Pass Scores

| Pass                          | Initial  | Final         | 핵심 fix                                                                    |
| ----------------------------- | -------- | ------------- | --------------------------------------------------------------------------- |
| 1. Information Architecture   | 4/10     | 8/10          | 3-tier visual hierarchy 명시 (header/terminal/cards)                        |
| 2. Interaction State Coverage | 2/10     | 9/10          | 7×5 state matrix 채움, empty state warmth 명시                              |
| 3. User Journey & Emotion     | 6/10     | 8/10          | 8-step storyboard + 변환점 (step 4, step 7) 명시                            |
| 4. AI Slop Risk               | 6/10     | 9/10          | 폰트/아이콘/컬러 lock-in, blacklist 통과                                    |
| 5. Design System Alignment    | 1/10     | 6/10          | mini design tokens (CLAUDE.md 갱신), full DESIGN.md 보류                    |
| 6. Responsive & A11y          | 2/10     | 8/10          | 키보드 nav + focus ring + a11y + reduced motion 명세                        |
| 7. Unresolved Decisions       | 6 issues | 5 fixed + D11 | onboarding(D11=B) + xterm 컬러/Stop=text/expand=hover/skip option 단일 권고 |

**Overall: 3/10 → 8/10**.

### Recommended Plan Deltas — P1 (반드시 통합)

1. **D3 구현**: ExtendScript AST validator + 패널 승인 다이얼로그. `system.callSystem`/`File`/`Folder`/`Socket` 사용 시 자동 차단.
2. **D4 구현**: `defineAETool(name, schema, handler)` HOF — `app.beginUndoGroup` 자동 wrapping. 세션 시작 시 `<original>.before-claude.aep` auto-save. 5 tool call마다 incremental save.
3. **WebSocket 포트 handoff** (§9 A1): 사이드카 stdout JSON line → CSInterface가 spawn 시 stdout 캡처 → 패널에 forward.
4. **WebSocket binding 명시** (§9 S1): **`127.0.0.1` only**. 0.0.0.0은 미래 인증 추가 후에만.
5. **AE 버전 매트릭스** (§3): 최소 AE 2022 (v22.0+) / Win10 1809+ / macOS 11+. ExtendScript ES3 baseline.
6. **로깅 인프라** (§8 신규 섹션): 구조화 JSON 로그 `~/.ae-claude-panel/logs/{date}.jsonl`, 30일 회전. AE 크래시 시 마지막 100라인 + 5 tool call dump. 패널 상태바 "Open Logs" 버튼.
7. **Auto-save 실패 정책** (§9 위험 표): 자동 저장 실패 시 AI op **중단** + 사용자 다이얼로그. 강제 진행 옵션 제공.
8. **AE process timeout** (§9 위험 표): `evalScript` 30초 timeout. timeout 시 패널에 "AE 응답 없음" + "Reconnect" 버튼 + crash dump.
9. **WebSocket reconnect** (§7 통신 시퀀스): request_id correlation. 패널 reload 시 in-flight tool call 재전송.

### Recommended Plan Deltas — P2 (Phase 5)

10. **C2** ExtendScript JSON polyfill (json2.js) — ES3 호환.
11. **P1** 모든 `list_*` tool 기본 `limit: 50`, 응답에 `total/hasMore` 메타.
12. **P2** `ae_list_available_effects` 카탈로그 캐시 + category 필터.
13. **U1** 패널 하단 "최근 AI 작업" 결과 카드 — comp/layer 변경 시각화 + 클릭 시 AE 선택.
14. **U2** 상태바에 에러 상태 표시 (빨강/노랑/회색 점 + tooltip + Open Logs).
15. **U4** "Stop current AI op" 버튼 — in-flight tool call SIGINT/cancel.
16. **U5** 첫 실행 onboarding (claude CLI 설치 체크, 인증, MCP 등록 단계별 가이드).

### Recommended Plan Deltas — P3 (v1.5+)

17. **L1** UXP 마이그레이션 v2.0 명시 — Architecture Decision Record `docs/adr/0001-cep-vs-uxp.md`.
18. **L4** 모델 ID 하드코딩 제거 — `~/.ae-claude-panel/settings.json`에서 변경 가능.
19. **T2** LLM eval suite — 5-10 골든 케이스 (`"페이드인 만들어줘"` → 예상 tool sequence). 모델 업데이트 시 자동 회귀 검사.
20. **R5** 패널-사이드카 버전 협상 — `Sec-WebSocket-Protocol` 헤더. mismatch 시 사용자 알림.

### Failure Modes Registry (요약)

| Codepath                        | Failure             | Rescued?   | Test? | User sees          | Action                     |
| ------------------------------- | ------------------- | ---------- | ----- | ------------------ | -------------------------- |
| 사이드카 spawn                  | 좀비 프로세스       | ⚠         | ❌    | 재시작 안내        | heartbeat + 자동 재기동    |
| WebSocket 포트 handoff          | 통보 실패           | ❌ → P1#3  | ❌    | "Connecting…" 영구 | stdout JSON line           |
| Claude CLI auth 만료            | PTY exit 1          | ⚠         | ❌    | exit code          | "Restart Claude" 자동 제안 |
| AE process killed               | evalScript hang     | ❌ → P1#8  | ❌    | hang               | 30s timeout + dump         |
| WS drop + in-flight             | 응답 영구 손실      | ❌ → P1#9  | ❌    | 응답 없음          | request_id correlation     |
| `ae_run_extendscript` injection | 임의 코드 실행      | ✅ D3=B    | ⚠    | 승인 다이얼로그    | AST allow-list             |
| Multi-step undo                 | 30번 Cmd+Z          | ✅ D4=A    | ⚠    | 단일 Cmd+Z         | undoGroup wrapper          |
| `list_*` token overflow         | Claude context full | ❌ → P2#11 | ❌    | 메시지 잘림        | pagination + summary       |
| Auto-save 실패                  | 데이터 손실 위험    | ❌ → P1#7  | ❌    | "진행할까요?"      | 중단 + 다이얼로그          |
| ZXP unsigned                    | ZXPInstaller 강제   | ✅ D5=A    | n/a   | 설치 안내          | self-signed cert           |

**Critical gaps remaining**: 0 (모두 P1 항목으로 등록됨). Eng review에서 구체적 구현 검증 권장.

### Dream State Delta

본 plan은 12-month ideal의 Phase 1. 명시된 미래 확장(§10: Premiere/모바일/skill/SQLite/음성)은 모두 일관된 trajectory. **빠진 future**: UXP 마이그레이션 시점 — CEP는 Adobe deprecated path라 1-2년 후 강제 전환. v2.0에 명시 권고 (P3#17).

### Recommended Diagrams (구현 단계에 추가)

1. **Error flow** — 9개 failure mode가 panel/sidecar/AE 어디서 catch되고 어디로 전파되는지
2. **Undo state machine** — `beginUndoGroup` → tool calls → `endUndoGroup` (정상/예외 경로)
3. **Auto-save policy** — 세션 시작 / 5 tool마다 / 사용자 manual / 실패 시 분기
4. **Approval flow** (D3) — `ae_run_extendscript` 호출 → AST 검사 → UI 다이얼로그 → 실행/거부
5. **Deployment sequence** — ZXP 설치 → 첫 실행 → claude CLI 체크 → MCP 등록 → 정상 동작
6. **Rollback flowchart** — 사용자가 v1.1 깨짐 보고 → uninstall ZXPInstaller → 이전 ZXP 재설치

### Next Reviews

- **`/plan-eng-review`** (required gate) — 위 P1 9개 항목의 구체적 구현 설계 검증 (특히 D3 AST validator, D4 wrapper HOF, WebSocket reconnect protocol).
- **`/plan-design-review`** (recommended) — 패널 UI 인터랙션 상태 5종(loading/empty/error/success/partial) 디자인.
