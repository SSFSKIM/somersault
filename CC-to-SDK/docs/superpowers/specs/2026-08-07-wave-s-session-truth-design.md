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

The grounding round and the spec review together moved the P0 twice. As filed — "rewind replays the
trimmed transcript" — it reproduces, but its cause is not what anyone wrote down. **The rewind is
correct, the persisted file is a tree that only grows, and the SDK's reader already resolves that tree
for us.** What is actually broken is *timing*: at the moment `ccx` rebuilds, the row that moves the
branch does not exist yet, so the reader can only return the pre-rewind chain. The fix is a few lines in
one function, and the wave's spine is smaller than v1 of this document claimed. The rest is a set of
well-bounded truth repairs.

**One distinction is load-bearing everywhere below, and conflating it caused v1's error: the session
FILE and the reader's OUTPUT are different objects.** The file is append-only JSONL holding every branch
ever written. `getSessionMessages` returns a resolved *conversation chain* — leaf-selected, `parentUuid`
walked, compaction-relinked — with `parentUuid` stripped from the rows it hands back. Statements about
one are not statements about the other.

## Acceptance (the wave gate)

Measured in the isolated-HOME tmux harness (`docs/parity/qa-driver.md`) unless a criterion is
unit-observable. `[BEHAVIOR]` throughout — what a reviewer sees, not what the code contains.

**Instrument rule, binding on every criterion (W-S10, and it cost four runs to learn).** A TUI repro
asserts on **dialog-scoped needles** and **verifies state after every keystroke**. Needles must carry the
dialog's own border (`│ ❯ …`) — the transcript renders submitted prompts with the same `❯` glyph a picker
uses for its cursor. Never wait on copy that also appears in the permanent footer. A repro that succeeds
on its first try gets the same scrutiny as one that fails.

1. **A1 (qa5-05/qa4-11, P0)** After restoring the conversation to the point before the second of three
   prompts, the replayed transcript shows **only the first turn — with no further input**, i.e. at the
   moment the rebuild settles, not after a follow-up turn. Verified against the model itself.
2. **A2 (compaction safety)** A rewind performed on an already-compacted session replays the
   post-boundary conversation only and never resurrects a pre-boundary turn. *(Replaces the original
   A2 — "two sibling branches replay the live one" — which **already passes at HEAD**, because the SDK
   reader resolves branches before ccx sees a row. A criterion that cannot fail is not a gate; W-S1.)*
3. **A3 (qa5-03, P0)** After any one completed turn: `/status` **prints a session line** (today it
   omits the line entirely — `commands.ts:158` — so the observable is presence, not a needle); `/rename`
   and `/tag` report success rather than refusing; `/export` writes a file; `/files`, `/stats` and the
   Settings Stats tab render session-scoped content.
4. **A4 (EP-S3) — a GUARD, not a gate.** The rewind confirm panel offers the **four implementable
   options** in upstream's order and wording — `Restore code and conversation`, `Restore conversation`,
   `Restore code`, `Never mind` — with the three-way head gated as upstream gates it, and each explanatory
   line matching its own option. *(The two `Summarize` options are excluded and deferred: they need a
   ranged compaction the SDK does not expose, which `rewindModel.ts:197,216` already records as out of
   scope.)* **This already passes at HEAD** — F6 T10 transcribed the whole panel into
   `rewindModel.ts:186-245`, wired at `RewindPicker.tsx:263-281`. It is kept as a regression guard so a
   later refactor cannot silently drop the option set; it gates nothing, and the second criterion that
   turned out to be unfailable (see A2).
4b. **A4b (EP-S3b)** Restoring to the session's **first** message offers a conversation restore and
   yields an empty conversation. This is a host + engine-lifecycle change, not a panel change:
   `host/host.ts:621` refuses it outright, and `resumeSessionAt` takes a message UUID with no value
   meaning "before the first".
5. **A5 (qa2-10b)** At 60×15 with 14 models, `/model`'s overflow counter reports the number of rows
   actually hidden by the **rendered** window. **Deliberate divergence (W-S11):** upstream computes
   `… +N models` off a fixed 10-row cap (L440969) and its `/model` list has no scroll gutter at all, so
   ccx is deliberately the more truthful of the two. The `↑` indicator half **already passes**
   (`Select.tsx:277,283`) and is not a gate.
