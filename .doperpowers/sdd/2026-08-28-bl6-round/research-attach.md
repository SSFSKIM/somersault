# T-ATTACH — root-cause diagnosis: the dropped first frame after `ccx attach`

bl6 round · research ticket · read-only on production source · 2026-08-28

## Summary

The lost frame is lost **on the host side, before it is ever written to the socket**: `ccx attach`
establishes its event stream by sending a `follow` op *after* its socket connects, and the only thing that
saves a frame published before that op lands is the **host's own replay-on-follow**. The real host has that
replay (`SessionHost.follow()` drains its `TurnBuffer` into a late joiner, `src/host/host.ts:730-772`); the
pty drivers' stand-in host, `harness/scripts/fake-host.mjs`, does **not** — its stdin push path
(`scripts/fake-host.mjs:119-126`) writes to a `followers` set that is empty until the `follow` op arrives and
buffers nothing, so a frame produced in that window is discarded with no trace. The window is real and
razor-thin rather than hypothetical: measured live this session, the footer that the drivers treat as
"attached" (`⏸ manual mode on`) paints within ±30 ms of the `follow` op reaching the host, and under CPU load
it painted **31 ms before** it — so a driver that pushes on that footer is pushing into a coin flip, and the
`warmup_follow` sentinel loop works only because it re-pushes until one push happens to land after `follow`.

## Frame path map

Host push → attach client screen, in order:

| # | Where | What happens |
|---|-------|--------------|
| 1 | `src/host/host.ts:781` `emit()` | Fan-out over `this.followers`. **Zero followers = the frame is gone.** No queue, no retry. |
| 2 | `src/host/host.ts:402` | The one thing that makes step 1 survivable: every non-`stream_event` turn message is *also* pushed into `TurnBuffer` before `emit`. |
| 3 | `src/host/server.ts:211-220` | The `follow` op handler. Registers **one sink per socket**, idempotently, and calls `handlers.follow(...)` → `SessionHost.follow()`. |
| 4 | `src/host/host.ts:730-772` `follow()` | The replay handshake — synchronous, before the follower is added: synthetic `turn:start` if a turn is in flight → last `system/init` → the whole `TurnBuffer` snapshot marked `replay:true` → every parked decision → the bg-task snapshot → a trailing `state`. Only then `this.followers.add(cb)` (`:770`). |
| 5 | `src/host/wire.ts:66` `encodeEvent` | `{t:"event", …}` + `\n`, NDJSON on the UDS. |
| 6 | `src/client/remote.ts:97-119` `onData` | Line-split, `t === "event"` routed to every registered follower callback before ids are even looked at. |
| 7 | `src/client/remote.ts:231-243` `follow(cb)` | The **first** live subscriber sends the `follow` op; `followAck` is the in-flight reply promise `whenFollowed()` exposes. |
| 8 | `src/client/chatAdapter.ts:74-104` | The `ready` IIFE: `connect` → (optional `resumeOp`) → `r.follow(route)` (`:101`) → `await r.whenFollowed()` (`:102`). |
| 9 | `src/client/chatAdapter.ts:38-72` `route()` | Fans events into decision/turn bookkeeping and then to `eventCb`; **events arriving before `onSessionEvent` subscribes are held in `backlog` and drained on subscribe** (`:36`, `:206`). |
| 10 | `src/tui/useChat.ts:262` | `useState(() => makeSession())` — the adapter is constructed during useChat's first render, which is what starts step 8. |
| 11 | `src/tui/useChat.ts:1409-1411` | `session.onSessionEvent(...)` in a mount effect; the `message` arm (`:1430-1607`) appends unconditionally — since the retention change there is **no** no-live-turn guard dropping idle-attach messages. |

Two important negatives from this map:

- **The client side does not drop anything.** Step 9's `backlog` covers "event arrived before the REPL
  subscribed", and step 11 appends messages with no live turn required. Every candidate client-side sink was
  checked and none of them silently swallows a frame.
