// test/unit/appserver/elicitation-park.test.ts — M4 Task 8: an MCP server's request for input becomes a
// parked decision, and the callback ALWAYS answers.
//
// THE CALLBACK IS THE SUBJECT, not the mapper (elicitation-map.test.ts owns that). `OnElicitation`
// resolving `null` sends no response at all (sdk.d.ts:1300-1318), so the MCP server waits out its own
// timeout — which is why every case below asserts a real `ElicitResult` on a path that could plausibly
// produce nothing: a rejected park, a malformed settle, a thread torn down mid-park, a decisions registry
// that is already gone. The harness captures the `onElicitation` the server BUILDS (a field of the config
// handed to `sessionFactory`, exactly as `permissionBroker` is) and invokes it directly; the acceptance
// test that proves a real stdio MCP server round-trips through it lives with the live suite, because
// elicitation reaches a stdio server only (probe 43/43b).
import { describe, it, expect, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { makeOnElicitation, type ElicitationParkSource } from "../../../src/appserver/elicitation.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { resolveOptions } from "../../../src/config/resolveOptions.js";
import type { HarnessConfig } from "../../../src/config/types.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { OnElicitation } from "@anthropic-ai/claude-agent-sdk";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, any>);
const settle = () => new Promise((r) => setImmediate(r));
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

/** Records the config every session was built from, so a test can pull the `onElicitation` off it. */
function factory() {
  const built: Array<Record<string, unknown>> = [];
  const sessionFactory: AppServerDeps["sessionFactory"] = (config) => {
    built.push(config);
    return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {},
      onFrame: () => () => {}, sessionId: `sess-${built.length}`, isEnded: () => false } as never;
  };
  return { built, sessionFactory };
}

const send = (method: string, params: unknown) => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
const replyTo = (id: number) => parsed(lines).find((m) => m.id === id);

/** A started, SUBSCRIBED thread plus the elicitation callback its engine was configured with — decision
 *  fan-out is per-thread-subscriber, so a test that never subscribes hears no `decision/requested`. */
async function startThread(config?: Record<string, unknown>): Promise<{ srv: AppServer; threadId: string; onElicitation: OnElicitation; built: Record<string, unknown> }> {
  const f = factory();
  const srv = new AppServer({}, f);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  lines = s.lines;
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  const startId = send("thread/start", config ? { config } : {});
  await settle();
  const threadId = replyTo(startId)!.result.thread.id as string;
  send("thread/subscribe", { threadId });
  await settle();
  lines.length = 0;
  const built = f.built.at(-1)!;
  return { srv, threadId, onElicitation: built.onElicitation as OnElicitation, built };
}

const FORM = {
  serverName: "vault", message: "Enter your token", mode: "form" as const,
  requestedSchema: { type: "object", properties: { token: { type: "string" }, save: { type: "boolean" } }, required: ["token"] },
};
const call = (fn: OnElicitation, request: Record<string, unknown> = FORM, requestId = "req-1", signal = new AbortController().signal) =>
  fn(request as never, { signal, requestId });
/** The park keys the server actually announced. Read rather than reconstructed: the key carries a
 *  uniqueness suffix (elicitation.ts) precisely so that nothing may predict it. */
const parkedKeys = () => parsed(lines).filter((m) => m.method === "decision/requested").map((m) => m.params.decision.toolUseId as string);
/** A promise that is ALLOWED to hang resolves "HUNG" instead of stalling the run — an orphaned park is one
 *  of the failures under test, and a test that expresses it as a timeout reports it as a failure. */
const orHang = <T>(p: Promise<T>): Promise<T | "HUNG"> => Promise.race([p, new Promise<"HUNG">((r) => setTimeout(() => r("HUNG"), 50))]);

/** A callback with NO server behind it: the same members `makeOnElicitation` reads off AppServer, with the
 *  warning fan-out captured instead of written to a wire. An `undefined` request is the thread whose
 *  decisions registry is gone; `parks:false` is broker.ts's unattended fast path, which answers WITHOUT
 *  ever entering the registry — so nothing was announced for it and nothing ever will be. */
