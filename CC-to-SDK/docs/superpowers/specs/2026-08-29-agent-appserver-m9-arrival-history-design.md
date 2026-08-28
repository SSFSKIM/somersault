# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 2 · **Task:** #59 · **Depends on:** M8 (merged, `06bf3c0e44`)

## Why this exists

M8 gave the app-server cross-session messaging in both directions. A thread admitted with
`crossSessionInbound: "accept"` turns an arriving peer message into a fully visible turn: subscribers
get `thread/peerMessage` carrying the sender's identity, then the model's answer through the ordinary
mapper, then a terminal state.

That is true only while you are watching. Call `thread/read` afterwards and the inbound message is
absent while the assistant's answer to it is present — **history shows an answer with no question.**
A client that reconnects, or that renders a thread it did not subscribe to, cannot reconstruct why
the model said what it said.

The purpose is not "un-filter a row". It is that **a thread's readable history should contain
everything the thread actually received**, so the record a client reads back matches the conversation
that happened.

## The measurements this design stands on

Measured against 1,076,891 rows across 7,131 real transcripts. Where rev 1 got a number wrong, the
correction is kept in place rather than quietly replaced — see `## Surprises & Discoveries`.

**M1 — the drop is unconditional and no SDK option reaches it.** `getSessionMessages` filters with
`if (e.isMeta) return false` after routing on type; `includeSystemMessages` gates only
`type: "system"` and never reaches `isMeta`. The projection that follows is a fixed field literal
with no `origin`. **Byte-identical in 0.3.237 and 0.3.250**, checked against both bundles — the
task #60 bump does not close this and there is no option to ask for.

**M2 — `origin` is a clean structural discriminator.** `isMeta` rows are 0.28% of all rows. They
split with no overlap: those carrying an `origin` object are genuine inbound messages; those without
are CLI bookkeeping (local-command caveats, skill injections, loop ticks, image placeholders, system
reminders). So the blanket drop exists for a real reason, and `origin` — not text matching — is the
discriminator. M8 removed a text-recognition rule from this codebase after counting showed it never
fired correctly; this design does not reintroduce that pattern.

**M3 — in the corpus this reader actually opens, the hidden population is peer messages and nothing
else.** Separating main transcripts from `subagents/`:

| corpus | files | rows | hidden `isMeta`+`origin` rows |
| --- | --- | --- | --- |
| **main** (what `getSessionMessages` reads) | 3,856 | 567,273 | **`peer` 69, `auto-continuation` 2** |
| `subagents/` (read only by `getSubagentMessages`) | 3,281 | 511,923 | `coordinator` 573, `task-notification` 94, `peer` 61, `human` 6 |

Every subagent row is `isSidechain` (511,876 of 511,923). **Coordinator history is not reachable
through this reader at all**, so rev 1's proposal to surface non-peer origin rows addressed a
population that does not exist in scope. The in-scope gap is peer messages.

**M4 — peer rows carry two provenances, and only one is verified.** 112 rows carry
`{body, from, kind, name, senderTaskId}` (the coordinator SendMessage path); 18 carry
`verifiedPeerPid` and `fromMode` (the M8 gateway path). `verifiedPeerPid` is the only field the
kernel vouches for; `from` is sender-authored and forgeable by any same-user process.

**M5 — the transcript is not a safe source to splice.** In main transcripts: **1,562 duplicate uuid
occurrences** across 2 files, **31 of which disagree with the first occurrence on `parentUuid`**, and
**335 dangling `parentUuid` references** naming rows absent from the file. A uuid-keyed map over raw
rows is therefore last-write-wins over an ambiguous graph, in cases that occur in the wild.

**M6 — the SDK's read window is post-compaction only.** In the largest transcript examined the last
compaction summary is at line 18,064 and the SDK's first returned row is line 18,063. This applies to
every message type, ordinary user prompts included; it is the SDK's window, not our gap.

**M7 — a folded arrival persists nothing.** No row of any kind, measured against a positive control
on the same transcript. No reader of the engine's transcript can recover it.

## Design

### The pivot, stated plainly

Rev 1 proposed recovering arrivals from the engine's transcript: use the SDK reader's output as an
ordering spine and splice back the rows it dropped, using raw `parentUuid` links. An adversarial
review broke that approach in six independent places, and checking its claims against the corpus
confirmed them. The approach is abandoned. **This server persists its own record of the arrivals it
handled, and merges that record into `thread/read`.**

The reasoning is not that the splice was unfixable — it is that every one of its problems came from
the same root, and the alternative does not have that root. The splice reads a file **another process
owns and writes**, and then tries to reconstruct **that process's private ordering decisions** from
it. Hence: two unsynchronised reads that can straddle a rewind; a graph with duplicate and dangling
nodes we must mirror the engine's normalisation of; and attribution metadata any same-user process
can forge, rendered as a user's words. The arrival log has none of those because the server writes
what it already saw, on the live path, from the engine's own frame.

