// tui/test/editor-readline.test.ts — F5 task 1: the editing-model tail of the pure reducer, pinned against
// the 2.1.220 bundle. Three contracts live here:
//  * CM12 (bundle L395676) — the readline ctrl map `[["a",startOfLogicalLine],["b",left],["e",endOfLogicalLine],
//    ["f",right],["h",deleteTokenBefore()??backspace()],["n",Re],["p",he]]` and the meta map's
//    `["d",()=>W.deleteWordAfter()]`, whose result never reaches the kill ring.
//  * CM17 (`o9f`, bundle L489735-L489748 + the `{maxBufferSize:50,debounceMs:1000}` call site at L495478) —
//    upstream DEBOUNCES undo pushes on a real timer; a pure reducer has no timer, so we pin the observably
//    equivalent coalesce window (a change < 1000 ms after the previous push does not push).
//  * CM18 (bundle L395679) — `d && W.offset>0 && W.text[W.offset-1]==="\\"` → `CXs(), W.backspace().insert("\n")`:
//    the continuation trigger is the character BEFORE THE CURSOR, and `CXs` is `markBackslashReturnUsed`.
import { describe, it, expect } from "vitest";
import { applyKey, initialEditorState, setCommandCatalog, clearToHistory, withBufferText, UNDO_CAP, UNDO_COALESCE_MS, type EditorState, type KeyFlags } from "../../src/tui/editor.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";

const CTRL: KeyFlags = { ctrl: true };
const META: KeyFlags = { meta: true };
const type = (s: EditorState, t: string) => [...t].reduce((st, ch) => applyKey(st, ch, {}).state, s);
const text = (s: EditorState) => s.lines.join("\n");
/** Type a string with each keystroke a full coalesce window apart, so every character pushes its own undo entry. */
const typeSpaced = (s: EditorState, t: string, from = 0) =>
  [...t].reduce((st, ch, i) => applyKey(st, ch, {}, from + (i + 1) * (UNDO_COALESCE_MS + 1)).state, s);

describe("CM12 readline ctrl keys (bundle L395676 ctrl map)", () => {
  it("ctrl+b moves left and ctrl+f moves right (`b`→left, `f`→right)", () => {
    let s = type(initialEditorState(), "abc");
    s = applyKey(s, "b", CTRL).state;
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    s = applyKey(s, "b", CTRL).state;
    expect(s.cursor).toEqual({ row: 0, col: 1 });
    s = applyKey(s, "f", CTRL).state;
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    expect(text(s)).toBe("abc");                                  // neither key inserts its letter
  });
  it("ctrl+b/f cross the line boundary like the arrows do", () => {
    let s = type(initialEditorState(), "ab\ncd");
    s = applyKey(s, "a", CTRL).state;                             // start of row 1
    s = applyKey(s, "b", CTRL).state;
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    s = applyKey(s, "f", CTRL).state;
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });
  it("ctrl+h deletes the character before the cursor (deleteTokenBefore() ?? backspace())", () => {
    let s = type(initialEditorState(), "abc");
    s = applyKey(s, "h", CTRL).state;
    expect(text(s)).toBe("ab");
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });
  it("ctrl+h at column 0 joins with the previous line (plain backspace)", () => {
    let s = type(initialEditorState(), "ab\ncd");
    s = applyKey(s, "a", CTRL).state;
    s = applyKey(s, "h", CTRL).state;
    expect(s.lines).toEqual(["abcd"]);
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });
  it("ctrl+h is undoable like any other edit", () => {
    let s = typeSpaced(initialEditorState(), "ab");
    s = applyKey(s, "h", CTRL, 10_000).state;
    expect(text(s)).toBe("a");
    expect(applyKey(s, "\x1f", {}).state.lines).toEqual(["ab"]);
  });
});