function fakeSource(request?: (req: { toolUseID: string }) => Promise<unknown>, opts: { parks?: boolean } = {}) {
  const warnings: Array<Record<string, unknown>> = [];
  const parked: Array<{ toolUseID: string }> = [];
  const peer = { notify: (method: string, params: Record<string, unknown>) => void warnings.push({ method, ...params }) };
  const decisions = request && {
    broker: () => ({ request: (req: { toolUseID: string }) => { if (opts.parks !== false) parked.push({ toolUseID: req.toolUseID }); return request(req); } }),
    pending: () => parked,
  };
  const source = { threadDecisions: () => decisions, registry: { get: () => ({ subscribers: [peer] }) }, watchers: () => [] } as unknown as ElicitationParkSource;
  return { fn: makeOnElicitation(source, "th_1"), warnings };
}

afterEach(async () => { for (const s of servers.splice(0)) await s.shutdown().catch(() => {}); });

describe("MCP elicitation parks as a decision", () => {
  it("parks with kind 'elicitation' and announces decision/requested", async () => {
    const { threadId, onElicitation } = await startThread();
    void call(onElicitation);
    await settle();
    const req = parsed(lines).find((m) => m.method === "decision/requested");
    expect(req).toBeTruthy();
    expect(req!.params.threadId).toBe(threadId);
    expect(req!.params.decision.kind).toBe("elicitation");
    // …and it lists like any other parked decision, which is what makes a client that reconnects able to
    // find it at all.
    const listId = send("decision/list", { threadId });
    await settle();
    expect(replyTo(listId)!.result.data).toHaveLength(1);
  });

  it("carries serverName, message, mode and requestedSchema onto the parked entry", async () => {
    // A client cannot render a form it cannot see. `input` is the one free-form field a PendingDecision
    // has, and it is what a dialog reads.
    const { onElicitation } = await startThread();
    void call(onElicitation);
    await settle();
    const decision = parsed(lines).find((m) => m.method === "decision/requested")!.params.decision;
    expect(decision.input.serverName).toBe("vault");
    expect(decision.input.message).toBe("Enter your token");
    expect(decision.input.mode).toBe("form");
    expect(decision.input.requestedSchema).toEqual(FORM.requestedSchema);
  });

  it("keys the park off requestId, since an ElicitationRequest carries no toolUseId", async () => {
    const { threadId, onElicitation } = await startThread();
    void call(onElicitation, FORM, "req-a");
    void call(onElicitation, { ...FORM, message: "second" }, "req-b");
    await settle();
    const ids = parkedKeys();
    expect(ids.map((k) => k.split("#")[0])).toEqual(["elicit:req-a", "elicit:req-b"]); // two concurrent elicitations, two distinct parks
    const listId = send("decision/list", { threadId });
    await settle();
    expect(replyTo(listId)!.result.data).toHaveLength(2);
  });

  it("keeps the park key unique even when the CLI repeats a requestId", async () => {
    // Load-bearing, and the ONE hang the callback's own catch cannot cover: `PendingDecisions.park` stores
    // by key into a Map (permissions/pending.ts), so a second park under a key already taken replaces the
    // first resolver and that first promise never settles at all. The CLI's id format is not ours to
    // assume — the binary is extracted from bunfs at runtime — so the key does not depend on it.
    const { threadId, onElicitation } = await startThread();
    const first = call(onElicitation, FORM, "dup");
    const second = call(onElicitation, { ...FORM, message: "again" }, "dup");
    await settle();
    const keys = parkedKeys();
    expect(new Set(keys).size).toBe(2);
    for (const toolUseId of keys) send("decision/respond", { threadId, toolUseId, answer: { kind: "elicitation_decline" } });
    await settle();
    expect(await orHang(Promise.all([first, second]))).toEqual([{ action: "decline" }, { action: "decline" }]);
  });

  it("resolves the onElicitation promise with {action:'accept', content} when answered accept", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    const id = send("decision/respond", { threadId, toolUseId: parkedKeys()[0], answer: { kind: "elicitation_accept", content: { token: "t-1", save: true } } });
    await settle();
    expect(replyTo(id)!.result).toEqual({ ok: true });
    expect(await answered).toEqual({ action: "accept", content: { token: "t-1", save: true } });
  });

  it("resolves with {action:'decline'} when answered decline", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    send("decision/respond", { threadId, toolUseId: parkedKeys()[0], answer: { kind: "elicitation_decline" } });
    await settle();
    expect(await answered).toEqual({ action: "decline" });
  });

  it("answers when the TURN IS INTERRUPTED while the elicitation is still parked", async () => {
    // `signal: options.signal` is the only thing that answers the MCP server here: the park's own abort
    // listener (pending.ts) settles on it. Without that field the promise below never resolves, which is
    // the same hang a null return causes and the reason an interrupt is a first-class case, not an edge.
    const { onElicitation } = await startThread();
    const ac = new AbortController();
    const answered = call(onElicitation, FORM, "req-int", ac.signal);
    await settle();
    expect(parkedKeys()).toHaveLength(1); // it really parked first — otherwise this proves nothing
    ac.abort();
    await settle();
    expect(await orHang(answered)).toEqual({ action: "cancel" }); // the system deny, mapped (elicitationMap)
  });

  it("cannot be switched off by the client's own extraOptions", async () => {
    // The bridge is the SERVER's to install (server.ts's `buildConfig`), but the config it installs it into is
    // the CLIENT's — `extraOptions` included, and that is merged LAST into the SDK `Options`
    // (resolveOptions.ts). With `onElicitation: null` in the hatch the real engine was built with no handler
    // at all, so a stdio MCP server's elicitation reached nothing and waited out its own timeout while M4
    // reported the bridge as installed: the difference between a shipped capability and a claimed one.
    // Asserted through `resolveOptions` because that is the function the real `openSession` runs on this
    // config (session/index.ts), and it is the only place the hatch is applied.
    const { threadId, built } = await startThread({ extraOptions: { onElicitation: null, maxTurns: 3 } });
    const options = resolveOptions(built as HarnessConfig);
    expect(typeof options.onElicitation).toBe("function");
    expect(options.maxTurns).toBe(3);          // the hatch itself still works — only this key is reserved
    // And it is the real bridge, not merely a function: driving it parks a decision a client can answer.
    void call(options.onElicitation as OnElicitation);
    await settle();
    const req = parsed(lines).find((m) => m.method === "decision/requested");
    expect(req!.params.threadId).toBe(threadId);
    expect(req!.params.decision.kind).toBe("elicitation");
  });

  it("resolves with a real result — NOT null — when the thread is torn down while parked", async () => {
    // The brief's original wording said `decline`; D-M4-9 settled it as `cancel` (nobody declined anything
    // when a thread closes). What this case exists to catch is unchanged and is the whole point of the
    // wiring: a `null` here sends NO response and the MCP server hangs until it times out.
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    send("thread/close", { threadId });
    await settle();
    const result = await answered;
    expect(result).not.toBeNull();
    expect(result).toEqual({ action: "cancel" });
  });
});

