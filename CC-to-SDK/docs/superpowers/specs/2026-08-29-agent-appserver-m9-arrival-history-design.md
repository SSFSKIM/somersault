# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 7 — **Stage A shipped; Stages B–D revised through review rounds 4 and 5
(fourteen findings, all adopted), pending convergence check.** · **Task:** #59 · **Depends on:** M8
(merged, `06bf3c0e44`)

## Why this exists

M8 gave the app-server cross-session messaging in both directions. A thread admitted with
`crossSessionInbound: "accept"` turns an arriving peer message into a fully visible turn: subscribers
get `thread/peerMessage`, then the model's answer, then a terminal state.

That is true only while you are watching. Call `thread/read` afterwards and the inbound message is
absent while the assistant's answer to it is present — **history shows an answer with no question.**

The purpose is that **a thread's readable history should contain everything the thread actually
received**, without the client having to know cross-session messaging exists.

## Where this design actually stands

Four revisions have been written and three adversarially reviewed. Twenty-four findings, every one
real. Rev 1's approach is dead, rev 2's is superseded, and rev 3's machinery came back **NOT
CONVERGED** with nine open findings that named missing mechanism rather than wording. Rev 4 recorded
that honestly and put two of the nine to the owner.

**The owner answered on 2026-08-30, and the answers are what made rev 5 possible.** They are load
bearing rather than preferences, so they are stated once here and referenced as D1–D3 throughout:

- **D1 — the cursor stays compatible.** No versioned break and no capability negotiation; whatever
  extra state paging needs must live inside the published `^\d+:\d+$` shape. *(Rejected: accepting a
  break, negotiating a capability, or keeping arrivals on a separate method and leaving default
  history incomplete.)*
- **D2 — `thread/clear` detaches rather than deletes.** Arrivals stay with the transcript they landed
  in and reappear if it is reopened; the fresh conversation starts empty. *(Rejected: erasing them,
  and carrying them forward into the new conversation.)*
- **D3 — correct where we can be, explicitly refusing where we cannot.** The single-engine case is
  made fully correct; concurrent engines, refused rewinds and branched conversations return an
  explicit failure rather than a plausible-looking wrong answer. *(Rejected: solving the full
  correctness envelope before shipping anything, and shipping the narrow case with silent
  degradation.)*

Under those three, the nine findings do not need nine mechanisms. Rev 3 was carrying machinery to
defend positions it had chosen to occupy; D3 permits vacating most of them, and once vacated, seven of
the nine dissolve and two become stated limits. Rev 5 is therefore **substantially smaller than rev
3**, not larger — no two-phase placement, no `historyGeneration`, no rewind rebase, no lease, no
opaque cursor, and in the end no cursor change at all.

## Measurements

Against 1,076,891 rows in 7,131 real transcripts, plus two keyed probe runs.

**M1 — the drop is unconditional and no SDK option reaches it.** `getSessionMessages` filters
`if (e.isMeta) return false`; `includeSystemMessages` gates only `type:"system"`. The projection is a
fixed field literal with no `origin`. Byte-identical in 0.3.237 and 0.3.250, so task #60's bump did
not close it and there is no option to ask for.

**M2 — `origin` is a clean structural discriminator.** `isMeta` rows are 0.28% of all rows and split
with no overlap: those with an `origin` object are inbound messages; those without are CLI
bookkeeping.

**M3 — in the corpus this reader opens, the hidden population is peer messages and nothing else.**

| corpus | files | rows | hidden `isMeta`+`origin` |
| --- | --- | --- | --- |
| **main** (what `getSessionMessages` reads) | 3,856 | 567,273 | **`peer` 69, `auto-continuation` 2** |
| `subagents/` (only `getSubagentMessages`) | 3,281 | 511,923 | `coordinator` 573, `task-notification` 94, `peer` 61, `human` 6 |

**M4 — two provenances, one verified.** 112 rows carry `{body, from, kind, name, senderTaskId}`; 18
carry `verifiedPeerPid`. Only `verifiedPeerPid` is kernel-vouched.

**M5 — the engine's transcript is not a safe graph to splice.** 1,562 duplicate uuid occurrences (31
disagreeing on `parentUuid`), 335 dangling `parentUuid` references.

**M6 — the SDK's read window is post-compaction only**, for every message type.

**M7 — a folded arrival persists nothing**, against a positive control.

**M8m — A BATCH IS COLLAPSED. This supersedes rev 3's reading of the same probe.** Probe 121, keyed,
CLI 2.1.250. Three messages sent, two peer-caused turns, three live arrival uuids — and **two**
persisted rows:

```
row a2a99619  msg_id=c58aadc8  1 envelope   content: M1     origin.body: M1
row 42364455  msg_id=4bc39d4d  2 envelopes  content: M2,M3  origin.body: M2
live uuid 541d1e23 — no persisted row at all
```

Several messages land in **one frame under one uuid**. `origin.body` and `origin.msg_id` name one of
them; the others are readable only as text inside a frame that claims to be a different message.

**Rev 3 read this probe as "each frame carries its own text" and was wrong.** The probe scored
aggregate nonce *coverage* — is each text present somewhere across the batch — and the verdict logic
reported it as per-frame *attribution*. Corrected in `3c7ae43991`: the verdict now requires a
bijection (every frame carrying exactly one message, every message in exactly one frame) before it
will claim A or B, and prints envelope counts per row so a collapse is visible rather than inferred.

**The consequence is a genuine impossibility, not a gap to engineer around: per-message identity for
a batched arrival does not exist in the data.** This server has no independent source — it observes
the engine's replayed frames and never receives inbound messages directly.

**M9m — but no text need be lost.** Across all 170 peer rows on this machine (107 files), rendering
*every* top-level envelope in a frame rather than `origin.body` returns byte-identical text on 169
rows and differs on exactly one — the collapsed batch row, where it recovers the message that
`origin.body` drops. 150 rows carry `origin.body` and no envelope, so the fallback stays.

**M10 — a synchronous durable write is cheap enough to sit in the observation path.** Write-plus-
rename on the real `~/.claude` filesystem, 500 iterations: p50 0.143ms, p95 0.201ms, p99 0.896ms, max
6.497ms. A 16KB body costs the same as a 400B one — the cost is the syscall pair, not the bytes.
Reading a whole log back: 0.12ms at one entry, 2.1ms at a hundred, 17ms at a thousand, against a
corpus-wide arrival count of 69. This is what lets Stage B skip an asynchronous persistence pipeline,
measured rather than asserted.

**M11 — `rowKind` does not discard a real peer row on the replay path.**
`itemsFromTranscript` drops `PHANTOM_ROW_KINDS` before consulting `peerArrival` (replay.ts:27).
Running the real `rowKind` over all 170 peer rows on this machine: 170 classify `prompt`, 0 are
phantom. **This answers U2**, and it is structural rather than lucky — all four phantom classifiers
anchor at the start of the text, and a peer frame opens with a CLI-authored preamble.

