// test/unit/appserver/review-start.test.ts — M4 Task 5: `review/start`, the one method Codex's whole review
// REQUEST surface is.
//
// THE TARGET THREAD'S ENGINE IS NEVER TOUCHED, which is what every case here is really pinning. Detached
// delivery needs exactly one fact from the target — the directory it runs in — so the target records below
// are HAND-BUILT (shell-command.test.ts's pattern) with a fake engine that records every submit: the claim
// is that array staying empty while a SECOND, new session is built and prompted instead.
//
// The `sessionFactory` dep is what makes both halves observable — the cwd the review thread was rooted at
// and the prompt it was handed are the two facts this handler is responsible for.
import { describe, it, expect, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { FLEET_UNSUPPORTED, emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { resolveOptions } from "../../../src/config/resolveOptions.js";
import type { HarnessConfig } from "../../../src/config/types.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

/** Records every session this server built, so a test can assert the cwd the REVIEW thread was rooted at,
 *  the config it was opened with, and the prompt it was handed. */
function factory() {
  const built: Array<{ config: Record<string, unknown>; submitted: unknown[] }> = [];
  const sessionFactory: AppServerDeps["sessionFactory"] = (config) => {
    const entry = { config, submitted: [] as unknown[] };
    built.push(entry);
    return { submit: async (p: unknown) => { entry.submitted.push(p); return { result: {} }; },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {},
      sessionId: `sess-${built.length}`, isEnded: () => false } as never;
  };
  return { built, sessionFactory };
}

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  // `watchThreads` throughout: `thread/started` is watcher-scoped fan-out, and a review thread appearing is
  // exactly the kind of thing a watching client is entitled to hear about.
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** A target thread to review — hand-built, because `review/start` never touches its engine. `submitted`
 *  comes back so a case can prove the target's own engine stayed silent. */
function addRecord(srv: AppServer, cwd: string | undefined, origin: "inProcess" | "fleet" = "inProcess", config?: Record<string, unknown>) {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  const submitted: unknown[] = [];
  srv.registry.add({
    id, origin,
    session: { submit: async (p: unknown) => { submitted.push(p); return { result: {} }; }, interrupt: async () => ({}),
      dispose: async () => {}, onFrame: () => () => {}, sessionId: "target", isEnded: () => false },
    unattended: "park", busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
    subscribers: new Set(), chain: Promise.resolve(), createdAt: now, updatedAt: now, cwd, config,
    settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
  } as unknown as ThreadRecord);
  return { id, submitted };
}

const send = (method: string, params: unknown) => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
const replyTo = (id: number) => parsed(lines).find((m) => m.id === id) as Record<string, any> | undefined;
const settle = () => new Promise((r) => setImmediate(r));

afterEach(async () => { for (const s of servers.splice(0)) await s.shutdown().catch(() => {}); });

describe("review/start — delivery", () => {
  it("refuses delivery:inline with an actionable message naming detached", async () => {
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" }, delivery: "inline" });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
    expect(String(replyTo(id)?.error?.message)).toMatch(/detached/i);
  });

  it("refuses a delivery value that is neither inline nor detached", async () => {
    // Carried forward from the Task 1 review: the schema tests pin that `detached` is the default and that
    // `inline` survives verbatim, but nothing pinned the enum CLOSED. Written as `z.string()` it would pass
    // all of those and let `delivery: "streamed"` reach this handler on a path no one specified. Two
    // supported values, and everything else is a bad request.
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" }, delivery: "streamed" });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
  });
});

describe("review/start — the detached review thread", () => {
  it("creates a NEW review thread, replies {turn, reviewThreadId}, and roots it at the target's cwd", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo/target");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const res = replyTo(id)?.result;
    expect(res?.reviewThreadId).toBeTruthy();
    expect(res?.reviewThreadId).not.toBe(t.id);          // a NEW thread, not the target
    expect(res?.turn?.id).toBeTruthy();
    expect(f.built.at(-1)?.config.cwd).toBe("/repo/target");
  });

  it("submits a prompt naming the target and ReportFindings", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const prompt = String(f.built.at(-1)?.submitted[0] ?? "");
    expect(prompt).toMatch(/uncommitted|working tree/i);
    expect(prompt).toContain("ReportFindings");
  });

  it("leaves the TARGET's engine untouched — nothing is submitted to it", async () => {
    // The whole mechanism in one assertion: a review is a turn on a second session, so the conversation
    // under review gains no message and its engine is never driven.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    send("review/start", { threadId: t.id, target: { type: "commit", sha: "abc123" } });
    await settle();
    expect(t.submitted).toEqual([]);
    expect(f.built.at(-1)?.submitted.length).toBe(1);
  });

  it("the review thread is an ORDINARY thread — announced, and its turn runs the normal spine", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const reviewThreadId = replyTo(id)?.result?.reviewThreadId as string;
    // Watchers hear about it like any other thread, or a client can never learn that the turn events it is
    // about to see belong to a thread it has.
    const started = parsed(lines).find((m) => m.method === "thread/started" && (m.params as any)?.thread?.id === reviewThreadId);
    expect(started).toBeDefined();
    expect((started?.params as any)?.thread?.cwd).toBe("/repo");
    expect(srv.registry.get(reviewThreadId)).toBeDefined();
  });

  it("works for a FLEET-origin target — the target's engine is never touched", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo/fleet", "fleet");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    expect(replyTo(id)?.error).toBeUndefined();
    expect(replyTo(id)?.result?.reviewThreadId).toBeTruthy();
    expect(f.built.at(-1)?.config.cwd).toBe("/repo/fleet");
    expect(FLEET_UNSUPPORTED.has("review/start")).toBe(false);
  });

  it("marks the review record with the thread it reviews, for the harvester to attribute", async () => {
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const review = srv.registry.get(replyTo(id)?.result?.reviewThreadId as string);
    expect(review?.reviewOf).toBe(t.id);
    expect(srv.registry.get(t.id)?.reviewOf).toBeUndefined();
  });
});

