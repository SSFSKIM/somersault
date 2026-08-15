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
import { makeOnElicitation } from "../../../src/appserver/elicitation.js";
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
async function startThread(): Promise<{ threadId: string; onElicitation: OnElicitation }> {
  const f = factory();
  const srv = new AppServer({}, f);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  lines = s.lines;
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  const startId = send("thread/start", {});
  await settle();
  const threadId = replyTo(startId)!.result.thread.id as string;
  send("thread/subscribe", { threadId });
  await settle();
  lines.length = 0;
  return { threadId, onElicitation: f.built.at(-1)!.onElicitation as OnElicitation };
}

const FORM = {
  serverName: "vault", message: "Enter your token", mode: "form" as const,
  requestedSchema: { type: "object", properties: { token: { type: "string" }, save: { type: "boolean" } }, required: ["token"] },
};
const call = (fn: OnElicitation, request: Record<string, unknown> = FORM, requestId = "req-1") =>
  fn(request as never, { signal: new AbortController().signal, requestId });

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
    const ids = parsed(lines).filter((m) => m.method === "decision/requested").map((m) => m.params.decision.toolUseId);
    expect(ids).toEqual(["elicit:req-a", "elicit:req-b"]); // two concurrent elicitations, two distinct parks
    const listId = send("decision/list", { threadId });
    await settle();
    expect(replyTo(listId)!.result.data).toHaveLength(2);
  });

  it("resolves the onElicitation promise with {action:'accept', content} when answered accept", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    const id = send("decision/respond", { threadId, toolUseId: "elicit:req-1", answer: { kind: "elicitation_accept", content: { token: "t-1", save: true } } });
    await settle();
    expect(replyTo(id)!.result).toEqual({ ok: true });
    expect(await answered).toEqual({ action: "accept", content: { token: "t-1", save: true } });
  });

  it("resolves with {action:'decline'} when answered decline", async () => {
    const { threadId, onElicitation } = await startThread();
    const answered = call(onElicitation);
    await settle();
    send("decision/respond", { threadId, toolUseId: "elicit:req-1", answer: { kind: "elicitation_decline" } });
    await settle();
    expect(await answered).toEqual({ action: "decline" });
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
  const withBroker = (request: () => Promise<unknown>): OnElicitation =>
    makeOnElicitation({ threadDecisions: () => ({ broker: () => ({ request }) }) } as never, "th_1");

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
    const result = await call(makeOnElicitation({ threadDecisions: () => undefined }, "th_gone"));
    expect(result).toEqual({ action: "cancel" });
  });
});

describe("content validation — an accept the MCP server would reject is worse than a clean refusal", () => {
  // The mapper cannot see the REQUEST, so this can only live here. A well-formed `{action:"accept"}` whose
  // content does not satisfy `requestedSchema` looks like success and fails at the server.
  const acceptWith = (content: unknown, request: Record<string, unknown> = FORM) =>
    call(makeOnElicitation({ threadDecisions: () => ({ broker: () => ({ request: async () => ({ kind: "elicitation_accept", ...(content === undefined ? {} : { content }) }) }) }) } as never, "th_1"), request);

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

  it("declines a value outside a declared enum", async () => {
    const req = { ...FORM, requestedSchema: { type: "object", properties: { pick: { type: "string", enum: ["a", "b"] } }, required: ["pick"] } };
    expect(await acceptWith({ pick: "c" }, req)).toEqual({ action: "decline" });
    expect(await acceptWith({ pick: "b" }, req)).toEqual({ action: "accept", content: { pick: "b" } });
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
    const declined = makeOnElicitation({ threadDecisions: () => ({ broker: () => ({ request: async () => ({ kind: "elicitation_decline" }) }) }) } as never, "th_1");
    expect(await call(declined)).toEqual({ action: "decline" });
  });
});
