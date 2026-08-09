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
import { Footer } from "../../src/tui/Footer.js";
import { defaultLookup } from "../../src/tui/keys/hints.js";
import { ROWS } from "../../src/tui/ShortcutsOverlay.js";
import { applyKey, initialEditorState, inputMode, UNDO_COALESCE_MS, type EditorState } from "../../src/tui/editor.js";
import { fakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";
import { appendHistory } from "../../src/tui/promptHistory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** TaskPanel's pending row (F6 T13). Ink lays the row out by MEASURED width and `◻` measures two columns
 *  while printing as one, so the gutter is one space or two — this is a regex rather than a literal for that
 *  reason. "todo-item-one" ALONE would not do: the transcript also prints the TaskCreate tool_use and its
 *  result text permanently, so a bare substring check never goes false. */
const TODO_ROW = /◻\s+todo-item-one/;

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
    await waitFor(() => frame(lastFrame).includes("manual mode on"));
    stdin.write("\x1b[Z");                           // Shift+Tab
    await waitFor(() => modes.includes("acceptEdits"));
    // WAVE C TASK 2: the chip prints upstream's own words (`⏵⏵ accept edits on`), not the wire key.
    await waitFor(() => frame(lastFrame).includes("accept edits on"));
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
    await waitFor(() => TODO_ROW.test(lastFrame() ?? ""));
    stdin.write("\x14");                             // Ctrl-T
    await waitFor(() => !TODO_ROW.test(lastFrame() ?? ""));
    stdin.write("\x14");
    await waitFor(() => TODO_ROW.test(lastFrame() ?? ""));   // proves the toggle really flips both ways
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
    await waitFor(() => frame(lastFrame).includes("Background"));
    expect(frame(lastFrame)).toContain("No tasks currently running");
  },

  "Ctrl-X Ctrl-K": async () => {
    const stopped: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopped.push(id); } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "d1" }] });
    await waitFor(() => frame(lastFrame).includes("← for agents"));
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

  // F6 T14 — the two rows the upstream merge ADDED to the grid. Both are advertised now, so both need a
  // proof; PROOFS is only ever extended, never trimmed to whatever the newest grid happens to print.
  "Alt-P": async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("\x1bp");                            // Alt-P → the model picker, and the picker really lists the live catalog
    await waitFor(() => frame(lastFrame).includes("Select model"));
    expect(frame(lastFrame)).toContain("Opus");
  },

  // Not a chord — the one COMMAND the grid advertises (upstream's `/keybindings to customize`, gated on a
  // release flag there and unconditional here because the command is implemented). The proof drives it end to
  // end through the injected editor seam, never the machine's real $EDITOR (chat.test.tsx's own idiom).
  "/keybindings": async () => {
    const home = mkdtempSync(join(tmpdir(), "ccx-honesty-home-"));
    honestyRoots.push(home);
    const opened: string[] = [];
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()}
      deps={{ home, openEditor: (file: string, prepare: () => void) => { prepare(); opened.push(file); return "opened" as const; }, readFile: () => null, writeFile: () => {} }} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("/keybindings"); await waitFor(() => frame(lastFrame).includes("/keybindings"));
    stdin.write("\r");
    await waitFor(() => opened.length === 1);
    expect(opened[0]).toBe(join(home, ".claude", "keybindings.json"));
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

