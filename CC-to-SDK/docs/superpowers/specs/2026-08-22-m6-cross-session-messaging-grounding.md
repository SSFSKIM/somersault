# M6 grounding — cross-session messaging: are our sessions addressable back?

**Date:** 2026-08-22 · **Branch:** `m6-backlog` · **Kind:** grounding pass (research + live probe). Not a design.
**Probes written:** `probes/probes/113-cross-session-inbound.ts`, `113b-cross-session-inbound-delivery.ts`, `113c-cross-session-inbound-envelope.ts`.

---

## 0. Verdict

> **The "our sessions are not addressable back" premise is FALSE on 0.3.237.**

It was already false on 0.3.234; probe 110 measured a real thing but attributed it to the wrong cause.

A headless SDK session **hosts its own inbound message socket, with no help from the embedding host.**
The Claude Code CLI that the SDK spawns registers itself in `~/.claude/sessions/<pid>.json`, binds a Unix
domain socket at `/tmp/cc-socks/<pid>.sock` at mode `0600`, publishes an authentication key file beside its
registry row, and advertises the socket path on the `system/init` frame. A **separate OS process** — our
probe, not a Claude session — connected to that socket, authenticated, and had its message **routed into the
session's turn queue**. That was observed, live, twice, with the receiver's own log stating the disposition
in its own words.

The receive side is therefore **not host work we must build**. It already exists inside every session we
spawn. What is host work is much smaller and different in kind: *discovery, addressing, policy and
plumbing* — described in §6.

One thing remains unobserved, for an environmental reason and not a technical one: the account hit its
weekly usage limit mid-session, so the delivered message never got to run as a model turn. That means the
final link — `origin.kind === 'peer'` appearing on our SDK message stream and the model acting on the text —
is **routed-and-queued but not yet seen executing**. §5 states exactly what would close it.

---

## 1. Observed

Everything in this section is output from a command run in this session. Nothing here is inferred.

### 1.1 A headless SDK session binds a cross-session inbox

`probes/probes/113-cross-session-inbound.ts`, run as:

```
cd CC-to-SDK/probes && unset ANTHROPIC_API_KEY && npx tsx probes/113-cross-session-inbound.ts
```

Output (abridged):

```
[p113] init frame keys: agents, analytics_disabled, apiKeySource, capabilities, claude_code_version,
       cwd, fast_mode_disabled_reason, fast_mode_state, mcp_servers, memory_paths,
       messaging_socket_path, model, output_style, permissionMode, plugins,
       product_feedback_disabled, session_id, skills, slash_commands, subtype,
       terminal_slash_commands, tools, type, uuid
[p113] init.messaging_socket_path = "/tmp/cc-socks/62500.sock"
[p113] init.capabilities = ["interrupt_receipt_v1","interrupt_cancel_queued_v1","msg_lifecycle_v1"]
[p113] new roster rows: 1 62500(sdk-cli/interactive)
[p113] our row: {"file":"62500.json","pid":62500,"sessionId":"f11baedc-…","messagingSocketPath":
       "/tmp/cc-socks/62500.sock","entrypoint":"sdk-cli","kind":"interactive","peerProtocol":1}
[p113] messagingSocketPath = /tmp/cc-socks/62500.sock | exists on disk: true
[p113] socket mode: 600
[p113] auth key file present for pid 62500 : true (value never printed)
[Q1] SDK session hosts a cross-session inbox: ✅ YES
```

Four facts, all first-hand:

1. A plain `query()` session — no special flags, no host wiring — writes a roster row with
   `entrypoint: "sdk-cli"` and `peerProtocol: 1`.
2. It binds `/tmp/cc-socks/<pid>.sock` at mode `0600`.
3. It publishes an auth key file `~/.claude/sessions/<pid>.<sha256>.key`.
4. **`messaging_socket_path` is on the `system/init` frame** — a session's own inbox address is handed to
   the SDK client at startup. `sdk.d.ts` does not declare this field (§2.4); it is on the wire regardless.