describe("the callback always answers — every failure path lands on a real ElicitResult", () => {
  // Not "the mapper never returns null": a REJECTED promise anywhere in the callback body hangs the MCP
  // server exactly as a null does, and the mapper throws on an outcome that is not well-typed.
  const withBroker = (request: () => Promise<unknown>): OnElicitation => fakeSource(request).fn;

  it("answers when the park REJECTS", async () => {
    const result = await call(withBroker(() => Promise.reject(new Error("registry exploded"))));
    expect(result).toEqual({ action: "cancel" });
  });

  it("answers when the park throws synchronously", async () => {
    const result = await call(withBroker(() => { throw new Error("boom"); }));
    expect(result).toEqual({ action: "cancel" });
  });

  it("answers when the park settles with a MALFORMED outcome the mapper would throw on", async () => {
    for (const bogus of [undefined, null, {}, { kind: "not_a_kind" }]) {
      const result = await call(withBroker(async () => bogus));
      expect(result, JSON.stringify(bogus)).not.toBeNull();
      expect(["accept", "decline", "cancel"]).toContain(result!.action);
    }
  });

  it("answers when the thread has no decisions registry at all", async () => {
    // Reachable: the config outlives the record across a rewind/reopen swap, and a closed thread's registry
    // is gone. Nothing here can park, and a park that cannot happen still owes the server an answer.
    const result = await call(fakeSource().fn);
    expect(result).toEqual({ action: "cancel" });
  });
});

