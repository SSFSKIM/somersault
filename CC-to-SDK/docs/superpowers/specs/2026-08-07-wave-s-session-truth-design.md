# Wave S · Session truth — design

> **Living document.** `## Decision Log`, `## Open questions`, `## Surprises & Discoveries`,
> `## Outcomes & Retrospective` and `## Revision Notes` stay current through execution. Acceptance is
> observable behavior only.
>
> Parent: `2026-08-06-qa-sprint-waves-design.md` § "Stream S" (re-cut 2026-08-07 against this wave's
> grounding round) and §12 items 20+. Sibling waves: T (shipped), R (shipped), C (not started).

## Purpose

**What is on screen must be what the model has.** Wave S is the honesty wave: every finding in it is a
place where `ccx` tells the user something about their session that is not true — a transcript that
replays turns the model no longer holds, a session that reports "no session yet" after four completed
turns, a context percentage left over from before `/clear`, a token count off by orders of magnitude, a
session id printed by the product that the product's own `--resume` will not accept.

The grounding round changed the wave's centre of gravity. The P0 as filed — "rewind replays the trimmed
transcript" — reproduces, but its cause is not what anyone wrote down: **the rewind is correct, and the
persisted session is a tree.** Three separate proposed fixes (the parent spec's `[DECIDED-AUTO]`, the
grounding worker's cheaper alternative, and the original QA diagnosis) all assumed a list. That
correction is the wave's spine; the rest is a set of small, well-bounded truth repairs.

## Acceptance (the wave gate)

Measured in the isolated-HOME tmux harness (`docs/parity/qa-driver.md`) unless a criterion is
unit-observable. `[BEHAVIOR]` throughout — what a reviewer sees, not what the code contains.

**Instrument rule, binding on every criterion (W-S10, and it cost four runs to learn).** A TUI repro
asserts on **dialog-scoped needles** and **verifies state after every keystroke**. Needles must carry the
dialog's own border (`│ ❯ …`) — the transcript renders submitted prompts with the same `❯` glyph a picker
uses for its cursor. Never wait on copy that also appears in the permanent footer. A repro that succeeds
on its first try gets the same scrutiny as one that fails.

1. **A1 (qa5-05/qa4-11, P0)** After restoring the conversation to the point before the second of three
   prompts, the replayed transcript shows **only the first turn**. Verified against the model itself: a
   follow-up asking what it was told to reply lists only the surviving word.
2. **A2** After **two** successive rewinds creating sibling branches, the replay shows the live branch
   only — no row from an abandoned branch appears.
3. **A3 (qa5-03, P0)** After any one completed turn, `/status` shows a session id and `/rename`,
   `/tag`, `/export`, `/files`, `/stats` and the Settings Stats tab all operate on it. None answers
   "no session yet".
4. **A4 (EP-S3 + §12 item 20)** The rewind confirm panel offers upstream's option set in upstream's
   order, gated as upstream gates it; **and rewinding to the session's first message offers a
   conversation restore** rather than only `Never mind`.
5. **A5 (qa2-10b)** At 60×15 with 14 models, `/model`'s overflow counter reports the number of rows
   actually hidden by the rendered window, and an above-indicator appears when the window has scrolled.
6. **A6 (EP-S4, unfiled)** Settings and Permissions clip at small geometries with upstream's
   `↑ N more above` / `↓ N more below` indicators, and their paging keys move the selection.
7. **A7 (qa5-10)** `/cost` after a cache-heavy turn reports cache-read and cache-creation tokens, and
   the API-duration and lines-changed rows, matching the SDK's own usage totals.
8. **A8 (qa5-02)** Immediately after `/clear`, the status bar shows no stale context percentage.
9. **A9 (qa5-14)** A session id **as `ccx` itself prints it** — from the `/status` line or the
   detachable banner — passed to `--resume`, resumes that session; an id that resolves to nothing fails
   loudly instead of opening a fresh REPL.
10. **A10 (qa5-13)** `ccx --continue` reopens the most recent session for the current directory.
11. **A11 (qa4-08)** Cancelling `/resume` prints an outcome line, like every sibling dialog.
12. **A12 (qa4-06)** The `/resume` picker offers upstream's `Ctrl+A` and `Ctrl+W` widen controls with
    upstream's toggle copy, and they change the result set.
13. **A13 (qa5-07/qa5-08)** `/compact` enters a busy state while it runs and leaves it at the boundary;
    the in-progress row is **replaced** by the result row, not joined by it.
14. **A14 (qa4-04)** A qualifying `/model` switch shows upstream's confirm; accepting switches and does
    not re-prompt at the same output count; declining leaves the model **and the stored default**
    unchanged.

---

## EP-S1 · The transcript is a tree — P0, the wave's spine

### Current state, measured rather than argued

Controller-run keyed repro, isolated HOME, 2026-08-07 (parent §12 item 20). Three turns, restore to the
point before the second, no further input:

- **The rewind is correct at the data layer.** The next user row's `parentUuid` points at the assistant
  row of the *first* turn. The fork lands exactly where it should; the model's context is genuinely
  trimmed.
- **The persisted file is append-only and is never truncated.** 19 rows before the rewind → 20 once it
  settles → 24 after one follow-up turn, same file throughout.
- **The replay is flat.** `rebuildAfterRewind` (`useChat.ts:1288-1303`) hands `getSessionMessages`' row
  list to `replayDocument`, so all three turns render above a `⏪ rewound here · live` marker.
  **`parentUuid` appears nowhere in `src/`.**

### Work items

- **(new)** Branch resolution in `sessions/rows.ts`: given the persisted rows, return the path from the
  newest leaf back to the root by `parentUuid`. Phantom kinds keep their existing treatment.
- **(modify)** `rebuildAfterRewind` replays the branch, not the file. The retry loop's purpose changes
  from "wait for a rewrite that never comes" to "wait for the rows to exist at all".
- **(new)** Regression: a fixture with two sibling branches replays only the live one.

### Acceptance

A1, A2.

---

## EP-S2 · One session identity — P0

`runTask` emits no `state` event (`host/host.ts:255-301`), and `state` is the only thing that populates
the client's cached session id (`client/chatAdapter.ts:48`). Nine surfaces read that id and all nine are
wrong after a clean turn. **One emit beside the roster stamp at `host.ts:270`.**

`qa5-04` left this epic (`[MISREAD]`, parent spec). Its residue is an open question below.

**Acceptance:** A3.

---

## EP-S3 · Rewind confirm panel — P1

Upstream's six options in fixed order (L487069-487072), the three-way head gated on file checkpointing
**and** a dry-run diff reporting ≥1 changed file. Copy trap: `Restore code`'s explanatory line reads
`The conversation will be unchanged.` — the two lines are independent and trivially swapped.

Absorbs the unfiled first-anchor defect: no `prevUuid` ⇒ `defaultRestoreOption` computes
`conversation: false` ⇒ the panel offers only `1. Never mind`. Restoring to before the first message is
a legitimate operation (it yields an empty conversation) and must be offered.

**Acceptance:** A4.

---

## EP-S4 · Windowing where it is actually missing — P1

Two of five surfaces are already correct (rewind picker, session picker); `/model`'s clipping was fixed
by Wave R t5 and only its counter is wrong — it reads a fixed 10-row window instead of the rendered one,
while `Select` already publishes the real window through `onViewChange`. The epic's real body is
**Settings and Permissions**, which have no windowing at all, declare no size props, and whose rule
lists are unbounded.

**W-S3 governs the shape:** migrate both onto `Select` rather than hand-rolling handlers. Binding paging
keys onto an unwindowed list reproduces the "resolves but moves nothing" defect F2 exists to remove — and
the handlers do not exist either.

**Acceptance:** A5, A6.

---

## EP-S5 · Cost and context truth — P1

`/cost`: the dollar total is already right; the token line and per-model rows drop seven of `ModelUsage`'s
ten fields (`commands.ts:127`, `:134-148`). One type widening also recovers API duration and lines
changed, both already on the wire and both in upstream's output.

Context %: it goes **stale**, it does not reset — `ctxPct` is written only at turn-end and `/clear` never
touches it.

**Acceptance:** A7, A8.

---

## EP-S6 · Resume ergonomics — P1

Four bounded items and one that is not. `--continue` (the resolution logic already exists as
`doContinue`), the `Resume cancelled` line, `--resume` id resolution, and the `Ctrl+A`/`Ctrl+W` widen
controls (both have real backing in `sessions/reader.ts`; `Ctrl+B` has none and is recorded as a
divergence).

`--resume` carries a trap: **ccx prints two different 8-character ids** — `/status`'s is a UUID prefix,
the detachable banner's is a randomly minted fleet roster id. Both must resolve, and a miss must fail
loudly instead of silently opening a fresh REPL.

The slash-entries-in-preview half of `qa4-07` is **out of scope** (W-S7) — it is a persistence change.

**Acceptance:** A9, A10, A11, A12.

---

## EP-S7 · Compaction surfaces — P2

The lifecycle already reaches `useChat` and is deliberately dropped by `systemNoticeLines`
(`species.ts:597`); the busy state is a consumption change. The in-progress row is a permanent `append()`
that nothing removes.

**The premise correction that matters:** the SDK exposes no progress value. Upstream's bar is
`1 - e^(-seconds/90)` capped at 95%, 40 cells of `▰`/`▱` — an animation, not a measurement. Ported for
fidelity under W-S4, and labelled as such in the code.

**Acceptance:** A13.

---

## EP-S8 · Model-switch confirm — P2

Upstream's gate: session **output** tokens > 0, not already acked at that count, resolved model ids
differ, and the difference is not merely the `[1m]` suffix. Accepting stamps an ack; declining stamps
nothing.

**Ordering trap (W-S9):** the "set as default" prefs write happens inside the picker before `onPick`, so
a confirm gated at `pickModel` leaves the pref written after a decline.

**Acceptance:** A14.

---

## Decision Log

- **W-S1 [DECIDED, from measurement]** **EP-S1 replays the branch, by walking `parentUuid` from the
  newest leaf.** *Rejected:* the parent spec's `[DECIDED-AUTO]` "poll until the file's tail matches the
  rewind anchor" — the file is append-only and its tail never becomes the anchor, so the poll can only
  exhaust its window and then render the same stale frame three seconds later. *Rejected:* slicing the
  flat rows at `prevUuid` — correct for one rewind, wrong after two, because sibling branches interleave
  in file order and only the parent chain disambiguates. *Rejected:* a host-supplied post-rewind
  snapshot — it would work, but it adds a wire message to fix a defect that is purely client-side
  arithmetic over data the client already has.
- **W-S2 [DECIDED]** `qa5-04` leaves EP-S2 as a `[MISREAD]`; the anchors-after-compaction behaviour it
  actually exposed becomes an open question rather than riding on a one-line identity fix.
- **W-S3 [DECIDED]** Settings and Permissions **migrate onto `Select`** rather than gaining hand-rolled
  paging handlers. *Rejected:* four bindings plus four handlers — it leaves both lists unwindowed, so the
  keys would page a list that never clips.
- **W-S4 [DECIDED]** Port upstream's compaction bar **including its fake progress curve**, and say so in
  the code. *Rejected:* omitting the bar (the wave's goal is fidelity to the installed build, and the
  formula is transcribed and cheap). *Rejected:* driving a bar from `pre_tokens`/`post_tokens` — those
  arrive only at the boundary, i.e. when the bar would be finished.
- **W-S5 [DECIDED]** After `/clear` the context chip is **hidden until the first turn ends**, matching
  upstream. *Rejected:* refreshing it immediately — also honest, and one call, but it invents a surface
  upstream does not show, and this wave's whole thesis is that the screen should not claim more than it
  knows.
- **W-S6 [DECIDED]** `--resume` resolves **both** id forms ccx prints (UUID prefix via `listSessions`,
  roster short id via `lifecycle.ts`'s existing lookup) and **fails loudly** on no match. *Rejected:*
  accepting only full UUIDs (upstream's own rule) — upstream never prints a short id, and ours does; the
  divergence is ours to close, not the user's to work around.
- **W-S7 [DEFERRED, owner-facing]** Persisting client-side slash entries so they appear in the resume
  preview and count is **out of Wave S**. It touches replay, rewind anchors and `/export` together.
- **W-S8 [DECIDED]** Restoring to before the session's first message is a supported operation.
- **W-S9 [DECIDED]** The model-switch confirm gates **before** the prefs write, not after.
- **W-S10 [DECIDED, from an incident]** The repro-instrument rule in Acceptance above, earned from five
  instrument bugs in one script (§12 item 20), every one of which produced a confident wrong answer
  rather than an error.

## Open questions

| Item | Owner | Deadline |
|---|---|---|
| **ANCHORS-1** — after a `/compact`, the persisted transcript collapses to one continuation-summary row, so rewind anchors vanish. Upstream keeps rewind targets across compaction. Where should anchors come from — the persisted rows (today), or a separate durable anchor log? Design question, not a bug fix; `qa5-04`'s real residue | Owner, with a controller recommendation | Wave S close-out |
| **SLASH-PERSIST-1** (W-S7) — persist client-side slash entries into the session store? Buys upstream's resume preview and message count; touches replay, rewind anchors and `/export` | Owner | Wave C spec time |
| **CTRL-B-1** — upstream's `Ctrl+B` (all branches) widen control has no backing in `listSessions`. Build a branch filter, or record the divergence permanently? Controller recommends recording it | Owner (override only) | Wave S execution |

## Surprises & Discoveries

Seeded from the grounding round; parent §12 item 20 carries the full evidence.

1. **The wave's P0 was correct code with a lying display**, and three independent proposed fixes all
   assumed a list because nobody had looked at `parentUuid`. The word appears nowhere in `src/`.
2. **Five instrument bugs in one repro script**, each producing a confident wrong answer. The sharpest:
   the transcript renders prompts with the same `❯` glyph the picker uses for its cursor, so a needle
   matched scrollback and reported "cursor on ONE after 0 Ups" while it sat on `(current)`.
3. **An epic's acceptance was unmeetable before anyone wrote code.** EP-S7 asked for a progress
   percentage the SDK does not expose and upstream does not compute.
4. **Wave R shrank two Wave S epics without anyone noticing.** Its dialog-size threading fixed most of
   `qa2-10b` and made the rewind-picker windowing claim a misread — but it never reached Settings or
   Permissions, which turned out to be the epic's real body.
5. **The worst anchor drift of the sprint: ~90,000 lines.** EP-S7's cited progress-bar line holds an
   unrelated SDK-message translator.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **v1 (2026-08-07)** — authored after the three-worker grounding round and one controller-run keyed
  repro. Born landed: every decision above was settled by evidence before this document existed, and
  Stream S was re-cut in the parent spec first.

## Deferred (out of this wave)

- **SLASH-PERSIST-1** (W-S7) and **ANCHORS-1** — both above.
- **The `/resume` preview pane rendered through the real transcript renderer** — upstream's shape; ccx's
  fixed tail is a recorded deliberate design, and changing it is a priced feature, not a correction.
- **`Ctrl+B` (all branches)** pending CTRL-B-1.
- **Interruptible `/compact`** — `session.compact()` is a capped-timeout op over the UDS with no cancel
  path; a cancel is a wire change.
