# Mistakes log

기록 규칙: 매번 막힌 시점 + 추측 말고 진단한 root cause + 적용한 fix.

## 2026-05-04 fnm + .bashrc auto-source

**문제**: Step 3에서 `~/.bashrc` 작성 후 다음 bash 명령에서 `which fnm` → not found. PATH 갱신 안 됨.

**진단**:
- `echo $-` → `hBc` (h=hashing, B=brace expand, c=command-from-arg)
- `BASH_ENV: unset`
- bash 실행 모드: `bash -c "<cmd>"` (Claude Code 내부 호출 방식)
- 결과: **non-interactive non-login shell** → bash는 이 모드에서 `~/.bashrc`도 `~/.bash_profile`도 자동으로 안 읽음
- 수동 `source ~/.bashrc` → 즉시 fnm 작동 → bashrc 자체는 정상

**Root cause**: non-interactive bash에서 init 파일을 자동 source하려면 `BASH_ENV` 환경변수가 그 파일을 가리켜야 함.

**Fix**: Windows user 환경변수에 `BASH_ENV=C:\Users\user\.bashrc` 영구 설정. setx 사용.

**Caveat**: `setx`는 registry에만 쓰므로 **현재 Claude Code 세션의 bash 프로세스는 못 받음** — 새 Claude Code 세션부터 적용. 이번 세션은 명령마다 명시적 source 필요.

**예방**: 다음에 비슷한 환경 셋업 시 — Claude Code bash 환경의 init 파일은 BASH_ENV 영구 설정이 전제. .bashrc 작성과 BASH_ENV 설정은 한 묶음으로.

## 2026-05-04 sidecar npm install이 Node 24로 빌드됨

**문제**: `cd sidecar && npm install` 실행 → node 147개 패키지 설치 성공이지만 `node -v` → v24.13.1 (시스템 Node). 의도는 fnm-managed Node 20.

**진단 (두 원인 중첩)**:
1. **fnm `.nvmrc` 탐색 범위**: PWD only, parent dir 탐색 안 함. root에 `.nvmrc=20` 있어도 `cd sidecar/`로 들어가면 fnm이 못 찾음 → default(v24)로 떨어짐.
2. **이번 Claude Code 세션 BASH_ENV 미적용**: 위 첫 mistake에서 setx로 영구 등록은 했으나 *현재 세션 프로세스는 변경 못 받음*. 매 명령에 `source ~/.bashrc` 안 하면 fnm 자체가 PATH에서 사라짐 → 시스템 Node 24(v24.13.1)가 그대로 사용됨.
3. 결과: 사이드카 native 모듈(node-pty)이 Node 24 ABI로 빌드/prebuilt 됨. 의도(D9 = Node 20 LTS)와 어긋남.

**Root cause**: 두 메커니즘 모두 "현재 디렉토리 기준" + "현재 세션 환경변수 기준"으로 작동. 둘 다 깨졌을 때 silent fallback이 시스템 Node로 떨어지는 게 위험.

**Fix**:
1. `sidecar/.nvmrc` = 20 추가 (root에 의존 안 하고 명시적으로)
2. 기존 `sidecar/node_modules/` + `sidecar/package-lock.json` 삭제 (Node 24로 빌드된 native 잔재 제거)
3. `source ~/.bashrc && cd sidecar && npm install` 한 명령으로 묶어 fnm 활성 + Node 20 보장 후 재설치

**예방**: 모든 npm/yarn install 명령은 `source ~/.bashrc &&`로 prefix 또는 명령어를 한 줄에 묶어 fnm hook이 활성된 상태에서만 실행. multi-package 워크스페이스는 각 package에 독립 `.nvmrc` 필수.

## TODO — bolt-cep boilerplate 정리 (Phase 7 전까지)

후속 정리 필요 항목 (Phase 1 commit엔 포함됨, 별 commit으로 정리):

- **`.github/FUNDING.yml`** — `github: hyperbrew`. bolt-cep 메인테이너 후원 표시. 우리 프로젝트 페이지에 박히면 의도와 다름. **삭제** 권장.
- **`.github/workflows/main.yml`** — windows-latest + Node 18 + 단순 ZXP 빌드. D9 결정(Win-x64/Mac-x64/Mac-arm64 matrix + Node 20 LTS + 사이드카 portable Node 동봉)과 충돌. **Phase 7에서 새로 작성**, 일단 비활성화 또는 삭제.
- **`README.md`** — bolt-cep boilerplate (21KB). 우리 프로젝트 README로 교체 필요.
- **`LICENSE`** — bolt-cep MIT 명의. 프로젝트 라이선스 결정 후 갱신.
- **`CHANGELOG.md`** — bolt-cep changelog. 우리 시작점부터 새로 쓰거나 삭제.
- **5 moderate vulns (sidecar)** — 모두 dev tree (vitest/vite/esbuild). 핵심 production 의존성 영향 0.
- **32 vulns (panel root, 22 critical)** — 모두 bolt-cep template의 **legacy babel 6 ecosystem** (`babel-preset-env@1.7.0`, `babel-helper-*`, `babel-plugin-transform-es2015-*`, `babel-traverse` RCE 등). ExtendScript ES3 트랜스파일용으로 bolt-cep가 의도적으로 포함. 모두 devDependencies — production 빌드 산출물 0 영향. babel-traverse RCE는 "specifically crafted malicious code" 시나리오로 우리 직접 작성 jsx만 컴파일하므로 위협 없음.
- 후속 처리: bolt-cep 메인테이너의 babel 7 마이그레이션 PR 모니터링 + 자체 fork 시 babel 7 / SWC 전환 검토.

## TODO — D8 collocation 충돌 (Phase 5 진입 전 결정)

bolt-cep template이 만든 jsx 파일들이 **D8 per-tool collocation 규칙(`tools/<ae_name>/{schema,handler,impl.jsx,test}`)과 충돌**:

- **`src/jsx/aeft/aeft.ts`** — bolt-cep boilerplate AE 함수 export 모음 (sample 함수들)
- **`src/jsx/aeft/aeft-utils.ts`** — bolt-cep AE 유틸 (sample 패턴)
- **`src/jsx/utils/samples.ts`**, **`src/jsx/utils/utils.ts`** — bolt-cep sample 코드
- **`src/jsx/index.ts`** — 모든 jsx 함수 export 진입점 (D8 collocation에서는 빌드 스크립트가 자동 생성해야)

**결정 필요 (Phase 5 시작 전)**:

1. **옵션 A — 통째 삭제**: bolt-cep sample을 모두 지우고 D8 collocation으로 처음부터. 빌드 스크립트(`tools/*/impl.jsx` → `src/jsx/index.ts` 합본)를 새로 작성.
   - 장점: 깔끔, CLAUDE.md 디렉토리 규칙과 100% 일치
   - 단점: bolt-cep의 evalTS<T>() 빌드 마법(타입 추론 + jsx 합본)을 직접 재구현해야

2. **옵션 B — bolt-cep 빌드 시스템 활용 + 30 tool은 collocation, sample은 그대로**: bolt-cep의 `src/jsx/aeft/aeft.ts`에 30 tool import 추가하는 형식. collocation 디렉토리는 별도로 두되 합본은 bolt-cep이 처리.
   - 장점: bolt-cep evalTS 마법 그대로 활용
   - 단점: D8 디렉토리 규칙과 부분 위반 — `tools/<ae_name>/impl.jsx`가 `src/jsx/aeft/`로 import되는 indirect 구조

3. **옵션 C — 하이브리드**: sample (`samples.ts`, `aeft.ts`의 dev 헬퍼)은 보존하되 production 30 tool은 `tools/` collocation으로. `aeft.ts`가 `tools/` 폴더 자동 import.
   - 절충

**왜 지금 결정 안 함**: Phase 2-4는 패널 통신 + PTY + MCP 인프라라 jsx tool 구조와 무관. Phase 5 첫 tool 구현 시점이 결정 시점.

**결정 시 고려**: bolt-cep `evalTS<T>()`의 타입 추론이 어떻게 동작하는지 (Phase 5 직전에 bolt-cep 빌드 스크립트 분석 필요).

## 2026-05-04 D7 validator — 2/41 fail (constructor escape 패턴)

**문제**: CLAUDE.md gate #1 검증 (`npm test`) → 41개 중 2개 fail.

**Fail 케이스**:
1. `D7 validator > indirection bypass attempts > blocks constructor escape`
   - input: `(0).constructor("return File")();`
2. `D7 validator > indirection bypass attempts > blocks __proto__ constructor escape`
   - input: `({}).__proto__.constructor("alert(1)")();`

**Root cause**: `_validateAst.ts:78-86`의 `Identifier` visitor가 MemberExpression의 non-computed property는 visit하지 않는다. acorn-walk의 동작 — `obj.foo`에서 `foo`는 "변수"가 아니라 "프로퍼티 이름"이라 Identifier 콜백이 안 불림.

→ deny-list에 `constructor`/`__proto__`를 넣었어도 `.constructor`/`.__proto__` 형태의 멤버 접근은 통과.

**보안 영향**: 둘 다 ECMAScript 표준 sandbox escape. Function constructor를 얻으면 임의 ExtendScript 실행 가능 → D3 보안 게이트 무력화.

**Fix 방향**: `MemberExpression` visitor에 추가 — `property.type === "Identifier"`이고 이름이 위험 set(`constructor`, `__proto__`, `callee`, `caller`, `prototype`)에 있으면 finding 추가. 약 15 LOC.

**예방**: AST validator 작성 시 acorn-walk의 visitor 의미를 명확히 알아야. "deny-list에 추가했으니 잡힌다"는 추측은 위험. 새 deny rule 추가할 때마다 adversarial 케이스를 먼저 작성하고 빨간 줄 확인 → fix → 초록 줄 (TDD).

## 2026-05-04 typecheck 명령 실수 (bolt-cep dual tsconfig)

**문제**: Phase 2 #1 sanity check에서 `npx tsc --noEmit` 실행 → `src/jsx/aeft/aeft.ts(14,3): Cannot find name 'app'` 외 5건 에러.

**진단**: bolt-cep는 의도적으로 **두 개 tsconfig 분리 운영**:
- `tsconfig.json` — panel side (React, Vite, DOM types)
- `src/jsx/tsconfig.json` — jsx side (ExtendScript, types-for-adobe)

`npx tsc --noEmit`은 root tsconfig만 사용 + 모든 `.ts`를 panel context로 검사 → jsx의 `app`/`BridgeTalk`/`ExternalObject` 같은 ExtendScript globals를 못 찾음. **에러는 우리 코드 문제 아니라 잘못된 명령 사용**.

**정확한 typecheck 명령** (앞으로 sanity check 시 이걸 사용):
- panel only: `npx tsc -p tsconfig.json --noEmit`
- jsx only: `npx tsc -p src/jsx/tsconfig.json --noEmit`
- 둘 다: `npm run watch` (or build) — bolt-cep의 빌드 시스템이 둘 다 처리

**예방**: bolt-cep 같은 mono-repo / multi-context 프로젝트는 root tsc 사용 금지. 항상 `-p <specific-tsconfig>` 또는 프로젝트의 npm script 사용.

## 2026-05-04 ConPTY 출력은 ANSI screen buffer (raw text 아님)

**문제**: `ptyHost.test.ts`에서 `cmd.exe` spawn → `echo hello\r` write → 정규식 `/(^|\r|\n)hello(\r|\n|$)/`로 출력 매칭 시도 → fail. 30s timeout.

**진단**: 받은 데이터 = `\r\nhello[7;1HC:\\...` — `hello` 뒤가 `\n`이 아니라 ANSI cursor 이동 escape (`ESC [7;1H` = 커서 좌표 7행 1열). **ConPTY(Windows 11/Win10 1809+)는 일반 PTY처럼 raw 텍스트 stream이 아니라 screen buffer 변경 사항을 ANSI escape sequence로 송출**. 일반 Unix PTY와 출력 의미가 다름.

**Fix**: 라인 경계 매칭 대신 **단어 출현 횟수 매칭**. `cmd.exe`/bash 모두 명령 echo + 출력 결과로 `hello`가 최소 2번 등장 → `combined.match(/hello/g).length >= 2`로 견고하게 매칭.

**예방**: PTY 출력 검증 시 newline-anchored regex 의존 금지. ConPTY는 `[...H` 커서 이동, `[?25h` 커서 표시, `[K` 라인 클리어 등을 자유롭게 섞음. 매칭은 단순한 substring 또는 단어 카운트가 안전.

## Phase 2 후속 / 한글 인코딩 검증 필요

**우려**: node-pty 사이드카에서 stderr 경고 `Setting encoding on Windows is not supported` 출력. Windows에선 `encoding: "utf8"` 옵션이 효력 없음. node-pty는 OS native code page (CP949 in ko_KR Windows) 사용.

**예상 영향 범위**:
- ASCII 명령/출력 (예: `echo hello`): 무영향. 모든 인코딩에서 동일 바이트.
- **claude CLI 자체 출력 (UTF-8)**: 사이드카가 OS native로 디코딩하면 한글/이모지 깨질 수 있음. claude CLI는 `chcp 65001` 미적용 환경에서 UTF-8을 CP949로 잘못 디코딩.
- **사용자가 한글 명령 입력**: 패널의 xterm은 UTF-8, 사이드카가 CP949로 PTY에 write하면 mismatch.

**왜 지금 안 막음**: Phase 2 #2 검증 게이트는 단순 `echo hello` ASCII 케이스. 한글 인코딩 이슈는 노출 안 됨. 지금 추측 fix 적용은 위험 — 실제 깨짐 패턴 보지 않고 코드 추가하면 over-engineer.

**검증 시점**:
- **Phase 2 #5 단독 통합 테스트**:
  - mock client → "한글 출력 명령" (예: `echo 한글`) write → onData 수신 → 깨짐 여부 확인
  - **AE 컴프/레이어 이름 한글 케이스**: `ae_create_comp({name: "오프닝 타이틀_v3"})` → AE에서 그 이름으로 생성됐는지 (Phase 5 첫 tool 통합 시점에 동시 검증)
- **Phase 2 #8 풀스택**: 패널 xterm에서 한글 입력 시 사이드카 → claude PTY 왕복 후 그대로 표시되는지

**Phase 2.3.1에서 부분 보장됨** (2026-05-04):
- WS 레이어 (panel ↔ sidecar 사이 JSON over text frame)는 UTF-8 round-trip 보장 — `panelBridge.test.ts` 시나리오 9 (exec input/output Korean+emoji) + 시나리오 10 (pty.in Korean) 통과
- 남은 위험은 PTY 레이어 (사이드카 ↔ claude CLI 사이) — Windows에서 OS code page 영향. 위 검증 시점에서 해결.

**Phase 2.5.2 발견 — cmd.exe PTY 한글 round-trip은 CP949 환경에서도 자동 통과** (2026-05-04):
- 검증 환경: Windows, `chcp` = `949` (CP949 ko_KR), Node 20.20.2, node-pty 1.x ConPTY 모드
- 시나리오 4 (`echo 한글\r` → pty.out에서 '한글' 2회 등장) **fix 없이 649ms 안에 통과**
- 가정 ('cmd.exe는 CP949라 한글 깨짐')과 결과 ('정상 round-trip')의 모순 해명:
  - **ConPTY는 내부적으로 UTF-16** (Win32 Console API native)
  - **node-pty는 OS code page와 독립적으로 UTF-16 → UTF-8 string 변환**
  - cmd.exe의 chcp 949 설정은 cmd.exe 자체의 file/IO 인코딩에 영향, ConPTY 레이어 출력에는 영향 없음
  - 사이드카 stderr의 경고 `Setting encoding on Windows is not supported`는 옵션 무시일 뿐 실제 동작은 UTF-8 string 전달
- **결론**: fix 1순위 (`chcp 65001 prefix`) 적용 안 해도 cmd.exe 환경에서 한글 OK. 잠재적 보호 효과는 있으나 현재 미적용.

**남은 미검증 영역 (Phase 4 후속 / claude CLI 한글 검증)**:
- 본 검증은 cmd.exe spawn 기준. **Phase 4에서 PtyHost가 `claude --model claude-opus-4-7`로 교체됨**
- claude CLI는 별도 binary (Rust 또는 Node). 자체 stdout 인코딩 정책이 다를 수 있음
- 검증 케이스: 사이드카 PTY로 claude 띄움 → "한글로 답해줘" 입력 → 한글 응답이 panel xterm까지 깨짐 없이 도달하는지
- 시점: Phase 4 첫 통합 (claude mcp add + PTY 진입) 직후. fail 시 fix 1순위 (`chcp 65001` prefix) 적용 검토.

**해결 후보** (검증 결과에 따라):
1. PTY spawn 전 `chcp 65001` (Windows): cmd.exe 시작 전 console code page를 UTF-8로
2. `cmd.exe /U` 옵션: Unicode I/O mode
3. PowerShell로 spawn (Win 10+ 기본 UTF-8): `cmd: "powershell.exe"`
4. node-pty 출력 Buffer를 직접 받아서 UTF-8 decode: `encoding: undefined` + `iconv-lite`로 수동 디코딩

**책임**: Phase 2 #5 또는 #8에서 직접 확인 후 결정. 1번이 가장 침투적 X 후보.

## 2026-05-04 WS test helper — message listener race

**문제**: `panelBridge.test.ts` 8/8 fail. `nextMessage`가 매 호출마다 새 listener 등록 → server가 `sys.version`을 client open 직후 송신했는데 listener 등록 전에 도착하면 메시지 drop.

**Fix 패턴 (재사용)**: WS test client는 항상 connection 즉시 영구 listener 등록 + queue에 push. 검사 함수는 큐를 polling. listener 늦게 등록해서 메시지 놓치는 race 원천 차단.