6. **A6 (EP-S4, unfiled)** Settings and Permissions clip at small geometries with `↑ N more above` /
   `↓ N more below` indicators, and their paging keys move the selection. **Also W-S11:** upstream's
   Settings has the counted indicators but binds no paging keys; upstream's Permissions has paging keys
   but no indicators and no `home`/`end`. ccx gives both surfaces both.
7. **A7 (qa5-10)** `/cost` after a cache-heavy turn reports cache-read and cache-creation tokens, and
   the API-duration and lines-changed rows, matching the SDK's own usage totals.
8. **A8 (qa5-02)** Immediately after `/clear` the status bar shows no context percentage, **and** a
   freshly measured one appears when the first post-clear turn ends. *(Both halves required: the chip is
   gated on `ctxPct != null` (`ChatStatusBar.tsx:41`), so the negative half alone passes on a build that
   never sets it — or whose status bar does not render at all.)*
9. **A9 (qa5-14)** A session id **as `ccx` itself prints it** — from the `/status` line or the
   detachable banner — passed to `--resume`, resumes that session; an id that resolves to nothing fails
   loudly instead of opening a fresh REPL.
10. **A10 (qa5-13)** `ccx --continue` reopens the most recent session for the current directory.
11. **A11 (qa4-08)** Cancelling `/resume` prints an outcome line, like every sibling dialog.
12. **A12 (qa4-06)** The `/resume` picker offers upstream's `Ctrl+A` and `Ctrl+W` widen controls with
    upstream's toggle copy, and they change the result set.
13. **A13 (qa5-07/qa5-08)** `/compact` enters a busy state while it runs and leaves it at the boundary;
    the in-progress affordance is **torn down** and the transcript is left carrying the result row only.
    *(Wording matters: upstream replaces nothing — spinner, hint and bar are ephemeral render state
    discarded at `compact_end`, while `Compacted …` is a separately persisted message. "Replaced" would
    send an implementer building a transient-row contract upstream does not have.)*
14. **A14 (qa4-04)** A qualifying `/model` switch shows upstream's confirm; accepting switches and does
    not re-prompt at the same output count; declining leaves the model **and the stored default**
    unchanged.

---

## EP-S1 · The rebuild reads too early — P0, the wave's spine

### Current state, measured rather than argued

Controller-run keyed repro, isolated HOME, 2026-08-07 (parent §12 item 20), then re-measured through the
real SDK reader against that same real session file:

- **The rewind is correct at the data layer.** The post-rewind user row's `parentUuid` points at the
  assistant row of the *first* turn. The fork lands exactly where it should.
- **The persisted FILE is append-only.** 19 rows before the rewind → 20 once it settles → 24 after one
  follow-up turn, same file throughout.
- **The reader already resolves the branch — verified on the real rewound session, not a fixture.**
  `getSessionMessages` returned **4 rows: the live branch only** (`ONE` prompt, `ONE` reply, then the
  post-rewind rows); `TWO` and `THREE` were correctly absent. `parentUuid` is **stripped** from the rows
  it returns (`type, uuid, session_id, message, parent_tool_use_id, parent_agent_id, timestamp`).
- **So the defect is timing.** At `rebuildAfterRewind`'s read the fork row does not exist yet — the
  20th row added at that moment is a `last-prompt` row, which is neither user nor assistant and
  therefore does not move the leaf. The reader has no choice but to return the pre-rewind chain. The
  fork row is written by the *next* turn (the measured 24).

### Work items

- **(modify)** `rebuildAfterRewind` (`useChat.ts:1275-1303`) derives the trimmed view itself instead of
  waiting for one: take the reader's already-branch-resolved rows and **truncate them at the anchor's
  `prevUuid`** (inclusive), which `resumeSessionAt` is guaranteed to keep. Race-free, and correct
  whether or not the file has moved on.
- **(modify)** The retry loop stops meaning "wait for a rewrite". It waits only for rows to exist.
- **(modify)** De-duplicate the double rebuild: `useChat.ts:638` runs `rebuildAfterRewind()` on **every**
  `rewound` broadcast including the confirming client's own, which already calls it at `:1329`.
  Harmless while the rebuild was a fire-and-forget read; not harmless once it gates on content.
- **(new)** Regression: a rewind on a **compacted** session (A2), and the no-follow-up-turn case (A1).

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

