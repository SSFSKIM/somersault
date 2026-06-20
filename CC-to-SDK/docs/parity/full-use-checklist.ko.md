# 전체 사용(Full-Use) 수동 QA 체크리스트

자동화된 테스트 스위트는 두 계층을 커버한다: **컴포넌트/유닛**(실제 Ink UI, *가짜* 세션)과
**라이브 e2e**(실제 API, 그러나 *lib 백엔드*를 구동 — `openSession`/`connectDaemon`을 직접 호출하며,
렌더링된 UI를 거치지 않는다). 이 체크리스트는 그 어느 쪽도 닿지 못하는 이음새(seam)를 다룬다:
**실제로 렌더링된 TUI + 실제 키 입력 + 실제 모델을, 사람이 쓰는 방식 그대로 사용하는 것.**
각 성숙도 체크포인트마다 실제 터미널에서 직접 손으로 실행하라.

- **소요 시간:** 전체 1회 통과에 약 25~35분.
- **비용:** 실제 API 크레딧을 소모한다(라이브 모델과 통신함). 프롬프트는 작게 유지하라.
- **아래 표기 규칙:** 모든 박스는 `[ ] 이걸 입력 → 저걸 기대`이다. 박스가 실패하면 다음으로 넘어가기 전에
  그 아래에 **명령어, 본 것, 그리고 stderr가 있다면 그것**을 적어 두라 — 어렴풋이 기억나는 재현 절차는
  다음 주가 되면 쓸모가 없다.
- **두 개의 제품 표면(surface):** `cc-harness-chat`(인터랙티브 REPL — 핵심 제품)과
  `cc-harness-console`(세션 풀 위에서 동작하는 데몬 대시보드). Part C(resume/replay)는 요청에 따라
  가장 깊이 있게 다루는 섹션이다.

---

## 0. 일회성 부트스트랩 (새로 빌드)

> 모든 명령어는 `CC-to-SDK/` 디렉터리에서 시작한다고 가정한다. `tui/`는 빌드된 `cc-harness`
> (`file:../harness`)에 의존하므로 **harness를 먼저 빌드**한다 — 순서가 어긋나면 tui 타입체크가
> "Cannot find module 'cc-harness'"로 실패한다.

```bash
# from CC-to-SDK/
cd harness && npm install && npm run build && npm run typecheck     # builds harness/dist
cd ../tui && npm install && npm run build && npm run typecheck       # builds tui/dist (needs harness/dist)
cd ..                                                                # back to CC-to-SDK/
```

- [ ] **Harness 빌드가 깨끗함** — `npm run build`가 0으로 종료, `npm run typecheck`가 0으로 종료.
- [ ] **TUI 빌드가 깨끗함** — 빌드 후 `tui/dist/chat.js`와 `tui/dist/cli.js`가 둘 다 존재.

```bash
ls tui/dist/chat.js tui/dist/cli.js     # both should print, no "No such file"
```

**이 셸에 API 키를 로드한다**(gitignore 처리됨, `CC-to-SDK/.env`에 위치). 이 터미널의 이후 모든
명령어가 이 키를 상속한다:

```bash
set -a; . ./.env; set +a
test -n "$ANTHROPIC_API_KEY" && echo "key loaded (${#ANTHROPIC_API_KEY} chars)" || echo "NO KEY"
```

- [ ] **키 로드됨** — `NO KEY`가 아니라 `key loaded (N chars)`를 출력. 키가 없으면 바이너리는 그래도
  실행되지만 첫 턴에서 인증 에러가 난다.

> 이 키가 로드된 셸을 통과 전 과정 내내 열어 두거나, 새 터미널마다 `set -a` 줄을 다시 실행하라.
> 전체 키를 echo하거나 커밋되는 곳에 붙여넣는 일은 **절대** 하지 말 것.

---

## A. `cc-harness-chat` — 인터랙티브 REPL

파일 편집 테스트가 레포를 건드리지 않도록 버릴 작업 디렉터리에서 실행한다:

```bash
mkdir -p /tmp/ccqa && printf 'ORIGINAL\n' > /tmp/ccqa/note.txt
node tui/dist/chat.js --cwd /tmp/ccqa
```

> 빌드 없이 개발용으로 돌리는 대안(dist를 건너뜀): `cd tui && npx tsx src/chat.tsx --cwd /tmp/ccqa`.
> 위의 새로-빌드 경로가 충실한 경로다 — 실제로 출하되는 산출물을 그대로 구동한다.

### A1. 실행 + 기본 스트리밍 턴

