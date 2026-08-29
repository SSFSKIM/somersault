# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 5 — **Stage A shipped; Stages B–D have mechanism, pending review.** ·
**Task:** #59 · **Depends on:** M8 (merged, `06bf3c0e44`)

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

**M11 — `rowKind` does not discard a peer row, so a spliced arrival survives to `peerArrival`.**
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
| 1 | No durable ordering primitive — `readLoop` calls `onFrame` synchronously and neither awaits nor catches rejection | **Answered.** Content fixes position, so write order is irrelevant; only durability remains, and a measured synchronous write covers it (M10). *Durability and ordering* |
| 2 | Two-phase placement cannot locate a folded or unfinalized arrival | **Dissolved** by Move 1 — the coordinate is a row, not a turn, so there is no second phase to fail. *Placement* |
| 3 | The cursor snapshot does not freeze finalize or eviction | **Dissolved** — entries are immutable and placement is derived, so there is no snapshot and nothing to freeze. *Placement* |
| 4 | Rebase has no transaction boundary matching the real rewind | **Dissolved** by Move 2 — append-only, so a rewind needs no rebase and a refused rewind needs no compensation. *When placement fails* |
| 5 | Concurrent writers do not form the claimed union | **Bounded.** A losing-branch anchor is absent, so the arrival is withheld rather than misplaced. Stated limit: an anchor on the shared trunk still renders. *When placement fails* |
| 6 | `thread/clear` would erase arrivals from a still-resumable transcript | **Answered by D2** — keying by session id gives detach-not-delete, because clear already detaches by dropping `record.sessionId`. *The log* |
| 7 | Search has no occurrence coordinate for a logged arrival | **Dissolved** by Move 3 — an arrival publishes its anchor's coordinate, which already lands a window containing it. *Placement* |
| 8 | The opaque cursor is an unversioned wire break | **Absent.** Move 3 changes no cursor, so D1 is satisfied by needing nothing. *Placement* |
| 9 | The injectable store has no compatibility rule | **Answered** — a structural default rule readable off the deps object. *Store injection* |

Two gaps are carried forward rather than closed, and are named as such where they arise: the
shared-trunk case under finding 5, and the absence of a withheld count.

### The log

One entry per `noteArrival` call — that is, exactly one per `thread/peerMessage` notification, so the
announcement channel and history cannot disagree about how many messages arrived.

An entry is immutable and carries `{ v, id, sessionId, afterUuid, seq, observedAt, origin, text }`.

- **`id`** — the frame's own uuid, or `noteArrival`'s minted fallback (peerInbound.ts:181). This is
  the same id `items/replay.ts` gives a replayed row, which is the mechanism by which a client
  dedupes the live item against the one `thread/read` returns.
- **`text`** — `peerArrival(frame).text`, so live and cold remain one function's output. Stage A's
  join is what makes this whole rather than the causing message alone.
- **`origin`** — verbatim, for the reason `thread/peerMessage` carries it verbatim: `verifiedPeerPid`
  is the only kernel-vouched field in the exchange and re-deriving it would replace a verified fact
  with this server's opinion of it.
- **`afterUuid`** — the uuid of the last frame this thread observed that would survive the reader's
  filter; `null` when there was none.
- **`seq`** — per-process monotonic, ordering entries that share an anchor. Cross-process ties break
  on `id`.

**Keyed by session id**, which is D2's mechanism in full. `thread/clear` sets
`record.sessionId = undefined` and lets the replacement engine mint a new id at its init frame
(settingsOps.ts:315-340, and the header there says why); it deletes no transcript. So a cleared
thread's arrival scope starts empty, the old session's entries stay on disk, and resuming that
transcript shows them again. **Detach, not delete, requires no code beyond the choice of key.**

An arrival observed before the thread has a session id is held in memory and flushed at the init
frame. A crash in that window loses it — a stated limit, and the only one durability does not cover.

### Placement — arrivals ride their anchor row

`thread/read` fetches raw rows and maps them with `itemsFromTranscript` (subscribe.ts:77). The splice
goes between those two steps: for each fetched row, append the entries whose `afterUuid` is that
row's uuid, ordered by `(seq, id)`. An entry anchored `null` splices before the first row, and only
when the page reaches the start of the file.

Two properties make this safe, and the existing pager already requires both of them:

- **Pure** — the spliced array is a function of the row window alone.
- **Monotone** — an entry appears in `splice(rows[0,w))` for every `w` past its anchor and never
  before. `boundaryRow`'s bisection (subscribe.ts:28-61) rests on exactly that predicate, so it keeps
  working unmodified.

**Because an arrival rides a row rather than occupying one, the cursor arithmetic never changes.**
`boundaryRow` still returns a raw row index, `base` is still a raw row offset, and the emitted cursor
is still `` `${record.epoch}:${begin}` ``.

Which means **no cursor change, no schema change, no capability negotiation and no versioned break**.
Finding 8 is not mitigated; it is absent. The owner's decision was to preserve compatibility by
keeping the cursor inside its published `^\d+:\d+$` shape, and that decision is honoured more cheaply
than the read-snapshot id it selected: once entries are immutable and placement is derived rather
than stored, there is no sequence left that needs freezing, so finding 3 goes with it.

