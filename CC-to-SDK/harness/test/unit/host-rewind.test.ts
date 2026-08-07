import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { SessionHost } from "../../src/host/host.js";
import { hostSocketPath } from "../../src/fleet/paths.js";

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
  // W-S8 INVERTS THIS. It used to read "refuses conversation scopes with a null prevUuid — and never touches
  // files (validate before side effects)" and assert `rejects.toThrow(/code-only/)`. That was honest only
  // while the host had no way to express "before the first prompt"; it now clears instead of refusing, so a
  // `both` scope does BOTH halves. What this pins is that both halves RAN — not their order: `calls` and
  // `opened` are independent arrays with nothing interleaving them, and the review moved the swap block
  // above the file-restore block with this test and the `scope both` test at the top of this describe both
  // staying green. The ordering (file restore on the LIVE engine first — probe 68d needs the open transport)
  // is UNPINNED here, a pre-existing gap inherited from that older test's idiom rather than one W-S8 opened.
  it("scope both with a null prevUuid restores the files AND clears the conversation", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uA", prevUuid: null }, "both");
    expect(calls).toEqual(["rewind:uA:dry", "rewind:uA:real"]);
    expect(opened).toHaveLength(1);
    expect((opened[0] as any).resumeAt).toBeUndefined();
  });
  it("scope code with a null prevUuid still succeeds and performs the file restore (the intended degradation)", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uA", prevUuid: null }, "code");
    expect(calls).toEqual(["rewind:uA:dry", "rewind:uA:real"]);
    expect(opened).toHaveLength(0);
  });
  it("restores to the session's FIRST message by swapping to a fresh conversation (A4b)", async () => {
    // resumeSessionAt takes a message UUID and has no value meaning "before the first", so a fork is not
    // the primitive here — an empty conversation is. Both keys must be EXPLICITLY undefined: engineConfig
    // spreads the LAUNCH config first (host.ts:356), so a host born from `ccx --resume <sid>` still carries
    // `resume` — which is why the launch config below carries one. A bare `swapEngine({})` passes a weaker
    // version of this test and reopens the very conversation the user asked to drop.
    const { host, opened } = makeHost({}, { config: { resume: "launch-sid" } });
    await host.rewind({ uuid: "uB", prevUuid: null }, "conversation");
    expect(opened).toHaveLength(1);
    expect((opened[0] as any).resume).toBeUndefined();
    expect((opened[0] as any).resumeAt).toBeUndefined();
  });
  it("keeps the busy window closed across the whole first-message restore", async () => {
    // The reason this does NOT call the host's own clearSession(): that method opens and closes
    // swapInFlight itself, so nesting it inside rewind's window would let the inner finally reopen the busy
    // gate mid-swap. WHERE THIS SAMPLES IS THE WHOLE TEST. The obvious place — inside the injected
    // openSession — cannot tell the two shapes apart, because that call sits inside the INNER window too:
    // the review replaced the swap with `await this.clearSession()` and every test here still passed. The
    // discriminating instant is the `rewound` broadcast, emitted after the swap resolves and before rewind's
    // own finally: shipped code is still busy there, the nested-clearSession shape has already been reopened
    // by the inner finally and reads false.
    const seen: boolean[] = [];
    const { host } = makeHost();
    host.follow((ev) => { if (ev.kind === "rewound") seen.push(host.busy()); });
    await host.rewind({ uuid: "uB", prevUuid: null }, "conversation");
    expect(seen).toEqual([true]);
  });
  it("broadcasts rewound with `cleared` and no prevUuid after a first-message restore", async () => {
    // POSITIVE, not the absence of prevUuid: the swap minted a NEW session id, and a follower whose cached
    // id has not flipped yet would otherwise read the OLD (non-empty) file and re-render the conversation
    // the user just discarded — truncateAtAnchor(rows, undefined) returns every row.
    const { host } = makeHost();
    const events: any[] = [];
    host.follow((ev) => events.push(ev));
    await host.rewind({ uuid: "uB", prevUuid: null }, "conversation");
    const ev = events.find((e: any) => e.kind === "rewound");
    expect(ev).toBeDefined();
    expect(ev.cleared).toBe(true);
    expect(ev.prevUuid).toBeUndefined();
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
  // EP-S1: a FOLLOWER's rebuild reads disk at the same instant the confirming client's does, and gets the
  // same pre-rewind chain back. It needs the anchor to cut at, and the broadcast is its only channel.
  it("the rewound broadcast carries the anchor's prevUuid, so a FOLLOWER can cut its own rebuild", async () => {
    const { host } = makeHost();
    const events: any[] = [];
    host.follow((ev) => events.push(ev));
    await host.rewind({ uuid: "uB", prevUuid: "a1" }, "conversation");
    const rewound = events.find((e) => e.kind === "rewound");
    expect(rewound).toMatchObject({ prevUuid: "a1" });
  });
  it("resumeSession still swaps at runtime mode (regression: the swap is now shared)", async () => {
    const { host, opened } = makeHost();
    await host.resumeSession("other-sid");
    expect(opened[0]).toMatchObject({ resume: "other-sid", permissionMode: "acceptEdits" });
    expect((opened[0] as any).resumeAt).toBeUndefined();
  });
});

