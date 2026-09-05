# CC-to-SDK tech debt

Known, deliberately unpaid debt. One entry per item: what it is, where it came from, what it costs if
nobody pays it, and why it was deferred. An item leaves this file by being fixed or by being shown not to
be debt — not by ageing out.

Nothing here is a bug report waiting for triage. Each of these was adjudicated once, judged real, and judged
not worth the change at the time. Re-read the "why deferred" line before acting on one: if the reason still
holds, leave it.

---

## 2026-08-31 — reforge's replay proxy scrubs less than its differ, so multi-request scenarios fall back to positional matching

**Source:** the 2.1.241 → 2.1.251 pin bump, full corpus re-record · `reforge/src/proxy.ts`
(`scrubRequestBody`, which feeds the replay match hash) vs `reforge/src/differ.ts` (`VALUE_SCRUBS` +
run-scoped id mapping).

**What:** the proxy matches a replayed request to a cassette entry by hashing the request body after
scrubbing only two things — the date stamp and `metadata`. The differ normalizes far more, because the
engine writes run-scoped values into request *prose*: a subagent's engine-minted `agentId`
(`"agentId: a27548a1e816dc4a2 (use SendMessage with to: …)"`) and inline clocks
(`<usage>… duration_ms: 2714</usage>`). Those differ between the recording run and every replay, so the
hash misses and the proxy serves the entry positionally instead. Measured on freshly recorded cassettes
(so this is not cassette rot): 6 fallbacks across 3 of 22 scenarios — `subagent`, `parallel-tools`,
`runtime-setters`, all multi-request.

**Cost:** the fallback is reported, not silent (M3-B added the warning), and grading still passed on all
three surfaces in every affected scenario, because the differ *does* normalize these values. What is lost is
the exactness guarantee behind the match: positional order is usually right, so a scenario whose engine
under test asked for things in a different order could be served the "right" responses anyway and grade
green. That is the precise failure `cross-resume` hit once before, where a positional fallback served the
first turn's response to the resume turn.

**Why deferred:** the fix is to share normalization between the two layers, and they want different things
from it — the differ maps ids run-scoped and first-seen so an engine using two ids where the oracle used one
still diffs, while a hash needs a single stateless canonical form. Over-scrubbing the hash trades a missed
match for a *wrong* match, which is strictly worse than the fallback it replaces, so this needs its own
design pass rather than a regex bolted onto `scrubRequestBody` during a pin bump. Revisit when a scenario
depends on request exactness, or when `engine-ts` starts being graded — the fallback's masking power matters
far more against a genuine reimplementation than against the identical-code pair it was measured on.

**Superseded 2026-08-31 (same day):** the reforge-full campaign spec
(`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md` §3.4) promotes this from deferred debt
to scheduled work — the normalization-sharing design pass lands W0-adjacent, and `fallback count > 0`
becomes a hard gate failure at engine-ts acceptance (diagnostic-only remains the posture while grading the
identical-code pair). Kept here for the record; the campaign spec owns the obligation now.

**CLOSED 2026-08-31 (campaign spec C3 / W0c).** `reforge/src/canonical.ts` now owns the normalization spec
for both layers: the differ keeps its run-scoped id MAP, the replay hash gets the stateless equivalent plus
the structural tool-result canonicalization, and each pattern ships a regression test with a must-survive
neighbour. The whole acceptance surface replays with zero positional fallbacks, and a fallback is now fatal
for every `engineB` that is not `engine-extracted`. The predicted over-scrubbing hazard was handled by
keeping the id map on the differ side and anchoring every hash-only pattern to an exact value shape.

---

## 2026-08-31 — reforge pins `CLAUDE_CODE_ENTRYPOINT` to `sdk-cli` to stay compatible with the recorded corpus

**Source:** campaign spec C3 (W0c), `reforge/src/env.ts` (`PINNED_ENTRYPOINT`).

**What:** the engine stamps its entrypoint label into every request body as `cc_entrypoint=<value>`. That
variable used to be INHERITED, so the corpus was recorded from inside a Claude Code session and carries
`sdk-cli`; the same recording made from a plain terminal would have carried `sdk-ts`. The env allowlist now
pins it — which fixes the determinism problem — but it pins it to `sdk-cli`, the value the existing
cassettes hold, rather than to `sdk-ts`, which is what `sdk.mjs` chooses on its own and is arguably the
truthful label for the SDK-driven lane.

**Cost:** every recorded request body says the engine was driven by the Claude Code CLI when it was driven
by the SDK. Nothing downstream reads the field today; the risk is that a future gate or server-side
behavior keys on entrypoint and the corpus then measures the wrong lane.

**Why deferred:** changing the constant is one character, but it changes every request body and therefore
costs a full 22-scenario live re-record. The next pin bump re-records the corpus anyway, so the change is
free then and merely expensive now. Flip `PINNED_ENTRYPOINT` to `sdk-ts` as part of that bump.

---

## 2026-08-31 — a fork's inherited peer history is invisible, as is every pre-M9 session's

**Source:** M9 branch external review, round 3 (finding 2) · `src/peer/arrivalLog.ts` (the store is keyed by
session id) with `src/sessions/` (the SDK mints a new id and rewrites uuids on fork).

**What:** `arrivals.logged` is derived from this server's own log, and the log starts where observation did.
A forked session's sidecar is empty over copied history, so `thread/read` and `thread/searchOccurrences` on
the fork omit every inherited arrival and report zero — the reader drops the copied `isMeta` peer rows, as
it has always done. The identical shape holds for every session that received peer messages before this
milestone shipped.

**Cost:** on a fork, and on any pre-M9 conversation, the defect this milestone exists to fix is still
present: history shows an answer with no question. The count is not lying — it reports what was observed —
but it cannot distinguish "no arrivals" from "arrivals nobody was watching for".

**Why deferred:** the fix is migrating entries onto the fork's rewritten uuids, which is placement work on a
branched conversation — and D3, the owner's scope decision, puts branches and forks under *explicit refusal
rather than correctness*. Doing it here would be the "solve the full correctness envelope before shipping
anything" alternative D3 rejected by name. Revisit if branches enter scope; the boundary is stated in the
spec beside the definition of `arrivals.logged` so the next reviewer reads it rather than re-deriving it.

**2026-08-31 (BL7, D-BL7-4):** re-read and left standing, reason unchanged — the fix still lands inside
D3's explicit-refusal scope, which is the owner's decision to revisit and not this round's.

---

## 2026-08-31 — a FOREIGN sender's literal closing tag truncates that sender's own text

**Source:** M9 branch external review, round 2 (P2); re-adjudicated in BL7 (D-BL7-4), where the half this
server controls was paid · `src/peer/address.ts` (the depth-counting envelope scan, `envelopeBodies`).

**What:** an arriving peer message whose body contains a literal `</cross-session-message>` or
`</agent-message>` matching its own wrapper is read as ending there. `before </cross-session-message> after`
decodes as `before `, and the rest of that message is dropped from the item, the log entry and history alike.