## Stage A — ready, and independently valuable

The shipped live path loses text. For the collapsed row above, `peerArrival` returns `origin.body`
(M2) and M3 vanishes from everything a client can see, live and cold, even though the model answered
both.

`peerArrival` changes to read **every top-level envelope** in the frame and join them, falling back
to `origin.body` when the frame carries none. Extraction is a depth-counting scan, not a regex
capture, because both obvious captures are measurably wrong on this machine's transcripts: a lazy
capture truncates at the first closing tag when a peer's body quotes an envelope (52 rows here carry
a complete envelope, only 12 are arrivals), and a greedy capture merges sibling envelopes with their
tags intact.

This is a **deliberate deviation** from the SDK's guidance to render `origin.body` "instead of
re-parsing the message text" — right for a single message, measurably wrong for a batch.

It does not restore per-message identity, which M8m shows is gone. It guarantees **no message is
silently dropped**: one item under one uuid carrying everything that frame delivered, which is a
faithful rendering of what the engine actually produced.

**The limit it does not close:** a frame that is both envelope-less and batched still returns the
causing message's text. `peerArrival` is pure and sees one frame, while the evidence of a batch is a
repeated `msg_id` *across* frames. No shape in the measured corpus is both, and guessing would be
worse than a documented limit.

## Stages B–D — the mechanism

The direction is rev 2's: **the server logs arrivals; it does not reconstruct them from the
transcript.** Rev 3's machinery for it — two-phase placement, `historyGeneration`, a rebase on
rewind, a lease, an opaque cursor — is **withdrawn in full**. Three moves replace it, and between them
every one of the nine findings is either dissolved or converted into a stated limit.

**Move 1 — anchor at observation, to the last row, not to a turn.** Rev 3 anchored an arrival to the
turn it caused, which is why a folded arrival (whose host turn had already emitted rows) and an
unsettled turn (`beginTurn` declines while the host turn is busy) had nowhere to attach. An arrival
does not need a turn. It needs the row it came after, and the observer already knows that.

**Move 2 — append-only, resolved at read.** The log is never mutated. Placement is recomputed on
every read against whatever rows currently exist.

**Move 3 — an arrival rides its anchor row rather than occupying a row of its own.** This is what
keeps every existing coordinate valid.

### Rev 3's nine findings, and where each one goes

Every claim below is argued in the section named beside it. The findings are quoted from rev 4 so
this table can be checked against the review that produced them rather than against a paraphrase.

| # | Rev 3's finding | Disposition |
| --- | --- | --- |
| 1 | No durable ordering primitive — `readLoop` calls `onFrame` synchronously and neither awaits nor catches rejection | **Answered.** Content fixes position (given the store-seeded `seq` — round 4 tightened this); only durability remains, and a measured synchronous write covers it (M10). *Durability and ordering* |
| 2 | Two-phase placement cannot locate a folded or unfinalized arrival | **Dissolved** by Move 1 — the coordinate is a row, not a turn, so there is no second phase to fail. *Placement* |
| 3 | The cursor snapshot does not freeze finalize or eviction | **Dissolved** — entries are immutable and placement is derived, so there is no snapshot and nothing to freeze. *Placement* |
| 4 | Rebase has no transaction boundary matching the real rewind | **Dissolved** by Move 2 — append-only, so a rewind needs no rebase and a refused rewind needs no compensation. *When placement fails* |
| 5 | Concurrent writers do not form the claimed union | **Bounded.** A losing-branch anchor is absent, so the arrival is withheld rather than misplaced. Stated limit: an anchor on the shared trunk still renders. *When placement fails* |
| 6 | `thread/clear` would erase arrivals from a still-resumable transcript | **Answered by D2** — keying by session id gives detach-not-delete, because clear already detaches by dropping `record.sessionId`. *The log* |
| 7 | Search has no occurrence coordinate for a logged arrival | **Dissolved** by Move 3 — an arrival publishes its anchor's coordinate, which already lands a window containing it. *Placement* |
| 8 | The opaque cursor is an unversioned wire break | **Absent.** Move 3 changes no cursor, so D1 is satisfied by needing nothing. *Placement* |
| 9 | The injectable store has no compatibility rule | **Answered** — a structural default rule readable off the deps object. *Store injection* |

Two gaps are carried forward rather than closed, and are named as such where they arise: the
shared-trunk case under finding 5, and the absence of a *withheld* count (the *logged* count is
published — see "When placement fails").

### Round 4 — rev 5's eight findings, and where each one goes

Rev 5 went back to the same reviewer with the code open. Eight findings, six high — every one real,
none dismissed. The architecture (the three moves) survived untouched; what failed was mechanism
detail, and each fix below is a refinement inside the rev 5 frame rather than a withdrawal of it.

