import { describe, it, expect } from "vitest";
import { ControlBridge } from "../../src/bridge/control.js";
import { controlFrame } from "../../src/bridge/types.js";
import type { ControllableSession } from "../../src/bridge/types.js";

function fakeSession(calls: any[], overrides: Partial<ControllableSession> = {}): ControllableSession {
  return {
    setModel: async (m) => { calls.push(["setModel", m]); },
    setPermissionMode: async (mode) => { calls.push(["setPermissionMode", mode]); },
    setMaxThinkingTokens: async (n) => { calls.push(["setMaxThinkingTokens", n]); },
    interrupt: async () => { calls.push(["interrupt"]); },
    capabilities: async () => ({ models: [{ value: "m1" }], commands: [{ name: "help" }], mcpServers: [] }),
    ...overrides,
  };
}

describe("ControlBridge", () => {
  it("routes each frame to the matching method with the right args", async () => {
    const calls: any[] = [];
    const s = fakeSession(calls);
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "set_permission_mode", mode: "plan" })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "set_thinking", maxTokens: 0 })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "interrupt" })).toEqual({ ok: true });
    expect(calls).toEqual([["setModel", "x"], ["setPermissionMode", "plan"], ["setMaxThinkingTokens", 0], ["interrupt"]]);
  });
  it("initialize returns the capabilities payload", async () => {
    const r = await ControlBridge.apply(fakeSession([]), { type: "initialize" });
    expect(r).toMatchObject({ ok: true, models: [{ value: "m1" }], commands: [{ name: "help" }], mcpServers: [] });
  });
  it("reports unsupported for a missing method (never throws)", async () => {
    const s = fakeSession([], { setModel: undefined });
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: false, error: "unsupported: setModel" });
  });
  it("converts a throwing method into a structured error", async () => {
    const s = fakeSession([], { setModel: async () => { throw new Error("bad model"); } });
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: false, error: "bad model" });
  });
  it("initialize converts a throwing capabilities() into a structured error", async () => {
    const s = fakeSession([], { capabilities: async () => { throw new Error("cap boom"); } });
    expect(await ControlBridge.apply(s, { type: "initialize" })).toEqual({ ok: false, error: "cap boom" });
  });
  it("controlFrame rejects an unknown frame type and accepts valid ones", () => {
    expect(controlFrame.safeParse({ type: "nope" }).success).toBe(false);
    expect(controlFrame.safeParse({ type: "set_model", model: "x" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "set_permission_mode", mode: "bogus" }).success).toBe(false);
    expect(controlFrame.safeParse({ type: "context_usage" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "account_info" }).success).toBe(true);
  });
  it("normalizes a non-Error rejection to a string", async () => {
    const s = fakeSession([], { setModel: async () => { throw "boom-string"; } });
    expect(await ControlBridge.apply(s, { type: "set_model", model: "x" })).toEqual({ ok: false, error: "boom-string" });
  });
  it("context_usage / account_info return their payloads", async () => {
    const s = fakeSession([], { getContextUsage: async () => ({ totalTokens: 7 }), accountInfo: async () => ({ apiProvider: "anthropic" }) });
    expect(await ControlBridge.apply(s, { type: "context_usage" })).toEqual({ ok: true, usage: { totalTokens: 7 } });
    expect(await ControlBridge.apply(s, { type: "account_info" })).toEqual({ ok: true, account: { apiProvider: "anthropic" } });
  });
  it("reports unsupported when context_usage method is absent", async () => {
    expect(await ControlBridge.apply(fakeSession([]), { type: "context_usage" })).toEqual({ ok: false, error: "unsupported: getContextUsage" });
  });
  // Wave 1 frames
  it("interrupt surfaces the 0.3.211 receipt", async () => {
    const s = fakeSession([], { interrupt: async () => ({ still_queued: ["u1"] }) });
    expect(await ControlBridge.apply(s, { type: "interrupt" })).toEqual({ ok: true, receipt: { still_queued: ["u1"] } });
  });
  it("reinitialize / background_tasks return their payloads; stop_task routes the taskId", async () => {
    const calls: any[] = [];
    const s = fakeSession(calls, {
      reinitialize: async () => ({ pid: 42 }),
      listBackgroundTasks: async () => [{ task_id: "a" }],
      stopTask: async (id) => { calls.push(["stopTask", id]); },
      backgroundAll: async (toolUseId) => { calls.push(["backgroundAll", toolUseId]); return true; },
    });
    expect(await ControlBridge.apply(s, { type: "reinitialize" })).toEqual({ ok: true, init: { pid: 42 } });
    expect(await ControlBridge.apply(s, { type: "background_tasks" })).toEqual({ ok: true, tasks: [{ task_id: "a" }] });
    expect(await ControlBridge.apply(s, { type: "stop_task", taskId: "t-1" })).toEqual({ ok: true });
    expect(await ControlBridge.apply(s, { type: "background_all", toolUseId: "toolu_1" })).toEqual({ ok: true, backgrounded: true });
    expect(calls).toEqual([["stopTask", "t-1"], ["backgroundAll", "toolu_1"]]);
  });
  it("wave-1 frames parse; unsupported on sessions lacking the methods", async () => {
    expect(controlFrame.safeParse({ type: "reinitialize" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "background_tasks" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "stop_task", taskId: "t" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "stop_task" }).success).toBe(false);
    expect(controlFrame.safeParse({ type: "background_all" }).success).toBe(true);
    expect(await ControlBridge.apply(fakeSession([]), { type: "reinitialize" })).toEqual({ ok: false, error: "unsupported: reinitialize" });
  });
});