// Final whole-branch review Important 2: rewind() is not atomic against a concurrent prompt from another
// attached client. rewind() used to check `turnInFlight` once on entry, then await a dry run and the real
// file restore before swapEngine — and the socket's `prompt` gate reads busy(), which was FALSE for that
// entire window (turnInFlight alone says nothing about a swap in progress). A second attached client's
// prompt landing in that window started a turn on the OLD engine while the working tree was already
// reverted, and swapEngine then reset the turn buffer and disposed that engine out from under the
// in-flight turn. These drive a REAL socket (host.start()), the same path server.ts's `prompt` op takes,
// so the test proves the actual gate a concurrent client would hit — not just the internal field.
describe("swapInFlight busy gate (Important 2)", () => {
  const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-swap-"));

  function askOverSocket(env: NodeJS.ProcessEnv, op: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const s = connect({ path: hostSocketPath(process.pid, env) }, () => s.write(JSON.stringify(op) + "\n"));
      let buf = "";
      s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { s.end(); resolve(JSON.parse(buf.slice(0, i))); } });
      s.on("error", reject);
    });
  }

  it("a prompt submitted while a rewind is mid-flight is refused as busy", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() };
    let releaseRewind: (() => void) | undefined;
    const session = {
      sessionId: "sid-1",
      submit: vi.fn(async () => ({})),
      dispose: vi.fn(async () => {}),
      onFrame: vi.fn(() => () => {}),
      // dryRun resolves immediately; the REAL call (the file restore) hangs until released — the exact
      // window in which the host must report busy() to a concurrent socket op.
      rewind: vi.fn(async (uuid: string, o?: { dryRun?: boolean }) => {
        if (o?.dryRun) return { canRewind: true, filesChanged: ["/tmp/a"], insertions: 1, deletions: 1 };
        await new Promise<void>((r) => { releaseRewind = r; });
        return { canRewind: true };
      }),
    };
    const host = new SessionHost(
      { short: "5a500001", name: "t", cwd: "/tmp", kind: "interactive", detached: true, config: {} as never, env },
      { openSession: () => session as any, procStartOf: async () => "start" },
    );
    await host.start();
    const rewindP = host.rewind({ uuid: "uB", prevUuid: "aA" }, "both");
    await vi.waitFor(() => expect(host.busy()).toBe(true));

    const reply = await askOverSocket(env, { op: "prompt", text: "hi" });
    expect(reply).toEqual({ ok: false, error: "busy" });
    expect(session.submit).not.toHaveBeenCalled();

    releaseRewind!();
    await rewindP;
    expect(host.busy()).toBe(false);
    await host.stop();
  });

  it("the flag is cleared after a rewind that THROWS, so a later prompt succeeds", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() };
    let releaseDry: (() => void) | undefined;
    const session = {
      sessionId: "sid-1",
      submit: vi.fn(async () => ({})),
      dispose: vi.fn(async () => {}),
      onFrame: vi.fn(() => () => {}),
      // The dry run itself hangs until released — so the test can observe busy()===true DURING the
      // window, not just infer the fix from a trivially-false busy() that would also be false with no
      // fix at all (no swap in flight ever means busy() is false for an unrelated reason).
      rewind: vi.fn(async (_uuid: string, o?: { dryRun?: boolean }) => {
        if (o?.dryRun) { await new Promise<void>((r) => { releaseDry = r; }); return { canRewind: false, error: "File rewinding is not enabled." }; }
        throw new Error("must never reach the real call — dry run already refused");
      }),
    };
    const host = new SessionHost(
      { short: "5a500002", name: "t", cwd: "/tmp", kind: "interactive", detached: true, config: {} as never, env },
      { openSession: () => session as any, procStartOf: async () => "start" },
    );
    await host.start();
    const rewindP = host.rewind({ uuid: "uB", prevUuid: "aA" }, "both");
    await vi.waitFor(() => expect(host.busy()).toBe(true));   // busy WHILE the dry run is in flight
    releaseDry!();
    await expect(rewindP).rejects.toThrow(/not enabled/);
    expect(host.busy()).toBe(false);   // NOT wedged — the finally cleared it even though rewind() threw

    const reply = await askOverSocket(env, { op: "prompt", text: "hi" });
    expect(reply).toMatchObject({ ok: true, accepted: true });
    await host.stop();
  });
});
