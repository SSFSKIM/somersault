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
});
