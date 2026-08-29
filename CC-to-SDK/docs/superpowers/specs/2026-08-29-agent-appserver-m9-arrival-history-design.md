# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 3 · **Task:** #59 · **Depends on:** M8 (merged, `06bf3c0e44`)

## Why this exists

M8 gave the app-server cross-session messaging in both directions. A thread admitted with
`crossSessionInbound: "accept"` turns an arriving peer message into a fully visible turn: subscribers
get `thread/peerMessage` carrying the sender's identity, then the model's answer, then a terminal
state.

That is true only while you are watching. Call `thread/read` afterwards and the inbound message is
absent while the assistant's answer to it is present — **history shows an answer with no question.**

The purpose is not "un-filter a row". It is that **a thread's readable history should contain
everything the thread actually received**, so the record a client reads back matches the conversation
that happened — without the client having to know that cross-session messaging exists.

## Measurements

Against 1,076,891 rows in 7,131 real transcripts, plus one keyed probe. Where an earlier revision got
a number wrong, the correction stays visible — see `## Surprises & Discoveries`.

**M1 — the drop is unconditional and no SDK option reaches it.** `getSessionMessages` filters
`if (e.isMeta) return false`; `includeSystemMessages` gates only `type:"system"`. The projection is a
fixed field literal with no `origin`. **Byte-identical in 0.3.237 and 0.3.250** — the task #60 bump
did not close this, and there is no option to ask for.

**M2 — `origin` is a clean structural discriminator.** `isMeta` rows are 0.28% of all rows and split
with no overlap: those carrying an `origin` object are genuine inbound messages; those without are
CLI bookkeeping (caveats, skill injections, loop ticks, image placeholders, system reminders).

**M3 — in the corpus this reader opens, the hidden population is peer messages and nothing else.**

| corpus | files | rows | hidden `isMeta`+`origin` |
| --- | --- | --- | --- |
| **main** (what `getSessionMessages` reads) | 3,856 | 567,273 | **`peer` 69, `auto-continuation` 2** |
| `subagents/` (only `getSubagentMessages`) | 3,281 | 511,923 | `coordinator` 573, `task-notification` 94, `peer` 61, `human` 6 |

Every subagent row is `isSidechain`. Coordinator history is unreachable through this reader.

**M4 — two provenances, one verified.** 112 rows carry `{body, from, kind, name, senderTaskId}`; 18
carry `verifiedPeerPid`. Only `verifiedPeerPid` is kernel-vouched; `from` is sender-authored and
forgeable by any same-user process.

**M5 — the engine's transcript is not a safe graph to splice.** Main transcripts hold 1,562 duplicate
uuid occurrences (31 disagreeing on `parentUuid`) and 335 dangling `parentUuid` references.

**M6 — the SDK's read window is post-compaction only**, for every message type.

**M7 — a folded arrival persists nothing.** No row of any kind, against a positive control.

**M8m — a batched arrival's own text survives per frame, in the field we do not read.** Probe 121
(`probes/121-batch-arrival-attribution.ts`), keyed, CLI 2.1.250, three messages into two turns:

```
LIVE      origin.msg_id    distinct 2/3   nonces recoverable 0/3
LIVE      origin.body      distinct 2/3   nonces recoverable 2/3
LIVE      message.content  distinct 3/3   nonces recoverable 3/3
PERSISTED message.content  distinct 3/3   nonces recoverable 3/3
```

`origin.body` and `origin.msg_id` repeat the CAUSING message's values across a batch; each frame's own
`message.content` carries its own message. **`peerArrival` prefers `origin.body`, so it returns the
wrong text for a batch's other members — a shipped, live defect, not merely a history problem.**

**M9m — swapping that preference is safe where an envelope exists.** Across 170 peer rows in 107
files: all 170 carry `origin.body`; 20 carry a parsable envelope; where both exist they are
**identical in all 20**; 150 carry no envelope and still need the `origin.body` fallback.

## Design

### Shape

The server persists its own record of the arrivals it handled and merges that record into
`thread/read`. It does not read, re-order, or trust the engine's transcript beyond what
`srv.deps.getSessionMessages` already returns.

```
live:   engine frame ─► peerArrival ─► arrival log APPEND (seq, uuid, text, origin)   [linearization point]
                                   └─► thread/peerMessage broadcast
        turn settles  ─────────────► arrival log FINALIZE (anchor = the turn's first visible row)

read:   srv.deps.getSessionMessages()  ─┐
                                        ├─► merge, one snapshot ─► itemsFromTranscript ─► items
        arrival store, same snapshot   ─┘
```