- [ ] **렌더링됨** — 트랜스크립트 영역, 컴포저 입력 줄, 그리고 하단의 **상태 표시줄**이 보이고
  `model …  mode default`(그리고 `think:…`는 `--think`를 넘겼을 때만)이 표시된다.
- [ ] **스트리밍 동작** — `Say the single word READY and nothing else.` ↵ 입력 → 응답이 토큰
  단위로 스트리밍된 뒤 안정화된다. 턴이 끝나면 상태 표시줄의 `busy` 인디케이터가 사라진다.
- [ ] **컨텍스트 인디케이터 갱신** — 턴이 끝난 뒤 상태 표시줄에 `ctx …%` 수치가 표시된다(매 턴 이후
  `getContextUsage`로부터 새로고침됨).

### A2. 권한 플로우 (default 모드 → 도구 → 브로커 다이얼로그)

- [ ] **도구가 REPL 내 권한 다이얼로그를 띄움** —
  `Edit note.txt: replace ORIGINAL with CHANGED, then say done.` ↵ 입력 → 편집이 적용되기
  전에 `Edit` 허용을 묻는 **PermissionDialog**가 나타난다.
- [ ] **Allow하면 변경이 적용됨** — allow 선택 → 턴이 완료되고:
  ```bash
  cat /tmp/ccqa/note.txt    # → CHANGED
  ```
- [ ] **Deny하면 차단됨** — 두 번째 편집으로 반복하고 **deny** → 파일은 그대로이고, 모델은 도구가
  거부되었다고 통보받는다(성공했다고 주장해서는 안 된다).

### A3. 권한 사다리(Tab) + `/yolo`

- [ ] **Tab이 사다리를 순환** — `Tab`을 누르고 상태 표시줄의 `mode` 필드가
  `default → acceptEdits → auto`로 순환하는지 본다(모드마다 색이 바뀐다). 다이얼로그나 resume
  피커가 열려 있는 동안에는 `Tab`이 비활성(그때는 다이얼로그가 입력을 소유함)이다.
- [ ] **`acceptEdits`는 편집 프롬프트를 멈춤** — `acceptEdits`에서는 편집 프롬프트가 다이얼로그 없이
  적용된다.
- [ ] **`auto`는 모델을 자가 치유함** — `auto`로 순환할 때 현재 모델이 auto 가능 모델이 아니라면 공지를
  띄우고 지원되는 모델로 전환해야 한다(auto는 모델 게이팅됨). 상태 표시줄의 `model`이 갱신되고,
  안전한 작업에 대해 수동 allow 없이 auto 턴이 도는지 확인하라.
- [ ] **`/yolo`는 bypass를 활성화** — `/yolo` ↵ 입력 → 모드가 `bypassPermissions`로 표시되고
  도구가 이제 게이팅 없이 실행된다. (bypass는 **오직** `/yolo` 또는
  `--permission-mode bypassPermissions`로만 도달 가능하며, Tab 순환으로는 절대 안 된다 — Tab이
  bypass에 도달하지 않음을 검증하라.)

### A4. 슬래시 명령어

각각 입력하고 응답 줄을 확인한다:

- [ ] `/help` → 모든 명령어를 나열(`model, compact, context, clear, resume, continue, yolo, think, help`).
- [ ] `/model` → 현재 모델을 흐리게(dim) 출력. `/model claude-haiku-4-5-20251001` → `model → …`
  이 출력되고 상태 표시줄 `model`이 갱신됨; 다음 턴이 그것을 사용.
- [ ] `/think` → 현재 레벨을 출력. `/think high` → `thinking → high`가 출력되고 상태 표시줄에
  `think:high` 표시. `/think off` → 비활성화; `/think 12000` → 원시 예산값을 수용.
  `/think bogus` → 빨간 `unknown level` 에러, 크래시 없음.
- [ ] `/context` → `ctx N% · used / max · status` 출력.
- [ ] `/compact` → `✦ compacted X → Y` 출력(컨텍스트가 너무 작으면 흐린 "nothing to compact").
- [ ] `/clear` → 화면상의 트랜스크립트는 지우지만 세션 컨텍스트는 **유지**(앞 턴을 참조하는 후속
  질문을 해 보라 — 여전히 알고 있어야 함).
- [ ] `/bogus` → 빨간 `Unknown command: /bogus · try /help`, 크래시 없음.

### A5. 입력 사용성(ergonomics)

