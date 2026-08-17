// tui/test/chat.test.tsx — reworked onto the adapter surface: `broker` prop is gone; ChatApp takes
// `client: { kind, short? }` + `onDetach?`. fakeRemote() (test/tui/helpers/fakeRemote.ts) mirrors the real
// RemoteChat wire contract (spec A2b Task 6).
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { tmpdir } from "node:os";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
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
import { appendHistory, readHistory } from "../../src/tui/promptHistory.js";
import { createNotificationStore } from "../../src/tui/notifications.js";
import { spinnerUp } from "./helpers/spinnerRow.js";

// W3 T4: theme.ts's ACCENT/current live binding is module-scoped and vitest isolates per FILE, not per
// test, so a /theme test that previews or persists a theme must not leak it into a later test in this
// file — reset after every test, not just the theme-specific ones.
afterEach(() => setTheme("auto"));

// Every fake home this file makes, removed after the test that made it — the /keybindings tests inject one so
// the REAL ~/.claude is never touched, and a leaked mkdtemp dir per run is still litter (matches the
// dirs/afterEach pattern in keys-user-bindings.test.ts).
const homes: string[] = [];
const tmpHome = (): string => { const d = mkdtempSync(join(tmpdir(), "ccx-kb-home-")); homes.push(d); return d; };
afterEach(() => { for (const d of homes.splice(0)) rmSync(d, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
// F4 Task 8: the prompt echo — live, replayed and QUEUED alike — is now `userEchoLines`'s band: a `❯ ` cell
// and the text in separate <Text> spans (they carry different colors), so ANSI sits between them and Ink may
// break the row. Strip and collapse before pinning the gutter. `⋯ queued: …` is gone: a queued prompt is the
// ordinary band inside `wqo`'s paddingX-2 box (bundle L426002–426022), which is what `isQueued` looks for.
/** TaskPanel's pending row (F6 T13). Ink lays the row out by MEASURED width and `◻` measures two columns
 *  while printing as one, so the gutter is one space or two — this is a regex rather than a literal for that
 *  reason. "todo-item-one" ALONE would not do: the transcript also prints the TaskCreate tool_use and its
 *  result text permanently, so a bare substring check never goes false. */
const TODO_ROW = /◻\s+todo-item-one/;
const stripAnsiAll = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
// The collapse deliberately spares U+00A0. F5 Task 2 gave the COMPOSER the same `❯` the band uses, followed
// by a NBSP (`Ge.pointer` + `\xA0`, bundle L494723) where the band uses a normal space — that one character
// is the whole difference between "this prompt is queued" and "this prompt is sitting in the composer".
// `\s` matches NBSP in JS, so a blanket `\s+` collapse made `isQueued` fire on rescued text too, and the
// queue-rescue tests could never observe the queue emptying.
const banded = (f: () => string | undefined) => stripAnsiAll(frame(f)).replace(/[^\S\u00a0]+/g, " ");
const isQueued = (f: () => string | undefined, text: string) => banded(f).includes(`❯ ${text}`);
/** The COMPOSER's own prompt row — the last `❯` line in the frame. The transcript above it echoes every
 *  prompt that was ever sent, so a whole-frame match cannot tell "the composer holds this" from "this was
 *  submitted earlier"; the history-walk pins below need the former. */
const composerLine = (f: () => string | undefined) => {
  const lines = stripAnsiAll(frame(f)).split("\n").filter((l) => l.includes("❯"));
  return lines[lines.length - 1] ?? "";
};
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** A frame as ONE line: Ink wraps the picker's long sentences, so a literal that spans a wrap has to be
 *  matched against the joined text (F6 T11). */
const oneLine = (f: string) => f.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s*\n\s*/g, " ");
/** WAVE C TASK 4 — the double-press arms' `deps` seam driven synthetically (plan constraint 15), copied from
 *  `test/unit/doublePress.test.ts`'s own `fakeClock` rather than imported: that helper is file-local by the
 *  same convention every other helper in this suite follows. `advance` fires due timers before it returns. */
function fakeClock() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      now: (): number => now,
      setTimeout: (fn: () => void, ms: number): unknown => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (h: unknown): void => { timers.delete(h as number); },
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        let id = -1, at = Infinity;
        for (const [k, t] of timers) if (t.at <= target && t.at < at) { id = k; at = t.at; }
        if (id < 0) break;
        const t = timers.get(id)!; timers.delete(id); now = t.at; t.fn();
      }
      now = target;
    },
  };
}
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { stdin.write(key); if (cond()) return; if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}) timeout`); await new Promise((r) => setTimeout(r, 5)); }
}
// ── F5 t12: ctrl+r is the COMPOSER's inline reverse-i-search now (upstream's own layout routing — see
// historySearchInline.ts's header), so every test below that wants the full-screen PICKER opens it the way a
// user does: the `/history` command. `historyDeps` points `loadHistory` at a temp fleet root seeded with one
// prompt, because both surfaces read `history.jsonl` (readHistory) instead of the persisted transcripts.
const historyRoots: string[] = [];
function seededHistory(display = "redo the build"): { env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "ccx-chat-hist-"));
  historyRoots.push(root);
  const env = { ...process.env, CCX_FLEET_ROOT: root };
  appendHistory({ display, project: process.cwd() }, env);
  return { env };
}
afterEach(() => { for (const d of historyRoots.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function openHistoryPicker(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined) {
  stdin.write("/history"); await waitFor(() => frame(lastFrame).includes("/history"));
  stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Search prompts"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));      // composer mounted → TextInput live
    stdin.write("hi");
    await waitFor(() => frame(lastFrame).includes("hi"));   // typed text landed in the composer before Enter
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });

  it("surfaces a parked permission as a dialog and 'a' allows it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.parkPermission({ sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Edit file"));   // dialog up
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t", decision: { kind: "allow_once" } });
  });

  it("hides the global composer hint under permission, question, and plan input owners", async () => {
    const fake = fakeRemote();
    const { lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.parkPermission({ sessionId: "s", toolUseID: "p", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    expect(frame(lastFrame)).not.toContain("Esc interrupt");
    expect(frame(lastFrame)).not.toContain("[y/n");
    fake.settlePermission("p", "me", "deny");
    await waitFor(() => !frame(lastFrame).includes("Edit file"));
    fake.parkPermission({ sessionId: "s", toolUseID: "q", toolName: "AskUserQuestion", kind: "question", input: { questions: [{ question: "Continue?", options: [{ label: "yes" }], multiSelect: false }] }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Continue?"));
    // WAVE C TASK 2: `Esc rewind` was hint row 2, which retired with the composer's hint stack. The rule it
    // stood for is unchanged and still asserted one line down: a dialog owner sees no Chat-context chord.
    expect(frame(lastFrame)).not.toContain("? for shortcuts");
    fake.settlePermission("q", "me", "question_answer");
    await waitFor(() => !frame(lastFrame).includes("Continue?"));
    fake.parkPermission({ sessionId: "s", toolUseID: "r", toolName: "ExitPlanMode", kind: "plan", input: { plan: "ship it" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Ready to code?"));
    expect(frame(lastFrame)).not.toContain("? for shortcuts");
  });

  it("never paints a stale editor hint in any frame after a draft or autocomplete takes input ownership", async () => {
    const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/__ccx-empty-cwd__" />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    const expectOwnerFramesHonest = (frames: string[], marker: string) => {
      const owned = frames.filter((f) => f.includes(marker));
      expect(owned.length, `no emitted frame rendered ${JSON.stringify(marker)}`).toBeGreaterThan(0);
      for (const rendered of owned) {
        // WAVE C TASK 2: `Esc rewind` retired with hint row 2; `? for shortcuts` is the surviving
        // Chat-context chord the footer can print, and the one this sweep now watches.
        expect(rendered).not.toContain("? for shortcuts");
      }
    };

    let start = stdout.frames.length;
    stdin.write("sentinel-draft");
    await waitFor(() => frame(lastFrame).includes("sentinel-draft"));
    expectOwnerFramesHonest(stdout.frames.slice(start), "sentinel-draft");
    stdin.write("\x15");
    await waitFor(() => !frame(lastFrame).includes("sentinel-draft"));

    // F5 t9 migrated these two legs onto the upstream trigger/empty-state contract. The command popup's empty
    // message is CM38's `No commands match "…"` and upstream only writes it once a partial NAME exists
    // (`mt.length > 1`, bundle L490779), so the marker is `/zz` rather than the bare `/` this used to type.
    start = stdout.frames.length;
    stdin.write("/zz");
    await waitFor(() => frame(lastFrame).includes('No commands match "/zz"'));
    expectOwnerFramesHonest(stdout.frames.slice(start), 'No commands match "/zz"');
    stdin.write("\x1b");
    await waitFor(() => !frame(lastFrame).includes('No commands match "/zz"'));
    stdin.write("\x15");

    // The file popup has NO empty message upstream (`suggestionsEmptyMessage` is written at the command site
    // only), so an `@` against this empty cwd draws no popup at all — the ownership the honesty check is
    // after is still real (the footer hint is gone while the mention is open), so the marker is the draft.
    start = stdout.frames.length;
    stdin.write("@zz");
    await waitFor(() => frame(lastFrame).includes("@zz"));
    expectOwnerFramesHonest(stdout.frames.slice(start), "@zz");
  });

  it("surfaces a parked question as a QuestionDialog (kind dispatcher) and answers it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.parkPermission({
      sessionId: "s", toolUseID: "t", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red" }, { label: "blue" }] }] },
      createdAt: Date.now(),
    });
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));   // QuestionDialog up, not PermissionDialog
    expect(frame(lastFrame)).not.toContain("Tool use");              // T8: the generic body's frame title
    stdin.write("2");                                                // selects "blue" — single question → onAnswer fires
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t", decision: { kind: "question_answer", answers: { "Red or blue?": "blue" } } });
  });

  it("a second queued question (fewer questions than the first) does not inherit stale progress — dialog remounts per toolUseID", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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

  // BL6 updated the OUTCOME this sends, not the routing this cell is about: the decline now carries its own
  // `reason` so the gate can report a present human refusing rather than an absent one, and it also ends the
  // turn. Both are pinned in question-decline.test.tsx; what stays pinned HERE is that Esc reaches the
  // dispatcher at all and never fabricates an answer.
  it("Esc on a parked question denies via the dispatcher (never a fabricated answer)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.parkPermission({
      sessionId: "s", toolUseID: "t2", toolName: "AskUserQuestion", kind: "question",
      input: { questions: [{ question: "Continue?", multiSelect: false, options: [{ label: "yes" }, { label: "no" }] }] },
      createdAt: Date.now(),
    });
    await waitFor(() => frame(lastFrame).includes("Continue?"));
    stdin.write("\x1b");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]).toEqual({ toolUseID: "t2", decision: { kind: "deny", reason: "declined" } });
  });

  it("Ctrl-L now clears the composer input (the editor owns it), not the app-level screen", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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

  // ── WAVE C TASK 4 (EP-C7b), annex §C7.2 — CTRL-C DOES BOTH THINGS ON THE FIRST PRESS. Upstream's `V`
  // (bundle L395616) is one `Pee` whose `onFirstPress` is `if (e) t(""), B(0), c?.()` — clear the buffer, put
  // the cursor at 0, reset the history walk — while the SAME press arms exit and paints
  // `Press Ctrl-C again to exit`. ccx armed without clearing, which is the defect these three pin.
  it("Ctrl-C on a non-empty draft clears the draft AND arms exit in the same press (annex §C7.2)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("half a thought");
    await waitFor(() => composerLine(lastFrame).includes("half a thought"));
    stdin.write("\x03");                                                     // ONE press: clears AND arms
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    expect(composerLine(lastFrame)).not.toContain("half a thought");
    stdin.write("\x03");                                                     // second press inside the window → exit
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("zzz");                                                      // a live composer would show this
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("zzz");
  });

  it("Ctrl-C while busy interrupts and leaves the draft standing (no clear, no arm)", async () => {
    let release = () => {}; let interrupts = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      interrupt: () => { interrupts++; },
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("go"); stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));                    // turn started, hanging
    stdin.write("next thought");
    await waitFor(() => composerLine(lastFrame).includes("next thought"));
    stdin.write("\x03");
    await waitFor(() => interrupts === 1);
    expect(composerLine(lastFrame)).toContain("next thought");               // the busy branch never clears
    expect(frame(lastFrame)).not.toContain("Press Ctrl-C again to exit");    // …and never arms
    release();
  });

  it("the Ctrl-C exit arm expires at the 800 ms window and the footer row comes back", async () => {
    const clock = fakeClock();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} doublePressDeps={clock.deps} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x03");
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    await act(async () => { clock.advance(800); });                          // `fpy` (L183463), driven synthetically
    // 300 ms, not the 2 s default: the window under test is the INJECTED one, so a poll long enough for a real
    // wall-clock timer to fire would pass on an unmigrated arm and prove nothing.
    await waitFor(() => !frame(lastFrame).includes("Press Ctrl-C again to exit"), 300);
    expect(frame(lastFrame)).toContain("? for shortcuts");                   // the footer's own row is back
  });

  it("the Ctrl-C arm's key is DERIVED from app:interrupt, so a rebind moves it", async () => {
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Global", bindings: { "ctrl+c": null, "alt+c": "app:interrupt" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x1bc");                                                    // alt+c now IS app:interrupt
    await waitFor(() => frame(lastFrame).includes("Press Alt-C again to exit"));
    expect(frame(lastFrame)).not.toContain("Press Ctrl-C again to exit");
  });

  // ── WAVE C TASK 4, from Task 2's review: the rewind arm shared `escape-again-to-clear` with the composer's
  // Esc-clear arm, and the composer removes that key unconditionally on every mount — so a composer remount
  // while a rewind arm was live silently pulled the hint out from under it. Its own key is the fix.
  it("the rewind arm posts on its own notification key, so the composer's clear-key removal cannot pull it", async () => {
    const store = createNotificationStore();
    const fake = fakeRewindRemote({ rewindAnchors: async () => [] });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ notifications: store }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    expect(store.state().current?.key).toBe("escape-again-to-rewind");
    store.remove("escape-again-to-clear");                                   // exactly what a composer mount does
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Press Esc again to rewind");
  });

  it("the first Esc on a draft posts `Esc again to clear` to the queue at upstream's own 1000 ms (annex §C7.3)", async () => {
    const store = createNotificationStore();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ notifications: store }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("aa"); await waitFor(() => composerLine(lastFrame).includes("aa"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(store.state().current).toMatchObject({ key: "escape-again-to-clear", text: "Esc again to clear", priority: "immediate", timeoutMs: 1000 });
    stdin.write("\x1b");                                                     // second press inside the window clears
    await waitFor(() => !composerLine(lastFrame).includes("aa"));
    expect(store.state().current).toBe(null);                                // upstream's `j("escape-again-to-clear")`
  });

  // ── WAVE C TASK 4, from Task 2's review: `← for agents` rendered while `←` was bound to nothing. The
  // gesture is upstream's left-arrow-on-empty (annex §C7.8, L395750) on the shared double-press primitive.
  it("← on an empty composer arms the agents gesture; a second ← opens the background pane", async () => {
    const store = createNotificationStore();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ notifications: store }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x1b[D");
    await waitFor(() => frame(lastFrame).includes("Press ← again"));
    expect(store.state().current?.key).toBe("left-arrow-again-for-agents");
    stdin.write("\x1b[D");
    await waitFor(() => frame(lastFrame).includes("Background"));
    expect(frame(lastFrame)).toContain("No tasks currently running");
  });

  it("typing disarms the ← agents gesture", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x1b[D");
    await waitFor(() => frame(lastFrame).includes("Press ← again"));
    stdin.write("a");
    await waitFor(() => !frame(lastFrame).includes("Press ← again"));
    stdin.write("\x1b[D");                                                   // a cursor motion now, not the gesture
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Press ← again");
    expect(frame(lastFrame)).not.toContain("No tasks currently running");
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    // "todo-item-one" alone is ambiguous: the transcript ALSO prints the TaskCreate tool_use + its result
    // text permanently, so a bare substring check never goes false. TODO_ROW (TaskPanel's pending
    // glyph + subject) is unique to the panel row and is what actually toggles.
    await waitFor(() => TODO_ROW.test(lastFrame() ?? ""));
    stdin.write("\x14");                                       // Ctrl-T
    await waitFor(() => !TODO_ROW.test(lastFrame() ?? ""));
    stdin.write("\x14");
    await waitFor(() => TODO_ROW.test(lastFrame() ?? ""));
  });

  // F6 T13 (DG59). The Ctrl-T state is a PREFERENCE now: `initialTodosOpen` is what chatMain restores from
  // `prefs.showExpandedTodos` before the first render, and every toggle writes the new value back through the
  // injected savePrefs seam (upstream keeps the same flag in step with `expandedView`, bundle L401025-401031).
  it("the Ctrl-T panel state is restored from prefs and written back on every toggle", async () => {
    const saved: Record<string, unknown>[] = [];
    const fake = fakeRemote();
    const { lastFrame, stdin } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/" initialTodosOpen={false}
        deps={{ savePrefs: (patch) => { saved.push(patch as Record<string, unknown>); } }} />);
    await new Promise((r) => setTimeout(r, 30));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await new Promise((r) => setTimeout(r, 60));                         // let the seeded task settle
    expect(TODO_ROW.test(lastFrame() ?? "")).toBe(false);                // the saved pref kept the panel shut…
    stdin.write("\x14");
    await waitFor(() => TODO_ROW.test(lastFrame() ?? ""));               // …over a task that was there all along
    expect(saved).toEqual([{ showExpandedTodos: true }]);
    stdin.write("\x14");
    await waitFor(() => !TODO_ROW.test(lastFrame() ?? ""));
    expect(saved).toEqual([{ showExpandedTodos: true }, { showExpandedTodos: false }]);
  });

  it("initialPrompt submits once on mount", async () => {
    const { lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} initialPrompt="do the thing" />);
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(banded(lastFrame)).toContain("❯ do the thing");
  });

  it("Ctrl-Z calls the injected suspend and does not exit or detach (KB5: detach moved to /detach)", async () => {
    let suspended = 0; let detached = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} onDetach={() => { detached++; }} suspend={() => { suspended++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1a");                                     // Ctrl-Z
    await waitFor(() => suspended === 1);
    expect(detached).toBe(0);
    expect(frame(lastFrame)).toContain("❯\u00a0");                 // composer still alive, never exited
  });

  it("Ctrl-Z routes its resumed Ink write through the render owner exactly once", async () => {
    const owner = { repaint: vi.fn((run: () => void) => run()) };
    const suspend = (deps: any) => deps.repaint();
    const { stdin, stdout, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={suspend} resumeOutput={owner} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    const framesBefore = stdout.frames.length;
    stdin.write("\x1a");
    await waitFor(() => owner.repaint.mock.calls.length === 1);
    await waitFor(() => stdout.frames.length > framesBefore);
    expect(stdout.frames.length).toBe(framesBefore + 1);
  });

  it("Ctrl-Z invokes a no-op suspend once without breaking the active composer's yank-pop", async () => {
    const suspend = vi.fn();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} suspend={suspend as any} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("one"); await waitFor(() => frame(lastFrame).includes("one"));
    stdin.write("\x15"); await waitFor(() => !frame(lastFrame).includes("one"));
    stdin.write("two"); await waitFor(() => frame(lastFrame).includes("two"));
    stdin.write("\x15"); await waitFor(() => frame(lastFrame).includes("? for shortcuts"));
    stdin.write("\x19"); await waitFor(() => frame(lastFrame).includes("two"));
    stdin.write("\x1a"); await waitFor(() => suspend.mock.calls.length === 1);
    stdin.write("\x1by"); await waitFor(() => frame(lastFrame).includes("one"));
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it("Ctrl-Z still reaches the injected suspend under a pending permission dialog, and never answers it", async () => {
    let suspended = 0;
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "attached", short: "abc" }} suspend={() => { suspended++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    const entry: PendingEntry = { sessionId: "s", toolUseID: "t", toolName: "Edit", kind: "permission", input: {}, createdAt: Date.now() };
    fake.parkPermission(entry);
    // An Edit with no derivable path routes to the generic body (`Gal`), whose frame title this is since T8.
    await waitFor(() => frame(lastFrame).includes("Tool use"));
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
      await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/detach"); await waitFor(() => frame(lastFrame).includes("/detach"));
    stdin.write("\r");
    await waitFor(() => detachCalls === 1);

    const loopback = fakeRemote();
    const lb = render(<ChatApp makeSession={() => loopback} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lb.lastFrame).includes("❯\u00a0"));
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
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn started, hanging
    stdin.write("\x02");                                                       // Ctrl-B busy → background the turn
    await waitFor(() => backgroundCalls === 1);
    expect(frame(lastFrame)).not.toContain("No tasks currently running");      // panel did NOT open
    release();
  });

  it("Ctrl-B while idle opens the background-tasks panel", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x02");                                                       // Ctrl-B idle → open panel
    await waitFor(() => frame(lastFrame).includes("Background"));
    expect(frame(lastFrame)).toContain("No tasks currently running");
  });

  // WAVE C TASK 2: `⚙ N bg` retired with the status bar. Upstream's shape for the same fact is the footer's
  // `← for agents` affordance (annex §C1.4), which renders only while background agents exist — so the
  // presence/absence contract this case was written for is the same one, in upstream's own words. The COUNT
  // is no longer on the row (upstream shows a number only during its awaiting/done flash, which ccx has no
  // producer for yet — see `footerModel.agentsAffordance`), so the count half is pinned in `footer.test.tsx`
  // against the pure function instead of against a live app frame.
  it("the footer advertises background agents only while some exist, and updates on tasks_changed", async () => {
    const fake = fakeRemote();
    const { lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).not.toContain("← for agents");
    fake.pushEvent({ kind: "tasks_changed", tasks: [
      { task_id: "a", task_type: "local_bash", description: "x" },
      { task_id: "b", task_type: "agent", description: "y" },
    ] });
    await waitFor(() => frame(lastFrame).includes("← for agents"));
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
          const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
          onMessage(m); fake.pushEvent({ kind: "message", data: m });
          await new Promise<void>((res) => { release = res; });
          fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
          return { result: "done" };
        },
      },
    );
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    stdin.write("\x1b");                                            // Esc idle → arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    expect(anchorsFetched).toBe(0);

    stdin.write("\x1b");                                            // second Esc within the window → opens the picker
    await waitFor(() => anchorsFetched === 1);
    await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");

    stdin.write("\x1b");                                            // list-stage esc closes the picker (no selection made)
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

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
    // No persisted transcript behind this fake — skip the post-rewind flush-race poll (live-feedback fix).
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ rewindReplayRetry: { attempts: 1, delayMs: 0 } }} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    stdin.write("\x1b");                                            // arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");                                            // open the picker
    await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
    stdin.write("k");                                               // off the trailing `(current)` row onto the anchor
    await waitFor(() => frame(lastFrame).includes("❯"));
    stdin.write("\r");                                              // select the anchor → the confirmation panel
    await waitFor(() => frame(lastFrame).includes("Confirm you want to restore"));
    stdin.write("\r");                                              // accept the focused option (no code restore → conversation)
    await waitFor(() => frame(lastFrame).includes("fix the parser"));   // prefill landed in the composer

    stdin.write("\x15");                                            // Ctrl-U: clear the composer buffer
    await waitFor(() => !frame(lastFrame).includes("fix the parser"));

    stdin.write("?");                                               // empty composer → shortcuts overlay (composer unmounts)
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x1b");                                            // Escape closes it (KB6) → composer REMOUNTS
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await new Promise((r) => setTimeout(r, 80));
    expect(frame(lastFrame)).not.toContain("fix the parser");       // must not resurrect
  });

  it("a turn start revokes an idle Esc arm — the rewind hint never survives into a busy turn", async () => {
    let release = () => {};
    let fake: ReturnType<typeof fakeRewindRemote>;
    fake = fakeRewindRemote({}, {
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

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
    const fakeDeps = { getSessionMessages: async () => [] as any[], rewindReplayRetry: { attempts: 1, delayMs: 0 } };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    stdin.write("\x1b");                                              // Esc: arm
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");                                              // Esc: open the picker
    await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
    stdin.write("k");                                                 // off the trailing `(current)` row onto the anchor
    await waitFor(() => frame(lastFrame).includes("❯"));
    stdin.write("\r");                                                // select the anchor → the confirmation panel
    await waitFor(() => frame(lastFrame).includes("Confirm you want to restore"));
    stdin.write("\r");                                                // conversation-only → confirmRewind → rewind() hangs
    await waitFor(() => frame(lastFrame).includes("restoring"));

    stdin.write("\x12");                                              // Ctrl-R must open NEITHER search surface here
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).not.toContain("Search prompts");         // the /history picker
    expect(frame(lastFrame)).not.toContain("search prompts:");        // …nor the composer's inline search (F5 t12)
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("❯\u00a0");                     // composer is replaced by the overlay
    stdin.write("x");
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Keyboard shortcuts");        // a non-Escape key leaves it open
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("help opened DURING a busy turn still dismisses on Escape — the swallow must resolve to Help, not the live Task scope (t7 review)", async () => {
    let release = () => {};
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (_p, onMessage) => {
        fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
        const m = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "ok" }] } };
        onMessage(m); fake.pushEvent({ kind: "message", data: m });
        await new Promise<void>((res) => { release = res; });
        fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
        return { result: "done" };
      },
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x0f");                                              // Ctrl-O
    await new Promise((r) => setTimeout(r, 30)); await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Keyboard shortcuts");         // still open
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));              // back at the composer, not a leaked pager
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("help owns ordinary keys while upstream-precedence Ctrl-Z suspends before it, then the composer resumes normally", async () => {
    const modes: string[] = [];
    const suspend = vi.fn();
    const fake = fakeRemote({ setPermissionMode: (mode: string) => { modes.push(mode); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={suspend as any} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    expect(frame(lastFrame)).not.toContain("Transcript");

    // NOT "x": F5 task 8 made the empty composer show a random `Try "…"` suggestion, and two of the eight
    // templates ("fix lint errors", "fix typecheck errors") contain an `x` — so a `not-in-frame` check on a
    // single `x` failed roughly a quarter of the time once the kill emptied the buffer. Any token asserted
    // ABSENT from a frame that may be showing the placeholder has to be one the pool cannot produce.
    stdin.write("zzq");
    await waitFor(() => frame(lastFrame).includes("zzq"));
    stdin.write("\x15");
    await waitFor(() => !frame(lastFrame).includes("zzq"));
    stdin.write("\x1b[Z");
    await waitFor(() => modes.length === 1);
    expect(modes).toEqual(["acceptEdits"]);
  });

  it("Ctrl-Z has upstream process-level precedence over every ordinary visible overlay", async () => {
    const historyDeps = seededHistory();
    const cases: { name: string; session: () => ReturnType<typeof fakeRemote>; deps?: any; open: (stdin: any, lastFrame: () => string | undefined) => Promise<void> }[] = [
      {
        name: "Search prompts", session: () => fakeRemote(), deps: historyDeps,
        open: openHistoryPicker,
      },
      {
        name: "Settings", session: () => fakeRemote(),
        open: async (stdin, lastFrame) => { stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Settings")); },
      },
      {
        name: "Select model", session: () => fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) }),
        open: async (stdin, lastFrame) => { stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model")); },
      },
      {
        name: "Resume session", session: () => fakeRemote(), deps: { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "prior", summary: "saved", lastModified: 1 }] },
        open: async (stdin, lastFrame) => { stdin.write("/resume"); await waitFor(() => frame(lastFrame).includes("/resume")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Resume session")); },
      },
    ];
    for (const testCase of cases) {
      const suspend = vi.fn();
      const session = testCase.session();
      const view = render(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={process.cwd()} deps={testCase.deps} suspend={suspend as any} />);
      await waitFor(() => frame(view.lastFrame).includes("❯\u00a0"));
      await testCase.open(view.stdin, view.lastFrame);
      view.stdin.write("\x1a");
      await waitFor(() => suspend.mock.calls.length === 1);
      expect(frame(view.lastFrame)).toContain(testCase.name);
      view.unmount();
    }
  });

  it("a hidden pending decision never bypasses the visible overlay's key ownership", async () => {
    const historyDeps = seededHistory();
    const cases: { name: string; session: () => ReturnType<typeof fakeRemote>; deps?: any; open: (stdin: any, lastFrame: () => string | undefined) => Promise<void>; closesOnCtrlC?: boolean }[] = [
      { name: "Search prompts", session: () => fakeRemote(), deps: historyDeps, closesOnCtrlC: true, open: openHistoryPicker },
      { name: "Settings", session: () => fakeRemote(), open: async (stdin, lastFrame) => { stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Settings")); } },
      { name: "Select model", session: () => fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) }), open: async (stdin, lastFrame) => { stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model")); } },
      { name: "Resume session", session: () => fakeRemote(), deps: { hasWorktrees: async () => false, listSessions: async () => [{ sessionId: "prior", summary: "saved", lastModified: 1 }] }, open: async (stdin, lastFrame) => { stdin.write("/resume"); await waitFor(() => frame(lastFrame).includes("/resume")); stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Resume session")); } },
    ];
    for (const testCase of cases) {
      const fake = testCase.session();
      const view = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={testCase.deps} />);
      await waitFor(() => frame(view.lastFrame).includes("❯\u00a0"));
      await testCase.open(view.stdin, view.lastFrame);
      fake.parkPermission({ sessionId: "s", toolUseID: `hidden-${testCase.name}`, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
      view.stdin.write("\x03");                                // Ctrl-C belongs to the visible surface, never hidden pending
      await new Promise((r) => setTimeout(r, 20));
      if (testCase.closesOnCtrlC) {
        // HistorySearch REBINDS ctrl+c to `historySearch:cancel`, so the press closes the overlay on the spot
        // and never reaches an exit arm. That surface owns the key and keeps owning it.
        expect(frame(view.lastFrame)).not.toContain("Press Ctrl-C again to exit");
        await waitFor(() => frame(view.lastFrame).includes("Edit file"));
      } else {
        // WAVE 2 TASK 3 (EP-D2c; s2qa4-11) — these three overlays USED to unbind ctrl+c, and this line used to
        // read `not.toContain(...)`. The unbind is gone (CTRL-C-FALLS-THROUGH in bindings.ts), so the press now
        // falls through to Global's exit arm. That does not weaken what this case is for: the arm is the APP's,
        // the parked Edit is still parked and still invisible, the visible overlay still owns the screen, and it
        // still closes by its own Escape — which is the whole claim, now stated directly instead of by proxy.
        expect(frame(view.lastFrame)).toContain("Press Ctrl-C again to exit");
        expect(frame(view.lastFrame)).not.toContain("Edit file");
        expect(frame(view.lastFrame)).toContain(testCase.name);
        view.stdin.write("\x1b");                              // visible overlay closes by its own Escape handler
        await waitFor(() => frame(view.lastFrame).includes("Edit file"));
      }
      view.stdin.write("a");
      await waitFor(() => fake.answeredCalls.length === 1);
      view.unmount();
    }
  });

  // F6 T7 fix. The file dialog's in-directory test (`z7`) runs over the session's WHOLE working set, which
  // only `listDirs()` knows — so the list has to travel useChat → ChatApp → PermissionDialog → FilePermission.
  // The two halves of this test are the same park under two different directory lists, and the wording is
  // what tells them apart: an added directory turns "in <name>/" into the bare in-directory row.
  it("an /add-dir'd directory reaches the file dialog: a park under it reads as IN-directory", async () => {
    const outside = mkdtempSync(join(tmpdir(), "ccx-workdirs-"));
    const park = (fake: ReturnType<typeof fakeSettingsRemote>) =>
      fake.parkPermission({ sessionId: "s", toolUseID: "wd", toolName: "Edit", kind: "permission",
        input: { file_path: join(outside, "a.ts"), old_string: "a", new_string: "b" }, createdAt: Date.now() });
    try {
      // Without the grant: the cwd is the only working directory, so the row names the outside one.
      const plain0 = fakeSettingsRemote();
      const a = render(<ChatApp makeSession={() => plain0} client={{ kind: "loopback" }} cwd={process.cwd()} />);
      await waitFor(() => frame(a.lastFrame).includes("❯\u00a0"));
      park(plain0);
      await waitFor(() => frame(a.lastFrame).includes("Edit file"));
      expect(frame(a.lastFrame)).toContain(`allow all edits in ${basename(outside)}/ during this session`);
      a.unmount();

      // With it: listDirs reports the extra directory and the same park is in-directory.
      const granted = fakeSettingsRemote({ listDirs: async () => [{ path: process.cwd(), source: "cwd" as const }, { path: outside, source: "session" as const }] });
      const b = render(<ChatApp makeSession={() => granted} client={{ kind: "loopback" }} cwd={process.cwd()} />);
      await waitFor(() => frame(b.lastFrame).includes("❯\u00a0"));
      park(granted);
      await waitFor(() => frame(b.lastFrame).includes("Edit file"));
      await waitFor(() => frame(b.lastFrame).includes("Yes, allow all edits during this session"));
      expect(frame(b.lastFrame)).not.toContain(`edits in ${basename(outside)}/`);
      b.unmount();
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it("a pending dialog synchronously blocks the retiring composer listener", async () => {
    const modes: string[] = [];
    const fake = fakeRemote({ setPermissionMode: (mode: string) => { modes.push(mode); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    fake.parkPermission({ sessionId: "s", toolUseID: "guard", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    // shift+tab must not leak to the former composer. Since F6 T7 it is not merely SWALLOWED here — the file
    // dialog BINDS it (`confirm:cycleMode`) and takes its own accept-session row with it, which is a stronger
    // form of the same claim: the key reached the dialog and stopped there.
    stdin.write("\x1b[Z");
    await waitFor(() => fake.answeredCalls.length === 1);
    expect(fake.answeredCalls[0]!.decision).toMatchObject({ kind: "allow_with_updates" });
    expect(modes).toEqual([]);                                  // …and the composer's mode ladder never ran
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    fake.parkPermission({ sessionId: "s", toolUseID: "guard2", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    stdin.write("\x1b");                                        // dialog denies; it must not also arm rewind
    await waitFor(() => fake.answeredCalls.length === 2);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
  });

  it("? mid-buffer inserts a literal '?' instead of opening the overlay", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("hi?"));
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");
  });

  it("ctrl+u on ≥3 chars shows 'Ctrl+Y to paste deleted text' and it expires (CM11)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} yankHintMs={80} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("hello");
    await waitFor(() => frame(lastFrame).includes("hello"));
    stdin.write("\x15");                                   // Ctrl-U
    await waitFor(() => frame(lastFrame).includes("Ctrl+Y to paste deleted text"));
    expect(frame(lastFrame)).not.toContain("hello");       // the kill really emptied the buffer
    await waitFor(() => !frame(lastFrame).includes("Ctrl+Y to paste deleted text"));
    stdin.write("\x19");                                   // Ctrl-Y yanks it back
    await waitFor(() => frame(lastFrame).includes("hello"));
  });

  // F5 t12: this door is `/history`, not Ctrl-R — the chord is the composer's inline search now (see
  // test/tui/inline-history-search.test.tsx and historySearchInline.ts's routing header).
  it("/history opens the picker; Esc accepts the top entry into the composer", async () => {
    const fakeDeps = seededHistory();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await openHistoryPicker(stdin, lastFrame);
    // Filter first: submitting `/history` wrote its own line to the prompt log (every submit does), so the
    // newest entry is the command, not the seeded prompt.
    stdin.write("redo"); await waitFor(() => frame(lastFrame).includes("redo the build"));
    stdin.write("\x1b");                                   // Esc = accept
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(frame(lastFrame)).toContain("redo the build");   // prefilled into the composer buffer
  });

  // F5 final whole-branch review, P2. Enter in the picker submits the expanded text straight through
  // `submit()`, skipping the append every OTHER submit route makes — so re-running a year-old prompt left it
  // a year old in the log, and the next `/history` still ranked it last. The composer's own submit path
  // (`persistHistory`) is the behaviour this has to match.
  it("/history Enter EXECUTES the entry and records it in the prompt log, newest, with a fresh timestamp", async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-chat-hist-"));
    historyRoots.push(root);
    const env = { ...process.env, CCX_FLEET_ROOT: root };
    const long_ago = Date.now() - 3_600_000;
    appendHistory({ display: "redo the build", project: process.cwd(), timestamp: long_ago }, env);
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await openHistoryPicker(stdin, lastFrame);
    stdin.write("redo"); await waitFor(() => frame(lastFrame).includes("redo the build"));
    stdin.write("\r");                                     // historySearch:execute
    await waitFor(() => !frame(lastFrame).includes("Search prompts"));
    await waitFor(() => readHistory({ scope: "everywhere" }, env)[0]?.display === "redo the build");
    const rows = readHistory({ scope: "everywhere" }, env);
    const [newest] = rows;
    expect(newest.timestamp).toBeGreaterThan(long_ago);    // a NEW record, not the one the picker read
    // …attributed exactly like the typed submit that opened the picker: same project, same session.
    const typed = rows.find((r) => r.display === "/history")!;
    expect(newest.project).toBe(typed.project);
    expect(newest.sessionId).toBe(typed.sessionId);
  });

  it("…and promotes it to the top of the composer's own Up-arrow walk", async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-chat-hist-"));
    historyRoots.push(root);
    const env = { ...process.env, CCX_FLEET_ROOT: root };
    appendHistory({ display: "redo the build", project: process.cwd(), timestamp: Date.now() - 3_600_000 }, env);
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ env }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await openHistoryPicker(stdin, lastFrame);
    stdin.write("redo"); await waitFor(() => frame(lastFrame).includes("redo the build"));
    stdin.write("\r");
    await waitFor(() => !frame(lastFrame).includes("Search prompts"));
    // One Up must answer with the prompt that just RAN, not with the `/history` command that opened the
    // picker. Read the COMPOSER's own row (the last `❯` line in the frame) — the transcript above it echoes
    // both prompts, so a whole-frame `includes` would pass without the promotion.
    stdin.write("\x1b[A");
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("History 2/2"));   // a walk is live
    expect(composerLine(lastFrame)).toContain("redo the build");
    expect(composerLine(lastFrame)).not.toContain("/history");
  });

  it("a recalled prompt synchronously disarms rewind before its first composer frame", async () => {
    const fakeDeps = seededHistory();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x12");                                         // Ctrl-R opens the inline search, arm untouched
    await waitFor(() => frame(lastFrame).includes("search prompts:"));
    expect(frame(lastFrame)).toContain("Press Esc again to rewind");
    stdin.write("redo");                                         // …the MATCH is what fills the buffer
    // stripAnsiAll, not frame: the caret lands ON the match (offset 0 here), so the inverted first
    // character puts an SGR run between "r" and "edo the build" in the raw frame.
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("redo the build"));
    // The load-bearing bit: a match landing in an empty buffer reports a draft start, exactly as the
    // picker's prefill and the queue drain do, so the rewind arm cannot outlive the empty composer it
    // was armed on (F5 t12 — the inline search had to be taught this, it is not free).
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");
    stdin.write("\x1b");                                         // Esc ACCEPTS: the match stays, the search closes
    await waitFor(() => !frame(lastFrame).includes("search prompts:"));
    expect(stripAnsiAll(frame(lastFrame))).toContain("redo the build");

    stdin.write("\x1b");                                         // first Escape clears/arms locally; it cannot rewind
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
    expect(frame(lastFrame)).not.toContain("Restore the code and/or conversation");
  });

  it("app-level keys are gated while the history overlay is open (its Ctrl-C is cancel, not exit-arm)", async () => {
    const fakeDeps = seededHistory();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await openHistoryPicker(stdin, lastFrame);             // /history opens the picker (F5 t12: ctrl+r is inline)
    stdin.write("\x03");                                   // Ctrl-C → overlay cancels; app exit-arm must NOT fire
    await waitFor(() => !frame(lastFrame).includes("Search prompts"));
    expect(frame(lastFrame)).not.toContain("Press Ctrl-C again to exit");
    expect(frame(lastFrame)).not.toContain("Search prompts");   // overlay closed by its own cancel
  });

  it("Ctrl-O opens the transcript pager, gates the app keys, and Ctrl-O again closes it", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    // Seed a task so the panel actually renders something — with an empty task list TaskPanel renders
    // null regardless of todosOpen, which would make the Ctrl-T-while-open check below pass vacuously
    // even if the gate leaked (the "still contains Transcript" check alone can't tell the difference).
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => TODO_ROW.test(frame(lastFrame)));
    stdin.write("\x0f");                                              // Ctrl-O opens
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    // Live-feedback fix (2026-08-06): the task panel HIDES while the pager is up. The original pin here
    // ("still visible under the pager") predated the height physics — pager (rows-6) + any sibling chrome
    // overflows the terminal and Ink floods scrollback with frame copies on every tick. Upstream never
    // co-renders them either: ctrl+o swaps the whole screen ("prompt" ⇄ "transcript", rUb L499000) and the
    // todo panel is prompt-screen chrome.
    expect(frame(lastFrame)).not.toMatch(TODO_ROW);
    stdin.write("\x14");                                              // Ctrl-T must NOT toggle todos while pager open
    await new Promise((r) => setTimeout(r, 30));
    expect(frame(lastFrame)).toContain("Transcript");                 // still the pager, no crash
    stdin.write("\x0f");                                              // Ctrl-O closes
    // Only the pager header prints the word "Transcript" — its absence proves the pager actually
    // unmounted (an "of 0" assertion would be vacuous: an empty pager renders "(empty)").
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
    // The panel RETURNS after close, still open — which is also the proof the gated Ctrl-T above never
    // reached setTodosOpen (a leaked toggle would have flipped todosOpen off behind the pager and the
    // panel would be gone right here).
    expect(frame(lastFrame)).toMatch(TODO_ROW);
    stdin.write("\x14");                                              // now (pager closed) Ctrl-T DOES toggle — proves the gate isn't a permanent lock
    await waitFor(() => !TODO_ROW.test(frame(lastFrame)));
  });

  // F2 task 7: the owner gate used to kill every key inside the pager except ChatApp's own Ctrl-O close arm.
  // With the pager on the scope stack, `Transcript` has to say so declaratively — hence the two null bindings.
  // Without them Global would newly fire history-search and the todo panel from inside the pager.
  it("Ctrl-R inside the transcript pager opens nothing (the Transcript null binding, not the old owner gate)", async () => {
    const fakeDeps = seededHistory();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    expect(frame(lastFrame)).not.toContain("search prompts:");        // …the inline surface leaked no more than the picker did
    expect(frame(lastFrame)).toContain("❯\u00a0");                          // the composer, not a history overlay
    stdin.write("\x12");                                              // …and Ctrl-R works again once the pager is gone
    await waitFor(() => frame(lastFrame).includes("search prompts:"));   // F5 t12: the INLINE search is what it opens now
  });

  // Live-feedback fix (2026-08-06): while the pager is up, every OTHER transient region hides — spinner,
  // task panel, queue echo, pending/streaming rows. The pager box alone is `rows - 6` lines; any sibling
  // chrome pushes the dynamic frame past the terminal height, and Ink cannot erase lines that scrolled off
  // the top — every spinner animation tick then deposits another frame copy into scrollback (the reported
  // real-TTY break). Upstream never co-renders them: ctrl+o swaps the whole screen ("prompt" ⇄ "transcript",
  // rUb bundle L499000), and spinner/todos/prompt are all prompt-screen chrome. The turn itself is not
  // hidden from the user: the pager's detail projection draws the same retained document, open calls
  // included, anchored to the bottom.
  it("the pager hides the spinner and queue echo while open, and restores them on close (frame-height law)", async () => {
    const fake = fakeRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });                    // live turn → spinner
    // Task 6 review, MEDIUM-3: this test used to watch `esc to interrupt`, which since Task 6 is FOOTER copy
    // and stays on screen for every busy frame — so the "spinner hidden" assertion below passed whether the
    // spinner was mounted over the pager or not (proved by sabotage). `spinnerUp` is the glyph-and-gerund
    // needle, which only a mounted TurnSpinner can print.
    await waitFor(() => spinnerUp(frame(lastFrame)));
    stdin.write("queued while busy");                                            // typed mid-turn…
    await waitFor(() => plain(frame(lastFrame)).includes("queued while busy"));
    stdin.write("\r");                                                            // …and submitted busy → the queue echo row
    await waitFor(() => plain(frame(lastFrame)).includes("Esc clear") === false && plain(frame(lastFrame)).includes("queued while busy"));
    stdin.write("\x0f");                                                          // Ctrl-O opens the pager
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    // The two load-bearing absences. "queued while busy" covers the queue echo AND any composer remnant at
    // once — whichever surface held the text, neither may add rows beside the pager.
    expect(spinnerUp(frame(lastFrame))).toBe(false);                              // spinner hidden (turn still live)
    expect(plain(frame(lastFrame))).not.toContain("queued while busy");           // queue echo hidden
    stdin.write("\x0f");                                                          // Ctrl-O closes
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
    await waitFor(() => spinnerUp(frame(lastFrame)));                             // spinner restored — turn never stopped
    expect(plain(frame(lastFrame))).toContain("queued while busy");               // queue echo restored
  });

  // W3 T3: /add-dir
  it("/add-dir with no arg opens the entry phase; Esc with no path cancels with the no-path message", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    const fakeDeps = { getSessionMessages: async () => [] as any[], rewindReplayRetry: { attempts: 1, delayMs: 0 } };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

    // Start /add-dir — it suspends on listDirs() (composer stays mounted: local commands don't set busy).
    stdin.write(`/add-dir ${target}`); await waitFor(() => frame(lastFrame).includes(target));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await new Promise((r) => setTimeout(r, 30));

    // While it's suspended, arm + open + confirm a rewind (mirrors the Wave-2 F3 test's exact key sequence).
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Press Esc again to rewind"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Restore the code and/or conversation"));
    stdin.write("k");
    await waitFor(() => frame(lastFrame).includes("❯"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Confirm you want to restore"));
    stdin.write("\r");
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
  //
  // WAVE S t5 — EVERY `❯ <row>` WAIT BELOW STRIPS ANSI FIRST, and the change is not cosmetic. The Config list
  // is a `Select` now, so the pointer is the list's own GUTTER (`<Text color=…>❯</Text>`, Select.tsx:282) and
  // the label is a separate span: the raw frame reads `❯\x1b[39m Thinking mode`, with a colour reset between
  // the two characters this file used to match as one literal. A raw `includes("❯ Model")` therefore goes
  // false forever — including the NEGATIVE one in keys-migration-dialogs.test.tsx, which would have gone
  // vacuously green instead of red. The rendered TEXT is unchanged, which is what these tests are about.
  it("/config opens the Settings dialog at the Config tab, showing all 6 rows and the normal-mode footer", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    expect(f).toContain("Show turn duration");                           // W-C T7's row
    expect(f).toContain("Enter/Space to change · / to search · Esc to close");
  });

  it("Config: toggling the Thinking-mode row shows the warning and Esc summarizes 'Set Thinking mode to false' (sabotage-checked — see task report)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Thinking mode"));
    // Row order is theme, model, outputStyle, permissionMode, thinking — 4 downs from the theme (default) row.
    for (let i = 0; i < 4; i++) stdin.write("\x1b[B");
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Thinking mode"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Settings"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Config dialog dismissed"));
  });

  it("Config: / enters search and filters the row list to the query (case-insensitive label match)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // confirms we're on Config first
    stdin.write("\x1b[Z");                                          // shift+Tab: Status·Config·Usage·Stats, Config(1) → Status(0)
    await waitFor(() => frame(lastFrame).includes("sess-1"));       // formatStatus's session-id row — unique to the Status tab
    const f = frame(lastFrame);
    expect(f).not.toContain("Default permission mode");             // Config's rows are gone
    expect(f).toContain("Tab/←/→ to switch tabs · Esc to close");
  });

  // F6 T11 (DG46), end to end through the app rather than the component: the two ways out of the picker
  // print DIFFERENT sentences (bundle L471427), only one of them writes a default, and the session-only one
  // leaves a mark the picker shows the NEXT time it opens (`sessionModel`, L441107).
  it("/model: `s` applies for this session only — no prefs write, and the picker says so when it reopens", async () => {
    const saved: unknown[] = [];
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { saved.push(patch); } }} />,   // never the real ~/.claude/ccx/prefs.json
    );
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
    stdin.write("s");
    await waitFor(() => oneLine(frame(lastFrame)).includes("Set model to Opus for this session only"));
    expect(saved).toEqual([]);                                       // `s` writes NO default
    stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
    expect(oneLine(frame(lastFrame))).toContain("Currently using Opus for this session only. Selecting a model will undo this.");
  });

  it("/model: Enter applies AND saves the default, says the other sentence, and clears the session-only mark", async () => {
    const saved: unknown[] = [];
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ savePrefs: (patch: unknown) => { saved.push(patch); } }} />,
    );
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
    stdin.write("s");                                                // a session-only pick FIRST…
    await waitFor(() => oneLine(frame(lastFrame)).includes("for this session only"));
    stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
    stdin.write("\r");                                               // …then the default one over it
    await waitFor(() => oneLine(frame(lastFrame)).includes("Set model to Opus and saved as your default for new sessions"));
    expect(saved).toEqual([{ model: "opus" }]);                      // the catalog value, through the injected seam
    stdin.write("/model"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Select model"));
    expect(oneLine(frame(lastFrame))).not.toContain("for this session only. Selecting");
  });

  // W3.5 fix pass — finding 1 regression guard: the Model row reuses the SAME top-level ModelPicker the
  // standalone /model command does (ChatApp's overlay-chain comment), so pickModel's own immediate
  // "model → X" notice used to fire whichever way the picker was reached — reported once live in the
  // transcript AND again by the close-time summary when reached via Settings. Only the summary should say
  // it in that case; this test failed red against the unfixed pickModel (see the task report).
  it("Config: the Model row round trip through the shared ModelPicker reports the change exactly once, and Settings reappears afterward", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");                                              // a combined "text\r" chunk reads as a PASTE (embedded \n), not Enter — write separately
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B");                                          // Theme(0) → Model(1)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Model"));
    stdin.write("\r");                                              // Enter on the Model row → onOpenModelPicker → the SHARED top-level ModelPicker
    await waitFor(() => frame(lastFrame).includes("Select model"));
    stdin.write("\r");                                              // pick the only model — resolveModelAlias("opus") → "claude-opus-5"
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // Settings dialog reliably reappears (remounted fresh on Config)
    stdin.write("\x1b");                                            // close Settings — the diff-based close summary is the ONE place this should report
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Model to"));
    const flat = frame(lastFrame).replace(/\n/g, " ");
    // Match on the SENTENCE forms, not a raw "claude-opus-5" substring count: the status bar ALSO shows the
    // live model id ("model claude-opus-5") permanently — that's an unrelated, always-on UI element, not a
    // notice, and would otherwise make this assertion count a legitimate second occurrence.
    expect(flat).not.toMatch(/Set model to/);                        // no immediate notice from pickModel while reached via Settings (lowercase "model" — the summary below says "Model")
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B");                                          // Theme(0) → Model(1)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Model"));
    stdin.write("\r");                                              // Enter on Model → onOpenModelPicker
    await waitFor(() => frame(lastFrame).includes("Select model"));
    stdin.write("\r");                                              // pick the only model — session.setModel(...) is now blocked on `gate`
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // back on the Config row list
    expect(frame(lastFrame).replace(/\n/g, " ")).toContain("Model  claude-opus-5");   // the row already reflects the pick — committed before the await, not after
    stdin.write("\x1b");                                            // close Settings WHILE session.setModel(...) is still unresolved
    await waitFor(() => frame(lastFrame).replace(/\n/g, " ").includes("Set Model to"));
    const flat = frame(lastFrame).replace(/\n/g, " ");
    expect(flat).not.toMatch(/Set model to/);                        // still no duplicate immediate notice on the Settings path
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B");                    // Theme(0) → Model(1) → Output style(2)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Output style"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B");   // Theme(0)→Model(1)→Output style(2)→Default permission mode(3)→Thinking mode(4)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Thinking mode"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config"); await waitFor(() => frame(lastFrame).includes("/config"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));
    stdin.write("\x1b[B"); stdin.write("\x1b[B");                    // Theme(0) → Model(1) → Output style(2)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Output style"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config bogus=1");
    await waitFor(() => frame(lastFrame).includes("/config bogus=1"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("isn't a /config setting"));
    expect(frame(lastFrame)).toContain(`bogus isn't a /config setting. Run /config to see what's available.`);
    expect(frame(lastFrame)).not.toContain("Enter/Space to change · / to search · Esc to close");   // the Config-tab footer never rendered — no dialog opened
  });

  it("Config: '/config thinking=maybe' prints the boolean-domain error", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config thinking=maybe");
    await waitFor(() => frame(lastFrame).includes("/config thinking=maybe"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes(`thinking takes true or false, not "maybe".`));
  });

  it("Config: '/config permissionMode=weird' prints the enum-domain error", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config permissionMode=weird");
    await waitFor(() => frame(lastFrame).includes("/config permissionMode=weird"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("permissionMode takes one of: default, acceptEdits, plan, auto."));
  });

  // Brief requirement: drive "already off" through TWO REAL invocations, not an isolated string assertion —
  // the first call must actually turn thinking off before the second call can correctly find it already off.
  it("Config: '/config thinking=false' twice — the first turns it off, the second reports it's already off", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/config theme=dark");
    await waitFor(() => frame(lastFrame).includes("/config theme=dark"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Set theme to dark"));
    expect(currentTheme()).toBe("dark");   // the engine-level effect, not just the printed line
    expect(calls).toEqual([{ theme: "dark" }]);   // persisted through the injected seam, exactly once — never the real file
  });

  it("/settings aliases /config — opens the same Settings dialog at the Config tab", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/settings"); await waitFor(() => frame(lastFrame).includes("/settings"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Settings"));
    const f = frame(lastFrame);
    expect(f).toContain("Default permission mode");                             // Config tab's rows, same as /config
    expect(f).toContain("Enter/Space to change · / to search · Esc to close");
  });

  it("/output-style prints the redirect line then opens Settings at the Config tab (not the picker directly)", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/output-style"); await waitFor(() => frame(lastFrame).includes("/output-style"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Default permission mode"));   // Settings opened, Config tab — not OutputStylePicker's own "Preferred output style" title
    expect(frame(lastFrame)).not.toContain("Preferred output style");
    // FSW TASK 3 re-pinned this to "readable after Esc" and the FIX ROUND (review I2) puts it back. T3's
    // premise was that a pane-owning dialog BLANKS the live window, so a notice printed in the very commit
    // that opens Settings was not painted underneath it. A pane-owning surface now commits that window
    // instead, which puts the row in <Static> — above the dialog, readable while it is up, which is where
    // this line was before the task. Asserted in both places: with Settings open, and still there on the
    // way back out (the commit is a publish, so closing the dialog cannot print it a second time).
    await waitFor(() => frame(lastFrame).includes("/output-style moved → Output style in /config"));
    expect(frame(lastFrame)).toContain("Default permission mode");                // …and the dialog is still up
    stdin.write("\x1b");
    await waitFor(() => !frame(lastFrame).includes("Default permission mode"));
    expect(frame(lastFrame).match(/\/output-style moved → Output style in \/config/g)).toHaveLength(1);
  });

  // F2 task 9: /keybindings is upstream's own file-opener now — the keymap IS customizable (the file merges
  // over the defaults and hot-reloads), so the W3 "not supported yet" honesty line is retired. Both tests
  // drive the editor through the injected seam, never $EDITOR: the machine running them has its own.
  // Ink word-wraps a long dim <Text> and re-opens the dim SGR codes around EACH physical line, so every
  // assertion below reads the frame with escapes stripped and whitespace runs collapsed.
  const flat = (lastFrame: () => string | undefined) => frame(lastFrame).replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+/g, " ");
  it("/keybindings opens ~/.claude/keybindings.json in $VISUAL/$EDITOR, seeding the starter file first", async () => {
    const home = tmpHome();
    const written: [string, string][] = [];
    const openEditor = vi.fn((_file: string, prepare: () => void) => { prepare(); return "opened" as const });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor, readFile: () => null, writeFile: (p, t) => { written.push([p, t]); } }} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => flat(lastFrame).includes("saved changes apply live"));
    expect(openEditor.mock.calls[0][0]).toBe(join(home, ".claude", "keybindings.json"));
    expect(written).toHaveLength(1);                                        // seeded once, by `prepare`, before the spawn
    expect(written[0][0]).toBe(join(home, ".claude", "keybindings.json"));
    expect(JSON.parse(written[0][1])).toMatchObject({ bindings: [] });      // the documented starter, valid JSON
    expect(frame(lastFrame)).not.toContain("Keyboard shortcuts");           // the read-only overlay is the FALLBACK, not the result
  });

  // The fresh-machine path, and the one case the recorder-fake above cannot catch: `~/.claude` does not exist
  // yet (the session connects lazily, so a first-launch `/keybindings` can beat everything that would create
  // it). readFile/writeFile are the REAL ones here on purpose — without a mkdir the seed write throws ENOENT
  // into the dispatcher's catch and the transcript shows a raw errno instead of an editor. `home` is a
  // mkdtemp dir, so every real fs call this test makes stays inside it.
  it("/keybindings creates ~/.claude before seeding, on a home that has no .claude yet", async () => {
    const home = tmpHome();
    const openEditor = vi.fn((_file: string, prepare: () => void) => { prepare(); return "opened" as const });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor }} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    expect(existsSync(join(home, ".claude"))).toBe(false);                  // the precondition the bug needs
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => flat(lastFrame).includes("saved changes apply live"));
    expect(flat(lastFrame)).not.toContain("ENOENT");
    const file = join(home, ".claude", "keybindings.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ bindings: [] });
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
    const home = tmpHome();
    const written: string[] = [];
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor: () => "no-editor", readFile: () => null, writeFile: (p) => { written.push(p); } }} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));   // ShortcutsOverlay is up
    expect(flat(lastFrame)).toContain("set $VISUAL or $EDITOR");
    expect(written).toEqual([]);                                            // nothing was created for an editor that never runs
  });

  it("help owns immediate keys before its passive handler mounts, and Escape closes without opening pager", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(view.lastFrame).includes("❯\u00a0"));
    view.rerender(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} suspend={() => { currentCalls++; }} />);
    view.stdin.write("\x1a");
    await waitFor(() => currentCalls === 1);
    expect(oldCalls).toBe(0);
  });

  // ---- W3 T7: /permissions — five-tab dialog ----

  it("/permissions opens with all 5 tabs, defaulting to Allow (with its intro + 'Add a new rule…') when there are no recent denials", async () => {
    const fake = fakeSettingsRemote();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.parkPermission({ sessionId: "s", toolUseID: "t1", toolName: "Bash", kind: "permission", input: { command: "rm -rf /" }, createdAt: Date.now() });
    // F6 T6: a Bash consult renders the `BashPermission` body, whose title is the dialog's own marker here.
    await waitFor(() => frame(lastFrame).includes("Bash command"));
    fake.settlePermission("t1", "auto", "deny");                    // the auto-mode classifier denying it — dropPending records the ledger entry
    await waitFor(() => !frame(lastFrame).includes("Bash command"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Read"));           // the fetched read-only row rendered
    stdin.write("\x1b[B");                                            // ↓ from "Add a new rule…" (idx 0) to the "Read" row (idx 1)
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Read"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    // stripAnsiAll, not the raw frame: WAVE S t6b mounted a `Select` under this list, and its pointer is the
    // list's own coloured gutter span — an SGR reset lands between `❯ ` and the label. As a `waitFor` PREDICATE
    // a raw match here fails as a bare timeout with no diff, which reads like a hang rather than a mismatch.
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ Add a new rule…"));   // back on the row list, cursor still on the top row
    // Refetched settings now report the rule as flagSettings-sourced (readOnly:false) — move down from
    // "Add a new rule…" (idx 0) onto it and confirm it opens the DELETE sub-view, not Rule details.
    stdin.write("\x1b[B");
    await waitFor(() => stripAnsiAll(frame(lastFrame)).includes("❯ WebFetch"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/permissions"); await waitFor(() => frame(lastFrame).includes("/permissions"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("Permissions"));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Claude Code will always reject requests to use denied tools."));
    stdin.write("\x1b[C"); await waitFor(() => frame(lastFrame).includes("Add directory…"));
    stdin.write("\x1b[B"); await waitFor(() => stripAnsiAll(frame(lastFrame)).replace(/\n/g, " ").includes(`❯ ${process.cwd()}`));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => stripAnsiAll(frame(lastFrame)).replace(/\n/g, " ").includes(`❯ ${sessionDir}`));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
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
    const deps = seededHistory();
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    for (const text of ["queued one", "queued two"]) {
      stdin.write(text); await waitFor(() => frame(lastFrame).includes(text));
      stdin.write("\r"); await waitFor(() => isQueued(lastFrame, text));
    }
    stdin.write("\x1b");
    await waitFor(() => interrupted === 1 && frame(lastFrame).includes("queued one") && frame(lastFrame).includes("queued two"));

    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await new Promise((r) => setTimeout(r, 20));
    // F5 t12: ctrl+r is the inline search. Opening it PARKS the rescued draft and Escape ACCEPTS with an
    // empty query, which must hand exactly that draft back — one more remount the text has to survive.
    stdin.write("\x12"); await waitFor(() => frame(lastFrame).includes("search prompts:"));
    stdin.write("\x1b"); await waitFor(() => !frame(lastFrame).includes("search prompts:"));
    await new Promise((r) => setTimeout(r, 20));

    fake.parkPermission({ sessionId: "s", toolUseID: "rescue", toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
    await waitFor(() => frame(lastFrame).includes("Edit file"));
    stdin.write("\x1b"); await waitFor(() => fake.answeredCalls.length === 1);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(" edited"); await waitFor(() => frame(lastFrame).includes("queued two edited"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("? for shortcuts"));

    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f"); await waitFor(() => frame(lastFrame).includes("? for shortcuts"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    for (const q of ["first queued", "second queued", "third queued"]) {
      stdin.write(q); await waitFor(() => frame(lastFrame).includes(q));
      stdin.write("\r");
      await waitFor(() => isQueued(lastFrame, q));
    }
    stdin.write("\x1b");                                              // Esc: interrupt + rescue
    await waitFor(() => interrupted === 1);
    await waitFor(() => !isQueued(lastFrame, "first queued"));
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("start"); await waitFor(() => frame(lastFrame).includes("start"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    stdin.write("queued-one"); await waitFor(() => frame(lastFrame).includes("queued-one"));
    stdin.write("\r"); await waitFor(() => isQueued(lastFrame, "queued-one"));
    stdin.write("/"); await waitFor(() => frame(lastFrame).includes("/"));
    stdin.write("mod"); await waitFor(() => frame(lastFrame).includes("/model"));
    stdin.write("\x03");
    await waitFor(() => interrupted === 1 && !isQueued(lastFrame, "queued-one"));
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
  const CLOSING_PROSE = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-closes-run", content: [{ type: "text", text: "all done" }] } };
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
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "idle-tail", content: [{ type: "text", text: "retained idle tail" }] } } });
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
      { kind: "sdk" as const, source: "disk" as const, message: { type: "assistant", parent_tool_use_id: null, message: { id: "a-last", content: [{ type: "text", text: "LAST-DISK-ROW" }] } } },
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    // F6 T14: `/help` opens a DIALOG now (it printed a command list before), which would take the composer
    // away before `/clear` could be typed. `/think` is the stand-in this test wanted all along: a local
    // command that appends a line and touches no session.
    stdin.write("/think"); await waitFor(() => frame(lastFrame).includes("/think"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("thinking:"));
    stdin.write("/clear"); await waitFor(() => frame(lastFrame).includes("/clear"));
    stdin.write("\r"); await waitFor(() => clears.length === 1);
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "post-clear", content: [{ type: "text", text: "POST-CLEAR-ROW" }] } } });
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
  const LONG_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-long", content: [{ type: "tool_use", id: "long-1", name: "Bash", input: { command: "echo hi" } }] } };
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
    // FSW TASK 3 moved this to ZERO and the FIX ROUND (review I2) moved it back to ONE, which is where it
    // started. T3 blanked the live window while a pane-owning surface was up, so the still-uncommitted
    // compact row was simply gone for the life of the pager; a pane-owning surface now COMMITS that window
    // instead, so the row is in <Static> — one copy, above the pager, exactly as before the task. The claim
    // is the one it always was, and reading it as `1` rather than `0` keeps it a claim about the PAGER: two
    // would mean the pager is rendering the compact form as well.
    expect(plain(frame(app.lastFrame)).match(OVERFLOW) ?? []).toHaveLength(1);                  // the pager is NOT compact
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
    // NEVER TWICE — the half of this case that is about republication, and the half that still binds. A
    // re-projection that appended the row a second time, or a <Static> replacement that re-emitted the whole
    // transcript, both show up here as a frame carrying it twice.
    // …AND EXACTLY ONCE, which is the half T3 dropped and the fix round (review I3) puts back. T3 weakened
    // this to "≤ 2 per frame", on the premise that a pane-owning surface blanks the live window and the row
    // legitimately vanishes while the pager is up; that premise was true then and is no longer — a
    // pane-owning surface COMMITS the window now (review I2), so the row is in <Static> for the whole
    // sequence. The weakened form also let a TRANSIENT wipe mid-pager pass, which is exactly the accidental
    // `<Static>` replacement the original assertion existed to catch.
    // The one concession the new mechanics do require: the commit runs in a passive effect, so the single
    // frame between "the pager took the pane" and "the window was published" can carry the row zero times.
    // Frames where the pager owns the pane are therefore `≤ 1`; every other frame is exactly 1.
    const pagerOwned = (f: string) => plain(f).includes("line 40") || plain(f).includes("lines 1–");
    for (const f of after) {
      const copies = plain(f).split(compactRow!).length - 1;
      expect(copies).toBeLessThanOrEqual(1);
      if (!pagerOwned(f)) expect(copies).toBe(1);
    }
    expect(plain(frame(app.lastFrame)).split(compactRow!)).toHaveLength(2);
  });
});

// WAVE S T4, FINAL ROUND — `ChatApp`'s `paneOwned` gate, one pin per member. The pager half of it has been
// pinned since the 2026-08-06 ctrl+o flood ("the task panel HIDES while the pager is up", above); the finding
// that closed t4 was that FIVE MORE surfaces size themselves from the terminal height the same way, and that
// the task panel — which `initialTodosOpen` puts on screen for every session that has tasks — was still
// mounted beside all five. Measured before the gate, on the real `ChatApp` at 21x100 with the rewind picker
// mid-list: 20 frame rows with no tasks, 25 with three, against a pane of 21, and Ink's `ink.js:121` branch
// (`outputHeight >= stdout.rows` → `clearTerminal + fullStaticOutput + output`) turns that into a full-screen
// wipe and a scrollback re-dump on EVERY cursor move.
//
// The rewind member is pinned by frame HEIGHT, in rewind-picker.test.tsx's matrix. This block pins the other
// four by the panel itself, because a height assertion needs a budget to measure against and these four have
// none in our code: each was sabotage-checked by deleting its own term from the disjunction and confirming
// that this test — and only this test — went red.
//
// EACH TITLE NAMES WHAT ITS ASSERTION CHECKS, WHICH IS THE GATE — not the windowing mechanism that puts the
// dialog in the class (review fix round). Three of them used to name the mechanism, and their fixtures do not
// exercise it: two description-less models, one saved session and a two-line plan each leave the dialog at its
// FIXED MINIMUM height, so nothing here measures `clampVisible`, `resumeVisibleRows` or `planRegionRows` at
// all. The fixtures are right as they are — the gate is a mount/unmount question and a minimal one answers it
// fastest — so the titles moved instead. The mechanisms are pinned where they can be: resize-dialogs.test.tsx
// windows each dialog from the height it is given, and the derivations live in ChatApp's own gate comment.
//   THAT SENTENCE WAS WRITTEN WHEN THIS BLOCK HELD FOUR CASES AND WENT STALE AS IT GREW TO SIX (t6b review
// round). `resize-dialogs.test.tsx` covered `ModelPicker`, `SessionPicker`, `RewindPicker` and `PlanDialog` —
// NOT `SettingsDialog` (t5) and not `PermissionsDialog` (t6b), the two newest members of this class, whose
// live-resize path was therefore unpinned. Closed rather than qualified: that file now carries one `rerender`
// case per missing dialog, in the same shape as `ModelPicker`'s own.
//
// AND THE LAST CASE PINS THE OTHER DIRECTION. Every mutation above REMOVES a term; adding one — someone gating
// `/theme` in a later round — would hide the task panel behind a dialog whose height is a function of its
// CONTENT, which is the half of the partition this gate deliberately excludes, and no test above would notice.
// The `/theme` case is that pin.
//
// WAVE S t5 ADDED A SEVENTH MEMBER, `/config`. Seventh of the CLASS — the list ChatApp's gate comment counts,
// which is the count to quote; it is only the SIXTH disjunct in `paneOwned`'s source order and the FIFTH case
// in this block, and those two numbers are why this one is stated with its noun attached. It is also the
// reason the negative pin above is not paranoia: the dialog that case names as a hypothetical over-fire
// ("`/theme` or `/settings`", as this comment read before) legitimately crossed the partition one wave later,
// because t5 windowed its Config list. Membership is decided by whether the surface's height DERIVES from
// `rows`, not by which list a name has always been on.
describe("<ChatApp> — the paneOwned gate hides the task panel behind every pane-sizing dialog", () => {
  const TODO = /◻\s+todo-item-one/;
  /** The todo panel's own wire pair (taskList.ts), wrapped in a turn so `state.busy` lands back at false. */
  const seedTodo = (fake: ReturnType<typeof fakeRemote>) => {
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
  };
  const MODELS = [{ value: "opus", displayName: "Opus 5" }, { value: "sonnet", displayName: "Sonnet 4.7" }];
  const SESSIONS = [{ sessionId: "s0", summary: "a saved session", lastModified: 1 }];

  /** Open, assert the panel is GONE, close, assert it is BACK. The close half is what makes the first half
   *  mean something: a panel missing for an unrelated reason would never come back. */
  const gateCycle = async (
    name: string,
    opts: FakeRemoteOpts,
    deps: Record<string, unknown>,
    open: (r: { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined }, fake: ReturnType<typeof fakeRemote>) => Promise<void>,
    close: (r: { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined }, fake: ReturnType<typeof fakeRemote>) => Promise<void>,
    /** WAVE S t6b — `/permissions` refuses to open at all on a session without the SettingsOps surface
     *  (useChat.ts:961 notices "permissions unsupported" and breaks), so that member needs a
     *  `fakeSettingsRemote`. Every other member is happy with the plain fake this defaults to. */
    make: (o: FakeRemoteOpts) => ReturnType<typeof fakeRemote> = fakeRemote,
  ) => {
    const fake = make(opts);
    const r = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/tmp" deps={deps as never} />);
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    seedTodo(fake);
    await waitFor(() => TODO.test(frame(r.lastFrame)));
    await open(r, fake);
    expect(frame(r.lastFrame), `${name}: the task panel is still mounted beside a pane-sizing dialog`).not.toMatch(TODO);
    await close(r, fake);
    await waitFor(() => TODO.test(frame(r.lastFrame)));
    r.unmount();
  };

  it("/model — the task panel unmounts while the model picker is up and comes back when it closes", async () => {
    await gateCycle("/model", { capabilities: () => ({ models: MODELS, commands: [], mcpServers: [] }) }, {},
      async (r) => { r.stdin.write("/model"); await waitFor(() => frame(r.lastFrame).includes("/model")); r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Select model")); },
      async (r) => { r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("Select model")); });
  });

  it("/resume — the task panel unmounts while the session picker is up and comes back when it closes", async () => {
    await gateCycle("/resume", {}, { hasWorktrees: async () => false, listSessions: async () => SESSIONS, getSessionMessages: async () => [] },
      async (r) => { r.stdin.write("/resume"); await waitFor(() => frame(r.lastFrame).includes("/resume")); r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Resume session")); },
      async (r) => { r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("Resume session")); });
  });

  it("/help — HelpDialog windows its command browser through browserVisibleRows(rows)", async () => {
    await gateCycle("/help", {}, {},
      async (r) => { r.stdin.write("/help"); await waitFor(() => frame(r.lastFrame).includes("/help")); r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("For more help:")); },
      async (r) => { r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("For more help:")); });
  });

  it("exit-plan-mode — the task panel unmounts while the plan dialog is up and comes back when it settles", async () => {
    const entry: PendingEntry = { sessionId: "s", toolUseID: "p1", toolName: "ExitPlanMode", kind: "plan", input: { plan: "step one\n\nstep two" }, createdAt: Date.now() } as PendingEntry;
    await gateCycle("plan", {}, {},
      async (r, fake) => { fake.parkPermission(entry); await waitFor(() => frame(r.lastFrame).includes("Ready to code?")); },
      async (r, fake) => { fake.settlePermission("p1", "someone-else", "deny"); await waitFor(() => !frame(r.lastFrame).includes("Ready to code?")); });
  });

  /** WAVE S t5 ADDED THIS MEMBER. `/config`'s Config list is windowed now (`settingsVisibleRows`), so the
   *  dialog's height DERIVES from `rows` and it moved out of the excluded half of ChatApp's partition into
   *  this one. That derivation is the whole criterion — not how much the frame happens to vary over some
   *  sweep, and not whether it composes over the pane beside a neighbour, which would make membership depend
   *  on the neighbour's height and on how many tasks a fixture seeds. ChatApp's gate comment carries the
   *  argument in full, including why the list's saturation at five rows does not evict it.
   *
   *  SABOTAGE-CHECKED like every other member, by writing this case with `|| state.settings.open` absent from
   *  the disjunction: it fails on the open half ("the task panel is still mounted beside a pane-sizing
   *  dialog") and every other case in the file stays green. */
  it("/config — the task panel unmounts while the Settings dialog is up and comes back when it closes", async () => {
    await gateCycle("/config", {}, {},
      async (r) => { r.stdin.write("/config"); await waitFor(() => frame(r.lastFrame).includes("/config")); r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Enter/Space to change")); },
      async (r) => { r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("Enter/Space to change")); });
  });

  /** WAVE S t6b ADDED THIS MEMBER — the EIGHTH of the class ChatApp's gate comment counts, the SEVENTH
   *  disjunct in `paneOwned`'s source order and the SIXTH case in this block. `/permissions`' rule and
   *  workspace lists are windowed now (`permissionsVisibleRows`), so the dialog's height DERIVES from `rows`
   *  and it moved out of the excluded half of ChatApp's partition into this one — the same crossing `/config`
   *  made one task earlier, and for the same reason. The derivation is the criterion, not observed variance:
   *  the Workspace tab saturates once every directory fits, exactly as the Config catalog's five rows do.
   *
   *  SABOTAGE-CHECKED like every other member, by deleting `|| state.permissions.open` from the disjunction:
   *  this case fails on the OPEN half ("the task panel is still mounted beside a pane-sizing dialog") and
   *  every other case in the file stays green. The measurement behind it is in ChatApp's gate comment — with
   *  the term absent and a task panel up, the composed frame is `rows + 2` and Ink draws a `clearTerminal`
   *  (full-screen wipe plus whole-transcript re-dump) on every cursor move at every pane from 14 to 30.
   *
   *  It needs the settings-capable fake — see `gateCycle`'s `make` parameter. */
  it("/permissions — the task panel unmounts while the Permissions dialog is up and comes back when it closes", async () => {
    await gateCycle("/permissions", {}, {},
      async (r) => { r.stdin.write("/permissions"); await waitFor(() => frame(r.lastFrame).includes("/permissions")); r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Claude Code won't ask before using allowed tools.")); },
      async (r) => { r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("Claude Code won't ask before using allowed tools.")); },
      (o) => fakeSettingsRemote({}, o) as unknown as ReturnType<typeof fakeRemote>);
  });

  /** THE NEGATIVE PIN. `/theme` is a content-sized dialog — a constant 17 rows at every pane — so it is on the
   *  excluded side of the partition ChatApp's gate comment draws, and the task panel must stay mounted beside
   *  it. Sabotage-checked the way the four above were, but in the opposite direction: ADDING
   *  `|| state.themeDialog.open` to `paneOwned` turns this test red (`the /theme dialog is content-sized …`)
   *  and leaves every other test in the suite green — which is exactly the hole this closes, since a term
   *  added by a later round is invisible to a suite whose every case only checks that the panel is GONE. */
  it("/theme — the task panel SURVIVES behind a content-sized dialog (the gate must not over-fire)", async () => {
    const fake = fakeRemote();
    const r = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/tmp" />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));
    seedTodo(fake);
    await waitFor(() => TODO.test(frame(r.lastFrame)));
    r.stdin.write("/theme"); await waitFor(() => frame(r.lastFrame).includes("/theme"));
    r.stdin.write("\r"); await waitFor(() => frame(r.lastFrame).includes("Choose the text style"));
    expect(frame(r.lastFrame), "the /theme dialog is content-sized — the paneOwned gate must not hide the task panel behind it").toMatch(TODO);
    r.stdin.write("\x1b"); await waitFor(() => !frame(r.lastFrame).includes("Choose the text style"));
    expect(frame(r.lastFrame)).toMatch(TODO);
    r.unmount();
  });
});
