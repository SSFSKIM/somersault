# 전체 사용(Full-Use) 수동 QA 체크리스트

자동화된 테스트 스위트는 세 계층을 커버한다: **유닛**(`test/unit`, DI 페이크, 네트워크 없음),
**tui**(`test/tui`, `ink-testing-library`를 통한 실제 Ink 컴포넌트, 여전히 네트워크 없음), 그리고
**라이브 e2e**(`test/live` + `test/integration`, 실제 API 또는 실제 소켓을 쓰지만 lib/프로세스
표면을 직접 구동함 — `dist/cli/bin.js`를 `spawnSync`하거나 `openSession`/`SessionHost`를
in-process로 호출 — 사람이 타이핑하는 렌더링된 터미널은 결코 아님). 이 체크리스트는 그 어느
것도 닿지 못하는 이음새(seam)를 다룬다: **실제로 렌더링된 REPL + 실제 키 입력 + 실제 모델 +
실제 분리(detached) 프로세스를, 사람이 쓰는 방식 그대로 사용하는 것.** 각 성숙도 체크포인트마다
실제 터미널에서 직접 손으로 실행하라.

- **소요 시간:** 전체 1회 통과에 약 25~35분.
- **비용:** 실제 API 크레딧을 소모한다(라이브 모델과 통신함). 프롬프트는 작게 유지하라.
- **아래 표기 규칙:** 모든 박스는 `[ ] 이걸 입력 → 저걸 기대`이다. 박스가 실패하면 다음으로
  넘어가기 전에 그 아래에 **명령어, 본 것, 그리고 stderr가 있다면 그것**을 적어 두라 — 어렴풋이
  기억나는 재현 절차는 다음 주가 되면 쓸모가 없다.
- **하나의 제품 표면:** `ccx` 바이너리 하나뿐이다. 포그라운드 `ccx`는 인터랙티브 REPL(핵심
  제품)이고, `ccx -p "<prompt>"`는 헤드리스 원샷이며, `ccx --bg` / `ccx --detachable`은 분리된
  세션을 스폰하고, `ccx attach <target>`은 살아 있는 세션에 연결하며, `ccx agents` / `ccx stop` /
  `ccx rm` / `ccx fleet gc`가 fleet를 관리한다. 별도의 콘솔/데몬 바이너리는 없다 — 그 패키지는
  `ccx`가 흡수하면서 삭제되었다.

---

## 0. 일회성 부트스트랩 (새로 빌드)

```bash
# from CC-to-SDK/
cd harness && npm install && npm run build && npm run typecheck
```

- [ ] **빌드가 깨끗함** — `npm run build`가 0으로 종료, `npm run typecheck`가 0으로 종료.
- [ ] **바이너리가 존재함** — `ls dist/cli/bin.js`가 출력됨, "No such file"이 아님.

선택적으로 맨몸의 `ccx` 명령어를 시스템 전역에서 쓸 수 있게 만든다:

```bash
npm link      # optional — makes `ccx` resolve without a path
```

> 아래의 모든 명령어는 `ccx …`로 적혀 있다. `npm link`를 건너뛰었다면, 아래 모든 곳에서 `ccx`
> 대신 `node dist/cli/bin.js`로 바꿔 쓰라(`harness/`에서 실행하거나, 전체 경로를 주라).

**이 셸에 자격 증명을 로드한다**(gitignore 처리됨, `CC-to-SDK/.env`에 위치). 이 터미널의 이후
모든 명령어가 이를 상속한다. 두 가지 옵션:

- **구독(선호 — 종량제 크레딧 없음):** `claude setup-token` → 출력된 `sk-ant-oat01-…`를 `.env`에
  `CLAUDE_CODE_OAUTH_TOKEN=…`로 넣고, `ANTHROPIC_API_KEY` 줄이 있다면 **주석 처리**해 둔다(둘 다
  설정되어 있으면 그것이 토큰을 가림). Pro/Max 플랜에 청구된다.
- **종량제 API:** `.env`에 `ANTHROPIC_API_KEY=…`. 토큰당 크레딧이 청구된다.

```bash
set -a; . ../.env; set +a
test -n "$CLAUDE_CODE_OAUTH_TOKEN$ANTHROPIC_API_KEY" \
  && echo "auth loaded (oauth=${CLAUDE_CODE_OAUTH_TOKEN:+yes} apikey=${ANTHROPIC_API_KEY:+yes})" || echo "NO AUTH"
```

- [ ] **인증이 로드됨** — `NO AUTH`가 아니라 `auth loaded (...)`가 출력됨. 없으면 첫 턴이
  인증에서 에러가 난다(바이너리 자체는 그래도 실행됨).

> 이 키가 로드된 셸을 통과 전 과정 내내 열어 두거나, 새 터미널마다 `set -a` 줄을 다시 실행하라.
> 전체 키/토큰을 echo하거나 커밋되는 곳에 붙여넣는 일은 **절대** 하지 말 것.

---

## A. 포그라운드 `ccx` — 인터랙티브 REPL