describe("CM12 ctrl+n/ctrl+p mirror down/up exactly (`n`→Re(), `p`→he())", () => {
  const CAT: CommandEntry[] = [
    { name: "model", description: "pick a model", source: "local" },
    { name: "memory", description: "edit memory", source: "local" },
    { name: "mcp", description: "list servers", source: "local" },
  ];
  it("ctrl+p recalls history at the top edge and ctrl+n walks back toward the draft", () => {
    let s = type(initialEditorState([{ display: "first" }, { display: "second" }]), "draft");
    s = applyKey(s, "p", CTRL).state;
    expect(text(s)).toBe("second");
    s = applyKey(s, "p", CTRL).state;
    expect(text(s)).toBe("first");
    s = applyKey(s, "n", CTRL).state;
    expect(text(s)).toBe("second");
    s = applyKey(s, "n", CTRL).state;
    expect(text(s)).toBe("draft");                                // the stashed draft comes back
  });
  it("ctrl+p/ctrl+n move the cursor inside a multi-line buffer instead of touching history", () => {
    let s = type(initialEditorState([{ display: "old" }]), "aa\nbb\ncc");
    expect(s.cursor).toEqual({ row: 2, col: 2 });
    s = applyKey(s, "p", CTRL).state;
    expect(s.cursor).toEqual({ row: 1, col: 2 });
    expect(text(s)).toBe("aa\nbb\ncc");                           // history untouched
    s = applyKey(s, "n", CTRL).state;
    expect(s.cursor).toEqual({ row: 2, col: 2 });
  });
  it("ctrl+n/ctrl+p move the selection while a popup is open (bundle L491100: the same keys drive the popup)", () => {
    let s = setCommandCatalog(type(initialEditorState(), "/m"), CAT);
    expect(s.command!.items.length).toBeGreaterThan(1);
    expect(s.command!.index).toBe(0);
    s = applyKey(s, "n", CTRL).state;
    expect(s.command!.index).toBe(1);
    s = applyKey(s, "n", CTRL).state;
    expect(s.command!.index).toBe(2);
    s = applyKey(s, "p", CTRL).state;
    expect(s.command!.index).toBe(1);
    expect(text(s)).toBe("/m");                                   // no letters inserted
  });
});

describe("CM12 alt+d = deleteWordAfter, and it is NOT a kill", () => {
  // WAVE C t3: `deleteWordAfter` is defined as the range up to `wordRight`, and that boundary moved from the
  // END of the word crossed to the START of the next one (annex §C7.6 `nextWord`, bundle L394936) — so the
  // separating space now goes with the word. Deliberate blast radius, pinned here rather than special-cased.
  it("deletes from the cursor to the START of the next word, separating space included", () => {
    let s = type(initialEditorState(), "one two three");
    s = applyKey(s, "a", CTRL).state;                             // column 0
    s = applyKey(s, "d", META).state;
    expect(text(s)).toBe("two three");
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });
  it("leaves the kill ring untouched (the meta map's `d` result never reaches the ring)", () => {
    let s = type(initialEditorState(), "one two");
    s = applyKey(s, "u", CTRL).state;                             // kill "one two" into the ring
    expect(s.killRing).toEqual(["one two"]);
    s = type(s, "alpha beta");
    s = applyKey(s, "a", CTRL).state;
    const r = applyKey(s, "d", META);
    expect(text(r.state)).toBe("beta");                           // WAVE C t3 boundary (see above)
    expect(r.killed).toBeUndefined();
    expect(r.state.killRing).toEqual(["one two"]);                // unchanged: alt+d does not feed the ring
  });
  it("is a no-op at the end of the buffer", () => {
    const s = type(initialEditorState(), "word");
    expect(applyKey(s, "d", META).state).toBe(s);
  });
});

