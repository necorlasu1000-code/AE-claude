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
- **5 moderate vulns** — 모두 dev tree (vitest/vite/esbuild). 핵심 production 의존성 영향 0. 후속에 vitest 3.x 마이그레이션 시 함께 해결.

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
