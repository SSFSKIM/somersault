# C5 — TUI closure: Esc-Esc rewind, the usage surface, and the polish tail

> Stage C5 of the clone roadmap (`docs/parity/clone-roadmap.md`), sequenced **before C6** by owner
> decision (2026-07-28): TUI closure is control-plane fidelity too, so it lands first; C6 (the
> doperpowers end-to-end acceptance) follows. Builds directly on Goal A (host+client spine) and
> Goal B (decision park) — every new control in this spec is a host op so it works identically in
> the foreground REPL and over `ccx attach`.

## Purpose

Close the `docs/parity/tui-ux.md` scorecard from **~83% to ~93–95%**, led by the single
highest-fidelity gap left: **Esc-Esc rewind** (U12) — the signature Claude Code interaction whose
engine shipped in Wave 1 and has never had a surface. Alongside it: the **plan-utilization surface**
(the F4 dividend — `/usage`, `/status`, a status-bar warning), the four MED scorecard rows, and the
cheap LOW polish tail.

**Explicitly out of scope** (recorded so "closure" has a boundary): vim mode + its indicator,
external editor (Ctrl-G/`$EDITOR`), image paste (🚫 non-terminal), the `›` user-echo glyph (kept as
an intentional divergence), and surfacing session-*fork* rewind (the lib capability stays lib-only —
Decision Log).

## Grounding

Every load-bearing premise is live-verified; the one new probe ran **before** this spec was written.

| Evidence | What it settled | Strength |
|---|---|---|
| **probe 68** (2026-07-28) Q1 + **probe 68b** F1 | `getSessionMessages` user-prompt rows carry uuids — but rows carry **no meta flags** (keys: `type/uuid/session_id/parent_tool_use_id/parent_agent_id/timestamp` only), and probe 68's naive filter admits **4 species of which only 1 is a real prompt**: compact-summary rows, `<command-name>` slash-command echoes, and `<local-command-stdout>` rows all pass. Anchor classification must be **content-shape-based** | direct |
| **probe 68c** T1 | The truncation rule, row-level: `resumeSessionAt(X)` **keeps X itself** and drops everything after it (X's assistant response onward). The model still obeys X's dangling instruction. So the picker's conversation anchor is the **row immediately before the selected prompt** (an assistant uuid — probe 37b's anchors), while the file anchor stays the selected prompt's uuid. This **overturns probe 68 Q3's "exclusive" reading**, which came from misleading model-recall evidence, and **root-causes 68 Q4's row count** (3 = exactly the surviving prompts) | direct — supersedes 68 Q3/Q4 |
| **probe 68b** (compaction) | `/compact` **rewrites the persisted transcript**: pre-compact prompt rows are gone, replaced by a continuation-summary user row. Rewind anchors reach back only to the **last compact boundary** | direct |
| **probe 68d** | `rewindFiles` works on 0.3.211 on a **held-open** query (dryRun `{canRewind:true, filesChanged: string[] (paths, not a count), insertions, deletions}`; real call reverted disk). With checkpointing **off**: dryRun **returns** `{canRewind:false, error:"File rewinding is not enabled."}` but the real call **throws** — the host op must guard, not just the UI | direct |
| **probes 68/68b/68c** (harness lesson) | Three probe shapes failed before one held the transport: `break`-ing the message loop closes the query; a string-prompt query closes at result; an **exhausted input generator** starts CLI shutdown. Control calls need a live streaming-input query — the product `Session`'s exact shape | direct (negative ×3) |
| **probes 37/37b** (Wave 1) | In-place rewind (`resume`+`resumeSessionAt`) is **destructive** — post-anchor turns unrecoverable, even a later anchor uuid dies; `forkSession: true` branches a new id and leaves the original intact | direct |
| `test/live/rewind.e2e.test.ts` (green on 0.3.211) | `rewindFiles(<user-prompt uuid>)` reverts a two-turn edit on disk; `dryRun` returns `{canRewind, filesChanged, insertions, deletions}` | direct |
| **probe 55** (F4) | `usage().rate_limits` populates **only under the interactive credential** (`~/.claude/.credentials.json`); under `CLAUDE_CODE_OAUTH_TOKEN` it is `null` with `rate_limits_available: false`. Payload: `five_hour`/`seven_day`/`seven_day_opus`/`seven_day_sonnet` windows (`utilization`, `resets_at`), `extra_usage`, `limits[]` | direct |
| Wave 3 (`coverage.md` §5) | The SDK **rejects** checkpointing combined with an external session store (we auto-disable it) — so code-restore can be legitimately unavailable at runtime | direct |
| Goal B final review (commit `b8212e4f82`) | Opening a replacement engine must carry the **live runtime mode**, not the launch config — `resumeSession` was fixed for exactly this; the rewind engine swap must reuse that path | branch review |