**What is no longer in scope of this entry:** our own outbound path. `peer/send` now wraps the body, asks
this same decoder to read it back — alone and beside a sibling copy, which is the collapsed two-envelope
frame probe 121 measured — and refuses with INVALID_PARAMS naming the unbalanced tag unless both come back as
exactly the message. Nothing this server writes can truncate itself any more; what remains is arrivals from
senders that are not us.

**Cost:** a foreign sender loses the tail of one message it wrote. It cannot reach any other session's text:
the truncation is confined to the frame that sender itself produced.

**Why still deferred:** the CLI's wrapper grammar carries no escaping and no length prefix, so nothing in the
frame distinguishes a payload tag from the real terminator, and **no framing exists that this server
controls** on the inbound path — a fix means either inventing framing we do not own, or failing the whole
message closed, which loses more than the truncation does. The send side was fixable precisely because it is
ours; the receive side is not, and stays bounded and self-inflicted-per-sender until a real sender hits it.

---

## 2026-08-31 — search reports a duplicate-anchor arrival at both rows; `thread/read` picks the first

**Source:** M9 review ledger (documented divergence) · `src/appserver/search.ts` (~:696).

**What:** where an anchor resolves at two indistinguishable rows (M5's 1,562 measured duplicate uuids),
`thread/searchOccurrences` reports the arrival at both positions while the projector's first-match-wins
renders it at one.

**Cost:** a client comparing the two methods sees one more occurrence than history contains.

**Why deferred:** it is not drift but a genuine difference in what the two methods claim — the projector
composes one ordered history and must choose, while an occurrence is a claim about a position and both
positions are equally true of what was recorded. Documented at the call site; a "fix" would have to invent
an occurrence identity the data does not carry.

**2026-08-31 (BL7, D-BL7-4):** re-read and left standing. BL7 changed the LIVE channel's attribution, not
the read side's; the divergence is between two read methods and the reason above is untouched by it.

---

## 2026-08-31 — a pre-M9 row-phase search cursor at `r === 0` skips the `atStart` group

**Source:** M9 review ledger (upgrade artifact) · `src/appserver/search.ts`.

**What:** a search cursor minted before this milestone, resumed at row phase 0, walks past the
null-anchored arrival group for that one in-flight walk.

**Cost:** one walk in progress across the upgrade may miss arrivals that precede every row. New walks are
unaffected.

**Why deferred:** one-time and self-clearing — the cursor is gone as soon as that walk ends. Versioning the
cursor to fix it would break D1, which is the one constraint the whole milestone was designed around.

**2026-08-31 (BL7, D-BL7-4):** re-read and left standing, reason unchanged. BL7 touched neither the search
cursor nor its phases; the entry stays until a walk started before M9 can be shown impossible, at which
point it leaves by being shown not to be debt rather than by ageing out.

---

## 2026-08-31 — `peerArrival` JSON-stringifies non-string, non-array content

**Source:** M9 review ledger (carried minor) · `src/peer/address.ts`.

**What:** for a frame whose `message.content` is neither a string nor a block array, the fallback renders
`JSON.stringify(content)` over `origin.body`.

**Cost:** a client would see a serialized object where a message should be.

**Why deferred:** unreachable for real CLI frames — every measured peer frame carries a string or a block
array — so the branch exists only to avoid an undefined, and changing it would be changing untested,
unreached code.

**2026-08-31 (BL7, D-BL7-7):** `test/unit/peer/address.test.ts` now pins the fallback — a frame whose
content is `{ weird: 1 }` yields that object stringified, outranking `origin.body` — so the branch is
tested-and-defined rather than untested-and-unreached; the entry STAYS, because a pin documents behaviour
and changes neither the cost nor the reachability that deferred it.

---

## 2026-08-31 — two binding-machine residuals: compaction turns and lifecycle-frame drain order

**Source:** BL7 Task 2 review (both findings judged real, neither reachable as a misattribution) ·
`src/appserver/peerInbound.ts` with `src/appserver/peerAdoption.ts`.

**What:** two places where BL7's bracket binding is bounded rather than complete.

1. **A compact turn opens no own bracket.** Compaction runs through its own inline runner
   (`src/appserver/lifecycle.ts`, `thread/compact/start`), which has no user prompt to mint a uuid for and
   so never calls `notePeerTurnUuid`; peerInbound records no `ownTurn` for it. An arrival landing
   mid-compaction therefore binds `next` instead of `own`, and is emitted into the next REAL bracket that
   opens on the thread.
2. **`command_lifecycle` frames return from `onFrame` before the per-frame drain.** A bracket that dies by
   its own terminal frame has its bound arrivals reaped only at the next NON-lifecycle frame, because the
   lifecycle route returns early.

**Cost:** bounded, and in neither case can an arrival reach a turn it did not belong to. (1) is exactly the
behaviour D-BL7-6 specifies for an arrival with no bracket open — the engine's own queue drains into the
next bracket — so the only "loss" is that a compaction turn never shows an arrival as its own item, which
it arguably should not anyway. (2) costs a delayed `console.warn` and one held queue slot between the
terminal frame and the next observed frame; the arrivals are dropped correctly when the drain does run,
and no successor bracket can claim them in the interim because they stay bound to the dead one.

**Why deferred:** both are residuals of the bracket-evidence design working as specified, not gaps in it.
(1) needs a `notePeerTurnUuid` hook in the compaction runner — a change to a runner that has nothing else
to do with peers, for a turn shape that has no user-visible arrival story. (2) needs the lifecycle route
re-ordered to drain before returning, which moves a drain inside terminal handling and would have to be
re-argued against every ordering cell Task 2 pinned. Neither buys a correctness change; revisit if a
driving case appears — an arrival genuinely lost across a compaction, or a warn late enough to confuse a
gate run.

---

## 2026-09-01 — reforge's two structural splice anchors carry a re-anchoring cost at every pin bump

**Source:** the C6 boundary review (finding 1, the only one of five not fixed in the fix wave) ·
`reforge/strangle/manifest.ts`, rows `identity-prompt` and `context-prompt-lines`.

**What:** the splice doctrine locates a target by a true-substring-unique string literal, and prose
literals are what made that bet survive ten upstream versions. Two C6 rows have no prose of their own
to anchor on and use structural anchors instead: `?.isNonInteractive` (a property-name fragment) and
`].filter(Boolean)}` (an operator sequence). Both are unique at the pinned 2.1.251 only because the
ESM chunk split scoped uniqueness per chunk file. Measured against the earlier bundles: in the
single-file payloads of 2.1.234, 2.1.236 and 2.1.241 the same two strings occur 17 times and 2 times
respectively, so at three of the four prior pins neither would have resolved without a `coLiteral`
scope or a different target.

**Cost:** availability churn at pin bumps, not correctness. A structural anchor that stops being unique
inside its chunk — or that a refactor moves — fails the build loudly (`strangle/anchor.ts` refuses a
non-unique anchor, and the target-identity guard refuses a drifted one), so the failure mode is a
blocked bump that someone re-anchors, never a silent mis-splice into the wrong node. The expected bill
is one re-anchoring per structural row per bump that touches its neighbourhood.

**Why deferred:** the alternative is not a better anchor, it is a different ownership tier. These two
targets emit no prose at all, so there is nothing stronger to anchor on short of promoting them out of
the method tier into an S-module seam — which is what §2.1's anchor budget already schedules, on the
budget's own timetable rather than on this entry's. Re-anchoring is the priced cost of using a
structural anchor, and §2.1 now says so. Revisit if the structural-anchor count grows beyond a handful,
or if a bump ever produces a resolution that is wrong rather than absent — the second would falsify the
loud-failure argument this entry rests on.

---

## 2026-09-02 — the hook-helper belt fixture cannot classify a CROSS-CHUNK injection, so `pure-with-injection` reads zero

**Source:** C10.6 / W7.6a · `reforge/research/tools/extract-hook-helpers.ts`,
`reforge/research/fixtures/hook-helper-belt-2.1.251.json`.

**What:** the fixture classifies each reached function by its free variables — `pure` when they all
resolve to other pure functions, `pure-with-injection` when the remainder are recognised reads (a
clock, a uuid mint, a platform read), `effectful` otherwise. The recogniser tests the CALLEE'S OWN
BODY, which it can only read for a declaration in the layer's chunk. Every injection candidate the
design pass named lives somewhere else — the default-shell read behind the dedupe key is in
`chunk-2z83fvw5`, the attachment minter's clock and uuid are imports — so each is recorded on the
281-name cross-chunk frontier and the function that reaches it is classified `effectful`. The
`pureWithInjection` count is therefore **0 by construction rather than by measurement**, and the
fixture says so only by that number being zero.

**Cost:** bounded and currently zero. Stage 1 owned nothing that hinged on the distinction: the one
pure helper it took has no free variables at all, and the interpreter it took is effectful on five
counts, not one. The distinction becomes load-bearing at **Stage 2**, where the design's whole claim
is that the matcher is "pure except for one `EnvironmentPort.defaultShell()` read" — that is exactly
a `pure-with-injection` verdict, and the fixture cannot currently issue it.

**Why deferred:** the fix is real work rather than a line — resolve each external name through the
chunk's import statements to its defining chunk, load that chunk, find the declaration, and test it —
and it wants a cache so the belt run does not re-parse the bundle per name. Doing it inside a wave
that owned nothing depending on it would be machinery built ahead of its consumer, which is the shape
this campaign refuses in the other direction.

**Revisit:** with C10.7 / W7.6b, which owns the matcher. The honest reading until then is that the
fixture's `effectful` verdict means "not provably pure from inside this chunk", and any function
whose only non-pure free variables are cross-chunk deserves a second look before it is written off.

## 2026-09-01 — reforge's hooks parity trace compares per-port call lists, so cross-port INTERLEAVING is ungraded — **PAID 2026-09-02 (C10.6/W7.6a, Stage 0)**

**Source:** the C8 boundary review (finding 5, logged rather than fixed) ·
`reforge/strangle/hooks-parity.test.ts` (`Trace`, `compare`, `compareValue`).

**What:** the oracle grades each dispatcher on two things — what it yielded or returned, and a TRACE of
what its ports saw. The trace is a record of per-port arrays: every `createBaseHookInput` call in one
list, every executor request in another, and so on. Comparing them proves each port was called the right
number of times with the right arguments, and it is what actually grades the hook record's field set and
the executor request. What it cannot see is ORDER ACROSS PORTS. A dispatcher that built its record before
taking the activity hold instead of after, or that read the working directory after asking the executor
rather than before, produces the same per-port lists and compares equal. Two smaller edges ride along:
the comparison is `JSON.stringify`-based, so a key present with the value `undefined` and a key absent
compare equal, and a port called with `undefined` versus not called at all is distinguished only by the
array's length.

**Cost:** bounded, and bounded by the subsystem rather than by luck. These dispatchers are short and
straight-line — build one record, call one executor — so the orderings a defect could plausibly permute
are few, and the two that carry real ordering semantics are graded another way: the SessionStart activity
hold is compared as a single ordered `activity` list (`begin(...)`, `end(...)` in call order), and the
try/finally that releases it has its own branch-attestation arm and its own control. The
present-with-undefined blindness is narrower still: every hook record reaches a command hook through
`JSON.stringify` onto stdin, which erases exactly the same distinction, so for the field that matters
most the oracle is blind to something the engine also cannot express.

**Why deferred:** fixing it means replacing the per-port lists with one interleaved event log, which is a
rewrite of the trace's comparison and of every `mustDiffer` control written against the current shape —
about sixty assertions across ten dispatchers. That is a worthwhile change when a dispatcher with real
sequencing arrives (the hook EXECUTOR itself is the obvious candidate: it spawns processes, races
timeouts and propagates cancellation, and for that one interleaving IS the behaviour). Doing it now would
buy ordering coverage for ten functions that mostly have one order to be in. Revisit when the executor is
spliced, or when any hook module grows a second effectful call whose position is load-bearing.

**THE TRIGGER HAS FIRED, and the entry was right about why (2026-09-02, W7.5's executor design pass —
`reforge/research/2026-09-02-w75-hook-executor-design.md`).** The executor does spawn processes, race
timeouts and propagate cancellation, so for it the interleaving IS the behaviour. The design pass adds
a second reason this entry did not anticipate: **cleanup pairing**. The command arm releases its
derived signal on six different paths plus its catch, and "every derived signal was cleaned exactly
once" is a property only an ordered log can state. So this is no longer deferred work to schedule
alongside the executor — it is a **precondition** of the first executor module, and the design stages
it as Stage 0. Two further oracle capabilities land with it: reproducing stdout CHUNK boundaries (the
async-detection path latches on the first write after which the accumulated stdout's first line contains
a `}` — and the latch is one-shot, so a write that ends after a NESTED brace parses a truncated
document and the complete one that follows is never re-examined. Byte-equal stdout delivered in a
different number of writes is a different behaviour), and grading a path that never settles (the
shutdown arm awaits a promise that by construction never resolves).

**Assigned 2026-09-02.** The C10.5 boundary review cut the executor implementation as its own wave
family (campaign spec, Deferred section, "The executor cut"), and this rewrite is **C10.6/W7.6a's
Stage 0** — scheduled *before* the first executor module rather than alongside it.

**PAID 2026-09-02 (C10.6/W7.6a, Stage 0a).** `Trace` and `emptyTrace` are gone; `EventLog` records
one ordered stream of `{port, args, pair?, hook?}` and the comparison is the ordered stream. What the
entry asked for, measured rather than asserted: swapping ONE adjacent pair of differently-ported
events in each owned log reddens **204 of the 226** log comparisons, and moves the per-port
projection this entry described in **zero** of them — the projection is kept on the class
(`perPort()`) precisely so the control can assert the old shape's blindness rather than claim it.
**Both smaller edges the entry named are closed with it**: the serializer now rewrites a
present-but-`undefined` value to a sentinel, so a carried-but-empty field and an absent one no longer
compare equal; and a port called with `undefined` versus not called at all is now two different
positions in one stream rather than one array length. Neither change moved a single existing
comparison — 721 before and after — which is the honest reading that the two blindnesses were latent
rather than load-bearing.

**And the reason it was a precondition rather than a companion**, which the entry could not have
known: `unpaired()` states "every derived signal was cleaned exactly once" as a PROPERTY of one run.
Two sides that both leak compare equal, so no comparison — however ordered — can state it. The
property runs on every graded case — 452 statements in total, of which 11 cases carry a lifecycle
edge at all — and has five non-vacuity controls, including the executor's own shape: five hooks
released and a sixth leaked.
The multi-hook mode of design §5(a) — per-hook subsequences plus a global multiset, for `Qxt`'s
unbounded merge — ships expressible and controlled on synthetic logs, and grades nothing until a
multi-hook scenario exists.

## 2026-09-01 — the CwdChanged hook event is one `cd` away from a verdict, and `AUt` from recordability — **PAID 2026-09-02 (W7.5)**

W5's registry-derived probe left `CwdChanged` OPEN, correctly — no phase created its condition — but
the row's original justification ("nothing on the SDK's Options moves the engine's cwd mid-session")
was wrong about the seam, and the C8-fix-2 boundary round corrected it: the Bash tool's post-command
tracking (the `tengu_shell_set_cwd` block) reads the shell's final PWD and calls `onCwdChanged` when a
`cd` persists, and the file-watch phase already arms the watcher with Bash enabled. The probe prose now
states the real mechanism.

**Debt:** one follow-up probe phase that runs a persisting `cd` under an armed CwdChanged matcher. If
the event fires, its dispatcher `AUt` becomes recordable and splice-able on the family template — it
shares the watcher-hooks helper `zxt` with the already-spliced `CUt`/FileChanged, so the capture
inventory is already characterized.

**Why deferred:** the verdict table is honest as written (OPEN names the uncreated condition), and W5's
boundary review converged with this as its only probe-shaped residue. Fold the phase into whichever
wave next touches the probe — W7.5's executor work is the natural host, since `zxt` is on its ledger
gap already.

**PAID (2026-09-02, W7.5).** The `cwd-change` probe phase runs one persisting `cd` under the armed
matcher and the event **FIRED** on both hook paths, with the record carrying `old_cwd` and `new_cwd`
after the common prefix. `hooks-cwd-change` recorded it into the corpus (58 to 59) and `AUt` is
spliced as `cwd-changed-hooks`, graded by the hooks parity oracle's new field-order block. One
mechanism claim was corrected on the way past: the notifier that reaches the dispatcher consults the
settings layer and plugin hooks only, never the global store `Options.hooks` callbacks land in, so a
callback alone arms nothing — both the probe and the scenario register through `Options.settings`.

---

## 2026-09-02 — the auto-mode classifier's BLOCK verdict has no scenario, so one producer of the `classifier` decisionReason stays unrecorded

**Source:** the W6/C9 boundary-fix round, adjudicated at design time rather than found in review ·
`reforge/w6/scenarios.ts` (`perm-auto-classifier-deny`), `reforge/w6/probe-permissions.ts`
(phases `auto-classifier` and `auto-classifier-unavailable`), `reforge/src/faults.ts`.

**What:** `auto` mode decides by asking a model. The `classifier` decisionReason has exactly two
producers — the classifier's own BLOCK verdict, and the FAIL-CLOSED arm beneath it that denies when
the classifier call is unavailable. The corpus records the second and not the first.
`perm-auto-classifier-deny` reaches the fail-closed arm with a harmless `chmod` by answering the
classifier's own `/v1/messages` request with a 400 at record time. The block verdict would need a
genuinely dangerous input, judged dangerous, live.

**Cost:** one of the eleven decisionReason kinds is recorded from one of its two producers. The kind
itself is not dark — the fail-closed arm carries it, `PermissionDenied` fires on it, and the parity
oracle grades the arm's rendering against upstream's bytes — so what is missing is the *semantic*
path: nothing in the corpus shows the classifier reading a command, judging it, and refusing.

**Why deferred:** three costs, and they compound rather than add.

1. **The verdict is a model judgement, so recording it takes multiple takes.** The consult is a live
   two-stage classifier call. Whether a given command comes back above the block threshold is not
   something the harness decides; the first `chmod` probe came back `<severity>25` and was allowed.
   Each take is a live recording.
2. **The consult bodies embed transcript and git enrichment**, which is extra matching surface for
   the replay proxy — more run-scoped prose in the request body is more for `canonical.ts` to
   normalize, on a request shape nothing else in the corpus produces.
3. **The classifier model derives from the main model**, so the cassette rots faster than an
   ordinary one: a pin bump that moves the main model moves the classifier's model with it, and this
   scenario needs re-recording when others do not.

Against that, what it buys is one verdict — and it is the classifier's BLOCK, the remaining
producer of a decisionReason the corpus already carries by another route. Revisit alongside §3.3's
`safetyCheck` trigger, which is deferred on the same argument (both need an input this project has
deliberately not designed) and which would amortize the "run something genuinely dangerous in the
sandbox" design pass across two cells instead of one.

---

## 2026-09-02 — `Vvt`'s two DEFAULT PARAMETERS are ungraded, and the owned module does not have them

**Source:** the W6/C9 fix round, found while re-reading the response mapper's oracle ·
upstream `Vvt` in `~/claude-code-bundle/2.1.251/modules/chunk-g1qrzvef.js`
(`function Vvt(t,e,o,r,u=e,l=!1)`), owned in
`reforge/strangle/modules/broker-response-map/reference.js` (`brokerResponseMap`), manifest row
`broker-response-map` in `reforge/strangle/manifest.ts`, oracle block "the response mapper" in
`reforge/strangle/permissions-parity.test.ts`.

**What:** upstream's fifth and sixth parameters carry defaults — `inputTool` defaults to the prompt
tool (`u = e`) and `suppressAlwaysAllow` defaults to `false` (`l = !1`). The owned
`brokerResponseMap` declares neither: its parameter list is positional with no initializers. Every
case in the parity oracle passes all six positionally (`…, stubTool(trace), false`), so no comparison
on either side ever runs with the arguments omitted, and the divergence is invisible to the gate.

**Cost:** none in the spliced build, which is why this is debt and not a bug. The splice transform
keeps upstream's own parameter text in the shim it leaves behind (`paramText` in
`reforge/strangle/ast.ts`, `exciseFunction`), so the retained declaration applies the defaults and
the owned module is only ever called with all six already resolved. The cost is in the standalone
lane: `engine-ts` calls owned modules directly, and a four-argument call there would pass
`inputTool: undefined` where upstream passes the prompt tool — which reaches `lastKnownInput` on an
undefined `.name` rather than falling back. A real caller with fewer than six arguments turns an
ungraded difference into a crash.

