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

## ✅ Phase 2 follow-up (#10) — `npm test` 통과만으로 phase 닫음 → production tsc 타입 에러 늦게 발견

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

## ✅ Phase 2.8.4 — panel close 시 사이드카 좀비 (graceful shutdown 메커니즘 부재)

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

6. **CLAUDE.md `Validation Gates` #1의 카운트 업데이트** — "30+ adversarial" → 실제 개수

**중요한 함정**:
- `acorn-walk` simple walker는 visitor 호출 패턴에 의미론적 차이 있음. node 안의 sub-node가 visit될지 직접 확인 (test로 빨강 → 초록 확인). 추측 금지.
- `Identifier` visitor 추가는 함정 — non-computed property name은 안 잡힘. **Property name 차단은 항상 `MemberExpression` 처리.**
- ES3 한계 (no `Proxy`, no `Reflect`)라 우회 패턴이 ES6+보다 적음. 단 `with`, `arguments.callee` 같은 옛 기능은 ES3에서도 작동하니 잊지 말 것.

**확장이 어렵다 싶으면**: 정적 분석에 한계 있다고 판단되는 패턴은 fix 시도 전에 사용자에게 알려라. "이 패턴은 정적 차단 어렵고 런타임 sandbox가 더 적절합니다" 같은 솔직한 보고. 추측으로 fragile fix 금지.