### 1.2 A separate process reaches the inbox — and is HELD, not rejected

`probes/probes/113b-cross-session-inbound-delivery.ts` wrote an authenticated frame onto that socket from
the probe process. No marker surfaced. The receiver's own debug log
(`~/.claude/debug/05a32cf6-0a3a-4f54-a67c-8152125258e2.txt`) says why:

```
[INFO]  [uds-messaging] Listening: /tmp/cc-socks/66188.sock
[DEBUG] [uds-messaging] Client connected
[DEBUG] [uds-messaging] Client disconnected
[DEBUG] [cross-session-inbound] held inbound peer message (1 held, cause=no-mode-asserted):
        from=uds:/tmp/cc-socks/66153.sock "(withheld)"
[DEBUG] [uds-client] Sending control:peer_message_status to /tmp/cc-socks/66153.sock
[DEBUG] [uds-messaging] hold-receipt send failed to uds:/tmp/cc-socks/66153.sock: Error: Timed out
```

This is the load-bearing observation of the whole pass. The frame was **accepted, authenticated, parsed and
adjudicated**. `held … cause=no-mode-asserted` is a *policy* outcome on a working ingress, not the silence
of a session that cannot be addressed. The receiver then tried to send a **delivery-status receipt back to
the sender's address** — so the channel is bidirectional by design.

The CLI also logs its own injection recipe at startup, which is as close to a first-party statement of intent
as this gets:

```
[uds-messaging] Inject messages (auth line optional here):
  { echo '{"type":"auth","token":"'"$CLAUDE_CODE_MESSAGING_TOKEN"'"}';
    echo '{"type":"user","message":{"role":"user","content":"hello"}}'; }
  | socat - UNIX-CONNECT:/tmp/cc-socks/<pid>.sock
```

Note `$CLAUDE_CODE_MESSAGING_TOKEN`: the session exports its own inbox token into its environment, so
anything it spawns inherits the ability to talk to it.

### 1.3 Delivery, and the `crossSessionInbound` setting, both work

`cause=no-mode-asserted` named the defect: the sender's permission class is not a top-level frame field, it
rides inside the message body's envelope. `probes/probes/113c-cross-session-inbound-envelope.ts` fixes that
and runs two receivers. **The probes workspace was bumped from SDK 0.3.234 to 0.3.237 first** (it had its own
`node_modules`, still on the old version — every earlier probe on this question, including probe 110, ran
against CLI 2.1.234).

```
cd CC-to-SDK/probes && unset ANTHROPIC_API_KEY && npx tsx probes/113c-cross-session-inbound-envelope.ts
```

```
[p113c] our peer address: uds:/tmp/cc-socks/79819.sock
[p113c] [Q1-parity] session=32e942b3-… sock="/tmp/cc-socks/79822.sock"
        row=pid=79822 entrypoint=sdk-cli v=2.1.237 proto=1
[p113c] [Q1-parity] auth key present: true (never printed); writing enveloped frame
[p113c] [Q1-parity] socket outcome: CLOSED
[p113c] [Q1-parity] disposition lines:
        [DEBUG] [uds-messaging] Routed user message to queue (priority=next): (withheld)

[p113c] [Q2-refuse] session=e13ec315-… sock="/tmp/cc-socks/79882.sock"
        row=pid=79882 entrypoint=sdk-cli v=2.1.237 proto=1
[p113c] [Q2-refuse] disposition lines:
        [DEBUG] [cross-session-inbound] refused inbound peer message
                (uds: dropped before attachment materialization)

=== VERDICT (probe 113c) ===
[Q1] enveloped frame, from-mode=bypass into a bypassPermissions receiver: ✅ DELIVERED (routed to the turn queue)
[Q2] same frame into crossSessionInbound:"refuse": ✅ REFUSED (setting honored)
```

**`Routed user message to queue (priority=next)` is the answer to the central question.** A message written
by a foreign process onto a headless SDK session's socket became a queued turn for that session.

