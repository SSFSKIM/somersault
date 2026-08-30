# CC-to-SDK tech debt

Known, deliberately unpaid debt. One entry per item: what it is, where it came from, what it costs if
nobody pays it, and why it was deferred. An item leaves this file by being fixed or by being shown not to
be debt — not by ageing out.

Nothing here is a bug report waiting for triage. Each of these was adjudicated once, judged real, and judged
not worth the change at the time. Re-read the "why deferred" line before acting on one: if the reason still
holds, leave it.

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

---

## 2026-08-31 — `clipboardImage-codec.test.ts`'s oversized-PNG cells race the codec's 2 s belt

**Source:** BL7 Task 5, which diagnosed and paid off the `imageCodec-encode.test.ts` entry that stood here
and found this one sharing its mechanism · `test/unit/clipboardImage-codec.test.ts` with
`src/tui/clipboardImage.ts`.

**What:** `reencodeImage` BUILDS its own deadline (`Date.now` against the 2 s `PROCESSING_BUDGET_MS`)
spanning the decode and every rung of the retry ladder; when it trips, the ladder returns
`budget-exceeded` instead of finishing. The encode test's cells were fixed by handing `reencodeImage` a
frozen clock, but these two cells reach the ladder through `pasteClipboardImage`, which takes no clock —
`ClipboardDeps` has no seam for one. Measured on a 10-core machine: at 2x CPU oversubscription both cells
pass, spending ~1.7 s of the 2 s budget; at 4x, both red with `expected 'image-failed' to be 'image'`.

**Cost:** on a heavily loaded host, two reds that are not regressions — the same re-run-and-judge tax the
encode entry used to carry, at a higher load threshold.

**Why deferred:** the fix is a production seam (a clock, or a codec injection point, on `ClipboardDeps`)
added purely for a test's benefit, and the measured trigger is 4x oversubscription — well past a gate run
sharing a machine with normal work (five full-suite runs and a 2x-load run were green). The belt itself is
a deliberate cooperative guard, not a defect, so there is nothing to fix on the product side. Revisit if
this reds in a real gate; compare against the 2x/4x measurements above rather than re-deriving them.

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

## 2026-08-30 — `peerInbound.ts` is past 600 lines

**Source:** M9 review ledger (module-size advisory) · `src/appserver/peerInbound.ts`.

**What:** the file now carries adoption, the seed window, the live queue and the logging path together.

**Cost:** the usual — a hot file that every arrival-related change has to touch, and reviewers who have to
hold four state machines at once.

**Why deferred:** the four parts share one state object and one frame-ordering argument, so a split has to
be designed rather than performed; doing it during a fix wave would put the milestone's riskiest code
through an untested refactor. Do it as its own change.