## Design

### 1. The rewind chain (U12 — the flagship)

Four layers, each following the pattern Goal A/B established for its tier.

**Contract (`session/chatSession.ts`).** A new optional mixin, structural like `DecisionFeed`/`BgTasks`:

```ts
export type RewindScope = "both" | "conversation" | "code";
export interface RewindAnchor {
  uuid: string;               // the selected user prompt — the FILE anchor (rewindFiles)
  prevUuid: string | null;    // the row immediately before it — the CONVERSATION anchor (resumeSessionAt,
                              // probe 68c's keep-through-anchor rule); null for the first prompt
  text: string; index: number;
}
export interface RewindDryRun { canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }
export interface RewindOps {
  rewindAnchors(): Promise<RewindAnchor[]>;          // classified user-prompt rows (see anchor classifier)
  rewindDryRun(uuid: string): Promise<RewindDryRun>; // rewindFiles dryRun on the file anchor; lazy, on selection
  rewind(anchor: RewindAnchor, scope: RewindScope): Promise<void>;
}
```

**Anchor classifier** (pure function, its own module, heavily tabled-tested): `getSessionMessages`
rows carry **no meta flags** (probe 68b), so a real prompt is identified by content shape —
`type === "user"`, has `uuid`, no `tool_result` block, and text **not** matching the non-prompt
species: `<command-name>…` slash echoes, `<local-command-stdout>`/`<local-command-caveat>` rows, and
compact continuation-summary rows. The classifier must agree with `replay.ts`'s existing row
rendering (one shared classification, so the picker and the transcript can't drift). Anchors reach
back only to the last compact boundary — compaction rewrote everything older (probe 68b) — and the
first listed prompt after a compact offers **code-only** restore when its `prevUuid` is the summary
row (conversation-anchoring onto a phantom row is exactly the untested semantics the classifier
exists to prevent). Likewise the session's very first prompt (`prevUuid: null`) offers code-only,
with a reason line.

**Host (`host/host.ts`).** Three new ops — `rewind_anchors`, `rewind_dryrun`, `rewind` — same NDJSON
request/response pattern as Goal B's `answer`. Execution order inside `rewind` (the live-transport
constraint): for `code`/`both`, call `session.rewind(anchor.uuid)` on the **live** engine first —
guarded by a dry-run check, because with checkpointing off the real call *throws* while dryRun
merely reports `canRewind: false` (probe 68d); the host converts that into a structured error before
touching anything. Then, for `conversation`/`both`, swap engines by reopening at
`{ resume: sessionId, resumeAt: anchor.prevUuid }` **at the current runtime mode** via the same path
`resumeSession` uses post-Goal-B (the `b8212e4f82` lesson). After the swap the host emits `state` so
every attached client refreshes. Rewind is rejected with a structured error while a turn is running
or a decision is parked — the client greys the affordance, but the host is the enforcer (attach
means multiple clients). **Live background tasks do not block a rewind, but they die with it**: the
engine swap terminates the old CLI process and its shells, so the host clears the roster (emits an
empty `background_tasks_changed` snapshot) and posts a `◼ background tasks ended by rewind` notice.
Rejecting instead would let a forgotten shell hold the flagship feature hostage; `code`-only rewind
swaps nothing and leaves tasks untouched.

