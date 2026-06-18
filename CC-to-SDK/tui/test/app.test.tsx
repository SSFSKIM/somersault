import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";
import type { DaemonClient, ListEntry } from "cc-harness";

const flush = () => new Promise((r) => setTimeout(r, 10));
const noopSchedule = () => () => {};

function fakeClient() {
  const calls: any = { stop: [], spawn: 0, submit: [], control: [] };
  const c: DaemonClient = {
    async list() { return [{ id: "sess-xyz", daemonPid: 1, status: "idle", model: "m", createdAt: 0, lastActiveAt: 0 } as ListEntry]; },
    async contextUsage() { return { totalTokens: 10, maxTokens: 100 }; },
    async submit(id, p, onChunk) { calls.submit.push([id, p]); onChunk({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }); return { result: "ok" }; },
    async control(id, f) { calls.control.push([id, f]); return { ok: true, models: ["a"] }; },
    async compact() { return {} as any; },
    async spawn() { calls.spawn++; return "id2"; },
    async stop(id) { calls.stop.push(id); },
    async fork() { return { id: "fk" }; },
    async startProactive() { return { state: "running", tickCount: 0, idleCount: 0, errorCount: 0 }; },
    async stopProactive() {},
  };
  return Object.assign(c, { calls });
}

describe("<App>", () => {
  it("renders the pool after the first poll", async () => {
    const { lastFrame } = render(<App client={fakeClient()} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    expect(lastFrame()).toContain("sess-xyz");
    expect(lastFrame()).toContain("daemon up");
  });

  it("Enter opens the composer; Esc returns to the list", async () => {
    const { stdin, lastFrame } = render(<App client={fakeClient()} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("\r");          // Enter → input focus
    await flush();
    expect(lastFrame()).toContain("›");        // composer prompt visible
    stdin.write("");      // Esc → list focus
    await flush();
    expect(lastFrame()).not.toContain("›");
  });

  it("'x' opens the confirm dialog and 'y' calls stop()", async () => {
    const c = fakeClient();
    const { stdin, lastFrame } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("x");
    await flush();
    expect(lastFrame()).toContain("Stop session sess-xyz?");
    stdin.write("y");
    await flush();
    expect(c.calls.stop).toEqual(["sess-xyz"]);
  });

  it("'n' spawns a new session", async () => {
    const c = fakeClient();
    const { stdin } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await flush();
    stdin.write("n");
    await flush();
    expect(c.calls.spawn).toBe(1);
  });
});
