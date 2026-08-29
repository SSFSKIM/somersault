// tui/test/useChat.test.tsx — reworked onto the RemoteChat adapter surface (spec A2b Task 6): the host
// event stream is the single rendering source; submit is a command channel; permissions arrive via the
// feed. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real adapter's wire contract.
import { describe, it, expect } from "vitest";
import React, { useEffect } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import type { ComposerSubmission, PastedMap } from "../../src/tui/editor.js";
import { needsModelConfirm } from "../../src/tui/modelConfirmModel.js";
import type { PermissionDecision } from "../../src/index.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { DecisionOutcome } from "../../src/permissions/types.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";
import type { ContextBindings } from "../../src/tui/keys/bindings.js";
import { READ_CALL, READ_RESULT_FLAT, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendHistory } from "../../src/tui/promptHistory.js";
import { savePrefs } from "../../src/tui/prefs.js";
import { IMAGE_VERSION_SKEW_NOTICE } from "../../src/client/chatAdapter.js";

// Ink hard-wraps a long single-line <Text> at the terminal width, inserting a real "\n" at whichever word
// boundary the reflow lands on — a boundary that shifts whenever earlier content in the SAME joined line
// grows or shrinks (e.g. the /help catalog gaining a command). De-wrap before substring checks so those
// checks assert on rendered CONTENT, not on an incidental wrap point.
const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
// F4 Task 8: a prompt echo is now a full-width BAND (`userEchoLines`) — gutter cell, text, then a right fill
// out to `width - 1`. Ink can legally break the joined <Text> between the `❯` cell and the text, and the fill
// makes that likelier, so an assertion that pins the gutter collapses whitespace runs first. Content-only
// assertions keep using `frame`.
const flat = (f: () => string | undefined) => frame(f).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// F1 Task 4: the transcript is `RenderItem[]` now — published Static rows, then the transient pending
// region, then the in-flight partial lines, in exactly the order a reader sees them.
const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
// FSW T3: read the WHOLE finalized projection, not just its committed head. `staticItems` is now only
// the part that has left the live window and been written into <Static>; `finalizedItems` is the transcript
// these content assertions are actually about.
type ProjectedState = { state: { finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: { text: string }[] } };
function allText(c: ProjectedState): string {
  return [...[...c.state.finalizedItems, ...c.state.pendingItems].flatMap(itemLines), ...c.state.streaming.map((l) => l.text)].join("|");
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "hello from elsewhere" }] } } });
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
        onMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "SHOULD-NOT-RENDER-VIA-CALLBACK" }] } });   // onMessage-only — NOT routed
        fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "VIA-EVENTS" }] } } });  // the real path
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
    expect(flat(lastFrame)).toContain("❯ hi");
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "first" }] } } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "second" }] } } });
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
    const late = { type: "assistant", parent_tool_use_id: null, message: { id: "late-1", content: [{ type: "text", text: "LATE-COMPLETION" }] } };
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

  // F9 T-IMAGE Task 5 (I3b) fix wave: the review's third finding — IMAGE_VERSION_SKEW_NOTICE →
  // notice() rendering was untested at the useChat layer (only proven indirectly by the adapter-level
  // integration test, which never reaches useChat.ts's own `runTurn` catch arm at all). Pins that a
  // submit() rejection carrying exactly this message renders as a capability notice, not the generic
  // "✗ <message>" error line runTurn uses for every other submit failure.
  it("a submit() rejection carrying IMAGE_VERSION_SKEW_NOTICE renders via notice(), not the generic '✗' error line", async () => {
    const fake = fakeRemote({ submit: async () => { throw new Error(IMAGE_VERSION_SKEW_NOTICE); } });
    const { lastFrame } = render(<Host makeSession={() => fake} prompt="hi with an image" />);
    // `flat`, not `frame`: Ink hard-wraps this notice line at a word boundary inside the message, and
    // `flat` is the helper that collapses the resulting whitespace run back to single spaces.
    await waitFor(() => flat(lastFrame).includes(IMAGE_VERSION_SKEW_NOTICE));
    expect(flat(lastFrame)).not.toContain(`✗ ${IMAGE_VERSION_SKEW_NOTICE}`);
    expect(frame(lastFrame)).toContain("IDLE");
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

// bl7 T-ADVISOR Task 3 carry-forward (spec D15): `config.advisorModel` must reach the rendered "Advising
// using {model}" clause through `projectionContext()` — the REAL closure `useChat.ts` builds (`opts.
// initialAdvisorModel` → the plain `advisorModel` const → the returned context's `advisorModel` field), not
// a hand-built `ProjectionOptions.advisorModel` bag the way `advisor-row.test.tsx`/`toolRenderer.test.tsx`
// exercise render.ts and toolRenderer.tsx directly. This is the one seam those unit cells cannot see: whether
// `main.ts` → `chatMain.tsx` → `ChatApp.tsx`'s `initialAdvisorModel` spread actually lands in the hook.
describe("useChat: D15 — a configured advisorModel reaches the rendered row via the real projectionContext", () => {
  it("initialAdvisorModel renders 'Advising using {model}' on an in-flight advisor consult, absent when omitted", async () => {
    const advisorInFlight = { kind: "sdk" as const, source: "disk" as const, message: {
      type: "assistant", parent_tool_use_id: null, uuid: "u-adv", message: { id: "m-adv",
        content: [{ type: "server_tool_use", id: "srv1", name: "advisor", input: {} }] } } };
    function AdvisorHost({ makeSession, model }: { makeSession: () => ChatSession; model?: string }) {
      const c = useChat(makeSession, { initialAdvisorModel: model, initialEntries: [advisorInFlight] });
      return <Text>{allText(c)}</Text>;
    }
    const withModel = render(<AdvisorHost makeSession={() => fakeRemote() as unknown as ChatSession} model="Opus 4.8" />);
    await waitFor(() => frame(withModel.lastFrame).includes("Advising"));
    expect(frame(withModel.lastFrame)).toContain("Advising using Opus 4.8");
    withModel.unmount();

    // D15's other half: absent config means the clause is OMITTED, not a phantom "Advising using undefined".
    const noModel = render(<AdvisorHost makeSession={() => fakeRemote() as unknown as ChatSession} />);
    await waitFor(() => frame(noModel.lastFrame).includes("Advising"));
    expect(frame(noModel.lastFrame)).toContain("Advising");
    expect(frame(noModel.lastFrame)).not.toContain("using");
    noModel.unmount();
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
      { type: "assistant", parent_tool_use_id: null, message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "PINECONE" }] } },
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
        { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => [] });
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
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
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
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));
    await waitFor(() => frame(lastFrame).includes("resumed here · live"));
    await waitFor(() => disposed === 1);
    expect(disposed).toBe(1);
    expect(calls).toBe(2);                    // initial makeSession() + resumeInto's makeSession(id)
  });

  // T-COPY: `resumeInto` (useChat.ts) seeds the WHOLE ring from the disk read, not just slot 0 — the same
  // seeding rule `recentAssistantTexts` gives rewind (useChat-rewind.test.tsx "5c."). Two assistant replies
  // on disk; /copy 2 must reach the earlier one through the resumed transcript, proving the seed is a ring.
  it("/resume seeds the whole ring from disk — /copy 2 reaches the second-newest replayed reply", async () => {
    let copied: string | undefined;
    const oldSession = fakeRemote();
    const newSession = fakeRemote();
    const makeSession = (resume?: string) => (resume ? newSession : oldSession);
    const msgs = [
      { type: "user", message: { content: [{ type: "text", text: "first prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "first reply" }] } },
      { type: "user", message: { content: [{ type: "text", text: "second prompt" }] }, timestamp: "2026-06-19T15:57:00.000Z" },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "second reply" }] } },
    ];
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs, copyText: async (t: string) => { copied = t; } };
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
    await waitFor(() => frame(lastFrame).includes("second reply"));
    (ResumeHost as any).run("/copy 2");
    await waitFor(() => copied !== undefined);
    expect(copied).toBe("first reply");     // proves the SECOND ring slot was seeded, not just slot 0
  });

  // EXTERNAL REVIEW, FINDING 2. Ctrl+A widened the LIST and nothing else: preview, resume and rename all
  // read through `opts.cwd`, so a row from another project previewed empty, refused to resume with "no
  // history found", and renamed under the wrong project. Each verb takes the ROW's own directory now
  // (`cwd` on `SDKSessionInfo`; there is no `projectPath` field on it — verified against sdk.d.ts).
  it("previews, resumes and renames a foreign-project row through THAT row's directory", async () => {
    const reads: [string, string | undefined][] = [];
    const renames: [string, string, string | undefined][] = [];
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const foreign = { sessionId: "old1234567890", summary: "prior", lastModified: 1, cwd: "/elsewhere" };
    const deps = {
      hasWorktrees: async () => false, listSessions: async () => [foreign],
      getSessionMessages: async (id: string, dir?: string) => { reads.push([id, dir]); return msgs; },
      renameSession: async (id: string, t: string, dir?: string) => { renames.push([id, t, dir]); },
    };
    const api: { run?: (s: string) => void; pick?: (s: any) => void; preview?: (id: string, dir?: string) => Promise<any[]>; rename?: (id: string, t: string, dir?: string) => Promise<void> } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { cwd: "/repo" }, deps);
      api.run = c.submit; api.pick = (c as any).pickSession;
      api.preview = (c as any).previewSession; api.rename = (c as any).renamePickedSession;
      return <Text>{c.state.picker.open ? "PICKER" : "NOPICK"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    await api.preview!(foreign.sessionId, foreign.cwd);
    expect(reads).toEqual([["old1234567890", "/elsewhere"]]);
    await api.rename!(foreign.sessionId, "over there", foreign.cwd);
    expect(renames).toEqual([["old1234567890", "over there", "/elsewhere"]]);
    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER"));
    api.pick!(foreign);
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));   // it RESUMED — the transcript is on screen
    expect(reads.at(-1)).toEqual(["old1234567890", "/elsewhere"]);     // …read through the row's project, not /repo
  });

  // T-RESUME T1. `previewSession` used to be `.catch(() => [])` — a rejecting reader and a successfully-
  // loaded empty session were indistinguishable at this seam, so `failed` could never reach the picker in
  // production. It now resolves the tagged `PreviewLoad` and never itself rejects: `loaded` on success,
  // `failed` (carrying the error's message, not the empty array) on rejection.
  it("previewSession surfaces the tagged failed state when getSessionMessages rejects — not an empty preview", async () => {
    const deps = {
      hasWorktrees: async () => false, listSessions: async () => [],
      getSessionMessages: async () => { throw new Error("ENOENT: no such file"); },
    };
    const api: { preview?: (id: string, dir?: string) => Promise<any> } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { cwd: "/repo" }, deps);
      api.preview = (c as any).previewSession;
      return <Text>{allText(c)}</Text>;
    }
    render(<H />);
    const load = await api.preview!("gone1234567890", "/repo");
    expect(load).toEqual({ state: "failed", error: "ENOENT: no such file" });
  });

  it("previewSession surfaces the tagged loaded state (with the real messages) on success", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "hi" }] } }];
    const deps = {
      hasWorktrees: async () => false, listSessions: async () => [],
      getSessionMessages: async () => msgs,
    };
    const api: { preview?: (id: string, dir?: string) => Promise<any> } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { cwd: "/repo" }, deps);
      api.preview = (c as any).previewSession;
      return <Text>{allText(c)}</Text>;
    }
    render(<H />);
    const load = await api.preview!("here1234567890", "/repo");
    expect(load).toEqual({ state: "loaded", messages: msgs });
  });

  // Wave S T10 (t10 review, finding 1). The picker's SCOPE has to become `ListSessionsOpts`, and the mapping
  // is the whole feature: `allProjects` DROPS the cwd key (it must be absent, not undefined — `toEqual` treats
  // an undefined-valued key as absent, so the key set is asserted separately) and `allWorktrees` lands on
  // `includeWorktrees` UNFLIPPED. Every other test in this file stubs `deps.listSessions`, which replaces the
  // mapping wholesale and can therefore never see it invert; this one stubs only the READER underneath it.
  it("maps the picker's scope onto listSessions options — cwd dropped, includeWorktrees unflipped", async () => {
    const seen: any[] = [];
    const deps = { readSessions: async (o: any) => { seen.push(o); return []; }, getSessionMessages: async () => [], hasWorktrees: async () => false };
    const api: { run?: (s: string) => void; reload?: (s: any) => Promise<unknown> } = {};
    function H() {
      const c = useChat(() => fakeRemote(), { cwd: "/repo/a" }, deps);
      api.run = c.submit; api.reload = (c as any).reloadSessions;
      return <Text>{c.state.picker.open ? "PICKER" : "NOPICK"}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    api.run!("/resume");
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ cwd: "/repo/a", includeWorktrees: false, limit: 30 });   // the narrowed OPEN
    await api.reload!({ allProjects: true, allWorktrees: false });
    expect(Object.keys(seen[1]).sort()).toEqual(["includeWorktrees", "limit"]);        // no cwd KEY at all
    expect(seen[1]).toEqual({ includeWorktrees: false, limit: 30 });
    await api.reload!({ allProjects: false, allWorktrees: true });
    expect(seen[2]).toEqual({ cwd: "/repo/a", includeWorktrees: true, limit: 30 });
    await api.reload!({ allProjects: true, allWorktrees: true });
    expect(seen[3]).toEqual({ includeWorktrees: true, limit: 30 });
  });

  // Wave S T10 (A11). Every sibling dialog prints an outcome when it is dismissed; `/resume` printed nothing.
  // Upstream's copy is `Resume cancelled` (L476806), and it is a CANCEL line — the successful pick closes the
  // same overlay and must stay silent, which is why the two paths cannot share one close function.
  // The pick resumes the CURRENT session id on purpose (t10 review, finding 3). A pick onto a DIFFERENT
  // session ends in `replaceDocument`, which wipes the transcript — including a wrongly-printed cancel notice
  // — before the assertion can read it, so the "never on a pick" half was vacuous. The same-session branch
  // APPENDS instead, so anything `pickSession` printed survives to be caught here.
  it("prints `Resume cancelled` when the picker is dismissed, and never on a successful pick (A11)", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const row = { sessionId: "sess-1", summary: "prior", lastModified: 1 };            // fakeRemote's own id
    const deps = { listSessions: async () => [row], getSessionMessages: async () => msgs, hasWorktrees: async () => false };
    const api: { run?: (s: string) => void; pick?: (s: any) => void; close?: () => void } = {};
    function H() {
      const c = useChat(() => fakeRemote(), {}, deps);
      api.run = c.submit; api.pick = (c as any).pickSession; api.close = c.closePicker;
      return <Text>{c.state.picker.open ? "PICKER" : "NOPICK"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER"));
    api.pick!(row);
    await waitFor(() => flat(lastFrame).includes("prior prompt"));
    expect(frame(lastFrame)).not.toContain("Resume cancelled");       // a pick is not a cancel
    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER"));
    api.close!();
    await waitFor(() => frame(lastFrame).includes("Resume cancelled"));
    expect(frame(lastFrame)).toContain("NOPICK");
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
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(makeSession, {}, deps);
      pick = (c as any).pickSession;
      api.run = c.submit;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} q:{c.state.queue.map((e) => e.value).join(",")} {allText(c)}</Text>;
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
    const deps = { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => msgs };
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "abc12345" } }, deps); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => (lastFrame() ?? "").includes("launch prompt"));
    expect(lastFrame() ?? "").toContain("resumed here · live");
  });
  // F10 T-MAINT item 7 (F9 resume/T2 Minor, pre-existing gap): the guard that keeps a launch `--resume`
  // out of a half-swapped session. `resumeInto` reads the transcript FIRST and refuses before touching
  // `session`, so the warning line is the only observable evidence the refusal happened at all — and it
  // had zero coverage. Both arms of the refusal, because they reach the same line by different routes:
  // an empty read, and a THROWING one (the `catch { msgs = [] }` at :2316).
  it("initialResume with no history found warns and does not swap the session", async () => {
    let made = 0;
    const deps = { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => [] };
    function H() { const c = useChat((_r?: string) => { made++; return fakeRemote(); }, { initialResume: { kind: "id", id: "abc12345-and-more" } }, deps); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => flat(lastFrame).includes("couldn't resume"));
    expect(flat(lastFrame)).toContain("abc12345");                 // the 8-char prefix, not the full id
    expect(flat(lastFrame)).toContain("no history found");
    expect(flat(lastFrame)).not.toContain("resumed here · live");  // the success line the sibling cell asserts
    expect(made).toBe(1);                                          // the original session, never a swap
  });

  it("a REJECTING transcript read lands on the same refusal, never on a half-swapped session", async () => {
    const deps = { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => { throw new Error("EACCES"); } };
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "def67890-and-more" } }, deps); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await waitFor(() => flat(lastFrame).includes("couldn't resume"));
    expect(flat(lastFrame)).toContain("def67890");
    expect(flat(lastFrame)).not.toContain("EACCES");               // the reason never leaks into the transcript
  });
  it("/continue resumes the most-recent session", async () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "recent work" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "s-old", summary: "", lastModified: 1 }, { sessionId: "s-new", summary: "", lastModified: 9 }], getSessionMessages: async (id: string) => (id === "s-new" ? msgs : []) };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((_r?: string) => fakeRemote(), {}, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => (lastFrame() ?? "").includes("recent work"));
  });
  it("/continue with no sessions shows a notice", async () => {
    const deps = { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => [] };
    let api: { run?: (s: string) => void } = {};
    function H() { const c = useChat((_r?: string) => fakeRemote(), {}, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/continue");
    await waitFor(() => flat(lastFrame).includes("No sessions to continue"));
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
    api.run!("/compact");      await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));   // W-S t7 corr.: the compaction family is upstream `va`, which strips the `.0`
    api.run!("/context");      await waitFor(() => frame(lastFrame).includes("ctx 25%"));
    api.run!("/help");         await waitFor(() => frame(lastFrame).includes("/model"));
    api.run!("/zzz");          await waitFor(() => frame(lastFrame).includes("Unknown command: /zzz"));
    api.run!("/clear");        await waitFor(() => !frame(lastFrame).includes("Unknown command"));
    expect(modelSet).toBe("claude-opus-5");     // tier alias resolved before setModel
    expect(submitted).toBe(0);     // no slash command ever reached session.submit
  });

  // Live-feedback fix (2026-08-06): /clear's engine half. The UI-only clear kept the engine context —
  // the model still remembered everything, which is what "doesn't actually work" looked like in live use.
  it("/clear calls the session's clearSession (engine swap) and only then wipes the document", async () => {
    let cleared = 0;
    const fake = fakeRemote({ clearSession: async () => { cleared++; } });
    const api: { run?: (s: string) => void } = {};
    render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => cleared === 0);
    api.run!("/clear");
    await waitFor(() => cleared === 1);
  });
  it("/clear on a refusing host (busy / pre-upgrade) prints the refusal and does NOT wipe the document", async () => {
    const fake = fakeRemote({ clearSession: async () => { throw new Error("busy"); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/clear");
    await waitFor(() => frame(lastFrame).includes("clear: busy"));
    expect(frame(lastFrame)).toContain("engine context unchanged");
  });

  // W-R t7: `/clear` fires the VIEWPORT reset (upstream's inline arm, scrollback kept), not the 2J/3J/H
  // screen+scrollback wipe — that one is rewind's now. test/tui/clear-repaint.test.tsx pins the payload.
  it("clear() empties the transcript and fires the terminal viewport reset", async () => {
    let cleared = 0;
    const api: { run?: (s: string) => void; clear?: () => void } = {};
        // FSW T3: `finalizedItems`, not `staticItems` — the finalized projection is what this claim is about;
    // `staticItems` is now only the part of it already committed to <Static>.
    function H() { const c = useChat(() => fakeRemote(), {}, { clearViewport: () => { cleared++; } }); api.run = c.submit; api.clear = c.clear; return <Text>L:{c.state.finalizedItems.length}</Text>; }
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
      const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `reply${submits}` }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      await new Promise<void>((res) => { release = res; });
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.map((e) => e.value).join(",")}</Text>; }
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

  // F9 T-IMAGE (I2), the plan's required "queue: submit-while-busy enqueues the structural entry, drain
  // hands it back intact" cell. Before this task `submit` only ever saw a flattened string — an image entry
  // could not reach the queue at all. `submit`'s widened signature (`ComposerSubmission | string`) is what
  // makes this reachable; `popQueueToComposer` is the SAME seam ChatComposer's Up-arrow reads (queue.ts's
  // `joinQueuedForComposer`), proven here at the useChat boundary rather than through a rendered composer.
  it("a structural submit while busy enqueues the image entry, and the queue hands it back intact", async () => {
    let release = () => {}; let submits = 0;
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async (_p, onMessage) => {
      submits++;
      fake.pushEvent({ kind: "turn", phase: "start", seq: submits });
      const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "reply" }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      await new Promise<void>((res) => { release = res; });
      fake.pushEvent({ kind: "turn", phase: "end", seq: submits });
      return { result: "done" };
    } });
    const api: { run?: (s: ComposerSubmission | string) => void; pop?: () => { text: string; pastedContents?: PastedMap } | null } = {};
    function H() {
      const c = useChat(() => fake);
      api.run = c.submit; api.pop = (c as any).popQueueToComposer;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.length}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("first turn"); await waitFor(() => frame(lastFrame).includes("BUSY"));
    const imageEntry = { id: 1, type: "image" as const, content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 2, height: 2 } };
    api.run!({ display: "look [Image #1]", submitText: "look [Image #1]", pastedContents: { 1: imageEntry } });
    await waitFor(() => frame(lastFrame).includes("q:1"));
    // ENQUEUE + DRAIN in one read: `popQueueToComposer` is the exact seam ChatComposer's Up-arrow calls
    // (`queuePop`), so if the entry survived the enqueue it survives here too.
    const popped = api.pop!();
    expect(popped).not.toBeNull();
    expect(popped!.text).toBe("look [Image #1]");
    // DRAIN: `joinQueuedForComposer` hands the SAME image entry back, not just its label.
    expect(popped!.pastedContents).toBeDefined();
    const backId = Number(Object.keys(popped!.pastedContents!)[0]);
    expect(popped!.pastedContents![backId]).toEqual({ ...imageEntry, id: backId });
    release();            // release the running turn so it settles cleanly
    await waitFor(() => !frame(lastFrame).includes("BUSY"));
  });

  // F9 T-IMAGE Task 5 (I3b), the plan's required "queue: an image turn queued while busy drains and
  // submits with its block intact" cell. The previous test proves the map survives the ROUND TRIP back
  // to the composer (queue.ts's `joinQueuedForComposer`); this one proves the OTHER drain destination —
  // `drainNext` → `dispatch` → `runTurn` → `session.submit` — which before this task pulled only
  // `q[0].value` (the flattened text) and dropped `pastedContents` on the floor, so a queued image never
  // reached the model at all even though `makeQueueEntry` had carried it this far.
  it("a queued image turn drains and reaches session.submit with the image block intact, not just its label", async () => {
    let release = () => {};
    const submitted: unknown[] = [];
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async (p, onMessage) => {
      submitted.push(p);
      const seq = submitted.length;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      if (submitted.length === 1) await new Promise<void>((res) => { release = res; });   // hold turn 1 open so turn 2 queues
      const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    } });
    const api: { run?: (s: ComposerSubmission | string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("first turn"); await waitFor(() => frame(lastFrame).includes("BUSY"));
    const imageEntry = { id: 1, type: "image" as const, content: "QkFTRTY0", mediaType: "image/png", dimensions: { width: 2, height: 2 } };
    api.run!({ display: "look [Image #1]", submitText: "look [Image #1]", pastedContents: { 1: imageEntry } });   // queues while busy
    release();                                              // turn 1 ends → the queued image turn drains
    await waitFor(() => submitted.length === 2);
    const second = submitted[1] as { type: string; text?: string; source?: { type: string; media_type: string; data: string } }[];
    expect(Array.isArray(second)).toBe(true);               // NOT the flattened string the pre-task drain sent
    expect(second[0]).toEqual({ type: "text", text: "look [Image #1]" });
    expect(second[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "QkFTRTY0" } });
  });

  it("drains PAST a queued unknown command (no stall) to a following turn", async () => {
    let release = () => {}; let submits = 0;
    let fake!: FakeRemote;
    fake = fakeRemote({ submit: async (_p, onMessage) => {
      submits++;
      const seq = submits;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "r" }] } };
      onMessage(m); fake.pushEvent({ kind: "message", data: m });
      await new Promise<void>((res) => { release = res; });
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.map((e) => e.value).join(",")}</Text>; }
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
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.map((e) => e.value).join(",")}</Text>; }
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
    function H() { const c = useChat((_r?: string) => fakeRemote(), { initialResume: { kind: "id", id: "sess-9" } }, { getSessionMessages: async () => msgs, hasWorktrees: async () => false, listSessions: async () => [] }); token = c.state.staticEpoch; return <Text>tok:{c.state.staticEpoch} {allText(c)}</Text>; }
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
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
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
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));   // the swap landed

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
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "x" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq });
        return { result: "done" };
      },
      setModel: (m?: string) => { modelSet = m ?? ""; },
    });
    const api: { run?: (s: string) => void; stop?: () => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.stop = c.interrupt; return <Text>{c.state.busy ? "BUSY" : "IDLE"} q:{c.state.queue.map((e) => e.value).join(",")} m:{c.state.model ?? "-"}</Text>; }
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
    await waitFor(() => flat(lastFrame).includes("not detachable — run with --detachable, or ccx attach from another terminal"));
    expect(submitted).toBe(0);
  });

  // WAVE C TASK 14 halved this test. `#` was ccx's own memory mode — no upstream counterpart at 2.1.220 —
  // and the spec's owner-decision section removed it, so the `appendMemory` half is gone and the prompt it
  // used to swallow now goes to the model like any other. `!` is untouched: it IS upstream's escape.
  it("! runs bash locally (injected) and never reaches the model — but # is an ordinary prompt now", async () => {
    let submitted = 0, bashCmd = "", lastPrompt = "";
    const fake = fakeRemote({ submit: async (p: string) => { submitted++; lastPrompt = p; return { result: "x" }; } });
    const deps = { runBash: async (cmd: string) => { bashCmd = cmd; return { code: 0, output: "file1\nfile2" }; } };
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, { cwd: "/proj" }, deps); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("!ls -a");   await waitFor(() => frame(lastFrame).includes("file1"));
    expect(bashCmd).toBe("ls -a");
    expect(frame(lastFrame)).toContain("! ls -a");
    expect(submitted).toBe(0);   // `!` still never reaches the model
    api.run!("#the parser lives in cli.ts");
    await waitFor(() => submitted === 1);
    expect(lastPrompt).toBe("#the parser lives in cli.ts");   // verbatim, `#` and all — no note, no file write
    expect(frame(lastFrame)).not.toContain("noted in");
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

  // FSW T5: the renderer decision is made once in `chatMain` and handed to the hook, and BOTH reporting
  // surfaces read it through the one `statusRenderer()` helper — the `/status` command and the Settings
  // dialog's Status tab. They are pinned together deliberately: wave 2 already caught the effort axis
  // disagreeing across exactly this pair, one surface gated and the other not, and a renderer row that
  // appeared in one place and not the other would be the same defect in a new field.
  it("threads the boot renderer decision into /status AND the Settings status tab, identically", async () => {
    const fake = fakeRemote({ usage: () => ({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: null }) });
    const api: { run?: (s: string) => void; tab?: () => Promise<{ text: string }[]> } = {};
    function H() {
      const c = useChat(() => fake, { rendererChoice: { mode: "fullscreen", reason: "settings_on" } });
      api.run = c.submit; api.tab = c.fetchSettingsStatus;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/status");
    await waitFor(() => flat(lastFrame).includes("renderer fullscreen (settings_on)"));
    // FSW T9 retired T5's placeholder: the stack named here is now derived from the mode, and a fullscreen
    // launch constructs none of the main-screen machinery this line used to claim for it.
    expect(flat(lastFrame)).toContain("corrections: alt-screen repaint contract");
    const tab = (await api.tab!()).map((l) => l.text);
    expect(tab.at(-1)).toBe("  renderer   fullscreen (settings_on) · corrections: alt-screen repaint contract");
  });

  it("a hook mounted with no renderer decision reports none rather than guessing one", async () => {
    const fake = fakeRemote({ usage: () => ({ session: { total_cost_usd: 0, model_usage: {} }, subscription_type: null }) });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<CmdHost makeSession={() => fake} api={api} />);
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/status");
    await waitFor(() => frame(lastFrame).includes("Status"));
    expect(frame(lastFrame)).not.toContain("renderer");
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
      submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } }],
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
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "build it" } }] } },
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
  function LadderHost({ makeSession, api, env }: { makeSession: () => ChatSession; api: { cyc?: () => void; run?: (s: string) => void }; env?: NodeJS.ProcessEnv }) {
    const c = useChat(makeSession, {}, { ...(env ? { env } : {}) });
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
  // Wave-T T15: `/yolo` is behind the bypass consent gate now, so this test states the ALREADY-CONSENTED
  // case — its subject is the ladder, not the gate (bypass-consent.test.tsx owns that). The temp fleet root
  // is what makes the acceptance a fact of THIS test rather than of whoever's machine it runs on: without it
  // `loadPrefs()` would read the real ~/.claude/ccx/prefs.json and the result would differ per developer.
  // The temp root is removed in a `finally`, not as the last statement: a failed assertion (or a `waitFor`
  // timeout) above it would otherwise skip the cleanup and leak the directory on exactly the runs where
  // someone is going to re-run the suite repeatedly.
  it("/yolo enables bypassPermissions (consent already accepted); Tab from bypass returns to default", async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-yolo-"));
    try {
      const env = { ...process.env, CCX_FLEET_ROOT: root };
      savePrefs({ skipDangerousModePermissionPrompt: true }, env);
      const setModeCalls: string[] = [];
      const session = fakeRemote({ setPermissionMode: (m: string) => { setModeCalls.push(m); } });
      const api: { cyc?: () => void; run?: (s: string) => void } = {};
      const { lastFrame } = render(<LadderHost makeSession={() => session} api={api} env={env} />);
      await waitFor(() => frame(lastFrame).includes("mode:default"));
      api.run!("/yolo");
      await waitFor(() => frame(lastFrame).includes("mode:bypassPermissions"));
      api.cyc!(); await waitFor(() => frame(lastFrame).includes("mode:default"));
      expect(setModeCalls).toEqual(["bypassPermissions", "default"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
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

  // F3 Task 7 (reviewer I10): these two frames render NOTHING in the transcript — upstream renders nothing
  // for them, and a local entry here is a fold BREAKER (P84: a `task_started` lands ~5 s into every
  // foreground Bash, so the old `⚙ task started` notice was splitting fold runs mid-turn). The ↓ panel is
  // unaffected: it reads the harvest + `tasks_changed`, never the transcript.
  it("tasks_changed updates bgTasks; task frames render NO transcript row but still reach the bg panel", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>bg:{c.state.bgTasks.length} rows:{c.state.bgRows.length} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep 99" }] });
    await waitFor(() => frame(lastFrame).includes("bg:1"));
    fake.pushEvent({ kind: "task", data: { type: "task_started", description: "reviewing", task_id: "t2", tool_use_id: "tu2", task_type: "local_agent" } });
    fake.pushEvent({ kind: "task", data: { type: "task_notification", status: "completed", summary: "done", task_id: "t2", tool_use_id: "tu2" } });
    await waitFor(() => frame(lastFrame).includes("rows:2"));            // t1 live + t2 finished, both in the panel
    expect(frame(lastFrame)).not.toContain("task started");
    expect(frame(lastFrame)).not.toContain("task done");
    expect(frame(lastFrame)).not.toContain("reviewing");
  });

  it("a task_started arriving mid-run does NOT break the fold: one group row, not two", async () => {
    const fake = fakeRemote();
    let snap!: { finalizedItems: readonly RenderItem[] };
    // FSW T3: `finalizedItems`, not `staticItems` — the finalized projection is what this claim is about;
    // `staticItems` is now only the part of it already committed to <Static>.
    function H() { const c = useChat(() => fake); snap = { finalizedItems: c.state.finalizedItems }; return <Text>{allText(c)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });
    fake.pushEvent({ kind: "task", data: { type: "system", subtype: "task_started", task_id: "t9", tool_use_id: "read-2", task_type: "local_bash", description: "a foreground shell" } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-2", content: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/src/b.ts" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "user-result-b", message: { content: [{ type: "tool_result", tool_use_id: "read-2", content: "b" }] } } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-3", content: [{ type: "text", text: "all done" }] } } });   // the breaker that publishes the run
    await waitFor(() => snap.finalizedItems.some((i) => i.id.startsWith("group:")));
    const groups = snap.finalizedItems.filter((i) => i.id.startsWith("group:"));
    expect(groups).toHaveLength(1);
    expect(itemLines(groups[0]!)[0]).toContain("Read 2 files");
  });

  // TS T11 (review fix): WHERE the elapsed ticker's start stamp is taken — here, at ingest, one stamp per
  // arriving `tool_use`, before the frame is retained. The fold-row suite stamps its own fixtures, so this is
  // the only cell that pins the wiring itself; it also carries the `!ev.replay` guard, which rides on the same
  // reasoning as `stampAgentCalls`': a replayed frame's arrival is when this client attached, not when the
  // work began, so its member has no age to report rather than a fabricated one.
  it("stamps an arriving tool_use for the elapsed ticker, and never a replayed one", async () => {
    const clock = { now: 0 };
    const fake = fakeRemote();
    let snap!: { pendingItems: readonly RenderItem[] };
    function H() {
      const c = useChat(() => fake, {}, { now: () => clock.now, isFullscreen: () => true });
      snap = { pendingItems: c.state.pendingItems };
      return <Text>{allText(c)}</Text>;
    }
    render(<H />);
    const groupRow = () => snap.pendingItems.filter((i) => i.id.startsWith("group:")).flatMap(itemLines)[0] ?? "";
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });                                  // read-1 ARRIVES at t=0
    await waitFor(() => groupRow().includes("Reading 1 file"));
    clock.now = 9000;
    await waitFor(() => groupRow().includes("· 9s"));                                      // the 600 ms repaint, on read-1's ingest stamp
    // A replayed call joins the cluster and takes the anchor (it is the newest in flight) — with NO stamp, so
    // the row says nothing rather than dating the work from the moment this client attached.
    const replayed = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-replayed", content: [{ type: "tool_use", id: "read-replayed", name: "Read", input: { file_path: "/work/src/z.ts" } }] } };
    fake.pushEvent({ kind: "message", data: replayed, replay: true });
    await waitFor(() => groupRow().includes("Reading 2 files"));
    clock.now = 15_000;
    await new Promise((r) => setTimeout(r, 700));                                          // past one repaint, so the row HAS been re-projected
    expect(groupRow()).toContain("Reading 2 files");
    expect(groupRow()).not.toContain("·");                                                 // ← stamping the replay reports "· 6s" here
    // …and when the replayed member settles the anchor returns to read-1, still measured from its own arrival
    // fifteen seconds ago — a stamp no projection ever asked for in between.
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "user-replayed", message: { content: [{ type: "tool_result", tool_use_id: "read-replayed", content: "z" }] } } });
    await waitFor(() => groupRow().includes("· 15s"));
  });

  it("captures the task sidechannel so a sidecar-less Agent still gets an honest Done row (P83 rung 2)", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake, {}, { now: () => 5000 }); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "a-agent", content: [{ type: "tool_use", id: "agent-1", name: "Agent", input: { description: "review the diff", prompt: "go" } }] } } });
    fake.pushEvent({ kind: "task", data: { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "agent-1", subagent_type: "reviewer", task_type: "local_agent", description: "review the diff" } });
    await waitFor(() => frame(lastFrame).includes("Initializing…"));
    // P83: the notification lands ~1 ms BEFORE the tool_result, which is what makes it available to the row.
    fake.pushEvent({ kind: "task", data: { type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "agent-1", status: "completed", usage: { total_tokens: 4195, tool_uses: 2, duration_ms: 4484 } } });
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "u-agent", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "the report" }] } } });
    await waitFor(() => frame(lastFrame).includes("Done (2 tool uses · 4.2k tokens · 4s)"));
    expect(frame(lastFrame)).not.toContain("the report");     // the agent's report is behind ctrl+o, not dumped
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", input: { command: "echo hi", run_in_background: true } }] } } });
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
  // F6 T11-fix. Two guards the picker itself cannot answer, both in useChat.
  it("an EMPTY catalog opens no picker at all — it says so instead", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [], commands: [], mcpServers: [] }) });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => flat(lastFrame).includes("no models available"));
    expect(api.state.modelPicker.open).toBe(false);
  });
  it("`/model <name>` CLEARS the picker's session-only mark — it replaces whatever `s` put in force", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const api: { run?: (p: string) => void; pick?: (m: any, o?: any) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.pick = c.pickModel; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.pick!({ value: "opus", displayName: "Opus" }, { saveDefault: false });   // the `s` path
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await new Promise((r) => setTimeout(r, 10));
    expect(api.state.modelPicker.sessionModel).toBe("opus");                     // the mark is in force…
    api.run!("/model sonnet");                                                   // …and a direct switch retires it
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/model");
    await new Promise((r) => setTimeout(r, 10));
    expect(api.state.modelPicker.open).toBe(true);
    expect(api.state.modelPicker.sessionModel).toBeUndefined();
  });

  // WAVE S T12 (EP-S8) — the half of the switch confirm the PICKER cannot hold. It unmounts on every pick,
  // so the ack ("do not ask again until the model has produced more output") has to live here and be threaded
  // back in on the next open.
  const CAPS = { models: [{ value: "opus", displayName: "Opus" }, { value: "sonnet", displayName: "Sonnet" }], commands: [], mcpServers: [] };
  const USAGE = { session: { model_usage: { "claude-sonnet-5": { outputTokens: 300 }, "claude-opus-5": { outputTokens: 200 } } } };

  it("opens the picker with the session's CUMULATIVE output tokens, summed across models", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => USAGE });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.outputTokens).toBe(500);
    expect(api.state.modelPicker.ackedAt).toBeUndefined();
  });

  // A broken usage read degrades to UPSTREAM-ABSENT behavior (0 output tokens ⇒ gate condition 1 ⇒ no
  // confirm), never to a dialog raised on a number we do not have — and never to a picker that fails to open.
  it("still opens the picker when usage() rejects, with a zero output count", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => { throw new Error("no usage"); } });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.models.length).toBe(2);
    expect(api.state.modelPicker.outputTokens).toBe(0);
  });

  it("stamps the ack at the confirmed count, and hands it back on the NEXT open", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => USAGE });
    const api: { run?: (p: string) => void; pick?: (m: any, o?: any) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.pick = c.pickModel; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    api.pick!({ value: "opus", displayName: "Opus" }, { saveDefault: true, confirmed: true });
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBe(500);       // the count the gate was asked about, not a re-read
  });

  // THE FIX ROUND'S REAL DEFECT. `/clear` swaps the ENGINE, so `usage()` restarts at zero — an ack carried
  // across sits above every count the new conversation produces for a long while. Same boundary and same
  // class as W-S5/Task 8's context percentage: a number measured against a conversation that is gone.
  it("drops the ack at a conversation boundary, so the fresh conversation warns again (/clear)", async () => {
    let out = 500;
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => ({ session: { model_usage: { m: { outputTokens: out } } } }), clearSession: () => {} });
    const api: { run?: (p: string) => void; pick?: (m: any, o?: any) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.pick = c.pickModel; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    api.pick!({ value: "opus", displayName: "Opus" }, { saveDefault: true, confirmed: true });   // ack at 500
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/clear");
    await new Promise((r) => setTimeout(r, 10));
    out = 200;                                                    // the new conversation's own output, from zero
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBeUndefined();
    expect(api.state.modelPicker.outputTokens).toBe(200);
    // the gate itself, on exactly the inputs the picker now holds
    expect(needsModelConfirm({ next: "sonnet", current: "opus", outputTokens: api.state.modelPicker.outputTokens, ackedAt: api.state.modelPicker.ackedAt })).toBe(true);
  });

  // Compaction is the OTHER kind of boundary: the session and its count survive, so upstream RE-STAMPS
  // rather than resets (`$$e`, L232096-232112, fired at L232164/L308436). The cache is already lost, so a
  // switch right after a compaction costs nothing extra and there is nothing to warn about.
  it("re-stamps the ack after a typed /compact, at the post-compaction count", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => ({ session: { model_usage: { m: { outputTokens: 800 } } } }) });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/compact");
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBe(800);
    expect(needsModelConfirm({ next: "sonnet", current: "opus", outputTokens: 800, ackedAt: api.state.modelPicker.ackedAt })).toBe(false);
  });

  it("leaves the ack alone when the post-compaction usage read fails", async () => {
    let usable = true;
    const fake = fakeRemote({
      capabilities: () => CAPS,
      usage: () => { if (!usable) throw new Error("no usage"); return { session: { model_usage: { m: { outputTokens: 500 } } } }; },
    });
    const api: { run?: (p: string) => void; pick?: (m: any, o?: any) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.pick = c.pickModel; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    api.pick!({ value: "opus", displayName: "Opus" }, { saveDefault: true, confirmed: true });   // ack at 500
    await new Promise((r) => setTimeout(r, 0));
    usable = false;
    api.run!("/compact");
    await new Promise((r) => setTimeout(r, 20));
    usable = true;
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBe(500);              // unchanged, not zeroed by a failed read
  });

  it("re-stamps off an AUTOMATIC compaction's wire boundary, but never off a replayed one", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => ({ session: { model_usage: { m: { outputTokens: 900 } } } }) });
    const api: { run?: (p: string) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: "b1" }, replay: true } as any);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBeUndefined();        // a replayed boundary is history
    api.run!("/model");                                           // close/reopen is not needed; the next open re-reads
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: "b2" } } as any);
    await new Promise((r) => setTimeout(r, 10));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.ackedAt !== undefined);
    expect(api.state.modelPicker.ackedAt).toBe(900);
  });

  it("stamps NOTHING when the pick never raised the confirm — the next switch must still be able to warn", async () => {
    const fake = fakeRemote({ capabilities: () => CAPS, usage: () => USAGE });
    const api: { run?: (p: string) => void; pick?: (m: any, o?: any) => void; state?: any } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.pick = c.pickModel; api.state = c.state; return <Text>x</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    api.pick!({ value: "opus", displayName: "Opus" }, { saveDefault: true });   // no confirm was shown
    await new Promise((r) => setTimeout(r, 0));
    api.run!("/model");
    await waitFor(() => api.state.modelPicker.open);
    expect(api.state.modelPicker.ackedAt).toBeUndefined();
  });
});

