# M8 — cross-session messaging: the gateway, the roster, and the adopted turn

**Date:** 2026-08-26 · **Owner approval:** presented 2026-08-26, approved with the one open fork resolved
to the recommendation (the gateway asserts `prompting`, and clients cannot declare a class).
**Grounding:** `docs/superpowers/specs/2026-08-22-m6-cross-session-messaging-grounding.md` (the mechanism
pass) · probe 113c (`probes/probes/113c-cross-session-inbound-envelope.ts`, keyed 2026-08-25:
ADDRESSABLE) · probes 117 / 117b / 117c (the four host seams) · probes 118 / 118b (the three outcomes of
an inbound message), all keyed 2026-08-26.
**Branch:** `m8-cross-session`, off `f69d1e28e4`.
**Rev 2** — an adversarial review of rev 1 returned twelve findings; ten survived adjudication and two
were rejected with reasons (Decision Log). Two of the survivors were load-bearing enough to need their own
measurement, which is what probes 118 and 118b are, and between them they replaced the whole inbound
half of the design.
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
| An inbound message becomes its **own turn**, a **follow-up turn**, or is **folded into the running turn**, depending on whether the receiver was busy and whether it had another model round-trip left (118, 118b Q5) | Arrival and execution are separate facts. A notification fires on arrival; a turn is adopted only when one actually runs. |
| A peer turn's result carries **no `user_message_uuid`**, and its `origin.kind` is `peer` or `task-notification` depending on which of those paths it took (118b Q2/Q3, 118) | Correlation by uuid is impossible and correlation by origin class is unreliable; settlement rides the unclaimed-result seam instead. |
| Several messages arriving during one busy turn **batch into a single turn** (118 Q2) | One message ≠ one turn, in either direction. |
| The replay frame is emitted at **enqueue**, before the running turn's own result (118) | A replay is not proof that the peer turn is executing — it retires rev 1's waiter-ordering argument. |
| `readLoop` calls every frame subscriber **before** it resolves a matching waiter (`session.ts:373` vs `:388-390`) | A router-driven "has my waiter fired?" fallback always wins the race, so rev 1's belt would have become the only settlement path. |

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

**Attribute values are escaped, not interpolated.** The envelope is compared byte-exactly by the receiver
after it re-serializes what it parsed, and two of the values are not ours to trust: a socket path and a
thread name a client chose. A quote, ampersand, angle bracket or newline in either silently downgrades the
whole envelope to plain text — which drops the permission attribution and changes the delivery decision
with nothing raised anywhere. The assembler escapes each value with the CLI's own XML attribute rules, and
hostile names are a test fixture rather than a hope.

**`from` is always the gateway's own address**, never a thread's. It is the reply route, and receipts come
back over a connection whose pid the kernel checks: no other value could receive them.

**`fromThreadId` changes attribution only** — `from-session` (that thread's `sessionId`, a navigation
target), `from-name` (its name), and `from-mode` (its *actual* permission class, read from the record, not
from the request).

**`hop-chain` is never set.** It exists in the attribute order for relayed traffic, and nothing here
relays: this server sends only when a client calls `peer/send`, and it never answers an inbound message on
its own. A hosted thread whose model uses the CLI's own `SendMessage` tool is the CLI's exchange, with the
CLI's own loop discipline, and is not this domain's traffic.

