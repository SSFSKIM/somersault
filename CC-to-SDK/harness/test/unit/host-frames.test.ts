import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-frames-"));

/** A fake HostSession whose onFrame the test drives by hand: `onFrame(cb)` stores the callback and
 *  returns an unsubscribe; `drive(m)` invokes the stored callback exactly like Session's read-loop
 *  would (see src/session/session.ts's readLoop frameCbs fan-out). */
function fakeSession(over: Record<string, unknown> = {}) {
  let cb: ((m: unknown) => void) | undefined;
  const fake = {
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    sessionId: "sid-1",
    dispose: async () => {},
    onFrame: (c: (m: unknown) => void) => { cb = c; return () => { cb = undefined; }; },
    ...over,
  };
  return { fake, drive: (m: unknown) => cb?.(m) };
}

const hostFor = (session: unknown) =>
  new SessionHost(
    { short: "f0f0f0f0", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: () => session as any, procStartOf: async () => "start" },
  );

describe("host frame plumbing", () => {
  it("re-emits background_tasks_changed as tasks_changed and snapshots it", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const first: HostEvent[] = [];
    host.follow((e) => first.push(e));
    const tasks = [{ task_id: "t1", task_type: "bash", description: "x" }];
    drive({ type: "system", subtype: "background_tasks_changed", tasks });
    expect(first).toContainEqual({ kind: "tasks_changed", tasks });
    // A SECOND follower's follow() replay includes the snapshot — proving the host, not just the first
    // follower's live delivery, is what carries the current bg-task state forward.
    const second: HostEvent[] = [];
    host.follow((e) => second.push(e));
    expect(second).toContainEqual({ kind: "tasks_changed", tasks });
    await host.stop();
  });

  it("re-emits task lifecycle frames as {kind:'task'} (both bare and system-subtype tags)", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    const bare = { type: "task_started", task_id: "t", tool_use_id: "tu", subagent_type: "reviewer" };
    drive(bare);
    expect(seen).toContainEqual({ kind: "task", data: bare });
    const tagged = { type: "system", subtype: "task_notification", task_id: "t", status: "completed", summary: "done" };
    drive(tagged);
    expect(seen).toContainEqual({ kind: "task", data: tagged });
    await host.stop();
  });

  it("does NOT re-emit ordinary assistant frames as task events", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    drive({ type: "assistant", message: { role: "assistant", content: [] } });
    expect(seen.some((e) => e.kind === "task" || e.kind === "tasks_changed")).toBe(false);
    await host.stop();
  });

  // Plan-review I1: the session swap replaces `this.session` with a fresh Session whose subscriber set
  // is empty — without a re-subscribe in resumeSession(), mode sync/tasks/attribution silently die
  // after a /resume.
  it("frames still plumb after resumeSession", async () => {
    const { fake: fake1, drive: drive1 } = fakeSession();
    const { fake: fake2, drive: drive2 } = fakeSession({ sessionId: "sid-2" });
    const sessions = [fake1, fake2];
    let i = 0;
    const host = new SessionHost(
      { short: "d0d0d0d0", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      { openSession: () => sessions[i++]! as any, procStartOf: async () => "start" },
    );
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    const tasksBefore = [{ task_id: "t1", task_type: "bash", description: "x" }];
    drive1({ type: "system", subtype: "background_tasks_changed", tasks: tasksBefore });
    expect(seen).toContainEqual({ kind: "tasks_changed", tasks: tasksBefore });

    await host.resumeSession("sid2");
    // The swap itself emitted an empty tasks_changed — the old session's tasks are gone.
    expect(seen).toContainEqual({ kind: "tasks_changed", tasks: [] });

    // Driving the FIRST (now-detached) session must not reach the follower anymore.
    drive1({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "stale", task_type: "bash", description: "z" }] });
    expect(seen).not.toContainEqual({ kind: "tasks_changed", tasks: [{ task_id: "stale", task_type: "bash", description: "z" }] });

    // Driving the SECOND session's onFrame reaches the follower — proving the re-subscribe fired.
    const tasksAfter = [{ task_id: "t2", task_type: "bash", description: "y" }];
    drive2({ type: "system", subtype: "background_tasks_changed", tasks: tasksAfter });
    expect(seen).toContainEqual({ kind: "tasks_changed", tasks: tasksAfter });
    await host.stop();
  });

  // Live-feedback fix (2026-08-06): the /clear engine half. The load-bearing subtlety is the launch
  // config's OWN resume key — engineConfig spreads it first, so a host born from `ccx --resume <sid>`
  // would reopen the very conversation /clear was asked to drop unless clearSession overrides it.
  it("clearSession opens a FRESH engine — the launch config's resume key is overridden, not inherited", async () => {
    const { fake: fake1 } = fakeSession();
    const { fake: fake2 } = fakeSession({ sessionId: "sid-fresh" });
    const sessions = [fake1, fake2];
    const opened: Record<string, unknown>[] = [];
    let i = 0;
    const host = new SessionHost(
      { short: "c1ea4c1e", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: { resume: "sid-launch" } as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      { openSession: (cfg: unknown) => { opened.push(cfg as Record<string, unknown>); return sessions[i++]! as any; }, procStartOf: async () => "start" },
    );
    await host.start();
    expect(opened[0]!["resume"]).toBe("sid-launch");   // the first engine honours the launch resume
    await host.clearSession();
    expect(opened).toHaveLength(2);
    expect(opened[1]!["resume"]).toBeUndefined();      // the swap does NOT reopen the dropped conversation
    expect(opened[1]!["resumeAt"]).toBeUndefined();
    await host.stop();
  });

  it("stamps parentToolUseID + subagentType onto a parked decision via the correlation maps", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    drive({ type: "task_started", task_id: "bg1", tool_use_id: "agent-tu", subagent_type: "code-reviewer" });
    drive({ type: "assistant", parent_tool_use_id: "agent-tu", message: { content: [{ type: "tool_use", id: "inner-tu", name: "Bash", input: {} }] } });
    void host.broker().request({ toolUseID: "inner-tu", toolName: "Bash", input: {}, kind: "permission", signal: new AbortController().signal });
    const entry = host.pending()[0];
    expect(entry.parentToolUseID).toBe("agent-tu");
    expect(entry.subagentType).toBe("code-reviewer");
    // A toolUseID with no map hit parks WITHOUT the fields (never blocks).
    void host.broker().request({ toolUseID: "unmapped-tu", toolName: "Bash", input: {}, kind: "permission", signal: new AbortController().signal });
    const unattributed = host.pending().find((e) => e.toolUseID === "unmapped-tu")!;
    expect(unattributed.parentToolUseID).toBeUndefined();
    expect(unattributed.subagentType).toBeUndefined();
    await host.stop();
  });

  it("clears the attribution maps at turn start", async () => {
    const { fake, drive } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    drive({ type: "task_started", task_id: "bg1", tool_use_id: "agent-tu", subagent_type: "code-reviewer" });
    drive({ type: "assistant", parent_tool_use_id: "agent-tu", message: { content: [{ type: "tool_use", id: "inner-tu", name: "Bash", input: {} }] } });
    await host.runTask("go");   // a fake (resolving) turn — must reset the correlation maps
    void host.broker().request({ toolUseID: "inner-tu", toolName: "Bash", input: {}, kind: "permission", signal: new AbortController().signal });
    const entry = host.pending().find((e) => e.toolUseID === "inner-tu")!;
    expect(entry.parentToolUseID).toBeUndefined();
    expect(entry.subagentType).toBeUndefined();
    await host.stop();
  });
});
