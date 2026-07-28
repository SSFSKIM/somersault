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
| **probe 68** (2026-07-28, this spec's probe) Q1 | `getSessionMessages` user-**prompt** rows carry uuids and are distinguishable from tool_result user rows (filter: `type === "user"`, no `tool_result` block) | direct |
| **probe 68** Q3 | `resume + resumeSessionAt(<user-prompt uuid>)` is accepted and is **EXCLUSIVE** — the anchored prompt itself is removed from the context (model recalls VERSION_ONE, not VERSION_TWO). Exactly CC's model: pick a prompt → conversation rewinds to *before* it → the prompt text goes to the composer | direct |
| **probe 68** Q4 | After in-place rewind the **persisted transcript is truncated under the same session id** — but the post-rewind row count didn't match naive prediction, so the picker must **always re-fetch anchors** after any rewind, never patch its local list | direct (with recorded wrinkle) |
| **probe 68** Q2 | `rewindFiles` **requires a live Query** — on a closed one-shot transport it throws `ProcessTransport is not ready for writing`. Constraint: the host must run file-restore on the *current* engine **before** any conversation-rewind engine swap | direct (negative) |
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
export interface RewindAnchor { uuid: string; text: string; index: number }
export interface RewindDryRun { canRewind: boolean; filesChanged: number; insertions: number; deletions: number }
export interface RewindOps {
  rewindAnchors(): Promise<RewindAnchor[]>;          // user-prompt rows from getSessionMessages (probe 68 Q1)
  rewindDryRun(uuid: string): Promise<RewindDryRun>; // rewindFiles dryRun; called lazily on selection
  rewind(uuid: string, scope: RewindScope): Promise<void>;
}
```

**Host (`host/host.ts`).** Three new ops — `rewind_anchors`, `rewind_dryrun`, `rewind` — same NDJSON
request/response pattern as Goal B's `answer`. Execution order inside `rewind` (probe 68 Q2's
constraint): for `code`/`both`, call `session.rewind(uuid)` on the **live** engine first; then, for
`conversation`/`both`, swap engines by reopening at `{ resume: sessionId, resumeAt: uuid }` **at the
current runtime mode** via the same path `resumeSession` uses post-Goal-B (the `b8212e4f82` lesson).
After the swap the host emits `state` so every attached client refreshes. Rewind is rejected with a
structured error while a turn is running or a decision is parked — the client greys the affordance,
but the host is the enforcer (attach means multiple clients).

**Client (`client/chatAdapter.ts`).** Pass-through ops, as with decisions/bg.

**REPL (`tui/`).** New `RewindPicker.tsx` + `useChat` wiring:

- **Esc-Esc on an idle composer** (and `/rewind`) opens the picker. While a turn runs, Esc stays
  interrupt — the affordance simply doesn't arm (host enforces too).
- Picker lists user prompts **newest-first** (from `rewindAnchors()` — always re-fetched on open,
  probe 68 Q4), rendered like `SessionPicker` rows: truncated prompt text + relative position.
- Selecting an anchor calls `rewindDryRun(uuid)` and shows CC's file-change summary
  (`N files changed (+i −d)` or `no file changes`), then the three restore choices:
  `1` **Restore conversation and code** · `2` **Restore conversation only** · `3` **Restore code
  only** · Esc backs out to the anchor list, Esc again closes.
- When checkpointing is off (external store, Wave 3) or `dryRun.canRewind` is false, the two
  code-touching rows render **disabled with a reason line** — present but grey, never silently
  missing.
- Confirm → `rewind(uuid, scope)` → on `conversation`/`both` the transcript rebuilds through the
  existing `resumeInto` machinery (`clearToken` remount + replay from `getSessionMessages`) with a
  `⏪ rewound` divider, and the **composer is pre-filled with the selected prompt's text** (the
  exclusive semantics of probe 68 Q3 make this exactly CC's edit-and-resend loop). `code`-only shows
  a one-line notice and touches neither transcript nor composer.

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
- **Edit/Write diff fidelity**: the shared `toolDiffLines` gains line numbers + up to 3 context
  lines (CC's format), flowing to transcript rendering and the permission dialog alike.
- **Bash result framing**: tool rows for Bash render `$ <command>` above the output preview and a
  dim `⎿ exit <code>` tail on non-zero exit.

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
| **Always re-fetch anchors post-rewind** | Patch the picker's local list | Probe 68 Q4's row count defied naive prediction; the transcript is the truth, our arithmetic is not. |
| **Zero-dep hand-rolled highlighter** | `cli-highlight`/highlight.js | ~1MB dependency into a bundle-sensitive package (`cc-codex-appserver` esbuild-bundles the harness) for a LOW row; regex keywords/strings/comments cover the recognizable 90%. |
| **Token-free live test scoped to the usage surface** | Flip the global `.env` convention to no-token | Strictly-more-capability holds (F4), but the OAuth-token convention is load-bearing across 40+ live tests and one memory records an org-policy incident; scope the change to where it pays. |
| **`/usage` fetch-on-demand** | Poll `usage()` on an interval | A status surface does not justify a background request loop; turn-end + command is when the number can change meaningfully. |

## Surprises & Discoveries

- **Probe 68 Q3 — `resumeSessionAt` is exclusive of the anchor**, on user-prompt uuids. This is
  the fact that makes CC's edit-and-resend loop implementable with zero adjustment arithmetic: the
  selected prompt leaves the conversation and reappears in the composer.
- **Probe 68 Q2 — `rewindFiles` needs the live transport**: a closed one-shot query throws
  `ProcessTransport is not ready for writing`. Ordering consequence baked into the host op: file
  restore on the current engine *before* the conversation swap.
- **Probe 68 Q4 — post-rewind transcript row count defied prediction** (expected 2 user-prompt
  rows, saw 3). Not fully root-caused; recorded as the reason the picker re-fetches instead of
  patching local state. If the plan's live test reproduces it, root-cause then.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-07-28): initial spec, written after probe 68 ran (live-probe-first honored).