```typescript
type Ws = WebSocket & { __queue: Msg[] };
async function openWs(url): Promise<Ws> {
  const ws = new WebSocket(url) as Ws;
  ws.__queue = [];
  ws.on("message", raw => { try { ws.__queue.push(JSON.parse(raw.toString())); } catch {} });
  await /* once open */;
  return ws;
}
async function nextMessage(ws, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const idx = ws.__queue.findIndex(m => !predicate || predicate(m));
    if (idx >= 0) return ws.__queue.splice(idx, 1)[0];
    await delay(20);
  }
  throw new Error("timeout");
}
```

## 2026-05-04 Promise.race + AbortSignal 패턴 (handler timeout 강제)

**문제**: panelBridge에서 `await execHandler(...)`만 쓰면 handler가 AbortSignal 무시 시 timeout이 의미 없음 (handler 영원히 pending).

**Fix 패턴**: handler vs abort-promise를 `Promise.race`. abort 시점에 우리 쪽이 reject → server가 강제로 error 응답 송신. handler가 abort 듣든 무시하든 server는 응답 보장.

```typescript
const abortPromise = new Promise<never>((_, reject) => {
  if (signal.aborted) reject(new Error("__abort"));
  else signal.addEventListener("abort", () => reject(new Error("__abort")), { once: true });
});
await Promise.race([handler(input, ctx), abortPromise]);
```

**언제 쓰나**: 외부 시스템(AE, native module)에 위임된 long-running work에서 timeout 보장 필요 시. 사용자 cancel + server timeout 모두 강제 가능.

## 2026-05-04 Node 20.12+ child_process.spawn EINVAL on Windows .cmd

**문제**: Phase 2.5.1 첫 실행 → 모든 시나리오 boot 단계 `spawn EINVAL`. 진단 결과 spawn-helper.ts가 `node_modules/.bin/tsx.cmd`를 `shell: false`로 직접 실행 시도 → EINVAL.

**Root cause**: Node.js CVE-2024-27980 fix (20.12.2+, 21.7.3+, 18.20.4+)로 `child_process.spawn`이 Windows에서 `.cmd`/`.bat` 파일을 `shell: false`로 실행 못 함. `.cmd` 파일은 cmd.exe가 해석해야 하는데, shell:false면 Node가 직접 실행 시도 → 운영체제가 EINVAL 반환.

**Fix**: `.cmd` shim 우회. tsx의 실제 entry point(`node_modules/tsx/dist/cli.mjs`)를 `process.execPath` (현재 Node)로 직접 실행:

```typescript
spawn(process.execPath, [tsxCliPath, "src/index.ts", ...args], { ... });
```

장점: cross-platform 동일 동작, 현재 fnm-managed Node 20과 자동 일치, shell:false 안전 유지.

