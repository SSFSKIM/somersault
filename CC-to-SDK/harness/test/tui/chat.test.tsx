// tui/test/chat.test.tsx — reworked onto the adapter surface: `broker` prop is gone; ChatApp takes
// `client: { kind, short? }` + `onDetach?`. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real
// RemoteChat wire contract (spec A2b Task 6).
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
// F2 task 6: ChatApp/ChatComposer read stdin through <KeymapProvider> now, not `useInput` — rendered bare
// they have no input path at all, so every render here goes through the provider wrapper.
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { READ_CALL, READ_RESULT_FLAT, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";
import { currentTheme, setTheme } from "../../src/tui/theme.js";
import { createNoticeBridge } from "../../src/tui/chatMain.js";

// W3 T4: theme.ts's ACCENT/current live binding is module-scoped and vitest isolates per FILE, not per
// test, so a /theme test that previews or persists a theme must not leak it into a later test in this
// file — reset after every test, not just the theme-specific ones.
afterEach(() => setTheme("auto"));

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
// A fakeRemote() extended onto the SettingsOps surface (fakeRemote() alone has none, so hasSettingsOps() is
// false on it as-is — same shape as fakeRewindRemote above). Default listDirs() reports only cwd (no
// additional dirs yet), matching a freshly-launched host.
// W3 T7: removeDir/addRule/removeRule are now override-able too (default no-ops previously) — the
// /permissions tests below need to observe calls into them and, for addRule, need a session-tab rule to
// remove/inspect via a scripted getSettings().
type SettingsFakeOpts = {
  listDirs?: () => Promise<{ path: string; source: "cwd" | "launch" | "session" }[]>;
  addDir?: (path: string) => Promise<void>;
  getSettings?: () => Promise<unknown>;
  removeDir?: (path: string) => Promise<void>;
  addRule?: (behavior: "allow" | "ask" | "deny", rule: string) => Promise<void>;
  removeRule?: (behavior: "allow" | "ask" | "deny", rule: string) => Promise<void>;
};
function fakeSettingsRemote(settingsOpts: SettingsFakeOpts = {}, remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return {
    ...base,
    getSettings: settingsOpts.getSettings ?? (async () => ({})),
    listDirs: settingsOpts.listDirs ?? (async () => [{ path: process.cwd(), source: "cwd" as const }]),
    addDir: settingsOpts.addDir ?? (async () => {}),
    removeDir: settingsOpts.removeDir ?? (async () => {}),
    setOutputStyle: async () => {},
    addRule: settingsOpts.addRule ?? (async () => {}),
    removeRule: settingsOpts.removeRule ?? (async () => {}),
  };
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

  it("hides the global composer hint under permission, question, and plan input owners", async () => {
    const fake = fakeRemote();
    const { lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({ sessionId: "s", toolUseID: "p", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    expect(frame(lastFrame)).not.toContain("Esc interrupt");
    expect(frame(lastFrame)).not.toContain("[y/n");
    fake.settlePermission("p", "me", "deny");
    await waitFor(() => !frame(lastFrame).includes("Allow Claude to use"));
    fake.parkPermission({ sessionId: "s", toolUseID: "q", toolName: "AskUserQuestion", kind: "question", input: { questions: [{ question: "Continue?", options: [{ label: "yes" }], multiSelect: false }] }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Continue?"));
    expect(frame(lastFrame)).not.toContain("Esc rewind");
    fake.settlePermission("q", "me", "question_answer");
    await waitFor(() => !frame(lastFrame).includes("Continue?"));
    fake.parkPermission({ sessionId: "s", toolUseID: "r", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Approve this plan?"));
    expect(frame(lastFrame)).not.toContain("? help");
  });

  it("never paints a stale editor hint in any frame after a draft or autocomplete takes input ownership", async () => {
    const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/__ccx-empty-cwd__" />);
    await waitFor(() => frame(lastFrame).includes("›"));
    const expectOwnerFramesHonest = (frames: string[], marker: string) => {
      const owned = frames.filter((f) => f.includes(marker));
      expect(owned.length, `no emitted frame rendered ${JSON.stringify(marker)}`).toBeGreaterThan(0);
      for (const rendered of owned) {
        expect(rendered).not.toContain("Esc rewind");
        expect(rendered).not.toContain("? help");
      }
    };

    let start = stdout.frames.length;
    stdin.write("sentinel-draft");
    await waitFor(() => frame(lastFrame).includes("sentinel-draft"));
    expectOwnerFramesHonest(stdout.frames.slice(start), "sentinel-draft");
    stdin.write("\x15");
    await waitFor(() => !frame(lastFrame).includes("sentinel-draft"));

    start = stdout.frames.length;
    stdin.write("/");
    await waitFor(() => frame(lastFrame).includes("/ — no matches"));
    expectOwnerFramesHonest(stdout.frames.slice(start), "/ — no matches");
    stdin.write("\x1b");
    await waitFor(() => !frame(lastFrame).includes("/ — no matches"));
    stdin.write("\x15");

    start = stdout.frames.length;
    stdin.write("@");
    await waitFor(() => frame(lastFrame).includes("@ — no matches"));
    expectOwnerFramesHonest(stdout.frames.slice(start), "@ — no matches");
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

  it("Ctrl-Z calls the injected suspend and does not exit or detach (KB5: detach moved to /detach)", async () => {
    let suspended = 0; let detached = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} onDetach={() => { detached++; }} suspend={() => { suspended++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1a");                                     // Ctrl-Z
    await waitFor(() => suspended === 1);
    expect(detached).toBe(0);
    expect(frame(lastFrame)).toContain("›");                 // composer still alive, never exited
  });

  it("Ctrl-Z routes its resumed Ink write through the render owner exactly once", async () => {
    const owner = { repaint: vi.fn((run: () => void) => run()) };
    const suspend = (deps: any) => deps.repaint();
    const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={suspend} resumeOutput={owner} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    const framesBefore = stdout.frames.length;
    stdin.write("\x1a");
    await waitFor(() => owner.repaint.mock.calls.length === 1);
    await waitFor(() => stdout.frames.length > framesBefore);
    expect(stdout.frames.length).toBe(framesBefore + 1);
  });

  it("Ctrl-Z invokes a no-op suspend once without breaking the active composer's yank-pop", async () => {
    const suspend = vi.fn();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} suspend={suspend as any} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("one"); await waitFor(() => frame(lastFrame).includes("one"));
    stdin.write("\x15"); await waitFor(() => !frame(lastFrame).includes("one"));
    stdin.write("two"); await waitFor(() => frame(lastFrame).includes("two"));
    stdin.write("\x15"); await waitFor(() => frame(lastFrame).includes("Ask Claude anything…"));
    stdin.write("\x19"); await waitFor(() => frame(lastFrame).includes("two"));
    stdin.write("\x1a"); await waitFor(() => suspend.mock.calls.length === 1);
    stdin.write("\x1by"); await waitFor(() => frame(lastFrame).includes("one"));
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it("Ctrl-Z still reaches the injected suspend under a pending permission dialog, and never answers it", async () => {
    let suspended = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} suspend={() => { suspended++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1a");                                     // Ctrl-Z — same gating tier as Ctrl-C/Ctrl-B, above every dialog gate
    await waitFor(() => suspended === 1);
    expect(fake.answeredCalls).toEqual([]);                  // unanswered — stays parked, never denied
  });

  // Finding-1 red-proof (F0 t6 review fix): the two tests above only prove ChatApp CALLS an injected
  // `suspend` — they say nothing about what the REAL suspendProcess does to the terminal. This test renders
  // ChatApp with NO `suspend` prop (so Ctrl-Z runs the real suspendProcess), and neuters only the two
  // process-level effects that would otherwise actually stop the test runner (`process.kill`/`process.once`)
  // via global spies — everything else, including raw-mode toggling, runs for real. Under the OLD
  // implementation (ChatApp calling Ink's ref-counted `useStdin().setRawMode`, verified: with ChatApp AND
  // ChatComposer both holding a raw-mode count of >=2, a single decrement never reaches 0) the real
  // `stdin.setRawMode` spy below is NEVER invoked by Ctrl-Z, so `toHaveBeenLastCalledWith(false)` fails
  // cleanly — captured live by temporarily reverting suspend.ts/ChatApp.tsx and rerunning this exact test
  // (see the task-6 fix report for the captured failure output). Under the fix it passes for real.
  it("Ctrl-Z genuinely drops raw mode on the real tty (not just Ink's ref count) and a real SIGCONT restores + repaints", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
    let onResume: (() => void) | undefined;
    const onceSpy = vi.spyOn(process, "once").mockImplementation(((event: string, handler: () => void) => {
      if (event === "SIGCONT") onResume = handler;
      return process;
    }) as typeof process.once);
    try {
      const fake = fakeRemote();
      const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
      await waitFor(() => frame(lastFrame).includes("›"));
      const rawModeSpy = vi.spyOn(stdin, "setRawMode");
      stdin.write("\x1a");                                     // Ctrl-Z, through the REAL suspendProcess
      await waitFor(() => killSpy.mock.calls.length > 0);       // suspend fired (kill is faked — nothing actually stops us)
      expect(rawModeSpy).toHaveBeenLastCalledWith(false);       // the REAL tty left raw mode, not just Ink's internal count
      expect(killSpy).toHaveBeenCalledWith(0, "SIGTSTP");
      expect(onResume).toBeTypeOf("function");
      const framesBefore = stdout.frames.length;
      onResume?.();                                             // simulate the shell delivering SIGCONT on `fg`
      expect(rawModeSpy).toHaveBeenLastCalledWith(true);        // raw mode genuinely restored
      await waitFor(() => stdout.frames.length > framesBefore); // a real repaint was forced, not a dead setState
    } finally {
      killSpy.mockRestore(); onceSpy.mockRestore();
    }
  });

  // "detach ≠ deny — a pending permission survives detaching" is proven in useChat.test.tsx ("/detach
  // calls opts.detach without answering a pending permission"): a decision dialog occupies the SAME slot
  // ChatComposer renders into (ChatApp.tsx's render chain), so a real permission dialog structurally
  // pre-empts typing "/detach" at this integration level — the useChat-level test calls submit() directly,
  // exercising the exact handleCommand code path this integration test exercises through keystrokes here.
  it("/detach detaches an attached client; a loopback client notices not-detachable instead", async () => {
    let detachCalls = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} onDetach={() => { detachCalls++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/detach"); await waitFor(() => frame(lastFrame).includes("/detach"));
    stdin.write("\r");
    await waitFor(() => detachCalls === 1);

    const loopback = fakeRemote();
    const lb = render(<ChatApp makeSession={() => loopback} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lb.lastFrame).includes("›"));
    lb.stdin.write("/detach"); await waitFor(() => frame(lb.lastFrame).includes("/detach"));
    lb.stdin.write("\r");
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    await waitFor(() => stripAnsi(frame(lb.lastFrame)).replace(/\s+/g, " ").includes("not detachable — run with --detachable, or ccx attach from another terminal"));
    lb.stdin.write("still here"); await waitFor(() => frame(lb.lastFrame).includes("still here"));   // composer still alive
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
    stdin.write("\x1b");                                            // Escape closes it (KB6) → composer REMOUNTS
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

    stdin.write("\x1b");                                            // arm on an EMPTY composer (CM15: text would arm the clear instead)
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));   // THEN type and submit to start the turn
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));            // turn running
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    release();
  });

  it("Wave 2 final-review F3: Ctrl-R and Ctrl-O do not open their overlays while a rewind is in flight", async () => {
    // A confirmed rewind is a multi-second engine operation held behind the "⏪ restoring…" modal
    // (state.rewinding) precisely so a prompt typed in that window isn't lost. Before the fix, Ctrl-R/
    // Ctrl-O were reachable during that window too — opening the history/pager overlay ABOVE the modal,
    // and (for history) Enter-executing a prompt straight into the busy host, refusing and losing it.
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix the parser", index: 2 };
    const fake = fakeRewindRemote({ rewindAnchors: async () => [ANCHOR], rewind: async () => { await held; } });
    const fakeDeps = { getSessionMessages: async () => [] as any[] };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("\x1b");                                              // Esc: arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");                                              // Esc: open the picker
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    stdin.write("\r");                                                // select the anchor → scope stage
    await waitFor(() => frame(lastFrame).includes("Restore conversation only"));
    stdin.write("2");                                                 // conversation-only → confirmRewind → rewind() hangs
    await waitFor(() => frame(lastFrame).includes("restoring"));

    stdin.write("\x12");                                              // Ctrl-R must NOT open history search here
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Search prompts");
    expect(frame(lastFrame)).toContain("restoring");                  // the rewinding modal is still the one showing

    stdin.write("\x0f");                                              // Ctrl-O must NOT open the transcript pager here
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Transcript");             // the pager's own header text (see the Ctrl-O test above)
    expect(frame(lastFrame)).toContain("restoring");

    release();
    await waitFor(() => !frame(lastFrame).includes("restoring"));
  });

  it("? on an empty idle composer opens the shortcuts overlay; only Escape closes it back to the composer (KB6)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("›");                     // composer is replaced by the overlay
    stdin.write("x");
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Keyboard shortcuts");        // a non-Escape key leaves it open
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("›"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("help opened DURING a busy turn still dismisses on Escape — the swallow must resolve to Help, not the live Task scope (t7 review)", async () => {
    let release = () => {};
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
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
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn running (Task scope live)
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x1b");                                                       // Escape → help:dismiss, NOT dropped by Task
    await waitFor(() => !frame(lastFrame).includes("Keyboard shortcuts"));
    release();
  });

  it("with the ? overlay open, ctrl+o does NOT open the pager and the overlay stays (F0 acceptance 5)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x0f");                                              // Ctrl-O
    await new Promise((r) => setTimeout(r, 30)); await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Keyboard shortcuts");         // still open
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("›"));              // back at the composer, not a leaked pager
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("help owns ordinary keys while upstream-precedence Ctrl-Z suspends before it, then the composer resumes normally", async () => {
    const modes: string[] = [];
    const suspend = vi.fn();
    const fake = fakeRemote({ setPermissionMode: (mode: string) => { modes.push(mode); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={suspend as any} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x1b[Z");                                      // Shift+Tab must not cycle the composer beneath help
    stdin.write("\x0f");                                        // Ctrl-O must not open the pager
    stdin.write("\x1a");                                        // upstream raw input intercepts Ctrl-Z before Help dispatch
    await waitFor(() => suspend.mock.calls.length === 1);
    expect(frame(lastFrame)).toContain("Keyboard shortcuts");
    expect(modes).toEqual([]);
    expect(frame(lastFrame)).not.toContain("Transcript");
    stdin.write("\x1b");                                        // Escape only closes help; it must not arm rewind beneath it
    await waitFor(() => frame(lastFrame).includes("›"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    expect(frame(lastFrame)).not.toContain("Transcript");

    stdin.write("x");
    await waitFor(() => frame(lastFrame).includes("x"));
    stdin.write("\x15");
    await waitFor(() => !frame(lastFrame).includes("x"));
    stdin.write("\x1b[Z");
    await waitFor(() => modes.length === 1);
    expect(modes).toEqual(["acceptEdits"]);
  });

  it("Ctrl-Z has upstream process-level precedence over every ordinary visible overlay", async () => {
    const historyDeps = {
      getSessionMessages: async () => [] as any[], getSessionMessagesIn: async () => [] as any[], listHistorySessions: async () => [],
    };
    const cases: { name: string; session: () => ReturnType<typeof fakeRemote>; deps?: any; open: (stdin: any, lastFrame: () => string | undefined) => Promise<void> }[] = [
      {
        name: "Search prompts", session: () => fakeRemote(), deps: historyDeps,
        open: async (stdin, lastFrame) => { stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("Search prompts")); },
      },
      {
        name: "Settings", session: () => fakeRemote(),
        open: async (stdin, lastFrame) => { stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Settings")); },
      },
      {
        name: "switch model", session: () => fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) }),
        open: async (stdin, lastFrame) => { stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("switch model")); },
      },
      {
        name: "resume a session", session: () => fakeRemote(), deps: { listSessions: async () => [{ sessionId: "prior", summary: "saved", lastModified: 1 }] },
        open: async (stdin, lastFrame) => { stdin.write("/resume"); await waitFor(() => frame(lastFrame).includes("/resume")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("resume a session")); },
      },
    ];
    for (const testCase of cases) {
      const suspend = vi.fn();
      const session = testCase.session();
      const view = render(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={process.cwd()} deps={testCase.deps} suspend={suspend as any} />);
      await waitFor(() => frame(view.lastFrame).includes("›"));
      await testCase.open(view.stdin, view.lastFrame);
      view.stdin.write("\x1a");
      await waitFor(() => suspend.mock.calls.length === 1);
      expect(frame(view.lastFrame)).toContain(testCase.name);
      view.unmount();
    }
  });

  it("a hidden pending decision never bypasses the visible overlay's key ownership", async () => {
    const historyDeps = {
      getSessionMessages: async () => [] as any[], getSessionMessagesIn: async () => [] as any[], listHistorySessions: async () => [],
    };
    const cases: { name: string; session: () => ReturnType<typeof fakeRemote>; deps?: any; open: (stdin: any, lastFrame: () => string | undefined) => Promise<void>; closesOnCtrlC?: boolean }[] = [
      { name: "Search prompts", session: () => fakeRemote(), deps: historyDeps, closesOnCtrlC: true, open: async (stdin, lastFrame) => { stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("Search prompts")); } },
      { name: "Settings", session: () => fakeRemote(), open: async (stdin, lastFrame) => { stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Settings")); } },
      { name: "switch model", session: () => fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) }), open: async (stdin, lastFrame) => { stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("switch model")); } },
      { name: "resume a session", session: () => fakeRemote(), deps: { listSessions: async () => [{ sessionId: "prior", summary: "saved", lastModified: 1 }] }, open: async (stdin, lastFrame) => { stdin.write("/resume"); await waitFor(() => frame(lastFrame).includes("/resume")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("resume a session")); } },
    ];
    for (const testCase of cases) {
      const fake = testCase.session();
      const view = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={testCase.deps} />);
      await waitFor(() => frame(view.lastFrame).includes("›"));
      await testCase.open(view.stdin, view.lastFrame);
      fake.parkPermission({ sessionId: "s", toolUseID: `hidden-${testCase.name}`, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
      view.stdin.write("\x03");                                // Ctrl-C belongs to the visible surface, never hidden pending
      await new Promise((r) => setTimeout(r, 20));
      expect(frame(view.lastFrame)).not.toContain("Press Ctrl-C again to exit");
      if (testCase.closesOnCtrlC) await waitFor(() => frame(view.lastFrame).includes("Allow Claude to use"));
      else {
        expect(frame(view.lastFrame)).toContain(testCase.name);
        view.stdin.write("\x1b");                              // visible overlay closes by its own Escape handler
        await waitFor(() => frame(view.lastFrame).includes("Allow Claude to use"));
      }
      view.stdin.write("a");
      await waitFor(() => fake.answeredCalls.length === 1);
      view.unmount();
    }
  });

  it("a pending dialog synchronously blocks the retiring composer listener", async () => {
    const modes: string[] = [];
    const fake = fakeRemote({ setPermissionMode: (mode: string) => { modes.push(mode); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    fake.parkPermission({ sessionId: "s", toolUseID: "guard", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1b[Z");                                      // must not leak to the former composer
    stdin.write("\x1b");                                        // dialog denies; it must not also arm rewind
    await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes("›"));
    expect(modes).toEqual([]);
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
  });

  it("? mid-buffer inserts a literal '?' instead of opening the overlay", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("hi?"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("ctrl+u on ≥3 chars shows 'Ctrl+Y to paste deleted text' and it expires (CM11)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} yankHintMs={80} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hello");
    await waitFor(() => frame(lastFrame).includes("hello"));
    stdin.write("\x15");                                   // Ctrl-U
    await waitFor(() => frame(lastFrame).includes("Ctrl+Y to paste deleted text"));
    expect(frame(lastFrame)).not.toContain("hello");       // the kill really emptied the buffer
    await waitFor(() => !frame(lastFrame).includes("Ctrl+Y to paste deleted text"));
    stdin.write("\x19");                                   // Ctrl-Y yanks it back
    await waitFor(() => frame(lastFrame).includes("hello"));
  });

  it("Ctrl-R opens history search; Esc accepts the top entry into the composer", async () => {
    const fakeDeps = {
      getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      // HistorySearchOverlay opens on scope "everywhere" by default, which reads via getSessionMessagesIn
      // (F1, final review) rather than the pinned getSessionMessages above — both need to agree here.
      getSessionMessagesIn: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      listHistorySessions: async () => [{ sessionId: "s1", summary: "", lastModified: 1 }],
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x12");                                   // Ctrl-R
    await waitFor(() => frame(lastFrame).includes("Search prompts"));
    stdin.write("\x1b");                                   // Esc = accept
    await waitFor(() => frame(lastFrame).includes("redo the build"));
    expect(frame(lastFrame)).toContain("redo the build");   // prefilled into the composer buffer
  });

  it("a nonempty history prefill synchronously disarms rewind before its first composer frame", async () => {
    const fakeDeps = {
      getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      getSessionMessagesIn: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      listHistorySessions: async () => [{ sessionId: "s1", summary: "", lastModified: 1 }],
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x12");                                         // Ctrl-R opens history without disarming rewind itself
    await waitFor(() => frame(lastFrame).includes("Search prompts"));
    stdin.write("\x1b");                                         // accept the top history result as external prefill
    await waitFor(() => frame(lastFrame).includes("redo the build"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    expect(frame(lastFrame)).toContain("Esc clear");

    stdin.write("\x1b");                                         // first Escape clears/arms locally; it cannot rewind
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(frame(lastFrame)).not.toContain("Rewind to a previous message");
  });

  it("app-level keys are gated while the history overlay is open (its Ctrl-C is cancel, not exit-arm)", async () => {
    const fakeDeps = {
      getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      // HistorySearchOverlay opens on scope "everywhere" by default, which reads via getSessionMessagesIn
      // (F1, final review) rather than the pinned getSessionMessages above — both need to agree here.
      getSessionMessagesIn: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      listHistorySessions: async () => [{ sessionId: "s1", summary: "", lastModified: 1 }],
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x12");                                   // Ctrl-R opens
    await waitFor(() => frame(lastFrame).includes("Search prompts"));
    stdin.write("\x03");                                   // Ctrl-C → overlay cancels; app exit-arm must NOT fire
    await waitFor(() => !frame(lastFrame).includes("Search prompts"));
    expect(frame(lastFrame)).not.toContain("Press Ctrl-C again to exit");
    expect(frame(lastFrame)).not.toContain("Search prompts");   // overlay closed by its own cancel
  });

  it("Ctrl-O opens the transcript pager, gates the app keys, and Ctrl-O again closes it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    // Seed a task so the panel actually renders something — with an empty task list TaskPanel renders
    // null regardless of todosOpen, which would make the Ctrl-T-while-open check below pass vacuously
    // even if the gate leaked (the "still contains Transcript" check alone can't tell the difference).
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(lastFrame).includes("☐ todo-item-one"));
    stdin.write("\x0f");                                              // Ctrl-O opens
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    expect(frame(lastFrame)).toContain("☐ todo-item-one");            // task panel still visible under the pager
    stdin.write("\x14");                                              // Ctrl-T must NOT toggle todos while pager open
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Transcript");                 // still the pager, no crash
    expect(frame(lastFrame)).toContain("☐ todo-item-one");            // proves Ctrl-T did NOT reach setTodosOpen
    stdin.write("\x0f");                                              // Ctrl-O closes
    // Only the pager header prints the word "Transcript" — its absence proves the pager actually
    // unmounted (an "of 0" assertion would be vacuous: an empty pager renders "(empty)").
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
    expect(frame(lastFrame)).toContain("☐ todo-item-one");            // task panel unaffected throughout
    stdin.write("\x14");                                              // now (pager closed) Ctrl-T DOES toggle — proves the gate isn't a permanent lock
    await waitFor(() => !frame(lastFrame).includes("☐ todo-item-one"));
  });

  // F2 task 7: the owner gate used to kill every key inside the pager except ChatApp's own Ctrl-O close arm.
  // With the pager on the scope stack, `Transcript` has to say so declaratively — hence the two null bindings.
  // Without them Global would newly fire history-search and the todo panel from inside the pager.
  it("Ctrl-R inside the transcript pager opens nothing (the Transcript null binding, not the old owner gate)", async () => {
    const fakeDeps = {
      getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      getSessionMessagesIn: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      listHistorySessions: async () => [{ sessionId: "s1", summary: "", lastModified: 1 }],
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x0f");                                              // Ctrl-O opens the pager
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x12");                                              // Ctrl-R must NOT open history search here
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Transcript");                 // the pager is still the visible surface
    stdin.write("\x0f");                                              // the pager's own Ctrl-O still closes it
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
    // The load-bearing assertion: the pager arm outranks the history arm in ChatApp's render chain, so
    // "Search prompts" being absent WHILE the pager is up proves nothing at all — a Ctrl-R that leaked would
    // have set historyOpen behind it and be revealed right here, the moment the pager unmounts.
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Search prompts");
    expect(frame(lastFrame)).toContain("›");                          // the composer, not a history overlay
    stdin.write("\x12");                                              // …and Ctrl-R works again once the pager is gone
    await waitFor(() => frame(lastFrame).includes("Search prompts"));
  });

  // W3 T3: /add-dir
  it("/add-dir with no arg opens the entry phase; Esc with no path cancels with the no-path message", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/add-dir"); await waitFor(() => frame(lastFrame).includes("/add-dir"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Enter the path to the directory:"));
    expect(frame(lastFrame)).toContain("Add directory to workspace");
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Did not add a working directory."));
  });

  it("/add-dir <path> opens the confirm phase with the three options; accepting 'for this session' calls addDir with the abs path and prints the success line", async () => {
    const calls: string[] = [];
    const fake = fakeSettingsRemote({ addDir: async (p) => { calls.push(p); } });
    const target = tmpdir();   // a real, existing directory outside process.cwd()
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write(`/add-dir ${target}`); await waitFor(() => frame(lastFrame).includes(target));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Add directory to workspace"));
    expect(frame(lastFrame)).toContain("Yes, for this session");
    expect(frame(lastFrame)).toContain("Yes, and remember this directory");
    expect(frame(lastFrame)).toContain("No");
    stdin.write("\r");                                                // idx 0 default = "Yes, for this session"
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toBe(target);
    await waitFor(() => frame(lastFrame).includes("as a working directory for this session"));
    expect(frame(lastFrame)).toContain("/permissions to manage");
  });

  it("/add-dir <path> 'remember' branch (idx 1) writes to local settings via the injected settingsFileDeps, never the real filesystem", async () => {
    const calls: string[] = [];
    const fake = fakeSettingsRemote({ addDir: async (p) => { calls.push(p); } });
    const target = tmpdir();   // a real, existing directory outside process.cwd()
    // A fake read/write pair standing in for settingsFile.ts's fs seam — an ENOENT read means the patch
    // applies fresh, mirroring settingsFile.test.ts's "missing file" case. If this test omitted
    // settingsFileDeps, confirmAddDir's remember branch would fall through to the REAL readFileSync/
    // writeFileSync/mkdirSync against `${cwd}/.claude/settings.local.json` under process.cwd() (the repo
    // itself) — the exact gap Finding 1 flagged.
    const writes: { path: string; content: string }[] = [];
    const settingsFileDeps = {
      read: (_p: string): string => { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
      write: (p: string, s: string) => { writes.push({ path: p, content: s }); },
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ settingsFileDeps }} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write(`/add-dir ${target}`); await waitFor(() => frame(lastFrame).includes(target));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Add directory to workspace"));
    stdin.write("\x1b[B");                                          // ↓ to idx 1 "Yes, and remember this directory"
    await waitFor(() => frame(lastFrame).includes("❯ Yes, and remember this directory"));
    stdin.write("\r");
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toBe(target);
    // The long tmpdir() path can push "and saved to local settings" across Ink's word-wrap boundary
    // (e.g. "...local\nsettings"), so match against the frame with newlines flattened to spaces rather
    // than a raw substring — the same trick useChat.test.tsx's own `frame` helper uses.
    const flat = () => frame(lastFrame).replace(/\n/g, " ");
    await waitFor(() => flat().includes("saved to local settings"));
    expect(flat()).toContain("/permissions to manage");
    // The write went through the injected fake, at the path settingsFile.ts derives for "localSettings",
    // with the merged patch applied (appendToArray under permissions.additionalDirectories).
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`${process.cwd()}/.claude/settings.local.json`);
    expect(JSON.parse(writes[0].content)).toEqual({ permissions: { additionalDirectories: [target] } });
  });

  it("W3-F gate: a late listDirs() resolution during an in-flight rewind must not leak the addDir dialog above the restoring modal (sabotage-checked — see task report)", async () => {
    let releaseListDirs: () => void = () => {};
    const heldListDirs = new Promise<void>((r) => { releaseListDirs = r; });
    let releaseRewind: () => void = () => {};
    const heldRewind = new Promise<void>((r) => { releaseRewind = r; });
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "add outside dir", index: 1 };
    const target = tmpdir();
    const fake = {
      ...fakeSettingsRemote({ listDirs: async () => { await heldListDirs; return [{ path: process.cwd(), source: "cwd" as const }]; } }),
      rewindAnchors: async () => [ANCHOR],
      rewindDryRun: async () => ({ canRewind: true }) as RewindDryRun,
      rewind: async () => { await heldRewind; },
    };
    const fakeDeps = { getSessionMessages: async () => [] as any[] };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));

    // Start /add-dir — it suspends on listDirs() (composer stays mounted: local commands don't set busy).
    stdin.write(`/add-dir ${target}`); await waitFor(() => frame(lastFrame).includes(target));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await new Promise((r) => setTimeout(r, 30));

    // While it's suspended, arm + open + confirm a rewind (mirrors the Wave-2 F3 test's exact key sequence).
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Restore conversation only"));
    stdin.write("2");
    await waitFor(() => frame(lastFrame).includes("restoring"));

    // Now let /add-dir's listDirs() resolve — it tries to open the dialog while rewinding is still true.
    releaseListDirs();
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("restoring");                  // the modal, not the dialog, must still be showing
    expect(frame(lastFrame)).not.toContain("Add directory to workspace");

    // Once the rewind itself settles, the dialog (still open in state) surfaces normally.
    releaseRewind();
    await waitFor(() => !frame(lastFrame).includes("restoring"));
    await waitFor(() => frame(lastFrame).includes("Add directory to workspace"));
  });

  // W3 T4: /theme
  it("/theme opens the picker with the exact prompt, all 5 rows, and the demo.js preview", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/theme"); await waitFor(() => frame(lastFrame).includes("/theme"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Choose the text style that looks best with your terminal"));
    const f = frame(lastFrame);
    expect(f).toContain("Auto (match terminal)");
    expect(f).toContain("Dark mode");
    expect(f).toContain("Light mode");
    expect(f).toContain("Dark mode (colorblind-friendly)");
    expect(f).toContain("Light mode (colorblind-friendly)");
    expect(f).toContain("demo.js");
    expect(f).toContain("function greet() {");
    expect(f).toContain('console.log("Hello, World!");');
    expect(f).toContain('console.log("Hello, Claude!");');
    expect(f).toContain("Enter to select · Esc to cancel");
  });

  it("/theme Esc restores the theme that was live when the dialog opened, after navigating away from it (sabotage-checked — see task report)", async () => {
    const before = currentTheme();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/theme"); await waitFor(() => frame(lastFrame).includes("/theme"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Choose the text style"));
    stdin.write("\x1b[B");                                          // ↓ previews the next row's theme live
    await waitFor(() => currentTheme() !== before);                 // the live preview really applied
    stdin.write("\x1b");                                            // Esc
    await waitFor(() => frame(lastFrame).includes("Theme picker dismissed"));
    expect(currentTheme()).toBe(before);
  });

  it("/theme Enter persists the highlighted row via the injected savePrefs seam (never the real ~/.claude/ccx/prefs.json)", async () => {
    const calls: unknown[] = [];
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { calls.push(patch); } }} />,
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/theme"); await waitFor(() => frame(lastFrame).includes("/theme"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Choose the text style"));
    stdin.write("\x1b[B");                                          // ↓ to "Dark mode" (row 1)
    await waitFor(() => frame(lastFrame).includes("❯ Dark mode"));
    stdin.write("\r");
    await waitFor(() => calls.length === 1);
    expect(calls[0]).toEqual({ theme: "dark" });
    expect(currentTheme()).toBe("dark");                            // Enter KEEPS the already-previewed theme
    await waitFor(() => frame(lastFrame).includes("Theme set to dark"));
  });

  it("/theme j/k and ctrl+n/ctrl+p navigate the same as ↓/↑ (Select-context keymap parity)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/theme"); await waitFor(() => frame(lastFrame).includes("/theme"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Choose the text style"));
    stdin.write("j");
    await waitFor(() => frame(lastFrame).includes("❯ Dark mode"));
    stdin.write("\x0e");                                            // ctrl+n → next row
    await waitFor(() => frame(lastFrame).includes("❯ Light mode"));
    stdin.write("k");
    await waitFor(() => frame(lastFrame).includes("❯ Dark mode"));
    stdin.write("\x10");                                            // ctrl+p → previous row
    await waitFor(() => frame(lastFrame).includes("❯ Auto (match terminal)"));
  });

  // W3 T5: /config
  it("/config opens the Settings dialog at the Config tab, showing all 5 rows and the normal-mode footer", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Settings"));
    const f = frame(lastFrame);
    expect(f).toContain("Status");
    expect(f).toContain("Config");
    expect(f).toContain("Usage");
    expect(f).toContain("Stats");
    expect(f).toContain("Theme");
    expect(f).toContain("Model");
    expect(f).toContain("Output style");
    expect(f).toContain("Default permission mode");
    expect(f).toContain("Thinking mode");
    expect(f).toContain("Enter/Space to change · / to search · Esc to close");
  });

  it("Config: toggling the Thinking-mode row shows the warning and Esc summarizes 'Set Thinking mode to false' (sabotage-checked — see task report)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Thinking mode"));
    // Row order is theme, model, outputStyle, permissionMode, thinking — 4 downs from the theme (default) row.
    for (let i = 0; i < 4; i++) stdin.write("\x1b[B");
    await waitFor(() => frame(lastFrame).includes("❯ Thinking mode"));
    stdin.write("\r");                                              // enter/space toggles: initial value is "true" (thinkLevel defaults to "default", not "off")
    await waitFor(() => frame(lastFrame).includes("Changing thinking mode mid-conversation will increase latency and may reduce quality."));
    stdin.write("\x1b");                                            // Esc closes with the change summary
    // The value segment renders bold (its own ANSI span), so "…to " and "false" are NOT one contiguous
    // substring in the raw frame (an ESC[1m sits between them) — assert the two pieces separately rather
    // than the combined sentence (verified against the raw frame while diagnosing this test).
    await waitFor(() => frame(lastFrame).includes("Set Thinking mode to") && frame(lastFrame).includes("false"));
  });

  it("Config: Esc with no changes prints 'Config dialog dismissed'", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Settings"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Config dialog dismissed"));
  });

  it("Config: / enters search and filters the row list to the query (case-insensitive label match)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("/");
    await waitFor(() => frame(lastFrame).includes("Search settings…"));
    stdin.write("THEME");
    await waitFor(() => frame(lastFrame).includes("Type to filter · Enter/↓ to select · Esc to clear"));   // final review Finding 5 — dropped the dead "↑ to tabs" chord
    const f = frame(lastFrame);
    expect(f).toContain("Theme");
    expect(f).not.toContain("Output style");
    expect(f).not.toContain("Default permission mode");
    expect(f).not.toContain("Thinking mode");
  });

  it("Config: an unmatched search shows the empty state", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("/");
    await waitFor(() => frame(lastFrame).includes("Search settings…"));
    stdin.write("zzz");
    await waitFor(() => frame(lastFrame).includes(`No settings match "zzz"`));
  });

  it("Config: shift+Tab reaches the Status tab, rendering the live status rows (Global Constraints line 34: tab/shift+tab/left/right switch tabs, wrapping)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // confirms we're on Config first
    stdin.write("\x1b[Z");                                          // shift+Tab: Status·Config·Usage·Stats, Config(1) → Status(0)
    await waitFor(() => frame(lastFrame).includes("sess-1"));       // formatStatus's session-id row — unique to the Status tab
    const f = frame(lastFrame);
    expect(f).not.toContain("Default permission mode");             // Config's rows are gone
    expect(f).toContain("Tab/←/→ to switch tabs · Esc to close");
  });

  // W3.5 fix pass — finding 1 regression guard: the Model row reuses the SAME top-level ModelPicker the
  // standalone /model command does (ChatApp's overlay-chain comment), so pickModel's own immediate
  // "model → X" notice used to fire whichever way the picker was reached — reported once live in the
  // transcript AND again by the close-time summary when reached via Settings. Only the summary should say
  // it in that case; this test failed red against the unfixed pickModel (see the task report).
  it("Config: the Model row round trip through the shared ModelPicker reports the change exactly once, and Settings reappears afterward", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B");                                          // Theme(0) → Model(1)
    await waitFor(() => frame(lastFrame).includes("❯ Model"));
    stdin.write("\r");                                              // Enter on the Model row → onOpenModelPicker → the SHARED top-level ModelPicker
    await waitFor(() => frame(lastFrame).includes("switch model"));
    stdin.write("\r");                                              // pick the only model — resolveModelAlias("opus") → "claude-opus-5"
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // Settings dialog reliably reappears (remounted fresh on Config)
    stdin.write("\x1b");                                            // close Settings — the diff-based close summary is the ONE place this should report
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Model to"));
    const flat = frame(lastFrame).replace(/\n/g, " ");
    // Match on the SENTENCE forms, not a raw "claude-opus-5" substring count: the status bar ALSO shows the
    // live model id ("model claude-opus-5") permanently — that's an unrelated, always-on UI element, not a
    // notice, and would otherwise make this assertion count a legitimate second occurrence.
    expect(flat).not.toMatch(/model → claude-opus-5/);              // no immediate notice from pickModel while reached via Settings
    expect((flat.match(/Set Model to/g) ?? []).length).toBe(1);     // the close-time summary reported the change exactly once
  });

  // Final review Finding 2 (Important — distinct from the "finding 2" referenced in the comment above,
  // which is a W3.5-round fix): pickModel used to commit setModel(v) only AFTER `await session.setModel(v)`
  // settled. Holding that engine call open (simulating the real wire round trip) and closing Settings
  // BEFORE it resolves used to print "Config dialog dismissed" — closeSettings diffed against the still-old
  // `model` — even though the model DID change moments later. This test fails red against the unfixed
  // pickModel (see the task report); it passes now because pickModel commits synchronously, before the await.
  it("Config: closing Settings while the Model row's session.setModel(...) is still in flight still reports the change (final review Finding 2)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }), setModel: () => gate });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B");                                          // Theme(0) → Model(1)
    await waitFor(() => frame(lastFrame).includes("❯ Model"));
    stdin.write("\r");                                              // Enter on Model → onOpenModelPicker
    await waitFor(() => frame(lastFrame).includes("switch model"));
    stdin.write("\r");                                              // pick the only model — session.setModel(...) is now blocked on `gate`
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // back on the Config row list
    expect(frame(lastFrame).replace(/\n/g, " ")).toContain("Model  claude-opus-5");   // the row already reflects the pick — committed before the await, not after
    stdin.write("\x1b");                                            // close Settings WHILE session.setModel(...) is still unresolved
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Model to"));
    const flat = frame(lastFrame).replace(/\n/g, " ");
    expect(flat).not.toMatch(/model → claude-opus-5/);              // still no duplicate immediate notice on the Settings path
    expect((flat.match(/Set Model to/g) ?? []).length).toBe(1);     // reported exactly once, even though the engine call hadn't settled yet
    release();                                                       // let the held call resolve so it doesn't leak into a later test
    await new Promise((r) => setTimeout(r, 0));
  });

  // W3.5 fix pass — finding 2 coverage gap: nothing previously opened the Theme row's embedded ThemeDialog
  // sub-flow (hideEsc + live preview + "discard the sub-dialog's own notice, let the close summary report
  // it instead" — the contract the Model-row bug above shows what happens when it breaks).
  it("Config: the Theme row opens the embedded ThemeDialog (hideEsc footer), previews live, returns to the row list on Enter, and the close-time summary — not the dialog's own line — reports it", async () => {
    const before = currentTheme();
    const savePrefsCalls: unknown[] = [];
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { savePrefsCalls.push(patch); } }} />,   // never the real ~/.claude/ccx/prefs.json
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\r");                                              // Enter on the Theme row (idx 0, already highlighted)
    await waitFor(() => frame(lastFrame).includes("Choose the text style that looks best with your terminal"));
    expect(frame(lastFrame)).not.toContain("Enter to select · Esc to cancel");   // hideEsc — no redundant footer nested inside Settings
    stdin.write("\x1b[B");                                          // ↓ previews the next row's theme live (same mechanism the standalone /theme test pins)
    await waitFor(() => currentTheme() !== before);
    stdin.write("\r");                                              // Enter persists + returns to the Config row list (onDone → setSub("none"))
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    expect(frame(lastFrame)).not.toContain("Choose the text style");   // really back on the row list, not still in the sub-dialog
    expect(frame(lastFrame)).not.toContain("Theme set to");           // the embedded dialog's OWN notice is discarded (sibling to Output-style)
    stdin.write("\x1b");                                              // close Settings
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Theme to"));
    expect(savePrefsCalls).toEqual([{ theme: "dark" }]);              // persisted through the injected seam, exactly once — never the real file
  });

  // W3.5 fix pass — finding 2 coverage gap: OutputStylePicker.tsx had zero tests anywhere in the repo.
  it("Config: the Output-style row opens the embedded OutputStylePicker; picking a style updates the row live and the close-time summary reports it exactly once, without touching real settings files", async () => {
    const savePrefsCalls: unknown[] = [];
    const writes: { path: string; content: string }[] = [];
    // ENOENT read (mirrors the /add-dir "remember" test above) → the merge patch applies fresh, and the
    // write lands only in `writes`, never `${cwd}/.claude/settings.local.json` under the real repo checkout.
    const settingsFileDeps = {
      read: (_p: string): string => { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
      write: (p: string, s: string) => { writes.push({ path: p, content: s }); },
    };
    const fake = fakeSettingsRemote();   // hasSettingsOps(session) → true, so applyOutputStyle's session.setOutputStyle leg runs
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { savePrefsCalls.push(patch); }, settingsFileDeps }} />,
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B");                    // Theme(0) → Model(1) → Output style(2)
    await waitFor(() => frame(lastFrame).includes("❯ Output style"));
    stdin.write("\r");                                                // Enter opens the embedded OutputStylePicker
    await waitFor(() => frame(lastFrame).includes("Preferred output style"));
    stdin.write("\x1b[B");                                            // ↓ to "Proactive" (index 1)
    await waitFor(() => frame(lastFrame).includes("❯ Proactive"));
    stdin.write("\r");                                                // Enter picks it → applyOutputStyle("proactive"), returns to the row list
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    expect(frame(lastFrame)).not.toContain("Preferred output style");             // really back on the row list, not the picker
    expect(frame(lastFrame).replace(/\n/g, " ")).toContain("Output style  proactive");   // the row reflects the live pick
    stdin.write("\x1b");                                              // close Settings
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Output style to"));
    const flat = frame(lastFrame).replace(/\n/g, " ");
    expect((flat.match(/proactive/g) ?? []).length).toBe(1);          // the close-time summary is the ONLY place it's reported (applyOutputStyle itself never appends/notices)
    expect(savePrefsCalls).toEqual([{ outputStyle: "proactive" }]);
    expect(writes).toHaveLength(1);                                   // wrote through the injected fake only, never the real fs
    expect(writes[0].path).toBe(`${process.cwd()}/.claude/settings.local.json`);
    expect(JSON.parse(writes[0].content)).toEqual({ outputStyle: "proactive" });
  });

  // Final review Finding 2: setThink had the identical commit-after-await shape as pickModel above — this
  // fails red against the unfixed setThink (thinkLevel only committed after the awaited
  // setMaxThinkingTokens settled), and passes now that it commits synchronously first.
  it("Config: closing Settings while the Thinking-mode row's session.setMaxThinkingTokens(...) is still in flight still reports the change (final review Finding 2)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fake = fakeRemote({ setMaxThinkingTokens: () => gate });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B");   // Theme(0)→Model(1)→Output style(2)→Default permission mode(3)→Thinking mode(4)
    await waitFor(() => frame(lastFrame).includes("❯ Thinking mode"));
    stdin.write("\r");                                              // toggle it — session.setMaxThinkingTokens(...) is now blocked on `gate`
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Thinking mode  false"));   // the row already reflects the toggle
    stdin.write("\x1b");                                            // close Settings WHILE the engine call is still unresolved
    // Not "...to false" — the value renders bold (a separate ANSI-wrapped segment, see summarizeChanges),
    // so it is never adjacent plain text to "to " in the frame; every sibling test in this file matches on
    // the un-valued prefix for the same reason (see the Model/Output-style race tests above).
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Thinking mode to"));
    release();
    await new Promise((r) => setTimeout(r, 0));
  });

  // Final review Finding 2: applyOutputStyle had the identical commit-after-await shape — this fails red
  // against the unfixed applyOutputStyle (outputStyle only committed after the awaited setOutputStyle
  // settled), and passes now that it commits (and persists) synchronously first.
  it("Config: closing Settings while the Output-style row's session.setOutputStyle(...) is still in flight still reports the change (final review Finding 2)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fake = { ...fakeSettingsRemote(), setOutputStyle: (_id: string) => gate };
    const writes: { path: string; content: string }[] = [];
    const settingsFileDeps = {
      read: (_p: string): string => { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
      write: (p: string, s: string) => { writes.push({ path: p, content: s }); },
    };
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: () => {}, settingsFileDeps }} />,
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B");                    // Theme(0) → Model(1) → Output style(2)
    await waitFor(() => frame(lastFrame).includes("❯ Output style"));
    stdin.write("\r");                                                // Enter opens the embedded OutputStylePicker
    await waitFor(() => frame(lastFrame).includes("Preferred output style"));
    stdin.write("\x1b[B");                                            // ↓ to "Proactive" (index 1)
    await waitFor(() => frame(lastFrame).includes("❯ Proactive"));
    stdin.write("\r");                                                // Enter picks it → applyOutputStyle("proactive") — session.setOutputStyle(...) is now blocked on `gate`
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Output style  proactive"));   // the row already reflects the pick
    stdin.write("\x1b");                                              // close Settings WHILE the engine call is still unresolved
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Output style to"));
    release();
    await new Promise((r) => setTimeout(r, 0));
  });

  // ---- W3 T6: /config key=value, /settings alias, /output-style redirect, /keybindings viewer ----
  // The exhaustive input/output matrix for parseConfigArg lives in commands.test.ts (pure unit tests);
  // these are end-to-end wiring checks — the composer really dispatches through parseConfigArg AND the
  // right apply function actually runs (theme really switches, the dialog really opens), not just that the
  // right string gets printed.

  it("Config: '/config bogus=1' prints the unknown-key error and never opens the dialog", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config bogus=1");
    await waitFor(() => frame(lastFrame).includes("/config bogus=1"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("isn't a /config setting"));
    expect(frame(lastFrame)).toContain(`bogus isn't a /config setting. Run /config to see what's available.`);
    expect(frame(lastFrame)).not.toContain("Enter/Space to change · / to search · Esc to close");   // the Config-tab footer never rendered — no dialog opened
  });

  it("Config: '/config thinking=maybe' prints the boolean-domain error", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config thinking=maybe");
    await waitFor(() => frame(lastFrame).includes("/config thinking=maybe"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes(`thinking takes true or false, not "maybe".`));
  });

  it("Config: '/config permissionMode=weird' prints the enum-domain error", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config permissionMode=weird");
    await waitFor(() => frame(lastFrame).includes("/config permissionMode=weird"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("permissionMode takes one of: default, acceptEdits, plan, auto."));
  });

  // Brief requirement: drive "already off" through TWO REAL invocations, not an isolated string assertion —
  // the first call must actually turn thinking off before the second call can correctly find it already off.
  it("Config: '/config thinking=false' twice — the first turns it off, the second reports it's already off", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config thinking=false");
    await waitFor(() => frame(lastFrame).includes("/config thinking=false"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Set thinking to false"));   // invocation 1: a real change
    expect(frame(lastFrame)).not.toContain("already off");
    stdin.write("/config thinking=false");
    await new Promise((r) => setTimeout(r, 30));                              // settle tick, mirrors other repeated-invocation tests in this file
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("thinking is already off."));   // invocation 2: reads the state invocation 1 actually left behind
    expect((frame(lastFrame).match(/Set thinking to false/g) ?? []).length).toBe(1);   // only ONE real set happened across both calls
  });

  it("Config: '/config theme=dark' prints 'Set theme to dark' and the theme actually switches", async () => {
    expect(currentTheme()).toBe("auto");   // afterEach resets it — confirms this test starts from a real baseline, not already "dark"
    // Final review Finding 1 (Critical): this test used to render <ChatApp> with NO deps at all, so the
    // theme arm's `savePrefsFn({theme:…})` fell through to the real ~/.claude/ccx/prefs.json writer —
    // every full-suite run silently reset the developer's real theme file. Inject the seam, same as the
    // standalone /theme Enter test above and the two Config-tab Theme/Output-style tests below.
    const calls: unknown[] = [];
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { calls.push(patch); } }} />,   // never the real ~/.claude/ccx/prefs.json
    );
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/config theme=dark");
    await waitFor(() => frame(lastFrame).includes("/config theme=dark"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Set theme to dark"));
    expect(currentTheme()).toBe("dark");   // the engine-level effect, not just the printed line
    expect(calls).toEqual([{ theme: "dark" }]);   // persisted through the injected seam, exactly once — never the real file
  });

  it("/settings aliases /config — opens the same Settings dialog at the Config tab", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/settings"); await waitFor(() => frame(lastFrame).includes("/settings"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Settings"));
    const f = frame(lastFrame);
    expect(f).toContain("Default permission mode");                             // Config tab's rows, same as /config
    expect(f).toContain("Enter/Space to change · / to search · Esc to close");
  });

  it("/output-style prints the redirect line then opens Settings at the Config tab (not the picker directly)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/output-style"); await waitFor(() => frame(lastFrame).includes("/output-style"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("/output-style moved → Output style in /config"));
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // Settings opened, Config tab — not OutputStylePicker's own "Preferred output style" title
    expect(frame(lastFrame)).not.toContain("Preferred output style");
  });

  // F2 task 9: /keybindings is upstream's own file-opener now — the keymap IS customizable (the file merges
  // over the defaults and hot-reloads), so the W3 "not supported yet" honesty line is retired. Both tests
  // drive the editor through the injected seam, never $EDITOR: the machine running them has its own.
  // Ink word-wraps a long dim <Text> and re-opens the dim SGR codes around EACH physical line, so every
  // assertion below reads the frame with escapes stripped and whitespace runs collapsed.
  const flat = (lastFrame: () => string | undefined) => frame(lastFrame).replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ");
  it("/keybindings opens ~/.claude/keybindings.json in $VISUAL/$EDITOR, seeding the starter file first", async () => {
    const home = mkdtempSync(join(tmpdir(), "ccx-kb-home-"));
    const written: [string, string][] = [];
    const openEditor = vi.fn((_file: string, prepare: () => void) => { prepare(); return "opened" as const });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor, readFile: () => null, writeFile: (p, t) => { written.push([p, t]); } }} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => flat(lastFrame).includes("saved changes apply live"));
    expect(openEditor.mock.calls[0][0]).toBe(join(home, ".claude", "keybindings.json"));
    expect(written).toHaveLength(1);                                        // seeded once, by `prepare`, before the spawn
    expect(written[0][0]).toBe(join(home, ".claude", "keybindings.json"));
    expect(JSON.parse(written[0][1])).toMatchObject({ bindings: [] });      // the documented starter, valid JSON
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");           // the read-only overlay is the FALLBACK, not the result
  });

  it("a noticeBridge notification reaches the transcript — queued BEFORE mount and pushed after", async () => {
    const bridge = createNoticeBridge();
    bridge.notify("⚠ keybindings.json: 1 problem");                        // the launch case: no transcript exists yet
    const { lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} noticeBridge={bridge} />);
    await waitFor(() => flat(lastFrame).includes("⚠ keybindings.json: 1 problem"));
    bridge.notify("⚠ reloaded: 2 problems");                               // the hot-reload case, mid-session
    await waitFor(() => flat(lastFrame).includes("⚠ reloaded: 2 problems"));
  });

  it("/keybindings falls back to the read-only keymap when neither $VISUAL nor $EDITOR is set", async () => {
    const home = mkdtempSync(join(tmpdir(), "ccx-kb-home-"));
    const written: string[] = [];
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor: () => "no-editor", readFile: () => null, writeFile: (p) => { written.push(p); } }} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));   // ShortcutsOverlay is up
    expect(flat(lastFrame)).toContain("set $VISUAL or $EDITOR");
    expect(written).toEqual([]);                                            // nothing was created for an editor that never runs
  });

  it("help owns immediate keys before its passive handler mounts, and Escape closes without opening pager", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x0f");                         // Ctrl-O immediately after the help frame appears
    expect(frame(lastFrame)).not.toContain("Transcript");
    stdin.write("\x1b");                         // immediate Escape must be handled by the root owner
    await waitFor(() => !frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("Transcript");
  });

  it("ChatApp root handler reads the current suspend callback immediately after rerender", async () => {
    let oldCalls = 0, currentCalls = 0;
    const view = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={() => { oldCalls++; }} />);
    await waitFor(() => frame(view.lastFrame).includes("›"));
    view.rerender(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={() => { currentCalls++; }} />);
    view.stdin.write("\x1a");
    await waitFor(() => currentCalls === 1);
    expect(oldCalls).toBe(0);
  });

  // ---- W3 T7: /permissions — five-tab dialog ----

  it("/permissions opens with all 5 tabs, defaulting to Allow (with its intro + 'Add a new rule…') when there are no recent denials", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    const f = frame(lastFrame);
    expect(f).toContain("Recently denied");
    expect(f).toContain("Allow");
    expect(f).toContain("Ask");
    expect(f).toContain("Deny");
    expect(f).toContain("Workspace");
    expect(f).toContain("Claude Code won't ask before using allowed tools.");   // Allow's own intro → proves it's the ACTIVE tab, not just listed
    expect(f).toContain("Add a new rule…");
    expect(f).not.toContain("Commands recently denied by the auto mode classifier.");
  });

  // Step 6's REQUIRED sabotage check (see task report for the observed fail/pass): openPermissions()'s
  // ternary was temporarily forced to always "Allow", this exact test re-run and confirmed to FAIL, then
  // reverted — proving this assertion genuinely exercises the denials.length-driven default, not just
  // "some tab renders".
  it("/permissions defaults to the Recently-denied tab (with the just-denied entry) when a denial already happened this session", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    fake.parkPermission({ sessionId: "s", toolUseID: "t1", toolName: "Bash", kind: "permission", input: { command: "rm -rf /" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    fake.settlePermission("t1", "auto", "deny");                    // the auto-mode classifier denying it — dropPending records the ledger entry
    await waitFor(() => !frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    const f = frame(lastFrame);
    expect(f).toContain("Commands recently denied by the auto mode classifier.");
    expect(f).toContain("Bash(rm -rf /)");
    expect(f).not.toContain("Claude Code won't ask before using allowed tools.");   // proves Allow is NOT the active tab here
  });

  it("/permissions Allow tab: 'Add a new rule…' walks entry → destination and calls addRule + persists to the chosen settings file", async () => {
    const addRuleCalls: { behavior: string; rule: string }[] = [];
    const writes: { path: string; content: string }[] = [];
    const settingsFileDeps = {
      read: (_p: string): string => { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
      write: (p: string, s: string) => { writes.push({ path: p, content: s }); },
    };
    const fake = fakeSettingsRemote({ addRule: async (behavior, rule) => { addRuleCalls.push({ behavior, rule }); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ settingsFileDeps }} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Add a new rule…"));
    stdin.write("\r");                                              // Enter on "Add a new rule…" (idx 0, already highlighted)
    await waitFor(() => frame(lastFrame).includes("Add allow permission rule"));
    expect(frame(lastFrame)).toContain("Enter permission rule…");
    stdin.write("WebFetch");
    await waitFor(() => frame(lastFrame).includes("WebFetch"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE, not typing-then-Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Where should this rule be saved?"));
    expect(frame(lastFrame)).toContain("Project settings (local)");
    expect(frame(lastFrame)).toContain("Project settings");
    expect(frame(lastFrame)).toContain("User settings");
    expect(frame(lastFrame)).toContain("Saved in at ~/.claude/settings.json");   // the verbatim upstream typo, reproduced exactly
    stdin.write("\r");                                              // idx 0 default = "Project settings (local)" → localSettings
    await waitFor(() => addRuleCalls.length === 1);
    expect(addRuleCalls[0]).toEqual({ behavior: "allow", rule: "WebFetch" });
    await waitFor(() => writes.length === 1);
    expect(writes[0].path).toBe(`${process.cwd()}/.claude/settings.local.json`);
    expect(JSON.parse(writes[0].content)).toEqual({ permissions: { allow: ["WebFetch"] } });
    await waitFor(() => frame(lastFrame).includes("Add a new rule…"));   // back on the Allow row list, dialog still open
  });

  it("/permissions: a rule sourced from an actual settings file is read-only — Enter shows the Rule-details panel, never a delete confirm", async () => {
    const removeRuleCalls: unknown[] = [];
    const fake = fakeSettingsRemote({
      getSettings: async () => ({ sources: [{ source: "userSettings", settings: { permissions: { allow: ["Read"] } } }] }),
      removeRule: async (behavior, rule) => { removeRuleCalls.push({ behavior, rule }); },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Read"));           // the fetched read-only row rendered
    stdin.write("\x1b[B");                                            // ↓ from "Add a new rule…" (idx 0) to the "Read" row (idx 1)
    await waitFor(() => frame(lastFrame).includes("❯ Read"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Rule details"));
    expect(frame(lastFrame)).toContain("This rule comes from a read-only source and cannot be modified here.");
    expect(frame(lastFrame)).toContain("From user settings");
    expect(frame(lastFrame)).not.toContain("Delete allowed tool?");
    expect(frame(lastFrame)).not.toContain("Are you sure you want to delete this permission rule?");
    expect(removeRuleCalls).toHaveLength(0);                          // Enter on a read-only row must never reach removeRule
  });

  // Finding 1 (review, W3 T7): the add-rule and remove-directory flows were both covered, but the delete-a-
  // rule path (removePermRule, useChat.ts) never ran end to end anywhere — its only prior mention in this
  // file was the negative assertion above (read-only rows never reach it). Drive a REMOVABLE rule (source
  // "flagSettings", so readOnly:false) through the full add → delete-confirm → delete round trip, the same
  // way the add-rule test above builds it, then continue past add into the delete sub-view. Two file writes
  // are expected through the injected settingsFileDeps fake: the add (appendToArray) and the delete
  // (removeFromArray) — proving BOTH the flag-layer revoke (removeRule fake) AND the file-strip land.
  it("/permissions: deleting a flagSettings-sourced (removable) rule calls removeRule and strips it from the persisted file", async () => {
    const addRuleCalls: { behavior: string; rule: string }[] = [];
    const removeRuleCalls: { behavior: string; rule: string }[] = [];
    const writes: { path: string; content: string }[] = [];
    const settingsFileDeps = {
      read: (_p: string): string => { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
      write: (p: string, s: string) => { writes.push({ path: p, content: s }); },
    };
    // A minimal in-memory mirror of the flag layer: addRule appends, removeRule filters — so the SECOND
    // getSettings() fetch (after delete) reflects the revoke, same as the real engine would.
    let rules: string[] = [];
    const fake = fakeSettingsRemote({
      addRule: async (behavior, rule) => { addRuleCalls.push({ behavior, rule }); rules.push(rule); },
      removeRule: async (behavior, rule) => { removeRuleCalls.push({ behavior, rule }); rules = rules.filter((r) => r !== rule); },
      getSettings: async () => (rules.length ? { sources: [{ source: "flagSettings", settings: { permissions: { allow: rules } } }] } : {}),
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ settingsFileDeps }} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Add a new rule…"));
    stdin.write("\r");                                              // Enter on "Add a new rule…" (idx 0, already highlighted)
    await waitFor(() => frame(lastFrame).includes("Add allow permission rule"));
    stdin.write("WebFetch");
    await waitFor(() => frame(lastFrame).includes("WebFetch"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE, not typing-then-Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Where should this rule be saved?"));
    stdin.write("\r");                                              // idx 0 default = "Project settings (local)" → localSettings
    await waitFor(() => addRuleCalls.length === 1);
    expect(addRuleCalls[0]).toEqual({ behavior: "allow", rule: "WebFetch" });
    await waitFor(() => writes.length === 1);                       // the ADD write landed
    expect(writes[0].path).toBe(`${process.cwd()}/.claude/settings.local.json`);
    expect(JSON.parse(writes[0].content)).toEqual({ permissions: { allow: ["WebFetch"] } });
    await waitFor(() => frame(lastFrame).includes("❯ Add a new rule…"));   // back on the row list, cursor still at idx 0
    // Refetched settings now report the rule as flagSettings-sourced (readOnly:false) — move down from
    // "Add a new rule…" (idx 0) onto it and confirm it opens the DELETE sub-view, not Rule details.
    stdin.write("\x1b[B");
    await waitFor(() => frame(lastFrame).includes("❯ WebFetch"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"));
    expect(frame(lastFrame)).toContain("Are you sure you want to delete this permission rule?");
    stdin.write("\r");
    await waitFor(() => removeRuleCalls.length === 1);
    expect(removeRuleCalls[0]).toEqual({ behavior: "allow", rule: "WebFetch" });
    await waitFor(() => writes.length === 2);                       // the DELETE (strip) write landed
    expect(writes[1].path).toBe(`${process.cwd()}/.claude/settings.local.json`);
    expect(JSON.parse(writes[1].content)).toEqual({ permissions: { allow: [] } });
    await waitFor(() => frame(lastFrame).includes("Add a new rule…"));   // back on the Allow row list, dialog still open
    expect(frame(lastFrame)).not.toContain("WebFetch");               // the deleted rule no longer renders as a row
  });

  it("/permissions Workspace tab: managed cwd rows do not advertise or respond to Enter", async () => {
    const fake = fakeSettingsRemote({ listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }] });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Permissions"));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always reject requests to use denied tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Add directory…"));
    stdin.write("\x1b[B"); await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes(`❯ ${process.cwd()}`));
    expect(frame(lastFrame)).not.toContain("Enter to select");
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Remove directory from workspace?");
  });

  it("/permissions Workspace tab: Enter on a session directory opens the remove confirm, and Enter there calls removeDir", async () => {
    const removeDirCalls: string[] = [];
    const sessionDir = tmpdir();
    const fake = fakeSettingsRemote({
      listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }, { path: sessionDir, source: "session" as const }],
      removeDir: async (p) => { removeDirCalls.push(p); },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    // Each cycleTab computes the next tab from the CURRENT `tab` prop (not a functional state update), so
    // three '\x1b[C' writes fired back-to-back with no render in between would all compute "next tab from
    // Allow" and collapse onto the same target (a real terminal never delivers keys this fast) — space them
    // out one render apart, exactly like every other multi-hop navigation in this file already does via
    // pressUntil/explicit waits, so each press sees the PREVIOUS press's committed state.
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always reject requests to use denied tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Add directory…"));
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes(sessionDir));
    stdin.write("\x1b[B"); stdin.write("\x1b[B");                     // ↓ ↓ : Add directory…(0) → cwd row(1) → session dir row(2)
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes(`❯ ${sessionDir}`));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Remove directory from workspace?"));
    expect(frame(lastFrame)).toContain("Claude Code will no longer have access to files in this directory.");
    stdin.write("\r");
    await waitFor(() => removeDirCalls.length === 1);
    expect(removeDirCalls[0]).toBe(sessionDir);
  });

  // W3 final review Finding 6: the embedded "Add directory…" flow used to fire refreshDirs() unchained
  // from confirmAddDir's own promise, so a listDirs() that resolved before session.addDir(...) landed would
  // capture a stale (pre-add) snapshot into state — and nothing ever refetched after, so the new directory
  // stayed invisible until the user bounced tabs. `addDir` here is gated on a promise this test controls,
  // standing in for the "ops arrive in separate socket chunks" race the reviewer described; `listDirs`
  // reports the CURRENT server-side truth (only the cwd row until the gated addDir actually resolves).
  it("/permissions Workspace tab: 'Add directory…' waits for confirmAddDir to land before refetching, so the new directory appears with no extra tab bounce (Finding 6, final review)", async () => {
    const target = tmpdir();   // a real, existing directory outside process.cwd()
    let added = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fake = fakeSettingsRemote({
      listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }, ...(added ? [{ path: target, source: "session" as const }] : [])],
      addDir: async () => { await gate; added = true; },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always reject requests to use denied tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Add directory…"));
    stdin.write("\r");                                              // Enter on "Add directory…" (idx 0) → embedded AddDirDialog entry phase
    await waitFor(() => frame(lastFrame).includes("Enter the path to the directory:"));
    stdin.write(target);
    await waitFor(() => frame(lastFrame).includes(target));
    stdin.write("\r");                                              // validate("ok") → confirm phase
    await waitFor(() => frame(lastFrame).includes("Yes, for this session"));
    stdin.write("\r");                                              // idx 0 default → onConfirm(target, false); session.addDir(...) now blocked on `gate`
    await waitFor(() => frame(lastFrame).includes("Add directory…"));   // back on the Workspace row list (setSub("none") is synchronous either way)
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame).replace(/\n/g, " ")).not.toContain(target);   // not yet — addDir hasn't resolved, so it must not have been added
    release();                                                       // let session.addDir(...) resolve
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes(target));   // now it shows up — with no further keypress
  });

  it("/permissions: Esc at the top level dismisses with the exact upstream line, and /allowed-tools is a full alias", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/allowed-tools"); await waitFor(() => frame(lastFrame).includes("/allowed-tools"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Permissions dialog dismissed"));
    expect(frame(lastFrame)).not.toContain("Claude Code won't ask before using allowed tools.");   // dialog really closed
  });

  it("a queue-rescued draft remains current through actual pager, history, and decision composer remounts", async () => {
    let interrupted = 0;
    let first = true;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (_prompt) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        if (first) { first = false; return new Promise(() => {}); }
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
      interrupt: async () => { interrupted++; fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); },
    });
    const deps = { getSessionMessages: async () => [] as any[], getSessionMessagesIn: async () => [] as any[], listHistorySessions: async () => [] };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("⟳"));
    for (const text of ["queued one", "queued two"]) {
      stdin.write(text); await waitFor(() => frame(lastFrame).includes(text));
      stdin.write("\r"); await waitFor(() => frame(lastFrame).includes(`⋯ queued: ${text}`));
    }
    stdin.write("\x1b");
    await waitFor(() => interrupted === 1 && frame(lastFrame).includes("queued one") && frame(lastFrame).includes("queued two"));

    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("›"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("Search prompts"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("›"));
    await new Promise((r) => setTimeout(r, 20));

    fake.parkPermission({ sessionId: "s", toolUseID: "rescue", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use"));
    stdin.write("\x1b"); await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes("›"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(" edited"); await waitFor(() => frame(lastFrame).includes("queued two edited"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Ask Claude anything…"));

    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Ask Claude anything…"));
  });

  it("Esc with a running turn and 3 queued messages: composer holds all three newline-joined, queue empty, turn interrupted (F0 acceptance 1, CM49)", async () => {
    let interrupted = 0;
    const submitted: string[] = [];
    // A hanging turn, mirroring escape.test.tsx's "busy + text: Esc interrupts" pattern: fakeRemote() has
    // no `run` field, so `submit` pushes the turn-start event itself (busy is driven by that host event,
    // not by submit()'s own promise state) and then never resolves.
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (prompt) => { submitted.push(prompt); fake.pushEvent({ kind: "turn", phase: "start", seq: submitted.length }); return new Promise(() => {}); },
      interrupt: async () => { interrupted++; fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("⟳"));
    for (const q of ["first queued", "second queued", "third queued"]) {
      stdin.write(q); await waitFor(() => frame(lastFrame).includes(q));
      stdin.write("\r");
      await waitFor(() => frame(lastFrame).includes(`⋯ queued: ${q}`));
    }
    stdin.write("\x1b");                                              // Esc: interrupt + rescue
    await waitFor(() => interrupted === 1);
    await waitFor(() => !frame(lastFrame).includes("⋯ queued:"));
    const f = frame(lastFrame);
    expect(f).toMatch(/first queued[\s\S]*second queued[\s\S]*third queued/);
    expect(f).toMatch(/third queued(?:\x1b\[[0-9;]*m)*\x1b\[7m /);   // cursor-at-end marker on the final line
    stdin.write("\r");
    await waitFor(() => submitted.length === 2);
    expect(submitted[1]).toBe("first queued\nsecond queued\nthird queued");
  });

  it("Ctrl-C rescues queued text without submitting a stale open command popup (F0 critical rescue)", async () => {
    let interrupted = 0;
    let first = true;
    const submitted: string[] = [];
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (prompt) => {
        submitted.push(prompt);
        fake.pushEvent({ kind: "turn", phase: "start", seq: submitted.length });
        if (first) { first = false; return new Promise(() => {}); }
        fake.pushEvent({ kind: "turn", phase: "end", seq: submitted.length });
        return { result: "done" };
      },
      interrupt: async () => { interrupted++; fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("⟳"));
    stdin.write("queued-one"); await waitFor(() => frame(lastFrame).includes("queued-one"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("⋯ queued: queued-one"));
    stdin.write("/"); await waitFor(() => frame(lastFrame).includes("/"));
    stdin.write("mod"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\x03");
    await waitFor(() => interrupted === 1 && !frame(lastFrame).includes("⋯ queued:"));
    expect(frame(lastFrame)).toContain("queued-one");
    expect(frame(lastFrame)).toContain("/mod");
    expect(frame(lastFrame)).not.toContain("↑/↓");
    stdin.write("\r");
    await waitFor(() => submitted.length === 2);
    expect(submitted[1]).toBe("queued-one\n/mod");
    expect(submitted[1]).not.toBe("/model");
  });
});

// ── F1 Task 4: the retained-source cutover, through the REAL ChatApp wiring ────────────────────────────
// A tool header carries a real OSC-8 hyperlink (Task 3), so `Read(src/app.ts)` is NOT contiguous in the
// raw frame — strip the escapes before any substring check. A published <Static> row is asserted over the
// emitted stream (`printed`) rather than reasoned about per frame.
// NB (corrected in Task 5, having verified it against ink-testing-library): that library renders in Ink's
// `debug` mode, where every frame is the ACCUMULATED static output plus the current dynamic output — a row
// Static has published therefore stays in `lastFrame` for the rest of the run. So "X is no longer shown"
// can only ever be asserted about the dynamic region; for a published row, count it instead.
const plain = (s: string) => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const printed = (stdout: { frames: string[] }) => plain(stdout.frames.join("\n"));
async function tick() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}
async function waitForFakeTimers(cond: () => boolean, timeout = 2_000) {
  for (let elapsed = 0; elapsed <= timeout; elapsed += 5) {
    if (cond()) return;
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  }
  throw new Error("waitForFakeTimers timeout");
}

describe("<ChatApp> — retained source", () => {
  /** Task 5c: a read run collapses to ONE dim summary row, and the projection withholds it while the run is
   *  still growable — real assistant prose is what closes the run and publishes it into Static. */
  const CLOSING_PROSE = { type: "assistant", message: { id: "assistant-closes-run", content: [{ type: "text", text: "all done" }] } };
  it("repaints an open tool at 600ms without an SDK event, then appends one final Static row", async () => {
    const fake = fakeRemote(), { stdout, lastFrame, unmount } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick(); vi.useFakeTimers();
    try {
      fake.pushEvent({ kind: "message", data: READ_CALL }); await waitForFakeTimers(() => plain(frame(lastFrame)).includes("Reading 1 file"));
      const beforeBlink = stdout.frames.at(-1)!;
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      await waitForFakeTimers(() => stdout.frames.at(-1) !== beforeBlink);
      expect(plain(frame(lastFrame))).toContain("Reading 1 file"); // only the leader glyph blinked away; no fake.pushEvent between the two frames.
      fake.pushEvent({ kind: "message", data: READ_RESULT_WITH_SIDECAR }); fake.pushEvent({ kind: "message", data: CLOSING_PROSE });
      await waitForFakeTimers(() => plain(frame(lastFrame)).includes("Read 1 file (ctrl+o to expand)"));
      fake.pushEvent({ kind: "message", data: READ_RESULT_WITH_SIDECAR });                      // the same result redelivered
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(plain(frame(lastFrame)).match(/Read 1 file \(ctrl\+o to expand\)/g)).toHaveLength(1);   // ONE final row, never republished
      expect(plain(frame(lastFrame))).not.toContain("Running Read");
      unmount(); const framesAfterUnmount = stdout.frames.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200); }); expect(stdout.frames).toHaveLength(framesAfterUnmount);
    } finally { vi.useRealTimers(); }
  });

  it("ingests a bare truncated idle replay without opening a turn or trapping the composer", async () => {
    const prompts: string[] = [], fake = fakeRemote({ submit: async (prompt) => { prompts.push(prompt); return { result: "done" }; } });
    const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached" }} cwd="/work" />);
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", truncated: true });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "idle-tail", content: [{ type: "text", text: "retained idle tail" }] } } });
    fake.pushEvent({ kind: "state", status: { state: "working", status: "idle" } });
    await waitFor(() => printed(stdout).includes("Earlier live output unavailable while attaching") && printed(stdout).includes("retained idle tail"));
    expect(plain(frame(lastFrame))).not.toContain("esc to interrupt");   // never busy: no turn was opened
    // Typed then submitted as two writes, per this file's Ink discipline: one chunked "text\r" arrives as a
    // single key event the editor reads as literal text, so it would never reach onSubmit.
    stdin.write("after attach"); await waitFor(() => plain(frame(lastFrame)).includes("after attach"));
    stdin.write("\r"); await waitFor(() => prompts.includes("after attach"));
  });

  it("bootstraps [disk SDK, identified local notice, disk SDK] in order, with no second initial channel", async () => {
    const initialEntries = [
      { kind: "sdk" as const, source: "disk" as const, message: { type: "user", uuid: "u-first", message: { content: [{ type: "text", text: "FIRST-DISK-ROW" }] } } },
      { kind: "local" as const, identity: "attach:no-persisted-history", event: { kind: "notice" as const, lines: [{ text: "MIDDLE-LOCAL-NOTICE", dim: true }] } },
      { kind: "sdk" as const, source: "disk" as const, message: { type: "assistant", message: { id: "a-last", content: [{ type: "text", text: "LAST-DISK-ROW" }] } } },
    ];
    const { lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "attached" }} cwd="/work" initialEntries={initialEntries} />);
    await waitFor(() => frame(lastFrame).includes("LAST-DISK-ROW"));
    const rendered = frame(lastFrame);
    expect(rendered.indexOf("FIRST-DISK-ROW")).toBeLessThan(rendered.indexOf("MIDDLE-LOCAL-NOTICE"));
    expect(rendered.indexOf("MIDDLE-LOCAL-NOTICE")).toBeLessThan(rendered.indexOf("LAST-DISK-ROW"));
  });

  it("clears Ink's Static before a /clear mounts a fresh one, leaving one copy of every later row", async () => {
    const clears: number[] = [];
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" clearStaticTranscript={() => clears.push(1)} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/help"); await waitFor(() => frame(lastFrame).includes("/help"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("/clear"); await waitFor(() => frame(lastFrame).includes("/clear"));
    stdin.write("\r"); await waitFor(() => clears.length === 1);
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "post-clear", content: [{ type: "text", text: "POST-CLEAR-ROW" }] } } });
    await waitFor(() => frame(lastFrame).includes("POST-CLEAR-ROW"));
    expect(frame(lastFrame).match(/POST-CLEAR-ROW/g)).toHaveLength(1);
  });
  // F1 Task 5: the pager reads the RETAINED document through useChat's detailItems, so a result the compact
  // transcript folded to three rows opens whole — and ctrl+e is the pager's OWN local knob, never app state.
  // Per the frame-model note above, "the pager is not showing the compact form" is asserted as a COUNT of
  // the compact hint (one published copy, never a second) rather than as its absence.
  // A NON-collapsible tool since Task 5c: the default view folds every read/search/list/MCP run into one
  // summary row and drops its result body entirely, so the compact three-row-plus-overflow shape this pager
  // pair is about only survives on a standalone row. Nothing else here changed.
  const LONG_CALL = { type: "assistant", message: { id: "assistant-long", content: [{ type: "tool_use", id: "long-1", name: "Bash", input: { command: "echo hi" } }] } };
  const longReadResult = (rows: number) => ({
    type: "user", uuid: "user-long",
    message: { content: [{ type: "tool_result", tool_use_id: "long-1", content: Array.from({ length: rows }, (_, i) => `line ${i + 1}`).join("\n"), is_error: false }] },
  });
  const OVERFLOW = /… \+\d+ lines? \(ctrl\+o to expand\)/g;
  it("opens retained 40-line output with Ctrl-O and toggles only pager-local Ctrl-E", async () => {
    const fake = fakeRemote();
    const app = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick(); fake.pushEvent({ kind: "message", data: LONG_CALL }); fake.pushEvent({ kind: "message", data: longReadResult(40) });
    await waitFor(() => plain(frame(app.lastFrame)).includes("… +37 lines (ctrl+o to expand)"));
    expect(plain(frame(app.lastFrame))).not.toContain("line 40");                              // compact hid rows 4–40
    app.stdin.write("\x0f"); await waitFor(() => plain(frame(app.lastFrame)).includes("line 40"));   // detail-all, opened at the bottom
    app.stdin.write("g"); await waitFor(() => plain(frame(app.lastFrame)).includes("lines 1–"));
    // Asserted at the TOP of the pager, where a wrongly-compact pager would show its own overflow row: at the
    // bottom anchor a duplicate above the viewport is invisible and the count passes vacuously.
    expect(plain(frame(app.lastFrame)).match(OVERFLOW) ?? []).toHaveLength(1);                  // only the static copy: the pager is NOT compact
    app.stdin.write("G"); await waitFor(() => plain(frame(app.lastFrame)).includes("line 40"));
    app.stdin.write("\x05"); await waitFor(() => plain(frame(app.lastFrame)).includes("… +37 lines (ctrl+e to show all)")); expect(plain(frame(app.lastFrame))).not.toContain("line 40");
    app.stdin.write("\x05"); app.stdin.write("G"); await waitFor(() => plain(frame(app.lastFrame)).includes("line 40")); app.stdin.write("\x1b"); await waitFor(() => !plain(frame(app.lastFrame)).includes("line 40"));
  });
  it("Ctrl-E toggling and closing leave exactly one compact overflow row in the emitted static stream", async () => {
    const fake = fakeRemote();
    const app = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" />);
    await tick(); fake.pushEvent({ kind: "message", data: LONG_CALL }); fake.pushEvent({ kind: "message", data: longReadResult(40) });
    await waitFor(() => plain(frame(app.lastFrame)).includes("ctrl+o to expand"));
    // The expected row is READ OUT of the emitted frames, never copied in as a literal — the claim is about
    // what Ink actually flushed into its append-only <Static>, so the text has to come from there.
    const compactRow = (printed(app.stdout).match(OVERFLOW) ?? [])[0];
    expect(compactRow).toBeTypeOf("string");
    const before = app.stdout.frames.length;
    app.stdin.write("\x0f"); await waitFor(() => plain(frame(app.lastFrame)).includes("line 40"));
    app.stdin.write("\x05"); await waitFor(() => plain(frame(app.lastFrame)).includes("ctrl+e to show all"));
    app.stdin.write("\x05"); await waitFor(() => plain(frame(app.lastFrame)).includes("line 40"));
    app.stdin.write("\x1b"); await waitFor(() => !plain(frame(app.lastFrame)).includes("line 40"));
    const after = app.stdout.frames.slice(before);
    expect(after.length).toBeGreaterThan(0);
    // Every frame the toggles and the close emitted still carries that row exactly once: never republished
    // by a re-projection, never wiped by an accidental <Static> replacement.
    for (const f of after) expect(plain(f).split(compactRow!)).toHaveLength(2);
  });
});
