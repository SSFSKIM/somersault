# Full-Use Manual QA Checklist

The automated suites cover two layers: **component/unit** (real Ink UI, *fake* sessions) and
**live e2e** (real API, but driving the *lib backend* — `openSession`/`connectDaemon` directly,
never the rendered UI). This checklist covers the seam neither reaches: **the real rendered TUI +
real keystrokes + the real model, used the way a person uses it.** Run it by hand in a real
terminal at each maturity checkpoint.

- **Time:** ~25–35 min for the full pass.
- **Cost:** burns real API credit (it talks to the live model). Keep prompts tiny.
- **Convention below:** every box is `[ ] type this → expect that`. If a box fails, write down the
  **command, what you saw, and any stderr** under it before moving on — a half-remembered repro is
  worthless next week.
- **Two product surfaces:** `cc-harness-chat` (the interactive REPL — the primary product) and
  `cc-harness-console` (the daemon dashboard over a session pool). Part C (resume/replay) is the
  deepest section by request.

---

## 0. One-time bootstrap (fresh build)

> All commands assume you start from the `CC-to-SDK/` directory. `tui/` depends on the built
> `cc-harness` (`file:../harness`), so **harness builds first** — out of order, the tui typecheck
> fails with "Cannot find module 'cc-harness'".

```bash
# from CC-to-SDK/
cd harness && npm install && npm run build && npm run typecheck     # builds harness/dist
cd ../tui && npm install && npm run build && npm run typecheck       # builds tui/dist (needs harness/dist)
cd ..                                                                # back to CC-to-SDK/
```

- [ ] **Harness build is clean** — `npm run build` exits 0, `npm run typecheck` exits 0.
- [ ] **TUI build is clean** — `tui/dist/chat.js` and `tui/dist/cli.js` both exist after build.

```bash
ls tui/dist/chat.js tui/dist/cli.js     # both should print, no "No such file"
```

**Load the API key into this shell** (gitignored, lives at `CC-to-SDK/.env`). Every later command in
this terminal inherits it:

```bash
set -a; . ./.env; set +a
test -n "$ANTHROPIC_API_KEY" && echo "key loaded (${#ANTHROPIC_API_KEY} chars)" || echo "NO KEY"
```

- [ ] **Key loaded** — prints `key loaded (N chars)`, not `NO KEY`. Without it the bins still launch
  but the first turn errors out on auth.

> Keep this keyed shell open for the whole pass, or re-run the `set -a` line in each new terminal.
> **Never** echo the full key or paste it anywhere committed.

---

## A. `cc-harness-chat` — the interactive REPL

Run a throwaway working dir so file-edit tests don't touch the repo:

```bash
mkdir -p /tmp/ccqa && printf 'ORIGINAL\n' > /tmp/ccqa/note.txt
node tui/dist/chat.js --cwd /tmp/ccqa
```

> No-build dev alternative (skips dist): `cd tui && npx tsx src/chat.tsx --cwd /tmp/ccqa`. The
> fresh-build path above is the faithful one — it exercises the actual shipped artifact.

### A1. Launch + a basic streamed turn

- [ ] **It renders** — you see a transcript area, a composer input line, and a **status bar** at the
  bottom showing `model …  mode default` (and `think:…` only if you passed `--think`).
- [ ] **Streaming works** — type `Say the single word READY and nothing else.` ↵ → the reply streams
  token-by-token, then settles. Status bar `busy` indicator clears when the turn ends.
- [ ] **Context indicator updates** — after the turn, the status bar shows a `ctx …%` figure (it
  refreshes from `getContextUsage` after each turn).

### A2. Permission flow (default mode → tool → broker dialog)

- [ ] **Tool triggers an in-REPL permission dialog** — type
  `Edit note.txt: replace ORIGINAL with CHANGED, then say done.` ↵ → before the edit applies, a
  **PermissionDialog** appears asking to allow the `Edit`.
- [ ] **Allow applies the change** — choose allow → the turn completes, and:
  ```bash
  cat /tmp/ccqa/note.txt    # → CHANGED
  ```
