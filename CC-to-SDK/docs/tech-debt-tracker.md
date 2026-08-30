# CC-to-SDK tech debt

Known, deliberately unpaid debt. One entry per item: what it is, where it came from, what it costs if
nobody pays it, and why it was deferred. An item leaves this file by being fixed or by being shown not to
be debt — not by ageing out.

Nothing here is a bug report waiting for triage. Each of these was adjudicated once, judged real, and judged
not worth the change at the time. Re-read the "why deferred" line before acting on one: if the reason still
holds, leave it.

---

## 2026-08-30 — a literal closing tag in a peer body truncates that sender's own text

**Source:** M9 branch external review, round 2 (P2) · `src/peer/address.ts` (the depth-counting envelope
scan, `envelopeBodies`).

**What:** a peer message whose body contains a literal `</cross-session-message>` or `</agent-message>`
matching its own wrapper is read as ending there. `before </cross-session-message> after` decodes as
`before `, and the rest of that message is dropped from the item, the log entry and history alike.

**Cost:** one sender loses the tail of one message it wrote. It cannot reach any other session's text: the
truncation is confined to the frame the sender itself produced.

**Why deferred:** the CLI's wrapper grammar carries no escaping and no length prefix, so nothing in the
frame distinguishes a payload tag from the real terminator — a fix means either inventing framing this
server does not control, or failing the whole message closed, which loses more than the truncation does.
Self-inflicted-only and bounded; not worth either trade until a real sender hits it.

---

## 2026-08-30 — `EMPTY_ARRIVALS` is an exported mutable singleton

**Source:** M9 review ledger (carried minor) · `src/appserver/items/project.ts`.

**What:** the empty `ResolvedArrivals` is a shared exported object rather than a constructor. The rule it
relies on — construct fresh, never mutate — is a convention, not a type.

**Cost:** one caller that mutates it corrupts every later projection in the process, silently.

**Why deferred:** every current caller reads it only, and the parity-law property test would redden loudly
on a mutation that changed a projection. Bounded until a new caller appears.

---

## 2026-08-30 — items-test corpus fixtures are duplicated rather than shared

**Source:** M9 review ledger (carried minor) · `test/unit/appserver/items/corpus.ts` versus the row builders
open-coded in `test/unit/appserver/subscribe-arrivals.test.ts` and `search-arrivals.test.ts`.

**What:** `items/replay.test.ts` and `items/project.test.ts` share `TRANSCRIPT_CORPUS`; the reply-side
suites spell their own `USER`/`ASSISTANT`/`ENTRY` builders instead of drawing on it.

**Cost:** data drift — one copy updated for a shape change and the other not, leaving a suite that agrees
with itself about a shape the code no longer produces.

**Why deferred:** the duplication is small and both copies are read by tests that fail loudly on drift in
the code. Lift it the next time either corpus is edited.

---

## 2026-08-30 — search reports a duplicate-anchor arrival at both rows; `thread/read` picks the first

**Source:** M9 review ledger (documented divergence) · `src/appserver/search.ts` (~:696).

**What:** where an anchor resolves at two indistinguishable rows (M5's 1,562 measured duplicate uuids),
`thread/searchOccurrences` reports the arrival at both positions while the projector's first-match-wins
renders it at one.

**Cost:** a client comparing the two methods sees one more occurrence than history contains.

**Why deferred:** it is not drift but a genuine difference in what the two methods claim — the projector
composes one ordered history and must choose, while an occurrence is a claim about a position and both
positions are equally true of what was recorded. Documented at the call site; a "fix" would have to invent
an occurrence identity the data does not carry.

---

## 2026-08-30 — a pre-M9 row-phase search cursor at `r === 0` skips the `atStart` group

**Source:** M9 review ledger (upgrade artifact) · `src/appserver/search.ts`.

**What:** a search cursor minted before this milestone, resumed at row phase 0, walks past the
null-anchored arrival group for that one in-flight walk.

**Cost:** one walk in progress across the upgrade may miss arrivals that precede every row. New walks are
unaffected.

**Why deferred:** one-time and self-clearing — the cursor is gone as soon as that walk ends. Versioning the
cursor to fix it would break D1, which is the one constraint the whole milestone was designed around.

---

## 2026-08-30 — `tick()` macrotask waits instead of `vi.waitFor` in the arrivals suite

**Source:** M9 review ledger (carried minor) · `test/unit/appserver/arrivals-clear-degraded.test.ts`.

**What:** this suite drains the microtask/macrotask queue a fixed number of times where the `fr-*` family
polls a condition with `vi.waitFor`.

**Cost:** a future change that adds an await to the path makes the wait too short, and the test fails as a
flake rather than as a statement about behavior.

**Why deferred:** the suite is deterministic today (the engine fake is push-driven, and the reads it waits
on are injected), and converting it is mechanical work with no current failure to motivate it.

---

## 2026-08-30 — `imageCodec-encode.test.ts` retry ladder reds intermittently under full-suite load

**Source:** M9 gate runs (carried) · `test/unit/imageCodec-encode.test.ts`.

**What:** the encode retry-ladder assertions fail occasionally when the whole unit suite runs in parallel,
and pass when the file runs alone.

**Cost:** a red that is not a regression, which costs whoever is running the gate a re-run and a judgement
call each time.

**Why deferred:** the suspicion is memory pressure from parallel workers changing where the ladder stops,
which means the fix is either a resource bound on the test or a rewrite of what it asserts — and neither is
worth doing on a suspicion. Isolate and record when it reds; do not accept a red that reproduces alone.

---

## 2026-08-30 — `peerArrival` JSON-stringifies non-string, non-array content

**Source:** M9 review ledger (carried minor) · `src/peer/address.ts`.

**What:** for a frame whose `message.content` is neither a string nor a block array, the fallback renders
`JSON.stringify(content)` over `origin.body`.

**Cost:** a client would see a serialized object where a message should be.

**Why deferred:** unreachable for real CLI frames — every measured peer frame carries a string or a block
array — so the branch exists only to avoid an undefined, and changing it would be changing untested,
unreached code.

---

## 2026-08-30 — `peerInbound.ts` is past 600 lines

**Source:** M9 review ledger (module-size advisory) · `src/appserver/peerInbound.ts`.

**What:** the file now carries adoption, the seed window, the live queue and the logging path together.

**Cost:** the usual — a hot file that every arrival-related change has to touch, and reviewers who have to
hold four state machines at once.

**Why deferred:** the four parts share one state object and one frame-ordering argument, so a split has to
be designed rather than performed; doing it during a fix wave would put the milestone's riskiest code
through an untested refactor. Do it as its own change.
