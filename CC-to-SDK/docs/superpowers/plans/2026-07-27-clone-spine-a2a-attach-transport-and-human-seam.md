# A2a — Attach Transport & the Human Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a running `ccx` session a human seam and a live stream — a host that parks permission
decisions instead of auto-denying them, broadcasts its turn to N connected clients, and answers
`prompt`/`answer`/`interrupt` over its existing per-session socket — so that A2b's interactive `ccx
attach` has something real to attach *to*.

**Architecture:** Everything lands host-side, inside `harness/`. The A1 socket (`~/.claude/ccx/run/<pid>.sock`,
NDJSON, one op per line) grows two things: correlation ids on replies and a second frame type for
server-pushed events. `SessionHost` gains a fan-out (`follow`) with a bounded buffer of the current
turn, and owns a park registry — the one that exists today under `daemon/`, promoted out of the
supervisor that is being retired and given an explicit never-expire policy. A `RemoteChatSession`
client speaks the whole surface, and is the consumer that proves it in tests.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `node:net` UDS, `zod/v4` for op parsing,
`vitest`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-clone-process-surface-spine-design.md` (rev 3.x). This is
the **second plan against that one spec**; A1 (`2026-07-26-clone-spine-a1-fleet-substrate.md`) built
the process substrate. This plan closes spec acceptance **8** and builds the transport that A2b needs
for acceptance 5, 6, 7 and 10. It does **not** build `ccx attach`, `--detachable`, or the foreground
client — those stay refused at the CLI, because they need the Ink client that lives in a different
package.

## Global Constraints

- **No `Co-Authored-By` lines** or any other attribution in commit messages.
- **ESM:** every relative import specifier ends in `.js`, even though the sources are `.ts`.
- **Dense hand style, no Prettier.** Match the surrounding file; do not reformat neighbouring code.
- **DI-by-deps:** inject collaborators through a `deps = { … }` default parameter, mirroring
  `SessionHost`'s existing constructor. Every test in this plan runs **without an API key**.
- **Tests before implementation.** The park tests especially: *parked promises that hang, leak, or
  fake-settle on teardown are this project's recurring bug class* (spec, Testing).
- **A guard test must be proven against the regression it names.** Make the change it guards against,
  watch the test fail, revert. A guard that passes under its own regression is worse than no guard.
- **`agents` stays read-only.** Nothing in this plan may make a read command write to the roster.
- **Deny-on-lost-UI stays the default for interactive sessions; park is opt-in and `kind`-scoped.**
- **Any explicit permission configuration wins.** (The spec's default ask-policy *floor* is **not**
  built in A2a — see Task 8 — but this precedence rule still governs everything that is.)
- **First answer wins across clients**; a second answerer is told who answered, and is not an error.
- **`detach()` ≠ `dispose()`.** A client going away must never deny a request that is already parked.
- **The wire stays backward-compatible with an already-running A1 host.** Replies keep their A1 shape
  (`{ok:…}` at the top level, no discriminator); only server-*pushed* frames carry `t:"event"`, and
  they are only ever sent to a connection that asked for them. An `agents` run from a freshly-built
  binary must still read a host that started before the upgrade.
- Commands run from `CC-to-SDK/harness/`: `npm run typecheck`, `npm run test:unit`,
  `npx vitest run test/unit/<file>`, `npm run build`.

---

## Files

**Create**

| Path | Responsibility |
|---|---|
| `harness/src/permissions/pending.ts` | The park registry (moved from `daemon/permissions.ts`), with an explicit expiry policy |
| `harness/src/host/wire.ts` | Frame types + encode/decode for the host socket, shared by server and client |
| `harness/src/host/follow.ts` | `TurnBuffer` — the bounded record of the current turn replayed to a late follower |
| `harness/src/client/remote.ts` | `RemoteChatSession` — the socket client |
| `harness/test/unit/permissions-pending.test.ts` | The park quartet + never-expire |
| `harness/test/unit/host-wire.test.ts` | Frame encode/decode, id echo, v1 compatibility |
| `harness/test/unit/host-follow.test.ts` | `TurnBuffer` bounds, truncation flag, replay order |
| `harness/test/unit/host-park.test.ts` | Kind-scoped park policy, `status()` → `blocked`, detach-does-not-deny |
| `harness/test/unit/host-ops.test.ts` | `pending`/`answer`/`prompt`/`interrupt`/`stop` op behaviour |
| `harness/test/unit/host-teardown.test.ts` | `stop()` returns, and closes the socket, even when dispose never settles |
| `probes/probes/64-auto-mode-vs-canusetool.ts` | Whether `permissionMode: "auto"` consults `canUseTool` at all (Task 8) |
| `harness/test/integration/host-client.test.ts` | Real UDS + fake `QueryFn`: attach, follow, park, multi-client, detach-vs-dispose, roster on exit |

**Modify**

| Path | Change |
|---|---|
| `harness/src/daemon/permissions.ts` | Deleted; importers repoint to `permissions/pending.ts` |
| `harness/src/daemon/supervisor.ts` | Import path only; add the explicit `expireAfterMs: 30_000` it relies on today |
| `harness/src/index.ts:54` | `PendingEntry` re-exported from its new path |
| `harness/src/host/ops.ts` | Op union grows; `HostStatus` unchanged (it already carries `waitingFor`) |
| `harness/src/host/server.ts` | Correlation ids, event frames, per-connection subscriptions |
| `harness/src/host/host.ts` | `follow()`, the park registry, `status()` → `blocked`, `stop()` settles parks |
| `harness/src/fleet/status.ts` | **No change expected.** It sends no `id` and reads a bare `{ok:…}` reply — which is exactly what keeps it able to read a pre-A2a host. Verify, do not "improve". |

---

## Task 1: Promote the park registry out of the retiring daemon

**Files:**
- Create: `harness/src/permissions/pending.ts`
- Delete: `harness/src/daemon/permissions.ts`
- Modify: `harness/src/daemon/supervisor.ts` (import path + explicit expiry), `harness/src/index.ts:54`
- Test: `harness/test/unit/permissions-pending.test.ts`

**Interfaces:**
- Produces: `class PendingPermissions`, `interface PendingEntry`, `type ExpiryPolicy = number | "never"`.
  `new PendingPermissions({ expireAfterMs })`, `.brokerFor(sessionId)`, `.respond(toolUseID, decision)`,
  `.list()`, `.denyAllForSession(id)`, `.denyAll()`.
- Consumes: `PermissionBroker`, `PermissionDecision`, `PermissionRequest` from `../permissions/types.js`.