**Why deferred:** it is one line in the owned module plus two oracle cases, and neither is urgent
while the shim supplies the defaults. It is logged rather than fixed because the fix belongs with a
decision this campaign has not made in general — whether owned modules reproduce upstream's arity
defaulting or require their callers to resolve it — and making that call for one module in a fix
wave would set the precedent by accident. Pay it in the wave that first drives `broker-response-map`
from the standalone skeleton, and check the other owned modules' targets for initializers at the
same time.

---

## 2026-09-02 — three PURE HELPERS are forwarded as ports instead of owned, against §2.4's taxonomy

**Source:** the W6/C9 fix round · `reforge/strangle/manifest.ts`, rows `permission-precheck`
(captures `denyRuleMessage` / `nEe`, `isPlanModeFloor` / `h7e`, `resolvedInput` / `u7e`) and
`rule-based-permissions` (a second `denyRuleMessage` / `nEe` capture). Recorded in
`reforge/ledger.json` under row `subsystem/permissions`.

**What:** all three upstream bodies are one-line pure functions with no free variables:

```
function nEe(e,n){return`Permission to use ${e} with ${n.ruleValue.ruleContent} has been denied.`}
function h7e(e){return e?.type==="mode"&&e.mode==="plan"}
function u7e(e,t){return("updatedInput"in e?e.updatedInput:void 0)??t}
```

