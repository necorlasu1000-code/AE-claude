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

## Phase 2 후속 / PtyHost.kill graceful shutdown ConPTY 호환성 검증

**관찰**: Phase 2 #2 smoke test에서 `await pty.kill()` 호출이 hang → vitest 35s testTimeout 발동. 매칭(`hello` 2회)은 짧은 시간 내 성공 추정.

**가설**: ConPTY는 Windows process tree에 SIGTERM POSIX signal을 전달하지 못함 (Windows는 SIGTERM 개념이 다름). node-pty의 `pty.kill("SIGTERM")`은 cmd.exe에 무시됨 → 5s 후 SIGKILL fallback이 발동해야 하나 ConPTY 통신이 막혀 그것도 hang.

**임시 fix (테스트만)**: `pty.kill()`을 fire-and-forget 처리. graceful shutdown 의미는 production에서만 의미 있음. 테스트는 vitest 종료 시 OS가 child process 정리.

**Phase 2 후속에서 확인**:
1. PtyHost.kill을 ConPTY-aware하게 수정 — `pty.kill()` (signal 인자 없이) 또는 직접 `process.kill(pid, "SIGKILL")`
2. node-pty 1.x ConPTY 모드의 정확한 kill 시맨틱 문서 검토
3. Phase 2 #5 통합 테스트에서 graceful shutdown 검증 케이스 별도 작성

**예방**: native module의 OS-specific 동작 (특히 process signal)을 production으로 보내기 전 OS 두 곳 (Win + Mac)에서 검증. Phase 7 distribution matrix(D9 = GitHub Actions Win/Mac)에서 자동.

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

6. **CLAUDE.md `Validation Gates` #1의 카운트 업데이트** — "30+ adversarial" → 실제 개수

**중요한 함정**:
- `acorn-walk` simple walker는 visitor 호출 패턴에 의미론적 차이 있음. node 안의 sub-node가 visit될지 직접 확인 (test로 빨강 → 초록 확인). 추측 금지.
- `Identifier` visitor 추가는 함정 — non-computed property name은 안 잡힘. **Property name 차단은 항상 `MemberExpression` 처리.**
- ES3 한계 (no `Proxy`, no `Reflect`)라 우회 패턴이 ES6+보다 적음. 단 `with`, `arguments.callee` 같은 옛 기능은 ES3에서도 작동하니 잊지 말 것.

**확장이 어렵다 싶으면**: 정적 분석에 한계 있다고 판단되는 패턴은 fix 시도 전에 사용자에게 알려라. "이 패턴은 정적 차단 어렵고 런타임 sandbox가 더 적절합니다" 같은 솔직한 보고. 추측으로 fragile fix 금지.
