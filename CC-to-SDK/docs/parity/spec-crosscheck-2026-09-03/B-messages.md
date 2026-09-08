# Lane B — §41.15–§41.18a (screen composition, message/tool-result rendering, markdown, spinner, narration)

Spec read: `41-tui-rendering.md` lines 2809–5989 in full, plus `A5-cross-version-notes.md` §A5.11.17/.18.
Bundle used for verification: `~/claude-code-bundle/2.1.257/cli.pretty.js` (line numbers below are that file).
Our side: `harness/src/tui/` (abbreviated `$T` = `/Users/new/Developer/GitHub/somersault/CC-to-SDK/harness/src/tui`),
`docs/parity/tui-ux.md`, `docs/superpowers/specs/2026-08-31-bl10-menus-click-spacing-design.md`.

Every finding is labelled **verified** (I read the bundle line myself) or **spec-only**.

> **Erratum, resolved.** The first draft of this report read `harness/src` from
> `/Users/new/Developer/GitHub/**codex_**somersault/CC-to-SDK`, a frozen checkout that predates the bl10
> merge, and therefore wrongly concluded that the T-SPACE spacing invariant was unimplemented. Everything
> below has been re-verified against `/Users/new/Developer/GitHub/somersault/CC-to-SDK`; §7 records the
> disposition of every affected item and the line numbers in the body are the somersault tree's.
> The 24 files that differ between the two trees are listed in §7.

---

## 0. Top takeaways

1. **The shipped T-SPACE invariant is canon-correct, including the exception canon has and the spec never
   states.** Canon gives `marginTop: 1` to every content-block arm *except* `tool_result` (and
   `tool_search_tool_result`), so the `⎿` result is glued to its `⏺ Tool(args)` header. ccx gets this
   right structurally rather than by special case: the separator is keyed to a *pushed unit's first item*
   (`$T/toolRenderer.tsx:694-695`) and a tool call's header and result are one unit
   (`$T/toolRenderer.tsx:565-604`), so no separator can land between them. **verified both sides.** → §1.1
2. **The spinner sub-line does not exist in ccx.** Canon's spinner is a *block*, not a row: line 2 is
   `narration` → `Next: <task subject>` → `<label>: <tip>`, backed by a 70-entry tip registry with a
   deterministic (not random) selection rule and `~/.claude.json` persistence. Fully reachable. → §2.1
3. **The spinner verb re-rolls on every phase transition in ccx; canon rolls it once and holds it for the
   whole turn.** `$T/TurnSpinner.tsx:80-83` vs `chunk-zf8f7hb4.js:849671` + `chunk-bq8epagv.js:426015`.
   User-visible churn mid-turn. **verified.** → §1.2
4. **Four missing markdown tokenizer overrides** change what renders: `~x~` should *not* strike, `[a][b]`
   should render literally (link-reference definitions are disabled), a table with `|` inside a backtick
   span should still parse, and our fast-path regex silently drops `+ ` bullets, `1)` ordered lists and
   setext headings into plain paragraphs. **verified.** → §1.3
5. **Generic MCP tool results have no typed renderer in ccx** — canon has four (`[Image]`, `(No content)`,
   an oversize warning, and a 20-column progress bar), plus a `Waiting for permission…` body that replaces
   any result while a permission prompt is open. Both reachable from SDK frames. → §2.2
6. **Canon keeps the spinner row while compacting and adds the gauge as a second row**; ccx replaces the
   spinner with `CompactionRow` entirely (`$T/ChatApp.tsx:2000-2006`). Structural, not a string fix. → §3
7. **Turn narration is 257-only, off by default, and fullscreen-only.** Record it; do not build it. The
   verbatim prompt and the full digest format are in the spec if we ever want it. → §2.3

---

## 1. Corrections — things we built that canon does differently

### 1.1 The spacing invariant — **NOT a correction. Shipped, and canon-correct including the exception.**

*(Retained under §1 because the canon evidence is the independent verification the bl10 close-out did not
have: the spec chapter never states the rule, so nothing outside this report confirms it arm by arm.)*

**What canon does.** The message row component computes `addMargin = !hasMetadataHeader`
[`chunk-bq8epagv.js:393286`] and passes that one value to every content block of the message
[`chunk-bq8epagv.js:393289`, `:769174`]. The block-level switch then threads `addMargin` into **every arm
except two**:

| arm | gets `addMargin`? | line |
|---|---|---|
| `text` (user + assistant) | yes | `769316`, `769323` |
| `image` | yes | `769332` |
| **`tool_result`** | **no** | `769337-769341` |
| `tool_use` | yes | `769386` |
| `text` (assistant inner) | yes | `769405`, `769412` |
| `redacted_thinking` | yes | `769422` |
| `thinking` | yes | `769427`, `769440` |
| `server_tool_use` / `advisor_tool_result` | yes | `769451` |
| **`tool_search_tool_result`** | **no** | `769460` |

Consumers turn it into a literal `marginTop`: assistant prose is
`const ie = Oo ? 1 : 0; … r(o, { …, marginTop: ie, … })` [`chunk-vp8nzhw3.js:763399`, `:763411`];
the tool-use row is `const fl = Mj ? 1 : 0; … r(o, { marginTop: fl, … })`
[`chunk-vp8nzhw3.js:762424`, `:762457`]. The `⎿` result wrapper `Ie` has **no margin prop at all** —
it is `e(P, { children: r(o, { flexDirection: "row", height: g, overflowY: "hidden", children: [y, N] }) })`
[`chunk-ezp5bkhr.js:494486-494505`]. And when a metadata header *is* present, the gap does not vanish:
the header row carries `marginTop: 1` itself [`chunk-bq8epagv.js:393313`].

**What ccx ships, and why the exception costs it nothing.** T-SPACE models the rule as a separator *item*
rather than a `marginTop` field (D6/D7), minted by one shared gate
[`$T/toolRenderer.tsx:694-695`]:

```ts
export const withLeadingSeparator = (items: readonly RenderItem[]): readonly RenderItem[] =>
  items.length === 0 ? items : [separatorItem(items[0]!.id), ...items];
```

The unit it wraps is a whole tool call, not a row: `toolEventItems`
[`$T/toolRenderer.tsx:565-604`] returns the header and the result in one array —
`{ kind: "line", id: \`${event.id}:call\` … }` at `:581` and
`{ kind: "gutter-block", id: \`${event.id}:result\`, gutter: TOOL_RESULT_GUTTER … }` at `:602`. The
separator therefore keys on `…:call` and lands above the header; **nothing can place one between the
header and its `⎿` result.** The canon exception is satisfied by construction rather than by a
gutter-block guard, which is the stronger form — a future unit that legitimately begins with a
gutter-block (a standalone `⎿` interrupt row, `$T/species.ts:296`) still gets its blank, and canon agrees,
because that row is a `text`-arm user message and *does* carry `addMargin`.

Call sites, all gated the same way: `foldAnchored`'s two arms [`$T/toolRenderer.tsx:1667`, `:1671-1672`],
`projectAll`'s five [`:1834-1847`], `projectPending`'s five [`:1931-1955`], the per-content-block loop
[`:947`], the streaming region [`$T/streamingItems.ts:49-51`] and the classic path's raw-`RenderLine`
mirror [`$T/Transcript.tsx:23-40`].

**Both D17 exemptions check out against canon:**

