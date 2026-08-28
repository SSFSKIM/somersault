# M9 — arrival history: making an inbound peer message survive into `thread/read`

**Status:** design, rev 1 · **Task:** #59 · **Depends on:** M8 (merged, `06bf3c0e44`)

## Why this exists

M8 gave the app-server cross-session messaging in both directions. A thread admitted with
`crossSessionInbound: "accept"` turns an arriving peer message into a fully visible turn: subscribers
get `thread/peerMessage` carrying the sender's identity, then the model's answer through the ordinary
mapper, then a terminal state.

That is true only while you are watching. Call `thread/read` afterwards and the inbound message is
absent while the assistant's answer to it is present — **history shows an answer with no question.**
A client that reconnects, or that renders a thread it did not subscribe to, cannot reconstruct why
the model said what it said.

This is the largest outstanding gap M8 shipped with, and it was written down rather than smoothed
over. This spec closes it.

The purpose is not "un-filter a row". It is that **a thread's readable history should contain
everything the thread actually received**, whoever sent it, so that the record a client reads back
matches the conversation that happened.

## What is measured, and what it cost to learn

Every claim in this section was measured against real transcripts during this design round
(1,076,891 rows across 7,131 files under `~/.claude/projects`). None of it is inference. That
discipline is deliberate: M8's retrospective records that this exact component was reasoned about
rather than re-read, and the resulting false premise survived five spec revisions and produced two
tasks of correct code that cannot run.

**M1 — the drop is unconditional, and no SDK option reaches it.** `getSessionMessages` filters with

```js
if (e.type === "user" || e.type === "assistant") ; else if (e.type === "system" && t) ; else return false;
if (e.isMeta) return false; if (e.isSidechain) return false; if (e.teamName) return false; return true;
```

`includeSystemMessages` (the `t` above) gates only `type: "system"`; it does not reach `isMeta`. The
projection that follows is a fixed field literal — `type, uuid, session_id, message,
parent_tool_use_id, parent_agent_id, timestamp` — so `origin` cannot survive even for rows that pass.
**This is byte-identical in 0.3.237 and 0.3.250**, checked directly against both bundles, so the SDK
bump in task #60 does not close this and there is no option to ask for.

**M2 — `origin` is the discriminator, and it is clean.** `isMeta` rows are 0.28% of all rows (2,962).
They separate on one structural field with no overlap:

| carries an `origin` object | 800 | genuine inbound messages |
| no `origin` | 2,160 | CLI bookkeeping |

The bookkeeping side is entirely local-command caveats (632), skill injections (665), autonomous-loop
ticks (91), "Continue from where you left off." (54), image placeholders, and system reminders —
nothing a user sent. **So the blanket drop exists for a real reason, and `origin` is a better rule
than "peer": it is structural, it is what the CLI itself stamps, and it needs no text matching.**
M8 already removed one text-recognition rule from this codebase after counting showed it never fired
correctly; this design does not reintroduce the pattern.

**M3 — only peer origins carry a payload.** Broken out by kind:

| kind | rows | of those `isMeta` | keys on `origin` |
| --- | --- | --- | --- |
| `task-notification` | 4,578 | 94 | `kind` only |
| `human` | 2,520 | 6 | `kind` only |
| `coordinator` | 571 | **571** | `kind` only |
| `peer` | 130 | **130** | `kind, from, name, body`, + `senderTaskId` (112) / `verifiedPeerPid` (18) |
| `auto-continuation` | 2 | 2 | `kind` only |

Two things follow, and the second corrected an error made earlier in this round. First, `peer` is the
only kind carrying the sender-authored `body`, so it is the only kind that can be rendered from
anything but raw persisted content. Second, **the gap is not "every origin-bearing message"** — an
early read of the aggregate suggested it was six times larger than task #59 states. It is not:
`task-notification` and `human` rows are overwhelmingly *not* `isMeta` and were never hidden. The
genuinely hidden populations are `peer` (130) and `coordinator` (571).

**M4 — peer rows come in two populations, and only one has verified identity.**

- 112 rows / 26 files: `{body, from, kind, name, senderTaskId}` — the coordinator SendMessage path.
- 18 rows: `{body, from, fromMode, kind, name, verifiedPeerPid, …}` — the M8 gateway path.

`peerArrival` accepts both (it requires only `origin.kind === "peer"`). `verifiedPeerPid` is the only
field the kernel vouches for; `from` is sender-authored and forgeable by any same-user process. A
replayed item must therefore **not** assert verified identity that its row does not carry.