| # | Round 4 finding | Disposition |
| --- | --- | --- |
| 1 | Silent omission is not the "explicit refusal" D3 promises | **Adopted, narrowed.** The terminal page publishes `arrivalsLogged`, so incompleteness is always visible; failing the RPC is rejected because a post-compaction anchor is normal, and a permanently poisoned read is worse than a detectable gap. *When placement fails* |
| 2 | Per-process `seq` reverses same-anchor order across an ordinary restart | **Adopted.** `seq` is seeded from the store's max at observer install; refutes rev 5's "write order is irrelevant" as stated, which is now conditional on the seeding. *The log* |
| 3 | A bare uuid anchor can be rebound by a duplicate (M5's own 1,562) | **Adopted.** The anchor carries a fingerprint; mismatch withholds. The strongest finding of the round — it refuted rev 5 with this spec's own measurement. *The log* |
| 4 | Seeding has no race-free mechanism; Stage B can certify a bad anchor | **Adopted.** Explicit buffering state: install synchronously, hold arrivals, ground the chain when the seed resolves, then persist and broadcast in observation order. `null` becomes unrepresentable except as confirmed-empty. Also corrects rev 5's one-sided "drift is safe" claim. *The observer has to be seeded* |
| 5 | M10 measured happy-path latency, not failure semantics | **Adopted in substance.** Caught write failures, a degraded latch surfaced as `arrivalsLogged: null`, crash semantics honestly stated as atomic visibility rather than durability. Network-filesystem stalls documented, not engineered: the store lives beside the transcripts, which already carry that exposure. *Durability and ordering* |
| 6 | M11 measured raw rows, but Stage C replays entries that are not rows — and a synthetic row would re-lose the batch through `peerArrival`'s fallback | **Adopted fully.** The splice becomes an item-level projector injecting `userItem(entry.text, entry.id)` directly, bypassing `rowKind` and `peerArrival`. Simpler than what it replaces; M11 is re-scoped to Stage A. *Placement* |
| 7 | The search cursor cannot resume between same-anchor arrivals at `limit:1` | **Adopted.** The occurrence cursor (ours, unpublished) gains a `(seq, id)` discriminator; the published `readCursor` is untouched. Rev 5's "finding 7 dissolves" is corrected to "half dissolves". *Placement* |
| 8 | The splice cannot leave `boundaryRow` untouched under either naive reading; the last-resort page is unbounded | **Adopted.** Same projector closes the coordinate hazard (independently found here before the review returned); a per-session log cap bounds the last-resort page, whose self-limiting behaviour is already tested. *Placement*, *Bounds* |

### Round 5 — rev 6's six findings, and where each one goes

All six named missing mechanism; all six are adopted. They are narrower than round 4's — edge
composition rather than core mechanism — which is the direction convergence looks like from inside.

| # | Round 5 finding | Disposition |
| --- | --- | --- |
| 1 | The `{type, timestamp}` fingerprint does not distinguish the duplicate-uuid population it targets, and live `timestamp` is optional | **Adopted.** The anchor gains `prevUuid` — chain position, which a rebound duplicate cannot fake — plus a content hash; fingerprint fields absent at observation constrain nothing; any disagreement withholds. *The log* |
| 2 | The seed is not a snapshot; a frame can be both buffered and in the seed result, anchoring an arrival after its own answer | **Adopted.** Grounding rule: ground before the earliest buffered uuid that occurs in the seed result; replay the buffer once. Four overlap shapes pinned in acceptance. *The observer has to be seeded* |
| 3 | "Items for that row" does not exist — the mapper is a whole-window stateful reduction; and search never calls the item mapper at all | **Adopted.** The projector is specified on the mapper's real per-frame `ingest`, completions tagged by producing row, one `finalize` at the end; the false "same projector serves search" claim is withdrawn and Stage D gets an explicit anchored-entry scan step. *Placement* |
| 4 | Null-anchored entries are stranded: present in every prefix, so `begin` resolves to 0 and the walk ends without emitting them | **Adopted.** Null anchors become a sentinel outside the bisection: emitted only on the page reaching row 0, never discardable, excluded from `boundaryRow`'s targets. The review's exact `limit:1` walk is an acceptance criterion. *Placement* |
| 5 | The cap silently deletes from an "append-only" log, and cannot bound the last-resort page anyway | **Adopted.** Eviction writes a durable dropped-count marker first, and `logged` reports the pre-eviction total; the bounds claim is corrected — the cap bounds the arrival contribution only, the page's transcript portion being the pager's pre-existing trade. *Placement*, *When placement fails* |
| 6 | `arrivalsLogged` is uncheckable (arrival items are unmarked) and terminal-only | **Adopted.** Projected, drained and replayed arrival items all carry `origin` — countable and provenance-complete, converging with task #63 — and `arrivals: { logged, dropped }` rides every reply via one shared helper, with the degraded latch persisted in the marker. *When placement fails* |

### The log

One entry per `noteArrival` call — that is, exactly one per `thread/peerMessage` notification, so the
announcement channel and history cannot disagree about how many messages arrived.

An entry is immutable and carries `{ v, id, sessionId, anchor, seq, observedAt, origin, text }`.

- **`id`** — the frame's own uuid, or `noteArrival`'s minted fallback (peerInbound.ts:181). This is
  the same id `items/replay.ts` gives a replayed row, which is the mechanism by which a client
  dedupes the live item against the one `thread/read` returns.
- **`text`** — `peerArrival(frame).text`, so live and cold remain one function's output. Stage A's
  join is what makes this whole rather than the causing message alone.
- **`origin`** — verbatim, for the reason `thread/peerMessage` carries it verbatim: `verifiedPeerPid`
  is the only kernel-vouched field in the exchange and re-deriving it would replace a verified fact
  with this server's opinion of it.
- **`anchor`** — `{ afterUuid, prevUuid, fingerprint }`: the uuid of the last frame this thread
  observed that would survive the reader's filter, the uuid of the filter-surviving frame *before
  it* (`null` when the anchor is the first), and a fingerprint of the anchor frame — `type`, a short
  content hash, and `timestamp` when the frame carried one (live `timestamp` is declared optional:
  "older emitters omit it", sdk.d.ts). `anchor: null` as a whole means **confirmed empty** — the
  seed read completed and reported zero rows — never "not yet known".

  A uuid alone is not a row identity: M5 counted 1,562 duplicate uuid occurrences (31 disagreeing on
  `parentUuid`), and the reader's last-wins keying means a later duplicate would silently *rebind* a
  uuid-only anchor to a different row — a misplacement, the one failure class this design must not
  produce (round 4, finding 3). A fingerprint alone is not enough either: a duplicate born from a
  rewrite can carry identical type, timestamp *and* content at a different chain position (round 5,
  finding 1). `prevUuid` is what pins the position — a rebound duplicate sits after a different
  predecessor. At resolution, all three must agree: `afterUuid` found, its predecessor in the
  reader's output equal to `prevUuid`, and every fingerprint field *recorded at observation* equal
  on the row (a field the live frame omitted constrains nothing). Any disagreement withholds.
  Acceptance pins the measured differing-parent collisions and the timestamp-absent projection.
- **`seq`** — per-session monotonic, ordering entries that share an anchor. **Seeded from the store**:
  at observer install, the session's existing entries are read once (0.12ms at one entry, 2.1ms at a
  hundred, M10) and `seq` continues from their maximum. Rev 5's per-process counter reversed order
  across an ordinary restart — arrival A at seq 47, restart, arrival B at seq 1 sorts B first — which
  is sequential single-engine operation, not the concurrent-engine limit (round 4, finding 2).
  Cross-process ties still break on `id`.

**Keyed by session id**, which is D2's mechanism in full. `thread/clear` sets
`record.sessionId = undefined` and lets the replacement engine mint a new id at its init frame
(settingsOps.ts:315-340, and the header there says why); it deletes no transcript. So a cleared
thread's arrival scope starts empty, the old session's entries stay on disk, and resuming that
transcript shows them again. **Detach, not delete, requires no code beyond the choice of key.**

An arrival observed before the thread has a session id is held in memory and flushed at the init
frame. A crash in that window loses it — a stated limit, bounded by the length of engine startup.

### Placement — arrivals are injected as items, never as rows

Rev 5 said "splice arrival rows into the array before `itemsFromTranscript`", and the review
(round 4, findings 6 and 8) showed both available readings of that sentence are broken. A stored
entry `{id, origin, text}` is not a transcript row — fed to `itemsFromTranscript` it emits nothing.
Reconstructing a synthetic user row does not fix it: the synthetic row would route through
`peerArrival`, whose envelope scan finds nothing in the already-joined `text`, falls back to
`origin.body`, and **re-loses the very message Stage A recovered**. And mutating the array that
`boundaryRow` indexes shifts every raw-row coordinate the cursor publishes.