describe("useChat: compact divider + /copy (Task 9)", () => {
  // F4 Task 10b re-points this at upstream's real form. The hand-rolled `─── context compacted ───` rule was
  // F1's invention; `XWo` shape B (L422282) is a bulleted `Compact summary` carrying the live expand hint,
  // and P81 caught the `compact_boundary` frame on the wire, so the row is evidence-backed rather than a
  // stand-in. (Replay from DISK keeps its own divider — `getSessionMessages` strips the boundary, P81's TR36
  // trap — which is why `replay.test.ts`'s "context compacted earlier" assertion still stands.)
  it("a system/compact_boundary message event (mid-turn, like the real host emits it) appends the compact-summary row", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary" } });
    await waitFor(() => frame(lastFrame).includes("Compact summary"));
    expect(frame(lastFrame)).toContain("Compact summary (ctrl+o to expand)");
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
    // `parent_tool_use_id: null` is the WIRE shape of a top-level assistant frame (SDK `string | null`);
    // omitting it is what let a strict `=== undefined` nesting test pass here and fail on every real reply.
    const late = { type: "assistant", parent_tool_use_id: null, message: { id: "late-copy", content: [{ type: "text", text: "LATE-COMPLETION" }] } };
    fake.pushEvent({ kind: "message", data: late });
    await waitFor(() => frame(lastFrame).includes("LATE-COMPLETION"));
    fake.pushEvent({ kind: "message", data: late });                     // the same record redelivered
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame).match(/LATE-COMPLETION/g)).toHaveLength(1);
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("Copied to clipboard"));
    expect(copied).toBe("LATE-COMPLETION");
  });

  it("/copy with no assistant text yet notices 'No assistant message to copy' and never calls the copy fn", async () => {
    let calls = 0;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/copy");
    await waitFor(() => flat(lastFrame).includes("No assistant message to copy"));
    expect(calls).toBe(0);
  });

  // T-COPY: canon's success line is `Copied to clipboard (N characters, M lines)` (R1 §1.8), byte-exact,
  // replacing ccx's homegrown `✓ copied N chars`. "characters"/"lines" are always plural nouns in canon,
  // regardless of count — there is no singular form here (unlike the out-of-range error below).
  it("/copy after an assistant message calls the injected copy fn with THAT text and notices canon's byte-exact confirmation", async () => {
    let copied: string | undefined;
    const TEXT = "the answer is 42";
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: TEXT }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes(TEXT));
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("Copied to clipboard"));
    expect(copied).toBe(TEXT);                          // the fn received the actual text, not just a call
    expect(frame(lastFrame)).toContain(`Copied to clipboard (${TEXT.length} characters, 1 lines)`);
  });

  it("/copy 1 is equivalent to bare /copy — both name the newest reply", async () => {
    let copied: string | undefined;
    const TEXT = "the answer is 42";
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: TEXT }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes(TEXT));
    api.run!("/copy 1");
    await waitFor(() => frame(lastFrame).includes("Copied to clipboard"));
    expect(copied).toBe(TEXT);
  });

  // T-COPY wiring rule: the ring must be reached through the REAL delivery chain (turn start → message
  // frames → turn end via `fake.pushEvent`, the same idiom every other live-path test above uses), not by
  // hand-setting internal state — deleting the unshift-and-cap at the live assignment site kills this.
  it("/copy 2 reaches the second-newest reply through the live ring, built by real frame delivery", async () => {
    let copied: string | undefined;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "first reply" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("first reply"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "second reply" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("second reply"));
    api.run!("/copy 2");
    await waitFor(() => copied !== undefined);
    expect(copied).toBe("first reply");                 // N=2 is the SECOND-newest, not slot 0 overwritten
    copied = undefined;
    api.run!("/copy 1");
    await waitFor(() => copied !== undefined);
    expect(copied).toBe("second reply");                // N=1 is still the newest
  });

  // Canon's usage string (R1 §1.9), byte-exact including the REAL ellipsis character U+2026 — a naive
  // three-dot "..." port would fail this assertion.
  it("/copy <non-numeric> prints canon's usage string byte-exact, with the real ellipsis (U+2026)", async () => {
    let calls = 0;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "42" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("42"));
    api.run!("/copy abc");
    await waitFor(() => flat(lastFrame).includes("Usage: /copy"));
    // flat(), not frame(): the notice line is long enough to hard-wrap at the test terminal's width, and
    // frame() only folds the wrap's "\n" to a single space — flat() also collapses the resulting run of
    // whitespace, matching how every other long-line assertion in this file compares wrapped text.
    expect(flat(lastFrame)).toContain(`Usage: /copy [N] where N is 1 (latest), 2, 3, … Got: abc`);
    expect(flat(lastFrame)).toContain("…");        // guards against a 3-dot "..." substitute
    expect(calls).toBe(0);
  });

  it("/copy 0 and /copy -1 are also usage errors — canon's grammar is Number(arg), integer, >= 1", async () => {
    let calls = 0;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "42" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("42"));
    api.run!("/copy 0");
    await waitFor(() => flat(lastFrame).includes("Got: 0"));
    api.run!("/copy -1");
    await waitFor(() => flat(lastFrame).includes("Got: -1"));
    expect(calls).toBe(0);
  });

  // Canon's out-of-range string (R1 §1.9) pluralizes "message(s)" on the COUNT, not on N.
  it("/copy N past the ring's length: singular 'message' with exactly one available, plural otherwise", async () => {
    let calls = 0;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "only reply" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("only reply"));
    api.run!("/copy 2");
    await waitFor(() => flat(lastFrame).includes("Only 1 assistant message available to copy"));
    expect(calls).toBe(0);
  });

  it("/copy N past the ring's length with 2+ available uses the plural 'messages'", async () => {
    let calls = 0;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "first reply" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("first reply"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "second reply" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("second reply"));
    api.run!("/copy 5");
    await waitFor(() => flat(lastFrame).includes("Only 2 assistant messages available to copy"));
    expect(calls).toBe(0);
  });

  // The conversation boundary owns this ref like it owns every other measurement: the reply belonged to the
  // conversation `/clear` threw away, so putting it on the system clipboard afterwards is the Wave S rule
  // inverted. `replaceDocument` is the one place all four boundary paths (clear/resume/rewind/empty-rewind)
  // pass through, and resume/rewind re-seed AFTER the swap, so only `/clear` newly resets.
  it("/copy after /clear has nothing to copy — the cleared conversation's reply never reaches the clipboard", async () => {
    let calls = 0;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "the answer is 42" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("the answer is 42"));
    api.run!("/clear");
    await waitFor(() => !frame(lastFrame).includes("the answer is 42"));
    api.run!("/copy");
    await waitFor(() => flat(lastFrame).includes("No assistant message to copy"));
    expect(calls).toBe(0);
  });

  // A failed turn's terminal frame is `type:"assistant"` with `parent_tool_use_id:null` and real text — it
  // differs from a reply ONLY by `is_api_error_message:true` (probe 96's shape, pinned key-for-key in
  // useChat-error.test.tsx). Truthiness on the nesting field is therefore not enough: without the error
  // filter /copy hands the user "Failed to authenticate. API Error: 401 …" as though Claude had said it.
  // Canon's rule is "the newest NON-ERROR assistant message", so an error is not a source and does not
  // displace the last real reply either.
  const API_ERROR_FRAME = {
    type: "assistant", parent_tool_use_id: null, model: "<synthetic>", is_api_error_message: true,
    error: "authentication_failed", uuid: "copy-err-1",
    message: { role: "assistant", content: [{ type: "text", text: "Failed to authenticate. API Error: 401 synthetic" }] },
  };
  it("/copy never sources an api_error frame — a failed turn leaves nothing to copy", async () => {
    let calls = 0;
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async () => { calls++; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: API_ERROR_FRAME });
    await waitFor(() => frame(lastFrame).includes("API Error: 401"));   // it still RENDERS — only /copy declines it
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    api.run!("/copy");
    await waitFor(() => flat(lastFrame).includes("No assistant message to copy"));
    expect(calls).toBe(0);
  });

  it("an api_error after a real reply does not displace it — /copy still yields the reply", async () => {
    let copied: string | undefined;
    const fake = fakeRemote({ submitMessages: [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "the answer is 42" }] } }] });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { copyText: async (t: string) => { copied = t; } }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("the answer is 42"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 7 });
    fake.pushEvent({ kind: "message", data: API_ERROR_FRAME });
    await waitFor(() => frame(lastFrame).includes("API Error: 401"));
    fake.pushEvent({ kind: "turn", phase: "end", seq: 7 });
    api.run!("/copy");
    await waitFor(() => frame(lastFrame).includes("Copied to clipboard"));
    expect(copied).toBe("the answer is 42");
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
        getSessionMessages: async () => [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t", name: "Edit", input: { file_path: "/repo/z.ts" } }] } }],
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
          { type: "assistant", parent_tool_use_id: null, message: { content: [
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

describe("F5 t12: loadHistory reads history.jsonl (readHistory), not the persisted transcripts", () => {
  const PROJ = "/tmp/ccx-loadhistory-proj";
  const withRoot = async (body: (env: NodeJS.ProcessEnv) => Promise<void>) => {
    const root = mkdtempSync(join(tmpdir(), "ccx-loadhist-"));
    try { await body({ ...process.env, CCX_FLEET_ROOT: root }); } finally { rmSync(root, { recursive: true, force: true }); }
  };
  const mountLoad = (env: NodeJS.ProcessEnv, sessionId?: string) => {
    let load!: (s: any) => Promise<any[]>;
    function H() {
      const c = useChat(() => fakeRemote(sessionId ? { sessionId } : {}), { cwd: PROJ }, { env });
      load = c.loadHistory; return <Text />;
    }
    render(<H />);
    return () => load;
  };

  it("scope 'project' returns only this project's prompts, newest first, with the ! prefix intact", async () => {
    await withRoot(async (env) => {
      appendHistory({ display: "run typecheck", project: PROJ }, env);
      appendHistory({ display: "!git status", project: PROJ }, env);
      appendHistory({ display: "someone else's", project: "/tmp/other" }, env);
      const load = mountLoad(env);
      await new Promise((r) => setTimeout(r, 20));
      const entries = await load()("project");
      expect(entries.map((e) => e.text)).toEqual(["!git status", "run typecheck"]);
      expect(entries[0].ts).toBeGreaterThan(0);
    });
  });

  it("scope 'everywhere' crosses projects; scope 'session' filters on the live session id", async () => {
    await withRoot(async (env) => {
      appendHistory({ display: "mine", project: PROJ, sessionId: "sess-1" }, env);
      appendHistory({ display: "theirs", project: "/tmp/other", sessionId: "sess-2" }, env);
      const load = mountLoad(env, "sess-1");
      await new Promise((r) => setTimeout(r, 20));
      expect((await load()("everywhere")).map((e) => e.text).sort()).toEqual(["mine", "theirs"]);
      expect((await load()("session")).map((e) => e.text)).toEqual(["mine"]);
    });
  });

  it("carries pastedContents through, so an accepted match can rebuild its chips", async () => {
    await withRoot(async (env) => {
      appendHistory({ display: "look at [Pasted text #1 +2 lines]", project: PROJ, pastedContents: { 1: { id: 1, type: "text", content: "a\nb\nc", lineCount: 2 } } }, env);
      const load = mountLoad(env);
      await new Promise((r) => setTimeout(r, 20));
      const [e] = await load()("project");
      expect(e.text).toBe("look at [Pasted text #1 +2 lines]");
      expect(e.pastedContents?.[1].content).toBe("a\nb\nc");
    });
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
    api.colors = () => [...[...c.state.finalizedItems, ...c.state.pendingItems].flatMap((i) => (i.kind === "line" ? [i.line] : i.body)), ...c.state.streaming];
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
const CLOSING_PROSE = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-closes-run", content: [{ type: "text", text: "all done" }] } };
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
  // W-C T7 SEEDS `initialShowTurnDuration: false` HERE, and that is the whole point of the seam. The
  // end-of-turn `✻ Worked for 4s` row is a LOCAL ENTRY, and every local entry is a fold BREAKER — so with the
  // row on, `turn:end` publishes the run and this test's "a turn boundary is NOT a breaker" claim stops being
  // about the turn boundary at all. Turning the row off keeps the original claim testable in its own right;
  // the case below pins what the row does to the same sequence when it is on.
  it("keeps a settled-but-unclosed fold run visible in the dynamic region until a breaker publishes it", async () => {
    const fake = fakeRemote();
    // FSW T3: the split this case draws is compact-projection-vs-transient (`finalizedItems` vs
    // `pendingItems`), which is what `staticItems` used to stand in for. Publication to <Static> is a
    // separate, later boundary now, and is not what "published by a breaker" means here.
    let snap!: { finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[] };
    function H() {
      const c = useChat(() => fake, { initialShowTurnDuration: false });
      snap = { finalizedItems: c.state.finalizedItems, pendingItems: c.state.pendingItems };
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
    expect(snap.finalizedItems.filter((i) => i.id.startsWith("group:"))).toEqual([]);  // still withheld: a growable run is not finalized
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });                         // a turn boundary is NOT a breaker
    await waitFor(() => frame(lastFrame).includes("Read 1 file (ctrl+o to expand)"));
    expect(snap.pendingItems.map((i) => i.id)).toEqual(["group:read-1:unclosed-row"]);
    fake.pushEvent({ kind: "message", data: CLOSING_PROSE });                       // the breaker publishes it
    await waitFor(() => snap.finalizedItems.some((i) => i.id === "group:read-1:row"));
    expect(snap.pendingItems).toEqual([]);                                          // and the dynamic copy is gone the same render
    expect(frame(lastFrame).match(/Read 1 file \(ctrl\+o to expand\)/g)).toHaveLength(1);
  });

  it("with the duration row ON, turn end IS the breaker — the run publishes above it, exactly once", async () => {
    const fake = fakeRemote();
    let snap!: { finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[] };
    function H() {
      const c = useChat(() => fake, {}, { pickTurnVerb: () => "Worked" });
      snap = { finalizedItems: c.state.finalizedItems, pendingItems: c.state.pendingItems };
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: READ_CALL });
    fake.pushEvent({ kind: "message", data: READ_RESULT_FLAT });
    await waitFor(() => snap.pendingItems.some((i) => i.id === "group:read-1:unclosed-row"));
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => snap.finalizedItems.some((i) => i.id === "group:read-1:row"));
    expect(snap.pendingItems).toEqual([]);
    // ORDER MATTERS: the run is published at a lower sequence than the row that broke it, so the fold row
    // reads above `✻ Worked for …` rather than under it.
    const texts = snap.finalizedItems.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.body.map((l) => l.text)));
    expect(texts.findIndex((t) => t.includes("Read 1 file"))).toBeLessThan(texts.findIndex((t) => t.startsWith("Worked for")));
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
    await waitFor(() => flat(lastFrame).includes("❯ after the duplicate"));
  });

  it("publishes every stable RenderItem id exactly once — local visual, assistant text and divider alike", async () => {
    const fake = fakeRemote();
    let ids: string[] = [];
    // FSW TASK 3 FIX ROUND (review I1) — reads `finalizedItems`, not `staticItems`. This case was NOT among
    // the twelve the task re-pointed, because it stayed green: at the default 24-row geometry with three
    // items nothing is ever committed, so `ids` was empty and `new Set(ids).size === ids.length` was
    // comparing 0 to 0. "Every stable RenderItem id" is a claim about the finalized projection — which is
    // what `staticItems` used to be, and is now only its committed head.
    function H() { const c = useChat(() => fake); ids = [...c.state.finalizedItems].map((i) => i.id); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const text = { type: "assistant", parent_tool_use_id: null, message: { id: "stable-text", content: [{ type: "text", text: "stable reply" }] } };
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: text });
    fake.pushEvent({ kind: "message", data: text });                      // exact duplicate
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true, seq: 4 });   // a divider-shaped local record, twice
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true, seq: 4 });
    await waitFor(() => frame(lastFrame).includes("stable reply") && frame(lastFrame).includes("Earlier live output unavailable"));
    expect(ids.length).toBeGreaterThan(0);                                // …and it is not comparing 0 to 0
    expect(new Set(ids).size).toBe(ids.length);
    expect(frame(lastFrame).match(/stable reply/g)).toHaveLength(1);
    expect(frame(lastFrame).match(/Earlier live output unavailable/g)).toHaveLength(1);
  });

  // F6 T14: this pair used `/help` for its line-appending local command; `/help` opens a DIALOG now and
  // appends nothing but its echo. `/think` (no args) is the same shape — local, session-free, one line.
  it("gives the SAME local visual action a fresh monotonic identity each time it is invoked, so two /think runs both render", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/think");
    await waitFor(() => frame(lastFrame).includes("thinking:"));
    const before = (flat(lastFrame).match(/❯ \/think/g) ?? []).length;
    api.run!("/think");
    await waitFor(() => (flat(lastFrame).match(/❯ \/think/g) ?? []).length === before + 1);
  });

  it("same-session /resume APPENDS only unseen persisted rows and keeps the pre-resume local event in detail-all", async () => {
    const msgs = [{ type: "user", uuid: "u-prior", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const fake = fakeRemote({ sessionId: "same-1" });
    const api: { run?: (s: string) => void; pick?: (s: any) => void; detail?: (p: "detail-all" | "detail-collapsed") => readonly RenderItem[] } = {};
    let epoch = -1, published: string[] = [];
    function H() {
      const c = useChat(() => fake, {}, { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "same-1", summary: "s", lastModified: 1 }], getSessionMessages: async () => msgs });
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
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));
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
      const c = useChat(() => fake, { clearStaticTranscript: () => order.push(`clear@${c.state.staticEpoch}`) }, { hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => msgs });
      api.run = c.submit; api.clear = c.clear;
      return <Text>epoch:{c.state.staticEpoch} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/think");
    await waitFor(() => frame(lastFrame).includes("thinking:"));
    api.clear!();
    await waitFor(() => frame(lastFrame).includes("epoch:1"));
    expect(order).toEqual(["clear@0"]);                            // ran while the OLD epoch was still mounted
    expect(frame(lastFrame)).not.toContain("thinking:");           // the fresh <Static> did not replay history
  });

  it("stops the 600 ms pending repaint when the call settles, when the session is replaced, and on unmount", async () => {
    const scheduler = fakeScheduler();
    const first = fakeRemote(), second = fakeRemote();
    const msgs = [{ type: "user", uuid: "u-s", message: { content: [{ type: "text", text: "swapped" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const api: { pick?: (s: any) => void } = {};
    function H({ session }: { session: FakeRemote }) {
      const c = useChat(() => session, {}, { scheduleRepaint: scheduler.schedule, hasWorktrees: async () => false, listSessions: async () => [], getSessionMessages: async () => msgs });
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

    first.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "open-2", content: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/b.ts" } }] } } });
    await waitFor(() => scheduler.armed === 1);
    api.pick!({ sessionId: "other-1", summary: "s", lastModified: 1 });   // replace the session while a call is OPEN
    await waitFor(() => flat(view.lastFrame).includes("❯ swapped"));
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "tail-1", content: [{ type: "text", text: "retained idle tail" }] } } });
    fake.pushEvent({ kind: "state", status: { state: "working", status: "idle" } });
    await waitFor(() => frame(lastFrame).includes("retained idle tail"));
    expect(frame(lastFrame)).toContain("Earlier live output unavailable while attaching");
    expect(frame(lastFrame)).toContain("IDLE");                                // never busy — there is no later turn:end
    expect(frame(lastFrame).match(/Earlier live output unavailable/g)).toHaveLength(1);
  });

  // Round-1 review finding 1: a compact boundary is a SYSTEM frame, which the document never retains, so
  // document dedup cannot suppress a redelivered one — the divider's identity has to come from the boundary
  // itself.
  // Re-pointed at the bulleted form by F4 Task 10b; the GUARD is unchanged and is the reason this test exists.
  it("publishes ONE compact-summary row when the same compact_boundary frame is redelivered", async () => {
    const fake = fakeRemote();
    let items: readonly RenderItem[] = [];
    function H() { const c = useChat(() => fake); items = c.state.finalizedItems; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    const boundary = { type: "system", subtype: "compact_boundary", uuid: "compact-boundary-1" };
    fake.pushEvent({ kind: "message", data: boundary });
    await waitFor(() => frame(lastFrame).includes("Compact summary"));
    fake.pushEvent({ kind: "message", data: boundary });                  // the same boundary, redelivered by a follow replay
    await new Promise((r) => setTimeout(r, 30));
    expect(items.flatMap(itemLines).filter((t) => t.includes("Compact summary"))).toHaveLength(1);
  });

  // F4 final review, finding 2. An `info` system notice is TRANSCRIPT-ONLY, not dropped: sdk.d.ts's `level`
  // doc says "'info' shows only in transcript mode", and the bundle's transcript screen renders the message
  // list with `verbose: !0` (L476168), which is precisely the arm `dVo`'s `!verbose` info gate (L428497) reads.
  // Before the fix the frame was gated at INGEST and never entered the document, so ctrl+O could not show what
  // compact was hiding — the notice was unreachable in every projection.
  it("keeps a level:info system notice out of compact and IN the ctrl+O detail projections", async () => {
    const fake = fakeRemote();
    const api: { detail?: (p: "detail-all" | "detail-collapsed") => readonly RenderItem[] } = {};
    let items: readonly RenderItem[] = [];
    function H() { const c = useChat(() => fake); api.detail = c.detailItems; items = c.state.finalizedItems; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "informational", uuid: "sys-info-1", level: "info", content: "QUIET-INFO-LINE" } });
    // A `notice`-level frame beside it proves the gate is about LEVEL, not about system frames in general.
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "informational", uuid: "sys-notice-1", level: "notice", content: "LOUD-NOTICE-LINE" } });
    await waitFor(() => frame(lastFrame).includes("LOUD-NOTICE-LINE"));
    expect(frame(lastFrame)).not.toContain("QUIET-INFO-LINE");                 // compact hides it…
    expect(items.flatMap(itemLines).some((t) => t.includes("QUIET-INFO-LINE"))).toBe(false);
    for (const projection of ["detail-all", "detail-collapsed"] as const) {    // …detail shows it, in BOTH modes
      const lines = api.detail!(projection).flatMap(itemLines);
      expect(lines.some((t) => t.includes("QUIET-INFO-LINE"))).toBe(true);
      expect(lines.some((t) => t.includes("LOUD-NOTICE-LINE"))).toBe(true);
    }
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-2", content: [{ type: "tool_use", id: "read-2", name: "Read", input: { file_path: "/work/src/b.ts" } }] } } });
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