**예방**: 다른 통합 테스트에서도 .bin/*.cmd 직접 spawn 금지. 항상 entry .mjs/.cjs를 node로 실행하거나 shell:true 사용. shell:true는 args quoting 위험 — 첫 번째 옵션 권장.

## ✅ Phase 3.7 (#11) — panel-side script generator가 dot 포함 ns로 chained property access 생성

**증상**: Phase 3.7 production wiring 시점에 발견. useExtendScriptBridge가 `${ns}.tools.${tool}(...)` 형식으로 evalScript 호출을 생성하는데, 실제 `ns` 값 = `cep.config.ts:id` = **`com.aeclaude.panel`** (dot 포함). ExtendScript에 도달한 script `com.aeclaude.panel.tools.ae_get_active_comp("...")`는 `com → .aeclaude → .panel ...` 식 chained property access로 파싱 → 첫 click에 `ReferenceError: com is undefined`. AE 사용자 검증 (Phase 3.8) 직전이라 다행이지 그 단계까지 가서야 발견했으면 사용자 시간 낭비.

**Root cause**: 3.5 단위 테스트가 mock CSInterface로 script string의 정확한 형식 비교만 (`expect(script).toBe('ns.tools.ae_get_active_comp("{}")')`). mock이 실제 ExtendScript parse semantics를 모방 안 함 — 짧은 ns (`"ns"`)에선 dot 없어서 chained-vs-bracket ambiguity 자체가 안 드러남. unit test가 production ns 형식 가정을 시험하지 못함.

**Fix (Phase 3.7 fix-1)**: bracket notation으로 변경.
- `useExtendScriptBridge.ts` script template: `${ns}.tools.${tool}(...)` → `$[${JSON.stringify(ns)}].tools.${tool}(...)` → 산출물 `$["com.aeclaude.panel"].tools.ae_get_active_comp("...")`. jsx index.ts는 이미 `host[ns] = aeft` (bracket 등록), bracket lookup으로 동일 객체 회수.
- `useExtendScriptBridge.test.ts` 기존 expect 정정 + 신규 case 1개 추가:
  - real ns (`com.aeclaude.panel`)로 instance 생성
  - 생성된 script를 acorn으로 parse → 통과 검증
  - AST 구조 검증: outermost CallExpression callee가 `MemberExpression(MemberExpression($[ns:literal], "tools"), "<tool>")` 형태인지. 즉 `$["..."]`가 root, dotted-identifier로 풀리지 않음을 AST level에서 강제.
- `main.tsx` `NS = "aeclaudepanel"` (잘못된 hardcode) → `NS = "com.aeclaude.panel"` (실제 cep.config.ts id 값).

**예방 (Phase 5 30 tool 진입 전 핵심)**:
- (a) **3.5 단위 테스트 자동 가드 (이번 commit에 박힘)**: useExtendScriptBridge에 신규 case "real ns with dots — generated script parses + first call shape is $[ns].tools.<tool>(...)". dotted ns가 실제 production 환경 가정이고, mock의 짧은 ns 가정은 반드시 진짜 ns로 한 번 더 검증 필요. acorn parse + AST 구조 검증이 형식 비교보다 본질적.
- (b) **Phase 5 신규 tool 추가 시**: 같은 acorn 검증 패턴을 신규 tool generator 테스트에 자동 상속 (case 작성자가 of course 박을 것 — 단위 테스트 파일이 이미 패턴 보유).
- (c) **CLAUDE.md Validation Gates §9 추가**: "panel-side script generator는 production ns 값으로 unit test에서 정확한 호출 형식 검증 (mock의 짧은 ns 가정 X)."

**왜 mistakes.md 함정**: production wiring 첫 등장 시점에 string template generation의 implicit assumption (dot 없는 식별자)이 깨졌음. mock 환경과 production ns 값의 형식 차이가 unit test로 분리 안 됐던 게 본질. 향후 비슷한 상황 (panel runtime이 다른 cep config 값 식별자처럼 사용하는 케이스) 재학습 0이 목표 — gate §9가 그 자동 가드.

---

### Phase 3.8 추가 면 — jsx host[ns] 등록의 boilerplate switch host 매칭 가정

**증상**: 위 fix-1 적용 + 빌드 + AE에서 dev 버튼 클릭 → AE Script Alert: `TypeError: Cannot convert to ... C:/Users/.../com.aeclaude.panel/jsx/index.js`. PTY/WS는 정상 (panel "Ready"), spike 버튼 클릭 직후 발생.

**Root cause**: bolt-cep boilerplate의 `src/jsx/index.ts`는 multi-host 분기 switch에 호스트별 namespace 등록:
```typescript
switch (getAppNameSafely()) {
  case "aftereffects":
  case "aftereffectsbeta":
    host[ns] = aeft;
    break;
}
```
`getAppNameSafely()` 내부:
- `BridgeTalk.appName` 정의되면 그 값 반환. Adobe AE 일부 버전에서 **versioned string** 반환 (e.g., `"aftereffects-22.0"`).
- broken AE 24-25 fallback만이 `app.appName` ("After Effects") `compare(name, "after effects")` indexOf로 literal `"aftereffects"` 매핑.

즉 BridgeTalk이 정상 동작하는 AE 버전에서는 case match 실패 → `host[ns] = aeft` 미실행 → `$["com.aeclaude.panel"]` undefined → panel exec script `$["com.aeclaude.panel"].tools.ae_get_active_comp(...)`의 `.tools` access 시 `Cannot convert undefined to object` throw.

**Fix (Phase 3.7 follow-up)**: switch에 `default: host[ns] = aeft;` 추가. AE-only 프로젝트(D2 hold scope)이므로 어떤 host 식별 결과여도 fallback 등록 안전. boilerplate switch intent (multi-host 분기) 보존하면서 fail-safe.

**디버그법** (다음 비슷한 case 발생 시):
1. AE ExtendScript 콘솔 (Window > Extensions > ExtendScript Toolkit, 또는 bolt-cep dev 도구)에서 다음 평가:
   - `BridgeTalk.appName` — 정확한 반환 확인 (literal "aftereffects" vs versioned)
   - `app.appName` — fallback path 반환
   - `getAppNameSafely()` — switch에 들어가는 최종 값
2. 산출 jsx에서 `host[ns] = aeft` 라인 도달 여부 — 임시 `alert($[ns])` 1줄 추가 + 빌드 + 패널 reload + 결과 확인. undefined면 host 등록 미실행 확정.

---

### Phase 3.8 추가 면 — `import * as` namespace import → rollup `__proto__: null` → ExtendScript throw

**증상**: fix-1 (panel `$[ns]` bracket) + fix-2 (jsx switch default) 적용 후에도 AE 완전 재시작 → panel load 시점에 동일 alert (`TypeError: Cannot convert to ... jsx/index.js`). spike 클릭 → `AEResultParseError` (5ms; jsx 평가 throw → garbage 반환 → panel JSON.parse fail).

**진단 진행**:
1. dist ↔ AppData diff 0 (fix-2 sync 정상). default branch 박혀있음 — 즉 fix-2가 ExtendScript에 도달했음에도 throw → 더 윗 line에서 throw.
2. 산출물 ES3 비호환 grep: arrow `=>` 1개 + backtick 11개 — 모두 코멘트 안. 실행 코드 X.
3. Phase 3.3 코드 (`defineJsxTool`, handler) ES3 호환 OK.
4. **`__proto__: null` 2개 발견** (line 176, 186) — rollup이 ESM `import * as` (namespace import)를 ES3+CJS 호환 객체로 합성할 때 자동 생성하는 패턴.

**Root cause**: ExtendScript SpiderMonkey 기반 engine이 `{ __proto__: null, ... }` object literal을 평가할 때 prototype을 null로 설정 시도. SpiderMonkey-derived ExtendScript에서 prototype을 null로 setter 호출 시 internal type coercion 호출 → "Cannot convert null to object" → 메시지 "Cannot convert to" (사용자 메시지와 일치). IIFE 평가 자체 throw → 후속 `host[ns] = aeft` 도달 못 함 → spike 클릭 시 lookup undefined → AEResultParseError.

발화점:
- `src/jsx/aeft/aeft.ts`: `import * as tools from "./tools"; export { tools };` → 산출 line 176 (tools namespace 객체)
- `src/jsx/index.ts`: `import * as aeft from "./aeft/aeft"; ... host[ns] = aeft;` → 산출 line 186 (aeft namespace 객체)

bolt-cep boilerplate 자체에는 namespace import 없음 — Phase 3.3에서 우리가 collocation 패턴 만들면서 추가한 게 발화. 즉 boilerplate fault 0, 우리 추가 fault.

**Fix (Phase 3.7 follow-up 2)**: `import * as` → named imports + 객체 literal로 직접 작성.
- `aeft.ts`: `import { ae_get_active_comp } from "./tools"; export const tools = { ae_get_active_comp };`
- `index.ts`: `import { helloError, ..., helloWorld, tools } from "./aeft/aeft"; const aeft = { helloError, ..., helloWorld, tools };`

산출물 검증: `__proto__: null` 0 매치 (직접 차단). aeft binding이 `var aeft = { helloError: helloError, ..., tools: tools };` plain object literal로 빌드 → ExtendScript 호환.

**디버그법** (다음 비슷한 case 발생 시):
- 산출 jsx에서 `grep -c "__proto__" dist/cep/jsx/index.js` — 박혀있으면 어딘가 `import * as` 사용 흔적. 0이면 안전.
- panel inspector 콘솔에서 `__adobe_cep__.evalScript("$.global", cb)` 또는 작은 fragment로 ExtendScript 환경 직접 점검 가능 (마지막 수단).

---

### Phase 3.8 추가 면 — jsx 산출물 file encoding (UTF-8 no BOM) + ExtendScript system codepage 디코딩

**증상**: fix-1 + fix-2 + fix-3 적용 후에도 동일 alert. probe 결과 (`typeof $["com.aeclaude.panel"] === "undefined"`)로 host[ns] 미등록 확정. 그러나 polyfill 정상 평가 (`Date.prototype.toJSON === "function"`) → **IIFE의 polyfill 다음 ~ host[ns]= 사이 어딘가에서 throw**.

**Root cause**: vite/rollup이 합성한 `dist/cep/jsx/index.js`가 **UTF-8 (no BOM)** 으로 저장. ExtendScript engine은 BOM 없으면 system codepage 추정 — Windows Korean locale에서 **cp949** (EUC-KR variant). UTF-8로 인코딩된 한국어 byte sequence를 cp949로 디코딩 시도 → string literal parse 시 invalid char → SyntaxError/TypeError throw → IIFE 중단 → host[ns] = aeft 도달 못 함.

발화점: **Phase 3.3에서 추가한 한국어 userMessage / developerHint** — `_define.ts`의 AEInputParseError/AEScriptError 메시지 + `ae_get_active_comp/handler.ts`의 AENoActiveCompError 메시지. bolt-cep boilerplate 자체에는 한국어 literal 0 — 다른 사용자 동작은 boilerplate가 ASCII only이기 때문.

**Fix (Phase 3.7 follow-up 4)**: jsx layer는 ASCII only로 통일. 한국어 메시지는 panel layer가 i18n 처리 (Phase 6 UX). machine-friendly = 영어 (Claude/MCP가 읽는 메시지), human-friendly i18n은 panel layer 책임.

수정:
- `src/jsx/aeft/tools/_define.ts`: "입력 데이터 형식 오류" → "Input parse failed", "툴 실행 중 오류" → "Tool execution failed"
- `src/jsx/aeft/tools/ae_get_active_comp/handler.ts`: "활성 컴프가 없습니다..." → "No active composition. Select or create a comp..."
- `handler.test.ts`: regex 영어 매치
- `src/jsx/index.ts`: 코멘트도 영어 통일 (코멘트는 ExtendScript 무시지만 일관성)

**fix-2 (default case) 정정**: probe 결과 `BridgeTalk.appName === "aftereffects"` literal 반환 확인 — switch case "aftereffects"에 정상 매치, default 없어도 도달했을 것. **fix-2는 이번 root cause 아님**. 단 future-proof safety net으로 유지 (다른 AE 버전/환경에서 versioned 반환 가능성 대비).

**디버그법** (다음 비슷한 케이스 발생 시):
- 산출 jsx에서 non-ASCII byte grep: `grep -P '[\x80-\xFF]' dist/cep/jsx/index.js | head` — 매치 있으면 ExtendScript file encoding 함정 의심.
- panel inspector 콘솔에서 `__adobe_cep__.evalScript("'한글'", cb)` 직접 평가 — 한국어 string literal 자체가 ExtendScript engine에서 valid한지 즉시 확인.

---

### Meta-pattern (#11 다섯 면 통합)

panel-side script generator (fix-1) + jsx-side host 등록 (fix-2, future-proof) + rollup namespace import (fix-3) + jsx file encoding (fix-4)는 같은 함정의 **네 면**:

> **production 환경 (ES3 ExtendScript + Windows host) 차이가 build-tool / source / boilerplate / mock 가정과 부딪침. 모두 같은 root.**
>
> | 면 | 가정 (잘못된) | production ground truth |
> |---|---|---|
> | fix-1 panel script generator | mock 짧은 ns ("ns") | dotted ns ("com.aeclaude.panel") |
> | fix-2 jsx host 등록 (future-proof) | boilerplate switch literal 매칭 | versioned BridgeTalk 반환 가능성 |
> | fix-3 rollup namespace import | ESM `__proto__: null` 표준 | ExtendScript SpiderMonkey 동작 차이 |
> | fix-4 jsx file encoding | UTF-8 (no BOM) source | system codepage 추정 (cp949) |

mock + 단위 테스트 + boilerplate + build tool + source code 모두 production ground truth와 형식 차이를 자동 가드 못 함. 모든 면이 production wiring 첫 등장 시점에서만 드러남. 각각 unit test (fix-1: acorn AST + real ns) + 직접 보증 (fix-2: switch fallback) + 패턴 금지 (fix-3: `import * as` 금지) + 영역 분리 (fix-4: jsx ASCII only) + Validation Gate에 영구 박힘 (§9 panel-side, §10 jsx-side, §11 rollup-side, §12 jsx encoding).

**예방 (Phase 5 30 tool 진입 전 핵심 — meta level)**:
- 새 wiring layer 등장 시 production ground-truth value를 단위 테스트에 직접 박을 것 (mock의 짧은/단순 가정 X).
- bolt-cep boilerplate의 host-detection / namespace registration 의존하는 코드는 우리 fail-safe (default fallback) 추가로 강화.
- ESM build tool (rollup/vite) 산출물의 ES3 호환성을 매 phase exit에 산출물 grep으로 가드.
- jsx layer string literal은 ASCII only — 한국어/non-ASCII는 panel layer가 i18n 책임 분리.
- production wiring 첫 등장 시 inline ExtendScript probe (panel main.tsx의 PROBE_FRAGMENTS 패턴) 임시 주입으로 환경 ground truth 빠르게 확인 — root cause 가설 검증 시간 ↓.

## ✅ Phase 3.7 follow-up 5 (#12) — `sys.heartbeat` 단방향 broadcast가 양방향 watchdog와 모순 (panel idle ~35s 후 사이드카 자체 shutdown)

**증상**: Phase 3.7 follow-up 4 검증 통과 후 사용자 dogfood — panel "Ready" 정상, spike 6ms 정상. 그러나 **panel을 1분 정도 idle 두면 status가 갑자기 `crashed`로 전환**. panel 화면은 보이는 상태(다른 탭 가림 X), AE focus 잃음 X, 사용자 무입력. 로그:

```
Sidecar crashed (code=0, signal=null)
[sidecar] bridge listening on 127.0.0.1:10819
[sidecar] shutdown: panel-shutdown:panel-disconnect
```

**Root cause**: 사이드카 PanelBridge는 두 timer 운용:
- `setupHeartbeat` (panelBridge.ts:555): 10초마다 `sys.heartbeat` **단방향 broadcast** (panel로 송신).
- `setupWatchdog` (panelBridge.ts:562): 5초 간격 체크. **client의 `lastRecvAt`이 30초 이상 idle이면 `ws.close(1001, "heartbeat timeout")`**.

`lastRecvAt`은 **client → sidecar 메시지 수신 시에만** 갱신 (panelBridge.ts:253). 즉 sidecar가 보낸 heartbeat는 자기 자신의 watchdog 클럭을 갱신 안 함.

Panel 측 `useTerminal.ts` 라우터에 `sys.heartbeat` case 부재 → 받기만 하고 echo/응답 송신 0 → 30s 후 사이드카가 `ws.close(1001)` → 5s grace → `onShutdownRequest("panel-disconnect")` → gracefulShutdown → 사이드카 process exit (code=0, 정상 종료). Panel UI는 launcher.onCrash가 아닌 ws "close" 이벤트 받아 status를 `crashed`로 잘못 라벨링 (graceful exit이지만 panel 입장에선 unexpected close).

타임라인 = ~35s (timeout 30s + grace 5s), 사용자 체감 "1분 정도"와 부합.

**왜 보호망 통과**: protocol design intent (D6 typed envelope)은 bidirectional liveness ping. Phase 2 wiring이 **broadcast 절반만** 구현했고, panel echo 누락. `panelBridge.test.ts:338`의 "scenario 12: last client disconnect + grace elapses"는 client가 명시적으로 disconnect하는 path만 검증 — heartbeat-timeout-driven close path는 별도 시나리오 필요했음.

**미발견 이유**: Phase 2 검증 시나리오가 모두 **active interaction** (사용자 입력 → pty.in 송신, 명령 실행 → output 수신). active interaction은 5초마다 메시지가 오가서 `lastRecvAt` 자동 갱신 → watchdog 발화 안 함. **1분+ 무입력 idle 시나리오 0건** → 결함이 dormant 상태로 Phase 3까지 통과.

**Fix (Phase 3.7 follow-up 5)**: panel echo. `useTerminal.ts` 라우터에 case 추가:

```ts
case "sys.heartbeat":
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "sys.heartbeat", ts: Date.now() }));
  }
  break;
```

5줄 변경. protocol.ts `HeartbeatMsg` jsdoc을 bidirectional spec으로 정정 (sidecar broadcast + panel echo, 둘 다 receiver `lastRecvAt` 갱신). Test scenario 13 추가 (`useTerminal.test.ts`): heartbeat 수신 → echo 송신 검증 (mock WS send call count + payload + ts: number).

**디버그법** (다음 비슷한 case 발생 시):
- "panel-disconnect" 사유 shutdown은 항상 panel 측 WS keep-alive 누락 의심. 사이드카 watchdog 코드 확인 (panelBridge.ts:562).
- panel/sidecar 양측의 `grep -n "heartbeat\|keepalive\|ping"`로 wiring 존재 여부 확인.
- 가장 빠른 진단: panel idle 1분+ 두기 → 사이드카 살아있는지 확인. 죽으면 keep-alive 결함.

**메타 가이드 (Phase 4-7 진입 전 핵심)**:
- **phase 검증 시나리오에 idle (1분+ 무입력 후 정상 동작) 포함 필수**. active interaction만으론 keep-alive 결함이 dormant. CLAUDE.md Validation Gate §8 (phase exit) 또는 phase rule에 명시 — 본 commit에서 박힘.
- protocol design이 "bidirectional"인 envelope은 양 쪽 wiring이 둘 다 구현됐는지 명시적 검증 (단위 테스트 + jsdoc 양방향 명시).
- timer-driven close path는 별도 시나리오로 panelBridge.test.ts에 누적 (scenario 12와 동등하게).
- 사이드카 종료 사유 라벨이 panel UI에서 "crashed"로 라벨링되는 케이스 다수 — graceful (code=0) vs unexpected (code≠0/signal) 구분이 panel 진단에 더 도움. 향후 useTerminal의 ws close 처리에서 직전 sys.shutting-down 부재 + code=0이면 "stopped" 또는 별도 라벨로 구분 고려 (out of scope, phase 6 UX 또는 별도 함정).



**증상**: Phase 2 완료 commit (047b8c9) 후 Phase 3.2 진입에서 `npm run build` 첫 실행 → `launcher.ts:303` 타입 에러로 production 빌드 실패. 96 자동 테스트는 모두 green이었으나 vitest는 tsx로 트랜스파일만 하고 strict 타입 검사 안 함.

**Root cause**:
1. `LauncherDeps.setTimeout` 시그니처가 `(cb,ms) => unknown` (line 72) — 명시적 약한 타입.
2. `waitForExit`에서 `const t = (deps.setTimeout ?? setTimeout)(...)` (line 295) → `t: unknown`.
3. `clearTimeout(t)` (line 303) — `unknown`은 `clearTimeout`의 `Timeout|number|undefined` 인자에 할당 불가.
4. dev 사이클 (vitest)은 `tsx` 사용 → 타입 에러 silent skip. production tsc strict 빌드에서 첫 등장.

**Fix**: `LauncherDeps.setTimeout/clearTimeout` 시그니처를 `ReturnType<typeof setTimeout>` 자기 참조형으로 정정. DOM에선 `number`, Node에선 `Timeout`으로 자동 추론 → 환경 무관 호환.

**예방 (본질적 fix)**: 매 phase 종료 commit 전에 **`npm test` AND `npm run build` 둘 다 통과**해야 phase 닫음. test만으론 부족 — vitest tsx 트랜스파일은 strict 타입 검사 skip. 이 룰은 CLAUDE.md Validation Gates §8 (Phase exit gate)에 추가됨. Phase 2가 이 게이트 없이 닫혔던 게 root cause.

**왜 미리 안 잡혔나** (메타 진단):
- bolt-cep boilerplate에 `npm run build`가 있었으나 Phase 0/1/2 어디도 빌드 호출 안 함.
- "Phase 7 ZXP 빌드 전엔 production 빌드 안 돌릴 거"라는 가정이 있었으나 → phase 단위 type 에러 누적 가능성 무시한 가정. CI 없는 단일 개발자 환경에선 매 phase 빌드가 안전망.

**Phase 2.7~2.8에 fix가 안 박혔던 이유** (참고): launcher.ts는 Phase 2.7.0에서 `aePid optional` 리팩토링 + Phase 2.7 sendShutdownOverWs 추가 시 deps 시그니처가 처음 등장 (당시 fast prototype). vitest는 통과 → 진행. 1주일 후 Phase 3.2에서 production 빌드 첫 호출 → 늦은 발견.

## ✅ Phase 4.3 hotfix (#13) — PtyLike interface 미스매치 + 사이드카 typecheck 누락 (이중 트랩)

**증상**: Phase 4.3 commit 후 사용자 dogfood (panel 띄움) → 사이드카 즉시 fatal:

```
[sidecar] {"event":"mcp:register:success"}      ← 4.2 정상
{"type":"fatal","reason":"startup-failed",
 "message":"pty.onExit is not a function",
 "stack":"TypeError: pty.onExit is not a function at sidecar/src/index.ts:362:7"}
```

mcp:register:success 정상 직후 사이드카 main()의 `pty.onExit(...)` 호출이 runtime throw. 4.3 단위 + 통합 테스트는 122/122 그린이었음에도 production wiring에서 첫 발현.

**Root cause** — **이중 트랩**:

**Trap A — PtyLike interface 미스매치**

`sidecar/src/ws/panelBridge.ts`의 `PtyLike`는 Phase 2 시점에 PanelBridge가 직접 호출하는 method만 노출 — `write/resize/onData/getRecentOutput`. **`onExit` / `kill` 누락**. PtyHost (real)는 둘 다 가지지만 interface 선언에 없음.

`sidecar/src/index.ts`의 main()은 PtyHost 가정으로 `pty.onExit(...)` 호출 + shutdown 흐름에서 `pty.kill()` 호출. 4.3에서 `let pty: PtyLike` 선언 + `dummyPty = makeDummyPty()` (ENOENT fallback) 추가. dummyPty 경로 시 onExit/kill 메서드 없음 → runtime throw.

**Trap B — 사이드카 strict tsc 누락 (함정 #10 변형)**

CLAUDE.md Validation Gate §8: "phase 종료 commit 전에 `npm test` AND `npm run build` 둘 다 통과". 본문은 monorepo 양쪽 (panel root + sidecar root) 둘 다 실행한다는 뜻이었으나 **panel root에서 `npm run build`만 실행하면 panel tsc + vite만 거치고 사이드카 tsc는 안 거침**. 4.3 검증 시점에 사이드카 tsc 빠뜨림 — 이게 본 root cause.

사이드카 strict tsc를 hotfix 시점에 실행하니 **4개 type 에러 즉시 발견**:

```
src/index.ts(166,5): Type 'PtyHost' is not assignable to type 'PtyLike'.
  Types of property 'onExit' are incompatible. (signal type mismatch)
src/index.ts(246,11): Property 'kill' does not exist on type 'PtyLike'.
src/index.ts(327,11): Property 'kill' does not exist on type 'PtyLike'.
src/mcp/wsClient.ts(141,17): Conversion of type ... may be a mistake.
```

**4개 모두 tsx runtime에서 silent**, production wiring에서 즉시 fatal.

**왜 보호망 통과** — 이중 검증 모두 fail:
1. **단위 테스트**: `panelBridge.test.ts`의 `makeMockPty`는 PtyLike interface 충족하는 mock. interface에 onExit/kill 없으니 mock에도 없음. main()을 거치지 않아서 line 362 영역 검증 0.
2. **통합 테스트** (`integration-shell-not-found.test.ts`): `spawnSidecar`는 **ready JSON만 받으면 resolve** (line 197 출력 후 즉시). line 362 fail은 ready JSON **이후**라 resolve 시점에 미발생. ws connect + sys.version + server.error 모두 그 짧은 window에서 받힘. spawn-helper의 contract는 만족했고 expect 모두 통과 — **테스트는 사이드카 사후 fatal을 catch 못 함**.
3. **단위 typecheck**: `cd sidecar && npm run build` 별도 실행 명시 누락 → 4개 type 에러 모두 silent.

**자기 비판 (본 root cause 명확화)**: Phase 4.3 검증 commit 시 내가 `cd /c/Users/user/Desktop/성윤/에펙 클로드 && npm run build`만 실행했고 사이드카 tsc 별도 실행은 빠뜨렸다. CLAUDE.md §8 본문이 "양쪽" 의도였으나 **명시 누락**이라 내가 panel root에서만 실행. 사용자 dogfood가 catch한 함정.

**Fix (Phase 4.3 hotfix)**:

1. **Trap A 해소** — PtyLike에 `onExit` + `kill` 추가:
   ```ts
   onExit(cb: (code: number, signal?: number) => void): () => void;
   kill(): Promise<void>;
   ```
   `signal?: number`는 PtyHost.ExitCb 시그니처와 일치 (Windows ConPTY graceful exit 시 signal 부재).
2. `makeDummyPty()`에 noop `onExit` (return noop unsubscribe — dummy never exits) + noop `kill` (return Promise.resolve) 추가.
3. 모든 mock PtyLike (`makeMockPty` panelBridge.test, `makeStubPty` integration-mcp/dispatcher) 같이 update — interface 정합 보장.
4. `wsClient.ts:141`의 cast `msg as ResultMsg | ErrorMsg` → `msg as unknown as ResultMsg | ErrorMsg` (parsed shape vs envelope 구조 차이).

**Trap B 해소** — CLAUDE.md §8 본문 보강:
> phase 종료 commit 전에 **monorepo 양쪽 (panel root + sidecar root)에서 각각 `npm run build` 명시 실행**. panel root만 실행 = panel tsc + vite만, 사이드카 tsc strict 미실행 = 함정 #13 재발.
> ```bash
> cd sidecar && npm run build && cd ..
> npm run build
> ```

**통합 테스트 보강** — `integration-shell-not-found.test.ts`에 신규 시나리오:
> "invalid AE_CLAUDE_SHELL → sidecar stays alive past boot (no late fatal)"
>
> ready JSON + sys.version + server.error 받은 후 1.5s 대기 + ws.readyState === OPEN 검증. 사이드카가 main() 끝까지 정상 통과했는지 사후 검증. 향후 비슷한 "ready 직후 fatal" 함정을 spawn-helper의 ready-only resolve가 놓치지 않도록.

**디버그법** (다음 비슷한 case 발생 시):

- panel/사이드카 monorepo면 panel root + sidecar root 양쪽 build 명시 실행.
- mock interface (`PtyLike` 같은 ABC)는 real implementation의 모든 public method 노출. interface 사용처를 grep해서 호출되는 모든 method가 interface에 박혀있는지 확인.
- "ready JSON 후 fatal" 패턴: 통합 테스트가 ready만 기다려 resolve하는 경우 ready 이후 사이드카 alive 검증 추가 (대기 + readyState 검사).

**메타 가이드 (Phase 5+ 진입 전 핵심)**:

- **모든 mock interface는 real implementation의 superset이거나 같은 set이어야** — interface는 호출되는 모든 method를 enumerate. abstract base class (ABC) 자세 도입 검토.
- **monorepo phase exit gate**: monorepo 각 package root에서 build 강제. CI 부재 환경에서는 사용자가 직접 양쪽 실행 책임. CLAUDE.md에 명시 → 자동 가드.
- **integration test의 resolve trigger 점검**: ready/init/connect 같은 "준비 완료" 신호가 main() 마지막 라인을 의미하지 않음. main() 끝까지 통과 검증 (alive 검사) 별도 시나리오 추가.

## ✅ Phase 4.4 fix (#14) — node-pty PATH lookup 부재 (child_process.spawn과 다른 spawn 메커니즘)

**증상**: Phase 4.4 사용자 dogfood — panel 띄우면 spike round-trip은 정상 (6ms), 하지만 **xterm 영역 검은 화면 + 키 입력 부분 손실** (한글 마지막 글자만 남음). hotfix #13 적용 후에도 동일.

**진단 trace** (사이드카 file probe 결과):

```
[probe:main:enter]   pid=18508, cwd="...에펙 클로드/sidecar"           ← main() 진입 OK
[probe:main:cfg]     shell="claude", args=["--model","claude-opus-4-7"]  ← cfg 정확
[probe:pty.spawn:try] cmd="claude", cwd="...sidecar"
[probe:pty.spawn:error] {
  "message": "File not found: ",
  "name": "Error",
  "stack": ["...WindowsPtyAgent..."],
  "detectedAsShellNotFound": true
}                                                                        ← node-pty가 ENOENT
[probe:dummypty:enter] reason="shell-not-found"                          ← dummyPty fallback
```

즉 같은 사이드카 process에서 **두 spawn 메커니즘이 다르게 동작**:

| 위치 | spawn 메커니즘 | 결과 |
|---|---|---|
| `registerWithClaude.ts:132` | `child_process.spawn("claude", [...])` | ✅ exit 0 (PATH lookup 정상) — 4.2 mcp:register:success 로그가 증거 |
| `index.ts:170` (`new PtyHost`) | `node-pty spawn("claude", [...])` | ❌ `WindowsPtyAgent: File not found` |

**Root cause**: **node-pty는 PATH lookup을 하지 않음**. `child_process.spawn`은 PATH 환경변수를 walk해서 binary를 찾지만, node-pty는 Windows ConPTY API에 path를 verbatim 전달 — 절대 path 또는 cwd-relative path만 받음. 같은 환경 / 같은 cwd / 같은 PATH에서 한 쪽은 OK, 다른 쪽은 ENOENT.

**왜 보호망 통과**:
1. **단위 test mock** (`shellResolve.test.ts`는 fix 시점 추가): Phase 4.3 시점의 panelBridge / mcp / dispatcher mock은 모두 PtyLike 자체를 mock — node-pty / spawn 메커니즘 차이를 건드리지 않음.
2. **통합 test override**: `spawn-helper.ts`의 default `AE_CLAUDE_SHELL=cmd.exe` (Windows) / `bash` (else). cmd.exe는 절대 path도, PATH lookup도 모두 OK인 special case — node-pty의 PATH 부재를 안 드러냄. 즉 14 통합 시나리오 전부 cmd.exe 의존성 때문에 본 함정이 dormant.
3. **Hotfix #13 (PtyLike + sidecar tsc)** 검증도 cmd.exe override 사용 — 같은 이유로 못 잡음.
4. **사용자 dogfood**가 첫 검증 — production wiring (claude shell)이 처음 등장한 시점에서만 발현. 사이드카 stderr는 panel launcher.ts:148이 buffer에만 누적해서 정상 부팅 시 외부 노출 0 → file probe (`C:\temp\ae-probe.log`)로 우회 진단.

**Fix (Phase 4.4 fix)**: `which` 패키지로 사전 PATH lookup. `sidecar/src/shellResolve.ts` 신규:

```ts
export function resolveShellPath(shell: string, whichFn = defaultWhichSync): string {
  if (isAbsolute(shell)) return shell;
  try { return whichFn(shell); }
  catch { return shell; }   // fail-safe → PtyHost ENOENT → dummyPty
}
```

`index.ts` main()에서 PtyHost 생성 직전 호출:
```ts
const resolvedShell = resolveShellPath(cfg.shell);
pty = new PtyHost({ cmd: resolvedShell, ... });
```

**fail-safe 의도** (jsdoc에도 박힘): which throw 시 입력 그대로 반환 → PtyHost ENOENT → 기존 dummyPty fallback path (Phase 4.3 hotfix #13 산출). 즉 resolveShellPath는 **"shell not found" UX의 단일 source를 깨지 않음** — 추가 분기 없이 PATH lookup gap만 메움.

**which 패키지 import 함정** (이 fix에서도 한 번 발현, mistakes #11/#13의 친척):
- `which` v6+는 `module.exports = which; which.sync = whichSync` (CJS).
- ESM `import { sync as whichSync } from "which"` → `SyntaxError: does not provide an export named 'sync'` (named export로 인식 안 됨).
- 정답: `import which from "which"` + `which.sync(cmd)` 호출.
- 첫 사이드카 build는 strict tsc 0 에러였지만 vitest run에서 11 fail 발생 — runtime ESM resolution이 strict tsc보다 엄격. 동일 fix commit에 같이 박음.

**디버그법** (다음 비슷한 case 발생 시):
- 사이드카 stderr 외부 노출 0 → file probe 패턴 (절대 ASCII path, 한국어/공백 path 회피).
- spawn 메커니즘 둘 (`child_process.spawn` vs `node-pty`)이 동일 입력에 다르게 동작하면 **PATH lookup 차이 의심** — `which.sync` 또는 `where <cmd>`로 사전 검증.
- Windows 환경에서 ENOENT 메시지가 ConPTY 측에서 오면 (`WindowsPtyAgent: File not found`) 100% PATH lookup 부재.

### Sub-section: Phase 4.4 fix-2 — MCP entry path dev/prod resolution (Aspect B)

**Aspect 명확화** (#14 본문 두 면):
- **Aspect A (위 본문)**: spawn 메커니즘 차이. `child_process.spawn` PATH lookup OK / `node-pty` PATH lookup X. **사이드카가 PTY로 spawn하는 binary** (claude shell)에서 발현. fix = `resolveShellPath` (which 사전 lookup).
- **Aspect B (이 sub-section)**: **dev/prod entry path resolution**. claude CLI가 spawn하는 ae-mcp child entry — 사이드카가 tsx로 src/.ts를 직접 실행할 때, mcp/server entry는 `src/mcp/server.js` (존재 X — src에는 .ts만)로 박혀 fail. fix = `resolveMcpSpawn` (사이드카의 import.meta.url 기반 dev/prod 자동 분기).

두 aspect 모두 같은 메타 패턴: **production wiring 첫 등장 함정 (#11과 같은 family)**. 같은 fix commit에 동시 발견 — Aspect A fix 후 panel 띄우고 `/mcp` 진단하면 Aspect B 발현 (`ae-mcp · ✗ failed to connect`).

**증상**: Phase 4.4 fix (Aspect A) 적용 후 사용자가 panel xterm 안의 claude에서 `/mcp` 실행 결과:

```
Local MCPs (...sidecar [project])
> ae-mcp · ✗ failed
```

`claude mcp get ae-mcp`:
```
Args: C:\Users\user\Desktop\성윤\에펙 클로드\sidecar\src\mcp\server.js
                                                       ^^^ src에는 .ts만
```

**Root cause**: Phase 4.2 시점의 mcpEntryAbs 계산:
```ts
const sidecarDir = dirname(fileURLToPath(import.meta.url));
const mcpEntryAbs = join(sidecarDir, "mcp", "server.js");
```

사이드카가 `tsx src/index.ts`로 실행되면 `import.meta.url = .../sidecar/src/index.ts` → `sidecarDir = .../sidecar/src` → `mcpEntryAbs = .../sidecar/src/mcp/server.js` (존재 X).

**Self-aware trade-off** (4.2 jsdoc 인용 — 함정을 의식했으나 fix 안 한 사례):

> "Entry path resolution: this file is `<sidecar>/dist/index.js` after build (or `<sidecar>/src/index.ts` under tsx dev). The MCP entry is a sibling `mcp/server.js` — for dev/tsx the file won't exist yet, **and that's fine: register still succeeds (claude doesn't validate the path until it tries to spawn the entry). The 4.4 user dogfood step is what verifies the path actually resolves to a runnable file.**"

이 jsdoc은 정확히 4.4 dogfood가 catch할 함정을 사전 의식했다. 의식 → 명시 self-aware decision으로 미루기 → dogfood가 verify. 이 패턴 자체는 valid (모든 함정을 phase 1에 fix할 수 없음, 사용자 검증 시점까지 미루는 게 합리적). 미래 reader는 이 self-aware decision pattern 자체를 수입 가능 — "함정 의식했으나 다음 phase로 미루기 + jsdoc에 명시 박기 → dogfood가 catch".

**Fix (Phase 4.4 fix-2)**: 사이드카 main 패턴 (`factories.ts:60-64`의 `SIDECAR_CMD = "node"` + `SIDECAR_ARGS = [tsx_cli, "src/index.ts"]`)을 mcp register에도 동일 적용.

`sidecar/src/index.ts`:
```ts
function resolveMcpSpawn(): { cmd: string; args: string[] } {
  const sidecarDir = dirname(fileURLToPath(import.meta.url));
  const isSrcMode = /[\\/]src$/.test(sidecarDir);
  if (isSrcMode) {
    const sidecarRoot = dirname(sidecarDir);
    return {
      cmd: "node",
      args: [
        join(sidecarRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(sidecarRoot, "src", "mcp", "server.ts"),
      ],
    };
  }
  return {
    cmd: "node",
    args: [join(sidecarDir, "mcp", "server.js")],
  };
}
```

`registerMcpWithClaude` 시그니처 변경: `serverEntryPath: string` → `spawnCommand: string + spawnArgs: string[]`. claude mcp add 명령은 `claude mcp add ae-mcp -e KEY=VAL -- <cmd> <...args>` 형태로 multi-arg 자연 지원.

Phase 7 ZXP 패키징 시 자동으로 prod mode 전환 (`import.meta.url` = dist/index.js → isSrcMode false → dist path 박힘). 코드 변경 0.

**메타 학습 (Aspect A vs B 분리)**:
- Aspect A는 OS layer (PTY spawn 메커니즘). Aspect B는 build artifact layer (tsx vs dist). 둘 다 production wiring 첫 등장에 발현하지만 fix 위치 다름.
- 두 aspect를 한 함정 #14에 묶은 이유: 같은 production wiring sub-step (Phase 4.4)에서 발견 + 같은 사용자 dogfood 검증 패턴 + 함정 번호 인플레 회피.
- 미래 fix 시 aspect 분리 명시 (예: "함정 #14 Aspect A 또는 Aspect B에 해당") — 검색/추적 용이.

**메타 가이드 (Phase 5+ 30 tool 진입 전 핵심)**:
- **production wiring (실제 사용자 binary)이 처음 등장하는 sub-step은 항상 file probe + dogfood로 검증** — 단위 test mock + integration override는 spawn 메커니즘 차이 같은 OS-layer 함정을 dormant 상태로 통과시킴.
- **외부 dependency의 spawn 메커니즘 가정 명시**: PATH lookup 여부 / encoding / signal handling / stdio 흐름 등은 라이브러리별 다름. PtyHost (node-pty) 같은 OS 직결 컴포넌트는 추가 사전 검증 layer (`resolveShellPath` 같은 helper) 박는 게 안전.
- **third-party 패키지 ESM/CJS 차이**: import 문법이 strict tsc 통과해도 runtime에서 fail 가능. 신규 npm 패키지 도입 시 vitest run 직접 실행으로 import 동작 확인 (단위 test 1개라도) — strict tsc만 의존하지 말 것.
- **함정 #11 4 faces + #13 + #14 통합 메타**: production ground truth (ES3 ExtendScript / Windows ConPTY / node-pty PATH / claude TUI 등)는 단위 mock + integration override로 100% 시뮬 불가능. **사용자 dogfood가 항상 마지막 검증**.

### Sub-section: Phase 4.4 fix-3 — MCP entry guard suffix dev/prod (Aspect C)

**Aspect 명확화** (#14 본문 세 번째 면):
- **Aspect A (위 본문)**: spawn 메커니즘 차이 — `child_process.spawn` PATH lookup OK / `node-pty` PATH lookup X. fix = `resolveShellPath` (which 사전 lookup).
- **Aspect B (이전 sub-section)**: dev/prod entry path resolution — claude register 시 entry 경로가 `src/.js` (존재 X)로 박힘. fix = `resolveMcpSpawn` (사이드카 import.meta.url 기반 dev/prod 자동 분기).
- **Aspect C (이 sub-section)**: **entry guard suffix list dev/prod 양면 누락**. `mcp/server.ts`의 self-entry guard가 `.js` suffix만 검사 → tsx로 `.ts` 직접 실행 시 guard skip → `McpServer.connect()` 미실행 → claude stdio child가 MCP handshake 없이 즉시 종료 → claude `× failed`. fix = entry guard suffix list에 `.ts` 두 줄 추가 (forward + backward slash).

세 aspect 모두 같은 메타 패턴: **production wiring 첫 등장 함정 (#11과 같은 family) + dev/prod 분기 누락**. Aspect B fix 후 panel `/mcp` 다시 진단하면 Aspect C 발현 — Aspect B는 entry **경로**를 dev mode에 맞춰 박았으나, entry **파일 내부의 self-guard**도 dev/prod 둘 다 인식하도록 별도 보강 필요했음. 같은 dev/prod boundary가 두 layer (호출자 args + 피호출자 guard)에서 따로 cut.

**증상**: Phase 4.4 fix-2 (commit `9889af0`) 적용 후 panel `/mcp` 결과:

```
Local MCPs (...sidecar [project])
> ae-mcp · × failed
```

`.claude.json` ae-mcp 엔트리 직독 결과 args는 정상 저장됨 (Korean+space full path 포함, 잘림 0):
```json
"args": [
  "C:\\...\\sidecar\\node_modules\\tsx\\dist\\cli.mjs",
  "C:\\...\\sidecar\\src\\mcp\\server.ts"
]
```

→ args 인코딩/잘림 가설 기각. panel `/mcp` UI의 "이후 잘림" 표시는 단순 UI cropping.

**Root cause**: `sidecar/src/mcp/server.ts:80-83` (Phase 4.2 시점) entry guard:
```ts
const isEntry = process.argv[1] && (
  process.argv[1].endsWith("/mcp/server.js") ||
  process.argv[1].endsWith("\\mcp\\server.js")
);
```

prod (`.js`) → suffix 매치 → `if (isEntry)` 블록 실행 → `McpServer.connect(StdioServerTransport)` 등록 OK.
dev (`.ts`) → suffix 미매치 → guard skip → MCP handler 등록 X → claude stdio child 즉시 종료 → claude `× failed`.

**Self-aware trade-off** (4.2 jsdoc 인용 — 함정 의식 + 미루기 + dogfood layered catch):
4.2 jsdoc은 entry **경로** 함정만 명시 (Aspect B는 그 자리에서 catch). entry **guard suffix**는 자체 인식 안 됨 — 같은 dev/prod boundary지만 다른 layer라서 4.2 시점에 함께 의식 못 함. 4.4 dogfood가 layered fashion으로 잡아냄: fix-1 (Aspect A) → 다음 dogfood loop → fix-2 (Aspect B) → 다음 dogfood loop → fix-3 (Aspect C).

이는 self-aware decision pattern 자체의 한계 보여줌 — **의식한 함정만 jsdoc에 명시 가능, 같은 메타 family의 다른 layer 함정은 한 layer fix 후 재현해야 발현**. 미래 reader는 self-aware trade-off → layered fix 워크플로우를 학습 가능: "한 phase의 production wiring 첫 등장은 dogfood loop를 N회 반복해야 모든 layer 누락이 catch될 수 있음. 한 번의 dogfood로 끝난다고 가정하지 말 것."

**Fix (Phase 4.4 fix-3)**: `sidecar/src/mcp/server.ts` entry guard suffix list에 `.ts` 두 줄 추가:
```ts
const isEntry = process.argv[1] && (
  process.argv[1].endsWith("/mcp/server.js") ||
  process.argv[1].endsWith("\\mcp\\server.js") ||
  process.argv[1].endsWith("/mcp/server.ts") ||
  process.argv[1].endsWith("\\mcp\\server.ts")
);
```

prod 회귀 0 (기존 `.js` 두 줄 그대로 유지). dev (`.ts`) 새 path 진입 → MCP server 등록 OK → claude `✓ connected`.

**메타 학습 (Aspect A/B/C 통합)**:
- 한 production wiring sub-step (Phase 4.4)에 같은 메타 family (#11) 함정 셋이 layered로 발현. 한 commit으로 다 fix하지 못한 이유: 각 aspect가 이전 aspect fix 후 dogfood loop에서 비로소 reachable (Aspect A 미해결 시 사이드카 자체가 boot 못 함 → Aspect B/C 도달 X. Aspect B 미해결 시 claude entry 경로 자체 invalid → Aspect C 도달 X).
- **layered dogfood 원칙**: production wiring first encounter sub-step은 N회 dogfood loop 가정 + 매 loop마다 fix-N commit. fix-1 후 "다 끝났다" 가정 금지.
- **entry guard 패턴 일반화** (Phase 5+ 30 tool 추가 시 적용): tool impl 파일이 self-entry 가능한 구조면 guard suffix list에 dev (`.ts`) + prod (`.js`) 두 종 모두 등록. ESM dynamic import 가정도 마찬가지 (확장자별 분기 누락 위험).



**증상**: panel을 6-8번 열고 닫은 후 작업관리자에 Node 좀비 ~20개. 메모리별 두 개씩 짝지어 (큰 + 작은) 누적. fix-1, fix-2 후에도 발생.

**Root cause**: 두 가지가 동시에 누락:
1. **Panel 측**: CEP panel close → React unmount의 async cleanup chain (`sendShutdownOverWs → launcher.stop → terminal.dispose`)이 panel runtime 종료 전에 못 끝남. 즉 `sys.shutdown` 메시지가 사이드카에 도달 못 하는 케이스 多.
2. **사이드카 측**: PanelBridge가 client `ws.close` 이벤트는 처리하나 **자체 self-shutdown trigger 없음**. 클라이언트 다 끊겨도 다음 client 기다리며 alive 유지.

→ panel close → 사이드카는 "잠깐 끊긴 거" 인식 → 다음 panel 열 때 새 사이드카 또 spawn → 좀비 누적.

**Fix (Phase 2.8.4 fix-3)**: PanelBridge에 disconnect grace shutdown 추가:
- `clientDisconnectGracePeriodMs` 옵션 (default 5000)
- 마지막 client disconnect → grace timer 시작
- grace 안에 새 connection 들어오면 cancel
- grace 만료 + clients still empty → `onShutdownRequest("panel-disconnect")` → index.ts gracefulShutdown → lockfile 정리 + process exit

**왜 5초 default**:
- panel 빠른 reload (<2초) 에는 안 발동
- 사용자가 panel 닫고 5초 안에 다시 안 열면 self-shutdown 합리적 (좀비 방지)
- Phase 4/5에서 사용 패턴 보고 조정 가능 (예: 30초로 늘리기)

**예방**: 외부 process를 owning하는 hook (CEP panel 같은 ephemeral runtime에서) — graceful shutdown 메시지가 도달 안 할 case에 대비해 사이드카 측 self-trigger 메커니즘 필수. AE death watchdog (Phase 2.5.6) 같이 _다중 trigger 경로_ 가지는 게 안전.

**검증 (2026-05-05)**: 패널 2-3회 open/close 사이클 (`echo hello` 입력 포함), 작업관리자 결과 — 사이드카 Node 프로세스 0개, vite/npm dev + Claude Code CLI 4개만 잔존. 5초 grace timer + self-shutdown production-grade 작동 확인. 시나리오 a/b/c/d/e 모두 통과로 Phase 2.8.4 닫음.

## ✅ Phase 2.8.4 — React StrictMode + useTerminal heavy side-effect 충돌 (사이드카 double-spawn race)

**증상**: 시나리오 a 재검증 시 status "Crashed" + ws close. console 로그가 명확:
1. `[useTerminal] mount → starting`
2. `[useTerminal] launcher.start() called`
3. `[useTerminal] cleanup begin` ← 여기
4. `[useTerminal] mount → starting` (재시작)
5. `[useTerminal] launcher.start() called`
6. `[useTerminal] launcher ready`
7. `[useTerminal] ws open`
8. `[useTerminal] ws close` ← 즉시 끊김

**Root cause**: React 18+ StrictMode가 개발 모드에서 useEffect를 의도적으로 두 번 invoke (mount → cleanup → mount). useTerminal 같은 **무거운 side effect** (사이드카 spawn + lockfile + WS bind)에선 두 번째 mount의 새 사이드카가 첫 번째 cleanup이 아직 정리 못 한 상태에서 충돌 (port/lockfile race) → 두 번째 ws가 곧 close.

**Fix**: entry 파일에서 `<React.StrictMode>` 제거. Production 빌드는 StrictMode 영향 0 (개발 도구일 뿐). 잃는 것: 일부 React 개발 모드 검증 (legacy lifecycle, 부수효과 검증). 사이드카 같은 외부 process 관리엔 부적합.

**대안 (채택 안 함)**: useRef mount-guard로 두 번째 invoke skip — 코드 복잡 + StrictMode 의도 회피. CEP panel은 SSR/concurrent rendering 시나리오 없으니 StrictMode 검증 가치 낮음.

## ✅ Phase 2.8.4 — child_process.spawn shell:true Windows path-with-space/Korean quote 함정

**증상**: 사이드카 spawn 시도 → exit code 1 + stderr `Cannot find module 'C:\Users\user\Desktop\성윤\에펙'` (path가 공백에서 잘림).

**Root cause**: `child_process.spawn(cmd, args, { shell: true })` Windows 환경. shell:true는 cmd.exe가 args 파싱하는데 공백이 있는 path는 quote 안 되면 단어 단위로 잘림. 절대 경로 args (`C:\Users\user\Desktop\성윤\에펙 클로드\...`)에 공백 + 한글 → cmd.exe가 `C:\Users\user\Desktop\성윤\에펙`까지만 첫 args로 읽고 나머지 buffer.

**Fix (option 3 — cwd 사용)**:
- spawn options에 `cwd: SIDECAR_ROOT` 추가
- args를 **상대 경로**로 변경: `["node_modules/tsx/dist/cli.mjs", "src/index.ts"]`
- args에 공백 없으면 cmd.exe quote 문제 회피

**왜 option 2 (shell:false + node 절대 경로) 안 썼나**:
- shell:true는 PATH lookup 보장에 필요 (Phase 2.6 spike에서 확인). shell:false 시 system Node 절대 경로 hardcode 필요 → fnm 환경 의존도 ↑.

**예방**: Windows + spawn + shell:true 조합에선 항상 args 상대 경로 + cwd. 다른 spawn 사용처(spawn-helper.ts는 shell:false라 무관)에서도 동일 패턴 검토.

## Phase 2.8.4 — panel이 시스템 Node 24 spawn (fnm default vs project 20)

**증상**: fix-1 적용 후에도 사이드카가 Node v24.13.1로 실행 (stderr에 표시). 우리 프로젝트는 .nvmrc=20.

**Root cause**: panel runtime의 `child_process.spawn("node")` 는 시스템 PATH의 node 사용. fnm default가 v24면 그게 픽업됨. panel runtime은 fnm hook (chpwd-style auto-switch) 못 받음 — fnm은 shell의 cwd-change hook 기반인데 panel runtime은 그 hook 없음. cwd:SIDECAR_ROOT 설정해도 fnm shim이 안 발동.

**영향**:
- Phase 2.5 사이드카 통합 테스트는 .nvmrc=20 환경에서만 검증됨 (vitest를 sidecar/에서 실행)
- Node 24에서 사이드카 코드 동작 보장 X — node-pty native module 호환성 등

**현재 결정**: Node 24도 우리 사이드카 (TypeScript ESM, node-pty 1.x)와 호환 가능성 큼. 일단 spawn 동작 확인 후 panel 검증 → fail 시 fix.

**중기 fix 후보** (Phase 2.8.5 또는 후속):
- factories.ts에서 fnm-managed Node 20 절대 경로 detect (`fnm exec --using=20 which node` 같은 패턴) → cmd로 사용
- ENV `AE_CLAUDE_NODE_PATH` 명시 override hook 노출
- production (Phase 7 D9): portable Node 20 ZXP 동봉 → 이 문제 자동 해결

**Phase 4 후속**: PTY가 claude CLI로 교체될 때 claude는 자체 binary라 Node 버전 무관. 단 사이드카 자체는 Node 의존이라 위 detect 메커니즘 유지.

**예상 증상**: AE에서 panel 첫 열 때 사이드카 spawn 시도 → `spawn ENOENT` 또는 args에 `undefined/...` 표시.

**진단**: factories.ts의 `__DEV_SIDECAR_ROOT__` 가 빌드에 정상 주입됐는지 확인:
- panel DevTools (`http://localhost:8860`) → Console → `console.log(__DEV_SIDECAR_ROOT__)` 평가
- 결과가 절대 경로 string이면 정상; `ReferenceError` 또는 `undefined`면 미주입

**Root cause 후보**:
1. `vite.config.ts`의 `define: { __DEV_SIDECAR_ROOT__: ... }` 가 cep-plugin과 merge 안 됐을 가능성 (vite-cep-plugin 자체 define 사용 시)
2. dev server 재시작 안 한 상태 (define은 빌드 시점 처리, hot reload 시 반영 안 될 수 있음)

**Fix 후보**:
- dev server 완전 재시작 (`npm run dev` 종료 → 다시 실행)
- vite-cep-plugin merge 우회: `define`을 `process.env.__DEV_SIDECAR_ROOT__` ENV로 변경 + factories에서 읽기
- 최후: production-style ENV 변수만 사용 (vite define 포기)

**해결 후 확인**: panel DevTools console에서 절대 경로 출력 확인 + 사이드카 spawn args에 정확한 path 박혔는지.

## Phase 2.7.1.3 spike — backspace 미동작은 mock echo 한계 (#8에서 자동 해결)

**관찰**: 시각 spike에서 사용자가 backspace 키 누르면 글자 안 지워짐.

**원인**: spike의 EchoFakeWS는 `pty.in` → `pty.out` 단순 passthrough. `\x7f` (DEL) 같은 키도 그대로 echo. 실제 PTY 환경에선 cmd.exe/bash가 `\b \b` (backspace + space + backspace) 응답으로 글자 지움.

**판정**: spike 검증 결과에 영향 X. Phase 2 #8 (진짜 사이드카 연결) 단계에서 cmd.exe가 처리 → 자동 해결.

## ✅ Phase 2.6 spike 결과 — bolt-cep node.ts child_process.spawn 작동 확인

**검증**: `src/js/main/main.tsx`에 임시 spike 코드 추가 → AE에서 panel 열어 spike-result.txt 받음.

```json
{
  "spawnFn": "function",
  "exitCode": 0,
  "exitSignal": null,
  "stdout": "{\"hello\":\"world\",\"ts\":1777905262017}\n"
}
```

**결론**:
- bolt-cep `src/js/lib/cep/node.ts`가 panel runtime에 표준 Node.js modules 노출 (`child_process.spawn`, `fs`, `os`, `path` 등)
- Phase 2.5 spawn-helper.ts와 **동일한 EventEmitter 기반 API** + 정식 TypeScript 타입 (`typeof import("child_process")`)
- stdout streaming 정상 (chunk-by-chunk on data event)
- 자식 프로세스 정상 종료 시 exit 이벤트 fire (code: 0, signal: null)

→ panel launcher (`src/js/main/sidecar/launcher.ts`)는 옵션 E (`child_process.spawn`) 사용 확정. ~~옵션 A (cep.process.createProcess)~~ 불필요.

**관련 발견** — `npm run dev` 첫 실행 시 ENOENT (`dist/cep/main/index.html`)
- 원인: `vite-cep-plugin`이 폴더 자동 생성 안 함
- fix: `mkdir -p dist/cep/main` 한 번 실행 후 `npm run dev` 정상 작동
- 또는 `npm run build` 한 번 실행으로 dist/cep 풀 구조 생성

## ✅ 2026-05-04 Windows process.kill SIGTERM = TerminateProcess (graceful 불가) — sys.shutdown으로 해결

**문제**: Phase 2.5.5 통합 테스트에서 `process.kill(sidecarPid, "SIGTERM")` 호출 후 사이드카가 graceful shutdown 안 함 → lockfile 안 삭제됨.

**Root cause**: Node.js Windows에서 `process.kill(pid, signal)`은 모든 signal을 SIGKILL과 동등하게 처리 → `TerminateProcess` Windows API 호출. 사이드카의 `process.on("SIGTERM", ...)` 핸들러는 **fire되지 않음**. POSIX SIGTERM 의미론(graceful) 자체가 Windows에 없음.

**영향**:
- 사이드카 측면: 어떤 OS signal로도 graceful shutdown trigger 불가능 (Windows)
- production 시 panel close → AE death watchdog만 유일한 graceful 경로
- 통합 테스트에서 lockfile cleanup 검증 불가능 (SIGTERM이 graceful path 안 트리거)

**Fix (Phase 2.5.5.0)**: WS-level `sys.shutdown` 메시지 신설.
- protocol.ts: `ShutdownRequestMsg` (`type: "sys.shutdown"`, primary client only) + `ShuttingDownMsg` (server broadcast ack)
- panelBridge.ts: `onShutdownRequest` 콜백 옵션. WRITE_TYPES에 `sys.shutdown` 추가 (multi-client refusal 일관)
- index.ts: 콜백을 `gracefulShutdown("panel-shutdown:<reason>")`에 wire
- spawn-helper.ts: `sendShutdown(reason?)` API — 통합 테스트 cleanup용
- production 의미: panel close 시 명시적 sys.shutdown 송신 → 사이드카 정리 보장

**Phase 2.5.5.1 검증**: lockfile race 시나리오 6 통과 (sidecar1.sendShutdown → lockfile 삭제 → sidecar3 spawn 성공).

**남은 한계 (mistake로 등록)**: Production에서 panel이 비정상 crash하면 sys.shutdown 못 보냄 → lockfile orphan. 이 케이스는 다음 사이드카 spawn 시 stale detection이 처리 (시나리오 6b로 검증 완료).

## 2026-05-04 node-pty 'Signals not supported on windows' uncaughtException

**관찰**: Phase 2.5.5 시나리오 6 디버깅 중 사이드카 stderr에서 발견:

```
{"type":"uncaught","message":"Signals not supported on windows.",
 "stack":"...WindowsTerminal.<anonymous> windowsTerminal.ts:167..."}
```

**원인**: node-pty 1.x Windows에서 `pty.kill("SIGTERM")` 호출 시 내부 socket data 처리 path에서 비동기적으로 throw. PtyHost.kill의 `try { pty.kill("SIGTERM") } catch {}`는 동기 throw만 잡고 비동기 throw는 uncaughtException으로 olso.

**영향**:
- index.ts의 `process.on("uncaughtException")` 핸들러가 graceful shutdown 트리거 → 의도하지 않은 shutdown 가능
- 단 안정성 직접 영향은 적음 — shutdown 자체는 정상 진행

**임시 처리**: Phase 2.5.4 tree kill이 1초 후 OS-level taskkill을 발동하므로 graceful path 자체엔 의존 X. uncaughtException은 stderr 노이즈 + 부정한 shutdown trigger 가능성으로 남음.

**근본 fix 후보 (Phase 4 후속)**:
1. Windows에서 `pty.kill()` (signal 인자 없이) 사용 — node-pty가 내부적으로 안전하게 처리
2. node-pty 호출 자체 skip — 1초 graceful 단계 건너뛰고 바로 tree kill
3. node-pty 업스트림 fix 대기

**Phase 4 검증 시 확인**: claude CLI를 PTY로 띄울 때 동일 문제 재현되는지. 재현되면 후보 1 또는 2 적용.

## ✅ PtyHost.kill ConPTY 호환성 — Phase 2.5.4에서 검증 + fix 적용 완료

**가설 (Phase 2.2)**: ConPTY는 SIGTERM 무시 + node-pty의 5s SIGKILL fallback도 hang 가능.

**Phase 2.5.4 검증 결과 (2026-05-04)**:
- 가설 **확인** + **추가 발견**: SIGTERM뿐 아니라 node-pty 경유 `pty.kill("SIGKILL")`도 ConPTY에 무력. 12s 시험 동안 OS pid 23회 폴링 모두 ALIVE, node-pty `onExit` 영영 fire 안 함.
- 즉 node-pty의 `pty.kill(signal)`은 Windows ConPTY child에 어떤 signal도 전달 못함.

**Fix 적용 (`sidecar/src/pty/ptyHost.ts` `kill()`)**:
1. SIGTERM via `pty.kill()` — bash에선 graceful 종료, ConPTY에선 무시(harmless)
2. **1초 후** OS-level **tree kill** (node-pty 우회):
   - Windows: `child_process.spawn("taskkill", ["/F", "/T", "/PID", pid])` — taskkill 자체에 3s self-timeout
   - Unix: `process.kill(-pid, "SIGKILL")` (process group), fallback `process.kill(pid)`
3. **8초 hard cap** (`killHardCapMs` ENV로 override 가능): `onExit` 영영 안 와도 Promise resolve + `_alive=false` 강제 마킹

**검증 결과**:
- 시나리오 8 (`integration-conpty-kill.test.ts`): 12s hang → **2.1s resolve**로 단축
- 타임라인: 0ms SIGTERM(무시) → 1000ms taskkill /F /T 발동 → 1524ms OS DEAD → 2139ms onExit fire → Promise resolve
- 회귀 0: Phase 2.2 ptyHost smoke 포함 65 기존 테스트 모두 통과 유지

**Tree kill 선택 이유**:
- Phase 4에서 PTY가 cmd.exe → claude CLI로 교체됨
- claude CLI가 자식 프로세스 띄울 가능성 (HTTP client, MCP server, 등) — 부모 PID만 죽이면 자식이 좀비
- `taskkill /T` (tree) + `killpg(-pid)`는 자식 포함 정리 → Phase 4 대비 보호적

**Phase 4 후속 검증 (필수)**:
- claude CLI로 PTY 교체 후 시나리오 8 재실행
- claude가 자식 띄우는지 `tasklist` (Windows) / `ps` (Unix)로 확인
- tree kill이 모든 자식까지 정리하는지 — 안 되면 추가 fix (예: `taskkill /T` 옵션 보강 또는 wmic 사용)

### Resolution + playbook (2026-05-04)

**Fix**: `_validateAst.ts`에 `DANGEROUS_PROPS` set 추가 + `MemberExpression` visitor의 non-computed branch 신설.

**막힌 우회 패턴 5종** (모두 ECMAScript 표준 sandbox escape, ExtendScript ES3에서도 작동):

| 패턴 | 위험 식별자 | 실 코드 예시 | 작동 원리 |
|---|---|---|---|
| Function constructor via primitive | `constructor` | `(0).constructor("return File")()` | 모든 값의 `.constructor`가 그 타입의 생성자. Number의 `.constructor.constructor`는 Function constructor. 임의 코드 실행. |
| Function constructor via prototype chain | `__proto__` | `({}).__proto__.constructor("alert(1)")()` | 위와 같은 경로, prototype 체인 명시적 사용 |
| Function self-reference | `callee` | `(function(){ return arguments.callee; })().toString()` | 함수가 자기 자신 참조 → 다른 안전한 함수의 source 추출/재바인딩 |
| Caller chain leak | `caller` | `function inner() { return inner.caller; }` | 호출 컨텍스트 leak |
| Function prototype hijack | `prototype` | `(function(){}).prototype.bind.call(File, ...)` | 임의 함수의 prototype을 통해 deny-list 함수 메서드 우회 |

**왜 deny-list만으론 부족했나** (acorn-walk 의미론):

acorn-walk의 `simple` walker는 `MemberExpression`을 만났을 때:
- `object`는 항상 visit (다음 visitor 호출됨)
- `property`는 **`computed === true`일 때만** visit. `obj.foo` 같은 dot-notation은 `foo` 부분이 별도 노드라도 Identifier visitor에 안 걸린다.

→ deny-list에 `"constructor"`를 넣어도 `(0).constructor` 같은 코드의 `constructor`는 visitor가 안 봄 → 통과.

**Fix 메커니즘**: `MemberExpression` visitor 자체에서 non-computed property를 직접 검사. property가 `Identifier`이고 `DANGEROUS_PROPS` set에 있으면 finding.

---

### Playbook: 새 우회 패턴 발견 시 추가 절차 (Claude Code 향후 참조용)

**Trigger**: 새 ExtendScript tool 작성 중 / 보안 감사 / `/cso` 실행 중에 "이 식별자나 프로퍼티 통하면 deny-list 우회될 것 같은데" 의심 들 때.

**TDD 절차** (CLAUDE.md Karpathy 원칙 4 — Goal-Driven Execution):

1. **먼저 adversarial 케이스를 `_validateAst.test.ts`에 추가** (구현 X)
   - 적절한 `describe` 블록: `D7 validator — indirection bypass attempts` (또는 새 카테고리)
   - 케이스명에 패턴 의도 명시 (`blocks <pattern> escape`)
   - 위험 코드 정확히 작성. 예: `var x = ___suspicious___; x("payload");`

2. **`npm test`로 fail 확인** — 우회가 실제로 작동하는지 (red)

3. **Fix 위치 결정**:
   - 위험 식별자가 **bare global** (예: `eval`, `File`)? → `DENY_LIST`에 추가. Identifier visitor가 잡음.
   - 위험 식별자가 **property name** (예: `.constructor`, `.callee`)? → `DANGEROUS_PROPS`에 추가. MemberExpression visitor가 잡음.
   - 위험 패턴이 **AST node type 자체** (예: `WithStatement`, `setTimeout("...")`)? → 별도 visitor 추가.
   - 위험 패턴이 **타입 조합** (예: BinaryExpression `+`로 만든 property name)? → 기존 visitor 안에서 패턴 매칭.

4. **`npm test`로 green 확인** — 새 케이스 잡고 기존 41+ 케이스 회귀 없음

5. **`mistakes.md`의 위 표에 행 추가** — 패턴, 위험 식별자, 코드 예시, 작동 원리

6. **CLAUDE.md `Validation Gates` #1 표현 점검** — 동적 표현 ("per-tool 골든셋 누적" 같은) 유지. 정적 미래 수치 박지 말 것 (Phase 5 30 tool 진행하면서 매번 갱신해야 하는 부담 → 표현 자체가 자동 누적이면 갱신 불필요).

**중요한 함정**:
- `acorn-walk` simple walker는 visitor 호출 패턴에 의미론적 차이 있음. node 안의 sub-node가 visit될지 직접 확인 (test로 빨강 → 초록 확인). 추측 금지.
- `Identifier` visitor 추가는 함정 — non-computed property name은 안 잡힘. **Property name 차단은 항상 `MemberExpression` 처리.**
- ES3 한계 (no `Proxy`, no `Reflect`)라 우회 패턴이 ES6+보다 적음. 단 `with`, `arguments.callee` 같은 옛 기능은 ES3에서도 작동하니 잊지 말 것.

**확장이 어렵다 싶으면**: 정적 분석에 한계 있다고 판단되는 패턴은 fix 시도 전에 사용자에게 알려라. "이 패턴은 정적 차단 어렵고 런타임 sandbox가 더 적절합니다" 같은 솔직한 보고. 추측으로 fragile fix 금지.

## 함정 #15 — production assembly point가 단위/통합 mock 외부에 있어 모든 test green이지만 production fail (Phase 4.4 fix-4)

**컨텍스트**: Phase 4.1 (D-J role-aware routing) 작업 후 Phase 4.4 dogfood 시 panel `/mcp`가 `ae-mcp · × failed` 표시. 사이드카 unit (~127) + integration (~14) + panel (~44) 모두 그린 상태에서 발현. 함정 #11/#13/#14의 "production wiring first encounter" family와는 **다른 메타 패턴** — dev/prod 분기 누락이 아니라, **production wiring 그 자체가 mock 안에서 검증되지 않음**.

**Aspect**: production assembly point (즉 main()의 객체 wiring 코드)가 단위 테스트 어디에도 import 안 되고, 통합 테스트도 mock execHandler를 직접 주입 → wiring 그 자체가 dormant 상태로 모든 test 통과.

**Symptom**:
- `/mcp` UI가 `× failed`로 표시 (사용자 dogfood 단계 (f) "현재 컴프 알려줘" 시도 시점에야 발현).
- panel 안의 claude (= 사용자 dogfood 환경 자체)가 `git/grep`으로 사이드카 코드 직접 분석 → `sidecar/src/index.ts:117-124`의 `stubExecHandler`가 throw하는 것 발견. **사용자 dogfood 환경 = 진단 도구**라는 메타 학습.
- ae-mcp connect 자체는 OK (claude CLI가 stdio child spawn + handshake까지는 성공) — 단 첫 actual tool call에서 `AENotImplementedError` throw → panel claude는 이를 "× failed" connection metadata로 표시.

**Root cause**:
```ts
// sidecar/src/index.ts:117 (Phase 4.1 commit 시점부터)
const stubExecHandler: ExecHandler = async (tool, _input, _ctx) => {
  throw new AEError("AENotImplementedError", `Tool '${tool}' is not wired yet`, ...);
};
// ...
bridge = new PanelBridge({
  ...,
  execHandler: stubExecHandler,   // ← Phase 4 wiring 누락
  onToolResponse: dispatcher.handleIncoming,
});
```

`plan.md` line 596 D-I + line 537 (Phase 3.6 toolDispatcher 설명) 모두 "MCP tool call → **dispatcher.exec** → panel WS exec → ExtendScript → result"를 명시했지만, Phase 4.1 sub-step의 D-J role-aware routing 작업 시 이 wiring 코드는 추가되지 않음.

**왜 모든 test가 green이었나** (메타 핵심):
- `integration-mcp.test.ts:43,60,105` — mock `execHandler: vi.fn(async () => ({ ok: true }))`를 PanelBridge에 직접 주입.
- `integration-dispatcher.test.ts:87,173` — mock execHandler 또는 dispatcher.exec 직접 호출, production assembly와 다른 wiring.
- `panelBridge.test.ts:90~,460,485,508` — 모두 mock execHandler.
- 단위 테스트 어디서도 `index.ts`의 `bridge = new PanelBridge({execHandler: stubExecHandler, ...})` 라인을 import하지 않음 (main()이 module-level immediate invocation이라 test에서 import하면 sidecar boot 시작됨 → 자연스레 격리됨).
→ **production assembly point가 모든 test scope 외부**. unit + integration 그린 = wiring correctness 보장 X.

**Fix (Phase 4.4 fix-4)**:

1. `sidecar/src/dispatcher/execHandler.ts` (신규) — adapter 분리:
   ```ts
   export function makeDispatcherExecHandler(dispatcher: ToolDispatcher): ExecHandler {
     return async (tool, input, _ctx) => {
       const result = await dispatcher.exec({ tool, input });
       if (result.ok) return result.data;
       throw new AEError(result.code, result.userMessage, result.developerHint, ...);
     };
   }
   ```
   `DispatcherResult ok=true → data return / ok=false → AEError throw` 변환. `panelBridge.toErrorMsg`가 `e instanceof AEError` 체크로 code/userMessage/developerHint triple 보존.

2. `sidecar/src/index.ts`:
   - `stubExecHandler` 삭제 (orphan import `AEError`도 같이).
   - `execHandler: stubExecHandler` → `execHandler: makeDispatcherExecHandler(dispatcher)`.
   - `void dispatcher` (Phase 3.7 tsc-happy 잔재) 삭제.

3. `sidecar/src/dispatcher/execHandler.test.ts` (신규) — helper 단위 테스트: ok / error / 임의 code 통과.

4. `sidecar/src/__integration__/integration-production-wiring.test.ts` (신규) — production assembly 그 자체 검증. real PanelBridge + real dispatcher + real makeDispatcherExecHandler + lazy back-reference + mock panel ws (?role=panel) + mock mcp ws (?role=mcp). mcp 측 exec → panel 측 exec 도착 → result 회신 → mcp 측 result 도달 round-trip + error path. **이 테스트가 #15 회귀 방지의 single source of truth**.

**예방 (미래 패턴)**:
1. **production assembly point는 항상 helper로 추출 + 단위 테스트**. main()에 inline wiring 코드를 박지 말 것 — 적어도 한 줄짜리 wiring도 별도 함수로 빼서 import 가능하게.
2. **assembly-point integration test 패턴**: Phase 5+ 새 wiring 추가 시 `sidecar/src/__integration__/integration-production-*.test.ts` 형태로 production-equivalent path 직접 검증. mock injection 회피, real wiring 그래프 그대로.
3. **panel 안의 claude를 진단 도구로 활용**: 사용자 dogfood 환경의 panel xterm 안 claude는 사이드카 코드를 git/grep으로 직접 분석할 수 있어, mock 없는 production root cause 짚기에 가장 효과적. CLAUDE.md§Phase exit gate 검증 시나리오에 "panel 안 claude가 코드 분석으로 wiring 누락 catch 가능한가" 질문 추가 가치 있음.
4. **boot 시점 sanity 가능성**: 사이드카 main()의 ready JSON에 `execHandler: "wired" | "stub"` flag 또는 사이드카 자체 self-test (boot 직후 더미 exec 한 번 통과 확인) — 옵션. Phase 5+ 30 tool 진행 시 wiring 누락 패턴이 다시 나타나면 검토 가치.

**메타 함정 family 비교** (#11 / #13 / #14 / #15):
- #11 / #13 / #14: **production ground truth (ES3 SpiderMonkey / node-pty PATH / dev vs prod build artifact / entry guard suffix)와 단위 mock의 차이**. 즉 *외부 의존성의 시뮬레이션 정확도* 함정. dogfood가 catch.
- #15: **wiring code 자체가 mock 외부에 위치**. 즉 *production assembly point의 dependency injection gap* 함정. dogfood가 catch — 단 발현 메커니즘은 다름 (외부 의존성 시뮬 vs 내부 wiring 누락).

두 family는 같은 dogfood 검증 패턴에 의존하지만 fix 방향이 다름:
- #11/#13/#14 가족 fix → 외부 의존성에 더 가까운 검증 layer 추가 (which 사전 lookup, file probe, dev/prod 분기 helper, suffix list 확장).
- #15 fix → production assembly point를 helper로 추출 + 그 helper의 단위 테스트 + assembly graph 그 자체의 integration test.

## Phase 4.4 dogfood case study (#13 / #14 Aspect A/B/C / #15 통합)

**의도**: 함정 #13~#15는 Phase 4.3 hotfix + 4.4 layered fix 4개로 분산되어 발견됐다. 함정별 본문은 각각 root cause + fix가 정확하지만, 같은 sub-step의 dogfood loop가 catch한 메타 패턴 4가지는 분산. Phase 5+ 30 tool 진입 시 같은 패턴 재발 가능성이 매우 높아 — 미래 reader가 이 case study를 한 곳에서 통합 파악할 수 있도록 박음. 함정 검색 entry point (mistakes.md)와 phase 회고 entry point (plan.md Phase 4 회고)에서 reachable.

### 1. Layered fix 4개 워크플로우 패턴

Phase 4.4 한 sub-step에서 4개의 다른 production wiring 함정이 **layered**로 발현. 각 fix가 다음 layer를 reachable하게 만들어, 단일 dogfood loop로는 모두 catch 불가능한 구조.

| 순서 | 함정 | layer | 발현 메커니즘 |
|---|---|---|---|
| 1 | #14 Aspect A (which) | OS-level (PTY spawn 메커니즘) | 사이드카 boot 자체 fail. 다음 layer 도달 X |
| 2 | #14 Aspect B (entry path) | build artifact (tsx vs dist) | 사이드카 boot OK + claude register 성공 → panel `/mcp` × failed (entry path invalid) |
| 3 | #14 Aspect C (entry guard) | runtime guard (.js vs .ts suffix) | claude entry 도달 OK → guard skip → MCP server 등록 X → 여전히 × failed |
| 4 | #15 (dispatcher wiring) | production assembly (main() 내부 wiring) | MCP server 등록 OK → 첫 actual tool call에서 stubExecHandler throw → × failed |

**메타 학습**: production wiring first encounter sub-step은 single fix가 아니라 **layered fix 가정**. 한 fix 후 "다 끝났다" 추측 금지. Phase 5+ 새 sub-step 진입 시 매 dogfood loop마다 새 layer가 reachable해질 수 있음을 의식.

### 2. Spike 버튼 (Phase 3 자산)의 진단 가치

Phase 3.7 dev spike 버튼은 panel UI에서 dispatcher.exec를 직접 호출하는 우회 path — MCP를 거치지 않음. Phase 4.4 dogfood에서 결정적 진단 도구로 작동:

- spike 버튼 클릭 → ae_get_active_comp 5ms 정상 동작 = **Phase 3 dispatcher + ExtendScript 멀쩡 / MCP path만 fail** 즉시 진단.
- "어디까지 정상 / 어디부터 fail" 좁히기에 결정적. spike 없었으면 dispatcher 자체 의심까지 검증 범위 확장 필요했을 것.
- **메타 학습**: Phase 5+ 새 tool 추가 시도 production path와 별도로 우회 path (spike 류) 유지 가치. 새 tool 동작 검증 도구 + production wiring fail 시 진단 isolating 도구 양면.

### 3. Panel xterm 안 claude의 self-diagnosis 능력

사용자 dogfood 환경의 panel xterm 안 claude (Opus 4.7) **자체가 진단 도구**. CLI는 메인 dev work를, dogfood claude는 root cause 짚기를 분담:

- #15 발견 메커니즘: 사용자 "현재 컴프 알려줘" → 자연어 응답 fail → claude가 자체 git/grep/file read로 사이드카 코드 분석 → `sidecar/src/index.ts:117-124`의 stubExecHandler throw 정확한 line 번호 + 의도된 흐름 vs 누락 파악 + plan.md D-I 명시 vs 코드 누락 분리까지 짚어옴.
- #14 Aspect B 발견도 유사: claude가 `claude mcp get ae-mcp` 실행 + entry path src/.js 확인 + Phase 4.2 jsdoc 인용까지.
- **메타 학습**: dogfood 환경 자체가 진단 인프라. 메인 dev는 CLI가 실행하지만, dogfood claude의 self-diagnosis는 production root cause 짚기에 가장 효과적 (mock 0 + git/code 직접 접근 + 자연어 질문에서 시작). Phase 5+ 진입 시 dogfood 시나리오 정의 시 "panel 안 claude가 코드 분석으로 wiring 누락 catch 가능한가" 질문을 검증 시나리오에 포함 가치.

### 4. Self-aware jsdoc 패턴 (4.2 사례)

Phase 4.2 시점의 mcpEntryAbs jsdoc은 **함정을 의식했으나 fix 안 한 trade-off**를 명시했다:

> "Entry path resolution: this file is `<sidecar>/dist/index.js` after build (or `<sidecar>/src/index.ts` under tsx dev). The MCP entry is a sibling `mcp/server.js` — for dev/tsx the file won't exist yet, **and that's fine: register still succeeds (claude doesn't validate the path until it tries to spawn the entry). The 4.4 user dogfood step is what verifies the path actually resolves to a runnable file.**"

**의식 → 명시 self-aware decision으로 미루기 → dogfood가 verify**. 정확히 4.4 dogfood가 이 함정을 catch (Aspect B 발현). 모든 함정을 phase 1에 fix할 수 없고, dogfood까지 미루는 게 합리적인 경우가 있음 — 그때 jsdoc에 "이 trade-off를 미래 N 시점에 검증" 명시가 미래 reader 진단 가속에 결정적.

**한계** (#14 Aspect C가 보여줌): self-aware decision pattern은 **의식한 함정만** 박을 수 있다. 같은 dev/prod boundary가 두 layer (호출자 args + 피호출자 guard)에서 따로 cut된 함정은 4.2 시점에 함께 의식 못 함 → 4.4 layered loop가 catch.

## 2026-05-07 D-J multi-role grace timer 회귀 (#16)

**문제**: Phase 5.1.2 dogfood — CEP panel close (X 버튼 또는 Window 메뉴 토글) 후 task manager에 사이드카 관련 process 4개 (사이드카 main `node.exe` + claude CLI + MCP server `node.exe` + `winpty-agent.exe`)가 모두 남음. cycle마다 4개씩 누적되는 좀비. **Phase 4 dogfood (h) "잔존 0" 통과 baseline 회귀로 보였으나 진단 결과 회귀가 아니라 Phase 4.0부터 잠재**.

**진단**:
- panel close 시 useTerminal cleanup → ws.close + launcher.stop이 발동되지만 React unmount async 특성상 `sys.shutdown` 메시지가 사이드카에 반드시 도달하지는 않음 (#9 함정의 원래 fix 동기). 그래서 사이드카 측 `panelBridge.ts:365` disconnect grace timer가 fallback shutdown trigger.
- pre-fix 조건: `if (!this.stopping && this.clients.size === 0 && grace > 0)`. 이 조건이 panel ws disconnect 후에도 `clients.size > 0`이라 발동 안 함.
- 이유: Phase 4.0 (`541c759`) D-J multi-role 도입 시 mcp role을 panel과 같은 `clients` Map에 등록. mcp client는 claude CLI의 stdio child라 lineage가 panel과 다름 (panel 죽어도 mcp는 살아있는 자체 process tree). 결과 — panel ws만 disconnect되고 mcp ws는 attached 상태 → `clients.size === 1` → grace 영원히 안 발동 → 사이드카 stay → MCP/PTY/claude 전부 stay.

**Root cause**: D-J가 mcp role을 도입할 때 `clients` Map을 공유하는 결정은 합리적 (multi-role 라우팅 통합 관리). 하지만 **disconnect grace 정책 자체는 "panel runtime이 사라졌는가"를 묻는 의도였음** — 정책-구현 어긋남. mcp의 lifecycle은 사이드카가 graceful shutdown할 때 PTY tree-kill로 자연 정리되므로 정책상 무시 대상. clients.size 조건이 mcp까지 합산하는 건 buggy.

**왜 Phase 4 dogfood (h)가 통과했는가** (메타 핵심):

`panelBridge.ts:688-699` heartbeat watchdog: 30s (`heartbeatTimeoutMs` default) 무수신 시 `ws.close(1001, "heartbeat timeout")`. mcp client는 dogfood (h) 시점에 사이드카 측 heartbeat broadcast(`sys.heartbeat`)에 echo 응답 wiring이 없었음 → 30s 후 강제 close → `clients.size === 0` 도달 → grace 5s → 사이드카 graceful shutdown → PTY tree-kill → 잔존 0.

즉 **dogfood (h) 통과는 35-50s 시간 변수에 의존한 우연**. 사용자가 task manager 확인까지 충분히 기다렸기 때문. 즉시 확인했다면 잔존 4 발견했을 것.

**Fix (Phase 5.1.2)**:

`sidecar/src/ws/panelBridge.ts` ws.on("close") 안의 grace gate를 panel-only 조건으로 변경:

```ts
const grace = this.opts.clientDisconnectGracePeriodMs ?? 5_000;
const panelStillPresent = this.findFirstByRole("panel") !== undefined;
if (!this.stopping && !panelStillPresent && grace > 0) {
  this.clientDisconnectTimer = setTimeout(() => {
    this.clientDisconnectTimer = undefined;
    if (this.stopping || this.findFirstByRole("panel") !== undefined) return;
    try { this.opts.onShutdownRequest?.("panel-disconnect"); }
    catch { /* never throw from timer */ }
  }, grace);
}
```

`findFirstByRole`는 D-J 도입 시 이미 존재하던 헬퍼. panel role 클라이언트가 1개도 없을 때만 grace timer 발동. mcp client는 grace gate에 영향 0 — 사이드카 shutdown 시 PTY tree-kill이 claude CLI를 정리하면 그 stdio child인 MCP server도 함께 정리.

**예방 (미래 패턴)**:

1. **새 role 추가 시 lifecycle 정책 role-aware 명시**: clients Map은 multi-role 공유 가능하나 disconnect/grace/promotion 정책 gate는 어느 role에 적용되는지 코드와 jsdoc 둘 다 명시. D-J 시점에 mcp role primary promotion (`primaryMcp` 별도 필드, `findFirstByRole`)은 역할별로 분리됐으나 grace gate만 통합 조건으로 남아있던 것이 본 함정.
2. **D8 collocation 30 tool 진입 시도 같은 패턴 의식**: 새 메시지 type / 새 client role / 새 lifecycle hook 추가할 때 기존 통합 조건이 실수로 새 차원을 합산하는지 사전 점검.
3. **dogfood scenario 정의에 시간 boundary 명시**: "panel close 후 잔존 0"이 아니라 "panel close 후 **즉시** (5-10초 이내) 잔존 0" 같이 측정 timing 명시. timing-ambiguous criterion은 시간 변수 우연 통과 risk.

**검증**:

- `sidecar/src/ws/panelBridge.test.ts` scenario 15 (mistakes #16 정방향): panel ws close + mcp ws alive → grace timer 발동 → `onShutdownRequest("panel-disconnect")` 호출 ✅. pre-fix는 발동 X.
- scenario 16 (역방향 회귀 가드): mcp ws close + panel ws alive → grace timer 발동 X. panel이 authoritative하므로 mcp 끊겨도 shutdown 발동 X ✅. 조건 부주의로 양방향 발동되는 실수 방지.
- 사용자 dogfood: panel 닫고 task manager 즉시 확인 + 2 cycle 이상 (열고/닫기 반복) + 매 cycle 후 잔존 0 확인. 시간 변수 의존 X 검증.

**메타 함정 family 비교** (#11 / #13 / #14 / #15 / #16):

- **#11 4-faces / #13 / #14 family**: 외부 의존성 시뮬레이션 정확도 (ES3 SpiderMonkey / node-pty PATH / dev vs prod build artifact / entry guard suffix). mock과 production ground truth의 차이.
- **#15**: production assembly point가 mock 외부 (DI gap). wiring code 자체가 test scope 밖.
- **#16 (신설 family)**: **검증 절차 자체가 측정 timing에 의존 → 우연 통과**. dogfood가 catch하는 게 아니라 dogfood 측정 protocol의 시간 변수가 함정을 가림. fix 자체는 단순하지만 발현 메커니즘이 다른 메타 layer.

세 family 모두 dogfood가 진단 도구지만 fix 방향과 catch 메커니즘이 다름:
- #11/#13/#14 fix → 외부 의존성에 더 가까운 검증 layer 추가.
- #15 fix → production assembly point helper 추출 + integration test.
- #16 fix → 검증 protocol에 timing boundary 명시 + 즉시 측정 강제. unit test로 시간 변수 isolate (vitest fake timer 또는 짧은 grace window).

**Phase 4 dogfood 통과 baseline의 신뢰도 재평가**:

dogfood (h) "잔존 0" 통과는 사실상 검증 안 된 것. Phase 4 회고 기준 "panel close 후 잔존 0 ✅"는 #16 fix 적용 + 즉시 측정 protocol 후에야 진짜 보장된다. Phase 5.1.2 commit이 baseline을 retroactively 강화 — Phase 4 회고는 그대로 두되 PROJECT_CONTEXT.md §H에 "5.1.2 fix 후 잔존 0 강화 baseline" 메모 추가 가치.

## 2026-05-08 ExtendScript SpiderMonkey this-binding 강제 (#17)

**문제**: Phase 5.1.4 dogfood — AE 패널에서 "프로젝트 컴프 목록 알려줘" 자연어 호출 시 `Function global.item() cannot work with this class` 에러. ae_list_comps tool round-trip 자체가 fail. impl.test.ts 4 case 모두 그린이었지만 production AE에서 첫 호출에 throw — dogfood 발견.

**진단**: `sidecar/src/tools/ae_list_comps/impl.ts`에서:

```ts
var itemFn = project.item as (index: number) => JsxItemLike;
for (var i = 1; i <= numItems; i++) {
  var item = itemFn(i);
  ...
}
```

Method를 local variable에 분리한 뒤 호출 — `itemFn(i)` 호출 시 `this`가 손실됨 (sloppy mode = global, strict mode = undefined). ExtendScript SpiderMonkey는 method receiver identity를 **엄격히 강제** — `app.project.item`은 ItemCollection의 instance method라 `this`가 ItemCollection이어야 하는데, detached call은 `this = global` → 엔진이 "global object cannot work with this class" throw.

**왜 unit test (4 case) 모두 통과했는가** (메타 핵심): vitest의 vanilla JS는 method receiver identity를 강제 안 함. `_mockApp.ts`의 `makeMockProject`가 `item: function(index) { return items[index-1]; }` 형식이고, 호출 시 `this` 검사 0. detached `itemFn(i)` 호출도 같은 array slot 반환 — **mock 환경에서는 정상 작동, production에서만 throw**.

panel xterm 안 ae-claude가 자체 진단 — `var itemFn = project.item` 분리 패턴이 ExtendScript SpiderMonkey this-binding 함정이라고 짚어옴. mock vs production 환경 시뮬 미흡 family (#11 4-faces / #14 family lineage, 다른 layer).

**Root cause**: ExtendScript SpiderMonkey의 method this-binding 강제는 vanilla JS 표준 (ECMAScript spec) 동작과 다른 host-specific 강화. `obj.method(i)` 직접 호출은 `this = obj`로 binding되지만, `var fn = obj.method; fn(i)`는 `this`를 잃음. 이 차이가 mock/production 분기점.

**Fix (Phase 5.1.4 fix)**:

1. `sidecar/src/tools/ae_list_comps/impl.ts` — `itemFn` 변수 분리 제거, `project.item!(i)` 직접 호출. `!` non-null assertion은 JsxProjectLike.item이 optional type이지만 production AE에서 항상 populated이라 안전. babel preset-typescript transform에서 strip되어 ES3 output에는 영향 0.

```ts
// before (broken in production AE):
var itemFn = project.item as (index: number) => JsxItemLike;
var item = itemFn(i);