So the splice lives one level up, as an **item-level projector**. Round 5 (finding 3) caught the
hand-wave in rev 6's version of this: "`itemsFromTranscript`'s items for that row" is not an
operation the code has — the mapper is one stateful `TurnMapper` spanning the whole window, with a
single `finalize(false)` at the end, and calling it per row would force-complete every open tool.
The primitive is nonetheless buildable directly on the mapper's real API, because `ingest` is
already per-frame:

```
project(rawRows, entries) :=
  mapper := one TurnMapper for the whole window            (exactly as today)
  if the window includes row 0: emit null-anchored entries, by (seq, id)
  for each row in rawRows, in order:
    emit the completed items mapper.ingest(row) returns     (tagged by this row, the producing row)
    for each entry whose anchor resolves at this row (afterUuid + prevUuid + fingerprint), by (seq, id):
      emit userItem(entry.text, entry.id, { origin: entry.origin })   (bypassing rowKind and peerArrival)
  emit mapper.finalize(false)'s still-open items at the end (exactly as today)
```

One reducer, invoked identically by the full page mapping and by `boundaryRow`'s prefix predicate.
An item that *opens* at the anchor row but *completes* later emits at its completion row, after the
arrival — which is the live stream's order too, so cold and live agree. The raw array is never
touched: `begin`, `base`, `from` and `cursorRow` all stay in raw-row space, and the emitted cursor
is still `` `${record.epoch}:${begin}` `` over rows that really exist.

**Null-anchored entries are outside the bisection, by construction.** Round 5 (finding 4) traced the
alternative to a stranded arrival: a confirmed-empty entry appears in every prefix including width
zero, so once discarded its boundary resolves to `begin = 0` and the walk terminates without ever
emitting it. So the rule is a sentinel, not a row: null-anchored entries emit **only** on the page
whose window includes row 0, are **never eligible for discard** on that page (they ride past `limit`
the way the last-resort page already does, bounded by the log cap), and are **excluded from
`boundaryRow`'s target set** — they have no row transition to bisect for. The exact `limit:1` walk
the review constructed is pinned in acceptance.

Two properties make this safe, and the existing pager already requires both of them:

- **Pure** — `project`'s output is a function of the row window and the (immutable) entry set alone.
- **Monotone** — an entry's id appears in `project(rows[0,w))` for every `w` past its anchor row and
  never before, exactly the predicate `boundaryRow`'s bisection (subscribe.ts:28-61) already rests
  on for tool items, so it keeps working unmodified.

**A row carrying several items is not a new case for this pager; it is the case it was built for.**
Its own header says rows and items are not 1:1 because "one row can complete several items", and its
guarantee is that no discarded item's opening row is ever excluded from every future window — no
loss, with duplication across a straddling boundary tolerated and deduped by id. An arrival riding
its anchor is precisely a row that completes several items, and it carries a stable id (the arrival
uuid, the same one `thread/peerMessage` announced), so it is deduped by the machinery already there.

**Because an arrival rides a row rather than occupying one, the cursor arithmetic never changes.**
`boundaryRow` still returns a raw row index, `base` is still a raw row offset, and the emitted cursor
is still `` `${record.epoch}:${begin}` ``.

Which means **no cursor change, no schema change, no capability negotiation and no versioned break**.
Finding 8 is not mitigated; it is absent. The owner's decision was to preserve compatibility by
keeping the cursor inside its published `^\d+:\d+$` shape, and that decision is honoured more cheaply
than the read-snapshot id it selected: once entries are immutable and placement is derived rather
than stored, there is no sequence left that needs freezing, so finding 3 goes with it.

**Search does not use the projector, and rev 6 was wrong to say it did** (round 5, finding 3).
`thread/searchOccurrences` scans raw text row by row (`rowSearchText`, search.ts:521-527) and never
maps items at all. Stage D therefore adds its own explicit step to that loop: after scanning row
`r`'s text, scan the text of every entry anchored at `r` (same resolution rule), in `(seq, id)`
order; null-anchored entries scan before row 0. A match inside an arrival publishes its **anchor's**
`readCursor`, `` `${epoch}:${rowOffset + 1}` `` (for a null-anchored entry: `` `${epoch}:1` `` when
the session has a first row, `null` otherwise, like nested rows) — the *published* coordinate space
is untouched. Search's **own** resume cursor, unpublished, gains an entry discriminator `(seq, id)`
so a `limit:1` resume between two same-anchor matches neither skips nor repeats (round 4, finding 7
— a real residue rev 5 wrongly claimed dissolved).

**Bounds — corrected** (round 5, finding 5). The from===0 last-resort page returns everything not
yet returned, limit-free — an existing, tested, self-limiting branch (it always ends the walk;
subscribe.test.ts test (j)) that arrivals make more reachable, since an anchor's entries cannot be
split across pages. The **per-session log cap** (mirroring `MAX_ARRIVALS`: oldest dropped, drop
announced) bounds *what arrivals add* to that page — and only that. The page's transcript portion
was unbounded before M9 and stays so; that is the pager's pre-existing, documented trade, not this
design's to fix. Rev 6 claimed the cap bounded the page; it does not, and the claim is withdrawn.

**Dedupe guard.** Skip any entry whose `id` already appears among the fetched rows. Today it never
fires, because `getSessionMessages` drops every `isMeta` row (M1); it is what keeps this design
correct on the day a future SDK stops dropping them. It is monotone too, so the bisection is safe.

**`rowKind` is no longer on the path.** The projector injects items directly, so no synthetic row
ever meets `PHANTOM_ROW_KINDS` — rev 5 needed M11 to prove spliced rows survive classification, and
the projector makes that load-bearing role moot. M11 stands as a true measurement (all 170 peer rows
classify `prompt`; U2 answered) and keeps one consumer: Stage A's *replay* path, where real peer
rows do route through `rowKind` before `peerArrival` (replay.ts:27). The corrected comment in
`sessions/rows.ts` stands on its own merits.

### When placement fails

One rule: **the anchor resolves and the arrival renders there, or it does not resolve and the arrival
does not render.** Never a guessed position.

That rule absorbs three separate findings:

- **Compaction.** M6: the reader's window is post-compaction only. The anchor is gone, and so is the
  answer it preceded.
- **Rewind (finding 4).** No transaction, no rebase, no `historyGeneration`. The log is never mutated
  and placement is recomputed per read, so a rewind needs no compensating action — including the case
  the finding named, where `thread/rewind` replies success (rewind.ts:560-565, after `swapEngine`
  returns) and the replacement engine's `resumeDropsTurn` refusal surfaces only later, as a throw with
  no named branch. Nothing was compensated, so nothing has to be un-compensated.