// F3 Task 3: the thinking clock's LIFETIME. The durations are produced by the turn's `LiveTurn` and the
// turn's `LiveTurn` is thrown away at `turn:end` — but the group row it belongs to outlives the turn (it
// stays in the transient region until a breaker publishes it, and then it is an immutable Static row), so
// useChat keeps its own map and merges into it on every repaint AND once at turn end, before the LiveTurn
// is dropped. A document swap clears it, which IS the replay-omission rule P82 requires.
describe("useChat: the thinking clock survives the turn that measured it", () => {
  const streamEvent = (event: unknown) => ({ kind: "message" as const, data: { type: "stream_event", event } });
  /** ONE assistant message carrying the thinking that preceded the call — the live shape (the engine emits
   *  one frame per content block, but our document retains whatever the host forwards). */
  const THINKING_READ = { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [
    { type: "thinking", thinking: "Checking the config first", signature: "sig" },
    { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/a.ts" } },
  ] } };
  const READ_DONE = { type: "user", uuid: "u-read-1", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "ok" }] } };

  function ClockHost({ fake, clock }: { fake: FakeRemote; clock: { now: number } }) {
    const c = useChat(() => fake, { cwd: "/work" }, { now: () => clock.now, home: "/home/me", platform: "darwin", columns: () => 100 });
    return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
  }

  it("keeps `Thought for Ns` on the settled group row after the turn ends", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    const { lastFrame } = render(<ClockHost fake={fake} clock={clock} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "m1" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    clock.now = 4200;
    fake.pushEvent(streamEvent({ type: "content_block_stop", index: 0 }));
    fake.pushEvent({ kind: "message", data: THINKING_READ });
    fake.pushEvent({ kind: "message", data: READ_DONE });
    await waitFor(() => frame(lastFrame).includes("Thought for 3s, read 1 file"));   // settled: past-tense clauses
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    // The LiveTurn that measured it is gone; the row must not lose its clause.
    expect(frame(lastFrame)).toContain("Thought for 3s, read 1 file");
    // …and it must survive publication into Static, which only a breaker triggers.
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m2", content: [{ type: "text", text: "all done" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("all done"));
    expect(frame(lastFrame)).toContain("Thought for 3s, read 1 file");
  });

  it("shows no clause at all when the run was never live-clocked (a replayed/attached transcript)", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    const { lastFrame } = render(<ClockHost fake={fake} clock={clock} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: THINKING_READ });          // the same messages, no stream_event frames
    fake.pushEvent({ kind: "message", data: READ_DONE });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("Read 1 file"));
    expect(frame(lastFrame)).not.toContain("Thought for");
  });
  it("freezes a block still OPEN at turn end — the last read of a clock that is about to be dropped", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    const { lastFrame } = render(<ClockHost fake={fake} clock={clock} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "m1" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    fake.pushEvent({ kind: "message", data: THINKING_READ });      // no content_block_stop: the turn is cut short
    fake.pushEvent({ kind: "message", data: READ_DONE });
    await waitFor(() => frame(lastFrame).includes("read 1 file") || frame(lastFrame).includes("Read 1 file"));
    expect(frame(lastFrame)).not.toContain("Thought for");         // 0 ms elapsed so far
    clock.now = 9000;
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    // Only the turn-end merge can have captured this: the LiveTurn is gone by the time the next
    // projection runs, and the block never stopped.
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m2", content: [{ type: "text", text: "all done" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("all done"));
    expect(frame(lastFrame)).toContain("Thought for 8s, read 1 file");
  });
});