- **Expanded cluster, outer separator suppressed** [`$T/toolRenderer.tsx:704-705`]: an expanded group is
  handed straight through because each member already carries its own leading blank. Canon's verbose
  branch likewise puts no margin on the container — each member row gets its own unconditional
  `marginTop: 1`. Consistent with 257's arm table above (every member is an ordinary block).
- **Live hook counter, exempt** [`$T/toolRenderer.tsx:1959-1963`]: correct as reasoned, with one nuance —
  the row is a ccx addition (bl8 D6) with no counterpart in 2.1.257 (`grep 'hook…'` finds no such counter
  in this build), so its exemption is a local design call, not a canon transcription. Not a defect;
  worth a footnote in the close-out.

**Two canon data points the shipped work already matches, recorded so they are not re-litigated:**
- `marginTop: 1` is unconditional on standalone blocks outside the message switch, e.g. `EnterPlanMode`
  [`chunk-vp8nzhw3.js:764557`] and the hook/memory-recall sub-blocks [`chunk-vp8nzhw3.js:767770`, `:767774`]
  — the same shape as the spinner-slot wrapper [`$T/ChatApp.tsx:2001`].
- There is **no document-start suppression**: `addMargin` never reads the index, which is what
  `$T/Transcript.tsx:29-30` and the `withLeadingSeparator` no-index gate implement.

**One residual worth a look, not a finding.** Our separator sits above *standalone* hook blocks
[`$T/toolRenderer.tsx:1671`, `:1839`, `:1955`]. In 2.1.257 the completed-run hook summary renders *inside*
the owning tool-use subtree [`chunk-vp8nzhw3.js:767774`] and so inherits that block's margin rather than
having one of its own; canon has no standalone hook block to compare against. Our choice is the only
coherent one given our flat model — noting it so a future reviewer does not read the difference as drift.

### 1.2 The spinner verb re-rolls mid-turn — **verified**, unchanged 251→257

**What we do.** `$T/TurnSpinner.tsx:80-83` calls `rotateVerb` on every phase transition, and
`$T/spinner.ts:239-241` re-picks whenever `kind !== previousKind`. Phase kinds are
`tool-running | tool-done | thinking | thought-for | none` (`$T/spinner.ts:159-164`), so a normal turn
that thinks, runs a tool, thinks again cycles through three different gerunds. `docs/parity/tui-ux.md`
§3 records this as deliberate: "The verb is also re-picked between phases now (t6), not fixed per turn."

**What canon does.** `defaultVerb` is sampled once, when the per-agent spinner record is materialised
[`chunk-zf8f7hb4.js:849671`], and re-rolled only by `resetOverrides()`
[`chunk-zf8f7hb4.js:849715`], whose sole caller is `resetLoadingState`
[`chunk-bq8epagv.js:426015`] — invoked at interrupt (`:426149`) and at the three query-completion sites
(`:426399`, `:426458`, `:426514`). Nothing in the mode/phase machinery touches it: `setMode`, `setMessage`,
`setColors`, `setTurnEffort`, `setRetryStatus`, `setCompacting` all leave `defaultVerb` alone
[`chunk-zf8f7hb4.js:849685-849714`]. Spec §41.18.6 states it plainly: "Within a turn the word does not
change."

**Impact.** Cosmetic but constant: canon's spinner reads one word for a whole turn; ours churns. Low cost
to fix (drop `rotateVerb`, keep the ref).

### 1.3 Four markdown tokenizer behaviours we inherit from stock `marked` — **verified**

Canon installs three tokenizer overrides once [`chunk-hn8xn3fc.js:544279-544306`] plus a fast-path regex
[`chunk-p1jzptgf.js:631673`]. We install none and use a narrower regex.

| # | canon | ours | user-visible |
|---|---|---|---|
| a | `del` override: only `~~x~~` strikes; single `~x~` does not [`chunk-hn8xn3fc.js:544280`] | GFM default (`$T/markdownInline.ts:148-151`) | `~approx~` renders struck in ccx, plain in canon |
| b | `def` override returns `undefined`, **disabling link reference definitions entirely**, so `[text][id]` renders literally [`chunk-hn8xn3fc.js:544285`] | `def` renders nothing (`$T/markdown.ts:207`) but marked's default `def` tokenizer still *consumes* the definition line and resolves `[text][id]` into a link | ccx swallows `[id]: url` lines and turns `[a][b]` into a hyperlink; canon shows both literally |
| c | `table` override: re-runs the stock tokenizer after escaping `\|` inside backtick spans, and bails to a paragraph when any row has more cells than the header [`chunk-hn8xn3fc.js:544295`] | none | a markdown table containing `` `a\|b` `` in a cell mis-splits in ccx |
| d | fast-path regex `_t` also matches `\r` forms, `+ ` bullets, `N)` ordered markers and setext `===` headings [`chunk-p1jzptgf.js:631673`] | `FAST_PATH = /[#*\`\|[>\-_~]\|\n\n\|(?:^\|\n) {0,3}\d+\. \|https?:\/\/\|www\./` (`$T/markdown.ts:50`) | a message that is *only* `+ one` / `+ two`, or `1) one`, or a setext heading, skips the lexer and renders as one plain paragraph |

(d) is the sharpest of the four: the miss is silent and the whole message loses its structure.
Canon also caps the LRU at 500 entries [`chunk-p1jzptgf.js:631673`] — same as ours (`$T/markdown.ts:51`).

One more, smaller: canon has a **separate `Marked` instance for prompt mode** that additionally disables
`table`, `blockquote`, `hr`, `lheading`, `link`, `autolink`, `url`, `escape` and `br`, and turns off
underscore emphasis while keeping asterisk emphasis [`chunk-hn8xn3fc.js:544307`]. Our user-echo path
(`$T/render.ts` `userEchoLines`) does not gate the grammar this way, so a user prompt containing `_x_` or
a `---` line renders as markdown chrome in ccx and as literal text in canon. **verified** (the guard is
`return e.startsWith("_") ? void 0 : !1;`).

### 1.4 Reduced-motion spinner glyph is the wrong character — **verified**

Ours pins the glyph to `spinnerBase(env)[0]`, i.e. `·` (`$T/TurnSpinner.tsx:95`). Canon substitutes a
**filled circle**: `var je = "●"` [`chunk-c872axth.js:439704`], rendered in the reduced-motion branch
of the glyph cell [`chunk-c872axth.js:439708-439718`] with a colour cross-fade on the same 2000 ms cosine.
Screen-reader and `prefersReducedMotion` users see `● Baking…` in canon and `· Baking…` in ccx. One-line fix.

Also in this family, **verified**: canon's reduced-motion brief spinner substitutes the static string
`"…  "` for its animated dots [`chunk-c872axth.js:440478`]; we have no brief spinner (`CLAUDE_CODE_BRIEF`
is not a surface we implement), so this is a non-issue.

### 1.5 Timer intervals are quantised up to 16 ms multiples in canon — **spec-only**, low value

Every spinner interval goes through `zi(ms)`, which computes
`Math.ceil(ms / 16) * 16` [`chunk-fxw67fyp.js:512131-512135`], so canon's nominal 100 ms tick actually
fires every 112 ms, the 50 ms requesting tick every 64 ms, and the brief-spinner tick every 128 ms
(spec §41.18.2). We use exact 100/50 (`$T/spinner.ts:61-64`) and 120 for `RetryRow`
(`$T/RetryRow.tsx:48`). Visually indistinguishable; log as debt, not work.

### 1.6 Continuation indent inside a list item — **verified**, minor