맨몸의 `ccx` 실행은 **호스트와 클라이언트가 한 프로세스 안에 함께 있는** 형태다: in-process
세션 호스트와, 자기 자신의 소켓을 통해 그것과 통신하는 loopback 클라이언트 — `ccx attach`가
분리된 호스트에 대해 쓰는 것과 동일한 와이어 프로토콜이다. 파일 편집 테스트가 레포를 건드리지
않도록 버릴 작업 디렉터리에서 실행한다:

```bash
mkdir -p /tmp/ccqa && printf 'ORIGINAL\n' > /tmp/ccqa/note.txt
ccx --cwd /tmp/ccqa
```

### A1. 실행 + 기본 스트리밍 턴

- [ ] **렌더링됨** — 웰컴 배너(cwd/model/mode + 팁), 트랜스크립트 영역, 컴포저 입력 줄, 그리고
  하단의 **상태 표시줄**이 보이고 `model …  mode default`가 표시된다(`--think` 플래그가 없으면
  `think:…` 구간 없음).
- [ ] **스트리밍 동작** — `Say the single word READY and nothing else.` ↵ 입력 → 응답이 토큰
  단위로 스트리밍된 뒤 안정화된다. 턴이 끝나면 상태 표시줄의 `⟳ streaming` 마커가 사라진다.
- [ ] **컨텍스트 인디케이터 갱신** — 턴이 끝난 뒤 상태 표시줄에 `ctx N%` 수치가 표시된다(매 턴
  이후 `getContextUsage`로부터 새로고침됨).

> **알려진 특이사항 — A2 전에 읽을 것 — 2026-07-28(Goal B, control-plane fidelity)에 대부분
> 수정됨:** 상태 표시줄의 `mode` 라벨은 마운트 시 UI 표시용 값으로 `"default"`에서 *시드*된다
> (`--permission-mode`를 넘기지 않으면 `main.ts`의 `hookOpts.initialMode`가 여전히 `"default"`로
> 폴백한다) — 이 표시용 값은 하네스의 실제 엔진 기본값이 **아니다**, 실제 기본값은 SDK의 `auto`
> 분류기 모드다(`resolveOptions`의 `DEFAULTS.permissionMode`). 다만 control-plane 작업 이후로는
> 클라이언트가 연결/follow하는 즉시 호스트가 첫 `state` 이벤트로 **실제** `permissionMode`를
> 밀어주므로(호스트-진실 모드 동기화), 이 표시용 값이 세션 내내 틀린 채로 남는 대신 실행 직후
> 한 틱 안에 `auto`로 스스로 교정된다 — 바뀌기 전에 `default`가 한 프레임 정도 깜빡이는 것을
> 볼 수도 있다. `auto` 아래에서는 안전한 편집이 여전히 다이얼로그 없이 그냥 통과할 수 있다 —
> 분류기가 결정하는 것이지 라벨이 결정하는 게 아니다. A2의 **결정론적인** 권한 다이얼로그
> 테스트를 위해서는 여전히 항상 `--permission-mode default`를 명시적으로 주고 실행하라.

### A2. 권한 플로우 (`default` 모드 → 도구 → 브로커 다이얼로그)

모드가 모호하지 않도록 다시 실행한다:

```bash
ccx --cwd /tmp/ccqa --permission-mode default
```

- [ ] **도구가 REPL 내 권한 다이얼로그를 띄움** —
  `Edit note.txt: replace ORIGINAL with CHANGED, then say done.` ↵ 입력 → 편집이 적용되기 전에
  **PermissionDialog**가 나타나 `Allow Claude to use Edit?`를 물으며 파일 경로가 함께 표시된다.
- [ ] **Allow하면 변경이 적용됨** — `1`을 누름(또는 `↑`/`↓` + Enter로 "Yes" 선택) → 턴이
  완료되고:
  ```bash
  cat /tmp/ccqa/note.txt    # → CHANGED
  ```
- [ ] **Deny하면 차단됨** — 두 번째 편집으로 반복하고 `3` 또는 `Esc`(둘 다 deny)를 누름 → 파일은
  그대로이고, 모델은 도구가 거부되었다고 통보받는다(성공했다고 주장해서는 안 된다).
- [ ] **"다시 묻지 않기"가 동작함** — 세 번째 편집을 유발하고 `2`를 누름 → 적용되고, 같은 세션
  내의 이어지는 편집은 더 이상 묻지 않는다.

### A3. 권한 사다리(Tab) + `/yolo`

- [ ] **Tab이 사다리를 순환** — `Tab`을 누르고 상태 표시줄의 `mode` 필드가
  `default → acceptEdits → auto`로 순환하는지 본다(모드마다 색이 바뀐다: 초록/노랑/청록). `Tab`은
  다이얼로그·mention 팝업·명령어 팝업이 열려 있지 않을 때만 모드를 순환시킨다 — 그것들이 열려
  있는 동안에는 각자가 `Tab`을 소유한다.
- [ ] **`acceptEdits`는 편집 프롬프트를 멈춤** — `acceptEdits`에서는 편집 프롬프트가 다이얼로그
  없이 적용된다(`Bash` 같은 비-편집 도구는 여전히 브로커로 라우팅됨).