// F3 Task 4: the pending region's time-dependent state (plan 2026-08-04-tui-clone-f3). `useChat` owns one
// `FoldPendingState` for the whole document epoch because the projection it feeds is rebuilt from scratch
// on every 600 ms repaint — upstream keeps the equivalent refs inside the row component, whose instance
// survives a growing run's re-renders. Every assertion below is made after EVERY advance, not only at the
// end: the whole point is that no intermediate frame shows the drop.
describe("useChat: latched counters and the throttled group hint", () => {
  const catCall = (id: string, file: string) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command: `cat ${file}` } }] } });
  const readCall = (id: string, file: string) =>
    ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Read", input: { file_path: file } }] } });
  const done = (id: string) => ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
  const POKE = { kind: "message" as const, data: { type: "system", subtype: "noop" } };   // a frame the document retains nothing of — it exists to force one repaint
  type Api = { run?: (s: string) => void; items?: () => readonly RenderItem[] };

  function LatchHost({ fake, clock, api }: { fake: FakeRemote; clock: { now: number }; api: Api }) {
    const c = useChat(() => fake, { cwd: "/work" }, { now: () => clock.now, home: "/home/me", platform: "darwin", columns: () => 100 });
    api.run = c.submit; api.items = () => c.state.pendingItems;
    return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
  }
  const hintText = (api: Api) => api.items!().flatMap((i) => (i.kind === "gutter-block" && i.id.endsWith(":pending-hint") ? i.body : [])).map((l) => l.text);
  const hintLines = (api: Api) => api.items!().flatMap((i) => (i.kind === "gutter-block" && i.id.endsWith(":pending-hint") ? i.body : []));
  const ids = (api: Api) => api.items!().map((i) => i.id).join(" ");

  it("holds the live row at its maximum when R1.5's read recount would drop it, and resets on a document swap", async () => {
    const fake = fakeRemote(), clock = { now: 1000 }, api: Api = {};
    const { lastFrame } = render(<LatchHost fake={fake} clock={clock} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: catCall("b1", "a.ts") });
    await waitFor(() => frame(lastFrame).includes("Reading 1 file"));
    fake.pushEvent({ kind: "message", data: done("b1") });
    fake.pushEvent({ kind: "message", data: catCall("b2", "b.ts") });
    await waitFor(() => frame(lastFrame).includes("Reading 2 files"));
    fake.pushEvent({ kind: "message", data: done("b2") });
    fake.pushEvent({ kind: "message", data: readCall("read-1", "/work/c.ts") });
    await waitFor(() => ids(api).includes("read-1"));                 // the run grew — its anchor `b1` did not
    // The would-be count here is 1: one distinct `file_path` beats the two bare read operations (R1.5).
    expect(frame(lastFrame)).toContain("Reading 2 files");
    expect(frame(lastFrame)).not.toContain("Reading 1 file");
    // …and the hint is still the FIRST one accepted: the clock has not moved, so the 700 ms window never opened.
    expect(hintText(api)).toEqual(["$ cat a.ts"]);
    clock.now = 1700; fake.pushEvent(POKE);
    await waitFor(() => hintText(api)[0] === "c.ts");                 // one window later the current candidate lands
    expect(frame(lastFrame)).toContain("Reading 2 files");            // and the latch is unaffected by the hint's clock

    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("IDLE"));
    api.run!("/clear");                                               // the document swap: rewind / resume / clear all land here
    await waitFor(() => !frame(lastFrame).includes("Reading"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "message", data: catCall("b1", "a.ts") });   // the SAME anchor id, from a rebuilt transcript
    await waitFor(() => frame(lastFrame).includes("Reading"));
    expect(frame(lastFrame)).toContain("Reading 1 file");
    expect(frame(lastFrame)).not.toContain("Reading 2 files");
  });

  it("gives the hint slot to a fresh thinking summary for 3000 ms, italic, then hands it back", async () => {
    const streamEvent = (event: unknown) => ({ kind: "message" as const, data: { type: "stream_event", event } });
    const fake = fakeRemote(), clock = { now: 1000 }, api: Api = {};
    const { lastFrame } = render(<LatchHost fake={fake} clock={clock} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "m1" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    clock.now = 4200;
    fake.pushEvent(streamEvent({ type: "content_block_stop", index: 0 }));
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [
      { type: "thinking", thinking: "Checking the\n  config   first", signature: "sig" },
      { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/a.ts" } },
    ] } } });
    await waitFor(() => frame(lastFrame).includes("Thinking for 3s, reading 1 file"));
    // The summary outranks the ordinary path hint while it is fresh, whitespace-collapsed WHOLE (not its
    // first line) and rendered italic — R4.7 step 5.
    expect(hintLines(api)).toEqual([{ text: "Checking the config first", dim: true, color: resolveThemeColor(themeTokens().inactive), italic: true }]);
    clock.now = 7199; fake.pushEvent(POKE);
    await waitFor(() => ids(api).length > 0);
    expect(hintText(api)).toEqual(["Checking the config first"]);
    clock.now = 7200; fake.pushEvent(POKE);
    await waitFor(() => hintText(api)[0] === "a.ts");
    expect(hintLines(api)[0]!.italic).toBeUndefined();                // back to the ordinary dim hint
  });
});