**Context.** `harness/src/daemon/permissions.ts` already implements almost exactly the registry a host
needs. It lives under `daemon/`, which the spec retires ("`cc-harness daemon` / `ps` / `submit` /
`top` — retired, no supervisor"), and it auto-denies every park after 30 seconds. A background host
must be able to park **forever**: that is the whole point of acceptance 8. So: move it, and make the
expiry a policy the caller states rather than a constant with a default.

The rename of the option is deliberate. Today it is `timeoutMs`, which reads like "how long to wait
for a reply" — a knob you might reasonably leave at its default. It is in fact "how long until we
answer *for* the human, with a deny". Calling it `expireAfterMs` and requiring `"never"` to be spelled
out makes the dangerous case impossible to reach by omission.

- [ ] **Step 1: Write the failing tests**

Create `harness/test/unit/permissions-pending.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PendingPermissions } from "../../src/permissions/pending.js";
import type { PermissionRequest } from "../../src/permissions/types.js";

const req = (toolUseID: string, signal = new AbortController().signal): PermissionRequest =>
  ({ toolName: "Bash", input: { command: "ls" }, toolUseID, signal });

describe("PendingPermissions", () => {
  it("settles the awaited promise when answered", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1"));
    expect(p.list()).toHaveLength(1);
    expect(p.respond("t1", { kind: "allow_once" })).toBe(true);
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
    expect(p.list()).toHaveLength(0);
  });

  it("does not leak: an answered entry is gone and its timer is cancelled", () => {
    const cancel = vi.fn();
    const p = new PendingPermissions({ expireAfterMs: 1000, schedule: () => cancel });
    void p.brokerFor("s1").request(req("t1"));
    p.respond("t1", { kind: "deny" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(p.list()).toHaveLength(0);
  });

  it("rejects a duplicate answer rather than resolving twice", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1"));
    expect(p.respond("t1", { kind: "allow_once" })).toBe(true);
    expect(p.respond("t1", { kind: "deny" })).toBe(false);   // second answer is refused, not applied
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
  });

  it("denies everything on teardown so nothing is left awaited", async () => {
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const a = p.brokerFor("s1").request(req("t1"));
    const b = p.brokerFor("s2").request(req("t2"));
    p.denyAll();
    await expect(a).resolves.toEqual({ kind: "deny" });
    await expect(b).resolves.toEqual({ kind: "deny" });
  });

  it('expireAfterMs "never" schedules NO timer at all', () => {
    const schedule = vi.fn(() => () => {});
    const p = new PendingPermissions({ expireAfterMs: "never", schedule });
    void p.brokerFor("s1").request(req("t1"));
    expect(schedule).not.toHaveBeenCalled();     // not "a very long timer" — none
    expect(p.list()).toHaveLength(1);
  });

  it("expires to deny when a finite policy is given", async () => {
    let fire = () => {};
    const p = new PendingPermissions({ expireAfterMs: 50, schedule: (fn) => { fire = fn; return () => {}; } });
    const decision = p.brokerFor("s1").request(req("t1"));
    fire();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });

  it("settles on abort so an interrupted turn cannot leave an awaited promise", async () => {
    const ac = new AbortController();
    const p = new PendingPermissions({ expireAfterMs: "never" });
    const decision = p.brokerFor("s1").request(req("t1", ac.signal));
    ac.abort();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });
});
```

- [ ] **Step 2: Run them and watch every one fail**

Run: `npx vitest run test/unit/permissions-pending.test.ts`
Expected: FAIL — `Cannot find module '../../src/permissions/pending.js'`.

- [ ] **Step 3: Move the file and make the policy explicit**

`git mv src/daemon/permissions.ts src/permissions/pending.ts`, then apply exactly these changes:

```ts
// harness/src/permissions/pending.ts
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "./types.js";
```

```ts
/** How long a parked request may sit before we answer FOR the human, with a deny. `"never"` is the
 *  background case and is spelled out rather than defaulted: a host that parks forever is the entire
 *  point of a worker that outlives its terminal, and a numeric default is how that silently becomes a
 *  30-second auto-deny again. */
export type ExpiryPolicy = number | "never";

export interface PendingPermissionsOpts {
  expireAfterMs: ExpiryPolicy;                           // REQUIRED — no default, deliberately
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}
```

In the constructor, replace the `timeoutMs` field with `private expireAfterMs: ExpiryPolicy` taken
straight from `opts.expireAfterMs` (no `??`). In `park`, guard the timer:

```ts
    const cancelTimer = this.expireAfterMs === "never"
      ? () => {}
      : this.schedule(() => this.settle(req.toolUseID, { kind: "deny" }), this.expireAfterMs);
```

Everything else in the class — `settle`, `respond`, `list`, `denyAllForSession`, `denyAll`, the abort
listener — is already correct and must be carried over **unchanged**.

- [ ] **Step 4: Repoint the importers**

`harness/src/daemon/supervisor.ts`: change the import to `../permissions/pending.js`. The real line is
`new PendingPermissions({ timeoutMs: opts.permissionTimeoutMs, now: this.now })` — keep **both**
arguments; the daemon's documented `DaemonOptions.permissionTimeoutMs` knob and its injected clock are
not yours to drop:

```ts
    this.pending = new PendingPermissions({ expireAfterMs: opts.permissionTimeoutMs ?? 30_000, now: this.now });
```

Search for any other importer (`grep -rn "daemon/permissions" src/ test/`) and repoint it too.

`harness/src/index.ts:54`: `export type { PendingEntry } from "./permissions/pending.js";` — the
exported **name** does not change, so `test/unit/index.test.ts` (which pins the public surface) must
still pass untouched. If it fails, you have changed the surface; fix the export, not the test.

- [ ] **Step 5: Run the new tests and the daemon's own**

Run: `npx vitest run test/unit/permissions-pending.test.ts test/unit/index.test.ts`
Then: `npx vitest run test/unit` and `npm run typecheck`

`test/unit/daemon-permissions.test.ts` constructs `new PendingPermissions()` bare in three places and
with only `{now}`/`{schedule}` in three more; a required `expireAfterMs` fails all six on typecheck.
**The only edits permitted in that file are the import path and adding `expireAfterMs: 30_000` to those
constructor calls.** Any other change — softening the required field, altering an assertion — means the
move changed semantics: stop and report it instead.

- [ ] **Step 6: Commit**

```bash
git add -A harness/src/permissions harness/src/daemon harness/src/index.ts harness/test/unit
git commit -m "refactor(a2a): promote the park registry out of the retiring daemon

Moves PendingPermissions to permissions/pending.ts and replaces the 30s
timeoutMs default with a required expireAfterMs: number | \"never\". A
background host must park forever; a defaulted timeout is how that becomes a
silent auto-deny again."
```

---

## Task 2: Correlation ids and a second frame type on the wire

**Files:**
- Create: `harness/src/host/wire.ts`, `harness/test/unit/host-wire.test.ts`
- Modify: `harness/src/host/ops.ts`, `harness/src/host/server.ts`

**Interfaces:**
- Produces: `type HostEvent`, `encodeReply(id, body)`, `encodeEvent(ev)`, `type HostFrame`,
  `decodeFrame(line): HostFrame | undefined`. `HostServer` learns to echo correlation ids. Fan-out is
  **not** part of this task — Task 6 adds it, per connection.
- Consumes: nothing new.

**Context.** A1's socket answers one reply per request line. A client that is *following* needs frames
the host sends unbidden, and a client that has a request in flight while events stream needs to tell a
reply from an event. Two rules keep this from becoming a protocol rewrite:

1. **Replies keep their A1 shape.** They stay `{ok:true, …}` / `{ok:false, error}` at the top level,
   with an `id` echoed back only when the request carried one. This is not politeness toward a
   hypothetical consumer — a background session spawned before this change is *still running* on the
   old code, and `ccx agents` must keep reading it. Adding a discriminator to replies would make every
   pre-upgrade host read as unresponsive.
2. **Only pushed frames carry `t:"event"`**, and a connection receives them only after it has asked
   (Task 7's `follow` op). An A1 client never asks, so it never sees one.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/host-wire.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeFrame, encodeEvent, encodeReply } from "../../src/host/wire.js";

describe("host wire", () => {
  it("a reply keeps the A1 top-level shape so a pre-upgrade client still parses it", () => {
    const line = encodeReply(undefined, { ok: true, state: "working", status: "busy" });
    const parsed = JSON.parse(line.trim());
    expect(parsed).toEqual({ ok: true, state: "working", status: "busy" });   // no `t`, no `id`
  });

  it("echoes the id when the request carried one", () => {
    expect(JSON.parse(encodeReply(7, { ok: true }).trim())).toEqual({ ok: true, id: 7 });
  });

  it("an event is discriminated and never mistaken for a reply", () => {
    const parsed = JSON.parse(encodeEvent({ kind: "state", status: { state: "blocked", status: "idle" } }).trim());
    expect(parsed.t).toBe("event");
    expect(parsed.kind).toBe("state");
  });

  it("every frame ends in exactly one newline", () => {
    for (const l of [encodeReply(1, { ok: true }), encodeEvent({ kind: "message", data: { a: 1 } })]) {
      expect(l.endsWith("\n")).toBe(true);
      expect(l.slice(0, -1)).not.toContain("\n");
    }
  });

  it("decodeFrame rejects junk rather than throwing", () => {
    expect(decodeFrame("not json")).toBeUndefined();
    expect(decodeFrame("[1,2,3]")).toBeUndefined();
    expect(decodeFrame(JSON.stringify({ t: "event", kind: "message", data: 1 }))?.t).toBe("event");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/host-wire.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `harness/src/host/wire.ts`**

```ts
import type { PendingEntry } from "../permissions/pending.js";
import type { HostStatus } from "./ops.js";

/** Server-pushed frames. A reply is NOT one of these: replies keep A1's bare `{ok:…}` shape so a host
 *  started before this change stays readable by a client built after it. Only a connection that sent
 *  `follow` ever receives an event, so an A1 client cannot be confused by one. */
export type HostEvent =
  | { kind: "message"; data: unknown }                                      // one SDK message from the turn
  | { kind: "permission"; entry: PendingEntry }                             // a decision just parked
  | { kind: "permission_settled"; toolUseID: string; by: string; decision: string }
  | { kind: "state"; status: HostStatus }
  | { kind: "turn"; phase: "start" | "end"; error?: string; truncated?: boolean };

export type HostFrame = { t: "event" } & HostEvent | ({ t?: undefined } & Record<string, unknown>);

export function encodeReply(id: number | undefined, body: Record<string, unknown>): string {
  return JSON.stringify(id === undefined ? body : { ...body, id }) + "\n";
}

export function encodeEvent(ev: HostEvent): string { return JSON.stringify({ t: "event", ...ev }) + "\n"; }

/** Parse one line. Returns undefined for anything that is not a JSON object — a peer writing junk is a
 *  peer to ignore, not a reason to throw inside a detached host nobody is watching. */
export function decodeFrame(line: string): HostFrame | undefined {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return undefined; }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  return v as HostFrame;
}
```

- [ ] **Step 4: Add the id to the op union**

In `harness/src/host/ops.ts`, give every op an optional numeric id. Keep the discriminated union:

```ts
const withId = { id: z.number().int().nonnegative().optional() };
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
]);
```

- [ ] **Step 5: Teach the server to echo ids**

In `harness/src/host/server.ts`, route replies through `encodeReply`.

**Do not add a `broadcast` method or a subscriber set.** Task 6 delivers events **per connection**,
writing straight to the socket that asked for them. A shared broadcast looks natural here and is
wrong: each following connection registers its own host-side follower, so a broadcast-from-each-
follower delivers every event N times to each of N clients (N² writes), and a late joiner's replay
goes to everyone rather than to the joiner. Keep the server dumb about fan-out.

In the data handler, replace the two `sock.write(JSON.stringify(...) + "\n")` calls so the reply is
built by `encodeReply` with the id parsed off the request. Parse the id **before** validating the op,
so a malformed op still gets a correlated error:

```ts
        const frame = decodeFrame(line);
        const id = typeof frame?.["id"] === "number" ? (frame["id"] as number) : undefined;
        try { sock.write(encodeReply(id, await this.dispatch(frame))); }
        catch (e) { sock.write(encodeReply(id, { ok: false, error: (e as Error).message })); }
```

and change `dispatch` to take the decoded frame rather than the raw line (`if (!frame) return { ok:
false, error: "bad json" };`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/unit/host-wire.test.ts && npx vitest run test/unit && npm run typecheck`
Expected: PASS. The existing host-server tests must pass unchanged — that is the compatibility claim
being checked.

- [ ] **Step 7: Commit**

```bash
git add harness/src/host harness/test/unit/host-wire.test.ts
git commit -m "feat(a2a): correlation ids and pushed event frames on the host socket

Replies keep A1's bare {ok:…} shape — a session spawned before this change is
still running, and agents must keep reading it. Only frames the host pushes
carry t:\"event\", and only to a connection that asked to follow."
```

---

## Task 3: The bounded record of the current turn

**Files:**
- Create: `harness/src/host/follow.ts`, `harness/test/unit/host-follow.test.ts`

**Interfaces:**
- Produces: `class TurnBuffer` — `push(m: unknown)`, `snapshot(): { messages: unknown[]; truncated: boolean }`,
  `reset()`. Constructed as `new TurnBuffer({ maxMessages, maxBytes })`.

**Context — measured, not assumed.** A client attaching mid-turn needs to see the turn *from its
beginning*, not from the moment it connected. Probe 62 settled where that content can come from, on a
real 21.6-second turn sampled fourteen times:

```
  [poll +1506ms]  getSessionMessages -> 1 messages (tail: user)
  …                                     (unchanged, every sample)
  [poll +21167ms] getSessionMessages -> 1 messages (tail: user)
  transcript after turn: 3 messages
```

The engine writes the user's prompt at once and then **nothing until the turn ends**. So the on-disk
transcript carries the conversation *up to and including the current prompt*, and the in-flight
assistant text exists only in the live stream. Without a host-side record, a client attaching ten
seconds into a turn sees a prompt and a blank space where the answer is being written.

The same probe measured the fan-out cost the spec asked us not to assume: **61 messages / 30.2 KiB
over 21.6 s — 2.8 messages/s, 1.4 KiB/s**, of which 47 were partial `stream_event` frames. Writing
that to a handful of unix sockets is free. No coalescing, no backpressure machinery: bound the buffer
for memory, and write events straight through.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/host-follow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TurnBuffer } from "../../src/host/follow.js";

describe("TurnBuffer", () => {
  it("replays in arrival order", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    expect(b.snapshot()).toEqual({ messages: [{ n: 1 }, { n: 2 }, { n: 3 }], truncated: false });
  });

  it("drops the OLDEST past maxMessages and says it truncated", () => {
    const b = new TurnBuffer({ maxMessages: 2, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 }); b.push({ n: 3 });
    const s = b.snapshot();
    expect(s.messages).toEqual([{ n: 2 }, { n: 3 }]);
    expect(s.truncated).toBe(true);      // a follower must know it joined a partial view
  });

  it("drops past maxBytes as well, so one huge message cannot pin the heap", () => {
    const b = new TurnBuffer({ maxMessages: 100, maxBytes: 120 });
    b.push({ pad: "x".repeat(100) });
    b.push({ pad: "y".repeat(100) });
    const s = b.snapshot();
    expect(s.messages).toHaveLength(1);
    expect(JSON.stringify(s.messages[0])).toContain("y");
    expect(s.truncated).toBe(true);
  });

  it("a single message larger than maxBytes is kept, not dropped into nothing", () => {
    const b = new TurnBuffer({ maxMessages: 10, maxBytes: 10 });
    b.push({ pad: "z".repeat(500) });
    expect(b.snapshot().messages).toHaveLength(1);   // an empty replay is worse than an oversized one
  });

  it("reset clears the record and the truncation flag for the next turn", () => {
    const b = new TurnBuffer({ maxMessages: 1, maxBytes: 10_000 });
    b.push({ n: 1 }); b.push({ n: 2 });
    expect(b.snapshot().truncated).toBe(true);
    b.reset();
    expect(b.snapshot()).toEqual({ messages: [], truncated: false });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/host-follow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `harness/src/host/follow.ts`**

```ts
export interface TurnBufferOpts { maxMessages: number; maxBytes: number }

/** The current turn, kept in memory so a client that attaches mid-turn sees it from the start rather
 *  than from the moment it connected. Bounded on both counts because this lives in a detached process
 *  that may run for hours: a message cap alone loses to one enormous tool result, a byte cap alone
 *  loses to a flood of tiny stream deltas. */
export class TurnBuffer {
  private messages: unknown[] = [];
  private sizes: number[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private opts: TurnBufferOpts) {}

  push(m: unknown): void {
    const size = JSON.stringify(m)?.length ?? 0;
    this.messages.push(m); this.sizes.push(size); this.bytes += size;
    // `length > 1` on the byte trim: a lone message over the cap is kept. Replaying one oversized
    // message is a worse view than replaying all of them, but replaying NOTHING is worse than both,
    // and that is what an unguarded while-loop produces for a single 2 MiB tool result.
    while (this.messages.length > this.opts.maxMessages
      || (this.bytes > this.opts.maxBytes && this.messages.length > 1)) {
      this.messages.shift(); this.bytes -= this.sizes.shift() ?? 0; this.truncated = true;
    }
  }

  snapshot(): { messages: unknown[]; truncated: boolean } {
    return { messages: [...this.messages], truncated: this.truncated };
  }

  reset(): void { this.messages = []; this.sizes = []; this.bytes = 0; this.truncated = false; }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/host-follow.test.ts && npm run typecheck`
Expected: PASS (5/5).

- [ ] **Step 5: Prove the byte-trim guard against its own regression**

Delete `&& this.messages.length > 1` from the while condition, re-run, and confirm *"a single message
larger than maxBytes is kept"* FAILS. Restore it. Record in your report that you did this and what
the failure said.

- [ ] **Step 6: Commit**

```bash
git add harness/src/host/follow.ts harness/test/unit/host-follow.test.ts
git commit -m "feat(a2a): TurnBuffer — the bounded record of the current turn

A client attaching mid-turn must see the turn from its start. Probe 62 measured
that the engine does NOT put it on disk: across a 21.6s turn, fourteen samples
of getSessionMessages all read one message (the user's prompt), reaching three
only after the turn ended. So the in-flight assistant text exists only in the
live stream, and the host keeps its own bounded record to replay to a late
follower.

Bounded on both counts because a detached host may run for hours: a message cap
alone loses to one enormous tool result, a byte cap alone to a flood of tiny
stream deltas. A single message over the byte cap is kept rather than evicted,
because an empty replay is worse than an oversized one."
```

---

## Task 4: `SessionHost.follow()` — fan-out with a late-joiner replay

**Files:**
- Modify: `harness/src/host/host.ts`
- Test: `harness/test/unit/host-follow.test.ts` (append a `SessionHost.follow` block)

**Interfaces:**
- Produces: `SessionHost.follow(cb: (ev: HostEvent) => void): () => void` (the returned function
  unsubscribes). `SessionHost` now emits `turn` start/end and `message` events.
- Consumes: `TurnBuffer` from Task 3, `HostEvent` from Task 2.

**Context.** `runTask` currently passes a `stamp` callback into `session.submit` purely to capture the
session id mid-turn. That callback is the fan-out point: every message the SDK produces arrives there.
Do not change *when* the session id is stamped — that fix is load-bearing (the consumer's uuid poller
gives up after ~60 s) and its comment in `host.ts` explains why it is once-only.

- [ ] **Step 1: Write the failing test**

Append to `harness/test/unit/host-follow.test.ts`:

```ts
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

/** A session whose turn we drive by hand, so the test controls exactly when messages arrive. */
function fakeSession() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-1",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

const hostFor = (session: ReturnType<typeof fakeSession>, env: NodeJS.ProcessEnv) =>
  new SessionHost(
    { short: "aaaaaaaa", name: "t", cwd: "/tmp", kind: "bg", config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" },
  );

describe("SessionHost.follow", () => {
  it("fans one message out to every follower", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const a: HostEvent[] = [], b: HostEvent[] = [];
    host.follow((e) => a.push(e)); host.follow((e) => b.push(e));
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 });
    expect(a.filter((e) => e.kind === "message")).toHaveLength(1);
    expect(b.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await turn; await host.stop();
  });

  it("replays the turn so far to a follower that joins mid-turn", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const turn = host.runTask("hi");
    s.emit({ type: "assistant", n: 1 }); s.emit({ type: "assistant", n: 2 });
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1, 2]);
    s.finish(); await turn; await host.stop();
  });

  it("unsubscribing stops delivery and does not disturb the others", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const a: HostEvent[] = [], b: HostEvent[] = [];
    const off = host.follow((e) => a.push(e)); host.follow((e) => b.push(e));
    const turn = host.runTask("hi");
    off();
    s.emit({ type: "assistant", n: 1 });
    expect(a.filter((e) => e.kind === "message")).toHaveLength(0);
    expect(b.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await turn; await host.stop();
  });

  it("a throwing follower cannot kill the turn or starve the other followers", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const good: HostEvent[] = [];
    host.follow(() => { throw new Error("client blew up"); });
    host.follow((e) => good.push(e));
    const turn = host.runTask("hi");
    expect(() => s.emit({ type: "assistant", n: 1 })).not.toThrow();
    expect(good.filter((e) => e.kind === "message")).toHaveLength(1);
    s.finish(); await expect(turn).resolves.toBeUndefined();
    await host.stop();
  });

  it("the buffer resets between turns, so turn two does not replay turn one", async () => {
    const s = fakeSession(); const host = hostFor(s, { CCX_FLEET_ROOT: tmpFleet() });
    await host.start();
    const t1 = host.runTask("one"); s.emit({ type: "assistant", n: 1 }); s.finish(); await t1;
    const t2 = host.runTask("two");
    const late: HostEvent[] = []; host.follow((e) => late.push(e));
    expect(late.filter((e) => e.kind === "message")).toHaveLength(0);
    s.finish(); await t2; await host.stop();
  });
});
```

Add this helper at the top of the file (the roster writes need somewhere harmless to land):

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-follow-"));
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/unit/host-follow.test.ts`
Expected: FAIL — `host.follow is not a function`.

- [ ] **Step 3: Implement the fan-out in `harness/src/host/host.ts`**

Add the imports and fields:

```ts
import { TurnBuffer } from "./follow.js";
import type { HostEvent } from "./wire.js";
```

```ts
  private followers = new Set<(ev: HostEvent) => void>();
  private turnBuffer = new TurnBuffer({ maxMessages: 500, maxBytes: 1024 * 1024 });
```

```ts
  /** Subscribe to the live turn. The new follower is replayed the turn so far FIRST, synchronously, so
   *  it never sees message 3 before messages 1 and 2. Returns its own unsubscribe. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const snap = this.turnBuffer.snapshot();
    // The truncation flag has to reach the client or it is a promise we do not keep: TurnBuffer
    // records that the replay is partial, and a follower shown a partial turn with no marker reads it
    // as the whole turn. Sent only when true, so an untruncated replay costs no frame.
    if (snap.truncated) this.deliver(cb, { kind: "turn", phase: "start", truncated: true });
    for (const m of snap.messages) this.deliver(cb, { kind: "message", data: m });
    this.followers.add(cb);
    return () => { this.followers.delete(cb); };
  }

  /** One follower's failure is that follower's problem. Without this guard a client whose callback
   *  throws — a socket write to a peer that vanished, most likely — unwinds through the SDK's message
   *  dispatch and rejects the turn, taking a detached host down over a client that already left. */
  private deliver(cb: (ev: HostEvent) => void, ev: HostEvent): void {
    try { cb(ev); } catch { /* a follower that throws is dropped from this event, not from the set */ }
  }

  private emit(ev: HostEvent): void { for (const cb of [...this.followers]) this.deliver(cb, ev); }
```

In `runTask`, reset the buffer, wrap the existing `stamp` callback, and bracket the turn:

```ts
  async runTask(prompt: string): Promise<void> {
    this.busy = true; this.state = "working";
    this.turnBuffer.reset();
    this.emit({ kind: "turn", phase: "start" });
    let stamped = false;
    const onMessage = (m: unknown) => {
      // The session-id stamp keeps its ONCE-ONLY guard and its position: it must land the moment the
      // init frame arrives (the consumer's uuid poller gives up after ~60s) and must not repeat (a
      // read-then-write per message reopens the window in which a concurrent `ccx rm` is undone).
      if (!stamped && this.session?.sessionId) { stamped = true; this.writeSessionId(); }
      this.turnBuffer.push(m);
      this.emit({ kind: "message", data: m });
    };
    try { await this.session!.submit(prompt, onMessage); this.state = "done"; }
    catch (e) { this.state = "error"; this.emit({ kind: "turn", phase: "end", error: (e as Error)?.message }); throw e; }
    finally { this.busy = false; if (this.opts.kind === "bg") this.syncRoster(); }
    this.emit({ kind: "turn", phase: "end" });
  }
```

Note the `finally` keeps its existing body verbatim; the `turn end` on the success path is emitted
after it, and the error path emits its own before rethrowing.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/host-follow.test.ts && npx vitest run test/unit && npm run typecheck`
Expected: PASS, including every pre-existing host test.

- [ ] **Step 5: Prove the throwing-follower guard**

Remove the `try/catch` in `deliver`, re-run, confirm *"a throwing follower cannot kill the turn"*
FAILS, restore. Report what the failure said.

- [ ] **Step 6: Commit**

```bash
git add harness/src/host/host.ts harness/test/unit/host-follow.test.ts
git commit -m "feat(a2a): SessionHost.follow — fan-out with a late-joiner replay

A follower joining mid-turn is replayed the turn so far before it is added to
the set, so it never sees message 3 before 1 and 2. A follower whose callback
throws is skipped for that event rather than unwinding into the turn."
```

---

## Task 5: The park, wired and `kind`-scoped

**Files:**
- Modify: `harness/src/host/host.ts`
- Test: `harness/test/unit/host-park.test.ts` (new)

**Interfaces:**
- Produces: `SessionHost.pending(): PendingEntry[]`,
  `SessionHost.answer(toolUseID, decision, by): { ok: true; alreadyAnsweredBy?: string } | { ok: false; error: string }`
  — the `ok:false` arm is for a `toolUseID` that was never parked, which must not be reported as
  success; see Step 3's code, which is authoritative — and a `status()` that reports `blocked` while
  anything is parked.
- Consumes: `PendingPermissions` (Task 1), `HostEvent` (Task 2), `follow`/`emit` (Task 4).

**Context — read this twice, it is the subtlest rule in the plan.** The spec keeps two opposite
behaviours alive on purpose:

- A **`--bg`** host parks a decision **indefinitely**. Surviving unattended is its purpose.
- An **interactive** host keeps *deny-on-lost-UI*: a human who closed the window is not going to
  answer, and hanging forever on their behalf is worse than denying.

The rule that reconciles them is evaluated **when the request arrives, never retroactively**:

> An interactive host denies immediately **if no follower is attached at the moment the request
> arrives**. Once a request is parked, it stays parked — even if every follower then detaches.

Getting this backwards breaks acceptance 6, which requires that `Ctrl+Z` (detach) leaves the pending
permission alone. "Deny when the last follower leaves" would deny exactly the request the human
detached in order to go think about. Implement the rule as written; do not add a timer.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/host-park.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-park-"));
const fakeSession = () => ({ sessionId: "sid", submit: async () => undefined, dispose: async () => {} });
const hostFor = (kind: "bg" | "interactive") =>
  new SessionHost({ short: "bbbbbbbb", name: "t", cwd: "/tmp", kind, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: () => fakeSession(), procStartOf: async () => "start" });

const ask = (host: SessionHost, toolUseID = "t1") =>
  host.broker().request({ toolName: "Bash", input: { command: "ls" }, toolUseID, signal: new AbortController().signal });

describe("host park policy", () => {
  it("a bg host parks with no follower attached, and reports blocked", async () => {
    const host = hostFor("bg"); await host.start();
    const decision = ask(host);
    expect(host.pending()).toHaveLength(1);
    expect(host.status()).toMatchObject({ state: "blocked", status: "idle", waitingFor: "permission:Bash" });
    host.answer("t1", { kind: "allow_once" }, "test");
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
    expect(host.status().state).not.toBe("blocked");
    await host.stop();
  });

  it("an interactive host with NO follower denies immediately instead of hanging", async () => {
    const host = hostFor("interactive"); await host.start();
    await expect(ask(host)).resolves.toEqual({ kind: "deny" });
    expect(host.pending()).toHaveLength(0);
    await host.stop();
  });

  it("an interactive host WITH a follower parks", async () => {
    const host = hostFor("interactive"); await host.start();
    host.follow(() => {});
    const decision = ask(host);
    expect(host.pending()).toHaveLength(1);
    host.answer("t1", { kind: "deny" }, "test"); await decision;
    await host.stop();
  });

  it("detaching every follower does NOT deny an already-parked request", async () => {
    const host = hostFor("interactive"); await host.start();
    const off = host.follow(() => {});
    const decision = ask(host);
    off();                                        // Ctrl+Z: the human walked away to think
    expect(host.pending()).toHaveLength(1);       // still parked, per acceptance 6
    let settled = false; void decision.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    host.answer("t1", { kind: "allow_once" }, "returned"); await decision;
    await host.stop();
  });

  it("parking emits a permission event to followers", async () => {
    const host = hostFor("bg"); await host.start();
    const seen: string[] = [];
    host.follow((e) => seen.push(e.kind));
    void ask(host);
    expect(seen).toContain("permission");
    host.answer("t1", { kind: "deny" }, "test");
    await host.stop();
  });

  it("stop() settles every parked request so nothing is left awaited", async () => {
    const host = hostFor("bg"); await host.start();
    const decision = ask(host);
    await host.stop();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/unit/host-park.test.ts`
Expected: FAIL — `host.broker is not a function`.

- [ ] **Step 3: Implement in `harness/src/host/host.ts`**

```ts
import { PendingPermissions } from "../permissions/pending.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision, PermissionBroker, PermissionRequest } from "../permissions/types.js";
```

```ts
  // "never": a background host parks until a human answers, which is the entire point of a worker that
  // outlives the terminal that spawned it. The interactive case is handled by the follower rule in
  // broker(), not by a timer — a timer is how "the human is thinking" becomes "the human said no".
  private parked = new PendingPermissions({ expireAfterMs: "never" });
  // Who answered what, so a second answerer can be told. A host that runs for days would otherwise
  // accumulate one entry per permission for its whole life.
  private settledBy = new Map<string, string>();
```

```ts
  /** The permission seam this host exposes to its SDK session (wired as `config.permissionBroker`).
   *
   *  The interactive rule is evaluated HERE, when the request arrives — never retroactively when a
   *  follower leaves. An interactive session whose human is gone denies rather than hanging; but a
   *  request already parked stays parked through a detach, because detaching is what a human does in
   *  order to go and think about it (spec acceptance 6). */
  broker(): PermissionBroker {
    return {
      request: async (req: PermissionRequest): Promise<PermissionDecision> => {
        if (this.opts.kind === "interactive" && this.followers.size === 0) return { kind: "deny" };
        const decision = this.parked.brokerFor(this.short).request(req);
        const entry = this.parked.list().find((e) => e.toolUseID === req.toolUseID);
        if (entry) this.emit({ kind: "permission", entry });
        this.emit({ kind: "state", status: this.status() });
        return decision;
      },
    };
  }

  pending(): PendingEntry[] { return this.parked.list(); }

  /** First answer wins. A second answerer is TOLD who got there first rather than erroring: two humans
   *  racing on the same prompt is normal, and an error frame would read as "your answer failed". */
  answer(toolUseID: string, decision: PermissionDecision, by: string): { ok: true; alreadyAnsweredBy?: string } | { ok: false; error: string } {
    if (!this.parked.respond(toolUseID, decision)) {
      const who = this.settledBy.get(toolUseID);
      // Answered-by-someone-else and never-parked-at-all are different outcomes and must not share a
      // reply: a client whose toolUseID is stale or wrong would otherwise read `{ok:true}` and believe
      // its answer landed.
      return who ? { ok: true, alreadyAnsweredBy: who } : { ok: false, error: `no parked request ${toolUseID}` };
    }
    this.settledBy.set(toolUseID, by);
    this.emit({ kind: "permission_settled", toolUseID, by, decision: decision.kind });
    this.emit({ kind: "state", status: this.status() });
    return { ok: true };
  }
```

**Clear `settledBy` at the turn boundary.** Task 4 left `runTask` opening with
`this.turnBuffer.reset();` — add the clear beside it, now that the field exists:

```ts
    this.turnBuffer.reset(); this.settledBy.clear();
```

(Task 4's brief mandated this line before the field existed; its implementer correctly refused to
write code that would not compile and reported it. This is where it belongs.)

`status()` reports the park without mutating `this.state` — the roster's state and the live state stay
separate, and `blocked` must never be written down as if it were terminal:

```ts
  status(): HostStatus {
    const first = this.parked.list()[0];
    if (first) return { state: "blocked", status: "idle", waitingFor: `permission:${first.toolName}` };
    return { state: this.state, status: this.busy ? "busy" : "idle" };
  }
```

`stop()` settles the parks **before** disposing. This is not its final form — Task 10 rewrites the
same method to bound the dispose and always close the server, fixing a defect found by observation
during A1 verification. Write it as shown here; do not try to pre-empt Task 10:

```ts
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    // Settle first, and do it explicitly. Probe 63 shows interrupt() DOES abort a parked canUseTool,
    // so this is belt-and-braces rather than the mechanism — but it settles synchronously instead of
    // awaiting an abort round-trip, and it covers a session with no interrupt() at all.
    this.parked.denyAll();
    this.syncRoster();
    await this.session?.dispose().catch(() => {});
    await this.server?.close();
  }
```

Probe 63 has since measured what happens on the SDK side: `interrupt()` **does** abort a parked
`canUseTool` — the request's signal fired 4.7 s into the park, exactly when `interrupt()` was called —
so `createPermissionGate`'s abort race would resolve it as a deny on its own. Keep the explicit
`denyAll()` anyway: it settles synchronously instead of waiting on an async abort round-trip, and it
covers a `HostSession` that has no `interrupt` at all (the fakes in these tests, and any future
session type). It is one line and it removes a dependency on someone else's behaviour.

Finally, wire the broker into the session's config in `start()`, replacing the bare
`this.deps.openSession(this.opts.config)`:

```ts
      this.session = this.deps.openSession({ ...this.opts.config, permissionBroker: this.broker() });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/host-park.test.ts && npx vitest run test/unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Prove the detach guard**

Change `broker()` so a follower leaving denies parked requests (e.g. call `this.parked.denyAll()` in
the unsubscribe returned by `follow`). Confirm *"detaching every follower does NOT deny an
already-parked request"* FAILS. Revert. Report it.

- [ ] **Step 6: Commit**

```bash
git add harness/src/host/host.ts harness/test/unit/host-park.test.ts
git commit -m "feat(a2a): kind-scoped permission park with first-answer-wins

A bg host parks indefinitely; an interactive host denies only when no follower
is attached AT REQUEST TIME, so a detach leaves an already-parked request
alone (acceptance 6). status() reports blocked without writing it down, and
stop() settles every park explicitly rather than trusting interrupt semantics
probe 63 could not confirm."
```

---

## Task 6: The ops — `pending`, `answer`, `prompt`, `interrupt`, `follow`

**Files:**
- Modify: `harness/src/host/ops.ts`, `harness/src/host/server.ts`, `harness/src/host/host.ts`,
  `harness/src/cli/hostMain.ts`
- Test: `harness/test/unit/host-ops.test.ts` (new)

**Interfaces:**
- Produces: the full op union and the `HostHandlers` it dispatches to.
- Consumes: everything from Tasks 2, 4, 5.

**Context.** A1's `HostHandlers` is `{ status, stop }`. It grows to cover the human seam. `follow` is
the one op that changes the *connection's* mode rather than returning a value: it replies `{ok:true}`
once, and from then on that socket receives event frames.

An interactive host also needs to accept a **new turn** from a client (`prompt`) — that is what makes
attach more than a viewer. A2a delivers the op and the plumbing; the Ink client that types into it is
A2b.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/host-ops.test.ts`. Drive `HostServer` directly through a socket pair so the
test exercises real framing:

```ts
import { describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostServer } from "../../src/host/server.js";
import type { HostHandlers } from "../../src/host/server.js";

const sockPath = () => join(mkdtempSync(join(tmpdir(), "ccx-ops-")), "h.sock");

/** Send lines, collect frames until `until` says stop. */
function client(path: string) {
  const frames: any[] = [];
  const sock = connect(path);
  let buf = "";
  sock.on("data", (c) => {
    buf += c.toString();
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) frames.push(JSON.parse(line));
    }
  });
  return {
    frames,
    ready: new Promise<void>((r) => sock.once("connect", () => r())),
    send: (o: unknown) => sock.write(JSON.stringify(o) + "\n"),
    end: () => sock.destroy(),
    async waitFor(pred: (f: any) => boolean, ms = 1000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = frames.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no frame matched within ${ms}ms; saw ${JSON.stringify(frames)}`);
    },
  };
}