- [ ] **`auto`는 모델을 자가 치유함** — auto 가능하지 않은 모델(예: 먼저
  `--model claude-haiku-4-5-20251001`로 재실행)에서 `auto`로 순환하면
  `↻ auto — switched model to … (… doesn't support auto)`가 출력되고 상태 표시줄의 `model`이
  갱신된다; 이미 auto 가능한 모델(기본값인 `claude-opus-4-8`)에서는 전환 공지가 뜨지 않는다.
- [ ] **`/yolo`는 bypass를 활성화** — `/yolo` ↵ 입력 → 모드가 `bypassPermissions`(빨강)로
  표시되고 도구가 이제 게이팅 없이 실행된다. **bypass는 순환 밖에 있다**: Tab을 반복해서 순환해도
  `bypassPermissions`에는 결코 도달하지 않는지 확인하라 — 오직 `/yolo` 또는
  `--permission-mode bypassPermissions`로만 도달 가능하다.

### A4. 슬래시 명령어

각각 입력하고 응답 줄을 확인한다(`/help`가 보여주는 현재 전체 목록):

- [ ] `/help` → 12개 전부를 나열: `model, compact, context, cost, status, clear, resume, continue,
  yolo, think, mcp, help`.
- [ ] `/model`(인자 없음) → 현재 모델을 흐리게(dim) 출력. `/model claude-haiku-4-5-20251001` →
  `model → …`이 출력되고 상태 표시줄 `model`이 갱신됨; 다음 턴이 그것을 사용.
- [ ] `/think`(인자 없음) → 현재 레벨을 출력. `/think high` → `thinking → high`가 출력되고
  상태 표시줄에 `think:high` 표시. `/think off` → 비활성화. `/think 12000` → 원시 토큰 예산값을
  수용. `/think bogus` → 빨간
  `thinking: unknown level "bogus" · try off/low/medium/high/xhigh/max or a number`, 크래시 없음.
- [ ] `/context` → `ctx N% · used / max · status` 출력.
- [ ] `/compact` → `✦ compacted X → Y` 출력(컨텍스트가 너무 작으면 흐린 "nothing to compact").
- [ ] `/cost` → 업스트림 블록을 출력(모든 값이 같은 열에서 시작): `Total cost:`(구독 인증이면
  "included in your … plan"), `Total duration (API):`, `Total duration (wall):`,
  `Total code changes: N lines added, M lines removed`, 그리고 `Usage by model:` 아래에
  모델마다 오른쪽 정렬된 `<model>:  … input, … output, … cache read, … cache write (…)` 행.
- [ ] `/status` → model / mode / thinking / context% / cwd / session-id를 한눈에 출력.
- [ ] `/clear` → 화면상의 트랜스크립트는 지우지만 세션 컨텍스트는 **유지**(앞 턴을 참조하는
  후속 질문을 해 보라 — 여전히 알고 있어야 함).
- [ ] `/mcp`(인자 없음) → `mcp: no servers`를 출력(또는 설정된 서버마다 상태 행).
- [ ] `/bogus` → 빨간 `Unknown command: /bogus · try /help`, 크래시 없음.

### A5. 입력 사용성(ergonomics)

- [ ] **여러 줄** — 줄 끝을 `\`로 마치고 ↵를 누르면 새 줄로 이어짐(끝의 `\`는 제거됨); 맨 ↵로
  두 줄짜리 프롬프트를 제출 → 그대로 도착하고 턴이 완료된다.
- [ ] **`@` 파일 mention** — `@`를 입력 → `cwd` 위에서 파일시스템 팝업이 열리고 타이핑에 따라
  필터링됨; `Tab`/`Enter`가 수락하고, `Esc`는 팝업만 닫는다(컴포저 전체가 아니라).
- [ ] **`/` 명령어 팝업** — `/`를 입력 → 같은 실시간 명령어 카탈로그가 인라인으로 팝업된다(제출
  시에만 뜨는 게 아님); 화살표 키로 선택 이동, `Tab`으로 이름 자동완성.
- [ ] **`!` bash 모드** — `!`로 시작하는 줄은 컴포저 테두리를 마젠타로 바꾸고
  `! bash mode — runs locally in cwd (Enter to run)`을 보여준다.
- [ ] **`#` memory 모드** — `#`로 시작하는 줄은 컴포저 테두리를 파랑으로 바꾸고
  `# memory — appends a note to CLAUDE.md (Enter to save)`를 보여준다.
- [ ] **Esc가 실행 중인 턴을 중단** — 긴 턴(`Count slowly from 1 to 50.`)을 시작하고 (컴포저가
  비어 있고 팝업이 없는 상태에서) `Esc`를 누름 → 턴이 중단되고 REPL이 준비 상태로 돌아온다.
- [ ] **빈 줄에서 Ctrl-D는 종료**; **Ctrl-L은 화면을 지움**(세션 컨텍스트는 유지); **Ctrl-C**는
  실행 중인 턴을 중단시키거나, 유휴 상태에서는 종료를 무장/확인한다(2초 이내에
  `Press Ctrl-C again to exit`).

