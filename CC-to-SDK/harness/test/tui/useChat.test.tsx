// tui/test/useChat.test.tsx — reworked onto the RemoteChat adapter surface (spec A2b Task 6): the host
// event stream is the single rendering source; submit is a command channel; permissions arrive via the
// feed. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real adapter's wire contract.
import { describe, it, expect } from "vitest";
import React, { useEffect } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import type { PermissionDecision } from "../../src/index.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { DecisionOutcome } from "../../src/permissions/types.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_FLAT, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";

// Ink hard-wraps a long single-line <Text> at the terminal width, inserting a real "\n" at whichever word
// boundary the reflow lands on — a boundary that shifts whenever earlier content in the SAME joined line
// grows or shrinks (e.g. the /help catalog gaining a command). De-wrap before substring checks so those
// checks assert on rendered CONTENT, not on an incidental wrap point.
const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// F1 Task 4: the transcript is `RenderItem[]` now — published Static rows, then the transient pending
// region, then the in-flight partial lines, in exactly the order a reader sees them.
const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
type ProjectedState = { state: { staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: { text: string }[] } };
function allText(c: ProjectedState): string {
  return [...[...c.state.staticItems, ...c.state.pendingItems].flatMap(itemLines), ...c.state.streaming.map((l) => l.text)].join("|");
}
function Host({ makeSession, prompt, initialPrompt }: { makeSession: () => ChatSession; prompt?: string; initialPrompt?: string }) {
  const c = useChat(makeSession, { initialPrompt });
  useEffect(() => { if (prompt) c.submit(prompt); /* fire once */ }, []); // eslint-disable-line
  return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : c.state.busy ? "BUSY" : "IDLE"} m:{c.state.model ?? "-"} {allText(c)}</Text>;
}

function CmdHost({ makeSession, api }: { makeSession: () => ChatSession; api: { run?: (s: string) => void } }) {
  const c = useChat(makeSession);
  api.run = c.submit;
  return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
}

describe("useChat: the host event stream is the single rendering source", () => {
  it("an externally-started turn (no submit call) renders streaming lines and lands in the transcript; busy is true between start and end", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));   // let mount effects subscribe
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "hello from elsewhere" }] } } });
    await waitFor(() => frame(lastFrame).includes("hello from elsewhere"));
    expect(frame(lastFrame)).toContain("BUSY");                  // still busy — the turn hasn't ended
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    expect(frame(lastFrame)).toContain("hello from elsewhere");  // finalized into the transcript
  });

  it("submit('hi') echoes the prompt line, and the turn renders from EVENTS (the fake's onMessage passthrough is inert)", async () => {
    let capturedOnMessage: ((m: unknown) => void) | undefined;
    let fake!: FakeRemote;
    fake = fakeRemote({
      async submit(_prompt, onMessage) {
        capturedOnMessage = onMessage;
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        onMessage({ type: "assistant", message: { content: [{ type: "text", text: "SHOULD-NOT-RENDER-VIA-CALLBACK" }] } });   // onMessage-only — NOT routed
        fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "VIA-EVENTS" }] } } });  // the real path
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("VIA-EVENTS"));
    expect(frame(lastFrame)).toContain("› hi");
    expect(frame(lastFrame)).toContain("VIA-EVENTS");
    expect(frame(lastFrame)).not.toContain("SHOULD-NOT-RENDER-VIA-CALLBACK");   // onMessage callback is a no-op passthrough
    expect(typeof capturedOnMessage).toBe("function");
  });

  it("mid-turn attach replay renders (turn start → messages → permission → state, no submit call); an idle completed record still lands in the retained transcript", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.busy ? "BUSY" : "IDLE"} {c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NOPEND"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    // the exact replay shape a mid-turn joiner now gets (plan-review finding 2's client half)
    fake.pushEvent({ kind: "turn", phase: "start", seq: 7 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "first" }] } } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "second" }] } } });
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t9", toolName: "Read", kind: "permission", input: { file_path: "x" }, createdAt: Date.now() };
    fake.pushEvent({ kind: "decision", entry });
    fake.pushEvent({ kind: "state", status: { state: "working", status: "busy" } });
    await waitFor(() => frame(lastFrame).includes("BUSY") && frame(lastFrame).includes("PENDING:Read"));
    expect(frame(lastFrame)).toContain("first");
    expect(frame(lastFrame)).toContain("second");
    // settle this turn so it doesn't leak into the next assertion
    fake.pushEvent({ kind: "turn", phase: "end", seq: 7 });
    fake.settlePermission("t9", "system", "deny");
    await waitFor(() => frame(lastFrame).includes("IDLE") && frame(lastFrame).includes("NOPEND"));

    // Idle-attach shape: a COMPLETED record with no preceding start frame. F1 Task 4 retains it — a
    // completion landing in the disk-read/follow window is real history, and identity dedup (not a
    // no-live-turn guard) is what stops a redelivered copy showing twice — while busy stays false.
    const late = { type: "assistant", message: { id: "late-1", content: [{ type: "text", text: "LATE-COMPLETION" }] } };
    fake.pushEvent({ kind: "message", data: late });
    await waitFor(() => frame(lastFrame).includes("LATE-COMPLETION"));
    expect(frame(lastFrame)).toContain("IDLE");
    fake.pushEvent({ kind: "message", data: late });                      // the same record redelivered
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame).match(/LATE-COMPLETION/g)).toHaveLength(1);   // published exactly once
  });

  it("a synthetic close with NO live turn (an idle host dying) surfaces a notice instead of nothing (F5)", async () => {
    // Without this, an idle attached client gets no indication at all that its host died — the next
    // submit just fails ~10s later with the generic "host did not answer" timeout line.
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "end", error: "host connection closed" });   // no seq, no preceding start
    await waitFor(() => frame(lastFrame).includes("connection lost"));
    expect(frame(lastFrame)).toContain("host connection closed");
    expect(frame(lastFrame)).toContain("IDLE");   // busy untouched — it was already false
  });
});