- [ ] **여러 줄** — 컴포저 안에서 줄바꿈을 입력하고(컴포저의 멀티라인 바인딩에 따라) 두 줄짜리 프롬프트를
  제출 → 그대로 도착하고 턴이 완료된다.
- [ ] **붙여넣기** — 여러 줄 블록을 붙여넣음 → 줄마다 턴이 발생하지 않고 하나의 입력으로 들어간다.
- [ ] **Esc가 실행 중인 턴을 중단** — 긴 턴(`Count slowly from 1 to 50.`)을 시작하고 `Esc`를
  누름 → 턴이 중단되고 REPL이 준비 상태로 돌아온다.

### A6. 실행 플래그

`Ctrl-C`로 종료하고 각 플래그로 다시 실행한다; 실행 시점에 적용되는지 확인한다:

- [ ] `--model claude-haiku-4-5-20251001` → 상태 표시줄이 해당 모델로 열린다.
- [ ] `--permission-mode acceptEdits` → `acceptEdits`로 열린다. 알 수 없는 값은 stderr 공지를
  출력하고 `default`로 폴백한다.
- [ ] `--think high` → 상태 표시줄이 첫 턴부터 `think:high`를 표시하며 열린다.
- [ ] `--cwd /tmp/ccqa` → 파일 작업이 그 디렉터리를 기준으로 해석된다(위에서 이미 사용함).

---

## B. `cc-harness-console` — 데몬 대시보드

콘솔은 **클라이언트**이므로 동작 중인 데몬이 필요하다. **두 개의 터미널**을 사용하라(둘 다
`set -a; . ./.env; set +a` 줄로 키 로드).

**터미널 1 — 데몬 시작:**
```bash
node harness/dist/cli.js daemon       # prints: cc-harness daemon listening at <socket>
```

**터미널 2 — 콘솔 실행:**
```bash
node tui/dist/cli.js                   # connects to the default daemon socket automatically
```
> 빌드 없는 대안: `cd tui && npm run cli`.

- [ ] **콘솔 렌더링 + 데몬 가동 중** — **Pool**(왼쪽), **Detail** 패널(오른쪽), 그리고 `daemon up`
  으로 읽히는 상태 표시줄이 보인다. 처음에는 풀이 비어 있다.
- [ ] **`n`이 세션을 스폰** — `n`을 누름 → 풀에 세션이 나타나고 상태가 `spawned …`을 표시. 내비게이션을
  테스트할 수 있도록 두 번째도 스폰하라.
- [ ] **`j` / `k` (또는 ↓ / ↑) 내비게이션** — 선택 하이라이트가 이동하고 Detail 패널이 따라온다.
- [ ] **`Enter`가 입력에 포커스; `Esc`가 목록으로 복귀** — `Enter`를 누르고 작은 프롬프트를 입력해
  제출 → Detail 패널로 스트리밍됨; `Esc`로 포커스가 풀로 돌아온다.
- [ ] **`m`이 모델을 순환** — 상태가 세션의 지원 모델들을 `model=…`로 순환 표시.
- [ ] **`p`가 권한 모드를 순환** — `default → acceptEdits → bypassPermissions → plan →
  dontAsk → auto`로 순환; `auto`에서는 먼저 지원되는 모델로 `set_model`을 발행(REPL과 동일한
  자가 치유).
- [ ] **`t`가 thinking 예산을 순환** — 상태가 `thinking=off → low → medium → …`을 표시(`set_thinking`
  컨트롤 op 발행).
- [ ] **`/`가 선택된 세션을 compact** → 상태 `compact`.
- [ ] **`f`가 선택된 세션을 포크** → 상태 `forked → <new id>`; 새 행이 나타남.
- [ ] **`i`가 선택된 세션의 실행 중인 턴을 중단**.
- [ ] **`P`가 proactive를 토글** — 프로액티브 루프를 시작/중지; 상태가 그 상태를 반영.
- [ ] **`x`가 세션을 중지** — 확인 다이얼로그를 띄움; 확인 → 행이 사라짐.
- [ ] **연결된(attached) 권한 다이얼로그** — `default` 모드의 세션에 도구를 유발하는 프롬프트를 제출
  → 콘솔에 **PermissionDialog**가 나타남; allow/deny가 결정을 그 세션으로 다시 라우팅함.
- [ ] **`q` / `Ctrl-C`가 콘솔을 깨끗이 종료**(데몬은 계속 동작).

