import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { rewindSession } from "../../src/session/index.js";

// one turn per prompt; interleaves the given extra frames before each result
function framesQuery(extra: (turn: number) => any[]) {
  return ({ prompt }: any) => (async function* () {
    let i = 0;
    for await (const t of prompt) {
      for (const f of extra(i)) yield f;
      i++;
      yield { type: "result", subtype: "success", result: "did:" + t.message.content };
    }
  })();
}
// generator-object carrying the Wave-1 Query control methods
function methodQuery(rec: any) {
  return ({ prompt }: any) => {
    const it: any = (async function* () { for await (const t of prompt) yield { type: "result", subtype: "success", result: "did:" + t.message.content }; })();
    it.reinitialize = async () => ({ commands: ["c"], pid: 42 });
    it.stopTask = async (id: string) => { rec.stopped = id; };
    it.backgroundTasks = async (toolUseId?: string) => { rec.backgrounded = toolUseId ?? "(all)"; return true; };
    it.interrupt = async () => ({ still_queued: ["u1"] });
    return it;
  };
}

describe("Session background-task visibility (W1.4)", () => {
  it("REPLACES the set on each background_tasks_changed (level semantics), including to empty", async () => {
    const sets = [
      [{ task_id: "a", task_type: "local_bash", description: "loop" }],
      [], // task stopped → level goes empty; a merge would wrongly keep "a"
    ];
    const s = new Session({ query: framesQuery((i) => [{ type: "system", subtype: "background_tasks_changed", tasks: sets[i] }]) }, {});
    expect(s.backgroundTasks).toEqual([]);            // nothing before the first signal
    await s.submit("one");
    expect(s.backgroundTasks).toEqual(sets[0]);
    await s.submit("two");
    expect(s.backgroundTasks).toEqual([]);
    expect(await s.listBackgroundTasks()).toEqual([]);
    await s.dispose();
  });
  it("delegates stopTask/backgroundAll to the query methods", async () => {
    const rec: any = {};
    const s = new Session({ query: methodQuery(rec) }, {});
    await s.stopTask("t-9");
    expect(rec.stopped).toBe("t-9");
    expect(await s.backgroundAll()).toBe(true);
    expect(rec.backgrounded).toBe("(all)");
    await s.backgroundAll("toolu_1");
    expect(rec.backgrounded).toBe("toolu_1");
    await s.dispose();
  });
});

describe("Session limit tracking (W1.3)", () => {
  it("sets limitState from a limited result and CLEARS it on the next clean result", async () => {
    const results = ["You've hit your usage limit", "all good"];
    let i = 0;
    const q = ({ prompt }: any) => (async function* () {
      for await (const _t of prompt) yield { type: "result", subtype: "success", result: results[i++] };
    })();
    const s = new Session({ query: q }, {});
    await s.submit("x");
    expect(s.limitState?.kind).toBe("usage-limit");
    await s.submit("y");
    expect(s.limitState).toBeUndefined();
    await s.dispose();
  });
  it("a rejected rate_limit_event after the result sets rate-limit; a later allowed one clears it", async () => {
    const q = ({ prompt }: any) => (async function* () {
      let i = 0;
      for await (const _t of prompt) {
        yield { type: "result", subtype: "success", result: "ok" };
        yield { type: "rate_limit_event", rate_limit_info: { status: i === 0 ? "rejected" : "allowed", rateLimitType: "five_hour" } };
        i++;
      }
    })();
    const s = new Session({ query: q }, {});
    await s.submit("one");
    await new Promise((r) => setImmediate(r));
    expect(s.limitState?.kind).toBe("rate-limit");
    await s.submit("two");
    await new Promise((r) => setImmediate(r));
    expect(s.limitState).toBeUndefined();
    await s.dispose();
  });
  it("an allowed rate event does not clear an org-policy state", async () => {
    const q = ({ prompt }: any) => (async function* () {
      for await (const _t of prompt) {
        yield { type: "result", subtype: "success", result: "This service is disabled for your org" };
        yield { type: "rate_limit_event", rate_limit_info: { status: "allowed" } };
      }
    })();
    const s = new Session({ query: q }, {});
    await s.submit("x");
    await new Promise((r) => setImmediate(r)); // let the post-result event frame drain
    expect(s.limitState?.kind).toBe("org-policy");
    await s.dispose();
  });
});

describe("Session reinitialize + interrupt receipt (W1.2)", () => {
  it("reinitialize returns the fresh init payload; interrupt returns the receipt", async () => {
    const s = new Session({ query: methodQuery({}) }, {});
    expect(await s.reinitialize()).toEqual({ commands: ["c"], pid: 42 });
    expect(await s.interrupt()).toEqual({ still_queued: ["u1"] });
    await s.dispose();
  });
  it("reports unsupported when the query lacks the methods", async () => {
    const bare = ({ prompt }: any) => (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
    const s = new Session({ query: bare }, {});
    await expect(s.reinitialize()).rejects.toThrow("unsupported: reinitialize");
    await expect(s.stopTask("t")).rejects.toThrow("unsupported: stopTask");
    await s.dispose();
  });
});

describe("rewindSession (W1.1)", () => {
  it("passes resume + resumeSessionAt (in-place, no forkSession)", () => {
    const sink: any[] = [];
    const capture = ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
    const s = rewindSession("sid-1", "uuid-9", {}, { query: capture });
    expect(sink[0].resume).toBe("sid-1");
    expect(sink[0].resumeSessionAt).toBe("uuid-9");
    expect(sink[0].forkSession).toBeUndefined();
    void s.dispose();
  });
  it("fork: true adds forkSession (non-destructive branch) and never leaks `fork` into options", () => {
    const sink: any[] = [];
    const capture = ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const _t of prompt) yield { type: "result", result: "ok" }; })(); };
    const s = rewindSession("sid-1", "uuid-9", { fork: true }, { query: capture });
    expect(sink[0].forkSession).toBe(true);
    expect(sink[0].fork).toBeUndefined();
    void s.dispose();
  });
});