describe("useChat: permission feed", () => {
  it("a parked permission arriving via the feed opens the dialog; answering calls answerDecision with the entry's toolUseID; alreadyAnsweredBy clears the dialog and appends a notice", async () => {
    let fake!: FakeRemote;
    fake = fakeRemote({
      async answerDecision(toolUseID, outcome) {
        fake.settlePermission(toolUseID, "eve", outcome.kind);
        return { ok: true, alreadyAnsweredBy: "eve" };
      },
    });
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t1", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() };
    const api: { resolve?: (d: PermissionDecision) => void } = {};
    function H() { const c = useChat(() => fake); api.resolve = c.resolveDecision; return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    api.resolve!({ kind: "allow_once" });
    expect(fake.answeredCalls).toEqual([{ toolUseID: "t1", decision: { kind: "allow_once" } }]);
    await waitFor(() => frame(lastFrame).includes("NONE"));
    await waitFor(() => frame(lastFrame).includes("answered by eve"));
  });

  it("a rejecting answerDecision (host death mid-dialog, or a wedged host's deadline) appends a notice instead of crashing, and does NOT clear the dialog", async () => {
    // F1: this is the ONLY session call in useChat whose promise used to have no rejection handler at
    // all — an unhandled rejection here used to kill the whole attached REPL process.
    let fake!: FakeRemote;
    fake = fakeRemote({ answerDecision: async () => { throw new Error("host connection closed"); } });
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t7", toolName: "Bash", kind: "permission", input: { command: "rm -rf /" }, createdAt: Date.now() };
    const api: { resolve?: (d: PermissionDecision) => void } = {};
    function H() { const c = useChat(() => fake); api.resolve = c.resolveDecision; return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:Bash"));
    api.resolve!({ kind: "allow_once" });
    await waitFor(() => frame(lastFrame).includes("answer failed"));
    expect(frame(lastFrame)).toContain("host connection closed");
    expect(frame(lastFrame)).toContain("PENDING:Bash");   // NOT cleared — the park may still be live host-side
  });

  it("settlePermission(...by:'system', decision:'deny') with no local answer clears the dialog and appends a notice", async () => {
    const fake = fakeRemote();
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t2", toolName: "Bash", kind: "permission", input: { command: "rm -rf /" }, createdAt: Date.now() };
    function H() { const c = useChat(() => fake); return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:Bash"));
    fake.settlePermission("t2", "system", "deny");
    await waitFor(() => frame(lastFrame).includes("NONE"));
    expect(frame(lastFrame)).toContain("denied by system");
  });

  it("unmount does NOT deny a pending remote permission — it stays parked (detach ≠ deny); the session is disposed exactly once", async () => {
    const fake = fakeRemote();
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t5", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    function H() { const c = useChat(() => fake); return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"}</Text>; }
    const { lastFrame, unmount } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.answeredCalls).toEqual([]);   // never answered/denied by teardown
    expect(fake.disposed).toBe(1);
  });

  // F0 KB5: detach moved off the Ctrl-Z chord onto /detach. ChatApp.tsx renders a decision dialog in the
  // SAME slot as ChatComposer, so a real pending permission structurally pre-empts typing "/detach" at
  // the integration level (chat.test.tsx's /detach test covers the reachable idle-composer flow) — calling
  // submit() directly here exercises handleCommand's "detach" case the same way regardless, and is the only
  // way to prove the "survives detaching" half of the old Ctrl-Z guarantee still holds on the new path.
  it("/detach calls opts.detach without answering a pending permission — it stays parked (detach ≠ deny)", async () => {
    const fake = fakeRemote();
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t6", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    let detachCalls = 0;
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, { detach: () => { detachCalls++; } }); api.run = c.submit; return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    api.run!("/detach");
    await waitFor(() => detachCalls === 1);
    expect(fake.answeredCalls).toEqual([]);              // unanswered — stays parked, never denied
    expect(frame(lastFrame)).toContain("PENDING:Edit");   // still parked after detach
  });

  it("three parked entries queue FIFO: dialog shows the head; answering advances to the next", async () => {
    let fake!: FakeRemote;
    fake = fakeRemote();
    const e1: PendingEntry = { sessionId: "s", toolUseID: "a", toolName: "Edit", kind: "permission", input: {}, createdAt: 1 };
    const e2: PendingEntry = { sessionId: "s", toolUseID: "b", toolName: "Write", kind: "permission", input: {}, createdAt: 2 };
    const api: { resolve?: (d: PermissionDecision) => void } = {};
    function H() { const c = useChat(() => fake); api.resolve = c.resolveDecision; return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolName}` : "NONE"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(e1);
    fake.parkPermission(e2);
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    api.resolve!({ kind: "allow_once" });
    await waitFor(() => frame(lastFrame).includes("PENDING:Write"));   // advanced to the queued entry
  });
});

describe("useChat: initial prompt", () => {
  it("initialPrompt submits exactly once on mount", async () => {
    let calls = 0;
    const fake = fakeRemote({ submit: async () => { calls++; return { result: "x" }; } });
    function H() { const c = useChat(() => fake, { initialPrompt: "do the thing" }); return <Text>{c.state.busy ? "BUSY" : "IDLE"}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });
});

describe("useChat", () => {
  it("streams a submitted turn into the transcript", async () => {
    const { lastFrame } = render(<Host makeSession={() => fakeRemote()} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });
  it("streams partial frames live and captures the model from the assistant frame", async () => {
    const fake = fakeRemote({ submitMessages: [
      { type: "stream_event", event: { type: "message_start" } },
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINE" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CONE" } } },
      { type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "PINECONE" }] } },
    ] });
    const { lastFrame } = render(<Host makeSession={() => fake} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("PINECONE") && frame(lastFrame).includes("m:claude-sonnet-4-6"));
    expect(lastFrame()).toContain("PINECONE");
    expect(lastFrame()).toContain("m:claude-sonnet-4-6");
  });
  it("seeds the welcome banner into the scrollback, but skips it when launching into a resume", async () => {
    const banner = [{ text: "✻ Welcome to Claude Code" }, { text: "  tips" }];
    const welcome = [{ kind: "local" as const, identity: "welcome", event: { kind: "notice" as const, lines: banner } }];
    function BannerHost({ resume }: { resume?: boolean }) {
      const c = useChat(() => fakeRemote(), { initialEntries: welcome, ...(resume ? { initialResume: { kind: "continue" } as const } : {}) },
        { listSessions: async () => [], getSessionMessages: async () => [] });
      return <Text>{allText(c)}</Text>;
    }
    const fresh = render(<BannerHost />);
    expect(frame(fresh.lastFrame)).toContain("✻ Welcome to Claude Code");
    const resumed = render(<BannerHost resume />);
    await new Promise((r) => setTimeout(r, 20));
    expect(frame(resumed.lastFrame)).not.toContain("✻ Welcome to Claude Code");
  });

  it("/resume → pick fetches the transcript and replays it (old session disposed)", async () => {
    let disposed = 0; let calls = 0;
    const oldSession = fakeRemote({ dispose: async () => { disposed++; } });
    const newSession = fakeRemote();
    const makeSession = (resume?: string) => { calls++; return resume ? newSession : oldSession; };
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    function ResumeHost() {
      const c = useChat(makeSession, {}, deps);
      pick = (c as any).pickSession;
      (ResumeHost as any).run = c.submit;
      return <Text>{c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {allText(c)}</Text>;
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

  it("/resume mid-turn is blocked (no session swap); a notice is appended; the queue drains once the ORIGINAL turn ends", async () => {
    // The old session's submit pushes a turn-start event and then NEVER resolves and NEVER pushes a
    // turn-end — the test pushes that manually, later, once it has proven the swap didn't happen.
    let oldFake!: FakeRemote;
    oldFake = fakeRemote({ submit: async () => { oldFake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise<{ result: unknown }>(() => {}); } });
    const newFake = fakeRemote();
    let calls = 0;
    const makeSession = (resume?: string) => { calls++; return resume ? newFake : oldFake; };
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(makeSession, {}, deps);
      pick = (c as any).pickSession;
      api.run = c.submit;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} q:{c.state.queue.join(",")} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    expect(calls).toBe(1);                                            // just the initial makeSession()

    api.run!("go");
    await waitFor(() => frame(lastFrame).includes("BUSY"));           // the old session's turn is now in flight

    api.run!("/resume");                                              // LOCAL_NAME → dispatched immediately even while busy
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });   // pick mid-turn
    await waitFor(() => frame(lastFrame).includes("cannot resume mid-turn"));

    expect(calls).toBe(1);                                            // (1) NO swap — resumeInto's makeSession(id) never ran
    expect(frame(lastFrame)).toContain("BUSY");                       // the old turn is untouched, still in flight
    expect(frame(lastFrame)).not.toContain("prior");                  // no replay landed either

    api.run!("queued prompt");                                        // (3a) queues behind the still-busy old turn
    await waitFor(() => frame(lastFrame).includes("q:queued prompt"));

    oldFake.pushEvent({ kind: "turn", phase: "end", seq: 1 });         // the ORIGINAL turn finally ends
    await waitFor(() => frame(lastFrame).includes("IDLE") || !frame(lastFrame).includes("q:queued prompt"));
    await waitFor(() => !frame(lastFrame).includes("q:queued prompt"));   // (3b) the queue drained
  });

  it("initialResume {kind:'id'} replays the session on mount", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "launch prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [], getSessionMessages: async () => msgs };
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "abc12345" } }, deps); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => (lastFrame() ?? "").includes("launch prompt"));
    expect(lastFrame() ?? "").toContain("resumed here · live");
  });
  it("/continue resumes the most-recent session", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "recent work" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "s-old", summary: "", lastModified: 1 }, { sessionId: "s-new", summary: "", lastModified: 9 }], getSessionMessages: async (id: string) => (id === "s-new" ? msgs : []) };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((_r?: string) => fakeRemote(), {}, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("recent work"));
  });
  it("/continue with no sessions shows a notice", async () => {
    const deps = { listSessions: async () => [], getSessionMessages: async () => [] };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((_r?: string) => fakeRemote(), {}, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("No sessions to continue"));
  });

  it("dispatches /model, /compact, /context, /clear, /help locally — never to the model", async () => {
    let submitted = 0, modelSet = "";
    const fake = fakeRemote({
      submit: async () => { submitted++; return { result: "x" }; },
      setModel: (m?: string) => { modelSet = m ?? ""; },
      compact: () => ({ ok: true, preTokens: 9000, postTokens: 2000 }),
      getContextUsage: () => ({ totalTokens: 50, maxTokens: 200 }),
      capabilities: () => ({ models: [{ value: "claude-opus-4-8", displayName: "Opus 4.8" }, { value: "sonnet", displayName: "Sonnet" }], commands: [], mcpServers: [] }),
    });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/model opus");   await waitFor(() => frame(lastFrame).includes("model → claude-opus-5"));
    api.run!("/compact");      await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));
    api.run!("/context");      await waitFor(() => frame(lastFrame).includes("ctx 25%"));
    api.run!("/help");         await waitFor(() => frame(lastFrame).includes("/model"));
    api.run!("/zzz");          await waitFor(() => frame(lastFrame).includes("Unknown command: /zzz"));
    api.run!("/clear");        await waitFor(() => !frame(lastFrame).includes("Unknown command"));
    expect(modelSet).toBe("claude-opus-5");     // tier alias resolved before setModel
    expect(submitted).toBe(0);     // no slash command ever reached session.submit
  });

  it("clear() empties the transcript and fires the terminal clear-screen", async () => {
    let cleared = 0;
    const api: { run?: (s: string) => void; clear?: () => void } = {};
    function H() { const c = useChat(() => fakeRemote(), {}, { clearScreen: () => { cleared++; } }); api.run = c.submit; api.clear = c.clear; return <Text>L:{c.state.staticItems.length}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("hi");  await waitFor(() => !frame(lastFrame).includes("L:0"));   // lines present
    api.clear!();    await waitFor(() => frame(lastFrame).includes("L:0"));    // emptied
    expect(cleared).toBe(1);
  });

  it("queues a turn submitted while busy and drains it (FIFO) when the turn ends", async () => {
    let release = () => {}; let submits = 0;
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async (_p, onMessage) => {
      submits++;
      const seq = submits;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      const m = { type: "assistant", message: { content: [{ type: "text", text: `reply${submits}` }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      await new Promise<void>((res) => { release = res; });
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.join(",")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("first");  await waitFor(() => frame(lastFrame).includes("BUSY"));
    expect(submits).toBe(1);
    api.run!("second"); await waitFor(() => frame(lastFrame).includes("q:second"));   // queued, NOT a 2nd submit
    expect(submits).toBe(1);
    release();           await waitFor(() => submits === 2);                           // turn ends → drains "second"
    expect(frame(lastFrame)).not.toContain("q:second");
    release();           // release the drained turn so it settles cleanly
  });

  it("drains PAST a queued unknown command (no stall) to a following turn", async () => {
    let release = () => {}; let submits = 0;
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async (_p, onMessage) => {
      submits++;
      const seq = submits;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      const m = { type: "assistant", message: { content: [{ type: "text", text: "r" }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      await new Promise<void>((res) => { release = res; });
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.join(",")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("first");  await waitFor(() => frame(lastFrame).includes("BUSY"));            // turn A (submits=1)
    api.run!("/zzz");   await waitFor(() => frame(lastFrame).includes("q:/zzz"));          // unknown command queued
    api.run!("second"); await waitFor(() => frame(lastFrame).includes("q:/zzz,second"));   // a turn queued BEHIND it
    release();          await waitFor(() => submits === 2);                                // A ends → drain /zzz (no turn) → re-drain → "second" runs
    release();
    expect(submits).toBe(2);
  });

  it("F2: a submit that rejects with 'busy' WHILE another client's turn is live does not clobber busy or drain", async () => {
    // Mirrors the cross-client refusal race: the OTHER client's turn-start event lands on our connection
    // (setting liveTurnRef non-null, busy true) BEFORE our own prompt's reply comes back refused — the
    // event-owned turn is still streaming and must own busy/drain, not this catch.
    let fake!: FakeRemote;
    fake = fakeRemote({
      submit: async () => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 99 });   // another client's turn just started
        throw new Error("host refused: busy");
      },
    });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("busy"));
    expect(frame(lastFrame)).toContain("BUSY");   // untouched — the OTHER turn is still streaming
  });

  it("F2: host death mid-turn (submit rejects AND the synthetic turn-end arrives) drains exactly once", async () => {
    let submits = 0;
    let rejectFirst!: (e: Error) => void;
    let fake!: FakeRemote;
    fake = fakeRemote({
      submit: async () => {
        submits++;
        if (submits === 1) {
          fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
          return new Promise<{ result: unknown }>((_resolve, reject) => { rejectFirst = reject; });
        }
        // the drained second prompt: a clean turn this time
        fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
        return { result: "ok" };
      },
    });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.join(",")}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("first");  await waitFor(() => frame(lastFrame).includes("BUSY"));
    expect(submits).toBe(1);
    api.run!("second"); await waitFor(() => frame(lastFrame).includes("q:second"));   // queued behind the in-flight first

    // Mirrors chatAdapter's onClose: the synthetic turn-end fires (the event arm owns busy/drain), and
    // the in-flight submit's promise ALSO rejects — the SAME host death, on two channels.
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1, error: "host connection closed" });
    rejectFirst(new Error("host connection closed"));

    await waitFor(() => submits === 2);           // the queued "second" drained exactly once
    await new Promise((r) => setTimeout(r, 50));   // give a wrongly-doubled drain time to fire
    expect(submits).toBe(2);                       // still exactly 2 — no double-dispatch
  });

  it("resuming a DIFFERENT session bumps staticEpoch (so a fresh <Static> mounts and shows the full replay)", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    let token = -1;
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "sess-9" } }, { getSessionMessages: async () => msgs, listSessions: async () => [] }); token = c.state.staticEpoch; return <Text>tok:{c.state.staticEpoch} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("prior"));   // replay landed
    expect(token).toBeGreaterThanOrEqual(1);                   // staticEpoch bumped by resumeInto's terminal boundary
  });

  it("Wave 2 final-review F2: a /resume swap clears stale bgTasks from the OLD engine (no ghost ⟳ running rows)", async () => {
    // The old session's bg tasks died with its engine; no `tasks_changed:[]` correction can ever arrive
    // post-swap (the old subscription is detached, and the new host's follow() only replays a NON-EMPTY
    // snapshot) — so resumeInto itself must clear bgTasks, or the panel/killAgents keep pointing at a
    // dead engine's task ids forever.
    const oldSession = fakeRemote();
    const newSession = fakeRemote();
    const makeSession = (resume?: string) => (resume ? newSession : oldSession);
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(makeSession, {}, deps);
      pick = (c as any).pickSession;
      api.run = c.submit;
      return <Text>{c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} bg:{c.state.bgTasks.length}:{c.state.bgRows.length} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    oldSession.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep 99" }] });
    await waitFor(() => frame(lastFrame).includes("bg:1:1"));

    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });
    await waitFor(() => frame(lastFrame).includes("› prior prompt"));   // the swap landed

    expect(frame(lastFrame)).toContain("bg:0:0");   // no ghost ⟳ running row survives the swap
  });

  it("interrupt clears the queue; local commands run immediately even while busy", async () => {
    let release = () => {}; let submits = 0, modelSet = "";
    let fake!: FakeRemote;
    fake = fakeRemote({
      submit: async (_p, onMessage) => {
        submits++;
        const seq = submits;
        fake.pushEvent({ kind: "turn", phase: "start", seq });
        const m = { type: "assistant", message: { content: [{ type: "text", text: "x" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq });
        return { result: "done" };
      },
      setModel: (m?: string) => { modelSet = m ?? ""; },
    });
    const api: { run?: (s: string) => void; stop?: () => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.stop = c.interrupt; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.join(",")} m:{c.state.model ?? "-"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("turn");          await waitFor(() => frame(lastFrame).includes("BUSY"));
    api.run!("queued");        await waitFor(() => frame(lastFrame).includes("q:queued"));
    api.run!("/model opus");   await waitFor(() => frame(lastFrame).includes("m:claude-opus-5"));  // local cmd runs mid-turn
    expect(modelSet).toBe("claude-opus-5");                                                      // tier alias → id
    api.stop!();               await waitFor(() => !frame(lastFrame).includes("q:queued")); // interrupt clears queue
    release();
    expect(submits).toBe(1);   // the queued turn never ran (cleared on interrupt)
  });

  it("/exit and /quit leave the REPL through the host's exit hook, never the model", async () => {
    // Real Claude Code has /exit and /quit; ours answered "Unknown command: /exit" (pty-verified), so the
    // only way out was Ctrl-D / Ctrl-C twice. The command must reach the SAME exit the keys use.
    let submitted = 0, exits = 0;
    const fake = fakeRemote({ submit: async () => { submitted++; return { result: "x" }; } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, { cwd: "/proj", onExit: () => { exits++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/exit");
    await waitFor(() => exits === 1);
    api.run!("/quit");
    await waitFor(() => exits === 2);
    expect(submitted).toBe(0);
  });

  it("/detach without opts.detach (a loopback client) notices not-detachable, never the model", async () => {
    let submitted = 0;
    const fake = fakeRemote({ submit: async () => { submitted++; return { result: "x" }; } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, { cwd: "/proj" }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/detach");
    await waitFor(() => frame(lastFrame).includes("not detachable — run with --detachable, or ccx attach from another terminal"));
    expect(submitted).toBe(0);
  });

  it("! runs bash locally (injected) and # appends to memory — neither reaches the model", async () => {
    let submitted = 0, bashCmd = "", memNote = "", memCwd = "";
    const fake = fakeRemote({ submit: async () => { submitted++; return { result: "x" }; } });
    const deps = {
      runBash: async (cmd: string) => { bashCmd = cmd; return { code: 0, output: "file1\nfile2" }; },
      appendMemory: (note: string, cwd: string) => { memNote = note; memCwd = cwd; return "/proj/CLAUDE.md"; },
    };
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, { cwd: "/proj" }, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("!ls -a");   await waitFor(() => frame(lastFrame).includes("file1"));
    expect(bashCmd).toBe("ls -a");
    expect(frame(lastFrame)).toContain("! ls -a");
    api.run!("#the parser lives in cli.ts");   await waitFor(() => frame(lastFrame).includes("noted in"));
    expect(memNote).toBe("the parser lives in cli.ts");
    expect(memCwd).toBe("/proj");
    expect(submitted).toBe(0);   // neither ! nor # ever reached the model
  });

  it("dispatches /cost (session.usage) and /status (local state) locally", async () => {
    let submitted = 0;
    const fake = fakeRemote({
      submit: async () => { submitted++; return { result: "x" }; },
      usage: () => ({ session: { total_cost_usd: 0.0123, total_duration_ms: 4200, model_usage: { "claude-opus-4-8": { inputTokens: 1200, outputTokens: 340, costUSD: 0.0123 } } }, subscription_type: null }),
    });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/cost");    await waitFor(() => frame(lastFrame).includes("$0.0123"));
    api.run!("/status");  await waitFor(() => frame(lastFrame).includes("Status"));
    expect(frame(lastFrame)).toContain("sess-1".slice(0, 8));   // /status shows the session id
    expect(submitted).toBe(0);
  });

  it("submit sets turnStartedAt and busy during the turn", async () => {
    let hung: (() => void) | null = null;
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); await new Promise<void>((r) => { hung = r; }); fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); return { result: "x" }; } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>{String(c.state.busy)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("hello");
    await waitFor(() => api.state.busy === true);
    expect(api.state.busy).toBe(true);
    expect(api.state.turnStartedAt).toBeGreaterThan(0);
    if (hung) (hung as () => void)();
  });

  it("a catalog command (not local) is submitted as a turn, not treated as unknown", async () => {
    const submitted: string[] = [];
    const fake = fakeRemote({
      capabilities: () => ({ models: [], commands: [{ name: "review", description: "review code" }], mcpServers: [] }),
      submit: async (p, onMessage) => { submitted.push(p); return { result: "ok" }; },
      submitMessages: [{ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }],
    });
    const api: { run?: (s: string) => void; state?: any } = {};
    // Read the catalog off c.state directly (not the wrapped <Text>): the comma-joined catalog string has
    // no spaces to wrap at, so ink's hard-wrap can land mid-word — exactly the "gaining a command" risk the
    // frame()/dewrap helper above warns about — and the /copy command (Task 9) is one more local entry that
    // shifts that boundary, so this test must not depend on where a line happens to wrap.
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>{(c.state as any).commandCatalog.map((e: any) => e.name).join(",")}</Text>; }
    render(<H />);
    await waitFor(() => api.state.commandCatalog.some((e: any) => e.name === "review"));   // wait for the init catalog fetch
    api.run!("/review");
    await waitFor(() => submitted.includes("/review"));
    expect(submitted).toContain("/review");
  });

  it("accumulates tasks from a turn's frames and exposes them in state", async () => {
    const fake = fakeRemote({ submitMessages: [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created successfully: build it" }] } },
    ] });
    let tasks: any[] = [];
    function TaskHost() {
      const c = useChat(() => fake);
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

describe("permission ladder", () => {
  function LadderHost({ makeSession, api }: { makeSession: () => ChatSession; api: { cyc?: () => void; run?: (s: string) => void } }) {
    const c = useChat(makeSession);
    api.cyc = c.cycleMode; api.run = c.submit;
    return <Text>mode:{c.state.mode} model:{c.state.model ?? "-"} {allText(c)}</Text>;
  }
  // Goal B acceptance ⑤ evidence (spec: docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md).
  it("Tab cycles default → acceptEdits → plan → auto → default (bypass off-cycle)", async () => {
    const setModeCalls: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { setModeCalls.push(m); } });
    const api: { cyc?: () => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:plan"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:default"));
    expect(setModeCalls).toEqual(["acceptEdits", "plan", "auto", "default"]);
  });
  it("entering auto on an unsupported model swaps to a supported one with a notice", async () => {
    const setModelCalls: (string | undefined)[] = [];
    const session = fakeRemote({ setModel: (m?: string) => { setModelCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/model claude-haiku-4-5");
    await waitFor(() => frame(lastFrame).includes("model:claude-haiku-4-5"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:plan"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    expect(setModelCalls).toContain("claude-sonnet-5");
    // Collapse whitespace: `frame` turns Ink's 80-col wrap into a space, and where that wrap lands
    // depends on the model-id LENGTH — this assertion used to pass only by accident of column width.
    expect(frame(lastFrame).replace(/\s+/g, " ")).toContain("switched model to claude-sonnet-5");
  });
  it("entering auto on a supported model does not swap the model", async () => {
    const setModelCalls: (string | undefined)[] = [];
    const session = fakeRemote({ setModel: (m?: string) => { setModelCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/model claude-opus-4-8");
    await waitFor(() => frame(lastFrame).includes("model:claude-opus-4-8"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:plan"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:auto"));
    expect(setModelCalls).toEqual(["claude-opus-4-8"]);
    expect(frame(lastFrame)).not.toContain("switched model");
  });
  it("/yolo enables bypassPermissions; Tab from bypass returns to default", async () => {
    const setModeCalls: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { setModeCalls.push(m); } });
    const api: { cyc?: () => void; run?: (s: string) => void } = {};
    const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    api.run!("/yolo");
    await waitFor(() => frame(lastFrame).includes("mode:bypassPermissions"));
    api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:default"));
    expect(setModeCalls).toEqual(["bypassPermissions", "default"]);
  });
  it("cycleMode after unmount is a no-op (early disposed guard)", async () => {
    const setModeCalls: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { setModeCalls.push(m); } });
    const api: { cyc?: () => void } = {};
    const { lastFrame, unmount } = render(<LadderHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("mode:default"));
    const cyc = api.cyc!;
    unmount();
    cyc();
    await new Promise((r) => setTimeout(r, 20));
    expect(setModeCalls).toEqual([]);
  });
});

describe("useChat: decisions, mode sync, bg tasks (Goal B task 7)", () => {
  it("a state event carrying permissionMode overwrites the local mode (host truth wins)", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>mode:{c.state.mode}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "state", status: { state: "working", status: "idle", permissionMode: "acceptEdits" } });
    await waitFor(() => frame(lastFrame).includes("mode:acceptEdits"));
  });

  it("a question decision parks into pending with its kind intact", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.pending ? `PENDING:${c.state.pending.kind}` : "NONE"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const entry: PendingEntry = { sessionId: "s", toolUseID: "q1", toolName: "AskUserQuestion", kind: "question", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:question"));
  });

  it("resolveDecision answers via answerDecision and clears only on the settle event", async () => {
    let fake!: FakeRemote;
    fake = fakeRemote({ async answerDecision() { return { ok: true }; } });   // deliberately does NOT auto-settle
    const entry: PendingEntry = { sessionId: "s", toolUseID: "q2", toolName: "AskUserQuestion", kind: "question", input: {}, createdAt: Date.now() };
    const api: { resolve?: (d: DecisionOutcome) => void } = {};
    function H() { const c = useChat(() => fake); api.resolve = c.resolveDecision; return <Text>{c.state.pending ? `PENDING:${c.state.pending.toolUseID}` : "NONE"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("PENDING:q2"));
    api.resolve!({ kind: "question_answer", answers: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.answeredCalls).toEqual([{ toolUseID: "q2", decision: { kind: "question_answer", answers: {} } }]);
    expect(frame(lastFrame)).toContain("PENDING:q2");    // still parked — the settle event hasn't landed yet
    fake.settlePermission("q2", "me", "question_answer");
    await waitFor(() => frame(lastFrame).includes("NONE"));
  });

  it("tasks_changed updates bgTasks; task frames render notices honoring skip_transcript", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>bg:{c.state.bgTasks.length} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep 99" }] });
    await waitFor(() => frame(lastFrame).includes("bg:1"));
    fake.pushEvent({ kind: "task", data: { type: "task_started", description: "reviewing", task_id: "t2" } });
    await waitFor(() => frame(lastFrame).includes("⚙ task started: reviewing"));
    fake.pushEvent({ kind: "task", data: { type: "task_notification", status: "completed", summary: "done", task_id: "t2" } });
    await waitFor(() => frame(lastFrame).includes("✓ task done: done"));
    fake.pushEvent({ kind: "task", data: { type: "task_started", description: "hidden", skip_transcript: true } });
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("hidden");
  });

  // Goal B acceptance ⑤ evidence (spec: docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md).
  it("/bg opens the panel; stopBgTask calls the session; settled decision notices name the kind action", async () => {
    const stopCalls: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopCalls.push(id); } });
    const api: { run?: (s: string) => void; stop?: (id: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.stop = c.stopBgTask; return <Text>panel:{String(c.state.bgPanelOpen)} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/bg");
    await waitFor(() => frame(lastFrame).includes("panel:true"));
    api.stop!("t9");
    await waitFor(() => stopCalls.includes("t9"));

    const entry: PendingEntry = { sessionId: "s", toolUseID: "p1", toolName: "ExitPlanMode", kind: "plan", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    fake.settlePermission("p1", "someone", "plan_approve");
    await waitFor(() => frame(lastFrame).includes("approved by someone"));
  });
});

// Wave 2 U2: killAgents double-press confirm + harvest-enriched bgRows.
describe("useChat: killAgents (Ctrl-X Ctrl-K) + bgRows", () => {
  it("killAgents with no bg tasks notices 'No background agents running'", async () => {
    const fake = fakeRemote();
    const api: { kill?: () => void } = {};
    function H() { const c = useChat(() => fake); api.kill = c.killAgents; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.kill!();
    await waitFor(() => frame(lastFrame).includes("No background agents running"));
  });

  it("killAgents arms on first press and stops ALL bg tasks on the second within 3s", async () => {
    const stopped: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopped.push(id); } });
    const api: { kill?: () => void } = {};
    function H() { const c = useChat(() => fake); api.kill = c.killAgents; return <Text>bg:{c.state.bgTasks.length} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "d1" }, { task_id: "t2", task_type: "bash", description: "d2" }] });
    await waitFor(() => frame(lastFrame).includes("bg:2"));
    api.kill!();
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-X Ctrl-K again to stop background agents"));
    expect(stopped).toEqual([]);                    // armed, nothing stopped yet
    api.kill!();
    await waitFor(() => stopped.length === 2);
    expect(stopped).toEqual(["t1", "t2"]);
  });

  it("bgRows carries command/outputFile harvested from message+task events", async () => {
    const fake = fakeRemote();
    let state: any;
    function H() { const c = useChat(() => fake); state = c.state; return <Text>{allText(c)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", input: { command: "echo hi", run_in_background: true } }] } } });
    fake.pushEvent({ kind: "task", data: { type: "system", subtype: "task_started", task_id: "b1", tool_use_id: "tu1", description: "d", task_type: "local_bash" } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", content: "Command running in background with ID: b1. Output is being written to: /tmp/x.output. Use BashOutput to check progress." }] } } });
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "b1", task_type: "local_bash", description: "d" }] });
    await waitFor(() => state.bgRows.length === 1);
    expect(state.bgRows).toHaveLength(1);
    expect(state.bgRows[0]).toMatchObject({ task_id: "b1", command: expect.stringContaining("echo"), outputFile: "/tmp/x.output", status: "running" });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
  });
});

describe("model picker", () => {
  it("/model with no arg opens the model picker from capabilities()", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "claude-opus-4-8", displayName: "Opus 4.8" }], commands: [], mcpServers: [] }) });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>{String(c.state.modelPicker.open)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await new Promise((r) => setTimeout(r, 0));
    expect(api.state.modelPicker.open).toBe(true);
    expect(api.state.modelPicker.models[0].value).toBe("claude-opus-4-8");
  });
  it("/model <name> keeps the free-text fast-path (no picker, setModel called)", async () => {
    let set = "";
    const fake = fakeRemote({ setModel: (m?: string) => { set = m ?? ""; } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model sonnet");
    await new Promise((r) => setTimeout(r, 0));
    expect(set).toBe("claude-sonnet-5");        // the tier word never reaches the engine

    expect(api.state.modelPicker.open).toBe(false);
  });
});

describe("useChat: compact divider + /copy (Task 9)", () => {
  it("a system/compact_boundary message event (mid-turn, like the real host emits it) appends the compacted divider", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary" } });
    await waitFor(() => frame(lastFrame).includes("context compacted"));
    expect(frame(lastFrame)).toContain("─── context compacted ───");
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
  });
  // F1 Task 4 inverts the old "no live turn ⇒ ignore" guard: a COMPLETED record landing in the disk-read/
  // follow window is real history, so it is retained and shown, and /copy follows what is on screen. A
  // REDELIVERED copy is suppressed by document identity dedup instead — which is what the guard was for.
  it("an assistant message with NO owning live turn is retained once and reaches /copy", async () => {
    const fake = fakeRemote();
    let copied: string | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const late = { type: "assistant", message: { id: "late-copy", content: [{ type: "text", text: "LATE-COMPLETION" }] } };
    fake.pushEvent({ kind: "message", data: late });
    await waitFor(() => frame(lastFrame).includes("LATE-COMPLETION"));
    fake.pushEvent({ kind: "message", data: late });                     // the same record redelivered
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame).match(/LATE-COMPLETION/g)).toHaveLength(1);
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("✓ copied"));
    expect(copied).toBe("LATE-COMPLETION");
  });

  it("/copy with no assistant text yet notices 'nothing to copy' and never calls the copy fn", async () => {
    let calls = 0;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("nothing to copy"));
    expect(calls).toBe(0);
  });

  it("/copy after an assistant message calls the injected copy fn with THAT text and notices ✓ copied", async () => {
    let copied: string | undefined;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", message: { content: [{ type: "text", text: "the answer is 42" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("the answer is 42"));
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("✓ copied"));
    expect(copied).toBe("the answer is 42");                          // the fn received the actual text, not just a call
    expect(frame(lastFrame)).toContain(`✓ copied ${"the answer is 42".length} chars`);
  });
});

describe("thinking control", () => {
  function ThinkHost({ makeSession, api }: { makeSession: () => ChatSession; api: { run?: (s: string) => void } }) {
    const c = useChat(makeSession);
    api.run = c.submit;
    return <Text>think:{c.state.thinkLevel} {allText(c)}</Text>;
  }
  it("/think <level> sets the thinking budget and updates the indicator", async () => {
    const budgets: (number | null)[] = [];
    const session = fakeRemote({ setMaxThinkingTokens: (n: number | null) => { budgets.push(n); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think high"); await waitFor(() => frame(lastFrame).includes("think:high"));
    expect(budgets).toEqual([16000]);
    expect(frame(lastFrame)).toContain("thinking → high");
  });
  it("/think off disables thinking via setMaxThinkingTokens(0)", async () => {
    const budgets: (number | null)[] = [];
    const session = fakeRemote({ setMaxThinkingTokens: (n: number | null) => { budgets.push(n); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think off"); await waitFor(() => frame(lastFrame).includes("think:off"));
    expect(budgets).toEqual([0]);
  });
  it("/think with no arg shows the current level; /think bogus errors", async () => {
    const session = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<ThinkHost makeSession={() => session} api={api} />);
    await waitFor(() => frame(lastFrame).includes("think:default"));
    api.run!("/think"); await waitFor(() => frame(lastFrame).includes("thinking: default"));
    api.run!("/think bogus"); await waitFor(() => frame(lastFrame).includes("unknown level"));
  });
});

describe("U1: catalogued client-side controls never become prompt turns", () => {
  // "config" used to be this test's client-side example; Wave 3 task 5 made /config a real LOCAL_NAME (a
  // dispatch-routable command, not a catalogued-but-client-side one), so it now takes the LOCAL_NAMES branch
  // of dispatch() instead of this one — "color" is still an honest-message-only control, so it now plays
  // the representative role "config" used to.
  it("/color prints the honest message and never submits; /review still submits as a turn", async () => {
    const submitted: string[] = [];
    const fake = fakeRemote({
      async submit(prompt: string) { submitted.push(prompt); return { result: "done" }; },
      async capabilities() {
        return { models: [], mcpServers: [], commands: [
          { name: "color", description: "Set prompt-bar color" },
          { name: "review", description: "Review a pull request" },
        ] };
      },
    } as any);
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 30));            // let the capabilities fetch land
    api.run!("/color");
    await waitFor(() => frame(lastFrame).includes("/color:"));
    expect(submitted).toHaveLength(0);                       // the model never saw it
    api.run!("/review my PR");
    await waitFor(() => submitted.length === 1);
    expect(submitted[0]).toBe("/review my PR");
  });
});

describe("U5a: /export /files /diff", () => {
  it("/export writes the markdown via the injected writer and reports the path", async () => {
    const writes: [string, string][] = [];
    const fake = fakeRemote();                               // fake's sessionId — check helper; set if settable
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: [{ type: "text", text: "hello" }] } }],
        writeFile: (p, t) => writes.push([p, t]),
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export");
    await waitFor(() => writes.length === 1);
    expect(writes[0][0]).toMatch(/conversation-.*\.md$/);
    expect(writes[0][1]).toContain("## › hello");
    await waitFor(() => frame(lastFrame).includes("exported"));
  });
  it("/files lists tool-touched paths; /diff shells out to git via runBash", async () => {
    const fake = fakeRemote();
    const bashCalls: string[] = [];
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionMessages: async () => [{ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Edit", input: { file_path: "/repo/z.ts" } }] } }],
        runBash: async (cmd) => { bashCalls.push(cmd); return { code: 0, output: " M z.ts" }; },   // BashResult shape (bash.ts:7)
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/files");
    await waitFor(() => frame(lastFrame).includes("/repo/z.ts"));
    api.run!("/diff");
    await waitFor(() => frame(lastFrame).includes("M z.ts"));
    expect(bashCalls[0]).toContain("git");
  });
  it("/export with no session notices instead of writing (no-session guard)", async () => {
    const fake = fakeRemote({ sessionId: undefined });
    const writes: [string, string][] = [];
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, { writeFile: (p, t) => writes.push([p, t]) });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export");
    await waitFor(() => frame(lastFrame).includes("no conversation to export"));
    expect(writes).toHaveLength(0);
  });
  it("/export clipboard copies the markdown via copyText and does not touch writeFile", async () => {
    const writes: [string, string][] = [];
    const copies: string[] = [];
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: [{ type: "text", text: "hello" }] } }],
        writeFile: (p, t) => writes.push([p, t]),
        copyText: async (t) => { copies.push(t); },
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export clipboard");
    await waitFor(() => copies.length === 1);
    expect(copies[0]).toContain("## › hello");
    expect(writes).toHaveLength(0);
    await waitFor(() => frame(lastFrame).includes("copied"));
  });
  it("/files with no session renders the honest empty line and does not throw", async () => {
    const fake = fakeRemote({ sessionId: undefined });
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake);
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => api.run!("/files")).not.toThrow();
    await waitFor(() => frame(lastFrame).includes("no files touched in this conversation yet"));
  });
});

describe("U5b: /rename /tag /session /stats", () => {
  it("/rename calls the lib and confirms; /tag toggles (same tag twice clears)", async () => {
    const renames: [string, string][] = []; const tags: [string, string | null][] = [];
    let currentTag: string | undefined;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        renameSession: async (id: string, t: string) => { renames.push([id, t]); },
        tagSession: async (id: string, t: string | null) => { tags.push([id, t]); currentTag = t ?? undefined; },
        getSessionInfo: async () => ({ summary: "s", tag: currentTag }) as any,
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/rename my session");
    await waitFor(() => renames.length === 1);
    expect(renames[0][1]).toBe("my session");
    api.run!("/tag sprint");
    await waitFor(() => tags.length === 1);
    expect(tags[0][1]).toBe("sprint");
    api.run!("/tag sprint");                                 // same tag again = clear (CC "toggle")
    await waitFor(() => tags.length === 2);
    expect(tags[1][1]).toBeNull();
    await waitFor(() => frame(lastFrame).includes("tag cleared"));
  });

  it("/rename with no args shows the current title without throwing", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => ({ customTitle: "existing title" }) as any });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => api.run!("/rename")).not.toThrow();
    await waitFor(() => frame(lastFrame).includes("existing title"));
  });

  it("/tag with no args shows the current tag without throwing", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionInfo: async () => ({ tag: "sprint" }) as any });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => api.run!("/tag")).not.toThrow();
    await waitFor(() => frame(lastFrame).includes("#sprint"));
  });

  it("/rename and /tag with no session notice instead of throwing", async () => {
    const fake = fakeRemote({ sessionId: undefined });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => api.run!("/rename x")).not.toThrow();
    await waitFor(() => frame(lastFrame).includes("no session yet"));
    expect(() => api.run!("/tag x")).not.toThrow();
    await waitFor(() => frame(lastFrame).match(/no session yet/g)!.length >= 2);
  });

  it("/session shows the id, title, tag and resume hint; notices with no session", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionInfo: async () => ({ summary: "s", customTitle: "bugfix", tag: "sprint" }) as any,
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/session");
    await waitFor(() => frame(lastFrame).includes("bugfix"));
    expect(frame(lastFrame)).toContain("#sprint");
    expect(frame(lastFrame)).toContain("ccx --resume");

    const fakeNoSession = fakeRemote({ sessionId: undefined });
    const api2: { run?: (s: string) => void } = {};
    function H2() { const c = useChat(() => fakeNoSession); api2.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame: lastFrame2 } = render(<H2 />);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => api2.run!("/session")).not.toThrow();
    await waitFor(() => frame(lastFrame2).includes("no session yet"));
  });

  it("/stats reports prompt/reply/tool-call counts and per-model token usage", async () => {
    const fake = fakeRemote({
      usage: () => ({ session: { total_cost_usd: 0.5, total_duration_ms: 65000, model_usage: {
        "claude-opus-5": { inputTokens: 1000, outputTokens: 200, costUSD: 0.5 } } } }),
    });
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionMessages: async () => [
          { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "fix it" }] } },
          { type: "assistant", message: { content: [
            { type: "text", text: "ok" },
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
          ] } },
        ],
      });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/stats");
    await waitFor(() => frame(lastFrame).includes("claude-opus-5"));
    expect(frame(lastFrame)).toContain("prompts");
  });
});

describe("Wave 2 final-review F1: loadHistory's scope-aware reader (out-of-project sessions)", () => {
  const entryFor = (id: string) => [{ type: "user", uuid: `u-${id}`, message: { content: [{ type: "text", text: `prompt-${id}` }] }, timestamp: "2026-07-28T08:00:00.000Z" }];

  it("scope 'session' reads the CURRENT session via the pinned getSessionMessages (never getSessionMessagesIn)", async () => {
    const fake = fakeRemote({ sessionId: "sess-1" });
    const pinnedCalls: string[] = [];
    const inCalls: unknown[] = [];
    let load!: (s: any) => Promise<any[]>;
    function H() {
      const c = useChat(() => fake, {}, {
        getSessionMessages: async (id: string) => { pinnedCalls.push(id); return entryFor(id); },
        getSessionMessagesIn: async (id: string, cwd?: string) => { inCalls.push({ id, cwd }); return entryFor(id); },
      });
      load = c.loadHistory; return <Text />;
    }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const entries = await load("session");
    expect(pinnedCalls).toEqual(["sess-1"]);
    expect(inCalls).toEqual([]);                 // scope "session" never touches the scope-aware reader
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].text).toBe("prompt-sess-1");
  });

  it("scope 'project' reads each listed session with the PROJECT cwd via getSessionMessagesIn", async () => {
    const fake = fakeRemote();
    const inCalls: { id: string; cwd: string | undefined }[] = [];
    let load!: (s: any) => Promise<any[]>;
    function H() {
      const c = useChat(() => fake, { cwd: "/proj" }, {
        listHistorySessions: async () => [{ sessionId: "a", summary: "", lastModified: 2 }, { sessionId: "b", summary: "", lastModified: 1 }],
        getSessionMessagesIn: async (id: string, cwd?: string) => { inCalls.push({ id, cwd }); return entryFor(id); },
      });
      load = c.loadHistory; return <Text />;
    }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const entries = await load("project");
    expect(inCalls).toEqual([{ id: "a", cwd: "/proj" }, { id: "b", cwd: "/proj" }]);
    expect(entries.length).toBe(2);               // both sessions' entries actually flowed back
  });

  it("scope 'everywhere' reads each listed session with an UNDEFINED cwd via getSessionMessagesIn — including an out-of-project session", async () => {
    const fake = fakeRemote();
    const inCalls: { id: string; cwd: string | undefined }[] = [];
    let load!: (s: any) => Promise<any[]>;
    function H() {
      const c = useChat(() => fake, { cwd: "/proj" }, {
        // "outside" stands in for a session from a DIFFERENT project — everywhere scope must still read it.
        listHistorySessions: async () => [{ sessionId: "outside", summary: "", lastModified: 5 }, { sessionId: "a", summary: "", lastModified: 2 }],
        getSessionMessagesIn: async (id: string, cwd?: string) => { inCalls.push({ id, cwd }); return entryFor(id); },
      });
      load = c.loadHistory; return <Text />;
    }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const entries = await load("everywhere");
    expect(inCalls).toEqual([{ id: "outside", cwd: undefined }, { id: "a", cwd: undefined }]);
    expect(entries.length).toBe(2);                // the out-of-project session's prompt actually came back
    expect(entries.map((e) => e.text)).toContain("prompt-outside");
  });
});

describe("U5a: /export path safety", () => {
  const msgs = async () => [{ type: "user", uuid: "u1", message: { content: [{ type: "text", text: "hello" }] } }];
  function mount(deps: Parameters<typeof useChat>[2]) {
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { cwd: "/repo" }, { getSessionMessages: msgs, ...deps });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    return { api, ...render(<H />) };
  }

  it("writes an absolute path where the user typed it, not re-rooted under cwd", async () => {
    const writes: [string, string][] = [];
    const { api } = mount({ writeFile: (p, t) => writes.push([p, t]), readFile: () => null });
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export /tmp/notes.md");
    await waitFor(() => writes.length === 1);
    expect(writes[0][0]).toBe("/tmp/notes.md");        // join() silently produced "/repo/tmp/notes.md"
  });

  it("refuses to truncate a file that is not one of our exports", async () => {
    const writes: [string, string][] = [];
    // writeFile TRUNCATES, so `/export package.json` used to destroy it with no prompt at all.
    const { api, lastFrame } = mount({ writeFile: (p, t) => writes.push([p, t]), readFile: () => '{\n  "name": "cc-harness"\n}' });
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export package.json");
    await waitFor(() => frame(lastFrame).includes("refusing to overwrite"));
    expect(writes).toEqual([]);
  });

  it("still overwrites a previous export, so re-exporting a growing conversation keeps working", async () => {
    const writes: [string, string][] = [];
    const { api } = mount({ writeFile: (p, t) => writes.push([p, t]), readFile: () => "# ccx conversation (abcd1234)\n\n## › older\n" });
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/export");
    await waitFor(() => writes.length === 1);
  });
});

describe("U3: the Tab ladder's `auto` rung only ever switches a model it knows", () => {
  async function cycleToAuto(api: { cycle?: () => void }, lastFrame: () => string | undefined) {
    for (const want of ["acceptEdits", "plan", "auto"]) {
      api.cycle!();
      await waitFor(() => frame(lastFrame).includes(`mode:${want}`));
    }
  }
  function mount(initialModel?: string) {
    const models: (string | undefined)[] = [];
    const api: { cycle?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote({ setModel: (m) => { models.push(m); } }), initialModel ? { initialModel } : {});
      api.cycle = c.cycleMode;
      return <Text>mode:{c.state.mode} model:{c.state.model ?? "-"} {allText(c)}</Text>;
    }
    return { models, api, ...render(<H />) };
  }

  it("leaves a seeded auto-capable launch model alone", async () => {
    const { models, api, lastFrame } = mount("claude-opus-5");
    await new Promise((r) => setTimeout(r, 20));
    await cycleToAuto(api, lastFrame);
    expect(models).toEqual([]);                                    // opus-5 supports auto — nothing to repair
    expect(frame(lastFrame)).toContain("model:claude-opus-5");
  });

  it("still repairs a seeded model that genuinely cannot run auto", async () => {
    const { models, api, lastFrame } = mount("claude-haiku-4-5-20251001");
    await new Promise((r) => setTimeout(r, 20));
    await cycleToAuto(api, lastFrame);
    expect(models).toEqual(["claude-sonnet-5"]);
    expect(frame(lastFrame)).toContain("doesn't support auto");
  });

  it("switches NOTHING when the model is unknown — an attach client must not downgrade the host's session", async () => {
    // `model` is undefined until a turn ENDS. Reaching the auto rung before that used to resolve the
    // unknown to DEFAULT_AUTO_MODEL and call setModel, quietly turning `ccx --model opus` into sonnet.
    const { models, api, lastFrame } = mount(undefined);
    await new Promise((r) => setTimeout(r, 20));
    await cycleToAuto(api, lastFrame);
    expect(models).toEqual([]);
    expect(frame(lastFrame)).toContain("can't check this client's model");
  });
});

describe("U5b: transcript-reading commands admit when a turn is still open", () => {
  it("/stats says the in-flight turn is missing (the SDK does not write the transcript mid-turn)", async () => {
    const fake = fakeRemote({ sessionId: "s1" });
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, { getSessionMessages: async () => [] });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start" } as any);       // a turn is now streaming
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/stats");
    await waitFor(() => frame(lastFrame).includes("in-flight turn isn't included"));
  });

  it("stays quiet when no turn is open", async () => {
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fakeRemote({ sessionId: "s1" }), {}, { getSessionMessages: async () => [] });
      api.run = c.submit; return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/stats");
    await waitFor(() => frame(lastFrame).includes("Session stats"));
    expect(frame(lastFrame)).not.toContain("in-flight turn");
  });
});

describe("useChat's own emitted lines carry semantic tokens, not ANSI literals", () => {
  const tok = (name: "error" | "bashBorder") => resolveThemeColor(themeTokens()[name]);
  function ColorHost({ makeSession, api, deps }: { makeSession: () => ChatSession; api: { run?: (s: string) => void; colors?: () => { text: string; color?: string }[] }; deps?: Parameters<typeof useChat>[2] }) {
    const c = useChat(makeSession, { cwd: "/proj" }, deps);
    api.run = c.submit;
    api.colors = () => [...[...c.state.staticItems, ...c.state.pendingItems].flatMap((i) => (i.kind === "line" ? [i.line] : i.body)), ...c.state.streaming];
    return <Text>{allText(c)}</Text>;
  }
  it("the ! echo reads `bashBorder` and a failed command's exit line reads `error`", async () => {
    const fake = fakeRemote();
    const deps = { runBash: async () => ({ code: 3, output: "" }) };
    const api: { run?: (s: string) => void; colors?: () => { text: string; color?: string }[] } = {};
    const { lastFrame } = render(<ColorHost makeSession={() => fake} api={api} deps={deps} />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("!boom");
    await waitFor(() => frame(lastFrame).includes("exit 3"));
    expect(api.colors!()).toContainEqual({ text: "! boom", color: tok("bashBorder") });
    expect(api.colors!()).toContainEqual({ text: "  exit 3", color: tok("error") });
  });
  it("a local command failure line reads `error`", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void; colors?: () => { text: string; color?: string }[] } = {};
    const { lastFrame } = render(<ColorHost makeSession={() => fake} api={api} />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/think nonsense-level");
    await waitFor(() => frame(lastFrame).includes("unknown level"));
    const bad = api.colors!().find((l) => l.text.startsWith("thinking: unknown level"));
    expect(bad!.color).toBe(tok("error"));
  });
});

// ── F1 Task 4: the retained-source cutover ────────────────────────────────────────────────────────────
/** Since Task 5c the default view collapses a contiguous read/search/list/MCP run into ONE summary row, and
 *  withholds it while the run is still growable — real assistant prose is what closes the run and publishes it. */
const CLOSING_PROSE = { type: "assistant", message: { id: "assistant-closes-run", content: [{ type: "text", text: "all done" }] } };
describe("useChat: one retained document behind every surface", () => {
  /** A fake repaint scheduler so a test can fire the 600 ms pending tick by hand and prove that no stale
   *  callback survives a settle, a session swap or an unmount. */
  function fakeScheduler() {
    const live: (() => void)[] = [];
    let ticks = 0;
    const schedule = (cb: () => void) => { live.push(cb); return () => { const i = live.indexOf(cb); if (i >= 0) live.splice(i, 1); }; };
    return { schedule, tick: () => { ticks++; for (const cb of [...live]) cb(); }, get armed() { return live.length; }, get ticks() { return ticks; } };
  }

  /** 5c follow-up: between "every member settled" and "a breaker closed the run" the row used to render
   *  NOWHERE — the active row had left the transient region and the settled row had not published. It now
   *  stays in the dynamic region, in its settled form, under its own id, and swaps into Static in one render. */
  it("keeps a settled-but-unclosed fold run visible in the dynamic region until a breaker publishes it", async () => {
    const fake = fakeRemote();
    let snap!: { staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[] };
    function H() {
      const c = useChat(() => fake);
      snap = { staticItems: c.state.staticItems, pendingItems: c.state.pendingItems };
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    await waitFor(() => snap.pendingItems.some((i) => i.id === "group:read-1:pending-row"));
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });                    // settles the ONLY member; nothing closes the run
    await waitFor(() => snap.pendingItems.some((i) => i.id === "group:read-1:unclosed-row"));
    expect(frame(lastFrame)).toContain("Read 1 file (ctrl+o to expand)");
    expect(frame(lastFrame)).not.toContain("Reading 1 file");                       // settled form, not the active one
    expect(snap.staticItems.filter((i) => i.id.startsWith("group:"))).toEqual([]);  // still unpublished — Static is append-only
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });                         // a turn boundary is NOT a breaker
    await waitFor(() => frame(lastFrame).includes("Read 1 file (ctrl+o to expand)"));
    expect(snap.pendingItems.map((i) => i.id)).toEqual(["group:read-1:unclosed-row"]);
    fake.pushEvent({ kind: "message", data: CLOSING_PROSE });                       // the breaker publishes it
    await waitFor(() => snap.staticItems.some((i) => i.id === "group:read-1:row"));
    expect(snap.pendingItems).toEqual([]);                                          // and the dynamic copy is gone the same render
    expect(frame(lastFrame).match(/Read 1 file \(ctrl\+o to expand\)/g)).toHaveLength(1);
  });

  it("renders ONE row for a complete call/result pair and keeps a typed composer draft live across a duplicate follow record", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    await waitFor(() => frame(lastFrame).includes("Reading 1 file"));     // Task 5c: the ACTIVE group row, transient
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });
    fake.pushEvent({ kind: "message", data: CLOSING_PROSE });             // real prose closes the run → the settled row publishes
    await waitFor(() => frame(lastFrame).includes("Read 1 file (ctrl+o to expand)"));
    fake.pushEvent({ kind: "message", data: READ_CALL });                 // the whole pair redelivered by a follow replay
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame).match(/Read 1 file/g)).toHaveLength(1);
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("after the duplicate");                                      // the command channel is still live
    await waitFor(() => frame(lastFrame).includes("› after the duplicate"));
  });

  it("publishes every stable RenderItem id exactly once — local visual, assistant text and divider alike", async () => {
    const fake = fakeRemote();
    let ids: string[] = [];
    function H() { const c = useChat(() => fake); ids = [...c.state.staticItems].map((i) => i.id); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const text = { type: "assistant", message: { id: "stable-text", content: [{ type: "text", text: "stable reply" }] } };
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: text });
    fake.pushEvent({ kind: "message", data: text });                      // exact duplicate
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true, seq: 4 });   // a divider-shaped local record, twice
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true, seq: 4 });
    await waitFor(() => frame(lastFrame).includes("stable reply") && frame(lastFrame).includes("Earlier live output unavailable"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(frame(lastFrame).match(/stable reply/g)).toHaveLength(1);
    expect(frame(lastFrame).match(/Earlier live output unavailable/g)).toHaveLength(1);
  });

  it("gives the SAME local visual action a fresh monotonic identity each time it is invoked, so two /help runs both render", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/help");
    await waitFor(() => frame(lastFrame).includes("/model"));
    const before = (frame(lastFrame).match(/› \/help/g) ?? []).length;
    api.run!("/help");
    await waitFor(() => (frame(lastFrame).match(/› \/help/g) ?? []).length === before + 1);
  });

  it("same-session /resume APPENDS only unseen persisted rows and keeps the pre-resume local event in detail-all", async () => {
    const msgs = [{ type: "user", uuid: "u-prior", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const fake = fakeRemote({ sessionId: "same-1" });
    const api: { run?: (s: string) => void; pick?: (s: any) => void; detail?: (p: "detail-all" | "detail-collapsed") => readonly RenderItem[] } = {};
    let epoch = -1, published: string[] = [];
    function H() {
      const c = useChat(() => fake, {}, { listSessions: async () => [{ sessionId: "same-1", summary: "s", lastModified: 1 }], getSessionMessages: async () => msgs });
      api.run = c.submit; api.pick = (c as any).pickSession; api.detail = c.detailItems;
      epoch = c.state.staticEpoch; published = [...c.state.staticItems].map((i) => i.id);
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("!echo local");
    await waitFor(() => frame(lastFrame).includes("! echo local"));
    const beforeIds = [...published];
    api.pick!({ sessionId: "same-1", summary: "s", lastModified: 1 });
    await waitFor(() => frame(lastFrame).includes("› prior prompt"));
    expect(epoch).toBe(0);                                        // NOT a terminal boundary: no fresh <Static>
    expect(published.slice(0, beforeIds.length)).toEqual(beforeIds);   // every earlier identity preserved
    expect(JSON.stringify(api.detail!("detail-all"))).toContain("! echo local");   // the local event survives into Ctrl-O detail
  });

  it("clears Static BEFORE the fresh projection publishes, so the final frame holds one copy of each retained row", async () => {
    const msgs = [{ type: "user", uuid: "u-r", message: { content: [{ type: "text", text: "restored prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const order: string[] = [];
    const fake = fakeRemote({ sessionId: "old-1" });
    const api: { run?: (s: string) => void; clear?: () => void } = {};
    function H() {
      const c = useChat(() => fake, { clearStaticTranscript: () => order.push(`clear@${c.state.staticEpoch}`) }, { listSessions: async () => [], getSessionMessages: async () => msgs });
      api.run = c.submit; api.clear = c.clear;
      return <Text>epoch:{c.state.staticEpoch} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/help");
    await waitFor(() => frame(lastFrame).includes("/model"));
    api.clear!();
    await waitFor(() => frame(lastFrame).includes("epoch:1"));
    expect(order).toEqual(["clear@0"]);                            // ran while the OLD epoch was still mounted
    expect(frame(lastFrame)).not.toContain("/model");             // the fresh <Static> did not replay history
  });

  it("stops the 600 ms pending repaint when the call settles, when the session is replaced, and on unmount", async () => {
    const scheduler = fakeScheduler();
    const first = fakeRemote(), second = fakeRemote();
    const msgs = [{ type: "user", uuid: "u-s", message: { content: [{ type: "text", text: "swapped" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const api: { pick?: (s: any) => void } = {};
    function H({ session }: { session: FakeRemote }) {
      const c = useChat(() => session, {}, { scheduleRepaint: scheduler.schedule, listSessions: async () => [], getSessionMessages: async () => msgs });
      api.pick = (c as any).pickSession;
      return <Text>{allText(c)}</Text>;
    }
    const view = render(<H session={first} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduler.armed).toBe(0);                              // nothing open yet
    first.pushEvent({ kind: "message", data: READ_CALL });
    await waitFor(() => frame(view.lastFrame).includes("Reading 1 file"));
    await waitFor(() => scheduler.armed === 1);                   // Ink discipline: effects subscribe one tick after the frame
    expect(scheduler.ticks).toBe(0);
    scheduler.tick();                                             // a real transient re-projection, no SDK event
    await new Promise((r) => setTimeout(r, 10));
    first.pushEvent({ kind: "message", data: READ_RESULT_WITH_SIDECAR });
    first.pushEvent({ kind: "message", data: CLOSING_PROSE });
    await waitFor(() => frame(view.lastFrame).includes("Read 1 file (ctrl+o to expand)"));
    expect(frame(view.lastFrame)).not.toContain("Reading 1 file");   // the active row left the transient region
    await waitFor(() => scheduler.armed === 0);                   // settled → the epoch is over
    expect(scheduler.armed).toBe(0);

    first.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "open-2", content: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/b.ts" } }] } } });
    await waitFor(() => scheduler.armed === 1);
    api.pick!({ sessionId: "other-1", summary: "s", lastModified: 1 });   // replace the session while a call is OPEN
    await waitFor(() => frame(view.lastFrame).includes("› swapped"));
    await waitFor(() => scheduler.armed === 0);                   // the swap disarmed the old epoch
    expect(scheduler.armed).toBe(0);
    view.unmount();
    expect(scheduler.armed).toBe(0);
  });

  it("a BARE truncated start is an idle tail replay: it never sets busy, records the gap once, and ends on the state frame", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true });          // BARE: no seq
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "tail-1", content: [{ type: "text", text: "retained idle tail" }] } } });
    fake.pushEvent({ kind: "state", status: { state: "working", status: "idle" } });
    await waitFor(() => frame(lastFrame).includes("retained idle tail"));
    expect(frame(lastFrame)).toContain("Earlier live output unavailable while attaching");
    expect(frame(lastFrame)).toContain("IDLE");                                // never busy — there is no later turn:end
    expect(frame(lastFrame).match(/Earlier live output unavailable/g)).toHaveLength(1);
  });

  // Round-1 review finding 1: a compact boundary is a SYSTEM frame, which the document never retains, so
  // document dedup cannot suppress a redelivered one — the divider's identity has to come from the boundary
  // itself.
  it("publishes ONE compacted divider when the same compact_boundary frame is redelivered", async () => {
    const fake = fakeRemote();
    let items: readonly RenderItem[] = [];
    function H() { const c = useChat(() => fake); items = c.state.staticItems; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const boundary = { type: "system", subtype: "compact_boundary", uuid: "compact-boundary-1" };
    fake.pushEvent({ kind: "message", data: boundary });
    await waitFor(() => frame(lastFrame).includes("context compacted"));
    fake.pushEvent({ kind: "message", data: boundary });                  // the same boundary, redelivered by a follow replay
    await new Promise((r) => setTimeout(r, 30));
    expect(items.flatMap(itemLines).filter((t) => t.includes("context compacted"))).toHaveLength(1);
  });

  // Round-1 review finding 2 (A): a turn that ends with a call still open leaves an ORPHAN. The document
  // keeps it verbatim (never a fabricated result), but nothing is running, so the blink epoch must end and
  // the transient row must go.
  it("ends the blink epoch and drops the pending row when a turn ENDS with a call still open", async () => {
    const scheduler = fakeScheduler();
    const fake = fakeRemote();
    let snap!: { pendingItems: readonly RenderItem[]; busy: boolean };
    function H() {
      const c = useChat(() => fake, {}, { scheduleRepaint: scheduler.schedule });
      snap = { pendingItems: c.state.pendingItems, busy: c.state.busy };
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    await waitFor(() => scheduler.armed === 1);
    expect(snap.pendingItems.length).toBeGreaterThan(0);
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });               // no tool_result ever arrives
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    await waitFor(() => scheduler.armed === 0);
    expect(snap.pendingItems).toEqual([]);
    expect(snap.busy).toBe(false);
  });

  // Round-1 review finding 2 (B): a disk bootstrap is history, not a live turn — a dangling `tool_use` read
  // off disk at attach must never blink or claim to be running.
  it("never arms the blink for a DANGLING tool_use that only the disk bootstrap carries", async () => {
    const scheduler = fakeScheduler();
    const fake = fakeRemote();
    let snap!: { pendingItems: readonly RenderItem[] };
    function H() {
      const c = useChat(() => fake, { initialEntries: [{ kind: "sdk", source: "disk", message: READ_CALL as unknown as Record<string, unknown> }] }, { scheduleRepaint: scheduler.schedule });
      snap = { pendingItems: c.state.pendingItems };
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 40));
    expect(scheduler.armed).toBe(0);
    expect(snap.pendingItems).toEqual([]);
    expect(frame(lastFrame)).not.toContain("Read(");
    expect(frame(lastFrame)).not.toContain("Reading 1 file");     // nor the Task 5c active group row
  });

  // Round-1 review finding 2 (D): settlement is per call, not per turn. Since the 5c follow-up an active
  // group row counts EVERY member of its run, a settled one included, so the row's membership id is no longer
  // a proxy for the live-open set — what a per-TURN settle would break is visible instead as the run flipping
  // to its settled form (the still-running call excluded from it) and the blink epoch dying with it.
  it("keeps a run ACTIVE and its blink epoch armed while only one of its two calls has settled", async () => {
    const scheduler = fakeScheduler();
    const fake = fakeRemote();
    let ids: string[] = [], rows: string[] = [];
    function H() {
      const c = useChat(() => fake, {}, { scheduleRepaint: scheduler.schedule });
      ids = [...c.state.pendingItems].map((i) => i.id);
      rows = [...c.state.pendingItems].flatMap(itemLines);
      return <Text>{allText(c)}</Text>;
    }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "assistant-2", content: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/src/b.ts" } }] } } });
    await waitFor(() => rows.some((r) => r.includes("Reading 2 files")));
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });          // settles read-1 only
    await new Promise((r) => setTimeout(r, 30));
    expect(ids.filter((i) => i.endsWith(":pending-row"))).toHaveLength(1);
    expect(ids.every((i) => i.includes("read-1") && i.includes("read-2"))).toBe(true);
    expect(rows.some((r) => r.includes("Reading 2 files"))).toBe(true);   // still the ACTIVE form
    expect(scheduler.armed).toBe(1);                                      // read-2 keeps the epoch alive
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "user-result-b", message: { content: [{ type: "tool_result", tool_use_id: "read-2", content: "b", is_error: false }] } } });
    await waitFor(() => rows.some((r) => r.includes("Read 2 files (ctrl+o to expand)")));
    await waitFor(() => scheduler.armed === 0);                           // both settled → the epoch is over
    expect(ids.every((i) => i.endsWith(":unclosed-row"))).toBe(true);     // and the run waits for a breaker, visibly
  });

  it("a truncated start WITH a numeric seq is a live mid-turn replay: gap record, LiveTurn, busy", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true, seq: 12 });
    await waitFor(() => frame(lastFrame).includes("BUSY") && frame(lastFrame).includes("Earlier live output unavailable while attaching"));
    fake.pushEvent({ kind: "turn", phase: "end", seq: 12 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
  });
});
