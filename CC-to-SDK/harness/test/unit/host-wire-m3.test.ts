// harness/test/unit/host-wire-m3.test.ts — the five ADDITIVE host-wire revisions M3 carries (spec §1a).
// Every one of them is driven over a REAL UDS through a REAL SessionHost + HostServer with a stubbed
// engine (the host-ops.test.ts client pattern over the attach.test.ts host fixture): these are wire
// promises, and a test that called the host's methods directly would prove nothing about what a foreign
// client actually receives.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { SessionHost } from "../../src/host/host.js";
import type { SessionHostOpts } from "../../src/host/host.js";
import { hostSocketPath } from "../../src/fleet/paths.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-m3wire-")); fleets.push(d); return d; };
const hosts: SessionHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.stop().catch(() => {});
  for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true });
});

const AGENTS = [{ name: "reviewer", description: "reviews" }];

/** A stub engine factory. `openSession` is called once by start() and once per swap, so it MINTS A NEW
 *  engine per call — and only the first carries a session id, because a freshly-opened engine reports
 *  none until its first turn's init frame (the exact state the `cleared` announce has to describe).
 *  `submitOutcome` stands in for the real `Session.submit`'s resolved `TurnOutcome` (§1a-f); a function
 *  that THROWS drives the failed-turn path. Defaults to the bare `{}` every pre-§1a-f case here used. */
function engineFactory(firstSessionId?: string, submitOutcome: () => unknown = () => ({})) {
  const submits: { prompt: string; opts?: { uuid?: string } }[] = [];
  const opened: Record<string, unknown>[] = [];
  const engines: { sessionId?: string }[] = [];
  const make = (sessionId?: string) => ({
    sessionId,
    submit: async (prompt: string, _on: (m: unknown) => void, opts?: { uuid?: string }) => { submits.push({ prompt, opts }); return submitOutcome(); },
    dispose: async () => {},
    interrupt: async () => {},
    onFrame: () => () => {},
    setModel: async () => {},
    setMaxThinkingTokens: async () => {},
    capabilities: async () => ({ models: [{ value: "m1" }], commands: [{ name: "c1" }], mcpServers: [{ name: "s1" }], agents: AGENTS }),
  });
  return {
    submits, opened, engines,
    openSession: (c: Record<string, unknown>) => {
      opened.push(c);
      const e = make(engines.length === 0 ? firstSessionId : undefined);
      engines.push(e);
      return e;
    },
  };
}

async function startHost(opts: { firstSessionId?: string; submitOutcome?: () => unknown } & Partial<SessionHostOpts> = {}) {
  const { firstSessionId, submitOutcome, ...over } = opts;
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const f = engineFactory(firstSessionId, submitOutcome);
  const host = new SessionHost(
    { short: "3a1b2c3d", name: "m3wire", cwd: "/tmp", kind: "interactive", detached: true,
      config: { model: "claude-test-9" }, env, ...over } as SessionHostOpts,
    { openSession: f.openSession as never, procStartOf: async () => "start", disposeGraceMs: 20 },
  );
  await host.start();
  hosts.push(host);
  return { host, f, path: hostSocketPath(process.pid, env) };
}

/** One connection, id-correlated ops, every pushed event kept. A reply and an event can never be
 *  confused: events carry `t:"event"` and replies carry the id we sent. */