describe("review/start — read-only by policy, not only by prompt", () => {
  it("opens the review thread with the edit tools disallowed", async () => {
    // The prompt says "Review only — do not edit, fix, or commit anything"; a promise the server does not
    // enforce is one it should not print. Risk reduction, not a guarantee — `Bash` stays (git needs it).
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const disallowed = f.built.at(-1)?.config.disallowedTools as string[];
    expect(disallowed).toEqual(expect.arrayContaining(["Edit", "Write", "NotebookEdit"]));
    expect(disallowed).not.toContain("Bash");
  });

  it("MERGES with the target config's own disallowedTools rather than clobbering them", async () => {
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo", "inProcess", { cwd: "/repo", disallowedTools: ["WebSearch", "Edit"] });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const disallowed = f.built.at(-1)?.config.disallowedTools as string[];
    expect(disallowed).toEqual(expect.arrayContaining(["WebSearch", "Edit", "Write", "NotebookEdit"]));
    expect(disallowed.filter((d) => d === "Edit").length).toBe(1); // merged as a set, not concatenated
  });

  it("never resumes the target's conversation, however the target was opened", async () => {
    // `record.config` is the FULL object the target's engine was built from — `resume` included. Carried
    // over it would open the review ON the target's own transcript, which is precisely the contamination
    // detached delivery exists to avoid.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo", "inProcess", { cwd: "/repo", resume: "sess-target", model: "opus" });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    expect(f.built.at(-1)?.config.resume).toBeUndefined();
    expect(f.built.at(-1)?.config.model).toBe("opus"); // the rest of the target's setup still travels
  });

  it("drops EVERY knob that names or reopens the target's conversation, not just `resume`", async () => {
    // `resume` was the only one stripped, and it is one of six ways a config can point an engine at an
    // existing transcript. A target opened with `sessionId` writes the review INTO that session's id; one
    // opened with `continueSession` reopens the most recent conversation in the cwd — the review's own cwd,
    // which is the target's. Either hands the "detached" review the target's history back, which is the one
    // thing D-M4-2 exists to prevent, so the whole family goes.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo", "inProcess", {
      cwd: "/repo", model: "opus",
      resume: "sess-target", resumeAt: "uuid-7", droppedTurnUuid: "uuid-8",
      forkSession: true, sessionId: "11111111-2222-3333-4444-555555555555", continueSession: true,
    });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const config = f.built.at(-1)!.config;
    for (const key of ["resume", "resumeAt", "droppedTurnUuid", "forkSession", "sessionId", "continueSession"])
      expect(config, key).not.toHaveProperty(key);   // omitted, not undefined — nothing downstream reads a hole
    expect(config.model).toBe("opus");               // and the rest of the target's setup still travels
  });

  it("drops the same family out of the target's `extraOptions`, which reaches Options directly", async () => {
    // The escape hatch is inherited too, and it does not go through the typed fields at all — `extraOptions`
    // is merged straight into the SDK `Options` (resolveOptions.ts), in the SDK's OWN spellings. Stripping
    // only the typed knobs above would leave the identical reopen one key deeper.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo", "inProcess", { cwd: "/repo", extraOptions: {
      resume: "sess-target", resumeSessionAt: "uuid-7", resumeDropsTurn: "uuid-8",
      forkSession: true, sessionId: "11111111-2222-3333-4444-555555555555", continue: true,
      maxTurns: 12,   // an ordinary escape-hatch value, which must survive
    } });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const extra = f.built.at(-1)!.config.extraOptions as Record<string, unknown>;
    for (const key of ["resume", "resumeSessionAt", "resumeDropsTurn", "forkSession", "sessionId", "continue"])
      expect(extra, key).not.toHaveProperty(key);
    expect(extra.maxTurns).toBe(12);
    // And the TARGET's own config is not edited on the way past — it is still the object its live engine was
    // built from, and a review must not mutate the thread it reviews.
    expect((srv.registry.get(t.id)!.config!.extraOptions as Record<string, unknown>).resume).toBe("sess-target");
  });

  it("drops the same family out of the target's `extraArgs`, the CLI-argv third wire (probe 114)", async () => {
    // `extraArgs` entries land on the spawned CLI's argv AFTER every typed flag, and the CLI takes the
    // LAST occurrence of a repeated flag — probe 114 measured both, in both orders, envelope and
    // transcript filename agreeing. An inherited `extraArgs.resume` would therefore point the
    // "detached" review at the target's own conversation past both strips above, one vocabulary deeper
    // again — the CLI's flag spellings, which hyphenate four of the six.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo", "inProcess", { cwd: "/repo", extraArgs: {
      resume: "sess-target", "resume-session-at": "uuid-7", "resume-drops-turn": "uuid-8",
      "fork-session": null, "session-id": "11111111-2222-3333-4444-555555555555", continue: null,
      "append-system-prompt": "keep",   // an ordinary argv value, which must survive
    } });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const args = f.built.at(-1)!.config.extraArgs as Record<string, unknown>;
    for (const key of ["resume", "resume-session-at", "resume-drops-turn", "fork-session", "session-id", "continue"])
      expect(args, key).not.toHaveProperty(key);
    expect(args["append-system-prompt"]).toBe("keep");
    // And the TARGET's own config is not edited on the way past.
    expect((srv.registry.get(t.id)!.config!.extraArgs as Record<string, unknown>).resume).toBe("sess-target");
  });

  it("wins over an `extraOptions` that tries to un-root or re-arm the review", async () => {
    // The other half of the same inheritance: `extraOptions` is spread LAST into the SDK Options, so before
    // resolveOptions reserved these keys a target could carry `{cwd, disallowedTools}` in its hatch and the
    // review's own re-rooting and read-only policy would both lose to it — a "read-only review of the
    // target's tree" pointed somewhere else with Edit and Write handed back. Asserted through `resolveOptions`
    // because that is the function the real `openSession` runs on this config (session/index.ts).
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo/target", "inProcess", { cwd: "/repo/target", extraOptions: { cwd: "/etc", disallowedTools: [] } });
    send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    const options = resolveOptions(f.built.at(-1)!.config as HarnessConfig);
    expect(options.cwd).toBe("/repo/target");
    expect(options.disallowedTools).toEqual(expect.arrayContaining(["Edit", "Write", "NotebookEdit"]));
  });
});