const handlers = (over: Partial<HostHandlers> = {}): HostHandlers => ({
  status: () => ({ state: "working", status: "busy" }),
  stop: async () => {},
  pending: () => [],
  answer: () => ({ ok: true }),
  prompt: async () => {},
  interrupt: async () => {},
  follow: (_deliver: (ev: unknown) => void) => () => {},
  ...over,
});

describe("host ops", () => {
  it("echoes the correlation id on every reply", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 42, op: "status" });
    expect(await c.waitFor((f) => f.id === 42)).toMatchObject({ ok: true, state: "working" });
    c.end(); await s.close();
  });

  it("an A1 client sending no id still gets an A1-shaped reply", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ op: "status" });
    const f = await c.waitFor((x) => x.ok === true);
    expect(f).toEqual({ ok: true, state: "working", status: "busy" });   // no id, no t
    c.end(); await s.close();
  });

  it("answer carries the decision and the answerer through to the handler", async () => {
    const seen: any[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ answer: (id, d, by) => { seen.push([id, d, by]); return { ok: true }; } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "answer", toolUseID: "t1", decision: "allow_once", by: "tty-1" });
    await c.waitFor((f) => f.id === 1);
    expect(seen).toEqual([["t1", { kind: "allow_once" }, "tty-1"]]);
    c.end(); await s.close();
  });

  it("rejects an answer whose decision is not one of the three kinds", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 2, op: "answer", toolUseID: "t1", decision: "sudo-yes", by: "x" });
    expect(await c.waitFor((f) => f.id === 2)).toMatchObject({ ok: false });
    c.end(); await s.close();
  });

  it("each following connection gets its OWN sink, and events reach only it", async () => {
    const sinks: ((ev: any) => void)[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: (deliver) => { sinks.push(deliver); return () => {}; } }), p);
    await s.listen();
    const watcher = client(p), quiet = client(p);
    await watcher.ready; await quiet.ready;
    watcher.send({ id: 1, op: "follow" });
    await watcher.waitFor((f) => f.id === 1);
    expect(sinks).toHaveLength(1);                       // only the follower registered
    sinks[0]!({ kind: "state", status: { state: "blocked", status: "idle" } });
    await watcher.waitFor((f) => f.t === "event" && f.kind === "state");
    await new Promise((r) => setTimeout(r, 50));
    expect(quiet.frames.some((f) => f.t === "event")).toBe(false);
    watcher.end(); quiet.end(); await s.close();
  });

  it("delivers each event EXACTLY ONCE per following connection", async () => {
    const sinks: ((ev: any) => void)[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: (deliver) => { sinks.push(deliver); return () => {}; } }), p);
    await s.listen();
    const a = client(p), b = client(p);
    await a.ready; await b.ready;
    a.send({ id: 1, op: "follow" }); await a.waitFor((f) => f.id === 1);
    b.send({ id: 1, op: "follow" }); await b.waitFor((f) => f.id === 1);
    // The host emits ONE event; with per-connection sinks that is one write to each socket. A shared
    // broadcast called from each of the two registered followers would write it twice to both.
    for (const sink of sinks) sink({ kind: "turn", phase: "end" });
    await new Promise((r) => setTimeout(r, 60));
    expect(a.frames.filter((f) => f.t === "event")).toHaveLength(1);
    expect(b.frames.filter((f) => f.t === "event")).toHaveLength(1);
    a.end(); b.end(); await s.close();
  });

  it("a follower that disconnects releases its host-side subscription", async () => {
    const offs: number[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: () => () => { offs.push(1); } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "follow" }); await c.waitFor((f) => f.id === 1);
    c.end();
    // Observable, unlike "broadcast does not throw": socket.write() after destroy never throws
    // synchronously in Node, so that assertion passes even with the cleanup deleted.
    await vi.waitFor(() => expect(offs).toHaveLength(1), { timeout: 1000 });
    await s.close();
  });

  it("prompt reaches the handler with its text", async () => {
    const got: string[] = [];
    const p = sockPath(); const s = new HostServer(handlers({ prompt: async (t) => { got.push(t); } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "prompt", text: "do the thing" });
    await c.waitFor((f) => f.id === 1);
    expect(got).toEqual(["do the thing"]);
    c.end(); await s.close();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/unit/host-ops.test.ts`
Expected: FAIL — the handler object does not match `HostHandlers`.

- [ ] **Step 3: Extend the op union in `harness/src/host/ops.ts`**

```ts
const decisionKind = z.enum(["allow_once", "allow_always", "deny"]);
const withId = { id: z.number().int().nonnegative().optional() };
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), ...withId }),
  z.object({ op: z.literal("stop"), ...withId }),
  z.object({ op: z.literal("pending"), ...withId }),
  z.object({ op: z.literal("answer"), toolUseID: z.string().min(1), decision: decisionKind, by: z.string().min(1), ...withId }),
  z.object({ op: z.literal("prompt"), text: z.string().min(1), ...withId }),
  z.object({ op: z.literal("interrupt"), ...withId }),
  z.object({ op: z.literal("follow"), ...withId }),
  z.object({ op: z.literal("unfollow"), ...withId }),
]);
```

- [ ] **Step 4: Extend `HostHandlers` and `dispatch` in `harness/src/host/server.ts`**

```ts
export interface HostHandlers {
  status(): HostStatus;
  stop(): Promise<void>;
  pending(): PendingEntry[];
  answer(toolUseID: string, decision: PermissionDecision, by: string): { ok: boolean; alreadyAnsweredBy?: string; error?: string };
  prompt(text: string): Promise<void>;
  interrupt(): Promise<void>;
  /** Register ONE sink for ONE connection; the returned function unregisters it. The sink is what the
   *  server writes to that socket — fan-out lives in the host's follower set, never here. */
  follow(deliver: (ev: HostEvent) => void): () => void;
}
```

`dispatch` needs the socket to serve `follow`, so give it the socket as a second parameter and keep
the per-connection unsubscribe with the connection. **Update the call site in the data handler that
Task 2 wrote** (`this.dispatch(frame)` → `this.dispatch(frame, sock)`) — it is in a part of the file
this task otherwise does not touch, and leaving it is a compile error the implementer will blame on
something else:

```ts
  private async dispatch(frame: HostFrame | undefined, sock: Socket): Promise<Record<string, unknown>> {
    if (!frame) return { ok: false, error: "bad json" };
    const op = hostOp.safeParse(frame);
    if (!op.success) return { ok: false, error: "unknown op" };
    switch (op.data.op) {
      case "status": return { ok: true, ...this.handlers.status() };
      case "stop": await this.handlers.stop(); return { ok: true };
      case "pending": return { ok: true, pending: this.handlers.pending() };
      case "answer": return { ...this.handlers.answer(op.data.toolUseID, { kind: op.data.decision }, op.data.by) };
      // A prompt is NOT awaited before replying: a turn runs for minutes, and holding the reply would
      // stall this connection's every other op — including the `interrupt` that ends the very turn it
      // is waiting on. The turn's progress travels as events instead. The busy check is the host's
      // (Task 5 tracks `busy`); a second prompt landing mid-turn would reset the TurnBuffer under the
      // running turn and let turn one's completion finalize the roster while turn two is still going.
      case "prompt": {
        if (this.handlers.status().status === "busy") return { ok: false, error: "busy" };
        void this.handlers.prompt(op.data.text).catch(() => {});
        return { ok: true, accepted: true };
      }
      case "interrupt": await this.handlers.interrupt(); return { ok: true };
      case "follow": {
        // Idempotent per connection: a client that sends `follow` twice must not end up with two
        // sinks writing every event to it twice.
        if (!this.unfollows.has(sock)) {
          this.unfollows.set(sock, this.handlers.follow((ev) => {
            try { sock.write(encodeEvent(ev)); } catch { /* the peer went away mid-write; close handles it */ }
          }));
        }
        return { ok: true, following: true };
      }
      case "unfollow": { this.unfollow(sock); return { ok: true, following: false }; }
    }
  }

  private unfollows = new Map<Socket, () => void>();
  private unfollow(sock: Socket): void {
    const off = this.unfollows.get(sock); this.unfollows.delete(sock); off?.();
  }