- [ ] **Deny blocks it** — repeat with a second edit and **deny** → the file is unchanged and the
  model is told the tool was denied (it should not claim success).

### A3. Permission ladder (Tab) + `/yolo`

- [ ] **Tab cycles the ladder** — press `Tab` and watch the status-bar `mode` field cycle
  `default → acceptEdits → auto` (colors change per mode). `Tab` is inactive while a dialog or the
  resume picker is open (the dialog owns input then).
- [ ] **`acceptEdits` stops prompting for edits** — in `acceptEdits`, an edit prompt applies without a
  dialog.
- [ ] **`auto` self-heals the model** — cycling to `auto` should, if the current model isn't
  auto-capable, emit a notice and switch to a supported model (auto is model-gated). Confirm the
  status bar `model` updates and an auto turn runs without a manual allow for safe ops.
- [ ] **`/yolo` enables bypass** — type `/yolo` ↵ → mode shows `bypassPermissions`; tools now run
  ungated. (Bypass is reachable **only** via `/yolo` or `--permission-mode bypassPermissions`, never
  from the Tab cycle — verify Tab never lands on bypass.)

### A4. Slash commands

Type each and confirm the response line:

- [ ] `/help` → lists every command (`model, compact, context, clear, resume, continue, yolo, think, help`).
- [ ] `/model` → prints the current model dim. `/model claude-haiku-4-5-20251001` → `model → …` and
  the status bar `model` updates; the next turn uses it.
- [ ] `/think` → prints current level. `/think high` → `thinking → high` and status bar shows
  `think:high`. `/think off` → disables; `/think 12000` → accepts a raw budget. `/think bogus` → a
  red `unknown level` error, no crash.
- [ ] `/context` → prints `ctx N% · used / max · status`.
- [ ] `/compact` → prints `✦ compacted X → Y` (or a dim "nothing to compact" if the context is tiny).
- [ ] `/clear` → wipes the on-screen transcript but **keeps** session context (ask a follow-up that
  references the earlier turn — it should still know).
- [ ] `/bogus` → red `Unknown command: /bogus · try /help`, no crash.

### A5. Input ergonomics