describe("review/start — gates", () => {
  it("refuses an unknown threadId with THREAD_NOT_FOUND", async () => {
    boot(factory());
    const id = send("review/start", { threadId: "th_nope", target: { type: "uncommittedChanges" } });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("refuses a malformed target", async () => {
    const srv = boot(factory());
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "nope" } });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
  });

  it("refuses SHUTTING_DOWN when the latch drops while the range resolve is in flight, and builds nothing", async () => {
    // The handler runs SYNCHRONOUSLY through `send` down to `resolveReviewRange`'s await, so the latch below
    // lands squarely inside this handler's one window — the reason the check sits after that await rather
    // than at arrival. Every other thread-admitting path pins its own latch (thread/start, thread/resume,
    // thread/fork, thread/attach); un-pinned, a later refactor hoisting this one back up to arrival reads as
    // a tidy-up and silently re-opens the window a review thread can be admitted through after shutdown.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    const done = srv.shutdown();
    await settle();
    await done;
    expect(replyTo(id)?.error?.code).toBe(ERR.SHUTTING_DOWN);
    expect(f.built.length).toBe(0);      // no engine, and so no `claude` child, outlives the shutdown
    expect(srv.registry.list()).toHaveLength(0);
  });

  it("refuses when the TARGET is dropped while the range resolve is in flight", async () => {
    // Same window, the other way round: `thread/close`/`thread/delete` can remove the target record while
    // git runs. Inheriting a closed thread's config would be odd; stamping `reviewOf` with an id that no
    // longer resolves would leave Task 6's attribution pointing at nothing. Re-read, and refuse.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    srv.registry.delete(t.id);
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.THREAD_NOT_FOUND);
    expect(f.built.length).toBe(0);
  });

  it("refuses over-cap scope text instead of truncating it into a different review", async () => {
    // The client strings all land in one user message (reviewPrompt.ts), so the schema bounds them — and the
    // handler's ordinary invalid-params path is where that bound has to surface. Truncating instead would
    // review a prefix of what was asked for and report it as the review requested; refusing is a bad request
    // the client can see. No thread and no engine are created for it.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "custom", instructions: "x".repeat(20_001) } });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
    expect(f.built.length).toBe(0);
    expect(srv.registry.list().map((r) => r.id)).toEqual([t.id]);
  });

  it("refuses a `sha` carrying a second git argument", async () => {
    // `sha: "HEAD -- package.json"` used to pass and made the prompt say `git show HEAD -- package.json`, so
    // the review silently covered one path instead of the commit — and Bash is deliberately enabled, so the
    // same channel carries shell metacharacters into a command the model was told to run.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: t.id, target: { type: "commit", sha: "HEAD -- package.json" } });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
    expect(f.built.length).toBe(0);
  });

  it("refuses a target thread whose cwd is unknown instead of reviewing this server's own tree", async () => {
    // Runtime-reachable only for a malformed fleet roster row (registry.ts's `threadCwd`), and "I don't
    // know where that thread runs" is the honest answer — a fallback would silently review a different repo.
    const f = factory();
    const srv = boot(f);
    const t = addRecord(srv, undefined, "fleet");
    const id = send("review/start", { threadId: t.id, target: { type: "uncommittedChanges" } });
    await settle();
    expect(replyTo(id)?.error?.code).toBe(ERR.INVALID_PARAMS);
    expect(f.built.length).toBe(0); // no orphaned session left behind
  });
});