### A6. 실행 플래그

`Ctrl-C`를 두 번 눌러 종료하고 각각으로 다시 실행한다; 실행 시점에 적용되는지 확인한다:

- [ ] `--model claude-haiku-4-5-20251001` → 상태 표시줄이 해당 모델로 열린다.
- [ ] `--permission-mode acceptEdits` → `acceptEdits`로 열린다.
- [ ] `--think high` → 상태 표시줄이 첫 턴부터 `think:high`를 표시하며 열린다.
- [ ] `--effort high` → 실행 시 수용됨(상태 표시줄에 눈에 띄는 효과는 없음; 에러가 안 나는지만
  확인).
- [ ] `--cwd /tmp/ccqa` → 파일 작업이 그 디렉터리를 기준으로 해석된다(위에서 이미 사용함).
- [ ] `-n my-session-name` → 수용됨(`ccx agents`/`stop`/`rm`을 위해 세션 이름을 지정 — Part C
  참고).
- [ ] `--settings '{"permissions":{"ask":["Bash(*)"]}}'` → 수용됨; `Bash` 프롬프트와 조합해
  `default`/`auto` 모드 어느 쪽에서든 다이얼로그가 여전히 나타나는지 확인하라(브로커를 소환하는
  것은 ask 규칙이다 — 이는 Part C의 attach 플로우에서 실제로 다뤄진다).
- [ ] **`--resume <id>`와 프롬프트를 함께 주면 거부됨** — `ccx --resume <id> "hi"` → 종료 코드
  2와 함께
  `ccx: --resume with a prompt is not supported — resume, then type your prompt`
  (resume한 뒤 프롬프트는 손으로 입력하라).

---

## B. `ccx -p` — 헤드리스 원샷

```bash
ccx -p "Reply with exactly: OK"
echo "test stdin" | ccx -p "Summarize stdin in 3 words"
```

- [ ] 원샷 프롬프트가 응답을 출력하고 0으로 종료. REPL은 렌더링되지 않는다(헤드리스 — 이 경로는
  결코 Ink/React를 임포트하지 않는다).
- [ ] 파이프된 stdin이 프롬프트에 합쳐짐.
- [ ] **프롬프트 없는 `-p`는 거부됨** — `ccx -p` → 종료 코드 2와 함께
  `ccx: -p requires a prompt`.
- [ ] **TTY가 아닌 포그라운드는 거부됨** — `echo hi | ccx`(`-p`도 `--bg`도 없이) → 종료 코드
  2와 함께 `ccx: foreground ccx needs a terminal (use -p or --bg for scripts)`.

---

## C. 백그라운드 세션, attach, 그리고 fleet

이 섹션은 의도적으로 가장 깊이 있게 다룬다 — 가장 새로운 표면(`ccx --bg` / `--detachable` /
`attach` / fleet 명령어들)이므로 가장 꼼꼼히 살펴보라.

### C0. 분리 스폰 + 목록 확인

```bash
ccx --bg -n qa-bg "Reply with exactly: OK"
```

- [ ] **배너** — 정확히 `backgrounded · <8자리 소문자 hex>`를 출력한다(예:
  `backgrounded · a1b2c3d4`), 그리고 셸이 즉시 돌아온다(스트리밍 없음, REPL 없음).
- [ ] **동작 중일 때 목록에 나타남** —
  ```bash
  ccx agents --json --all
  ```
  → 해당 short id의 행이 `state:"working"`, `status:"busy"`, 올바른 `name`/`cwd`로 나타남.
- [ ] **완료 후에도 여전히 목록에 있음** — 턴이 끝난 뒤 다시 폴링 → `state:"done"`,
  `status:"idle"`. `--all` 없이는 `ccx agents`가 종결 상태 행을 숨긴다(로그가 아니라 라이브
  뷰이므로):
  ```bash
  ccx agents          # the finished qa-bg row is gone
  ccx agents --all    # it's back
  ```

### C1. 권한을 park하고, attach하고, 답하기(심층 플로우)

```bash
ccx --bg --permission-mode default --settings '{"permissions":{"ask":["Bash(*)"]}}' \
  -n acc5 "Run the bash command: echo PARKED-OK. Use the Bash tool."
```

- [ ] **블록됨** — `ccx agents --json --all`을 폴링해 행이 `state:"blocked"`로 읽힐 때까지
  기다린다(`status:"idle"` — park은 실패가 아니다).
- [ ] **attach가 리플레이 + park된 다이얼로그를 보여줌** —
  ```bash
  ccx attach acc5     # or the short id from the banner
  ```
  → 이전 트랜스크립트가 리플레이되고, 이어서 라이브 턴이 따라오고, 그다음 **PermissionDialog**가
  나타나 `Bash`를 실행할지 물으며 `echo PARKED-OK`가 대상으로 표시된다.
- [ ] **답하면 세션이 재개됨** — `1`(allow)을 누름 → attach된 화면에서 턴이 `done`으로 완료된다.

