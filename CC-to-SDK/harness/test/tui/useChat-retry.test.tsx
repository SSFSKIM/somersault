// test/tui/useChat-retry.test.tsx — Wave T Task 12: the frames ALREADY arrive (session.ts → host.ts →
// chatAdapter.ts → useChat's message arm, verified in-tree); this pins that useChat now recognises them and
// exposes a retry status. Task 13 renders it — nothing here asserts on chrome.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
const retryFrame = (over: Record<string, unknown> = {}) => ({
  type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 563, error_status: null, error: "unknown", ...over,
});

describe("useChat: system/api_retry frames drive a live retry status", () => {
  it("an api_retry frame exposes the status; it clears on the next real message and on turn end", async () => {
    const fake = fakeRemote();
    function H() {
      const c = useChat(() => fake);
      const r = c.state.retryStatus;
      // FSW T3: read the WHOLE finalized projection, not just its committed head. `staticItems` is now only
      // the part that has left the live window and been written into <Static>; `finalizedItems` is the transcript
      // these content assertions are actually about.
      const rows = [...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines).join("|");
      return <Text>{r?.kind === "retrying" ? `RETRY:${r.attempt}/${r.maxRetries}:${r.label}` : "NORETRY"} [{rows}]</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 1 }) });
    await waitFor(() => frame(lastFrame).includes("RETRY:1/10:API error"));
    // NON-GOAL pin: live-turn chrome, never a transcript row — a ten-attempt ladder must not print ten rows.
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 3, error_status: 401, error: "authentication_failed", retry_delay_ms: 2413 }) });
    await waitFor(() => frame(lastFrame).includes("RETRY:3/10:Authentication failed"));
    expect(frame(lastFrame)).toContain("[]");   // the whole transcript, still empty

    // Nothing announces "the retry succeeded" (probe 96) — the next non-retry frame is what tears it down.
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "recovered" }] } } });
    await waitFor(() => frame(lastFrame).includes("NORETRY"));
    expect(frame(lastFrame)).toContain("recovered");

    // …and a turn that ends mid-ladder (the SDK throws after exhaustion) leaves no stale status behind.
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 4 }) });
    await waitFor(() => frame(lastFrame).includes("RETRY:4/10"));
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("NORETRY"));
  });

  it("a first stream_event delta clears the status — the answer that finally arrived is proof the API replied", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.retryStatus ? "RETRYING" : "NORETRY"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 2 }) });
    await waitFor(() => frame(lastFrame).includes("RETRYING"));
    fake.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } } } });
    await waitFor(() => frame(lastFrame).includes("NORETRY"));
  });

  it("an idle state frame clears a status left over from a follow replay", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.retryStatus ? "RETRYING" : "NORETRY"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", data: retryFrame({ attempt: 6 }), replay: true });
    await waitFor(() => frame(lastFrame).includes("RETRYING"));
    fake.pushEvent({ kind: "state", status: { state: "done", status: "idle" } });
    await waitFor(() => frame(lastFrame).includes("NORETRY"));
  });
});