describe("a refusal nothing else reports gets a warning", () => {
  // An answered elicitation is normally its own record — `decision/requested` then `decision/resolved`. The
  // paths below never park, so neither event exists for them, and without this a `mode:"url"` OAuth
  // elicitation is cancelled with nothing on the wire and nothing in a log: the operator debugging "my MCP
  // server's auth never completes" has nothing at all to go on. Shape follows rewind.ts's re-push warning.
  it("warns when there is no decisions registry to park into", async () => {
    const { fn, warnings } = fakeSource();
    expect(await call(fn)).toEqual({ action: "cancel" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ method: "warning", threadId: "th_1", code: "elicitationNotParked", serverName: "vault", requestId: "req-1" });
    expect(warnings[0].message).toEqual(expect.any(String));
  });

  it("warns when the park throws", async () => {
    const { fn, warnings } = fakeSource(() => { throw new Error("boom"); });
    expect(await call(fn)).toEqual({ action: "cancel" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ method: "warning", threadId: "th_1", code: "elicitationFailed", serverName: "vault", requestId: "req-1" });
  });

  it("warns when the request is refused WITHOUT ever entering the registry", async () => {
    // broker.ts's unattended fast path returns before the park's own emit, so this refusal is otherwise
    // invisible — and an unattended thread between subscriptions is the default state, not an exotic one.
    const { fn, warnings } = fakeSource(async () => ({ kind: "deny" }), { parks: false });
    expect(await call(fn)).toEqual({ action: "cancel" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "elicitationNotParked", serverName: "vault", requestId: "req-1" });
  });

  it("stays SILENT on a park that really parked — the decision events already tell that story", async () => {
    const { fn, warnings } = fakeSource(async () => ({ kind: "elicitation_decline" }));
    expect(await call(fn)).toEqual({ action: "decline" });
    expect(warnings).toEqual([]);
  });

  it("reaches a watcher on the real server, on the real unattended-deny path, with nobody subscribed", async () => {
    // The end-to-end shape of the case above: `unattended:"deny"` with zero subscribers denies before
    // parking (broker.ts), so no `decision/requested` is ever announced — the warning is the only frame.
    const f = factory();
    const srv = new AppServer({}, f);
    servers.push(srv);
    const s = mkSink();
    conn = srv.connect(s.sink);
    lines = s.lines;
    conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } }) + "\n");
    const startId = send("thread/start", { unattended: "deny" });
    await settle();
    const threadId = replyTo(startId)!.result.thread.id as string;
    lines.length = 0;
    const result = await call(f.built.at(-1)!.onElicitation as OnElicitation);
    await settle();
    expect(result).toEqual({ action: "cancel" });
    expect(parkedKeys()).toEqual([]);
    const warned = parsed(lines).find((m) => m.method === "warning");
    expect(warned!.params).toMatchObject({ threadId, code: "elicitationNotParked", serverName: "vault", requestId: "req-1" });
  });
});