it("the footer and the composer's contextual hints only advertise chords that ROWS carries", async () => {
  // WAVE C TASK 2 REWROTE THE CORPUS, NOT THE RULE. The eleven-row hint stack this test used to sweep is
  // gone: hint row 1 (`⏎ send · @ files · …`) had no upstream counterpart and was deleted outright, and the
  // rest became either the ONE footer row (`Footer.tsx`) or queue notifications. So the tokens changed and
  // the subject changed — the audit is the same, and it is still the thing that makes a lying string fail a
  // test rather than a review. Each token below is one the live footer can print; each maps to the ROWS key
  // whose proof above shows the chord actually works.
  const FOOTER_TOKEN_TO_ROW: Record<string, string> = {
    "? for shortcuts": "?", "! for shell mode": "!", "(shift+tab to cycle)": "⇧Tab",
  };
  // `esc to interrupt` is NOT here on purpose: `footerModel.buildHintList` builds it (it is what crowds
  // `? for shortcuts` out while a turn runs) and `Footer.tsx` filters it back out, because ccx's spinner tail
  // already carries the same offer — see that filter's comment. Its honesty is audited where it is printed:
  // the `Esc` row's own proof above drives a real interrupt.
  // ONE LIVE AFFORDANCE IS DELIBERATELY NOT IN THAT MAP, and this is the record of it rather than a hole:
  // `← for agents` (annex §C1.4).
  //   WAVE C TASK 4 CLOSED THE GAP THIS COMMENT USED TO DESCRIBE. It said the glyph was "a shape borrowed from
  // upstream, not a chord this table can prove", because ccx bound `←` to nothing. It is a chord now: `←` `←`
  // on an empty composer opens the background pane (ChatComposer's `leftAgentsArmRef`, annex §C7.8), on the
  // same double-press primitive every other armed gesture in the port uses, and chat.test.tsx drives it
  // end-to-end in "← on an empty composer arms the agents gesture; a second ← opens the background pane".
  //   IT STILL DOES NOT BELONG IN THE MAP ABOVE, for a different reason: that map's values are `ShortcutsOverlay`
  // ROWS keys, and ROWS is `shortcutRows(defaultLookup)` — upstream's own grid, which carries no `←` row. The
  // honest move is to leave the audit's corpus matching upstream's rather than to invent a row so a token has
  // somewhere to point. The two assertions below still pin the RENDER gate (`agentsAffordance` returns null at
  // count 0), so a change that started printing it unconditionally fails here.
  const rowKeys = new Set(ROWS.map(([k]) => k));
  const foot = (over: Partial<React.ComponentProps<typeof Footer>>) => stripAnsi(frame(render(
    <Footer mode="default" busy={false} draftNonEmpty={false} isInputEmpty searching={false}
      statusLineConfigured={false} pasting={false} pasteExpandHint={false} bashMode={false}
      agents={{ count: 0 }} bindings={defaultLookup} {...over} />).lastFrame));
  const frames = [
    foot({}),                                    // home: `⏸ manual mode on · ? for shortcuts`
    foot({ mode: "plan" }),                      // non-default: the cycle parenthetical
    foot({ busy: true }),                        // running: `esc to interrupt`
    foot({ bashMode: true }),                    // `! for shell mode`
  ];
  expect(foot({ agents: { count: 0 } })).not.toContain("← for agents");
  expect(foot({ agents: { count: 2 } })).toContain("← for agents");

  // UNWRAP before looking for tokens: the row is one logical line Ink breaks at the terminal width, and a
  // per-physical-line match silently loses whichever token straddles the break.
  const unwrapped = frames.map((raw) => raw.replace(/\s*\n\s*/g, " "));
  const liveTokens = new Set(Object.keys(FOOTER_TOKEN_TO_ROW).filter((token) => unwrapped.some((f) => f.includes(token))));
  for (const token of liveTokens) {
    const row = FOOTER_TOKEN_TO_ROW[token];
    expect(row, `footer token "${token}" has no ROWS mapping`).toBeDefined();
    expect(rowKeys.has(row), `footer token "${token}" maps to missing row "${row}"`).toBe(true);
  }
  for (const token of Object.keys(FOOTER_TOKEN_TO_ROW)) {
    expect(liveTokens.has(token), `"${token}" is in the mapping but no live footer state advertises it`).toBe(true);
  }
});

it("the footer never advertises a composer-local key it cannot deliver", () => {
  // WAVE C TASK 2: same rule, new subject. The footer renders under every dialog, so the chord-bearing half
  // of it (the cycle parenthetical, the whole hint list) is gated on `composerOwnsKeys`; the mode chip is a
  // statement about the session and carries no chord, so it survives — which is exactly what is asserted.
  const status = stripAnsi(frame(render(
    <Footer mode="plan" busy draftNonEmpty={false} isInputEmpty searching={false} statusLineConfigured={false}
      pasting={false} pasteExpandHint={false} bashMode={false} agents={{ count: 3 }}
      bindings={defaultLookup} composerOwnsKeys={false} />).lastFrame));
  expect(status).toContain("⏸ plan mode on");
  expect(status).not.toContain("[y/n");
  expect(status).not.toContain("to cycle");
  expect(status).not.toContain("to interrupt");
  expect(status).not.toContain("? for shortcuts");
  expect(status).not.toContain("← for agents");
});

afterAll(() => { for (const d of honestyRoots.splice(0)) rmSync(d, { recursive: true, force: true }); });