- **`whenFollowed()` / `whenReady()` are awaited nowhere outside the adapter.** `grep -rn "whenReady\|whenFollowed" src/` returns hits only in `chatAdapter.ts` and `remote.ts`. Nothing in the paint path is
  ordered against the follow ack, which is why the footer is not a follow signal.

## The race window

**What the client considers "attached" vs. when it actually starts receiving frames.**

The client is "attached" — footer painted, composer mounted, keys accepted — the moment React commits
useChat's first render. The adapter's socket work is *started* by that same render but completes later:

```ts
// src/tui/useChat.ts:262
const [session, setSession] = useState<ChatSession>(() => makeSession());
```

```ts
// src/client/chatAdapter.ts:74-104
const ready: Promise<RemoteChatSession> = (async () => {
  const r = await (opts.connect ?? ((p, o) => RemoteChatSession.connect(p, o)))(socketPath, {...});
  raw = r;
  r.onClose(...);
  if (opts.resume) { const rep = await r.resumeOp(opts.resume); ... }
  r.follow(route);            // :101  ← the follow op is written HERE
  await r.whenFollowed();     // :102  ← and acked HERE
  return r;
})();
```

Nothing between line 262 and line 102 is ordered against the paint. The two are concurrent, and which wins is
decided by tens of milliseconds of event-loop scheduling.

**The host side of the window** is where the frame actually dies. In the real host it does not die, because
the follow handler replays first:

```ts
// src/host/host.ts:730-772 (excerpt)
follow(cb: (ev: HostEvent) => void): () => void {
  const snap = this.turnBuffer.snapshot();
  if (this.turnInFlight) this.deliver(cb, { kind: "turn", phase: "start", seq: this.turnSeq_, ... });
  ...
  for (const m of snap.messages) this.deliver(cb, { kind: "message", data: m, replay: true });
  for (const entry of this.parked.list()) this.deliver(cb, { kind: "decision", entry });
  if (this.bgTasks.length) this.deliver(cb, { kind: "tasks_changed", tasks: this.bgTasks });
  this.deliver(cb, { kind: "state", status: this.status() });
  this.followers.add(cb);     // :770 — LAST
  return () => { this.followers.delete(cb); };
}
```

In the fake host it does die, because there is no buffer and no replay:

```js
// harness/scripts/fake-host.mjs:117-126 — the stdin push path
const followers = new Set();
process.stdin.on("data", (chunk) => {
  ...
    for (const ev of framesFor(word)) for (const push of followers) push(ev);   // :124
});
```

```js
// harness/scripts/fake-host.mjs:153-166 — the follow handler
else if (req.op === "follow") {
  send(base);
  if (!following) {
    following = true;
    followers.add(pushEvent);            // :157 — no replay of anything produced before this line
    const script = (process.env.FAKE_HOST_SCRIPT ?? "")...;
    let delay = 300;
    for (const word of script) {
      for (const ev of framesFor(word)) { setTimeout(() => pushEvent(ev), delay); delay += 300; }   // :164
    }
  }
}
```

Note the asymmetry inside this one file: the **`FAKE_HOST_SCRIPT`** path (`:161-165`) is race-free *by
construction* — it only starts pushing after the first `follow` ack. The **stdin** path (`:119-126`), added
later for on-demand pushes, has no such ordering and no buffer. That is the whole defect.

**Why the driver's readiness signal cannot cover it.** `scripts/linkopen-cells.sh:141-152` waits for
`mode on` in the pane and returns; `scripts/select-pty.sh:581` and `scripts/hover-cells.sh:82` do the same.
`mode on` is the footer (`src/tui/Footer.tsx:14`), painted by the render that *starts* the connect — it is
strictly a "the UI mounted" signal and carries no information about the socket at all.

**Why sentinel-then-real-push works.** `warmup_follow` (`linkopen-cells.sh:126-142`) re-pushes an idempotent
`message:readyframesentinel` every ~1.2 s until it is seen on screen. Seeing it is proof that `follow` has
been processed; and once `followers.add(pushEvent)` has run for that connection, the set stays non-empty for
the life of the socket, so every later push lands. The sentinel is not warming anything up — it is polling
until it wins the race, and discarding the losses.