describe("content validation — an accept the MCP server would reject is worse than a clean refusal", () => {
  // The mapper cannot see the REQUEST, so this can only live here. A well-formed `{action:"accept"}` whose
  // content does not satisfy `requestedSchema` looks like success and fails at the server.
  const acceptWith = (content: unknown, request: Record<string, unknown> = FORM) =>
    call(fakeSource(async () => ({ kind: "elicitation_accept", ...(content === undefined ? {} : { content }) })).fn, request);

  it("declines an accept that omits a required field", async () => {
    expect(await acceptWith({ save: true })).toEqual({ action: "decline" });
  });

  it("declines an accept carrying no content at all against a schema that requires one", async () => {
    expect(await acceptWith(undefined)).toEqual({ action: "decline" });
  });

  it("declines an accept whose value has the wrong type", async () => {
    expect(await acceptWith({ token: 42 })).toEqual({ action: "decline" });
    expect(await acceptWith({ token: "t", save: "yes" })).toEqual({ action: "decline" });
  });

  // MCP's restricted subset spells an enum FOUR ways, and every one of them has to be checked — a value
  // outside a titled enum's consts is still a string, and a multi-select answer carrying an out-of-set item
  // is still an array, so a shape that goes unchecked produces exactly the well-formed `{action:"accept"}`
  // the server then rejects. Each schema below is transcribed from the SDK's own declarations
  // (@modelcontextprotocol/sdk types.d.ts: Untitled/Titled SingleSelect, LegacyTitled, Untitled/Titled
  // MultiSelect), not from what an enum is assumed to look like.
  const withProperty = (property: Record<string, unknown>, key = "pick") =>
    ({ ...FORM, requestedSchema: { type: "object", properties: { [key]: property }, required: [key] } });

  it("declines a value outside an UNTITLED single-select enum", async () => {
    const req = withProperty({ type: "string", enum: ["a", "b"] });
    expect(await acceptWith({ pick: "c" }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ pick: "b" }, req)).toEqual({ action: "accept", content: { pick: "b" } });
  });

  it("declines a value outside a LEGACY titled enum (enum + enumNames)", async () => {
    const req = withProperty({ type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Bravo"] });
    expect(await acceptWith({ pick: "c" }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ pick: "a" }, req)).toEqual({ action: "accept", content: { pick: "a" } });
  });

  it("declines a value outside a TITLED single-select enum, which declares no `enum` key at all", async () => {
    // `{type:"string", oneOf:[{const,title}]}` — the option set lives in `oneOf`, and the value is a plain
    // string either way, so a check that only reads `enum` passes everything here.
    const req = withProperty({ type: "string", oneOf: [{ const: "a", title: "Alpha" }, { const: "b", title: "Bravo" }] });
    expect(await acceptWith({ pick: "c" }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ pick: "b" }, req)).toEqual({ action: "accept", content: { pick: "b" } });
  });

  it("declines an out-of-set item in an UNTITLED multi-select (items.enum)", async () => {
    const req = withProperty({ type: "array", items: { type: "string", enum: ["read", "write"] } }, "scopes");
    expect(await acceptWith({ scopes: ["read", "admin"] }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ scopes: ["read", "write"] }, req)).toEqual({ action: "accept", content: { scopes: ["read", "write"] } });
    expect(await acceptWith({ scopes: [] }, req)).toEqual({ action: "accept", content: { scopes: [] } }); // minItems is not ours to enforce
  });

  it("declines an out-of-set item in a TITLED multi-select (items.anyOf[].const)", async () => {
    const req = withProperty({ type: "array", items: { anyOf: [{ const: "read", title: "Read" }, { const: "write", title: "Write" }] } }, "scopes");
    expect(await acceptWith({ scopes: ["admin"] }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ scopes: ["write"] }, req)).toEqual({ action: "accept", content: { scopes: ["write"] } });
  });

  it("leaves the bounds it does not check alone rather than guessing at them", async () => {
    // The scope line, pinned: numeric/length/format/item-count bounds belong to the server's own validator.
    // Declining here on a bound we merely half-implement refuses answers that server would have taken.
    const req = withProperty({ type: "number", minimum: 1, maximum: 10 }, "count");
    expect(await acceptWith({ count: 99 }, req)).toEqual({ action: "accept", content: { count: 99 } });
    const short = withProperty({ type: "string", minLength: 8, format: "email" }, "who");
    expect(await acceptWith({ who: "x" }, short)).toEqual({ action: "accept", content: { who: "x" } });
  });

  it("accepts content that satisfies the schema, and passes it through verbatim", async () => {
    expect(await acceptWith({ token: "t-1", save: false })).toEqual({ action: "accept", content: { token: "t-1", save: false } });
  });

  it("accepts an undeclared extra key, but not when the schema closes itself", async () => {
    // JSON Schema allows extras by default — refusing them here would decline answers real servers accept.
    expect(await acceptWith({ token: "t", extra: "x" })).toEqual({ action: "accept", content: { token: "t", extra: "x" } });
    const closed = { ...FORM, requestedSchema: { ...FORM.requestedSchema, additionalProperties: false } };
    expect(await acceptWith({ token: "t", extra: "x" }, closed)).toEqual({ action: "decline" });
  });

  it("leaves a url-mode accept alone — there is no form to fill in", async () => {
    const url = { serverName: "vault", message: "Authorize in your browser", mode: "url", url: "https://example.test/auth" };
    expect(await acceptWith(undefined, url)).toEqual({ action: "accept" });
  });

  it("accepts anything when the request declared no schema", async () => {
    const bare = { serverName: "vault", message: "Anything?" };
    expect(await acceptWith({ whatever: "sure" }, bare)).toEqual({ action: "accept", content: { whatever: "sure" } });
  });

  it("validates only accepts — a refusal has no content to check", async () => {
    const declined = fakeSource(async () => ({ kind: "elicitation_decline" })).fn;
    expect(await call(declined)).toEqual({ action: "decline" });
  });
});