- **A losing branch under two engines (finding 5).** The reader returns one leaf-selected spine; an
  anchor on the other branch is simply absent. No cross-process fencing, no branch-aware history.

**A stated limit, not a claim of correctness:** if a concurrent engine's arrival anchors to a row on
the *shared trunk*, it will render in the surviving branch's history. Branches are not detectable
from `getSessionMessages`' output. Two engines on one session is unsupported; this records what the
design does there rather than promising what it guarantees.

**Omission is made detectable, which is what "explicit" costs here.** Rev 5 argued omission was the
status quo and left it silent; the review rightly refused that reading of D3 (round 4, finding 1) —
`thread/read` would return an apparently complete success over incomplete history. What is *not*
adopted is failing the RPC: an arrival whose anchor predates compaction is the *normal* aftermath of
M6, and a poisoned read forever is worse than an incomplete one.

Round 5 (finding 6) then showed rev 6's version of the mechanism didn't work: a count on the
terminal page is uncheckable when the projected arrivals are plain user items a cold client cannot
tell apart from ordinary ones, and "every read exposes degradation" is false if only the terminal
page speaks. Both halves are fixed structurally:

- **Arrival items are marked.** A projected item carries the entry's `origin` verbatim — an optional
  item field old clients ignore, the same object `thread/peerMessage` broadcast, so the item is both
  countable and provenance-complete. The live path's drained item and Stage A's replayed item gain
  the same field in Stage C, so all three renderings of one arrival agree. (This is also the shape
  task #63 wants for the notification side; the two converge.)
- **Every reply carries `arrivals: { logged, dropped }`** — built by one response helper used by all
  five reply paths (cursorless, normal page, last resort, empty-session, no-session), so no path can
  forget it. `logged` counts every entry ever written, *including* evicted ones: eviction under the
  cap writes a durable dropped-count marker first (round 5, finding 5 — an append-only log that
  silently forgets is a contradiction, and a post-eviction count that matched the retained entries
  would falsely certify completeness). `arrivals: null` means the store is degraded — "I cannot
  tell you" stated as itself, never as `0` — and the degraded latch is the marker file, so it
  survives a restart. A client that counts marked items against `logged` knows exactly how many
  messages history is not showing, on any page of any walk.

The shared-trunk case stays a stated limit: a misattributed anchor is not detectable from the
reader's output at any price, and two engines on one session is unsupported. D3's claim is narrowed
to what the mechanism actually delivers — **incompleteness is always visible; misattribution is
excluded only by the supported topology.**

### Durability and ordering (finding 1)

`Session.readLoop` calls `onFrame` synchronously and neither awaits nor catches rejection. Rev 3
needed an ordered asynchronous pipeline because it assigned placement *later*. Here it does not:
the anchor and `seq` are both computed synchronously at observation, so **the entry's content fixes
its position** — *given* the store-seeded `seq` above; rev 5's per-process counter made this claim
false across a restart, and the seeding is what makes it true. Only durability remains, and a
synchronous write answers it.

Measured on the real `~/.claude` filesystem, write-plus-rename: p50 0.143ms, p95 0.201ms, p99
0.896ms, max 6.497ms over 500 writes; a 16KB body costs the same as a 400B one, because the cost is
the syscall pair rather than the bytes. That is the bounded synchronous write finding 1 explicitly
permits, on a path already doing IO, and it removes the entire pipeline. It is written **before** the
broadcast, so a client is never told about a message history does not have — with exactly one
exception, the caught write failure below, where the broadcast proceeds *because* the degraded latch
makes the store's gap visible on every subsequent read.

**What M10 does not cover is failure, and the review was right that rev 5 had no answer** (round 4,
finding 5). The semantics are now stated:

- **A write that throws** (ENOSPC, EACCES, a failed rename) is caught in the observer — an escaped
  exception would hit `readLoop`'s discard and vanish. The notification is still broadcast: the live
  channel reports what the engine *did*, and the engine delivered the message whether or not our
  sidecar could record it. The session latches **degraded** — persisted in the marker file, so a
  restart does not forget it — and every subsequent `thread/read` reports `arrivals: null`:
  history's incompleteness is undetectable from a count that might be short, so the count honestly
  abstains.
- **Crash semantics are atomic visibility, not fsync durability.** Temp-then-rename guarantees no
  reader ever sees a torn entry; it does not guarantee an entry survives power loss before the
  metadata flushes. For a history sidecar that is the right trade — losing the newest entry to a
  machine crash is an absence the count reveals, while a torn entry would be a corruption — and it is
  claimed as exactly that, not as "durable".
- **A network-filesystem home directory** can stall a synchronous write without bound, on the read
  loop. Documented, not engineered around: this store lives where the CLI's own transcripts live, and
  a deployment that puts `~/.claude` on NFS has accepted that class of stall for every transcript
  write the engine itself makes.

One file per entry with a temp-then-rename, rather than one appended JSONL: no partially written
trailing line for a concurrent reader, and no interleaving between two app-server processes, without
needing a lock. Reading a whole log costs 0.12ms at one entry and 2.1ms at a hundred; the corpus-wide
arrival count is 69, and the per-session cap above bounds it structurally.

### The observer has to be seeded

The anchor is "the last filter-surviving frame this thread has observed", and on attach or resume the
observer has seen none. The seed read (`getSessionMessages`, last row) is asynchronous while frames
and arrivals land synchronously — so a bare "seed at startup" has a race on both sides: install the
observer first and an immediate arrival is persisted with a `null` anchor, which means
confirmed-empty and renders at the *top* of history (a misplacement); seed first and frames landing
during the read are missed (round 4, finding 4 — and independently caught here before the review
returned).

So seeding is an explicit state, not an ordering hope. The observer installs synchronously —
same-tick, as the admission contract requires — and opens **buffering**: frames advance a provisional
anchor chain in arrival order, and arrivals are held, neither persisted nor broadcast. When the seed
read resolves, the chain is grounded, buffered arrivals get their anchors computed in observation
order, and each is then persisted and broadcast in that order. The window is one read long —
milliseconds — and inside it nothing is durably wrong yet, so there is nothing to repair afterwards.
`anchor: null` can now *only* mean confirmed-empty, because an unknown anchor is unrepresentable in
the store: entries are written only after the seed resolves.

**Grounding has an overlap rule, because the seed is not a snapshot** (round 5, finding 2). A frame
observed live during the read can also appear in the read's result — the engine persists as it
emits — and grounding naively on the seed's tail would then anchor a buffered arrival *after* a row
that arrived after it. The rule: find the earliest buffered frame uuid that occurs anywhere in the
seed result; the chain grounds on the seed row **before** that occurrence, and the buffer replays
from its start, so every frame counts exactly once. No overlap grounds on the seed's tail; an empty
seed grounds on confirmed-empty. Acceptance pins the four shapes: seed-behind (no overlap),
seed-ahead (buffer fully contained), partial overlap, and seed-tail-equals-buffer-head.

The filter-surviving predicate mirrors the reader's own (`isMeta`, `isSidechain`, `teamName` are
dropped), and that coupling is **dangerous in both directions** — rev 5 claimed drift was safe, and
the review showed the claim was one-sided. Dropping a frame the reader keeps leaves the anchor
*stale but resolvable*: the arrival renders after an older row, before rows that actually preceded
it — a misplacement, not a withholding. The predicate therefore gets a contract test that runs both
predicates over a corpus of real frame shapes and fails on any disagreement, which turns silent
drift into a red test at the SDK bump that introduces it — the same posture the drift ritual already
takes for settings keys.