## Repro

### A. Deterministic, node-level (no terminal) — proves the mechanism

`/Users/new/.claude/jobs/4b30d1a4/tmp/bl6attach/node-repro.mjs` stands up a minimal wire-compatible host that
emits one `message` event **at socket-accept time** (strictly before the client's `follow` op can arrive),
then a second one 50 ms after `follow`. The client is the real `remoteChatSession` from `dist/`. Two modes:
`no-replay` (today's fake host) and `replay` (what `SessionHost.follow()` does).

```
$ node node-repro.mjs no-replay
mode=no-replay client saw: ["POSTFOLLOW-FRAME"]
  → pre-follow frame LOST
$ node node-repro.mjs replay
mode=replay client saw: ["PREFOLLOW-FRAME (replay)","POSTFOLLOW-FRAME"]
  → pre-follow frame SURVIVED
```

Reproduces 2/2 in both directions, with no timing dependence. This is the fix's unit seam, pre-written.

### B. Live pty — measures how wide the window actually is

`/Users/new/.claude/jobs/4b30d1a4/tmp/bl6attach/repro3.sh` (private tmux socket `-L bl6attach$$`, isolated
`HOME`/`CCX_FLEET_ROOT`, kills only its own two sessions) launches an **instrumented copy** of
`fake-host.mjs` that timestamps `CONNECT`, every op, and every stdin push with the live follower count, then
launches the real `node dist/cli/bin.js attach <short>`, polls the pane as tightly as a shell can for
`mode on`, and pushes `prlink` the instant it appears.

```
$ for k in 1 2 3; do bash repro3.sh; done
LOAD=0  first-push=LANDED follow_at=1787916321065 modeon_detected=1787916321077 push_at=1787916321121  (modeon-follow=+12ms, push-follow=+56ms)
LOAD=0  first-push=LANDED follow_at=1787916325045 modeon_detected=1787916325070 push_at=1787916325115  (modeon-follow=+25ms, push-follow=+70ms)
LOAD=0  first-push=LANDED follow_at=1787916329031 modeon_detected=1787916329046 push_at=1787916329091  (modeon-follow=+15ms, push-follow=+60ms)

$ for k in 1 2 3 4; do LOAD=10 bash repro3.sh; done
LOAD=10 first-push=LANDED follow_at=1787916343366 modeon_detected=1787916343393 push_at=1787916343462  (modeon-follow=+27ms)
LOAD=10 first-push=LANDED follow_at=1787916347761 modeon_detected=1787916347759 push_at=1787916347828  (modeon-follow=  -2ms)
LOAD=10 first-push=LANDED follow_at=1787916352229 modeon_detected=1787916352238 push_at=1787916352307  (modeon-follow=  +9ms)
LOAD=10 first-push=LANDED follow_at=1787916357007 modeon_detected=1787916356976 push_at=1787916357051  (modeon-follow= -31ms)
```

Reading this honestly:

- **`modeon-follow` went negative in 2 of 4 loaded runs.** Detection is an *upper bound* on paint time, so in
  those runs the footer demonstrably painted **before** the `follow` op reached the host. The driver's
  readiness signal is not ordered after `follow` — measured, not argued.
- **The push still landed every time** only because `tmux send-keys` → pty → the fake host's stdin costs
  another 44–78 ms after detection. That latency, not any guarantee in the code, is what my runs were
  winning on. bl5's 3/3 failures ran a whole cell suite (plus `npm run build`) on the same machine; losing
  50 ms there is entirely ordinary.
- The earlier untimed run (`repro.sh`, 100 ms poll) landed both a `message:` and a `prlink` first push, which
  is consistent: the bug is a lost coin flip, not a deterministic drop, and the bl5 note's "3/3" is a sample,
  not a property.

Supporting evidence from the same logs — the ops the client actually issues, in order, and how close they sit:

```
1787916244041 CONNECT               ← the adapter's socket (the earlier CONNECT is main.ts's probeSocket)
1787916244077 OP follow
1787916244077 FOLLOW REGISTERED followers=1
1787916244084 OP list_dirs
1787916244084 OP capabilities
1787916244309 STDIN push word="prlink" followers=1 frames=3
```

`connect` → `follow` is ~36 ms. The whole exposure is that 36 ms plus however long the paint lags it.

### C. What is *not* broken

- A real host does not lose these frames. `test/integration/host-client.test.ts:53` already pins "a client
  follows a live turn it joined late, from the turn's start" against the real `SessionHost`.
- The client's `backlog` (`chatAdapter.ts:36`, `:206`) genuinely covers connect→subscribe.
- `useChat`'s message arm appends with no live turn (`useChat.ts:1558-1571` comment: "Retention is
  unconditional now… document dedup — not a no-live-turn guard").
- `prlink` and the fold pipeline are innocent: `prlink` as the very first push rendered `Created PR #12`
  correctly in repro B, matching the bl5 note's own conclusion.

## Latent scope beyond the test harness

Worth recording even though it is not what this ticket must fix. The real host's replay covers `message`
(via `TurnBuffer`), parked decisions, bg tasks, and `state`. It does **not** replay `rewound`,
`decision_settled`, or raw `task` frames, and `stream_event` partials are deliberately excluded from the
buffer (`host.ts:402`). A rewind performed by another client inside the ~36 ms connect→follow window would
therefore leave the joining client rendering a transcript the host has truncated. Narrow, and orthogonal to
the frame-loss the pty cells see — backlog material, not this ticket.

## Candidate fixes

### Fix 1 — give `fake-host.mjs` the same replay-on-follow the real host has (**recommended**)

Buffer frames produced while `followers.size === 0` and drain them on the first `follow`, marking them
`replay: true` — i.e. make the stdin path (`:119-126`) obey the ordering rule the `FAKE_HOST_SCRIPT` path
(`:161-165`) already obeys. Roughly six lines, entirely inside a test script.

- **Pro** — fixes the actual deviation. The stand-in host stops being *less* capable than the thing it
  stands in for on precisely the axis the drivers depend on, which is the whole contract that makes fake-host
  cells trustworthy. Removes `warmup_follow` from `linkopen-cells.sh` and lets `select-pty.sh`'s
  `stream-shift` cell stop silently tolerating a possibly-dropped `LN01`. Zero production risk.
- **Pro** — it is the pattern this repo has already converged on twice: `SessionHost.follow()`
  (`host.ts:730-772`) and the app-server's `subscribe` (`src/appserver/subscribe.ts:92-140`, "Replay,
  host-follow() order (spec §5)"). A third implementation of the same rule is consistency, not novelty.
- **Con** — a frame pushed long before any client attaches would now be replayed on attach. That is what the
  real host does with its turn buffer, so it is the faithful behavior, but a cell that deliberately wants
  "pushed into the void" would need to say so.
- **Con** — it does not give drivers a true "the client is following" signal; a cell that needs to assert
  something about *live* (non-replay) delivery still has to wait for a rendered frame.

### Fix 2 — a machine-readable follow-established signal from the attach client

Have `ccx attach` announce, under a test-only env flag, that `whenReady()` resolved (a line on stderr, or a
write to a caller-supplied fd), and have the pty drivers wait on that instead of `mode on`.

- **Pro** — fixes the readiness signal itself, which is the other half of the defect, and would make every
  future fake-host cell correct by construction rather than by buffering.
- **Con** — new production surface (an env-gated side channel) for a test-only need, and it still leaves the
  fake host lossy for any frame that legitimately precedes the signal.
- **Con** — the tempting variant, *gate the first paint on the follow ack*, is a real UX regression: a slow
  or wedged host would hold the attach client on a blank screen instead of showing a usable UI immediately.
  That ordering is deliberate and should not be traded away for a test.

### Fix 3 — sequence-numbered events with client-side catch-up

Stamp every `HostEvent` with a monotonic seq, have the client report its last-seen seq on `follow`, and have
the host resend the gap.

- **Pro** — the only option that also closes the latent `rewound` / `decision_settled` / `task` gap noted
  above, and it would survive a reconnect, not just a first attach.
- **Con** — a wire-protocol change with version-skew consequences on a wire this codebase has worked hard to
  keep additive and backward-readable, and it requires the host to retain a gap buffer for event kinds that
  today are fire-and-forget by design. Far too much machinery for a defect that lives in a test script.

**Recommendation: Fix 1.** The production transport already implements the correct handshake and an
integration test already pins it; the only component missing the handshake is the stand-in host, and the bug
is a test-infrastructure defect masquerading as a transport race. Fix 2's readiness signal is worth keeping
in the backlog as a driver-ergonomics improvement, and Fix 3 should be dismissed at this scope — the parts of
it that matter (the `rewound` window) belong in a separate, host-side ticket.

**How to test it.**

- *Unit seam*: `test/integration/host-client.test.ts` gets a sibling case that spawns `scripts/fake-host.mjs`
  over a real UDS, writes one push word to its stdin **before** connecting a `remoteChatSession`, and asserts
  the frame arrives (marked `replay`) after `whenReady()`. `node-repro.mjs` above is that test already
  written in throwaway form — both arms pass/fail deterministically with no sleeps beyond one 300 ms drain.
- *pty acceptance*: delete `warmup_follow` from `scripts/linkopen-cells.sh` and let the `self-open`,
  `fold-link`, and `hover-suppress` cells push their real content as the first-ever push. Those three cells
  passing without the sentinel **is** the acceptance criterion — it is the exact workaround this ticket
  exists to remove. Run it a handful of times under load (`repro3.sh`'s `LOAD=10` trick) so a pass is not a
  won coin flip.

## Open questions

1. **Should the drivers keep any readiness wait at all?** With Fix 1 in place, a cell could push
   immediately after `tmux new-session` and rely on replay — which is faster and strictly more deterministic
   than waiting for `mode on`. Waiting still has value for cells that then send *mouse* bytes (those genuinely
   need a painted frame to compute columns against). Probably: keep the `mode on` wait where a click follows,
   drop it where only content is asserted. Worth a decision rather than leaving it per-cell.
2. **Should replayed frames in the fake host carry `replay: true`?** The real host marks them, and
   `useChat.ts:1437` uses that mark to suppress arrival-clock stamping. Marking them is faithful — but it also
   means a cell asserting on turn durations or Agent timing would see different output than it does today
   with the sentinel workaround. No current cell appears to assert on that; worth one grep before committing.
3. **Is the `rewound`-in-the-connect-window gap worth its own ticket?** It is a genuine production hole
   (§Latent scope) with a small blast radius. My read is yes, as a low-priority host-side ticket, not folded
   into this one.
4. **bl5's 3/3.** I could not reproduce a drop on this machine even under ten busy cores — the push always
   landed by 44 ms. The mechanism is proven and the ordering is proven, but the specific 3/3 remains a sample
   from a busier machine rather than something I re-observed. If a fix needs a failing-first test, use the
   node-level repro (Fix 1's seam), which fails deterministically; do not try to make the pty cell fail.

---

### Artifacts (scratch, outside the repo)

- `/Users/new/.claude/jobs/4b30d1a4/tmp/bl6attach/node-repro.mjs` — deterministic mechanism repro (both arms)
- `/Users/new/.claude/jobs/4b30d1a4/tmp/bl6attach/fake-host-logged.mjs` — `scripts/fake-host.mjs` + timestamped CONNECT/OP/FOLLOW/STDIN logging
- `/Users/new/.claude/jobs/4b30d1a4/tmp/bl6attach/repro.sh`, `repro2.sh`, `repro3.sh` — tmux drivers (private socket, own-session teardown only)

No production source was modified.