It is also strictly more capable: it is the only approach that can give a **folded** arrival any
history at all (M7), which is the gap M8 called its largest.

### Shape

On the live path, `peerInbound.ts` already recognises an arrival, mints its id, and broadcasts
`thread/peerMessage`. It gains one more step: append the arrival to a durable per-thread **arrival
log** — the id it announced, the text `peerArrival` resolved, the origin as received, and the epoch
it belongs to.

`thread/read` composes: the SDK reader's output, unchanged and still through
`srv.deps.getSessionMessages`, merged with this thread's logged arrivals.

```
live:   engine frame ──► peerArrival ──► thread/peerMessage broadcast
                                    └──► arrival log  (append: id, text, origin, epoch, position)

read:   srv.deps.getSessionMessages()  ─┐
                                        ├─► merge by position ──► itemsFromTranscript ──► items
        arrival log for this thread    ─┘
```

The `peerArrival` branch in `items/replay.ts` — correct, tested, and unfed since it landed — is what
renders a merged arrival, so the replayed item is produced by the **same rule** as the live one and
carries the same id. That is what makes a client dedupe them rather than double-render, and it is
preserved from rev 1 because it was the one part of that design nothing attacked.

### Why the record is trustworthy, where the transcript was not

The log is written by this server, on the live path, from the frame the engine handed it — the same
frame `thread/peerMessage` is built from. Nothing else writes it. So `thread/read` and
`thread/peerMessage` report the same thing by construction, and a same-user process that can write
files cannot inject a forged "user question" into a thread's rendered history. Persisted `origin` in
the engine's transcript stays what it is: another process's unauthenticated assertion, which this
design no longer reads.

`verifiedPeerPid` is logged when the arrival carried one and omitted when it did not (M4). A replayed
item asserts exactly what its arrival asserted, and manufactures nothing to look uniform.

### Position, and the coordinate system

This is the design's hardest remaining problem, and rev 1 wrongly deferred it as an unknown. It is a
deterministic contract question that must be settled **before** implementation:

`thread/read` pages by row offset within an epoch, and `thread/searchOccurrences` publishes a
`readCursor` built from a *filtered* row offset for direct use by `thread/read`. If read merges rows
that search does not, the two coordinate systems diverge and a search jump lands on the wrong row.

So the merge defines **one canonical coordinate space**, and every producer of a `thread/read` cursor
uses it. An arrival is logged with the anchor it precedes — durable and uuid-based, never a numeric
offset, because offsets are exactly what shifts. Paging and search-jump translation both resolve
through that anchor.

### Epoch, rewind, and clear

The log is epoch-scoped. `thread/clear` bumps the epoch and the log's earlier entries stop
participating; a rewind that invalidates outstanding cursors invalidates the log's view the same way.
This is the one place the arrival log takes on a consistency obligation the splice did not have, and
it is a tractable one: it reuses the epoch mechanism `thread/read` already relies on, rather than
inventing a second notion of "which history is current".

### What this does not fix

- **Arrivals this server never handled** — a thread's history from before this feature, or handled by
  a different process, has no log entries. Those arrivals were never visible to this server's clients
  either, so the boundary is honest rather than convenient: the server reports what it received.
- **Pre-compaction history** stays outside the read window (M6), as it does for every message type.
- **Coordinator and task-notification history** is subagent history (M3), reachable only through
  `getSubagentMessages`. Out of scope, and named so it is not rediscovered.

## Acceptance

Phrased as observable behaviour. Keyed legs run against a real engine.

1. **A peer message answered by a thread appears in that thread's history.** Send to an accepting
   thread, let the turn complete, call `thread/read`: the arrival is present, before the assistant's
   answer, carrying the sender's text — not the CLI's envelope preamble.
2. **The replayed item and the live item are one item.** The id `thread/read` returns equals the
   `arrivalUuid` `thread/peerMessage` announced, so a client that dedupes by id renders it once.
3. **A folded arrival has history too** — the case no transcript reader can serve (M7).
4. **Ordinary history is unchanged.** For a thread that never received a peer message, `thread/read`
   is byte-identical before and after.
5. **Paging and search jumps stay consistent.** A `readCursor` from `thread/searchOccurrences` lands
   on the row it names, with an arrival on either side of the boundary; a full paged walk returns
   every row exactly once, with no gap or repeat.
6. **A refused or held arrival produces no history**, because it produced no turn.
7. **`thread/clear` drops the thread's arrival history with the rest of it.**
8. **A forged `origin` on disk changes nothing.** Writing a row with a fabricated peer `origin` into
   a thread's transcript does not make it appear in `thread/read`.
9. **The M8 live legs that assert the gap go red and are rewritten**, not weakened — their reddening
   is the signal this landed.

## Delegated unknowns

Empirical, to be closed during implementation:

- **U1 — where the log lives.** It must survive process restart, be per-thread, and be cheap to read
  on every `thread/read`. Whether that is a sidecar file beside the transcript, a row in an existing
  store, or in-memory with a durable backing is an implementation question with a measurable answer
  (restart survival, read cost at realistic history sizes).
- **U2 — anchor resolution when the anchor is gone.** An arrival's anchor row can fall outside the
  SDK's post-compaction window (M6). Decide, by measurement, whether such an arrival is dropped with
  its anchor or surfaces at the window's head.
- **U3 — does `rowKind` change verdict on any merged row?** `sessions/rows.ts` opens by asserting
  "The rows carry NO meta flags (probe 68b)". True of its input, false of the rows on disk, and
  written as though it were a fact about the rows. Confirm no classifier branch changes, and correct
  that comment either way.

## Decision Log

- **The server logs arrivals; it does not reconstruct them from the engine's transcript.** Rejected:
  the rev 1 splice. Six independent review findings, all confirmed against the corpus: unsynchronised
  two-source reads that can straddle a rewind; raw parent links that are not the graph the SDK orders
  (M5 — 1,562 duplicate uuids, 31 disagreeing on parent, 335 dangling refs); a cursor namespace
  incompatible with search's published `readCursor`; a target population that is subagent history
  (M3); forgeable `origin` rendered as a user's words; and a bypass of the public
  `AppServerDeps.getSessionMessages` seam that embedders override. The alternative removes the root
  those share and additionally serves folded arrivals.
- **`thread/read` keeps calling `srv.deps.getSessionMessages`.** Rejected: a filesystem reader behind
  the dep. That dep is the documented seam an embedder overrides to point at its own session store;
  bypassing it hands such an embedder empty or foreign history from the local disk.
- **Scope is peer arrivals.** Rejected: rev 1's proposal to surface every origin-bearing row. M3
  shows that population is subagent history this reader never opens — the call rev 1 flagged as its
  most arguable was answered by measurement rather than argument.
- **Anchors are uuid-based, never numeric offsets.** Rejected: recording an insertion index. Offsets
  are precisely what merging shifts, and search publishes a cursor computed in the unmerged space.
- **Persisted `origin` is untrusted and unread.** Rejected: validating it and rendering it when it
  looks well-formed. Validation reduces the forgery surface; it does not remove it, and there is no
  need to accept any of it once the server has its own record.
- **A folded arrival is logged, not synthesised from nothing.** Its log entry records a real event the
  server observed. Still rejected: minting a placeholder for an arrival the server never saw.

## Surprises & Discoveries

- **Rev 1's central population number was wrong, and the refuting data was already in hand.** It
  reported a hidden population spanning five origin kinds and recommended surfacing all of them. Once
  main transcripts were separated from `subagents/`, the in-scope population was `peer` 69 and
  `auto-continuation` 2 — and rev 1's own splice script had already excluded `subagents/`, printing a
  peer count of 68 against a census of 130 without that discrepancy being chased. The aggregate was
  read; the disagreement between two of my own numbers was not.
- **A number stated in-round and disproved in-round.** Rev 1 claimed the gap was "six times larger
  than the task says". Breaking the aggregate down per kind disproved it the same day. Recorded
  rather than dropped.
- **45 of 70 arrivals appearing unreachable looked like a coverage ceiling and was compaction** —
  shared with every message type. One concrete example refuted a conclusion that a working session's
  reasoning had already accepted.
- **The review found more than it was asked to.** It was pointed at the splice, cursors, and the
  trust boundary; it also found that the target population was subagent history and that the design
  bypassed a public embedder seam. Two of six findings were outside the questions posed, which is the
  argument for adversarial review over a checklist.
- **An SDK bump is an engine change.** During this round, task #60's bump moved the bundled CLI from
  2.1.237 to 2.1.250 (each SDK package's `manifest.json` names its CLI), and a cross-session contract
  changed with it: a `peer/send` into a `refuse` thread, previously silent, now returns a
  `peer/messageStatus` of `expired` with an explicit reason. Established by controlled experiment —
  the same single leg passes on 0.3.237 and fails on 0.3.250, minutes apart on one machine. The
  refusal is still enforced (no turn, no items); only the sender's visibility improved.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-29)** — first draft, from measurement rather than from the M8 spec's prose about
  this reader.
- **rev 2 (2026-08-29)** — design pivot after adversarial review. Six findings, all confirmed against
  the corpus; two refuted rev 1's own claims. Transcript splicing is abandoned for a server-side
  arrival log: it removes the shared root of every finding (reading and re-deriving another process's
  private ordering from a file it owns), keeps `thread/read` on the public reader seam, and is the
  only approach that can serve a folded arrival. Scope narrowed from all origin kinds to peer
  arrivals on the evidence of M3. The cursor question moved from a delegated unknown to a settled
  part of the design, because it is a deterministic contract break rather than something to discover.