**데몬 CLI 교차 점검** (터미널 3, 키 로드):
- [ ] `node harness/dist/cli.js ps` → 콘솔이 보여 주는 라이브 세션(id, status, model)을 나열.
- [ ] `node harness/dist/cli.js top --once` → 풀의 단발 스냅샷.
- [ ] **데몬 종료** — `node harness/dist/cli.js daemon stop` → 터미널 1이 종료됨; 콘솔 상태가
  `daemon down`으로 바뀜.

---

## C. Resume & replay (심층 섹션)

**동작 방식("올바른" 모습이 무엇인지 알 수 있도록):**

- SDK는 모든 채팅 트랜스크립트를 **`~/.claude/projects/<project-slug>/`**에 영속화하며,
  **작업 디렉터리(`cwd`)로 스코프**된다. Resume는 `listSessions({dir: cwd})` /
  `getSessionMessages(id, {dir: cwd})`를 통해 그곳에서 읽는다.
- **따라서 resume은 cwd 스코프다.** **같은 `--cwd`**에서 생성된 세션만 보고/이어갈 수 있다. 다른
  디렉터리에서 실행하면 피커가 비어 있고 `--continue`는 "No sessions to continue here"라고 말한다.
  이것이 1순위 함정이다 — 일부러 테스트하라(C4).
- `resumeInto(id)`는 **먼저 트랜스크립트를 가져온 뒤 전환한다**: 히스토리가 있으면 resume된 세션으로
  전환하고 `replayLines`로 이전 트랜스크립트를 다시 렌더링한다; 가져온 것이 비었거나 throw하면
  **전환하지 않고** 경고를 출력한 뒤 현재 위치에 머무른다. (깨진 resume으로 빠지는 일 없음.)
- `replayLines`는 **마지막 200개 메시지**로 캡을 두고 생략(elision) 마커를 표시하며, 중첩된
  (서브에이전트) 메시지를 들여쓰고, 블록을 `resumed: <label> · N turns · <time>` 헤더와
  `resumed here · live` 구분선으로 감싼다. `tool_result` 블록은 건너뛴다(프롬프트 + 응답만 렌더링).

### C0. resume할 세션 시드(seed)

