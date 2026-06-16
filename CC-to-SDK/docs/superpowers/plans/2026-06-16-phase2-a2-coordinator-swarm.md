# Phase 2 · A2 — Coordinator / Swarm Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coordinator Claude session that orchestrates long-lived peer teammate sessions (each a real SDK `query()`) over an in-process message bus and the shared A1 `TaskStore`, exposed as a `cc-swarm` MCP tool family.

**Architecture:** One Node process. The coordinator is a `query()` given five `cc-swarm` MCP tools; each teammate is a long-lived `query()` fed by an `AsyncQueue` push-prompt. A `MessageBus` delivers messages to teammates (via a per-agent subscriber that pushes a user turn into their query) and buffers teammate→coordinator envelopes in the coordinator inbox (drained by `CheckMessages`). A `SwarmRuntime` ties the team registry, bus, and TaskStore together and exposes `onPermissionRequest`/`onHandshake` seams for A2b. All stateful units take an injected `query` (DI) so the substrate is unit-tested with zero network.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk` (`query`, `tool`, `createSdkMcpServer`), `zod/v4`, vitest.

**Conventions (match the existing codebase):**
- All paths below are under `CC-to-SDK/harness/`. Run all commands from `CC-to-SDK/harness/`.
- Single-file test run: `npx vitest run test/unit/<file>.test.ts`. Typecheck: `npm run typecheck`.
- Commit messages use `feat(harness): …` / `test(harness): …`. **No `Co-Authored-By` / attribution lines** (project CLAUDE.md).
- MCP handlers return `CallToolResult` (`{ content: [{ type: "text", text }], isError? }`) and turn domain errors into `isError` results (never throw) — exactly like `src/tasks/server.ts`.
- Spec: `docs/superpowers/specs/2026-06-16-phase2-a2-coordinator-swarm-design.md`.

---

### Task 1: Swarm types, zod tool shapes, and `SwarmError`

**Files:**
- Create: `src/swarm/types.ts`
- Test: `test/unit/swarm-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-types.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import {
  SwarmError,
  teamCreateShape, teamDeleteShape, spawnTeammateShape, sendMessageShape, checkMessagesShape,
} from "../../src/swarm/types.js";