And `crossSessionInbound: "refuse"`, set in a project `.claude/settings.json` and loaded via
`settingSources: ["project"]`, flipped the identical frame to refused. The 0.3.237 setting is live and
reachable through ordinary SDK options.

### 1.4 The wire protocol, as exercised

The frames the probe actually wrote and that the CLI actually accepted:

```jsonc
// line 1 — optional when the connecting process is trusted, required otherwise.
// token read from ~/.claude/sessions/<pid>.<sha256>.key → {"peerToken": "<32 hex>"}
{"type":"auth","token":"<32 hex>"}

// line 2 — NDJSON, one frame per line
{"type":"user",
 "session_id":"<receiver's session id — dropped on mismatch>",
 "from":"uds:/tmp/cc-socks/<sender pid>.sock",
 "message":{"content":"<the envelope below>"},
 "priority":"next",              // "now" | "next" | "later"
 "msg_id":"<sender-chosen, correlates status receipts>"}
```

The `content` must be the harness-formed envelope, or the sender is treated as asserting no permission class:

```
<cross-session-message from="uds:/tmp/cc-socks/79819.sock" from-name="probe-113c" from-mode="bypass">
<body text>
</cross-session-message>
```

Attribute order is fixed — `from`, `from-session`, `hop-chain`, `from-name`, `from-mode` — and the receiver
re-serializes what it parsed and requires byte-exact equality before honoring any of it.

### 1.5 The live machine already runs this at scale

`~/.claude/sessions/` on this machine held **17 live rows** at probe time, every one carrying
`messagingSocketPath`, `peerProtocol: 1`, and a live socket in `/tmp/cc-socks/` (40 sockets present).
Rows carry `kind` (`interactive` | `bg`), `entrypoint` (`cli` | `sdk-cli`), `status`
(`idle` | `busy` | `waiting`), a derived `name`, and on newer rows `peerFeatures: ["notify_idle"]`.
One pre-existing row, unrelated to this work, was a `claude -p … --output-format text` process with
`entrypoint: "sdk-cli"` and a live socket — i.e. a headless SDK-spawned session hosting an inbox is the
normal case on this machine, not something the probe induced.

---

## 2. Declared

### 2.1 `sdk.d.ts` (0.3.237, `harness/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

**`SDKMessageOrigin`** — `sdk.d.ts:4320` opens with the sentence that reframes the whole question:

> "Provenance of a user-role message (peer session, team lead, channel). **A host wrapping keyboard input
> must stamp `{kind:'human'}` explicitly** — absent origin is treated as unattributed and fails closed at
> strict `isHuman()` trust gates."

The union has nine variants; `kind: 'peer'` at **`sdk.d.ts:4328`** carries:

- `fromMode?: 'bypass' | 'prompting'` (**`:4333`**) — "The SENDING session's permission class **as declared
  by the host** that injects this message on local stdin … Lets the recipient deliver a same-class message
  immediately while a cross-class or undeclared sender is still held at a recipient that runs without
  asking. **Honored only from the injecting host on local stdin**; absent when the host does not declare it."
- `name?` (**`:4337`**) — sender display name, harness-normalized; "Sender-asserted display text … render it
  as reported speech".
- `fromSession?` (**`:4341`**) — "the envelope's `from-session` attribute … **Sender-asserted like `from`: a
  navigation target only, never authority**."
- `senderTaskId?` (**`:4345`**) — "Absent for cross-session peers" (this one is for in-process subagents).
- `body?` (**`:4349`**) — "Decoded message body with the peer envelope stripped — byte-exact with what the
  model sees. Present only when the turn is exactly one harness-formed envelope."
