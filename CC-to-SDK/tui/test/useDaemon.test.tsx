import { describe, it, expect } from "vitest";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useDaemon, type DaemonView, type UseDaemonOpts } from "../src/useDaemon.js";
import type { DaemonClient, ListEntry } from "cc-harness";

const flush = () => new Promise((r) => setTimeout(r, 5));

// a manual scheduler: capture the tick fn, count cancels (idempotent-teardown teeth)
function manualSchedule() {
  let fn: (() => void) | null = null;
  const cancels: number[] = [];
  const schedule = (f: () => void) => { fn = f; return () => { cancels.push(1); }; };
  return { schedule, tick: () => fn?.(), cancels };
}

function fakeClient(over: Partial<DaemonClient> = {}): DaemonClient & { calls: any } {
  const calls: any = { submit: [], control: [], stop: [], spawn: 0 };
  const base: DaemonClient = {
    async list() { return [{ id: "sess-1", daemonPid: 1, status: "idle", model: "m", createdAt: 0, lastActiveAt: 0 } as ListEntry]; },
    async contextUsage() { return { totalTokens: 20, maxTokens: 100 }; },
    async submit(id, prompt, onChunk) { calls.submit.push([id, prompt]); onChunk({ type: "assistant", message: { content: [{ type: "text", text: "yo" }] } }); return { result: "ok" }; },
    async control(id, frame) { calls.control.push([id, frame]); return { ok: true, models: ["a", "b"] }; },
    async compact() { return { compacted: true } as any; },
    async spawn() { calls.spawn++; return "new-id"; },
    async stop(id) { calls.stop.push(id); },
    async fork() { return { id: "fk", sessionId: "sid" }; },
    async startProactive() { return { state: "running", tickCount: 0, idleCount: 0, errorCount: 0 }; },
    async stopProactive() {},
  };
  return Object.assign({ ...base, ...over }, { calls });
}

let view: DaemonView;
function Probe({ client, opts }: { client: DaemonClient; opts: UseDaemonOpts }) {
  view = useDaemon(client, opts);
  return <Text>{view.snapshot.sessions.length}|{view.focus}|{view.status}|{view.stream.length}</Text>;
}

describe("useDaemon", () => {
  it("polls collect() on mount and exposes the session pool", async () => {
    const sched = manualSchedule();
    const { lastFrame } = render(<Probe client={fakeClient()} opts={{ schedule: sched.schedule, now: () => 0 }} />);
    await flush();
    expect(lastFrame()).toContain("1|list");
    expect(view.selected?.id).toBe("sess-1");
    expect(view.selected?.ctxPercent).toBe(20);
  });

  it("submit() accumulates streamed chunks", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.submit("hello");
    await flush();
    expect(c.calls.submit).toEqual([["sess-1", "hello"]]);
    expect(view.stream.length).toBe(1);
  });

  it("control ops route to the selected session and surface status", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.interrupt(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "interrupt" }]);
    view.cyclePermissionMode(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_permission_mode", mode: "acceptEdits" }]);
  });

  it("cycleModel() fetches the model list once then advances set_model", async () => {
    const c = fakeClient();
    render(<Probe client={c} opts={{ schedule: manualSchedule().schedule, now: () => 0 }} />);
    await flush();
    view.cycleModel(); await flush();
    expect(c.calls.control).toContainEqual(["sess-1", { type: "initialize" }]);
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "a" }]);
    view.cycleModel(); await flush();
    expect(c.calls.control.at(-1)).toEqual(["sess-1", { type: "set_model", model: "b" }]);
  });

  it("teardown() cancels the poll exactly once (idempotent)", async () => {
    const sched = manualSchedule();
    render(<Probe client={fakeClient()} opts={{ schedule: sched.schedule, now: () => 0 }} />);
    await flush();
    view.teardown();
    view.teardown();
    expect(sched.cancels.length).toBe(1);
  });
});
