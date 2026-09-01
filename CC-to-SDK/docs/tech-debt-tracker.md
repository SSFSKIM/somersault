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

## 2026-09-01 — reforge's hooks parity trace compares per-port call lists, so cross-port INTERLEAVING is ungraded

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

## 2026-09-01 — the CwdChanged hook event is one `cd` away from a verdict, and `AUt` from recordability

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
