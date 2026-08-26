# M8 — cross-session messaging: the gateway, the roster, and the adopted turn

**Date:** 2026-08-26 · **Owner approval:** presented 2026-08-26, approved with the one open fork resolved
to the recommendation (the gateway asserts `prompting`, and clients cannot declare a class).
**Grounding:** `docs/superpowers/specs/2026-08-22-m6-cross-session-messaging-grounding.md` (the mechanism
pass) · probe 113c (`probes/probes/113c-cross-session-inbound-envelope.ts`, keyed 2026-08-25:
ADDRESSABLE) · probes 117 / 117b / 117c (`probes/probes/117*.ts`, keyed 2026-08-26: the four host seams).
**Branch:** `m8-cross-session`, off `f69d1e28e4`.
**Status: DESIGNED — not yet built.**

## Purpose

Every Claude Code session on this machine already hosts an inbound message socket, binds it without any
help from its embedding host, and adjudicates what arrives by a documented policy. Probe 113c proved a
separate process can deliver into one and be acted on; probes 117/117b measured what a host must do to
participate properly. **The receive fabric is not ours to build.** What is ours is the four things around
it, and this milestone ships exactly those:

- **Discovery** — which sessions exist on this machine, which are alive, which have an inbox bound, and
  which of them this server is itself hosting.
- **Addressing** — turning a session the client can name into a socket path, with the same
  ambiguity-is-an-error discipline `thread/attach` already uses.
- **Policy** — deciding, per hosted thread and never by accident, whether inbound peer messages are
  accepted, and making that decision unforgeable by the client and unloosenable by the user's own repo.
- **Plumbing** — a turn that begins because someone else sent a message is, today, an unmodelled case:
  every turn this server has ever seen was minted by `queue.ts`'s `enqueue`. This milestone models it.

The population is **machine-wide**: any Claude Code session in the user's own registry, not merely the
threads this server hosts. That is the scope probes 113b/117 actually exercised, and it is what makes the
surface worth having — a client of this app-server can reach the user's own interactive TUI session, a
`ccx` host, or another SDK session, none of which this server opened.