Each is classified `effectful-port` in the manifest and forwarded across the adapter. §2.4's
taxonomy puts them in the `pure-helper` class instead: a pure helper is one the owned module *ships
its own implementation of and uses in both wirings*, with the graph's function neither called nor
compared. `effectful-port` is the class for captures that are effectful or stateful, where the
dependency becomes a typed port and a ledger edge to whichever subsystem owns the far side. These
have no far side to own.

**Cost:** doctrinal, not behavioural. The functions are pure, so calling upstream's copy returns
exactly what an owned copy would; the parity oracle grades the modules that use them, and the port
trace records the calls. What it costs is the campaign's actual purpose — three helpers whose
implementations we could own outright remain the extracted engine's, so `subsystem/permissions`
carries three ports it should not need, and the ownership trend the ledger reports is three
functions pessimistic.

**Why deferred — and explicitly, do NOT churn the splices to fix it now.** Re-classifying a capture
changes the adapter's wiring, the owned module's signature, its inverted twin and every oracle case
written against the current parameter list, and it does so across two manifest rows for `nEe` alone.
That is a real diff over four modules to move three one-line functions from "called correctly" to
"owned correctly", with no behavioural change to show for it and a fresh chance to introduce a
transcription error in bodies that are currently exact by construction. This entry exists so that
the next wave with a reason to touch `permission-precheck` or `rule-based-permissions` reclassifies
them **deliberately, as part of work it was already doing**, rather than either churning them in
isolation or leaving them un-noticed forever. When that wave comes: reclassify to `pure-helper`,
transcribe the three bodies into the owned modules, and drop the corresponding ports from the ledger
row's capture list.

