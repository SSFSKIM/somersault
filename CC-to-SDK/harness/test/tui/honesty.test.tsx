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
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { ChatStatusBar } from "../../src/tui/ChatStatusBar.js";
import { ROWS } from "../../src/tui/ShortcutsOverlay.js";
import { applyKey, initialEditorState, inputMode, type EditorState } from "../../src/tui/editor.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");   // ShortcutsOverlay.test.tsx's own idiom
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const settle = () => new Promise((r) => setTimeout(r, 30));   // chat.test.tsx's bare-setTimeout settle idiom

/** Fold applyKey over each character of `text` from a base state (default: fresh) — the same reduction
 *  editor.test.ts's own file-local `type` helper performs, just named per this task brief's `typed(text)`. */
function typed(text: string, base: EditorState = initialEditorState()): EditorState {
  return [...text].reduce((s, ch) => applyKey(s, ch, {}).state, base);
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
  },

  "↑↓": () => {
    const up = applyKey(initialEditorState(["past"]), "", { upArrow: true }).state;
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
    expect(s.stashed).toBe("draft prompt");
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hi"); await waitFor(() => frame(lastFrame).includes("hi"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("ok"));   // turn started, hanging
    stdin.write("\x1b");                             // Esc while busy → interrupt, not the rewind arm
    await waitFor(() => interrupts === 1);
    release();
  },

  "Esc Esc": async () => {
    // idle + text present: the SECOND Esc clears the buffer (ChatComposer-owned, CM15).
    const a = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} escClearMs={80} />);
    await waitFor(() => frame(a.lastFrame).includes("›"));
    a.stdin.write("hello there"); await waitFor(() => frame(a.lastFrame).includes("hello there"));
    a.stdin.write("\x1b"); await waitFor(() => frame(a.lastFrame).includes("Esc again to clear"));
    a.stdin.write("\x1b"); await waitFor(() => !frame(a.lastFrame).includes("hello there"));

    // idle + EMPTY buffer: the SECOND Esc opens the rewind picker instead (ChatApp-owned).
    let anchorsFetched = 0;
    const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix it", index: 1 };
    const rewindFake = fakeRewindRemote({ rewindAnchors: async () => { anchorsFetched++; return [ANCHOR]; } });
    const b = render(<ChatApp makeSession={() => rewindFake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(b.lastFrame).includes("›"));
    b.stdin.write("\x1b"); await waitFor(() => frame(b.lastFrame).includes("Press Esc again to rewind"));
    b.stdin.write("\x1b"); await waitFor(() => anchorsFetched === 1);
    await waitFor(() => frame(b.lastFrame).includes("Rewind to a previous message"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x0f");                             // Ctrl-O opens the pager
    await waitFor(() => frame(lastFrame).includes("Transcript"));
    stdin.write("\x0f");                             // Ctrl-O again closes it
    await waitFor(() => !frame(lastFrame).includes("Transcript"));
  },

  "Ctrl-R": async () => {
    const fakeDeps = {
      getSessionMessages: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      getSessionMessagesIn: async () => [{ type: "user", uuid: "u1", message: { content: "redo the build" } }],
      listHistorySessions: async () => [{ sessionId: "s1", summary: "", lastModified: 1 }],
    };
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd="/tmp" deps={fakeDeps} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x12");                             // Ctrl-R opens history search
    await waitFor(() => frame(lastFrame).includes("Search prompts"));
    stdin.write("\x1b");                             // Esc accepts the top entry into the composer
    await waitFor(() => frame(lastFrame).includes("redo the build"));
  },

  "Ctrl-B": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x02");                             // Ctrl-B idle → opens the bg-tasks panel
    await waitFor(() => frame(lastFrame).includes("Background tasks"));
    expect(frame(lastFrame)).toContain("none running");
  },

  "Ctrl-X Ctrl-K": async () => {
    const stopped: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopped.push(id); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1a");                             // Ctrl-Z
    await waitFor(() => suspended === 1);
    expect(frame(lastFrame)).toContain("›");         // never exited/detached — just suspended
  },

  "!": () => { expect(inputMode(typed("!ls"))).toBe("bash"); },
  "#": () => { expect(inputMode(typed("#note"))).toBe("memory"); },
  "@": () => { expect(typed("@").mention).not.toBeNull(); },
  "/": () => { expect(typed("/").command).not.toBeNull(); },

  "?": async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("?");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    expect(frame(lastFrame)).not.toContain("›");     // the composer is replaced by the overlay, not layered under it
  },
};

it("every advertised chord has a proof", () => {
  for (const [k] of ROWS) expect(PROOFS[k], `overlay advertises "${k}" with no proof — add one or delete the row`).toBeDefined();
});
for (const [k] of ROWS) it(`"${k}" is live`, async () => { await PROOFS[k](); });

it("the composer-owned footer and contextual hints only advertise chords that ROWS carries", async () => {
  const FOOTER_TOKEN_TO_ROW: Record<string, string> = {
    "⏎ send": "⏎", "\\⏎ newline": "\\⏎ / Ctrl-J", "@ files": "@", "/ commands": "/",
    "! bash": "!", "⇧Tab mode": "⇧Tab", "Esc rewind": "Esc", "Esc clear": "Esc", "Esc interrupt": "Esc", "? help": "?",
  };
  const rowKeys = new Set(ROWS.map(([k]) => k));
  const composer = render(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} />);
  await settle();
  const frames = [frame(composer.lastFrame)];
  composer.stdin.write("draft"); await waitFor(() => frame(composer.lastFrame).includes("draft"));
  frames.push(frame(composer.lastFrame));
  composer.rerender(<ChatComposer onSubmit={() => {}} cwd="/" commandCatalog={[]} busy />);
  await waitFor(() => frame(composer.lastFrame).includes("Esc interrupt"));
  frames.push(frame(composer.lastFrame));

  const liveTokens = new Set(frames.flatMap((raw) => stripAnsi(raw).split("\n")
    .filter((line) => line.includes(" · "))
    .flatMap((line) => line.trim().split(" · "))
    .filter((token) => token in FOOTER_TOKEN_TO_ROW)));
  for (const token of ["Esc rewind", "Esc clear", "Esc interrupt"]) {
    if (frames.some((raw) => raw.includes(token))) liveTokens.add(token);
  }
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
