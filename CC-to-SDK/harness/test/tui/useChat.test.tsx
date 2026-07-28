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

// Ink hard-wraps a long single-line <Text> at the terminal width, inserting a real "\n" at whichever word
// boundary the reflow lands on — a boundary that shifts whenever earlier content in the SAME joined line
// grows or shrinks (e.g. the /help catalog gaining a command). De-wrap before substring checks so those
// checks assert on rendered CONTENT, not on an incidental wrap point.
const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function allText(c: { state: { lines: { text: string }[]; streaming: { text: string }[] } }): string {
  return [...c.state.lines, ...c.state.streaming].map((l) => l.text).join("|");
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

  it("mid-turn attach replay renders (turn start → messages → permission → state, no submit call); the idle-attach shape (messages, no start frame) renders NOTHING", async () => {
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

    // idle-attach shape: messages with NO preceding start frame → the no-live-turn guard (disk/buffer dedup)
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "GHOST" }] } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("IDLE");
    expect(frame(lastFrame)).not.toContain("GHOST");
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
    function BannerHost({ resume }: { resume?: boolean }) {
      const c = useChat(() => fakeRemote(), { initialLines: banner, ...(resume ? { initialResume: { kind: "continue" } as const } : {}) },
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
    api.run!("/model opus");   await waitFor(() => frame(lastFrame).includes("model → opus"));
    api.run!("/compact");      await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));
    api.run!("/context");      await waitFor(() => frame(lastFrame).includes("ctx 25%"));
    api.run!("/help");         await waitFor(() => frame(lastFrame).includes("/model"));
    api.run!("/zzz");          await waitFor(() => frame(lastFrame).includes("Unknown command: /zzz"));
    api.run!("/clear");        await waitFor(() => !frame(lastFrame).includes("Unknown command"));
    expect(modelSet).toBe("opus");
    expect(submitted).toBe(0);     // no slash command ever reached session.submit
  });

  it("clear() empties the transcript and fires the terminal clear-screen", async () => {
    let cleared = 0;
    const api: { run?: (s: string) => void; clear?: () => void } = {};
    function H() { const c = useChat(() => fakeRemote(), {}, { clearScreen: () => { cleared++; } }); api.run = c.submit; api.clear = c.clear; return <Text>L:{c.state.lines.length}</Text>; }
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

  it("resuming bumps clearToken (so the append-only <Static> remounts and shows the full replay)", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    let token = -1;
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "sess-9" } }, { getSessionMessages: async () => msgs, listSessions: async () => [] }); token = c.state.clearToken; return <Text>tok:{c.state.clearToken} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("prior"));   // replay landed
    expect(token).toBeGreaterThanOrEqual(1);                   // clearToken bumped by resumeInto
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
    api.run!("/model opus");   await waitFor(() => frame(lastFrame).includes("m:opus"));   // local cmd runs mid-turn
    expect(modelSet).toBe("opus");
    api.stop!();               await waitFor(() => !frame(lastFrame).includes("q:queued")); // interrupt clears queue
    release();
    expect(submits).toBe(1);   // the queued turn never ran (cleared on interrupt)
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
    expect(setModelCalls).toContain("claude-sonnet-4-6");
    expect(frame(lastFrame)).toContain("switched model to claude-sonnet-4-6");
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
    expect(set).toBe("sonnet");
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
  it("an assistant message with NO owning live turn (a ghost replay) is ignored — it must not leak into /copy either", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "GHOST-NEVER-SHOWN" }] } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("GHOST-NEVER-SHOWN");
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("nothing to copy"));   // the ghost text never reached lastAssistant
    expect(frame(lastFrame)).not.toContain("GHOST-NEVER-SHOWN");
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