function client(path: string) {
  const frames: Record<string, any>[] = [];
  const sock = connect(path);
  sock.on("error", () => {});
  let buf = "";
  sock.on("data", (c) => {
    buf += c.toString("utf8");
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) frames.push(JSON.parse(line));
    }
  });
  let id = 0;
  const waitFor = async (pred: (f: any) => boolean, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = frames.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`no frame matched within ${ms}ms; saw ${JSON.stringify(frames)}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return {
    frames,
    events: (kind: string) => frames.filter((f) => f.t === "event" && f.kind === kind),
    ready: new Promise<void>((r) => sock.once("connect", () => r())),
    ask: async (op: Record<string, unknown>) => { const mine = ++id; sock.write(JSON.stringify({ ...op, id: mine }) + "\n"); return waitFor((f) => f.id === mine); },
    waitFor,
    close: () => sock.destroy(),
  };
}

/** Follow first, then run the op: every swap emission happens INSIDE the op's dispatch, so by the time
 *  the correlated reply lands on this same socket the events it produced are already in `frames` —
 *  the count assertions below need no sleep to be sound. */
async function followed(path: string) {
  const c = client(path);
  await c.ready;
  expect(await c.ask({ op: "follow" })).toMatchObject({ ok: true, following: true });
  return c;
}

// ─── §1a-a: every engine swap announces, with a SINGLE owner ──────────────────────────────────────────
// The emission lives in swapEngine, which all three paths go through. The count assertions are the
// point: rewind() calls swapEngine AND used to emit for itself, so the obvious reading of "every swap
// announces" double-announces every conversation rewind — two epoch bumps, two client rebuilds.
describe("§1a-a — one `rewound` per engine swap, on all three paths", () => {
  it("a `resume` op announces exactly once, naming the resumed conversation", async () => {
    const { path } = await startHost({ firstSessionId: "sid-1" });
    const conn = await followed(path);
    expect(await conn.ask({ op: "resume", sessionId: "sid-resumed" })).toMatchObject({ ok: true });
    const rewound = conn.events("rewound");
    expect(rewound).toHaveLength(1);
    expect(rewound[0]).toMatchObject({ sessionId: "sid-resumed" });
    expect(rewound[0].cleared).toBeUndefined();
    conn.close();
  });

  it("a `clear` op announces exactly once, with `cleared` and NO sessionId — the discarded id must not travel", async () => {
    const { path } = await startHost({ firstSessionId: "sid-1" });
    const conn = await followed(path);
    expect(await conn.ask({ op: "clear" })).toMatchObject({ ok: true });
    const rewound = conn.events("rewound");
    expect(rewound).toHaveLength(1);
    expect(rewound[0].cleared).toBe(true);
    expect(Object.keys(rewound[0])).not.toContain("sessionId");
    expect(rewound[0].prevUuid).toBeUndefined();
    conn.close();
  });

  it("a conversation-scope `rewind` op announces exactly ONCE (the double-announce tripwire), carrying the anchor", async () => {
    const { path } = await startHost({ firstSessionId: "sid-1" });
    const conn = await followed(path);
    expect(await conn.ask({ op: "rewind", uuid: "uB", prevUuid: "a1", scope: "conversation" })).toMatchObject({ ok: true });
    const rewound = conn.events("rewound");
    expect(rewound).toHaveLength(1);
    expect(rewound[0]).toMatchObject({ sessionId: "sid-1", prevUuid: "a1" });
    conn.close();
  });

  it("a first-message `rewind` announces exactly once and `cleared`, never an anchor", async () => {
    const { path } = await startHost({ firstSessionId: "sid-1" });
    const conn = await followed(path);
    expect(await conn.ask({ op: "rewind", uuid: "uA", prevUuid: null, scope: "conversation" })).toMatchObject({ ok: true });
    const rewound = conn.events("rewound");
    expect(rewound).toHaveLength(1);
    expect(rewound[0].cleared).toBe(true);
    expect(rewound[0].prevUuid).toBeUndefined();
    conn.close();
  });
});

// ─── §1a-b: the prompt op carries the user-item uuid ──────────────────────────────────────────────────
describe("§1a-b — `prompt.uuid` reaches Session.submit", () => {
  it("a uuid-stamped prompt hands `{uuid}` to submit", async () => {
    const { f, path } = await startHost();
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello", uuid: "u-1" })).toMatchObject({ ok: true, accepted: true });
    await vi.waitFor(() => expect(f.submits).toHaveLength(1));
    expect(f.submits[0]).toMatchObject({ prompt: "hello", opts: { uuid: "u-1" } });
    conn.close();
  });

  it("an unstamped prompt hands submit no uuid at all (a fabricated one would break the id stitch)", async () => {
    const { f, path } = await startHost();
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true, accepted: true });
    await vi.waitFor(() => expect(f.submits).toHaveLength(1));
    expect(f.submits[0].opts?.uuid).toBeUndefined();
    conn.close();
  });

  it("refuses an empty uuid at the schema, rather than stamping the turn with one", async () => {
    const { f, path } = await startHost();
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello", uuid: "" })).toMatchObject({ ok: false });
    expect(f.submits).toHaveLength(0);
    conn.close();
  });
});

// ─── §1a-c: status carries model/thinkingTokens, and the setters announce ─────────────────────────────
describe("§1a-c — model/thinkingTokens on the status frame, `state` on the setters", () => {
  it("the `status` reply carries the host's model mirror", async () => {
    const { path } = await startHost();
    const conn = await followed(path);
    expect(await conn.ask({ op: "status" })).toMatchObject({ ok: true, model: "claude-test-9" });
    conn.close();
  });

  it("`set_model` pushes a `state` event whose status carries the NEW model", async () => {
    const { path } = await startHost();
    const conn = await followed(path);
    const before = conn.events("state").length;
    expect(await conn.ask({ op: "set_model", model: "opus" })).toMatchObject({ ok: true });
    const states = conn.events("state");
    expect(states.length).toBe(before + 1);
    expect(states[states.length - 1].status).toMatchObject({ model: "claude-opus-5" });
    conn.close();
  });

  it("`set_thinking` pushes a `state` event whose status carries the new budget, and a null budget clears it", async () => {
    const { path } = await startHost();
    const conn = await followed(path);
    expect(await conn.ask({ op: "set_thinking", maxTokens: 12_000 })).toMatchObject({ ok: true });
    let states = conn.events("state");
    expect(states[states.length - 1].status).toMatchObject({ thinkingTokens: 12_000 });
    expect(await conn.ask({ op: "set_thinking", maxTokens: null })).toMatchObject({ ok: true });
    states = conn.events("state");
    expect(states[states.length - 1].status.thinkingTokens).toBeUndefined();
    conn.close();
  });
});

// ─── §1a-c (review, Important 2): a swap opens at the RUNTIME settings, not the launch config's ───────
// Publishing the mirrors made them a promise. `swapEngine` overrode only `permissionMode` from its runtime
// mirrors, so after a `set_model` + a /resume or /clear the fresh engine ran the LAUNCH model while the host
// went on advertising the set one on every status reply and `state` event — and the swap's own mid-swap
// `state` emit was the first frame to say it. The assertions are on BOTH halves: the config the engine was
// actually opened with, and the frames the wire carried afterwards.
describe("§1a-c — an engine swap carries the runtime model/thinking mirrors", () => {
  it("a `resume` after `set_model` opens the fresh engine on the SET model, and no post-swap frame says otherwise", async () => {
    const { f, path } = await startHost({ firstSessionId: "sid-1" });
    const conn = await followed(path);
    expect(await conn.ask({ op: "set_model", model: "opus" })).toMatchObject({ ok: true });
    const before = conn.events("state").length;
    expect(await conn.ask({ op: "resume", sessionId: "sid-resumed" })).toMatchObject({ ok: true });
    expect(f.opened).toHaveLength(2);
    expect(f.opened[0].model).toBe("claude-test-9");                 // the launch config's
    expect(f.opened[1].model).toBe("claude-opus-5");                 // the runtime mirror's, alias resolved
    // EVERY state frame the swap produced, not just the last: the mid-swap emit is the one that was stale.
    const after = conn.events("state").slice(before);
    expect(after.length).toBeGreaterThan(0);
    for (const ev of after) expect(ev.status).toMatchObject({ model: "claude-opus-5" });
    expect(await conn.ask({ op: "status" })).toMatchObject({ ok: true, model: "claude-opus-5" });
    conn.close();
  });

  it("a swap carries the runtime thinking budget — and a CLEARED budget does not come back from the launch config", async () => {
    const { f, path } = await startHost({ firstSessionId: "sid-1", config: { model: "claude-test-9", maxThinkingTokens: 8_000 } as never });
    const conn = await followed(path);
    expect(f.opened[0].maxThinkingTokens).toBe(8_000);
    expect(await conn.ask({ op: "set_thinking", maxTokens: 12_000 })).toMatchObject({ ok: true });
    expect(await conn.ask({ op: "clear" })).toMatchObject({ ok: true });
    expect(f.opened[1].maxThinkingTokens).toBe(12_000);
    // `null` CLEARS the mirror, and the clear has to survive the next swap: re-seeding from the launch
    // config would hand the fresh engine the 8k budget the user just turned off.
    expect(await conn.ask({ op: "set_thinking", maxTokens: null })).toMatchObject({ ok: true });
    expect(await conn.ask({ op: "resume", sessionId: "sid-2" })).toMatchObject({ ok: true });
    expect(f.opened[2].maxThinkingTokens).toBeUndefined();
    expect((await conn.ask({ op: "status" })).thinkingTokens).toBeUndefined();
    conn.close();
  });
});

// ─── §1a-d: the capabilities op returns all FOUR catalogs ─────────────────────────────────────────────
describe("§1a-d — the `agents` catalog reaches the wire", () => {
  it("a `capabilities` reply carries the engine's agents catalog verbatim, alongside the other three", async () => {
    const { path } = await startHost();
    const conn = await followed(path);
    const rep = await conn.ask({ op: "capabilities" });
    expect(rep).toMatchObject({ ok: true, models: [{ value: "m1" }], commands: [{ name: "c1" }], mcpServers: [{ name: "s1" }] });
    expect(rep.agents).toEqual(AGENTS);
    conn.close();
  });
});

// ─── §1a-e: decision_settled carries the structured answer ────────────────────────────────────────────
describe("§1a-e — `decision_settled` carries the answer the `answer` op received", () => {
  it("a structured outcome rides the settlement event, payload intact", async () => {
    const { host, path } = await startHost();
    const conn = await followed(path);
    void host.broker().request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "tu-1", signal: new AbortController().signal });
    await vi.waitFor(() => expect(host.pending()).toHaveLength(1));
    expect(await conn.ask({ op: "answer", toolUseID: "tu-1", by: "tester", answer: { kind: "deny", feedback: "not that one" } })).toMatchObject({ ok: true });
    const settled = conn.events("decision_settled");
    expect(settled).toHaveLength(1);
    // The kind string stays exactly where it was — this field is ADDITIVE, and a pre-M3 client reads it.
    expect(settled[0]).toMatchObject({ toolUseID: "tu-1", by: "tester", decision: "deny" });
    expect(settled[0].answer).toEqual({ kind: "deny", feedback: "not that one" });
    conn.close();
  });

  it("a flat legacy answer settles with the outcome the host reconstructed", async () => {
    const { host, path } = await startHost();
    const conn = await followed(path);
    void host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tu-2", signal: new AbortController().signal });
    await vi.waitFor(() => expect(host.pending()).toHaveLength(1));
    expect(await conn.ask({ op: "answer", toolUseID: "tu-2", by: "tester", decision: "allow_once" })).toMatchObject({ ok: true });
    const settled = conn.events("decision_settled");
    expect(settled[0].answer).toEqual({ kind: "allow_once" });
    conn.close();
  });
});

// ─── §1a-f: the turn-end event carries the turn's result ──────────────────────────────────────────────
// P106 measured 88 `{kind:"message"}` frames on a following client and ZERO carrying `type:"result"` —
// Session's read loop resolves a result frame into the submit waiter and never hands it to `onMessage`,
// which is the only feed the host's message emission rides. So the turn-end event is the ONLY route a
// result has to a follower, and these cases are what make it one. Asserted over the wire, on a socket
// client that never touched the host object: the result must survive JSON, not merely exist in-process.
const turnEnds = (conn: { frames: Record<string, any>[] }) =>
  conn.frames.filter((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");

describe("§1a-f — a following client reads the turn result off `turn` end", () => {
  it("carries the result the engine resolved, structure intact", async () => {
    const { path } = await startHost({ submitOutcome: () => ({ result: { text: "done", n: 7 } }) });
    const conn = await followed(path);
    const rep = await conn.ask({ op: "prompt", text: "hello" });
    expect(rep).toMatchObject({ ok: true, accepted: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.seq).toBe(rep.seq);                      // the SAME turn the prompt reply named
    expect(end.result).toEqual({ text: "done", n: 7 });
    expect(end.error).toBeUndefined();
    conn.close();
  });

  it("a plain string result reaches the wire as itself", async () => {
    const { path } = await startHost({ submitOutcome: () => ({ result: "the answer" }) });
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.result).toBe("the answer");
    conn.close();
  });

  it("`structuredOutput` does NOT ride the wire — the field is additive, and no consumer asked for it", async () => {
    const { path } = await startHost({ submitOutcome: () => ({ result: "r", structuredOutput: { shape: "json" } }) });
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.result).toBe("r");
    expect(Object.keys(end)).not.toContain("structuredOutput");
    conn.close();
  });

  it("a resultless turn keeps the pre-M3 bare frame — the key is absent, not present-and-null", async () => {
    const { path } = await startHost();                 // the default stub resolves `{}`
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(Object.keys(end)).not.toContain("result");
    conn.close();
  });

  // The SOFT-failure half. A turn that reaches a terminal `is_error` result RESOLVES carrying
  // `error: TurnFailure` (session.ts:32) instead of throwing, so the wire's `error?: string` — which
  // means "submit threw" and nothing else — can never describe it. Ship the outcome's tag as `failure`
  // or a fleet thread reads a soft-failed turn as a clean completion (appserver/turns.ts reads
  // `outcome.error` to broadcast `turn/completed {status:"failed"}`).
  it("a RESOLVED-but-failed turn carries BOTH `result` and the `failure` tag, and no `error`", async () => {
    const failure = { message: "API Error: Unable to connect to API (ConnectionRefused)", terminalReason: "api_error", apiErrorStatus: 401 };
    const { path } = await startHost({ submitOutcome: () => ({ result: "text", error: failure }) });
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.result).toBe("text");                    // a failed outcome still has a result value
    expect(end.failure).toEqual(failure);               // …structure intact across JSON
    expect(Object.keys(end)).not.toContain("error");    // `error` is thrown-turns-only, and this one resolved
    conn.close();
  });

  it("a healthy turn carries NO `failure` key — absent, not present-and-null", async () => {
    const { path } = await startHost({ submitOutcome: () => ({ result: "ok" }) });
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.result).toBe("ok");
    expect(Object.keys(end)).not.toContain("failure");
    conn.close();
  });

  it("a FAILED turn ends with its error and NO result — a turn that threw produced none to carry", async () => {
    const { path } = await startHost({ submitOutcome: () => { throw new Error("engine exploded"); } });
    const conn = await followed(path);
    expect(await conn.ask({ op: "prompt", text: "hello" })).toMatchObject({ ok: true });
    const end = await conn.waitFor((f) => f.t === "event" && f.kind === "turn" && f.phase === "end");
    expect(end.error).toBe("engine exploded");
    expect(Object.keys(end)).not.toContain("result");
    // …nor a `failure`: a throw produced no outcome at all, so there is no soft tag to read off one.
    expect(Object.keys(end)).not.toContain("failure");
    // …and exactly ONE end frame: the catch's emission is terminal (it rethrows), so a failed turn must
    // not also produce the success-path end that would blank the error a follower just read.
    await new Promise((r) => setTimeout(r, 30));
    expect(turnEnds(conn)).toHaveLength(1);
    conn.close();
  });
});
