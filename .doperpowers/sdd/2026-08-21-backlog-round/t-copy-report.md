# T-COPY report — `/copy N` indexes a 20-deep recent-assistant ring

Branch: `worktree-agent-a44c9f1979292b8b0`. Commit: `87ba6ec6cf`.

## What was built

**`CC-to-SDK/harness/src/sessions/rows.ts`** — `lastAssistantText(messages): string` (single-slot,
early-return) became `recentAssistantTexts(messages, cap = RECENT_ASSISTANT_CAP): string[]`
(newest-first, `push` instead of early-return, stops at `cap` COLLECTED entries — the walk keeps
going past skipped/filtered rows, matching canon's `sHw=20` semantics exactly). `RECENT_ASSISTANT_CAP
= 20` is now an exported constant shared by the default param and by `useChat.ts`'s ring cap, so the
number 20 has exactly one home. Two fidelity changes landed here per the brief's DECIDED list:
1. Text blocks within one assistant message now join with `"\n\n"` (was `"\n"`), matching canon's
   `xd(o, "\n\n")`.
2. The list gate is now bare truthiness on the joined string (`if (t)`), not `.trim()` — a reply whose
   only content is a whitespace-only text block now qualifies and enters the ring, matching canon's
   `if (i)`.

The `syntheticAssistant` filter (api-error / disk-synthetic-marker skip) is unchanged and still applies
to every candidate row, not just the head — so a synthetic frame can never surface at ANY `N`, not just
at N=1.

**`CC-to-SDK/harness/src/tui/useChat.ts`**:
- `lastAssistant` (line 799) is now `useRef<string[]>([])` instead of `useRef("")`.
- The live wire-path assignment (~1522-1536): the block-join changed to `"\n\n"`, the gate changed from
  `t.trim()` to bare `t`, and the assignment changed from overwrite (`lastAssistant.current = t`) to
  unshift-and-cap (`[t, ...lastAssistant.current].slice(0, RECENT_ASSISTANT_CAP)`). The pre-existing
  `appended` guard, the `!data.parent_tool_use_id` nesting guard, and the `is_api_error_message !==
  true` filter are untouched — only the storage shape and the entry semantics changed.
- `/clear`'s reset (~1249) changed from `""` to `[]`.
- Resume seeding (`resumeInto`, was line 2254, now 2280 after edits) and rewind seeding
  (`rebuildAfterRewind`, was 2730, now 2756) both now call `recentAssistantTexts(msgs)` /
  `recentAssistantTexts(rows)`, seeding the WHOLE ring in one assignment instead of just slot 0 — this
  is the change the brief called "today's gap."
- The dispatch arm (`case "copy":`, was a single line at 2009) is now a full block implementing canon's
  validation grammar: empty ring → `No assistant message to copy`; a non-empty, non-integer, or `<1`
  argument → `` Usage: /copy [N] where N is 1 (latest), 2, 3, … Got: <arg> `` (the real U+2026 ellipsis
  character, not three ASCII dots); an in-range integer indexes `ring[N-1]`; an out-of-range integer →
  `` Only <n> assistant <message|messages> available to copy `` (singular iff the ring has exactly one
  entry). On success the notice text became canon's `` Copied to clipboard (<N> characters, <M> lines)
  ``, replacing ccx's `✓ copied <N> chars`. Line count is `(t.match(/\n/g)?.length ?? 0) + 1`, matching
  canon's `Sp(e,"\n")+1`. `cmd.args` arrives already-trimmed from `parseCommand` (commands.ts), matching
  canon's `r?.trim()`.

No changes were made to `commands.ts` — the brief's "Shape" section did not ask for a catalog-summary
update, and none of the required tests needed one.

## Tests and what each kills

**`test/unit/rows.test.ts`** — the `lastAssistantText` describe block was replaced with a
`recentAssistantTexts` block (27 tests total, up from ~10):
- "index 0 is the newest reply" / "orders every entry newest-first" — die against any implementation
  that keeps the old early-return (would only ever produce a length-1 or length-0 array).
- "caps at 20 by default — the 21st-oldest reply falls off the ring" + "a list of exactly 20 replies is
  not truncated" — die against a missing or off-by-one cap (`< cap` vs `<= cap`, or a scan-count cap
  instead of a collected-count cap).
- "cap is overridable by the caller" — dies if `cap` isn't threaded through to the loop condition.
- "joins multiple text blocks... with a blank line" — dies against the un-migrated `"\n"` join (this
  test replaces the old test that asserted `"one\ntwo"`; it now asserts `"one\n\ntwo"`).
- "bare-truthiness gate: a whitespace-only text block QUALIFIES" — dies against a lingering `.trim()`
  gate (would produce `[]` where the new behavior yields `[" "]`).
- "skips api-error rows everywhere in the ring, not just at the head" — dies against a filter that only
  guards the return-once path (i.e., a naive index-`0`-only guard).
- Existing disk-synthetic-marker and empty-transcript cases carried over, re-pointed at the new function.

**`test/tui/useChat.test.tsx`** (new/changed in the `/copy` describe block):
- "/copy after an assistant message... notices canon's byte-exact confirmation" — dies against the old
  `✓ copied N chars` string, and against a wrong `M lines` computation (asserts the exact
  `(17 characters, 1 lines)` shape, computed from the actual text length, not hand-counted).
- "/copy 1 is equivalent to bare /copy" — dies if `cmd.args` handling doesn't treat `"1"` as index 0.
- "/copy 2 reaches the second-newest reply through the live ring, built by real frame delivery" — the
  WIRING test: delivers two full turns via `fake.pushEvent({kind:"turn"...})` / `{kind:"message"...}` /
  `{kind:"turn", phase:"end"}` (the same idiom every other live-path test in the file uses), then asserts
  `/copy 2` and `/copy 1` reach the correct texts. This dies if the unshift-and-cap at the live
  assignment site is deleted or reverted to overwrite semantics — confirmed by deleting that one line
  locally and re-running: the test failed with `copied` staying at the newest text for `/copy 2`.
- "/copy <non-numeric> prints canon's usage string byte-exact, with the real ellipsis (U+2026)" — dies
  against a 3-dot `"..."` substitute (explicit `toContain("…")` assertion) and against any wording
  drift from the brief's exact string.
- "/copy 0 and /copy -1 are also usage errors" — dies against a naive `Number(arg) > 0` check that
  doesn't also test `Number.isInteger` (canon's grammar admits e.g. `"0x2"` as valid but rejects `0`
  and negative integers via the `< 1` guard) — confirms `Number.isInteger(n) && n >= 1` is the actual
  gate, not `n > 0`.
- "singular 'message' with exactly one available" / "plural 'messages' with 2+" — die against a fixed
  string (no `n===1` branch) in either direction.

**`test/tui/useChat-rewind.test.tsx`**:
- "5c. after a rewind, /copy 2 reaches the second-newest replayed reply — the whole ring is seeded, not
  just slot 1" — the brief's named wiring test for the disk path. Seeds a two-assistant-message
  transcript, rewinds, then asserts `/copy 2` reaches the OLDER of the two texts. Dies against the
  pre-fix single-slot seed (`lastAssistant.current = recentAssistantTexts(rows)[0] ?? ""`, or any
  seeding that only populates index 0) — confirmed by reverting the rewind seed line locally: the ring
  had length ≤1 and `/copy 2` fell into the out-of-range branch instead of returning the older text.
- The pre-existing "5b." test's `✓ copied` wait/assert moved to `Copied to clipboard`.

**`test/tui/useChat.test.tsx`** also gained a resume-path counterpart (not explicitly named in the
brief's file list, but flagged as an open gap in the research report and cheap to close alongside the
rewind case, since the two seed sites are structurally identical): "/resume seeds the whole ring from
disk — /copy 2 reaches the second-newest replayed reply," built on the existing `/resume → pick` test's
scaffold (`makeSession`/`listSessions`/`getSessionMessages`/`pickSession`), asserting the same
whole-ring-seeded property on the resume site (`resumeInto`, not `rebuildAfterRewind`).

## Gates

- `npm run typecheck` — clean, no errors.
- `npx vitest run test/unit/rows.test.ts test/unit/copy.test.ts test/tui/useChat.test.tsx
  test/tui/useChat-rewind.test.tsx` — 4 files, 232 tests, all passing (copy.test.ts, the clipboard
  transport test, was untouched and green as expected — the index never reaches it).
- `npm run test:tui` — full suite, 152 files / 3880 tests passed, 9 live/e2e files skipped (no
  API key/token in this environment, as expected for a worktree run).

## Brief disagreements / notes

None material. One small addition beyond the brief's explicit file list: a resume-path ring-seeding
test in `useChat.test.tsx` (see above) — the brief's "Tests" section named the rewind case explicitly
but not resume; the research report flagged resume as an uncovered gap worth closing since the two
seed sites (`resumeInto` line ~2280, `rebuildAfterRewind` line ~2756) are structurally identical and
share the exact same `recentAssistantTexts(...)` call shape. Cost was low and it directly proves the
resume half of "BOTH paths" from the brief's Goal statement.

One test-authoring wrinkle, not a behavior disagreement: the usage-string assertion had to switch from
`frame()` (which only folds a hard line-wrap's `\n` to a single space) to `flat()` (which also collapses
the resulting run of whitespace) — the notice line is long enough to wrap at the test terminal's default
width, and every other long-line assertion elsewhere in the file already uses `flat()` for this reason.
Not a brief disagreement, just matching existing test-file convention.
