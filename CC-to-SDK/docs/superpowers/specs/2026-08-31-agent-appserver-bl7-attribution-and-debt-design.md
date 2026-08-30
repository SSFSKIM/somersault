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
   re-adjudicated here — five are paid this round (one of them partially: the truncation entry's foreign
   half has no fix this server controls), four stand with their reasons re-affirmed (one of those gains a
   pinning test without leaving the ledger), and one (a test flake) gets a diagnosis with a decision rule
   rather than a promise.

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
- **(b) own bracket open** at arrival (the fold-into-our-turn shape: the engine emits a nested lifecycle
  bracket, `adopt` correctly declines on busy, and today the arrival then leaks to a later foreign turn) →
  bound to the OWN turn, emitted into it via the same `emitItems` path adopted turns use. "Own bracket
  open" is NOT inferred from `busy`/`currentTurnId` (both race the bracket's real edges — `busy` flips
  before `turn/started` broadcasts, and an adopted terminal clears `state.adopted` before `busy` falls):
  peerInbound tracks its own-turn bracket EXPLICITLY — `notePeerTurnUuid`, which turns.ts already calls
  from inside the runner (post-broadcast, by `beginTurn`'s ordering), records
  `ownTurn = { turnId: record.currentTurnId }`, and the bracket is open exactly while
  `activeTurnId(record) === ownTurn.turnId`. An arrival landing in the busy-but-unbroadcast window binds
  `next` and is claimed by the own bracket the moment it truly opens; an arrival landing in the
  adopted-terminal-but-still-busy window also binds `next` (no adoption, no ownTurn), never `own` for a
  dying foreign turn.
- **(c) nothing open** → bound `next`, and CLAIMED AT BRACKET OPEN, not at the next drain: a successful
  `adopt()` re-stamps every `next`-bound arrival (live queue AND seed buffer) to itself the moment the
  lifecycle bracket is accepted, and `notePeerTurnUuid` re-stamps them to the own turn it records. A
  drain-time claim would let a bracket open and die between two drains and the arrival skip to a later
  unrelated bracket — the defect again, one window smaller. The engine queues undelivered messages and the
  next turn drains that queue, so the next bracket is the engine's own attribution, not a guess. No
  timers, no heuristics.
- **(d) bracket death** → an adoption terminated (with or without a mapper ever installing), an epoch
  swap, an own bracket no longer open: its bound arrivals are dropped from the live queue with a
  `console.warn` naming the count, detected at the next drain. A `next`-bound arrival is never dead
  (`uninstallPeerInbound` keeps its existing clear).

Mechanism: each queued `Arrival` — and each seed-window `PendingArrival`, SYNCHRONOUSLY at `noteArrival`,
because the seed read can stall across a bracket transition and a flush-time binding would attribute a
T1-observed arrival to T2 — gains a binding (`{ kind: "adopted", commandUuid, epoch } |
{ kind: "own", turnId } | { kind: "next" }`) recorded from the brackets open at that instant.
`drainArrivals` generalizes to "emit the arrivals bound to the currently open bracket, drop arrivals whose
bracket is dead" and runs where it runs today plus on every frame while the queue is nonempty. Seed-window
arrivals carry their arrival-time binding through grounding; the flush enqueues them with it intact.

Live behavior deliberately unchanged: announce-once-per-message, the 32-cap with oldest-first eviction,
persist-before-broadcast ordering, and announcement-after-durable-fate — which for the seed window means
at flush, the exception M9 already carved (held arrivals announce once grounding settles what they are;
a stalled seed delays the notification with the entry, never reorders them). The ONLY visible changes: an
arrival never appears as an item of an unrelated later turn, and a fold into an own turn now emits into
that own turn (new, correct — previously it leaked or sat forever).

Tests — the race matrix is the point, deterministic cells first: (b)'s misattribution pin (arrival during
own bracket lands in THAT turn; a later foreign adoption receives nothing); claim-at-open (a bracket that
opens and terminates before its mapper installs takes its claimed arrivals with it — dropped, warned,
never re-attributed); pre-start cancellation (arrival in the busy-but-unbroadcast window of a turn that
never opens stays `next`); terminal-then-arrival on the same stack (adopted terminal cleared, `busy` still
true → binds `next`, not `own`); a held seed spanning two brackets (arrival observed under T1, seed
resolves after T2 opened → emitted into T1 if T1 still lives, dropped if not — never T2). Live: LEG 4
strengthened to assert EXACTLY ONE arrival item on the host turn and none on its successor, plus an
own-fold live assertion (the arrival item lands on the observer's own turn); keyed rerun required.

## Stream 3 — the debt ledger, adjudicated entry by entry

**Paid this round (5):**

1. **`EMPTY_ARRIVALS` mutable singleton** (`items/project.ts`) — make mutation impossible AT RUNTIME, not
   conventionally: a shallow `Object.freeze` cannot stop `Map.set` or reach the array, so the fix is
   either an accessor returning a fresh value or an immutable facade whose mutators throw — and a test
   that one consumer's attempted poisoning cannot change a later projection.
2. **Duplicated corpus fixtures** — the tracker's own trigger ("lift it the next time either corpus is
   edited") fires this round: #63/#64 edit these suites. Lift the shared `USER`/`ASSISTANT`/`ENTRY`
   builders into `test/unit/appserver/items/corpus.ts` and consume them from `subscribe-arrivals` and
   `search-arrivals`.
3. **`tick()` macrotask waits** (`arrivals-clear-degraded.test.ts`) — convert to `vi.waitFor` per the
   `fr-*` family's pattern.
4. **Literal closing tag truncates the sender's own body — the half we control.** The debt entry stands
   for FOREIGN senders (no framing exists), but OUR gateway can stop producing self-truncating frames: at
   `peer/send`, refuse a body the harness's own decoder would not read back intact (wrap → `envelopeBodies`
   → expect exactly the body back; refusal is the established posture — "refusing is recoverable; a silent
   downgrade is not"). Balanced quoted envelopes round-trip fine (depth counting), so ordinary
   envelope-quoting traffic (52 measured rows) is untouched; only unbalanced wrapper tags refuse. Tracker
   entry updates to name the remaining foreign-sender residue.
5. **`peerInbound.ts` past 600 lines (now 692 + this round's additions)** — the tracker says "design the
   split, do it as its own change"; this round is that change, and the split goes LAST, behavior-preserving,
   after streams 1–2 land. Seams (three modules + the existing file as install/uninstall facade holding
   `PeerInboundState`):
   - `peerAdoption.ts` — adopt/settle/drain, lifecycle routing, `ourUuids`, the binding logic;
   - `peerSeed.ts` — seed window, `groundSeed`, `observeVisible`, anchor advance;
   - `peerArrivalPath.ts` — `noteArrival`/`logArrival`/`writeEntry`/`announceArrival`/`enqueueLive`.
   Gate: the full unit suite green UNCHANGED (no assertion edits in the split commit), then the keyed live
   suite.

**Left standing, reasons re-affirmed (4):** fork-inherited history (D3 owner scope — flagged to the owner
rather than re-decided here); search's duplicate-anchor divergence (a genuine difference in what the
two methods claim, documented at the call site; a "fix" would invent occurrence identity); the pre-M9
row-phase cursor skip (self-clearing; a versioned cursor breaks D1); and **`peerArrival`'s JSON-stringify
of exotic content** — a unit cell pins the current fallback (untested-unreached becomes tested-defined),
but the pin changes neither the debt's cost nor its reachability, so the entry STAYS, re-dated, noting the
pin (the spec review's correction: removing it would erase known debt rather than resolve it). The
truncation entry's foreign-sender residue also stands, inside its rewritten entry (no framing exists that
this server controls). Each entry in the tracker gets its adjudication date appended; fully-paid entries
are removed by their fixing commit.

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
6. The race matrix holds, each shape a deterministic cell: a bracket that opens and terminates before its
   mapper installs takes its claimed arrivals with it; an arrival in a turn's busy-but-unbroadcast window
   stays `next` (and is claimed when that turn truly opens); an arrival landing after an adopted terminal
   while `busy` is still falling binds `next`, never `own`; an arrival held by a seed that resolves after
   its bracket ended is dropped (or emitted into that exact bracket if it still lives), never into a
   successor.
7. Announce-once-per-message, persist-before-broadcast, announcement-after-durable-fate (the seed-window
   exception as M9 carved it), and the 32-cap all hold exactly as their existing cells state.
8. `peer/send` refuses a body whose wrapped envelope would not decode back to exactly that body, with a
   named reason; every previously-accepted body that round-trips still sends byte-identically — proven by
   a differential matrix at the RPC surface (balanced same- and mixed-grammar nesting, unclosed openers,
   unmatched closers, newline edges, cap boundaries: exact write or zero write, nothing between).
9. After the module split, the full unit suite passes with zero assertion changes in the split commit, and
   the keyed live suite passes — including LEG 4 strengthened to exactly one arrival item on the host turn
   and none on its successor, and an own-fold assertion placing the arrival item on the observer's own
   turn.
10. The tech-debt tracker reflects every adjudication above (paid entries removed by their fixing commits,
   standing entries re-dated), and `docs/parity/appserver.md` documents the notification's `text` field and
   the origin-vs-text meaning.
11. Gates: full unit suite green, typecheck green, drift gate unmoved, keyed live 10/10.

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
- **D-BL7-6** (spec review, adopted) Bindings are recorded synchronously at frame arrival — including
  seed-window arrivals — and `next` is claimed at BRACKET OPEN (`adopt()` success, `notePeerTurnUuid`),
  never at a drain; the own bracket is tracked explicitly rather than inferred from `busy`. *Rejected:*
  flush-time seed binding and drain-time claiming (both leave a window where a bracket transition
  re-attributes an arrival — the defect at a smaller scale).
- **D-BL7-7** (spec review, adopted) The JSON-stringify tracker entry STAYS, re-dated, with its new pin
  cell noted: a pin documents behavior but pays nothing — the cost and reachability are unchanged.
  *Rejected:* counting the pin as payment (erases known debt); fixing the fallback (changing unreached
  code buys nothing, the original deferral reason, which still holds).
- **D-BL7-8** (spec review, dismissed) No versioning/migration for the `peer/send` refusal: the tightening
  is deliberate, refuses only bodies our own decode side reads back truncated, and criterion 8's
  differential matrix proves every intact body unaffected. (spec review, dismissed) "Scope exceeds a
  reviewable change": the plan already lands each stream as its own reviewed task in the recommended
  order; the split is its own commit with a zero-assertion-change gate.

## Surprises & Discoveries

(living — append during execution)

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-08-31): initial design, written from direct grounding of `peerInbound.ts` (692 lines, post-M9),
  `address.ts`, `registry.ts:508`, and the M9 spec's verdict-C/M13 blocks.
- rev 2 (2026-08-31): codex adversarial review (9 findings) folded in — bindings move to arrival time
  everywhere (incl. seed window), `next` claims at bracket open, the own bracket becomes explicit state
  (D-BL7-6), the race matrix becomes criterion 6, the announce invariant wording carves the seed-window
  exception, `EMPTY_ARRIVALS` must be runtime-hard, the JSON-stringify entry stays (D-BL7-7), the
  `peer/send` differential matrix lands in criterion 8; two findings dismissed with reasons (D-BL7-8).
