import { describe, it, expect, vi } from "vitest";
import { SessionHost } from "../../src/host/host.js";

const user = (text: string, uuid: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const assistant = (uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });

function makeHost(overrides: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const opened: Record<string, unknown>[] = [];
  const session = {
    submit: vi.fn(async () => ({})), sessionId: "sid-1", dispose: vi.fn(async () => {}),
    onFrame: vi.fn(() => () => {}),
    rewind: vi.fn(async (uuid: string, o?: { dryRun?: boolean }) => {
      calls.push(`rewind:${uuid}:${o?.dryRun ? "dry" : "real"}`);
      return { canRewind: true, filesChanged: ["/tmp/a"], insertions: 1, deletions: 1 };
    }),
    ...overrides,
  };
  const getMessages = vi.fn(async () => [user("A", "uA"), assistant("aA"), user("B", "uB")]);
  const host = new SessionHost(
    { short: "h1", name: "h1", cwd: "/tmp", kind: "interactive", detached: true, config: {}, ...opts } as any,
    { openSession: (c: any) => { opened.push(c); return session as any; }, getMessages, disposeGraceMs: 20 } as any,
  );
  // start() binds a real socket; tests drive the methods directly instead — mirror host-session.test.ts
  (host as any).session = session; (host as any).mode = "acceptEdits";
  return { host, session, calls, opened, getMessages };
}

describe("rewindAnchors", () => {
  it("classifies via the shared module, newest-first", async () => {
    const { host } = makeHost();
    const anchors = await host.rewindAnchors();
    expect(anchors.map((a) => a.uuid)).toEqual(["uB", "uA"]);
    expect(anchors[0].prevUuid).toBe("aA");
  });
});

describe("rewindDryRun", () => {
  it("returns the shape, and normalizes a THROW into {canRewind:false,error}", async () => {
    const { host } = makeHost();
    expect((await host.rewindDryRun("uB")).canRewind).toBe(true);
    const { host: h2 } = makeHost({ rewind: vi.fn(async () => { throw new Error("File rewinding is not enabled."); }) });
    const dry = await h2.rewindDryRun("uB");
    expect(dry.canRewind).toBe(false);
    expect(dry.error).toMatch(/not enabled/);
  });
});

describe("rewind", () => {
  it("scope both: file restore (dry then real) on the LIVE engine BEFORE the swap, swap opens at runtime mode with resumeAt=prevUuid", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "both");
    expect(calls).toEqual(["rewind:uB:dry", "rewind:uB:real"]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ resume: "sid-1", resumeAt: "aA", permissionMode: "acceptEdits" });
  });
  it("scope code: no engine swap", async () => {
    const { host, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "code");
    expect(opened).toHaveLength(0);
  });
  it("scope conversation: no file restore", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "conversation");
    expect(calls).toEqual([]);
    expect(opened).toHaveLength(1);
  });
  it("refuses code scopes when dryRun says canRewind false — and never runs the throwing real call", async () => {
    const rewind = vi.fn(async (_u: string, o?: { dryRun?: boolean }) => {
      if (o?.dryRun) return { canRewind: false, error: "File rewinding is not enabled." };
      throw new Error("File rewinding is not enabled.");
    });
    const { host } = makeHost({ rewind });
    await expect(host.rewind({ uuid: "uB", prevUuid: "aA" }, "both")).rejects.toThrow(/not enabled/);
    expect(rewind).toHaveBeenCalledTimes(1);   // dry only
  });
  it("refuses conversation scopes with a null prevUuid — and never touches files (validate before side effects)", async () => {
    const { host, session } = makeHost();
    await expect(host.rewind({ uuid: "uA", prevUuid: null }, "both")).rejects.toThrow(/code-only/);
    expect(session.rewind).not.toHaveBeenCalled();
  });
  it("scope code with a null prevUuid still succeeds and performs the file restore (the intended degradation)", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uA", prevUuid: null }, "code");
    expect(calls).toEqual(["rewind:uA:dry", "rewind:uA:real"]);
    expect(opened).toHaveLength(0);
  });
  it("refuses while a turn is in flight", async () => {
    const { host } = makeHost();
    (host as any).turnInFlight = true;
    await expect(host.rewind({ uuid: "uB", prevUuid: "aA" }, "both")).rejects.toThrow(/busy/);
  });
  it("refuses while a decision is parked — attach means multiple clients, so this is host-side, not the client's greyed affordance", async () => {
    const { host } = makeHost();
    // Park a permission decision the same way the broker does — fire-and-forget, never awaited: `park()`
    // sets the pending entry synchronously inside the Promise executor, before this call even returns.
    void host.broker().request({ toolName: "Bash", input: {}, toolUseID: "tu-1", signal: new AbortController().signal });
    await expect(host.rewind({ uuid: "uB", prevUuid: "aA" }, "both")).rejects.toThrow(/pending/);
  });
  it("clears bg tasks + emits the stopped notice and empty snapshot on a conversation rewind", async () => {
    const { host } = makeHost();
    (host as any).bgTasks = [{ task_id: "t1", task_type: "local_shell", description: "sleep" }];
    const events: any[] = [];
    host.follow((ev) => events.push(ev));
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "conversation");
    expect(events.some((e) => e.kind === "task" && /ended by rewind/.test(e.data?.summary ?? ""))).toBe(true);
    expect(events.some((e) => e.kind === "tasks_changed" && e.tasks.length === 0)).toBe(true);
  });
  it("resumeSession still swaps at runtime mode (regression: the swap is now shared)", async () => {
    const { host, opened } = makeHost();
    await host.resumeSession("other-sid");
    expect(opened[0]).toMatchObject({ resume: "other-sid", permissionMode: "acceptEdits" });
    expect((opened[0] as any).resumeAt).toBeUndefined();
  });
});