describe("swarm types", () => {
  it("SwarmError is an Error subclass", () => {
    expect(new SwarmError("x")).toBeInstanceOf(Error);
  });
  it("spawnTeammateShape requires teamId, name, prompt and accepts optional agent", () => {
    const ok = z.object(spawnTeammateShape).parse({ teamId: "team-1", name: "w1", prompt: "go", agent: "Plan" });
    expect(ok.name).toBe("w1");
    expect(() => z.object(spawnTeammateShape).parse({ name: "w1" })).toThrow();
  });
  it("sendMessageShape constrains kind to the message kinds", () => {
    expect(() => z.object(sendMessageShape).parse({ to: "w1", body: "hi", kind: "bogus" })).toThrow();
    expect(z.object(sendMessageShape).parse({ to: "w1", body: "hi" }).kind).toBeUndefined();
  });
  it("the simple shapes parse minimal input", () => {
    expect(z.object(teamCreateShape).parse({ name: "a" }).name).toBe("a");
    expect(z.object(teamDeleteShape).parse({ teamId: "team-1" }).teamId).toBe("team-1");
    expect(z.object(checkMessagesShape).parse({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-types.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/types.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/types.ts
import { z } from "zod/v4";

export type MessageKind = "text" | "task" | "result" | "idle";

export interface Message {
  from: string;            // sender agent name
  to: string;              // recipient agent name ("coordinator" | teammate name)
  kind: MessageKind;
  body: string;
  ts: string;              // ISO timestamp, stamped by the bus/session
}

export interface TeammateSpec {
  name: string;            // unique within the runtime
  teamId: string;
  agent?: string;          // per-teammate model hint (30.9); forwarded to the teammate query as options.model
  prompt: string;          // seed turn
}

export interface SwarmOptions {
  cwd?: string;
  taskOptions?: { dir?: string; listId?: string; agentName?: string };
}

/** Minimal structural type for the SDK `query` fn so units can be tested with a fake (DI). */
export type QueryFn = (args: { prompt: any; options?: any }) => AsyncIterable<any>;

export class SwarmError extends Error {}

const KIND = z.enum(["text", "task", "result", "idle"]);

// zod raw shapes for the five cc-swarm tools.
export const teamCreateShape = {
  name: z.string(),
  members: z.array(z.string()).optional(),
};
export const teamDeleteShape = { teamId: z.string() };
export const spawnTeammateShape = {
  teamId: z.string(),
  name: z.string(),
  agent: z.string().optional(),
  prompt: z.string(),
};
export const sendMessageShape = {
  to: z.string(),
  body: z.string(),
  kind: KIND.optional(),
};
export const checkMessagesShape = {};

export type TeamCreateInput = z.infer<z.ZodObject<typeof teamCreateShape>>;
export type SpawnTeammateInput = z.infer<z.ZodObject<typeof spawnTeammateShape>>;
export type SendMessageInput = z.infer<z.ZodObject<typeof sendMessageShape>>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/types.ts test/unit/swarm-types.test.ts
git commit -m "feat(harness): swarm types + zod tool shapes + SwarmError"
```

---

### Task 2: `AsyncQueue` — push-driven async iterable (teammate input prompt)

**Files:**
- Create: `src/swarm/asyncQueue.ts`
- Test: `test/unit/swarm-asyncqueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-asyncqueue.test.ts
import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

describe("AsyncQueue", () => {
  it("delivers buffered values in order, then ends on close()", async () => {
    const q = new AsyncQueue<number>();
    q.push(1); q.push(2);
    const out: number[] = [];
    const consume = (async () => { for await (const v of q) out.push(v); })();
    q.push(3);
    q.close();
    await consume;
    expect(out).toEqual([1, 2, 3]);
  });
  it("resolves a waiting consumer when a value arrives later", async () => {
    const q = new AsyncQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push("a");
    expect(await pending).toEqual({ value: "a", done: false });
  });
  it("reports pending buffered count and ignores push after close", () => {
    const q = new AsyncQueue<number>();
    q.push(1); q.push(2);
    expect(q.pending).toBe(2);
    q.close();
    q.push(3);
    expect(q.pending).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-asyncqueue.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/asyncQueue.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/asyncQueue.ts
/** A push-driven async iterable: values are pushed in, consumed by `for await`, ended by close(). */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private resolvers: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  /** Number of values buffered but not yet consumed. */
  get pending(): number { return this.values.length; }

  push(value: T): void {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let resolve;
    while ((resolve = this.resolvers.shift())) resolve({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-asyncqueue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/asyncQueue.ts test/unit/swarm-asyncqueue.test.ts
git commit -m "feat(harness): AsyncQueue push-driven async iterable"
```

---

### Task 3: `MessageBus` — per-agent inboxes + subscriber delivery

**Files:**
- Create: `src/swarm/bus.ts`
- Test: `test/unit/swarm-bus.test.ts`

The bus is the single in-process transport. The **coordinator** is a passive inbox (drained by `CheckMessages`). A **teammate** registers a *subscriber* on spawn; a message sent to it is delivered to the subscriber (which pushes a turn into the teammate's query) instead of being buffered.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-bus.test.ts
import { describe, it, expect } from "vitest";
import { MessageBus } from "../../src/swarm/bus.js";
import type { Message } from "../../src/swarm/types.js";

const msg = (to: string, body: string): Message => ({ from: "x", to, kind: "text", body, ts: "t" });

describe("MessageBus", () => {
  it("buffers for the coordinator and drain() returns then clears", () => {
    const bus = new MessageBus();
    bus.send("coordinator", msg("coordinator", "hi"));
    expect(bus.drain("coordinator").map((m) => m.body)).toEqual(["hi"]);
    expect(bus.drain("coordinator")).toEqual([]);
  });
  it("throws on an unknown recipient", () => {
    const bus = new MessageBus();
    expect(() => bus.send("ghost", msg("ghost", "x"))).toThrow(/unknown recipient/);
  });
  it("delivers to a subscriber instead of buffering", () => {
    const bus = new MessageBus();
    const got: string[] = [];
    bus.subscribe("w1", (m) => got.push(m.body));
    bus.send("w1", msg("w1", "yo"));
    expect(got).toEqual(["yo"]);
    expect(bus.drain("w1")).toEqual([]);
  });
  it("unregister removes the recipient so sends error again", () => {
    const bus = new MessageBus();
    bus.subscribe("w1", () => {});
    bus.unregister("w1");
    expect(() => bus.send("w1", msg("w1", "x"))).toThrow(/unknown recipient/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-bus.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/bus.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/bus.ts
import { SwarmError } from "./types.js";
import type { Message } from "./types.js";

export class MessageBus {
  private inboxes = new Map<string, Message[]>();
  private subscribers = new Map<string, (msg: Message) => void>();
  private known = new Set<string>(["coordinator"]); // coordinator inbox always exists

  subscribe(agent: string, handler: (msg: Message) => void): void {
    this.known.add(agent);
    this.subscribers.set(agent, handler);
  }
  unregister(agent: string): void {
    this.known.delete(agent);
    this.subscribers.delete(agent);
    this.inboxes.delete(agent);
  }

  send(to: string, msg: Message): void {
    if (!this.known.has(to)) throw new SwarmError(`unknown recipient ${to}`);
    const sub = this.subscribers.get(to);
    if (sub) { sub(msg); return; }
    const box = this.inboxes.get(to) ?? [];
    box.push(msg);
    this.inboxes.set(to, box);
  }

  drain(agent: string): Message[] {
    const box = this.inboxes.get(agent) ?? [];
    this.inboxes.set(agent, []);
    return box;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-bus.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/bus.ts test/unit/swarm-bus.test.ts
git commit -m "feat(harness): MessageBus (inbox + subscriber delivery)"
```

---

### Task 4: `TeamRegistry` — team lifecycle + roster

**Files:**
- Create: `src/swarm/team.ts`
- Test: `test/unit/swarm-team.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-team.test.ts
import { describe, it, expect } from "vitest";
import { TeamRegistry } from "../../src/swarm/team.js";

describe("TeamRegistry", () => {
  it("creates a team with an auto id, roster, and active state", () => {
    const r = new TeamRegistry();
    const t = r.create("alpha", ["w1"]);
    expect(t.id).toBe("team-1");
    expect(t.members).toEqual(["w1"]);
    expect(t.state).toBe("active");
    expect(r.create("beta").id).toBe("team-2");
  });
  it("addMember rejects duplicates within a team and disbanded teams", () => {
    const r = new TeamRegistry();
    const t = r.create("alpha");
    r.addMember(t.id, "w1");
    expect(() => r.addMember(t.id, "w1")).toThrow(/duplicate/);
    r.delete(t.id);
    expect(() => r.addMember(t.id, "w2")).toThrow(/disbanded/);
  });
  it("delete marks disbanded and returns the roster; unknown id throws", () => {
    const r = new TeamRegistry();
    const t = r.create("alpha", ["w1"]);
    expect(r.delete(t.id).state).toBe("disbanded");
    expect(() => r.delete("team-99")).toThrow(/unknown team/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-team.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/team.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/team.ts
import { SwarmError } from "./types.js";

export interface Team {
  id: string;
  name: string;
  members: string[];
  state: "active" | "disbanded";
}

export class TeamRegistry {
  private teams = new Map<string, Team>();
  private nextId = 1;

  create(name: string, members: string[] = []): Team {
    const id = `team-${this.nextId++}`;
    const team: Team = { id, name, members: [...members], state: "active" };
    this.teams.set(id, team);
    return team;
  }

  get(id: string): Team | undefined { return this.teams.get(id); }
  list(): Team[] { return [...this.teams.values()]; }

  addMember(id: string, name: string): void {
    const team = this.teams.get(id);
    if (!team) throw new SwarmError(`unknown team ${id}`);
    if (team.state !== "active") throw new SwarmError(`team ${id} is disbanded`);
    if (team.members.includes(name)) throw new SwarmError(`duplicate teammate ${name}`);
    team.members.push(name);
  }

  delete(id: string): Team {
    const team = this.teams.get(id);
    if (!team) throw new SwarmError(`unknown team ${id}`);
    team.state = "disbanded";
    return team;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-team.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/team.ts test/unit/swarm-team.test.ts
git commit -m "feat(harness): TeamRegistry (lifecycle + roster)"
```

---

### Task 5: `TeammateSession` — long-lived peer over an injected `query`

**Files:**
- Create: `src/swarm/teammate.ts`
- Test: `test/unit/swarm-teammate.test.ts`

A `TeammateSession` opens a `query()` whose prompt is an `AsyncQueue` it controls. It seeds the prompt, subscribes itself to the bus (incoming messages become new turns), and runs a read-loop that emits a `result` envelope per settled turn and an `idle` envelope when nothing is queued. `dispose()` closes the input → ends the query. `settled()` resolves after the next turn settles (for tests and coordination).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-teammate.test.ts
import { describe, it, expect } from "vitest";
import { MessageBus } from "../../src/swarm/bus.js";
import { TeammateSession } from "../../src/swarm/teammate.js";

// Fake query: consumes each pushed user turn and yields an assistant + result per turn.
function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      const text = turn.message.content;
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack:" + text }] } };
      yield { type: "result", subtype: "success", result: "did:" + text };
    }
  })();
}

describe("TeammateSession", () => {
  it("seeds the prompt and emits result + idle to the coordinator", async () => {
    const bus = new MessageBus();
    const s = new TeammateSession({ name: "w1", teamId: "team-1", prompt: "do x" }, bus, { query: fakeQuery });
    await s.settled();
    const msgs = bus.drain("coordinator");
    expect(msgs.map((m) => [m.kind, m.body])).toEqual([["result", "did:do x"], ["idle", ""]]);
    expect(msgs[0].from).toBe("w1");
    await s.dispose();
  });
  it("delivers a sent message as a new turn", async () => {
    const bus = new MessageBus();
    const s = new TeammateSession({ name: "w1", teamId: "team-1", prompt: "seed" }, bus, { query: fakeQuery });
    await s.settled();
    bus.drain("coordinator");
    const next = s.settled();
    s.send("more");
    await next;
    expect(bus.drain("coordinator").map((m) => [m.kind, m.body])).toEqual([["result", "did:more"], ["idle", ""]]);
    await s.dispose();
  });
  it("dispose() ends the underlying query", async () => {
    const bus = new MessageBus();
    let ended = false;
    const fq = ({ prompt }: any) => (async function* () {
      try { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } }
      finally { ended = true; }
    })();
    const s = new TeammateSession({ name: "w1", teamId: "team-1", prompt: "x" }, bus, { query: fq });
    await s.settled();
    await s.dispose();
    expect(ended).toBe(true);
  });
  it("forwards constructor options to the query (e.g. per-teammate model)", () => {
    const bus = new MessageBus();
    let seen: any;
    const fq = ({ prompt, options }: any) => {
      seen = options;
      return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })();
    };
    new TeammateSession({ name: "w1", teamId: "t1", prompt: "x" }, bus, { query: fq }, { model: "claude-haiku-4-5-20251001" });
    expect(seen).toEqual({ model: "claude-haiku-4-5-20251001" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/teammate.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/teammate.ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "./asyncQueue.js";
import type { MessageBus } from "./bus.js";
import type { MessageKind, QueryFn, TeammateSpec } from "./types.js";

export interface TeammateDeps { query: QueryFn; }

function userTurn(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null } as SDKUserMessage;
}

export class TeammateSession {
  readonly name: string;
  readonly teamId: string;
  readonly done: Promise<void>;
  private input = new AsyncQueue<SDKUserMessage>();
  private q: AsyncIterable<any>;
  private settleResolvers: (() => void)[] = [];

  constructor(spec: TeammateSpec, private bus: MessageBus, deps: TeammateDeps, options?: Record<string, unknown>) {
    this.name = spec.name;
    this.teamId = spec.teamId;
    this.bus.subscribe(this.name, (msg) => this.send(msg.body)); // incoming bus message → new turn
    this.input.push(userTurn(spec.prompt));                      // seed turn
    this.q = deps.query({ prompt: this.input, options });
    this.done = this.readLoop();
  }

  /** Deliver a new user turn into this teammate's query. */
  send(turn: string): void { this.input.push(userTurn(turn)); }

  /** Resolves after the next turn settles (result + maybe idle emitted). */
  settled(): Promise<void> { return new Promise((r) => this.settleResolvers.push(r)); }

  /** End the underlying query and wait for the read-loop to finish. */
  async dispose(): Promise<void> { this.input.close(); await this.done; }

  private emit(kind: MessageKind, body: string): void {
    this.bus.send("coordinator", { from: this.name, to: "coordinator", kind, body, ts: new Date().toISOString() });
  }

  private settle(): void {
    const waiters = this.settleResolvers;
    this.settleResolvers = [];
    for (const w of waiters) w();
  }

  private async readLoop(): Promise<void> {
    for await (const m of this.q) {
      const mm = m as any;
      if (mm.type === "result") {
        this.emit("result", String(mm.result ?? ""));
        if (this.input.pending === 0) this.emit("idle", "");
        this.settle();
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/teammate.ts test/unit/swarm-teammate.test.ts
git commit -m "feat(harness): TeammateSession (long-lived peer over injected query)"
```

---

### Task 6: `SwarmRuntime` — registry + bus + TaskStore + seams

**Files:**
- Create: `src/swarm/runtime.ts`
- Test: `test/unit/swarm-runtime.test.ts`

The runtime owns the bus, the team registry, the teammate sessions, and a `TaskStore` whose `onOwnerChange` pushes a `task` envelope to the coordinator (this closes A1's deferred 15.10 mailbox-notify). `onPermissionRequest`/`onHandshake` are no-op seams for A2b.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-runtime.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwarmRuntime } from "../../src/swarm/runtime.js";

const dir = () => mkdtempSync(join(tmpdir(), "swarm-"));
function fakeQuery({ prompt }: any) {
  return (async function* () {
    for await (const turn of prompt) {
      yield { type: "result", subtype: "success", result: "did:" + turn.message.content };
    }
  })();
}
const newRuntime = () => new SwarmRuntime({ query: fakeQuery }, { taskOptions: { dir: dir() } });

describe("SwarmRuntime", () => {
  it("spawns a teammate and a bus message reaches its query → result to the coordinator", async () => {
    const rt = newRuntime();
    const team = rt.createTeam("alpha");
    const s = rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "seed" });
    await s.settled();
    rt.checkMessages(); // clear seed result/idle
    const next = s.settled();
    rt.sendMessage("w1", "go");
    await next;
    expect(rt.checkMessages().map((m) => m.body)).toContain("did:go");
    await rt.disposeAll();
  });
  it("rejects duplicate teammate names and unknown teams", () => {
    const rt = newRuntime();
    const t = rt.createTeam("a");
    rt.spawnTeammate({ teamId: t.id, name: "w1", prompt: "x" });
    expect(() => rt.spawnTeammate({ teamId: t.id, name: "w1", prompt: "y" })).toThrow(/duplicate/);
    expect(() => rt.spawnTeammate({ teamId: "team-99", name: "w2", prompt: "z" })).toThrow(/unknown team/);
    return rt.disposeAll();
  });
  it("sendMessage to an unknown recipient throws", () => {
    const rt = newRuntime();
    expect(() => rt.sendMessage("ghost", "hi")).toThrow(/unknown recipient/);
  });
  it("deleteTeam disposes members and unregisters them from the bus", async () => {
    const rt = newRuntime();
    const t = rt.createTeam("a");
    rt.spawnTeammate({ teamId: t.id, name: "w1", prompt: "x" });
    rt.deleteTeam(t.id);
    expect(() => rt.sendMessage("w1", "hi")).toThrow(/unknown recipient/);
  });
  it("a TaskStore owner change notifies the coordinator over the bus (closes A1 15.10)", async () => {
    const rt = newRuntime();
    await rt.tasks.create({ subject: "x" });
    await rt.tasks.update(1, { status: "in_progress" }); // claim → owner change
    expect(rt.checkMessages().some((m) => m.kind === "task" && /owner/.test(m.body))).toBe(true);
  });
  it("forwards spec.agent to the teammate query as options.model (30.9)", () => {
    let seen: any;
    const fq = ({ prompt, options }: any) => {
      seen = options;
      return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })();
    };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() } });
    const t = rt.createTeam("a");
    rt.spawnTeammate({ teamId: t.id, name: "w1", prompt: "x", agent: "claude-haiku-4-5-20251001" });
    expect(seen).toEqual({ model: "claude-haiku-4-5-20251001" });
    return rt.disposeAll();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/runtime.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/runtime.ts
import { MessageBus } from "./bus.js";
import { TeamRegistry } from "./team.js";
import type { Team } from "./team.js";
import { TeammateSession } from "./teammate.js";
import { TaskStore } from "../tasks/store.js";
import { SwarmError } from "./types.js";
import type { Message, MessageKind, QueryFn, SwarmOptions, TeammateSpec } from "./types.js";

export interface SwarmDeps { query: QueryFn; }

export class SwarmRuntime {
  readonly bus = new MessageBus();
  readonly teams = new TeamRegistry();
  readonly tasks: TaskStore;
  /** A2b seams (no-op by default). */
  onPermissionRequest?: (teammate: string, request: unknown) => void;
  onHandshake?: (kind: string, payload: unknown) => void;
  private sessions = new Map<string, TeammateSession>();

  constructor(private deps: SwarmDeps, opts: SwarmOptions = {}) {
    this.tasks = new TaskStore({
      cwd: opts.cwd,
      dir: opts.taskOptions?.dir,
      listId: opts.taskOptions?.listId,
      agentName: opts.taskOptions?.agentName,
      onOwnerChange: (task, prev) => {
        this.bus.send("coordinator", {
          from: task.owner ?? "system",
          to: "coordinator",
          kind: "task",
          body: `task ${task.id} owner ${prev ?? "none"} -> ${task.owner ?? "none"}`,
          ts: new Date().toISOString(),
        });
      },
    });
  }

  createTeam(name: string, members?: string[]): Team { return this.teams.create(name, members); }

  deleteTeam(id: string): Team {
    const team = this.teams.delete(id); // throws on unknown id
    for (const name of team.members) {
      const s = this.sessions.get(name);
      if (s) { void s.dispose(); this.sessions.delete(name); }
      this.bus.unregister(name);
    }
    return team;
  }

  spawnTeammate(spec: TeammateSpec): TeammateSession {
    if (this.sessions.has(spec.name)) throw new SwarmError(`duplicate teammate ${spec.name}`);
    if (!this.teams.get(spec.teamId)) throw new SwarmError(`unknown team ${spec.teamId}`);
    this.teams.addMember(spec.teamId, spec.name); // also guards disbanded teams
    const options = spec.agent ? { model: spec.agent } : undefined; // per-teammate model (30.9)
    const session = new TeammateSession(spec, this.bus, { query: this.deps.query }, options); // subscribes itself
    this.sessions.set(spec.name, session);
    return session;
  }

  sendMessage(to: string, body: string, kind: MessageKind = "text"): Message {
    const msg: Message = { from: "coordinator", to, kind, body, ts: new Date().toISOString() };
    this.bus.send(to, msg); // teammate subscriber delivers into its query; coordinator buffers; unknown → throws
    return msg;
  }

  checkMessages(): Message[] { return this.bus.drain("coordinator"); }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()));
    this.sessions.clear();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/runtime.ts test/unit/swarm-runtime.test.ts
git commit -m "feat(harness): SwarmRuntime (registry + bus + TaskStore + seams)"
```

---

### Task 7: Coordinator persona + tool-pool filter (30.4 / 30.11)

**Files:**
- Create: `src/swarm/coordinator.ts`
- Test: `test/unit/swarm-coordinator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-coordinator.test.ts
import { describe, it, expect } from "vitest";
import { applyCoordinatorPersona, coordinatorTools, COORDINATOR_PROMPT } from "../../src/swarm/coordinator.js";

describe("coordinator persona", () => {
  it("appends the persona to an existing preset systemPrompt and sets the default whitelist", () => {
    const options: any = { systemPrompt: { type: "preset", preset: "claude_code", append: "BASE" } };
    applyCoordinatorPersona(options);
    expect(options.systemPrompt.type).toBe("preset");
    expect(options.systemPrompt.append).toContain("BASE");
    expect(options.systemPrompt.append).toContain(COORDINATOR_PROMPT);
    expect(options.allowedTools).toEqual(coordinatorTools());
    expect(options.allowedTools).toContain("mcp__cc-swarm__spawnTeammate");
    expect(options.allowedTools).toContain("mcp__cc-tasks__TaskCreate");
  });
  it("creates a preset systemPrompt when none exists and honors a tools override", () => {
    const options: any = {};
    applyCoordinatorPersona(options, ["Read"]);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: COORDINATOR_PROMPT });
    expect(options.allowedTools).toEqual(["Read"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/coordinator.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/coordinator.ts

/** System-prompt append that turns a session into the swarm coordinator (30.4). */
export const COORDINATOR_PROMPT = [
  "You are the COORDINATOR of a team of AI teammates.",
  "Use TeamCreate to form a team, spawnTeammate to add workers (each runs as an independent session),",
  "SendMessage to assign or follow up with a teammate, and CheckMessages to read their replies.",
  "Decompose the goal into durable tasks with TaskCreate (set blockedBy for dependencies); a teammate",
  "claims a task by setting it in_progress. Do the planning and integration yourself; delegate the",
  "implementation to teammates and integrate their results.",
].join(" ");

/** Default coordinator tool whitelist (30.11): orchestration + tasks + read-only inspection. */
export function coordinatorTools(): string[] {
  return [
    "mcp__cc-swarm__TeamCreate", "mcp__cc-swarm__TeamDelete", "mcp__cc-swarm__spawnTeammate",
    "mcp__cc-swarm__SendMessage", "mcp__cc-swarm__CheckMessages",
    "mcp__cc-tasks__TaskCreate", "mcp__cc-tasks__TaskUpdate", "mcp__cc-tasks__TaskGet", "mcp__cc-tasks__TaskList",
    "Read", "Grep", "Glob",
  ];
}

/** Mutate resolved SDK options to apply the coordinator persona append + tool whitelist. */
export function applyCoordinatorPersona(options: Record<string, unknown>, tools?: string[]): void {
  const sp = options.systemPrompt as { type?: string; preset?: string; append?: string } | string | undefined;
  if (sp && typeof sp === "object") {
    options.systemPrompt = { ...sp, append: (sp.append ? sp.append + "\n\n" : "") + COORDINATOR_PROMPT };
  } else {
    options.systemPrompt = { type: "preset", preset: "claude_code", append: COORDINATOR_PROMPT };
  }
  options.allowedTools = tools ?? coordinatorTools();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/coordinator.ts test/unit/swarm-coordinator.test.ts
git commit -m "feat(harness): coordinator persona + tool-pool filter"
```

---

### Task 8: `cc-swarm` MCP server (`buildSwarmTools` + `createSwarmMcpServer`)

**Files:**
- Create: `src/swarm/server.ts`
- Test: `test/unit/swarm-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-server.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SwarmRuntime } from "../../src/swarm/runtime.js";
import { buildSwarmTools, createSwarmMcpServer } from "../../src/swarm/server.js";

const dir = () => mkdtempSync(join(tmpdir(), "swarm-"));
function fakeQuery({ prompt }: any) {
  return (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
}
const newRuntime = () => new SwarmRuntime({ query: fakeQuery }, { taskOptions: { dir: dir() } });
function toolMap(rt: SwarmRuntime) {
  const map: Record<string, any> = {};
  for (const t of buildSwarmTools(rt)) map[t.name] = t;
  return map;
}
const text = (r: any) => r.content[0].text;

describe("cc-swarm MCP server", () => {
  it("exposes the five tools", () => {
    expect(Object.keys(toolMap(newRuntime())).sort())
      .toEqual(["CheckMessages", "SendMessage", "TeamCreate", "TeamDelete", "spawnTeammate"]);
  });
  it("createSwarmMcpServer returns an sdk server named cc-swarm", () => {
    const srv: any = createSwarmMcpServer(newRuntime());
    expect(srv.type).toBe("sdk");
    expect(srv.name).toBe("cc-swarm");
  });
  it("TeamCreate → spawnTeammate → CheckMessages round-trips through the runtime", async () => {
    const rt = newRuntime();
    const t = toolMap(rt);
    const teamId = JSON.parse(text(await t.TeamCreate.handler({ name: "alpha" }, {}))).teamId;
    expect(teamId).toBe("team-1");
    const spawned = await t.spawnTeammate.handler({ teamId, name: "w1", prompt: "seed" }, {});
    expect(JSON.parse(text(spawned)).name).toBe("w1");
    await rt.disposeAll();
  });
  it("domain errors come back as isError results, not throws", async () => {
    const t = toolMap(newRuntime());
    const bad = await t.SendMessage.handler({ to: "ghost", body: "hi" }, {});
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/unknown recipient/);
    const badSpawn = await t.spawnTeammate.handler({ teamId: "team-99", name: "w1", prompt: "x" }, {});
    expect(badSpawn.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/server.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/server.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SwarmRuntime } from "./runtime.js";
import { teamCreateShape, teamDeleteShape, spawnTeammateShape, sendMessageShape, checkMessagesShape } from "./types.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Build the five cc-swarm SDK tool definitions over a SwarmRuntime (exported for direct handler testing). */
export function buildSwarmTools(runtime: SwarmRuntime) {
  return [
    tool("TeamCreate", "Create a team of teammates; returns its teamId and roster.", teamCreateShape, async (a) => {
      try { const t = runtime.createTeam(a.name, a.members); return ok({ teamId: t.id, roster: t.members }); }
      catch (e) { return fail((e as Error).message); }
    }),
    tool("TeamDelete", "Disband a team and stop its teammates.", teamDeleteShape, async (a) => {
      try { const t = runtime.deleteTeam(a.teamId); return ok({ teamId: t.id, roster: t.members }); }
      catch (e) { return fail((e as Error).message); }
    }),
    tool("spawnTeammate", "Spawn a long-lived teammate session on a team, seeded with a prompt.", spawnTeammateShape, async (a) => {
      try { const s = runtime.spawnTeammate(a); return ok({ name: s.name, teamId: s.teamId }); }
      catch (e) { return fail((e as Error).message); }
    }),
    tool("SendMessage", "Send a message to a teammate (delivered as a turn) or to 'coordinator'.", sendMessageShape, async (a) => {
      try { return ok(runtime.sendMessage(a.to, a.body, a.kind)); }
      catch (e) { return fail((e as Error).message); }
    }),
    tool("CheckMessages", "Read and clear messages addressed to the coordinator.", checkMessagesShape, async () => {
      return ok(runtime.checkMessages());
    }),
  ];
}

/** Wrap a SwarmRuntime as an in-process SDK MCP server exposing the five cc-swarm tools. */
export function createSwarmMcpServer(runtime: SwarmRuntime) {
  return createSdkMcpServer({ name: "cc-swarm", version: "0.1.0", tools: buildSwarmTools(runtime) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/server.ts test/unit/swarm-server.test.ts
git commit -m "feat(harness): cc-swarm MCP server (buildSwarmTools + createSwarmMcpServer)"
```

---

### Task 9: Wire `swarm` into config + `createHarness` + public exports

**Files:**
- Create: `src/swarm/index.ts`
- Modify: `src/config/types.ts` (add `swarm?` to `HarnessConfig`, after the `taskTools` line ~39)
- Modify: `src/harness.ts` (imports; `Harness.swarm` field; wiring block; return value)
- Modify: `src/index.ts` (re-export swarm public API)
- Test: `test/unit/swarm-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-integration.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/harness.js";

const dir = () => mkdtempSync(join(tmpdir(), "swarm-int-"));
function fakeQuery() { return (async function* () { yield { type: "result", subtype: "success", result: "ok" }; })(); }

describe("swarm harness wiring", () => {
  it("merges cc-swarm and exposes harness.swarm", () => {
    const h = createHarness({ swarm: true, cwd: dir() }, { query: fakeQuery as any });
    expect((h.options as any).mcpServers["cc-swarm"].name).toBe("cc-swarm");
    expect(h.swarm).toBeTruthy();
  });
  it("coexists with taskTools (both servers present, shared store)", () => {
    const h = createHarness({ swarm: true, taskTools: true, cwd: dir() }, { query: fakeQuery as any });
    const servers = (h.options as any).mcpServers;
    expect(servers["cc-swarm"]).toBeTruthy();
    expect(servers["cc-tasks"]).toBeTruthy();
    expect(h.tasks).toBe(h.swarm!.tasks); // the cc-tasks server shares the runtime's store
  });
  it("applies the coordinator persona + whitelist when requested", () => {
    const h = createHarness({ swarm: { coordinatorPersona: true }, cwd: dir() }, { query: fakeQuery as any });
    expect((h.options as any).systemPrompt.append).toContain("COORDINATOR");
    expect((h.options as any).allowedTools).toContain("mcp__cc-swarm__spawnTeammate");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-integration.test.ts`
Expected: FAIL — `createHarness` does not accept `swarm` / `h.swarm` is undefined (assertion fails or mcpServers["cc-swarm"] is undefined).

- [ ] **Step 3a: Add `swarm?` to `HarnessConfig`**

In `src/config/types.ts`, immediately after the `taskTools?…` line (~39), add:

```ts
  // swarm / coordinator (Phase 2 A2): peer teammate orchestration over an in-process bus
  swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[] };
```

- [ ] **Step 3b: Create the swarm barrel export**

```ts
// src/swarm/index.ts
export { MessageBus } from "./bus.js";
export { TeamRegistry } from "./team.js";
export type { Team } from "./team.js";
export { TeammateSession } from "./teammate.js";
export type { TeammateDeps } from "./teammate.js";
export { SwarmRuntime } from "./runtime.js";
export type { SwarmDeps } from "./runtime.js";
export { createSwarmMcpServer, buildSwarmTools } from "./server.js";
export { applyCoordinatorPersona, coordinatorTools, COORDINATOR_PROMPT } from "./coordinator.js";
export { AsyncQueue } from "./asyncQueue.js";
export { SwarmError } from "./types.js";
export type { Message, MessageKind, TeammateSpec, SwarmOptions, QueryFn } from "./types.js";
```

- [ ] **Step 3c: Wire `createHarness`** — in `src/harness.ts`:

Add imports after the existing `createTaskMcpServer` import (line ~5):

```ts
import { SwarmRuntime } from "./swarm/runtime.js";
import { createSwarmMcpServer } from "./swarm/server.js";
import { applyCoordinatorPersona } from "./swarm/coordinator.js";
```

Add a field to the `Harness` interface (after `tasks?: TaskStore;`, line ~19):

```ts
  swarm?: SwarmRuntime;
```

Replace the existing taskTools wiring block (lines ~26-32) with this combined block:

```ts
  let tasks: TaskStore | undefined;
  let swarm: SwarmRuntime | undefined;

  if (config.swarm) {
    const so = config.swarm === true ? {} : config.swarm;
    const to = config.taskTools && config.taskTools !== true ? config.taskTools : {};
    swarm = new SwarmRuntime({ query }, { cwd: config.cwd, taskOptions: to });
    tasks = swarm.tasks; // share the runtime's store with cc-tasks if enabled
    const existing = (options.mcpServers as Record<string, unknown>) ?? {};
    options.mcpServers = { ...existing, "cc-swarm": createSwarmMcpServer(swarm) };
    if (so.coordinatorPersona) applyCoordinatorPersona(options, so.tools);
  }

  if (config.taskTools) {
    const opts = config.taskTools === true ? {} : config.taskTools;
    tasks = tasks ?? new TaskStore({ cwd: config.cwd, dir: opts.dir, listId: opts.listId, agentName: opts.agentName });
    const existing = (options.mcpServers as Record<string, unknown>) ?? {};
    options.mcpServers = { ...existing, "cc-tasks": createTaskMcpServer(tasks) };
  }
```

Add `swarm` to the returned object (after `tasks,` at line ~76):

```ts
    swarm,
```

- [ ] **Step 3d: Re-export from the root** — in `src/index.ts`, add after the tasks exports (line ~9):

```ts
export { SwarmRuntime, MessageBus, createSwarmMcpServer, SwarmError } from "./swarm/index.js";
export type { Message, MessageKind, TeammateSpec, SwarmOptions } from "./swarm/index.js";
```

- [ ] **Step 4: Run the test + full unit suite + typecheck**

Run: `npx vitest run test/unit/swarm-integration.test.ts`
Expected: PASS (3 tests).

Run: `npm run test:unit`
Expected: PASS — all prior Phase-1/A1 tests (71) plus the new swarm unit tests, no regressions.

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/index.ts src/config/types.ts src/harness.ts src/index.ts test/unit/swarm-integration.test.ts
git commit -m "feat(harness): wire swarm into createHarness + public exports"
```

---

### Task 10: Live smoke test (real SDK, gated on `ANTHROPIC_API_KEY`)

**Files:**
- Create: `test/live/swarm.test.ts`

The cheapest, most deterministic live proof of the long-lived-peer substrate: build a real swarm, spawn ONE teammate whose seed prompt asks for a single exact word, wait for the turn to settle, and assert the `result` envelope reached the coordinator inbox over the bus. This exercises the real streaming-input `query()` + read-loop end-to-end. (The MCP-tool path is covered by Task 8's unit tests.)

- [ ] **Step 1: Write the test**

```ts
// test/live/swarm.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("live swarm substrate (real SDK)", () => {
  it("a spawned teammate runs a real turn and its result reaches the coordinator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swarm-live-"));
    const h = createHarness({ swarm: true, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 2 });
    const rt = h.swarm!;
    const team = rt.createTeam("alpha");
    const s = rt.spawnTeammate({
      teamId: team.id,
      name: "w1",
      prompt: "Reply with exactly the single word PONG and nothing else. Do not use any tools.",
    });
    await s.settled(); // wait for the real model turn to settle
    const msgs = rt.checkMessages();
    expect(msgs.some((m) => m.kind === "result" && /PONG/i.test(m.body))).toBe(true);
    await rt.disposeAll();
  }, 60_000);
});
```

- [ ] **Step 2: Run the live test**

Run: `npx vitest run test/live/swarm.test.ts`
Expected: PASS if `ANTHROPIC_API_KEY` is set (the teammate replies "PONG"; the result envelope is in the coordinator inbox). If the key is absent the suite auto-skips.

> If the run reports a credit/balance error (environmental, not a code failure), note it and move on — the unit suite is the gating evidence.

- [ ] **Step 3: Commit**

```bash
git add test/live/swarm.test.ts
git commit -m "test(harness): live smoke test for swarm substrate (real SDK)"
```

---

## Final verification (after all tasks)

- [ ] Run `npm run test:unit` → all unit tests green (Phase-1/A1 + the seven new swarm unit files).
- [ ] Run `npm run typecheck` → clean.
- [ ] Run `npx vitest run test/live/swarm.test.ts` → passes (or auto-skips without the key / notes a credit error).
- [ ] Confirm `git status` is clean and no `.env` / secret is staged.
- [ ] Two-stage review per the execution skill (Spec Compliance Review, then Code Quality Review). Per project CLAUDE.md, run each review via `/codex:rescue --model gpt-5.5 --effort high`; if codex spawning fails, fall back to a Claude `feature-dev:code-reviewer` subagent.

## Notes for the implementer

- **DI everywhere:** never let a unit construct a real `query`. `TeammateSession`, `SwarmRuntime`, and `createHarness` all take the `query` fn via deps so unit tests stay network-free.
- **`settled()` ordering:** register the waiter *before* the action that triggers the turn — `const p = s.settled(); s.send(...); await p;` — and for the seed turn, `await s.settled()` immediately after construction (the read-loop settles on a later microtask).
- **No dead state:** the bus delivers to a teammate's *subscriber* (push into its query) and only *buffers* for the coordinator. Do not also buffer teammate-bound messages.
- **Timestamps:** use `new Date().toISOString()` in runtime/bus/teammate (this is application code, not a Workflow script — the `Date.now()` restriction does not apply here).
- **Module size:** keep each `src/swarm/*` file focused; none should approach the ~500 LoC soft cap.