// ── F3 FINAL controller review (external codex reviewer): four findings, one describe ──────────────────
describe("useChat: F3 final review", () => {
  const streamEvent = (event: unknown) => ({ kind: "message" as const, data: { type: "stream_event", event } });
  const noRepaint = { scheduleRepaint: () => () => {} };   // the 600 ms blink would re-project on its own and mask what these pin
  const agentCall = (replay?: true) => ({
    kind: "message" as const, ...(replay ? { replay } : {}),
    data: { type: "assistant", parent_tool_use_id: null, uuid: "a1", message: { id: "m1", content: [{ type: "tool_use", id: "agent-1", name: "Agent", input: { description: "review the diff", prompt: "go" } }] } },
  });
  const agentResult = (replay?: true) => ({
    kind: "message" as const, ...(replay ? { replay } : {}),
    data: { type: "user", uuid: "u1", message: { content: [{ type: "tool_result", tool_use_id: "agent-1", content: "the report" }] } },
  });
  // One nested call, so the DERIVED rung has a tool-use count to report at all (`agentTerminalItems` paints
  // no row for a derived rung with zero observed children — that count would itself be fabricated).
  const agentChildFrames = (replay?: true) => [
    { kind: "message" as const, ...(replay ? { replay } : {}), data: { type: "assistant", uuid: "a2", parent_tool_use_id: "agent-1", message: { id: "m2", content: [{ type: "tool_use", id: "read-9", name: "Read", input: { file_path: "/work/a.ts" } }] } } },
    { kind: "message" as const, ...(replay ? { replay } : {}), data: { type: "user", uuid: "u2", parent_tool_use_id: "agent-1", message: { content: [{ type: "tool_result", tool_use_id: "read-9", content: "x" }] } } },
  ];

  // F1. Partials are default-on interactively now, so a turn carries thousands of deltas. Reprojecting the
  // whole retained transcript on each one is deltas × history — and it buys nothing, because `appendSdk`
  // rejects partials and the document therefore cannot have changed.
  it("a stream_event updates ONLY the live turn — pendingItems keeps its identity across a burst of deltas", async () => {
    const fake = fakeRemote();
    const seen: (readonly RenderItem[])[] = [];
    function H() {
      const c = useChat(() => fake, {}, noRepaint);
      seen.push(c.state.pendingItems);
      return <Text>{c.state.streaming.map((l) => l.text).join("") || "-"}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "sleep 5" } }] } } });
    await waitFor(() => (seen.at(-1)?.length ?? 0) > 0);          // the running call owns a transient row
    const projected = seen.at(-1)!, before = seen.length;
    fake.pushEvent(streamEvent({ type: "message_start", message: { id: "m2" } }));
    fake.pushEvent(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    for (const text of ["to", "ken", "s"]) fake.pushEvent(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
    await waitFor(() => frame(lastFrame).includes("tokens"));      // the deltas DID reach the live region
    expect(seen.length).toBeGreaterThan(before);                   // …and did re-render
    expect(seen.slice(before).every((items) => items === projected)).toBe(true);   // …without rebuilding the projection
  });

  // F2. The hint is derived from the live binding table at RENDER time, but the projection runs from
  // callbacks captured by effects keyed on `[session]` — so a rebind used to leave the old sentence on
  // screen while the key itself had already moved, which is exactly the dishonesty F2 shipped to end.
  it("a keybindings rebind moves the running-Bash background hint on the next projection", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake, {}, { ...noRepaint, env: {}, platform: "darwin" }); return <Text>{allText(c)}</Text>; }
    const withLayers = (layers: readonly ContextBindings[]) => <KeymapProvider deps={{ userLayers: layers }}><H /></KeymapProvider>;
    const { lastFrame, rerender } = render(withLayers([]));
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m1", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "sleep 5" } }] } } });
    fake.pushEvent({ kind: "task", data: { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "bash-1", task_type: "local_bash", description: "sleep" } });
    await waitFor(() => frame(lastFrame).includes("(ctrl+b to run in background)"));
    rerender(withLayers([{ context: "Global", bindings: { "ctrl+b": null, "ctrl+k": "task:background" } }]));
    await waitFor(() => frame(lastFrame).includes("(ctrl+k to run in background)"));
    expect(frame(lastFrame)).not.toContain("(ctrl+b to run in background)");
  });

  // ── F4 Task 10b: the expand hint, at every site that offers one ───────────────────────────────────────
  // `(ctrl+o to expand)` used to be a literal typed at four separate places, so a user who moved
  // `app:toggleTranscript` in keybindings.json was told to press a key that did nothing — everywhere at once,
  // in the busiest surface of the app. These two tests are the structural proof that the string is DERIVED:
  // the sentence has to follow the user's chord, and an unbind has to remove the offer rather than keep a
  // dead one on screen (E2). The layers go on BEFORE the frames because Ink's `<Static>` is append-only: the
  // guarantee is that every row printed from a rebind onward is honest, not that printed ink rewrites itself.
  describe("expand hint (Task 10b)", () => {
    const REBIND: readonly ContextBindings[] = [{ context: "Global", bindings: { "ctrl+o": null, "ctrl+t": "app:toggleTranscript" } }];
    const UNBIND: readonly ContextBindings[] = [{ context: "Global", bindings: { "ctrl+o": null } }];
    const read = (n: number) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", id: `r${n}`, name: "Read", input: { file_path: `/tmp/f${n}.ts` } }] } });
    const readResult = (n: number) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `r${n}`, content: "x" }] } });
    // THREE of the four sites are reachable from a live compact transcript: the collapsed tool-GROUP row
    // (toolRenderer, twice over — reads and the search), the generic output FOLD marker (outputFold), and the
    // compact boundary (species). The fourth, `toolSummaries`' `Found N files` sentence, is NOT reachable
    // here and that is upstream's own doing: its hint is compact-only (`$Wo`'s non-verbose branch), while a
    // compact projection folds every read/search call INTO the group row above, which replaces the typed body.
    // It is pinned instead in `species-system.test.ts`, where the projection can be named directly.
    async function paint(fake: FakeRemote, lastFrame: () => string | undefined) {
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      for (const n of [1, 2, 3]) { fake.pushEvent({ kind: "message", data: read(n) }); fake.pushEvent({ kind: "message", data: readResult(n) }); }
      fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "mb", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "seq 40" } }] } } });
      fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") }] } } });
      fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "mg", content: [{ type: "tool_use", id: "g1", name: "Grep", input: { pattern: "x" } }] } } });
      fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "g1", content: "a.ts" }] }, tool_use_result: { mode: "files_with_matches", numFiles: 3, filenames: ["a.ts", "b.ts", "c.ts"] } } });
      fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
      fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: "cb-1" } });
      await waitFor(() => frame(lastFrame).includes("Compact summary"));
    }

    it("renders the USER'S chord at the group row, the fold marker, the search sentence and the compact boundary", async () => {
      const fake = fakeRemote();
      function H() { const c = useChat(() => fake, {}, { ...noRepaint, platform: "darwin", columns: () => 80 }); return <Text>{allText(c)}</Text>; }
      const { lastFrame } = render(<KeymapProvider deps={{ userLayers: REBIND }}><H /></KeymapProvider>);
      await new Promise((r) => setTimeout(r, 20));
      await paint(fake, lastFrame);
      const painted = frame(lastFrame);
      expect(painted).toContain("Read 3 files (ctrl+t to expand)");            // toolRenderer's group row
      expect(painted).toContain("Searched for 1 pattern (ctrl+t to expand)");  // …and a second run through it
      expect(painted).toMatch(/… \+\d+ lines \(ctrl\+t to expand\)/);           // outputFold's overflow marker
      expect(painted).toContain("Compact summary (ctrl+t to expand)");         // species' compact boundary
      expect(painted).not.toContain("ctrl+o to expand");
    });

    it("an UNBOUND `app:toggleTranscript` removes the offer everywhere instead of naming a dead chord", async () => {
      const fake = fakeRemote();
      function H() { const c = useChat(() => fake, {}, { ...noRepaint, platform: "darwin", columns: () => 80 }); return <Text>{allText(c)}</Text>; }
      const { lastFrame } = render(<KeymapProvider deps={{ userLayers: UNBIND }}><H /></KeymapProvider>);
      await new Promise((r) => setTimeout(r, 20));
      await paint(fake, lastFrame);
      const painted = frame(lastFrame);
      expect(painted).not.toContain("to expand");
      expect(painted).toContain("Read 3 files");                                // the rows themselves survive…
      expect(painted).toContain("Searched for 1 pattern");
      expect(painted).toContain("Compact summary");
      expect(painted).toMatch(/… \+\d+ lines/);                                  // …and so does the overflow count
    });

    it("with the DEFAULT keymap every site still reads ctrl+o", async () => {
      const fake = fakeRemote();
      function H() { const c = useChat(() => fake, {}, { ...noRepaint, platform: "darwin", columns: () => 80 }); return <Text>{allText(c)}</Text>; }
      const { lastFrame } = render(<KeymapProvider deps={{ userLayers: [] }}><H /></KeymapProvider>);
      await new Promise((r) => setTimeout(r, 20));
      await paint(fake, lastFrame);
      const painted = frame(lastFrame);
      expect(painted).toContain("Read 3 files (ctrl+o to expand)");
      expect(painted).toContain("Searched for 1 pattern (ctrl+o to expand)");
      expect(painted).toContain("Compact summary (ctrl+o to expand)");
    });
  });

  // F5a. `ccx attach` mid-turn: host.follow() drains the turn buffer as `replay`-marked message frames.
  // Stamping them with the attach clock gave a completed, sidecar-less Agent a duration measured between
  // two frames that arrived milliseconds apart — a number about the attach, not about the work.
  it("a REPLAYED Agent result omits the duration instead of deriving one from attach-time stamps", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    function H() { const c = useChat(() => fake, {}, { ...noRepaint, now: () => clock.now }); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 7 });
    fake.pushEvent(agentCall(true));
    for (const ev of agentChildFrames(true)) fake.pushEvent(ev);
    clock.now = 9000;                                              // the attach drain takes real time; it is not the agent's
    fake.pushEvent(agentResult(true));
    fake.pushEvent({ kind: "state", status: { state: "working", status: "busy" } });
    await waitFor(() => frame(lastFrame).includes("Done ("));
    expect(frame(lastFrame)).toContain("Done (1 tool use)");
    expect(frame(lastFrame)).not.toContain("8s");                  // the fabricated 1000 → 9000 span
  });

  it("a LIVE Agent still derives its duration from the dispatch→result clock (the suppression is replay-only)", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    function H() { const c = useChat(() => fake, {}, { ...noRepaint, now: () => clock.now }); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 7 });
    fake.pushEvent(agentCall());
    for (const ev of agentChildFrames()) fake.pushEvent(ev);
    clock.now = 9000;
    fake.pushEvent(agentResult());
    await waitFor(() => frame(lastFrame).includes("Done ("));
    expect(frame(lastFrame)).toContain("Done (1 tool use · 8s)");
  });

  // F5b. The `system/task_*` sidechannel reaches a LIVE client as its own `task` event, but the follow drain
  // replays it as an ordinary `message` frame — so an attaching client used to lose the notification rung
  // (whose totals are the host's own measurements, valid whenever they are read) along with the stamps.
  it("a task_notification REPLAYED as a message frame still supplies the notification rung", async () => {
    const fake = fakeRemote(), clock = { now: 1000 };
    function H() { const c = useChat(() => fake, {}, { ...noRepaint, now: () => clock.now }); return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 7 });
    fake.pushEvent(agentCall(true));
    fake.pushEvent({ kind: "message", replay: true, data: { type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "agent-1", status: "completed", usage: { total_tokens: 4195, tool_uses: 2, duration_ms: 4484 } } });
    clock.now = 9000;
    fake.pushEvent(agentResult(true));
    fake.pushEvent({ kind: "state", status: { state: "working", status: "busy" } });
    await waitFor(() => frame(lastFrame).includes("Done ("));
    expect(frame(lastFrame)).toContain("Done (2 tool uses · 4.2k tokens · 4s)");   // from the wire, not from our clock
  });
});