`items/replay.ts`'s `peerArrival` branch — correct and unfed since it landed — renders a merged
arrival, so a replayed item is produced by the **same rule** as its live twin and carries the same id.
That is what makes a client dedupe rather than double-render.

### Why a log and not a transcript read

Rev 1 spliced dropped rows back into the SDK reader's output using raw `parentUuid` links. Six review
findings killed it, all confirmed against the corpus. They shared one root: **reading a file another
process owns and re-deriving that process's private ordering from it.** The log has no such root, and
is additionally the only approach that can serve a folded arrival (M7).

### The batch defect is fixed at its source, not designed around

M8m is upstream of any history feature: today's live announcement is already wrong for a batch's
non-causing members. `peerArrival` changes to prefer the frame's own envelope (per-frame by
construction; identical to `origin.body` in all 20 measured cases where both exist), falling back to
`origin.body` for the 150 envelope-less rows. That ships as **Stage A**, independently of everything
below, because it is a correctness fix to shipped behaviour.

Residual and stated plainly: **an envelope-less arrival that batches has no per-message text
anywhere.** `peerArrival` is pure and per-frame and cannot detect that from one frame. It keeps
returning `origin.body`; the limit is documented rather than guessed at.

### History lineage is its own generation, not `record.epoch`

`record.epoch` cannot represent history lineage, verified in the code: `Registry.mint()` starts every
admission at zero, `rewind.ts:210` and `fleet.ts:306` bump it, and `thread/reopen` bumps it while
preserving the conversation. Equality-scoping a durable log to it is wrong in both directions — a
rewind would erase arrivals that survived it, a reopen would orphan the lot, and a restart would alias
a fresh epoch zero against stale zero entries.

So the store carries a **persisted `historyGeneration`**, distinct from `record.epoch`:

- `thread/clear` → a new, empty generation.
- **rewind** → transactional rebase: entries whose anchor survives the truncation are carried forward,
  the rest dropped. A partial rewind therefore has a coherent answer, which epoch equality did not
  give it.
- `thread/reopen` / engine swap → generation preserved (epoch moves, lineage does not).
- restart / re-admission → generation reloaded from the store, never reset.

### The store is a contract, keyed by session

A thread id is `"thr_" + randomBytes(6)` in an in-memory `Map` (verified) — minted per admission and
useless as a durable key. The durable key is `sessionId`.

`AppServerDeps` gains an injectable `ArrivalStore`: `append`, `finalize`, `read`, `rebase`, `clear`,
`forkFrom`, `delete`. Injectable for the same reason `getSessionMessages` is: an embedder pointing at
its own session store must be able to point this at the same place, and a filesystem default behind
an overridden reader would hand that embedder foreign history.

Lifecycle mutations move with their session: `thread/fork` copies the prefix up to the fork point (a
fork with answers and no inherited questions is the same defect one level down); `thread/delete`
removes the log rather than orphaning it.

**Concurrency:** a second app-server process serving the same session is a state the admission code
cannot see today. The store is therefore **append-only with globally unique entry ids**, which makes
two writers' concurrent appends a union rather than a conflict. Rebase and clear are the mutating
operations and need an exclusive lease; that lease, not a general lock, is the scope.

### Position: a sequence at append, an anchor at settle

The anchor cannot be recorded at append time — the visible row an arrival precedes is a future event,
and a folded or terminal-tail arrival may never produce one. So placement is **two-phase**:

- **append** (arrival): a monotonic `seq`, the arrival uuid, the resolved text, the origin, and a null
  anchor.
- **finalize** (turn settle): the anchor — the first visible row of the turn the arrival caused or
  folded into — written idempotently by entry id.

At read time an entry is placed before its anchor; several entries sharing one anchor order among
themselves by `seq`; an entry never finalized (a crash between the two phases, or a turn that never
settled) is placed by `seq` relative to its neighbours and never silently dropped.

### The cursor is one canonical space

`thread/read` pages by `<epoch>:<rawRowOffset>` and feeds that offset straight to
`getSessionMessages`; `thread/searchOccurrences` publishes a `readCursor` computed in that same
unmerged space. Merging rows into read without changing the cursor is a deterministic break, not a
deferrable unknown: with `[prompt, arrival, assistantHit]` search emits an offset the merged read
resolves to the arrival, and the hit is missed.

So `thread/read`'s cursor becomes **opaque**, carrying the reader-spine boundary, the per-anchor
arrival `seq`, the log watermark, and the `historyGeneration`. Search composes and resolves through
the same helper, so the two cannot diverge. A per-anchor `seq` is what makes `limit: 1` across a
batch's siblings terminate correctly, where a bare row uuid would repeat or skip.

