# BL7 — live-channel attribution honesty, and the M9 debt ledger (design)

**Purpose.** M9 made *history* honest: `thread/read` and `thread/searchOccurrences` place every arrival
they can prove and count every one they can't. The **live channel** still is not, in two measured ways this
round closes, plus the debt M9 deliberately banked:

1. **(#63)** `thread/peerMessage` announces `origin` verbatim and nothing else — so in a collapsed batch a
   client rendering `origin.body` shows the CAUSING message N times while the item channel shows each
   frame's own text. The channels disagree about what one `arrivalUuid` says.
2. **(#64)** `drainArrivals` empties the live queue into whatever adoption is *current*, so an arrival
   recorded while no adoption exists is later emitted as a user item of a turn it did not cause — the live
   channel's own misplacement class, the exact shape M9 forbids in history.
3. The **tech-debt tracker** (`CC-to-SDK/docs/tech-debt-tracker.md`) holds ten entries; each is
   re-adjudicated here — six are paid this round (one of them partially: the truncation entry's foreign
   half has no fix this server controls), three stand with their reasons re-affirmed, and one (a test
   flake) gets a diagnosis with a decision rule rather than a promise.

Out of scope, stated so nobody re-derives it: the dead-engine `busy === true` liveness problem (#64's
"related" note) needs its own timeout/liveness design and touches every turn, not just adopted ones;
fork-inherited arrival history stays under D3's explicit-refusal scope (owner decision, M9 spec rev 9.2).

## Grounding (what exists today)

- `announceArrival` (`src/appserver/peerInbound.ts:~455`) broadcasts
  `{ threadId, arrivalUuid, origin }` and its own comment names the #63 defect and the fix's precondition:
  "closing it means deciding what `origin` MEANS when the engine has collapsed several messages into one
  frame — not quietly editing a verbatim field."
- `peerArrival` (`src/peer/address.ts`) already resolves per-frame text (own envelopes → own raw text →
  `origin.body` only for a textless frame) and `PendingArrival.text` carries exactly that string to every
  path — item, entry, and (after this round) announcement.
- `drainArrivals` (`peerInbound.ts:~610`) drains the WHOLE queue into `state.adopted` with no binding.
  Its callers: every frame while adopted, adoption's runner install, and `groundSeed`.
- `activeTurnId(record)` (`src/appserver/registry.ts:508`) yields the OWN turn's id while busy, and the
  record carries the started-broadcast gate subscribe-time replay already uses — the pieces an own-turn
  emission needs all exist.
- Unit coverage: `test/unit/appserver/peer-inbound.test.ts` (adoption, teardown, announcements),
  `peer-inbound-log.test.ts` (seed/anchor cells incl. 9b/9c). No cell pins the defective carry-across
  drain, so #64's fix contradicts no existing assertion.

## Stream 1 — #63: the announcement says what the arrival says

`thread/peerMessage` gains one field: `text` — **the same string the arrival's item carries**, i.e.
`PendingArrival.text` as `peerArrival` resolved it. Payload becomes
`{ threadId, arrivalUuid, origin, text }`. Additive and optional on the wire; no coordinate moves.

**What `origin` MEANS — decided once, for both channels** (this sentence lands in the code comment and the
parity doc): *`origin` is the engine's verbatim delivery provenance — `verifiedPeerPid` is the only
kernel-vouched fact in the exchange, and in a collapsed batch `origin.body`/`msg_id` name the CAUSING
message, not this arrival. `text` is what THIS arrival says: the frame's own resolved text, identical under
the same `arrivalUuid` on the announcement, the live item, the projected row, and the replayed row.* The
two are deliberately not reconciled — reconciling would invent an attribution the data does not contain
(probe 121, verdict C: per-message identity in a batch is non-bijective; text coverage is the claim).

Touches: `announceArrival` (one field), the notification's schema/doc surface (`src/appserver/schema/peer.ts`
if notifications are typed there, `docs/parity/appserver.md`), unit cells in the `thread/peerMessage`
describe block (batch case: announcement text equals item text under one uuid), and a live assertion
(existing LEG, no new leg: the announcement captured in LEG 2/10 now also carries `text` equal to the
item's).

## Stream 2 — #64: an arrival is attributed by bracket evidence, never by queue position

**The rule.** An arrival belongs to the turn bracket OPEN at the moment its frame arrived; if none is open,
to the NEXT bracket that opens on this thread — which is where the engine's own message queue drains (LEG 5
measured exactly this attribution for batched messages). It is NEVER carried past that bracket: a bound
arrival whose turn ends without emitting it is dropped from the live channel, loudly — it was already
announced (`thread/peerMessage`) and logged (M9), so nothing leaves history. Re-attribution to a later turn
is forbidden; that is the defect.

Cases, concretely:

- **(a) adopted bracket open** at arrival → bound to that adoption; drained into it exactly as today
  (mapper-install or per-frame). LEG 1/4/5/10 shapes unchanged.
- **(b) own turn busy** at arrival (the fold-into-our-turn shape: the engine emits a nested lifecycle
  bracket, `adopt` correctly declines on busy, and today the arrival then leaks to a later foreign turn) →
  bound to the OWN turn (`activeTurnId`), emitted into it via the same `emitItems` path adopted turns use —
  gated on the started-broadcast flag so no item precedes its own `turn/started`, queued until a later
  drain when the broadcast is still pending.
- **(c) nothing open** → bound "next": stamped onto the first bracket a drain observes open, own or
  adopted. The engine queues undelivered messages and the next turn drains that queue, so the next bracket
  is the engine's own attribution, not a guess. No timers, no heuristics.
- **(d) bracket death** → an adoption terminated without a mapper, an epoch swap, an own turn observed
  over: its bound arrivals are dropped from the live queue with a `console.warn` naming the count.
  `uninstallPeerInbound` keeps its existing clear.

Mechanism: each queued `Arrival` gains a binding (`{ kind: "adopted", commandUuid, epoch } |
{ kind: "own", turnId } | { kind: "next" }`); `drainArrivals` generalizes to "drain into the currently open
bracket the arrivals bound to it (re-stamping `next`), drop arrivals whose bracket is provably dead" and
runs where it runs today plus on frames while an own turn is busy. Seed-window arrivals bind at flush time
(`groundSeed`) under the same rule — the window is milliseconds long and records no per-arrival bracket.

Live behavior deliberately unchanged: announce-once-per-message, announce-at-arrival-with-no-turnId, the
32-cap with oldest-first eviction, persist-before-broadcast ordering. The ONLY visible changes: an arrival
never appears as an item of an unrelated later turn, and a fold into an own turn now emits into that own
turn (new, correct — previously it leaked or sat forever).

Tests: unit cells for (b) (arrival during own busy turn lands in THAT turn, and a later foreign adoption
does NOT receive it — the misattribution pin), (c)+(d) (idle arrival binds to next bracket; bound arrival
dropped at bracket death, warn observed), plus the existing adoption suite green unchanged. Live: existing
LEGs stay green (they exercise (a) and (c) end to end); keyed rerun required.

## Stream 3 — the debt ledger, adjudicated entry by entry

**Paid this round (6):**

1. **`EMPTY_ARRIVALS` mutable singleton** (`items/project.ts`) — make mutation impossible rather than
   conventional (freeze, or an accessor returning a frozen empty; executor's call — the parity law's
   call sites are identity-indifferent).
2. **Duplicated corpus fixtures** — the tracker's own trigger ("lift it the next time either corpus is
   edited") fires this round: #63/#64 edit these suites. Lift the shared `USER`/`ASSISTANT`/`ENTRY`
   builders into `test/unit/appserver/items/corpus.ts` and consume them from `subscribe-arrivals` and
   `search-arrivals`.
3. **`tick()` macrotask waits** (`arrivals-clear-degraded.test.ts`) — convert to `vi.waitFor` per the
   `fr-*` family's pattern.
4. **`peerArrival` JSON-stringifies exotic content** — not a behavior change: pin the current fallback
   with a unit cell so "untested unreached" becomes "tested defined". Changing unreached code buys nothing.
5. **Literal closing tag truncates the sender's own body — the half we control.** The debt entry stands
   for FOREIGN senders (no framing exists), but OUR gateway can stop producing self-truncating frames: at
   `peer/send`, refuse a body the harness's own decoder would not read back intact (wrap → `envelopeBodies`
   → expect exactly the body back; refusal is the established posture — "refusing is recoverable; a silent
   downgrade is not"). Balanced quoted envelopes round-trip fine (depth counting), so ordinary
   envelope-quoting traffic (52 measured rows) is untouched; only unbalanced wrapper tags refuse. Tracker
   entry updates to name the remaining foreign-sender residue.
6. **`peerInbound.ts` past 600 lines (now 692 + this round's additions)** — the tracker says "design the
   split, do it as its own change"; this round is that change, and the split goes LAST, behavior-preserving,
   after streams 1–2 land. Seams (three modules + the existing file as install/uninstall facade holding
   `PeerInboundState`):
   - `peerAdoption.ts` — adopt/settle/drain, lifecycle routing, `ourUuids`, the binding logic;
   - `peerSeed.ts` — seed window, `groundSeed`, `observeVisible`, anchor advance;
   - `peerArrivalPath.ts` — `noteArrival`/`logArrival`/`writeEntry`/`announceArrival`/`enqueueLive`.
   Gate: the full unit suite green UNCHANGED (no assertion edits in the split commit), then the keyed live
   suite.

**Left standing, reasons re-affirmed (3):** fork-inherited history (D3 owner scope — flagged to the owner
rather than re-decided here); search's duplicate-anchor divergence (a genuine difference in what the
two methods claim, documented at the call site; a "fix" would invent occurrence identity); the pre-M9
row-phase cursor skip (self-clearing; a versioned cursor breaks D1). The truncation entry's foreign-sender
residue also stands, inside its rewritten entry (no framing exists that this server controls). Each entry
in the tracker gets its adjudication date appended; fully-paid entries are removed by their fixing commit.

**`imageCodec-encode.test.ts` flake** — diagnose-then-decide: reproduce under full-suite load, record the
failing ladder step, and apply the smallest of (resource-bound the test, serialize the file, fix a real
races-under-load defect). "Isolate and record when it reds; do not accept a red that reproduces alone" is
the standing instruction and stays the acceptance bar. If it cannot be reproduced in this round's runs, the
entry stays with that recorded attempt.

## Acceptance criteria (behavior-phrased)

1. A `thread/peerMessage` notification carries `text` equal to the `text` of the item later emitted (or
   replayed) under the same `arrivalUuid`, including for a collapsed multi-envelope frame.
2. `origin` on that notification is byte-identical to the frame's `origin` (verbatim rule untouched).
3. An arrival recorded during an own busy turn is emitted as a user item of THAT turn, after its
   `turn/started`; a foreign adoption opening later receives no item for it.
4. An arrival recorded while nothing runs is emitted into the next bracket that opens (adopted or own),
   never into any bracket after it.
5. A bound arrival whose bracket dies unemitted produces no item ever, and a warn names the drop; its
   announcement and its M9 log entry are unaffected.
6. Announce-once-per-message, announce-at-arrival, persist-before-broadcast, and the 32-cap all hold
   exactly as their existing cells state.
7. `peer/send` refuses a body whose wrapped envelope would not decode back to exactly that body, with a
   named reason; every previously-accepted body that round-trips still sends byte-identically.
8. After the module split, the full unit suite passes with zero assertion changes in the split commit, and
   the keyed live suite passes 10/10.
9. The tech-debt tracker reflects every adjudication above (paid entries removed by their fixing commits,
   standing entries re-dated), and `docs/parity/appserver.md` documents the notification's `text` field and
   the origin-vs-text meaning.
10. Gates: full unit suite green, typecheck green, drift gate unmoved, keyed live 10/10.

## Decision Log

- **D-BL7-1** `thread/peerMessage` gains `text` (the item's own string) beside verbatim `origin`; the
  meaning of each is stated once for both channels. *Rejected:* per-envelope multi-notifications (identity
  is non-bijective — verdict C — and the item is ONE row; N notifications would mint identities nothing can
  dedupe); editing `origin` to per-frame values (destroys the only kernel-vouched provenance).
- **D-BL7-2** Live attribution binds to bracket evidence (open-at-arrival, else next-to-open), and a bound
  arrival never outlives its bracket. *Rejected:* synthetic turns (invents a turn the engine never ran — a
  misplacement wearing a uniform); strict drop-when-none-open (loses the caused-turn shape LEG 1/5 measure,
  where the engine's own queue drains into the next bracket); the status quo (the defect).
- **D-BL7-3** Own-turn folds emit into the own turn via the existing `emitItems` path, gated on the
  started-broadcast flag. *Rejected:* withholding own-turn folds from the live channel entirely (the engine
  measurably folded the message into that turn — LEG 4's nested bracket — so the item belongs there).
- **D-BL7-4** Debt items 5 of 10 fixed outright + the module split; 4 re-affirmed standing. The
  sender-side round-trip refusal converts the truncation entry from "unfixable" to "foreign residue only".
  *Rejected:* forcing fixes for the 4 standing items (each fix violates a standing owner decision — D1, D3 —
  or invents data the system does not have).
- **D-BL7-5** The dead-engine liveness problem stays out of scope, in task #64's text, awaiting its own
  design. *Rejected:* folding a turn-timeout mechanism into this round (touches every turn's settle path;
  undesigned).

## Surprises & Discoveries

(living — append during execution)

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-08-31): initial design, written from direct grounding of `peerInbound.ts` (692 lines, post-M9),
  `address.ts`, `registry.ts:508`, and the M9 spec's verdict-C/M13 blocks.
