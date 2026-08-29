# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 4 — **Stage A ready; Stages B–D NOT converged and not implementable as
specified.** · **Task:** #59 · **Depends on:** M8 (merged, `06bf3c0e44`)

## Why this exists

M8 gave the app-server cross-session messaging in both directions. A thread admitted with
`crossSessionInbound: "accept"` turns an arriving peer message into a fully visible turn: subscribers
get `thread/peerMessage`, then the model's answer, then a terminal state.

That is true only while you are watching. Call `thread/read` afterwards and the inbound message is
absent while the assistant's answer to it is present — **history shows an answer with no question.**

The purpose is that **a thread's readable history should contain everything the thread actually
received**, without the client having to know cross-session messaging exists.

## Where this design actually stands

Three revisions have been written and adversarially reviewed. Twenty-four findings, every one real.
Rev 1's approach is dead, rev 2's is superseded, and rev 3's machinery came back **NOT CONVERGED**
with nine open findings that are not editorial — they are missing mechanism.

This revision does not pretend otherwise. It records what is settled, what shipped-quality work can
proceed now, and precisely what remains unsolved, including two questions that are the owner's to
answer rather than mine.

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

## Stages B–D — not converged

The remaining design is a server-side arrival log merged into `thread/read`. The direction survives
review; **the mechanism does not.** Nine open findings, each naming a missing mechanism rather than a
wording fix:

1. **No durable ordering primitive.** `Session.readLoop` calls `onFrame` synchronously and neither
   awaits nor catches async rejection. Broadcasting before an async append permits a crash with a
   notification and no history; awaiting inside the listener lets later item, lifecycle and finalize
   events overtake the append. Needs a per-thread ordered persistence pipeline, or a justified bounded
   synchronous write-ahead append. Making the listener async is not a fix.
2. **Two-phase placement cannot locate a folded or unfinalized arrival.** A fold happens after the
   host turn has already emitted visible rows, so anchoring to that turn's first row places the
   arrival before output that preceded it; and `beginTurn` declines while the host turn is busy, so
   there is no adopted-turn settlement to finalize against. A `seq` orders entries against each other
   but gives no coordinate against ordinary transcript rows.
3. **The cursor snapshot does not freeze finalize or eviction.** A watermark excludes later appends
   but not rewrites of existing entries, so between two `limit:1` pages a sibling can move from
   unanchored to anchored, or be evicted. Needs a durable store revision (MVCC or versioned events)
   readable as of the cursor's revision.
4. **Rebase has no transaction boundary matching the real rewind.** The rewind path can reply success
   before `resumeDropsTurn` later rejects from the replacement engine. Rebasing on reply discards
   arrivals for a rewind the engine refuses; rebasing first has the inverse failure. A lease on our
   store cannot make the mutation atomic with a transcript we do not own.
5. **Concurrent writers do not form the claimed union.** Unique ids give a set, not a total order, and
   two engines resumed on one session can append separate branches while `getSessionMessages` returns
   one leaf-selected spine — so a losing-branch arrival has no anchor and no answer. Needs cross-process
   fencing or branch-aware history.
6. **`thread/clear` would erase arrivals from a still-resumable transcript.** Clear starts a fresh
   conversation and detaches the record; it does not delete the old transcript. Clearing a
   session-keyed log reproduces the original defect on a later resume of that old session.
7. **Search has no occurrence coordinate for a logged arrival.** Every occurrence must publish an
   integer raw row offset; a folded entry has no raw row, and a reader cursor of anchor plus `seq`
   cannot resume between multiple matches inside one arrival.
8. **The opaque cursor is an unversioned wire break.** `thread/read`'s published parameter is
   `^\d+:\d+$`; generated clients can reject a new cursor before sending it. Needs versioning or
   negotiation — and it contradicts this spec's own "ordinary history is byte-identical" criterion
   whenever pagination returns a cursor.
9. **The injectable store has no compatibility rule.** An embedder overriding `getSessionMessages`
   today supplies no arrival dependency: required, they break on upgrade; optional with a filesystem
   default, their custom transcript is merged with unrelated local arrivals — the exact mismatch
   injection was supposed to prevent.

### Two of these are the owner's call, not mine

- **Finding 8 — the wire break.** Merging arrivals into `thread/read` requires a cursor existing
  clients may reject. Accept a versioned break, negotiate a capability, or keep arrivals on a separate
  method and leave default history incomplete? This trades compatibility against the feature's whole
  point, which is that history is correct *by default*.
- **Finding 6 — clear semantics.** Should `thread/clear` erase a session's arrival history when the
  underlying transcript remains resumable? That is a product question about what "clear" promises.

## Acceptance

Stage A only; B–D's acceptance is deferred until their mechanism exists.

1. **No message a frame delivered is dropped.** For the collapsed row in M8m, the item carries both
   M2 and M3 rather than M2 alone.
2. **Every non-batched arrival is byte-identical to today** — 169 of the 170 measured rows.
3. **A quoted or forwarded envelope inside a body is not truncated**, and sibling envelopes are not
   merged with their tags.
4. **An envelope-less frame still resolves through `origin.body`.**
5. **The live item and its cold replay agree**, because one function serves both paths.

## Delegated unknowns

- **U1 — do envelope-less (coordinator-path) arrivals batch at all?** If never, Stage A's residual
  limit is empty in practice. Probe 121's machinery answers it for one run.
- **U2 — does `rowKind` change verdict on any widened row?** `sessions/rows.ts` asserts "The rows
  carry NO meta flags (probe 68b)" — true of its input, false of the rows on disk, and written as a
  fact about the rows. Correct the comment either way.

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
- **Stages B–D are not staged into implementation yet.** Rejected: planning them now. Nine findings
  name missing mechanism, and two need the owner's decision; a plan written over that would be
  fiction.
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