### C2. Ctrl-Z는 suspend하고 `/detach`가 composer에서 detach함

- [ ] **Ctrl-Z는 suspend만 하고 detach하지 않음** — attach 중 누른 뒤 `fg`로 돌아와 세션이 여전히
  attach되어 있고 대기 중인 결정에 답하지 않았음을 확인한다. 이것이 upstream 호환 터미널 suspend
  바인딩이다.
- [ ] **`/detach`가 detach 명령임** — composer가 보이는 attached 세션에서 `/detach` ↵를 입력한다.
  stderr에 `detached — session <short> keeps running · reattach: ccx attach <short>`가 출력되고,
  `ccx agents --json --all`은 라이브 행을 유지하며 `ccx attach <short>`로 다시 연결된다. 대기 중인
  결정은 composer를 차지하므로 이 명령 전에 allow 또는 deny로 처리한다.

### C3. `--detachable` — 스폰 후 자동 attach

```bash
ccx --detachable -n qa-det "Reply with exactly: OK"
```

- [ ] `backgrounded · <short>` 배너를 출력한 뒤, **곧바로** 같은 터미널에서 attach하고(두 번째
  명령이 필요 없음) 넘긴 프롬프트가 스트리밍된다.
- [ ] 여기서는 `/detach` ↵로 detach한다(이 세션은 attached이지 loopback이 아니다) — `ccx agents`는
  여전히 그것이 동작 중임을 보여주고 `ccx attach qa-det`가 재연결한다. `Ctrl-Z`는 터미널 프로세스를
  suspend할 뿐이다.

### C4. `--idle-timeout` (오직 `--detachable`과 함께일 때만 유효)

```bash
ccx --detachable --idle-timeout 10 -n qa-idle
```

- [ ] 즉시 detach하고(`/detach`) 10초 넘게 attach하지 않은 채 둠 → `ccx agents --all`이 그 행이
  종결 상태(`done`)에 도달했음을 보여준다 — 아무도 attach하지 않았기 때문에 idle reaper가
  종료시켰다.
- [ ] **`--detachable` 없이 쓰는 `--idle-timeout`은 거부됨** —
  `ccx --bg --idle-timeout 10 "hi"` → 종료 코드 2와 함께
  `ccx: --idle-timeout only applies to --detachable sessions`.
- [ ] **`--detachable`과 `--bg`를 함께 쓰면 거부됨** — 종료 코드 2와 함께
  `ccx: --detachable and --bg are mutually exclusive`.

### C5. 기본 포그라운드 세션도 attach 가능함; 그 세션의 생명은 자기 터미널이 쥐고 있음

**터미널 1:**
```bash
ccx --cwd /tmp/ccqa -n qa-fg
```
**터미널 2 (같은 키 로드된 셸):**
```bash
ccx attach qa-fg
```
- [ ] 평범한 **포그라운드** `ccx`에 대해 attach가 성공한다(실제 호스트일 뿐, 자기 클라이언트에
  대해서는 in-process + loopback일 뿐이다). 어느 터미널에서든 프롬프트를 보내면 → 두 터미널
  모두 그 턴의 렌더링을 본다.
- [ ] **터미널 1을 닫으면 세션이 끝남** — 터미널 1을 닫는다(또는 REPL에서 `Ctrl-C`가 아니라
  `Ctrl-D`/셸 자체를 kill) → 호스트가 터미널-사라짐 신호를 받아 종료 처리하고,
  `ccx agents --all`이 그 행을 `done`으로 보여준다. 터미널 2의 attach도 끝난다(호스트가
  사라졌으므로).

### C6. Fleet 생명주기

- [ ] `ccx stop <short>` — 턴을 종료하지만 세션은 자신의 session id로 여전히 resume 가능하다;
  두 번 실행해도 조용히/멱등적으로 동작.
- [ ] `ccx rm <short>` — 행을 등록 해제한다; `ccx agents --all`이 더 이상 그것을 나열하지 않음.
  이미 제거된 대상에 대해서도 멱등.
- [ ] **대상이 없으면 거부됨, 조용히 아무 일도 안 하는 게 아니라** — 인자 없이 `ccx stop` /
  `ccx rm` → 종료 코드 2와 함께
  `ccx: stop requires a session: a short id, a session uuid or a name`(rm도 동일).
- [ ] `ccx fleet gc` → 정리한 오래된(stale) 소켓 파일마다 `removed <path>`를 출력한다(오래된 게
  없으면 안전하게 아무것도 출력하지 않음).
- [ ] `ccx agents --cwd /tmp/ccqa` → 해당 디렉터리에 뿌리를 둔 세션들로 목록을 필터링한다.
- [ ] `ccx attach <이미-done-이거나-stopped된-세션>` → 다음으로 거부됨:
  `ccx: session <short> has ended (<state>) — resume it with: ccx --resume <uuid>`
  (종결된 세션은 attach 대상이 아니다 — 아래 D에 따라 대신 resume하라).

### C7. 질문을 park하고, attach하고, 답하기 (`AskUserQuestion`)