- [ ] **Multi-line** — enter a newline within the composer (per the composer's multiline binding) and
  submit a two-line prompt; it arrives intact and the turn completes.
- [ ] **Paste** — paste a multi-line block; it lands as one input without firing a turn per line.
- [ ] **Esc interrupts a running turn** — start a long turn (`Count slowly from 1 to 50.`) then press
  `Esc` → the turn is interrupted and the REPL returns to ready.

### A6. Launch flags

Quit (`Ctrl-C`) and relaunch with each flag; confirm it takes at launch:

- [ ] `--model claude-haiku-4-5-20251001` → status bar opens on that model.
- [ ] `--permission-mode acceptEdits` → opens in `acceptEdits`. An unknown value prints a stderr
  notice and falls back to `default`.
- [ ] `--think high` → status bar opens showing `think:high` from the first turn.
- [ ] `--cwd /tmp/ccqa` → file ops resolve against that dir (already used above).

---

## B. `cc-harness-console` — the daemon dashboard

The console is a **client**; it needs a running daemon. Use **two terminals** (both keyed via the
`set -a; . ./.env; set +a` line).

**Terminal 1 — start the daemon:**
```bash
node harness/dist/cli.js daemon       # prints: cc-harness daemon listening at <socket>
```

**Terminal 2 — launch the console:**
```bash
node tui/dist/cli.js                   # connects to the default daemon socket automatically
```
> No-build alt: `cd tui && npm run cli`.

- [ ] **Console renders + daemon is up** — you see a **Pool** (left), a **Detail** pane (right), and a
  status bar reading `daemon up`. The pool is empty at first.
- [ ] **`n` spawns a session** — press `n` → a session appears in the pool; status shows `spawned …`.
  Spawn a second so navigation is testable.
- [ ] **`j` / `k` (or ↓ / ↑) navigate** — the selection highlight moves; the Detail pane follows.
- [ ] **`Enter` focuses the input; `Esc` returns to the list** — press `Enter`, type a tiny prompt,
  submit → it streams into the Detail pane; `Esc` returns focus to the pool.
- [ ] **`m` cycles model** — status shows `model=…` cycling through the session's supported models.
- [ ] **`p` cycles permission mode** — cycles `default → acceptEdits → bypassPermissions → plan →
  dontAsk → auto`; on `auto` it issues a `set_model` to a supported model first (the same self-heal as
  the REPL).
- [ ] **`t` cycles thinking budget** — status shows `thinking=off → low → medium → …` (issues the
  `set_thinking` control op).
- [ ] **`/` compacts** the selected session → status `compact`.
- [ ] **`f` forks** the selected session → status `forked → <new id>`; a new row appears.
- [ ] **`i` interrupts** a running turn on the selected session.
- [ ] **`P` toggles proactive** — starts/stops the proactive loop; status reflects the state.
- [ ] **`x` stops a session** — opens a confirm dialog; confirm → the row disappears.
- [ ] **Attached permission dialog** — submit a prompt to a session in `default` mode that triggers a
  tool → a **PermissionDialog** appears in the console; allow/deny routes the decision back to that
  session.
- [ ] **`q` / `Ctrl-C` quits** the console cleanly (the daemon keeps running).

**Daemon CLI cross-check** (terminal 3, keyed):
- [ ] `node harness/dist/cli.js ps` → lists the live sessions (id, status, model) the console shows.
- [ ] `node harness/dist/cli.js top --once` → one-shot snapshot of the pool.
- [ ] **Shut the daemon down** — `node harness/dist/cli.js daemon stop` → terminal 1 exits; the
  console status flips to `daemon down`.

---

## C. Resume & replay (the deep section)

**How it works (so you know what "correct" looks like):**

- The SDK persists every chat transcript to **`~/.claude/projects/<project-slug>/`**, **scoped by the
  working directory** (`cwd`). Resume reads from there via `listSessions({dir: cwd})` /
  `getSessionMessages(id, {dir: cwd})`.
- **Therefore resume is cwd-scoped.** You can only see/continue sessions that were created in the
  **same `--cwd`**. Launch from a different dir and the picker is empty and `--continue` says "No
  sessions to continue here." This is the #1 gotcha — test it on purpose (C4).
- `resumeInto(id)` **fetches the transcript first, then swaps**: if history exists it swaps to the
  resumed session and re-renders the prior transcript via `replayLines`; if the fetch is empty or
  throws, it **does not swap** — it prints a warning and you stay where you are. (No dropping into a
  broken resume.)
- `replayLines` caps to the **last 200 messages** with an elision marker, indents nested
  (subagent) messages, and frames the block with a `resumed: <label> · N turns · <time>` header and a
  `resumed here · live` divider. `tool_result` blocks are skipped (only prompts + replies render).

### C0. Seed a session to resume

```bash
mkdir -p /tmp/ccqa-resume
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
In that REPL, run **3 distinct turns** so the transcript is recognizable, e.g.:
- `My favorite number is 42. Remember it.` ↵
- `Name three primes.` ↵
- `What was my favorite number?` ↵  (it should answer 42)

Then quit with `Ctrl-C`.

- [ ] **It persisted** — confirm a transcript file now exists for this project:
  ```bash
  ls -t ~/.claude/projects/*/  | head        # newest jsonl is your session
  ```

### C1. `/continue` (most-recent, same session)

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
- [ ] Type `/continue` ↵ → the prior 3 turns **replay** into the transcript, headed by
  `resumed: … · 3 turns · …` and followed by a `resumed here · live` divider.
- [ ] **Context truly carried** — type `What was my favorite number?` ↵ → it answers **42** (proving
  the SDK session context resumed, not just the on-screen text).

### C2. `--continue` / `-c` at launch

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume --continue
```
- [ ] The most-recent session **auto-replays on mount** (no `/continue` needed). Header + divider
  present. `-c` is an accepted alias — verify it behaves identically.

### C3. `/resume` picker + `--resume <id>`

```bash
node tui/dist/chat.js --cwd /tmp/ccqa-resume
```
- [ ] Type `/resume` ↵ → a **SessionPicker** lists prior sessions (most-recent first). Pick one →
  it replays exactly as `/continue` did.
- [ ] **Cancel works** — reopen `/resume`, cancel → returns to the composer, no swap, current session
  intact.
- [ ] **Grab an id from the picker** (the rows show session ids), quit, then relaunch targeting it:
  ```bash
  node tui/dist/chat.js --cwd /tmp/ccqa-resume --resume <paste-id>
  ```
  → that **specific** session replays on mount.

### C4. The cwd-scoping gotcha (negative test)

```bash
node tui/dist/chat.js --cwd /tmp/ccqa          # a DIFFERENT dir than the seeded one
```
- [ ] `/resume` → picker is **empty** (no sessions for this project).
- [ ] `/continue` → prints a dim **"No sessions to continue here"**, and you stay in the current
  fresh session (no crash, no swap).

### C5. Broken / empty resume (negative test)

- [ ] `node tui/dist/chat.js --cwd /tmp/ccqa-resume --resume not-a-real-id` → on mount it prints
  `⚠ couldn't resume not-a-r… — no history found` and **stays in a working fresh session** (the
  fetch-first-then-swap guarantee — it must not drop you into a dead session).

### C6. Replay fidelity spot-checks

- [ ] **Long transcript elision** — resume a session with many turns (or lower expectations: just
  confirm the mechanism) → if it exceeds 200 messages, an elision marker shows and only the tail
  renders.
- [ ] **Edit/Write diffs render** — if the resumed session contained an `Edit`/`Write`, the replayed
  lines show the diff body (shared with live rendering), not raw tool JSON.
- [ ] **`/clear` then resume** — `/clear` wipes the screen; a subsequent `/resume` still replays the
  picked session's full transcript (clear is screen-only, not a context wipe).

---

## D. Optional — headless lib sanity (one-shot)

Confirms the backend the TUIs sit on still answers outside the UI:

```bash
node harness/dist/cli.js "Reply with exactly: OK"        # one-shot, bypass mode, streams to stdout
echo "test stdin" | node harness/dist/cli.js "Summarize stdin in 3 words"
```
- [ ] One-shot prompt streams a reply and exits 0.
- [ ] Piped stdin is composed into the prompt.

---

## E. Complementary automated layer (reference)

This manual pass validates *feel* and the TTY-only behaviors (paste, raw-mode, launch flags). The
repeatable regression net is the **gated live suite** — run it keyed when you want machine-checked
proof the levers still work against the real API:

```bash
set -a; . ./.env; set +a
cd tui && npm run test:live        # tui live e2e (chat, console, auto-mode, thinking, resume-replay)
cd ../harness && npm run test:live # harness live e2e (daemon, sessions, hooks, compaction, …)
```
Without a key these suites **skip cleanly** (they gate on `ANTHROPIC_API_KEY`). Note: these drive the
lib backend, not the rendered UI — that UI↔model seam is exactly what *this* manual checklist covers.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Cannot find module 'cc-harness'` on tui build | Build `harness/` **before** `tui/` (§0 order). |
| First turn errors on auth | Key not loaded in this shell — re-run `set -a; . ./.env; set +a`. |
| `/resume` empty though you have sessions | Wrong `--cwd` — resume is cwd-scoped (§C4). Launch from the original dir. |
| Console shows `daemon down` | No daemon running — start `node harness/dist/cli.js daemon` first. |
| `auto` mode never runs ungated for safe ops | Model isn't auto-capable and the self-heal didn't fire — check the status-bar `model` actually changed when you entered `auto`. |
| Garbled rendering | Terminal too narrow, or not a real TTY (don't pipe the bins). Use a full terminal window. |

## Cleanup

```bash
node harness/dist/cli.js daemon stop 2>/dev/null   # if a daemon is still up
rm -rf /tmp/ccqa /tmp/ccqa-resume
# Persisted transcripts under ~/.claude/projects/ are harmless to leave; remove the test project
# slugs by hand if you want a clean slate.
```