// W-S5 (Wave S task 8). `ctxPct` had exactly one writer — turn end's refreshCtx — and no reset, so the last
// measurement outlived every conversation it described. Both halves of A8 on each path: the percentage GOES
// (never a build that simply never had one — each test measures a real 5% first), and the next turn end
// brings back a DIFFERENT, freshly measured number, so a restored stale value could not pass for it. The
// reset lives in replaceDocument, which is the boundary all these paths already share.
//
// Every half TWO waits on the turn's own REPLY — this builder tags it with the prompt that earned it — and
// then polls the percentage as an assertion of its own, rather than making `waitFor` the assertion: a build
// that never re-measures fails with the value it wrongly kept ("expected 'ctx:5 …' to contain 'ctx:42'")
// instead of a bare `waitFor timeout` that names nothing. The reply alone can't carry the assertion — it
// renders a microtask BEFORE the measurement refreshCtx triggers lands, so the poll is what closes that gap.
const reply = (p: string) => [{ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `re: ${p}` }] } }];
describe("W-S5: the context percentage never outlives the conversation it measured", () => {
  // W2 T6's fix round (D-W11) changed what `/status` does at the second half of this cell and NOT what the
  // rule is. `/status` used to render `ctxPct` and therefore showed nothing after a `/clear`; it now takes
  // its own reading. That is still "the measurement dies with its conversation" — what A8 forbids is the
  // number 5, measured before the wipe, surviving it. A freshly measured 42 is the new conversation's own
  // answer, and asserting on the VALUE is a strictly stronger pin than asserting the row is absent: a build
  // that resurrected the stale reading fails here naming the number it wrongly kept.
  it("/clear hides the measured percentage — /status re-measures rather than resurrecting it — and the next turn end measures its own (A8)", async () => {
    let ctx = { totalTokens: 5, maxTokens: 100 };
    const fake = fakeRemote({ getContextUsage: async () => ctx, submitMessages: reply });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { clearViewport: () => {} }); api.run = c.submit; return <Text>ctx:{c.state.ctxPct ?? "-"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");                                                     // a real turn — its end is what measures the context
    await waitFor(() => frame(lastFrame).includes("ctx:5"));
    api.run!("/status");
    await waitFor(() => flat(lastFrame).includes("context 5% used"));   // the conversation's own reading
    ctx = { totalTokens: 42, maxTokens: 100 };                          // the NEXT measurement differs from the stale one
    api.run!("/clear");
    await waitFor(() => !frame(lastFrame).includes("Status"));          // the document wipe landed
    expect(frame(lastFrame)).toContain("ctx:-");                        // half one: the chip is gone
    api.run!("/status");
    await waitFor(() => flat(lastFrame).includes("context 42% used"));  // …and /status answers with a NEW reading
    expect(flat(lastFrame)).not.toContain("context 5% used");           // never the wiped conversation's
    ctx = { totalTokens: 73, maxTokens: 100 };                          // a third value, so the turn's own measurement is named
    api.run!("second");
    await waitFor(() => frame(lastFrame).includes("re: second"));       // the second turn's REPLY, then the measurement
    await expect.poll(() => frame(lastFrame)).toContain("ctx:73");      // it triggers — a retry that fails with the VALUE
  });

  it("/resume onto a DIFFERENT session drops the previous session's percentage, and the first turn there measures its own (A8)", async () => {
    // The worst of the three: not a stale number about this conversation, the OTHER one's number rendered
    // against this one. The two fakes report deliberately different usage so the assertion names which.
    const oldSession = fakeRemote({ getContextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }), submitMessages: reply });
    const newSession = fakeRemote({ sessionId: "old1234567890", getContextUsage: async () => ({ totalTokens: 42, maxTokens: 100 }), submitMessages: reply });
    const makeSession = (resume?: string) => (resume ? newSession : oldSession);
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "old1234567890", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(makeSession, {}, deps);
      pick = (c as any).pickSession; api.run = c.submit;
      return <Text>ctx:{c.state.ctxPct ?? "-"} {c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("ctx:5"));            // measured against the session we are leaving
    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "old1234567890", summary: "prior", lastModified: 1 });
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));    // the swap landed
    expect(frame(lastFrame)).toContain("ctx:-");                        // half one: 5% described the session we left
    api.run!("carry on");
    await waitFor(() => frame(lastFrame).includes("re: carry on"));     // half two: the RESUMED session's own
    await expect.poll(() => frame(lastFrame)).toContain("ctx:42");      // measurement, off its own turn's reply
  });

  // The pair to the different-session case above, and to rewind test 16: resuming the SAME session into
  // itself KEEPS the percentage. It never reaches replaceDocument (the rows are appended to the existing
  // document), and that is the right answer, not an accident — the conversation is the one that was measured,
  // so the number is not lying. Like 16, this guards the reset's PLACEMENT: hoist it to the top of
  // `resumeInto`, above the sameSession branch, and this goes red while the different-session test above
  // stays green.
  it("/resume onto the SAME session KEEPS its percentage — nothing about that conversation changed (A8)", async () => {
    const fake = fakeRemote({ getContextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }), submitMessages: reply });
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "prior prompt" }] }, timestamp: "2026-06-19T15:56:00.000Z" }];
    const deps = { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "sess-1", summary: "prior", lastModified: 1 }], getSessionMessages: async () => msgs };
    let pick: ((s: any) => void) | undefined;
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, {}, deps);                          // the same fake back: sessionId "sess-1" either way
      pick = (c as any).pickSession; api.run = c.submit;
      return <Text>ctx:{c.state.ctxPct ?? "-"} {c.state.picker.open ? `PICKER:${c.state.picker.sessions.length}` : "NOPICK"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await waitFor(() => frame(lastFrame).includes("NOPICK"));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("ctx:5"));
    api.run!("/resume");
    await waitFor(() => frame(lastFrame).includes("PICKER:1"));
    pick!({ sessionId: "sess-1", summary: "prior", lastModified: 1 });
    await waitFor(() => flat(lastFrame).includes("❯ prior prompt"));    // the disk rows were APPENDED, not swapped in
    expect(frame(lastFrame)).toContain("ctx:5");                        // …and the measurement of that same conversation stands
  });

  // W-S5 Minor 3 (task 8 review). The one path where the number still describes THIS conversation and is
  // still wrong: a compaction shrinks the engine's context under it, and turn end is refreshCtx's only other
  // caller, so the chip overstated until the next turn ended. Both halves: the pre-compact reading is gone
  // AND the post-compact one is on screen — 90 → 12, so a kept stale value could not pass for the new one.
  it("/compact re-measures the percentage the compaction just invalidated (A8)", async () => {
    let ctx = { totalTokens: 90, maxTokens: 100 };
    const fake = fakeRemote({
      getContextUsage: async () => ctx, submitMessages: reply,
      compact: async () => { ctx = { totalTokens: 12, maxTokens: 100 }; return { ok: true, preTokens: 90000, postTokens: 12000 }; },
    });
    const api: { run?: (s: string) => void; text?: () => string } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.text = () => allText(c); return <Text>ctx:{c.state.ctxPct ?? "-"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("ctx:90"));           // a real, near-full reading to invalidate
    api.run!("/compact");
    // WAIT ON THE PROJECTION, NOT THE FRAME (wave 2 acceptance, gate flake). This wait timed out in 2 runs
    // in 5 — and at 20 s as readily as at 2 s, so it was never the budget. The row IS there; the frame spells
    // it `✦  compacted` because Ink wraps this single joined <Text> at the viewport edge and `frame` turns
    // the inserted newline into a second space. WHERE it wraps moves run to run, because the duration row
    // above it is `pickTurnVerb()` — a `Math.random()` pick whose verbs differ in length ("Baked" vs
    // "Crunched"), which slides every later column by up to three. The projected transcript has no viewport
    // and no wrap, so the needle means what it says.
    await waitFor(() => api.text!().includes("✦ compacted"));           // the outcome line — again, not the assertion
    await expect.poll(() => frame(lastFrame)).toContain("ctx:12");      // safe on the frame: it is at column 0
    expect(frame(lastFrame)).not.toContain("ctx:90");
  });

  // Why the drop is a separate statement BEFORE the re-measure rather than left to refreshCtx: refreshCtx
  // swallows its own failures and keeps the old value, so a re-measure that cannot answer would leave the
  // pre-compact number on a context that no longer has it. Nothing true to say → show nothing.
  it("/compact whose re-measure fails shows NO percentage rather than the pre-compact one", async () => {
    let ctx: { totalTokens: number; maxTokens: number } | undefined = { totalTokens: 90, maxTokens: 100 };
    const fake = fakeRemote({
      getContextUsage: async () => { if (!ctx) throw new Error("context unavailable"); return ctx; }, submitMessages: reply,
      compact: async () => { ctx = undefined; return { ok: true, preTokens: 90000, postTokens: 12000 }; },
    });
    const api: { run?: (s: string) => void; text?: () => string } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; api.text = () => allText(c); return <Text>ctx:{c.state.ctxPct ?? "-"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("ctx:90"));
    api.run!("/compact");
    await waitFor(() => api.text!().includes("✦ compacted"));           // the projection, not the wrapped frame — see above
    await expect.poll(() => frame(lastFrame)).toContain("ctx:-");
  });

  // The other side of that line: a compaction that FAILED changed no context, so the measurement it was
  // taken against is still the live one. Dropping it there would hide a number that is still true.
  it("a FAILED /compact leaves the percentage alone — no context changed", async () => {
    const fake = fakeRemote({
      getContextUsage: async () => ({ totalTokens: 90, maxTokens: 100 }), submitMessages: reply,
      compact: async () => ({ ok: false, result: "failed", error: "nope" }),
    });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>ctx:{c.state.ctxPct ?? "-"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hi");
    await waitFor(() => frame(lastFrame).includes("ctx:90"));
    api.run!("/compact");
    await waitFor(() => frame(lastFrame).includes("compact: nope"));
    await new Promise((r) => setTimeout(r, 30));                        // long enough for a stray drop to land
    expect(frame(lastFrame)).toContain("ctx:90");
  });
});

// W-S7 (Wave S task 11). Compaction had no busy STATE at all: the only in-progress affordance was a
// permanent `append()` in the `/compact` arm, so the transcript kept `✻ compacting…` forever beside the
// `✦ compacted N → M` result. Upstream discards its spinner/hint/bar together at compact_end (`a()`,
// L407334) and persists only the `Compacted …` message — ephemeral render state, not a transient row.
// Both entry paths are covered here because they are genuinely different mechanisms: the AUTOMATIC one
// arrives on the wire as a `system/status` frame, the `/compact` one never reaches the wire at all (the
// host calls `session.compact()` directly, and that method's frames die in its own private onMessage).
describe("W-S7: compaction is a real busy state with an ephemeral progress affordance", () => {
  it("enters a busy state while compaction runs and leaves it at the boundary (A13)", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => frame(lastFrame).includes("c:YES"));
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", compact_metadata: { pre_tokens: 100, post_tokens: 20 } } });
    await waitFor(() => frame(lastFrame).includes("c:no"));
  });

  it("tears the in-progress affordance down, leaving only the result row (A13)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fake = fakeRemote({ compact: async () => { await gate; return { ok: true, preTokens: 9000, postTokens: 2000 }; }, getContextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }) });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/compact");
    await waitFor(() => frame(lastFrame).includes("c:YES"));            // busy WHILE the pass runs — the affordance is state
    release();
    await waitFor(() => frame(lastFrame).includes("✦ compacted 9k → 2k"));
    await expect.poll(() => frame(lastFrame)).toContain("c:no");        // …and gone when it resolves
    expect(frame(lastFrame)).not.toContain("compacting…");              // the permanent append is what this replaces
  });

  it("clears the busy state when the compaction FAILS, not only when it succeeds", async () => {
    const fake = fakeRemote({ compact: async () => ({ ok: false, result: "failed", error: "nope" }) });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/compact");
    await waitFor(() => frame(lastFrame).includes("compact: nope"));
    expect(frame(lastFrame)).toContain("c:no");
  });

  // The belt: an automatic compaction that dies without ever emitting its boundary (an interrupt, a turn
  // that errors out mid-pass) would otherwise leave the bar up forever, because the wire path has no other
  // terminator. Turn end clears it unconditionally.
  it("turn end clears a compaction that never reached its boundary", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => frame(lastFrame).includes("c:YES"));
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("c:no"));
  });

  // T11 REVIEW, the strand. `follow()` (host.ts:465-496) drains the last COMPLETED turn's buffer with
  // `replay: true` and sends NO turn events on an idle attach — so a turn interrupted mid-auto-compaction
  // leaves a buffered `status:"compacting"` with no boundary after it, and an unguarded arm would paint
  // `Compacting conversation… 0%` on the attaching client forever: the turn-end belt waits on a turn event
  // that never arrives, and the idle `state` arm clears retryStatus but not this. Same guard, same reason,
  // as `ingestTaskFrame`'s a few lines above it.
  it("a REPLAYED compacting frame is history, not a live pass — it can never strand the bar", async () => {
    const fake = fakeRemote();
    function H() { const c = useChat(() => fake); return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "message", replay: true, data: { type: "system", subtype: "status", status: "compacting" } });
    await new Promise((r) => setTimeout(r, 30));                        // long enough for a stray set to land
    expect(frame(lastFrame)).toContain("c:no");
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
    await waitFor(() => frame(lastFrame).includes("c:YES"));            // …and a LIVE one still arms it
  });

  // T11 REVIEW: the `finally` had no pin — every failure fake in this file RETURNS `{ok:false}`, so
  // replacing try/finally with sequential statements kept the whole suite green. A compaction that THROWS
  // is the case that separates them: the outcome append never runs, and only a `finally` takes the bar down.
  it("clears the busy state when the compaction THROWS, and still reports the error", async () => {
    const fake = fakeRemote({ compact: async () => { throw new Error("boom"); } });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake); api.run = c.submit; return <Text>c:{c.state.compacting ? "YES" : "no"} {allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/compact");
    await waitFor(() => frame(lastFrame).includes("✗ boom"));           // the dispatch catch reports it
    expect(frame(lastFrame)).toContain("c:no");                         // …and the affordance is gone with it
  });
});