`AskUserQuestion`은 항상 park된다 — Bash/Edit와 달리 `--settings` ask 규칙이 **필요 없다**;
`bypassPermissions`를 포함한 모든 권한 모드에서 브로커에게 물어본다.

```bash
ccx --bg -n acc-q "Use the AskUserQuestion tool to ask me whether I prefer the color red or blue \
(single-select, one question). Wait for my answer, then reply with exactly: You chose <the color>."
```

- [ ] **블록됨** — `ccx agents --json --all`을 폴링해 행이 `state:"blocked"`이고 `waitingFor`가
  `question:`으로 시작(예: `question:AskUserQuestion`)할 때까지 기다린다.
- [ ] **attach가 질문을 보여줌** —
  ```bash
  ccx attach acc-q
  ```
  → 이전 트랜스크립트가 리플레이되고, 라이브 턴이 따라오고, 그다음 **QuestionDialog**가 나타나
  두 옵션이 번호(`1.`/`2.`)와 함께 나열되며 마지막에 **Other…** 행이 붙는다.
- [ ] **답하면 세션이 재개됨** — `1`을 눌러 첫 번째로 나열된 옵션을 고름 → 다이얼로그가 닫히고,
  턴이 완료되며, 모델의 응답이 고른 색을 지목한다.
- [ ] **자유 텍스트 "Other"도 동작함(선택)** — 새로운 `--bg` 질문으로 반복하되, 이번엔 **Other…**
  행(마지막 옵션 다음 번호)을 골라 짧은 답을 입력하고 ↵ → 모델의 최종 응답이 나열된 옵션이 아닌
  자유 텍스트(`response` 채널)를 반영한다.

### C8. Plan 모드 루프 (`ExitPlanMode`)

```bash
ccx --cwd /tmp/ccqa --permission-mode plan
```
프롬프트: `Plan how you'd add a hello() function to note.txt. Call ExitPlanMode when the plan is ready — don't implement anything yet.`

- [ ] **Plan 다이얼로그가 나타남** — **PlanDialog**가 plan을 마크다운으로 스크롤 가능한 창에
  렌더링하고(길면 ↑/↓로 스크롤), 그 아래 세 가지 선택지가 나타난다.
- [ ] **피드백과 함께 거부하면 모델이 다시 계획함** — `3`(또는 `Esc`)을 누름 → 한 줄짜리 피드백
  입력이 열림; `also handle the empty-file case` ↵ 입력 → 다이얼로그가 닫히고, 모델이 계획을
  수정해 `ExitPlanMode`를 다시 호출한다(두 번째 PlanDialog가 나타남).
- [ ] **승인 + 편집 자동 수락은 모드를 전환함** — 그 두 번째 다이얼로그에서 `1`을 누름 →
  다이얼로그가 닫히고 상태 표시줄의 `mode`가 `plan`에서 `acceptEdits`로 옮겨간다(CLI가 스스로
  `default`로 전환하고, 그다음 호스트가 그것을 관찰한 뒤 `acceptEdits` 업그레이드를 얹는다).
  이어서 `note.txt`를 편집하는 프롬프트를 주면 다이얼로그 **없이** 적용된다.
- [ ] **승인, 수동 편집은 계속 게이팅됨** — (`--permission-mode plan`으로) 새로 다시 실행해
  PlanDialog에 다시 도달하고, 이번엔 `2`를 누름 → 상태 표시줄이 `acceptEdits`가 아니라
  `mode default`를 보여주고, 이어지는 편집은 여전히 일반 PermissionDialog를 띄운다.

### C9. 백그라운드 셸 + `/bg` 패널

```bash
ccx --cwd /tmp/ccqa
```

- [ ] **모델에게 백그라운드로 무언가를 실행하도록 요청함** — `Run the bash command: sleep 20 &&
  echo BG-DONE, in the background.`라고 프롬프트해 모델이 `run_in_background: true`로 `Bash`를
  호출하게 함 → 다이얼로그 없이 턴이 계속 실행되고, SDK의 백그라운드 태스크 스냅샷이 도착하면
  상태 표시줄에 `⚙ 1 bg` 카운트가 나타난다.
- [ ] **알려진 한계: Ctrl+B는 이미 실행 중인 포그라운드 셸을 백그라운드로 보내지 못함** — 긴
  *포그라운드* 셸을 시작하고(`Run the bash command: sleep 20 && echo BG-DONE. Use the Bash
  tool.`), 실행 중일 때(상태 표시줄에 `⟳ streaming`) `Ctrl+B`를 누름: 키 입력은 받아들여지고
  SDK도 성공을 보고하지만, 실제 CLI는 그 호출을 분리하지 않는다 — 포그라운드에서 완료까지
  실행되고 백그라운드 태스크 스냅샷은 나타나지 않는다. 2026-07-28에 라이브로 검증됨
  (`docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md` § Outcomes); 패널을
  채우려면 위의 모델 주도 단계를 사용할 것.
