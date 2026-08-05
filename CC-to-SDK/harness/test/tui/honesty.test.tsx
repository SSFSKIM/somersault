// test/tui/honesty.test.tsx — F0's honesty audit: no string may advertise a chord that is not live.
// Structure: PROOFS maps every ShortcutsOverlay ROWS key to an executable proof. Pure-reducer rows are
// proven directly against editor.ts's applyKey/inputMode (mirrors editor.test.ts's own idioms); app rows
// drive a REAL <ChatApp> (or, where ChatApp offers no injection point for the dependency being proven,
// a real <ChatComposer> — see the "Ctrl-X Ctrl-E / Ctrl-G" proof below) with fakes. The first test fails
// the moment someone adds an overlay row without adding its proof — that is this file's whole point.
//
// This file has NO local `tick()` helper of its own invention: it copies chat.test.tsx's real idiom
// verbatim (a local `waitFor(cond)` polling loop, plus a bare `await new Promise((r) => setTimeout(r, N))`
// where a settle is needed with nothing to poll for) rather than a fictitious shared helper — chat.test.tsx
// does not export one, and these helpers are file-local by convention across this whole test suite.
import { describe, it, expect, afterAll } from "vitest";
import React from "react";
// F2 task 6: ChatApp/ChatComposer read stdin through <KeymapProvider> now, not `useInput` — rendered bare
// they have no input path at all, so every render here goes through the provider wrapper.
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { ChatStatusBar } from "../../src/tui/ChatStatusBar.js";
import { ROWS } from "../../src/tui/ShortcutsOverlay.js";
import { applyKey, initialEditorState, inputMode, UNDO_COALESCE_MS, type EditorState } from "../../src/tui/editor.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";
import { appendHistory } from "../../src/tui/promptHistory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// F5 t12: the Ctrl-R proof drives the real prompt log, so it needs a fleet root of its own — never the
// user's. Collected and removed at the end, the same discipline chat.test.tsx uses for its fake homes.
const honestyRoots: string[] = [];

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");   // ShortcutsOverlay.test.tsx's own idiom
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const settle = () => new Promise((r) => setTimeout(r, 30));   // chat.test.tsx's bare-setTimeout settle idiom

/** Fold applyKey over each character of `text` from a base state (default: fresh) — the same reduction
 *  editor.test.ts's own file-local `type` helper performs, just named per this task brief's `typed(text)`.
 *  Each keystroke is handed a `now` a full coalesce window apart (F5 task 1 / CM17), so every character is
 *  its own undo entry — these proofs are about a key being LIVE, not about typing speed. */
let honestyClock = 0;
function typed(text: string, base: EditorState = initialEditorState()): EditorState {
  return [...text].reduce((s, ch) => applyKey(s, ch, {}, honestyClock += UNDO_COALESCE_MS + 1).state, base);
}

// A fakeRemote() extended onto the RewindOps surface, copied from chat.test.tsx's own file-local
// fakeRewindRemote (that helper is not exported — every tui test file that needs it keeps its own copy).
type RewindFakeOpts = { rewindAnchors?: () => Promise<RewindAnchor[]>; rewindDryRun?: (uuid: string) => Promise<RewindDryRun>; rewind?: (anchor: RewindAnchor, scope: RewindScope) => Promise<void> };
function fakeRewindRemote(rewindOpts: RewindFakeOpts, remoteOpts: FakeRemoteOpts = {}) {
  const base = fakeRemote(remoteOpts);
  return { ...base, rewindAnchors: rewindOpts.rewindAnchors ?? (async () => []), rewindDryRun: rewindOpts.rewindDryRun ?? (async () => ({ canRewind: true }) as RewindDryRun), rewind: rewindOpts.rewind ?? (async () => {}) };
}