**The message is capped, because nothing downstream will tell us if it is not.** The CLI's own sender
preflights size and refuses with a message naming both figures ("the serialized message is N characters
and the limit is M … put bulk content in a file the recipient can read rather than in the message"), but
that preflight belongs to the path we do not use — we write the socket ourselves, and an oversize line
hits the receiver's own length cap, which drops it *silently*, before the JSON is even parsed. So
`peer/send` measures the assembled frame and refuses `-32602` above its own conservative cap, naming the
measured size and the limit. The receiver's exact cap is a **delegated unknown**: it is a constant in a
minified bundle, and the honest way to learn it is a bisecting probe against a live inbox during
execution. Until it is pinned, ours is set low enough that no frame we accept can reach theirs.

That cap binds what THIS server sends, and nothing more. Any same-user process can write to a hosted
thread's inbox directly, and by the time the replayed frame reaches us the CLI has already admitted the
body as model input — there is no point at which this server could intervene. The reviewer who raised this
framed it against a 10K-token ceiling on model-visible injected items; that rule is `AGENTS.md`'s and
governs `codex-rs/`, which this repository has already adjudicated once (M7 rejected the same misapplied
import), so it is not a conformance gap here. What remains true is narrower and worth acting on: the only
bound on inbound size is the CLI's own line cap, whose value we have not measured, and the only control a
hosted thread has is whether it accepts peer mail at all. That is what makes `refuse` the default rather
than a preference.

**The gateway always asserts `from-mode="prompting"`, and `fromThreadId` cannot change it.** The first
draft let attribution to a thread carry that thread's real permission class, on the reasoning that a
bypass thread speaking should say so. That reasoning was wrong, and the spec's own claim that "clients
cannot declare a class" was false as written: a client creates its own `bypassPermissions` thread — one
ordinary `thread/start` — and passes its id, and the gateway then asserts `bypass` on text the client
authored. That is the rejected `asMode` surface with one setup call in front of it, and what it buys is
real: `hold` is how a *stranger's* session protects its user from unattributed text, and this would step
around it into the user's own TUI session.

So the class is a property of the sender, and the sender is a gateway process that runs no model and asks
no permission: `prompting`, always. `fromThreadId` sets `from-session` (a navigation target) and
`from-name` (a label) and nothing that any recipient uses to decide. The honest cost is stated on the
wire: **every message this server sends is held by a `bypassPermissions` peer**, and on a headless peer a
hold expires. Immediate delivery to such a peer is not something this surface offers, and the way to
change that is a sender that genuinely holds the class — a model-side send, which this milestone does not
build — not a parameter.

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

### What the gateway retains, and what it cannot reach

**The correlation map needs its own lifecycle, because the success path never signals.** A `peer/send`
records `msgId -> sending connection` so a later receipt can be routed. Delivered and refused messages
produce no receipt at all, so the common outcomes leave no cleanup signal, and a long-lived client would
grow the map without bound. Three rules, none of them optional: entries expire on a TTL comfortably longer
than the hold deadline (`dialogExpiry`, 5 minutes by default and overridable by
`CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`); a connection's entries are dropped when it closes; and per-connection
and global counts are capped, with the oldest entry evicted first. `held` is explicitly **not** terminal —
an `expired` can follow it, so a `held` entry is retained rather than released on arrival. `expired`,
`delivered`, `refused`, `denied` and `dropped` are terminal and release immediately.

**One gateway socket cannot serve every peer on the machine.** The receipt sender refuses any reply
address outside the receiver's own socket directory, and directories vary — `XDG_RUNTIME_DIR`,
`CLAUDE_CODE_TMPDIR`, an explicit `--messaging-socket-path`. A send to a peer in another namespace is
therefore deliverable but can never produce a status, which is a contract difference the method must not
paper over. `peer/send` compares the target's directory with the gateway's and, when they differ, still
sends and returns `statusReachable: false` beside `delivered: false`. `peer/list` marks the same fact per
row. Binding a second gateway per namespace is a later option and is deliberately not in this milestone:
one honest field costs nothing and no measurement yet says multiple namespaces occur in practice.

### Inbound policy injection, and the three doors to close

The resolved policy is written into the thread's settings through the existing `config.settings` seam
(`config/settings.ts`), which probe 117c confirmed reaches argv as real JSON. A thread that opts in also
gets `--replay-user-messages` via `extraArgs`, server-owned.

Three doors let a client reach past that, and all three must be shut — the first draft shut only one:

1. **Startup argv.** `extraArgs` reaches the CLI as raw argv where the last flag wins, so a client-supplied
   `extraArgs.settings` overrides ours. `appserver/sessionIdentity.ts` already strips identity flags from
   both `extraArgs` and the `extraOptions` hatch; this extends that same stripping to `settings` and
   `replay-user-messages`, in the same function, because it is the same invariant.
2. **`thread/settings/apply`, after startup.** Its params are `z.record(z.string(), z.unknown())` — an open
   record — and the handler forwards it to `Session.applyFlagSettings`, which writes **the very layer this
   design relies on**, at runtime, with no mirror write and no `thread/settings/changed` broadcast. Any
   initialized connection could therefore turn another thread's `refuse` into `accept` and then feed it.
   `crossSessionInbound` is reserved in that method: refused with `-32602` naming itself, because a
   silently ignored key would be worse than the refusal. A client that wants to change the policy asks
   `thread/crossSessionInbound/set` — a small dedicated method with the same value domain and the same
   inProcess-only rule — so a policy change is always a deliberate, named act.
3. **Version skew.** `thread/start`'s params are a plain `z.object`, which strips unknown keys silently,
   so a new client asking an OLDER server for `refuse` gets a healthy thread that still runs mode parity —
   protection the client believes it has and does not. This is the exact failure the M7 `dynamicTools`
   marker exists to prevent, and its own schema doc says so. So `initialize`'s result gains
   `crossSession: true` as a `z.literal(true)`: an older server sends nothing at all, absence is the
   signal, and a client that means to rely on the policy must read the marker first.

### Arrival is not a turn — the three outcomes, and what each one forces

The first draft of this section assumed an inbound peer message becomes a turn. Probes 118 and 118b
measured that it becomes **one of three things**, and that nothing observable at delivery time says which:

| Receiver state at delivery | What happens | What the result frame carries |
|---|---|---|
| Idle | The message runs as its own turn, preceded by a second `system/init` | `origin: {kind:"peer", from, verifiedPeerPid, name, fromMode, body, msg_id}` — and **no `user_message_uuid`** |
| Busy, and the running turn ends without another model round-trip | A separate follow-up turn | `origin: {kind:"task-notification"}` — not `peer` |
| Busy, with round-trips still to come | **Folded into the running turn.** The queue is drained mid-turn, after a tool result and before the next round-trip, and the peer text rides in as an attachment | The running turn's own result, carrying the ORIGINAL turn's uuid and no peer origin. There is no second result at all |

The third row is why the first draft's busy path — park in a pending slot, claim it at `settleTurn` —
would have minted a turn that never runs and left the thread busy forever. The second row is why an
adopted waiter cannot declare origin `"peer"`: the same event produces a different origin class depending
on timing the host does not control. And the missing `user_message_uuid` is why `adoptTurn(uuid)` is
impossible: the replayed frame that *causes* the turn carries a uuid, and the result it produces does not.

Two further measurements bound the shape:

- **Several messages arriving during one busy turn BATCH into a single turn** — two replays, one result.
  So a turn can answer N peer messages, and a one-message-one-turn model is wrong in both directions.
- **The replay frame is emitted at ENQUEUE, not at execution start.** It precedes the running turn's own
  result. A replay is therefore not proof that the peer turn is executing, which retires the earlier
  unshift argument along with the waiter it justified.

### The design those measurements leave

**Split arrival from execution.** They are different facts, they are observable at different moments, and
conflating them is what produced every defect above.

**Arrival** is the replayed frame, and it is exact: it always fires, once per message, carrying the full
peer `origin` including `msg_id`. `thread/peerMessage` is broadcast from there and promises nothing about
a turn. A client correlating a send to an arrival uses `msg_id`; a client wanting to know what the message
*caused* watches the thread's turns like any other observer.

**Execution** is detected the one way that holds across all three outcomes: **frames arriving on a thread
this server believes is idle.** If `record.busy` is false and the engine starts producing, a turn is
running that this server did not start — regardless of whether its cause was a peer message, and
regardless of which origin its eventual result carries. In the fold case no such window ever opens,
because our own turn is running and owns its frames; nothing is adopted, which is exactly right.

Adoption then mints a turn id, claims `busy` through `beginTurn`'s client-less entry (the same one the
queue drain uses), and broadcasts `turn/started`. That event carries `origin` when unconsumed peer
arrivals are on record for the thread and omits it otherwise — best-effort attribution over an exact
notification, rather than a guess dressed as a fact.

