// test/tui/attach-reconcile.test.tsx — bl9 D14: the post-follow attach reconcile (T-FOLLOW Task 1).
// `ccx attach` reads disk BEFORE it follows (cli/attach.ts:27 → Ink mount → connect → follow), so a
// concurrent in-place rewind can truncate/replace the transcript in that window and the attaching client
// renders stale rows forever — nothing else ever corrects it (research-follow-replay.md §2.1). The fix is
// a one-shot reconcile: once the session reports ready (the adapter's `whenReady()`), re-read disk once
// and rebuild ONLY if the stamp moved (A1/A1b); no stamp at all means no read, ever (A5).
//
// bl9 wave 3 (invariant replacement): waves 1/2 each patched a corner of this reconcile racing a live turn
// (deferral, then local-row carry-over, then a title refetch) — three narrow fixes for one underlying gap.
// Wave 3 replaces all of it with one rule: the reconcile may rebuild ONLY while the document is still
// VIRGIN (exactly the attach-time mount seed, untouched). It aborts silently and permanently — no retry, no
// re-arm — the moment any of three virgin conditions fails by the time its disk read resolves: the disk
// generation moved (`diskGenRef`, unchanged machinery), a turn has started since mount
// (`turnStartedSinceMountRef`), or the document's entry count grew past the mount-time snapshot. Tests
// tagged "(replaced)" below pin the NEW abort semantics where the old test pinned a deferred rebuild.
//
// bl9 wave 4 (rereview3 P1/P2, invariant REFINEMENT): wave 3's entry-count snapshot was captured too late —
// inside the reconcile effect's own body, which runs AFTER two earlier mount effects (session-event
// subscription, launch-time initial-prompt submit) that can synchronously drain a backlog frame or echo a
// prompt first. Wave 4 replaces it with `TranscriptDocument.revision()` captured DURING RENDER (a lazily-
// initialized ref, the earliest point nothing can race), which also catches duplicate-sidecar upgrades and
// net-zero supersede+append pairs entry-count missed. `turnStartedSinceMountRef` (virgin condition 2, "a
// turn ran at all") is DELETED outright rather than replaced: any turn that has actually drained content
// already trips the revision check, so the flag was only ever deciding for a turn that opened but drained
// NOTHING — the common attach-to-a-busy-host shape — and disqualifying that case was pure over-approximation.
// Tests tagged "(revised)" below pin the two-condition rule; a mid-turn attach whose open turn HAS drained
// content still permanently aborts (a known, accepted limitation, not a regression).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { fakeRemote, type FakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import { diskStampOf } from "../../src/sessions/rows.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";

const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
function allText(c: { state: { finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: { text: string }[] } }): string {
  return [...[...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines), ...c.state.streaming.map((l) => l.text)].join("|");
}

// A `ChatSession` extended with the remote adapter's `whenReady()` (chatAdapter.ts's `RemoteChat`, pinned
// by test/unit/client-chat-adapter.test.ts:508) — the reconcile's readiness gate. `resolveReady`/`ready`
// let a test hold the effect open until it chooses to let the "follow ack" land.
function fakeAttachSession(remoteOpts: FakeRemoteOpts = {}): FakeRemote & { whenReady: () => Promise<void>; resolveReady: () => void } {
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  return { ...fakeRemote(remoteOpts), whenReady: () => ready, resolveReady };
}

const diskRows = (uuid: string, tail: string) => [
  { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "the first prompt" }] } },
  { type: "assistant", parent_tool_use_id: null, uuid, message: { content: [{ type: "text", text: tail }] } },
];
const entriesFrom = (rows: unknown[]): TranscriptBootstrapEntry[] => rows.map((message) => ({ kind: "sdk", source: "disk", message: message as Record<string, unknown> }));

function Host({ makeSession, initialEntries, initialDiskStamp, deps }: {
  makeSession: () => ChatSession;
  initialEntries: TranscriptBootstrapEntry[];
  initialDiskStamp?: { lastUuid?: string; count: number };
  deps?: { getSessionMessages?: (id: string) => Promise<any[]> };
}) {
  const c = useChat(makeSession, { initialEntries, initialDiskStamp }, deps);
  return <Text>{allText(c)}</Text>;
}