```

and call `this.unfollow(sock)` from the connection's `close` handler, so a vanished client releases
its host-side subscription too. This is what the *"a follower that disconnects releases its host-side
subscription"* test observes; deleting the call must make that test fail.

- [ ] **Step 5: Wire the real handlers in `harness/src/host/host.ts`**

In `start()`, replace the two-handler literal:

```ts
      this.server = new HostServer({
        status: () => this.status(),
        stop: () => this.stop("stopped"),
        pending: () => this.pending(),
        answer: (id, d, by) => this.answer(id, d, by),
        prompt: (text) => this.runTask(text),
        interrupt: () => this.interrupt(),
        // One follower per connection, delivering to that connection's sink. The host counts
        // followers (the interactive deny rule reads that count); the server owns the sockets.
        follow: (deliver) => this.follow(deliver),
      }, hostSocketPath(process.pid, this.env));
```

Add `interrupt()` to `SessionHost`. The lib `Session` exposes the SDK query handle; if it has no
`interrupt`, this is where you discover it — report rather than inventing one:

```ts
  /** Ends the in-flight turn, settling parked decisions first (see stop()).
   *
   *  Probe 63 recorded a second fact worth knowing here: interrupting a turn that is parked at a
   *  `tool_use` makes the message stream **throw** rather than return a result —
   *  `Claude Code returned an error result: … stop_reason=tool_use`. So `runTask`'s catch arm runs,
   *  sets `state = "error"`, and rethrows. That is harmless *provided* the terminal state was written
   *  first: `finalizeRoster` is first-terminal-wins, so a `stop("stopped")` that already recorded
   *  `stopped` is not overwritten by the error that its own interrupt caused. Task 10 depends on this
   *  ordering — do not move `syncRoster()` after the interrupt. */
  async interrupt(): Promise<void> {
    this.parked.denyAll();
    await this.session?.interrupt?.();
  }