### One snapshot per read

Both sources are independently mutable. `thread/read` takes one snapshot —
`{recordId, sessionId, epoch, historyGeneration, logWatermark}` — reads both against it, and rechecks
after every await, answering the existing invalidated-cursor error on drift rather than shipping a
page that mixes generations. `search.ts` already does exactly this for its own windows (one epoch read
per request, generation re-derived per window); this follows that precedent rather than inventing one.

### Resource bounds

Arrival text is attacker-influenced and the live path already caps its queue at 32 with an announced
drop. The durable log inherits bounds of the same kind: `MAX_FRAME_CHARS` per entry, a per-session
retained count and byte quota, oldest-first eviction that is announced rather than silent, and reads
that page rather than loading the whole log.

### The trust claim, narrowed

An earlier revision claimed the log creates a trust boundary against a same-user attacker. **That was
an overclaim and is withdrawn.** A process that can write the engine's transcript can equally write an
ordinary sidecar; "only this server writes it" is a convention, not an enforcement.

What the log actually buys is narrower and still worth having: the server renders a field **it wrote
itself from the frame it saw**, so `thread/read` and `thread/peerMessage` cannot disagree, and
accidental contamination — a transcript row the engine wrote for other purposes being read as a user's
question — is structurally impossible. Real integrity against a same-user attacker needs authenticated
storage whose key is outside that attacker's reach, and is out of scope. Stated, not implied.

### Search

A message visible in history that cannot be found by searching its own text is a bug users will hit,
so logged arrivals join the searchable corpus, bound to the same generation and ordering as the read
path. This is **Stage D** and is the one piece a reader could argue for deferring.

## Staging

Each stage is independently valuable and independently reviewable.

- **Stage A — the batch text fix.** `peerArrival` prefers the frame's own envelope. Fixes shipped
  live behaviour; depends on nothing here. *(In flight.)*
- **Stage B — the store.** `ArrivalStore` on `AppServerDeps`, two-phase append/finalize, the
  `historyGeneration`, lifecycle (clear, rebase, fork, delete), bounds. No read-side change: nothing
  user-visible ships, and the stage is verifiable on its own terms — the log is correct and durable.
- **Stage C — the merged read.** The opaque cursor, the snapshot, the merge, the shared resolver with
  search. This is where `thread/read` changes and where the acceptance below is met.
- **Stage D — search.** Logged arrivals in the searchable corpus.

## Acceptance

Observable behaviour. Keyed legs run against a real engine.

1. **A peer message answered by a thread appears in that thread's history**, before the assistant's
   answer, carrying the sender's own text and not the CLI's envelope preamble.
2. **The replayed item and the live item are one item** — the id equals the announced `arrivalUuid`,
   so a client that dedupes by id renders it once.
3. **Each member of a BATCH carries its own text**, live and in history (the M8m defect, asserted
   rather than described).
4. **A folded arrival has history too** — the case no transcript reader can serve.
5. **Ordinary history is unchanged** — byte-identical for a thread that never received a peer message.
6. **Paging and search jumps stay consistent**: a `readCursor` from `thread/searchOccurrences` lands
   on the row it names with an arrival on either side of the boundary; a full paged walk at `limit: 1`
   across a batch's siblings returns every row exactly once.
7. **A rewind past an arrival removes it from history; a rewind after it keeps it** — the case epoch
   equality could not express.
8. **`thread/clear` drops the thread's arrival history with the rest of it**; `thread/fork` inherits
   the prefix; `thread/delete` leaves no orphan log.
9. **A read that races a rewind fails its cursor rather than mixing generations.**
10. **An append failure is observable** — never a live notification with silently absent history.
11. **The M8 live legs that assert the gap go red and are rewritten**, not weakened.

## Delegated unknowns

- **U1 — where the default store lives.** Restart survival, per-session keying, and read cost at
  realistic history sizes are measurable; the shape is a Stage B decision made against those numbers.
- **U2 — anchor outside the window.** An anchor row can fall outside the SDK's post-compaction window
  (M6). Whether such an entry is dropped with its anchor or surfaces at the window's head is decided
  by measurement in Stage C.
- **U3 — does `rowKind` change verdict on any merged row?** `sessions/rows.ts` opens by asserting "The
  rows carry NO meta flags (probe 68b)" — true of its input, false of the rows on disk, and written as
  a fact about the rows. Confirm and correct that comment either way.
- **U4 — do envelope-less (coordinator-path) arrivals batch at all?** If they never do, M8m's residual
  limit is empty in practice. Probe 121's machinery answers this for the cost of one run.