---

## 2026-09-02 — ledger evidence is regenerated one commit after the commit that changed what it describes — **RECURRED 2026-09-03 (C16b/W13b)**

**Source:** the W6/C9 fix round's own commit sequence · `reforge/ledger.json`
(row `subsystem/permissions` and the hook-dispatch row), `reforge/ledger/check.ts`.

**What:** the splice work landed in `e382569b2` ("splice the PermissionDenied dispatcher, and two
functions the wave adjudicated dark"), and the ledger footprints, captures and notes describing it
were backfilled in the *following* commit, `061988b8e`. Between the two, the ledger's evidence
described a tree that no longer existed: it named neither the new `permission-denied-hooks` footprint
nor the `safety-check-reason` and `ask-rule-reason` rows the previous commit had created.

**Cost:** bounded and already closed for this instance, since the catch-up commit landed minutes
later on the same branch. The general cost is that the ledger is the campaign's ownership record and
its `_doc` already states the rule it broke — "every wave child updates its rows in its landing
commit". A reader who checks out the intermediate commit, or a reviewer who reads the ledger at a
commit boundary, gets an evidence list that under-reports what the tree owns. Nothing automated
catches this: `ledger/check.ts` validates the ledger against the manifest at whatever commit it runs
in, so a lagging evidence list is only wrong in history, not in the working tree.

**Why deferred:** there is nothing to fix — the lag is closed. What this entry records is the
**remedy going forward, which is discipline rather than tooling: regenerate ledger evidence in the
same commit as the change it describes.** A separate "ledger catch-up" commit is the anti-pattern,
however tidy it looks in a log. Consider promoting this to a gate check if it recurs: the mechanical
form would be a pre-commit or CI assertion that a commit touching `reforge/strangle/manifest.ts`
also touches `reforge/ledger.json`. That is deliberately not built yet — one occurrence is not
enough evidence that a rule needs enforcement machinery, and the check would fire on manifest edits
that genuinely change no ownership.

**RECURRENCE, 2026-09-03 (C16b / W13b), found by the boundary review.** Two splice commits carried no
ledger change: `d467459` (the shutdown latch owned whole as `CHUNK_REPLACEMENTS[1]`) and `2fe7e0e`
(four of `TWn`'s 44 members), with the ledger evidence landing in `ba7edff` and `2d75065`. Not
retro-fixable — rewriting landed history to move evidence between commits costs more than the lag
does. What the recurrence changes is the tooling argument above: one occurrence was not enough
evidence that the rule needs machinery, and two on different waves is closer to enough. The
mechanical form is unchanged — assert that a commit touching `reforge/strangle/manifest.ts`'s splice
arrays also touches `reforge/ledger.json` — and so is the objection to it: manifest edits that change
no ownership, such as this round's own `darkReason` rewordings, would fire it. If it happens a third
time, build the check with an explicit opt-out marker in the commit message rather than continuing
to log it.

## 2026-09-02 — three debt-grade residues from the C9-fix verification round (CONVERGED)

The round that closed W6's review loop confirmed every fix-wave claim (gate 92/92 reproduced,
355/669/314 attestation, both reversal splices re-measured with the old twins restored) and left
three findings, none contradicting a claim:

1. **The record-time fault injector's predicate has no unit fixture control.**
   `isAutoModeClassifierRequest`/`classifierUnavailable` (`reforge/src/faults.ts`) are guarded only
   indirectly, by the scenario's substance checks — which do fail loudly in both directions
   (fault missed → "no permission_denied frame"; mis-aimed → "the Bash call was never attempted").
   A fixture control (a classifier-shaped request and three near-misses) would pin the predicate
   itself. Do it when the primitive gains its second user.
2. **The campaign-total splice count exists only in build output.** No committed doc states it
   (and none states a stale total, so there is no drift). If a doc ever starts quoting it, make the
   gate or a check derive it.
3. **`firedIn` provenance in the W5 probe's verdict table is prose**, not machine-checked against
   the scenario it names. The named artifacts exist and are gate-covered today; a checker would
   only matter if a `firedIn` row's scenario were ever renamed or dropped.

## 2026-09-02 — three debt-grade residues from W7 (the control protocol, C10)

The wave landed with a green gate (99/99) and three findings that are real, small and deliberately
not fixed inside it.

1. **The control-protocol fixture's `respondsSuccess` / `respondsError` columns under-report.** They
   are recovered by shape — an arm is credited when it CALLS the loop-scope responder that wraps the
   owned success or error envelope — and an arm that answers through the shared error WRAPPER (which
   calls the error responder for it) reads as answering nothing. Three arms are in that position and
   the probe proved at least one of them wrong the same day: `add_directory` is recorded with no
   responder and FIRES with a refusal. The columns are descriptive metadata, not the enumeration the
   wave grades on — the subtype list and the SDK's sendable set are what the gate re-derives — so the
   under-report costs a reader's expectation and nothing else. Fix by resolving the wrapper as a
   third responder shape when someone needs those columns to be load-bearing.

2. **`m2/raw-protocol.ts` carries a bisection hatch on an environment variable.**
   `REFORGE_RAW_CASES` filters the driver's committed case list to a subset, and it exists because a
   control frame that stops the session is the failure mode this driver actually hits — finding which
   one requires running them singly, which is how `get_context_usage`'s twenty-one `count_tokens`
   calls were found. It is harness-side only: `sdkEnv` builds the child's environment from X6's
   allowlist, so the variable cannot reach an engine. Still, it is a knob whose default is the only
   graded configuration, and nothing asserts that it is unset on a gate run. Cheap to harden (refuse
   the flag unless a `--bisect` argument is also present) if a second such hatch ever appears.

3. **Re-recording the raw cassette is now materially more expensive than it was**, and nothing says
   so where the pin-bump ritual is written. `get_context_usage` makes twenty-one further model-side
   calls, so the cassette went from 1 exchange to 23, and every pin bump re-records it. That is the
   honest price of grading a subtype the SDK lane cannot see, and it is worth paying; what is missing
   is a line in `src/pin.ts`'s bump recipe warning that this one suite's re-record is no longer free.
   Related (C10 boundary round): `m2-raw.jsonl` is the only cassette embedding MACHINE-ABSOLUTE
   paths (the sandbox path and the harness config-dir memory path, 4 hits; `m1-plain` has zero),
   because `get_context_usage`'s section walk prints them. A re-record or replay on another machine
   shifts those graded bytes — fold a path scrub or a same-machine note into the same bump-recipe
   line when it is written.

---

## 2026-09-02 — `rewind_files` has a cheap scenario and a poor splice, so W7.5 recorded the measurement instead of taking it

**Source:** the W7.5 rider measurement (charter: take `rewind_files` "only if its scenario is genuinely
cheap") · upstream `Tf` in `chunk-dvbbv89q.js`, 485 B · `reforge/w7/probe-control-subtypes.ts` ·
C10's W7 note ("takeable and anchorable today and wants only a scenario of its own — the probe already
fires the arm and nothing grades its answer").

**What:** the charter's condition was met and the splice was still declined, on two structural facts the
condition does not cover.

*The scenario really is cheap.* Turning on file checkpointing is one env knob; the engine snapshots per
incoming user message on its own, so a three-turn write/edit/rewind conversation creates the state
without an explicit checkpoint call; the answer comes back as the return value of a first-class `Query`
method rather than as a transcript frame, so it lands entirely on the side-channel the scenario controls
and needs no canonicalizer work; and a single recording would reach all four of the function's exits.
Nothing about it resembles the expensive OPEN rows in the W7 subtype table.

*But the splice is thin and the anchor is coupled to the wrong thing.* Four of `Tf`'s five free
variables are effectful ports into the file-history subsystem, and what the body owns is two refusal
sentences, the order of two guards, a dry-run branch and two result field sets — the worst
owned-decision-to-capture ratio of anything in the family, and unlike the watcher dispatchers it owns no
byte-order contract (its fields are consumed as a typed SDK result, not as a stdin stream). And every one
of its three good literals occurs in TWO chunks, because the interactive host object carries a
line-for-line twin with the same three sentences; no untainted extension separates them, and `siblings`
cannot, since it widens uniqueness only within one chunk. A `coLiteral` does resolve it — but the only
chunk-unique co-occurring literals belong to OTHER ARMS of the same control ladder, so the row's locator
would name neither the rewind handler nor its subsystem, which is weaker than the doctrine asks for.

**Cost:** one control-protocol arm keeps firing in the probe with nothing grading its answer, and one of
the four exits (the disabled refusal) is the only one any run has exercised. The gap is coverage, not
correctness: nothing depends on the arm today.

**Why deferred:** taking it would buy very little ownership for a real anchor liability, and the same
effort spent on `zxt` — the watcher-hooks helper both owned watcher dispatchers forward into, already
named on the ledger gap — buys ownership depth in a subsystem the campaign is actively closing. Revisit
if a later wave wants control-arm handler BREADTH rather than depth, or if a pin bump separates the twin.

---

## 2026-09-02 — two prompt-section oracle preludes bind upstream bodies to OWNED constants, the one tolerated exception to C7's rule

**Source:** C10.5's boundary review · `reforge/strangle/prompt-parity.test.ts` (the `M8t` and `C8t`
blocks) · the standing rule from C7's boundary round: *bind extracted upstream bodies to UPSTREAM's
helpers, never the wave's own*, because an oracle that shares an input with the thing it grades is
not an oracle.

**What:** both blocks extract the pinned upstream section builder and evaluate it against a prelude
that declares its free identifiers. For six of the eight W7.5 section splices the prelude declares
upstream's own bytes. For two it does not:

- `M8t` (`# Using your tools`) declares the nine tool-name identifiers from the OWNED
  `TASK_CREATE_TOOL` / `TODO_WRITE_TOOL` / `BASH_TOOL` / … constants.
- `C8t` (the identity/security opener) declares `rKe` and `jfe` from the OWNED `AGENT_IDENTITY` and
  `SECURITY_POLICY`.

Read alone, that is the shape C7 forbids: if the owned constant drifted from upstream, both sides of
the comparison would drift together and the oracle would stay green.

**Why it is not a false green:** all eleven identifiers are `primitive` captures, and the taxonomy's
check for a `primitive` is a per-delegation `assertGraphValue` in the adapter, comparing the value
DERIVED from the graph against the owned constant on **every request the corpus makes**. So the
drift these preludes cannot see is caught one layer down, by a check that runs far more often than
the oracle does. What is exceptional is only where the coverage lives, not whether it exists.

**Cost:** a reader auditing `prompt-parity.test.ts` in isolation cannot tell a deliberate taxonomy
choice from an oversight, and a future section splice could copy the pattern for a capture that is
NOT a `primitive` — where no adapter assertion would catch it — without anything objecting.

**Why deferred:** the alternative is re-deriving eleven string constants from the bundle inside the
oracle, duplicating the manifest's own `derive` regexes to buy a check the adapter already performs
per request. The honest fix is documentation, which this entry is. Revisit if a prelude ever declares
a non-`primitive` capture from an owned value — that one would be a real hole.

## 2026-09-03 — `twn-claim-shutdown` / `twn-release-shutdown-claim` darkOver is two of three signal paths

Found by the C16b fix-wave verification (pre-existing, not introduced by the fix range). Both rows declare `darkOver: [sigterm-mid-turn, sighup-mid-turn]`; the D2 principle (the population is all three headless signal paths) applies the same way. Defensible today because their darkness rests on interactive-only callers, but the honest population is three. Fix is a one-line widening of each row; it needs a gate run to grade, so it rides on the next gate-running wave (C12a) rather than a standalone three-hour run. Close this entry when that gate lands with `dark over 3 scenario(s)` on both rows.

**CLOSED 2026-09-03 (C12a / W9a).** Both rows widened to all three headless signal paths; the gate rebuilt each inverted twin and re-measured it, and both read `PASS  liveness twn-claim-shutdown (dark over 3 scenario(s))` and `PASS  liveness twn-release-shutdown-claim (dark over 3 scenario(s))` inside a **147 of 147 summary phases, zero FAIL** run (`GATE PASS — every splice is live AND the faithful build is equivalent`). The general lesson is C16b-fix's D2 restated: a `darkOver` list is a POPULATION, and a population narrower than the claim leaves the difference asserting nothing.

## 2026-09-03 — a dark row's verdict reads the whole SCENARIO, so a red on any other surface reports it as reachable

**Source:** C12a / W9a's first full gate run (`/tmp/c12a-gate4.log`, lines 336–368) ·
`reforge/strangle/gate.ts`, the `darkOver` block.

**What.** A splice adjudicated DARK is rebuilt with an inverted twin and its `darkOver` scenarios must
stay GREEN; a RED one is reported as `NO LONGER DARK. The corpus now reaches <row>; the darkReason is
stale and the row needs coverage instead`. That message is a REACHABILITY claim, and the verdict it
rests on is not: `replayTag` returns the scenario's whole verdict, which is red if ANY of its four
surfaces differed.

Measured on that run. C12a's new config-store surface had one unmapped field, so `hooks-precompact`
went red on state alone. Two dark rows cover it — `hook-output-sync` (over eighteen scenarios) and
`hook-stderr-tail` (over ten) — and both reported NO LONGER DARK, naming a reachability that did not
exist. Every other covering scenario stayed GREEN in both rows, which is exactly the shape that should
have made the claim suspect: a twin that is genuinely reached by a scenario is reached because of what
the twin changed, not because an unrelated surface moved.

**Cost.** Two of five FAILs in a three-hour gate run pointed at the wrong subsystem. The rows were
correct; the wave that read them nearly converted two sound `darkReason`s into coverage rows over a
scenario that does not reach either predicate. Both are still dark and unchanged.

**Fix, not taken here.** The dark-row check has the information it needs and does not use it: the
FAITHFUL build's verdict for the same scenario is measured in the equivalence phase of the same run.
When the faithful build is itself red on a `darkOver` scenario, the twin's red says nothing about the
twin, and the dark verdict should be INCONCLUSIVE — an outcome the gate already has language for
(`a run that graded nothing is not evidence of liveness`) — rather than a reachability claim. Cheaper
variant, if ordering makes that awkward: report which SURFACE reddened, so a state-only red is legible
as one. Not fixed in C12a because the phase ordering puts equivalence after the liveness loop and
reordering it is a change to the gate's own shape, which is not a storage-machinery wave's to make.

## 2026-09-03 — the `sessions/<pid>` family is declared but not projected

**Source:** the C12a / W9a fix wave (F5) · `reforge/src/observed.ts` (`generalizePath`),
`reforge/research/tools/extract-config-inventory.ts` (`PATTERN_REASONS`),
`reforge/research/fixtures/config-dir-inventory-2.1.251.json`.

**What.** A reviewer killed a standalone `attest --check` mid-run. Its orphaned engine child left
`config/sessions/10747.json` and `config/sessions/10747.<hex>.key` behind, and the next reset censused
both into `build/config-observed.json` — where they then failed `extract-config-inventory.ts --check` as
undeclared patterns. The census was repaired (the two rows removed; `build/` is derived and gitignored)
and the family declared honestly in the inventory: `sessions/<pid>.json` and `sessions/<pid>.<hex>.key`,
`graded: admitted` because `src/state.ts` hashes `sessions/**` raw, each carrying the provenance —
0 of 1,768 clean resets produce one.

**What is NOT done.** `generalizePath` has no `<pid>` token, so it cannot mint those patterns: a real
`sessions/12345.json` would arrive undeclared and red the tripwire by name. That is the safe direction,
and it is why the projection was not bought — a `<pid>` substitution over bare digits is the broadest
generalization in the file (any 1–7 digit segment anywhere), and buying it for a family no clean run
writes would weaken the tripwire in exchange for nothing.

**Cost if nobody pays it.** A scenario that deliberately leaves a peer-registry entry — C11d's edge is
the candidate — reds the inventory check once and needs the projection written before it can be
declared. One `generalizePath` rule anchored on `sessions/`, plus a fixture regeneration.

**Fix when:** a scenario reaches the family on purpose.

**CLOSED 2026-09-05 (H1 gate-inventory fix, commit `5cd90df`).** Paid before a scenario reached the
family, because the second incident showed the deferral's cost was not the one written above. The
entry priced the debt as "reds the inventory check once" for the wave that reaches the family
deliberately. What it actually costs is paid by everyone else: the census is an ACCUMULATOR shared by
every wave in a checkout, so an unclean kill *anywhere* reds the tripwire on *every later gate* until
an operator hand-deletes rows from `build/config-observed.json`. That happened twice — the C12a
incident above, and again during H1's gate (`157 PASS / 1 FAIL` over 158 phases), where a corpus run
killed to hand the sandbox lock to a sibling left `sessions/70765.json` and its `.key` behind.

The generalization is narrower than the entry feared. It is not "any 1–7 digit segment anywhere" but
`^sessions\/\d+(?=\.)` — the digits must be the first dot-component of a name directly under
`sessions/`, the only place the engine writes one — so `projects/<slug>/12345.jsonl`,
`tasks/12345/1.json` and `sessions/12345/peer.json` keep their digits, each with a control in
`reforge/src/observed.test.ts` (a new gate phase, 15 checks; dropping the anchor fails four of them).

And the property the deferral was protecting is kept, at its proper scope: the loud red for a run that
leaves a peer-registry entry belongs on the PER-RUN state surface, not on the cross-wave tripwire.
`reforge/src/state.ts:179` admits `sessions/**` and hashes it, and `entryOf` records the path verbatim,
so a graded run that leaves one still fails on a pid-named path. Second half of the fix:
`regeneralizeEntries` in `reforge/src/observed.ts`, shared by the reset that writes the census and the
tool that checks it, re-generalizes stored keys on load and sums the counts of rows that fold together
— so a row written under an older rule heals at the next reset instead of in an editor.

## 2026-09-03 — seven cassettes are recorded against the baseline seed and record no hash of it

**Source:** the C12a / W9a fix wave, verification round · `reforge/m1/run.ts` (the sidecar),
`reforge/src/precondition.ts` (`baselineSeedHash`), `reforge/m2/faults.ts`,
`reforge/m2/raw-protocol.ts`, `reforge/w13/signals.ts`.

**What.** F4 made the precondition sidecar record BOTH halves of the applied world — the scenario's
declaration and a hash of the baseline `.claude.json` seed that `applyPrecondition` puts underneath it
— so that a baseline change without a pin bump is a named FINDING at replay time rather than a silent
re-grading. Only `m1/run.ts` writes and reads that sidecar. Seven primary cassettes are recorded by
other runners: `m2-fault-malformed-event`, `m2-fault-overloaded`, `m2-fault-rate-limited`,
`m2-fault-server-error`, `m2-fault-truncated-stream` (`m2/faults.ts`), `m2-raw`
(`m2/raw-protocol.ts`) and `w13-signals` (`w13/signals.ts`). All three runners call `resetSandbox()`,
so all seven ARE recorded against the baseline seed — they simply write nothing down about it.

**Cost if nobody pays it.** For those seven, a change to `baselineConfigJson` that is not accompanied
by an engine-pin bump replays green against a filesystem that is not the one the cassette answers.
That is exactly the failure F4 exists to prevent, on 7 of the corpus's 70 primary cassettes. It is
latent today because nothing has changed the baseline since it was introduced.

**Fix when:** the wave that changes the baseline seed — C14a, which seeds a non-zero `skillUsage`
through `ConfigPrecondition.seed` — reaches it. The fix is to lift the sidecar write/compare out of
`m1/run.ts` into a helper the three other runners call, keyed by their own cassette names; the drift
message and the re-record path already exist.

**Narrowed, not closed, 2026-09-05 (H1).** `m1/run.ts --reseal` now pays the baseline change for the
63 cassettes that DO carry a sidecar: it replays each drifted declaration against its own cassette on
engine-real and re-seals the sidecar when the proxy's three signals come back clean, so C14a's
`skillUsage` seed costs a re-seal rather than 63 live re-records. These seven are outside that
mechanism for the same reason they are on this list — no sidecar to re-seal, and nothing that would
write one — so the helper this entry asks for is still the fix, and it is now the ONLY remaining
re-record cost of a baseline change.

## 2026-09-05 — a corpus scenario that REFUSES TO GRADE is read by the liveness loop as a sabotage observed

**Source:** found in passing by H1 (the precondition re-seal) · `reforge/m1/run.ts` (the refusal and the
verdict block), `reforge/strangle/runners.ts` (`classifyReplay`), `reforge/strangle/gate.ts` (the
per-target liveness loop).

**What.** `classifyReplay` reads a runner's own verdict line: `FAIL  <tag>` is RED, `PASS  <tag>` is
GREEN, anything else is INCONCLUSIVE — a three-outcome rule C9 introduced precisely so that "the
runner died" could not be mistaken for evidence. But a corpus scenario can now print `FAIL  <tag>`
for a HARNESS reason rather than a behavioural one: a drifted precondition sidecar has failed the
scenario by name since C12a, and H1 added a refusal-before-replay for a MALFORMED one (no
`baselineSha256`, or no sidecar at all). In the LIVE direction the liveness loop requires RED, so a
scenario that refused to grade would satisfy the row without any sabotage having been observed at
all. The DARK direction is safe — it requires GREEN, so a refusal fails the row loudly, which is the
correct outcome.

**Cost if nobody pays it.** A row could report "this target is live" on a scenario that graded
nothing. It is latent rather than live today: the drift census is 0 of 63 (measured 2026-09-05), and
a refusal is loud in the log — but the gate's own summary would read PASS, which is the direction
that matters. The vacuity is the same shape as the one the three-outcome rule was written for, one
layer in.

**Fix when:** the next wave that touches the verdict vocabulary. The shape is small — the runner
prints a THIRD verdict (a refusal is neither PASS nor FAIL for the tag), `classifyReplay` maps it to
INCONCLUSIVE, and `m2/relay.ts` learns the line so the gate still names it. It is not taken here
because the vocabulary is read by four layers (`m1/run.ts`, `m2/all.ts`, `strangle/gate.ts`,
`strangle/attest.ts`) and changing it under a sibling worker's in-flight wave is a worse trade than
recording it.

## 2026-09-05 — the P2 lesson regressed: five wave directories and `research/` are outside `tsc`

**Source:** found by C13c while adding `w10/` to the include list · `reforge/tsconfig.json`.

**What.** `reforge/README.md`'s P2 entry records the fix for exactly this: "`tsconfig.json` covered
only `src/` and `m0/`, so `npx tsc --noEmit` passed green while never checking `m1 m2 m2c m3
strangle` — a real TS2339 sat hidden in `m3/probe-origin.ts` (tsx transpiles without checking)". The
include list was widened then and has not been widened since. `w2/`, `w3/`, `w4/`, `w5/`, `w6/`,
`w7/`, `w9/`, `w13/` and `research/` have all been added to the tree without being added to it, so
the same green-while-checking-nothing state is back for nine directories.

**Measured, not inferred.** Widening the list to include them was tried and reverted: it surfaces a
real `TS2322` at `reforge/w5/probe-hook-events.ts:316` — a `Record<string, unknown[]>` passed as
`Options.settings.hooks`, which the SDK types as a structured hook map. `tsx` transpiles without
checking, so the probe runs; nothing else has ever looked at it. `w10/` was added alone, and it type-
checks clean.

**Cost if nobody pays it.** Every wave directory added from here inherits the same blind spot, and a
type error in a probe or a scenario is found by a failing run rather than by a compile. There is no
`tsc` phase in the gate either, so the check is a recipe somebody remembers to run — which is the
same vacuity the gate's own phases exist to refuse.

**Fix when:** the next wave that touches `w5/probe-hook-events.ts`, or any wave with room to fix one
cast. The shape is: type the settings hook map properly (or cast it at the one site), widen the
include list to every wave directory plus `research/`, and consider a `tsc --noEmit` phase in the
determinism block, which is build-free and takes a few seconds. Not taken here because it means
editing another wave's probe while two workers are in flight in one checkout, and the fix is worth
less than the conflict.

---

## The shell-parser attestation's `contract.why` quotes the corpus size it had before it was widened (C13a, 2026-09-05)

`strangle/attestation.ts`'s `shell-parser` entry describes its oracle as comparing parse trees "over
sixteen partitions of the input domain and 1,891 command strings". Both numbers were true when the
sentence was written and are not now: the corpus was widened later in the same wave to **seventeen
partitions and 2,170 command strings**, which is what `strangle/parser-parity.test.ts` prints on
every run (8,040 checks) and what the gate archive records.

**Why it was not fixed in place.** That sentence is printed verbatim into `attestation/coverage.md`,
so correcting it makes the committed report differ from what a run would write, and `attest --check`
— a gate phase — compares those bytes. Fixing the number therefore requires regenerating the report,
which replays 40-odd scenarios under the sandbox lock. It was attempted and failed for a reason that
had nothing to do with the number: a second worker had `src/observed.ts` modified in the shared
checkout at that moment, and four scenarios came back with state differences that were the edit's,
not the engine's. Retrying would have meant racing another worker's uncommitted change to the state
surface, and the fix is worth less than that race.

**Cost if nobody pays it.** A reader of `attestation/coverage.md` sees a corpus size 279 strings and
one partition smaller than the one that produced the coverage below it. Nothing is graded wrong — the
counts, the states and the adjudications are all this run's own output — but the sentence that
explains WHY 3,060 branches count as evidence understates the evidence.

**Fix when:** the next wave that regenerates the attestation for any other reason. The shape is two
edits in `strangle/attestation.ts` (`sixteen` → `seventeen`, `1,891` → `2,170`) and one
`npx tsx strangle/attest.ts` on a quiet checkout. Better still, write the sentence without the
numbers — the suite prints its own — so it cannot go stale a second time.