- [ ] **`/bg`는 언제든 패널을 염** — `/bg` ↵ 입력(또는 **유휴** 상태에서 `Ctrl+B`) →
  **BgTasksPanel**이 백그라운드 태스크를 `<short id> · <type> · <description>` 형태로 나열한다.
- [ ] **`k`/`x`가 그것을 중지시킴** — 패널이 열린 상태에서 ↑/↓로 행을 선택하고 `k` 또는 `x`를
  누름 → 중지가 확인되면 트랜스크립트에 `◼ task stopped: …` 알림이 나타나고, 다음 갱신에서 해당
  행이 패널에서 사라진다.
- [ ] **Esc가 패널을 닫음** — `Esc`를 누름 → 컴포저로 복귀; `⚙ N bg` 상태 표시줄 카운트는 태스크가
  남아 있는 한 유지된다.

---

## D. Resume & replay

**동작 방식("올바른" 모습이 무엇인지 알 수 있도록):**

- SDK는 모든 채팅 트랜스크립트를 **`~/.claude/projects/<project-slug>/`**에 영속화하며,
  **작업 디렉터리(`cwd`)로 스코프**된다. Resume는 `listSessions()` / `getSessionMessages(id)`를
  통해 그곳에서 읽는다.
- **따라서 resume은 cwd 스코프다.** **같은 `--cwd`**에서 생성된 세션만 보고/이어갈 수 있다. 다른
  디렉터리에서 실행하면 `/resume`의 피커가 비어 있고 `/continue`는 "No sessions to continue
  here"라고 말한다. 이것이 1순위 함정이다 — 일부러 테스트하라(D4).
- `resumeInto(id)`는 **먼저 트랜스크립트를 가져온 뒤 전환한다**: 히스토리가 있으면 resume된
  세션으로 전환하고 `replayLines`로 이전 트랜스크립트를 다시 렌더링한다; 가져온 것이 비었으면
  **전환하지 않고** 경고를 출력한 뒤 현재 위치에 머무른다.
- `replayLines`는 **마지막 200개 메시지**로 캡을 두고 생략(elision) 마커를 표시하며, 중첩된
  (서브에이전트) 메시지를 들여쓰고, 블록을 `resumed: <label> · N turns · <time>` 헤더와
  `resumed here · live` 구분선으로 감싼다. `tool_result` 블록은 건너뛴다(프롬프트 + 응답만
  렌더링).

### D0. resume할 세션 시드(seed)

```bash
ccx --cwd /tmp/ccqa-resume
```
그 REPL에서, 트랜스크립트가 식별 가능하도록 **서로 다른 3개의 턴**을 실행한다, 예:
- `My favorite number is 42. Remember it.` ↵
- `Name three primes.` ↵
- `What was my favorite number?` ↵  (42라고 답해야 함)

`Ctrl-C` `Ctrl-C`로 종료한다.

- [ ] **영속화됨** — 이 프로젝트의 트랜스크립트가 이제 존재하는지 확인:
  ```bash
  ls -t ~/.claude/projects/*/  | head        # newest jsonl is your session
  ```

### D1. `/continue` (가장 최근, 같은 세션)

```bash
ccx --cwd /tmp/ccqa-resume
```
- [ ] `/continue` ↵ 입력 → 앞선 3개의 턴이 **리플레이**되고, `resumed: … · 3 turns · …` 헤더와
  그 뒤의 `resumed here · live` 구분선이 붙는다.
- [ ] **컨텍스트가 진짜로 이어짐** — `What was my favorite number?` ↵ 입력 → **42**라고 답한다
  (화면상의 텍스트뿐 아니라 SDK 세션 컨텍스트가 resume되었음을 증명).

### D2. 실행 시 `--resume <id>`

```bash
ccx --cwd /tmp/ccqa-resume --resume <paste-id-from-D0>
```
- [ ] 그 특정 세션이 **마운트 시 자동 리플레이**됨(`/continue` 불필요). 헤더 + 구분선 존재.
  (별도의 `--continue` 실행 플래그는 없다 — `/continue`는 REPL 전용이다; id는
  `ls ~/.claude/projects/…`나 아래의 `/resume` 피커에서 얻어라.)

### D3. `/resume` 피커

```bash
ccx --cwd /tmp/ccqa-resume
```
- [ ] `/resume` ↵ 입력 → **SessionPicker**가 이전 세션들을 나열(최근 순). 하나를 고름 →
  `/continue`와 똑같이 리플레이됨.
- [ ] **취소 동작** — `/resume`를 다시 열고 취소 → 컴포저로 복귀, 전환 없음, 현재 세션 그대로.

### D4. cwd 스코핑 함정 (네거티브 테스트)

```bash
ccx --cwd /tmp/ccqa          # a DIFFERENT dir than the seeded one
```
- [ ] `/resume` → 피커가 **비어 있음**(이 프로젝트에 세션 없음).
- [ ] `/continue` → 흐린 **"No sessions to continue here"**를 출력하고, 현재의 새 세션에 머무름
  (크래시 없음, 전환 없음).

### D5. 깨진 / 빈 resume (네거티브 테스트)