## Decision Log

- **The server logs arrivals; it does not reconstruct them from the engine's transcript.** Rejected:
  rev 1's splice. Six confirmed findings sharing one root (M5, M3, the cursor namespace, the embedder
  seam, the trust boundary). The log also serves folded arrivals, which no transcript reader can.
- **The batch defect is fixed in `peerArrival`, not compensated for in the log.** Rejected: logging
  ambiguous batch entries and marking them. Probe 121 showed the correct text is present per frame, so
  marking it unknown would discard information we hold — and would leave the shipped live path wrong.
- **Merge into `thread/read` rather than expose a separate `thread/arrivals`.** The separate endpoint
  is genuinely simpler: no cursor change, no search change, no merge race. Rejected because it makes
  correct history opt-in — every client must learn about peer messaging to get a history that is not
  misleading, and the default stays wrong. The cost is Stage C's cursor work, taken deliberately.
- **`historyGeneration` is separate from `record.epoch`.** Rejected: epoch equality. Verified wrong in
  both directions against `registry.ts`, `rewind.ts:210`, `fleet.ts:306`.
- **The store is keyed by `sessionId` and injectable.** Rejected: a thread-keyed sidecar (thread ids
  are minted per admission) and a hardcoded filesystem path (it bypasses the embedder's session store).
- **Append is the linearization point, before the broadcast, and never throws into the frame
  listener.** `Session.readLoop` swallows listener exceptions, so a throwing append would silently
  suppress the announcement without stopping the engine. The engine runs the turn whatever we do, so
  the broadcast always goes out and an append failure surfaces as an observable warning.
- **Append-only with unique entry ids; a lease only for rebase and clear.** Rejected: a general
  exclusive-writer lock. Concurrent appends from two processes are a union, which is the correct
  answer; only the mutating operations genuinely conflict.
- **The trust claim is withdrawn, not defended.** Rejected: validating persisted `origin` against a
  schema and calling it trusted — validation shrinks the forgery surface without closing it.
- **Scope is peer arrivals.** M3 answers the question rev 1 left open: the other origin kinds are
  subagent history this reader never opens.

## Surprises & Discoveries

- **Probe 121 found a shipped bug while answering a design question.** It was written to decide
  whether a batched arrival's text is recoverable from disk. It answered that (yes, from the frame's
  own content) and in doing so showed the LIVE path is already wrong — `thread/peerMessage` announces
  one message's text under another's id today. The design question was downstream of a defect nobody
  had looked for.
- **LEG 5's own finding was half right.** It pinned "N arrivals, ONE `msg_id`, ONE `body`" and
  attributed the loss to the engine. True of `origin.*`; false of the frame's content, which it did
  not examine. An assertion that pins the wrong field passes for the wrong reason.
- **Rev 1's central population number was wrong, and the refuting data was already in hand.** It
  counted five origin kinds across a corpus mixing main and subagent transcripts. Its own splice script
  had already excluded `subagents/` and printed a peer count that disagreed with its census; the
  discrepancy was not chased.
- **45 of 70 arrivals appearing unreachable was compaction**, shared with every message type — one
  concrete example refuted a conclusion a whole session's reasoning had accepted.
- **An SDK bump is an engine change.** Task #60 moved the bundled CLI 2.1.237 → 2.1.250 and a
  cross-session contract moved with it: a send into a `refuse` thread, previously silent, now returns
  an `expired` receipt with a reason. Established by controlled experiment. The refusal is still
  enforced; only the sender's visibility improved.
- **Two designs died before one survived.** Both were internally coherent and both were broken by an
  adversarial reader in one pass. The cost of each was a day of measurement; the cost of shipping
  either would have been a wrong history nobody could see was wrong.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-29)** — transcript splice, from measurement rather than from the M8 spec's prose.
- **rev 2 (2026-08-29)** — pivot to a server-side arrival log after six confirmed findings against the
  splice.
- **rev 3 (2026-08-30)** — eight findings against rev 2, three verified independently in the code
  (epoch is not lineage; thread ids are not durable; the batch defect is real and pinned by our own
  live test). Probe 121 resolves the severest one upstream rather than in the design: the per-message
  text exists, `peerArrival` reads the wrong field, and that is now Stage A. The rest of rev 2's gaps
  are closed rather than deferred — a persisted `historyGeneration`, an injectable session-keyed
  store, two-phase append/finalize, an opaque cursor shared with search, one snapshot per read, real
  bounds — and the overclaimed trust boundary is withdrawn. Work is staged A–D so each piece is
  independently valuable.
