# Full-Use Manual QA Checklist

The automated suites cover three layers: **unit** (`test/unit`, DI fakes, no network), **tui**
(`test/tui`, real Ink components via `ink-testing-library`, still no network), and **live e2e**
(`test/live` + `test/integration`, real API or a real socket, but driving the library/process
surface directly — `spawnSync`ing `dist/cli/bin.js`, or calling `openSession`/`SessionHost`
in-process — never a rendered terminal a person is typing into). This checklist covers the seam
none of those reach: **the real rendered REPL + real keystrokes + the real model + real detached
processes, used the way a person uses them.** Run it by hand in a real terminal at each maturity
checkpoint.

- **Time:** ~25–35 min for the full pass.
- **Cost:** burns real API credit (it talks to the live model). Keep prompts tiny.
- **Convention below:** every box is `[ ] type this → expect that`. If a box fails, write down the
  **command, what you saw, and any stderr** under it before moving on — a half-remembered repro is
  worthless next week.
- **One product surface:** the `ccx` binary. Foreground `ccx` is the interactive REPL (the primary
  product); `ccx -p "<prompt>"` is one-shot headless; `ccx --bg` / `ccx --detachable` spawn
  detached sessions; `ccx attach <target>` attaches to a live one; `ccx agents` / `ccx stop` /
  `ccx rm` / `ccx fleet gc` manage the fleet. There is no separate console/daemon binary — that
  package was deleted when `ccx` absorbed it.

---

## 0. One-time bootstrap (fresh build)

```bash
# from CC-to-SDK/
cd harness && npm install && npm run build && npm run typecheck
```

- [ ] **Build is clean** — `npm run build` exits 0, `npm run typecheck` exits 0.
- [ ] **The binary exists** — `ls dist/cli/bin.js` prints, no "No such file".

Optionally make the bare `ccx` command available system-wide:

```bash
npm link      # optional — makes `ccx` resolve without a path
```

> Every command below is written as `ccx …`. If you skipped `npm link`, substitute
> `node dist/cli/bin.js` for `ccx` everywhere (run from `harness/`, or give the full path).

**Load credentials into this shell** (gitignored, live at `CC-to-SDK/.env`). Every later command in
this terminal inherits them. Two options:

- **Subscription (preferred — no metered credits):** `claude setup-token` → put the printed
  `sk-ant-oat01-…` in `.env` as `CLAUDE_CODE_OAUTH_TOKEN=…`, and keep any `ANTHROPIC_API_KEY` line
  **commented** (it shadows the token when both are set). Bills your Pro/Max plan.
- **Metered API:** `ANTHROPIC_API_KEY=…` in `.env`. Bills per-token credits.

```bash
set -a; . ../.env; set +a
test -n "$CLAUDE_CODE_OAUTH_TOKEN$ANTHROPIC_API_KEY" \
  && echo "auth loaded (oauth=${CLAUDE_CODE_OAUTH_TOKEN:+yes} apikey=${ANTHROPIC_API_KEY:+yes})" || echo "NO AUTH"
```

- [ ] **Auth loaded** — prints `auth loaded (...)`, not `NO AUTH`. Without it the first turn errors
  out on auth (the binary still launches).

> Keep this keyed shell open for the whole pass, or re-run the `set -a` line in each new terminal.
> **Never** echo the full key/token or paste it anywhere committed.

---

## A. Foreground `ccx` — the interactive REPL

A plain `ccx` invocation is **both host and client in one process**: an in-process session host plus
a loopback client talking to it over its own socket — the same wire protocol `ccx attach` uses
against a detached host. Run a throwaway working dir so file-edit tests don't touch the repo:

```bash
mkdir -p /tmp/ccqa && printf 'ORIGINAL\n' > /tmp/ccqa/note.txt
ccx --cwd /tmp/ccqa
```

### A1. Launch + a basic streamed turn

- [ ] **It renders** — a welcome banner (cwd/model/mode + tips), a transcript area, a composer input
  line, and a **status bar** at the bottom showing `model …  mode default` (no `--think` flag →
  no `think:…` segment).