// ─── WAVE C TASK 14: the two warnings that used to be always-on chips ────────────────────────────────────
// Both left the retired status bar (spec D-C3) and re-enter as QUEUE entries. The pins here are about the
// PLUMBING — that the ladder is computed at the turn-end refresh, that it carries the spec's key/priority/
// timeout, that the error rung is coloured, and that a refresh which finds nothing to say takes the entry
// back down. The ladder's own arithmetic is pinned in `test/unit/token-warning.test.ts`.
describe("the token-warning and usage-warning notifications", () => {
  // `18_000_000` is five hours: an entry that is never re-posted and never removed would outlive the
  // conversation that earned it, which is exactly why the "falls back to ok → remove" case below exists.
  // 167 000 = 200 000 − min(maxOutputTokens, 20 000) − 13 000, upstream's own ceiling (`Tbe` L164098 fed
  // through `Sfo` L163981). The ladder's arithmetic on it is pinned in the unit test; here it only has to be
  // the SAME number the implementation uses, or the plumbing assertions below would pass on a lie.
  const WINDOW = 200_000, CEILING = 167_000;
  function NotifHost({ makeSession, api }: { makeSession: () => ChatSession; api?: { run?: (s: string) => void } }) {
    const c = useChat(makeSession);
    if (api) api.run = c.submit;
    const n = c.state.notification;
    return <Text>n:{n ? `${n.key}|${n.text}|${n.color ?? "-"}|${n.priority}|${n.timeoutMs}` : "none"}</Text>;
  }

  it("posts nothing while the context is comfortably under the warn threshold", async () => {
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: CEILING - 21_000, maxTokens: WINDOW }) });
    const { lastFrame } = render(<NotifHost makeSession={() => fake} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await new Promise((r) => setTimeout(r, 40));                        // long enough for the refresh to land
    expect(frame(lastFrame)).toContain("n:none");
  });

  it("posts the warn rung at the turn-end refresh, with the spec's key, priority and timeout", async () => {
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: CEILING - 19_000, maxTokens: WINDOW }) });
    const { lastFrame } = render(<NotifHost makeSession={() => fake} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("token-warning"));
    // no colour of its own → the slot renders it dim, which is upstream's own auto-compact-enabled arm
    // used = 148 000 → (167 000 − 148 000) / 167 000 = 11.377% → 11
    expect(frame(lastFrame)).toContain("n:token-warning|11% until auto-compact|-|medium|18000000");
  });

  it("escalates past the ceiling to the error-coloured Context low text", async () => {
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: CEILING + 5_000, maxTokens: WINDOW }) });
    const { lastFrame } = render(<NotifHost makeSession={() => fake} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("token-warning"));
    expect(frame(lastFrame)).toContain("Context low (0% remaining) · Run /compact to compact & continue");
    expect(frame(lastFrame)).toContain(`|${resolveThemeColor(themeTokens().error)}|medium|`);
  });

  it("takes the entry back down once a later refresh finds the context healthy again", async () => {
    let used = CEILING + 5_000;
    const fake = fakeRemote({ getContextUsage: () => ({ totalTokens: used, maxTokens: WINDOW }) });
    const { lastFrame } = render(<NotifHost makeSession={() => fake} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("token-warning"));
    used = 1_000;                                                       // …as a /compact would leave it
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("n:none"));
  });

  // REVIEW FIX (finding 1). The entry is a FIVE-HOUR row that describes one specific conversation. `/clear`,
  // a resume and a rewind all swap that conversation out through `replaceDocument` — the shared reset boundary
  // where `ctxPct`, the cache-miss ack and the suggester already go — so the row has to come down with them.
  // Left up, `Context low (0% remaining) · Run /compact…` sits on screen describing a transcript that no
  // longer exists, until the next COMPLETED turn happens to re-measure. The plan-usage warning deliberately
  // does not follow: that one is an account-level fact about the rate-limit window, and /clear does not
  // refill your quota.
  it("takes the token-warning down at the document swap — and leaves the account-level usage warning alone", async () => {
    const fake = fakeRemote({
      getContextUsage: () => ({ totalTokens: CEILING + 5_000, maxTokens: WINDOW }),
      usage: () => ({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 91 } } }),
      clearSession: async () => {},
    });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<NotifHost makeSession={() => fake} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("token-warning"));
    api.run!("/clear");
    // The usage warning is queued behind it and surfaces the moment the slot frees up; what must NOT survive
    // is the context row, so the assertion is on that key's absence rather than on an empty slot.
    await waitFor(() => !frame(lastFrame).includes("token-warning"));
    expect(frame(lastFrame)).not.toContain("Context low");
  });

  it("the plan-usage warning posts as a queued notification too, and only when it CHANGES", async () => {
    let util = 91;
    const fake = fakeRemote({
      getContextUsage: () => ({ totalTokens: 1_000, maxTokens: WINDOW }),
      usage: () => ({ rate_limits_available: true, rate_limits: { five_hour: { utilization: util } } }),
    });
    const { lastFrame } = render(<NotifHost makeSession={() => fake} />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("⚠ 5h 91%"));
    // REVIEW FIX (finding 3): the LONG timeout, not the queue's 8 s default. The post is change-gated, so an
    // 8 s row would flash once and never come back while the percentage held — a standing condition rendered
    // as a blink. Five hours is "until something replaces or removes it", which is what a standing condition
    // deserves and what this warning had as permanent status-bar chrome before Wave C moved it here.
    expect(frame(lastFrame)).toMatch(/n:usage-warning\|[^|]*\|[^|]*\|medium\|18000000/);
    util = 40;                                                          // the window rolled over
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await waitFor(() => frame(lastFrame).includes("n:none"));
  });
});

// ── WAVE 2 TASK 6 (EP-D4) — THE STATUS LINE'S MOUNT SITE ─────────────────────────────────────────────
// The payload builder is pinned field-for-field in test/unit/statusline.test.ts; what only a MOUNTED hook
// can answer is which ccx value reaches which field AT WHICH MOMENT, and how many times the script runs.
// Every cell here drives the real driver through a FAKE RUNNER, so no shell is ever forked and the payload
// each run carried is readable back as JSON.
//
// WHAT EACH CELL MEASURED BEFORE THE CHANGE (the negative pins this task started from, all run green
// against the pre-change tree): the payload carried no `transcript_path`, no `prompt_id`, no `fast_mode`
// and no `rate_limits`; `context_window.context_window_size` was 0 with both percentages null on every
// pre-turn run; and a boot cost TWO runs of the script. They are flipped in place rather than deleted so
// each arrival is a visible diff in this file's history.
type StatusRun = { payload: any; resolve: (t: string | undefined) => void };
function statusRunner() {
  const runs: StatusRun[] = [];
  const run = (_c: unknown, payload: string): Promise<string | undefined> =>
    new Promise<string | undefined>((resolve) => { runs.push({ payload: JSON.parse(payload), resolve }); });
  return { runs, run };
}
const STATUS_CFG = { type: "command" as const, command: "my-status" };
/** THE CLOCK SEAM (fix round, MINOR 5). Both timers the mount site owns — the driver's 300 ms trailing
 *  debounce and the 1500 ms mount-read cap — are armed through `deps.statusLine`'s `setTimeout`/
 *  `clearTimeout`, the same pair `test/tui/footer.test.tsx` has always injected. These cells used to sleep
 *  500 ms of REAL time each, eight of them, for ~8.6 s of suite time that pinned nothing virtual time
 *  cannot; and the cap is 1500 ms, which real sleeps could not have afforded to drive at all. */
function slClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown) => { timers.delete(h as number); },
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
  };
}
type SlClock = ReturnType<typeof slClock>;
/** Flush the real microtask/promise queue, then move VIRTUAL time on — repeatedly, because a boot is a chain
 *  of promises with timers between them (the mount read resolves, and only then does the boot run's window
 *  open). Eight windows = 2400 virtual ms, which clears the worst case the mount site can produce: the
 *  1500 ms cap with a full debounce behind it. */
async function settle(clock: SlClock, windows = 8): Promise<void> {
  for (let i = 0; i < windows; i++) { await new Promise((r) => setTimeout(r, 1)); clock.advance(300); }
  await new Promise((r) => setTimeout(r, 1));
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
/** The launch state a real `ccx` boot has: a model and a mode from the launch config, a catalog that answers
 *  a tick later, and a host `state` frame. All four are deltas on the statusLine's own list, and they are
 *  what used to turn one boot into two runs. */
const bootCaps = { models: [{ value: "claude-opus-4-6", displayName: "Opus 4.6", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }], commands: [], mcpServers: [] };

describe("useChat: the statusLine payload and cadence (W2 T6, canon Q3/Q4)", () => {
  /** One mounted hook with a statusLine configured, plus whatever launch state the cell needs. */
  function mountStatus(fake: FakeRemote, r: { run: any }, clock: SlClock, extra: Record<string, unknown> = {}, latch?: any) {
    function H() {
      useChat(() => fake, { statusLine: STATUS_CFG, ...(latch ? { promptLatch: latch } : {}), ...extra } as any,
        { statusLine: { runStatusLine: r.run, ...clock.deps } });
      return <Text>ok</Text>;
    }
    return render(<H />);
  }

  // ── THE BOOT GATE (fix round MAJOR 1, spec D-W11) ────────────────────────────────────────────────────
  // The shipped shape fired the context read and the boot run independently and hoped the 300 ms debounce
  // outlasted the read. The review timed the read at ~1.2 s warm, so it did not: a live boot ran the script
  // twice and the first payload carried `context_window_size: 0`. The run now WAITS for the read, capped.
  // Both outcomes of that race are driven here, because only the pair proves the gate is a race and not a
  // sleep: the read winning must produce one run with a real window, the cap winning one run with a zero.

  it("the boot run waits for the mount context read — nothing runs until it lands, then ONE run with a real window", async () => {
    const clock = slClock(), r = statusRunner();
    let landRead!: (u: unknown) => void;
    const reading = new Promise<unknown>((res) => { landRead = res; });
    const fake = fakeRemote({ capabilities: () => bootCaps, getContextUsage: () => reading });
    mountStatus(fake, r, clock, { initialModel: "claude-opus-4-6", initialMode: "default", initialEffort: "high" });
    // A real boot delta, landing WHILE the read is still out — the case that made the old shape run early.
    fake.pushEvent({ kind: "state", status: { state: "idle", status: "idle", permissionMode: "acceptEdits" } } as any);
    await settle(clock, 3);                               // 900 virtual ms: three whole debounce windows
    expect(r.runs).toHaveLength(0);                       // was: a run at +300 ms carrying a zero window
    landRead({ totalTokens: 12_000, maxTokens: 1_000_000 });
    await settle(clock, 2);
    expect(r.runs).toHaveLength(1);                       // was 2: the early run plus its correction
    expect(r.runs[0].payload.context_window).toMatchObject({
      context_window_size: 1_000_000, total_input_tokens: 12_000, used_percentage: 1, remaining_percentage: 99,
    });
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "hi" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock, 2);
    expect(r.runs).toHaveLength(2);                       // turn end + both refreshers, coalesced into one
  });

  // ── WAVE 2 ACCEPTANCE A8 — ONE REFRESH PER TURN, AND IT IS THE ONE THAT CARRIES THE NEW NUMBERS ──────
  // The cell above proves the turn-end coalescing with a fake whose readings resolve in the same microtask.
  // A real session's do not: `getContextUsage()` and `usage()` are control round-trips measured at ~1.2 s,
  // four times the 300 ms window, so the live cadence was a turn-end run carrying the PREVIOUS turn's cost
  // and a second run once the readings landed. Deferring the readings past the window is the whole fix's
  // test: it reproduces the live shape that instant fakes hide.
  it("A8: a turn refreshes ONCE even when the readings land after the debounce window, and that run carries them", async () => {
    const clock = slClock(), r = statusRunner();
    let ctxCalls = 0;
    let landCtx!: (u: unknown) => void, landUsage!: (u: unknown) => void;
    let facts: any = {};
    const latch = { read: () => facts, clear: () => { facts = {}; }, hooks: () => ({}) };
    const fake = fakeRemote({
      // The MOUNT read answers at once (the boot gate has its own cells); the TURN-END read is the slow one.
      getContextUsage: () => (++ctxCalls === 1
        ? Promise.resolve({ totalTokens: 12_000, maxTokens: 1_000_000 })
        : new Promise((res) => { landCtx = res; })),
      usage: () => new Promise((res) => { landUsage = res; }),
    });
    // THE FIRST turn, so `adoptAiTitle` fires here too — a LOCAL disk read that answers long before the two
    // control calls. It used to poke on its own and cost this turn a second run; it is awaited now instead.
    function H() {
      useChat(() => fake, { statusLine: STATUS_CFG, promptLatch: latch } as any,
        { statusLine: { runStatusLine: r.run, ...clock.deps }, getSessionInfo: async () => ({ summary: "Engine's own title" }) } as any);
      return <Text>ok</Text>;
    }
    render(<H />);
    await settle(clock, 2);
    expect(r.runs).toHaveLength(1);                                   // boot: one run, as EP-D4 already had it
    expect(r.runs[0].payload.cost.total_cost_usd).toBe(0);

    facts = { transcriptPath: "/home/u/.claude/projects/-repo/s.jsonl", promptId: "pid-turn-1" };
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock, 3);                                           // 900 ms with both readings still out
    expect(r.runs).toHaveLength(1);                                   // was 2: a run with the OLD cost and the new prompt_id

    landCtx({ totalTokens: 22_690, maxTokens: 1_000_000 });
    landUsage({ session: { total_cost_usd: 0.0664025, model_usage: { m: { outputTokens: 21 } } } });
    await settle(clock, 2);
    expect(r.runs).toHaveLength(2);                                   // the turn's ONE refresh
    const refresh = r.runs[1].payload;
    expect(refresh.cost.total_cost_usd).toBe(0.0664025);              // updated, not the previous total
    expect(refresh.context_window.total_output_tokens).toBe(21);
    expect(refresh.prompt_id).toBe("pid-turn-1");                     // and still the turn's own prompt id
    expect(refresh.transcript_path).toBe("/home/u/.claude/projects/-repo/s.jsonl");
    expect(refresh.session_name).toBe("Engine's own title");          // the title rides IN it, not in a run of its own
  });

  it("a context read that never answers cannot suppress the row forever: the cap fires, one run, zero window", async () => {
    const clock = slClock(), r = statusRunner();
    const fake = fakeRemote({ getContextUsage: () => new Promise(() => {}) });   // a control call that hangs
    mountStatus(fake, r, clock);
    await settle(clock, 3);                               // 900 ms — still inside STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS
    expect(r.runs).toHaveLength(0);
    await settle(clock, 4);                               // past 1500 ms: the cap wins the race
    expect(r.runs).toHaveLength(1);
    // The honest fallback, and the reason the cap is not simply an unbounded await: the row appears with the
    // zero window it used to have and the first turn end corrects it.
    expect(r.runs[0].payload.context_window).toMatchObject({ context_window_size: 0, used_percentage: null, remaining_percentage: null });
  });

  it("`fast_mode` is on every payload, from the boot run on", async () => {
    const clock = slClock(), r = statusRunner();
    mountStatus(fakeRemote(), r, clock);
    await settle(clock);
    expect(r.runs[0].payload.fast_mode).toBe(false);
  });

  it("`rate_limits` rides through from session.usage() when the credential can see the windows", async () => {
    const clock = slClock(), r = statusRunner();
    const fake = fakeRemote({ usage: () => ({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 42, resets_at: "2026-08-11T20:00:00Z" } } }) });
    mountStatus(fake, r, clock);
    await settle(clock);
    expect("rate_limits" in r.runs[0].payload).toBe(false);          // no usage reading yet — nothing to report
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock);
    expect(r.runs[r.runs.length - 1].payload.rate_limits).toEqual({ five_hour: { used_percentage: 42, resets_at: "2026-08-11T20:00:00Z" } });
  });

  it("`rate_limits` stays absent under a credential that cannot see the buckets (this project's own)", async () => {
    const clock = slClock(), r = statusRunner();
    const fake = fakeRemote({ usage: () => ({ rate_limits_available: false, rate_limits: null }) });
    mountStatus(fake, r, clock);
    await settle(clock);
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock);
    expect("rate_limits" in r.runs[r.runs.length - 1].payload).toBe(false);
  });

  // D-W4, THE NAMED IDENTITY SWAP. Pre-turn the payload carries a client-minted uuid and NO
  // transcript_path; once the prompt hook has fired the engine's own id and its JSONL path are on the wire.
  // The sequence is the pin, not either end of it.
  it("session_id mints then reconciles: minted uuid + no transcript_path pre-turn, engine id + path after", async () => {
    const clock = slClock(), r = statusRunner();
    let facts: any = {};
    const latch = { read: () => facts, clear: () => { facts = {}; }, hooks: () => ({}) };
    const fake = fakeRemote({ sessionId: undefined });               // no engine id yet, as at a real launch
    mountStatus(fake, r, clock, {}, latch);
    await settle(clock);
    const pre = r.runs[0].payload;
    expect(pre.session_id).toMatch(UUID_RE);                          // a uuid, not null and not absent
    expect("transcript_path" in pre).toBe(false);
    (fake as any).sessionId = "engine-sess-9";                        // the SDK's first system/init frame
    facts = { transcriptPath: "/home/u/.claude/projects/-repo/engine-sess-9.jsonl", promptId: "pid-1" };
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock);
    const post = r.runs[r.runs.length - 1].payload;
    expect(post.session_id).toBe("engine-sess-9");
    expect(post.transcript_path).toBe("/home/u/.claude/projects/-repo/engine-sess-9.jsonl");
    expect(post.prompt_id).toBe("pid-1");
    expect(post.session_id).not.toBe(pre.session_id);                 // the swap is observable, by design
  });

  // D-W6 — the mount site's half of "failure removes the row". `Footer.tsx`'s `statusLineText !== undefined`
  // guard is the render half and was already there (test/tui/footer.test.tsx pins the empty slot); what had
  // to change is that a failure now REACHES the state at all.
  it("a failing run clears statusLineText, and a later good run puts it back", async () => {
    const clock = slClock(), r = statusRunner();
    const api: { text?: () => string | undefined } = {};
    const fake = fakeRemote();
    function H() {
      const c = useChat(() => fake, { statusLine: STATUS_CFG } as any, { statusLine: { runStatusLine: r.run, ...clock.deps } });
      api.text = () => c.state.statusLineText;
      return <Text>[{c.state.statusLineText ?? "NONE"}]</Text>;
    }
    const { lastFrame } = render(<H />);
    await settle(clock);
    r.runs[0].resolve("~/repo (main)");
    await waitFor(() => frame(lastFrame).includes("~/repo (main)"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await settle(clock);
    r.runs[1].resolve(undefined);                                     // nonzero exit / timeout / empty stdout
    await waitFor(() => frame(lastFrame).includes("[NONE]"));
    expect(api.text!()).toBeUndefined();                              // was: the previous text stood forever
    fake.pushEvent({ kind: "turn", phase: "start", seq: 2 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 2 });
    await settle(clock);
    r.runs[2].resolve("back");
    await waitFor(() => frame(lastFrame).includes("[back]"));
  });

  it("the conversation boundary mints a NEW id and drops the latch — never the discarded conversation's", async () => {
    const clock = slClock(), r = statusRunner();
    let facts: any = { transcriptPath: "/old.jsonl", promptId: "pid-old" };
    const latch = { read: () => facts, clear: () => { facts = {}; }, hooks: () => ({}) };
    const api: { run?: (s: string) => void } = {};
    const fake = fakeRemote({ sessionId: "engine-sess-9", clearSession: async () => { (fake as any).sessionId = undefined; } });
    function H() {
      const c = useChat(() => fake, { statusLine: STATUS_CFG, promptLatch: latch } as any, { statusLine: { runStatusLine: r.run, ...clock.deps } });
      api.run = c.submit;
      return <Text>ok</Text>;
    }
    render(<H />);
    await settle(clock);
    expect(r.runs[0].payload.session_id).toBe("engine-sess-9");
    api.run!("/clear");
    await settle(clock);
    const after = r.runs[r.runs.length - 1].payload;
    expect(after.session_id).toMatch(UUID_RE);
    expect(after.session_id).not.toBe("engine-sess-9");               // not the conversation the user wiped
    expect("transcript_path" in after).toBe(false);                   // canon's `Ot.promptId = null`, both keys
    expect("prompt_id" in after).toBe(false);
  });

  // FIX ROUND, MINOR 2 — the cell above cannot see the RE-mint. Its session had an engine id, so deleting
  // `statusSessionIdRef.current = randomUUID()` from `replaceDocument` leaves the MOUNT mint standing, and
  // the mount mint is already a uuid that differs from `engine-sess-9`: the assertions pass on a build with
  // no boundary re-mint at all. This session never has an engine id, so the mint is the field's only writer
  // and the two mints are the only two values it can hold — which makes "they differ" the pin, and deleting
  // the boundary line the thing that reddens it.
  it("the boundary RE-mints: the id after /clear is a SECOND uuid, not the one minted at mount (D-W4)", async () => {
    const clock = slClock(), r = statusRunner();
    const api: { run?: (s: string) => void } = {};
    const fake = fakeRemote({ sessionId: undefined, clearSession: async () => {} });
    function H() {
      const c = useChat(() => fake, { statusLine: STATUS_CFG } as any, { statusLine: { runStatusLine: r.run, ...clock.deps } });
      api.run = c.submit;
      return <Text>ok</Text>;
    }
    render(<H />);
    await settle(clock);
    const mintedAtMount = r.runs[0].payload.session_id;
    expect(mintedAtMount).toMatch(UUID_RE);
    api.run!("/clear");
    await settle(clock);
    const afterClear = r.runs[r.runs.length - 1].payload.session_id;
    expect(afterClear).toMatch(UUID_RE);                              // still an identity, never absent
    expect(afterClear).not.toBe(mintedAtMount);                       // canon's `UHi()` rotation, reproduced
  });

  // ── EXTERNAL REVIEW (codex, finding A) — THE LOSING SIDE OF THE MOUNT RACE ───────────────────────────
  // The boot gate races a control read against a 1500 ms cap, and BOTH sides of that race outlive the thing
  // they were about. The read is a second-scale round trip: `--resume`, `--continue` and `/clear` can all
  // replace the conversation while it is still out, and `refreshCtx` wrote its answer against whatever
  // conversation was on screen when it landed — W-S5's rule (`replaceDocument` above) inverted, with the
  // number arriving AFTER the boundary cleared it instead of surviving across it. And when the CAP wins the
  // read still lands later, still pokes, and turns the one boot run D-W11 exists to guarantee into two.
  it("a mount read that lands after /clear writes NOTHING — not the chip, not the payload, not the warning", async () => {
    const clock = slClock(), r = statusRunner();
    let landRead!: (u: unknown) => void;
    const reading = new Promise<unknown>((res) => { landRead = res; });
    const fake = fakeRemote({ getContextUsage: () => reading, clearSession: async () => {} });
    const api: { run?: (s: string) => void } = {};
    function H() {
      const c = useChat(() => fake, { statusLine: STATUS_CFG } as any, { statusLine: { runStatusLine: r.run, ...clock.deps }, clearViewport: () => {} });
      api.run = c.submit;
      return <Text>ctx:{c.state.ctxPct ?? "-"} notif:{c.state.notification?.text ?? "-"}</Text>;
    }
    const { lastFrame } = render(<H />);
    await settle(clock, 1);
    api.run!("/clear");                                               // the conversation the read describes is gone
    await settle(clock, 1);                                           // …600 virtual ms, still inside the cap
    landRead({ totalTokens: 95_000, maxTokens: 100_000 });            // …and only now does the boot read answer
    await settle(clock, 2);
    expect(frame(lastFrame)).toContain("ctx:-");                      // was: ctx:95, measured against the wiped one
    expect(frame(lastFrame)).not.toContain("Context low");            // …and the row replaceDocument just removed
    expect(r.runs).toHaveLength(1);                                   // the gate still opens: a boot run happened
    expect(r.runs[0].payload.context_window.context_window_size).toBe(0);   // …carrying no reading at all
  });

  it("a read that lands after the CAP has already run the boot script does not run it a second time", async () => {
    const clock = slClock(), r = statusRunner();
    let landRead!: (u: unknown) => void;
    const fake = fakeRemote({ getContextUsage: () => new Promise((res) => { landRead = res; }) });
    mountStatus(fake, r, clock);
    await settle(clock, 7);                                           // past 1500 ms: the cap wins, one run, zero window
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0].payload.context_window.context_window_size).toBe(0);
    landRead({ totalTokens: 12_000, maxTokens: 1_000_000 });          // …and the slow read answers behind it
    await settle(clock, 3);
    expect(r.runs).toHaveLength(1);                                   // was 2: the boot run, then its correction
  });
});

