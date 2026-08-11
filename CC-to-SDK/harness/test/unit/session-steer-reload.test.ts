// test/unit/session-steer-reload.test.ts — M2b Task 5's lib seams, promoted from live probes 103b/105.
//
// `steer` is the interesting one, and the whole point of it having its own seam is what it must NOT do:
// `enqueueTurn` pairs every push with a result waiter, and a uuid-less result is handed to the waiter at
// the HEAD of that queue, so a waiter-less injection registered as a turn would desync it. The second test
// below is written so that a `steer` implemented via `enqueueTurn` FAILS deterministically — the real
// turn's promise never settles — rather than only leaking a stray rejection at dispose.
//
// Engine-faithful fake: the query is a push-driven AsyncQueue (exactly the shape session.ts's own read
// loop consumes), and a separate consumer drains the PROMPT stream so every pushed SDKUserMessage is
// observable in order — the input queue is the seam `steer` writes to, so the fake has to be faithful
// there, not only on the frame side. Closing the prompt stream closes the frame stream, which is what
// `dispose()` does on the real session.
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Rig {
  pushes: any[];
  emit(frame: unknown): void;
  query: (args: any) => AsyncIterable<unknown>;
}

/** `extra` hangs Query control methods off the returned iterable, the way session.ts's callQ/callQValue
 *  reach them (`(this.q as any)[name]`) — mirrors session-wave1.test.ts's methodQuery. */
function rig(extra: Record<string, unknown> = {}): Rig {
  const pushes: any[] = [];
  const out = new AsyncQueue<unknown>();
  const q = Object.assign(out, extra);
  return {
    pushes,
    emit: (frame) => out.push(frame),
    query: ({ prompt }: any) => {
      void (async () => { for await (const m of prompt) pushes.push(m); out.close(); })();
      return q as unknown as AsyncIterable<unknown>;
    },
  };
}

const result = (uuid: string | undefined, text: string, origin?: string) => ({
  type: "result", subtype: "success", ...(uuid ? { user_message_uuid: uuid } : {}), ...(origin ? { origin: { kind: origin } } : {}), result: text,
});

describe("Session.steer (probe 103b ALIVE)", () => {
  it("pushes a user message onto the LIVE prompt stream, shaped exactly like submit's", async () => {
    const r = rig();
    const s = new Session({ query: r.query }, {});
    const turn = s.submit("count to 30");
    s.steer("stop counting");
    await tick();

    expect(r.pushes.map((m) => m.message.content)).toEqual(["count to 30", "stop counting"]);
    expect(r.pushes[1]).toMatchObject({ type: "user", message: { role: "user", content: "stop counting" }, parent_tool_use_id: null, origin: { kind: "human" } });
    // Its own uuid, like every other pushed prompt — the SDK persists exactly what it is given (probe 70).
    expect(typeof r.pushes[1].uuid).toBe("string");
    expect(r.pushes[1].uuid).not.toBe(r.pushes[0].uuid);

    r.emit(result(r.pushes[0].uuid, "steered"));
    await expect(turn).resolves.toMatchObject({ result: "steered" });
    await s.dispose();
  });

  // Bounded: the failure mode a steer-with-waiter produces is a promise that never settles, and the
  // default 120s timeout turns one sabotage run into a two-minute wait.
  it("adds NO result waiter: a later turn's uuid-less result settles THAT turn, not the steer", { timeout: 5000 }, async () => {
    const r = rig();
    const s = new Session({ query: r.query }, {});
    const first = s.submit("A");
    s.steer("mid-A nudge");
    await tick();
    r.emit(result(r.pushes[0].uuid, "A done"));
    await expect(first).resolves.toMatchObject({ result: "A done" });

    const second = s.submit("C");
    await tick();
    // Uuid-less: fifoWaiter takes the HEAD waiter. A steer-waiter left in the queue is that head, so the
    // real turn would never settle.
    r.emit(result(undefined, "C done", "human"));
    await expect(second).resolves.toMatchObject({ result: "C done" });
    await s.dispose();
  });

  it("counts an unmatched result instead of dropping it silently — the steer-correlation bad case leaves a trace", async () => {
    // `resultWaiter` scores a present-but-unknown uuid as "no waiter" (uuid-bearing results are turn-owned
    // by design), so if a steered turn's result ever came back correlated to the STEER's uuid the real turn
    // would hang. The frame is still skipped — the counter is a diagnostic, not a second correlation path.
    const r = rig();
    const s = new Session({ query: r.query }, {});
    const turn = s.submit("count to 30");
    s.steer("stop counting");
    await tick();
    expect(s.unmatchedResults).toBe(0);

    r.emit(result(r.pushes[1].uuid, "steered", "human")); // the steer's own uuid — matches no waiter
    await tick();
    expect(s.unmatchedResults).toBe(1);

    // Skipped, not consumed: the turn's own result still settles it, unchanged.
    r.emit(result(r.pushes[0].uuid, "counted"));
    await expect(turn).resolves.toMatchObject({ result: "counted" });
    expect(s.unmatchedResults).toBe(1);
    await s.dispose();
  });

  it("throws once the query has ended, like every other control seam", async () => {
    const r = rig();
    const s = new Session({ query: r.query }, {}, { label: "sess" });
    await s.dispose();
    expect(() => s.steer("too late")).toThrow(/sess is not running/);
  });
});

describe("Session.reloadPlugins / reloadSkills (probe 105 ALIVE)", () => {
  it("delegate to the Query methods and return the engine's receipt verbatim", async () => {
    const calls: string[] = [];
    const r = rig({
      reloadPlugins: async () => { calls.push("plugins"); return { commands: ["c"], agents: [], plugins: ["p"], mcpServers: [] }; },
      reloadSkills: async () => { calls.push("skills"); return { skills: ["s"] }; },
    });
    const s = new Session({ query: r.query }, {});

    expect(await s.reloadPlugins()).toEqual({ commands: ["c"], agents: [], plugins: ["p"], mcpServers: [] });
    expect(await s.reloadSkills()).toEqual({ skills: ["s"] });
    expect(calls).toEqual(["plugins", "skills"]);
    await s.dispose();
  });

  it("reject with callQ's unsupported message when the engine build lacks the method", async () => {
    const r = rig();
    const s = new Session({ query: r.query }, {});
    await expect(s.reloadPlugins()).rejects.toThrow("unsupported: reloadPlugins");
    await expect(s.reloadSkills()).rejects.toThrow("unsupported: reloadSkills");
    await s.dispose();
  });

  it("throw once the query has ended", async () => {
    const r = rig({ reloadPlugins: async () => ({}), reloadSkills: async () => ({}) });
    const s = new Session({ query: r.query }, {}, { label: "sess" });
    await s.dispose();
    await expect(s.reloadPlugins()).rejects.toThrow(/sess is not running/);
    await expect(s.reloadSkills()).rejects.toThrow(/sess is not running/);
  });
});