**M5 — the splice is exact, and needs none of the SDK's chain logic.** Using the SDK's own output as
the ordering spine and walking raw `parentUuid` links to re-insert dropped rows: **25 of 25** on-chain
arrivals placed exactly, zero unplaced, across 29 transcripts. Leaf selection, tree resolution and
compaction handling all stay with the SDK.

**M6 — the "missing" 45 are pre-compaction, not a splice failure.** 45 of 70 arrivals sat off the
selected chain. That looked like a 36% coverage ceiling. It is not: in the largest case the last
compaction summary is at line 18,064 and the SDK's first returned row is line 18,063. The reader
returns the post-compaction window only — for *every* message type, ordinary user prompts included.
Our own `tui/rewindRebuild.ts` already documents this. **The splice recovers 100% of the arrivals
inside the window `thread/read` actually returns.**

## Design

### The shape

One new reader, used by one caller. `thread/read` (in `appserver/subscribe.ts`) stops calling the
shared reader and calls an **arrival-preserving reader** that returns the SDK's rows with two
additions: dropped origin-bearing rows spliced back into position, and `origin` preserved on every
row that has one. `itemsFromTranscript` then runs unchanged, and the `peerArrival` branch that Tasks
10c/10d already wrote — correct, tested, and unfed since the day it landed — starts receiving rows.

```
thread/read ──► arrivalReader(sessionId)                    [new]
                  ├─ sdkGetSessionMessages()   the spine: chain, leaf, compaction window
                  ├─ raw JSONL by uuid         recovers origin + the dropped rows
                  └─ splice by parentUuid      M5: exact, 25/25
                            │
                            ▼
                itemsFromTranscript()  ──► peerArrival branch  [already correct]
```

### Why a dedicated reader and not the shared dep

`srv.deps.getSessionMessages` is also consumed by `appserver/search.ts` and `appserver/rewind.ts`.
Widening it would change both, and one of those changes is dangerous:

- **`rewind.ts`** builds anchors with `rewindAnchorsFrom`, which selects rows where
  `rowKind(m) === "prompt"` and records a positional `index`. A peer arrival row is `type: "user"`,
  has a uuid, and carries no `tool_result` — so it classifies as `"prompt"`. Widening the shared
  reader would silently turn every peer arrival into a rewind anchor **and shift the index of every
  anchor after it.** That is a behaviour change to rewind that nobody asked for, arriving as a side
  effect of a read fix.
- **`search.ts`** would begin matching arrival text. Defensible, but it is a product decision about
  what search covers, and it should be made deliberately rather than inherited.

So the widening is scoped to the one caller whose contract is "show me this thread's history".
Whether rewind and search should follow is a genuine question, deferred rather than answered by
accident.

### What each origin kind renders as

- **`peer`** — through `peerArrival`, exactly as today's live path does. Same rule, same id, same
  text, which is what makes the live item and the replayed item deduplicate by id rather than
  double-render. This is the case the whole design exists for.
- **every other kind** — through the existing content path, becoming an ordinary `userMessage`.
  They carry no `body`, so there is nothing to unwrap; their text is the persisted content including
  whatever framing the CLI wrote around it.

The recommendation is that non-peer origin rows **do** surface, on the grounds that a message the
session actually received is better rendered with CLI framing than omitted entirely — 571 coordinator
messages are invisible today. This is the design's most arguable call and is flagged for review.

### Identity, and what a replayed item may claim

`thread/peerMessage` forwards `origin` verbatim, deliberately, because re-deriving it would replace a
kernel-verified fact with this server's opinion. The replayed path inherits that rule unchanged: it
forwards what the row carries and asserts nothing it does not. Per M4, most peer rows have no
`verifiedPeerPid`, so any consumer treating presence as guaranteed is wrong — and a replayed item
must not manufacture one to look uniform.

### What this design does not fix, stated plainly

- **A folded arrival persists nothing** — no row of any kind, measured against a positive control on
  the same transcript. No reader can recover what was never written. `thread/peerMessage` remains its
  only record, which makes that announcement load-bearing rather than a convenience. Giving folded
  arrivals durable history requires this server to persist its own record, which is a different
  design with its own consistency questions, and is not attempted here.
- **Pre-compaction arrivals stay invisible**, exactly as pre-compaction user prompts do (M6). This is
  the SDK's read window, not our gap, and pretending otherwise would mean reimplementing compaction
  semantics to no benefit.