// Live-feedback fix (2026-08-06), bundle L395786-395796: the `backspace` dispatch arm reads
// `if (Pe.meta || Pe.ctrl) return se()` — deleteWordBefore AS A KILL (ring, prepend; the ctrl+w op) —
// before falling to `deleteTokenBefore() ?? backspace()`. Option+backspace over ssh (ESC 0x7f →
// alt+backspace) previously fell through to the single-char arm and read as broken in live use.
// `delete` reads `if (Pe.meta) return oe()` — deleteToLineEnd (ring, append).
describe("meta+backspace = deleteWordBefore as a kill (bundle L395789 `se()`), meta+delete = deleteToLineEnd (`oe()`)", () => {
  it("alt+backspace deletes the word before the cursor into the ring, prepend direction", () => {
    let s = type(initialEditorState(), "one two");
    const r = applyKey(s, "", { backspace: true, meta: true });
    expect(text(r.state)).toBe("one ");
    expect(r.killed).toEqual({ text: "two", dir: "prepend" });
    expect(r.state.killRing).toEqual(["two"]);
    const restored = applyKey(r.state, "y", CTRL).state;          // the kill is yankable, exactly like ctrl+w's
    expect(text(restored)).toBe("one two");
  });
  it("ctrl+backspace runs the same word kill (the arm is `meta || ctrl`)", () => {
    const s = type(initialEditorState(), "alpha beta");
    const r = applyKey(s, "", { backspace: true, ctrl: true });
    expect(text(r.state)).toBe("alpha ");
    expect(r.state.killRing).toEqual(["beta"]);
  });
  it("plain backspace still deletes one character — the fall-through arm is untouched", () => {
    const s = type(initialEditorState(), "ab");
    const r = applyKey(s, "", { backspace: true });
    expect(text(r.state)).toBe("a");
    expect(r.killed).toBeUndefined();
  });
  it("meta+delete kills to the end of the line, append direction", () => {
    let s = type(initialEditorState(), "one two three");
    s = applyKey(s, "b", META).state; s = applyKey(s, "b", META).state;   // cursor before "two"
    const r = applyKey(s, "", { delete: true, meta: true });
    expect(text(r.state)).toBe("one ");
    expect(r.killed).toEqual({ text: "two three", dir: "append" });
  });
});

describe("CM14 ctrl+a/ctrl+e are start/end of the LOGICAL line", () => {
  // Our buffer is already unwrapped logical lines, so today's behavior IS upstream's — pin it so a future
  // visual-line refactor cannot silently redefine these two keys.
  it("moves within the current logical line of a multi-line buffer, never to the buffer edge", () => {
    let s = type(initialEditorState(), "alpha\nbravo\ncharlie");
    s = applyKey(s, "p", CTRL).state;                             // row 1
    s = applyKey(s, "a", CTRL).state;
    expect(s.cursor).toEqual({ row: 1, col: 0 });
    s = applyKey(s, "e", CTRL).state;
    expect(s.cursor).toEqual({ row: 1, col: 5 });
  });
});

describe("CM17 undo coalescing (upstream debounceMs 1000, maxBufferSize 50)", () => {
  it("changes inside the window fold into one entry; one past it pushes a second", () => {
    let s = applyKey(initialEditorState(), "a", {}, 0).state;
    expect(s.undo.length).toBe(1);
    s = applyKey(s, "b", {}, 500).state;                          // < 1000 ms after the push → coalesced
    expect(s.undo.length).toBe(1);
    s = applyKey(s, "c", {}, 999).state;
    expect(s.undo.length).toBe(1);
    expect(text(s)).toBe("abc");
    s = applyKey(s, "d", {}, 2000).state;                         // past the window → a second entry
    expect(s.undo.length).toBe(2);
    expect(s.undo[1].at).toBe(2000);
  });
  it("undo after a rapid typing run reverts the WHOLE run (the deliberate divergence from the timer)", () => {
    let s = applyKey(initialEditorState(), "h", {}, 0).state;
    for (const [i, ch] of [..."ello"].entries()) s = applyKey(s, ch, {}, 100 * (i + 1)).state;
    expect(text(s)).toBe("hello");
    s = applyKey(s, "\x1f", {}).state;
    expect(s.lines).toEqual([""]);
  });
  it("caps at 50 entries (was 100)", () => {
    expect(UNDO_CAP).toBe(50);
    expect(UNDO_COALESCE_MS).toBe(1000);
    let s = initialEditorState();
    for (let i = 0; i < 51; i++) s = applyKey(s, "x", {}, (i + 1) * (UNDO_COALESCE_MS + 1)).state;
    expect(s.undo.length).toBe(50);
    expect(text(s)).toBe("x".repeat(51));
  });
  it("an entry carries the pastedContents of the buffer it snapshots, and Ctrl-_ restores them", () => {
    const chips = { 1: { id: 1, type: "text" as const, content: "a long pasted blob", lineCount: 12 } };
    let s: EditorState = { ...typeSpaced(initialEditorState(), "ab"), pastedContents: chips, pasteCounter: 1 };
    s = applyKey(s, "c", {}, 10_000).state;
    expect(s.undo[s.undo.length - 1].pastedContents).toEqual(chips);
    const chipsGone = { ...s, pastedContents: {} };               // e.g. the chip's placeholder was deleted
    const undone = applyKey(chipsGone, "\x1f", {}).state;
    expect(text(undone)).toBe("ab");
    expect(undone.pastedContents).toEqual(chips);                 // the pop restores the map with the text
  });
});

