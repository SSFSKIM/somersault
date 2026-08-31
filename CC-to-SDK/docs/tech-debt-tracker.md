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

**2026-08-31 (BL7, D-BL7-4):** re-read and left standing, reason unchanged — the fix still lands inside
D3's explicit-refusal scope, which is the owner's decision to revisit and not this round's.

---

## 2026-08-31 — an oversized clipboard paste can lose to the codec's 2 s belt on a busy machine

**Source:** BL7 Task 5, which diagnosed and paid off the `imageCodec-encode.test.ts` entry that stood here
and found the same race still live on the production path · `src/tui/clipboardImage.ts` with
`test/unit/clipboardImage-codec.test.ts`.

**What:** `reencodeImage` BUILDS its own deadline (`Date.now` against the 2 s `PROCESSING_BUDGET_MS`)
spanning the decode and every rung of the retry ladder; when it trips, the ladder returns
`budget-exceeded` and the paste becomes an `image-failed` chip. The encode test's cells were fixed by
handing `reencodeImage` a frozen clock; `pasteClipboardImage` cannot be, because it takes no clock —
`ClipboardDeps` has no seam for one — and a real paste would not want a stubbed one anyway. Measured on a
10-core machine against the 3200x1800 fixture: idle, the Linux cell spends ~820 ms of the 2 s budget; at
2x CPU oversubscription ~1.7 s; at 4x the Linux and Windows cells both red,
`expected 'image-failed' to be 'image'`.

**Cost:** two costs, and the larger one is the user's. A trip on a real paste is USER-FACING: the
`image-failed` chip renders into the submitted turn as `[Image could not be processed: <reason>]`
(`src/tui/pasteChips.ts:204`), so on a machine that happens to be busy an ordinary oversized screenshot
reaches the model as an apology instead of an image. The measurements above say that is not a remote
corner: the margin is only ~2.4x at idle and is gone by 2x oversubscription — a laptop compiling, on a
call, or running a couple of agents. The second, smaller cost is the familiar one: those two test cells
red under the same conditions, costing whoever runs the gate a re-run and a judgement call.

**Why deferred:** the belt is a deliberate cooperative guard, so the fix is not "remove the deadline" — it
is a product decision this task has no mandate to make: raise `PROCESSING_BUDGET_MS` for the interactive
paste path, make the budget scale with pixel count, or let a trip fall back to shipping the image
unresized rather than dropping it. Each changes what a user gets from a slow paste, which is a taste call
for the owner, not a mechanical fix. What is settled and recorded here is the measurement, so that call
can be made on numbers. Revisit alongside any work on the clipboard paste path; do not re-derive the
2x/4x curve, and do not close this by stubbing a clock into the test — that would hide the user-facing
half while paying only the flake half.

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