const PROOFS: Record<string, () => Promise<void> | void> = {
  "⏎": () => { expect(applyKey(typed("hi"), "", { return: true }).submit).toBe("hi"); },

  "\\⏎ / Ctrl-J": () => {
    expect(applyKey(typed("a\\"), "", { return: true }).state.lines).toEqual(["a", ""]);   // \⏎ continuation
    expect(applyKey(typed("a"), "\n", {}).state.lines).toEqual(["a", ""]);                 // Ctrl-J = 0x0a, no key.return
    // F5 Task 2: the ladder's rung-1 form is advertised on Apple_Terminal, so the chord behind it has to
    // work — `\x1b\r` parses to return+shift (keys/parse.ts:95) and the editor splits the line on it.
    expect(applyKey(typed("a"), "", { return: true, shift: true }).state.lines).toEqual(["a", ""]);
    expect(applyKey(typed("a"), "", { return: true, shift: true }).submit).toBeUndefined();
  },

  "↑↓": () => {
    const up = applyKey(initialEditorState([{ display: "past" }]), "", { upArrow: true }).state;
    expect(up.lines).toEqual(["past"]);                        // ↑ on an empty row-0 buffer recalls history
    const idle = applyKey(up, "", { downArrow: true }).state;
    expect(idle.lines).toEqual([""]);                          // ↓ back past the newest entry restores the (empty) draft
  },

  "Ctrl-A/E/K/U/W": () => {
    const CTRL = { ctrl: true };
    const base = typed("hello world");                                          // cursor at end, col 11
    expect(applyKey(base, "a", CTRL).state.cursor).toEqual({ row: 0, col: 0 });  // Ctrl-A: line start
    expect(applyKey(applyKey(base, "a", CTRL).state, "e", CTRL).state.cursor).toEqual({ row: 0, col: 11 });   // Ctrl-E: line end
    const killedToEnd = applyKey(applyKey(base, "a", CTRL).state, "k", CTRL);    // Ctrl-K from col 0: kills the whole line
    expect(killedToEnd.state.lines).toEqual([""]);
    expect(killedToEnd.killed).toEqual({ text: "hello world", dir: "append" });
    const killedToStart = applyKey(base, "u", CTRL);                            // Ctrl-U from end: kills the whole line
    expect(killedToStart.state.lines).toEqual([""]);
    expect(killedToStart.killed).toEqual({ text: "hello world", dir: "prepend" });
    const killedWord = applyKey(base, "w", CTRL);                               // Ctrl-W from end: kills the last word only
    expect(killedWord.state.lines).toEqual(["hello "]);
    expect(killedWord.killed).toEqual({ text: "world", dir: "prepend" });
  },

  "Ctrl-Y / Alt-Y": () => {
    const CTRL = { ctrl: true };
    let s = typed("one");
    s = applyKey(s, "u", CTRL).state;             // Ctrl-U kills "one" into the ring
    s = typed("two", s);                          // a non-kill keystroke breaks the run
    s = applyKey(s, "u", CTRL).state;              // Ctrl-U kills "two" as a SECOND ring entry
    expect(s.killRing).toEqual(["one", "two"]);
    s = applyKey(s, "y", CTRL).state;              // Ctrl-Y yanks the newest kill
    expect(s.lines).toEqual(["two"]);
    s = applyKey(s, "y", { meta: true }).state;    // Alt-Y (yank-pop) cycles to the older entry
    expect(s.lines).toEqual(["one"]);
  },

  "Alt-←→ / Alt-b/f": () => {
    const base = typed("hello world");                                          // cursor at end, col 11
    expect(applyKey(base, "", { meta: true, leftArrow: true }).state.cursor).toEqual({ row: 0, col: 6 });    // Alt-Left
    expect(applyKey(base, "b", { meta: true }).state.cursor).toEqual({ row: 0, col: 6 });                    // Alt-b, same move
    const backOne = applyKey(base, "", { meta: true, leftArrow: true }).state;
    expect(applyKey(backOne, "", { meta: true, rightArrow: true }).state.cursor).toEqual({ row: 0, col: 11 });   // Alt-Right
    expect(applyKey(backOne, "f", { meta: true }).state.cursor).toEqual({ row: 0, col: 11 });                    // Alt-f, same move
  },

  "Ctrl-L": () => { expect(applyKey(typed("x"), "l", { ctrl: true }).state.lines).toEqual([""]); },

  "Ctrl-_": () => { expect(applyKey(typed("ab"), "\x1f", {}).state.lines).toEqual(["a"]); },

  "Ctrl-S": () => {
    let s = typed("draft prompt");
    s = applyKey(s, "s", { ctrl: true }).state;    // Ctrl-S stashes a non-empty buffer, clearing it
    expect(s.lines).toEqual([""]);
    expect(s.stashed?.display).toBe("draft prompt");
    s = applyKey(s, "s", { ctrl: true }).state;    // Ctrl-S on the now-empty buffer restores the stash
    expect(s.lines).toEqual(["draft prompt"]);
    expect(s.stashed).toBeNull();
  },

  // ChatApp exposes NO editExternal injection point (it never forwards the prop to <ChatComposer>), so
  // proving this through ChatApp would either shell out to a real $EDITOR or silently prove nothing. The
  // chord is owned entirely by ChatComposer, so this proof renders it directly with an injected fake —
  // exactly what test/tui/components.test.tsx already does for the same chord.
  "Ctrl-X Ctrl-E / Ctrl-G": async () => {
    const edits: string[] = [];
    const submitted: string[] = [];
    const fakeEdit = (t: string) => { edits.push(t); return "EDITED:" + t; };
    const { stdin, lastFrame } = render(<ChatComposer onSubmit={(t) => submitted.push(t)} cwd="/" commandCatalog={[]} editExternal={fakeEdit} />);
    await settle();
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\x18");                            // Ctrl-X arms the chord
    await settle();
    stdin.write("\x05");                            // Ctrl-E within the chord window → round-trips through editExternal
    await waitFor(() => frame(lastFrame).includes("EDITED:hi"));
    expect(edits).toEqual(["hi"]);
    stdin.write("\r"); await waitFor(() => submitted.length === 1);
    expect(submitted[0]).toBe("EDITED:hi");
    stdin.write("\x07");                            // Ctrl-G — no Ctrl-X prefix needed, fires directly
    await waitFor(() => edits.length === 2);
    expect(edits[1]).toBe("");                       // buffer was empty (post-submit) when Ctrl-G fired
  },

  "⇧Tab": async () => {
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    stdin.write("\x1b[Z");                           // Shift+Tab
    await waitFor(() => modes.includes("acceptEdits"));
    await waitFor(() => frame(lastFrame).includes("acceptEdits"));   // status bar reflects the real mode change
  },

  "Esc": async () => {
    let interrupts = 0;
    let release = () => {};
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
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn started, hanging
    stdin.write("\x1b");                             // Esc while busy → interrupt, not the rewind arm
    await waitFor(() => interrupts === 1);
    release();
  },

  "Esc Esc": async () => {
    // idle + text present: the SECOND Esc clears the buffer (ChatComposer-owned, CM15).
    const a = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} escClearMs={80} />);
    await waitFor(() => frame(a.lastFrame).includes("❯\u00a0"));
    a.stdin.write("hello there"); await waitFor(() => frame(a.lastFrame).includes("hello there"));
    a.stdin.write("\x1b"); await waitFor(() => frame(a.lastFrame).includes("Esc again to clear"));
    a.stdin.write("\x1b"); await waitFor(() => !frame(a.lastFrame).includes("hello there"));

    // idle + EMPTY buffer: the SECOND Esc opens the rewind picker instead (ChatApp-owned).
    let anchorsFetched = 0;
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix it", index: 1 };
    const rewindFake = fakeRewindRemote({ rewindAnchors: async () => { anchorsFetched++; return [ANCHOR]; } });
    const b = render(<ChatApp makeSession={() => rewindFake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(b.lastFrame).includes("❯\u00a0"));
    b.stdin.write("\x1b"); await waitFor(() => frame(b.lastFrame).includes("Press Esc again to rewind"));
    b.stdin.write("\x1b"); await waitFor(() => anchorsFetched === 1);
    await waitFor(() => frame(b.lastFrame).includes("Restore the code and/or conversation"));
  },

  "Ctrl-T": async () => {
    const fake = fakeRemote();
    const { lastFrame, stdin } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/" />);
    await settle();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => (lastFrame() ?? "").includes("☐ todo-item-one"));
    stdin.write("\x14");                             // Ctrl-T
    await waitFor(() => !(lastFrame() ?? "").includes("☐ todo-item-one"));
    stdin.write("\x14");
    await waitFor(() => (lastFrame() ?? "").includes("☐ todo-item-one"));   // proves the toggle really flips both ways
  },

  "Ctrl-O": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x0f");                             // Ctrl-O opens the pager
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f");                             // Ctrl-O again closes it
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
  },

  // F5 t12: Ctrl-R is the composer's INLINE reverse-i-search now, not the full-screen picker (upstream's own
  // layout routing — historySearchInline.ts's header). The row still advertises "search history", and this
  // proof still drives the real chord end to end: open, type, and watch the buffer become the match.
  "Ctrl-R": async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-honesty-hist-"));
    honestyRoots.push(root);
    const env = { ...process.env, CCX_FLEET_ROOT: root };
    appendHistory({ display: "redo the build", project: "/tmp" }, env);
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={{ env }} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x12");                             // Ctrl-R opens the inline search
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("search prompts:"));
    stdin.write("redo");                             // …and the match rewrites the buffer in place
    await waitFor(() => stripAnsi(frame(lastFrame)).includes("redo the build"));
  },

  "Ctrl-B": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x02");                             // Ctrl-B idle → opens the bg-tasks panel
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    expect(frame(lastFrame)).toContain("none running");
  },

  "Ctrl-X Ctrl-K": async () => {
    const stopped: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopped.push(id); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "d1" }] });
    await waitFor(() => frame(lastFrame).includes("⚙ 1 bg"));
    stdin.write("\x18"); await settle(); stdin.write("\x0b");   // first Ctrl-X Ctrl-K chord: arms killAgents' own confirm
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-X Ctrl-K again to stop background agents"));
    expect(stopped).toEqual([]);
    stdin.write("\x18"); await settle(); stdin.write("\x0b");   // second chord within 3s → stops every bg task
    await waitFor(() => stopped.length === 1);
    expect(stopped).toEqual(["t1"]);
  },

  "Ctrl-C ×2": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x03");                             // Ctrl-C idle → arms
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-C again to exit"));
    stdin.write("\x03");                             // second Ctrl-C within the window → real useApp().exit()
    await settle();
    stdin.write("zzz");                              // if exit() didn't really fire the composer would still be live and show this
    await settle();
    expect(frame(lastFrame)).not.toContain("zzz");
  },

  "Ctrl-D ×2": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x04");                             // Ctrl-D on an empty composer → arms
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-D again to exit"));
    stdin.write("\x04");                             // second Ctrl-D within the (real, 800ms) window → real exit()
    await settle();
    stdin.write("zzz");                              // if exit() didn't really fire this would land in the composer
    await settle();
    expect(frame(lastFrame)).not.toContain("zzz");
  },

  "Ctrl-Z": async () => {
    let suspended = 0;
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} suspend={() => { suspended++; }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1a");                             // Ctrl-Z
    await waitFor(() => suspended === 1);
    expect(frame(lastFrame)).toContain("❯\u00a0");         // never exited/detached — just suspended
  },

  "!": () => { expect(inputMode(typed("!ls"))).toBe("bash"); },
  "#": () => { expect(inputMode(typed("#note"))).toBe("memory"); },
  "@": () => { expect(typed("@").mention).not.toBeNull(); },
  "/": () => { expect(typed("/").command).not.toBeNull(); },

  "?": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("❯\u00a0");     // the composer is replaced by the overlay, not layered under it
  },
};