The same splice serves `thread/searchOccurrences`, which scans windows through the same reader
contract (search.ts:122-126). A match inside an arrival publishes its **anchor's** coordinate,
`` `${epoch}:${rowOffset + 1}` `` — a cursor that already lands a window ending at the row the
arrival rides. Finding 7 dissolves with the same move rather than needing an occurrence coordinate of
its own.

**Dedupe guard.** Skip any entry whose `id` already appears among the fetched rows. Today it never
fires, because `getSessionMessages` drops every `isMeta` row (M1); it is what keeps this design
correct on the day a future SDK stops dropping them. It is monotone too, so the bisection is safe.

**`rowKind` does not interfere.** `itemsFromTranscript` discards `PHANTOM_ROW_KINDS` before
`peerArrival` is ever consulted (replay.ts:27), so a spliced row that classified as a phantom would
vanish. Measured by running the real `rowKind` over all 170 peer rows on this machine: every one
classifies `prompt`, none is a phantom kind. **This answers U2.** The four classifiers are all
anchored at the start of the text and a peer frame opens with a CLI-authored preamble, so the result
is structural rather than lucky — but the comment in `sessions/rows.ts` that asserts "the rows carry
NO meta flags" is true of the reader's output and false of the rows on disk, and is corrected to say
which.

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

**No withheld-count field.** D3 asks that a hard case refuse rather than answer plausibly and wrongly.
Omission is not a wrong answer about position — it is the status quo, where every arrival is omitted —
and reporting a truthful count would need whole-history knowledge the pager deliberately never
gathers. Deferred as a real gap rather than faked with a number computed from one window.

### Durability and ordering (finding 1)

`Session.readLoop` calls `onFrame` synchronously and neither awaits nor catches rejection. Rev 3
needed an ordered asynchronous pipeline because it assigned placement *later*. Here it does not:
`afterUuid` and `seq` are both computed synchronously at observation, so **the entry's content fixes
its position and write order is irrelevant.** Only durability remains, and a synchronous write
answers it.

Measured on the real `~/.claude` filesystem, write-plus-rename: p50 0.143ms, p95 0.201ms, p99
0.896ms, max 6.497ms over 500 writes; a 16KB body costs the same as a 400B one, because the cost is
the syscall pair rather than the bytes. That is the bounded synchronous write finding 1 explicitly
permits, on a path already doing IO, and it removes the entire pipeline. It is written **before** the
broadcast, so there is no window in which a client has been told about a message history does not
have.

One file per entry with a temp-then-rename, rather than one appended JSONL: no partially written
trailing line for a concurrent reader, and no interleaving between two app-server processes, without
needing a lock. Reading a whole log costs 0.12ms at one entry and 2.1ms at a hundred; the corpus-wide
arrival count is 69.

### The observer has to be seeded

`afterUuid` is "the last filter-surviving frame this thread has observed", and on attach or resume the
observer has seen none. It seeds from the last row `getSessionMessages` returns for the session.
Without that seed the first arrival after a resume anchors `null` and renders at the top of history —
the one placement error this design can produce, and it is a startup ordering requirement rather than
a runtime one.

The filter-surviving predicate mirrors the reader's own (`isMeta`, `isSidechain`, `teamName` are
dropped). That is a coupling to SDK behaviour and earns its own test. If it drifts, arrivals anchor to
rows the reader discards and are withheld — the safe direction.

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
- **Stage C — the splice in `thread/read`.** The visible feature.
- **Stage D — the splice in `thread/searchOccurrences`,** so an arrival's text is findable and its
  `readCursor` lands.

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
   of writing.
8. **A folded arrival is logged**, against M7's positive control — the case no transcript reader can
   ever recover.
9. **Nothing is read.** `thread/read`'s output is byte-identical to today with the store populated,
   which is what makes Stage B verifiable on its own.
10. **An arrival is durable before it is announced.** Killing the process between the two leaves an
    entry with no notification, never the reverse.

### Stage C — the splice in `thread/read`

11. **The question precedes the answer.** For a keyed cross-session exchange, `thread/read` returns
    the arrival item immediately before the assistant turn it caused — the defect this milestone
    exists to fix, and the inverse of M8's LEG 2, which is written to redden the day it closes.
12. **The cursor is unchanged.** Paging a session that has arrivals emits cursors matching
    `^\d+:\d+$` and a rewind still invalidates them with the same `INVALID_PARAMS` message. No
    schema file changes in this stage (D1).
13. **A `limit:1` walk across a session with arrivals terminates and yields every item exactly once.**
14. **An unresolvable anchor withholds rather than misplaces.** With the anchor row removed, the
    arrival does not appear, and no other item's position moves.
15. **A cleared thread starts empty and the old transcript keeps its arrivals** (D2), verified by
    clearing and then resuming the prior session id.
16. **An embedder that overrides `getSessionMessages` without a store gets no merge** (D3, finding 9).

### Stage D — the splice in `thread/searchOccurrences`

17. **An arrival's text is findable**, and its `readCursor` lands a `thread/read` window containing it.

## Delegated unknowns

- **U1 — do envelope-less (coordinator-path) arrivals batch at all?** If never, Stage A's residual
  limit is empty in practice. Probe 121's machinery answers it for one run. **Still open.**
- **U2 — does `rowKind` change verdict on any widened row?** **Answered (M11): no.** All 170 peer
  rows classify `prompt` and none is a phantom kind, so a spliced arrival reaches `peerArrival`. The
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