describe("useChat: post-follow attach reconcile (bl9 D14)", () => {
  // Also serves as wave 3's "virgin mismatch still rebuilds" test: nothing here trips any of the three
  // virgin conditions (no turn, no swap, no local row), so this is exactly the case the new invariant must
  // still let through — unchanged from before the rewrite.
  it("A1: a stale attach rebuilds to post-rewind disk after the follow ack", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return freshRows; } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(frame(lastFrame)).toContain("the stale tail reply");   // seeded from the (stale) bootstrap stream
    session.resolveReady();                                       // the "follow ack" lands
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
    expect(frame(lastFrame)).not.toContain("the stale tail reply");
    expect(reads).toBe(1);
    // Fix 3 (reviewer-recommended): the mismatch rebuild is labeled "resynced", not `replayDocument`'s
    // default "resumed" — the likeliest cause is another client's rewind, and nothing here was resumed.
    expect(frame(lastFrame)).toContain("resynced");
  });

  it("A1b: a matching stamp repaints nothing", async () => {
    const rows = diskRows("a1", "the only tail reply");
    let reads = 0, wipes = 0;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return rows; }, clearScreen: () => { wipes++; } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(rows)} initialDiskStamp={diskStampOf(rows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    const seeded = frame(lastFrame);
    session.resolveReady();
    await waitFor(() => reads === 1);
    await new Promise((r) => setTimeout(r, 20));                 // long enough for a stray rebuild to land
    expect(wipes).toBe(0);
    expect(frame(lastFrame)).toBe(seeded);
  });

  it("A5: no stamp, no read", async () => {
    const rows = diskRows("a1", "irrelevant — must never be read");
    let reads = 0;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return rows; } };
    render(<Host makeSession={() => session} initialEntries={[]} deps={deps} />);
    session.resolveReady();
    await new Promise((r) => setTimeout(r, 40));
    expect(reads).toBe(0);
  });

  // Fix 1 (T-FOLLOW fix wave, Important finding): the mismatch compare used to close over the FROZEN
  // `opts.initialDiskStamp` captured at mount, not the live `diskStampRef` every other disk-driven rebuild
  // (`rebuildAfterRewind`) keeps current. So a real `rewound` rebuild that lands WHILE this reconcile's own
  // disk read is still in flight already resolved the mismatch — and the reconcile, still comparing against
  // the stale mount-time stamp, would see one anyway and fire a second, redundant `clearScreen` + rebuild.
  // This pins the fix: once the live rebuild has landed, the reconcile's later-resolving read must see the
  // CURRENT stamp and no-op.
  it("D14 fix 1: a live rewound rebuild landing while the reconcile's own read is in flight must not repaint again", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0, wipes = 0;
    let resolveReconcileRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = {
      // Call #1 is the reconcile's own read — held open (a deferred promise) so it resolves AFTER the
      // rewind rebuild below has already landed. Call #2 is that rewind rebuild's own read, which
      // resolves immediately.
      getSessionMessages: async () => {
        reads++;
        if (reads === 1) return new Promise<unknown[]>((r) => { resolveReconcileRead = r; });
        return freshRows;
      },
      clearScreen: () => { wipes++; },
    };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();                       // the follow ack lands → the reconcile's read (call #1) starts, held open
    await waitFor(() => reads === 1);
    session.pushEvent({ kind: "rewound" } as any); // a live rewind rebuild races ahead of the reconcile's own read
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
    expect(wipes).toBe(1);                         // the rewind rebuild wiped once
    resolveReconcileRead(freshRows);               // NOW let the reconcile's stale-window read land
    await new Promise((r) => setTimeout(r, 30));   // long enough for a stray second rebuild to land
    expect(wipes).toBe(1);                         // NOT a second wipe: the live stamp already matched
    expect(frame(lastFrame)).toContain("the fresh tail reply");
  });

  // A2 (T-FOLLOW Task 2), invariant REPLACED wave 3: the tasks half is the D16 test below (task ref state
  // survives, because no rebuild ever gets a chance to touch it once a turn has started); this pins the
  // IN-FLIGHT TURN half under the new rule. Drives a live turn the same way the sibling suite does
  // (useChat.test.tsx: "an externally-started turn ... busy is true between start and end"), races the
  // reconcile's read against it, and asserts `busy`/the live turn are untouched — not because a document-only
  // rebuild happens to spare them (the old D16-style argument), but because the live turn's own message frame
  // (pushed below) is a retained document append that bumps `revision()` past the render-time seed (wave 4:
  // `turnStartedSinceMountRef` is gone, but a turn that has drained content trips the SAME abort through the
  // revision check), so NO rebuild — deferred or otherwise — ever runs again for the rest of this mount,
  // including after `turn:end` (there is no re-arm left to react to it: wave 1's deferral machinery is deleted).
  it("A2: an in-flight turn's live state survives the mismatch reconcile, which now aborts permanently instead of deferring", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    function BusyHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps);
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<BusyHost />);
    await new Promise((r) => setTimeout(r, 20));
    // The follow drain's in-flight turn lands BEFORE the follow ack (`whenReady`) resolves — the same
    // ordering the brief describes and the D16 test already exercises for tasks.
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "live turn frame one" }] } } });
    await waitFor(() => frame(lastFrame).includes("live turn frame one"));
    session.resolveReady();                          // the follow ack lands mid-turn — a turn already started, so this read can only ever abort
    await new Promise((r) => setTimeout(r, 30));      // long enough for the reconcile's read to resolve and, if unguarded, rebuild
    expect(frame(lastFrame)).toContain("BUSY");       // the live turn's UI state is untouched
    expect(frame(lastFrame)).toContain("live turn frame one");
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
    // The turn is still event-owned: a later frame of the SAME turn still renders.
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "live turn frame two" }] } } });
    await waitFor(() => frame(lastFrame).includes("live turn frame two"));
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    await new Promise((r) => setTimeout(r, 30));      // no re-arm exists anymore — turn end must not trigger a late rebuild either
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("resynced");
  });

  // A4 (T-FOLLOW Task 2): the self-resume invariant, pinned from the reconcile's side. `chatAdapter.ts:94-100`
  // documents RESUME BEFORE FOLLOW as load-bearing: a resuming client's `resumeOp` happens before it calls
  // `follow()`, so it is never sent its own swap's `rewound` broadcast — the invariant review F1 required v2
  // to preserve untouched (spec D14/D16, "the self-resume invariant … is preserved untouched"). A resume
  // re-opens the SAME persisted file it just read, so this reconcile's own mechanism (comparing the
  // pre-follow stamp against a fresh `getSessionMessages` read) sees a MATCH by construction — no correlation
  // with `resumeOp` needed. This fixture fakes exactly that: `initialDiskStamp` is computed from the same
  // rows `getSessionMessages` hands back, the resume-reopens-same-file case. Asserts no `clearScreen`, no
  // repaint — same shape as A1b, but pinned here as review F1's named scenario per the task brief.
  it("A4: a resume that reopens the same file it already read reconciles to a no-op (review F1's self-resume scenario)", async () => {
    const rows = diskRows("a-resume", "the resumed tail reply");
    let reads = 0, wipes = 0;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    // `getSessionMessages` stands in for the adapter's `resumeOp`-then-`follow` re-open: it returns the
    // SAME rows the pre-follow read (`initialDiskStamp`) was computed from — the file did not move.
    const deps = { getSessionMessages: async () => { reads++; return rows; }, clearScreen: () => { wipes++; } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(rows)} initialDiskStamp={diskStampOf(rows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    const seeded = frame(lastFrame);
    session.resolveReady();                          // the follow ack lands — mirrors `whenFollowed()` after resumeOp+follow
    await waitFor(() => reads === 1);
    await new Promise((r) => setTimeout(r, 20));      // long enough for a stray rebuild to land
    expect(wipes).toBe(0);                            // no clearScreen — the self-resume stays silent
    expect(frame(lastFrame)).toBe(seeded);            // document untouched
  });

  // F1 (bl9 round), invariant REPLACED wave 3, refined wave 4: waves 1/2 patched around a mismatch rebuild
  // racing a live turn — first deferring it to turn end, then carrying the turn-end's own local rows
  // forward. Wave 3 deletes both: the reconcile is a mount-time correction, and (post-wave-4) a turn that
  // has drained a message frame into the document permanently disqualifies it via the revision check — the
  // frame pushed below bumps `revision()` past the render-time seed before the reconcile's read resolves. So
  // F1's original race (a completed assistant message delivered mid-turn silently dropped by a rebuild that
  // predates it) is now UNREPRESENTABLE — there is no rebuild left for it to be dropped by. This pins the
  // abort: once a turn has drained content, the reconcile's own read — whenever it resolves, even long after
  // the turn has fully closed — must never touch the document again.
  it("F1 (replaced): a turn starting before the reconcile's read resolves aborts it permanently, even after the turn ends", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    function BusyHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps);
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<BusyHost />);
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "live-1", message: { content: [{ type: "text", text: "COMPLETED-BEFORE-REBUILD" }] } } });
    await waitFor(() => frame(lastFrame).includes("COMPLETED-BEFORE-REBUILD"));
    session.resolveReady();                          // the follow ack lands mid-turn — a turn already started, so this read can only ever abort
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });   // the turn closes — no re-arm exists anymore to react to this
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    await new Promise((r) => setTimeout(r, 30));       // long enough for the reconcile's read to resolve, if it were going to rebuild
    expect(frame(lastFrame)).toContain("COMPLETED-BEFORE-REBUILD");   // the live content, never touched by any rebuild
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");   // the abort is FINAL: no rebuild, ever, past this turn
    expect(frame(lastFrame)).not.toContain("resynced");
  });

  // F2 (bl9 round): the reconcile's own read is a pure equality check against `diskStampRef.current` with no
  // notion of recency — it cannot tell "my read is stale because a newer rebuild already landed" from "my
  // read is the newer, correcting one." A generation token bumped by every disk-backed rebuild closes it: the
  // reconcile captures the gen before its read and discards the result if the gen moved underneath it.
  it("F2: a reconcile read that resolves with STALE pre-rewind rows after a newer rebuild must not win", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0, wipes = 0;
    let resolveReconcileRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = {
      getSessionMessages: async () => {
        reads++;
        if (reads === 1) return new Promise<unknown[]>((r) => { resolveReconcileRead = r; });
        return freshRows;   // the live rewound rebuild's own read
      },
      clearScreen: () => { wipes++; },
    };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();
    await waitFor(() => reads === 1);
    session.pushEvent({ kind: "rewound" } as any);
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
    expect(wipes).toBe(1);
    resolveReconcileRead(staleRows);   // the reconcile's stale-window read resolves with the ORIGINAL pre-rewind rows
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("the stale tail reply");
  });

  // New (bl9 wave 3, revised wave 4): a local row appended with NO turn ever starting (the idle follow-gap
  // marker `appendFollowGap` fires from a bare truncated turn-start with no `seq`, which opens no turn at
  // all — see useChat.ts's turn:start arm) still permanently disqualifies the reconcile — under wave 4, via
  // the SAME `revision()` check that condition 2 (F1/A2 above, real turns with drained content) uses:
  // `appendLocal` bumps `rev` exactly like `appendSdk` does. Distinct from condition 1 (D14 fix 1/F2, a
  // document swap) — this is the case that exercises the non-turn append path through the merged condition.
  it("virgin condition (revision): a local row appended before the read resolves aborts the reconcile, even with no turn ever started", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", truncated: true } as any);   // idle follow-gap: appends a local row, opens no turn
    await waitFor(() => frame(lastFrame).includes("Earlier live output unavailable"));
    session.resolveReady();
    await new Promise((r) => setTimeout(r, 30));      // long enough for the reconcile's read to resolve
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("resynced");
    expect(frame(lastFrame)).toContain("the stale tail reply");   // untouched
  });

  // F3 (bl9 round): `whenReady()` mints a fresh promise per call and the reconcile's `.then(...)` chain had
  // no rejection handler — a dead host during the readiness window (a real, expected failure mode) produced
  // an unhandled rejection, which crashes the process outright under Node's default `--unhandled-rejections`
  // semantics. A read-only side path must never take the session down with it.
  it("F3: a rejecting whenReady() must not produce an unhandled promise rejection", async () => {
    const rows = diskRows("a1", "irrelevant");
    const rejectingSession = { ...fakeAttachSession({ sessionId: "sess-1" }), whenReady: () => Promise.reject(new Error("host died")) };
    let caught: unknown;
    const onUnhandled = (e: unknown) => { caught = e; };
    process.on("unhandledRejection", onUnhandled);
    try {
      render(<Host makeSession={() => rejectingSession as any} initialEntries={entriesFrom(rows)} initialDiskStamp={diskStampOf(rows)} deps={{ getSessionMessages: async () => rows }} />);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(caught).toBeUndefined();
  });

  // D16 (pinned per the fix-wave review), invariant REPLACED wave 3: the mismatch rebuild is the
  // document-only `replaceFromDisk` core, deliberately narrow — it must never touch `taskListRef`/`setTasks`
  // (or bgHarvest), unlike a real rewind's rebuild. The reviewer's mutation test — adding
  // `taskListRef.current.reset(); setTasks([]);` into `replaceFromDisk` — survived all 215 tests in the
  // suite at the time, meaning nothing pinned the constraint. This does.
  //
  // Under the new invariant this reconcile only ever fires while the document is virgin, so the fixture
  // must seed live task state WITHOUT tripping either of the other two virgin conditions: no turn wrapper
  // (condition 2) and no document growth (condition 3). `taskListRef.ingest` runs unconditionally for every
  // `message` event, turn or no turn (useChat.ts's message-frame handler) — so this replays the
  // task-creating pair as bare `message` events carrying the SAME uuids already present in the mount seed;
  // `appendSdk`'s identity dedup rejects them as duplicates (no entries growth) while the task ingest still
  // runs. This is not merely a test contrivance — it is the real shape of an idle follow-buffer replay of
  // already-persisted content (`host.ts`'s "no-live-turn guard" dedup, cli/attach.ts's own comment), which
  // is exactly the case a virgin reconcile must still be able to rebuild through.
  it("D16 regression: live task state seeded without any turn survives the virgin mismatch rebuild", async () => {
    const taskCall = { type: "assistant", parent_tool_use_id: null, uuid: "task-call", message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } };
    const taskResult = { type: "user", uuid: "task-result", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created successfully: build it" }] } };
    const staleRows = [
      { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "the first prompt" }] } },
      taskCall, taskResult,
      { type: "assistant", parent_tool_use_id: null, uuid: "a-stale", message: { content: [{ type: "text", text: "the stale tail reply" }] } },
    ];
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    let tasks: unknown[] = [];
    function TaskHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps);
      tasks = (c.state as unknown as { tasks: unknown[] }).tasks;
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<TaskHost />);
    await new Promise((r) => setTimeout(r, 20));
    // Replay the SAME task frames live, with NO turn wrapper — `taskListRef` ingests every `message` event
    // unconditionally, so this seeds live task state while `appendSdk`'s identity dedup (same uuids as the
    // mount seed above) keeps the document itself exactly virgin.
    session.pushEvent({ kind: "message", data: taskCall } as any);
    session.pushEvent({ kind: "message", data: taskResult } as any);
    await waitFor(() => tasks.length === 1);
    session.resolveReady();                        // the follow ack lands → the reconcile fires its virgin mismatch rebuild
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
    expect(tasks).toEqual([{ id: "1", subject: "build it", status: "pending" }]);
  });

  // W2-F1a (rereview1, bl9 fix-wave 2), invariant REPLACED wave 3: wave 2's fix carried the turn-end
  // duration row forward through a deferred rebuild and reissued the title fetch that rebuild would
  // otherwise invalidate. Wave 3 deletes both — there is no rebuild left to carry anything through or
  // invalidate, because a turn having started at all (even one that raced the follow ack and closed before
  // the reconcile's read resolved) permanently disqualifies this reconcile. Pins the abort: the turn's own
  // duration row and its own SINGLE title fetch land exactly as they would with no reconcile in the picture
  // at all, and the stale-window read — whenever it resolves — touches nothing.
  it("W2-F1a (replaced): a turn racing the follow ack means the reconcile aborts — the turn's own duration row and title fetch land untouched, with no reissue", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const titleResolvers: Array<() => void> = [];
    const deps = {
      getSessionMessages: async () => freshRows,
      getSessionInfo: () => new Promise<any>((res) => { titleResolvers.push(() => res({ customTitle: "engine title" })); }),
    };
    let aiTitle: string | undefined;
    function BusyHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps as any);
      aiTitle = c.state.aiTitle;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<BusyHost />);
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "live-1", message: { content: [{ type: "text", text: "LIVE-TURN-REPLY" }] } } });
    await waitFor(() => frame(lastFrame).includes("LIVE-TURN-REPLY"));
    session.resolveReady();                          // the follow ack lands mid-turn — a turn already started, so this read can only ever abort
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });   // appends the duration row and fires the turn's own (only) title fetch
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    await new Promise((r) => setTimeout(r, 30));      // long enough for the reconcile's read to resolve
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");   // the abort held: no rebuild ever ran
    expect(frame(lastFrame)).not.toContain("resynced");
    expect(titleResolvers.length).toBe(1);            // exactly one fetch — nothing to reissue, because nothing was invalidated
    titleResolvers[0]();
    await waitFor(() => aiTitle === "engine title");
    // the SAME turn-end's duration row — local, never on disk — was never at risk in the first place
    expect(frame(lastFrame)).toMatch(/(Baked|Brewed|Churned|Cogitated|Cooked|Crunched|Sautéed|Worked) for/);
  });

  // W2-F1b, invariant REPLACED wave 3: the same race, for the OTHER local row the finding names — a
  // connection-loss notice a failed turn's own end appends (`✗ <error>`, `useChat.ts`'s `turn:end` arm).
  // Same abort — the notice lands because `turn:end` always appends it, not because any carry-over
  // machinery preserves it against a rebuild that (under the new rule) never runs.
  it("W2-F1b (replaced): a turn racing the follow ack means the reconcile aborts — a connection-loss notice at turn end lands untouched", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    function BusyHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps);
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<BusyHost />);
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "live-1", message: { content: [{ type: "text", text: "LIVE-TURN-REPLY" }] } } });
    await waitFor(() => frame(lastFrame).includes("LIVE-TURN-REPLY"));
    session.resolveReady();                          // the follow ack lands mid-turn — a turn already started, so this read can only ever abort
    session.pushEvent({ kind: "turn", phase: "end", seq: 1, error: "connection dropped" } as any);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    await new Promise((r) => setTimeout(r, 30));      // long enough for the reconcile's read to resolve
    expect(frame(lastFrame)).toContain("connection dropped");
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("resynced");
  });

  // W2-F2 (rereview1): `clear()` swaps the document through `replaceDocument` but — before this fix — never
  // advanced `diskGenRef`, so a reconcile read already in flight when `/clear` lands is invisible to the F2
  // generation guard and can repopulate the just-cleared transcript with pre-clear rows once it resolves.
  // Doubles, unchanged, as wave 3's "virgin condition 1" test: `/clear` is a document swap, so this is
  // already an abort-via-`diskGenRef` scenario under the new invariant — nothing here needed adjusting.
  it("W2-F2: /clear invalidates a still-in-flight deferred reconcile read", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let resolveRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => new Promise<unknown[]>((r) => { resolveRead = r; }) };
    const api: { clear?: () => void } = {};
    function ClearHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows) }, deps);
      api.clear = c.clear;
      return <Text>L:{c.state.finalizedItems.length} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<ClearHost />);
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();                    // fires the reconcile's read — held open by `resolveRead`
    await new Promise((r) => setTimeout(r, 20));
    api.clear!();                              // the user clears mid-flight, before the reconcile's read resolves
    await waitFor(() => frame(lastFrame).includes("L:0"));
    resolveRead(freshRows);                    // the stale-window read finally resolves, AFTER the clear
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("L:0");                        // must STILL be empty
    expect(frame(lastFrame)).not.toContain("the stale tail reply");
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
  });

  // W4-F2 (rereview3 P2) — RED ON WAVE 3: this is wave 3's own bug, not a new scenario. Wave 3's virgin
  // condition 3 captured `documentRef.current!.entries().length` INSIDE the reconcile effect's own body,
  // which runs AFTER the earlier-defined launch-time initial-prompt effect (useChat.ts's `ranInitialPrompt`
  // effect, source order precedes the reconcile effect). `runTurn` appends the user-echo BEFORE calling
  // `session.submit` — so a `submit` stub that never resolves (no turn wrapper ever opens; `pushEvent` is
  // never called) leaves the echo as the ONLY document mutation, landing entirely inside the mount's own
  // effect flush, before the old entry-count snapshot line ever executed. That snapshot therefore already
  // counted the echo as part of the "seed", so it never detects the mutation, and the wholesale
  // `replaceFromDisk` rebuild erases the echo along with everything else — genuinely local-only content that
  // was never on disk. Wave 4's `revision()` is captured one render earlier than that (see `seedRevisionRef`),
  // strictly before this effect can run, so it catches the same mutation the entry count missed.
  it("W4-F2 (red on wave 3): an initial-prompt echo landing before the old entry-count snapshot must survive the reconcile", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    // No turn wrapper ever opens: `submit` never calls back into the host event stream, so
    // `turnStartedSinceMountRef` (wave 3) — and, post-wave-4, the message-append half of the revision
    // check — are never the reason this passes. Only the bare local echo is at stake.
    const session = fakeAttachSession({ sessionId: "sess-1", submit: () => new Promise<{ result: unknown }>(() => {}) });
    const deps = { getSessionMessages: async () => freshRows };
    function InitialPromptHost() {
      const c = useChat(() => session, { initialEntries: entriesFrom(staleRows), initialDiskStamp: diskStampOf(staleRows), initialPrompt: "localecho" }, deps);
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<InitialPromptHost />);
    await new Promise((r) => setTimeout(r, 20));
    expect(frame(lastFrame)).toContain("localecho");   // the initial-prompt echo landed on mount, ahead of the reconcile's own setup
    session.resolveReady();
    await new Promise((r) => setTimeout(r, 30));        // long enough for the reconcile's read to resolve
    expect(frame(lastFrame)).toContain("localecho");    // MUST survive: local-only content a disk rebuild cannot reconstruct
    expect(frame(lastFrame)).not.toContain("resynced"); // MUST NOT have rebuilt — the document was never virgin
  });

  // New (bl9 wave 4, rereview3 P1) — the coverage the deleted `turnStartedSinceMountRef` condition was
  // permanently blocking: a mid-turn attach whose open turn has drained NO content by the time the
  // reconcile's read resolves. `turn:start` alone touches no document state (useChat.ts's turn-start ingest
  // arm mutates only refs/React state), so `revision()` stays at the render-time seed and the mismatch
  // rebuild may still run — this is the common attach-to-a-busy-host shape (`follow()` emits `turn:start`
  // before `whenReady()` resolves) the finding named. RED ON WAVE 3: the old flag aborted the instant ANY
  // turn opened, content or not, so this would time out waiting for "resynced" that never arrives.
  it("new coverage (revised): a turn that opened but drained no content by read-resolve time still lets the reconcile rebuild", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });   // a real turn opens — but drains NOTHING before the follow ack
    session.resolveReady();
    await waitFor(() => frame(lastFrame).includes("resynced"), 500);
    expect(frame(lastFrame)).toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("the stale tail reply");
  });

  // New (bl9 wave 4, rereview3 boundary pin): the flip side of the restored coverage above — a mid-turn
  // attach whose open turn HAS drained a row by the time the reconcile's read resolves keeps its stale
  // prefix. This is the DELIBERATE, ACCEPTED limitation the controller declined to fix (no deferral, re-arm
  // or merge-after-turn reconstruction): the drained row already bumped `revision()` past the render-time
  // seed, so the same abort A2/F1 pin above still holds. Expected green on HEAD and after the fix alike —
  // pinned so a future change cannot silently narrow or widen this boundary without a test noticing.
  it("boundary pin: a turn that has drained one row by read-resolve time keeps the stale prefix (accepted limitation)", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => freshRows };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "live-drained", message: { content: [{ type: "text", text: "LIVE-DRAINED-ROW" }] } } });
    await waitFor(() => frame(lastFrame).includes("LIVE-DRAINED-ROW"));
    session.resolveReady();
    await new Promise((r) => setTimeout(r, 30));        // long enough for the reconcile's read to resolve, if it were going to rebuild
    expect(frame(lastFrame)).toContain("the stale tail reply");   // untouched — the accepted limitation
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
    expect(frame(lastFrame)).not.toContain("resynced");
  });

  // rereview4 P2 (wave 5): a live stream_event/hook/task frame arriving WHILE the reconcile's disk read is
  // pending does not move `revision()`, so (pre-fix) the virgin mismatch rebuild still fired and
  // `replaceDocument` wiped `hookTrackerRef`/`agentMetaRef`/`streaming` state that frame had just written.
  // Fixed by virgin condition 3 (`liveActivitySeq`, see useChat.ts): now the SAME race aborts the rebuild
  // instead, exactly like conditions 1/2 already do. Held-open reads (`resolveRead`), same idiom as
  // D14-fix-1/F2 above, so the event genuinely lands DURING the pending window and not before it starts.
  const hookFrame = (subtype: "hook_started" | "hook_response", fields: Record<string, unknown>) =>
    ({ kind: "message" as const, data: { type: "system", subtype, ...fields } });

  it("condition 3 (hook): a hook_started ingested while the read is pending aborts the rebuild — the pairing survives for its later response", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0;
    let resolveRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return new Promise<unknown[]>((r) => { resolveRead = r; }); } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();                          // the follow ack lands → the reconcile's read starts, held open
    await waitFor(() => reads === 1);
    // A Stop hook starts (standalone, unbounded — no tool_use anchor needed) WHILE the read is pending:
    // `hook_started` never touches `documentRef` (useChat.ts's own comment: "nothing here mutates the
    // document for it to react to"), so conditions 1/2 alone would let the mismatch rebuild through.
    session.pushEvent(hookFrame("hook_started", { hook_id: "h1", hook_event: "Stop" }) as any);
    resolveRead(freshRows);
    await new Promise((r) => setTimeout(r, 30));      // long enough for the read to resolve, if it were going to rebuild
    expect(frame(lastFrame)).not.toContain("resynced");             // condition 3 held: no rebuild ran
    expect(frame(lastFrame)).toContain("the stale tail reply");     // untouched — the same abort A2/F1 already pin
    // The pairing response arrives later, live — the tracker that survived (no rebuild ever touched it) pairs it.
    session.pushEvent(hookFrame("hook_response", { hook_id: "h1", hook_name: "Stop", hook_event: "Stop", exit_code: 2, stderr: "boom" }) as any);
    await waitFor(() => frame(lastFrame).includes("stop hook"));
  });

  it("condition 3 (streaming): a stream_event partial mid-read aborts the rebuild — the live line is never blanked", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0;
    let resolveRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return new Promise<unknown[]>((r) => { resolveRead = r; }); } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });   // pre-read drain: outside the window, by design
    session.resolveReady();
    await waitFor(() => reads === 1);
    // A partial streams WHILE the read is pending — `stream_event` "changes NOTHING outside the live turn"
    // (useChat.ts's own comment), so `revision()` alone would let the mismatch rebuild through.
    session.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } } } as any);
    session.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } } } as any);
    session.pushEvent({
      kind: "message",
      data: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "LIVE-STREAM-CHUNK" } } },
    } as any);
    await waitFor(() => frame(lastFrame).includes("LIVE-STREAM-CHUNK"));
    resolveRead(freshRows);
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("resynced");              // condition 3 held: no rebuild ran
    expect(frame(lastFrame)).toContain("LIVE-STREAM-CHUNK");         // never blanked — the live line was never at risk
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");
  });

  it("condition 3 (agentMeta): a live task_notification mid-read aborts the rebuild — the enrichment survives", async () => {
    const agentCall = { type: "assistant", parent_tool_use_id: null, uuid: "a-agent-call", message: { content: [{ type: "tool_use", id: "agent-1", name: "Agent", input: { description: "review the diff", prompt: "go" } }] } };
    const agentResult = { type: "user", uuid: "u-agent-result", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "the report" }] } };
    const staleRows = [
      { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "the first prompt" }] } },
      agentCall, agentResult,
      { type: "assistant", parent_tool_use_id: null, uuid: "a-stale", message: { content: [{ type: "text", text: "the stale tail reply" }] } },
    ];
    const freshRows = [
      { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "the first prompt" }] } },
      agentCall, agentResult,
      { type: "assistant", parent_tool_use_id: null, uuid: "a-fresh", message: { content: [{ type: "text", text: "the fresh tail reply" }] } },
    ];
    let reads = 0;
    let resolveRead!: (rows: unknown[]) => void;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => { reads++; return new Promise<unknown[]>((r) => { resolveRead = r; }); } };
    const { lastFrame } = render(
      <Host makeSession={() => session} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();
    await waitFor(() => reads === 1);
    // The task sidechannel (P83 rung 2) arrives WHILE the read is pending — live-only enrichment keyed by
    // tool_use id, never persisted to disk, and never touching `documentRef` either.
    session.pushEvent({ kind: "task", data: { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "agent-1", subagent_type: "reviewer", task_type: "local_agent", description: "review the diff" } } as any);
    session.pushEvent({ kind: "task", data: { type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "agent-1", status: "completed", usage: { total_tokens: 4195, tool_uses: 2, duration_ms: 4484 } } } as any);
    await waitFor(() => frame(lastFrame).includes("4.2k tokens"));
    resolveRead(freshRows);
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("resynced");         // condition 3 held: no rebuild ran
    expect(frame(lastFrame)).toContain("4.2k tokens");          // the enrichment survives — never at risk
  });

  // condition 3's own boundary pin, the mirror of the "boundary pin" test above: a decision parked WHILE the
  // read is pending must abort too — `pendingStateRef` (the decision-dialog surface) is reset unconditionally
  // by `replaceDocument`, same rule as the hook tracker and agent meta, and it does not route through
  // `onSessionEvent` at all (`session.onDecision`, a separate subscription this hook owns).
  it("condition 3 (decision): a decision parked mid-read aborts the rebuild", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRows = diskRows("a-fresh", "the fresh tail reply");
    let reads = 0;
    let resolveRead!: (rows: unknown[]) => void;
    let onDecisionCb: ((entry: unknown) => void) | undefined;
    const session = {
      ...fakeAttachSession({ sessionId: "sess-1" }),
      onDecision: (cb: (entry: unknown) => void) => { onDecisionCb = cb; return () => {}; },
      onDecisionSettled: () => () => {},
    };
    const deps = { getSessionMessages: async () => { reads++; return new Promise<unknown[]>((r) => { resolveRead = r; }); } };
    const { lastFrame } = render(
      <Host makeSession={() => session as any} initialEntries={entriesFrom(staleRows)} initialDiskStamp={diskStampOf(staleRows)} deps={deps} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    session.resolveReady();
    await waitFor(() => reads === 1);
    onDecisionCb!({ toolUseID: "t1", kind: "permission", request: {} });
    resolveRead(freshRows);
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("resynced");         // condition 3 held: no rebuild ran
    expect(frame(lastFrame)).toContain("the stale tail reply");
  });
});