// D-W11's COMPANION (fix round, owner-call 1): `/status` MEASURES ITS OWN READING. It used to render
// `ctxPct`, whose only writer was the turn-end refresh — so before the first turn the context row was
// missing from the one command whose whole job is "what is the state of this session right now", and
// whether it was missing depended on something the user cannot see: the statusLine mount effect's context
// read was the only other producer, and it only runs when a status line happens to be configured.
// Measure-then-show, which is Wave S's rule rather than an exception to it (see the W-S5 block above).
describe("/status takes its own context measurement (W2 T6 fix, D-W11)", () => {
  it("shows a context row on a FRESH mount — no statusLine configured, no turn yet", async () => {
    const fake = fakeRemote({ getContextUsage: async () => ({ totalTokens: 25, maxTokens: 100 }) });
    const api: { run?: (s: string) => void } = {};
    function H() { const c = useChat(() => fake, {}, { clearViewport: () => {} }); api.run = c.submit; return <Text>{allText(c)}</Text>; }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("/status");                                              // the first thing this session ever does
    await waitFor(() => flat(lastFrame).includes("context 25% used"));  // was: no context row at all pre-turn
  });
});

// ── Tool-stream T5: the renderer identity reaches the projection ────────────────────────────────────────
// `projectionContext()` is the ONE place the two halves of the fullscreen switch are set, and it sets them
// TOGETHER: the widened fold policy (`fullscreen`) and the blanked `(ctrl+o to expand)` chip (`expandHint: ""`).
// Nothing else in the tree pairs them, so nothing else can catch them drifting apart — the projection-level
// cells in `toolRenderer.test.tsx` are handed the pair already assembled and would not notice its absence.
describe("Tool-stream T5: useChat pairs the fullscreen flag with the blank expand hint", () => {
  const toolCall = (id: string, name: string, input: unknown) =>
    ({ kind: "sdk" as const, source: "disk" as const, message: { type: "assistant", parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } } });
  const toolResult = (id: string) =>
    ({ kind: "sdk" as const, source: "disk" as const, message: { type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok", is_error: false }] } } });
  const assistantText = (t: string) =>
    ({ kind: "sdk" as const, source: "disk" as const, message: { type: "assistant", parent_tool_use_id: null, message: { id: `m-${t}`, content: [{ type: "text", text: t }] } } });
  const entries = [toolCall("bash-1", "Bash", { command: "npm run build" }), toolResult("bash-1"),
    toolCall("bash-2", "Bash", { command: "npm test" }), toolResult("bash-2"), assistantText("done")];
  function FoldHost({ fullscreen }: { fullscreen: boolean }) {
    const c = useChat(() => fakeRemote(), { initialEntries: entries }, { isFullscreen: () => fullscreen });
    return <Text>{c.state.finalizedItems.flatMap(itemLines).join("|")}</Text>;
  }

  it("folds a non-read shell run into one clause-bearing row and prints no chip when the renderer is fullscreen", () => {
    const f = frame(render(<FoldHost fullscreen />).lastFrame);
    expect(f).toContain("Ran 2 shell commands");
    expect(f).not.toContain("to expand");
    expect(f).not.toContain("Bash(npm run build)");     // the per-call rows are what the fold replaces
  });

  it("leaves the classic renderer on its frozen path: per-call Bash rows, chip intact, no shell clause", () => {
    const f = frame(render(<FoldHost fullscreen={false} />).lastFrame);
    expect(f).toContain("Bash(npm run build)");
    expect(f).not.toContain("shell command");
  });

  // T5 FIX 1 — THE BLANKET HAD A HOLE THE PROJECTION COULD NOT SEE. `projectionContext()`'s ternary covers
  // every chip a PROJECTION derives; the compact-summary row was the one baked at INGEST, so a `/compact` in a
  // fullscreen session left exactly ONE chip standing after the blanket had taken every other one on screen.
  // Canon cannot produce that: `Ett` (2.1.234:506706, consumer `Wv` at 511132) kills the chip for EVERYTHING
  // inside its virtual list, so a survivor is a divergence. E2 moved the fix from the oven to the projection —
  // `projectLocalEvent` re-derives the whole row off `COMPACT_SUMMARY_SPECIES` in both projections — which is
  // what also makes a later `/tui` flip correct it (pinned in `tui-switch.test.tsx`). This cell is unchanged
  // and deliberately so: it asks only what the reader SEES under each renderer, which is the claim that has to
  // survive whichever side of the seam answers it.
  it("shows the compact-summary row without a chip in fullscreen, and with one in classic", async () => {
    const boundary = async (fullscreen: boolean) => {
      const fake = fakeRemote();
      function H() { const c = useChat(() => fake, {}, { isFullscreen: () => fullscreen }); return <Text>{allText(c)}</Text>; }
      const { lastFrame } = render(<H />);
      await new Promise((r) => setTimeout(r, 20));
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: `cb-${fullscreen}` } });
      await waitFor(() => frame(lastFrame).includes("Compact summary"));
      fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
      return frame(lastFrame);
    };
    expect(await boundary(true)).not.toContain("to expand");          // ← the ternary at the ingest site
    expect(await boundary(false)).toContain("Compact summary (ctrl+o to expand)");   // …and the classic control
  });
});

// bl7 T-HOOKBLOCK Task 1, spec D14 (plan review M5). Hook frames never mutate the document (a hook_response
// enters no tool_use_id, no result — nothing `appendSdk` or the fold would react to), so without an explicit
// reconcile a completed hook's timing would sit invisible in the tracker until some UNRELATED later frame
// happened to trigger the next repaint. This pins the fix at the ingest seam: with a run already open (a
// tool_use with no result yet, so it lives in the transient pending region) and a hook_response as the FINAL
// event delivered, the pending projection is re-derived on its own — no further frame required. Task 2/3
// still owe the actual rendering of the hook block; this only proves the repaint fires.
describe("useChat: hook_response reconciliation (bl7 T-HOOKBLOCK D14)", () => {
  // The 600 ms pending-region ticker (`scheduleRepaint`) re-projects on its own on every tick and would
  // otherwise mask exactly what this suite pins — a `waitFor` with a 2 s default timeout would happily pass
  // off the NEXT tick rather than off this arm's own reconcile. Disabled here for the same reason the F3
  // final-review suite disables it (`noRepaint` above): the only thing left that can move `pendingItems` is
  // an explicit `reconcile()` call.
  const noRepaint = { scheduleRepaint: () => () => {} };

  it("a hook_response as the final event repaints an already-open run with no further frame", async () => {
    const fake = fakeRemote();
    let snap!: { pendingItems: readonly RenderItem[] };
    function H() { const c = useChat(() => fake, {}, noRepaint); snap = { pendingItems: c.state.pendingItems }; return <Text>{allText(c)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "a1", content: [{ type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/a.ts" } }] } } });
    await waitFor(() => snap.pendingItems.length > 0);
    const before = snap.pendingItems;
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "hook_started", hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse", uuid: "hs1", session_id: "s1" } });
    fake.pushEvent({ kind: "message", data: { type: "system", subtype: "hook_response", hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse", output: "", stdout: "", stderr: "", outcome: "success", uuid: "hr1", session_id: "s1" } });
    await waitFor(() => snap.pendingItems !== before);
    expect(snap.pendingItems).not.toBe(before);   // a fresh projection ran off the hook_response alone — the ticker is disabled, so nothing else could have
  });

  // Reference identity, not a render count: EVERY message frame (hook or not) already triggers a render via
  // the unconditional `setTasks(taskListRef.current.snapshot())` upstream of this arm (a fresh array every
  // call), so counting renders cannot distinguish "reconciled" from "some unrelated state changed". Whether
  // THIS reconcile ran is exactly what `pendingItems`' own reference answers: only `reconcile()` (and its
  // siblings) call `setPendingItems`, so an untouched reference means it never fired.
  it("a replayed hook_response never pairs (no timing to fabricate) and never reconciles", async () => {
    const fake = fakeRemote();
    let snap!: { pendingItems: readonly RenderItem[] };
    function H() { const c = useChat(() => fake, {}, noRepaint); snap = { pendingItems: c.state.pendingItems }; return <Text>{allText(c)}</Text>; }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "a1", content: [{ type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/a.ts" } }] } } });
    await waitFor(() => snap.pendingItems.length > 0);
    const before = snap.pendingItems;
    fake.pushEvent({ kind: "message", replay: true, data: { type: "system", subtype: "hook_started", hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse", uuid: "hs1", session_id: "s1" } });
    fake.pushEvent({ kind: "message", replay: true, data: { type: "system", subtype: "hook_response", hook_id: "h1", hook_name: "PreToolUse:Read", hook_event: "PreToolUse", output: "", stdout: "", stderr: "", outcome: "success", uuid: "hr1", session_id: "s1" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(snap.pendingItems).toBe(before);   // no started() stamp was ever recorded for h1 under the replay guard, so the response is dropped, not reconciled
  });
});
