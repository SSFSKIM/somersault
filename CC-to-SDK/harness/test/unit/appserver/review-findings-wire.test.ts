// test/unit/appserver/review-findings-wire.test.ts — M4 Task 6: the harvested findings ON THE WIRE.
//
// THE ONE RULE EVERY CASE HERE SERVES: a review must never report a silent all-clear. Three separate
// defects earlier in this milestone were that rule violated in different disguises, so the cases below pin
// each door it can arrive through — an explicit empty report is a REAL report, a turn that never reported
// is loudly `unstructured` with the prose attached, and a subagent's report counts as a report.
//
// The harness block is Task 5's (`mkSink`/`boot`/`factory`/`addRecord`/`send`/`parsed`) with two additions
// the review TURN needs: the fake session's `onFrame` now hands its callback back (`emit`), so a test can
// drive real assistant frames into the review, and its `submit` parks until `finish()` — so the frames are
// driven while the turn is genuinely IN FLIGHT, which is the only state the production harvest ever sees.
import { describe, it, expect, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

interface FakeSession { config: Record<string, unknown>; submitted: unknown[]; emit(frame: unknown): void; finish(): void }

function factory() {
  const built: FakeSession[] = [];
  const sessionFactory: AppServerDeps["sessionFactory"] = (config) => {
    const cbs: Array<(m: unknown, replay?: true) => void> = [];
    let resolveSubmit: ((v: { result: unknown }) => void) | undefined;
    const entry: FakeSession = {
      config, submitted: [],
      // Copied, so a callback that unsubscribes itself mid-fan-out cannot skip the next one — the real
      // read loop iterates `[...this.frameCbs]` for the same reason (session/session.ts).
      emit: (frame: unknown) => { for (const cb of [...cbs]) cb(frame); },
      finish: () => resolveSubmit?.({ result: {} }),
    };
    built.push(entry);
    return { submit: async (p: unknown) => { entry.submitted.push(p); return new Promise<{ result: unknown }>((r) => { resolveSubmit = r; }); },
      interrupt: async () => ({}), dispose: async () => {},
      onFrame: (cb: (m: unknown, replay?: true) => void) => { cbs.push(cb); return () => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }; },
      sessionId: `sess-${built.length}`, isEnded: () => false } as never;
  };
  return { built, sessionFactory };
}

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** A target thread to review — hand-built, because `review/start` never touches its engine. */
function addRecord(srv: AppServer, cwd: string): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  srv.registry.add({
    id, origin: "inProcess",
    session: { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {},
      onFrame: () => () => {}, sessionId: "target", isEnded: () => false },
    unattended: "park", busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
    subscribers: new Set(), chain: Promise.resolve(), createdAt: now, updatedAt: now, cwd,
    settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
  } as unknown as ThreadRecord);
  return id;
}

const send = (method: string, params: unknown) => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
const replyTo = (id: number) => parsed(lines).find((m) => m.id === id) as Record<string, any> | undefined;
const settle = () => new Promise((r) => setImmediate(r));
const notifs = (method: string) => parsed(lines).filter((m) => m.method === method).map((m) => m.params as Record<string, any>);
const methodOrder = () => parsed(lines).map((m) => m.method);

// The frame shapes are Task 4's, verbatim — this file is about what reaches the WIRE, so the payloads it
// harvests must be the same ones the pure harvester was proven against.
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({ type: "assistant", message: { content }, ...extra });
const report = (input: unknown) => ({ type: "tool_use", name: "ReportFindings", id: "toolu_1", input });
const text = (t: string) => ({ type: "text", text: t });
const one = (file: string) => ({ file, summary: "s", failure_scenario: "f" });
/** The engine's own terminal frame — the read loop hands it to every frame callback BEFORE it resolves the
 *  turn's waiter (session/session.ts), which is what makes it the review turn's end from here. */
const END = { type: "result", subtype: "success" };

/** Raise a detached review and subscribe to the thread it runs on — `review/findings` rides that thread's
 *  own fan-out, exactly like every other turn event, so a client that never subscribed hears nothing. */
async function startReview(srv: AppServer, f: ReturnType<typeof factory>) {
  const targetId = addRecord(srv, "/repo");
  const id = send("review/start", { threadId: targetId, target: { type: "uncommittedChanges" } });
  await settle();
  const reviewThreadId = replyTo(id)?.result?.reviewThreadId as string;
  send("thread/subscribe", { threadId: reviewThreadId });
  await settle();
  lines.length = 0; // from here every line belongs to the review itself
  return { reviewThreadId, session: f.built.at(-1)!, targetId };
}

