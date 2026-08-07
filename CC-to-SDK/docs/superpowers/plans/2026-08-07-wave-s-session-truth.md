# Wave S · Session truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or
> doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Stop `ccx` telling the user things about their session that are not true — a transcript that
replays turns the model no longer holds, a session that reports "no session yet" after four completed
turns, a context percentage left over from before `/clear`, a token count missing seven of ten fields, and
a session id the product's own `--resume` will not accept.

**Architecture:** Thirteen tasks over eight epics. The spine (Task 1) is a few lines of arithmetic in one
function plus one optional field on one wire event. The rest are bounded repairs to existing surfaces: one
event emit, one host capability, two dialog migrations onto the existing `Select` primitive, two formatter
widenings, two CLI entry points, and two transcribed upstream affordances. Nothing new is invented; where
`ccx` deliberately differs from the installed 2.1.220 build, the divergence is written into the code as a
comment, not smoothed over.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink 5.2.1, `vitest` +
`ink-testing-library`, the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). All commands run from
`CC-to-SDK/harness/`.

**Governing spec:** `CC-to-SDK/docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md` (v2+).
Acceptance criteria are referenced below as A1–A14; the spec is the source of truth for their wording.

---

## Global Constraints

Every task's requirements implicitly include this section. Copy it verbatim into every implementer and
reviewer dispatch.

1. **Never print, echo, log or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.** Live tests gate
   on either and read them from the gitignored `CC-to-SDK/.env`. Implementers stop at the clean keyless
   skip; **the controller runs every keyed cell.**
2. **No test, TTY run or QA script may read or write the real `~/.claude`.** Isolate with **both**
   `CCX_FLEET_ROOT` and `HOME` pointed at a temp dir under **literal `/tmp`** (macOS `$TMPDIR` breaks the
   UDS `sun_path` 104-byte limit).
3. **tmux teardown kills only sessions you created, by name (W-R8).** `tmux kill-server`,
   `kill-session -a` and every other all-sessions form are forbidden — one of them destroyed the owner's
   own sessions during Wave R.