**Client (`client/chatAdapter.ts`).** Pass-through ops, as with decisions/bg.

**REPL (`tui/`).** New `RewindPicker.tsx` + `useChat` wiring:

- **Esc-Esc on an idle composer** (and `/rewind`) opens the picker. While a turn runs, Esc stays
  interrupt — the affordance simply doesn't arm (host enforces too).
- Picker lists user prompts **newest-first** (from `rewindAnchors()` — always re-fetched on open,
  probe 68 Q4), rendered like `SessionPicker` rows: truncated prompt text + relative position.
- Selecting an anchor calls `rewindDryRun(uuid)` and shows CC's file-change summary
  (`filesChanged.length` files, `(+i −d)`, or `no file changes`), then the three restore choices:
  `1` **Restore conversation and code** · `2` **Restore conversation only** · `3` **Restore code
  only** · Esc backs out to the anchor list, Esc again closes.
- When checkpointing is off (external store, Wave 3) or `dryRun.canRewind` is false, the two
  code-touching rows render **disabled with a reason line** — present but grey, never silently
  missing.
- Confirm → `rewind(anchor, scope)` → on `conversation`/`both` the transcript rebuilds through the
  existing `resumeInto` machinery (`clearToken` remount + replay from `getSessionMessages`) with a
  `⏪ rewound` divider, and the **composer is pre-filled with the selected prompt's text** — the
  conversation anchor is the *predecessor* row (probe 68c), so the selected prompt has genuinely
  left the conversation and re-enters only when the user sends its edited form: CC's
  edit-and-resend loop. `code`-only shows a one-line notice and touches neither transcript nor
  composer.

### 2. The usage surface (F4)

- **`/usage`** (CC has one): renders the plan windows as bars — `five_hour`, `seven_day`, and the
  per-model splits when present — each `▓▓▓░░ 43% · resets 3:00 PM`, plus the `extra_usage` line
  when the account has one. Pure formatter module (`tui/usageFormat.ts`), data from the existing
  `session.usage()`.
- **`/status`** gains one usage line (highest-utilization window).
- **Status bar**: a warning chip only when any window crosses **80%** utilization (mirrors the ctx%
  escalation style U13 set) — no permanent gauge.
- **Degradation is honest**: when `rate_limits_available` is false (OAuth-token auth, probe 55),
  `/usage` prints `plan usage not available under this credential (see docs: setup-token vs login)`
  — never a silent absence.
- The live test for this surface runs **token-free** (spawned CLI falls back to the interactive
  credential). The `.env` convention for every other live test is unchanged.

### 3. MED rows

- **`?` shortcuts overlay**: `?` on an empty composer opens a real overlay (new
  `ShortcutsOverlay.tsx`) listing the keymap (readline keys, Tab ladder, Esc-Esc, Ctrl-B, `!`/`#`
  modes, popups); any key closes. The footer hint line stays.
- **Edit/Write diff fidelity**: the shared `toolDiffLines` gains a real hunk diff — common
  prefix/suffix rendered as up to 3 dim context lines with line numbers, changed lines as -/+.
  Numbering is **hunk-relative** (1-based within the snippet): `old_string`/`new_string` are the
  only data we have; the file is never read, so absolute file lines are not available — scored
  honestly in the rescore.
- **Bash/tool-row framing**: tool rows adopt CC's bullet form (`● Bash(<command>)`, `● Read(<path>)`)
  and **error** tool results render red with a `✗` prefix. The rev-2 `⎿ exit <code>` tail is
  dropped: tool_result blocks carry no reliable exit code (only `is_error`), and correlating
  result→tool across messages for a cosmetic tail isn't worth the state (planning finding).