- `verifiedPeerPid?` (**`:4354`**) — the trust boundary, stated outright:

  > "Kernel-verified pid of the process that connected to **this session's cross-session messaging socket**,
  > read from the connection (SO_PEERCRED / LOCAL_PEERPID) — never from the payload. This identifies the
  > CONNECTING process, which for relayed traffic (e.g. a daemon forwarding on another session's behalf) is
  > the relay, not the message's author. **Key sender identity on this, never on `from`: `from` is
  > sender-authored and kept only for reply routing, so it is forgeable by any same-user process.** Absent
  > when unverifiable (Windows, non-UDS ingress) — never a wrong value. Pids are recyclable: provenance, not
  > an authentication token."

**`kind: 'task-notification'`** (**`:4356`**) with `subkind?: 'scheduled-trigger' | 'peer-send-message'`
(**`:4360`**):

> "…or a coordinator co-member SendMessage delivery (`'peer-send-message'`: model-authored text from another
> of the same user's sessions, **verified by the server-stamped receiver co-membership** — task-notification
> for prompt authority, but distinguishable so the receive-side `crossSessionInbound` setting can apply to
> it)."

Also declared but not exercised here: `kind: 'coordinator'` (**`:4362`**), `kind: 'observer'` with
`from` + `senderTaskId` (**`:4366`**), `kind: 'channel'`, `kind: 'auto-continuation'`,
`kind: 'observer-activity'`, `kind: 'unclassified'`.

**The settings key**, `sdk.d.ts:7601`, doc at `:7599`:

> "Inbound cross-session peer messages (SendMessage from your other sessions): `'accept'` delivers them,
> `'hold'` parks them for your review without letting Claude act, `'refuse'` opts this session out. **An
> explicit value always wins.** Unset (mode parity): a message auto-delivers only when the sending session's
> permission-mode class matches yours (bypass↔bypass or prompting↔prompting); a mismatched sender's message
> is held for your approval; **a sender that asserts no class is held only while this session bypasses
> permission prompts.**"

That last clause predicted probe 113b's hold exactly.

Two neighbours matter. `sdk.d.ts:7593` `isolatePeerMachines?: boolean` — "Require explicit approval before
SendMessage can reach a peer session on **another machine** via Remote Control": the local-UDS path and the
cross-machine bridge path are separately governed. And `sdk.d.ts:7349` sets the hold deadline —
"how long a HELD cross-session message awaits approval, before either resolves to its safe no-action default
(cancelled / dropped-with-denial). Defaults to 5m … `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` overrides."

### 2.2 The host-injection path, declared

`origin?: SDKMessageOrigin` appears on **`SDKUserMessage` (`sdk.d.ts:4952`)** — the type documented at
`:4937` as "A user-role message. **A client writes one to the CLI to submit a prompt**". It is also on
`SDKUserMessageReplay` (`:5002`) and both result messages (`:4609`, `:4655`).

So there are **two** inbound routes, not one: the socket the CLI hosts (what we exercised), and a
host-stamped `origin` on a user message the host writes on stdin (declared, unexercised — `fromMode`'s doc
says it is "honored only from the injecting host on local stdin").

### 2.3 What `sdk.d.ts` does *not* declare

- **No `SendMessage` tool schema.** `sdk-tools.d.ts` never declares it; the only mention is
  `sdk-tools.d.ts:562`, on the Agent/Task tool — "Name for the spawned agent. Makes it addressable via
  `SendMessage({to: name})` while running" — which is the **in-process subagent** namespace, a different
  addressing space from cross-session peers. Do not conflate them.
- **No `messaging_socket_path`** anywhere in `sdk.d.ts`, though §1.1 observed it on the init frame.
- **No `ListAgents` / `ListPeers` schema**, no roster type, no co-membership type.

### 2.4 The CLI binary (2.1.238, `/Users/new/.local/share/claude/versions/2.1.238`)

Read by string extraction; this is declared-surface evidence about the implementation, not a live result.

