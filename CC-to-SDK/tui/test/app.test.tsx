import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";
import type { DaemonClient, ListEntry } from "cc-harness";

const noopSchedule = () => () => {};
const frame = (lastFrame: () => string | undefined) => lastFrame() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}
// Re-press an IDEMPOTENT key each tick until the outcome holds (covers the just-mounted-useInput subscription window).
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    stdin.write(key);
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}): condition not met in time`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

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
    await waitFor(() => frame(lastFrame).includes("sess-xyz"));
    expect(lastFrame()).toContain("sess-xyz");
    expect(lastFrame()).toContain("daemon up");
  });

  it("Enter opens the composer; Esc returns to the list", async () => {
    const { stdin, lastFrame } = render(<App client={fakeClient()} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await waitFor(() => frame(lastFrame).includes("sess-xyz"));     // pool live → list useInput subscribed
    await pressUntil(stdin, "\r", () => frame(lastFrame).includes("›"));  // Enter → composer ('›')
    expect(lastFrame()).toContain("›");
    await pressUntil(stdin, "", () => !frame(lastFrame).includes("›")); // Esc → back to list
    expect(lastFrame()).not.toContain("›");
  });

  it("'x' opens the confirm dialog and 'y' calls stop()", async () => {
    const c = fakeClient();
    const { stdin, lastFrame } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    await waitFor(() => frame(lastFrame).includes("sess-xyz"));     // ensures d.selected is set before 'x'
    await pressUntil(stdin, "x", () => frame(lastFrame).includes("Stop session sess-xyz?"));
    expect(lastFrame()).toContain("Stop session sess-xyz?");
    await pressUntil(stdin, "y", () => c.calls.stop.length > 0);
    expect(c.calls.stop).toEqual(["sess-xyz"]);
  });

  it("'n' spawns a new session", async () => {
    const c = fakeClient();
    const { stdin, lastFrame } = render(<App client={c} hookOpts={{ schedule: noopSchedule, now: () => 0 }} />);
    // Wait for pool-populated render: guarantees list useInput is subscribed before the single 'n' press.
    await waitFor(() => frame(lastFrame).includes("sess-xyz"));
    stdin.write("n");
    await waitFor(() => c.calls.spawn === 1);
    expect(c.calls.spawn).toBe(1);
  });
});