### 4. LOW polish batch

Markdown tables (`markdown.ts` + a column-width renderer) · zero-dep syntax highlighter
(`tui/highlight.ts`: keywords/strings/comments/numbers for ts/js/py/sh/json, dim fallback otherwise
— Decision Log) · compact-boundary divider line on the compact system frame · `/copy` (last
assistant message → clipboard via injected `pbcopy`/`xclip` spawn, DI like U5's bash) · word
movement (Alt/Ctrl ←→ in `editor.ts`) · tool-use rows adopt CC's `●` glyph (replacing `⚙`).

### 5. Non-goals (beyond the scope line above)

No per-anchor checkpoint *browsing* (CC shows a flat prompt list; so do we), no undo-of-rewind
(destructive is the CC-faithful choice; the escape hatch is the lib's fork capability), no
`/rewind`-with-arguments grammar, no usage polling loop (fetch on command/turn-end only).

## Acceptance

Phrased as observable behavior; ① – ③ are scripted-pty drivers (the Goal B `ptyrun.py` rig), ④ is a
keyed live test, ⑤ is the standing keyless gate.

1. **Rewind e2e, foreground**: a session writes VERSION_ONE then edits to VERSION_TWO; Esc-Esc →
   picker shows both prompts newest-first; selecting the second shows a non-zero file-change
   summary; choosing **Restore conversation and code** reverts the file to VERSION_ONE on disk,
   rebuilds the transcript truncated above the divider, and pre-fills the composer with the
   selected prompt text; editing and sending it runs a normal turn.
2. **Rewind over attach**: the same flow against a `--detachable` host through `ccx attach`,
   including the host emitting `state` so the client's transcript rebuild happens on the attach
   side.
3. **Scope variants**: *conversation only* leaves VERSION_TWO on disk while the model no longer
   recalls it; *code only* reverts the disk while the transcript and composer are untouched.
4. **Usage surface**: token-free live run renders at least one utilization bar with a reset time in
   `/usage`; the same command under `CLAUDE_CODE_OAUTH_TOKEN` renders the honest-unavailable line.
   The token-free half additionally gates on `~/.claude/.credentials.json` existing on the runner
   (the env-var gate can't see it) — absent, it skips cleanly, never machine-dependent-red.
5. **Keyless gate**: typecheck, unit + tui suites, and build green; every new component carries
   keyless tests (picker flow incl. disabled code rows, usage formatter incl. degraded shape,
   overlay, highlighter, tables, word movement, diff numbering, bash framing, `/copy` DI).
6. **Docs**: `tui-ux.md` rescored row-by-row (target ~93–95%), `coverage.md` + `clone-roadmap.md`
   C5 marked, `harness/CLAUDE.md` module map updated.

## Decision Log

| Decision | Rejected alternative | Why |
|---|---|---|
| **One spec, one SDD plan, rewind-first** | (B) rewind spec + loose U-increments for polish; (C) polish-first | The rewind chain touches the same four layers as Goal B; one whole-branch review boundary catches the cross-layer seam that has produced the worst defect three stages running. Rewind carries the only unverified premises, so it goes first, not last. |
| **CC-faithful 3-way restore, destructive in-place** (owner choice) | Both-or-nothing simplification; fork-first non-destructive | The flagship item is *fidelity*; CC's picker offers the three scopes and rewinds in place. Fork survives as a lib-only capability. |
| **Esc-Esc idle-only; host enforces** | Client-side-only gating | Attach means multiple clients; a host-side reject is the only consistent gate (same reasoning as Goal B's decision park). |
| **Always re-fetch anchors post-rewind** | Patch the picker's local list | Probe 68 Q4's row count defied naive prediction (later root-caused by 68c); the transcript is the truth, our arithmetic is not. |
| **Content-shape anchor classifier shared with `replay.ts`** | Read the CLI's raw session jsonl (which does carry `isMeta`-style flags) | The raw jsonl is an unversioned private format — the F2-era lesson about depending on those; `getSessionMessages` is the supported surface, and one shared classifier keeps picker and transcript from drifting. |
| **Rewind proceeds despite live background tasks; roster cleared + notice** | Reject while tasks run | The engine swap inherently kills the old CLI's shells; rejecting would let a forgotten shell block the flagship interaction. Honest notice over silent orphaning (review finding #3). |
| **Code-only restore for phantom-`prevUuid` prompts** (first prompt, first-after-compact) | Conversation-anchor onto the summary/first row anyway | Probe 68b showed anchoring onto a phantom row has untested, inconsistent semantics; offering only the well-defined scope is honest degradation. |
| **Zero-dep hand-rolled highlighter** | `cli-highlight`/highlight.js | ~1MB dependency into a bundle-sensitive package (`cc-codex-appserver` esbuild-bundles the harness) for a LOW row; regex keywords/strings/comments cover the recognizable 90%. |
| **Token-free live test scoped to the usage surface** | Flip the global `.env` convention to no-token | Strictly-more-capability holds (F4), but the OAuth-token convention is load-bearing across 40+ live tests and one memory records an org-policy incident; scope the change to where it pays. |
| **`/usage` fetch-on-demand** | Poll `usage()` on an interval | A status surface does not justify a background request loop; turn-end + command is when the number can change meaningfully. |

## Surprises & Discoveries

- **Probe 68c overturned probe 68's headline conclusion.** 68's model-recall evidence read
  `resumeSessionAt` as *exclusive* of the anchor; 68c's row-level dump shows the opposite — the
  anchored prompt **survives** (dangling, still obeyed by the model) and only its response onward is
  dropped. The picker therefore anchors conversation-rewind on the *predecessor* row. Lesson: a
  probe that infers state from model recall is measuring the model, not the state — dump the rows.
- **Compaction rewrites the persisted transcript** (68b): pre-compact prompts are simply gone,
  replaced by a continuation-summary user row. Rewind's reach ends at the last compact boundary.
- **The review's filter warning was confirmed at 4-to-1**: of four rows probe 68's naive filter
  admitted as anchors in a row-diverse session, one was a real prompt. And `getSessionMessages`
  strips whatever meta flags the CLI keeps internally, so classification is content-shape or nothing.
- **`dryRun` and the real call disagree about failure** (68d): checkpointing off makes dryRun
  *return* `{canRewind:false, error}` while the real call *throws* — two different failure channels
  for one condition; the host op normalizes them.
- **`filesChanged` is a path array, not a count** (68d) — rev 1's `RewindDryRun` type was wrong.
- **It took four probe harness shapes to make a live control call**: `break` closes the query; a
  string-prompt query closes at result; an exhausted input generator starts shutdown; only a
  held-open streaming query works. Worth remembering for every future `Query`-control probe.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-07-28): initial spec, written after probe 68 ran (live-probe-first honored).
- rev 3 (2026-07-28, planning): Bash framing corrected — `⎿ exit <code>` tail dropped (no reliable
  exit code in tool_result; `is_error` is the signal), replaced by CC's `●` bullet rows + red `✗`
  error-result framing; Edit-diff numbering stated as hunk-relative (the file is never read). The
  `⚙`→`●` swap and the tool-row form merge into one T8 change.
- rev 2 (2026-07-28): pre-plan review (3 findings) resolved by probes 68b/68c/68d — anchor
  classifier + two-anchor rows (68c's keep-through-anchor rule **supersedes** rev 1's "exclusive"
  claim), `RewindDryRun` corrected (`filesChanged: string[]`, `error`), host guard for the
  throw-vs-return failure split, background-tasks-die-with-rewind decision, compact-boundary reach
  limit, and the acceptance-④ credentials-file skip gate.