it("every advertised chord has a proof", () => {
  for (const [k] of ROWS) expect(PROOFS[k], `overlay advertises "${k}" with no proof — add one or delete the row`).toBeDefined();
});
for (const [k] of ROWS) it(`"${k}" is live`, async () => { await PROOFS[k](); });

it("the composer-owned footer and contextual hints only advertise chords that ROWS carries", async () => {
  // F5 Task 2 (CM20): the invented `\⏎ newline` rung became upstream's own `Z_a` ladder, so all THREE of
  // its strings map onto the same row — whichever rung the ladder is standing on still has to be a chord
  // ROWS can prove. The proof itself is unchanged: `\`+Return and Ctrl-J both split the line.
  const FOOTER_TOKEN_TO_ROW: Record<string, string> = {
    "⏎ send": "⏎", "@ files": "@", "/ commands": "/",
    "backslash (\\) + return (⏎) for newline": "\\⏎ / Ctrl-J", "\\⏎ for newline": "\\⏎ / Ctrl-J", "shift + ⏎ for newline": "\\⏎ / Ctrl-J",
    "! bash": "!", "⇧Tab mode": "⇧Tab", "Esc rewind": "Esc", "Esc clear": "Esc", "Esc interrupt": "Esc", "? help": "?",
  };
  const rowKeys = new Set(ROWS.map(([k]) => k));
  const savedTerm = process.env.TERM_PROGRAM;
  const composer = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} />);
  await settle();
  const frames = [frame(composer.lastFrame)];
  composer.stdin.write("draft"); await waitFor(() => frame(composer.lastFrame).includes("draft"));
  frames.push(frame(composer.lastFrame));
  // Each ladder rung is a DIFFERENT advertised string, so each one needs a frame of its own: the terse rung
  // only appears once `\`+Return has been used, and the shift rung only on an Apple_Terminal.
  composer.stdin.write("\\"); await waitFor(() => frame(composer.lastFrame).includes("draft\\"));
  composer.stdin.write("\r"); await waitFor(() => stripAnsi(frame(composer.lastFrame)).includes("\\⏎ for newline"));
  frames.push(frame(composer.lastFrame));
  try {
    process.env.TERM_PROGRAM = "Apple_Terminal";
    composer.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} />);
    await waitFor(() => stripAnsi(frame(composer.lastFrame)).includes("shift + ⏎ for newline"));
    frames.push(frame(composer.lastFrame));
  } finally { if (savedTerm === undefined) delete process.env.TERM_PROGRAM; else process.env.TERM_PROGRAM = savedTerm; }
  composer.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy />);
  await waitFor(() => frame(composer.lastFrame).includes("Esc interrupt"));
  frames.push(frame(composer.lastFrame));

  // UNWRAP before looking for tokens. The ladder row is one logical line that Ink breaks at the terminal
  // width, and the break lands mid-row once the verbose newline rung is standing (`? \n help`) — matching
  // per physical line silently loses whichever token straddles the break, which reads as "the footer stopped
  // advertising it" rather than "the frame is 100 columns wide".
  const unwrapped = frames.map((raw) => stripAnsi(raw).replace(/\s*\n\s*/g, " "));
  const liveTokens = new Set(Object.keys(FOOTER_TOKEN_TO_ROW).filter((token) => unwrapped.some((f) => f.includes(token))));
  for (const token of liveTokens) {
    const row = FOOTER_TOKEN_TO_ROW[token];
    expect(row, `footer token "${token}" has no ROWS mapping`).toBeDefined();
    expect(rowKeys.has(row), `footer token "${token}" maps to missing row "${row}"`).toBe(true);
  }
  for (const token of Object.keys(FOOTER_TOKEN_TO_ROW)) {
    expect(liveTokens.has(token), `"${token}" is in the mapping but no live composer footer/hint advertises it`).toBe(true);
  }
});

it("the status bar never advertises composer-local keys", () => {
  const status = render(<ChatStatusBar mode="default" busy={true} ctxPct={42} />).lastFrame() ?? "";
  expect(status).not.toContain("[y/n");
  expect(status).not.toContain("Esc interrupt");
  expect(status).not.toContain("Esc rewind");
  expect(status).not.toContain("? help");
});

afterAll(() => { for (const d of honestyRoots.splice(0)) rmSync(d, { recursive: true, force: true }); });