- **Store-backed sessions.** `GetSessionMessagesOptions.sessionStore` allows a transcript to live
  somewhere other than the local filesystem. Reading raw JSONL bypasses that. The app-server passes
  no `sessionStore` anywhere today (verified: zero occurrences under `src/appserver`), so nothing
  breaks now — but the reader must degrade to plain SDK output rather than fail when the file is
  absent, and that is a required behaviour, not a nicety.

## Acceptance

Phrased as observable behaviour. The keyed legs run against a real engine.

1. **A peer message answered by a thread appears in that thread's history.** Send a message to an
   accepting thread, let the turn complete, then call `thread/read`: the arrival is present, before
   the assistant's answer, carrying the sender's text — not the CLI's envelope preamble.
2. **The replayed item and the live item are the same item.** The id `thread/read` returns for the
   arrival equals the `arrivalUuid` that `thread/peerMessage` announced, so a client that dedupes by
   id renders it once.
3. **Ordinary history is unchanged.** For a thread that never received a peer message, `thread/read`
   returns byte-identical output before and after this change.
4. **CLI bookkeeping stays out.** A thread whose transcript contains local-command caveats, skill
   injections, or system reminders shows none of them in `thread/read`.
5. **Rewind is untouched.** Rewind anchors and their indices for a thread containing a peer arrival
   are identical before and after this change — the shared reader still feeds them.
6. **A missing or unreadable transcript file degrades, never throws.** `thread/read` returns what the
   SDK returns.
7. **The M8 live legs that assert the gap go red and are updated, not weakened.** They assert current
   behaviour deliberately; their reddening is the signal this landed, and each is rewritten to assert
   the new behaviour rather than deleted or loosened.

## Delegated unknowns

Empirical, to be closed during implementation rather than argued now:

- **U1 — does a widened row disturb `rowKind`?** `sessions/rows.ts` opens by asserting "The rows carry
  NO meta flags (probe 68b)". That is true of its *input* (SDK-projected rows) but is written as a
  fact about the rows, and it is false on disk. Once richer rows reach it, confirm no classifier
  branch changes verdict, and correct the comment either way.
- **U2 — cursor stability.** `thread/read` pages by row offset within an epoch. Inserting rows shifts
  offsets. Confirm a cursor minted and consumed within one server version still walks without gap or
  repeat; a cursor spanning a version upgrade is out of scope.
- **U3 — the second population's live twin.** M4 found 112 peer rows carrying `senderTaskId` and no
  `verifiedPeerPid`. Confirm `peerArrival` renders those correctly from disk, since M8's live legs
  only ever exercised the 18-row gateway population.

## Decision Log

- **The reader rule is `origin`, not `peer`.** Rejected: matching on `origin.kind === "peer"` at the
  reader. It bakes one consumer's interest into a shared boundary, and M2 shows `origin` is already
  the clean structural split. Also rejected: text recognition of the envelope — M8 removed exactly
  that rule after counting showed 40 of 52 matches were local prompts quoting an envelope.
- **Splice over reimplementation.** Rejected: reproducing the SDK's chain walk in our tree. It would
  duplicate leaf selection, tree resolution and compaction-window semantics — the subtle parts — to
  recover rows the SDK already positions for us. M5 measured the splice exact at 25/25.
- **A dedicated reader, not the shared dep.** Rejected: widening `srv.deps.getSessionMessages`. It
  would silently turn peer arrivals into rewind anchors and shift every subsequent anchor index.
- **Non-peer origin rows surface as ordinary user messages.** Rejected: hiding them until they can be
  rendered richly, which keeps 571 real messages invisible for a cosmetic reason. Flagged as the most
  arguable call here.
- **Folded arrivals are documented, not synthesised.** Rejected: minting a placeholder item for an
  arrival with no persisted row. It would put a fabricated row in a record whose whole value is
  being what actually happened.

## Surprises & Discoveries

- The SDK's `includeSystemMessages` option looked like the seam and is not — it gates `type:"system"`
  only and never reaches `isMeta`. Reading the bundled implementation, not the type declaration, is
  what settled it.
- 45 of 70 arrivals appearing "off-chain" looked like a hard coverage ceiling for a full working
  session's reasoning. It was compaction, shared with every other message type. The lesson repeats
  M8's: an aggregate number invited a conclusion, and one concrete example refuted it in a minute.
- The claim that this gap covers "every origin-bearing message, six times larger than the task says"
  was made and then disproved within the same design round, by breaking the aggregate down per kind.
  It is recorded here rather than quietly dropped.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-29)** — first draft, written from measurement (M1–M6) rather than from reading
  the M8 spec's prose about this component, which was wrong for five revisions.