```bash
mkdir -p /tmp/ccqa-resume
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
그 REPL에서, 트랜스크립트가 식별 가능하도록 **서로 다른 3개의 턴**을 실행한다, 예:
- `My favorite number is 42. Remember it.` ↵
- `Name three primes.` ↵
- `What was my favorite number?` ↵  (42라고 답해야 함)

그런 다음 `Ctrl-C`로 종료한다.

- [ ] **영속화됨** — 이 프로젝트의 트랜스크립트 파일이 이제 존재하는지 확인:
  ```bash
  ls -t ~/.claude/projects/*/  | head        # newest jsonl is your session
  ```

### C1. `/continue` (가장 최근, 같은 세션)

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
- [ ] `/continue` ↵ 입력 → 앞선 3개의 턴이 트랜스크립트로 **리플레이**되고,
  `resumed: … · 3 turns · …` 헤더와 그 뒤의 `resumed here · live` 구분선이 붙는다.
- [ ] **컨텍스트가 진짜로 이어짐** — `What was my favorite number?` ↵ 입력 → **42**라고 답한다
  (화면상의 텍스트뿐 아니라 SDK 세션 컨텍스트가 resume되었음을 증명).

### C2. 실행 시 `--continue` / `-c`

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume --continue
```
- [ ] 가장 최근 세션이 **마운트 시 자동 리플레이**됨(`/continue` 불필요). 헤더 + 구분선 존재.
  `-c`는 수용되는 별칭이다 — 동일하게 동작하는지 검증하라.

### C3. `/resume` 피커 + `--resume <id>`

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
- [ ] `/resume` ↵ 입력 → **SessionPicker**가 이전 세션들을 나열(최근 순). 하나를 고름 →
  `/continue`와 똑같이 리플레이됨.
- [ ] **취소 동작** — `/resume`를 다시 열고 취소 → 컴포저로 복귀, 전환 없음, 현재 세션 그대로.
- [ ] **피커에서 id를 잡아둠**(행에 세션 id가 보임), 종료한 뒤 그것을 타깃으로 다시 실행:
  ```bash
  node tui/dist/chat.js --cwd /tmp/ccqa-resume --resume <paste-id>
  ```
  → 그 **특정** 세션이 마운트 시 리플레이됨.

### C4. cwd 스코핑 함정 (네거티브 테스트)

```bash
node tui/dist/chat.js --cwd /tmp/ccqa          # a DIFFERENT dir than the seeded one
```
- [ ] `/resume` → 피커가 **비어 있음**(이 프로젝트에 세션 없음).
- [ ] `/continue` → 흐린 **"No sessions to continue here"**를 출력하고, 현재의 새 세션에 머무름
  (크래시 없음, 전환 없음).

### C5. 깨진 / 빈 resume (네거티브 테스트)

- [ ] `node tui/dist/chat.js --cwd /tmp/ccqa-resume --resume not-a-real-id` → 마운트 시
  `⚠ couldn't resume not-a-r… — no history found`를 출력하고 **동작하는 새 세션에 머무름**
  (먼저-가져오고-그다음-전환 보장 — 죽은 세션으로 빠뜨리면 안 됨).

### C6. 리플레이 충실도 스팟 체크

- [ ] **긴 트랜스크립트 생략** — 턴이 많은 세션을 resume(또는 기대치를 낮춰 메커니즘만 확인) → 200개
  메시지를 넘으면 생략 마커가 표시되고 꼬리 부분만 렌더링됨.
- [ ] **Edit/Write diff 렌더링** — resume된 세션에 `Edit`/`Write`가 있었다면, 리플레이된 줄이
  원시 도구 JSON이 아니라 diff 본문(라이브 렌더링과 공유)을 보여준다.
- [ ] **`/clear` 후 resume** — `/clear`가 화면을 지움; 이후 `/resume`는 여전히 고른 세션의 전체
  트랜스크립트를 리플레이함(clear는 화면 전용이며 컨텍스트 삭제가 아님).

---

## D. 선택 — 헤드리스 lib 정상성(one-shot)

TUI가 올라타 있는 백엔드가 UI 바깥에서도 여전히 응답하는지 확인:

```bash
node harness/dist/cli.js "Reply with exactly: OK"        # one-shot, bypass mode, streams to stdout
echo "test stdin" | node harness/dist/cli.js "Summarize stdin in 3 words"
```
- [ ] one-shot 프롬프트가 응답을 스트리밍하고 0으로 종료.
- [ ] 파이프된 stdin이 프롬프트에 합쳐짐.

---

## E. 보완적 자동화 계층 (참고)

이 수동 통과는 *느낌(feel)*과 TTY 전용 동작(붙여넣기, raw 모드, 실행 플래그)을 검증한다. 반복 가능한
회귀 그물망은 **게이팅된 라이브 스위트**다 — 레버가 실제 API에 대해 여전히 작동한다는 기계 검증된 증거를
원할 때 키를 로드해 실행하라:

```bash
set -a; . ./.env; set +a
cd tui && npm run test:live        # tui live e2e (chat, console, auto-mode, thinking, resume-replay)
cd ../harness && npm run test:live # harness live e2e (daemon, sessions, hooks, compaction, …)
```
키가 없으면 이 스위트들은 **깨끗하게 스킵**된다(`ANTHROPIC_API_KEY`로 게이팅됨). 참고: 이들은 렌더링된
UI가 아니라 lib 백엔드를 구동한다 — 바로 그 UI↔모델 이음새가 *이* 수동 체크리스트가 커버하는 부분이다.

---

## 트러블슈팅

| 증상 | 유력한 원인 / 해결 |
|---|---|
| tui 빌드에서 `Cannot find module 'cc-harness'` | `tui/`보다 **먼저** `harness/`를 빌드(§0 순서). |
| 첫 턴이 인증에서 에러 | 이 셸에 키가 로드되지 않음 — `set -a; . ./.env; set +a` 재실행. |
| 세션이 있는데도 `/resume`가 비어 있음 | 잘못된 `--cwd` — resume은 cwd 스코프(§C4). 원래 디렉터리에서 실행. |
| 콘솔이 `daemon down`을 표시 | 데몬이 동작 중이 아님 — 먼저 `node harness/dist/cli.js daemon` 시작. |
| `auto` 모드가 안전한 작업에서 결코 게이팅 없이 안 돎 | 모델이 auto 가능 모델이 아니고 자가 치유가 안 일어남 — `auto`에 진입했을 때 상태 표시줄 `model`이 실제로 바뀌었는지 확인. |
| 렌더링이 깨짐 | 터미널이 너무 좁거나 실제 TTY가 아님(바이너리를 파이프하지 말 것). 전체 터미널 창을 사용. |

## 정리(Cleanup)

```bash
node harness/dist/cli.js daemon stop 2>/dev/null   # if a daemon is still up
rm -rf /tmp/ccqa /tmp/ccqa-resume
# Persisted transcripts under ~/.claude/projects/ are harmless to leave; remove the test project
# slugs by hand if you want a clean slate.
```