```

and widen `HostSession` by one optional member: `interrupt?(): Promise<unknown>;`. **`unknown`, not
`void`** — the real `Session.interrupt()` returns `Promise<unknown>`, and a `Promise<void>` declaration
makes the default `openSession: realOpenSession` stop type-checking.

- [ ] **Step 6: Run everything**

Run: `npx vitest run test/unit && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Prove the prompt-does-not-block guard — and mind how you send it**

Add a test: point `prompt` at a promise that never resolves, then send the `prompt` and a `status`
**in a single `sock.write`**, with both frames in one string:

```ts
    c.sendRaw(JSON.stringify({ id: 1, op: "prompt", text: "x" }) + "\n"
            + JSON.stringify({ id: 2, op: "status" }) + "\n");
    expect(await c.waitFor((f) => f.id === 2)).toMatchObject({ ok: true });
```

(Add a `sendRaw` to the test client that writes a string unchanged.) The single write matters: the
server's loop runs per `'data'` event over a shared buffer, so two frames sent as two writes usually
arrive as two chunks and are handled by two independent async invocations — under which a hung
`await` in the first does **not** stall the second. Sent as one chunk they serialize, which is the
condition the guard is about.

Now prove it: change `case "prompt"` to `await this.handlers.prompt(...)`, re-run, confirm the
`status` reply never arrives, revert, and report what you saw.