## EP-S3 · Rewind confirm panel — ALREADY BUILT, verified at plan time

Upstream's six options in fixed order (L487069-487072), the three-way head gated on file checkpointing
**and** a dry-run diff reporting ≥1 changed file. Copy trap: `Restore code`'s explanatory line reads
`The conversation will be unchanged.` — the two lines are independent and trivially swapped.

**Two of upstream's six options are excluded.** `Summarize from here` / `Summarize up to here` need a
ranged compaction the SDK does not expose (`session.compact()` takes no range), which `rewindModel.ts`
already records at `:197` and `:216`. The panel ships **four**; summarize is deferred.

**All of the above is already implemented**, and writing the plan is what found that: `rewindModel.ts`
carries the option set (`:186-209`), the gating (`:165-168`), the head's clause rule (`:183`) and both
explanation lines (`:216-245`), and `RewindPicker.tsx:263-281` wires them. F6 T10 built it. **So this epic
has no work items** — its acceptance becomes a regression guard (A4) and its one genuine residual, the
`prevUuid` gate on the conversation option, is EP-S3b's, because that gate is honest until the host can
serve the case behind it.

**Acceptance:** A4, as a guard.

## EP-S3b · Rewind to the first message — P1, split out at spec review

The unfiled defect from §12 item 20 is **not** a panel change and does not belong in EP-S3. `host.rewind`
refuses it before any UI is involved (`host/host.ts:621`: *"no conversation anchor before the first
prompt — code-only rewind is available"*), and the only trimming primitive underneath, `resumeSessionAt`,
takes a **message UUID** (`sdk.d.ts:1815`) with no value meaning "before the first". Restoring to an empty
conversation therefore needs a different primitive — most plausibly `clearSession()` — which is an engine
lifecycle decision, not an option-list one.

**It also owns the one line EP-S3 leaves behind.** `RewindPicker.tsx:263` computes
`conversation = anchor.prevUuid != null`, which is why the first message offers only `Never mind`. That
gate is *correct* while the host refuses the operation, so it moves in the same change as the host
capability and not before — removing either half alone produces a panel that lies or a host that is asked
for something it will reject.

**Acceptance:** A4b.

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

**This is two units of work and the plan must slice it accordingly (spec review).** The `/model` counter
is roughly one line — adopt `Select`'s `onViewChange`, which the rewind picker already consumes. The
migration is not: `SettingsDialog` is ~209 lines with embedded theme and output-style sub-views and a
`/`-search over rows; `PermissionsDialog` is ~340 lines, tabbed, with per-row activation and its own key
registration. Both carry existing snapshot coverage that will move.

**Also restored to scope (spec review):** the rewind picker's window-size constant. `rewindVisibleRows`
(`rewindModel.ts:53`) transcribes upstream's `max(2, floor((m-12)/g))` **without** upstream's
`m = ds() ? floor(f/2) : f` halving — which is why grounding measured 9 visible rows where upstream's own
frame at the same geometry shows 2.

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
**Its sibling is not, and v1 dropped it (spec review):** `qa4-07(ii)`, the preview's message count, is
separately fixable — the count is the raw row count while the pane drops tool-result-only rows, so the
number and the pane disagree in both directions, and the bundle hands over upstream's exact predicate
(`Pqs`/`$$_`/`B$_`, L369021-369043).

**A trap for A9 (spec review):** `RosterRow.sessionId` is optional (`fleet/roster.ts:9`) and is stamped
only once the engine's id materializes mid-turn, so a banner short id for a session that never completed
a turn resolves to nothing. That is a **third** outcome — neither "resumes" nor "wrong id" — and the
failure copy must distinguish it.

**Acceptance:** A9, A10, A11, A12, and the count half of A-preview (folded into A9's task, pinned by
unit test rather than a frame).

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

- **W-S1 [DECIDED, from measurement — INVERTED at spec review; v1 of this decision was wrong]**
  **EP-S1 truncates the reader's already-branch-resolved rows at the anchor's `prevUuid`.**
  *Rejected:* the parent spec's `[DECIDED-AUTO]` "poll until the file's tail matches the rewind anchor" —
  the file is append-only and its tail never becomes the anchor.
  *Rejected, and this was v1's choice:* walking `parentUuid` ourselves from the newest leaf. Three
  independent reasons, each sufficient. (a) **The SDK already does it** — verified on the real rewound
  session: `getSessionMessages` returned the live branch only. (b) **We cannot do it** — `parentUuid` is
  stripped from the returned rows, so implementing it means abandoning the SDK reader and hand-parsing
  JSONL, a new capability rather than a function in `rows.ts`. (c) **It would be strictly worse** — the
  reader carries compaction-specific relinking driven by `compactMetadata.preservedMessages`
  (`sdk.d.ts:2965`); a naive walker ignores it and replays pre-boundary turns the model no longer holds,
  which is the exact lie this wave exists to remove. That hazard is now criterion A2.
  *Rejected:* gating the poll on the fork row appearing — it appears only when the next turn is written,
  so the poll would exhaust its window and render the stale frame anyway.
  *Rejected:* a host-supplied post-rewind snapshot — it would work, but it adds a wire message to fix a
  defect that is client-side arithmetic over data the client already holds.
- **W-S2 [DECIDED]** `qa5-04` leaves EP-S2 as a `[MISREAD]`; the anchors-after-compaction behaviour it
  actually exposed becomes an open question rather than riding on a one-line identity fix.
- **W-S3 [DECIDED]** Settings and Permissions **migrate onto `Select`** rather than gaining hand-rolled
  paging handlers. *Rejected:* four bindings plus four handlers — it leaves both lists unwindowed, so the
  keys would page a list that never clips.
- **W-S4 [DECIDED]** Port upstream's compaction bar **including its fake progress curve**, and say so in
  the code: `min(95, round((1 - e^(-seconds/90)) * 100))` (`JCp`, L407448), held monotonic. The width is
  `min(40, columns - 2 - 6)` with the bar **suppressed below 8 cells**, glyphs `▰`/`▱` falling back to
  `█`/`░` on ink-bleed terminals (L408060) — 40 is a maximum, not a fixed count.
  *Rejected:* omitting the bar (the wave's goal is fidelity to the installed build, and the formula is
  transcribed and cheap). *Rejected:* driving a bar from `pre_tokens`/`post_tokens` — those arrive only
  at the boundary, i.e. when the bar would already be finished.
- **W-S5 [DECIDED; justification corrected at spec review]** After `/clear` the context chip is
  **hidden until the first turn ends**. *Rejected:* refreshing it immediately — also honest, one call,
  but it keeps a surface on screen that has nothing true to say yet.
  **The v1 rationale ("matching upstream") was wrong and is withdrawn:** upstream has no persistent
  context chip at all. Its indicator returns `null` unless the context level is not "ok" (L488912-922)
  and surfaces as a transient warning (`Context low (N% remaining) · Run /compact to compact & continue`,
  L489324). So ccx still shows a chip upstream never shows, both before and after this change. Keeping
  or dropping ccx's inline context percentage entirely is already parked for Wave C (parent §16); this
  decision only stops it lying in the meantime.
- **W-S6 [DECIDED]** `--resume` resolves **both** id forms ccx prints (UUID prefix via `listSessions`,
  roster short id via `lifecycle.ts`'s existing lookup) and **fails loudly** on no match. *Rejected:*
  accepting only full UUIDs (upstream's own rule) — upstream never prints a short id, and ours does; the
  divergence is ours to close, not the user's to work around.
- **W-S7 [DEFERRED, owner-facing]** Persisting client-side slash entries so they appear in the resume
  preview and count is **out of Wave S**. It touches replay, rewind anchors and `/export` together.
- **W-S8 [DECIDED]** Restoring to before the session's first message is a supported operation.
- **W-S9 [DECIDED]** The model-switch confirm gates **before** the prefs write, not after.
- **W-S11 [DECIDED]** Where upstream's own list affordances are inconsistent, ccx is **consistently
  more truthful, and the divergence is recorded rather than silently taken**: `/model`'s counter follows
  the rendered window (upstream uses a fixed 10-row cap and no gutter); Settings and Permissions both
  get indicators **and** paging keys (upstream gives Settings only the first and Permissions only the
  second). *Rejected:* transcribing upstream's inconsistency — three surfaces behaving three ways is a
  defect the clone would be importing, and W-S5's "do not invent surfaces" applies to inventing
  *information*, not to making an existing surface accurate.
- **W-S10 [DECIDED, from an incident]** The repro-instrument rule in Acceptance above, earned from five
  instrument bugs in one script (§12 item 20), every one of which produced a confident wrong answer
  rather than an error.

## Open questions

| Item | Owner | Deadline |
|---|---|---|
| ~~**ANCHORS-1**~~ — **CLOSED 2026-08-07 by measurement, no owner decision needed.** Probe 68e (`probes/probes/68e-anchors-after-compaction.ts`, run keyed): four pre-boundary anchors → **one** post-boundary anchor, zero survivors. The premise on file is **correct**, and the spec review's contrary fixture was wrong. **But it is not a defect** — see Surprise 7. No work follows from it | — | Closed |
| **SLASH-PERSIST-1** (W-S7) — persist client-side slash entries into the session store? Buys upstream's resume preview and message count; touches replay, rewind anchors and `/export` | Owner | Wave C spec time |
| **CTRL-B-1** — upstream's `Ctrl+B` (all branches) widen control has no backing in `listSessions`. Build a branch filter, or record the divergence permanently? Controller recommends recording it | Owner (override only) | Wave S execution |

## Surprises & Discoveries

Seeded from the grounding round; parent §12 item 20 carries the full evidence.

0. **The spec's own spine was wrong, and the spec review caught it before a line was planned.** v1 said
   the fix was to walk `parentUuid` ourselves. Verified on the real rewound session: the SDK reader
   already returns the live branch only, and strips `parentUuid` from what it hands back — so the
   proposed work item was simultaneously redundant, unimplementable where it was placed, and (through
   compaction relinking) actively harmful. **Four proposed fixes for this one defect have now been
   wrong**, each by a different party, and every one of them was refuted by running something rather
   than by reasoning harder. The surviving fix is the one the grounding worker proposed and v1 rejected.
1. **The wave's P0 was correct code with a lying display**, and every wrong fix shared one root error:
   conflating the append-only session FILE with the reader's resolved OUTPUT.
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
6. **A THIRD criterion turned out to be unfailable, and the plan is what found it.** A2 was caught by the
   spec review; A4 survived both the grounding round and that review and was still describing work that
   F6 T10 had already shipped — the whole confirm panel, option set, gating and explanation lines. Both
   times the cause was the same: an epic was written from what the *bundle* contains rather than from what
   *ccx* already contains, and the two were only compared when someone had to name the files to edit.
   Planning is the first pass that forces that comparison, which is an argument for planning against the
   code rather than against the spec's prose.
7. **ANCHORS-1 turned out to be the system telling the truth, and the wave's spine depends on it.**
   Measured live (probe 68e): a manual `/compact` takes a four-anchor session to **one** anchor, and not
   one of the four survives. `getSessionMessages` returns the compacted view — a `compact_summary` row,
   the preserved tail, and the post-boundary turns — so the pre-boundary prompts are not in the reader's
   output at all. **That is correct, not broken:** the model no longer holds those turns, so offering to
   rewind to one would be an offer to restore a conversation nobody has. `qa5-04`'s residue is therefore
   not a defect and nothing follows from it.
   **It is also the strongest evidence yet for W-S1's third reason.** A hand-rolled `parentUuid` walk over
   the raw JSONL would resurrect exactly these four discarded anchors and replay their turns — the precise
   lie this wave exists to remove — while the SDK reader, which relinks through
   `compact_metadata.preserved_messages`, does not. Criterion A2 is the guard for it.
   One runtime correction to `sdk.d.ts:2965` while we were there: `preserved_segment` has **not** been
   superseded in practice. The live boundary frame carries **both** keys, alongside `trigger`,
   `pre_tokens`, `post_tokens`, `cumulative_dropped_tokens` and `duration_ms` (a manual compaction of
   ~18k tokens took 11.9 s and dropped ~16.7k).

8. **The rewind panel's "forked" wording was never ours to fix, and the option-suppression was the real
   divergence** (controller, during Task 3's implementation; `cli.pretty.js` L487190-208). Task 3's
   implementer flagged what looked like a new inaccuracy: after teaching the host to clear, the panel
   offers **Restore conversation** on the session's first message and still prints *"The conversation will
   be forked."* — but that path empties the conversation rather than forking it. Reading the bundle
   inverted the finding. Upstream builds its option list as `Y(!!Re)` where `Re` is code-restorability
   alone, with **no anchor-shape gate anywhere**, and picks `defaultFocusValue: Re ? "both" :
   "conversation"` the same way; its explanation function `J4f` has exactly five arms (`summarize`,
   `summarize_up_to`, `both`/`conversation`, `code`/`nevermind`) and **no "emptied" arm to clone**. So
   upstream offers the option on the first message and prints "forked" for it too. What diverged was our
   own `prevUuid != null` gate, which suppressed an option upstream always offered — a divergence forced
   by `host.rewind`'s refusal, not chosen. Task 3 removes it. **Decision: keep the copy, invent nothing.**
   Adding a sixth arm upstream does not have would be the divergence, not the fix. This is the second time
   in this wave that a "defect we introduced" turned out to be a divergence we were *removing*; both were
   only visible by opening the bundle rather than reasoning about the diff.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **v1 (2026-08-07)** — authored after the three-worker grounding round and one controller-run keyed
  repro. Born landed: every decision above was settled by evidence before this document existed, and
  Stream S was re-cut in the parent spec first.
- **v2 (2026-08-07, spec review)** — the review returned "the plan cannot be written from this spec",
  and it was right. **W-S1 inverted** after the controller re-measured through the real SDK reader
  against the real rewound session: the reader already resolves the branch and strips `parentUuid`, so
  the defect is timing and the fix is the truncation v1 had rejected. EP-S1 rewritten and given the
  double-rebuild de-duplication. **EP-S3b and the EP-S4 migration split out** as separate units (one
  reaches the host and the engine lifecycle; the other is two dialogs, not one line). **A2 replaced** —
  the original already passed at HEAD and could not fail. **A3, A4, A5, A6, A8, A13 re-worded** to be
  observable and to record deliberate divergences (W-S11). **W-S5's justification withdrawn** — upstream
  has no persistent context chip at all, so "matching upstream" was never what the change achieved.
  **Three dropped items restored:** the double rebuild, the rewind window-size constant, and
  `qa4-07(ii)`'s message count. **ANCHORS-1 flagged as an unverified premise** to re-measure before it
  costs anything.
- **v3 (2026-08-07, plan authoring)** — writing the implementation plan is a hostile read of the spec, and
  it found one more thing the spec asserted without checking: **EP-S3 is already built.** The rewind
  confirm panel's option set, ordering, three-way gate, head clause and both explanation lines were all
  transcribed by F6 T10 into `rewindModel.ts` and wired in `RewindPicker.tsx`. EP-S3 is now marked as
  built with no work items, **A4 is re-cast as a regression guard** rather than a gate (the third
  criterion in this wave that could not fail), and the one residual — the `prevUuid` gate on the
  conversation option — moved into **EP-S3b**, which is where the host change that makes removing it
  honest already lives. Surprise 6 records what the pattern was.
  **ANCHORS-1 also closed** the same day, by running probe 68e keyed rather than by deciding: the premise
  on file is correct (four anchors → one across a manual compaction, zero survivors), the spec review's
  contrary fixture was wrong, and no work follows because the behaviour is honest. Surprise 7 carries the
  measurement and the runtime correction to `sdk.d.ts:2965` it turned up.

## Deferred (out of this wave)

- **SLASH-PERSIST-1** (W-S7) — above. *(ANCHORS-1 was deferred here in v2; it is now closed by
  measurement, with no work following from it — see Surprise 7.)*
- **The `/resume` preview pane rendered through the real transcript renderer** — upstream's shape; ccx's
  fixed tail is a recorded deliberate design, and changing it is a priced feature, not a correction.
- **`Ctrl+B` (all branches)** pending CTRL-B-1.
- **Interruptible `/compact`** — `session.compact()` is a capped-timeout op over the UDS with no cancel
  path; a cancel is a wire change.
- **FOLLOWER-CLEAR-1 — `/clear` in one client leaves every other attached client showing the whole old
  conversation.** Found while reviewing Task 8, as the `/clear` counterpart of the rewind follower question
  — which came out clean, because `host.rewind` broadcasts `rewound` and both arms of the client's rebuild
  reach the reset. `host.clearSession()` (`host/host.ts:456-461`) swaps the engine and **broadcasts
  nothing**, and the client's `state` handler (`tui/useChat.ts:670-673`) reads only idle and permission
  mode. So a second attached client keeps its transcript, its context percentage, and its `/status` line,
  all describing a conversation the engine has already discarded.
  **Deferred for three reasons, none of them that it is small.** It is strictly *larger* than the chip
  Task 8 fixed — the entire transcript diverges, not one number — so filing it under EP-S5b would
  understate it. It is pre-existing, not a regression from any Wave S change. And it is unfixable inside
  `useChat`: the repair is a new wire frame (`cleared`, or a `state` frame that carries the swap), which
  is a protocol change of the same shape Task 3 made for `rewound` and deserves its own task rather than
  a fix round. Task 3's `rewound`+`cleared` pair is the working precedent for whoever takes it.
- **NARROW-CHROME-1 — six geometries where no budget can help, because the fix is a copy decision.**
  After Task 6 clipped the row bodies *and* added a tab-dependent chrome-wrap allowance, `/permissions`
  still draws Ink's full-screen clear in six cells: at 60 columns a pane of 14 in all three cursor states
  (twelve clears per six cursor moves mid-list) and a pane of 15 on the Workspace tab; and at 70 and 80
  columns a pane of 14 on Workspace. Everything else is clean — the worst case the task was scoped around,
  mid-list with both counted indicators up, draws zero clears at every pane from 15 to 30 at all four
  widths, and at 14 for 70, 80 and 100.
  **`/settings` lands in the same place from the other direction, and the same call covers it.** After the
  row clip and the conditional warning term, its remaining clears are panes 12–13 at 60/70/80 columns and
  pane 12 at 100, and only while the Thinking-mode warning is on screen; everything from pane 14 up
  (13 at 100) is zero, and the warning-down walk is zero across all 76 swept cells. Identical cause —
  `Math.max(1, rows − 11 − wrap)` stops delivering below a pane of `12 + wrap` — and identical only-fix:
  clipping the warning, which at 60 columns reads *"Changing thinking mode mid-conversation will incre…"*.
  Both dialogs are therefore one decision, not two.
  **This is the window's floor, not a missing subtraction.** `Math.max(1, …)` stops buying anything once
  `rows − 13 − wrap` reaches zero, and a frame of one row plus two indicators is the shortest this dialog
  gets. A bigger constant cannot reach it. What does close it — measured live, all six cells go to zero —
  is `wrap="truncate"` on the intro and the footer. **That is a copy decision, not a geometry one:** at 60
  columns the footer loses *"· Esc to cancel"*, and the whole point of transcribing these literals was
  fidelity to the canonical build. It belongs with the chrome wave's other truncation and windowing calls
  (the content-sized dialogs that overflow on their own) so the same taste gets applied once, rather than
  being decided here for one dialog in isolation.
- **STREAM-OVERFLOW-1 — the live streaming region is unbounded, and it is a bigger instance of the very
  defect Task 4 spent four rounds closing.** Found by the `paneOwned` gate's reviewer while measuring
  something else, and named here rather than left in a review transcript because nothing in the codebase
  records it. `LiveTurn.snapshot()` (`tui/liveTurn.ts:100-104,:149-150`) flat-maps the **full** markdown
  render of the accumulated in-flight text with no window and no clip. Measured: eight long paragraphs
  streaming into a 40-row pane produce a **47-row dynamic frame** — with **no dialog open at all**. So
  `ChatApp` already trips Ink's `outputHeight >= rows` branch (`ink.js:121` → `clearTerminal +
  fullStaticOutput + output`) on **every delta** of any answer longer than the terminal: a full-screen
  wipe and whole-transcript re-dump, continuously, during ordinary use.
  **Three things make this a deferral rather than a defect to fix here.** It is entirely pre-existing —
  the `paneOwned` gate is a strict improvement on it, never a cause. It is out of Wave S's subject
  (session truth), and squarely in the chrome/geometry wave's. And the fix is not a constant or a gate but
  a windowed live region — the streamed text has to become scrollable or tail-clipped, which is a design
  question about what a user should see while a long answer arrives, not an arithmetic one.
  **What it costs us in the meantime, stated honestly:** Task 4's invariant test promises that `ChatApp`
  with the rewind picker open never renders a frame reaching the pane, and that promise holds only because
  the fixture has no streaming turn in it. The invariant is real for the geometry it covers and silent
  about this one. Whoever picks this up should widen that same matrix rather than write a new one.