// after (works in both production AE + vitest):
var item = project.item!(i);
```

2. `src/jsx/aeft/tools/_mockApp.ts` `makeMockProject` — mock의 `item` function에 receiver check 추가:

```ts
var project: JsxProjectLike;
project = {
  ...,
  item: function (this: unknown, index: number) {
    if (this !== project) {
      throw new Error("Mock this-binding violation: ...");
    }
    return items[index - 1];
  },
};
```

Detached call `var fn = project.item; fn(i)` 시 `this !== project` → mock throw. 30 tool 누적 시 같은 패턴 재발하면 unit test가 즉시 fail (production 도달 전 catch).

3. `sidecar/src/tools/ae_list_comps/impl.test.ts` — 5번째 case 추가 (this-binding regression guard).

**예방 (미래 패턴)**:

1. **Mock policy: ExtendScript host-specific 동작은 mock에서 강제**. 일반 vanilla JS 동작이 production과 갈라지는 모든 지점은 mock에서 production-strict 패턴 강제. 본 사례는 method receiver identity. 후보: typeName check (이미 적용), 1-based array indexing (vitest는 0-based 자연 — `items[index-1]` 변환), AE class instance check 우회 (typeName string compare — 이미 적용).
2. **Phase 5+ 30 tool 추가 시 method 호출 패턴 게이트**: `var fn = obj.method` detach 패턴 금지. mock receiver guard로 자동 차단 (이번 fix처럼).
3. **Production-direct method 호출 권장**: ExtendScript impl 작성 시 항상 `obj.method(args)` 형식. 변수 분리 + delayed call은 함정 risk.

**검증**:

- `impl.test.ts` 5 cases (4 기존 + 1 this-binding regression case) 모두 그린
- `_mockApp.ts` receiver guard가 future detach 시도 시 즉시 throw — 30 tool 추가 시 자동 가드
- 사용자 dogfood: "프로젝트 컴프 목록 알려줘" → ae_list_comps round-trip 정상 (production AE에서 검증)

**메타 family 비교** (#11 / #13 / #14 / #15 / #16 / #17):

- **#11 4-faces / #13 / #14 family / #17**: **외부 의존성 시뮬레이션 정확도** — mock과 production 환경 차이. ES3 SpiderMonkey 문법 (#11) / PtyLike interface 누락 (#13) / dev/prod 분기 (#14) / **method this-binding 강제 (#17)** 모두 같은 메타 family. mock 환경이 production을 정확히 시뮬 못 해서 mock-test 우연 통과 후 production에서 발현.
- **#15**: production assembly point가 mock 외부 (DI gap).
- **#16**: 검증 절차 자체가 측정 timing에 의존.

#17은 mock-vs-production 시뮬 정확도 family에 추가되는 새 layer. fix 방향 일관 — mock에 production-strict 패턴 강제. 이번 fix는 single-tool fix가 아니라 **30 tool 공통 가드** (mock 정책 변경) — Phase 5+ 추가 tool이 자동 보호.

**Phase 5.1.4 sub-step 통합 학습**:

5.1.4 single sub-step에서 두 함정 발현 (Gate §12 em-dash 회귀 + #17 this-binding). 둘 다 catch:
- Gate §12 em-dash: build artifact grep으로 즉시 catch (Gate 자동 점검 작동)
- #17 this-binding: 사용자 AE dogfood에서만 발현 (mock-test 모두 그린이었음). dogfood가 single source of truth.

**메타 학습 — Gate 자동화 vs dogfood 의존**: build-time grep으로 catch 가능한 함정 (encoding, namespace import, secret leak 등)은 gate로 자동화 가능. mock vs production 환경 차이 함정 (this-binding, ES3 syntax, AE class globals 등)은 dogfood가 fundamental — gate 추가는 가능하지만 mock 측에 production-strict 패턴 강제하는 게 더 효과적 (dogfood 도달 전 unit test가 catch).

## 2026-05-08 schema description vs production AE 동작 차이 (#18)

**문제**: Phase 5.1.7 dogfood — AE 패널에서 `ae_get_expression` 호출 시 claude가 `propertyMatchName: "ADBE Position"` (internal id)으로 5번 시도 → 모두 AENotFoundError. 6번째 시도에 `"Position"` (display name)으로 변경 → 성공. claude의 자율 retry로 회복했지만 first attempt 부정확 + latency.

**진단**: 5.1.7 schema description에 박은 내용:

```
"propertyMatchName is locale-stable internal id (e.g., 'ADBE Position', ...)"
```

이는 types-for-adobe AE 22.0의 `PropertyBase.matchName: string` (line 2201) 정의를 보고 추론한 spec. 단 ExtendScript runtime 동작은 **다름**:

- `layer.property("ADBE Position")` (matchName 호출) → fail (`null` 반환 또는 throw)
- `layer.property("Position")` (display name 호출) → 성공

이유: AE의 `Layer.property(name)`은 **immediate child의 display name lookup**. matchName은 `PropertyBase.matchName` field로 read-only access만 가능, 직접 lookup key 아님. matchName으로 navigate하려면 PropertyGroup tree walk-down + 각 단계 명시 필요. 단일 string lookup에선 display name이 표준 path.

types-for-adobe TS type만 보면 알 수 없는 runtime semantic — 사용자 dogfood가 catch.

**왜 unit test는 모두 통과했는가** (메타 핵심): 5.1.7 mock의 `MockLayerOpts.properties`가 단순 `Record<string, JsxPropertyLike>` map이라 key 의미가 schema와 분리됨. test fixture에서 key를 `"ADBE Position"`으로 박고 input도 `"ADBE Position"`으로 박음 → mock이 단순 string match로 lookup → 통과. **mock이 production AE의 layer.property(name) display-name lookup 의미를 시뮬 안 함** → mistakes #11 family 직접 재현.

**Root cause**: schema description이 production runtime 동작과 부정확 + mock fixture가 production 의미 시뮬 안 함 (key 의미 모호). 사용자가 schema description 보고 박은 input field name (`propertyMatchName`)이 실제 runtime semantic과 mismatch.

**Fix (Phase 5.1.7 fix)**:

1. `schema.ts` 인자명 `propertyMatchName` → `propertyName`. description 정정:

   ```
   "Property display name in the current locale (e.g., 'Position',
   'Scale', 'Rotation', 'Anchor Point', 'Opacity'). NOT the matchName --
   ExtendScript's layer.property() does display-name lookup, not
   matchName lookup, when called directly on a Layer."
   ```

2. `handler.ts` / `impl.ts` — input field 이름 propagate.

3. `_mockApp.ts` `MockLayerOpts.properties` jsdoc 정정 — 명시적으로 "KEYED BY DISPLAY NAME". `JsxPropertyLike.matchName` field는 entry body에 별도 유지 (locale-stable internal id 보존).

4. `impl.test.ts` — mock fixture key를 display name으로 변경 (`{ "Position": prop }`) + 회귀 case 추가 ("ADBE Position" matchName-shaped input → AENotFoundError, "Position" display-name input → 성공). future impl 변경이 matchName fallback 잘못 추가하면 즉시 fail.

**예방 (미래 패턴)**:

1. **schema description은 production AE runtime 동작 검증 후 박기**. types-for-adobe TS type 정의만 보고 추론하지 말 것 — AE ExtendScript에는 TS type에 직접 표현 안 되는 runtime semantic 존재 (display name vs matchName lookup, locale 의존, 1-based vs 0-based, instance method receiver 강제 등). dogfood로 first-attempt 정확도 검증이 description 품질 측정 지표.
2. **30 tool 진화 시 mock fixture가 production semantic 직접 시뮬 강제**. key 의미를 jsdoc에 명시 ("KEYED BY DISPLAY NAME" 같이). production-strict mock이 mistakes #11/#17/#18 family 자동 차단.
3. **첫 dogfood에서 retry 1+ 발생 시 schema description 회의 필요**. claude는 자율 retry로 회복 가능하지만 retry 자체가 description 부정확 신호. 5.1.x 30 tool 누적 시 dogfood retry rate를 description 품질 KPI로.

**검증**:

- `impl.test.ts` 8 cases (기존 7 + 회귀 case 1: "ADBE Position" matchName-shaped input → AENotFoundError, "Position" display-name → 성공)
- `_mockApp.ts.properties` jsdoc 정정으로 30 tool 추가 시 future authors가 display-name keyed 의도 명확
- 사용자 dogfood: "<레이어> Position 익스프레션" → ae_get_expression first-attempt 정확 호출 (retry 0 — production AE에서 검증)

**메타 family 비교** (#11 / #13 / #14 / #15 / #16 / #17 / #18):

- **#11 4-faces / #13 / #14 family / #17**: mock과 production runtime 환경 차이 (ES3 SpiderMonkey 문법 / PtyLike 누락 / dev/prod 분기 / method this-binding 강제). **외부 의존성 시뮬레이션 정확도** family.
- **#18 (신설 family)**: **schema description vs production runtime semantic** 차이. types-for-adobe TS type이 production AE runtime 동작과 어긋날 때, schema description이 type만 보고 박히면 claude tool selection이 first attempt fail. mock fixture가 production semantic 시뮬 안 하면 unit test가 dust 통과.

#18은 #11/#17 lineage이지만 layer가 다름 — **spec / description 정확도 자체가 production runtime 검증 필요**. fix 방향:
- schema description을 dogfood로 검증 (claude first-attempt 정확도)
- mock fixture가 production semantic 직접 시뮬 (key 의미 jsdoc 명시)

**Phase 5.1.7 sub-step 통합 학습**:

5.1.7 → 5.1.7 fix sub-step 분할이 #18 family의 자연스러운 catch 메커니즘:
- 5.1.7 commit: types-for-adobe + AE doc reference로 spec 박음 (production 미검증)
- 사용자 dogfood: claude first-attempt fail × 5 → retry로 회복 → 사용자 발견
- 5.1.7 fix: schema description 정정 + mock 정정 + 회귀 case

**메타 학습 — schema description 검증 패턴**: 30 tool 진화 시 매 tool dogfood loop에 "claude first-attempt 정확도" 명시. retry 1+ 발생 시 schema description sub-step (5.x.y fix) 분할 가능. 반복 패턴이면 schema 검증 자동화 후보 (e.g., dogfood-driven description regeneration).

## 2026-05-08 description duplication / single source of truth 위반 (#19)

**문제**: Phase 5.1.7 fix (`1ad3feb`)에서 `propertyMatchName → propertyName` 인자명 변경 + description 정정 박았는데, 사용자 dogfood 재검증 시 claude가 여전히 "propertyMatchName" 인자명으로 호출 시도. ae-claude (panel xterm 안 claude) 자체 진단:

> "fix-1이 zod schema description (`schema.ts`)과 handler.ts description은 정정했지만, **production source는 `sidecar/src/mcp/server.ts:127-134` inline description**. claude는 server.ts MCP registerTool description만 본다. zod schema description은 production 노출 0 = dead code."

**진단**: ae_get_expression의 description이 **세 곳**에 박혀있었음:
1. `sidecar/src/tools/ae_get_expression/schema.ts` zod `.describe()` (또는 jsdoc — 5.1.7에선 jsdoc만)
2. `sidecar/src/tools/ae_get_expression/handler.ts` `defineAETool({description: ...})` JSDoc + description string
3. `sidecar/src/mcp/server.ts:127-134` `server.registerTool("ae_get_expression", { description: ... })`

claude MCP 호출 시 보는 것은 (3) only. (1), (2)는 dev 시점 annotation. fix-1이 (1)+(2)만 정정 → claude 입장에선 **description 변경 0**.

**Root cause**: tool description의 single source of truth 위반. 같은 정보가 여러 source에 박혀있고 production 노출 source가 명시 안 됨. 5.1.3 architecture refactor에서 mcp/server.ts inline registerTool 패턴 박았을 때 handler.ts와 description 동기화 정책 정의 안 함 — 30 tool 누적 시 매 tool마다 두 곳 동기화 의존.

**왜 fix-1이 통과했는가** (메타 핵심):
- fix-1 검증: unit test 174/174 그린 + alias 합본 grep `propertyMatchName: 0` (handler/impl/schema에서만 제거 확인). 단 **dist/mcp/server.js scope 미검증** — 거기에 propertyMatchName 잔존.
- 사용자 dogfood: panel reload 후 claude가 새 description으로 re-fetch — 단 server.ts 안 옛 description 그대로라 claude는 old spec 보고 호출.

#15 family lineage (production assembly point가 mock 외부) — 이번 사례는 description의 production source가 fix-1 scope 외부. unit test와 alias grep이 잡지 못함.

**Fix (Phase 5.1.7 fix-2)**:

1. `sidecar/src/mcp/server.ts:122-141` ae_get_expression registerTool block의 description 정정. 사용자 spec sentence:

   ```
   "Property name as shown in After Effects panel timeline (display name in
   current locale). Examples: 'Position', 'Scale', 'Rotation', 'Anchor Point',
   'Opacity'. Do NOT use internal matchNames like 'ADBE Position' --
   ExtendScript's layer.property() lookup uses display name only."
   ```

   negative example ("Do NOT use 'ADBE Position'")이 명시적으로 박힌 description. claude에 강한 지시.

2. `sidecar/src/tools/ae_get_expression/handler.ts:7` JSDoc cleanup — `propertyMatchName` 잔존 → `propertyName` 정정.

3. dist grep 검증 (좁혀서):
   - `dist/mcp/server.js`에서 `propertyMatchName` 0 매치 ✅
   - `"ADBE Position"` 1 매치 (새 description의 negative example, 의도) — 옛 positive 예시 잔존 X

**예방 (미래 패턴)**:

1. **description production source는 `mcp/server.ts` registerTool block — single source of truth**. handler.ts / schema.ts의 description은 dev annotation only로 인지. 30 tool 진화 시 description 변경은 server.ts에서.
2. **tool description 변경 시 dist grep 검증 scope 명시**: production 노출 source (server.ts)의 dist 산출물 (dist/mcp/server.js) 직접 grep. handler/schema/impl scope만 grep하면 production 미반영 가능.
3. **root cause fix 후보 (5.2 진입 전 별도 검토)**: description duplication 자체 제거. 옵션:
   - (a) zod schema의 `.describe()`를 server.ts가 import해서 통합 (zod 표준 패턴)
   - (b) handler.ts의 ToolDef.description을 server.ts가 tools registry로부터 lookup
   - (c) 두 곳 description을 const string으로 추출, server.ts/handler.ts 양쪽 import

   30 tool 일관성 + 5.x.y fix 같은 함정 자동 차단.

**검증**:

- `dist/mcp/server.js` ae_get_expression block: `propertyMatchName` 0 매치 / 옛 `ADBE Position` positive example 0 매치 / 새 negative example 1 매치 (의도)
- 사용자 dogfood: panel reload + 단일 호출 1회 first-attempt 정확 (claude가 "Position" display name으로 직접 호출)

**메타 family 비교** (#11 / #13 / #14 / #15 / #16 / #17 / #18 / #19):

- **#15** (production assembly point가 mock 외부): wiring code 자체가 test scope 밖. fix-4가 helper 추출 + integration test로 해결.
- **#19** (description production source가 fix scope 밖): description duplication + production 노출 source 명시 안 됨. **#15 family lineage** — 같은 메타 ("fix scope가 production 노출 surface와 일치 안 함"). 다른 layer (wiring vs description).

**Phase 5.1.7 fix → fix-2 통합 학습**:

5.1.7 sub-step에서 두 함정 발견:
- #18 (5.1.7 fix): types-for-adobe TS type만 보고 schema spec 박음 → production runtime 차이
- #19 (5.1.7 fix-2): fix-1 scope가 description duplication 인지 못 함 → production source 미반영

**메타 학습 — fix scope 검증 명시**: 함정 fix 시 production 노출 surface (artifact/registered output/runtime config 등) 직접 검증. dev annotation source만 정정 + unit test 그린 = production 미반영 가능. 30 tool 진화 시 fix sub-step마다 dist/binding/registered output grep로 production scope 좁혀서 검증 명시.

**메타 학습**: 미래 reader는 두 패턴 모두 수입 가능 — (a) "함정 의식했으나 다음 phase로 미루기 + jsdoc에 명시" + (b) "한 layer fix 후 같은 메타 family의 다른 layer 함정 재현해야 발현하는 layered dogfood 가정". 둘 합치면: jsdoc self-aware는 가치 있되, 한 번의 dogfood가 모든 함정 catch한다고 가정하지 말 것. 매 dogfood loop가 새 layer 발견 기회.

---

## 2026-05-08 xterm.js keybinding selection 모델 dual-source 함정 (#20)

**현상 (Phase 5.1.9 fix-1)**: panel xterm에서 마우스 드래그로 텍스트 선택 후 Ctrl+C 누르면 OS clipboard에 복사 안 되고 입력 라인 clear (SIGINT 통과). 사용자 dogfood (commit `3ae033b` 후 panel reload) 발견. Ctrl+V paste는 정상.

**root cause**: xterm.js 6.x의 `terminal.getSelection()` API는 xterm 자체 selectionService가 capture한 selection만 반환. canvas/webgl renderer는 캔버스 mousedown/move/up 이벤트로 selection 추적하나, CEF 환경에서는 동일 mouse drag가 wrapper DOM element의 native browser selection으로 engage될 수 있음 — 이 경우 `terminal.getSelection() === ""` 이지만 `window.getSelection().toString()`은 텍스트 보유. 5.1.9 keybinding이 xterm side만 check → false branch (no selection) → return true → SIGINT pass-through.

**fix (Phase 5.1.9 fix-1)**:

`src/js/main/sidecar/useTerminal.ts:172-218` Ctrl+C 분기에 native selection fallback 추가:

```ts
const xtermSel = terminal.getSelection();
let nativeSel = "";
if (typeof window !== "undefined" && typeof window.getSelection === "function") {
  const s = window.getSelection();
  nativeSel = s ? s.toString() : "";
}
const sel = xtermSel || nativeSel;
if (sel.length > 0) {
  void navigator.clipboard.writeText(sel).catch(() => {});
  if (xtermSel) terminal.clearSelection();
  if (nativeSel && typeof window !== "undefined" && typeof window.getSelection === "function") {
    const s = window.getSelection();
    if (s) s.removeAllRanges();
  }
  return false;
}
return true;
```

clearSelection은 xtermSel side에만 / removeAllRanges는 nativeSel side에만 — 각 source만 정리. writeText는 발화한 sel 사용.

**예방 (미래 패턴)**:

1. **xterm 또는 캔버스 기반 UI 위 키바인딩 작성 시 두 selection 모델 모두 check**: API 가정 (xterm.getSelection이 모든 환경에서 모든 selection 포착) 금지. canvas-based widget의 native browser selection은 host runtime (CEF/Electron/일반 brower 등) 따라 wrapper element에서 engage 가능.
2. **dogfood-driven validation 필수**: keybinding 같은 UX 기능은 unit test (jsdom)에서 selection 동작 모사 어려움 — production 환경 (CEP panel) dogfood로 분기 정확성 확인.
3. **mock receiver로 production 환경 모사 한계 인지**: mistakes #11/#17/#18/#19 family와 같은 메타 — test mock의 동작이 production runtime의 동작을 100% 미러하지 않음. UX 작업 시 dogfood loop를 unit test와 별도로 명시.

**검증**:

- `panel test 41 → 42` (+#18 native selection fallback case)
- `main bundle dist grep`: `window.getSelection`=4 / `removeAllRanges`=2 / `attachCustomKeyEventHandler`=4 매치
- 사용자 dogfood 재검증: Ctrl+C copy (xterm + native 두 source 모두) → 다른 앱 paste 확인

**family lineage**:

- **#11 (4-faces)** — production 환경 가정 vs 실제 runtime 동작 차이 메타 family. fix-1은 환경 가정 fail의 5번째 face: "API 단일 source 가정 vs 실제 dual model 환경".
- **#17 (this binding)** — mock 환경에서 production 동작 미러 미흡. 다른 layer (xterm 캔버스 vs CEF DOM selection 모델)지만 같은 "환경 가정 함정" 메타.
- **#18 (schema description vs runtime)** — TS type만 보고 spec 박음 → production runtime 차이. 같은 "API 가정 vs 실제 동작" 메타.

**메타 학습** — UX 기능 (keybinding/clipboard/event handler) dogfood는 sub-step별 명시: unit test 그린만으로 phase exit 금지. UX 영역은 production 환경 dogfood loop를 phase 검증 절차에 명시.

---

## 2026-05-09 #20 face-2 — xterm.css `.xterm{user-select:none}` library 기본 룰 (Phase 5.1.9 fix-2)

**현상**: fix-1 (`aff9f85`) 후 dogfood 재검증 — Ctrl+V paste / SIGINT 보존 ✅이지만 Ctrl+C copy 여전히 fail. 사용자 panel 안 mouse drag 후 Ctrl+C → clipboard 미반영 + 입력 라인 clear (SIGINT 통과). 분기 로직상 `xtermSel === "" && nativeSel === ""` → return true → SIGINT path 실행.

**root cause** (Step 1 grep으로 발견):
- `node_modules/@xterm/xterm/css/xterm.css:38-44`의 라이브러리 기본 룰:

  ```css
  .xterm {
      cursor: text;
      position: relative;
      user-select: none;
      -ms-user-select: none;
      -webkit-user-select: none;
  }
  ```

- xterm.js 6.x는 canvas/webgl 렌더러 사용 (DOM text node 0). 기본 selection은 canvas mouse 이벤트 + selectionService 내부 상태 (`terminal.getSelection()`로 노출). 라이브러리는 native browser selection이 canvas selection 시각화와 충돌하지 않도록 `user-select: none`으로 차단.
- CEP/CEF 환경에서 canvas selection 경로가 fragile (`terminal.getSelection()` 빈 문자열 반환 — 캔버스 mouseevent 누락 추정). fix-1 native fallback도 `.xterm`이 user-select:none 박혀있어 미달.
- 두 selection model 모두 차단된 dead state.

**fix (Phase 5.1.9 fix-2)**:

`src/js/index.scss` 끝에 override 추가:

```scss
.xterm {
  user-select: text !important;
  -webkit-user-select: text !important;
  -ms-user-select: text !important;
}
```

`!important` 필수. vite bundle 순서: `index.scss` → `xterm.css` (factories.ts:20 import). 미니파이된 CSS bundle (`dist/cep/assets/main-*.css`) byte 위치 확인:
- 우리 rule @1324
- xterm.css `.xterm{user-select:none}` @2972 — 후순위 동일 specificity → !important 없으면 우리 rule 패배

**예방**:
1. **library default CSS는 `node_modules/<pkg>/**/*.css`까지 grep scope 확장**: panel src 영역만 grep하면 library shipped 룰 누락. xterm/jsx-runtime/react 등 import된 CSS는 vite bundle에 합쳐져 production에 도달.
2. **CSS load order는 import order 따라감 (vite/rollup 기본)**: 동일 specificity 룰은 후순위 import가 승. library CSS override 시 순서 가정 하지 말고 `!important` 또는 더 높은 specificity selector 사용.
3. **dist CSS bundle byte-position grep**: production CSS의 룰 충돌 검증은 `dist/cep/assets/main-*.css`에서 직접 grep — 우리 rule + library rule 위치 둘 다 출력해서 후순위 확인.

**검증** (build 산출물 grep):

- `dist/cep/assets/main-*.css`에서 `.xterm{user-select:text!important}` 1 매치 확인
- `!important` 3개 (text + webkit + ms) 매치
- xterm.css `.xterm{user-select:none}`은 그대로 존재하지만 우리 `!important` rule이 cascade 승 (CSS spec)

**face 통합**:

#20 자체는 "xterm keybinding selection 모델 dual-source 가정 함정". fix-1 (face-1)은 코드 layer (handler.ts에 native fallback 추가). fix-2 (face-2)는 CSS layer (xterm.js library 기본 user-select:none 차단). 둘은 같은 root question("native selection 어떻게 활성화")의 다른 layer. fix-1은 code-side fallback / fix-2는 CSS-side enabling. 통합 필요 — fix-2 없이 fix-1 단독으로는 작동 X.

**메타 family** (#11 / #15 / #19와 같은 "fix scope 한 layer만 보면 production 미달" 메타):
- fix-1: code layer만 fix → user-select:none CSS는 그대로 → 둘 다 차단 → fix-1 fallback도 못 발화
- fix-2: CSS layer 추가 fix → native selection 활성화 → fix-1 fallback 발화 가능

**메타 학습 — multi-layer fix dogfood loop**: UX 기능은 code + CSS + 환경 권한 등 multi-layer로 wiring됨. 한 layer만 fix하고 dogfood 그린이 무조건 정답 가정 X. 사용자 dogfood 통해 layer마다 발견 + fix sub-step 누적. mistakes entry 안에 face-N 누적해서 진화 기록.

## 2026-07-22 #16 connect 방향 재발 — grace timer 취소가 role-blind (#21)

**문제**: 심층 코드 리뷰 (외부 감사)에서 발견. `panelBridge.ts handleConnection`이 **role 파싱 전에** 무조건 `clientDisconnectTimer`를 취소. #16 fix는 close 방향(타이머 arm)만 panel-only 게이트를 걸었고, connect 방향(타이머 cancel)은 role-blind로 남아있었음.

**발현 시나리오**: panel close → 5s grace timer 진행 중 → mcp client 신규/재접속 (claude CLI 부팅 직후 MCP stdio child가 접속하는 1-2s 구간에 panel을 닫거나, claude가 MCP server를 재시작해 reverse-connect하는 경우) → 타이머 취소 → 타이머 re-arm은 **close 이벤트에서만** 일어나므로 다시는 안 걸림 → 사이드카 + PTY(claude) + MCP child 좀비 (AE watchdog이 잡을 때까지).

**Root cause**: #16과 동일한 정책-구현 어긋남의 **반대 방향**. "grace 정책은 panel runtime 존재 여부만 묻는다"는 정책이 close 방향에만 적용되고 connect 방향은 누락. #16 fix 시 같은 타이머를 만지는 **모든 지점** (arm + cancel)을 열거하지 않은 것이 원인.

**Fix**: `handleConnection`에서 role 파싱을 타이머 취소 **앞으로** 이동 + `role === "panel"`일 때만 취소.

**예방**:
1. **상태 전이 fix 시 그 상태를 만지는 모든 지점 열거**: 타이머/플래그/카운터에 조건 게이트를 넣을 때 set/clear/reset 전 지점을 grep해서 같은 게이트 적용 여부 점검. 한 방향만 고치면 #16→#21처럼 같은 함정이 반대 방향에서 재발.
2. **회귀 테스트는 양방향**: scenario 15/16 (close 방향 정/역) 페어에 connect 방향 페어 (scenario 17/17b) 추가 — mcp connect during grace → 타이머 유지 + panel reconnect during grace → 타이머 취소 (기존 scenario 13 동작 보존).

**검증**: `panelBridge.test.ts` scenario 17 (mcp connect mid-grace → shutdown 발동) + 17b (panel reconnect mid-grace → 발동 X). pre-fix에서 17은 fail (타이머 취소로 shutdown 미발동), post-fix 26 tests 그린.

**메타 family**: #16 direct lineage — "통합 조건이 새 차원(role)을 합산"의 arm 방향이 #16, cancel 방향이 #21. 정책 게이트는 상태 lifecycle 전체 (arm/cancel/re-arm)에 일관 적용해야 완결.

## 2026-07-22 AST validator allow-list 미강제 → deny-list 전용 (#22)

**문제**: 심층 리뷰에서 발견. `_validateAst.ts`가 헤더 주석에 "default-deny + allow-list"를 표방하지만, `ALLOWED_GLOBALS` Set이 **정의만 되고 참조 0회** (grep 확인). Identifier 비지터가 `DENY_LIST.has(name)`일 때만 finding을 추가 → deny-list에 없는 임의 전역이 전부 통과. 설계 의도(기본 거부)와 실제 동작(기본 허용)이 정반대.

**우회 구멍** (모두 pre-fix 통과):
- `this.File("x")` / `this.system.callSystem(...)` — `this`는 DENY_LIST에 없고 `ThisExpression`은 Identifier 노드가 아님. 비계산 dot 접근이라 computed 규칙에도 안 걸림. 최상위 `this` = 전역 객체 → 전체 deny 표면 도달.
- `$.evalFile("/evil.jsx")` / `$.write(...)` — `$` (ExtendScript 디버그 전역)가 ALLOWED_GLOBALS에 있고 deny에 없어 통과. `$.evalFile`은 임의 파일 eval.
- `foobarBaz.doEvil()` — deny에 없는 임의 전역 전부 통과.

**영향 범위**: 현재 `ae_run_extendscript`가 레지스트리에 없어 즉시 도달 불가(잠재). 단 이 validator가 D3/D7의 **유일한 보안 게이트**이므로 5.8 escape hatch 도입 시 그대로 뚫림. 5.8 진입 전 필수 수정.

**Fix**:
1. **allow-list 강제** (scope-aware): pass 1에서 지역 선언 이름(var/function/param/catch) 수집 → pass 2 `ancestor` walk에서 참조 위치 Identifier가 지역 선언도 ALLOWED_GLOBALS도 아니면 거부. 선언/프로퍼티/레이블 위치는 `isNonReferencePosition`으로 제외. DENY_LIST는 절대 우선(지역 shadow 무시).
2. **`this` 차단**: `ThisExpression` 비지터 추가.
3. **`$` 제거**: ALLOWED_GLOBALS에서 삭제 ($.evalFile/$.global/$.write 표면).
4. `acorn-walk`의 `simple` → 선언 수집만 simple, 참조 검사는 `ancestor` (parent 컨텍스트로 참조 vs 선언 구분).
5. 죽은 코드 제거: 빈 `BinaryExpression` 비지터 + `hasStringInvolved` 헬퍼 (주석 스스로 "computed 규칙이 잡는다"고 인정).

**scope 근사의 안전성**: 지역 선언을 단일 flat scope로 over-approximate — out-of-scope 지역 참조를 허용할 수 있으나 이는 런타임 ReferenceError일 뿐 **capability escape 아님** (안전한 방향의 근사). deny-list globals와 unknown globals는 절대 통과 못 함.

**예방**:
1. **"정의된 allow-list는 반드시 소비되는지" 게이트**: 보안 목록(allow/deny)을 선언하면 참조 지점을 grep로 확인. 정의만 하고 미참조 = 게이트 무력화.
2. **allow-list validator는 scope-aware 필수**: 단순 deny-list는 열거된 것만 막지만, allow-list는 "선언 vs 참조" 위치 구분(ancestor/parent) 없이는 false positive(프로퍼티명/파라미터를 unknown global로 오탐) 폭발. `simple` walk로는 부족.
3. **골든셋에 allow-list 케이스**: deny 우회(this/$/unknown global) + 정상 통과(app/Math/지역변수) 양쪽 누적. 5.8 진입 시 확장.

**검증**: `_validateAst.test.ts` 42 → 50 cases (+8: this.File / this.system / this.eval / $.evalFile / $.write / unknown global / with(this)). positive 케이스(app.project / comp.layer / KeyframeInterpolationType / ae_create_comp 패턴) 전부 그린 유지. 사이드카 225 tests green + tsc build clean.

**메타 family**: "선언했으나 배선 안 된 방어" — #19(description single source가 dead code만 정정)와 유사하게, 코드가 있다고 방어가 작동하는 게 아님. allow-list Set 존재 ≠ allow-list 강제.