- [ ] **Step 8: Commit**

```bash
git add harness/src/host harness/test/unit/host-ops.test.ts
git commit -m "feat(a2a): pending/answer/prompt/interrupt/follow ops on the host socket

follow switches the connection into event mode and holds its unsubscribe with
the socket, so a vanished client releases the host-side subscription. prompt
replies immediately and reports progress as events: awaiting a turn would
stall the same connection's interrupt."
```

---

## Task 7: `RemoteChatSession` — the client over the socket

**Files:**
- Create: `harness/src/client/remote.ts`
- Modify: `harness/src/index.ts` (export it)
- Test: covered by Task 9's integration test; add unit coverage only for framing edge cases

**Interfaces:**
- Produces: `class RemoteChatSession` with
  `static async connect(socketPath: string, opts?: { label?: string }): Promise<RemoteChatSession>`,
  `status()`, `pending()`, `answer(toolUseID, decision)`, `prompt(text)`, `interrupt()`,
  `follow(cb: (ev: HostEvent) => void): () => void`, `detach()`, `stopHost()`.
- Consumes: `wire.ts`, `ops.ts`.

**Context.** This is the object A2b's Ink client will hold instead of a local `Session`. Two
requirements shape it:

- **`detach()` closes the socket and leaves the host completely alone.** It is not `dispose()`. There
  is no client-side call that ends the session except `stopHost()`, which is the explicit `stop` op.
- **Requests are correlated, not serialized.** Several ops may be in flight while events stream; the
  client matches replies by id and routes `t:"event"` frames to followers.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/client-remote.test.ts` with the framing cases (the behavioural ones live in
Task 9):

```ts
import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteChatSession } from "../../src/client/remote.js";

/** A stub host that replies out of order, so the client's correlation is actually exercised. */
function stubHost(path: string) {
  const srv = createServer((sock) => {
    let buf = "";
    sock.on("data", async (c) => {
      buf += c.toString();
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        const delay = req.op === "status" ? 50 : 0;      // status answers LAST despite being sent first
        setTimeout(() => sock.write(JSON.stringify({ ok: true, id: req.id, op: req.op }) + "\n"), delay);
      }
    });
  });
  return new Promise<typeof srv>((r) => srv.listen(path, () => r(srv)));
}

describe("RemoteChatSession", () => {
  it("matches replies by id even when they arrive out of order", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const srv = await stubHost(p);
    const c = await RemoteChatSession.connect(p);
    const [status, pending] = await Promise.all([c.status(), c.pending()]);
    expect((status as any).op).toBe("status");
    expect((pending as any).op).toBe("pending");
    c.detach(); srv.close();
  });

  it("detach() closes the socket without sending stop", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const seen: string[] = [];
    const srv = createServer((sock) => sock.on("data", (c) => seen.push(String(c))));
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    c.detach();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.join("")).not.toContain('"stop"');
    srv.close();
  });

  it("a pending request rejects when the host goes away, rather than hanging forever", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const srv = createServer(() => {});                   // accepts, never replies
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    const inflight = c.status();
    srv.close(); (c as any).sock.destroy();
    await expect(inflight).rejects.toThrow();
    c.detach();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/unit/client-remote.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `harness/src/client/remote.ts`**

```ts
import { connect } from "node:net";
import type { Socket } from "node:net";
import { decodeFrame } from "../host/wire.js";
import type { HostEvent } from "../host/wire.js";
import type { HostStatus } from "../host/ops.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision } from "../permissions/types.js";

/** Long enough that a busy host answering a `status` while streaming a turn is never mistaken for a
 *  dead one; short enough that a client does not sit on a promise that will never settle. */
const REQUEST_TIMEOUT_MS = 10_000;

/** A `ChatSession`-shaped handle on a host running in another process. Held by an attached client in
 *  place of a local Session. `detach()` is NOT `dispose()`: it drops this connection and leaves the
 *  host, its turn and its parked decisions exactly as they were. */
export class RemoteChatSession {
  private nextId = 1;
  private inflight = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private followers = new Set<(ev: HostEvent) => void>();
  private buf = "";

  private constructor(private sock: Socket, private label: string) {
    sock.on("data", (c) => this.onData(c.toString("utf8")));
    // Every awaited request must settle when the peer goes, or an attached client hangs on a host that
    // already exited — the same parked-promise class this project keeps rediscovering.
    const fail = (e: Error) => { for (const { reject } of this.inflight.values()) reject(e); this.inflight.clear(); };
    sock.on("close", () => fail(new Error("host connection closed")));
    sock.on("error", (e) => fail(e as Error));
  }

  static connect(socketPath: string, opts: { label?: string } = {}): Promise<RemoteChatSession> {
    return new Promise((resolve, reject) => {
      const sock = connect(socketPath);
      sock.once("error", reject);
      sock.once("connect", () => { sock.off("error", reject); resolve(new RemoteChatSession(sock, opts.label ?? `client-${process.pid}`)); });
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      const frame = decodeFrame(line);
      if (!frame) continue;
      if (frame.t === "event") { for (const cb of [...this.followers]) { try { cb(frame as HostEvent); } catch { /* one follower's failure */ } } continue; }
      const id = (frame as Record<string, unknown>)["id"];
      if (typeof id !== "number") continue;
      const waiter = this.inflight.get(id);
      if (!waiter) continue;
      this.inflight.delete(id);
      waiter.resolve(frame);
    }
  }

  private send<T>(op: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      // A deadline, because a silent peer is a real case, not a hypothetical: a host started before
      // A2a answers without the `id` we echo on (its zod schema strips the unknown key), so its reply
      // is dropped here and this promise would never settle. An attached client hanging forever on a
      // pre-upgrade host is the same parked-promise class this transport exists to make visible.
      const timer = setTimeout(() => {
        if (!this.inflight.delete(id)) return;
        reject(new Error(`host did not answer ${String(op["op"])} within ${REQUEST_TIMEOUT_MS}ms (a pre-A2a host, or a wedged one)`));
      }, REQUEST_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      this.inflight.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    });
  }

  status(): Promise<HostStatus & { ok: boolean }> { return this.send({ op: "status" }); }
  pending(): Promise<{ ok: boolean; pending: PendingEntry[] }> { return this.send({ op: "pending" }); }
  answer(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string }> {
    return this.send({ op: "answer", toolUseID, decision: decision.kind, by: this.label });
  }
  prompt(text: string): Promise<{ ok: boolean; accepted?: boolean }> { return this.send({ op: "prompt", text }); }
  interrupt(): Promise<{ ok: boolean }> { return this.send({ op: "interrupt" }); }
  stopHost(): Promise<{ ok: boolean }> { return this.send({ op: "stop" }); }

  /** Subscribe to the host's events. The first follower sends the `follow` op; later ones ride it. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const first = this.followers.size === 0;
    this.followers.add(cb);
    if (first) void this.send({ op: "follow" }).catch(() => {});
    return () => { this.followers.delete(cb); if (this.followers.size === 0) void this.send({ op: "unfollow" }).catch(() => {}); };
  }

  /** Drop this connection. The host keeps running, its turn keeps going, and anything parked stays
   *  parked — that is the whole distinction between detach and stop. */
  detach(): void { this.sock.destroy(); }
}
```

- [ ] **Step 4: Export it**

In `harness/src/index.ts`, add `export { RemoteChatSession } from "./client/remote.js";` and add the
name to whatever list `test/unit/index.test.ts` pins.

- [ ] **Step 5: Run**

Run: `npx vitest run test/unit && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add harness/src/client harness/src/index.ts harness/test/unit/client-remote.test.ts
git commit -m "feat(a2a): RemoteChatSession — a ChatSession-shaped handle over the host socket

Correlates replies by id so several ops can be in flight while events stream,
settles every awaited request when the peer goes, and keeps detach() strictly
separate from stopping the host."
```

---

## Task 8: Delete the no-human-seam flag

**Files:**
- Modify: `harness/src/fleet/roster.ts`, `harness/src/fleet/project.ts`, `harness/src/cli/agents.ts`,
  `harness/src/cli/hostMain.ts`, `harness/src/cli/args.ts`, `harness/src/host/host.ts`,
  `harness/src/config/types.ts` (one comment)
- Modify (tests): `harness/test/unit/cli-agents.test.ts`, `fleet-project.test.ts`,
  `fleet-roster.test.ts`, `host-session.test.ts`, `cli-args.test.ts`

**Interfaces:**
- Removes: `RosterRow.noHumanSeam`, `AgentsRow.noHumanSeam`, `SessionHostOpts.noHumanSeam`,
  `CcxInvocation.hasExplicitPermissionConfig`.

**Context — an owner decision, and the measurement that vindicates it.** A1 shipped a `noHumanSeam`
flag: a bare `--bg` with no permission configuration got its `agents` row marked `⚠ no human seam`, on
the reasoning that such a worker "auto-approves everything and never parks". The owner's decision is
to **keep the SDK's `auto` classifier as the permission posture and drop the flag entirely**.

Probe 64 (run 2026-07-27, on `claude-sonnet-4-6`, which is auto-capable) shows the flag's premise was
wrong at the mechanism level too:

```
  [default] canUseTool FIRED for Bash -> allow
  [auto]    canUseTool FIRED for Bash -> allow
```

With an explicit `ask` rule present, **`auto` consults `canUseTool` exactly as `default` does**. What
summons the broker is the `ask` rule, not the permission mode. So the flag was marking a condition
that is neither a defect nor unrecoverable: a bare `--bg` runs under an AI classifier that adjudicates
each tool, and any operator who wants a human in the loop adds an `ask` rule and gets one — under
`auto`, including in doperpowers' `--bg --permission-mode auto` workers.

A warning that fires on a supported configuration, that the reader cannot act on, and whose stated
reason is untrue, is noise in a listing that a poller also reads. Remove it.

- [ ] **Step 1: Correct the comment that started this**

`harness/src/config/types.ts`, the `permissionMode` comment, currently reads *"dontAsk replaces
canUseTool entirely (joins auto/bypass as broker-replacing) — verified"*, and the `permissionBroker`
comment says the broker is *"Only consulted in broker-live modes (default/acceptEdits/plan)"*. Probe 64
refutes both for `auto`. Replace with:

```ts
  // permissionMode: 6 SDK modes. acceptEdits auto-accepts edits but still routes non-edit tools to
  // canUseTool; dontAsk and bypassPermissions replace canUseTool entirely. `auto` does NOT — probe 64
  // shows it consults the broker whenever a rule routes a tool to `ask`, exactly as `default` does.
  // What summons the broker is the ask rule, not the mode.
  permissionMode?: PermissionMode;
  // interactive permission broker (incr3): when set, resolveOptions wires it as the SDK canUseTool.
  // Consulted in default/acceptEdits/plan/auto; bypassPermissions and dontAsk bypass it.
  permissionBroker?: PermissionBroker;
```

- [ ] **Step 2: Delete the flag, its derivation, and its only input**

Remove, in this order, and let the compiler find the rest:

1. `fleet/roster.ts` — the `noHumanSeam?: boolean` field and its doc comment.
2. `fleet/project.ts` — the `AgentsRow.noHumanSeam` field and the `...(roster.noHumanSeam ? … )` spread.
3. `cli/agents.ts:15` — the `⚠ no human seam` suffix. Keep the `(unresponsive)` suffix exactly as it is.
4. `host/host.ts` — `SessionHostOpts.noHumanSeam` and the row spread that writes it.
5. `cli/hostMain.ts` — the `const noHumanSeam = …` line and the opts spread that carries it. **Keep the
   `forkSession` derivation above it untouched** — that one is load-bearing for `--bg --resume`.
6. `cli/args.ts` — `CcxInvocation.hasExplicitPermissionConfig`, its initialiser, and the two
   `a.hasExplicitPermissionConfig = true` assignments. **Keep the parsing itself**: `--permission-mode`
   must still set `config.permissionMode` and `--settings` must still set `config.settings`. Only the
   boolean and its comment go. Confirm with `grep -rn hasExplicitPermissionConfig src/` that nothing
   else reads it before deleting.

- [ ] **Step 3: Delete the tests that only existed for the flag**

- `fleet-roster.test.ts` — *"round-trips the noHumanSeam flag, which agents surfaces"*: delete.
- `fleet-project.test.ts` — *"carries noHumanSeam through from the roster…"*: delete.
- `host-session.test.ts` — *"records noHumanSeam on the roster row…"*: delete.
- `cli-agents.test.ts:145` — the render test passes `{ unresponsive: true, noHumanSeam: true }`; keep
  the test, drop `noHumanSeam` from the input and drop the marker from the expected string. Do **not**
  delete it: it is the `(unresponsive)` suffix's only coverage.
- `cli-args.test.ts` — the three `hasExplicitPermissionConfig` assertions go. The dangling-flag test at
  line 45 asserts something else as well; keep whatever remains meaningful and say in your report what
  you kept.

- [ ] **Step 4: Run**

Run: `npx vitest run test/unit && npm run typecheck && npm run build`
Expected: PASS. A leftover reference is a compile error, which is the point of deleting the type first.

- [ ] **Step 5: Check the consumer contract is untouched**

Run: `npx vitest run test/contract`
Expected: PASS. `noHumanSeam` was never one of the five keys doperpowers reads (`id`, `sessionId`,
`state`, `status`, `cwd`), so removing it must not move the contract. If a contract test fails, stop —
that means it was load-bearing after all.

- [ ] **Step 6: Commit**

```bash
git add harness/src harness/test/unit
git commit -m "refactor(a2a): delete the no-human-seam flag

Owner decision: keep the SDK's auto classifier as the background permission
posture, and drop the warning. Probe 64 also refutes the premise the flag was
built on — with an explicit ask rule present, auto consults canUseTool exactly
as default does, so what summons the human seam is the rule, not the mode. The
flag marked a supported configuration with a reason that was not true.

Also corrects the config/types.ts comment that recorded auto as
broker-replacing."
```

---

## Task 9: Integration — a real socket, two clients, one park

**Files:**
- Create: `harness/test/integration/host-client.test.ts`
- Modify: `harness/package.json` only if `test:unit` does not already pick up `test/integration`
  (check first; prefer adding a `test:integration` script over widening `test:unit`)

**Interfaces:** consumes everything built above. No new production code should be needed — if you find
yourself adding some, that is a finding about an earlier task.

**Context.** This is the spec's "Integration (no API key)" tier: a real `SessionHost` on a real UDS,
driven by a fake `QueryFn`, with real `RemoteChatSession` clients. It is the test that proves the
parts compose, and it is the only place detach-vs-dispose is exercised end to end.

- [ ] **Step 1: Write the test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { readRoster } from "../../src/fleet/roster.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-int-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A session we drive by hand: `emit` pushes a message into the live turn, `finish` ends it, and
 *  `askPermission` fires the broker exactly as the SDK would. */
function drivable() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-int",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r(undefined); });
    },
    dispose: async () => {},
    interrupt: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

