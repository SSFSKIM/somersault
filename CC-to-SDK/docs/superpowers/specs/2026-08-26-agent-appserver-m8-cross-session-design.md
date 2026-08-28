# M8 — cross-session messaging: the gateway, the roster, and the adopted turn

**Date:** 2026-08-26 · **Owner approval:** presented 2026-08-26, approved with the one open fork resolved
to the recommendation (the gateway asserts `prompting`, and clients cannot declare a class).
**Grounding:** `docs/superpowers/specs/2026-08-22-m6-cross-session-messaging-grounding.md` (the mechanism
pass) · probe 113c (`probes/probes/113c-cross-session-inbound-envelope.ts`, keyed 2026-08-25:
ADDRESSABLE) · probes 117 / 117b / 117c (the four host seams) · probes 118 / 118b (the three outcomes of
an inbound message) · probes 119 / 119b (the engine's own per-message lifecycle frames), keyed
2026-08-26/27.
**Branch:** `m8-cross-session`, off `f69d1e28e4`.
**Rev 5** — three adversarial review rounds, and one late measurement that simplified the result. Round 1 (twelve findings, ten adopted) forced probes 118/118b,
which replaced the whole inbound half; round 2 against that rewrite returned fifteen more, of which the
sharpest was an internal contradiction rev 2 had left standing — one paragraph still said `fromThreadId`
carries a thread's real permission class, which would have rebuilt the escalation the same rev claimed to
close. Rev 3 also gives adoption the explicit state it needed (`peerPending`, an
epoch-stamped turn id, a claiming settlement hook, and explicit cancellation) rather than deriving it from
`record.busy`.
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
| The CLI emits an undeclared **`command_lifecycle`** frame per queued message — `{command_uuid, state, session_id, uuid}` — bracketing every turn as `started` … `terminal`, and a peer-delivered message gets `started` with **no preceding `queued`** (119b) | Execution is an engine STATEMENT about a specific message, not something to infer. Adoption keys on a `started` naming a uuid this server did not submit; settlement on that uuid's terminal. |
| A host turn pushed into a busy engine can be **folded and answered inside the running turn**, producing no result of its own (119) | The app-server's server-side queue is load-bearing, not a convenience — pushing into a busy engine can strand a turn whose waiter never settles. |

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
  statusReachable: boolean;   // false when this peer's socket namespace differs from the gateway's, so
                              // no peer/messageStatus can ever come back for a send to it
}
```

The gateway itself never appears here, and that follows from a decision rather than a filter: it
publishes a key file and no registry row, so nothing scanning `<claudeConfigDir()>/sessions/*.json` can
see it.

Read from **`<claudeConfigDir()>/sessions/*.json`**, never a hardcoded `~/.claude`: this harness already
resolves that root through `config/claudeHome.ts` (which handles `CLAUDE_CONFIG_DIR` REPLACING the home
path, the empty-variable case, and NFC normalization), and `config/tenantPreset.ts` gives each tenant its
own. Scanning the literal home directory under a tenant preset would list the wrong namespace's peers,
omit the right ones, and — for the gateway's key file — publish vouching material where no receiver looks.
Fields beyond `address`/`alive`/`inboxBound`/`threadId` are
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
}  ->  { msgId: string; address: string; targetSessionId?: string;
         delivered: false; statusReachable: boolean }
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
with nothing raised anywhere. The assembler escapes each value, but "use the CLI's XML rules" is not a specification — the receiver
compares a canonical *reserialization* byte-for-byte, and a unit test written from the same guess as the
implementation passes while hostile attributes still downgrade in production. So the exact byte mapping is
a **spike with a hard fallback**: one probe delivers a message per permitted special character
(`" & < > '`, plus CR, LF and tab) into a live inbox and records which spelling survives parse-and-compare,
and the measured table is written into the spec before the assembler is built. Until a character is
measured to survive, values containing it are **refused** (`-32602`, naming the character) rather than
sent — an over-strict refusal is recoverable, a silently downgraded envelope is a permission decision made
on wrong information.

**`from` is always the gateway's own address**, never a thread's. It is the reply route, and receipts come
back over a connection whose pid the kernel checks: no other value could receive them.

**`fromThreadId` changes attribution only** — `from-session` (that thread's `sessionId`, a navigation
target) and `from-name` (its name). It does NOT touch `from-mode`; see the class rule below, which is the
single place that attribute is decided.

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
import), so it is not a conformance gap here. What remains true is narrower and worth acting on, and it is stated here as a property of the surface
rather than buried: **`accept` is an uncontrolled trust boundary.** The only bound on inbound size is the
CLI's own line cap, whose value we have not measured; several accepted arrivals batch into one model
request; and there is no seam between the socket and the model's context where this server could
intervene — by the time the replayed frame reaches us, the body is already input. So a same-user process
that a thread has accepted can spend that thread's context and tokens up to the CLI's own limit, and the
only control this server holds is the binary one: whether the thread accepts at all. That is what makes
`refuse` the default rather than a preference, and it is what a client turning a thread to `accept` is
consenting to. Measuring the CLI's line cap is a follow-up worth doing (one bisecting probe against a live
inbox) — it would let `peer/list` publish the real ceiling — but it would sharpen the disclosure, not
change it: the enforcement point belongs to the CLI either way.

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
thread/peerMessage { threadId, arrivalUuid, origin: { kind: "peer", from, verifiedPeerPid?, name?,
                     fromMode?, fromSession?, body?, msg_id? }, receivedAt }
```

**There is no `turnId` here, and there cannot be.** This event fires at arrival, and at arrival the
message's fate is undecided — it may fold into a running turn, batch with others, or cause a turn whose id
does not exist yet. A `turnId` field would have to be fabricated, delayed, or left null, all three of
which are worse than not promising it. `arrivalUuid` is the replayed frame's own uuid: it is the id of the
`userMessage` item this arrival produces, so a client deduplicates against `thread/read` with it, and
`origin.msg_id` correlates back to a `peer/send`. A client that wants the turn watches the thread's turns
like any other observer.

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

**The gateway has one namespace, and the server declares it.** A peer namespace is the pair
(socket directory, config root) — the socket directory because the receipt sender refuses any reply
address outside the receiver's own, and the config root because that is where the vouching key must be
published for a receiver to find it. Both are per-process values a hosted thread could in principle
differ on: `config/tenantPreset.ts` gives each tenant its own `CLAUDE_CONFIG_DIR`. So the server resolves
ONE namespace at startup — `claudeConfigDir()` and the socket directory derived from it — and **refuses
to host peer methods at all when a thread is started under a different config root**, answering `-33008`
and naming the mismatch. One honest refusal beats a roster that silently lists the wrong tenant's peers
and a key no receiver will ever read. Binding per-namespace gateways is a later option, deliberately not
this milestone.

Within that namespace: one socket at `<socketDir>/<our pid>.sock`, where `socketDir` comes from a hosted
session's own `messaging_socket_path` when one is known and otherwise from
`${XDG_RUNTIME_DIR||/tmp}/cc-socks`. Alongside it, one key file at
`<claudeConfigDir()>/sessions/<pid>.<sha256(socket path)>.key` containing a freshly minted 32-hex
`peerToken` and our `procStart`. **No registry row**: a key alone vouches, and publishing a row would put
the app-server in every session-listing tool on the machine as if it were a session.

`statusReachable` is therefore a two-part test, not a directory comparison: a peer is status-reachable
when its socket sits in our socket directory AND it resolves the same config root we publish our key
under. A peer that fails either can be sent to and can never answer.

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
grow the map without bound. Retention cannot be derived from this process's environment: the hold deadline belongs to the RECEIVER,
which may run with its own `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`, so a TTL computed from ours could expire
before a status this server was still owed. The bound is therefore an **absolute protocol-level retention window of 30 minutes** — six times the
CLI's 5-minute default hold deadline, fixed here rather than computed from a local value so a client can
know how long correlation is meaningful. Alongside it: a connection's entries are dropped when it closes;
**256 entries per connection and 4096 across the server**, oldest-first. **Eviction is never silent** — an entry dropped by a cap or
by the window notifies its still-live sending connection with a terminal `peer/messageStatus` of status
`dropped` and a reason naming the eviction, because a client that will never hear again should be told
that, not left waiting. `held` is explicitly **not** terminal —
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

### Inbound policy: one owner, four doors

The resolved policy is written into the thread's settings through the existing `config.settings` seam
(`config/settings.ts`), which probe 117c confirmed reaches argv as real JSON.

**`--replay-user-messages` is passed on EVERY hosted thread, not only on threads that opt in.** That looks
like over-reach until you follow the setter: the flag is startup-only argv, so a thread launched at
`refuse` and later moved to `accept` could take peer input the model acts on while this server sees no
arrival frame at all — invisible injection, and the worst possible failure for a surface whose whole job
is to make inbound traffic visible. Passing it always costs an extra echo of our own prompts, which the
router already filters, and removes the possibility outright.

**The policy lives on `ThreadRecord`, and a replacement engine is BUILT with it — not corrected
afterwards.** The rewind/reopen/clear family replaces the engine, and a replacement built from the launch
config would silently restore the launch policy, including re-opening a thread a client had explicitly
moved to `refuse`. Re-pushing after the swap is not enough and is the wrong shape twice over: the swap
spine starts the replacement and installs its router before the re-push lands, so there is a real window
in which a fresh engine runs the LAUNCH policy and can take peer mail; and a re-push is best-effort, so a
rejection would leave the launch policy in force permanently — failing exactly when the policy matters
most. So the record's current policy (and the unconditional replay flag) go into the replacement's startup
config, before the process exists. Any later re-push is reconciliation, never the mechanism.

Four doors let something other than that owner decide, and all four are shut:

1. **Startup options, through every carrier there is.** A client's settings can reach the CLI by more
   routes than one, and a guard that covers some of them covers none: `config.settings`,
   `extraOptions.settings` (and `extraOptions` is spread LAST in `resolveOptions`, so it wins),
   `extraArgs.settings`, `extraOptions.extraArgs.settings` (which REPLACES the sanitized top-level map
   rather than merging with it), and the `settings=<json>` equals-encoding of either argv form. The rule is
   therefore stated as one **effective-options sanitizer** that runs AFTER the final merge, walks every one
   of those carriers, and reasserts the server's policy on whatever survived — not a per-carrier patch, and
   not a strip: it is a **merge**.
   Removing the whole `settings` key would silently delete unrelated SDK settings a client legitimately
   sent, turning a policy guard into a configuration regression. The rule is narrow: parse the client's
   settings, overwrite `crossSessionInbound` with the server's value, leave every other key untouched, and
   refuse with `-32602` when the client's raw `--settings` cannot be parsed rather than dropping it. A
   client-supplied `replay-user-messages` is likewise redundant now that the flag is unconditional, so it
   is dropped without ceremony — noted here because it is a real, if harmless, takeover of a flag a client
   could previously pass.
2. **`thread/settings/apply`, after startup.** Its params are `z.record(z.string(), z.unknown())` — an open
   record — and the handler forwards it to `Session.applyFlagSettings`, which writes **the very layer this
   design relies on**, at runtime, with no mirror write and no `thread/settings/changed` broadcast. Any
   initialized connection could turn another thread's `refuse` into `accept` and then feed it.
   `crossSessionInbound` is reserved there: refused with `-32602` naming itself, because silently ignoring
   it would be worse than the refusal.
3. **The dedicated setter — measured, and narrowed to the direction that moves (rev 7).**
   `thread/crossSessionInbound/set` was specified through rev 5 as the way a policy changes at runtime:
   inProcess-only, serialized through `record.chain`, engine-first and committed to the record only after
   the engine accepts, broadcasting `thread/settings/changed` where the generic method deliberately does
   not. Rev 6 held it back as a spike. Probes 120 and 120b have now answered it, and it ships as a
   **monotonic tightening operation** — a ratchet.

   The claim the spike existed to test was that the CLI RE-READS `crossSessionInbound` off the live flag
   layer `applyFlagSettings` writes. Probe 102 had already shown that call resolves for values it never
   validates, so a resolved call could never be the evidence. Probe 120 measured it behaviourally, and
   120b completed the matrix over the whole vocabulary, each run carrying a control leg proving the send
   path worked and holding 113c's measured-good baseline fixed:

   | launch   | flip to  | pre-flip  | post-flip | moved |
   |----------|----------|-----------|-----------|-------|
   | `accept` | `refuse` | DELIVERED | REFUSED   | yes   |
   | `accept` | `hold`   | DELIVERED | HELD      | yes   |
   | `hold`   | `refuse` | HELD      | REFUSED   | yes   |
   | `hold`   | `accept` | HELD      | HELD      | no    |
   | `refuse` | `accept` | REFUSED   | REFUSED   | no    |
   | `refuse` | `hold`   | REFUSED   | REFUSED   | no    |

   Order the vocabulary by permissiveness — `accept` > `hold` > `refuse` — and the pattern is total: every
   TIGHTENING move takes effect, every LOOSENING move is silently ignored. The flag layer is re-read, but
   in one direction only. That reads as design rather than defect: a session may restrict its own inbound
   access at runtime but cannot grant itself more access than it launched with, which is the only safe
   direction for a value writable by anything that can reach that layer.

   So the setter applies a value equal-or-more-restrictive than the thread's current one, and REFUSES a
   loosening request with `-32602` naming both values and the alternative. The refusal is OURS, not the
   engine's: the engine ignores a loosening write silently, and a method that reported success for a
   change that did not happen is the one failure this door cannot have. The comparison is against the
   record's CURRENT value rather than its launch value because every measured leg flips exactly once, so
   the two readings are indistinguishable in this matrix — and current-value is the reading that is safe
   under both, at the price of occasionally refusing a request the engine might have honoured. A
   tighten-then-partially-loosen sequence (`accept` -> `refuse` -> `hold`) is therefore an explicitly
   UNMEASURED cell that our own ratchet refuses before the engine ever sees it.

   Loosening being unreachable at runtime is not a gap in the surface, because admission already covers
   it: the policy is decided at admission on BOTH spines (`thread/start` and `thread/resume` are different
   functions in this server) and reported on `thread/get`, so a client that wants a thread open to peers
   asks for it when the thread starts. Re-opening a running thread would need a replacement engine, which
   the rewind/reopen/clear family already performs; that is a later round's work, and it is named here
   rather than built.

   The setter lands on the canonical settings spine — the one `thread/settings/changed` payload shape that
   `broadcastSettings` and `routeSettingsMirror` both build — rather than inventing a second, partial one.

   A fourth door was found in the same pass and is closed unconditionally: the SDK types `Options.settings`
   as `string | Settings`, and a string there is a PATH to a settings file on disk. `resolveOptions`
   spreads `extraOptions` last, so an admitted path would replace the whole settings object,
   `crossSessionInbound` included. A path cannot be sanitized without rewriting a file this server does not
   own, so it is REFUSED with `-32602` rather than admitted — as is a `--settings` argv value that does not
   parse as inline JSON, for the same reason.


4. **Version skew.** `thread/start`'s params are a plain `z.object`, which strips unknown keys silently, so
   a new client asking an OLDER server for `refuse` gets a healthy thread that still runs mode parity —
   protection the client believes it has and does not. This is the exact failure the M7 `dynamicTools`
   marker exists to prevent, and its own schema doc says so. `initialize`'s result gains
   `crossSession: true` as a `z.literal(true)`: an older server sends nothing, absence is the signal.

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

**Split arrival from execution.** They are different facts, observable at different moments, and
conflating them is what produced every defect in rev 1.

**Arrival** is the replayed frame, and it is exact: it always fires, once per message, carrying the full
peer `origin` including `msg_id`, plus the frame's own uuid. `thread/peerMessage` is broadcast from there
and promises nothing about a turn.

**Execution** is stated by the engine, not inferred by us. The CLI emits a `command_lifecycle` frame per
QUEUED MESSAGE — a wire frame that appears in neither `sdk.d.ts` nor the reference source, and that this
project only found by dumping what probe 119 had recorded and not decoded:

```
{ type: "command_lifecycle", command_uuid, state, session_id, uuid }
```

`command_uuid` is the message's own uuid — the same one its replayed user frame carries. Measured
states: `queued`, `started`, and a terminal one. The frames bracket each turn exactly:

```
command_lifecycle { command_uuid, state: "started" }
system/init
user replay  (uuid === command_uuid; origin.kind === "peer" when the message came from the socket)
… the turn's output …
result
command_lifecycle { command_uuid, terminal state }
```

And the distinguishing fact: **a peer-delivered message gets `started` with no preceding `queued`** — it
entered through the socket rather than through this server's stdin, so it never passed the stdin queue
that emits `queued`. This server knows every `command_uuid` it submitted (they are its own minted turn
uuids), so:

- **`started` naming a `command_uuid` this server did not submit → a turn began that is not ours.** Adopt.
- **A terminal state for that `command_uuid` → that turn ended.** Settle.

Both are engine statements about a specific message. No timing window, no "production while we believe
idle", and no dependence on `record.busy` being accurate across a settlement boundary — which is what
three review rounds kept, correctly, refusing to accept.

The design treats the terminal state as **any state that is not `queued` or `started`**, rather than
matching a name. The run that measured this had its turns fail immediately (the account was
weekly-limited), so the terminal state observed was `cancelled`; a healthy turn's name is a
**delegated unknown**, named here and closed by the first keyed acceptance run, and a design that matched
`"completed"` literally would break on exactly the failure path it most needs to survive.

Two leaves are likewise unmeasured and named rather than assumed, both closable in one keyed run: what
lifecycle a FOLDED message gets (it has no turn of its own — most likely `started` and a terminal around
the running turn, or a terminal alone), and whether a BATCH emits one bracket per `command_uuid` around
one turn. The adoption rule above is written to survive either answer: it adopts on the first unfamiliar
`started` while no adoption is open, and settles on the terminal of the `command_uuid` it adopted, so
extra brackets for sibling messages neither mint extra turns nor settle the wrong one.

#### The states, because `busy` alone is not enough

Keying on the engine's own per-message frames removes the window rev 3 had to reason about, but adoption
still needs state of its own — a turn has an id, subscribers, and a settlement, none of which live in a
frame. It sits on the record alongside `busy` rather than inside it:

- **`peerPending`** — a FIFO of unconsumed arrivals (uuid, origin, receivedAt), **capped at 32 per
  thread**. Written synchronously by the arrival route. At capacity the OLDEST entry is dropped and a
  `warning` is broadcast naming the thread and the count: the newest arrivals are the ones a turn is about
  to consume, and silently forgetting either end would leave an arrival with no lifecycle. The cap is a
  bookkeeping bound, not a delivery bound — the CLI has already admitted those messages either way, which
  is the honest limit of what this server can promise and is stated as such under the message cap.
- **`adoptedCommandUuid`** — the `command_uuid` of the turn currently adopted, or absent. Set on the
  `started` that adopted it, cleared on that same uuid's terminal frame. It is what makes settlement
  address a specific turn rather than "whatever ended", so a sibling message's terminal frame cannot
  settle it.
- **`adoptedTurnId` + `epoch`** — the adopted turn's identity, epoch-stamped like every other engine-bound
  state here, so a result arriving after a swap cannot settle a turn belonging to the engine before it.

**Adoption happens BEFORE the turn produces anything, which is the quiet gift of keying on the lifecycle
frame.** `started` arrives ahead of the turn's `init`, its replayed user frame and every item, so the
mapper and runner are in place before there is anything to miss. Rev 3 had to buffer the triggering frame
precisely because it adopted on the first assistant frame — by then the frame that proved the turn existed
had already gone by, and `beginTurn` builds its runner inside `record.chain.then`, so a held chain could
let output or even the result land first. Nothing needs buffering now. That deletion is the clearest
measure of what the engine signal bought.

**Settlement is the adopted `command_uuid`'s terminal frame** — but the turn's OUTCOME still has to come
from somewhere, and the lifecycle frame carries none. That is what the claiming hook is for.
`Session.readLoop` reaches a point where a result frame matched no waiter (`session.ts:392`, today just
`_unmatchedResults++`), which is precisely what a peer turn's result is. `Session` gains:

```ts
onUnclaimedResult(cb: (result: unknown) => boolean): () => void
```

The callback returns whether it **claimed** the result. A claimed result supplies the adopted turn's
outcome and does not increment `unmatchedResults`; an unclaimed one increments it exactly as today, so the
counter keeps its job as the tripwire for results nobody owns. The lifecycle terminal is what CLOSES the
turn; the claimed result is what fills in how it went. A turn whose terminal arrives with no result
claimed settles anyway, reported `failed` — an outcome the engine declined to describe is still an
outcome, and a thread left open waiting for one is the failure this whole section exists to prevent. A boolean rather than `void` is the difference between a hook and
a guess: without it the design could not tell a consumed result from a leaked one, which is the whole
reason the counter exists.

This replaces rev 1's waiter **and** its belt. The belt had to go regardless: `readLoop` calls every frame
subscriber *before* it resolves a matching waiter (`session.ts:373` vs `:388-390`), so a router-driven
"has my waiter fired yet?" fallback observes it unfired every time and wins unconditionally — the rescue
path would have become the only path.

**The degraded case needs no special path any more.** An accepted peer turn that dies on an API or
transport error still gets its `started` and its terminal — the run that measured these frames was exactly
that case, every turn failing on a usage limit — so it is adopted and settled by the ordinary rule, with
the failure carried by whatever result the hook claims. Rev 3 needed a late-adoption branch only because
its trigger was the model's own output, which a turn that dies before producing any never emits.

### Interrupt, close, and shutdown

An adopted turn is a real turn, but it is not backed by a client `submit()` promise, so nothing in the
existing teardown rejects it: `thread/close` and `shutdown` flush `record.queue` and then dispose, relying
on disposal rejecting waiters that an adopted turn does not have — and `onUnclaimedResult` never fires
when disposal ends the stream with no result at all. So adoption gets an **explicit cancellation**, called
before the router is torn down and before the record is deleted, which settles the adopted turn
`cancelled` and clears `adoptedCommandUuid`. It is epoch-guarded, so a lifecycle terminal or result
arriving afterwards settles nothing.

Three further rules the existing paths cannot infer:

- The `closing` latch **blocks new adoptions**. A `started` arriving on a closing thread is not a turn
  this server will announce; adopting one would emit `turn/started` after `thread/closed`.
- Unconsumed arrivals are dropped at close with no notification of their own. They were announced when
  they arrived; a second event about a message that will now never run would be inventing an outcome.
- `turn/interrupt` on an adopted turn interrupts the ENGINE's turn, which is the peer's, not the
  interrupting client's. That is worth stating on the wire, because the client did not start it.

### Live and replayed views must agree — one item per arrival, in every outcome

**The premise this section opened with was wrong, and the keyed run (2026-08-28) inverted its
conclusion.** It read: the projection turns every persisted top-level user prompt into a `userMessage`
item, with no `isMeta`, `origin` or `isReplay` filter available to it, "the persisted rows carry no such
flags", so `thread/read` will show a peer prompt as a `userMessage` whatever the live path does and the
live path's only job is to match it.

That conflated two different statements. What `sessions/rows.ts` and probe 68b establish is that the
rows the READER RETURNS carry no such flags. The rows ON DISK carry both: a peer arrival is persisted as
a `type:"user"` row with `isMeta: true` and a full `origin`. And the SDK reader behind `thread/read`
(`getSessionMessages`, a passthrough in `sessions/reader.ts`) DROPS every `isMeta` row outright and
projects what remains onto a fixed shape — `message, parent_agent_id, parent_tool_use_id, session_id,
timestamp, type, uuid` — so `origin` cannot survive either. Probe 107 measured exactly this on
2026-08-12, six weeks before this design was written, on two independent real transcripts; nothing here
connected that finding to the peer-arrival path until a live leg tried to read one back.

So the conclusion is the opposite of what was written: `thread/read` shows a peer arrival **not as a
`userMessage`, but not at all**. There was never an item for the live path to match. A client watching
live sees the arrival, the turn and the model's answer; the same client calling `thread/read` afterwards
gets the answer with no question in front of it. For a FOLDED arrival it is worse — the keyed run found
those persisted nowhere at all, against a positive control on the same read — so the
`thread/peerMessage` notification is the ONLY record of them that will ever exist, live or cold.

**What this does and does not change.** The rule below is unaffected and stays exactly as stated: it is a
rule about what the LIVE path emits, and the live legs verify it directly. The cold half — the
`peerArrival` branch Tasks 10c and 10d put into `items/replay.ts` — is correct and currently UNFED: run
the real rule over the real on-disk row and it reproduces the live item byte for byte, id included, which
a live leg asserts; it is the reader in between that removes the row. That branch is therefore not dead
code to delete but a correct decoder one reader away from mattering, and deleting it would mean
re-deriving the rule the day the reader changes. Making `thread/read` show inbound peer messages needs a
reader that does not drop `isMeta` rows, which is its own round's work and is not attempted here.

The rule is therefore stated on the arrival, not on the turn: **every peer arrival emits exactly one
`userMessage` item, id-stable on the replayed frame's uuid — the same `arrivalUuid` the notification
carries.** That holds in all three outcomes, which is precisely what tying it to the turn would have
broken: a folded arrival produces no adopted turn but still persists a prompt, and N batched arrivals
produce one turn but N prompts. Emitting per-turn would have under-produced in both cases.

Ownership follows the outcome without changing the count, and so does ORDER — which follows the
protocol's existing rule rather than inventing one. Every turn on this wire publishes its edge before its
items (`beginTurn`, and subscribe-time replay, both do), so an adopted arrival is
`thread/peerMessage` → `turn/started` → the `userMessage` item → the model's items. Emitting the item
first would hand a client an item belonging to a turn id it has not been told about, and live order would
disagree with replay order. For a FOLD there is no edge to precede: the turn already began, so the
notification and the item are emitted against the running turn, in that order. The mapper stays out of it
entirely — its `onUser` reads `tool_result` blocks only, and a unit row pins that so a future change
cannot start fabricating a second item from the same frame.

### Where the code lands

`src/peer/gateway.ts` (socket, key file, receipt parsing), `src/peer/address.ts` (grammar, namespace
checks, envelope assembly — pure, so its byte-exactness is unit-testable without a socket),
`src/peer/roster.ts` (registry read + liveness), `src/peer/receipts.ts` (the correlation map and its
retention rules), `appserver/peerDomain.ts` (`peer/list`, `peer/send`),
`appserver/peerInbound.ts` (arrival notification + the adoption state machine),
`appserver/peerPolicy.ts` (the settings injection and the key
reservation `thread/settings/apply` enforces), `appserver/schema/peer.ts` (registered in `methodSchemas`, with
`result` shapes published — M5's D-M5-19 convention), and the handlers registered in `server.ts` beside
`fleet/list` and `thread/attach`. One change lands outside the domain: `Session` gains
`onUnclaimedResult` at `session.ts`'s existing unmatched-result site. Named `peerDomain`/`peerInbound`
because `appserver/peer.ts` is the JSON-RPC framing class and the collision is a known trap.

`peer/list` and `peer/send` are **server-scoped**: they name no thread and bypass the engine-gone and
origin gates, like `fleet/list` and `config/*`. `thread/crossSessionInbound/set`, if probe 120 licenses it, lands beside the other three setters in `appserver/settings.ts` rather than in `peerPolicy.ts` — it is a settings mutation, and this server has exactly one `thread/settings/changed` payload shape, built by `broadcastSettings` and `routeSettingsMirror` together. It is thread-scoped and
inProcess-only. Errors reuse `-33008` (documented as the fleet-operation code "named for its first user")
for gateway and delivery failures, and `-32602` for an ambiguous target, an over-cap message, or a
reserved key offered to `thread/settings/apply`.

## How this lands, in reviewable stages

The evidence and the architecture are separable and should be reviewed separately: the probes are read
by checking them against a live engine, the design by checking it against the probes. Three stages, each
its own diff:

1. **The host-seam probes** (117 / 117b / 117c) — the gateway's shape, the policy injection route, and the
   stream-visibility flag.
2. **The outcome probes** (118 / 118b / 119 / 119b) — what an inbound message actually does to a session,
   and the corrections their own first runs earned.
3. **This design**, which synthesizes them.

Implementation then follows the plan, which cuts the same way: the outbound half (`peer/list`,
`peer/send`, the gateway, the receipt channel) is independently useful and independently reviewable, and
the inbound half (policy, arrival, adoption) lands after it.

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
4. `npx vitest run test/unit/appserver/peer-inbound.test.ts` — the three outcomes, each as its own row.
   **One `userMessage` item per arrival in every outcome**, id-stable on `arrivalUuid`: one for a folded
   arrival (which has no adopted turn), N for N batched arrivals under one adopted turn, and the item
   always follows its turn's `turn/started`. The lifecycle key's own rows: a `command_lifecycle`
   `started` naming a uuid this server SUBMITTED adopts nothing, one naming an unfamiliar uuid adopts, and
   a terminal frame settles only the `command_uuid` actually adopted — a sibling's terminal leaves the
   adopted turn open. A `started` on a `closing` thread adopts nothing. `onUnclaimedResult`
   returns true exactly once per adopted turn, leaving `unmatchedResults` unchanged; a result it does not
   claim still increments it. A result-only failure on an idle thread with a pending arrival is
   late-adopted and settled `failed` in one step. An epoch-stale result settles nothing. Close and
   shutdown cancel an adopted turn explicitly, emitting `turn/completed {status:"cancelled"}` BEFORE
   `thread/closed`, and `closing` blocks new adoptions. Then, as before:
   a replayed peer frame broadcasts `thread/peerMessage` in ALL of them, exactly once, carrying the
   origin verbatim including `verifiedPeerPid` and `msg_id`; frames arriving while the thread is idle
   adopt a turn through `beginTurn` — so its `turn/started` payload is the ordinary
   `{threadId, turn}` and carries no origin field (rev 6: `beginTurn` has no origin parameter, and a turn
   edge that differs by how the turn was caused is a shape every subscriber would have to special-case) —
   and that turn settles on the unclaimed-result hook, through `turnFailureOf`, so a failed result reports
   `failed` rather than `completed`; frames arriving while a client turn is running adopt NOTHING, because
   `beginTurn` refuses a busy thread, so the folded case leaves exactly one turn; two
   arrivals followed by one adopted turn produce one turn, not two. The trigger's narrowness has its own
   rows: `system/init`, `background_tasks_changed`, `rate_limit_event` and a nested frame carrying
   `parent_tool_use_id` each arrive on an idle thread and adopt NOTHING, so a session start does not mint
   a turn. A replayed **non-peer** frame is
   ignored and produces no item events. An adopted turn emits an id-stable `userMessage` item so the live
   view matches what `thread/read` projects from the transcript. `closing` blocks new adoptions, and
   interrupt/close/shutdown settle an adopted turn through the same flush a client turn takes.
5. `npx vitest run test/unit/appserver/peer-policy.test.ts` — `crossSessionInbound` is written explicitly
   at `thread/start` for every value including the default, and `--replay-user-messages` is passed even
   when the policy is `refuse`; a client's own `settings` are MERGED rather than dropped, with only
   `crossSessionInbound` overwritten and every other key surviving, and an unparseable client `--settings`
   refused `-32602` rather than silently discarded; `thread/settings/apply` REFUSES the key with `-32602`
   naming it. **The setter row is conditional on probe 120** (rev 6): if the CLI does re-read the key off
   the live flag layer, `thread/crossSessionInbound/set` changes it, broadcasts `thread/settings/changed`, updates
   the record before the engine, is refused on a fleet thread with `-33006`, and **survives an engine
   swap** — a rewind/reopen/clear re-pushes the record's policy rather than the launch config's, in both
   directions (a thread moved to `refuse` does not come back `accept`, and vice versa); and `initialize`'s
   result carries `crossSession: true`. **Every row in this file runs through `thread/resume` as well as
   `thread/start`** — they are separate spines today, so an implementation can secure new threads while
   resumed ones quietly keep mode parity and lose the replay flag, which is the invisible-injection case
   with a different door.
6. `node scripts/drift-check.mjs` from `CC-to-SDK/` — exit 0, with the new methods rowed and the
   notifications rowed, and `docs/parity/full-potential.md`'s stale 🚫 row for cross-session receive
   replaced by a scored row (the capability re-enters the denominator).

Keyed (gated live, `test/live/appserver-cross-session.test.ts`):

7. The whole loop against a real engine, on an IDLE receiver: the server starts a thread with
   `crossSessionInbound: "accept"`, `peer/list` shows that thread's own row with its `threadId`,
   `peer/send` addresses it, and the subscriber sees `thread/peerMessage` → `turn/started` → its items →
   `turn/completed`, with the model's reply naming the sent token. `unmatchedResults` is unchanged at the
   end, which is what says the adopted turn's result was consumed rather than dropped.
8. The separate-follow-up leg: the receiver is busy with a turn that will END without another model
   round-trip, the message is delivered mid-turn, and the client sees two balanced lifecycles — the
   client's turn completing, then an adopted `turn/started`/`turn/completed` pair for the peer turn whose
   result is uuid-less and carries `origin.kind: "task-notification"` — with no orphaned turn id and
   `unmatchedResults` unchanged. This path exists only against a real SDK; mocked frames cannot produce
   its ordering.
9. The arrival-only leg: after the replayed frame reaches the client as `thread/peerMessage`, the test
   pauses before any production and asserts that NO turn has started — arrival alone begins nothing.
10. The fold leg, which is the one no unit test can fake: the receiver is given a turn with several
   sequential tool calls, the message is delivered mid-turn, and the client sees `thread/peerMessage`
   **and exactly one turn** — no second `turn/started`, no orphaned turn id, and the running turn's own
   completion carrying the model's answer to both prompts.
11. The negative leg: the same send into a `crossSessionInbound: "refuse"` thread produces no
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

- **Adoption carries explicit state rather than reading `record.busy`** (rev 3). Rejected: deriving
  everything from `busy` — it is set synchronously at request arrival, so a same-tick client `turn/start`
  between a peer arrival and its first assistant frame makes the peer's production look like the client's,
  running two engine turns under one lifecycle.
- **`--replay-user-messages` on every hosted thread, not only on opt-in threads** (rev 3). Rejected:
  passing it only when inbound is accepted — the flag is startup-only argv, so a thread later moved to
  `accept` would take peer input the model acts on while this server saw no arrival frame at all.
- **The server MERGES a client's settings instead of stripping the key** (rev 3). Rejected: rev 2's
  wholesale strip, which would have deleted unrelated SDK settings a client legitimately sent — a
  configuration regression wearing a policy guard's clothes.
- **One `userMessage` item per ARRIVAL, not per turn** (rev 3). Rejected: emitting per adopted turn — a
  folded arrival has no turn and still persists a prompt, and N batched arrivals share one turn, so
  per-turn emission under-produces in exactly the two cases the transcript will disagree about.
- **The escaping byte mapping is measured before it is implemented, and unmeasured characters are refused**
  (rev 3). Rejected: writing the assembler from the CLI's rules as read — the receiver compares a canonical
  reserialization, so a test written from the same guess as the code passes while production downgrades.
- **Receipt retention is an absolute protocol window, and eviction notifies** (rev 3). Rejected: a TTL
  derived from this process's `dialogExpiry` — the hold deadline belongs to the receiver, which may run
  with a different one, so ours could expire before a status we were still owed.
- **`thread/peerMessage` carries no `turnId`** (rev 3). Rejected: including one — at arrival the message's
  fate is undecided, so the field could only be fabricated, delayed, or null.
- **Considered and not taken: shipping the outbound half alone.** A notify-only M8 — `peer/list`,
  `peer/send`, the policy, and an arrival notification with no turn adoption — would drop most of the
  machinery above, and it was weighed seriously once the three-outcome measurement landed. It loses the
  half that makes receiving useful (a client would be told a message arrived and then have to poll
  `thread/read` to learn what it did), and the owner's grill answer chose the full receive side
  deliberately. Recorded here because the measurement changed that choice's cost, and a later reader
  should see the fork was live rather than assume it was never considered.

- **The runtime policy setter ships as a ratchet, not as a two-way switch (rev 7).** Probes 120 and 120b
  measured every transition in the `accept`/`hold`/`refuse` vocabulary and found tightening honoured and
  loosening silently ignored. Three options were open. *Ship both directions* was rejected outright: it
  would report success for a change the engine ignores, which is the specific failure the spike existed to
  prevent. *Ship nothing* (rev 6's provisional position, and plan Task 11's verdict B) was rejected
  because the direction that does work is the safety-critical one — revoking a thread's inbound access
  while it runs — and it works retroactively, denying messages already held. *Ship the measured direction
  and name the missing one on the wire* was taken, which is plan Task 11's verdict C applied literally.
  The cost is a client that opened a thread refusing cannot open it later without a new thread; that cost
  is visible in an error message rather than hidden in a no-op.

### Findings rejected, with reasons

- **A 10K-token ceiling on model-visible injected items** — the rule is `AGENTS.md`'s, which marks itself
  the Rust rulebook and whose sibling clause names a Rust path (`core/context`, `ContextualUserFragment`).
  This repository adjudicated the same misapplied import once already during M7. What survives from the
  finding is narrower and is stated in the wire design: inbound size is bounded only by the CLI's own line
  cap, which is why `refuse` is the default.
- **"Rev 2 overstates what 118b measured about priorities other than `next`"** — accepted as a *scoping*
  correction rather than a defect, and the spec now says only what was run: the fold was forced and
  observed on `next`. Whether `now` and `later` fold identically follows from the same drain (`later` is
  drained only on a Sleep-tool iteration) but was not measured, and the design does not depend on it —
  adoption keys on production, not on priority.
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
- **The persisted peer `origin` carries `msg_id`, which the SDK does not declare.** Measured on this
  machine's own transcripts (2026-08-27): a persisted cross-session row's `origin` holds
  `{kind, from, fromMode, name, body, verifiedPeerPid, msg_id}`, while the installed SDK's
  `SDKMessageOrigin` peer variant (sdk.d.ts 0.3.237) declares every one of those except `msg_id`. It is
  the sender's own correlation id — the same value `peer/send` mints and `peer/messageStatus` reports
  against — so a receiving client can tie an arrival to a specific send without this server correlating
  anything. It reaches clients already, because `thread/peerMessage` carries `origin` verbatim; it is
  recorded here because an undeclared field is one an SDK bump can remove without a type error.
- **The persisted `content` is not what the peer sent.** The CLI prefixes the envelope with
  `"Another Claude session sent a message: "` before persisting. Any path that renders a peer arrival
  from raw transcript text therefore shows a preamble the sender never wrote — which is the second
  reason, independent of the live/cold stitch, that `origin.body` is the display text. Measuring the same
  rows again for Task 10d found a SAFETY POSTAMBLE too ("This came from another Claude session — not typed
  by your user…", the peer-trust instructions), so the raw text is wrong at both ends, not just the front.
- **Recognising a peer by its ENVELOPE TEXT is a net loss, and the measurement is not close.** The design
  carried an envelope-regex fallback for "a sender whose host stamps no origin". Counted over this
  machine's own transcripts (2026-08-27, 64 files holding the string): **52 user rows carry a complete
  `<cross-session-message …>…</…>` in their text and only 12 are real arrivals.** The other 40 are
  ordinary local prompts and tool results that QUOTE an envelope — code reviews and probe transcripts of
  this very work. On the replay path's reachable subset the split is 12 real against 9 false. The fallback
  never fired for a real arrival in any observed row, so it bought nothing and would have rewritten a
  local user's own prompt to a fragment of itself. The SDK says the same thing outright: an absent
  `origin` "is treated as unattributed and fails closed at strict `isHuman()` trust gates", and
  `origin.body` is to be rendered "instead of re-parsing the message text". The general shape is worth
  keeping: a recognition rule whose false positives are SILENT CORRUPTION and whose false negatives are a
  visibly raw message is not a symmetric trade, so it should key on the attribution the platform states,
  never on text any author can type. Task 10d made recognition `origin.kind === "peer"` alone; the
  envelope regex survives only as a DECODER inside a row already known to be a peer's.

- **The runtime inbound policy is a RATCHET.** The spike asked a yes/no question — is the flag layer
  re-read? — and the answer was neither. Probe 120 found it asymmetric; two mechanisms explained that
  equally well and licensed different setters, so 120b measured the two cells they disagree on and the
  rest of the matrix with them. Both hypotheses were wrong: it is not a latch on `refuse` and not one
  unreachable value, but a total ordering — tightening always takes effect, loosening never does. The
  lesson repeats this round's pattern: one measured cell is not a rule, and the cheapest way to find out
  which rule you are looking at is to measure the cells your competing explanations disagree about.
- **Tightening is RETROACTIVE, and `denied` is a receipt status we said was never observed.** Flipping a
  thread to `refuse` did not merely stop the next message: it resolved one already HELD, and the sender
  got a `denied` receipt for it. That corrects the earlier bullet above — the observed status vocabulary
  is `held`, `expired` AND `denied`, and silence remains the success path only for messages that are
  delivered or refused outright. It also means the setter has real teeth: revoking access disposes of
  what is already parked, rather than leaving it to expire.
- **Probe 120 leg D is the first LIVE confirmation that peerPolicy's door 1 works.** A launch policy
  written through the SDK's typed `settings` object was refused by a real CLI. Every unit test for that
  door asserts the config this server BUILDS; none of them can observe what an engine does with it, so
  until this leg the whole four-door design rested on one untested hop.
- **A peer we message can message us BACK, on the gateway's own socket.** A `type:"user"` frame carrying a
  `hop-chain` attribute arrived on the address `peer/send` publishes as `from` — the receiving session's
  model had replied through the same channel. The gateway already answers this correctly, as a stray
  ("a reply address, not a session"), and the measurement turns that from a reasoned choice into a
  defended one: routing such a frame into the SENDING thread would deliver unsolicited peer text into a
  thread whose own policy may be `refuse`, which is a policy bypass built out of a courtesy feature.
- **The live `origin` and the persisted `origin` are not the same object.** The live peer frame carries
  `{kind, from, verifiedPeerPid, name, fromMode, body}` — no `msg_id` — while a persisted row for the same
  kind of message carries `msg_id` too (recorded earlier in this section). Nothing depends on it today,
  because `thread/peerMessage` forwards whatever the frame holds verbatim, but a client correlating a
  send to an arrival can only do so from the persisted side.

- **Three of the four delegated unknowns are now measured (probe 119b, keyed, 2026-08-28, two runs).** Rev 5 and
  rev 6 named four leaves the design was written to survive any answer to. A keyed re-run of 119b — the
  probe already written to dump the frames verbatim, and weekly-limited when it was authored — answers
  three of them off the raw transcript:
  - **The healthy terminal state is `completed`.** The observed vocabulary is `queued` -> `started` ->
    `completed`; rev 5 had only ever seen the failure path's `cancelled`.
  - **The uuid this server submits under rides on `command_uuid`, not `uuid`.** The frame's own `uuid`
    field is a FRESH value on every frame — three different values were emitted for one `command_uuid` —
    so `uuid` identifies the frame and `command_uuid` identifies the message. The host turn's `result`
    carried `0629caa6…`, matching that turn's `command_uuid` exactly. `peerInbound.ts` matches against
    both fields and relies on `beginTurn`'s busy gate to make a wrong guess a no-op; that safety net is
    still correct, and it is no longer what the correctness of adoption rests on.
  - **A FOLDED message gets a complete lifecycle bracket of its own, nested inside the host turn's, and
    never produces a `result`.** The peer message's `started`/`completed` pair sat entirely within the
    host turn's own pair. Two brackets are therefore open at once, which means a folded arrival emits a
    `started` while this server knows itself to be busy — exactly the input `beginTurn`'s busy gate turns
    into a no-op. The design's "a wrong guess is harmless" claim is now an observation rather than an
    argument.
  - **Peer messages skip `queued`.** Host turns emitted all three states; both peer messages went
    straight to `started`. Nothing depends on this, and it is recorded because an adoption rule that
    keyed on `queued` would have been silently dead.
  Both runs produced the same three answers, and the second echoed the folded message's marker where the
  first did not — so the fold is confirmed as a real delivery the model answered inside the host turn,
  rather than a message that vanished.
  The fourth unknown — whether a BATCH emits one bracket per `command_uuid` around a single turn —
  remains open, and is confirmatory rather than load-bearing: whatever the answer, the second `started`
  arrives while the first has made the record busy, so the busy gate yields one turn either way.
- **Probe 119b misreported its own measurement, and the raw dump is what saved it.** Its verdict lines
  read the lifecycle state from `subtype`/`status`/`phase` and printed `?` for every frame, while the
  field is spelled `state` and the answer sat in the transcript above it. This is the third time in this
  round that a probe's SUMMARY was wrong while its evidence was right (118 and 118b were the first two),
  and the practice that keeps catching it is the same one: read conclusions off the dumped frames, never
  off the verdict label, and correct the label in the same pass so the artifact cannot mislead later.

- **The keyed acceptance passed nine legs and returned five findings, two of which are about the
  product rather than the code.** The legs are in `test/live/appserver-cross-session.test.ts` and each
  finding is ASSERTED there, so the day the engine's behaviour changes the leg reddens rather than the
  documentation quietly rotting.
  1. **`turn/started` precedes `thread/peerMessage`, not the other way round.** The engine emits the
     message's lifecycle `started` before it replays the `type:"user"` frame, so this server adopts and
     broadcasts the turn edge before it has anything to announce. Acceptance row 7's arrow chain is
     wrong in its first hop. Nothing depends on that order — the announcement deliberately carries no
     `turnId` — so the leg asserts the ordering the design DOES rest on (an arrival's `userMessage` item
     never precedes the `turn/started` of the turn that owns it) rather than pinning an order the engine
     never promised.
  2. **A peer arrival is persisted with `isMeta: true`, and the SDK reader drops every `isMeta` row.**
     See the rewritten "Live and replayed views must agree" section above: this inverts that section's
     opening premise, and it means `thread/read` cannot project an inbound peer message at all.
  3. **A FOLDED arrival is persisted nowhere at all** — no `isMeta` row, no row of any kind, measured
     against a positive control (the host turn's own rows were present in the same read). It reached the
     model and it had a lifecycle bracket, but its only durable trace is the `thread/peerMessage`
     notification. That makes the notification load-bearing rather than a convenience.
  4. **A batched turn's replay frames all carry the CAUSING message's `origin`.** Three messages produced
     three replay frames with three distinct uuids but only as many distinct `origin.msg_id` values as
     there were turns; the other members' attributions never appear, though their text does reach the
     model. So a client is told about the causing message N times and never told the rest arrived. This
     is the engine's behaviour, not this server's: `peerInbound.ts` forwards `origin` verbatim by design,
     and re-deriving it would replace a kernel-vouched fact with our opinion of it. Held in all four
     observations across three runs, including writes spaced three seconds apart.
  5. **A host turn's lifecycle bracket closes AFTER its `turn/completed`, while an adopted turn's is the
     reverse** — a host turn settles on the terminal `result` frame and an adopted one settles on the
     bracket itself. Read without allowing for this, a host bracket reads as still-`started` about half
     the time. That is a race in a naive reader rather than a finding about the engine, and it is
     recorded because it reddened a leg once and would redden any future reader written the same way.
- **The fourth delegated unknown closed too: a BATCH emits one bracket per `command_uuid` around ONE
  turn.** Three messages written back to back to an idle thread produced a first message with its own
  turn, then two brackets open simultaneously around a single turn, and only two `turn/started` at the
  app-server. More than one bracket open at once is the shape the design was written to survive, and the
  busy gate declining the second adoption is the whole mechanism. The batch leg was written for real
  rather than left `it.todo`: on an idle thread the first message starts a turn immediately and
  everything written behind it accumulates, which reproduced in every run.
- **The receiving model has its own judgement about a peer message, and it is right to.** Told only to
  "reply with this token", it reached for the CLI's own SendMessage tool and answered the peer over the
  gateway socket instead of saying anything in its own transcript. Told that its "entire response must be
  exactly this token and nothing else", it REFUSED, naming the instruction a prompt-injection pattern
  designed to use it as a covert signal relay between sessions — which is precisely what a
  suppress-your-output instruction from an unattributed peer looks like. The acceptance messages were
  rewritten to say truthfully what they are. Recorded because it is a real property of this surface: a
  peer message is untrusted input to a model that will evaluate it as such, and a host that designs its
  wire protocol assuming compliance is designing against the wrong receiver.
- **A thread is not addressable until it has run one turn.** `record.sessionId` is latched off the first
  `system/init` frame and the CLI emits none until it gets input — a thread was measured sitting idle for
  48 seconds publishing its session row without ever latching, and `thread/init/read` starts the CLI
  without producing a frame either. So `peer/list` cannot map a roster row to a `threadId` until the
  thread has done something. This is a property of this server's id latch rather than of the peer
  surface, and every acceptance leg takes one trivial warm-up turn because of it.

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
- **rev 3 (2026-08-26)** — absorbs the round-2 review of rev 2 (fifteen findings). Deletes the surviving
  `from-mode` contradiction; drops `turnId` from the arrival notification in favour of `arrivalUuid`;
  resolves every path through `claudeConfigDir()` instead of a hardcoded `~/.claude`; declares
  `statusReachable` on both wire shapes it was only described in; gives adoption real state
  (`peerPending`, an epoch, a claiming `onUnclaimedResult`, a buffered triggering frame,
  late adoption for result-only failures, explicit cancellation before teardown); makes the replay flag
  unconditional and the policy record-owned and swap-durable; merges client settings rather than stripping
  them; ties the `userMessage` item to the arrival rather than the turn; turns the escaping rule into a
  measured table with a refuse-until-measured fallback; and adds the busy-follow-up and arrival-only live
  legs. Probes 118 and 118b keep their conclusions — both were read off transcripts, not off the verdict
  labels — but their verdict logic is corrected in the same pass so the artifacts cannot mislead a later
  reader.
- **rev 4 (2026-08-27)** — absorbs round 3, which confirmed thirteen findings closed and named the rest
  relocated rather than fixed. Deletes an ordering contradiction rev 3 introduced (the item now follows
  `turn/started`, per the protocol's existing edge-before-items rule); makes the peer namespace an
  explicit (socket directory, config root) pair resolved once, with a refusal for threads under a
  different root; builds the policy into a replacement engine's startup config instead of re-pushing after
  the swap, and returns the setter to engine-first commit-after-accept; states the settings guard as one
  sanitizer over every carrier; fills in every numeric limit; states `accept` as an uncontrolled trust
  boundary; extends policy acceptance through `thread/resume` and the live legs through `thread/read`;
  and corrects the verdict logic of probes 118 and 118b again.
- **rev 5 (2026-08-27)** — probe 119b decoded the `command_lifecycle` frames probe 119 had recorded and
  left undecoded, and the design's hardest section got simpler rather than larger. Adoption now keys on
  the engine's own per-message `started`/terminal statements instead of on model production while the
  server believes a thread idle, which deletes the reservation machinery, the frame buffering, and the
  late-adoption branch outright — each of which existed only to compensate for a trigger that fired after
  the fact. Three leaves are named as delegated unknowns rather than assumed, all closable in one keyed
  run: the healthy terminal state's name (the measuring run was weekly-limited, so `cancelled` is what it
  saw), and what lifecycle a folded and a batched message get. The adoption rule is written to survive any
  answer to all three.
- **rev 6 (2026-08-27)** — absorbs an adversarial review scoped to the plan's Stage B (eighteen findings),
  every load-bearing one of which was verified against the real code before adoption. Four defects were
  facts about this codebase the design had assumed away: admission is TWO functions, not one, so a policy
  only `createThread` applied was a policy `thread/resume` ignored; `fleet.ts` holds a second
  `ThreadRecord` literal, so every mandatory field added to that type must be seeded there or the
  typecheck fails before any test runs; `swapEngine` uninstalls and reinstalls only the ROUTER, so an
  inbound observer installed at admission would leave the replacement engine deaf; and `Options.settings`
  accepts a file path, which is a policy bypass no object-shaped sanitizer can see. The inbound half is
  rewritten around them: adoption now goes THROUGH `beginTurn` rather than beside it, so an adopted turn
  inherits the mapper (its model output reaches subscribers at all), `turnFailureOf` (a failed result
  reports failed, not completed), and the close/interrupt re-check; frames are captured synchronously at
  lifecycle start and drained when the chained runner installs, which is what keeps a terminal that
  arrives during a held chain from wedging the thread forever; nothing branches on `record.busy`, which
  the spec's own measurement says cannot decide an arrival's fate; teardown folds into the same task as
  adoption, because a commit that can open a turn only a LATER commit knows how to close is a reachable
  hole; and every attacker-influenced collection is bounded, including the own-turn uuid set, which is now
  per-record and forgotten at each terminal. The runtime setter becomes a spike (see door 3 above). A
  fourth delegated unknown joins the three already named: which lifecycle field carries the uuid this
  server submits under.
- **rev 7 (2026-08-28)** — the keyed half. Probes 120 and 120b closed the spike rev 6 opened, and the
  answer narrowed a method rather than unblocking it: the runtime inbound policy is a ratchet, so
  `thread/crossSessionInbound/set` ships as a tightening-only operation that refuses a loosening request
  in its own voice instead of forwarding a write the engine ignores. Door 3 is rewritten around the
  measurement; the Decision Log records why shipping both directions and shipping nothing were both
  rejected. Four side findings land in Surprises: door 1 is confirmed against a real engine for the first
  time, tightening is retroactive and produces a `denied` receipt the spec had said was never observed, a
  messaged peer can reply onto the gateway's own socket (already handled as a stray, now for a measured
  reason), and the live and persisted `origin` objects differ by `msg_id`.
- **rev 8 (2026-08-29)** — the keyed acceptance ran: nine legs green against a real engine, the fourth
  delegated unknown closed (a batch emits one bracket per `command_uuid` around one turn), and five
  findings recorded, each asserted in the live file rather than described in a comment. The consequential
  one inverts a premise this spec had carried since rev 1: a peer arrival is persisted with
  `isMeta: true`, the SDK reader drops every `isMeta` row and strips `origin` besides, so `thread/read`
  shows an inbound peer message not as a `userMessage` but not at all — and a folded arrival is persisted
  nowhere whatever. The "Live and replayed views must agree" section is rewritten around that: the live
  rule is unchanged and verified, while the cold `peerArrival` branch is named as correct-but-unfed
  rather than quietly left looking active. Probe 107 had measured the reader's `isMeta` behaviour six
  weeks before this design was written; nothing connected it to the peer path until a live leg tried to
  read an arrival back, which is the round's sharpest lesson about reusing one's own prior measurements.