- The module logs under `[uds-messaging]` and `[cross-session-inbound]`.
- Socket path: `${XDG_RUNTIME_DIR || <tmp>}/cc-socks/${process.pid}.sock`, with a Termux fallback to
  `/tmp/cc-socks-${uid}/`. Overridable by `--messaging-socket-path`; exported as
  `CLAUDE_CODE_MESSAGING_SOCKET` after bind. Directory forced to `0700`, socket to `0600`.
- Auth: a 32-hex `peerToken` published to `~/.claude/sessions/<pid>.<sha256>.key`
  (`/^(\d+)\.[0-9a-f]{64}\.key$/`, body `{peerToken, procStart?, procStartFt?}`). The auth frame is
  `{"type":"auth","token":…}`; a token match resolves to scope `"peer"` or `"child"`. Whether auth is
  *required* is a runtime decision — an unauthenticated connection is dropped only when it is.
- Frame types: `type:"user"` and `type:"control"`. Control actions observed in the binary: `rename`,
  `notify_when_idle`, `peer_idle_notice`, and `peer_message_status` with statuses
  `held | denied | expired | delivered | refused | dropped`.
- Receiver checks, in order: line length cap → JSON parse → auth (if required) → `session_id` match
  (`Dropping <type> message: session_id mismatch (got …, expected …)`) → content is a non-empty string →
  envelope parse → `crossSessionInbound` adjudication → enqueue as `{mode:"prompt", priority, origin,
  skipSlashCommands:true, isMeta:true}` → ring the `onEnqueue` doorbell.
- **The inbox is behind a server-side feature gate.** The binary carries
  `[uds-messaging] Skipped: cross-session messaging gate off (will late-bind if a GrowthBook refresh
  enables it)` and the gate name `agents_cross_session_inbox`. It was **on** for this account during every
  run in §1. It is not guaranteed on for every account, and it can change without an SDK release.

### 2.5 The February reference (`Claude Code Src/`)

Correction to the task framing: the reference tree is at the **worktree root**, `Claude Code Src/`, not under
`CC-to-SDK/`.

The snapshot contains the **entire consumer surface and none of the implementation**. Every receive-side
module is a stub: `src/utils/udsMessaging.ts` is 4 lines of `any`, `src/utils/udsClient.ts` is 2,
`src/bridge/peerSessions.ts` is 1, `src/components/messages/UserCrossSessionMessage.tsx` returns `null`,
`src/tools/ListPeersTool/` is absent, `src/utils/peerRegistry.ts` is absent.

What it *does* capture, and which matched the live system exactly:

- `src/utils/concurrentSessions.ts:21-23` → the registry is `~/.claude/sessions/<pid>.json`, dir `0700`.
  The writer at `:77-97` emits `messagingSocketPath: process.env.CLAUDE_CODE_MESSAGING_SOCKET`. Its own
  docstring (`:49-60`) says it registers **"interactive CLI, SDK (vscode, desktop, typescript, python,
  -p), bg/daemon spawns … Skips only teammates/subagents."** SDK sessions were always meant to be in the
  roster.
- `src/setup.ts:86-102` → the socket is bound inside `setup()`, before hooks can spawn, gated on
  `feature('UDS_INBOX')`, with `--messaging-socket-path` as the escape hatch and `--bare` as the opt-out.
- `src/constants/xml.ts:58-59` → `CROSS_SESSION_MESSAGE_TAG = 'cross-session-message'`.
- `src/utils/peerAddress.ts:7-21` → addressing is **purely lexical**: `uds:` → socket path,
  `bridge:` → Anthropic-server relay, bare `/` → legacy UDS. **There is no session-id → transport lookup
  anywhere.** This is why probe 110's send to a session uuid was refused.
- `src/cli/print.ts:2680-2691` → in headless/`-p`/SDK mode, `setOnEnqueue(() => { if (!inputClosed) void
  run(); })`. The socket pushes onto the queue itself; the callback is only a doorbell that wakes the loop.
- `src/utils/messages/systemInit.ts:87-93` → `messaging_socket_path` on the init frame, commented
  *"Hidden from public SDK types — ant-only"*. §1.1 shows it is still on the wire and no longer ant-only in
  effect.