### Store injection (finding 9)

`getSessionMessages` is optional on `AppServerDeps` (server.ts:68) with a default resolved at each of
its four call sites. The arrival store is added the same way, under one structural rule:

**The filesystem store is the default only when `getSessionMessages` is also the default.** An
embedder that overrides the reader but not the store gets merging disabled, rather than this
machine's arrivals merged into a transcript it does not own. Both are fields on one deps object, so
this is checkable at startup rather than a convention to be honoured.

### A separate defect this surfaced

`drainArrivals` drains the queue into whatever adoption is current (peerInbound.ts:220-227), so an
arrival recorded while no adoption exists is attributed to a later turn it did not cause. The log is
immune — it anchors at observation and never consults adoption — but the live item stream is not.
That is a defect in the M8 live path, not in history, and it is tracked on its own rather than folded
in here.

### Staging

- **Stage B — store and observer.** Entries are written; nothing reads them. Verifiable alone:
  one entry per `thread/peerMessage`, ids equal, every non-null anchor naming a row that exists.
  Unlike rev 3's Stage B this bakes in no read-side contract, because placement is not stored.
- **Stage C — the projector in `thread/read`.** The visible feature.
- **Stage D — the anchored scan in `thread/searchOccurrences`,** so an arrival's text is findable
  and its `readCursor` lands.

## Acceptance

### Stage A — shipped

1. **No message a frame delivered is dropped.** For the collapsed row in M8m, the item carries both
   M2 and M3 rather than M2 alone.
2. **Every non-batched arrival is byte-identical to today** — 169 of the 170 measured rows.
3. **A quoted or forwarded envelope inside a body is not truncated**, and sibling envelopes are not
   merged with their tags.
4. **An envelope-less frame still resolves through `origin.body`.**
5. **The live item and its cold replay agree**, because one function serves both paths.

### Stage B — store and observer

6. **One entry per announcement.** For any keyed run, the number of log entries equals the number of
   `thread/peerMessage` notifications, and their ids are equal as sets.
7. **Every non-null anchor names a row that exists** in what `getSessionMessages` returns at the time
   of writing, and carries a fingerprint matching that row.
8. **A folded arrival is logged**, against M7's positive control — the case no transcript reader can
   ever recover.
9. **No merge is performed.** `thread/read`'s items are byte-identical to today with the store
   populated, which is what makes Stage B verifiable on its own. (The observer does read: the seed
   row and the session's max `seq` — its own store's write path, not a read-side merge.)
10. **An arrival is persisted before it is announced.** Killing the process between the two leaves an
    entry with no notification, never the reverse — except a caught write failure, where the
    notification still goes out and the session latches degraded.
11. **Order survives a restart.** Two same-anchor arrivals separated by a server restart carry
    increasing `seq` — the store-seeded counter, pinned by a test that restarts between them.
12. **An arrival racing the seed is neither lost nor misanchored.** Delay the seed read artificially,
    deliver an arrival immediately at attach: the entry appears after the seed resolves, anchored to
    the seeded row, never to `null`.
13. **A write failure degrades loudly and durably.** With the store directory made unwritable, the
    notification still broadcasts, `thread/read` reports `arrivals: null` from then on — and still
    does after a restart, because the latch is the on-disk marker.
14. **Grounding survives seed/buffer overlap** in all four shapes: seed-behind, seed-ahead, partial
    overlap, and seed-tail-equals-buffer-head. Each frame anchors exactly once; an arrival buffered
    before a row that the seed also returned anchors *before* that row.
15. **The anchor identity rejects the measured collisions.** Against fixtures reproducing M5's
    differing-parent duplicate shape, and against a live frame that omitted `timestamp`, resolution
    withholds on position mismatch and never binds to the wrong occurrence.
16. **Eviction is never silent.** Fill past the cap: the dropped-count marker exists, and
    `arrivals.logged` still reports the pre-eviction total, exceeding the items any read can return.

### Stage C — the splice in `thread/read`

17. **The question precedes the answer.** For a keyed cross-session exchange, `thread/read` returns
    the arrival item immediately before the assistant turn it caused — the defect this milestone
    exists to fix, and the inverse of M8's LEG 2, which is written to redden the day it closes.
18. **The arrival item carries the entry's text verbatim and its `origin`** — for the collapsed
    batch, both messages, proving the projector bypassed `peerArrival` (whose fallback would re-lose
    one); and the `origin` field is what lets a client count arrival items at all. Live, replayed and
    projected renderings of one arrival agree on id, text and origin.
19. **The cursor is unchanged.** Paging a session that has arrivals emits cursors matching
    `^\d+:\d+$` addressing raw rows, and a rewind still invalidates them with the same
    `INVALID_PARAMS` message. No schema file changes in this stage (D1).
20. **A `limit:1` walk across a session with arrivals terminates and strands nothing.** Every item
    appears at least once and its id is stable across pages. Not "exactly once": the pager's existing
    contract is no-loss plus dedupe-by-id, because `boundaryRow` returns the smallest prefix holding
    every discarded id and a row straddling that boundary is legitimately re-fetched. An arrival
    inherits that contract rather than being held to a stronger one. Pinned at the named edges: an
    anchor on the window's last row, an anchor row that opened a still-unfinished tool, more
    same-anchor arrivals than `limit` (which ends in the tested last-resort page), and **round 5's
    exact construction** — a null-anchored entry plus three rows at `limit: 1`, which must return
    all four items rather than stranding the entry.
21. **`arrivals: { logged, dropped }` is on every reply**, from every path — cursorless, normal
    page, last resort, empty-session and no-session — and `logged` matches the notification count
    for the run.
22. **An unresolvable anchor withholds rather than misplaces.** With the anchor row removed, its
    fingerprint changed, OR its predecessor changed (the rebound-duplicate shape), the arrival does
    not appear, no other item's position moves — and `arrivals.logged` exceeds the marked items
    returned, making the omission visible.