describe("the wire and the MCP server agree about what was answered", () => {
  // The check above is a BACKSTOP, and on its own it produced a contradiction: `decision/respond` had already
  // replied {ok:true} and broadcast `decision/resolved {elicitation_accept}` by the time the callback
  // downgraded the result to `decline`, so every client and every audit log recorded an acceptance that never
  // reached the MCP server. The fix validates against THIS request before the decision settles — the answer is
  // refused, nothing is announced, and the park stands so the client can correct itself. Nothing is lost by
  // waiting: the MCP server was already blocked on this park and stays exactly as blocked.
  it("refuses an accept the request's schema rejects, and announces nothing", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    const toolUseId = parkedKeys()[0];
    lines.length = 0;
    const bad = send("decision/respond", { threadId, toolUseId, answer: { kind: "elicitation_accept", content: { save: true } } });
    await settle();
    expect(replyTo(bad)!.error.code).toBe(ERR.INVALID_PARAMS);
    expect(String(replyTo(bad)!.error.message)).toMatch(/requestedSchema|content/i);
    expect(parsed(lines).filter((m) => m.method === "decision/resolved")).toEqual([]);
    // The MCP server is still waiting — which is where it already was, and the only honest state until an
    // answer it can actually use arrives.
    expect(await orHang(answered)).toBe("HUNG");
  });

  it("leaves the park answerable, so the corrected answer settles it exactly once", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    const toolUseId = parkedKeys()[0];
    send("decision/respond", { threadId, toolUseId, answer: { kind: "elicitation_accept", content: { save: true } } });
    await settle();
    const listId = send("decision/list", { threadId });
    await settle();
    expect(replyTo(listId)!.result.data).toHaveLength(1);   // still parked, not consumed by the refusal
    lines.length = 0;
    const good = send("decision/respond", { threadId, toolUseId, answer: { kind: "elicitation_accept", content: { token: "t-1" } } });
    await settle();
    expect(replyTo(good)!.result).toEqual({ ok: true });
    expect(await answered).toEqual({ action: "accept", content: { token: "t-1" } });
    const resolved = parsed(lines).filter((m) => m.method === "decision/resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].params.answer.kind).toBe("elicitation_accept");
  });

  it("does not stand in the way of a refusal, or of an accept the schema takes", async () => {
    // The check is scoped to the one answer that carries content against a schema. A decline has none, and a
    // valid accept must not acquire a new way to fail.
    const a = await startThread();
    const declined = call(a.onElicitation);
    await settle();
    const declineId = send("decision/respond", { threadId: a.threadId, toolUseId: parkedKeys()[0], answer: { kind: "elicitation_decline" } });
    await settle();
    expect(replyTo(declineId)!.result).toEqual({ ok: true });
    expect(await declined).toEqual({ action: "decline" });
    const b = await startThread();
    const accepted = call(b.onElicitation);
    await settle();
    const acceptId = send("decision/respond", { threadId: b.threadId, toolUseId: parkedKeys()[0], answer: { kind: "elicitation_accept", content: { token: "t", save: false } } });
    await settle();
    expect(replyTo(acceptId)!.result).toEqual({ ok: true });
    expect(await accepted).toEqual({ action: "accept", content: { token: "t", save: false } });
  });

  it("holds a NON-elicitation decision to its own rules — this check is not a second kind gate", async () => {
    // `input` is the one FREE-FORM field a PendingDecision carries, so another kind of park can perfectly well
    // hold something shaped like a `requestedSchema` — a question's own rendering hints, say. Read there, this
    // check would answer for a decision it has no business judging and would report a content error where the
    // kind gate owns the answer. Parked through the real broker rather than through the elicitation bridge,
    // because that bridge is the one thing that cannot produce this case.
    const { srv, threadId } = await startThread();
    void srv.threadDecisions(threadId)!.broker(threadId).request({
      toolName: "AskUserQuestion", kind: "question", toolUseID: "toolu_q",
      input: { requestedSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    } as never);
    await settle();
    const id = send("decision/respond", { threadId, toolUseId: "toolu_q", answer: { kind: "elicitation_accept", content: {} } });
    await settle();
    expect(replyTo(id)!.error.code).toBe(ERR.INVALID_PARAMS);
    expect(String(replyTo(id)!.error.message)).toMatch(/kind/i);   // the kind gate's own words, not the new check's
  });
});