- `src/tools/SendMessageTool/SendMessageTool.ts:585-602` → `uds:` sends are auto-allowed; `bridge:` sends
  require explicit user consent marked `safetyCheck` with `classifierApprovable: false`, deliberately
  immune to `bypassPermissions`.

**Where February disagrees with 0.3.237 — all of it new work, not renames:** no `crossSessionInbound`, no
hold/refuse/accept state, no mode parity, no `SO_PEERCRED`/`LOCAL_PEERPID`, no `subkind`, no co-membership,
no `peerFeatures`/`peerProtocol`, no auth token. February's model was blunt — an inbound UDS message was
enqueued and delivered, and the only human gate anywhere was on the *outbound* bridge send. Its own prompt
text (`src/tools/SendMessageTool/prompt.ts:20`) says so: *"A listed peer is alive and will process your
message — no 'busy' state."* Treat the snapshot as a guide to **shape** and to **where things are wired**,
never to policy.

Also a false friend worth naming: `coordinator` in February is `CLAUDE_CODE_COORDINATOR_MODE`, a locally
asserted agent persona that restricts the tool set. It has nothing to do with the "coordinator co-member"
in `sdk.d.ts:4360`.

---

## 3. Our prior evidence, re-read

`probes/probes/110-cross-session-messaging.ts` (2026-08-18, SDK **0.3.234**, `claude-sonnet-4-5`, two bare
`query()` sessions in one process, `bypassPermissions`, no `settingSources`, no settings, no env).

**What it genuinely proved:**

1. A bare headless SDK session can enumerate the machine's real Claude Code fleet via a model-invoked
   `ListAgents` — 20 rows with live busy/idle status.
2. `SendMessage` is reachable and callable headless (the model had to `ToolSearch` it first — it is deferred).
3. `SendMessage` rejects a raw session uuid: `No agent named '<uuid>' is reachable`.
4. Its own two sessions did not appear in the `ListAgents` roster.
5. Init `capabilities` were `[interrupt_receipt_v1, interrupt_cancel_queued_v1, msg_lifecycle_v1]`, with no
   `queued_notifications`.
6. A marker addressed at a session uuid never arrived.

**What it did not exercise, and what that costs the conclusion:**

- It never used a valid address. §2.5 shows the grammar is `uds:<socket path>`; a uuid is not an address in
  any namespace. Fact 3 is "the address was malformed", not "the target was unreachable". Fact 6 follows
  from fact 3 and carries no independent weight.
- It never looked at `~/.claude/sessions/` or `/tmp/cc-socks/`. Fact 4 says the sessions were absent from
  **`ListAgents`' projection**, which is a different question from whether they registered — §1.1 shows a
  bare SDK session **does** write a roster row and **does** bind a socket. Whatever `ListAgents` filters on
  (`kind`, entrypoint, name, liveness), it is a discovery-surface question, not an addressability one.
- It never set `crossSessionInbound`, never stamped `origin`, never wrote to a socket, and never had a real
  Claude Code session send *at* it. There was no negative control.
- It ran on **0.3.234 / CLI 2.1.234**. The probes workspace was still pinned there until this pass bumped
  it; the harness had already moved to 0.3.237. Every "the SDK can't" claim on this topic predating today
  was measured against the older CLI.

The docs that record it are correspondingly careful, and their hedges were right:
`docs/parity/full-potential.md:148` — *"Send to a real Claude Code session left unexercised — needs a
consented target"*; `:149` — *"The receive fabric (registry entry + messaging socket) belongs to Claude Code
hosts; making ccx sessions addressable needs its own grounding pass"*. This is that pass, and the answer is
that the fabric does not belong to hosts. It ships in the session.