/** One whole review: raise it, drive `frames`, end the turn. Returns its `review/findings` payloads. */
async function runReview(srv: AppServer, f: ReturnType<typeof factory>, frames: unknown[]) {
  const r = await startReview(srv, f);
  for (const frame of frames) r.session.emit(frame);
  r.session.emit(END);
  r.session.finish();
  await settle();
  return notifs("review/findings");
}

afterEach(async () => { for (const s of servers.splice(0)) await s.shutdown().catch(() => {}); });

describe("review findings on the wire", () => {
  it("broadcasts review/findings with unstructured:false when ReportFindings is called", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([report({ level: "high", findings: [{ file: "a.ts", line: 3, summary: "off-by-one", failure_scenario: "lastN(x,2) returns 3" }] })]));
    const got = notifs("review/findings");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ threadId: r.reviewThreadId, unstructured: false, level: "high" });
    expect(got[0].turnId).toBe(srv.registry.get(r.reviewThreadId)?.currentTurnId);
    expect(got[0].findings).toHaveLength(1);
    expect(got[0].findings[0]).toMatchObject({ file: "a.ts", line: 3, summary: "off-by-one" });
    expect(got[0].prose).toBeUndefined(); // a real report carries the findings, not an excuse for them
  });

  it("distinguishes an EXPLICIT empty report (unstructured:false) from NO report (unstructured:true)", async () => {
    const f = factory(); const srv = boot(f);
    // "I looked and found nothing" IS a report — and the turn ending after it adds no second, contradictory
    // notification.
    const explicit = await runReview(srv, f, [assistant([report({ findings: [] })])]);
    expect(explicit).toHaveLength(1);
    expect(explicit[0]).toMatchObject({ findings: [], unstructured: false });
    // "the reviewer never reported" is a different fact, and it must never be flattened into the one above.
    const silent = await runReview(srv, f, [assistant([text("Looks fine to me.")])]);
    expect(silent).toHaveLength(1);
    expect(silent[0]).toMatchObject({ findings: [], unstructured: true, prose: "Looks fine to me." });
  });

  // The same rule, one door further in than the case above — and the FIFTH disguise this milestone has found
  // it in. An empty array is a real clean report; a NON-EMPTY array whose every entry is malformed is a
  // payload nothing could be read out of, and publishing it as `unstructured:false` with no findings tells a
  // client "reviewed, nothing found" while the reviewer was in the middle of reporting defects. It must land
  // on the loud fallback instead, with the prose the reviewer wrote about the defects still attached.
  it("an ALL-MALFORMED report is NOT a clean review — it falls through to the unstructured fallback", async () => {
    const f = factory(); const srv = boot(f);
    const got = await runReview(srv, f, [
      assistant([text("Two real problems here.")]),
      assistant([report({ level: "high", findings: [{ line: 4 }, { summary: "missing the other two fields" }] })]),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ findings: [], unstructured: true, prose: "Two real problems here." });
    // BOTH channels, for the reason every other case here says so: an items-only client would otherwise still
    // read the all-clear the notification no longer sends.
    const items = notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ findings: [], unstructured: true });
  });

  it("a PARTIALLY valid report still publishes its valid entries", async () => {
    // The third leg of the distinction: dropping one bad entry must not cost the report, which is the
    // behaviour that was already right and that the fix above must not trade away.
    const f = factory(); const srv = boot(f);
    const got = await runReview(srv, f, [assistant([report({ findings: [{ line: 4 }, one("a.ts")] })])]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ unstructured: false });
    expect(got[0].findings.map((x: { file: string }) => x.file)).toEqual(["a.ts"]);
  });

  it("carries the assistant prose on the unstructured fallback", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([text("I read the diff.")]));
    r.session.emit(assistant([text("It changes two files"), text(" and I have concerns.")]));
    // A subagent's chatter is NOT the reviewer's answer — TurnMapper drops nested frames from itemization
    // for the same reason, and the prose is what the REVIEWER said.
    r.session.emit(assistant([text("(subagent noise)")], { parent_tool_use_id: "toolu_parent" }));
    r.session.emit(END);
    r.session.finish();
    await settle();
    const got = notifs("review/findings");
    expect(got).toHaveLength(1);
    expect(got[0].unstructured).toBe(true);
    expect(got[0].findings).toEqual([]);
    // Blocks within one message concatenate; separate assistant messages are separate paragraphs.
    expect(got[0].prose).toBe("I read the diff.\nIt changes two files and I have concerns.");
    // Ahead of the turn's own end, so a client never sees a review turn finish before it hears the verdict.
    const order = methodOrder();
    expect(order.indexOf("review/findings")).toBeLessThan(order.indexOf("turn/completed"));
  });

  it("emits a review item so an items-only subscriber still sees the review", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([report({ level: "medium", findings: [one("a.ts")] })]));
    const items = notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ unstructured: false, level: "medium" });
    expect(items[0].findings[0]).toMatchObject({ file: "a.ts" });
    // And it is in the per-turn replay buffer, so a client that subscribes mid-review still gets it — the
    // notification alone is live-only, and a review can outlive the moment a client happened to be watching.
    const buffered = srv.registry.get(r.reviewThreadId)!.buffer.filter((b) => b.event.kind === "completed" && (b.event.item as { type: string }).type === "review");
    expect(buffered).toHaveLength(1);
  });

  it("does NOT harvest on a non-review thread's turn", async () => {
    const f = factory(); const srv = boot(f);
    const id = send("thread/start", { config: { cwd: "/repo" } });
    await settle();
    const threadId = replyTo(id)?.result?.thread?.id as string;
    send("thread/subscribe", { threadId });
    send("turn/start", { threadId, input: "hi" });
    await settle();
    lines.length = 0;
    const s = f.built.at(-1)!;
    s.emit(assistant([report({ findings: [one("a.ts")] })]));
    s.emit(END);
    s.finish();
    await settle();
    // An ordinary turn may call ReportFindings for its own reasons; nobody asked this thread to be reviewed.
    expect(notifs("review/findings")).toHaveLength(0);
    // BOTH channels, not just the notification: the item is the durable copy, so a review item minted here
    // would outlive the notification that wasn't sent and still tell an items-only client this turn was one.
    expect(notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review")).toHaveLength(0);
  });

  // D-M4-7, both halves: a subagent's report must reach the wire, and it must count as a report.
  it("broadcasts a SUBAGENT's ReportFindings (frame carries parent_tool_use_id)", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([report({ findings: [one("b.ts")] })], { parent_tool_use_id: "toolu_parent" }));
    const got = notifs("review/findings");
    expect(got).toHaveLength(1);
    expect(got[0].findings[0]).toMatchObject({ file: "b.ts" });
    expect(got[0].unstructured).toBe(false);
  });

  it("two reports in one turn broadcast TWICE — the notification is additive, not a replacement", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([report({ findings: [one("a.ts")] })]));
    r.session.emit(assistant([report({ findings: [one("b.ts"), one("c.ts")] })]));
    const got = notifs("review/findings");
    expect(got).toHaveLength(2);
    expect(got[0].findings.map((x: { file: string }) => x.file)).toEqual(["a.ts"]);
    expect(got[1].findings.map((x: { file: string }) => x.file)).toEqual(["b.ts", "c.ts"]); // its OWN frame's findings, not a re-send of everything so far
  });

  it("a subagent-only report suppresses the unstructured fallback", async () => {
    const f = factory(); const srv = boot(f);
    // Dropping a nested report would produce a review that reports nothing while its prose says otherwise —
    // the silent all-clear again, through the nesting door.
    const got = await runReview(srv, f, [assistant([report({ findings: [one("b.ts")] })], { parent_tool_use_id: "toolu_parent" })]);
    expect(got).toHaveLength(1);
    expect(got[0].unstructured).toBe(false);
  });

  it("scopes the harvest to the review's OWN turn — a follow-up turn on the review thread is not harvested", async () => {
    // A review thread is an ORDINARY thread: the client holds `reviewThreadId` and may ask the reviewer a
    // question about its own findings. Under a thread-scoped harvest that turn's findings-free ending would
    // fire the fallback on a turn nobody asked to be reviewed.
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(END);
    r.session.finish();
    await settle();
    expect(notifs("review/findings")).toHaveLength(1); // the review's own turn reported nothing — one fallback
    lines.length = 0;
    send("turn/start", { threadId: r.reviewThreadId, input: "why did you say that?" });
    await settle();
    r.session.emit(assistant([report({ findings: [one("a.ts")] })]));
    r.session.emit(END);
    r.session.finish();
    await settle();
    expect(notifs("review/findings")).toHaveLength(0);
  });

  // The case above does NOT isolate the `currentTurnId` comparison: it ends the review turn with a result
  // frame, so `done` and the unsubscribe already block everything after it. This one strands the watcher —
  // the turn settles with NO end frame (the engine died, or simply never emitted one), leaving `done` false
  // and the callback still subscribed — so the comparison is the ONLY thing standing between a later turn's
  // report and the review channel.
  it("a STRANDED watcher does not harvest a later turn — the turnId comparison alone", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.finish();   // submit resolves; no `result` frame ever arrives, so the watcher is never retired
    await settle();
    expect(notifs("review/findings")).toHaveLength(0); // no end frame, no fallback — the documented no-result path
    lines.length = 0;
    send("turn/start", { threadId: r.reviewThreadId, input: "why did you say that?" });
    await settle();
    r.session.emit(assistant([report({ findings: [one("a.ts")] })]));
    await settle();
    expect(notifs("review/findings")).toHaveLength(0);
    expect(notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review")).toHaveLength(0);
  });

  // The milestone's own failure mode through a new door. An interrupt does NOT reject the turn — the engine
  // resolves it through a real terminal `result` frame (turns.ts's onSuccess consults interruptRequested for
  // exactly that reason) — so the unstructured fallback DOES fire for it. Untagged, a client keyed on the
  // review channel renders a cancelled review as "no defects found".
  it("tags an INTERRUPTED review `aborted`, so cancelling one never reads as an all-clear", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([text("Starting on the diff now...")]));
    send("turn/interrupt", { threadId: r.reviewThreadId });
    await settle();
    r.session.emit(END);   // the engine's own terminal frame, exactly as an uninterrupted turn ends
    r.session.finish();
    await settle();
    const got = notifs("review/findings");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ findings: [], unstructured: true, aborted: true, prose: "Starting on the diff now..." });
    // BOTH channels — a client rendering items alone would otherwise still get the untagged reading.
    const items = notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review");
    expect(items).toHaveLength(1);
    expect(items[0].aborted).toBe(true);
    // And it agrees with the turn's own ending, which is what makes the two readable side by side.
    expect(notifs("turn/completed")[0].turn).toMatchObject({ status: "interrupted" });
  });

  it("does NOT tag a review that genuinely finished with nothing to report", async () => {
    const f = factory(); const srv = boot(f);
    // The distinction is the whole point of the tag: same empty findings, same `unstructured` flag, and a
    // completely different fact about whether a review happened.
    const got = await runReview(srv, f, [assistant([text("I read the diff and found nothing.")])]);
    expect(got[0]).toMatchObject({ findings: [], unstructured: true });
    expect(got[0].aborted).toBeUndefined();
    const items = notifs("item/completed").map((p) => p.item).filter((i) => i?.type === "review");
    expect(items[0].aborted).toBeUndefined();
  });

  // The other ending that reaches a terminal frame without finishing: probe 96's dead connection is a
  // `subtype:"success"` frame carrying `is_error`, which `turnFailureOf` is the one reader of.
  it("tags a FAILED review too — a result frame that reports failure is not a clean ending", async () => {
    const f = factory(); const srv = boot(f);
    const r = await startReview(srv, f);
    r.session.emit(assistant([text("Reading the diff.")]));
    r.session.emit({ type: "result", subtype: "success", is_error: true, result: "connection lost" });
    r.session.finish();
    await settle();
    const got = notifs("review/findings");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ findings: [], unstructured: true, aborted: true });
  });

  it("omits `prose` entirely when the reviewer said nothing at all", async () => {
    const f = factory(); const srv = boot(f);
    const got = await runReview(srv, f, []);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ findings: [], unstructured: true });
    expect("prose" in got[0]).toBe(false); // "" is not something a reviewer said
  });

  // `reviewOf` is a property of the THREAD, so it rides the thread view every client already reads rather
  // than repeating itself on every findings notification — which is also what lets a client identify a
  // review thread it did not raise, off `thread/started` or `thread/list`.
  it("a review thread's view names what it reviewed; an ordinary thread's carries no such key", async () => {
    const f = factory(); const srv = boot(f);
    const targetId = addRecord(srv, "/repo");
    const id = send("review/start", { threadId: targetId, target: { type: "uncommittedChanges" } });
    await settle();
    const reviewThreadId = replyTo(id)?.result?.reviewThreadId as string;
    const started = notifs("thread/started").map((p) => p.thread).find((t: Record<string, any>) => t.id === reviewThreadId);
    expect(started.reviewOf).toBe(targetId);
    const plainId = send("thread/start", { config: { cwd: "/repo" } });
    await settle();
    expect("reviewOf" in (replyTo(plainId)?.result?.thread as Record<string, unknown>)).toBe(false); // omitted, not undefined
  });
});
