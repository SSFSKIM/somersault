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
    async setPermissionMode() {}, async setModel() {}, async compact() { return { ok: true, preTokens: 0, postTokens: 0 }; },
    async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
    async dispose() { s.disposed++; }, sessionId: "sess-1", ...overrides };
  return s;
}
function Host({ makeSession, ui, prompt }: { makeSession: () => ChatSession; ui: ReturnType<typeof createUiBroker>; prompt?: string }) {
  const c = useChat(makeSession, ui);
  useEffect(() => { if (prompt) c.submit(prompt); /* fire once */ }, []); // eslint-disable-line
  return <Text>{c.state.pending ? `PENDING:${c.state.pending.req.toolName}` : c.state.busy ? "BUSY" : "IDLE"} m:{c.state.model ?? "-"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
}

function CmdHost({ makeSession, api }: { makeSession: () => ChatSession; api: { run?: (s: string) => void } }) {
  const c = useChat(makeSession, createUiBroker());
  api.run = c.submit;
  return <Text>{c.state.busy ? "BUSY" : "IDLE"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
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

  it("/resume → pick fetches the transcript and replays it (old session disposed)", async () => {
    let disposed = 0; let calls = 0;
    const oldSession = fakeSession({ async dispose() { disposed++; } });
    const newSession = fakeSession();
    const makeSession = (resume?: string) => { calls++; return resume ? newSession : oldSession; };
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    function ResumeHost() {
      const c = useChat(makeSession, createUiBroker(), {}, deps);
      pick = (c as any).pickSession;
      (ResumeHost as any).run = c.submit;
      return <Text>{c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
    }
    const { lastFrame } = render(<ResumeHost />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    (ResumeHost as any).run("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });
    await waitFor(() => frame(lastFrame).includes("› prior prompt"));
    await waitFor(() => frame(lastFrame).includes("resumed here · live"));
    await waitFor(() => disposed === 1);
    expect(disposed).toBe(1);
    expect(calls).toBe(2);                    // initial makeSession() + resumeInto's makeSession(id)
  });

  it("initialResume {kind:'id'} replays the session on mount", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "launch prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [], getSessionMessages: async () => msgs };
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), { initialResume: { kind: "id", id: "abc12345" } }, deps); return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => (lastFrame() ?? "").includes("launch prompt"));
    expect(lastFrame() ?? "").toContain("resumed here · live");
  });
  it("/continue resumes the most-recent session", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "recent work" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "s-old", summary: "", lastModified: 1 }, { sessionId: "s-new", summary: "", lastModified: 9 }], getSessionMessages: async (id: string) => (id === "s-new" ? msgs : []) };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), {}, deps); api.run = c.submit; return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("recent work"));
  });
  it("/continue with no sessions shows a notice", async () => {
    const deps = { listSessions: async () => [], getSessionMessages: async () => [] };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((r?: string) => fakeSession(), createUiBroker(), {}, deps); api.run = c.submit; return <Text>{c.state.lines.map((l) => l.text).join("|")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("No sessions to continue"));
  });

  it("dispatches /model, /compact, /context, /clear, /help locally — never to the model", async () => {
    let submitted = 0, modelSet = "";
    const fake = fakeSession({
      async submit() { submitted++; return { result: "x" }; },
      async setModel(m?: string) { modelSet = m ?? ""; },
      async compact() { return { ok: true, preTokens: 9000, postTokens: 2000 }; },
      async getContextUsage() { return { totalTokens: 50, maxTokens: 200 }; },
    });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/model opus");   await waitFor(() => frame(lastFrame).includes("model → opus"));
    api.run!("/compact");      await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));
    api.run!("/context");      await waitFor(() => frame(lastFrame).includes("ctx 25%"));
    api.run!("/help");         await waitFor(() => frame(lastFrame).includes("/model"));
    api.run!("/zzz");          await waitFor(() => frame(lastFrame).includes("Unknown command: /zzz"));
    api.run!("/clear");        await waitFor(() => !frame(lastFrame).includes("Unknown command"));
    expect(modelSet).toBe("opus");
    expect(submitted).toBe(0);     // no slash command ever reached session.submit
  });

  it("accumulates tasks from a turn's frames and exposes them in state", async () => {
    const fake = fakeSession({ async submit(_p: string, onMessage: (m: unknown) => void) {
      onMessage({ type: "assistant", message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } });
      onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created successfully: build it" }] } });
      return { result: "done" };
    } });
    let tasks: any[] = [];
    function TaskHost() {
      const c = useChat(() => fake, createUiBroker());
      tasks = (c.state as any).tasks;
      (TaskHost as any).run = c.submit;
      return <Text>{tasks.map((t) => t.subject).join("|")}</Text>;
    }
    const { lastFrame } = render(<TaskHost />);
    await new Promise((r) => setTimeout(r, 20));
    (TaskHost as any).run("go");
    await waitFor(() => frame(lastFrame).includes("build it"));
    expect(tasks).toEqual([{ id: "1", subject: "build it", status: "pending" }]);
  });
});