- [ ] **Streaming works** — type `Say the single word READY and nothing else.` ↵ → the reply streams
  token-by-token, then settles. The `⟳ streaming` status-bar marker clears when the turn ends.
- [ ] **Context indicator updates** — after the turn, the status bar shows a `ctx N%` figure
  (refreshed from `getContextUsage` after every turn).

> **Known quirk — read before A2 — mostly fixed 2026-07-28 (Goal B, control-plane fidelity):** the
> status bar's `mode` label is *seeded* from the string `"default"` as a UI placeholder at mount
> (`main.ts`'s `hookOpts.initialMode` still falls back to `"default"` when you don't pass
> `--permission-mode`) — that placeholder is **not** the harness's actual engine default, which is the
> SDK's `auto` classifier mode (`resolveOptions`'s `DEFAULTS.permissionMode`). As of the control-plane
> work, though, the host now pushes the **real** `permissionMode` on its first `state` event the moment a
> client connects/follows (host-truth mode sync), so the placeholder self-corrects to `auto` within a tick
> of launch instead of staying wrong for the whole session — you may see a one-frame flash of `default`
> before it flips. Under `auto`, safe edits can still go through without a dialog at all — the classifier
> is deciding, not the label. For a **deterministic** permission-dialog test (A2 below), still always
> launch with `--permission-mode default` explicitly.

### A2. Permission flow (`default` mode → tool → broker dialog)

Relaunch so the mode is unambiguous:

```bash
ccx --cwd /tmp/ccqa --permission-mode default
```

- [ ] **Tool triggers an in-REPL permission dialog** — type
  `Edit note.txt: replace ORIGINAL with CHANGED, then say done.` ↵ → before the edit applies, a
  **PermissionDialog** appears asking `Allow Claude to use Edit?` with the file path shown.
- [ ] **Allow applies the change** — press `1` (or `↑`/`↓` + Enter on "Yes") → the turn completes,
  and:
  ```bash
  cat /tmp/ccqa/note.txt    # → CHANGED
  ```
- [ ] **Deny blocks it** — repeat with a second edit and press `3` or `Esc` (both deny) → the file is
  unchanged and the model is told the tool was denied (it should not claim success).
- [ ] **"Don't ask again" works** — trigger a third edit and press `2` → it applies, and a follow-up
  edit in the same session no longer prompts.

### A3. Permission ladder (Tab) + `/yolo`

- [ ] **Tab cycles the ladder** — press `Tab` and watch the status-bar `mode` field cycle
  `default → acceptEdits → auto` (colors change per mode: green/yellow/cyan). `Tab` only cycles the
  mode when no dialog, mention popup, or command popup is open — those own `Tab` themselves while
  active.
- [ ] **`acceptEdits` stops prompting for edits** — in `acceptEdits`, an edit prompt applies without a
  dialog (non-edit tools like `Bash` still route to the broker).
- [ ] **`auto` self-heals the model** — cycling to `auto` on a non-auto-capable model (e.g. relaunch
  with `--model claude-haiku-4-5-20251001` first) emits `↻ auto — switched model to … (… doesn't
  support auto)` and the status-bar `model` updates; on an already auto-capable model (the default,
  `claude-opus-4-8`) no swap notice appears.
- [ ] **`/yolo` enables bypass** — type `/yolo` ↵ → mode shows `bypassPermissions` (red); tools now
  run ungated. **Bypass is off-cycle**: verify Tab, cycled repeatedly, never lands on
  `bypassPermissions` — it's reachable only via `/yolo` or `--permission-mode bypassPermissions`.

### A4. Slash commands

Type each and confirm the response line (the full current set, from `/help`):

- [ ] `/help` → lists all 12: `model, compact, context, cost, status, clear, resume, continue, yolo,
  think, mcp, help`.
- [ ] `/model` (no arg) → prints the current model dim. `/model claude-haiku-4-5-20251001` →
  `model → …` and the status bar `model` updates; the next turn uses it.
- [ ] `/think` (no arg) → prints current level. `/think high` → `thinking → high` and status bar
  shows `think:high`. `/think off` → disables. `/think 12000` → accepts a raw token budget.
  `/think bogus` → a red `thinking: unknown level "bogus" · try off/low/medium/high/xhigh/max or a
  number`, no crash.