**Settlement rides the one seam that already knows.** `Session.readLoop` increments `unmatchedResults`
at exactly the point where a result frame matched no waiter (`session.ts:392`) — which is precisely what
a peer turn's result is, in all three shapes it can take. So `Session` gains a hook there:

```ts
onUnclaimedResult(cb: (result: unknown) => void): () => void
```

The adopted turn settles on it. This replaces the first draft's waiter **and** its belt, and the belt had
to go regardless: `readLoop` calls every frame subscriber *before* it resolves a matching waiter
(`session.ts:373` vs `:388-390`), so a router-driven "has my waiter fired yet?" fallback always observes
it unfired and wins the race unconditionally — the rescue path would have become the only path. One
settlement site, no race to lose.

`unmatchedResults` still increments for anything the hook does not consume, so it keeps its job as the
tripwire for results nobody owns.

### Interrupt, close, and shutdown

An adopted turn is a real turn and dies like one: `turn/interrupt` interrupts it, `thread/close` and
`shutdown` settle it `cancelled` through the same flush every client-owned turn goes through. Two
adoption-specific rules the existing paths cannot infer:

- The `closing` latch **blocks new adoptions**. Frames arriving on a closing thread are not a turn this
  server will announce; adopting one would emit `turn/started` after `thread/closed`.