- [ ] `ccx --cwd /tmp/ccqa-resume --resume not-a-real-id` → 마운트 시
  `⚠ couldn't resume not-a-r… — no history found`를 출력하고 **동작하는 새 세션에 머무름**
  (먼저-가져오고-그다음-전환 — 죽은 세션으로 빠뜨리면 안 됨).
- [ ] **턴 도중의 resume은 거부됨** — 긴 턴을 시작하고 `/resume` 또는 `/continue`를 시도(둘 다
  같은 가드를 거침) →
  `cannot resume mid-turn — wait for the turn to finish or press Esc to interrupt`.

### D6. 리플레이 충실도 스팟 체크

- [ ] **긴 트랜스크립트 생략** — 턴이 많은 세션을 resume(또는 기대치를 낮춰 메커니즘만 확인) →
  200개 메시지를 넘으면 생략 마커가 표시되고 꼬리 부분만 렌더링됨.
- [ ] **Edit/Write diff 렌더링** — resume된 세션에 `Edit`/`Write`가 있었다면, 리플레이된 줄이
  원시 도구 JSON이 아니라 diff 본문(라이브 렌더링과 공유)을 보여준다.
- [ ] **`/clear` 후 resume** — `/clear`가 화면을 지움; 이후 `/resume`는 여전히 고른 세션의 전체
  트랜스크립트를 리플레이함(clear는 화면 전용이며 컨텍스트 삭제가 아님).

---

## E. 보완적 자동화 계층 (참고)

이 수동 통과는 *느낌(feel)*과 TTY 전용 동작(붙여넣기, raw 모드, 실행 플래그, 실제 분리된
프로세스)을 검증한다. 반복 가능한 회귀 그물망은 **게이팅된 라이브 스위트**다 — 레버가 실제
API에 대해 여전히 작동한다는 기계 검증된 증거를 원할 때 키를 로드해 실행하라:

```bash
set -a; . ../.env; set +a
cd harness
npm run test:unit          # DI fakes, no network — the fast correctness gate
npm run test:tui           # real Ink components via ink-testing-library, still keyless
npm run test:integration   # real sockets, real SessionHost, fake SDK session
npm run test:contract      # shells out to a real python3 filter
npm run test:live          # real API/OAuth — the process + lib surface, not a rendered terminal
```

키/토큰이 없으면 `test:live`는 **깨끗하게 스킵**된다(`ANTHROPIC_API_KEY` **또는**
`CLAUDE_CODE_OAUTH_TOKEN`으로 게이팅됨). 참고: `test:live`는 `spawnSync`/lib API를 통해
`dist/cli/bin.js`를 직접 구동한다 — REPL을 렌더링하거나 키를 누르는 일은 결코 없다. 바로 그
UI↔모델↔프로세스 이음새가 *이* 수동 체크리스트가 커버하는 부분이다.

---

## 트러블슈팅

| 증상 | 유력한 원인 / 해결 |
|---|---|
| 첫 턴이 인증에서 에러 | 이 셸에 키/토큰이 로드되지 않음 — `set -a; . ../.env; set +a` 재실행. OAuth를 쓴다면 `.env`에서 `ANTHROPIC_API_KEY`가 주석 처리되어 있는지 확인(토큰을 가림). |
| 상태 표시줄은 `mode default`인데 도구가 묻지 않음 | A1에서 다룬 알려진 특이사항이다 — 라벨은 `"default"`를 기본값으로 하지만 하네스의 실제 엔진 기본값은 `auto`다. 결정론적인 다이얼로그 동작을 원하면 `--permission-mode default`를 명시적으로 주라. |
| 세션이 있는데도 `/resume` / `/continue`가 비어 있음 | 잘못된 `--cwd` — resume은 cwd 스코프다(§D4). 원래 디렉터리에서 실행하라. |
| `ccx attach <id>`가 "no host listening"으로 실패 | 행이 오래됐거나 프로세스가 죽음 — `ccx agents --all`로 실제 상태를 확인하라; `ccx fleet gc`가 죽은 소켓을 정리한다. |
| `ccx attach <id>`가 "has ended"라고 함 | 세션이 종결 상태(`done`/`error`/`stopped`)에 도달함 — 대신 resume하라: `ccx --resume <uuid>`. |
| `auto` 모드가 결코 모델을 자가 치유하지 않음 | 모델이 이미 auto 가능했음(전환이 필요 없었음) — 상태 표시줄의 `model`을 확인하라; 공지는 실제로 전환이 일어날 때만 뜬다. |
| 렌더링이 깨짐 | 터미널이 너무 좁거나 실제 TTY가 아님(`ccx`를 파이프하지 말 것). 전체 터미널 창을 사용. |

## 정리(Cleanup)

```bash
ccx fleet gc                                  # clears stale sockets
for s in qa-bg qa-det qa-idle qa-fg acc5 acc-q; do ccx rm "$s" 2>/dev/null; done
rm -rf /tmp/ccqa /tmp/ccqa-resume
# Persisted transcripts under ~/.claude/projects/ are harmless to leave; remove the test project
# slugs by hand if you want a clean slate.
```