23. **A cleared thread starts empty and the old transcript keeps its arrivals** (D2), verified by
    clearing and then resuming the prior session id.
24. **An embedder that overrides `getSessionMessages` without a store gets no merge** (D3, finding 9)
    and `arrivals` is absent, not `0`.

### Stage D — the anchored scan in `thread/searchOccurrences`

25. **An arrival's text is findable**, and its `readCursor` lands a `thread/read` window containing
    it — including a null-anchored arrival, whose `readCursor` is `epoch:1` when a first row exists
    and `null` otherwise.
26. **Two same-anchor arrivals both matching resume correctly at `limit:1`** — the occurrence
    cursor's `(seq, id)` discriminator names which entry is next, so neither is skipped and neither
    repeats.

## Delegated unknowns

- **U1 — do envelope-less (coordinator-path) arrivals batch at all?** If never, Stage A's residual
  limit is empty in practice. Probe 121's machinery answers it for one run. **Still open.**
- **U2 — does `rowKind` change verdict on any widened row?** **Answered (M11): no**, and then made
  moot for the splice path: all 170 peer rows classify `prompt` and none is a phantom kind, but the
  rev 6 projector injects items without ever constructing a row, so `rowKind` no longer sits between
  an entry and its rendering. M11's remaining consumer is Stage A's replay of real peer rows. The
  comment in `sessions/rows.ts` asserting "The rows carry NO meta flags (probe 68b)" is true of the
  reader's output and false of the rows on disk, and is corrected to say which.

## Decision Log

- **Render every envelope and join, rather than pick one.** Rejected: preferring the first envelope —
  in a multi-envelope frame that is an arbitrary member, no better than `origin.body`. Rejected:
  splitting into N items — it would require inventing uuids the announcement never used and nothing
  could dedupe against. The engine really did produce one frame; one item carrying everything it
  delivered is the faithful rendering.
- **Depth-counting extraction, not a regex capture.** Both captures are measurably wrong here: lazy
  truncates at a quoted envelope's inner tag, greedy merges siblings with tags intact.
- **The server logs arrivals; it does not reconstruct them from the transcript.** Rejected: rev 1's
  splice. Six confirmed findings sharing one root — reading a file another process owns and
  re-deriving its private ordering. The log also serves folded arrivals, which no transcript reader
  can.
- **Scope is peer arrivals.** M3: the other origin kinds are subagent history this reader never opens.
- **An arrival rides its anchor row; it does not occupy a row of its own.** This is the decision the
  whole of rev 5 rests on. Rejected: giving arrivals their own position in the merged sequence, which
  is what forced rev 3's opaque cursor — a merged offset is not a raw offset, so every coordinate in
  `thread/read` and `thread/searchOccurrences` would have had to move, and the published cursor
  pattern with them. Riding an anchor keeps the splice a pure, monotone function of the row window,
  which is exactly the predicate `boundaryRow`'s bisection already assumes, so no coordinate changes
  at all. D1 is satisfied by needing nothing rather than by fitting something in.
- **Anchor to the last observed row, not to the turn the arrival caused.** Rejected: rev 3's
  two-phase placement. A turn is the wrong coordinate — a folded arrival's host turn has already
  emitted rows, and `beginTurn` declines while that turn is busy, so there is no settlement to
  finalize against. The row the arrival came after is known synchronously, needs no second phase, and
  is what a reader can actually locate later.
- **Append-only, resolved at read.** Rejected: rebasing the log on rewind. Rebasing needs a
  transaction boundary against a transcript we do not own, and `thread/rewind` replies before the
  replacement engine can refuse. Recomputing placement per read makes a rewind a non-event, which is
  cheaper than making it atomic and is correct for the refusal case too.
- **Withhold rather than interpolate when an anchor does not resolve.** Rejected: placing the
  arrival next to its nearest resolvable neighbour. Interpolation always produces a position, and a
  position we invented is exactly the plausible-looking wrong answer D3 rules out. Withholding is the
  status quo for that one message and never lies about order.
- **No withheld-count field, and it is named as a gap.** Rejected: reporting a count computed from
  the current window, which would be a number the server cannot stand behind. An honest count needs
  whole-history knowledge the pager is deliberately built to avoid gathering.
- **One file per entry rather than one appended JSONL.** Rejected: appending to a per-session log,
  which needs either a lock or a tolerance for a partially written trailing line, and can interleave
  between two app-server processes. At 69 arrivals corpus-wide the per-file cost is irrelevant and
  the atomicity is free.
- **The store is keyed by session id.** This is D2's entire implementation: `thread/clear` already
  detaches by dropping `record.sessionId` and letting the replacement engine mint a new one, so
  keying by session gives "detach, not delete" with no code that knows about clearing.
- **Items, not rows (rev 6).** The projector injects arrival items directly rather than
  materialising synthetic transcript rows. Rejected: synthetic rows — they either corrupt the raw
  cursor (if spliced into the indexed array) or re-lose the collapsed batch (if routed through
  `peerArrival`, whose envelope scan finds nothing in the joined text and falls back to
  `origin.body`). The rejected alternative was not merely inferior; both of its readings were broken.
- **Publish the logged count, not a withheld count (rev 6).** Rejected in rev 5 as unknowable;
  the review forced a better distinction: the *withheld* count needs whole-history knowledge, the
  *logged* count is one readdir, and a client holding both the count and the items can compute the
  discrepancy itself. Rejected: failing the RPC on any unresolvable anchor — compaction makes that
  the common case and would poison every read of an ordinary long session.
- **Degrade loudly, and let the notification outlive the store (rev 6).** A caught write failure
  still broadcasts `thread/peerMessage` — the live channel reports what the engine did, and the
  engine delivered the message regardless — while `arrivals: null` marks history untrustworthy.
  Rejected: suppressing the notification on write failure, which would convert a sidecar fault into
  a lie about the engine's behaviour.
- **Chain position, not just content, is the anchor identity (rev 7).** Rejected: fingerprint-only —
  a rewrite-born duplicate can be field-identical at a different position, and the misplacement it
  permits is exactly the failure class under design. `prevUuid` pins the position; a rebound
  duplicate sits after a different predecessor by construction.
- **Null anchors are a sentinel, not a row-zero coordinate (rev 7).** Rejected: treating
  confirmed-empty as "anchored at width 0", which made the entry discardable and then stranded it —
  the bisection resolves it to `begin = 0` and ends the walk. An anchor that names no row cannot
  participate in a bisection over rows.
- **Arrival items are marked with `origin` (rev 7).** Rejected: an unmarked count — a client cannot
  compare a count against items it cannot distinguish. Rejected: a server-computed withheld count —
  it would need a whole-history resolution pass per read, the exact cost the pager exists to avoid.
  The marked item makes the client's subtraction trivial and carries provenance the item should have
  had anyway.