4. **Never drive a GUI application** on this machine (W-R7).
5. **Repro-instrument rule (W-S10), binding on every acceptance cell.** A TUI repro asserts on
   **dialog-scoped needles** (carrying the dialog's own border, e.g. `│ ❯ `) and **verifies state after
   every keystroke**. The transcript renders submitted prompts with the same `❯` glyph a picker uses for
   its cursor, so a bare `❯ ` needle matches scrollback. Never wait on copy that also appears in the
   permanent footer. **A repro that succeeds on its first try gets the same scrutiny as one that fails** —
   five instrument bugs in one script each produced a confident wrong answer.
6. **The session FILE and the reader's OUTPUT are different objects.** The file is append-only JSONL
   holding every branch ever written. `getSessionMessages` returns a resolved conversation chain —
   leaf-selected, `parentUuid`-walked, compaction-relinked — and **strips `parentUuid` from the rows it
   returns**. Never write code that walks `parentUuid`; see Task 1.
7. **Code style:** dense hand-style, **no Prettier**, match the surrounding file. ESM import specifiers end
   in `.js`. Dependency injection via a `deps = { … }` default parameter, mirroring the existing pattern.
8. **TDD:** failing test → red → minimal implementation → green → `npm run typecheck`. Every new public
   export and every new behavior gets a test.
9. **Gates after every task:** `npm run typecheck`, then `npm run test:unit`, then `npm run test:tui`.
   Report the actual numbers. Do not run `npm run test:resize-matrix` (it needs tmux and is Wave R's).
10. **Commit to the current branch (`main`) without asking. No `Co-Authored-By` lines and no other
    attribution. Never push and never open a PR.**
11. **Subagents must not edit `CC-to-SDK/.doperpowers/sdd/progress.md`** — the controller appends to it.
12. **Verbatim upstream copy is verbatim**, including upstream's own typos. Where this plan gives a string
    in backticks with a bundle line reference (`L…`), reproduce it exactly.
13. **Record deliberate divergences in the code (W-S11)**, as a comment naming what upstream does and why
    ccx differs. A divergence that is not written down becomes a future "bug" someone re-fixes backwards.
14. **THE TEST SNIPPETS IN THIS PLAN ARE ILLUSTRATIVE OF THE ASSERTION, NOT OF THE FIXTURE.** This is the
    plan's known weak point and an independent review found it in nine tasks. Every snippet below states
    *what must be proven*; none of them is guaranteed to name a helper, fixture, variable or export that
    exists. **Before writing any test, open the test file the task names and use its own idiom, its own
    helpers and its own fixture names.** Where a snippet and the file disagree, **the file wins** — and
    say so in your report. Two repo-wide facts the snippets get wrong often enough to state once:
    - There is **no `renderHook` and no `result.current`** in this repo, and no `@testing-library/react`.
      `test/tui/` renders a wrapper component through `ink-testing-library` and asserts on `lastFrame()`.
    - There are **no snapshot files at all** (`find test -name "*.snap"` is empty). Any instruction below
      to "review the changed snapshots" is wrong. What actually breaks when a dialog's rows change is
      **plain frame-text assertions** — there are 22 of them matching `❯ <row label>` across
      `test/tui/keys-migration-dialogs.test.tsx` and `test/tui/chat.test.tsx`. Grep for them before you
      change a row body.
15. **A test that passes before your change proves nothing.** Run every new test against the unmodified
    code first and confirm it is RED for the reason you intend. If it is green, the test is wrong, not the
    code — fix the test, and if it cannot be made to fail, say so explicitly in your report rather than
    shipping it. Several snippets below are known-tautological (they fail today only via an import error);
    they are flagged where I know of them, but assume there are more.
    **Never verify a red gate with `vitest run <directory> -t "<name>"`.** If the filter matches nothing,
    vitest exits 0 and prints only skip counts — indistinguishable, at a glance, from a test that ran and
    failed. Always name the test FILE. Two commands in earlier drafts of this plan had exactly this bug.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `harness/src/tui/rewindRebuild.ts` | The pure arithmetic EP-S1 needs: cut the reader's resolved rows at the rewind anchor. No React, no I/O. |
| `harness/src/tui/select/overflow.ts` | The one spelling of `↑ N more above` / `↓ N more below` and the chrome-budget helpers three dialogs now share. |
| `harness/src/tui/compactionBar.ts` | Upstream's fake progress curve, bar geometry and glyph sets, pure. |
| `harness/src/tui/modelConfirmModel.ts` | The model-switch confirm's gate predicate and copy, pure. |
| `harness/src/tui/ModelSwitchConfirm.tsx` | The confirm dialog component. |

**Modified files** (each named in its task with the exact region)

`harness/src/tui/useChat.ts` · `harness/src/host/host.ts` · `harness/src/host/wire.ts` ·
`harness/src/tui/commands.ts` · `harness/src/tui/rewindModel.ts` · `harness/src/tui/modelPickerModel.ts` ·
`harness/src/tui/ModelPicker.tsx` · `harness/src/tui/SettingsDialog.tsx` ·
`harness/src/tui/PermissionsDialog.tsx` · `harness/src/tui/sessionPickerModel.ts` ·
`harness/src/tui/SessionPicker.tsx` · `harness/src/tui/ChatApp.tsx` · `harness/src/cli/args.ts` ·
`harness/src/cli/main.ts` · `harness/src/sessions/reader.ts` · `harness/src/index.ts`

---

## Task 1: EP-S1 — the rebuild reads too early (P0, the wave's spine)

**Why this is the shape it is.** Four proposed fixes for this defect have been wrong, and each was refuted
by running something rather than by reasoning harder. What is measured and settled:

- The rewind is **correct at the data layer** — the post-rewind row's `parentUuid` points at the assistant
  row of the turn before the anchor.
- The persisted file is **append-only** (19 → 20 → 24 rows across one rewind and one follow-up turn, same
  file throughout).
- `getSessionMessages` **already resolves the branch** — measured on the real rewound session, it returned
  the live branch only, and the discarded turns were correctly absent. It also **strips `parentUuid`**;
  the returned rows carry `type, uuid, session_id, message, parent_tool_use_id, parent_agent_id,
  timestamp`.
- So the defect is **timing**. At `rebuildAfterRewind`'s read the row that moves the leaf onto the new
  branch does not exist yet — the row appended at that instant is a `last-prompt` row, which is neither
  user nor assistant. The reader has no choice but to return the pre-rewind chain.

**Do not implement a `parentUuid` walk.** It is redundant (the SDK does it), unimplementable in `rows.ts`
(the field is stripped), and strictly worse (the reader carries compaction relinking driven by
`compactMetadata.preservedMessages`; a naive walker ignores it and replays pre-boundary turns the model no
longer holds — the exact lie this wave exists to remove).

**Files:**
- Create: `harness/src/tui/rewindRebuild.ts`
- Create: `harness/test/unit/rewind-rebuild.test.ts`
- Modify: `harness/src/host/wire.ts:30`
- Modify: `harness/src/host/host.ts:638` (inside `rewind`)
- Modify: `harness/src/tui/useChat.ts` — `rebuildAfterRewind` (≈1275–1303), the `rewound` event arm
  (≈638), `confirmRewind` (≈1314–1335)
- Test: `harness/test/tui/useChat-rewind.test.tsx` (existing), `harness/test/unit/host-rewind.test.ts`
  (existing)

**Interfaces:**
- Produces: `truncateAtAnchor<T extends { uuid?: unknown }>(rows: readonly T[], prevUuid?: string | null): T[]`
  from `src/tui/rewindRebuild.ts`.
- Produces: `HostEvent` variant `{ kind: "rewound"; sessionId?: string; prevUuid?: string }`.
- Consumes: `RewindAnchor { uuid: string; prevUuid: string | null; text: string; index: number; timestamp?: string }`
  from `src/session/chatSession.js:61`.

- [ ] **Step 1: Write the failing test for the pure cut**

Create `harness/test/unit/rewind-rebuild.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { truncateAtAnchor } from "../../src/tui/rewindRebuild.js";

const row = (uuid: string, type = "user") => ({ uuid, type, message: { content: uuid } });

describe("truncateAtAnchor", () => {
  it("cuts the reader's rows AFTER the anchor's prevUuid, inclusive", () => {
    const rows = [row("u1"), row("a1", "assistant"), row("u2"), row("a2", "assistant")];
    expect(truncateAtAnchor(rows, "a1").map((r) => r.uuid)).toEqual(["u1", "a1"]);
  });

  it("returns the rows unchanged when there is no anchor", () => {
    const rows = [row("u1"), row("a1", "assistant")];
    expect(truncateAtAnchor(rows, null).map((r) => r.uuid)).toEqual(["u1", "a1"]);
    expect(truncateAtAnchor(rows, undefined).map((r) => r.uuid)).toEqual(["u1", "a1"]);
  });

  // A2's hazard, stated as arithmetic: the cut can only ever REMOVE rows the reader returned. It has no
  // way to reach a row the reader dropped, which is what a hand-rolled parentUuid walk would do across a
  // compaction boundary.
  it("never returns a row the reader did not return", () => {
    const rows = [row("compact-summary"), row("u9"), row("a9", "assistant")];
    const out = truncateAtAnchor(rows, "pre-boundary-uuid-the-reader-dropped");
    expect(out.map((r) => r.uuid)).toEqual(["compact-summary", "u9", "a9"]);
    expect(out.every((r) => rows.includes(r))).toBe(true);
  });

  it("keeps a compaction summary row that precedes the anchor", () => {
    const rows = [row("compact-summary"), row("u9"), row("a9", "assistant"), row("u10")];
    expect(truncateAtAnchor(rows, "a9").map((r) => r.uuid)).toEqual(["compact-summary", "u9", "a9"]);
  });

  it("does not mutate its input", () => {
    const rows = [row("u1"), row("a1", "assistant"), row("u2")];
    truncateAtAnchor(rows, "a1");
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/rewind-rebuild.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tui/rewindRebuild.js"`.

- [ ] **Step 3: Write the module**

Create `harness/src/tui/rewindRebuild.ts`:

```ts
// tui/src/rewindRebuild.ts — the arithmetic EP-S1 needs. No React, no I/O.
//
// THE DISTINCTION THIS MODULE EXISTS FOR (Wave S, W-S1; conflating the two is what made three earlier
// fixes wrong). The persisted session FILE is append-only JSONL holding every branch ever written.
// `getSessionMessages` returns a RESOLVED conversation chain — leaf-selected, parentUuid-walked,
// compaction-relinked via compactMetadata.preservedMessages — and it STRIPS parentUuid from the rows it
// hands back (measured on a real rewound session, 2026-08-07: the returned keys are type, uuid,
// session_id, message, parent_tool_use_id, parent_agent_id, timestamp). So nothing here walks a parent
// chain: the SDK already did, better than we could, and the field is not even present to walk.
//
// WHY A CUT IS NEEDED AT ALL. `rebuildAfterRewind` runs the instant the engine swap settles, and at that
// moment the row that MOVES the leaf onto the new branch has not been written — the row appended then is
// a `last-prompt` row, which is neither user nor assistant and therefore moves no leaf. The reader is
// still resolving the PRE-rewind chain and returns the very turns the rewind discarded. The anchor's
// `prevUuid` is the exact uuid the host handed `resumeSessionAt`, so it is the last row the restored
// conversation keeps: cutting there is race-free and correct whether or not the file has moved on.

/** The reader's rows, cut after the row whose uuid is `prevUuid` (inclusive).
 *
 *  Two fallbacks, both returning the rows UNCHANGED, and both deliberately on the side of showing more
 *  rather than fewer — the side the pre-fix code was already on, and the only safe side when the input is
 *  ambiguous:
 *   · no `prevUuid` — a rewind we did not initiate whose anchor never reached us;
 *   · `prevUuid` not among `rows` — the reader has already resolved onto the POST-rewind branch, where
 *     the anchor's successors are the user's new turns and cutting would delete them.
 *  The second fallback is also what makes the compaction hazard unreachable: this function can only
 *  remove rows the reader returned, never reach one it dropped. */
export function truncateAtAnchor<T extends { uuid?: unknown }>(rows: readonly T[], prevUuid?: string | null): T[] {
  if (!prevUuid) return [...rows];
  const at = rows.findIndex((r) => r?.uuid === prevUuid);
  return at === -1 ? [...rows] : rows.slice(0, at + 1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/rewind-rebuild.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the wire field**

Add to `harness/test/unit/host-rewind.test.ts` (follow the file's existing harness for building a host and
capturing emitted events — read it first; do not invent a new fixture):

```ts
it("the rewound broadcast carries the anchor's prevUuid, so a FOLLOWER can cut its own rebuild", async () => {
  // Build the host exactly as the neighbouring tests in this file do, drive a conversation rewind whose
  // anchor has prevUuid "a1", and capture the events emitted to a follower.
  const rewound = events.find((e) => e.kind === "rewound");
  expect(rewound).toMatchObject({ prevUuid: "a1" });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run test/unit/host-rewind.test.ts -t "prevUuid"`
Expected: FAIL — the emitted event has no `prevUuid`.

- [ ] **Step 7: Add the field to the wire and the emit**

In `harness/src/host/wire.ts`, line 30:

```ts
  // `prevUuid` is the uuid the host handed `resumeSessionAt` — the last row the restored conversation
  // keeps. A follower needs it to cut its own rebuild at the same place the confirming client does
  // (EP-S1); without it a second attached client renders the pre-rewind chain. Optional because a host
  // built before this field existed emits none, and the client's fallback is "show the rows unchanged".
  | { kind: "rewound"; sessionId?: string; prevUuid?: string }
```

In `harness/src/host/host.ts`, the emit inside `rewind` (currently line 638):

```ts
        this.emit({ kind: "rewound", sessionId: this.session?.sessionId ?? sid, ...(anchor.prevUuid ? { prevUuid: anchor.prevUuid } : {}) });
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run test/unit/host-rewind.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing REPL test — the rebuild renders only the restored turns**

Add to `harness/test/tui/useChat-rewind.test.tsx` (read the file first; reuse its fake session and its
`getSessionMessages` injection point — do not build a second fixture shape):

```tsx
it("renders only the restored conversation when the reader still returns the pre-rewind chain (A1)", async () => {
  // The reader returns what it returns AT REBUILD TIME: the pre-rewind chain, because the fork row is
  // not written until the next turn. This is the measured condition, not a hypothetical.
  readerRows = [
    { uuid: "u1", type: "user",      message: { content: "ONE" } },
    { uuid: "a1", type: "assistant", message: { content: [{ type: "text", text: "one" }] } },
    { uuid: "u2", type: "user",      message: { content: "TWO" } },
    { uuid: "a2", type: "assistant", message: { content: [{ type: "text", text: "two" }] } },
  ];
  await result.current.confirmRewind({ uuid: "u2", prevUuid: "a1", text: "TWO", index: 2 }, "conversation");
  await waitFor(() => expect(rendered()).toContain("ONE"));
  expect(rendered()).not.toContain("TWO");
  expect(rendered()).not.toContain("two");
});

it("rebuilds ONCE when this client is the one that confirmed", async () => {
  // The host broadcasts `rewound` to every follower INCLUDING the confirming client, which already
  // rebuilds from confirmRewind's own await. Two rebuilds were harmless while the rebuild was a
  // fire-and-forget read; they are not harmless now that it truncates and sets composer prefill.
  await result.current.confirmRewind({ uuid: "u2", prevUuid: "a1", text: "TWO", index: 2 }, "conversation");
  expect(readerCalls).toBe(1);
});
```

- [ ] **Step 10: Run to verify both fail**

Run: `npx vitest run test/tui/useChat-rewind.test.tsx`
Expected: FAIL — the first because `TWO` is still rendered, the second because the reader was called
twice.

- [ ] **Step 11: Rewire `rebuildAfterRewind`**

In `harness/src/tui/useChat.ts`. Add the import beside the other `./` imports:

```ts
import { truncateAtAnchor } from "./rewindRebuild.js";
```

Add a ref beside the other refs in the hook body (near `disposed`/`ranInitial`):

```ts
  // Set for the whole window in which THIS client's own rewind is in flight, so the host's `rewound`
  // broadcast — which every follower receives, the confirming client included — does not trigger a
  // second rebuild on top of confirmRewind's own. A boolean, not the anchor uuid: nothing on the wire is
  // needed to answer "was this mine", and the window is bounded by the same try/finally that owns
  // `rewinding`.
  const selfRewind = useRef(false);
```

Replace the signature and body of `rebuildAfterRewind` (keep the existing doc comment's first paragraph,
replace the "Live-feedback fix" block's first bullet, and keep the second bullet about the 2J/3J wipe
verbatim — it is still true):

```ts
  async function rebuildAfterRewind(opts: { prevUuid?: string | null; prefill?: string } = {}) {
    // Two halves, both measured:
    //  · The READ RACES THE SWAP, and the race cannot be won by waiting. The engine swap mints a session
    //    id asynchronously and the new file's first flush lags the swap settling, so the poll below still
    //    earns its keep for "is there anything to read yet". But polling can never produce the TRIMMED
    //    view: the row that moves the reader's leaf onto the new branch is written by the NEXT turn, so
    //    a poll waiting for it would exhaust its window and render the stale frame anyway. The rows are
    //    cut here instead, at the anchor the host itself resumed at (rewindRebuild.ts).
    //  · Ink's app.clear() (replaceDocument's bridge) cannot erase rows already scrolled OUT of the
    //    viewport, so the pre-rewind conversation survived above and the rebuild below read as "nothing
    //    re-rendered". So rewind does the real wipe (2J/3J/H — screen AND scrollback), immediately before
    //    the fresh document mounts. It is now the ONLY caller of that wipe: W-R t7 moved `/clear` onto
    //    upstream's viewport-only inline arm, which keeps scrollback on purpose. A rewind cannot, because
    //    the turns it discards must not stay readable above the transcript that replaced them.
    const retry = deps.rewindReplayRetry ?? { attempts: 8, delayMs: 375 };   // ≈3s worst case; injectable so tests never sit it out
    let id = session.sessionId;
    let msgs: any[] = [];
    for (let attempt = 0; attempt < retry.attempts; attempt++) {
      if (attempt > 0) { await new Promise((r) => setTimeout(r, retry.delayMs)); if (disposed.current) return; }
      id = session.sessionId ?? id;
      if (!id) continue;
      try { msgs = await getSessionMessages(id); } catch { msgs = []; }
      if (msgs.length) break;                       // the poll waits for rows to EXIST — nothing more
    }
    if (disposed.current) return;
    const rows = truncateAtAnchor(msgs, opts.prevUuid);
    clearScreen();
    // A rewind is a deliberate session transition: the fresh document derives ONLY the restored persisted
    // messages. (Ctrl-O never uses this path.)
    if (rows.length) replaceDocument(replayDocument(rows, { id, label: "⏪ rewound", width: columnsFn() }));
    else { const fresh = new TranscriptDocument(); fresh.appendLocal({ kind: "rewind-divider", lines: [{ text: "⏪ rewound", dim: true }] }, "rewind:empty"); replaceDocument(fresh); }
    lastAssistant.current = lastAssistantText(rows);        // /copy follows what is on screen
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    if (opts.prefill !== undefined) setComposerPrefill({ text: opts.prefill, token: Date.now() });
  }
```

- [ ] **Step 12: Rewire the two call sites**

In the event effect (currently line 638):

```ts
      // ANOTHER client rewound: rebuild from disk, cut at the anchor the host resumed at (no prefill —
      // not our prompt). Our OWN rewind's broadcast is skipped: confirmRewind already awaits its own
      // rebuild, and running a second one on top of it re-reads disk and re-mints the composer prefill.
      else if (ev.kind === "rewound") { if (!selfRewind.current) void rebuildAfterRewind({ prevUuid: ev.prevUuid }); }
```

In `confirmRewind`, set and clear the guard around the whole operation, and pass the anchor through:

```ts
    setRewinding(true);
    selfRewind.current = true;
    void (async () => {
      try {
        await session.rewind(anchor, scope);
        if (disposed.current) return;
        if (scope === "code") { notice(`⏪ code restored to before "${anchor.text.slice(0, 40)}"`); return; }
        await rebuildAfterRewind({ prevUuid: anchor.prevUuid, prefill: anchor.text });
      } catch (e) { append([{ text: rewindFailureHeading(scope), color: role("error") }, { text: (e as Error).message, color: role("error") }]); }
      finally { selfRewind.current = false; if (!disposed.current) setRewinding(false); }
    })();
```

- [ ] **Step 13: Run to verify both pass**

Run: `npx vitest run test/tui/useChat-rewind.test.tsx`
Expected: PASS, including the two new tests.

- [ ] **Step 14: Add the standing guard against a `parentUuid` walk (A2)**

Add to `harness/test/unit/rewind-rebuild.test.ts`:

```ts
import { readFile } from "node:fs/promises";

// W-S1's hazard, encoded so it cannot come back. `getSessionMessages` strips `parentUuid` and performs
// compaction relinking through `compactMetadata.preservedMessages`; a hand-rolled walk over the returned
// rows would both fail (the field is absent) and, if someone re-parsed the raw JSONL to get it back,
// resurrect pre-boundary turns the model no longer holds. If this test fails, read W-S1 before "fixing"
// it — three earlier attempts at this defect went the other way.
it("no rewind-replay code reads parentUuid", async () => {
  for (const f of ["src/tui/rewindRebuild.ts", "src/tui/useChat.ts", "src/sessions/rows.ts"])
    expect(await readFile(new URL(`../../${f}`, import.meta.url), "utf8")).not.toMatch(/parentUuid/);
});
```

- [ ] **Step 15: Run it**

Run: `npx vitest run test/unit/rewind-rebuild.test.ts`
Expected: PASS, 6 tests. If `rows.ts` fails it, you have re-introduced the walk — do not relax the test.

- [ ] **Step 16: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`
Expected: all green; report the counts.

- [ ] **Step 17: Commit**

```bash
git add harness/src/tui/rewindRebuild.ts harness/src/tui/useChat.ts harness/src/host/wire.ts harness/src/host/host.ts harness/test/unit/rewind-rebuild.test.ts harness/test/unit/host-rewind.test.ts harness/test/tui/useChat-rewind.test.tsx
git commit -m "f5(waveS-t1): cut the post-rewind rebuild at the anchor — the SDK reader already resolves the branch, the bug was timing"
```

---

## Task 2: EP-S2 — one session identity (P0)

**Why, stated more precisely than the spec does.** `state` is the only thing that populates the client's
cached session id (`client/chatAdapter.ts:48`). Nine surfaces read that id: `/status` omits its session
line, `/rename` and `/tag` refuse with "no session yet — send a first prompt" (`useChat.ts:881,887,895`),
`/export` writes nothing, and `/files`, `/stats` and the Settings Stats tab render empty.

**`runTask` is not quite silent today, and the narrower claim is the true one (plan review).** `host.ts:526`
already emits `state` for any `system/status` frame carrying a `permissionMode`, so a turn that changes
permission mode already publishes the id by accident. **The defect is a clean turn with no mode change.**
Your test has to reproduce that, not merely "a turn happened".

**This task's original tests could not fail, and that is why it is written out at length here.** Both were
tautological — one of them, the `/status` formatter test, the plan itself conceded. `SessionHost.follow()`
delivers a `state` frame **synchronously at subscribe time** (`host.ts:488`) and `status()` (`:724`)
spreads `sessionId` whenever the session has one, while `host-follow.test.ts`'s fake session hardcodes
`sessionId: "sid-1"` at construction (`:56`). So "some state event carries a sessionId" is true before
`runTask` is ever called. That fixture's `submit` also only settles on an explicit `s.finish()` (`:57-62`),
so a bare `await host.runTask(...)` hangs.

**What the test must do instead.** Build a fake session whose `sessionId` starts **`undefined`** and
materializes only when the first message is dispatched — that is the real engine's behaviour (the id
arrives in the init frame mid-turn). Then:
- subscribe **after** construction and discard the synchronous subscribe-time frame, or assert on frames
  that arrive strictly after `runTask` begins;
- drive a turn that emits **no** `system/status` frame with a `permissionMode`, so `host.ts:526` cannot
  supply the emit for you;
- assert that a `state` frame carrying the now-materialized id reaches the follower **before the turn
  ends**, not merely at some point.

Run it against unmodified `host.ts` and confirm it is RED. If the existing fixture cannot express a
late-materializing id, **write a new one in this test file** — Global Constraint 14 supersedes the earlier
instruction to reuse it. If after honest effort no keyless test can distinguish fixed from broken, say so
in your report and record that A3 rests on Task 13's keyed live cell alone; do not ship a green test that
proves nothing.

**Files:**
- Modify: `harness/src/host/host.ts` — the `stamped` block inside `runTask` (≈line 268–271)
- Test: `harness/test/unit/host-follow.test.ts` (existing)

**Interfaces:**
- Consumes: `this.status(): HostStatus` and `this.emit(ev: HostEvent)`, both already private members of the
  host — the emit shape is `this.emit({ kind: "state", status: this.status() })`, used at nine other sites.
- Produces: no new export. The observable is one additional `state` event per turn.

- [ ] **Step 1: Write the failing test**

In `harness/test/unit/host-follow.test.ts`. The shape below is the ASSERTION, not the fixture — see the
paragraph above and Global Constraint 14:

```ts
it("publishes the engine's session id mid-turn, on a turn that changes no permission mode (EP-S2)", async () => {
  const s = lateIdSession();               // sessionId undefined until the first message is dispatched
  const host = makeHost(s);
  const after: any[] = [];
  const off = host.follow(() => {});       // the subscribe-time state frame is not evidence — discard it
  off();
  host.follow((e: any) => after.push(e));
  const turn = host.runTask("hello");
  s.deliver({ type: "system", subtype: "init", session_id: LATE_ID });   // no permissionMode anywhere
  await waitFor(() => expect(after.some((e) => e.kind === "state" && e.status.sessionId === LATE_ID)).toBe(true));
  s.finish();                              // this fixture's submit settles only here
  await turn;
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/host-follow.test.ts -t "mid-turn"`
Expected: FAIL — the follower sees no `state` frame carrying the id while the turn is open. **If it
passes, stop**: either your fixture's id is set at construction (the trap described above) or your turn
emitted a `permissionMode` frame and `host.ts:526` published it for you. Fix the fixture, not the code.

- [ ] **Step 3: Emit the state beside the roster stamp**

In `harness/src/host/host.ts`, inside `runTask`'s `onMessage`:

```ts
    let stamped = false;
    const onMessage = (m: unknown) => {
      // Stamp the roster AND tell every follower, in the same breath and for the same reason: this is the
      // instant the engine's id exists. The roster write was already here; the emit was not, and `state`
      // is the ONLY frame that populates the client adapter's cached session id
      // (client/chatAdapter.ts:48). Without it, nine surfaces — /status's session line, /rename, /tag,
      // /export, /files, /stats and the Settings Stats tab — reported "no session yet" after any number
      // of completed turns (EP-S2). Once, not per message: `stamped` already guards that.
      if (!stamped && this.session?.sessionId) { stamped = true; this.writeSessionId(); this.emit({ kind: "state", status: this.status() }); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/host-follow.test.ts`
Expected: PASS.

- [ ] **Step 5: Pin the `/status` line's presence — a GUARD, and it is tautological by construction**

This one passes before and after; it exists so nobody deletes the gate. **It is not evidence that Task 2
works** — Step 1 is. Add it to whichever file already imports `formatStatus` (grep first; it is **not**
`commands-aliases.test.ts`, which never imports it):

```ts
it("prints a session row once an id exists, and omits it before (A3)", () => {
  const withId = formatStatus({ mode: "default", thinkLevel: "default", sessionId: "0d7a7a9d-1111-2222-3333-444455556666" });
  expect(withId.some((l) => l.text.includes("session") && l.text.includes("0d7a7a9d"))).toBe(true);
  const withoutId = formatStatus({ mode: "default", thinkLevel: "default" });
  expect(withoutId.some((l) => l.text.includes("session"))).toBe(false);
});
```

Note: `commands.ts:159` is the gate (`if (s.sessionId)`); the spec cites `:158`, which is the `cwd` row.
No copy changes — the fix is that the id now exists.

- [ ] **Step 6: Run it**

Run: `npx vitest run test/tui/commands.test.ts -t "session row"`
Expected: PASS (this one passes before the host change too — it is a guard on the formatter, not the fix).
**Note the path:** `formatStatus` and `formatCost` are `commands.ts` formatters but their tests live under
`test/tui/`, not `test/unit/`. An earlier draft said `test/unit`, which matches nothing and prints a wall
of "skipped" that reads like a satisfied gate.

- [ ] **Step 7: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`

- [ ] **Step 8: Commit**

```bash
git add harness/src/host/host.ts harness/test/
git commit -m "f5(waveS-t2): publish the engine session id to followers when it materializes — nine surfaces stop reporting 'no session yet'"
```

---

## Task 3: EP-S3 verified + EP-S3b — restoring to the first message (P1)

**Read this before writing anything.** EP-S3 as the spec describes it — upstream's option set in upstream's
order and wording, the three-way head gated on a dry-run diff reporting ≥1 changed file, and the
per-option explanation lines — **is already implemented** in `src/tui/rewindModel.ts:186-245` and wired at
`src/tui/RewindPicker.tsx:263-281`. Your **Step 1 is to prove that, not to rebuild it.** If the guard test
passes on the current build, keep it as a guard and invent no fix (this is the same Step-2 rule Wave R's
Task 6 followed). If it fails, stop and report — that is a real finding.

The genuine defect is the one residual: `RewindPicker.tsx` computes `conversation = anchor.prevUuid != null`,
so a rewind to the session's **first** message offers only `Never mind`. That gate is honest today —
`host.rewind` refuses the operation at `host/host.ts:621` (*"no conversation anchor before the first
prompt — code-only rewind is available"*) because the only trimming primitive underneath,
`resumeSessionAt`, takes a **message UUID** (`sdk.d.ts:1815`) with no value meaning "before the first". So
this is a host and engine-lifecycle change, not an option-list one (W-S8).

**The primitive, located and checked before this plan shipped — do not re-derive it.** `clearSession()` is
**not** an SDK method; `sdk.d.ts` declares no such member, and the only rewind-adjacent option it declares
is `resumeSessionAt` (`:1815`). What exists is the **host's own** `HostSession.clearSession()` at
`host/host.ts:449`, and its body is exactly the right shape: `swapEngine({ resume: undefined, resumeAt:
undefined })` — a fresh conversation through the same swap seam `resume` and `rewind` already use, with an
explicit `resume: undefined` because `engineConfig` spreads the launch config first.

**But do not call `clearSession()` from inside `rewind()`.** It opens and closes `swapInFlight` itself
(`:451-453`), so nesting it inside `rewind`'s own `swapInFlight` window would have the inner `finally`
clear the flag while the outer operation is still running — reopening the busy gate mid-swap, which is the
exact window `rewind`'s field doc says must stay closed. Call `swapEngine({ resume: undefined, resumeAt:
undefined })` **directly**, mirroring the `swapEngine({ resume: sid, resumeAt: anchor.prevUuid })` call it
replaces. There is then no capability to feature-test and no BLOCKED path: `swapEngine` is always
available where `rewind` runs.

**And it mints a NEW session id — it does not empty the existing one.** The spec's phrasing ("an empty
conversation on this session") is wrong; the plan review caught it. Two consequences to handle rather than
discover:
- the `rewound` broadcast's `sessionId` will be the **new** id, which is what the client should read;
- but the client's cached id may not have flipped by the time it rebuilds, and Task 1's fallback for an
  absent `prevUuid` is *"render the reader's rows unchanged."* Together those re-render the entire
  conversation the user just discarded, off the OLD file — the retry loop breaks on the first non-empty
  read and the old file is non-empty. **So the cleared case carries an explicit signal, never the absence
  of one.** Add `cleared?: true` to the `rewound` wire variant (beside Task 1's `prevUuid`), emit it on
  this path, and have `rebuildAfterRewind` take the empty-document arm directly on it — no disk read, no
  poll, no cut. Step 7's poll-skip is then a second, weaker guard, not a substitute: it makes the empty
  outcome fast, and only the flag makes it correct.

**Two existing tests invert and the plan must not leave you to discover that mid-suite.**
`harness/test/tui/rewind-picker.test.tsx:315` is *"a null-prevUuid anchor cannot restore the conversation:
only the code option is offered, and it is focused"* — it asserts `not.toContain("Restore conversation")`
and `toContain("The conversation will be unchanged.")`. Both are correct **today** and both become wrong
under this task. Rewrite that test to assert the new truth (a conversation restore IS offered for a
null-prevUuid anchor) rather than deleting it; it is the only coverage of that anchor shape.

**THE `conversation` PREDICATE LIVES AT THREE SITES, NOT ONE — controller-verified before dispatch.** An
earlier draft of this task named only the render site, which would have shipped a panel whose pointer and
whose explanation line disagreed. All three compute `anchor.prevUuid != null` and all three must change:
- `RewindPicker.tsx:201` — `open()`, when a dry-run summary has ALREADY landed;
- `RewindPicker.tsx:211` — `open()`, when the out-of-band dry run resolves;
- `RewindPicker.tsx:263` — the render, which feeds BOTH `restoreOptions` (`:264`) and the `Select`'s own
  `defaultFocusValue` (`:282`).

Sites `:201`/`:211` set the `focusedOption` **state**, and that state is what `conversationExplanation`
reads at `:275`. Change `:263` alone and a first-message anchor with no code changes gets
`defaultRestoreOption({code:false, conversation:false})` → `"nevermind"` in state, so the panel prints
*"The conversation will be unchanged."* while the pointer sits on **Restore conversation**. The pure-function
guard in Step 1 would not catch it — it tests `conversationExplanation`, not the wiring.

**THE CONFIRMING CLIENT NEVER RECEIVES `cleared` — it must derive it.** `confirmRewind` sets
`selfRewind.current = true` precisely so the host's `rewound` broadcast does NOT drive a second rebuild
(Task 1), and then calls `rebuildAfterRewind({ prevUuid: anchor.prevUuid, prefill: anchor.text })` directly
at `useChat.ts:1345`. So the wire field added below reaches **followers only**. On the confirming client
`prevUuid` is `null`, `truncateAtAnchor` returns the rows unchanged (`null` is falsy — `rewindRebuild.ts:37`),
the old file is non-empty, and the discarded conversation renders. Pass the flag from the call site, where
both values are in hand:

```ts
        await rebuildAfterRewind({ prevUuid: anchor.prevUuid, prefill: anchor.text, cleared: scope !== "code" && !anchor.prevUuid });
```

and on the follower arm at `useChat.ts:648`, `{ prevUuid: ev.prevUuid, cleared: ev.cleared }`. The poll-skip
in Step 7 makes the empty outcome FAST; only this flag makes it CORRECT.

**Files:**
- Modify: `harness/src/host/host.ts` — `rewind` (≈611–650)
- Modify: `harness/src/host/wire.ts` — the `rewound` variant, adding `cleared?: true`
- Modify: `harness/src/tui/useChat.ts` — `rebuildAfterRewind`'s `cleared` arm and poll gate; both call
  sites (`:648` follower, `:1345` confirming client)
- Modify: `harness/src/tui/RewindPicker.tsx:201`, `:211`, `:263` (all three `conversation` predicates)
- Modify: `harness/src/tui/rewindModel.ts:195-214` (the doc comments describing the prevUuid gate)
- Test: `harness/test/tui/rewind-picker.test.tsx`, `harness/test/unit/host-rewind.test.ts`,
  `harness/test/tui/useChat-rewind.test.tsx`

**Interfaces:**
- Consumes: `truncateAtAnchor` (Task 1) — unchanged; a first-message restore passes `prevUuid: null`, so
  the cut is a no-op and the empty-document arm of `rebuildAfterRewind` renders.
- Consumes: `this.swapEngine({ resume: undefined, resumeAt: undefined })` — the host's own private swap
  seam, already called twice inside `rewind`'s sibling paths. **Not** `this.session.clearSession`, which
  does not exist, and **not** `this.clearSession()`, which would nest a second `swapInFlight` window
  inside `rewind`'s.

- [ ] **Step 1: Write the A4 guard test and expect it to PASS**

Add to `harness/test/tui/rewind-picker.test.tsx`:

```tsx
// A4, kept as a GUARD. This passed on the build that existed when Wave S was planned; it is here so a
// later refactor cannot quietly drop upstream's option set (L487069-072). Do not "fix" anything if it
// passes — that is the expected result.
it("offers the four implementable options in upstream's order and wording (A4)", async () => {
  // dry run reporting one changed file → the three-way head is on
  const frame = await openConfirmPanel({ dry: { canRewind: true, filesChanged: ["a.ts"], insertions: 1, deletions: 0 }, prevUuid: "a1" });
  const at = (s: string) => frame.indexOf(s);
  expect(at("Restore code and conversation")).toBeGreaterThan(-1);
  expect(at("Restore conversation")).toBeGreaterThan(at("Restore code and conversation"));
  expect(at("Restore code")).toBeGreaterThan(-1);
  expect(at("Never mind")).toBeGreaterThan(at("Restore conversation"));
});

it("drops the code options when the dry run names no changed file (A4)", async () => {
  const frame = await openConfirmPanel({ dry: { canRewind: true, filesChanged: [] }, prevUuid: "a1" });
  expect(frame).toContain("Restore conversation");
  expect(frame).not.toContain("Restore code and conversation");
});

it("pairs each option with its own explanatory line — the two are trivially swapped (A4)", () => {
  expect(conversationExplanation("code")).toBe("The conversation will be unchanged.");
  expect(conversationExplanation("conversation")).toBe("The conversation will be forked.");
  expect(conversationExplanation("both")).toBe("The conversation will be forked.");
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/tui/rewind-picker.test.tsx`
Expected: **PASS.** Record the result in your report. If any assertion fails, STOP and report — do not
implement around it.

- [ ] **Step 3: Write the failing test for the first-message restore (A4b)**

Add to `harness/test/unit/host-rewind.test.ts`. **This file's fixture is `makeHost(overrides, opts)`,
returning `{ host, session, calls, opened, getMessages }` — there is no `swapCalls`, no `swapEngineSpy`,
and the busy accessor is `host.busy()`, not `isBusy()`. `opened` is the array of configs handed to the
injected `openSession`, which is how every existing swap assertion in this file reads (see `:60`, `:128`).**

```ts
it("restores to the session's FIRST message by swapping to a fresh conversation (A4b)", async () => {
  // resumeSessionAt takes a message UUID and has no value meaning "before the first", so a fork is not
  // the primitive here — an empty conversation is. Both keys must be EXPLICITLY undefined: engineConfig
  // spreads the LAUNCH config first (host.ts:356), so a host born from `ccx --resume <sid>` still carries
  // `resume` — which is why the launch config below carries one. A bare `swapEngine({})` passes a weaker
  // version of this test and reopens the very conversation the user asked to drop.
  const { host, opened } = makeHost({}, { config: { resume: "launch-sid" } });
  await host.rewind({ uuid: "uB", prevUuid: null }, "conversation");
  expect(opened).toHaveLength(1);
  expect((opened[0] as any).resume).toBeUndefined();
  expect((opened[0] as any).resumeAt).toBeUndefined();
});

it("keeps the busy window closed across the whole first-message restore", async () => {
  // The reason this does NOT call the host's own clearSession(): that method opens and closes
  // swapInFlight itself (host.ts:447-449), so nesting it inside rewind's window would let the inner
  // finally reopen the busy gate mid-swap. Sampled from INSIDE the injected openSession — that is the
  // one moment the swap is genuinely in flight.
  const seen: boolean[] = [];
  const { host } = makeHost({}, {}, (h: any) => seen.push(h.busy()));   // however this file lets you hook openSession
  await host.rewind({ uuid: "uB", prevUuid: null }, "conversation");
  expect(seen).toEqual([true]);
});

it("broadcasts rewound with no prevUuid after a first-message restore", async () => {
  await host.rewind({ uuid: "u1", prevUuid: null }, "conversation");
  const ev = events.find((e: any) => e.kind === "rewound");
  expect(ev).toBeDefined();
  expect(ev.prevUuid).toBeUndefined();
});
```

Add to `harness/test/tui/rewind-picker.test.tsx`:

```tsx
it("offers a conversation restore for the first message (A4b)", async () => {
  const frame = await openConfirmPanel({ dry: { canRewind: false }, prevUuid: null });
  expect(frame).toContain("Restore conversation");
  expect(frame).toContain("Never mind");
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run test/unit/host-rewind.test.ts test/tui/rewind-picker.test.tsx`
Expected: FAIL — the host throws `no conversation anchor before the first prompt`, and the picker offers
only `Never mind`.

- [ ] **Step 5: Teach the host the first-message case**

In `harness/src/host/host.ts`, replace the null-prevUuid refusal inside `rewind`. Keep the surrounding
comment block's ordering argument verbatim — it is still load-bearing — and replace only the refusal:

```ts
    // VALIDATION FIRST, THEN SIDE EFFECTS is unchanged; what changed is that a null-prevUuid CONVERSATION
    // restore is no longer a refusal (W-S8). `resumeSessionAt` takes a message UUID and has no value
    // meaning "before the first" (sdk.d.ts:1815), so the fork primitive genuinely cannot express it — but
    // the OUTCOME the user asked for is an empty conversation, which is what the swap seam produces with
    // both keys undefined. Deliberately NOT this.clearSession(), which wraps that same swap in its own
    // swapInFlight window: nesting it here would let its finally reopen the busy gate mid-operation.
    const clearing = scope !== "code" && !anchor.prevUuid;
```

and in the conversation branch:

```ts
      if (scope !== "code") {
        if (this.bgTasks.length) this.emit({ kind: "task", data: { type: "task_notification", status: "stopped", task_id: "rewind", summary: "background tasks ended by rewind" } });
        if (clearing) await this.swapEngine({ resume: undefined, resumeAt: undefined });
        else await this.swapEngine({ resume: sid, resumeAt: anchor.prevUuid as string });
        // Broadcast so EVERY attached client rebuilds, not just the one that confirmed (see wire.ts).
        // `cleared` is POSITIVE, not the absence of prevUuid: the swap above minted a NEW session, and a
        // client whose cached id has not flipped yet would otherwise read the OLD file, find it non-empty,
        // and re-render the very conversation the user just discarded.
        this.emit({ kind: "rewound", sessionId: this.session?.sessionId ?? sid,
                    ...(clearing ? { cleared: true } as const : anchor.prevUuid ? { prevUuid: anchor.prevUuid } : {}) });
      }
```

- [ ] **Step 6: Open the option to the first message**

**All three sites** named in the preamble — `:201`, `:211`, `:263`. At the render site (`:263`; `:262` is
the destructure above it, `:264` the `restoreOptions` call below it):

```tsx
  // A conversation restore is now possible for EVERY anchor, the first prompt included: the host clears
  // the conversation where it cannot fork it (host.ts's `clearing` branch, W-S8). The old
  // `anchor.prevUuid != null` gate was honest while the host refused that case, and removing one without
  // the other is what would make the option list lie.
  const code = canRestoreCode(dry), conversation = true;
```

and at both `open()` sites, where the same predicate feeds `defaultRestoreOption` — leaving these behind
puts `focusedOption` on `"nevermind"` while the pointer rests on **Restore conversation**, so the panel's
explanation line (`:275`) contradicts its own pointer:

```tsx
    // conversation: true for the same reason as the render site — the host can now clear where it cannot
    // fork, so no anchor is unrestorable.
    setFocusedOption(defaultRestoreOption({ code: canRestoreCode(have), conversation: true }));
```

Pin that agreement with a test rather than trusting the edit:

```tsx
it("focuses a restorable option and explains THAT option, for a first-message anchor (A4b)", async () => {
  const frame = await openConfirmPanel({ dry: { canRewind: false }, prevUuid: null });
  expect(frame).toContain("The conversation will be forked.");        // not "…will be unchanged."
});
```

Update the doc comment on `restoreOptions` in `harness/src/tui/rewindModel.ts:195-201`: strike the
"second capability upstream's message does not" paragraph and replace it with a note that the prevUuid
degradation was removed in Wave S when the host learned to clear, keeping the function's own signature
(`{ code, conversation }`) — callers other than the picker may still pass `conversation: false`, and the
absence-not-disabled-row rule stands.

- [ ] **Step 7: Do not make the empty outcome wait three seconds**

Task 1's poll retries 8 times at 375 ms — ≈3 s — waiting for the reader to return **any** rows. After a
first-message restore the correct answer is *no rows*, so the poll would burn its whole window and only
then render the `⏪ rewound` divider. An empty conversation that takes three seconds to appear reads as a
hang, which is the same class of defect the pre-notice at `useChat.ts:781` exists to prevent elsewhere.

Both clients short-circuit on the `cleared` flag — the follower reads it off the wire, the confirming
client derives it locally at `useChat.ts:1345` (see the preamble; `selfRewind` means the broadcast never
reaches it). Take the empty-document arm on the flag: no read, no poll, no cut. The `prevUuid !== null`
poll gate below is then belt to that brace, for a host too old to send either field.

**THE FIXTURE MUST BE THE HONEST ONE: A NON-EMPTY OLD FILE.** An earlier draft of this step set
`readerRows = []`, which passes with or without the `cleared` arm — the empty document renders either
way and the test proves nothing (Global Constraint 15). The old session file **is** non-empty; that is the
entire hazard. So seed the reader with the conversation the rewind discards, and assert it is gone:

```tsx
it("renders the empty conversation immediately after a first-message restore, off a NON-empty old file", async () => {
  // The old file still holds the whole conversation and the client's cached id may still point at it.
  // Without the `cleared` arm, truncateAtAnchor(rows, null) returns every row (null is falsy) and the
  // discarded conversation re-renders. Timing alone would not catch that — the assertion below does.
  readerRows = [user("ONE", "u1"), assistant("a1"), user("TWO", "u2")];
  const t0 = Date.now();
  await confirmRewind({ uuid: "u1", prevUuid: null, text: "ONE", index: 0 }, "conversation");
  expect(rendered()).not.toContain("TWO");           // the discarded conversation is GONE
  expect(rendered()).toContain("⏪ rewound");
  expect(Date.now() - t0).toBeLessThan(200);         // and it did not sit out the poll's ~3s
});
```

Verify this test goes red for the RIGHT reason before implementing: against unmodified code it must fail on
the `not.toContain("TWO")` line, not on the timing bound. If it fails on timing first, reorder as written
above and re-run — a timing-only failure would go green from the poll gate alone, leaving the correctness
bug shipped.

Then gate the poll in `rebuildAfterRewind`:

```ts
    // A null anchor means "restore to before the first prompt", whose correct result is an EMPTY
    // conversation — so there is nothing for the poll to wait for and waiting three seconds for it makes
    // a successful operation read as a hang. Every other rewind still polls: there, rows are expected.
    const expectRows = opts.prevUuid !== null;
    for (let attempt = 0; attempt < (expectRows ? retry.attempts : 1); attempt++) {
```

Note the predicate is `!== null`, not falsy: `undefined` means "anchor unknown" (a follower on a host too
old to send one), where rows ARE still expected and the poll must run.

- [ ] **Step 8: Run to verify they pass**

Run: `npx vitest run test/unit/host-rewind.test.ts test/tui/rewind-picker.test.tsx test/tui/useChat-rewind.test.tsx`
Expected: PASS, including the Step-1 guards and Task 1's tests, which must all still be green.

- [ ] **Step 9: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`

- [ ] **Step 10: Commit**

```bash
git add harness/src/host/host.ts harness/src/tui/RewindPicker.tsx harness/src/tui/rewindModel.ts harness/src/tui/useChat.ts harness/test/unit/host-rewind.test.ts harness/test/tui/rewind-picker.test.tsx harness/test/tui/useChat-rewind.test.tsx
git commit -m "f5(waveS-t3): restore to the first message by swapping to a fresh conversation; A4's option set verified at HEAD and pinned as a guard"
```

---

## Task 4: EP-S4a — the `/model` overflow counter and the rewind window constant (P1)

**Why.** `/model`'s counter reads a fixed 10-row cap (`modelPickerModel.ts:19-22`) while `Select` already
publishes the real rendered window through `onViewChange` (`Select.tsx:108,202`), which the rewind picker
already consumes. At 60×15 with 14 models the counter therefore reports a number unrelated to what is on
screen. **This is a deliberate divergence (W-S11):** upstream computes `… +N models` off exactly that
fixed 10-row cap (L440969) and its `/model` list has no scroll gutter at all, so ccx is deliberately the
more truthful of the two. Say so in the code.

Second, unrelated but in the same file family: `rewindVisibleRows` (`rewindModel.ts:53`) transcribes
upstream's `max(2, floor((rows - 12) / rowHeight))` **without** upstream's `m = ds() ? floor(f/2) : f`
halving, which is why grounding measured 9 visible rows where upstream's own frame at the same geometry
shows 2. Upstream's `ds()` is its split-view predicate; we have no split view, so the halving is not
portable — but the existing comment claims the branch is "recorded and not ported" while the constant is
also wrong for our own chrome. Re-derive it against the frame `RewindPicker` actually draws and pin the
result.

**Files:**
- Modify: `harness/src/tui/modelPickerModel.ts:19-22`
- Modify: `harness/src/tui/ModelPicker.tsx:48-50, 80-92`
- Modify: `harness/src/tui/rewindModel.ts:44-55`
- Test: `harness/test/tui/model-picker.test.tsx`, `harness/test/tui/rewind-picker.test.tsx`

**Interfaces:**
- Consumes: `SelectView { start: number; end: number; focus: number }` from `src/tui/select/selectModel.js`
  and `SelectProps.onViewChange` from `src/tui/select/Select.js`.
- Produces: `modelOverflowCount(total: number, view?: { start: number; end: number }): number` —
  the second parameter is new; with it absent the function keeps its current fixed-cap behaviour so the
  existing tests stay meaningful as the pre-migration pin.

- [ ] **Step 1: Write the failing tests**

Add to `harness/test/tui/model-picker.test.tsx`:

```tsx
it("counts the rows the RENDERED window left off, not a fixed cap (A5)", () => {
  // 14 models, a window showing 4 of them → 10 hidden, whatever the cap says.
  expect(modelOverflowCount(14, { start: 0, end: 4 })).toBe(10);
  expect(modelOverflowCount(14, { start: 6, end: 10 })).toBe(10);
  expect(modelOverflowCount(14, { start: 0, end: 14 })).toBe(0);
});

it("renders the counter from the window the Select actually reported (A5)", async () => {
  const { lastFrame } = render(<ModelPicker models={fourteenModels} rows={15} columns={60} {...noops} />);
  await tick();
  const shown = (lastFrame() ?? "").split("\n").filter((l) => fourteenModels.some((m) => l.includes(m.displayName!))).length;
  expect(lastFrame()).toContain(`… +${14 - shown} models`);
});
```

Add to `harness/test/tui/rewind-picker.test.tsx`:

```tsx
it("sizes its window from the chrome it actually draws", () => {
  // The constant is re-derived, not inherited: upstream halves `rows` first under its split-view
  // predicate, which we do not have, so the 12 alone was measuring nothing of ours.
  expect(REWIND_CHROME_ROWS).toBe(9);          // the derived value, asserted DIRECTLY
  expect(rewindVisibleRows(21)).toBe(4);       // 4 at C=9, 3 at the old C=12 — this is the discriminator
  expect(rewindVisibleRows(15)).toBe(2);
});
```

**Do not write the loose version of this test.** The obvious pair — `rewindVisibleRows(15) === 2` and
`rewindVisibleRows(40) > 2` — is satisfied by **any** constant from 7 to 31, the current 12 included, so
adding the `REWIND_MIN_ROWS` export alone turns it green with no change to the constant at all. It pins
nothing. Assert the constant directly and include a height where the old and new values differ.

**And the plan's own enumeration undercounts by one (plan review).** `RewindPicker` draws **nine** rows of
chrome: border ×2, title, a `marginTop={1}` blank, the prompt, both indicator rows, the footer's
`marginTop={1}` blank, and the footer (`RewindPicker.tsx:99-107,235-255`). The earlier draft named only one
of the two blanks. Re-count it yourself against the component and correct me if nine is still wrong — but
whatever number you derive, assert it directly as above.

Note also that `resize-dialogs.test.tsx:199` hardcodes the OLD formula in a comment. It stays green, but
update the comment so it does not go stale.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/tui/model-picker.test.tsx test/tui/rewind-picker.test.tsx`
Expected: FAIL — `modelOverflowCount` takes one argument; `REWIND_MIN_ROWS` is not exported.

- [ ] **Step 3: Widen the counter**

In `harness/src/tui/modelPickerModel.ts`:

```ts
/** Upstream's fixed cap (L440969: `Math.min(10, models.length)`), kept as the FALLBACK only. */
export const MODEL_VISIBLE_MAX = 10;
export const modelVisibleCount = (rows: number): number => Math.min(MODEL_VISIBLE_MAX, rows);

/** How many rows the picker is NOT showing.
 *
 *  DELIBERATE DIVERGENCE (W-S11). Upstream computes this off its fixed 10-row cap and its `/model` list
 *  carries no scroll gutter at all, so at a short pane upstream's `… +N models` names a number unrelated
 *  to what is on screen. Ours follows the window `Select` actually rendered — reported through
 *  `onViewChange`, the same channel the rewind picker's `↑ N more above` already uses. Passing no window
 *  keeps the upstream arithmetic, which is what the pre-migration tests pin. */
export const modelOverflowCount = (total: number, view?: { start: number; end: number }): number =>
  view ? Math.max(0, total - Math.max(0, view.end - view.start)) : Math.max(0, total - modelVisibleCount(total));
```

- [ ] **Step 4: Consume the reported window in the picker**

In `harness/src/tui/ModelPicker.tsx`:

```tsx
  const visible = modelVisibleCount(models.length);
  // The window `Select` last rendered. State, not a ref: the counter is rendered output and has to
  // repaint when the window moves. `onViewChange` fires after a paint, so setting state from it is safe
  // (Select.tsx's own contract note).
  const [view, setView] = useState<{ start: number; end: number } | undefined>(undefined);
  const overflow = modelOverflowCount(models.length, view);
```

and on the `<Select>`:

```tsx
          onViewChange={(v) => setView({ start: v.start, end: v.end })}
```

- [ ] **Step 5: Re-derive the rewind window constant**

In `harness/src/tui/rewindModel.ts`, replace `REWIND_CHROME_ROWS` / `rewindVisibleRows` with a constant
derived from the frame `RewindPicker` draws. Count it from the component, do not guess: border top and
bottom, title, prompt line, the two indicator rows, the blank separator, and the footer. Write the count
you derived into the comment as an enumerated list, and export the floor:

```ts
/** The floor upstream uses (`Math.max(2, …)`, L487056) — two rows is the least that still reads as a list. */
export const REWIND_MIN_ROWS = 2;
/** What the frame, prompt, indicators and footer cost before a single row is drawn — RE-DERIVED from
 *  `RewindPicker`'s own frame in Wave S, not inherited. Upstream inlines 12 at L487056 but halves `rows`
 *  first under `ds()` (its split-view predicate); we have no split view, so importing the 12 alone
 *  measured nothing of ours and produced 9 visible rows where upstream's frame at the same geometry shows
 *  2. Enumerate every row you counted here. */
export const REWIND_CHROME_ROWS = 9;   // border ×2 · title · marginTop blank · prompt · both indicator rows · footer's marginTop blank · footer
export function rewindVisibleRows(rows: number, rowHeight: number = REWIND_ROW_HEIGHT): number {
  return Math.max(REWIND_MIN_ROWS, Math.floor((rows - REWIND_CHROME_ROWS) / rowHeight));
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run test/tui/model-picker.test.tsx test/tui/rewind-picker.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`

- [ ] **Step 8: Commit**

```bash
git add harness/src/tui/modelPickerModel.ts harness/src/tui/ModelPicker.tsx harness/src/tui/rewindModel.ts harness/test/tui/model-picker.test.tsx harness/test/tui/rewind-picker.test.tsx
git commit -m "f5(waveS-t4): /model's counter follows the rendered window; rewind's window constant re-derived from its own frame"
```

---

## Task 5: EP-S4b — Settings windowing (P1)

**Why, and what governs the shape.** `SettingsDialog`'s Config tab hand-rolls its cursor
(`useState(0)` + `select:previous`/`select:next` handlers at `:155-163`) and renders every row it has, with
no size props and no indicators. **W-S3 governs: migrate onto `Select` rather than binding paging keys
onto an unwindowed list** — binding keys to a list that never clips reproduces exactly the
"resolves but moves nothing" defect F2 exists to remove, and the handlers do not exist either. Migrating
gets the whole `Select` context for free: `pageup`/`pagedown`/`home`/`end` are already bound to
`select:pageUp`/`pageDown`/`first`/`last` (`keys/bindings.ts:166`), `selectKeys.ts:48-49` implements them,
and `Select.tsx:234` already passes `page: visible` so a page is one window.

**Divergence to record (W-S11):** upstream's Settings list has the counted indicators
(`↑ N more above` / `↓ N more below`, L441977/L441980) but binds **no** `pageup`/`pagedown`/`home`/`end` in
its `Settings` context (L186118) — its `ctrl+u`/`ctrl+d` are the surrounding scroll container's and are
effectively dead in the list. ccx gives this surface both.

**Two things must not change.** (1) The `/` search surface: while `search !== null` every key is text, and
that is why the scopes stay pushed. Keep it exactly as it is by **not mounting the `Select` while the
query is open** — render the current static filtered list there, unchanged. The Select is remounted when
the query closes, which is also what makes `defaultFocusValue` pick up the row the search selected.
(2) The embedded Theme/Output-style sub-views early-return above everything; leave that untouched.

**Files:**
- Create: `harness/src/tui/select/overflow.ts`
- Modify: `harness/src/tui/rewindModel.ts` (re-export `moreAbove`/`moreBelow` from the new module)
- Modify: `harness/src/tui/SettingsDialog.tsx`
- Test: `harness/test/unit/select-overflow.test.ts` (new), `harness/test/tui/settings-dialog.test.tsx`
  (new — check for an existing Settings component test first and extend it if one exists)

**Interfaces:**
- Produces: `moreAbove(n: number): string`, `moreBelow(n: number): string`,
  `overflowRows(view: { start: number; end: number }, total: number): { above: number; below: number }`
  from `src/tui/select/overflow.js`.
- Produces: `SETTINGS_CHROME_ROWS: number`, `settingsVisibleRows(rows: number): number` from
  `src/tui/SettingsDialog.tsx` (exported for the test; the component is the only consumer).
- Consumes: `Select`, `SelectProps` (`options`, `visibleOptionCount`, `defaultFocusValue`, `onFocus`,
  `onChange`, `onCancel`, `onViewChange`, `hideIndexes`, `rows`, `columns`, `node`) from
  `src/tui/select/Select.js`.

- [ ] **Step 1: Write the failing test for the shared overflow copy**

Create `harness/test/unit/select-overflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { moreAbove, moreBelow, overflowRows } from "../../src/tui/select/overflow.js";

describe("overflow indicators", () => {
  it("uses upstream's counted form (L441977/L441980)", () => {
    expect(moreAbove(3)).toBe("↑ 3 more above");
    expect(moreBelow(7)).toBe("↓ 7 more below");
  });
  it("derives both counts from the reported window", () => {
    expect(overflowRows({ start: 4, end: 9 }, 20)).toEqual({ above: 4, below: 11 });
    expect(overflowRows({ start: 0, end: 20 }, 20)).toEqual({ above: 0, below: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/select-overflow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared module**

Create `harness/src/tui/select/overflow.ts`:

```ts
// tui/src/select/overflow.ts — ONE spelling of the counted overflow indicators, shared by every windowed
// list in this package. It used to live in rewindModel.ts, which made every other dialog either import
// the rewind picker's model or type the strings a second time.
//
// UPSTREAM IS NOT INTERNALLY CONSISTENT HERE and we do not reproduce the inconsistency (W-S11): the
// bundle ships three indentations (paddingLeft 1 at the rewind picker L487190/193, 2 at the MCP and csb
// lists L465044/L467913, two leading spaces at the artifacts list L435655) and two forms (counted, and a
// countless `↑ more above` at L466948). The COPY below is upstream's counted form verbatim; each caller
// keeps its own indentation, which is the part that is genuinely per-frame.

export const moreAbove = (n: number): string => `↑ ${n} more above`;
export const moreBelow = (n: number): string => `↓ ${n} more below`;

/** How many rows a reported `Select` window leaves off each end. `end` is exclusive (selectModel.ts). */
export function overflowRows(view: { start: number; end: number }, total: number): { above: number; below: number } {
  return { above: Math.max(0, view.start), below: Math.max(0, total - view.end) };
}
```

In `harness/src/tui/rewindModel.ts`, delete the two local definitions and re-export instead, so the rewind
picker's imports keep working and there is still only one spelling:

```ts
export { moreAbove, moreBelow } from "./select/overflow.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/select-overflow.test.ts test/tui/rewind-picker.test.tsx`
Expected: PASS both.

- [ ] **Step 5: Write the failing Settings test**

Create (or extend) `harness/test/tui/settings-dialog.test.tsx`:

```tsx
it("windows the Config list and reports what it clipped (A6)", async () => {
  const { lastFrame } = render(<SettingsDialog {...props} rows={11} columns={80} />);
  await tick();
  // The 5 Config rows cannot all fit under a frame this short.
  expect(lastFrame()).toMatch(/↓ \d+ more below/);
});

it("moves the selection with the paging keys (A6)", async () => {
  const { lastFrame, stdin } = render(<SettingsDialog {...props} rows={11} columns={80} />);
  await tick();
  const before = focusedRowLabel(lastFrame());
  stdin.write("\x1b[6~");                          // pagedown
  await tick();
  expect(focusedRowLabel(lastFrame())).not.toBe(before);
  stdin.write("\x1b[H");                           // home
  await tick();
  expect(focusedRowLabel(lastFrame())).toBe("Theme");
});

it("leaves the / search surface exactly as it was", async () => {
  const { lastFrame, stdin } = render(<SettingsDialog {...props} rows={24} columns={80} />);
  await tick();
  stdin.write("/");
  await tick();
  stdin.write("th");                               // must land in the query, not move a cursor
  await tick();
  expect(lastFrame()).toContain("Type to filter");
  expect(lastFrame()).toContain("Theme");
  expect(lastFrame()).toContain("Thinking mode");
});
```

Read `harness/test/tui/` for the existing `tick()`/`render` conventions before writing this — a test that
writes keys before the passive `useInput` subscription lands drops them (`harness/CLAUDE.md`).

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run test/tui/settings-dialog.test.tsx`
Expected: FAIL — no indicators, and pagedown moves nothing.

- [ ] **Step 7: Migrate the browse list onto `Select`**

In `harness/src/tui/SettingsDialog.tsx`:

Add the imports:

```tsx
import { Select } from "./select/Select.js";
import { moreAbove, moreBelow, overflowRows } from "./select/overflow.js";
import type { SelectView } from "./select/selectModel.js";
```

Add the chrome budget beside the footers:

```tsx
/** What this dialog draws above and below the list: border ×2, the `Settings` title, the tab strip, two
 *  blank spacers, the footer, and the two new indicator rows. Enumerated rather than tuned so a later
 *  frame change has one number to update.
 *
 *  NOTE the clamp interaction: `Select`'s own `clampVisible` (selectModel.ts:18,28) already reserves 8
 *  rows, and takes the `min()` of the two — so this number does not solely govern the window. It is the
 *  ceiling this dialog contributes, not the whole budget. */
export const SETTINGS_CHROME_ROWS = 9;
/** THE DEFAULT IS LOAD-BEARING, do not drop it. `rows` is an optional prop and every existing test renders
 *  this dialog with no size props at all (keys-migration-dialogs.test.tsx:553), as does ChatApp
 *  (`:554,560`). Without it `settingsVisibleRows(undefined)` is NaN, which threads through clampVisible
 *  and windowBounds to `{start: NaN, end: 1}` and `options.slice(NaN, 1)` — a list permanently stuck at
 *  ONE row with navigation broken. `Select` defaults its own `rows` the same way (Select.tsx:146). */
export const settingsVisibleRows = (rows: number = process.stdout.rows ?? 24): number =>
  Math.max(1, rows - SETTINGS_CHROME_ROWS);
```

**Thread the props too, or accept the default deliberately.** `ChatApp.tsx:554,560` renders this dialog
with no size props today. Either add the threading (copy `ChatApp.tsx:521`'s `RewindPicker` pattern, which
uses `terminalRows()`/`terminalColumns()` at `:188-189`) or leave it and let the default carry — but say
which you chose and why in your report. The A6 test renders the dialog directly with explicit `rows`, so
it passes either way; only the real REPL notices.

Replace the `idx` state with an id-keyed focus, and add the window:

```tsx
  // Keyed by row ID, not index: the `/` search picks a ROW, and `Select`'s `defaultFocusValue` is a value.
  const [focusId, setFocusId] = useState<string>("theme");
  const [view, setView] = useState<SelectView | undefined>(undefined);
```

Every prior read of `rows[idx]` becomes `rows.find((r) => r.id === focusId) ?? rows[0]`. **One of those is
inside the search handler and the plan's "keep the search arm byte-identical" instruction is wrong about
it (plan review):** `onSearchKey` at `SettingsDialog.tsx:123` calls `setIdx(i)` when Enter picks a filtered
row, and must become `setFocusId(picked.id)` — which is simpler, since it no longer needs the
`rows.findIndex` lookup on the line above. Everything else in that handler and in the search RENDER stays
byte-identical; that one line is the exception.

In `acceptRow`, take the row from the value `Select` hands back instead:

```tsx
  const acceptRow = (id: string) => {
    const row = rows.find((r) => r.id === id); if (!row) return;
    if (row.type === "boolean") { setThinkingTouched(true); void setThink(row.value === "true" ? "off" : "default"); }
    else if (row.type === "enum") { void applyMode(cycleEnum(row)); }
    else if (row.id === "theme") setSub("theme");
    else if (row.id === "model") onOpenModelPicker();
    else if (row.id === "outputStyle") setSub("outputStyle");
  };
```

Drop `select:previous` / `select:next` / `select:accept` from this component's `useKeyActions` — the inner
`Select` pushes the `Select` context innermost and owns all eight of them, including the four paging
actions this task is for. Keep `settings:search` and `confirm:no`, both still `route()`d:

```tsx
  useKeyActions({
    // Movement and acceptance belong to the inner `Select` now (W-S3): it pushes the `Select` context
    // innermost, so its eight actions — including select:pageUp/pageDown/first/last, which this component
    // never had — resolve there. Registering them here as well would only shadow it.
    "settings:search": route(onConfig(() => setSearch(""))),
    "confirm:no": route(() => onDone()),
  });
```

Render the Config tab's browse arm through `Select`, and keep the search arm byte-identical:

```tsx
          {search !== null ? (
            /* …the existing query box and filtered-row rendering, UNCHANGED. The Select is deliberately
               not mounted here: while the query is open every key is text, and a mounted Select would eat
               j/k/enter. Unmounting also makes `defaultFocusValue` pick up the row the search selected
               when the query closes. */
          ) : (
            <>
              {view && overflowRows(view, rows.length).above > 0
                ? <Text dimColor>{moreAbove(overflowRows(view, rows.length).above)}</Text> : null}
              <Select
                options={rows.map((r) => ({
                  value: r.id, label: r.label,
                  // `focused` is used, not ignored: the focused row is ACCENT today (SettingsDialog.tsx:189)
                  // and dropping that would leave the pointer gutter as the only focus affordance.
                  // The `❯ `/`  ` prefix is NOT reproduced here — Select draws it in its own gutter
                  // (Select.tsx:282), and repeating it renders `❯ ❯ Theme`.
                  node: (focused: boolean) => (
                    <Box flexDirection="column">
                      <Text color={focused ? ACCENT : undefined}>{r.label}  {r.value}{r.hint ? <Text dimColor>   {r.hint}</Text> : null}</Text>
                      {r.id === "thinking" && thinkingTouched ? <Text dimColor>    {THINKING_WARNING}</Text> : null}
                    </Box>
                  ),
                }))}
                hideIndexes
                visibleOptionCount={settingsVisibleRows(rows_)}
                defaultFocusValue={focusId}
                onFocus={setFocusId}
                onViewChange={setView}
                onChange={acceptRow}
                onCancel={onDone}
                rows={rows_} columns={columns_}
              />
              {view && overflowRows(view, rows.length).below > 0
                ? <Text dimColor>{moreBelow(overflowRows(view, rows.length).below)}</Text> : null}
            </>
          )}
```

`rows_` / `columns_` are new optional props on the component (`rows?: number; columns?: number`), threaded
by `ChatApp` the same way `RewindPicker`'s are — grep `ChatApp.tsx` for `<RewindPicker` and copy the
threading exactly. Name the local variables so they do not collide with the `rows` settings array; if that
reads badly, rename the settings array to `settingsRows` instead. Do not leave two things called `rows`.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run test/tui/settings-dialog.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`
Expected: green. **There are no snapshots in this repo** (an earlier draft said otherwise). What breaks
instead is plain frame text: `grep -rn '❯ Theme\|❯ Model\|❯ Output style' test/` finds the assertions that
depend on this dialog's row rendering. They stay green **only if** the `node` body omits the pointer
prefix, which is why the code above omits it. Also check
`harness/test/tui/f6-acceptance.test.tsx:320-328`, which documents in prose that Settings has "no
`pageup`/`pagedown`/`home`/`end` at all" — that narrowing is exactly what this task removes, so update the
test and its comment.

- [ ] **Step 10: Commit**

```bash
git add harness/src/tui/select/overflow.ts harness/src/tui/rewindModel.ts harness/src/tui/SettingsDialog.tsx harness/src/tui/ChatApp.tsx harness/test/unit/select-overflow.test.ts harness/test/tui/settings-dialog.test.tsx
git commit -m "f5(waveS-t5): Settings' Config list migrates onto Select — real windowing, counted indicators, working paging keys"
```

---

## Task 6: EP-S4c — Permissions windowing (P1)

**Dispatch this as TWO implementer rounds with a review between them** (plan review: this is the one task
big enough to split, and it carries five separate defects found in a single pass). Both halves land in the
same file, so they are one task, but each half has a testable boundary:

- **6a — row identity.** Give every `Item` a stable string value, replace the index cursor with a
  value cursor, retarget `activate` and the footer's `selectedItem`, and lift the row bodies into a
  `renderItem(it)` that omits the pointer prefix. **No `Select` yet, no windowing** — the existing
  hand-rolled list renders `renderItem` and the existing tests must stay green. This half is where the
  22 frame-text assertions get their chance to fail loudly and early.
- **6b — windowing.** Mount the `Select`, add the indicators and the chrome budget, drop the movement
  handlers.

**Why this is not Task 5 again.** `PermissionsDialog` is ~340 lines, tabbed, with per-row activation, six
sub-views, an embedded `AddDirDialog`, and its own key registration at `:229-239`. Its rule lists are
genuinely unbounded — one per `allow`/`ask`/`deny` tab, plus the workspace directory list.

**Divergence to record (W-S11):** upstream's Permissions rule list uses the classic `jr` Select, so
`pageup`/`pagedown` work there but `home`/`end` do not (there is no `home`/`end` handling in `jr` at all),
and it renders **no** counted indicators. ccx gives this surface both indicators and the full four-key
set.

**Leave alone:** every `sub !== "none"` early-return, `onSubKey`'s physical key body (four of those six
sub-views are destructive confirms whose only keys are Enter and Esc — dispatching them on the ACTION
would delete a permission rule on a stray space), and the `NO_ACTIONS` behaviour while the embedded
`AddDirDialog` is up.

**Files:**
- Modify: `harness/src/tui/PermissionsDialog.tsx`
- Test: `harness/test/tui/permissions-dialog.test.tsx` (new — check for an existing component test first)

**Interfaces:**
- Consumes: `moreAbove`, `moreBelow`, `overflowRows` from `src/tui/select/overflow.js` (Task 5).
- Consumes: `Select` and `SelectView` as in Task 5.
- Produces: `PERMISSIONS_CHROME_ROWS: number`, `permissionsVisibleRows(rows: number): number`.

- [ ] **Step 1: Write the failing test**

Create `harness/test/tui/permissions-dialog.test.tsx`:

```tsx
const manyRules = Array.from({ length: 30 }, (_, i) => `Bash(cmd${i}:*)`);

it("windows an unbounded rule list and reports what it clipped (A6)", async () => {
  const { lastFrame } = render(<PermissionsDialog {...props} tab="Allow" rows={14} columns={80} />);
  await tick();
  expect(lastFrame()).toMatch(/↓ \d+ more below/);
  expect(countRuleRows(lastFrame())).toBeLessThan(manyRules.length);
});

it("moves the selection with the paging keys (A6)", async () => {
  const { lastFrame, stdin } = render(<PermissionsDialog {...props} tab="Allow" rows={14} columns={80} />);
  await tick();
  const before = focusedRow(lastFrame());
  stdin.write("\x1b[6~");                          // pagedown
  await tick();
  expect(focusedRow(lastFrame())).not.toBe(before);
  stdin.write("\x1b[F");                           // end
  await tick();
  expect(focusedRow(lastFrame())).toContain("cmd29");
});

it("still opens the delete confirm on Enter over a rule, and Esc still backs out", async () => {
  const { lastFrame, stdin } = render(<PermissionsDialog {...props} tab="Allow" rows={24} columns={80} />);
  await tick();
  stdin.write("\x1b[B");                           // onto the first rule (row 0 is "Add rule")
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("Enter to delete");
  stdin.write("\x1b");
  await tick();
  expect(lastFrame()).not.toContain("Enter to delete");
});

it("a stray space over a rule does not delete it", async () => {
  const { lastFrame, stdin } = render(<PermissionsDialog {...props} tab="Allow" rows={24} columns={80} />);
  await tick();
  stdin.write("\x1b[B"); await tick();
  stdin.write(" ");     await tick();
  expect(removeRule).not.toHaveBeenCalled();       // space may open the confirm; it must never remove
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/tui/permissions-dialog.test.tsx`
Expected: FAIL — the first two; the last two should already pass and are guards.

- [ ] **Step 3: Migrate the top-level list onto `Select`**

In `harness/src/tui/PermissionsDialog.tsx`:

Give each `Item` a stable string value — the `Select` addresses rows by value, not index:

```tsx
/** A row's stable identity. Index is not usable: a refetch after any mutation rebuilds `items`, and the
 *  cursor has to survive that. */
function itemValue(it: Item): string {
  switch (it.kind) {
    case "addRule": return "\0addRule";
    case "addDir":  return "\0addDir";
    case "rule":    return `rule:${it.row.rule}`;
    case "dir":     return `dir:${it.d.path}`;
    // `DenialEntry` is `{ display, by, at }` (permissionsModel.ts:84) — there is no toolUseID and no
    // command, and no SINGLE field is unique. This is the composite the existing React key already uses.
    case "denial":  return `denial:${it.e.at}-${it.e.display}`;
  }
}
```

Replace `idx` with a value-keyed focus and add the window:

```tsx
  const [focusValue, setFocusValue] = useState<string | undefined>(undefined);
  const [view, setView] = useState<SelectView | undefined>(undefined);
  useEffect(() => { setFocusValue(undefined); setView(undefined); }, [activeTab]);   // a cursor from one tab must not carry into another's list
```

**That effect alone does NOT reset the cursor, and the plan review caught it.** `Select` reads
`defaultFocusValue` **only in its `useState` initializers** (`Select.tsx:160-167`), and a tab change does
not remount it — so its internal `view.focus` survives, and Allow-tab-row-20 → a short tab → back lands on
row 20 again with no keypress. The existing `setIdx(0)` effect (`PermissionsDialog.tsx:140`) works today
precisely because the index lived in this component. **Put `key={activeTab}` on the `<Select>`** so a tab
change remounts it; the effect above then only clears this component's own mirrors. Write a test for it:
page down on a long tab, switch tabs and back, assert the cursor is on the first row.

`activate` takes the value:

```tsx
  const activate = (value: string) => {
    const item = items.find((i) => itemValue(i) === value);
    if (!item) return;
    /* …the existing five arms, unchanged… */
  };
```

Registration: drop `select:previous`/`select:next`/`select:accept`; keep `confirm:no` and the inert
`settings:search`. **Keep both `useKeyScope` calls** — the sub-views rely on the `Settings`/`Tabs` contexts'
null bindings to keep the six root globals unbound while they own the keyboard, and the sub-views render
with no `Select` mounted at all.

```tsx
  useKeyActions(sub === "addDir" ? NO_ACTIONS : {
    // Movement and acceptance moved to the inner `Select` (W-S3), which pushes the `Select` context
    // innermost and answers first. It brings select:pageUp/pageDown/first/last with it — upstream's own
    // Permissions gets pageup/pagedown from `jr`'s raw handler and has no home/end at all (recorded
    // divergence, W-S11). The six sub-views are untouched: each early-returns above the Select, and their
    // keys stay PHYSICAL because four of them are destructive confirms where `space` must not mean Enter.
    "confirm:no": route(() => onDone()),
    "settings:search": route(() => {}),            // `/` opens no query here — this dialog has no search
  });
```

Add the chrome budget and render the list through `Select` with `node` rows, wrapping the existing per-kind
row bodies unchanged:

```tsx
/** ELEVEN, not nine — an earlier draft named one blank spacer and the frame draws three
 *  (PermissionsDialog.tsx:311, :314, :336). Border ×2 · title · tab strip · blank · intro · blank · blank
 *  · footer = 9, plus the two new indicator rows = 11. Re-count it against the component yourself and
 *  correct this if the frame has moved.
 *
 *  As in Task 5, `Select`'s own clampVisible already reserves 8 rows and takes the min() of the two — this
 *  is the ceiling this dialog contributes, not the whole budget. */
export const PERMISSIONS_CHROME_ROWS = 11;
/** The default is load-bearing for the same reason Task 5's is: `rows` is optional, existing tests and
 *  ChatApp render this dialog with no size props, and `permissionsVisibleRows(undefined)` would be NaN —
 *  which threads through to a list permanently stuck at one row. */
export const permissionsVisibleRows = (rows: number = process.stdout.rows ?? 24): number =>
  Math.max(1, rows - PERMISSIONS_CHROME_ROWS);
```

```tsx
      {view && overflowRows(view, items.length).above > 0
        ? <Text dimColor>{moreAbove(overflowRows(view, items.length).above)}</Text> : null}
      <Select
        options={items.map((it) => ({ value: itemValue(it), label: itemLabel(it), node: () => renderItem(it) }))}
        hideIndexes
        visibleOptionCount={permissionsVisibleRows(rows_)}
        {...(focusValue !== undefined ? { defaultFocusValue: focusValue } : {})}
        onFocus={setFocusValue}
        onViewChange={setView}
        onChange={activate}
        onCancel={onDone}
        rows={rows_} columns={columns_}
      />
      {view && overflowRows(view, items.length).below > 0
        ? <Text dimColor>{moreBelow(overflowRows(view, items.length).below)}</Text> : null}
```

`itemLabel(it)` is the plain-string fallback `Select` uses for measurement. `renderItem(it)` is the
existing per-kind row body — **lifted, but NOT verbatim.** Two corrections, both from the plan review:

1. **Drop the `{selected ? "❯ " : "  "}` prefix.** Every current row body opens with it
   (`PermissionsDialog.tsx:317,318,320,325,331`) and `Select` draws that pointer in its own gutter
   (`Select.tsx:282`) — lifted as-is you get `❯ ❯ Add a new rule…`. `selected` is not even in scope; the
   node signature is `(focused: boolean) => ReactNode` (`Select.tsx:64`). This is load-bearing beyond
   cosmetics: `grep -rn '❯ Add a new rule\|❯ Bash(\|❯ WebFetch' test/` finds assertions across
   `test/tui/keys-migration-dialogs.test.tsx` and `test/tui/chat.test.tsx` that stay green **only** if the
   prefix is dropped. Task 5's node body drops it for the same reason.
2. **Use the `focused` argument** wherever the old body used `selected` for colour, so the focused row
   keeps the affordance it has today.

**The footer still needs a cursor (plan review).** `PermissionsDialog.tsx:150-151` derives `selectedItem`
from `clampedIdx` and `:337` uses it to choose `MANAGED_DIR_FOOTER`. Once `idx` is gone, re-derive it from
`focusValue`: `const selectedItem = items.find((i) => itemValue(i) === focusValue) ?? items[0]`. Keep the
`?? items[0]` — `focusValue` is `undefined` until `Select`'s mount-time `onFocus` fires, and the footer
renders before that.

Thread `rows` / `columns` props from `ChatApp` exactly as Task 5 does, or accept the default deliberately
and say which you chose.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/tui/permissions-dialog.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Full gates**

Run: `npm run typecheck && npm run test:unit && npm run test:tui`
Expected: green. **There are no snapshots** — what breaks is the frame-text assertions named above. Also
update `harness/test/tui/f6-acceptance.test.tsx:320-328`, which documents in prose that Permissions has
"no `pageup`/`pagedown`/`home`/`end` at all" and points at the parity doc's F6 divergence table; this task
invalidates both, so fix the test and refresh that table row in `docs/parity/`.

- [ ] **Step 6: Commit**

```bash
git add harness/src/tui/PermissionsDialog.tsx harness/src/tui/ChatApp.tsx harness/test/tui/permissions-dialog.test.tsx
git commit -m "f5(waveS-t6): Permissions' rule and workspace lists migrate onto Select — windowing, indicators, paging keys"
```

---

## Task 7: EP-S5a — `/cost` reports what the SDK actually returns (P1)

**Why.** `ModelUsage` (`sdk.d.ts:1265-1282`) carries ten fields; `commands.ts:130-147` reads two of them.
The dollar total is already right. Missing: `cacheReadInputTokens`, `cacheCreationInputTokens`,
`webSearchRequests`, `contextWindow`, `maxOutputTokens`, `canonicalModel`, `provider`. One type widening
also recovers API duration and lines changed, both already on the wire and both in upstream's output.

**Files:**
- Modify: `harness/src/tui/commands.ts:125-147` (`SessionUsage`, `sum`, `formatCost`)
- Test: **`harness/test/tui/commands.test.ts`** — `formatCost` is covered there at `:42,49`.
  **Not** `test/unit/commands-aliases.test.ts`, which never imports it; the earlier draft's
  `npx vitest run test/unit -t "cache tokens"` selects nothing at all and prints "1592 skipped", which
  reads like a satisfied red gate while proving nothing (plan review).

**Interfaces:**
- Produces: widened `SessionUsage.session.model_usage` entry type carrying at least
  `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`,
  `costUSD`, `contextWindow`, `maxOutputTokens`, `canonicalModel?`, `provider?`; plus
  `session.total_lines_added?` / `session.total_lines_removed?` / `session.total_api_duration_ms?` — grep
  `sdk.d.ts` for the exact names on the usage response before typing them, and use the SDK's spelling.
- Produces: `formatCost(u: SessionUsage): RenderLine[]` — same signature, more rows.

- [ ] **Step 1: Confirm the field names against the SDK, not this plan**

Run: `grep -n "total_lines_added\|total_api_duration_ms\|SDKControlGetUsageResponse" -A 25 node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | head -60`

Every name this task asks for was checked and **exists with that exact spelling** — `ModelUsage` at
`sdk.d.ts:1265-1282`, and `total_api_duration_ms` (`:3192`), `total_lines_added` (`:3194`),
`total_lines_removed` (`:3195`). Confirm rather than trust, and report any drift. (Correction to the
epic's own wording: the formatter reads **three** fields today, not two — `inputTokens`/`outputTokens` at
`commands.ts:141` and `costUSD` at `:145`.)

- [ ] **Step 2: Write the failing test**

```ts
it("reports cache tokens, API duration and lines changed (A7)", () => {
  const out = formatCost({
    session: {
      total_cost_usd: 0.1234, total_duration_ms: 61_000,
      /* the API-duration and lines-changed field names you confirmed in Step 1 */
      model_usage: { "claude-opus-5": {
        inputTokens: 100, outputTokens: 200,
        cacheReadInputTokens: 5000, cacheCreationInputTokens: 900,
        webSearchRequests: 2, costUSD: 0.1234, contextWindow: 200_000, maxOutputTokens: 64_000,
      } },
    },
  }).map((l) => l.text).join("\n");
  expect(out).toContain("5k");            // cache read, through tokenCount — `5k`, NOT `5.0k`:
                                          // commands.ts:91 is `${Math.round(n/100)/10}k`, so 5000 → "5k"
  expect(out).toContain("900");           // cache creation
  expect(out).toMatch(/api|API/);         // the API-duration row
  expect(out).toMatch(/lines/);           // the lines-changed row
});

it("omits a row the SDK did not populate rather than printing a zero", () => {
  const out = formatCost({ session: { total_cost_usd: 0, model_usage: {} } }).map((l) => l.text).join("\n");
  expect(out).not.toMatch(/lines/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/tui/commands.test.ts -t "cache tokens"`
Expected: FAIL.

- [ ] **Step 4: Widen the type and the formatter**

Replace `SessionUsage`'s inline model-usage type with one carrying the confirmed fields, extend `sum` to
take any numeric key, and add the rows to `formatCost`. Keep the existing rows and their exact spacing —
this is an addition, not a re-layout. Rows the SDK did not populate are omitted, never printed as zero:
a zero the harness invented is the same class of lie this wave is removing.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/tui/commands.test.ts -t "cache tokens"`
Expected: PASS.

- [ ] **Step 6: Full gates and commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/tui/commands.ts harness/test/tui/commands.test.ts
git commit -m "f5(waveS-t7): /cost reports the seven ModelUsage fields it was dropping, plus API duration and lines changed"
```

---

## Task 8: EP-S5b — the context chip stops lying after `/clear` (P1)

**Why.** `ctxPct` is written only at turn end (`useChat.ts:680`) and `clear()` (`:1599`) never touches it,
so after `/clear` the status bar keeps showing a percentage measured against a context that no longer
exists. The chip is gated on `ctxPct != null` (`ChatStatusBar.tsx:41`), so hiding it is one state reset.

**Both halves of A8 are required.** The negative half alone ("no percentage after `/clear`") passes on a
build that never sets one, or whose status bar does not render at all. The test must also show a freshly
measured percentage arriving when the first post-clear turn ends.

**Divergence, and the v1 rationale was wrong (W-S5).** Upstream has no persistent context chip at all —
its indicator returns `null` unless the context level is not "ok" (L488912-922) and surfaces as a transient
warning (`Context low (N% remaining) · Run /compact to compact & continue`, L489324). So ccx still shows a
chip upstream never shows, before and after this change. Whether to keep ccx's inline percentage at all is
parked for Wave C; this change only stops it lying in the meantime. Write that into the code comment —
do not repeat the "matching upstream" claim, which was never true.

**Files:**
- Modify: `harness/src/tui/useChat.ts` — `clear()` (≈1599)
- Test: `harness/test/tui/useChat.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("hides the context percentage after /clear and shows a fresh one when the next turn ends (A8)", async () => {
  await completeATurn();                                   // sets ctxPct
  expect(result.current.state.ctxPct).toBeGreaterThan(0);
  result.current.clear();
  await tick();
  expect(result.current.state.ctxPct).toBeUndefined();      // half one
  contextUsage = { totalTokens: 4_000, maxTokens: 200_000 };
  await completeATurn();
  await waitFor(() => expect(result.current.state.ctxPct).toBe(2));   // half two: freshly MEASURED
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/tui/useChat.test.tsx -t "after /clear"`
Expected: FAIL — `ctxPct` survives the clear.

- [ ] **Step 3: Reset the chip on clear**

```ts
  // `/clear` discards the conversation, so the last measured context percentage now describes something
  // that does not exist. Hidden until the next turn end measures a real one — refreshing immediately
  // would also be honest, and costs one call, but it puts a surface back on screen that has nothing true
  // to say yet.
  //
  // DIVERGENCE, recorded (W-S5): upstream has no persistent context chip at all. Its indicator returns
  // null unless the context level is not "ok" (L488912-922) and surfaces as a transient warning
  // (`Context low (N% remaining) · Run /compact to compact & continue`, L489324). This change does not
  // make ccx match upstream — it makes ccx's own chip stop lying. Whether to keep the chip is Wave C's.
  function clear() { if (!disposed.current) { replaceDocument(new TranscriptDocument()); setCtxPct(undefined); clearViewportFn(); } }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/tui/useChat.test.tsx -t "after /clear"`
Expected: PASS.

- [ ] **Step 5: Full gates and commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/tui/useChat.ts harness/test/tui/useChat.test.tsx
git commit -m "f5(waveS-t8): /clear hides the stale context percentage until a real one is measured"
```

---

## Task 9: EP-S6a — `--continue`, and a `--resume` that resolves what ccx prints (P1)

**Why.** `ccx` has `/continue` in the REPL (`useChat.ts:808` → `doContinue`) but no `--continue` flag —
`args.ts` never mentions it. Upstream has both (`-c, --continue`, L563626; help copy at L385342:
`-c, --continue                   Resume the last session in this directory`; failure copy
`No conversation found to continue`, L576823).

**And `--resume` carries a trap.** `ccx` prints **two different 8-character ids**: `/status`'s is a UUID
prefix (`commands.ts:159` slices 8 chars), the detachable banner's is a randomly minted fleet roster short
id. Upstream accepts **neither** — three independent gates all require a full 36-char UUID or a filesystem
path (`xN` at L1459 against `/^[0-9a-f]{8}-…$/i`; the session-file lookup `e2_` at L369966 is an exact
filename join, never a prefix scan). **W-S6 decides ccx accepts both forms and fails loudly on no match**,
because upstream never prints a short id and ours does — the divergence is ours to close, not the user's
to work around. Record it as a deliberate extension.

**A third outcome, and the failure copy must distinguish it (spec review).** `RosterRow.sessionId` is
optional (`fleet/roster.ts:9`) and is stamped only once the engine's id materializes mid-turn, so a banner
short id for a session that never completed a turn resolves to a roster row **with no session id** —
neither "resumes" nor "unknown id".

**Files:**
- Modify: `harness/src/cli/args.ts` (the flag), and its help/usage text — grep for where the flag list is
  printed and add the line there too
- Modify: `harness/src/cli/main.ts` (≈265–320: the `--resume` + prompt refusal, and the `initialResume`
  construction)
- Create: `harness/src/cli/resolveResume.ts` — the pure resolver
- Test: `harness/test/unit/cli-args.test.ts`, `harness/test/unit/resolve-resume.test.ts` (new)

**Interfaces:**
- Produces: `CcxInvocation.continue: boolean` (name it `continueSession` if `continue` is awkward as a
  property — pick one and use it consistently; `continue` is a reserved word only as an identifier, not as
  a property, so `a.continue` is legal).
- Produces from `src/cli/resolveResume.ts`:
  ```ts
  export type ResumeResolution =
    | { kind: "session"; id: string }
    | { kind: "pending"; short: string }      // a roster row exists but has minted no session id yet
    | { kind: "unknown"; arg: string };
  export function resolveResumeArg(arg: string, deps?: ResolveResumeDeps): Promise<ResumeResolution>;
  export interface ResolveResumeDeps { listSessions: typeof listSessions; resolveTarget: typeof resolveTarget }
  ```
- Consumes: `listSessions(opts)` from `src/sessions/reader.js`; `resolveTarget(target, env)` from
  `src/cli/lifecycle.js:23` (returns a `RosterRow`, throws when the short id names nothing).
- Consumes: `InitialResume` (`{ kind: "id"; id: string } | { kind: "continue" }`) — declared at
  `src/tui/commands.ts:210`, not `chatMain.tsx:24`; confirm the union before wiring.

- [ ] **Step 1: Write the failing resolver test**

Create `harness/test/unit/resolve-resume.test.ts`:

```ts
const FULL = "0d7a7a9d-1111-2222-3333-444455556666";

it("accepts a full UUID unchanged", async () => {
  expect(await resolveResumeArg(FULL, deps({ sessions: [{ sessionId: FULL }] })))
    .toEqual({ kind: "session", id: FULL });
});

it("accepts the 8-char prefix /status prints (W-S6)", async () => {
  expect(await resolveResumeArg("0d7a7a9d", deps({ sessions: [{ sessionId: FULL }] })))
    .toEqual({ kind: "session", id: FULL });
});

it("accepts the fleet roster short id the detachable banner prints (W-S6)", async () => {
  expect(await resolveResumeArg("k3f9", deps({ roster: { short: "k3f9", sessionId: FULL } })))
    .toEqual({ kind: "session", id: FULL });
});

it("distinguishes a roster row that has not minted a session id yet", async () => {
  // RosterRow.sessionId is optional and is stamped mid-turn — a session that never completed a turn has
  // a roster row and no id. That is a THIRD outcome, not "unknown".
  expect(await resolveResumeArg("k3f9", deps({ roster: { short: "k3f9" } })))
    .toEqual({ kind: "pending", short: "k3f9" });
});

it("fails loudly on no match rather than resolving to nothing", async () => {
  expect(await resolveResumeArg("zzzz", deps({}))).toEqual({ kind: "unknown", arg: "zzzz" });
});

it("refuses an ambiguous prefix rather than picking one", async () => {
  const a = "0d7a7a9d-1111-2222-3333-444455556666", b = "0d7a7a9d-9999-8888-7777-666655554444";
  await expect(resolveResumeArg("0d7a7a9d", deps({ sessions: [{ sessionId: a }, { sessionId: b }] })))
    .rejects.toThrow(/ambiguous/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/resolve-resume.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver**

Create `harness/src/cli/resolveResume.ts`. Order the attempts: full UUID → exact `listSessions` match →
unique UUID-prefix match (throw on ambiguity) → fleet roster short id (`resolveTarget`, caught) →
`unknown`. Head it with the divergence note:

```ts
// cli/resolveResume.ts — what `--resume <arg>` accepts.
//
// DELIBERATE EXTENSION, not parity (W-S6). Upstream accepts a FULL 36-char UUID or a filesystem path and
// nothing else: `xN` (L1459) tests /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i and
// the session-file lookup `e2_` (L369966) is an exact filename join, never a prefix scan. An 8-char id
// resumes nothing upstream. But ccx PRINTS two different 8-char ids — `/status`'s UUID prefix
// (commands.ts:159) and the detachable banner's fleet roster short id — so refusing them would make the
// product's own output unusable against its own flag. Both resolve here; anything else fails loudly.
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/unit/resolve-resume.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing `--continue` test**

Add to `harness/test/unit/cli-args.test.ts`:

The parser export is **`parseCcx`** (`harness/src/cli/args.ts:72`), already imported by
`test/unit/cli-args.test.ts:5` — not `parseArgs`, which does not exist:

```ts
it("parses -c / --continue (A10)", () => {
  expect(parseCcx(["-c"]).continue).toBe(true);
  expect(parseCcx(["--continue"]).continue).toBe(true);
  expect(parseCcx([]).continue).toBe(false);
});
```

**Do NOT write a parser-level `--continue` + `--resume` refusal, and do not test for one here.** An earlier
draft asked for both a throw from the parser and a refusal "where the other cross-flag refusals live" —
those contradict, and the parser side is the wrong one. `args.ts:101-104` documents exactly why grammar-level
cross-flag rules are forbidden: a detached child re-parses its OWN argv, so a parser constraint would kill
every `--detachable` child at startup. The refusal belongs in `main.ts` beside its siblings (`:109`,
`:142`, `:270`), and its test belongs wherever those are tested. Note also the asymmetry to keep in mind
while wiring: `--resume` lands at `a.config.resume` (`args.ts:112`) while `continue` is top-level.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run test/unit/cli-args.test.ts -t "continue"`
Expected: FAIL — `unknown flag -c`.

- [ ] **Step 7: Add the flag and wire both paths**

In `harness/src/cli/args.ts`, beside `-r/--resume`:

```ts
      // Upstream's own flag and letter (`-c, --continue`, L563626). Valueless; it resolves at launch to
      // the most recent session for this directory, which is exactly what the REPL's own /continue does.
      case "-c": case "--continue": a.continue = true; break;
```

Add `continue: false` to the invocation's defaults and `continue: boolean` to `CcxInvocation`. Refuse the
combination with `--resume` in `main.ts`, beside its siblings at `:109`, `:142`, `:270` — **not** in the
parser (see above).

In `harness/src/cli/main.ts`, resolve `--resume` through `resolveResumeArg` before building
`initialResume`, and map the three outcomes:

```ts
  // `unknown` and `pending` FAIL rather than dropping into a fresh REPL: silently opening an empty
  // session when the user asked for a specific one is the failure this criterion exists to remove.
  if (resume) {
    const r = await resolveResumeArg(resume);
    if (r.kind === "unknown") return fail(`No conversation found with session ID: ${r.arg}`, 1);
    if (r.kind === "pending") return fail(`Session ${r.short} has not started a conversation yet — nothing to resume`, 1);
    resolvedResume = r.id;
  }
```

and for `--continue`, hand the TUI the continue intent (`{ kind: "continue" }` — match
`chatMain.tsx:24`'s union exactly), which `useChat.ts:653` already routes to `doContinue()`. `doContinue`
already prints `No sessions to continue here` on an empty result; leave that copy alone rather than
importing upstream's, and note the divergence in a comment.

Add the help line to whichever function prints the flag list.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run test/unit/cli-args.test.ts test/unit/resolve-resume.test.ts`
Expected: PASS.

- [ ] **Step 9: Full gates and commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/cli/args.ts harness/src/cli/main.ts harness/src/cli/resolveResume.ts harness/test/unit/cli-args.test.ts harness/test/unit/resolve-resume.test.ts
git commit -m "f5(waveS-t9): ccx --continue, and --resume resolves both id forms ccx prints — failing loudly on neither"
```

---

## Task 10: EP-S6b — resume picker: the cancel line, the widen controls, the preview count (P1)

Three bounded items on one surface.

**(i) `Resume cancelled` (A11).** Cancelling `/resume` prints nothing while every sibling dialog prints an
outcome. Upstream's copy is exactly `Resume cancelled` — lowercase `c`, no period, `display: "system"`
(L476806). It prints on Esc from the list **and** on cancelling the loading/resuming spinner, and it does
**not** print on a successful resume or on the `--resume` CLI path.

**(ii) The widen controls (A12).** Upstream offers three; ccx can back two.
`Ctrl+A` toggles project scope, `Ctrl+W` toggles worktree scope, and both have real backing in
`sessions/reader.ts` — dropping the `cwd` filter and flipping `includeWorktrees` respectively.
**`Ctrl+B` (all branches) has no backing in `listSessions` and is not built** (CTRL-B-1: the controller
recommends recording the divergence permanently; do not build a branch filter in this task).

Each control is a two-state toggle **whose label names the state you would move to** (L476627):

| chord | label while narrowed | label while widened |
|---|---|---|
| `Ctrl+A` | `show all projects` | `only show current repo` |
| `Ctrl+W` | `show all worktrees` | `only show current worktree` |

Both render with `format: { modCase: "title", charCase: "upper" }`, i.e. `Ctrl+A` / `Ctrl+W`. `Ctrl+W` is
shown only when a worktree is detected.

**(iii) The preview's message count (`qa4-07(ii)`).** The count is the raw row count while the pane drops
tool-result-only rows, so the number and the pane disagree in both directions. Upstream's predicate is
`Pqs`/`$$_`/`B$_` (L369021-369043) — read those in
`/Users/new/.claude/jobs/4b30d1a4/tmp/waveS-grounding-bundle.md` §3.3 and port the predicate. The
slash-entries half of `qa4-07` is **out of scope** (W-S7, deferred).

**Files:**
- Modify: `harness/src/tui/sessionPickerModel.ts` (the toggle copy, the count predicate)
- Modify: `harness/src/tui/SessionPicker.tsx` (the two chords, the footer, the reload)
- Modify: `harness/src/tui/useChat.ts` — `closePicker` (≈993), and the picker's session-list loader so it
  can re-fetch under widened scope
- Modify: `harness/src/sessions/reader.ts` if the scope options need widening (they may not — `cwd` is
  already optional and `includeWorktrees` already exists)
- **Modify: `harness/src/tui/keys/bindings.ts` — omitted from the earlier draft and NOT optional.**
  `ctrl+a` and `ctrl+w` are bound in no context today (`:153-161` binds only `space`, `ctrl+r` and
  `escape` in `SessionPicker`), and neither action is in `VALID_ACTIONS` (`:263`). Edit `DEFAULT_BINDINGS`
  and `VALID_ACTIONS` **together** — `test/tui/keys-bindings.test.ts:79-82` is a bidirectional
  set-equality pin and fails if you touch only one. There is no fallback route: `SessionPicker.tsx:172,177`
  both guard on `!key.ctrl`, so a raw `\x01` is silently dropped.
- Test: `harness/test/tui/session-picker.test.tsx` (new or existing), `harness/test/unit/sessions-reader.test.ts`

**Interfaces:**
- Produces from `sessionPickerModel.ts`:
  ```ts
  export const WIDEN_ALL_PROJECTS = "show all projects";
  export const WIDEN_CURRENT_REPO = "only show current repo";
  export const WIDEN_ALL_WORKTREES = "show all worktrees";
  export const WIDEN_CURRENT_WORKTREE = "only show current worktree";
  export const RESUME_CANCELLED = "Resume cancelled";
  export interface ResumeScope { allProjects: boolean; allWorktrees: boolean }
  export function widenHints(scope: ResumeScope, hasWorktree: boolean): { chord: string; action: string }[];
  export function previewMessageCount(rows: readonly unknown[]): number;
  ```
- Consumes: `ListSessionsOpts { cwd?: string; includeWorktrees?: boolean; … }` from `src/sessions/reader.js`.

- [ ] **Step 1: Write the failing tests**

```ts
it("prints upstream's cancel copy, exactly (A11)", () => {
  expect(RESUME_CANCELLED).toBe("Resume cancelled");
});

it("labels each widen control with the state it would move TO (A12)", () => {
  expect(widenHints({ allProjects: false, allWorktrees: false }, true)).toEqual([
    { chord: "Ctrl+A", action: "show all projects" },
    { chord: "Ctrl+W", action: "show all worktrees" },
  ]);
  expect(widenHints({ allProjects: true, allWorktrees: false }, true)[0])
    .toEqual({ chord: "Ctrl+A", action: "only show current repo" });
});

it("hides Ctrl+W when no worktree is detected", () => {
  expect(widenHints({ allProjects: false, allWorktrees: false }, false).map((h) => h.chord)).toEqual(["Ctrl+A"]);
});

it("counts only the rows the preview pane actually renders (qa4-07 ii)", () => {
  const rows = [userPrompt("hi"), assistantText("hello"), toolResultOnly(), userPrompt("again")];
  expect(previewMessageCount(rows)).toBe(3);          // the tool-result-only row is not a message
});

it("count and pane apply the SAME predicate", () => {
  // NOT "the count equals the pane's row count" — `previewLines` ends `return out.slice(-PREVIEW_ROWS)`
  // with PREVIEW_ROWS = 12, so for any transcript longer than 12 rows the total and the windowed tail
  // MUST differ. What has to be shared is the predicate, and this is how you pin that.
  const rows = manyMixedRows(40);
  expect(previewMessageCount(rows)).toBe(rows.filter(isPreviewMessage).length);
  expect(previewLines(rows).length).toBeLessThanOrEqual(PREVIEW_ROWS);
});
```

The defect is real and exactly where the epic says: `SessionPicker.tsx:111` sets `count: msgs.length`
while the pane drops tool-result-only rows.

```tsx
it("changes the result set when the project scope widens (A12)", async () => {
  const { lastFrame, stdin } = render(<SessionPicker {...props} />);
  await tick();
  expect(lastFrame()).toContain("show all projects");
  expect(listSessionsCalls.at(-1)).toMatchObject({ cwd: "/repo/a" });
  stdin.write("\x01");                       // Ctrl+A
  await tick();
  expect(listSessionsCalls.at(-1)?.cwd).toBeUndefined();
  expect(lastFrame()).toContain("only show current repo");
});
```

```tsx
it("prints an outcome line when /resume is cancelled (A11)", async () => {
  result.current.closePicker();
  await tick();
  expect(rendered()).toContain("Resume cancelled");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/tui/session-picker.test.tsx test/tui/useChat.test.tsx -t "Resume cancelled"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the literals and `widenHints` to `sessionPickerModel.ts`, replacing the header comment's claim that
"the three scope toggles are omitted" with what is now true: two are built off real `listSessions`
options, and `Ctrl+B` is recorded as unbacked.

```ts
/** L476627's footer controls, in upstream's order. Each label names the state the chord moves you TO —
 *  that is upstream's convention, and inverting it is the obvious way to get this wrong.
 *
 *  Ctrl+B (all branches) is NOT here and is a permanent recorded divergence (CTRL-B-1): `listSessions`
 *  has no branch axis, and the only branch datum we hold is the `gitBranch` a row happens to carry, which
 *  cannot widen a query it never narrowed. */
export function widenHints(scope: ResumeScope, hasWorktree: boolean): { chord: string; action: string }[] {
  return [
    { chord: "Ctrl+A", action: scope.allProjects ? WIDEN_CURRENT_REPO : WIDEN_ALL_PROJECTS },
    ...(hasWorktree ? [{ chord: "Ctrl+W", action: scope.allWorktrees ? WIDEN_CURRENT_WORKTREE : WIDEN_ALL_WORKTREES }] : []),
  ];
}
```

Hold `ResumeScope` as state in `SessionPicker`, bind `ctrl+a` / `ctrl+w` there, and re-fetch through the
existing loader with `{ ...(scope.allProjects ? {} : { cwd }), includeWorktrees: scope.allWorktrees }`.
Print the outcome line from `closePicker` in `useChat.ts` via the existing `notice(...)`.

For (iii), port the predicate and make the count and the pane read the **same** function — the defect is
that they disagree, so a fix that leaves two independent implementations has not fixed it. Export the
predicate itself (`isPreviewMessage`) so a test can apply it independently; the count and the pane both
consume it, and the pane additionally windows to `PREVIEW_ROWS`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/tui/session-picker.test.tsx test/tui/useChat.test.tsx test/unit/sessions-reader.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gates and commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/tui/sessionPickerModel.ts harness/src/tui/SessionPicker.tsx harness/src/tui/useChat.ts harness/test/
git commit -m "f5(waveS-t10): /resume gains its cancel line, two backed widen controls, and a preview count that matches the pane"
```

---

## Task 11: EP-S7 — compaction surfaces (P2)

**The premise correction that governs this task.** The SDK exposes **no** progress value. Upstream's bar is
`1 - e^(-seconds/90)` capped at 95% — an animation, not a measurement (`JCp`, L407448). It is ported for
fidelity under W-S4 and **labelled as such in the code**. Do not drive it from `pre_tokens`/`post_tokens`:
those arrive only at the boundary, i.e. when the bar would already be finished.

**What is broken today — and the epic's premise is FALSE for the path that matters (plan review).** The
spec says the lifecycle "already reaches `useChat`… a consumption change, not a wire change." That holds
for **automatic mid-turn compaction**, which flows through `submit` → `runTask`. It does **not** hold for
a user-typed `/compact`, and the plan traced why:

- `session/session.ts:146-153` — `compact()` installs its own **private** `onMessage` that collects the
  status and boundary frames into a local array. Nothing escapes it.
- `host/host.ts:322` — the host's `compact` op calls `s.compact()` directly, bypassing `runTask`, which is
  the only place raw frames become client `message` events (`:269-278`).
- `host/host.ts:505-532` — the always-on frame tap emits only for `background_tasks_changed`, the `task_*`
  family, and `status` frames carrying a `permissionMode` **string** (`:521`). A `system/status` with
  `status: "compacting"` and no `permissionMode` matches no branch.

`session.ts:262` — the line the spec cites — proves only that the SDK **emits** the frame. (Two more
citation corrections while you are in there: the spec's `species.ts:597` is inside a *doc comment*;
`systemNoticeLines` itself is at `:634` and its generic `typeof content !== "string"` exit — the one that
swallows every structured system frame — is at `:653`. And `useChat.ts`'s `compact_boundary` branch is at
`:557`, not `:556`.) So: consume the
wire lifecycle for the automatic path, **and set the busy state locally at `useChat.ts:781`** for the
`/compact` path, where the client already knows a compaction is starting because it started it. Do not
spend the task trying to route `/compact`'s frames through the host; that is a wire change this epic (a
P2) does not justify. Record the split in a comment.

Second defect, unchanged: the in-progress affordance is a permanent `append()` at `useChat.ts:781` that
nothing removes, so the transcript keeps `✻ compacting…` forever beside the `✦ compacted N → M` result.

**A13's wording matters.** Upstream *replaces* nothing: the spinner, hint and bar are ephemeral render
state discarded at `compact_end` (`a()` at L407334 clears all four fields at once), while `Compacted …` is
a separately persisted message. Build ephemeral render state, not a transient-row contract.

**Exact upstream geometry (L407977-978, L408060):**
- ratio: `min(95, round((1 - exp(-seconds/90)) * 100))`, held **monotonic** by `Math.max(previous, …)`.
  **It is a PERCENTAGE (0–95), not a 0–1 fraction** — so `barCells` fills `round(ratio / 100 * width)`.
  Upstream's own `clamp01` sits on its 0–1 `ratio` prop, one layer further in; an earlier draft of this
  plan spliced the two and would have filled the whole bar at 50% (plan review)
- width: `min(40, columns - 2 - 6)`; **suppressed entirely when the computed width is under 8**
- `marginLeft: 2`; the trailing dim `NN%` sits after the bar with `gap: 1`
- glyphs: fill `▰` U+25B0, empty `▱` U+25B1; on ink-bleed terminals `█` U+2588 / `░` U+2591
- fill: `filled = round(clamp(ratio, 0, 100) / 100 * width)`, remainder empty — **whole cells only**, no
  sub-cell interpolation in the pill variant
- spinner verb: `Compacting conversation` (rendered with a trailing `…`)

**Files:**
- Create: `harness/src/tui/compactionBar.ts`
- Create: `harness/test/unit/compaction-bar.test.ts`
- Modify: `harness/src/tui/useChat.ts` — the system-frame arm (≈553-580), the `/compact` command
  (≈779-781), and the state it publishes
- Modify: `harness/src/tui/ChatApp.tsx` or `TurnSpinner.tsx` to render the bar — put it wherever the
  spinner already lives; grep for `TurnSpinner` and follow that surface
- Test: `harness/test/tui/useChat.test.tsx`

**Interfaces:**
- Produces from `src/tui/compactionBar.ts`:
  ```ts
  export const COMPACTING_VERB = "Compacting conversation";
  export const BAR_MAX_WIDTH = 40, BAR_MIN_WIDTH = 8, BAR_MARGIN_LEFT = 2;
  export function compactionRatio(elapsedMs: number, previous?: number): number;   // 0..95, monotonic
  export function barWidth(columns: number): number;                                // 0 = suppressed
  export function barCells(ratio: number, width: number, inkBleed?: boolean): { fill: string; empty: string };
  ```
- Produces: `ChatState.compacting?: { startedAt: number }` — ephemeral, cleared at the boundary.

- [ ] **Step 1: Write the failing pure tests**

```ts
it("is upstream's saturating curve, not a measurement (W-S4)", () => {
  expect(compactionRatio(30_000)).toBe(28);
  expect(compactionRatio(60_000)).toBe(49);
  expect(compactionRatio(90_000)).toBe(63);
  expect(compactionRatio(180_000)).toBe(86);
  expect(compactionRatio(600_000)).toBe(95);          // the cap
});
it("never goes backwards", () => {
  expect(compactionRatio(10_000, 40)).toBe(40);
});
it("is 40 cells at most and suppressed below 8", () => {
  expect(barWidth(200)).toBe(40);
  expect(barWidth(30)).toBe(22);
  expect(barWidth(14)).toBe(0);                       // 14-2-6 = 6 < 8 → suppressed
});
it("fills whole cells only, with the pill glyphs", () => {
  expect(barCells(50, 10)).toEqual({ fill: "▰".repeat(5), empty: "▱".repeat(5) });
  expect(barCells(50, 10, true)).toEqual({ fill: "█".repeat(5), empty: "░".repeat(5) });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run test/unit/compaction-bar.test.ts`

- [ ] **Step 3: Write `compactionBar.ts`**, heading it with the "this is theatre" note:

```ts
// tui/src/compactionBar.ts — upstream's compaction progress bar, INCLUDING its fake progress curve.
//
// THE CURVE MEASURES NOTHING. `JCp` (L407448) is `min(95, round((1 - e^(-seconds/90)) * 100))` over
// elapsed wall-clock — the SDK exposes no compaction progress value and upstream computes none. It is
// ported because this project's goal is fidelity to the installed build and the formula is transcribed
// and cheap, and it is labelled here so nobody later "fixes" it by wiring it to pre_tokens/post_tokens —
// those arrive at the boundary, i.e. when the bar would already be finished.
```

- [ ] **Step 4: Run to verify it passes**

- [ ] **Step 5: Write the failing lifecycle tests**

```tsx
it("enters a busy state while compaction runs and leaves it at the boundary (A13)", async () => {
  emit({ type: "system", subtype: "status", status: "compacting" });
  await tick();
  expect(result.current.state.compacting).toBeDefined();
  emit({ type: "system", subtype: "compact_boundary", compact_metadata: { pre_tokens: 100, post_tokens: 20 } });
  await tick();
  expect(result.current.state.compacting).toBeUndefined();
});

it("tears the in-progress affordance down, leaving only the result row (A13)", async () => {
  await runSlashCommand("/compact");
  const text = rendered();
  expect(text).toContain("compacted");
  expect(text).not.toContain("compacting…");
});
```

- [ ] **Step 6: Run to verify they fail** — the second fails today: `useChat.ts:781` appends the
  in-progress line permanently.

- [ ] **Step 7: Implement**

Consume `system/status` with `status === "compacting"` in the system-frame arm to set
`compacting = { startedAt: nowFn() }`, and clear it in the existing `compact_boundary` branch (which
already runs at `:557`). Replace the permanent `append()` at `:781` with that same ephemeral state — the
`✦ compacted N → M` line stays a real appended row, because upstream persists its `Compacted …` message
too. Render the verb, the bar and the trailing `NN%` from the spinner surface, gated on `compacting`.

- [ ] **Step 8: Run to verify they pass; full gates; commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/tui/compactionBar.ts harness/src/tui/useChat.ts harness/src/tui/ChatApp.tsx harness/test/
git commit -m "f5(waveS-t11): /compact gets a real busy state and an ephemeral progress affordance — with upstream's fake curve labelled as such"
```

---

## Task 12: EP-S8 — the model-switch confirm (P2)

**The gate, all four conditions required** (`XMo`, L315221):

1. **Mid-conversation only** — session cumulative **output** tokens > 0. Not "messages exist": a session
   where only user text was typed switches silently.
2. **Not already acknowledged at this output count** — confirming stamps
   `cacheMissAckedAtOutputTokens = <current output tokens>`; you are not re-prompted until the model
   produces more output.
3. **The resolved model ids actually differ** — aliases resolve first, so `sonnet` → `claude-sonnet-…` is
   not a change.
4. **Context-window variants do not count** — strip a `[1m]`/`[2m]` suffix before comparing.

**Copy, verbatim (L447014-447039):**
```
Switch model?
Your next response will be slower and use more tokens

This conversation is cached for the current model. Switching to <TARGET> means the full history gets re-read on your next message.

  Yes, switch to <TARGET>
  No, go back
```
`<TARGET>` is the model's display name, rendered **bold**. Frame colour `warning`.

**Accepting** stamps the ack and performs the switch. **Declining** changes nothing and stamps nothing, so
the same switch prompts again.

**The ordering trap (W-S9).** `ModelPicker.tsx:60` writes the "set as default" pref **inside the picker,
before `onPick`** — with an explicit comment saying the write goes first so a caller unmounting the picker
cannot race it. A confirm gated at `pickModel` therefore leaves the pref **written after a decline**. Gate
**before** the prefs write.

**Files:**
- Create: `harness/src/tui/modelConfirmModel.ts`, `harness/src/tui/ModelSwitchConfirm.tsx`
- Create: `harness/test/unit/model-confirm.test.ts`
- Modify: `harness/src/tui/ModelPicker.tsx` (`choose`, ≈52-62)
- Modify: `harness/src/tui/useChat.ts` (`pickModel`, ≈1061) and `ChatApp.tsx` (the overlay chain)
- Test: `harness/test/tui/model-picker.test.tsx`

**Interfaces:**
- Produces from `src/tui/modelConfirmModel.ts`:
  ```ts
  export const CONFIRM_TITLE = "Switch model?";
  export const CONFIRM_SUBTITLE = "Your next response will be slower and use more tokens";
  export const CONFIRM_CANCEL = "No, go back";
  export const confirmBody = (target: string) => …;      // returns RenderLine[]-shaped segments, target bold
  export const confirmAccept = (target: string) => `Yes, switch to ${target}`;
  export function needsModelConfirm(a: { next: string; current?: string; sessionModel?: string; outputTokens: number; ackedAt?: number }): boolean;
  export function stripContextSuffix(id: string): string;  // /\[(1|2)m\]/gi → ""
  ```
- Consumes: `resolveModelAlias` (`config/models.ts:26` — synchronous and pure, already imported by
  `useChat.ts:55`; it needs no injection) and the session's cumulative output tokens. Reuse
  `commands.ts:130`'s `sum(models, "outputTokens")` rather than adding a second accumulator — **it is
  module-private today, so export it** as part of this task.

- [ ] **Step 1: Write the failing gate tests**

```ts
const base = { next: "claude-opus-5", current: "claude-sonnet-5", outputTokens: 500 };
it("does not prompt before the model has produced output", () => {
  expect(needsModelConfirm({ ...base, outputTokens: 0 })).toBe(false);
});
it("does not prompt again at the same output count once acknowledged", () => {
  expect(needsModelConfirm({ ...base, ackedAt: 500 })).toBe(false);
  expect(needsModelConfirm({ ...base, ackedAt: 400 })).toBe(true);
});
it("does not prompt when the alias resolves to the same model", () => {
  expect(needsModelConfirm({ ...base, next: "sonnet", current: "claude-sonnet-5" })).toBe(false);
});
it("does not prompt for a context-window variant of the same model", () => {
  expect(needsModelConfirm({ ...base, next: "claude-sonnet-5[1m]", current: "claude-sonnet-5" })).toBe(false);
});
it("prompts on a real mid-conversation switch", () => {
  expect(needsModelConfirm(base)).toBe(true);
});
it("carries upstream's copy verbatim", () => {
  expect(CONFIRM_TITLE).toBe("Switch model?");
  expect(CONFIRM_SUBTITLE).toBe("Your next response will be slower and use more tokens");
  expect(confirmAccept("Opus 5")).toBe("Yes, switch to Opus 5");
  expect(CONFIRM_CANCEL).toBe("No, go back");
});
```

- [ ] **Step 2: Run to verify they fail** — Run: `npx vitest run test/unit/model-confirm.test.ts`

- [ ] **Step 3: Write the model and the component**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Add the props the confirm needs, then write the failing ordering test**

**`ModelPicker` has neither of the inputs the gate needs.** Its props today are
`{ models, current, sessionModel, onPick, onCancel, savePrefs, rows, columns }`
(`ModelPicker.tsx:31-44`) — no `outputTokens`, no `ackedAt`. Add both, and **decide where the ack lives**:
it cannot live in the picker, because the picker unmounts on pick (`useChat.ts:1064`), so
"does not re-prompt at the same output count" is only satisfiable if `useChat` owns the ack and threads it
back in. Say so in your report; that ownership is the task's one real design decision.

**Two fixture traps, both of which make the obvious test fail for the wrong reason (plan review):**
- `test/tui/model-picker.test.tsx:26-30` defines `MODELS` as **tier aliases** (`opus`, `sonnet`, `haiku`),
  not resolved ids. So `current="claude-sonnet-5"` plus picking `sonnet` makes `needsModelConfirm` **false**
  by rule 3 — no confirm appears, `savePrefs` fires, and the assertion fails without testing anything.
  Either set `current` to an alias the fixture actually contains, or resolve aliases inside
  `needsModelConfirm` (which is what the real path does) and give the test a genuinely different model.
- `ModelPicker.tsx:60` writes `savePrefs({ model: m.value })` — the **raw alias**. Alias resolution happens
  downstream at `useChat.ts:1067`. So `toHaveBeenCalledWith({ model: "claude-opus-5" })` can never hold;
  assert the alias the fixture uses.

```tsx
it("does not write the default-model pref when the confirm is declined (W-S9)", async () => {
  // props/fixture per the two traps above — this is the assertion, not the fixture
  await pressUntilConfirmShows();
  expect(savePrefs).not.toHaveBeenCalled();          // the pref must not be written BEFORE the confirm
  await decline();
  expect(savePrefs).not.toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
});

it("switches and writes the pref when the confirm is accepted", async () => { /* … */ });
it("does not re-prompt at the same output count after accepting", async () => { /* … */ });
```

- [ ] **Step 6: Run to verify it fails** — the pref is written before `onPick` today
  (`ModelPicker.tsx:60`).

- [ ] **Step 7: Gate before the prefs write**

In `ModelPicker.tsx`'s `choose`, evaluate `needsModelConfirm` **first** and short-circuit into the confirm
state, leaving the existing write-then-`onPick` ordering intact on the accepted path. Update the comment
that currently explains why the write goes first: it still goes first **relative to `onPick`**, and now it
goes after the confirm.

- [ ] **Step 8: Run to verify it passes; full gates; commit**

```bash
npm run typecheck && npm run test:unit && npm run test:tui
git add harness/src/tui/modelConfirmModel.ts harness/src/tui/ModelSwitchConfirm.tsx harness/src/tui/ModelPicker.tsx harness/src/tui/useChat.ts harness/src/tui/ChatApp.tsx harness/test/
git commit -m "f5(waveS-t12): mid-conversation model switches confirm first — gated before the prefs write"
```

---

## Task 13: Final verification — execute the spec's acceptance as written

The tests prove the parts; this task proves the wave. **Every criterion below is run by the controller, not
by an implementer**, because half of them need a keyed live session (Global Constraint 1). An implementer
reaching this task should run the keyless subset, report exactly which cells it could not run, and stop.

- [ ] **Step 1: Full suite**

```bash
cd harness && npm run typecheck && npm run test:unit && npm run test:tui && npm run build
```
Record every count.

- [ ] **Step 2: ANCHORS-1 — already measured and closed; re-run only as a regression check**

Done at plan time, keyed, by `probes/probes/68e-anchors-after-compaction.ts`. Result: a manual `/compact`
took a four-anchor session to **one** anchor with zero survivors, so the premise on file is correct and
the spec review's contrary fixture was wrong — **and it is not a defect.** The reader returns the
compacted view, so the pre-boundary prompts are not in its output at all, which is honest: the model no
longer holds those turns. Nothing is built for it (spec Surprise 7).

Re-run it only if the SDK version has moved since:

```bash
cd CC-to-SDK && export HOME=/tmp/ws-anchors-$$ && mkdir -p "$HOME" && export CCX_FLEET_ROOT="$HOME/fleet"
set -a; . ./.env; set +a
cd probes && npx tsx probes/68e-anchors-after-compaction.ts
```
Expected tail: `VERDICT: pre-boundary anchors are GONE; only post-boundary prompts remain.`

- [ ] **Step 3: Keyless acceptance cells**

| Criterion | Command | Expected |
|---|---|---|
| A2 | `npx vitest run test/unit/rewind-rebuild.test.ts` | 6 pass, including the `parentUuid` guard |
| A4 | `npx vitest run test/tui/rewind-picker.test.tsx` | the three A4 guards pass |
| A5 | `npx vitest run test/tui/model-picker.test.tsx` | counter follows the rendered window |
| A6 | `npx vitest run test/tui/settings-dialog.test.tsx test/tui/permissions-dialog.test.tsx` | indicators + paging on both |
| A7 | `npx vitest run test/tui/commands.test.ts -t "cache tokens"` | pass |
| A11/A12 | `npx vitest run test/tui/session-picker.test.tsx` | pass |
| A13 | `npx vitest run test/unit/compaction-bar.test.ts` | the five curve reference points pass |
| A14 | `npx vitest run test/unit/model-confirm.test.ts` | all four gate conditions pass |

- [ ] **Step 4: Keyed live cells (controller only)**

Isolate first, every time:

```bash
export CCX_HOME=/tmp/ws-verify-$$
mkdir -p "$CCX_HOME"
export HOME="$CCX_HOME" CCX_FLEET_ROOT="$CCX_HOME/fleet"
cd CC-to-SDK && set -a; . ./.env; set +a
```

- **A1** — three prompts, restore to before the second, assert the settled frame shows the first turn and
  **no further input**, at the moment the rebuild settles and *not* after a follow-up turn. Then ask the
  model what it remembers, and verify the answer against the transcript.
- **A2** — the same, on a session that has already been `/compact`ed: the replay shows the post-boundary
  conversation only and never a pre-boundary turn.
- **A3** — after **one** completed turn: `/status` prints a session line; `/rename` and `/tag` report
  success; `/export` writes a file; `/files`, `/stats` and the Settings Stats tab render session-scoped
  content.
- **A4b** — restore to the session's **first** message: a conversation restore is offered, and taking it
  yields an empty conversation.
- **A8** — immediately after `/clear` no context percentage is shown, **and** a freshly measured one
  appears when the first post-clear turn ends. Both halves.
- **A9** — the id from `/status` and the id from the detachable banner each resume their session through
  `--resume`; an id that resolves to nothing fails loudly instead of opening a fresh REPL; a banner id for
  a session that never completed a turn reports the third outcome.
- **A10** — `ccx --continue` reopens the most recent session for the directory.
- **A13** — `/compact` on a real conversation enters the busy state, shows the bar, and leaves the
  transcript carrying the result row only.

Apply W-S10 to every cell: dialog-scoped needles carrying the dialog's own border, state verified after
every keystroke, and the same scrutiny for a cell that passes first try as for one that fails.

- [ ] **Step 5: Write the outcome into the spec**

Fill `## Outcomes & Retrospective` in
`docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md`: which criteria were met with what
evidence, every residual named with its measurement, the ANCHORS-1 answer, and the divergences recorded
under W-S11. Then refresh `docs/parity/coverage.md`.

- [ ] **Step 6: External whole-branch review**

Per the root `CLAUDE.md`: `doperpowers:codex-companion`'s `review` verb with `--base <the commit Wave S
started from> --model gpt-5.6-sol`, run in a background Bash with stderr redirected to a scratch file.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md CC-to-SDK/docs/parity/coverage.md
git commit -m "f5(waveS-t13): wave verification — acceptance executed, outcomes and residuals recorded"
```

---

## Appendix: what this plan deliberately does NOT build

Named here so no implementer builds them by inference, and so the final reviewer does not read them as
gaps.

| Item | Why not | Where it is recorded |
|---|---|---|
| Walking `parentUuid` in `rows.ts` or anywhere else | The SDK reader already resolves the branch, strips the field, and carries compaction relinking a naive walker would ignore | W-S1; Task 1 Step 14 is a standing guard |
| The two `Summarize` rewind options | They need a ranged compaction the SDK does not expose — `session.compact()` takes no range | spec EP-S3; `rewindModel.ts:197,216` |
| `Ctrl+B` (all branches) in `/resume` | `listSessions` has no branch axis to widen | CTRL-B-1, open question; Task 10 records it in code |
| Persisting client-side slash entries into the session store | Touches replay, rewind anchors and `/export` together | W-S7 / SLASH-PERSIST-1, deferred to Wave C spec time |
| The `/resume` preview rendered through the real transcript renderer | ccx's fixed tail is a recorded deliberate design; changing it is a priced feature, not a correction | spec Deferred |
| Interruptible `/compact` | `session.compact()` is a capped-timeout op over the UDS with no cancel path; a cancel is a wire change | spec Deferred |
| Anything for ANCHORS-1 | **Measured and closed at plan time** (probe 68e): anchors genuinely do not survive a compaction, and that is honest — the model no longer holds those turns, so offering to rewind to one would be an offer to restore a conversation nobody has | spec Surprise 7; Task 13 Step 2 |