Canon indents an item's continuation lines by `parentIndent + markerWidth + 1`, capped at
`$Qt = 32` columns [`chunk-hn8xn3fc.js:544404`, `:544330`], so wrapped/second-paragraph text aligns under
the item *text*. Ours uses a flat `"  ".repeat(depth)` for continuations (`$T/markdown.ts:170`, and per
the inventory "continuation children get bare `indent`"). For `- ` at depth 0 both give 2 columns, so
single-marker unordered lists agree; they diverge for ordered lists with two-digit markers (`10. `) and
for any item with a second paragraph.

### 1.7 `(ctrl+e to show all)` is not a canon inline string — **verified**, flag before pinning

`grep -c 'to show all' cli.pretty.js` → **0**. The phrase exists only as a *composed* transcript-screen
footer hint: `` `${chord} to ${collapsed ? "collapse" : "show all"}` `` [`chunk-bq8epagv.js:395472`].
Ours hard-codes `SHOW_ALL_HINT = "(ctrl+e to show all)"` (`$T/keys/hints.ts:122`) and appends it to the
fold marker in `detail-*` projections (`$T/outputFold.ts:18-21`). Canon's fold marker in a non-compact
projection appends nothing. Worth a decision: keep as a deliberate divergence (it is a genuine
affordance ccx needs, since our pager differs) or drop it. Not a bug — a recorded invention.

---

## 2. Unknown unknowns — canon behaviours with no scorecard row

### 2.1 The spinner sub-line and the tip registry (§41.18.7–§41.18.11) — **fully reachable**

We have no row for any of this. Canon's spinner is a **column**, not a row
[`chunk-c872axth.js:440280`]: the glyph+message+parenthetical row, an optional compaction gauge row, and a
**sub-line** whose priority is `narration` → `Next: <task subject>` → `<label>: <tip>`
[`chunk-c872axth.js:440451`]. The sub-line is drawn `dimColor`, `italic`, `wrap: "truncate-end"`, and adds
one row of bottom margin to the block [`chunk-c872axth.js:440457`].

The tip half is a complete, self-contained subsystem we could build verbatim:

- **70 static entries** with `{ id, content, cooldownSessions, priority?, maxLifetimeShows?,
  advertisedCommand?, providerAgnostic?, isRelevant?, label? }` — the full table with per-entry priority
  and cooldown is spec §41.18.7, and ~28 texts are quoted verbatim in §41.18.8.
- **Selection is deterministic, not random** [`chunk-bq8epagv.js:424978-424983`]: sort by sessions elapsed
  since last shown (descending; a never-shown tip scores `Infinity`), tiebreak on `priority` descending,
  take the winner. Killed outright by `spinnerTipsEnabled === false` [`chunk-bq8epagv.js:424986`].
- **"Sessions" means CLI startups**, tracked in `~/.claude.json` as `tipsHistory`,
  `tipLifetimeShownCounts` and `numStartups`; the recorder is idempotent within a startup
  [`chunk-dr6zwk9r.js:478608-478617`].
- **One tip per turn**, chosen at the turn boundary behind a per-turn latch
  [`chunk-bq8epagv.js:426020-426033`] — I verified the latch: `_tipPickedThisTurn` is cleared on submit
  [`chunk-bq8epagv.js:425993`] and set inside `_pickNewSpinnerTip` [`:426021-426023`].
- **Two time-based pre-emptions of the slot** [`chunk-c872axth.js:440451`], both cheap and both good UX:
  after **30 minutes** in one turn the slot shows
  `Use /clear to start fresh when switching topics and free up context`; after **30 seconds**, if
  `btwUseCount` is zero, `Use /btw to ask a quick side question without interrupting Claude's current work`.
- **Three gates on the sub-line being read at all**: the spinner must belong to the main session, brief
  mode off, no retry banner showing.

Reachability: none of this needs internal model state. `numStartups` is ours to keep; `isRelevant`
predicates read local config and env. The only entries we cannot honour are the ones advertising
commands/surfaces ccx does not have (`/powerup`, `/install-github-app`, marketplace plugins) — those are
dropped by the `advertisedCommand` filter for free.