- **The trust claim is withdrawn.** A same-user process that can write the transcript can write a
  sidecar. What a log buys is that `thread/read` and `thread/peerMessage` cannot disagree, and that
  accidental contamination is structurally impossible. Real integrity needs authenticated storage out
  of that attacker's reach, and is out of scope.

## Surprises & Discoveries

- **The same error class twice in one round: an aggregate read as a statement about its members.**
  First, an origin-kind census summed across main and subagent transcripts and produced a hidden
  population five kinds wide; separating the corpora left `peer` and nothing else. Then probe 121's
  nonce coverage — "all three texts are present" — was read as "each frame carries its own text",
  when in fact one frame carried two. Both times the refuting detail was already in output I had
  quoted. The generalisable rule is now in the probe's header: an aggregate over a set answers a
  question about the set, never about its members.
- **A subagent found the collapse independently and built a better rule than the one it was given.**
  Briefed to prefer "the envelope", it discovered the multi-envelope row, recognised that a greedy
  capture merges siblings, and returned every top-level envelope instead. It was then told to revert
  on my mistaken reading and had done so before the cancellation arrived — the work was recoverable,
  but a correction issued in haste cost more than the error it was chasing.
- **Probe 121 found a shipped bug while answering a design question**, and the bug is not the one it
  first appeared to be: not "the wrong text is announced" but "text the model answered is dropped
  entirely".
- **LEG 5's assertion passes for the wrong reason.** It pins "N arrivals, ONE `msg_id`, ONE `body`"
  and attributes the loss to the engine. True of `origin.*`; it never examined the frame's content and
  so never saw the collapse.
- **An SDK bump is an engine change.** Task #60 moved the bundled CLI 2.1.237 → 2.1.250 and a
  cross-session contract moved with it: a send into a `refuse` thread, previously silent, now returns
  an `expired` receipt with a reason. Established by controlled experiment; the refusal is still
  enforced, only the sender's visibility improved.
- **Permission to refuse made the design smaller, not weaker.** Rev 3 answered nine findings by
  adding nine mechanisms, and every one of them existed to defend a position it had chosen to occupy:
  a merged coordinate space needed an opaque cursor, a stored placement needed a rebase, a turn
  anchor needed two phases. The owner's D3 — be correct where you can and refuse where you cannot —
  permitted vacating those positions, and seven findings went with them. The generalisable form: when
  a design needs a mechanism per objection, suspect the objections are all downstream of one
  commitment, and price *removing* it before engineering around it.
- **A hopeful reading, checked before it was relied on.** The live path announces one arrival per
  uuid and probe 121 saw three uuids for three messages, which suggested the log could restore the
  per-message identity the transcript destroys. Reading `noteArrival` refuted it: it fires once per
  *frame*, and the collapsed frame already carries two bodies at observation. Live and cold see the
  same collapse. This is the same failure the round has now produced three times — an aggregate or an
  adjacent count read as a statement about members — caught this time before it reached a document.
- **Three designs, twenty-four findings, and the honest output is a smaller feature plus a list.**
  Every revision was internally coherent and every one was broken in a single review pass. The cost
  of each was measurement; the cost of shipping any would have been a history nobody could see was
  wrong.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-29)** — transcript splice. Dead: six confirmed findings.
- **rev 2 (2026-08-29)** — pivot to a server-side arrival log. Eight findings.
- **rev 3 (2026-08-30)** — rev 2's gaps closed and work staged A–D. Returned NOT CONVERGED with nine
  findings; separately, its central new measurement was misread.
- **rev 4 (2026-08-30)** — corrects M8m: a batch is COLLAPSED and per-message identity does not exist
  in the data, superseding rev 3's "each frame carries its own text". Stage A survives with a
  different and better rationale — join every envelope so no message is dropped — and is ready.
  Stages B–D are recorded as not converged, with their nine open findings named and the two owner
  decisions surfaced rather than guessed. The status line now says what is true.
- **rev 5 (2026-08-30)** — the owner answered, and Stages B–D acquire mechanism by *removing*
  machinery rather than adding it. Three moves — anchor at observation to the last row, append-only
  with placement resolved at read, and arrivals riding their anchor row — dissolve findings 2, 3, 4,
  5, 7, 8 and 9, leave 1 answered by a measured synchronous write (M10), and convert the remainder
  into two stated limits. Rev 3's two-phase placement, `historyGeneration`, rewind rebase, lease and
  opaque cursor are all withdrawn; the cursor and the published schema do not change at all. U2 is
  answered by measurement (M11). Acceptance is written for B, C and D. A separate M8 live-path defect
  is recorded: `drainArrivals` attributes an arrival to whatever adoption is current, which can be a
  turn it did not cause.
- **rev 6 (2026-08-30)** — round 4 of review: eight findings, all real, all adopted, none requiring
  the architecture to move. The splice becomes an item-level projector (no synthetic rows — both
  readings of rev 5's row splice were broken, one corrupting the cursor and one re-losing the batch);
  the anchor gains a fingerprint against uuid rebinding (refuted by M5's own duplicate count); `seq`
  is seeded from the store so order survives a restart; seeding becomes an explicit buffering state
  and `anchor: null` becomes unrepresentable except as confirmed-empty; write failure latches a
  degraded state surfaced as `arrivalsLogged: null`; the terminal page publishes `arrivalsLogged` so
  omission is detectable, which is the narrowed, honest form of D3's "explicit"; the occurrence
  cursor gains a `(seq, id)` discriminator; a per-session log cap bounds the last-resort page.
  Crash semantics are stated as atomic visibility, not durability. Rev 5's "drift is safe" and
  "write order is irrelevant" claims are both corrected as one-sided or conditional.
- **rev 7 (2026-08-30)** — round 5 of review: six findings, all missing-mechanism, all adopted, and
  visibly narrower than round 4's — edge composition rather than core mechanism. The anchor gains
  `prevUuid` (chain position — the fingerprint alone cannot distinguish a rewrite-born duplicate)
  and a content hash with match-on-recorded-fields semantics; grounding gains an explicit
  seed/buffer overlap rule with four pinned shapes; the projector is re-specified on `TurnMapper`'s
  real per-frame `ingest` (rev 6's "items for that row" named an operation that does not exist), and
  the false claim that search shares it is withdrawn — Stage D gets an anchored-entry scan step;
  null anchors become a sentinel outside the bisection, closing the stranded-arrival walk the review
  constructed; eviction writes a durable dropped-count marker and the cap's bounds claim is
  corrected; arrival items are marked with `origin` on all three renderings and
  `arrivals: { logged, dropped }` rides every reply through one helper, degraded state persisting
  via the marker. Acceptance grows to 26 criteria.
