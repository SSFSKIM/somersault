// tui/test/chat.test.tsx — reworked onto the adapter surface: `broker` prop is gone; ChatApp takes
// `client: { kind, short? }` + `onDetach?`. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real
// RemoteChat wire contract (spec A2b Task 6).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { stdin.write(key); if (cond()) return; if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}) timeout`); await new Promise((r) => setTimeout(r, 5)); }
}
// A fakeRemote() extended onto the RewindOps surface (fakeRemote() alone has no rewind methods, so
// hasRewind() is false on it as-is — mirrors useChat-rewind.test.tsx's fakeRewindSession).
type RewindFakeOpts = { rewindAnchors?: () => Promise<RewindAnchor[]>; rewindDryRun?: (uuid: string) => Promise<RewindDryRun>; rewind?: (anchor: RewindAnchor, scope: RewindScope) => Promise<void> };
function fakeRewindRemote(rewindOpts: RewindFakeOpts, remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return { ...base, rewindAnchors: rewindOpts.rewindAnchors ?? (async () => []), rewindDryRun: rewindOpts.rewindDryRun ?? (async () => ({ canRewind: true }) as RewindDryRun), rewind: rewindOpts.rewind ?? (async () => {}) };
}

describe("<ChatApp>", () => {
  it("submits a typed prompt and streams the reply", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));      // composer mounted → TextInput live
    stdin.write("hi");
    await waitFor(() => frame(lastFrame).includes("hi"));   // typed text landed in the composer before Enter
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });

  it("surfaces a parked permission as a dialog and 'a' allows it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({ sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));   // dialog up
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t", decision: { kind: "allow_once" } });
  });

  it("surfaces a parked question as a QuestionDialog (kind dispatcher) and answers it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({
      sessionId: "s", toolUseID: "t", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] },
      createdAt: Date.now(),
    });
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));   // QuestionDialog up, not PermissionDialog
    expect(frame(lastFrame)).not.toContain("Allow Claude to use");
    stdin.write("2");                                                // selects "blue" — single question → onAnswer fires
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t", decision: { kind: "question_answer", answers: { "Red or blue?": "blue" } } });
  });

  it("a second queued question (fewer questions than the first) does not inherit stale progress — dialog remounts per toolUseID", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    // A: 2 questions. Queue B (1 question) behind it BEFORE A is answered — dropPending promotes B
    // straight into `pending` with no intermediate null render once A settles.
    fake.parkPermission({
      sessionId: "s", toolUseID: "a", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [
        { question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] },
        { question: "Which meals?", header: "Meals", multiSelect: false, options: [{ label: "breakfast" }, { label: "dinner" }] },
      ] }, createdAt: Date.now(),
    });
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    fake.parkPermission({
      sessionId: "s", toolUseID: "b", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Continue?", multiSelect: false, options: [{ label: "yes" }, { label: "no" }] }] },
      createdAt: Date.now(),
    });
    stdin.write("2");                                        // A Q1: blue → advances to A Q2 (qi becomes 1)
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    stdin.write("1");                                         // A Q2: breakfast → A is fully answered, B is promoted
    await waitFor(() => fake.answeredCalls.length === 1);
    // B has only ONE question (index 0) — if the dialog reused A's stale qi=1, `questions[1]` is
    // undefined and the mount-only auto-deny effect (deps `[]`) never re-fires, rendering an invisible,
    // input-eating dialog forever instead of B's question.
    await waitFor(() => frame(lastFrame).includes("Continue?"));
    expect(frame(lastFrame)).not.toContain("Which meals?");
    stdin.write("1");                                         // B: yes
    await waitFor(() => fake.answeredCalls.length === 2);
    expect(fake.answeredCalls[1]).toEqual({ toolUseID: "b", decision: { kind: "question_answer", answers: { "Continue?": "yes" } } });
  });

  it("Esc on a parked question denies via the dispatcher (never a fabricated answer)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({
      sessionId: "s", toolUseID: "t2", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Continue?", multiSelect: false, options: [{ label: "yes" }, { label: "no" }] }] },
      createdAt: Date.now(),
    });
    await waitFor(() => frame(lastFrame).includes("Continue?"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t2", decision: { kind: "deny" } });
  });

  it("Ctrl-L now clears the composer input (the editor owns it), not the app-level screen", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi");   await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r");   await waitFor(() => frame(lastFrame).includes("ok"));
    stdin.write("typed"); await waitFor(() => frame(lastFrame).includes("typed"));
    stdin.write("\x0c"); await waitFor(() => !frame(lastFrame).includes("typed"));   // Ctrl-L clears the buffer, not the screen
    expect(frame(lastFrame)).toContain("ok");                                        // transcript survives — no screen wipe
    stdin.write("more"); await waitFor(() => frame(lastFrame).includes("more"));      // composer still responsive after clear
    expect(frame(lastFrame)).toContain("more");
  });

  it("Ctrl-C while idle arms 'press again to exit'; while busy it interrupts instead", async () => {
    let release = () => {}; let interrupts = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      interrupt: () => { interrupts++; },
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x03");                                                      // Ctrl-C idle → arm
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    expect(interrupts).toBe(0);
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));  // turn started, hanging
    stdin.write("\x03");                                                      // Ctrl-C busy → interrupt

    await waitFor(() => interrupts === 1);
    release();
    expect(interrupts).toBe(1);
  });

  it("Shift+Tab cycles the permission ladder default → acceptEdits → plan → auto; bare Tab does not", async () => {
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    stdin.write("\t"); await new Promise((r) => setTimeout(r, 30));   // bare Tab: no popup open → no-op
    expect(modes).toEqual([]);
    await pressUntil(stdin, "\x1b[Z", () => modes.includes("auto"));   // Shift+Tab cycles default→acceptEdits→plan→auto
    expect(modes[0]).toBe("acceptEdits");
    expect(modes).toContain("plan");
    expect(modes).toContain("auto");
  });

  it("Ctrl-T hides and re-shows the task panel", async () => {
    const fake = fakeRemote();
    const { lastFrame, stdin } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/" />);
    await new Promise((r) => setTimeout(r, 30));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    // "todo-item-one" alone is ambiguous: the transcript ALSO prints the TaskCreate tool_use + its result
    // text permanently, so a bare substring check never goes false. "☐ todo-item-one" (TaskPanel's pending
    // glyph + subject) is unique to the panel row and is what actually toggles.
    await waitFor(() => (lastFrame() ?? "").includes("☐ todo-item-one"));
    stdin.write("\x14");                                       // Ctrl-T
    await waitFor(() => !(lastFrame() ?? "").includes("☐ todo-item-one"));
    stdin.write("\x14");
    await waitFor(() => (lastFrame() ?? "").includes("☐ todo-item-one"));
  });

  it("initialPrompt submits once on mount", async () => {
    const { lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} initialPrompt="do the thing" />);
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("› do the thing");
  });

  it("Ctrl-Z detaches when attached, and does NOT deny a pending remote permission (detach ≠ deny)", async () => {
    let detachCalls = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} onDetach={() => { detachCalls++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1a");                                     // Ctrl-Z
    await new Promise((r) => setTimeout(r, 30));
    expect(detachCalls).toBe(1);
    expect(fake.answeredCalls).toEqual([]);                  // unanswered — stays parked, never denied
  });

  it("Ctrl-Z with client.kind === 'loopback' appends a not-detachable notice and does not exit", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1a");
    await waitFor(() => frame(lastFrame).includes("not detachable — run with --detachable"));
    stdin.write("still here"); await waitFor(() => frame(lastFrame).includes("still here"));   // composer still alive
  });

  it("Ctrl-B while busy backgrounds the running turn (does not open the panel)", async () => {
    let release = () => {}; let backgroundCalls = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      background: () => { backgroundCalls++; return true; },
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn started, hanging
    stdin.write("\x02");                                                       // Ctrl-B busy → background the turn
    await waitFor(() => backgroundCalls === 1);
    expect(frame(lastFrame)).not.toContain("Background tasks");                // panel did NOT open
    release();
  });

  it("Ctrl-B while idle opens the background-tasks panel", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x02");                                                       // Ctrl-B idle → open panel
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    expect(frame(lastFrame)).toContain("none running");
  });

  it("the status bar shows a live bg-task count and updates on tasks_changed", async () => {
    const fake = fakeRemote();
    const { lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    expect(frame(lastFrame)).not.toContain("⚙");
    fake.pushEvent({ kind: "tasks_changed", tasks: [
      { task_id: "a", task_type: "local_bash", description: "x" },
      { task_id: "b", task_type: "agent", description: "y" },
    ] });
    await waitFor(() => frame(lastFrame).includes("⚙ 2 bg"));
  });

  it("Esc on an idle composer arms 'Press Esc again to rewind'; second Esc opens the picker (rewindAnchors called); while busy Esc interrupts and never arms", async () => {
    let anchorsFetched = 0;
    let interrupts = 0;
    let release = () => {};
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix it", index: 1 };
    let fake: ReturnType<typeof fakeRewindRemote>;
    fake = fakeRewindRemote(
      { rewindAnchors: async () => { anchorsFetched++; return [ANCHOR]; } },
      {
        interrupt: () => { interrupts++; },
        submit: async (_p, onMessage) => {
          fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
          const m = { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
          onMessage(m); fake.pushEvent({ kind: "message", data: m });
          await new Promise<void>((res) => { release = res; });
          fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
          return { result: "done" };
        },
      },
    );
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("\x1b");                                            // Esc idle → arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    expect(anchorsFetched).toBe(0);

    stdin.write("\x1b");                                            // second Esc within the window → opens the picker
    await waitFor(() => anchorsFetched === 1);
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");

    stdin.write("\x1b");                                            // list-stage esc closes the picker (no selection made)
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn started, hanging

    stdin.write("\x1b");                                            // Esc while busy → interrupt, never arms
    await waitFor(() => interrupts === 1);
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    expect(anchorsFetched).toBe(1);                                 // the busy Esc never triggered another fetch
    release();
  });

  it("a consumed rewind prefill does not resurrect after a popup remount — through the REAL ChatApp wiring", async () => {
    // The composerPrefillRemount test pins the useChat↔composer contract with its own harness; this one
    // exercises ChatApp itself, so dropping the onPrefillApplied prop in ChatApp is caught too.
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix the parser", index: 2 };
    const fake = fakeRewindRemote({ rewindAnchors: async () => [ANCHOR], rewind: async () => {} });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("\x1b");                                            // arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");                                            // open the picker
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    stdin.write("\r");                                              // select the anchor → scope stage
    await waitFor(() => frame(lastFrame).includes("Restore conversation only"));
    stdin.write("2");                                               // conversation-only: no dryRun dependency
    await waitFor(() => frame(lastFrame).includes("fix the parser"));   // prefill landed in the composer

    stdin.write("\x15");                                            // Ctrl-U: clear the composer buffer
    await waitFor(() => !frame(lastFrame).includes("fix the parser"));

    stdin.write("?");                                               // empty composer → shortcuts overlay (composer unmounts)
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("x");                                               // any key closes it → composer REMOUNTS
    await waitFor(() => frame(lastFrame).includes("›"));
    await new Promise((r) => setTimeout(r, 80));
    expect(frame(lastFrame)).not.toContain("fix the parser");       // must not resurrect
  });

  it("a turn start revokes an idle Esc arm — the rewind hint never survives into a busy turn", async () => {
    let release = () => {};
    let fake: ReturnType<typeof fakeRewindRemote>;
    fake = fakeRewindRemote({}, {
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\x1b");                                            // arm on an idle composer, THEN submit without a second Esc
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));            // turn running
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    release();
  });

  it("? on an empty idle composer opens the shortcuts overlay; any keypress closes it back to the composer", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("›");                     // composer is replaced by the overlay
    stdin.write("x");
    await waitFor(() => frame(lastFrame).includes("›"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("? mid-buffer inserts a literal '?' instead of opening the overlay", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("hi?"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });
});
