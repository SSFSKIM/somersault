// tui/test/useChat.test.tsx
import { describe, it, expect } from "vitest";
import React, { useEffect } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { createUiBroker } from "../src/uiBroker.js";
import { useChat, type ChatSession } from "../src/useChat.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function fakeSession(overrides: Partial<ChatSession> = {}): ChatSession & { disposed: number } {
  const s: any = { disposed: 0,
    async submit(_p: string, onMessage: (m: unknown) => void) { onMessage({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }); return { result: "done" }; },
    async setPermissionMode() {}, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
    async dispose() { s.disposed++; }, sessionId: "sess-1", ...overrides };
  return s;
}
function Host({ makeSession, ui, prompt }: { makeSession: () => ChatSession; ui: ReturnType<typeof createUiBroker>; prompt?: string }) {
  const c = useChat(makeSession, ui);
  useEffect(() => { if (prompt) c.submit(prompt); /* fire once */ }, []); // eslint-disable-line
  return <Text>{c.state.pending ? `PENDING:${c.state.pending.req.toolName}` : c.state.busy ? "BUSY" : "IDLE"} m:{c.state.model ?? "-"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
}

describe("uiBroker", () => {
  it("denies a request when no handler is set yet", async () => {
    expect(await createUiBroker().broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal })).toEqual({ kind: "deny" });
  });
});

describe("useChat", () => {
  it("streams a submitted turn into the transcript", async () => {
    const { lastFrame } = render(<Host makeSession={() => fakeSession()} ui={createUiBroker()} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("working"));
    expect(lastFrame()).toContain("working");
  });
  it("surfaces a broker request as pending state", async () => {
    const ui = createUiBroker();
    const { lastFrame } = render(<Host makeSession={() => fakeSession()} ui={ui} />);
    await new Promise((r) => setTimeout(r, 20)); // let the mount effect set the handler
    void ui.broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal });
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    expect(lastFrame()).toContain("PENDING:Edit");
  });
  it("streams partial frames live and captures the model from the assistant frame", async () => {
    const fake = fakeSession({ async submit(_p: string, onMessage: (m: unknown) => void) {
      onMessage({ type: "stream_event", event: { type: "message_start" } });
      onMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
      onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINE" } } });
      onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CONE" } } });
      onMessage({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "PINECONE" }] } });
      return { result: "PINECONE" };
    } });
    const { lastFrame } = render(<Host makeSession={() => fake} ui={createUiBroker()} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("PINECONE") && frame(lastFrame).includes("m:claude-sonnet-4-6"));
    expect(lastFrame()).toContain("PINECONE");
    expect(lastFrame()).toContain("m:claude-sonnet-4-6");
  });
  it("settles a parked permission promise → deny on unmount, and disposes the session exactly once", async () => {
    const ui = createUiBroker();
    const session = fakeSession();
    const { unmount } = render(<Host makeSession={() => session} ui={ui} />);
    await new Promise((r) => setTimeout(r, 20));
    let decided: PermissionDecision | undefined;
    void ui.broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal }).then((d) => { decided = d; });
    await new Promise((r) => setTimeout(r, 20));
    unmount();
    await waitFor(() => decided !== undefined);
    expect(decided).toEqual({ kind: "deny" });
    expect(session.disposed).toBe(1);
  });
});