describe("CM18 backslash-Enter continues from the CURSOR, not the line end (bundle L395679)", () => {
  it("`a\\b` with the cursor right after the backslash eats it and splits mid-line", () => {
    let s = type(initialEditorState(), "a\\b");
    s = applyKey(s, "", { leftArrow: true }).state;               // cursor between `\` and `b`
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBeUndefined();                             // a continuation, not a send
    expect(r.state.lines).toEqual(["a", "b"]);
    expect(r.state.cursor).toEqual({ row: 1, col: 0 });
    expect(r.state.hasUsedBackslashReturn).toBe(true);
  });
  it("a trailing backslash still continues (the end-of-line case is the same rule)", () => {
    const s = type(initialEditorState(), "keep going\\");
    const r = applyKey(s, "", { return: true });
    expect(r.state.lines).toEqual(["keep going", ""]);
    expect(r.state.hasUsedBackslashReturn).toBe(true);
  });
  it("a backslash NOT before the cursor does not continue — it submits", () => {
    let s = type(initialEditorState(), "a\\b");
    const r = applyKey(s, "", { return: true });                  // cursor at the end, `b` before it
    expect(r.submit).toBe("a\\b");
    expect(r.state.hasUsedBackslashReturn).toBe(false);
  });
  // `ae` (L395679) tests the `\`-continuation BEFORE `meta || shift`; we had it the other way round, so
  // shift+Return on a buffer ending in `\` inserted a newline UNDER the backslash and never set the flag
  // (t2 review, Minor).
  it("shift+Return on a trailing backslash is the CONTINUATION, not a plain newline", () => {
    const s = type(initialEditorState(), "foo\\");
    const r = applyKey(s, "", { return: true, shift: true });
    expect(r.submit).toBeUndefined();
    expect(r.state.lines).toEqual(["foo", ""]);                   // the backslash is eaten
    expect(r.state.hasUsedBackslashReturn).toBe(true);
    // …and with no backslash before the cursor, shift+Return is still the plain newline.
    const plain = applyKey(type(initialEditorState(), "foo"), "", { return: true, shift: true });
    expect(plain.state.lines).toEqual(["foo", ""]);
    expect(plain.state.hasUsedBackslashReturn).toBe(false);
  });
  it("the flag survives a submit and an Esc-Esc clear (upstream persists it globally)", () => {
    let s = type(initialEditorState(), "x\\");
    s = applyKey(s, "", { return: true }).state;
    expect(s.hasUsedBackslashReturn).toBe(true);
    const sent = applyKey(type(s, "hi"), "", { return: true });   // the continuation left "x\n" in the buffer
    expect(sent.submit).toBe("x\nhi");
    expect(sent.state.hasUsedBackslashReturn).toBe(true);
    expect(clearToHistory(type(sent.state, "draft")).hasUsedBackslashReturn).toBe(true);
  });
});

describe("paste chips die with the buffer (Task 3 fills the map; the shape is pinned now)", () => {
  const chips = { 1: { id: 1, type: "text" as const, content: "blob", lineCount: 4 } };
  it("a fresh state starts empty", () => {
    const s = initialEditorState();
    expect(s.pastedContents).toEqual({});
    expect(s.pasteCounter).toBe(0);
    expect(s.hasUsedBackslashReturn).toBe(false);
  });
  it("submit, Esc-Esc clear, and an outside replacement all drop them", () => {
    const s = { ...type(initialEditorState(), "hello"), pastedContents: chips, pasteCounter: 1 };
    expect(applyKey(s, "", { return: true }).state.pastedContents).toEqual({});
    expect(clearToHistory(s).pastedContents).toEqual({});
    expect(withBufferText(s, "other").pastedContents).toEqual({});
  });
});