**Scoring impact.** `docs/parity/coverage.md` has no cross-session row at all (the only `SendMessage`
mention, `coverage.md:466`, is the unrelated in-process subagent bus from probes 41/41b).
`docs/parity/full-potential.md:147-149` scores discovery 🟡, send 🟡, and receive 🚫. **The 🚫 is now wrong**:
🚫 means "bridge-coupled, CLI-only, or deleted; excluded from the goal's denominator", and this capability is
none of those. It should re-enter the denominator.

---

## 4. Inferred

Reasoning, marked as such.

1. **Probe 110's real finding was a discovery gap, not a delivery gap.** Our sessions register and bind, but
   did not show up in `ListAgents`. The most likely cause is that the roster projection filters on something
   our rows lack — a `name`/`nameSource`, a `status` (our fresh rows in §1.3 carried none), or `peerFeatures`.
   Untested. It matters because it decides whether *other* sessions can find us, which is a separate question
   from whether they can reach us once they know our address.
2. **The trust model is legible and we sit on the right side of it.** `verifiedPeerPid` is kernel-supplied;
   `from`, `fromSession` and `name` are sender-authored and explicitly forgeable by any same-user process.
   The socket is `0600` in a `0700` directory, so the blast radius is already "processes running as this
   user" — which is exactly the population our app-server hosts. A host that keys authorization on
   `verifiedPeerPid` and treats `from` as routing-only is following the documented contract.
3. **The two inbound routes are probably one mechanism seen from two sides.** The socket path constructs an
   `origin: {kind:'peer', …}` internally; `SDKUserMessage.origin` lets a host construct the same thing
   directly on stdin. If the stdin route works (unverified), a host can inject peer-attributed messages
   without any socket at all — simpler, but it forfeits `verifiedPeerPid`, since nothing was verified.
4. **`subkind: 'peer-send-message'` is a different, server-mediated channel** and we did not touch it. Its
   doc says co-membership is *server-stamped*; the UDS path we exercised is purely local and kernel-verified.
   A local host cannot mint server co-membership. Expect the UDS path to be the one available to us and the
   coordinator path to be out of reach without server-side enrollment.
5. **The feature gate is the real risk to this design**, more than any API instability. `agents_cross_session_inbox`
   is evaluated server-side and can late-bind or turn off. Any design built on this must detect the inbox's
   absence at runtime rather than assume it, and degrade rather than fail.

---

## 5. What is still open

One thing, and one experiment closes it.

**Open:** the delivered message was routed to the turn queue but never ran, so we have not seen
`origin.kind === 'peer'` arrive on our own SDK message stream, nor the model act on peer text. The blocker
was environmental and is dated: the account hit **"You've hit your weekly limit · resets Aug 26 at 1pm
(Asia/Seoul)"** during probe 113b, and every model turn after that failed. Routing was still observable
because the CLI logs the disposition before it attempts the turn.

**The experiment:** re-run `probes/probes/113c-cross-session-inbound-envelope.ts` unchanged, with quota
available. It already asserts on `B1.peerOrigin` and on the marker reaching the model (Q3/Q5 in its verdict
block); both printed "not observed" purely because no turn could run. Nothing about the probe needs to
change. Two secondary things would also settle themselves on that run: whether the receiver's
`control:peer_message_status` receipt reaches our listener (Q4 — 113b showed the receiver *attempting* it),
and whether the `hold` disposition surfaces a reviewable prompt rather than silently expiring at the 5-minute
deadline.

**Not blocking, but worth one probe each later:** whether `SDKUserMessage.origin` stamped by a host on stdin
is honored (§4.3); and what `ListAgents` filters on, which is the discovery half (§4.1).

---

## 6. What the receive side would require of us

Stated as seams, not as a design. The headline is that the transport, the authentication, the policy
adjudication and the turn-injection are **already implemented inside each session we spawn**. We do not
build a receive path. We build the parts that make our fleet legible and governable.

Four things a host must own:

1. **Learn each hosted session's inbox address.** It arrives on the `system/init` frame as
   `messaging_socket_path` (§1.1) and is mirrored to `~/.claude/sessions/<pid>.json`. `harness/src/appserver/`
   already consumes init frames per thread; this is one more field to capture and keep beside the thread
   record. Today `harness/src/appserver/registry.ts` holds the in-memory thread registry and
   `harness/src/fleet/roster.ts` holds our own on-disk rows — neither carries a peer address.

2. **Publish addressability outward.** `harness/src/appserver/fleet.ts` already implements `fleet/list` as a
   roster + live-probe projection over every session on the machine. It is the natural place to surface "this
   thread is addressable at X", and the natural place to answer the discovery gap in §4.1. A new `fleet/*`
   method would register in the method table at `harness/src/appserver/server.ts:532-533`, beside
   `"fleet/list"` and `"thread/attach"`.

3. **Decide policy per hosted session.** `crossSessionInbound` is a *settings* key, not a `query()` option —
   §1.3 reached it via a project `.claude/settings.json` plus `settingSources: ["project"]`. Our
   session-spawn path would have to compose that deliberately. There is a real design question here about
   where the value comes from (per-thread request, tenant preset, server default) and it is exactly the kind
   of thing to settle in the design session, not here.

4. **Surface inbound arrivals to connected clients.** An inbound peer message becomes a turn the session
   takes on its own, without any client asking for it. That is new: today every turn in
   `harness/src/appserver/` originates from a client request through `harness/src/appserver/queue.ts`
   (`enqueue` mints the id) and `harness/src/appserver/turns.ts` (`beginTurn`). A turn that begins without an
   enqueue is an unmodelled case. `harness/src/appserver/router.ts` (per-thread frame routing) and
   `harness/src/appserver/fanout.ts` (`broadcastToWatchers`) are where it would become visible to clients.
   `harness/src/appserver/lifecycle.ts` is the precedent worth reading first — `thread/compact/start` is
   already a server-initiated action that has to claim the real turn machinery.

Two traps for whoever picks this up:

- **`harness/src/appserver/peer.ts` is not a peer seam.** It is the per-connection JSON-RPC NDJSON framing
  class. The name collides and means something else entirely.
- **`harness/src/swarm/` is not this either.** Its `SendMessage`/`CheckMessages` MCP tools
  (`harness/src/swarm/server.ts:26`) run over an in-process `MessageBus` (`harness/src/swarm/bus.ts`) between
  teammates of one session. Same verb, unrelated address space — the same conflation that made probe 110
  address a session by uuid.

Also worth weighing at design time: `harness/src/host/server.ts` already runs a per-session Unix socket with
a 34-op protocol, which `harness/src/appserver/fleetEngine.ts` speaks to drive sessions we do not own. We
would then have **two** sockets per session — ours and the CLI's. Whether those converge, or ours simply
brokers onto the CLI's, is a design decision with real consequences and no obvious default.

---

## 7. Files produced

| Path | What it is |
|---|---|
| `CC-to-SDK/probes/probes/113-cross-session-inbound.ts` | Q1 — does a headless SDK session bind an inbox? Answered YES live. |
| `CC-to-SDK/probes/probes/113b-cross-session-inbound-delivery.ts` | Delivery attempt with a distinct sender address + native `SendMessage` route. Produced the `held … cause=no-mode-asserted` finding. |
| `CC-to-SDK/probes/probes/113c-cross-session-inbound-envelope.ts` | The decisive run on 0.3.237: enveloped frame DELIVERED; `crossSessionInbound:"refuse"` honored. Re-run this when quota returns to close §5. |
| `CC-to-SDK/docs/superpowers/specs/2026-08-22-m6-cross-session-messaging-grounding.md` | This document. |

Also changed: `CC-to-SDK/probes/package.json` + lockfile — the probes workspace was bumped
`@anthropic-ai/claude-agent-sdk` 0.3.234 → 0.3.237 (bundled CLI 2.1.234 → 2.1.237), because the question is
specifically about 0.3.237 and the workspace was still pinned to the old version.

No file under `harness/src/` was modified.