- Unconsumed peer arrivals are dropped at close with no notification of their own. They were announced
  when they arrived; a second event about a message that will now never run would be inventing an outcome.

Interrupting an adopted turn interrupts the ENGINE's turn, which is the peer's, not a client's — worth
stating on the wire because the interrupting client did not start it.

### Live and replayed views must agree

The transcript projection turns every persisted top-level user prompt into a `userMessage` item, with no
`isMeta`, `origin` or `isReplay` filter available to it — the persisted rows carry no such flags
(`sessions/rows.ts`, probe 68b). A peer prompt therefore appears as a `userMessage` on `thread/read` while
live subscribers saw only `thread/peerMessage`, so a client that reconnects sees an item that never
existed live.

Rather than teach the projection to suppress it — the rows cannot support that test — the live path emits
**the same `userMessage` item** for an adopted turn, id-stable on the replayed frame's `uuid`, alongside
`thread/peerMessage`. Live and replay then agree by construction, and the notification remains the
richer, peer-specific channel. This also settles what the item mapper does: nothing, still — its `onUser`
reads `tool_result` blocks only, and the item is emitted by the adoption path rather than by ingestion,
which a unit row pins so a future mapper change cannot start fabricating one.

### Where the code lands

`src/peer/gateway.ts` (socket, key file, receipt parsing), `src/peer/address.ts` (grammar, namespace
checks, envelope assembly — pure, so its byte-exactness is unit-testable without a socket),
`src/peer/roster.ts` (registry read + liveness), `src/peer/receipts.ts` (the correlation map and its
retention rules), `appserver/peerDomain.ts` (`peer/list`, `peer/send`),
`appserver/peerInbound.ts` (arrival notification + the adoption state machine),
`appserver/peerPolicy.ts` (`thread/crossSessionInbound/set`, the settings injection, and the reservation
`thread/settings/apply` enforces), `appserver/schema/peer.ts` (registered in `methodSchemas`, with
`result` shapes published — M5's D-M5-19 convention), and the handlers registered in `server.ts` beside
`fleet/list` and `thread/attach`. One change lands outside the domain: `Session` gains
`onUnclaimedResult` at `session.ts`'s existing unmatched-result site. Named `peerDomain`/`peerInbound`
because `appserver/peer.ts` is the JSON-RPC framing class and the collision is a known trap.

`peer/list` and `peer/send` are **server-scoped**: they name no thread and bypass the engine-gone and
origin gates, like `fleet/list` and `config/*`. `thread/crossSessionInbound/set` is thread-scoped and
inProcess-only. Errors reuse `-33008` (documented as the fleet-operation code "named for its first user")
for gateway and delivery failures, and `-32602` for an ambiguous target, an over-cap message, or a
reserved key offered to `thread/settings/apply`.

## Acceptance (behavior-phrased)

Keyless, run from `CC-to-SDK/harness`:

1. `npx vitest run test/unit/peer/address.test.ts` — the envelope is byte-exact with the CLI's attribute
   order, and reordering any two attributes changes the bytes; a thread name or socket path carrying a
   quote, ampersand, angle bracket or newline is ESCAPED such that the receiver's parse-and-reserialize
   still matches byte-for-byte; `uds:` addresses parse, `bridge:` is refused naming itself, a path outside
   the receiver's directory is refused as out-of-namespace; the key file name is `sha256` of the socket
   path.
2. `npx vitest run test/unit/peer/gateway.test.ts` — a receipt written by a fake sender is parsed and
   correlated by `orig_msg_id`; the listener closes the connection after consuming a frame; a `type:"user"`
   frame is dropped and raises a `warning`; teardown unlinks socket and key; a bind failure leaves the
   server up with `peer/*` answering `-33008`. The correlation map's lifecycle has its own rows: a `held`
   receipt does NOT release its entry and a following `expired` still routes; every other status releases
   immediately; entries expire on the TTL; a closing connection drops its entries; and the per-connection
   and global caps evict oldest-first rather than growing.
3. `npx vitest run test/unit/appserver/peer-domain.test.ts` — `peer/list` projects present fields verbatim
   and omits absent ones, marks `alive`/`inboxBound`/`threadId`, flags rows outside the gateway's socket
   namespace as status-unreachable, lists dead rows by default and drops them under `aliveOnly`;
   `peer/send` puts the requested `priority` on the frame and `"next"` when none was asked for, refuses an
   over-cap message with `-32602` naming the measured size and the limit, sets no `hop-chain` attribute,
   mints a UUID `msgId`, refuses an ambiguous target with the matches listed, refuses `fromThreadId` on a
   fleet thread with `-33006`, and returns `delivered: false` — plus `statusReachable: false` for a target
   in another namespace. **`from-mode` is `"prompting"` on every send, including one attributed to a
   `bypassPermissions` thread**, and `fromThreadId` changes only `from-session` and `from-name`. A receipt
   arriving for that `msgId` reaches the sending connection as `peer/messageStatus` and is dropped when
   that connection is gone.
4. `npx vitest run test/unit/appserver/peer-inbound.test.ts` — the three outcomes, each as its own row:
   a replayed peer frame broadcasts `thread/peerMessage` in ALL of them, exactly once, carrying the
   origin verbatim including `verifiedPeerPid` and `msg_id`; frames arriving while the thread is idle
   adopt a turn (turn id minted, `turn/started` broadcast carrying the origin when an unconsumed arrival
   is on record and omitting it otherwise), and that turn settles on the unclaimed-result hook; frames
   arriving while a client turn is running adopt NOTHING, so the folded case leaves exactly one turn; two
   arrivals followed by one adopted turn produce one turn, not two. A replayed **non-peer** frame is
   ignored and produces no item events. An adopted turn emits an id-stable `userMessage` item so the live
   view matches what `thread/read` projects from the transcript. `closing` blocks new adoptions, and
   interrupt/close/shutdown settle an adopted turn through the same flush a client turn takes.
5. `npx vitest run test/unit/appserver/peer-policy.test.ts` — `crossSessionInbound` is written explicitly
   at `thread/start` for every value including the default; it is stripped from a client's `extraArgs` and
   from the `extraOptions` hatch, as is `replay-user-messages`; `thread/settings/apply` REFUSES it with
   `-32602` naming the key; `thread/crossSessionInbound/set` changes it and is refused on a fleet thread
   with `-33006`; and `initialize`'s result carries `crossSession: true`.
6. `node scripts/drift-check.mjs` from `CC-to-SDK/` — exit 0, with the new methods rowed and the
   notifications rowed, and `docs/parity/full-potential.md`'s stale 🚫 row for cross-session receive
   replaced by a scored row (the capability re-enters the denominator).

Keyed (gated live, `test/live/appserver-cross-session.test.ts`):

7. The whole loop against a real engine, on an IDLE receiver: the server starts a thread with
   `crossSessionInbound: "accept"`, `peer/list` shows that thread's own row with its `threadId`,
   `peer/send` addresses it, and the subscriber sees `thread/peerMessage` → `turn/started` → its items →
   `turn/completed`, with the model's reply naming the sent token. `unmatchedResults` is unchanged at the
   end, which is what says the adopted turn's result was consumed rather than dropped.
8. The fold leg, which is the one no unit test can fake: the receiver is given a turn with several
   sequential tool calls, the message is delivered mid-turn, and the client sees `thread/peerMessage`
   **and exactly one turn** — no second `turn/started`, no orphaned turn id, and the running turn's own
   completion carrying the model's answer to both prompts.
9. The negative leg: the same send into a `crossSessionInbound: "refuse"` thread produces no
   `thread/peerMessage`, no turn, and no receipt — silence on both channels is the measured contract.

## Decision Log

- **Machine-wide population, not just hosted threads.** Rejected: scoping to this server's own threads —
  it duplicates `fleet/list` and throws away the reach that makes the surface worth having (the user's own
  TUI session is the most interesting peer on the machine).
- **Gateway sends; `fromThreadId` attributes.** Rejected: thread-scoped-only sending (Codex's shape) —
  a UI client would have to create a thread merely to speak, and `from` must be the gateway's address
  anyway because that is where receipts can land. Rejected: gateway-only with no attribution — the
  receiving side could then never tell which of our threads spoke.
- **The gateway asserts `prompting` on every send, with no way for a client to change it** (owner-resolved
  fork, then hardened in rev 2). Rejected: a client-declared `asMode`. Also rejected, and this is the rev-2
  correction: letting `fromThreadId` carry the named thread's real class — a client can create its own
  `bypassPermissions` thread and pass its id, which is the same escalation with one setup call in front of
  it. The cost is stated on the wire: every send from this server is held by a bypass peer, and immediate
  delivery would need a sender that genuinely holds the class.
- **Arrival and execution are separate events** (rev 2, forced by probes 118/118b). Rejected: rev 1's
  one-replay-one-turn model — measurement showed a message can be folded into a running turn with no turn
  of its own, batched with others into one turn, or run as its own, and nothing at delivery time predicts
  which.
- **Settlement rides `onUnclaimedResult`.** Rejected: rev 1's `adoptTurn(uuid)` (peer results carry no
  uuid) and its router-driven belt (frame subscribers run before waiter resolution, so the belt would have
  won every race and become the only path). Rejected: a waiter declaring origin `"peer"` — the same event
  yields `peer` or `task-notification` depending on timing the host does not control.
- **`crossSessionInbound` is reserved in `thread/settings/apply` and gets its own setter.** Rejected:
  leaving the generic settings RPC open — it writes the identical flag layer at runtime, so guarding only
  startup argv guarded half the door.
- **`initialize` publishes `crossSession: true`.** Rejected: shipping the field without a marker — a plain
  `z.object` strips it, so a new client asking an older server for `refuse` would believe it was protected
  and not be. The repo already learned this once with `dynamicTools`.
- **A namespace mismatch is disclosed, not hidden.** Rejected: binding a gateway per namespace now (no
  measurement says multiple namespaces occur in practice) and rejected: silently sending as if status
  would follow.
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

### Findings rejected, with reasons

- **A 10K-token ceiling on model-visible injected items** — the rule is `AGENTS.md`'s, which marks itself
  the Rust rulebook and whose sibling clause names a Rust path (`core/context`, `ContextualUserFragment`).
  This repository adjudicated the same misapplied import once already during M7. What survives from the
  finding is narrower and is stated in the wire design: inbound size is bounded only by the CLI's own line
  cap, which is why `refuse` is the default.
- **"`next` injects mid-turn, so a busy receiver never gets its own turn"** — half right, and the half it
  missed is worse. Measurement showed all three priorities can produce a separate turn AND that any of them
  can be folded into the running one; the deciding factor is whether the model takes another round-trip,
  which no host can predict. The design answers the general case rather than the priority.

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
- **Only the head waiter receives non-result frames**, and a fix for that was overtaken by a better
  question. Reading `session.ts` while writing rev 1 turned up that every frame except a result goes to
  `waiters[0]` and nowhere else, so adoption's first draft — which pushed its waiter to the back — would
  have streamed a peer turn's output into a queued client turn's mapper. Rev 1 corrected it to an unshift.
  Rev 2 deleted the waiter entirely, because measurement showed there is often no separate peer turn to
  own frames in the first place. The lesson is not the unshift: a careful fix inside a wrong model is
  still inside the wrong model, and only measuring the model's premise exposes that.
- **The same event has three shapes, and the host cannot tell which is coming.** An inbound message is
  its own turn, a follow-up turn, or invisible — folded into whatever turn was running, answered in the
  same reply, with no second result anywhere. This is the measurement that replaced half the design, and
  the tell is that the reference source and the first probe *disagreed*: the source said `next` drains
  mid-turn, probe 118 saw a separate turn, and both were right because 118's receiver happened to end its
  turn early. Two sources agreeing would have hidden it; two disagreeing is what exposed it.
- **A probe can manufacture its own finding.** Probe 118 reported that no result frame carries a
  `user_message_uuid` — true of that run, and caused by the probe pushing user objects with no uuid of
  their own. 118b stamped them the way the harness does and its own turns correlated perfectly, while the
  peer turn still carried none. The real finding survived; it just needed a run that could not have
  produced it by accident.
- **Decompiled reading is a hypothesis, not a measurement.** Reading the minified SDK concluded that
  `Options.settings` as an object would serialize to `"[object Object]"`, which would have meant a live
  latent defect in the harness's autocompact path. Intercepting the real argv (117c) showed it emits
  proper JSON. The reading was careful and wrong; the cheap interception settled it in one run.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- **rev 1 (2026-08-26)** — first draft, written after the grill and probes 117/117b/117c, with the one
  presented fork resolved to the recommendation.
- **rev 2 (2026-08-26)** — absorbs an adversarial review of rev 1 (twelve findings: ten adopted, two
  rejected with reasons above) and the two probes it forced. The inbound half is rewritten: arrival and
  execution are separated, adoption triggers on frames-while-idle rather than on the replay frame, and
  settlement moves to a new `Session.onUnclaimedResult` seam, retiring both `adoptTurn(uuid)` and the belt.
  `fromThreadId` loses its ability to confer a permission class. `thread/settings/apply` reserves the
  policy key and a dedicated setter replaces it; `initialize` gains a `crossSession` marker. The gateway
  gains a retention policy for its correlation map and discloses namespaces it cannot receive status from;
  envelope attributes are escaped rather than interpolated.