Non-goals, decided: the **cross-machine `bridge:` path** (governed separately by `isolatePeerMachines`,
and unmeasured here — the address grammar's `bridge:` arm is refused with a named message rather than
attempted); **hold review** (a held message cannot be released from a hosted thread at all — see the
measurement in Surprises, which turns hold into a delayed refuse and removes the feature's subject);
**fleet threads as senders or receivers** (a fleet thread's engine is another process's session, whose
settings this server does not write and whose stream it does not own — `peer/send`'s `fromThreadId` and
the inbound policy are inProcess-only, refused with `-33006`); and **`SendMessage`-tool parity** (the
model-facing tool is the CLI's own and needs nothing from us).

## What was measured, and what each measurement forces

Each row is a design constraint, not background. All five were measured on 2026-08-25/26 against the
installed CLI (2.1.246) and SDK 0.3.237.

| Measurement | Forces |
|---|---|
| A vouched, in-namespace listener that **closes on read** receives `peer_message_status`; 113c's, which was neither, received nothing (117b Q1) | The gateway's shape: same socket directory, a published key, and an immediate close. None of the three is optional. |
| A **key file alone** vouches a reply address — no `~/.claude/sessions/<pid>.json` row needed (117b Q3) | The app-server does not masquerade as a session. It publishes one key and stays out of everyone's session list. |
| `msg_id` must be **UUID-shaped** or the receipt carries no `orig_msg_id` (117b Q4, both runs) | `peer/send` mints a UUID and returns it; a client-supplied id is not accepted. |
| Receipts arrive **only on `held` and `expired`** — a delivered message and a refused message both tell the sender nothing (117b + the receivers' own logs in 117) | `peer/send` cannot promise delivery, and silence is the success path. Both must be said on the wire and in the docs. |
| A held message on a headless session logs `headless: held peer message expired (no approval surface)` and expires (117b) | `hold` on a hosted thread is a **delayed refuse**. It stays an accepted value (a client may want the sender told "held" rather than nothing) but the spec calls it what it is. |
| `--settings` inline JSON is honored under `settingSources: []`, and an explicit value beats mode parity in **both** directions (117 Q2a/Q2b) | Per-thread policy without touching the user's repo, and a default that cannot be loosened by anything on disk. |
| With `--replay-user-messages`, a peer turn surfaces as `{type:"user", isReplay:true, origin:{kind:"peer", …}}`; without it **no user prompt frame is emitted at all** (117 Q3) | The doorbell and the notification payload are the same object. 113c's "origin never observed" was a missing flag, not a stripped field. |
| `Options.settings` as an object serializes to real JSON on argv (117c) | The harness's existing `config.settings` path is sound; no string-encoding workaround is needed. |

## Wire design

### `peer/list` — the roster (server-scoped, no `threadId`)

```
peer/list { aliveOnly?: boolean }  ->  { peers: PeerRow[] }
PeerRow {
  address: string;            // "uds:<socket path>" — the only thing that is an ADDRESS
  sessionId?: string; pid: number;
  entrypoint?: string; kind?: string; name?: string; cwd?: string;
  version?: string; peerProtocol?: number; peerFeatures?: string[];
  alive: boolean;             // pid + procStart match, measured with LC_ALL=C TZ=UTC
  inboxBound: boolean;        // the socket exists on disk
  threadId?: string;          // set when THIS server hosts that session
}
```

The gateway itself never appears here, and that follows from a decision rather than a filter: it
publishes a key file and no registry row, so nothing scanning `~/.claude/sessions/*.json` can see it.

Read from `~/.claude/sessions/*.json`. Fields beyond `address`/`alive`/`inboxBound`/`threadId` are
**projected verbatim when present and omitted when absent** — they are another program's file, and a row
that invents a default is a row that lies. `aliveOnly` defaults false: a dead row is information (it is
why an address stopped working), and `fleet/list` already sets the precedent of listing terminal rows.

Liveness is `pid` + `procStart` compared against `ps -o lstart=` under `LC_ALL=C TZ=UTC` — the same
comparison `fleet/liveness.ts` makes, and for the same reason: a locale mismatch here once cost this
project a wrong roadmap finding.

### `peer/send` — the outbound half (server-scoped)

```
peer/send {
  target: string;             // sessionId | pid (as a string) | "uds:<path>"
  message: string;
  priority?: "now" | "next" | "later";   // default "next"
  fromThreadId?: string;      // attribution only; inProcess threads only
}  ->  { msgId: string; address: string; targetSessionId?: string; delivered: false }
```

`delivered: false` is a literal, not a status: **this method reports that the frame was written, and
nothing more.** The CLI tells a sender nothing on the success path, so a result that implied delivery
would be the wire's own lie. A client that needs more listens for `peer/messageStatus`.

**Target resolution** copies `thread/attach`'s rule exactly: a simultaneous filter over `sessionId`, `pid`
and `address`, where more than one match is an error carrying the matches rather than a precedence. A
wrong guess here delivers a message into somebody else's session.

**The envelope** is assembled with the CLI's fixed attribute order — `from`, `from-session`, `hop-chain`,
`from-name`, `from-mode` — because the receiver re-serializes and compares byte-exactly, and anything out
of order is silently downgraded to plain text. Only the attributes we set appear.

**`from` is always the gateway's own address**, never a thread's. It is the reply route, and receipts come
back over a connection whose pid the kernel checks: no other value could receive them.

**`fromThreadId` changes attribution only** — `from-session` (that thread's `sessionId`, a navigation
target), `from-name` (its name), and `from-mode` (its *actual* permission class, read from the record, not
from the request).

**Without `fromThreadId` the gateway asserts `from-mode="prompting"`** (the resolved fork). The gateway
process runs no model and asks no permission; claiming `bypass` would be a false statement about the one
attribute the recipient uses to decide. The visible consequence, which belongs on the wire docs: a message
sent with no thread attribution reaches a `bypassPermissions` peer as **held**, and on a headless peer it
then expires. A client that needs immediate delivery to such a peer attributes the send to a bypass
thread it owns. Clients cannot declare a class themselves; the surface has no `asMode`.

### `peer/messageStatus` — the receipt, as a notification

```
peer/messageStatus { msgId, status, reason?, from, receivedAt }
status: "held" | "expired" | "delivered" | "refused" | "denied" | "dropped"
```

The full status vocabulary is declared because the CLI's own control frame declares it, but the docs and
the scorecard row state the measured truth: **only `held` and `expired` are observed today.** Delivered to
the connection that sent the `peer/send` — this is that request's delayed completion, not thread state —
and dropped if that connection is gone.

### `thread/peerMessage` — inbound, to the thread's subscribers

```
thread/peerMessage { threadId, turnId, origin: { kind: "peer", from, verifiedPeerPid?, name?,
                     fromMode?, fromSession?, body?, msg_id? }, receivedAt }
```

The `origin` object is passed through **verbatim from the SDK frame** rather than re-derived. It is
already exactly the right shape, and `verifiedPeerPid` — the one field the kernel vouches for and the only
non-forgeable identity in the whole exchange — must not be reconstructed from anything a sender wrote.
Broadcast to the thread's subscribers (not watchers): this is content, and `watchThreads` is existence
fan-out, a distinction the images round learned the hard way.

### `crossSessionInbound` on `thread/start` and `thread/resume`

```
crossSessionInbound?: "accept" | "hold" | "refuse"     // default "refuse"
```

Always written explicitly into the session's flag-layer settings, whatever the value — including the
default. An explicit value wins over mode parity and over every settings file on disk, so writing it
always is what makes "this server's threads do not receive mail unless a client asked for it" a property
rather than a hope. `hold` is accepted and documented as a delayed refuse on a hosted thread.

Refused with `-33006` on fleet threads: this server does not write that engine's settings.

## Runtime design

### The gateway inbox (`src/peer/gateway.ts`)

One socket per server process, bound at `<socketDir>/<our pid>.sock` where `socketDir` is taken from a
hosted session's own `messaging_socket_path` when one is known and otherwise from
`${XDG_RUNTIME_DIR||/tmp}/cc-socks` — the receipt sender refuses any reply address outside the receiver's
own directory, so this is a correctness requirement, not a convention. Alongside it, one key file at
`~/.claude/sessions/<pid>.<sha256(socket path)>.key` containing a freshly minted 32-hex `peerToken` and
our `procStart`. **No registry row**: a key alone vouches, and publishing a row would put the app-server
in every session-listing tool on the machine as if it were a session.

The listener accepts, reads NDJSON lines, and **closes the connection as soon as it has consumed a
frame**. The receipt sender writes one buffer, never reads, and times out idle after five seconds — a
listener that stays open turns every receipt into the sender's error, which is precisely what 113b logged
and 113c never diagnosed.

Two frame types are expected: `auth` (ignored — we are the listener, and the token is the sender's
courtesy) and `control` with `action: "peer_message_status"` (matched to a pending `peer/send` by
`orig_msg_id` and forwarded). Anything else, including a `type:"user"` frame, is dropped with a
`warning` notification: **the gateway is a reply address, not a session**, and it must never be mistaken
for one.

Teardown unlinks both the socket and the key file. A bind failure is not fatal: the server runs, and every
`peer/*` method answers `-33008` naming the gateway as unavailable. The whole inbound fabric sits behind a
server-side feature gate (`agents_cross_session_inbox`) that can turn off without an SDK release, so
runtime detection and degradation are the design's baseline, not its error path.

### Inbound policy injection, and the hole to close

The resolved policy is written into the thread's settings through the existing
`config.settings` seam (`config/settings.ts`), which probe 117c confirmed reaches argv as real JSON. A
thread that opts in also gets `--replay-user-messages` via `extraArgs`, server-owned.

Both are forgeable by a client today: `extraArgs` reaches the CLI as raw argv where the last flag wins, so
a client-supplied `extraArgs.settings` would override ours. `appserver/sessionIdentity.ts` already strips
identity flags from both `extraArgs` and the `extraOptions` hatch for exactly this reason; this milestone
extends that same stripping to `settings` and `replay-user-messages`. The stripping lives beside the
existing one, in the same function, because the invariant is the same one.

### Adopting the turn nobody asked for

The SDK correlates a turn's result to its waiter by `user_message_uuid` **and** by origin class: a waiter
declares the origin it owns, and a result whose `origin.kind` differs settles nothing. Peer-initiated
turns therefore need a waiter of their own — without one, the result is counted in `Session`'s existing
`unmatchedResults` and the thread wedges busy forever.

So `SubmittedOrigin` gains `"peer"`, and `Session` gains one method:

```ts
adoptTurn(uuid: UserMessageUUID, onMessage: (m: unknown) => void): Promise<TurnOutcome>
```

It registers a waiter exactly like `enqueueTurn` does — and pushes **nothing** onto the input queue. The
correlation machinery is already right; it was simply never given a turn it did not start.

**The waiter goes to the FRONT of the queue, and that detail is load-bearing.** Result frames are matched
by uuid and origin, but every *other* frame is routed to `waiters[0]` and nowhere else
(`src/session/session.ts:393`). Push the adopted waiter to the back while a client turn sits queued ahead
of it, and the peer turn's assistant frames stream into the client turn's mapper — items attributed to a
turn that has not started, on a thread where both turns then look wrong. Unshift is not merely safer, it
is what the engine's own ordering says: the CLI emits the replayed user frame at the moment it *dequeues*
that message to run it, so a peer replay frame is proof that the peer turn is the one now executing and
that anything still queued behind it in `waiters` has not begun. When the peer result settles its waiter
and it shifts off, the client's turn is head again.

The app-server side is a small state machine in `appserver/peerInbound.ts`, driven by the replayed frame:

1. A router route sees `{type:"user", isReplay:true, origin.kind === "peer"}` on a thread. Every other
   replayed frame is ignored — the flag also re-emits our own prompts, and only the peer arm is ours.
   (The item mapper is unaffected either way: its `onUser` reads `tool_result` blocks only, so a replayed
   prompt produces no item events. A unit row pins that, so a future mapper change cannot quietly
   fabricate an item from a replay.)
2. If the thread is idle, adoption claims the turn through `beginTurn` with no `ctx`/`id` — the same
   client-less entry the queue drain already uses — and its runner awaits `adoptTurn(frame.uuid)`.
   `turn/started` carries the peer `origin`, and `thread/peerMessage` is broadcast alongside it.
3. If the thread is busy, the CLI has queued the message behind our own turn. Adoption parks it in a
   single pending slot and claims it from `settleTurn`, the same place the queue drain runs. One slot,
   not a queue: the CLI owns the real queue, and a second one here would be a second source of truth.
4. The adopted turn settles when its waiter resolves. As a belt, it also settles if the router observes a
   terminal `result` frame for this thread while an adoption is open and its waiter has not fired —
   settle-once, latched. This exists because a wedged thread is worse than an approximate completion, and
   because whether a peer result frame carries `user_message_uuid` is a **delegated unknown** this design
   names rather than assumes: the live acceptance settles it, and `unmatchedResults` is the instrument
   that turns a wrong guess into a red test instead of a hang.

### Where the code lands

`src/peer/gateway.ts` (socket, key file, receipt parsing), `src/peer/address.ts` (grammar, namespace
checks, envelope assembly — pure, so its byte-exactness is unit-testable without a socket),
`src/peer/roster.ts` (registry read + liveness), `appserver/peerDomain.ts` (the two methods),
`appserver/peerInbound.ts` (the adoption state machine), `appserver/schema/peer.ts` (registered in
`methodSchemas`, with `result` shapes published — M5's D-M5-19 convention), and the two handlers
registered in `server.ts` beside `fleet/list` and `thread/attach`. Named `peerDomain`/`peerInbound`
because `appserver/peer.ts` is the JSON-RPC framing class and the collision is a known trap.

Both methods are **server-scoped**: they name no thread and bypass the engine-gone and origin gates, like
`fleet/list` and `config/*`. Errors reuse `-33008` (documented as the fleet-operation code "named for its
first user") for gateway and delivery failures, and `-32602` for an ambiguous or unresolvable target.

## Acceptance (behavior-phrased)

Keyless, run from `CC-to-SDK/harness`:

1. `npx vitest run test/unit/peer/address.test.ts` — the envelope is byte-exact with the CLI's attribute
   order, and reordering any two attributes changes the bytes; `uds:` addresses parse, `bridge:` is
   refused naming itself, a path outside the receiver's directory is refused as out-of-namespace; the key
   file name is `sha256` of the socket path.
2. `npx vitest run test/unit/peer/gateway.test.ts` — a receipt written by a fake sender is parsed and
   correlated by `orig_msg_id`; the listener closes the connection after consuming a frame; a `type:"user"`
   frame is dropped and raises a `warning`; teardown unlinks socket and key; a bind failure leaves the
   server up with `peer/*` answering `-33008`.
3. `npx vitest run test/unit/appserver/peer-domain.test.ts` — `peer/list` projects present fields verbatim
   and omits absent ones, marks `alive`/`inboxBound`/`threadId`, lists dead rows by default and drops them
   under `aliveOnly`; `peer/send` puts the requested `priority` on the frame and `"next"` when none was
   asked for, mints a UUID `msgId`, refuses
   an ambiguous target with the matches listed, refuses `fromThreadId` on a fleet thread with `-33006`,
   asserts `from-mode="prompting"` with no attribution and the thread's real class with it, and returns
   `delivered: false`; a receipt arriving for that `msgId` reaches the sending connection as
   `peer/messageStatus` and is dropped when that connection is gone.
4. `npx vitest run test/unit/appserver/peer-inbound.test.ts` — a replayed peer frame on an idle thread
   claims a turn and broadcasts `thread/peerMessage` + `turn/started` carrying the peer origin; on a busy
   thread it is claimed at `settleTurn`; a replayed **non-peer** frame is ignored and produces no item
   events; an adoption raised while a client turn is queued ahead of it takes the HEAD of the waiter queue,
   so the peer turn's assistant frames reach the peer turn's mapper and not the queued turn's;
   the adopted turn settles on its waiter, and settles once via the belt when the waiter never
   fires; `crossSessionInbound` is written explicitly at `thread/start` for every value including the
   default, is stripped from a client's `extraArgs` and `extraOptions`, and is refused on a fleet thread.
5. `node scripts/drift-check.mjs` from `CC-to-SDK/` — exit 0, with the new methods rowed and the
   notifications rowed, and `docs/parity/full-potential.md`'s stale 🚫 row for cross-session receive
   replaced by a scored row (the capability re-enters the denominator).

Keyed (gated live, `test/live/appserver-cross-session.test.ts`):

6. The whole loop against a real engine: the server starts a thread with `crossSessionInbound: "accept"`,
   `peer/list` shows that thread's own row with its `threadId`, `peer/send` addresses it with attribution
   from a second bypass thread, and the subscriber sees `thread/peerMessage` → `turn/started` with
   `origin.kind === "peer"` → `turn/completed`, with the model's reply naming the sent token.
7. The negative leg: the same send into a `crossSessionInbound: "refuse"` thread produces no
   `thread/peerMessage`, no turn, and no receipt — silence on both channels is the measured contract.

## Decision Log

- **Machine-wide population, not just hosted threads.** Rejected: scoping to this server's own threads —
  it duplicates `fleet/list` and throws away the reach that makes the surface worth having (the user's own
  TUI session is the most interesting peer on the machine).
- **Gateway sends; `fromThreadId` attributes.** Rejected: thread-scoped-only sending (Codex's shape) —
  a UI client would have to create a thread merely to speak, and `from` must be the gateway's address
  anyway because that is where receipts can land. Rejected: gateway-only with no attribution — the
  receiving side could then never tell which of our threads spoke.
- **The gateway asserts `prompting`** (owner-resolved fork). Rejected: a client-declared `asMode` — it
  would let any WS client claim `bypass` and land straight in a stranger's turn queue, and `from-mode` is
  the exact field the recipient trusts. The cost is stated on the wire: unattributed sends are held by
  bypass peers.
- **Default `refuse`, always written explicitly.** Rejected: CLI-default mode parity — it would open every
  bypass thread this server hosts to any same-user process, spending the user's tokens with no client
  having asked. Rejected: writing the key only when a client sets it — an unwritten key lets a settings
  file on disk decide.
- **A key file only, no registry row.** Rejected: publishing a row (117's approach) — it works, but it
  puts the app-server in every session listing on the machine claiming to be a session, and 117b proved
  it unnecessary.
- **`peer/send` reports written, not delivered.** Rejected: waiting for a receipt before replying — the
  success path produces no receipt at all, so the method would hang on exactly the good case.
- **Adoption via a `"peer"`-origin waiter.** Rejected: a synthetic completion driven purely by router
  frames — it would fabricate a turn outcome the session layer never confirmed, and `unmatchedResults`
  would silently count every peer turn as a dropped result.
- **`bridge:` refused, not attempted.** Rejected: passing it through untested — cross-machine delivery is
  governed by a different setting and was never measured; a refusal that names itself is honest, an
  untested pass-through is not.

## Surprises & Discoveries

- **113c's zero receipts were a listener defect, not an absent channel.** Three independent conditions
  gate the receipt write, and 113c's bare `net.createServer` failed two of them (unvouched, never
  closing). A capability can look absent because the probe's own half was wrong — the same shape as
  probe 110's "not addressable", which was a malformed address rather than an unreachable target.
- **Silence is the success path.** Delivered and refused messages produce no receipt at all; only `held`
  and `expired` do. A design that treated "no news" as a failure would have been backwards.
- **`hold` on a headless session is a delayed refuse** — the CLI says so in its own words (`no approval
  surface`). The feature that looked like the richest half of the receive story has no subject on a
  hosted thread.
- **A non-UUID `msg_id` silently costs correlation.** The receipt still arrives; it simply carries no
  `orig_msg_id`. Nothing errors, and a sender would just never be able to tie a status to a message.
- **The SDK emits no user prompt frame at all** unless `--replay-user-messages` is passed, which it never
  passes. 113c's "origin.kind='peer' not observed" was therefore about a flag, not about attribution
  being stripped — and the same flag hands us the notification payload for free.
- **Only the head waiter receives non-result frames.** Reading `session.ts` while writing this spec turned
  up that every frame except a result goes to `waiters[0]` and nowhere else. Adoption's first draft pushed
  its waiter to the back, which would have streamed a peer turn's output into a queued client turn's
  mapper — a defect with no error anywhere, just two turns rendering wrong. The correction (unshift) is
  one word; finding it needed reading the layer being extended rather than the layer being written.
- **Decompiled reading is a hypothesis, not a measurement.** Reading the minified SDK concluded that
  `Options.settings` as an object would serialize to `"[object Object]"`, which would have meant a live
  latent defect in the harness's autocompact path. Intercepting the real argv (117c) showed it emits
  proper JSON. The reading was careful and wrong; the cheap interception settled it in one run.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-26)** — first draft, written after the grill and probes 117/117b/117c, with the one
  presented fork resolved to the recommendation.