async function startHost(kind: "bg" | "interactive" = "bg") {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const session = drivable();
  const host = new SessionHost(
    { short: "dddddddd", name: "int", cwd: process.cwd(), kind, config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env) };
}

describe("host + client over a real socket", () => {
  it("a client follows a live turn it joined late, from the turn's start", async () => {
    const { host, session, path } = await startHost();
    const turn = host.runTask("go");
    session.emit({ type: "assistant", n: 1 });
    session.emit({ type: "assistant", n: 2 });
    const c = await RemoteChatSession.connect(path);
    const seen: any[] = [];
    c.follow((e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2]);
    session.emit({ type: "assistant", n: 3 });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.filter((e) => e.kind === "message").map((e) => e.data.n)).toEqual([1, 2, 3]);
    c.detach(); session.finish(); await turn; await host.stop();
  });

  it("two clients see the same park; the first answer wins and the second is told who answered", async () => {
    const { host, path } = await startHost();
    const a = await RemoteChatSession.connect(path, { label: "tty-a" });
    const b = await RemoteChatSession.connect(path, { label: "tty-b" });
    const seenA: any[] = [], seenB: any[] = [];
    a.follow((e) => seenA.push(e)); b.follow((e) => seenB.push(e));
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t9", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 80));
    // EXACT counts, not `.some`. One park must produce one permission event per client; a fan-out that
    // broadcasts once per registered follower delivers it N times to each of N clients, and `.some`
    // passes cheerfully on 2, 4 or 16 copies.
    expect(seenA.filter((e) => e.kind === "permission")).toHaveLength(1);
    expect(seenB.filter((e) => e.kind === "permission")).toHaveLength(1);
    expect((await a.status()).state).toBe("blocked");
    const first = await a.answer("t9", { kind: "allow_once" });
    expect(first.alreadyAnsweredBy).toBeUndefined();
    const second = await b.answer("t9", { kind: "deny" });
    expect(second.ok).toBe(true);
    expect(second.alreadyAnsweredBy).toBe("tty-a");
    await expect(decision).resolves.toEqual({ kind: "allow_once" });   // the FIRST answer, not the last
    a.detach(); b.detach(); await host.stop();
  });

  it("detach leaves the host and its park untouched; a re-attached client still sees the park", async () => {
    const { host, path } = await startHost();
    const a = await RemoteChatSession.connect(path);
    a.follow(() => {});
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t10", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 50));
    a.detach();
    await new Promise((r) => setTimeout(r, 50));
    const b = await RemoteChatSession.connect(path);
    expect((await b.pending()).pending.map((p: any) => p.toolUseID)).toEqual(["t10"]);
    expect((await b.status()).state).toBe("blocked");
    await b.answer("t10", { kind: "deny" });
    await expect(decision).resolves.toEqual({ kind: "deny" });
    b.detach(); await host.stop();
  });

  it("stop over the socket records a terminal roster state and settles the park", async () => {
    const { host, env, path } = await startHost();
    const c = await RemoteChatSession.connect(path);
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t11", signal: new AbortController().signal });
    await c.stopHost().catch(() => {});          // the host closes the socket as it stops
    await expect(decision).resolves.toEqual({ kind: "deny" });
    expect(readRoster("dddddddd", env)?.state).toBe("stopped");
    c.detach();
  });

  it("an interactive host with no client attached denies rather than parking", async () => {
    const { host } = await startHost("interactive");
    await expect(host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t12", signal: new AbortController().signal }))
      .resolves.toEqual({ kind: "deny" });
    await host.stop();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/integration/host-client.test.ts`
Expected: PASS (5/5). If any case needs production changes to pass, make the change in the file it
belongs to and say so in your report — do not weaken the test.

- [ ] **Step 3: Run everything**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add harness/test/integration harness/package.json
git commit -m "test(a2a): integration — real socket, two clients, one park

Late-joining follower replay, first-answer-wins with the loser told who
answered, detach leaving the park intact for a re-attached client, and stop
settling both the park and the roster row."
```

---

## Task 10: Make `stop()` actually stop — bounded teardown

**Files:**
- Modify: `harness/src/host/host.ts`
- Test: `harness/test/unit/host-teardown.test.ts` (new)

**Interfaces:** no new exports. `SessionHost.stop()` keeps its signature.

**Context — a real defect found by observation, not by review.** While verifying the A1 acceptance
arms, a run held a turn open at the transport layer (an endpoint that accepts the request and never
answers) and found this:

> `ccx stop` and `ccx rm` return success while the host process, its engine subprocess and its
> listening socket all survive indefinitely when the in-flight turn never returns.

The chain is exact. `Session.dispose()` is `this.input.close(); await this.done;` — and its own comment
says "in-flight turn finishes", so waiting is deliberate. `SessionHost.stop()` awaits that dispose
*before* `this.server?.close()`. When the turn cannot end, dispose never resolves, so the server is
never closed, `runHostMain`'s `finally { await host.stop() }` never returns, and `bin.ts` never reaches
`exitAfterFlush` — the process stays up forever.

No poller is deceived, because the terminal roster state is written before any of this. That is also
what makes it hard to see: `agents` reports `stopped`, and `ccx fleet gc` sweeps only sockets that do
*not* answer — this one answers. For a session removed with `ccx rm` it is worse, because the roster
row is gone and no command names the process any more.

Order matters in the fix and each position has a reason:

1. Settle parked decisions — nothing awaited may survive us.
2. Write the terminal roster state — a reader must never wait on a host that is going away. (This is
   already first today, and it is why every acceptance arm read truthfully; keep it.)
3. **Interrupt the in-flight turn.** This is the actual repair: ending the turn is what lets
   `this.done` resolve, which lets dispose resolve normally. The timeout below is a backstop, not the
   mechanism.
4. Dispose, **bounded**. If a turn will not end, we still leave.
5. Close the server **unconditionally** — outside the part that can time out.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/host-teardown.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-teardown-"));

/** A session whose dispose NEVER settles — exactly what a turn whose request never returns produces. */
const wedged = (over: Record<string, unknown> = {}) => ({
  sessionId: "sid",
  submit: async () => undefined,
  dispose: () => new Promise<void>(() => {}),
  ...over,
});

const hostWith = (session: any, env: NodeJS.ProcessEnv) =>
  new SessionHost({ short: "ffffffff", name: "t", cwd: "/tmp", kind: "bg", config: {} as never, env },
    { openSession: () => session, procStartOf: async () => "start" });

describe("SessionHost teardown", () => {
  it("returns even when dispose never settles", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(wedged(), env);
    await host.start();
    await expect(host.stop("stopped")).resolves.toBeUndefined();   // must not hang
    expect(readRoster("ffffffff", env)?.state).toBe("stopped");
  }, 10_000);

  it("closes the socket server even when dispose never settles", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const host = hostWith(wedged(), env);
    await host.start();
    await host.stop("stopped");
    // The server's own close promise is the observable: a host that left it open is a host that will
    // never exit, which is the whole defect.
    await expect((host as any).server.closed).resolves.toBeUndefined();
  }, 10_000);

  it("interrupts the turn before disposing, so the normal path never needs the timeout", async () => {
    const order: string[] = [];
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const session = wedged({
      interrupt: async () => { order.push("interrupt"); },
      dispose: async () => { order.push("dispose"); },
    });
    const host = hostWith(session, env);
    await host.start();
    await host.stop("stopped");
    expect(order).toEqual(["interrupt", "dispose"]);
  });

  it("a session with no interrupt() is disposed anyway", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const disposed = vi.fn(async () => {});
    const host = hostWith({ sessionId: "s", submit: async () => undefined, dispose: disposed }, env);
    await host.start();
    await host.stop("stopped");
    expect(disposed).toHaveBeenCalled();
  });

  it("a throwing interrupt does not prevent teardown", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const disposed = vi.fn(async () => {});
    const host = hostWith({ sessionId: "s", submit: async () => undefined, dispose: disposed,
      interrupt: async () => { throw new Error("no interrupt for you"); } }, env);
    await host.start();
    await expect(host.stop("stopped")).resolves.toBeUndefined();
    expect(disposed).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch the first two hang, then fail on the vitest timeout**

Run: `npx vitest run test/unit/host-teardown.test.ts`
Expected: FAIL — *"returns even when dispose never settles"* and *"closes the socket server…"* time
out. That timeout **is** the defect; confirm you saw it before fixing.

- [ ] **Step 3: Implement in `harness/src/host/host.ts`**

```ts
/** How long we will wait for a well-behaved dispose after the turn has been interrupted. Generous
 *  enough that the normal path always completes inside it, short enough that a wedged turn does not
 *  keep a detached process alive for the rest of the day. */
const DISPOSE_GRACE_MS = 5_000;
```

Make it injectable through the existing `deps` object — `deps.disposeGraceMs ?? DISPOSE_GRACE_MS` —
and have the two wedged-dispose tests pass a small value. Otherwise each of them burns five seconds of
real time in a suite that runs on every commit, which is how a fast unit suite quietly becomes a slow
one.

```ts
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    // Settle first, and do it explicitly. Probe 63 shows interrupt() DOES abort a parked canUseTool,
    // so this is belt-and-braces rather than the mechanism — but it settles synchronously instead of
    // awaiting an abort round-trip, and it covers a session with no interrupt() at all.
    this.parked.denyAll();
    this.syncRoster();                     // terminal state on disk BEFORE anything that can block
    // Ending the turn is the repair, not the timeout below: dispose() is `input.close(); await done`,
    // and `done` cannot resolve while a request is in flight. Interrupting is what lets it.
    await this.session?.interrupt?.().catch(() => {});
    await Promise.race([
      this.session?.dispose().catch(() => {}) ?? Promise.resolve(),
      new Promise<void>((r) => { const t = setTimeout(r, DISPOSE_GRACE_MS); (t as { unref?: () => void }).unref?.(); }),
    ]);
    // OUTSIDE the race, and unconditional. A server left listening is a host that never exits: this
    // whole method used to sit behind an await that a wedged turn never satisfied, so `ccx stop`
    // reported success over a process that lived on with its socket still answering.
    await this.server?.close();
  }
```

- [ ] **Step 4: Run**

Run: `npx vitest run test/unit/host-teardown.test.ts && npx vitest run test/unit && npm run typecheck`
Expected: PASS, and the whole unit suite still green.

- [ ] **Step 5: Prove it against the real thing**

The reproduction recipe is in `.doperpowers/sdd/acceptance-finalize-arms-report.md` — read the section
describing the stalling endpoint. Reproduce it: point `ANTHROPIC_BASE_URL` at a local server that
accepts `POST /v1/messages` and never answers, spawn `ccx --bg`, confirm `agents` reports
`state=working status=busy`, then run `ccx stop <short>`.

Record, verbatim: the host pid before and after, whether the engine subprocess is gone
(`pgrep -P <hostpid>`), and whether `~/.claude/ccx/run/<pid>.sock` was removed. If the host process
exits but leaves an orphaned engine subprocess behind, that is a **separate finding** — report it with
the pid evidence rather than expanding this task to chase it.

- [ ] **Step 6: Commit**

```bash
git add harness/src/host/host.ts harness/test/unit/host-teardown.test.ts
git commit -m "fix(a2a): stop() must actually stop — interrupt, bound the dispose, always close

dispose() waits for the in-flight turn by design, so a turn that never returns
left stop() parked forever: the socket stayed open, the host never exited, and
ccx stop reported success over a live process that fleet gc cannot reap
because its socket still answers. Interrupt first, bound the wait, and close
the server outside the race."
```

---

## Task 11: Final verification

**Files:** none changed unless a check fails.

**Context.** Tests prove the parts; the spec's acceptance proves the feature. A2a can execute exactly
one of the spec's acceptance items end to end — item 8 — because the rest need the client that A2b
builds. Run it as written, and run the checks that protect what A1 shipped.

- [ ] **Step 1: The whole suite**

Run: `cd CC-to-SDK/harness && npx vitest run`
Expected: every file green, including `test/contract/` (which shells out to a real `python3`).

- [ ] **Step 2: Types and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 3: The keyless-skip guarantee**

Run: `env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN npx vitest run`
Expected: green, with the live suites reported as skipped — never failed. Nothing in this plan may
require a credential to pass.

- [ ] **Step 4: Spec acceptance 8, executed**

> "A `--bg` host parks indefinitely on an `ask`-routed tool with no client attached, and `agents`
> shows `state: "blocked"`."

Without a working account the model cannot be made to call a tool, so exercise the same path through
the host's own seam and record it as such:

```bash
cd CC-to-SDK/harness && npm run build
node --input-type=module -e '
import { mkdtempSync } from "node:fs";
const { SessionHost } = await import("./dist/host/host.js");
const { collectFleet } = await import("./dist/fleet/index.js");
process.env.CCX_FLEET_ROOT = mkdtempSync("/tmp/ccx-acc8-");
// NOTE: no procStartOf override. The real one records this process`s true `ps -o lstart=`, which is
// what collectFleet`s isPidLive then compares against. A fake value fails that comparison, the pid
// reads dead, and projectRow returns state "error" — the acceptance check would fail on its own
// scaffolding rather than on the behaviour under test.
const host = new SessionHost(
  { short: "eeeeeeee", name: "acc8", cwd: process.cwd(), kind: "bg", config: {}, env: process.env },
  { openSession: () => ({ sessionId: "s", submit: async () => {}, dispose: async () => {} }) });
await host.start();
host.broker().request({ toolName: "Bash", input: {}, toolUseID: "acc8", signal: new AbortController().signal });
await new Promise(r => setTimeout(r, 200));
console.log(JSON.stringify(await collectFleet(), null, 1));
await host.stop();
'
```

Expected: one row with `"state": "blocked"`. Paste the verbatim output into your report, and state
plainly that the park was driven through the host's broker rather than by a model calling a tool,
because the account's weekly limit ends every real turn in about three seconds without a tool call.

- [ ] **Step 4b: Confirm the premises this plan was built on still read as recorded**

All four A2 probes were run live on 2026-07-27 and are **resolved**; the plan's design follows their
results rather than hedging against them. Re-run them and paste the verdict lines into your report, so
a regression in the SDK shows up here rather than in production:

```bash
cd CC-to-SDK/probes && set -a; . ../.env; set +a
for p in 62-midturn-transcript-and-stream-volume 63-interrupt-vs-parked-permission 64-auto-mode-vs-canusetool; do
  echo "--- $p"; npx tsx "probes/$p.ts" 2>&1 | tail -6
done
```

Expected, matching what the plan cites:

1. **62** — the transcript does **not** grow mid-turn (Task 3's `TurnBuffer` is required, not
   speculative), and the stream runs at roughly 3 messages/s and 1.4 KiB/s.
2. **63** — `interrupt()` **does** abort a parked `canUseTool`, and the stream then throws rather than
   returning a result.
3. **64** — `auto` **does** consult `canUseTool` when a rule routes a tool to `ask` (Task 8's premise).
4. **63b** (`npx tsx probes/63b-park-soak-ten-minutes.ts`, ~11 min) — a park survives ten minutes and
   answers normally. Run it once; if it now fails, acceptance 8's word "indefinitely" needs revisiting
   and that is a finding, not a flake.

- [ ] **Step 5: Commit anything the verification changed**

If nothing changed, say so and skip. Otherwise commit with a message naming what the verification
caught.

---

## Notes for the executor

- **A plan-mandated defect is still a defect.** Every code block above is a starting point, not a
  contract with reality. If a step tells you to write something that is wrong — a race, a deadlock, a
  guard that cannot fire — report it as a finding and say what you did instead. The A1 run's three
  Critical defects were all faithfully transcribed from plan text.
- **`--detachable`, foreground `ccx`, and `ccx attach` stay refused.** They are A2b. If you find
  yourself tempted to unrefuse one because "the transport exists now", stop: the client does not.
- **Do not touch `CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR` or `CODEX_SANDBOX_ENV_VAR`.**
- **Never print or commit `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.**