- [ ] `/context` → prints `ctx N% · used / max · status`.
- [ ] `/compact` → prints `✦ compacted X → Y` (or a dim "nothing to compact" if context is tiny).
- [ ] `/cost` → prints upstream's block, every value starting at the same column: `Total cost:` (or
  "included in your … plan" on subscription auth), `Total duration (API):`, `Total duration (wall):`,
  `Total code changes: N lines added, M lines removed`, then `Usage by model:` and one right-aligned
  `<model>:  … input, … output, … cache read, … cache write (…)` row per model.
- [ ] `/status` → prints model / mode / thinking / context% / cwd / session-id in one glance.
- [ ] `/clear` → wipes the on-screen transcript but **keeps** session context (ask a follow-up that
  references the earlier turn — it should still know).
- [ ] `/mcp` (no arg) → prints `mcp: no servers` (or a status row per configured server).
- [ ] `/bogus` → red `Unknown command: /bogus · try /help`, no crash.

### A5. Input ergonomics

- [ ] **Multi-line** — end a line with `\` then ↵ to continue on a new line (the trailing `\` is
  dropped); submit a two-line prompt with a bare ↵ — it arrives intact and the turn completes.
- [ ] **`@` file mentions** — type `@` → a filesystem popup opens over `cwd`, filtered as you type;
  `Tab`/`Enter` accepts, `Esc` closes just the popup (not the composer).
- [ ] **`/` command popup** — type `/` → the same live command catalog pops up inline (not just on
  submit); arrow keys move the selection, `Tab` completes the name.
- [ ] **`!` bash mode** — a line starting with `!` borders the composer in magenta and shows
  `! bash mode — runs locally in cwd (Enter to run)`.
- [ ] **`#` memory mode** — a line starting with `#` borders the composer in blue and shows
  `# memory — appends a note to CLAUDE.md (Enter to save)`.
- [ ] **Esc interrupts a running turn** — start a long turn (`Count slowly from 1 to 50.`) then press
  `Esc` (composer empty, no popup) → the turn is interrupted and the REPL returns to ready.
- [ ] **Ctrl-D on an empty line exits**; **Ctrl-L clears** the screen (keeps session context);
  **Ctrl-C** interrupts a busy turn, or arms/confirms exit (`Press Ctrl-C again to exit` within 2s)
  when idle.

### A6. Launch flags

Quit (`Ctrl-C` twice) and relaunch with each; confirm it takes at launch:

- [ ] `--model claude-haiku-4-5-20251001` → status bar opens on that model.
- [ ] `--permission-mode acceptEdits` → opens in `acceptEdits`.
- [ ] `--think high` → status bar opens showing `think:high` from the first turn.
- [ ] `--effort high` → accepted at launch (no visible status-bar effect; verify it doesn't error).
- [ ] `--cwd /tmp/ccqa` → file ops resolve against that dir (already used above).
- [ ] `-n my-session-name` → accepted (names the session for `ccx agents`/`stop`/`rm` — see Part C).
- [ ] `--settings '{"permissions":{"ask":["Bash(*)"]}}'` → accepted; combine with a `Bash` prompt and
  confirm the dialog still appears in `default`/`auto` mode alike (the ask rule is what summons the
  broker — this is exercised for real in Part C's attach flow).
- [ ] **`--resume <id>` together with a prompt is refused** — `ccx --resume <id> "hi"` → exits 2 with
  `ccx: --resume with a prompt is not supported — resume, then type your prompt` (resume, then type
  your prompt manually).

---

## B. `ccx -p` — one-shot headless

```bash
ccx -p "Reply with exactly: OK"
echo "test stdin" | ccx -p "Summarize stdin in 3 words"
```

- [ ] One-shot prompt prints the reply and exits 0. No REPL renders (headless — this path never
  imports Ink/React).
- [ ] Piped stdin is composed into the prompt.
- [ ] **`-p` with no prompt is refused** — `ccx -p` → exits 2 with `ccx: -p requires a prompt`.
- [ ] **Non-TTY foreground is refused** — `echo hi | ccx` (no `-p`, no `--bg`) → exits 2 with
  `ccx: foreground ccx needs a terminal (use -p or --bg for scripts)`.

---

## C. Background sessions, attach, and the fleet

This is the deepest section by design — it is the newest surface (`ccx --bg` / `--detachable` /
`attach` / the fleet commands), so give it the most scrutiny.

### C0. Spawn detached + list it

```bash
ccx --bg -n qa-bg "Reply with exactly: OK"
```

- [ ] **Banner** — prints exactly `backgrounded · <8 lowercase hex chars>`, e.g.
  `backgrounded · a1b2c3d4`, and the shell returns immediately (no streaming, no REPL).
- [ ] **It's listed while working** —
  ```bash
  ccx agents --json --all
  ```
  → a row for the short id with `state:"working"`, `status:"busy"`, the right `name`/`cwd`.
- [ ] **It's still listed once done** — poll again after the turn finishes → `state:"done"`,
  `status:"idle"`. Without `--all`, `ccx agents` hides terminal rows (a live view, not a log):
  ```bash
  ccx agents          # the finished qa-bg row is gone
  ccx agents --all    # it's back
  ```

### C1. Park a permission, attach, answer it (the deep flow)

```bash
ccx --bg --permission-mode default --settings '{"permissions":{"ask":["Bash(*)"]}}' \
  -n acc5 "Run the bash command: echo PARKED-OK. Use the Bash tool."
```

- [ ] **It blocks** — poll `ccx agents --json --all` until the row reads `state:"blocked"`
  (`status:"idle"` — a park is not a failure).
- [ ] **Attach replays + shows the parked dialog** —
  ```bash
  ccx attach acc5     # or the short id from the banner
  ```
  → the prior transcript replays, then the live turn follows, then a **PermissionDialog** appears
  asking to run `Bash` with `echo PARKED-OK` visible as the target.
- [ ] **Answering resumes the session** — press `1` (allow) → the turn completes to `done` in the
  attached view.

### C2. Ctrl-Z suspends; `/detach` detaches from the composer

- [ ] **Ctrl-Z suspends, never detaches** — press it while attached, return with `fg`, and verify the
  session remains attached and no pending decision was answered. This is the upstream-compatible terminal
  suspend binding.
- [ ] **`/detach` is the detach command** — from an attached session while the composer is visible, type
  `/detach` ↵ → stderr prints `detached — session <short> keeps running · reattach: ccx attach <short>`.
  `ccx agents --json --all` retains the live row, and `ccx attach <short>` reattaches it. A pending
  decision occupies the composer, so answer or deny it before issuing this command.

### C3. `--detachable` — spawn then auto-attach

```bash
ccx --detachable -n qa-det "Reply with exactly: OK"
```

- [ ] Prints the `backgrounded · <short>` banner, then **immediately** attaches in the same
  terminal (no second command needed) and the prompt you gave streams in.
- [ ] Type `/detach` ↵ here to detach (this session is attached, not loopback) — `ccx agents` still
  shows it running; `ccx attach qa-det` reattaches. `Ctrl-Z` only suspends the terminal process.

### C4. `--idle-timeout` (only valid with `--detachable`)

```bash
ccx --detachable --idle-timeout 10 -n qa-idle
```

- [ ] Detach immediately with `/detach` ↵ and leave it unattached for >10s → `ccx agents --all`
  shows the row reach a terminal state (`done`) — the idle reaper ended it because nobody was attached.
- [ ] **`--idle-timeout` without `--detachable` is refused** — `ccx --bg --idle-timeout 10 "hi"` →
  exits 2 with `ccx: --idle-timeout only applies to --detachable sessions`.
- [ ] **`--detachable` and `--bg` together are refused** — exits 2 with
  `ccx: --detachable and --bg are mutually exclusive`.

### C5. A default foreground session is attachable; its terminal owns its life

**Terminal 1:**
```bash
ccx --cwd /tmp/ccqa -n qa-fg
```
**Terminal 2 (same keyed shell):**
```bash
ccx attach qa-fg
```
- [ ] Attach succeeds against a **plain foreground** `ccx` (it's a real host, just in-process +
  loopback for its own client). Send a prompt from either terminal → both terminals see the turn
  render.
- [ ] **Closing terminal 1 ends the session** — close terminal 1 (or `Ctrl-D`/kill the shell, not
  `Ctrl-C` on the REPL) → the host receives the terminal-gone signal, finalizes, and
  `ccx agents --all` shows the row `done`. Terminal 2's attach ends too (the host is gone).

### C6. Fleet lifecycle

- [ ] `ccx stop <short>` — ends the turn but leaves the session resumable by its session id; running
  it twice is silent/idempotent.
- [ ] `ccx rm <short>` — deregisters the row; `ccx agents --all` no longer lists it. Idempotent on an
  already-removed target.
- [ ] **Missing target is refused, not silently a no-op** — `ccx stop` / `ccx rm` with no argument →
  exit 2 with `ccx: stop requires a session: a short id, a session uuid or a name` (same for `rm`).
- [ ] `ccx fleet gc` → prints `removed <path>` for each stale socket file it clears (safe to run with
  nothing stale — prints nothing).
- [ ] `ccx agents --cwd /tmp/ccqa` → filters the listing to sessions rooted at that directory.
- [ ] `ccx attach <a-done-or-stopped-session>` → refuses with
  `ccx: session <short> has ended (<state>) — resume it with: ccx --resume <uuid>` (a terminal
  session isn't attachable — resume it instead, per D below).

### C7. Question park → attach → answer (`AskUserQuestion`)

`AskUserQuestion` always parks — unlike Bash/Edit it needs **no** `--settings` ask rule; it consults
the broker in every permission mode, `bypassPermissions` included.

```bash
ccx --bg -n acc-q "Use the AskUserQuestion tool to ask me whether I prefer the color red or blue \
(single-select, one question). Wait for my answer, then reply with exactly: You chose <the color>."
```

- [ ] **It blocks** — poll `ccx agents --json --all` until the row reads `state:"blocked"` with a
  `waitingFor` starting `question:` (e.g. `question:AskUserQuestion`).
- [ ] **Attach shows the question** —
  ```bash
  ccx attach acc-q
  ```
  → the prior transcript replays, the live turn follows, then a **QuestionDialog** appears with both
  options listed and numbered (`1.`/`2.`), plus an **Other…** row after them.
- [ ] **Answering resumes the session** — press `1` to pick the first-listed option → the dialog
  closes, the turn completes, and the model's reply names the color you picked.
- [ ] **Free-text "Other" also flows (optional)** — repeat with a fresh `--bg` question; this time
  select the **Other…** row (the number after the last option), type a short answer, ↵ → the model's
  final reply reflects your free text (the `response` channel, not a listed option).

### C8. Plan-mode loop (`ExitPlanMode`)

```bash
ccx --cwd /tmp/ccqa --permission-mode plan
```
Prompt: `Plan how you'd add a hello() function to note.txt. Call ExitPlanMode when the plan is ready — don't implement anything yet.`

- [ ] **Plan dialog appears** — a **PlanDialog** renders the plan as markdown in a scrollable window
  (↑/↓ scrolls if it's long), with three choices below it.
- [ ] **Reject with feedback loops the model** — press `3` (or `Esc`) → a one-line feedback prompt
  opens; type `also handle the empty-file case` ↵ → the dialog closes, the model revises its plan and
  calls `ExitPlanMode` again (a second PlanDialog appears).
- [ ] **Approve + auto-accept edits flips the mode** — on that second dialog, press `1` → the dialog
  closes and the status bar's `mode` moves off `plan` to `acceptEdits` (the CLI flips to `default`
  itself; the host then layers the `acceptEdits` upgrade once it observes that). A follow-up prompt
  that edits `note.txt` now applies with **no** dialog.
- [ ] **Approve, manual edits stays gated** — relaunch fresh (`--permission-mode plan`), reach the
  PlanDialog again, and this time press `2` → the status bar shows `mode default` (not
  `acceptEdits`), and a follow-up edit **does** prompt a normal PermissionDialog.

### C9. Background shells + `/bg` panel

```bash
ccx --cwd /tmp/ccqa
```

- [ ] **Ask the model to run something in the background** — prompt
  `Run the bash command: sleep 20 && echo BG-DONE, in the background.` so the model calls `Bash`
  with `run_in_background: true` → no dialog appears, the turn keeps running, and once the SDK's
  background-tasks snapshot arrives the status bar shows a `⚙ 1 bg` count.
- [ ] **Known gap: Ctrl+B does not background an already-running foreground shell** — start a long
  *foreground* shell (`Run the bash command: sleep 20 && echo BG-DONE. Use the Bash tool.`) and,
  while it's running (status bar shows `⟳ streaming`), press `Ctrl+B`: the keypress is accepted and
  the SDK reports success, but the live CLI does not detach the call — it runs to completion in the
  foreground and no background-task snapshot appears. Verified live 2026-07-28
  (`docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md` § Outcomes); use the
  model-initiated step above to populate the panel instead.
- [ ] **`/bg` opens the panel anytime** — type `/bg` ↵ (or press `Ctrl+B` while **idle**) → a
  **BgTasksPanel** lists the backgrounded task as `<short id> · <type> · <description>`.
- [ ] **`k`/`x` stops it** — with the panel open, ↑/↓ to select the row, press `k` or `x` → a
  `◼ task stopped: …` notice appears in the transcript once the stop is confirmed, and the row drops
  off the panel on the next refresh.
- [ ] **Esc closes the panel** — press `Esc` → back to the composer; the `⚙ N bg` status-bar count
  persists as long as tasks remain running.

---

## D. Resume & replay

**How it works (so you know what "correct" looks like):**

- The SDK persists every chat transcript to **`~/.claude/projects/<project-slug>/`**, **scoped by the
  working directory** (`cwd`). Resume reads from there via `listSessions()` / `getSessionMessages(id)`.
- **Therefore resume is cwd-scoped.** You can only see/continue sessions created in the **same
  `--cwd`**. Launch from a different dir and `/resume`'s picker is empty and `/continue` says "No
  sessions to continue here." This is the #1 gotcha — test it on purpose (D4).
- `resumeInto(id)` **fetches the transcript first, then swaps**: if history exists it swaps to the
  resumed session and re-renders the prior transcript via `replayLines`; if the fetch is empty, it
  **does not swap** — it prints a warning and you stay where you are.
- `replayLines` caps to the **last 200 messages** with an elision marker, indents nested (subagent)
  messages, and frames the block with a `resumed: <label> · N turns · <time>` header and a
  `resumed here · live` divider. `tool_result` blocks are skipped (only prompts + replies render).

### D0. Seed a session to resume

```bash
ccx --cwd /tmp/ccqa-resume
```
In that REPL, run **3 distinct turns** so the transcript is recognizable, e.g.:
- `My favorite number is 42. Remember it.` ↵
- `Name three primes.` ↵
- `What was my favorite number?` ↵  (it should answer 42)

Quit with `Ctrl-C` `Ctrl-C`.

- [ ] **It persisted** — confirm a transcript exists for this project:
  ```bash
  ls -t ~/.claude/projects/*/  | head        # newest jsonl is your session
  ```

### D1. `/continue` (most-recent, same session)

```bash
ccx --cwd /tmp/ccqa-resume
```
- [ ] Type `/continue` ↵ → the prior 3 turns **replay**, headed by `resumed: … · 3 turns · …` and
  followed by a `resumed here · live` divider.
- [ ] **Context truly carried** — `What was my favorite number?` ↵ → answers **42** (proving the SDK
  session context resumed, not just the on-screen text).

### D2. `--resume <id>` at launch

```bash
ccx --cwd /tmp/ccqa-resume --resume <paste-id-from-D0>
```
- [ ] That specific session **auto-replays on mount** (no `/continue` needed). Header + divider
  present. (There is no separate `--continue` launch flag — `/continue` is REPL-only; grab the id
  from `ls ~/.claude/projects/…` or the `/resume` picker below.)

### D3. `/resume` picker

```bash
ccx --cwd /tmp/ccqa-resume
```
- [ ] Type `/resume` ↵ → a **SessionPicker** lists prior sessions (most-recent first). Pick one →
  it replays exactly as `/continue` did.
- [ ] **Cancel works** — reopen `/resume`, cancel → returns to the composer, no swap, current session
  intact.

### D4. The cwd-scoping gotcha (negative test)

```bash
ccx --cwd /tmp/ccqa          # a DIFFERENT dir than the seeded one
```
- [ ] `/resume` → picker is **empty** (no sessions for this project).
- [ ] `/continue` → prints a dim **"No sessions to continue here"**, and you stay in the current
  fresh session (no crash, no swap).

### D5. Broken / empty resume (negative test)

- [ ] `ccx --cwd /tmp/ccqa-resume --resume not-a-real-id` → on mount prints
  `⚠ couldn't resume not-a-r… — no history found` and **stays in a working fresh session**
  (fetch-first-then-swap — it must not drop you into a dead session).
- [ ] **Mid-turn resume is refused** — start a long turn, then try `/resume` or `/continue` (both
  dispatch through the same guard) → `cannot resume mid-turn — wait for the turn to finish or press
  Esc to interrupt`.

### D6. Replay fidelity spot-checks

- [ ] **Long transcript elision** — resume a session with many turns (or just confirm the mechanism)
  → past 200 messages, an elision marker shows and only the tail renders.
- [ ] **Edit/Write diffs render** — if the resumed session contained an `Edit`/`Write`, the replayed
  lines show the diff body (shared with live rendering), not raw tool JSON.
- [ ] **`/clear` then resume** — `/clear` wipes the screen; a subsequent `/resume` still replays the
  picked session's full transcript (clear is screen-only, not a context wipe).

---

## E. Complementary automated layer (reference)

This manual pass validates *feel* and the TTY-only behaviors (paste, raw-mode, launch flags, real
detached processes). The repeatable regression net is the **gated live suite** — run it keyed when
you want machine-checked proof the levers still work against the real API:

```bash
set -a; . ../.env; set +a
cd harness
npm run test:unit          # DI fakes, no network — the fast correctness gate
npm run test:tui           # real Ink components via ink-testing-library, still keyless
npm run test:integration   # real sockets, real SessionHost, fake SDK session
npm run test:contract      # shells out to a real python3 filter
npm run test:live          # real API/OAuth — the process + lib surface, not a rendered terminal
```

Without a key/token, `test:live` skips cleanly (gates on `ANTHROPIC_API_KEY` **or**
`CLAUDE_CODE_OAUTH_TOKEN`). Note: `test:live` drives `dist/cli/bin.js` via `spawnSync`/the lib API
directly — it never renders the REPL or presses a key. That UI↔model↔process seam is exactly what
*this* manual checklist covers.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| First turn errors on auth | Key/token not loaded — re-run `set -a; . ../.env; set +a`. If using OAuth, ensure `ANTHROPIC_API_KEY` is commented in `.env` (it shadows the token). |
| Status bar shows `mode default` but tools aren't prompting | That's the known quirk (see A1) — the label defaults to `"default"` but the harness's real engine default is `auto`. Pass `--permission-mode default` explicitly for deterministic dialog behavior. |
| `/resume` / `/continue` empty though you have sessions | Wrong `--cwd` — resume is cwd-scoped (§D4). Launch from the original dir. |
| `ccx attach <id>` fails "no host listening" | The row is stale or the process died — check `ccx agents --all` for its actual state; `ccx fleet gc` clears dead sockets. |
| `ccx attach <id>` says "has ended" | The session reached a terminal state (`done`/`error`/`stopped`) — resume it instead: `ccx --resume <uuid>`. |
| `auto` mode never self-heals the model | The model was already auto-capable (no swap needed) — check the status-bar `model`; the notice only fires on an actual swap. |
| Garbled rendering | Terminal too narrow, or not a real TTY (don't pipe `ccx`). Use a full terminal window. |

## Cleanup

```bash
ccx fleet gc                                  # clears stale sockets
for s in qa-bg qa-det qa-idle qa-fg acc5 acc-q; do ccx rm "$s" 2>/dev/null; done
rm -rf /tmp/ccqa /tmp/ccqa-resume
# Persisted transcripts under ~/.claude/projects/ are harmless to leave; remove the test project
# slugs by hand if you want a clean slate.
```