**Also unrecorded, same block:** `Next: <task subject>` is a *separate* line from the gerund. We fold the
active task into the gerund (`$T/spinner.ts:338-341`, matching canon's message chain) but canon does
**both** — the gerund carries `activeForm`, and the sub-line carries the *next* task's subject.

### 2.2 Result forms we have no renderer for

Canon's static renderer table [`chunk-vp8nzhw3.js:764687-764714`] covers ~40 tools. Our `summaryLines`
dispatch (`$T/toolSummaries.ts:391-411`) covers 12 and falls through to a generic fold for everything else.
The ones that matter, ranked by how often a ccx user would hit them:

| canon surface | strings | line | reachable? |
|---|---|---|---|
| **generic MCP result** — `[Image]` per image block; `(No content)`; an oversize warning | `[Image]`, `(No content)` | `chunk-vp8nzhw3.js:763934` (verified at `:763925`, `:763939`) | yes — `tool_result` content blocks |
| **MCP progress** — `Running…`, `Processing… <n>`, or a **20-column bar + percentage** | `Running…`, `Processing… ${n}` | `chunk-vp8nzhw3.js:763910` (verified `:763910`, `:763916`, `:763918`) | yes — SDK `tool_progress` frames |
| **`Waiting for permission…`** replaces the whole result body while a permission prompt is open | `Waiting for permission…`, dim, `height: 1` | `chunk-vp8nzhw3.js:764923` (verified) | yes — we already see `can_use_tool` control requests |
| `claude-in-chrome` — 17 verbs → one dim line each, `switch` with no `default` (unmatched verb renders nothing) | full table in spec §41.16.7 | `chunk-vp8nzhw3.js:764045-764100` (verified at `:764045`) | yes, if the MCP server is present |
| `computer-use` — 14-verb map, **suppressed entirely in verbose mode** | — | `chunk-vp8nzhw3.js:764109`, `:764112` | same |
| `LSP` | `Found <bold N> definitions across <bold M> files`, `Hover info available`, `LSP operation failed` | `chunk-vp8nzhw3.js:764234`, `:764280` | only if we ship LSP |
| `Monitor` | `Monitor started · task <id> · persistent` / `· timeout Ns` | `chunk-vp8nzhw3.js:764576` | yes |
| `Cron*` | `Scheduled <bold id> (<schedule>)`, `Cancelled <bold id>`, `No scheduled jobs`, `(recurring)`/`(one-shot)`/`[session-only]` | `chunk-vp8nzhw3.js:764655-764662` | only with cron |
| `RemoteTrigger` | `HTTP <status> (<N> lines)` | `chunk-vp8nzhw3.js:764652` | n/a |
| `NotebookEdit` | `Updated cell <bold n>:` + highlighted code at `marginLeft: 2` | `chunk-cw0sqtdg.js:457915` | yes |
| `memory_write` | header + 10 lines capped at 200 chars each, then `… +N more lines` | `chunk-8njfdsfe.js:329667` | yes |
| `PushNotification` | four branches incl. `Terminal and mobile notification sent.` | `chunk-vp8nzhw3.js:764621` | yes |
| MCP resource tools | `(No resources found)`, `(Empty directory)`, `(No content)` | `chunk-vp8nzhw3.js:764571`, `:764637`, `:764645` | yes |
| `AskUserQuestion` rejected | `User declined to answer questions`, then one line per question | `chunk-vp8nzhw3.js:764369` | yes |
| `EnterPlanMode` declined | `User declined to enter plan mode` | `chunk-vp8nzhw3.js:764560` (verified) | yes |
| plugin/skill list tools | `<count> <noun\|nouns>` | `chunk-gecxphbv.js:515473` | yes |

Note the one canon *absence* worth recording: **`TodoWrite` has no result renderer and no
`userFacingName`** — `renderToolUseMessage` returns `null` [`chunk-1kg58a1a.js:109927`]; todos surface only
in the diff sidebar and the tasks panel. Ours suppresses it only under fullscreen
(`$T/toolFold.ts:225,243-244`), so a classic-inline ccx transcript shows `⏺ TodoWrite(...)` rows canon
never shows. That is a small correction, listed here because there is no scorecard row for it.

### 2.3 Turn narration (§41.18a) — **257-only, off by default, fullscreen-only. Record, do not build.**

A second model request per assistant round, whose one-sentence answer replaces the tip line. Gate
[`chunk-1kg58a1a.js:117551-117563`]: off if `CLAUDE_CODE_ENABLE_NARRATION === false`; off if the variable
is unset and the session is non-interactive or a coordinator; **off unless the fullscreen renderer is
active**; else `tengu_pewter_kite_ms` if > 0, else 30000 ms when the variable is truthy, else off. So the
only way to see it is to set the env var explicitly. First **two rounds of a turn are skipped**
(`roundsThisTurn <= Mzn`), subagent rounds never narrate, and the runner is single-flight.

The request uses the **main-loop model** (not a utility model), `max_tokens = 512 + thinkingBudget`,
`skipSystemPromptPrefix: true`, `querySource: "narration"` [`chunk-bq8epagv.js:396870-396895`]. System
prompt and the three instruction paragraphs are verbatim in spec §41.18a.4 and again in
`A5-cross-version-notes.md` §A5.11.17. The digest format (five labelled sections, budgets
`16000 / 600 / 140 / 2400 / 6 / 180 / 720 / 20 / 400`) is §41.18a.5. The answer is post-processed by a
regex that strips a leading bullet or `now:`/`status:`/`done:` label and rejects
`none|n/a|nothing|nothing yet|-|—|not stated|nothing to report`, then truncates to 240 chars
[`chunk-bq8epagv.js:396896-396903`].

**Reachability for ccx: high but expensive.** We can build the digest from our own transcript and issue a
separate SDK query. But: it costs a main-model call every 30 s of every turn, it is off by default even in
canon, and A5.11.17 confirms it did not exist in our current canon target (2.1.251). Recommend a
`docs/parity/tui-ux.md` "Unreachable/deferred — recorded, not built" row citing §41.18a, nothing more.

### 2.4 Smaller unrecorded canon behaviours

- **`Interrupted · What should Claude do instead?`** — we have this verbatim (`$T/toolRenderer.tsx:214`),
  but canon renders it as `Interrupted ` + dim `· ` + the detail, and the detail is a *function*
  `ic()` [`chunk-vp8nzhw3.js:762286-762296`], so other details are possible. Low value.
- **There is no strikethrough anywhere in message chrome** — an interrupted or rejected block is never
  struck through; the only struck-through chrome in the build is a completed task-board subject
  [`chunk-c872axth.js:439671`] (§41.16.10). Worth pinning as a negative so nobody "fixes" it later.
- **The bullet blinks at a 600 ms period while unresolved** (`var LU = 600`,
  [`chunk-vp8nzhw3.js:762394`]) and the **queued** state shows the bullet dim *without* blink
  [`chunk-vp8nzhw3.js:764897`]. We have the 600 ms blink (`$T/toolRenderer.tsx:282`) but no queued state.
- **Diff word-level bail is 40 %** and is skipped entirely when the diff is dimmed
  [`chunk-kzfj9g0v.js:587726`, `:587797`]. Ours bails at 0.4 (`$T/diffRender.ts:42`) — match — but we have
  no "dimmed diff" concept.
- **The collapsed one-row diff form is chosen by file path, not hunk size**: `collapsed:
  !c && (W1e(path) || G1e(path))` where those are the scratchpad and workshop path predicates
  [`chunk-2c8a92gb.js:166055`, `chunk-mdswsfsx.js:598057`]. So in canon a scratchpad file *always*
  collapses and any other file *never* does. We have no such rule — worth knowing before anyone builds
  hunk-size-based diff collapsing thinking it is canon.
- **`Ie` returns its children bare under a screen reader** (`if (Ge(i)) return h;`
  [`chunk-ezp5bkhr.js:494489`], verified) — no `⎿` gutter at all in accessibility mode. We always emit it.

---

## 3. Known gaps now specified

| tui-ux row | current | what the spec supplies |
|---|---|---|
| §2 "Markdown: links, images, strikethrough + terminal gates" 🟡 | link title suffix coloured where upstream's is not | Canon's strikethrough allowlist is exactly `iTerm.app, vscode, WezTerm, WarpTerminal, Hyper, Tabby, rio, contour, alacritty` with Apple Terminal and `TERM=linux` excluded and `CLAUDE_CODE_FORCE_STRIKETHROUGH` overriding [`chunk-hn8xn3fc.js:544189`, `:544191`] — **our list is a strict superset** (we add ghostty, mintty, JediTerm, kitty, foot, konsole, WT, Zed, VTE≥4400). Decide: trim to canon or record the superset. Also: canon's link fallback when hyperlinks are unsupported is `text (url)`, or the **bare URL** when there is no distinct label [`chunk-1rn77rys.js:163730`] — ours matches; and canon prefixes Claude artifact/frame URLs with `⧉` [`chunk-hn8xn3fc.js:544380-544400`], which we documented as not ported (`$T/markdownInline.ts:119-127`). |
| §3 "Spinner glyph" ✅ | timing model ported | Spec §41.18.2 supplies a **third frame array** `Gt = ["·","✢","*","✶","✻","✽"]` and its mirror `Os` on the same line [`chunk-ha6de7vj.js:538103`, verified] — **dead in this build**; `Jit()`/`ele()` only ever return `ct`/`ft`. Pin it as dead so nobody ports it as an ASCII fallback. |
| §3 "API-retry / stalled indicator" 🟡 | `· will retry in <dur>` deliberately dropped | Canon has **three** retry kinds, not two [`chunk-c872axth.js:440282-440344`]: `stalled` (`Waiting for API response` + a suffix naming the retry delay and suggesting a network check), `low_priority_waiting` (` · next try in <d> · attempt N · esc to interrupt` — the *only* literal "esc to interrupt" in the build, [`chunk-c872axth.js:440315`]), and default (`API error` / a rate-limit headline / the formatted error, plus the countdown and `attempt N/M`). The rate-limit headline vocabulary is `{five_hour: "session limit", seven_day: "weekly limit", seven_day_opus: "Opus limit", seven_day_sonnet: "Sonnet limit", seven_day_overage_included: "Fable limit", overage: "usage credit limit"}` [`chunk-1kg58a1a.js:66681`]. Stall telemetry thresholds are 10 s / 45 s / 300 s (`jr`, [`chunk-c872axth.js:440139`]). |
| §3 "Reduced motion" 🟡 | one named asymmetry | §41.18.3 closes it: canon's reduced-motion decision is `prefersReducedMotion \|\| (VS-Code-family/xterm.js && tengu_cedar_marsh)` [`chunk-1a9yt55g.js:6474-6478`] — i.e. a *gate* can force it on in VS Code terminals, which ours cannot. Also the exact glyph (§1.4 above) and the frame-index pin (`0`) / shimmer park (`−100`) [`chunk-c872axth.js:440194`]. |
| §2 spacing (no row exists) | — | §1.1 above supplies the complete arm-by-arm table. |
| §2 "compaction" surface | we replace the spinner with `CompactionRow` | Canon **keeps the spinner row** and adds the gauge as a *second row* of the same block, gated on a compaction percentage existing and ≥ 8 columns remaining [`chunk-c872axth.js:440266`, verified: `var … ci = 8 …`]. Our `ChatApp.tsx:1984-1989` makes them mutually exclusive. This is a structural difference, not a string one. |

---

## 4. Verbatim assets worth pinning that we do not have

Pointers, not pastes.

1. **The 70-entry spinner-tip registry** — id / priority / cooldown / lifetime-cap table at spec §41.18.7,
   and ~28 texts verbatim (plus 3 platform-branched and 10 templated) at §41.18.8. Source
   `chunk-chr1kh62.js:452514-452770`.
2. **The tip group-cooldown sets** — `["c4e-desktop","c4e-remote-sessions","c4e-ultrareview"]` at 5,
   `["workflow-size-prompting","workflow-size-prompting-ambient"]` at 12,
   `["artifact-publish-plan","artifact-duplicate"]` at 5 [`chunk-chr1kh62.js:452489`, `:452493`, `:452497`].
3. **The two time-based sub-line replacements** (30 min / 30 s) — §41.18.10, verbatim at
   `chunk-c872axth.js:440451`.
4. **`spinnerTipsOverride` limits** — text ≤ 500 chars, ≤ 200 tips, file ≤ 262144 B, label ≤ 40 chars
   default `"Tip"`, id `/^[A-Za-z0-9._-]{1,64}$/`, cooldown clamped 0…1000, priority clamped −10…10, and
   the exact control/format-character strip class `J`
   [`chunk-pyqa6hmt.js:637760`, `:637762`]. Only useful if we ship org tips.
5. **The narration system prompt + three instruction paragraphs** — §41.18a.4 (also A5 §A5.11.17). Pin
   even if we never build it; it is the only 257-only prompt in this lane.
6. **The narration digest budgets** — `16000 / 600 / 140 / 2400 / 6 / 180 / 720 / 20 / 400`
   [`chunk-bq8epagv.js:396539`] and the accept-regexes
   [`chunk-bq8epagv.js:396896`].
7. **The `claude-in-chrome` 17-verb → line map** and the `computer-use` 14-verb map — §41.16.7 tables.
8. **`hljs` scope→style map** — canon's is at [`chunk-x27cye5d.js:792167`]; I diffed it against ours
   (`$T/highlight.ts:24-47`) and they agree entry for entry, so this is a *confirmation*, not an asset to
   pin. Recorded here so nobody re-derives it.
9. **Bundled-grammar count**: canon ships **186 lazy hljs grammars plus Cedar** (registered eagerly, alias
   `cedarpolicy`) [`chunk-adw04nbw.js:366952`, `chunk-1kg58a1a.js:79922`, `:79939-79941`]. Our
   `hljsRuntime.ts` uses the full npm hljs registry (~192 + aliases). If we ever want exact parity on
   "which fences get a dim language label", that is the list.
10. **Table constants** `le=4, ie=3, wt=4, Xe=200` [`chunk-p1jzptgf.js:631377`] and the truncation string
    `` `… ${n.toLocaleString()} more ${plural(n,"row")} not shown` `` [`chunk-p1jzptgf.js:631379`] —
    we already have all four values and the string (`$T/mdTable.ts:15-24`), so this is a confirmation.
11. **Rate-limit rendering family** (§41.16.11) — six surfaces, no `Claude usage limit reached` literal
    anywhere; the family is `Usage limit reached · …`. Constants and all six texts at
    `chunk-vp8nzhw3.js:762602-762741`. Relevant if we ever surface rate limits in the transcript.

---

## 5. Confirmations — things we built that the spec (and the bundle) confirm

One line each; all **verified** against 2.1.257 unless noted.

- **Result gutter bytes.** `["  ", "⎿ \xA0"]` — 2 spaces, U+23BF, space, **NBSP**
  [`chunk-ezp5bkhr.js:494493`] = our `TOOL_RESULT_GUTTER` (`$T/species.ts:103`). Exact.
- **Two gutter spellings are canon, not our drift.** `Ky = "  ⎿  "` (two ordinary spaces) exists
  separately [`chunk-vp8nzhw3.js:765976`], and the hook header uses the same inline
  [`chunk-vp8nzhw3.js:767774`]. Our `LOCAL_OUTPUT_GUTTER`/`GROUP_HINT_GUTTER` split is correct.
- **Hook sub-line gutter is 7 columns**, `"     ⎿ "` [`chunk-vp8nzhw3.js:767774`] = our
  `HOOK_LINE_GUTTER` (`$T/toolRenderer.tsx:52`, unchanged). Exact.
- **`Ran N PreToolUse hook(s) (Xs)` hard-codes `PreToolUse`** in canon too
  [`chunk-vp8nzhw3.js:767774`] — our inventory flagged this as a possible bug; it is parity.
- **Bullet platform switch.** `vr = D() === "macos" ? "⏺" : "●"` [`chunk-yte5spsr.js:839612`] =
  our darwin ternary (`$T/toolRenderer.tsx:282`, `$T/render.ts:72`).
- **User prompt prefix.** `[N.pointer, " "]` in `subtle`, continuation indent `3 + paddingWidth`
  [`chunk-g6y5e3gn.js:513548`] — ours is `"❯ "` (`$T/render.ts:106`).
- **Overflow marker.** `` `… +${t} ${H(t, r)}` `` [`chunk-6aqvjbk0.js:287693-287697`] = our
  `formatOverflowCount` / fold marker (`$T/format.ts:87`, `$T/outputFold.ts:58`). Ellipsis is always
  U+2026, never three dots [`chunk-teb05yv9.js:717019`] — matches, and our one deliberate exception (the
  diff hunk separator `"..."`, `$T/diffRender.ts:327`) is canon too [`chunk-kdxtefbg.js:579404`].
- **Expand affordance is composed from the `app:toggleTranscript` binding** with fallback `ctrl+o`,
  lower-cased, in parens [`chunk-kvpryjd2.js:585660-585669`] = our `expandHintText` three-state contract
  (`$T/keys/hints.ts:110-142`).
- **Error truncation is 10 lines** (`var LHe = 10`, [`chunk-kvpryjd2.js:585691`]) = our
  `ERROR_PHYSICAL_ROWS` (`$T/toolRenderer.tsx:295`).
- **Error normalisation** — non-string → `Tool execution failed`; `InputValidationError: ` → `Invalid tool
  parameters` outside verbose; else prefix `Error: ` unless already `Error: `/`Cancelled: `
  [`chunk-kvpryjd2.js:585730-585743`] = `$T/toolResult.ts:236-241`. Exact, including the two exempt
  prefixes.
- **Bash header clip is 2 lines / 160 chars** (`var O = 2, h = 160`, [`chunk-wmmfgnx6.js:779571`],
  verified) = `$T/toolResult.ts:220-222`.
- **Bash's four empty states in canon's order** — background id → `returnCodeInterpretation` →
  `noOutputExpected` → `(No output)` [`chunk-fmsg6nm8.js:507139`] = `$T/toolSummaries.ts:247-248`.
- **`[Image data detected and sent to Claude]`** [`chunk-fmsg6nm8.js:507113`] = `$T/toolSummaries.ts:227`.
- **`Found N files` has no "No files found" arm** — zero results render `Found 0 files`; the
  `No files found` literal is model-facing only [`chunk-1kg58a1a.js:99945`, `:100038`] — ours matches
  (`$T/toolSummaries.ts:186`).
- **The `Found` count is bold *including its trailing space*** [`chunk-vp8nzhw3.js:764164`, `:764169`] —
  ours reproduces this (`$T/toolSummaries.ts:186-194`), so it is fidelity, not a slip.
- **`Read` result forms** — all six, and the notebook arm's `Read 1 cells` non-singular
  [`chunk-n00r5m2t.js:604360-604385`] = `$T/toolSummaries.ts:81-94`.
- **`Edit` capitalisation trick** — `Removed 3 lines` alone, `Added 5 lines, removed 3 lines` together
  [`chunk-d9r3w99q.js:468314-468320`] = `$T/diffRender.ts:58-64`.
- **`Agent` Done line** — `Done (7 tool uses · 41.2k tokens · 3m 12s)`
  [`chunk-vp8nzhw3.js:769612`] = `$T/agentProgress.ts:208-213`.
- **`Initializing…`, `(↓ to manage)`, `Backgrounded agent`** [`chunk-vp8nzhw3.js:769660`, `:769603`] =
  `$T/agentProgress.ts:59`, `$T/toolRenderer.tsx:367-374`.
- **`EnterPlanMode`** — `⏺ Entered plan mode` in the plan colour + `paddingLeft: 2` dim
  `Claude is now exploring and designing an implementation approach.` [`chunk-vp8nzhw3.js:764557`,
  verified] = `$T/toolSummaries.ts:333-336`. Byte-exact.
- **`EnterWorktree`/`ExitWorktree`/`TaskStop`/`Skill`/`WebFetch`/`WebSearch`** strings all match
  §41.16.7's table.
- **Diff.** Row shape `<space><padded number><space><marker><code><rightpad>`
  [`chunk-kzfj9g0v.js:587856`]; six theme keys `diffAdded/Removed/AddedDimmed/RemovedDimmed/AddedWord/
  RemovedWord` [`chunk-kzfj9g0v.js:587890`]; removed lines never syntax-highlighted
  [`chunk-kacn3tam.js:578706`]; context = 3 [`chunk-1kg58a1a.js:58856`]; 2000-char per-line clamp with
  `` ` … [+N chars]` `` [`chunk-kacn3tam.js:578169`, `:578177`]; **no hunk-collapse mechanic**; the Ink
  path rewinds the counter after a removed run so paired `-`/`+` share a number
  [`chunk-kzfj9g0v.js:587874`] — every one of these is in `$T/diffRender.ts` / `$T/diffSource.ts`.
  Our numbering-rewind (`$T/diffRender.ts:89-100`) is the Ink-path behaviour, which is the one that
  renders in the message list.
- **Diff syntax palette chosen from the theme *name*** — `ansi` → indexed, `dark` → Monokai Extended,
  else GitHub [`chunk-kacn3tam.js:578230`] = `$T/diffHighlight.ts:47-95`.
- **Markdown.** Heading has **no `#` prefix and no colour**; depth 1 = bold+italic+underline, else bold,
  always followed by two newlines [`chunk-hn8xn3fc.js:544370`, verified]. `hr` is the literal `---`,
  not a full-width rule [`:544373`]. `codespan` is the theme's `permission` colour, no backticks
  [`:544359`]. Code fences have no fence, no border, no indent; an unknown language is emitted dimmed on
  its own line [`:544353`]. Blockquote is `dim("▎") + " "` with italic body and no rail on blank lines
  [`:544350`]. Images render `href` or `alt (href "title")` [`:544378`]. Unordered bullets are the ASCII
  `-` at **every** depth; ordered markers cycle decimal → letters → roman → decimal
  [`:544617`, `:544619`]. Task boxes are `[x] ` / `[ ] ` [`:544426`]. All match `$T/markdown.ts` /
  `$T/markdownInline.ts` exactly.
- **Tables.** Border set is **square** `┌─┬┐ ├─┼┤ └─┴┘` with `│` and one space of padding
  [`chunk-p1jzptgf.js:631498`, verified]; a `middle` rule between **every pair of body rows**
  [`:631506-631508`, verified]; header cells force-centred; the vertical fallback fires on either
  >4 wrapped lines in any row or assembled width > `terminalWidth − 4` [`:631478`, `:631516`]; the
  fallback's rule is `─` × `min(width−1, 40)` **between records only** and the first-line wrap width is
  `width − headerWidth − 3` floored at 10, continuations at `width − 3` with no indent
  [`:631527-631546`, verified]. `$T/mdTable.ts` reproduces all of it. This is the most faithful
  transcription in the lane.
- **Mermaid is never drawn in the terminal** [§41.17.8, `chunk-hn8xn3fc.js:544353`] and **no inline-image
  protocol is emitted anywhere** [§41.17.9] — our zero-hit greps are correct behaviour, not a gap.
- **`formatDuration`.** `$t(ms)` [`chunk-6aqvjbk0.js:287577-287600`, verified] — including the `t < 1`
  **millisecond** test (so 500 ms renders `0s`, not `0.5s`) and the 60→60→24 carry cascade — is
  reproduced exactly in `$T/format.ts:7-19`. The Wave-C correction that killed the `1m05s` spelling was
  right.
- **Token counter.** Response chars ÷ 4, eased, compact-lowercased, prefixed `↓` except in `requesting`
  which uses `↑` [`chunk-c872axth.js:440199`, `:440389`] = `$T/spinner.ts:132-148`.
- **Thinking ladder.** `thinking` → `still thinking` (10 s) → `thinking more` (20 s) →
  `thinking some more` (30 s) → `almost done thinking` (45 s) [`chunk-c872axth.js:440144-440154`] =
  `$T/spinner.ts:151-157`. Four rungs, exact thresholds.
- **Tool status rungs.** `running tool for <d>`, `ran tool for <d>`, `thought for <n>s`
  [`chunk-c872axth.js:440220-440228`] = `$T/spinner.ts:171-179`.
- **Suffix order** — spinnerSuffix, elapsed, tokens, thinking/tool status, joined ` · `, wrapped in
  literal parentheses [`chunk-c872axth.js:440277-440280`] = `$T/spinner.ts:304-309`. We have no
  `spinnerSuffix` (stop-hook progress) producer; the other three are in order.
- **"esc to interrupt" is composed in the footer, not literal in the spinner**
  [`chunk-bq8epagv.js:410123`] — Wave C's move of the offer to `footerModel`'s `interrupt` rung is
  canon-correct.
- **Spinner frames.** `ft = ["·","✢","✳","✶","✻","✽"]`, ghostty `ct` repeating the fifth slot; the
  mirrored twelve is derived, and the index is a **raised cosine** over the 6-element base with period
  2000 ms [`chunk-ha6de7vj.js:538103`, `chunk-c872axth.js:440140`, verified] = `$T/spinner.ts:34-56`.
- **The 186 verbs are byte-identical.** I diffed our `SPINNER_VERBS` against
  `chunk-zf8f7hb4.js:849663` programmatically: same 186 entries, **same order**, no additions, no
  omissions, including `Channeling`/`Channelling` and the precomposed `Flambéing`/`Sautéing`.
- **`spinnerVerbs` settings shape** `{mode:"append"|"replace", verbs:string[]}`
  [`chunk-zf8f7hb4.js:849655-849662`] — we do not implement it; noting the shape is small and cheap.
- **The `(ctrl+o to expand)` chip is suppressed in the virtualized (fullscreen) list.** See §6.1 — our
  `expandHint: fullscreen ? "" : …` (`$T/useChat.ts:346-348`) is canon-correct and the spec omits the rule.

---

## 6. Spec defects

### 6.1 §41.16.6 states the expand affordance unconditionally; canon suppresses it in the fullscreen list

The spec says `Fc` is "The expand affordance" and that the primitives "produce the canonical
`… +12 lines (ctrl+o to expand)`" [§41.16.6, citing `chunk-kvpryjd2.js:585665`]. It never mentions that
`Fc` opens with two context reads and **returns `null`** for either
[`chunk-kvpryjd2.js:585660-585662`, verified]:

```js
let K = _(3), so = Ge(E), ao = Ge(VB), I = tp("app:toggleTranscript", "Global", "ctrl+o");
if (so || ao)
  return null;
```

`VB` is `createContext(false)` [`chunk-7y70yypg.js`, verified], and the message list wraps the virtual
list in `VB.Provider value: !0` [`chunk-bq8epagv.js:394669`, verified]. Virtualisation is on whenever
`sT = Aue != null && !LQo` — i.e. a scroll viewport exists (the fullscreen layout branch) and
`CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL` is unset [`chunk-bq8epagv.js:394315`, verified]. Consequence: **in the
default fullscreen renderer the `(ctrl+o to expand)` chip does not render at all**; it appears only in the
classic inline path (and never under a screen reader, the `Ge(E)` arm).

Our pty evidence already says this — `docs/parity/tui-ux.md:585`: "the `(ctrl+o to expand)` chip is
suppressed everywhere fullscreen paints" — and `$T/useChat.ts:346-348` implements it. **Our evidence is right
and the spec is incomplete here.** Chapter 41 should carry the rule, because a reimplementer following
§41.16.6 literally would paint a chip canon does not.

### 6.2 §41.15/§41.16 never specify the vertical spacing between blocks

This is the largest omission in the lane. `marginTop` appears nowhere in §41.15 or §41.16; the sections
specify glyphs, gutters, indents and per-tool strings but not the one property that determines the
transcript's overall shape. The mechanism is `addMargin = !hasMetadataHeader`
[`chunk-bq8epagv.js:393286`] threaded to every content-block arm except `tool_result` and
`tool_search_tool_result` [`chunk-bq8epagv.js:769337`, `:769460`], consumed as `marginTop: X ? 1 : 0`
[`chunk-vp8nzhw3.js:763399/763411`, `chunk-vp8nzhw3.js:762424/762457`], with the margin relocating to the
metadata header row when one exists [`chunk-bq8epagv.js:393313`]. §1.1 above has the full arm table.

### 6.3 §41.16.3's gutter table mislabels `"  ⎿  "`

The table row reads: `"  ⎿  "` — "The same gutter as a measurable string" [`chunk-vp8nzhw3.js:765976`].
It is **not** the same string: `Ie` emits `["  ", "⎿ \xA0"]` (NBSP in column 5)
[`chunk-ezp5bkhr.js:494493`] while `var Ky = "  ⎿  "` uses two ordinary spaces
[`chunk-vp8nzhw3.js:765976`, verified]. Same display width, different bytes — which matters for anyone
byte-comparing frames, and is exactly the distinction our `$T/species.ts:104-108` comment already draws.

### 6.4 §41.18.2's frame table omits a third (dead) array

The quoted source line contains `Gt = ["·","✢","*","✶","✻","✽"]` and `Os = [...Gt, ...Gt.toReversed()]`
alongside `ct`/`ft`/`en`/`tn` [`chunk-ha6de7vj.js:538103`, verified], but the spec's "Array / Glyphs /
Selected when" table lists only `ct`, `ft`, `en`, `tn`. `Gt`/`Os` have no reader — `Jit()` and `ele()`
branch only on `TERM === "xterm-ghostty"` [`:538104-538115`, verified]. A reimplementer reading the source
line will wonder what selects them; the answer is "nothing".

### 6.5 §41.16.1's glyph table misattributes two constants to line 839616

`ylr` (`⌕`) is on line **839612**, not 839616 — 839612 is the long line that also carries `vr`, `AQ`,
`oE`, `vUe`, `VCt`, `XCt`, `jRe`, `qp`, `p_`, `Ikn`, `wv`, `Kl`, `CS`, `xkn`, `$Ze` [verified by reading
839612 whole]. Line 839616 carries `YCt` (`♪`), `Alr` (`▎`), `Okn` (`█`), `YP` (`─`), plus several the
table omits (`JCt`, `jZe`, `WZe`, `Dkn`, `WRe`, `QCt`, and the braille dot-spinner array). Cosmetic, but
the table is the thing a reimplementer greps.

### 6.6 §41.18.6's "no seasonal variant" claim is narrower than stated

The spec says "There is **no seasonal or holiday variant** of the verb list and no switch to disable it".
The second half is imprecise: `spinnerVerbs` with `mode: "replace"` and a one-element array is an
effective disable [`chunk-zf8f7hb4.js:849655-849662`, verified], and `spinnerTipsEnabled === false`
disables the *tip* line but not the verb. Minor wording.

---

## Appendix — what I verified in the bundle myself

Read and confirmed line-by-line in `~/claude-code-bundle/2.1.257/cli.pretty.js`:
`393286`, `393289`, `393313`, `394315`, `394621-394632`, `394669`, `426008-426040`, `439704-439730`,
`440139`, `440260-440282`, `440451`, `494478-494512`, `513535-513560`, `538100-538115`, `544345-544380`,
`544404-544432`, `544605-544625`, `585655-585700`, `631377-631380`, `631470-631560`, `762400-762425`,
`762480-762600`, `763370-763418`, `763905-763940`, `764045-764050`, `764158-764172`, `764555-764560`,
`764918-764930`, `765974-765980`, `767770-767780`, `769304-769475`, `779566-779575`, `287577-287602`,
`287690-287700`, `839610-839624`, `849650-849780`, and the `chunk-7y70yypg.js` `VB` definition.
Programmatic diff: our 186-verb array vs `849663` (identical, in order).

Not verified (taken from the spec as written, hence **spec-only** where cited above): the tip registry's
per-entry priorities/cooldowns, the narration digest constants, the `claude-in-chrome`/`computer-use` verb
maps beyond the first two cases, and the rate-limit string family.

---

## 7. Re-verification against `somersault` (post-bl10)

The first draft read `harness/src` from `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen
checkout predating the bl10 merge. `diff -rq` over `harness/src/tui` confirms the coordinator's list
exactly — **24 differing paths**, three of them new files:

`ChatApp.tsx`, `ChatComposer.tsx`, `FullscreenViewport.tsx`, `HelpDialog.tsx`, `Line.tsx`,
`McpDialog.tsx` (new), `PermissionsDialog.tsx`, `SettingsDialog.tsx`, `Transcript.tsx`, `chatMain.tsx`,
`clipboardImage.ts`, `commands.ts`, `composerFrame.tsx`, `dialogs/DialogFrame.tsx`,
`dialogs/keyhints.ts` (new), `keys/bindings.ts`, `liveWindow.ts`, `mcpDialogModel.ts` (new),
`select/Tabs.tsx`, `settingsFile.ts`, `streamingItems.ts`, `toolRenderer.tsx`, `useChat.ts`
— plus `docs/parity/tui-ux.md`.

Every other file this report cites — `species.ts`, `render.ts`, `markdown.ts`, `markdownInline.ts`,
`mdTable.ts`, `highlight.ts`, `hljsRuntime.ts`, `outputFold.ts`, `toolSummaries.ts`, `toolResult.ts`,
`toolFold.ts`, `diffRender.ts`, `diffSource.ts`, `diffHighlight.ts`, `agentProgress.ts`, `spinner.ts`,
`TurnSpinner.tsx`, `RetryRow.tsx`, `CompactionRow.tsx`, `compactionBar.ts`, `durationRow.ts`,
`liveTurn.ts`, `banner.ts`, `figures.ts`, `format.ts`, `motion.ts`, `wrapItems.ts`, `keys/hints.ts`,
`transcriptModel.ts`, `replay.ts`, `lineFold.ts`, `sgrFoldRow.ts` — is **byte-identical between the two
trees**, so those findings and line numbers stand as written.

### Disposition of every §0–§3 item

| item | disposition | note |
|---|---|---|
| **§0.1** (was: "bl10's invariant is one exception away from correct") | **corrected → confirmation** | Rewritten. T-SPACE shipped; the exception is honoured by construction. |
| **§0.2** (was: "we ship no inter-block spacing at all") | **withdrawn** | Factually wrong — an artefact of the frozen tree. Slot promoted; the compaction-gauge structural delta took the freed slot as the new §0.6. |
| §0.3–§0.7 (spinner sub-line, verb rotation, markdown tokenizers, MCP renderers, narration) | **unchanged**, renumbered 2–5 and 7 | All cite byte-identical files or the bundle only. |
| **§1.1** | **corrected in place** | Recast from "correction" to verified confirmation, with the shipped call sites, both D17 exemptions, and one residual noted below. |
| §1.2 verb re-roll | **unchanged** | `TurnSpinner.tsx`, `spinner.ts` identical in both trees. |
| §1.3 markdown tokenizer overrides | **unchanged** | `markdown.ts` / `markdownInline.ts` identical. |
| §1.4 reduced-motion glyph | **unchanged** | `TurnSpinner.tsx:95` identical. |
| §1.5 16 ms interval quantisation | **unchanged** | `spinner.ts`, `RetryRow.tsx` identical. |
| §1.6 list continuation indent | **unchanged** | `markdown.ts` identical. |
| §1.7 `(ctrl+e to show all)` | **unchanged** | `keys/hints.ts`, `outputFold.ts` identical. |
| §2.1 spinner sub-line / tip registry | **unchanged** | Confirmed still absent in the somersault tree (`grep -n 'spinnerTip\|Feature of the week'` → nothing under `src/tui`). |
| §2.2 missing per-tool renderers | **unchanged** | `toolSummaries.ts` identical; `toolRenderer.tsx`'s dispatch gained no new tool arms in bl10 (`Waiting for permission…` and the MCP typed rows are still absent). |
| §2.3 narration | **unchanged** | Bundle-only finding. |
| §2.4 misc unrecorded behaviours | **unchanged** | Bullet-blink cite renumbered `toolRenderer.tsx:267 → :282`. |
| §3 row "Markdown links/images/strikethrough" | **unchanged** | `markdownInline.ts` identical. |
| §3 row "Spinner glyph" (dead `Gt`/`Os` array) | **unchanged** | Bundle-only. |
| §3 row "API-retry / stalled indicator" | **unchanged** | `RetryRow.tsx`, `retryStatus.ts` identical. |
| §3 row "Reduced motion" | **unchanged** | `motion.ts` identical. |
| **§3 row "§2 spacing (no row exists)"** | **withdrawn** | A row now exists: `docs/parity/tui-ux.md` gained the bl10 close-out (+47 lines) naming T-SPACE, the `:gap` separator item, the D17 exemption, the spinner-slot margin, the composer margin drop and `MAIN_DOCK_ROWS` 14→16, pinned by 27 spacing-invariant cases. §1.1's canon arm table remains useful as the arm-by-arm evidence that close-out cites only in summary. |
| **§3 row "compaction surface"** | **unchanged, line number corrected** | `ChatApp.tsx:1984-1989 → :2000-2006`. The bl10 change wrapped the slot in `<Box marginTop={1}>` (`:2001`, T-SPACE Task 3, canon `Gn`) but left the three occupants mutually exclusive, so canon's "spinner row **plus** gauge row" delta stands. |
| §4 verbatim assets, §5 confirmations, §6 spec defects | **unchanged** | Line numbers in changed files corrected in place (see below). |

### Line numbers rewritten in place (frozen tree → somersault)

| citation | old | new |
|---|---|---|
| `INTERRUPTED_TEXT` | `toolRenderer.tsx:199` | `:214` |
| bullet + 600 ms blink | `toolRenderer.tsx:267` | `:282` |
| `ERROR_PHYSICAL_ROWS = 10` | `toolRenderer.tsx:280` | `:295` |
| `BACKGROUNDED_TEXT` / `(↓ to manage)` | `toolRenderer.tsx:352-360` | `:367-374` |
| blanket expand-chip suppression | `useChat.ts:339` | `:346-348` |
| spinner / retry / compaction slot | `ChatApp.tsx:1984-1989` | `:2000-2006` |
| `HOOK_LINE_GUTTER`, `GROUP_HINT_GUTTER` | `toolRenderer.tsx:52`, `:46` | unchanged (same lines in both trees) |

### The direct answer to the coordinator's question

**The tool_result glue is respected, not violated.** Two lines carry it:

```ts
// $T/toolRenderer.tsx:694-695
export const withLeadingSeparator = (items: readonly RenderItem[]): readonly RenderItem[] =>
  items.length === 0 ? items : [separatorItem(items[0]!.id), ...items];
```

```ts
// $T/toolRenderer.tsx:581 and :602 — one unit, header first
const items: RenderItem[] = [{ kind: "line", id: `${event.id}:call`, ownerKey, line: headerLine(…), … }];
…
if (finalBody.length) items.push({ kind: "gutter-block", id: `${event.id}:result`, ownerKey, gutter: TOOL_RESULT_GUTTER, body: finalBody, … });
```

Because the separator is keyed to `items[0]` of the *pushed unit* and a tool call pushes header+result as
one array, there is no reachable path that emits a blank row between `⏺ Tool(args)` and its `  ⎿  …`.
This matches canon exactly [`chunk-bq8epagv.js:769337-769341` — the `tool_result` arm is the one arm that
does not receive `addMargin`; `chunk-ezp5bkhr.js:494486-494505` — the `⎿` wrapper has no margin prop].

Both D17 exemptions also hold up (§1.1). One footnote for the close-out: the **live-hook-counter
exemption** is reasoned against an older bundle's `di`; 2.1.257 has no such row at all, so that exemption
is a sound local design call rather than a canon transcription. And one residual, flagged not asserted:
ccx puts a separator above **standalone** hook blocks (`$T/toolRenderer.tsx:1671`, `:1839`, `:1955`),
whereas 2.1.257 renders the completed-run hook summary *inside* the owning tool-use subtree
[`chunk-vp8nzhw3.js:767774`] where it inherits that block's margin. Canon has no standalone hook block to
compare against, so this is a difference in model, not drift.
