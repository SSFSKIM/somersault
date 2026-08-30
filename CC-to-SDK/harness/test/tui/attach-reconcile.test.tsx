// test/tui/attach-reconcile.test.tsx — bl9 D14: the post-follow attach reconcile (T-FOLLOW Task 1).
// `ccx attach` reads disk BEFORE it follows (cli/attach.ts:27 → Ink mount → connect → follow), so a
// concurrent in-place rewind can truncate/replace the transcript in that window and the attaching client
// renders stale rows forever — nothing else ever corrects it (research-follow-replay.md §2.1). The fix is
// a one-shot reconcile: once the session reports ready (the adapter's `whenReady()`), re-read disk once
// and rebuild ONLY if the stamp moved (A1/A1b); no stamp at all means no read, ever (A5).
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

  // A2 (T-FOLLOW Task 2): the brief's "non-empty tasks_changed AND an in-flight turn" claim splits in two —
  // the tasks half is the fix wave's "D16 regression" test above (taskListRef/setTasks survive the mismatch
  // rebuild); this pins the IN-FLIGHT TURN half. Drives a live turn the same way the sibling suite does
  // (useChat.test.tsx: "an externally-started turn ... busy is true between start and end" — turn start,
  // then a streamed `message` frame), races the reconcile's mismatch rebuild against it, and asserts `busy`
  // (the harness's live-turn UI signal — spinner/status derive from it) survives the rebuild untouched,
  // because `replaceFromDisk` (useChat.ts's D16 comment) touches only the document/lastAssistant/stamp ref,
  // never `busy`/`liveTurnRef`. It then pushes a further frame of the SAME turn to prove the turn is still
  // event-owned and rendering — not just that the flag didn't flip — and closes the turn to IDLE.
  // Re-read for bl9 F1: the mismatch rebuild now DEFERS while a turn is open (disk has no row for it yet)
  // rather than firing mid-turn — so the invariant this test pins is stronger than before: not just that
  // `busy`/the live turn survive an immediate rebuild, but that no rebuild runs at all until the turn's own
  // `turn:end` re-arms it. The old scenario asserted the rebuild fired mid-turn and busy/liveTurn merely
  // rode through it untouched; that expectation encoded the very loss F1 fixed (a completed frame arriving
  // in that same window would have been silently dropped — see the F1 test above), so the scenario moves
  // the fresh-tail-reply wait to after `turn:end`, which the deferral design satisfies more strongly: the
  // rebuild races nothing at all, because it only ever runs once the turn has fully closed.
  it("A2: an in-flight turn's live state survives the mismatch reconcile, and the deferred rebuild fires only at turn end", async () => {
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
    session.resolveReady();                          // the follow ack lands mid-turn → the mismatch is found but deferred, not fired
    await new Promise((r) => setTimeout(r, 30));      // long enough for a stray mid-turn rebuild to land
    expect(frame(lastFrame)).toContain("BUSY");       // the live turn's UI state is untouched — nothing rebuilt yet
    expect(frame(lastFrame)).toContain("live turn frame one");
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");   // deferred: no rebuild has run
    // The turn is still event-owned: a later frame of the SAME turn still renders.
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "live turn frame two" }] } } });
    await waitFor(() => frame(lastFrame).includes("live turn frame two"));
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    // `turn:end` re-arms the deferred reconcile, which re-reads disk and now rebuilds.
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
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

  // F1 (bl9 round): disk only gains a turn's rows AT TURN END (probe 62) — a COMPLETED assistant message
  // that already arrived live and rendered mid-turn is not on disk yet, so the mismatch rebuild used to
  // discard it silently by replacing the document wholesale from a disk read that predates it. The fix is
  // DEFERRAL: a mismatch found while a turn is open re-arms for that turn's OWN end instead of firing now —
  // the turn's completion is what writes it to disk, so the deferred re-read catches it. `afterTurnEnd`
  // stands in for "disk now has the turn's rows": before it flips, disk has only the pre-turn tail; after,
  // it also carries the completed message, exactly as a real host's turn-end flush would.
  it("F1: a COMPLETED assistant message delivered mid-turn survives because the mismatch rebuild defers to turn end", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
    const freshRowsBeforeEnd = diskRows("a-fresh", "the fresh tail reply");
    const freshRowsAfterEnd = [...freshRowsBeforeEnd, { type: "assistant", parent_tool_use_id: null, uuid: "live-1", message: { content: [{ type: "text", text: "COMPLETED-BEFORE-REBUILD" }] } }];
    let afterTurnEnd = false;
    const session = fakeAttachSession({ sessionId: "sess-1" });
    const deps = { getSessionMessages: async () => (afterTurnEnd ? freshRowsAfterEnd : freshRowsBeforeEnd) };
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
    session.resolveReady();                         // the follow ack lands mid-turn — the mismatch rebuild must defer, not fire
    await new Promise((r) => setTimeout(r, 30));     // long enough for a stray mid-turn rebuild to land
    expect(frame(lastFrame)).toContain("COMPLETED-BEFORE-REBUILD");   // still there — nothing rebuilt yet
    expect(frame(lastFrame)).not.toContain("the fresh tail reply");   // and the deferred rebuild hasn't fired either
    afterTurnEnd = true;                             // disk now has the turn's rows (the real turn-end flush)
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));   // the deferred reconcile fired
    expect(frame(lastFrame)).toContain("COMPLETED-BEFORE-REBUILD");   // and the re-read disk now carries it — nothing lost
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

  // D16 (pinned per the fix-wave review): the mismatch rebuild is the document-only `replaceFromDisk` core,
  // deliberately narrow — it must never touch `taskListRef`/`setTasks` (or bgHarvest), unlike a real rewind's
  // rebuild. The reviewer's mutation test — adding `taskListRef.current.reset(); setTasks([]);` into
  // `replaceFromDisk` — survived all 215 tests in the suite, meaning nothing pinned the constraint. This does.
  it("D16 regression: live task state seeded before the mismatch rebuild survives it", async () => {
    const staleRows = diskRows("a-stale", "the stale tail reply");
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
    // Seed live task state the SAME way the sibling useChat suite does (useChat.test.tsx: "accumulates
    // tasks from a turn's frames") — a TaskCreate tool_use followed by its tool_result.
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    session.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } } });
    session.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created successfully: build it" }] } } });
    session.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => tasks.length === 1);
    session.resolveReady();                        // the follow ack lands → the reconcile fires its mismatch rebuild
    await waitFor(() => frame(lastFrame).includes("the fresh tail reply"));
    expect(tasks).toEqual([{ id: "1", subject: "build it", status: "pending" }]);
  });
});
