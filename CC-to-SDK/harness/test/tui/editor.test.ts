// tui/test/editor.test.ts — pure editor-reducer units. Probe 17d7116: a paste arrives as one `input` with
// embedded \n; submit = a lone key.return; `\`+Enter = continuation.
import { describe, it, expect } from "vitest";
import { applyKey, initialEditorState, setMentionFiles, setCommandCatalog, stripPasteMarkers, inputMode, withBufferText, type EditorState, type KeyFlags } from "../../src/tui/editor.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";

const type = (s: EditorState, text: string): EditorState => applyKey(s, text, {}).state;
const press = (s: EditorState, key: KeyFlags): EditorState => applyKey(s, "", key).state;
const text = (s: EditorState): string => s.lines.join("\n");

describe("editor core", () => {
  it("inserts characters and tracks the cursor", () => {
    let s = initialEditorState();
    s = type(s, "h"); s = type(s, "i");
    expect(text(s)).toBe("hi");
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });
  it("inserts a multi-line paste as one input, splitting on \\n", () => {
    let s = initialEditorState();
    s = type(s, "a\nb\nc");                       // probe: a paste is a single input call
    expect(s.lines).toEqual(["a", "b", "c"]);
    expect(s.cursor).toEqual({ row: 2, col: 1 });
  });
  it("strips bracketed-paste markers before inserting", () => {
    expect(stripPasteMarkers("\x1b[200~hi\x1b[201~")).toBe("hi");
    expect(stripPasteMarkers("[200~hi[201~")).toBe("hi");          // ESC-stripped leak (probe case D)
    let s = type(initialEditorState(), "\x1b[200~x\x1b[201~");
    expect(text(s)).toBe("x");
  });
  it("backspace deletes left and joins lines at column 0", () => {
    let s = type(initialEditorState(), "ab");
    s = press(s, { backspace: true });
    expect(text(s)).toBe("a");
    s = initialEditorState(); s = type(s, "a\nb");                  // cursor at {1,1}
    s = press(s, { leftArrow: true });                             // cursor {1,0}
    s = press(s, { backspace: true });                             // join: "ab"
    expect(s.lines).toEqual(["ab"]);
    expect(s.cursor).toEqual({ row: 0, col: 1 });
  });
  it("Enter submits the joined buffer and resets, recording history", () => {
    let s = type(initialEditorState(), "hello");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("hello");
    expect(r.state.lines).toEqual([""]);                            // reset
    expect(r.state.history).toEqual(["hello"]);                     // recorded
  });
  it("ignores a whitespace-only submit", () => {
    const r = applyKey(type(initialEditorState(), "   "), "", { return: true });
    expect(r.submit).toBeUndefined();
  });
  it("`\\`+Enter inserts a newline (continuation) instead of submitting", () => {
    let s = type(initialEditorState(), "foo\\");                    // line ends with a backslash
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(r.state.lines).toEqual(["foo", ""]);
    expect(r.state.cursor).toEqual({ row: 1, col: 0 });
  });
  it("Left/Right move the cursor, wrapping across lines", () => {
    let s = type(initialEditorState(), "a\nb");                     // cursor {1,1}
    s = press(s, { leftArrow: true });                             // {1,0}
    s = press(s, { leftArrow: true });                             // wrap to {0,1}
    expect(s.cursor).toEqual({ row: 0, col: 1 });
    s = press(s, { rightArrow: true });                            // {1,0}
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });
});

describe("editor composer prefill", () => {
  it("withBufferText replaces the buffer and puts the cursor at the end (rewind's edit-and-resend prefill)", () => {
    const s = withBufferText(initialEditorState(), "a\nb");
    expect(s.lines).toEqual(["a", "b"]);
    expect(s.cursor).toEqual({ row: 1, col: 1 });
  });
});

describe("editor history", () => {
  const withHistory = (h: string[]) => initialEditorState(h);
  it("Up on the first line recalls the previous prompt; Down returns toward the draft", () => {
    let s = withHistory(["first", "second"]);
    s = type(s, "draft");                                          // a live draft
    s = press(s, { upArrow: true });                              // newest
    expect(text(s)).toBe("second");
    s = press(s, { upArrow: true });                              // older
    expect(text(s)).toBe("first");
    s = press(s, { upArrow: true });                              // clamp at oldest
    expect(text(s)).toBe("first");
    s = press(s, { downArrow: true });                            // newer
    expect(text(s)).toBe("second");
    s = press(s, { downArrow: true });                            // past newest → restore draft
    expect(text(s)).toBe("draft");
  });
  it("does not recall history when the cursor is on an interior line (moves the cursor instead)", () => {
    let s = type(initialEditorState(), "a\nb\nc");                 // 3 lines, cursor {2,1}
    s = press(s, { upArrow: true });                              // interior move, not history
    expect(s.cursor.row).toBe(1);
    expect(text(s)).toBe("a\nb\nc");
  });
});

describe("editor @-mention", () => {
  const open = () => {                                             // open a mention with two candidate files
    let s = type(initialEditorState(), "@");
    s = setMentionFiles(s, ["src/app.ts", "src/util/fs.ts"]);
    return s;
  };
  it("opens a mention on '@' at a word boundary and lists files", () => {
    const s = open();
    expect(s.mention).not.toBeNull();
    expect(s.mention!.items.length).toBe(2);
  });
  it("does NOT open a mention when '@' follows a non-space character", () => {
    let s = type(initialEditorState(), "a");
    s = type(s, "@");
    expect(s.mention).toBeNull();
  });
  it("filters the candidate list as the query is typed", () => {
    let s = open();
    s = type(s, "fs");                                             // query "fs"
    expect(s.mention!.query).toBe("fs");
    expect(s.mention!.items[0].path).toBe("src/util/fs.ts");
  });
  it("Up/Down move the highlight; Enter accepts the highlighted path and closes", () => {
    let s = open();
    s = press(s, { downArrow: true });                            // highlight index 1
    expect(s.mention!.index).toBe(1);
    const r = applyKey(s, "", { return: true });                 // accept (not submit)
    expect(r.submit).toBeUndefined();
    expect(r.state.mention).toBeNull();
    expect(text(r.state)).toBe("@src/util/fs.ts ");               // inserted token + trailing space
  });
  it("Esc closes the mention but keeps the typed text", () => {
    let s = open(); s = type(s, "ap");
    s = press(s, { escape: true });
    expect(s.mention).toBeNull();
    expect(text(s)).toBe("@ap");
  });
  it("backspacing past the '@' anchor closes the mention", () => {
    let s = open();                                               // buffer "@", cursor after @
    s = press(s, { backspace: true });                           // deletes the '@'
    expect(s.mention).toBeNull();
    expect(text(s)).toBe("");
  });
});

describe("editor / command palette", () => {
  const CAT: CommandEntry[] = [
    { name: "brainstorming", description: "plan a feature", source: "catalog" },
    { name: "review", description: "review code", source: "catalog" },
    { name: "model", description: "switch model", source: "local" },
  ];
  const open = () => setCommandCatalog(type(initialEditorState(), "/"), CAT);
  it("opens a command popup on a buffer-leading '/' and lists the catalog", () => {
    const s = open();
    expect(s.command).not.toBeNull();
    expect(s.command!.items.length).toBe(3);
  });
  it("does NOT open a command when '/' is not at buffer start", () => {
    let s = type(initialEditorState(), "a"); s = type(s, "/");
    expect(s.command).toBeNull();
  });
  it("filters the catalog as the query is typed", () => {
    let s = open(); s = type(s, "rev");
    expect(s.command!.query).toBe("rev");
    expect(s.command!.items[0].name).toBe("review");
  });
  it("Tab completes the highlighted command name and closes the popup", () => {
    let s = open(); s = type(s, "br");
    s = press(s, { tab: true });
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/brainstorming ");
  });
  it("Enter on an open command submits '/name' (runs it)", () => {
    let s = open(); s = type(s, "br");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("/brainstorming");
    expect(r.state.command).toBeNull();
  });
  it("a space ends the command name and closes the popup (now typing args)", () => {
    let s = open(); s = type(s, "review"); s = type(s, " ");
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/review ");
  });
  it("Esc closes the command popup but keeps the typed text", () => {
    let s = open(); s = type(s, "re"); s = press(s, { escape: true });
    expect(s.command).toBeNull();
    expect(text(s)).toBe("/re");
  });
  it("Up/Down move the command highlight", () => {
    let s = open(); s = press(s, { downArrow: true });
    expect(s.command!.index).toBe(1);
  });
  it("the whole catalog is reachable by arrow keys — not just the visible window", () => {
    // The popup renders a scrolling 8-row window, but the SELECTION is clamped to items.length. Ranking
    // the catalog down to 8 entries therefore made everything past the 8th unreachable: the real catalog
    // is ~105 commands and users could only ever see the top few.
    const big: CommandEntry[] = Array.from({ length: 20 }, (_, i) => ({ name: `cmd${String(i).padStart(2, "0")}`, description: "", source: "catalog" }));
    let s = setCommandCatalog(type(initialEditorState(), "/"), big);
    expect(s.command!.items.length).toBe(20);
    for (let i = 0; i < 19; i++) s = press(s, { downArrow: true });
    expect(s.command!.index).toBe(19);
    expect(s.command!.items[s.command!.index].name).toBe("cmd19");
    s = press(s, { tab: true });
    expect(text(s)).toBe("/cmd19 ");                                  // the last entry is selectable, not just visible
  });
  it("the @-mention path still works (regression)", () => {
    let s = type(initialEditorState(), "@"); s = setMentionFiles(s, ["a.ts", "b.ts"]);
    expect(s.mention!.items.length).toBe(2);
    expect(s.command).toBeNull();
  });
  it("backspacing past the leading '/' closes the command popup", () => {
    let s = open(); s = type(s, "re");          // "/re" — command open
    s = press(s, { backspace: true });          // "/r"
    s = press(s, { backspace: true });          // "/"
    expect(s.command).not.toBeNull();           // still open at the bare "/"
    s = press(s, { backspace: true });          // "" — leading slash gone
    expect(s.command).toBeNull();
    expect(text(s)).toBe("");
  });
});

describe("readline keys (ctrl)", () => {
  const ctrl = (s: EditorState, ch: string): EditorState => applyKey(s, ch, { ctrl: true }).state;
  it("Ctrl-A / Ctrl-E jump to line start / end", () => {
    let s = type(initialEditorState(), "hello");
    s = ctrl(s, "a"); expect(s.cursor.col).toBe(0);
    s = ctrl(s, "e"); expect(s.cursor.col).toBe(5);
  });
  it("Ctrl-K kills to end of line", () => {
    let s = type(initialEditorState(), "hello world"); s = ctrl(s, "a"); s = applyKey(s, "", { rightArrow: true }).state;  // col 1
    for (let i = 0; i < 5; i++) s = applyKey(s, "", { rightArrow: true }).state;   // col 6 (after "hello ")
    s = ctrl(s, "k"); expect(text(s)).toBe("hello ");
  });
  it("Ctrl-U kills to start of line", () => {
    let s = type(initialEditorState(), "hello"); s = ctrl(s, "u");
    expect(text(s)).toBe(""); expect(s.cursor.col).toBe(0);
  });
  it("Ctrl-W kills the previous word", () => {
    let s = type(initialEditorState(), "foo bar baz"); s = ctrl(s, "w");
    expect(text(s)).toBe("foo bar "); expect(s.cursor.col).toBe(8);
    s = ctrl(s, "w"); expect(text(s)).toBe("foo ");
  });
  it("an unhandled ctrl combo (e.g. Ctrl-L) never inserts a character", () => {
    const s = ctrl(initialEditorState(), "l");
    expect(text(s)).toBe("");
  });
  it("Ctrl-A in a /command line closes the popup (cursor left the token)", () => {
    let s = type(initialEditorState(), "/"); s = type(s, "model");   // "/" opens the popup, then chars refresh it
    expect(s.command).not.toBeNull();
    s = ctrl(s, "a"); expect(s.command).toBeNull();
  });
});

describe("word movement (Alt/Option)", () => {
  const meta = (s: EditorState, input: string, extra: KeyFlags = {}): EditorState => applyKey(s, input, { meta: true, ...extra }).state;
  it("Alt-Left steps back a word at a time, then stops at col 0", () => {
    let s = type(initialEditorState(), "hello world");            // cursor {0,11}
    s = meta(s, "", { leftArrow: true });
    expect(s.cursor).toEqual({ row: 0, col: 6 });                  // start of "world"
    s = meta(s, "", { leftArrow: true });
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });
  it("Alt-Left at col 0 of a later row crosses to the end of the row above", () => {
    let s = type(initialEditorState(), "ab\ncd");                  // cursor {1,2}
    s = press(s, { leftArrow: true });                            // {1,1}
    s = press(s, { leftArrow: true });                            // {1,0}
    s = meta(s, "", { leftArrow: true });
    expect(s.cursor).toEqual({ row: 0, col: 2 });                  // end of "ab"
  });
  it("Alt-Right steps forward a word at a time (mirrors Alt-Left)", () => {
    let s = type(initialEditorState(), "hello world");
    s = applyKey(s, "a", { ctrl: true }).state;                   // Ctrl-A → col 0
    expect(s.cursor.col).toBe(0);
    s = meta(s, "", { rightArrow: true });
    expect(s.cursor).toEqual({ row: 0, col: 5 });
    s = meta(s, "", { rightArrow: true });
    expect(s.cursor).toEqual({ row: 0, col: 11 });
  });
  it("Alt-Right at end of an earlier row crosses to col 0 of the row below", () => {
    let s = type(initialEditorState(), "ab\ncd");                  // cursor {1,2}
    s = press(s, { upArrow: true });                              // {0,2} — end of "ab" (col clamped)
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    s = meta(s, "", { rightArrow: true });
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });
  it('Alt-b / Alt-f (meta + input "b"/"f") behave identically to Alt-Left/Right', () => {
    let s = type(initialEditorState(), "hello world");
    s = meta(s, "b");
    expect(s.cursor).toEqual({ row: 0, col: 6 });
    s = applyKey(s, "a", { ctrl: true }).state;                   // back to col 0
    s = meta(s, "f");
    expect(s.cursor).toEqual({ row: 0, col: 5 });
  });
  it("an unrecognized meta combo is a no-op — never inserts a character or moves the cursor", () => {
    let s = type(initialEditorState(), "hi");                     // cursor {0,2}
    s = meta(s, "x");
    expect(text(s)).toBe("hi");
    expect(s.cursor).toEqual({ row: 0, col: 2 });
    s = meta(s, "", { upArrow: true });                           // meta+other-key combos are no-ops too
    expect(text(s)).toBe("hi");
    expect(s.cursor).toEqual({ row: 0, col: 2 });
  });
  it("an unrecognized meta combo (meta + input \"q\") still inserts nothing", () => {
    const s = meta(type(initialEditorState(), "hi"), "q");
    expect(text(s)).toBe("hi");
  });
});

// Regression coverage for a bug that shipped because the old press()/meta() helpers never modeled Ink's real
// key shape: Ink sets key.meta on a BARE Escape and on ESC-prefixed backspace/delete, not only on genuine
// Alt combos (ink/build/hooks/use-input.js: meta = keypress.meta || keypress.name === "escape" || keypress.option).
// These tests use that realistic shape so a regression of the too-broad `if (key.meta)` branch fails here.
describe("meta co-occurring with escape/backspace (Ink's real key shape)", () => {
  it("Escape delivered as {meta:true, escape:true} still closes an open '/' command popup", () => {
    const s = type(initialEditorState(), "/");
    expect(s.command).not.toBeNull();
    const r = applyKey(s, "", { meta: true, escape: true });
    expect(r.state.command).toBeNull();
  });
  it("Escape delivered as {meta:true, escape:true} still closes an open '@' mention popup", () => {
    let s = type(initialEditorState(), "@");
    s = setMentionFiles(s, ["a.ts", "b.ts"]);
    expect(s.mention).not.toBeNull();
    const r = applyKey(s, "", { meta: true, escape: true });
    expect(r.state.mention).toBeNull();
  });
  it("Backspace delivered as {meta:true, backspace:true} (Alt-Backspace/ESC-backspace) still deletes a character", () => {
    const s = type(initialEditorState(), "ab");
    const r = applyKey(s, "", { meta: true, backspace: true });
    expect(text(r.state)).toBe("a");
  });
});

describe("Wave-1 keymap: clear input, newline, undo, stash", () => {
  // Shadows the file's single-shot `type` (one applyKey call for the whole string): undo is snapshot-per-key,
  // so stepping back "one keystroke at a time" requires one applyKey call per character.
  const type = (s: EditorState, text: string) => [...text].reduce((st, ch) => applyKey(st, ch, {}).state, s);

  it("Ctrl-L clears the buffer (input, not screen) and Ctrl-_ restores it", () => {
    let s = type(initialEditorState(), "hello world");
    s = applyKey(s, "l", { ctrl: true }).state;
    expect(s.lines).toEqual([""]);
    s = applyKey(s, "_", { ctrl: true }).state;
    expect(s.lines).toEqual(["hello world"]);
    expect(s.cursor).toEqual({ row: 0, col: 11 });
  });

  it("Ctrl-J inserts a newline at the cursor", () => {
    let s = type(initialEditorState(), "ab");
    s = applyKey(s, "", { leftArrow: true }).state;
    s = applyKey(s, "j", { ctrl: true }).state;
    expect(s.lines).toEqual(["a", "b"]);
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });

  it("undo steps back one keystroke at a time; Ctrl-- is the same undo", () => {
    let s = type(initialEditorState(), "abc");
    s = applyKey(s, "_", { ctrl: true }).state;
    expect(s.lines).toEqual(["ab"]);
    s = applyKey(s, "-", { ctrl: true }).state;
    expect(s.lines).toEqual(["a"]);
  });

  it("Ctrl-S stashes a non-empty buffer; Ctrl-S on an empty buffer restores it", () => {
    let s = type(initialEditorState(), "draft prompt");
    s = applyKey(s, "s", { ctrl: true }).state;
    expect(s.lines).toEqual([""]);
    expect(s.stashed).toBe("draft prompt");
    s = applyKey(s, "s", { ctrl: true }).state;
    expect(s.lines).toEqual(["draft prompt"]);
    expect(s.stashed).toBeNull();
  });

  it("undo snapshots cap at 100", () => {
    let s = initialEditorState();
    for (let i = 0; i < 120; i++) s = applyKey(s, "x", {}).state;
    expect(s.undo.length).toBe(100);
  });

  it("submit resets the undo stack but the STASH SURVIVES the send (2.1.220 chat:stash — park a draft, fire a question, restore)", () => {
    let s = type(initialEditorState(), "long draft I want to keep");
    s = applyKey(s, "s", { ctrl: true }).state;              // park the draft
    s = type(s, "quick question");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("quick question");
    expect(r.state.undo).toEqual([]);                        // undo dies with the buffer
    expect(r.state.stashed).toBe("long draft I want to keep");
    const restored = applyKey(r.state, "s", { ctrl: true }).state;   // Ctrl-S on the fresh empty buffer
    expect(restored.lines).toEqual(["long draft I want to keep"]);
    expect(restored.stashed).toBeNull();
  });
});

describe("inputMode", () => {
  it("a leading ! = bash, # = memory, else normal", () => {
    expect(inputMode(type(initialEditorState(), "!ls -a"))).toBe("bash");
    expect(inputMode(type(initialEditorState(), "#remember this"))).toBe("memory");
    expect(inputMode(type(initialEditorState(), "hello"))).toBe("normal");
    expect(inputMode(initialEditorState())).toBe("normal");
  });
  it("an open / or @ popup suppresses the prefix mode", () => {
    const cmd = type(initialEditorState(), "/");   // command popup open
    expect(inputMode(cmd)).toBe("normal");
  });
});

describe("undo snapshots track CONTENT, not array identity", () => {
  // killToEnd/killToStart/clearInput all allocate a fresh `lines` array unconditionally, so an identity
  // check called these no-ops "changes" and snapshotted the buffer onto itself — Ctrl-_ then restored
  // identical text and looked broken.
  it("Ctrl-K at end of line pushes no undo entry", () => {
    const s = type(initialEditorState(), "hello");        // cursor already at end
    expect(applyKey(s, "k", { ctrl: true }).state.undo.length).toBe(s.undo.length);
  });
  it("Ctrl-U at column 0 pushes no undo entry", () => {
    let s = type(initialEditorState(), "hello");
    s = applyKey(s, "a", { ctrl: true }).state;            // Ctrl-A → column 0
    expect(applyKey(s, "u", { ctrl: true }).state.undo.length).toBe(s.undo.length);
  });
  it("Ctrl-L on an already-empty buffer pushes no undo entry", () => {
    expect(applyKey(initialEditorState(), "l", { ctrl: true }).state.undo.length).toBe(0);
  });
  it("still snapshots when the keypress genuinely changes the text", () => {
    const s = type(initialEditorState(), "hello");
    const killed = applyKey(applyKey(s, "a", { ctrl: true }).state, "k", { ctrl: true }).state;
    expect(killed.lines).toEqual([""]);
    expect(killed.undo.length).toBe(s.undo.length + 1);   // a real edit is still undoable
  });
});

describe("kill ring (CM10/CM11)", () => {
  const CTRL = { ctrl: true };
  const type = (s: EditorState, text: string) => [...text].reduce((st, ch) => applyKey(st, ch, {}).state, s);
  it("ctrl+u kills the line into the ring and ctrl+y restores it verbatim (F0 acceptance 3)", () => {
    let s = type(initialEditorState(), "hello world");
    const killed = applyKey(s, "u", CTRL);
    expect(killed.killed).toEqual({ text: "hello world", dir: "prepend" });
    expect(killed.state.lines).toEqual([""]);
    const yanked = applyKey(killed.state, "y", CTRL).state;
    expect(yanked.lines).toEqual(["hello world"]);
    expect(yanked.cursor).toEqual({ row: 0, col: 11 });
  });
  it("consecutive kills coalesce with direction: ctrl+k then ctrl+u rebuilds the whole line as ONE entry", () => {
    let s = type(initialEditorState(), "hello world");
    s = { ...s, cursor: { row: 0, col: 5 } };
    s = applyKey(s, "k", CTRL).state;            // kills " world" (append)
    s = applyKey(s, "u", CTRL).state;            // kills "hello" (prepend) into the SAME entry
    expect(s.killRing).toEqual(["hello world"]);
    expect(applyKey(s, "y", CTRL).state.lines).toEqual(["hello world"]);
  });
  it("a no-op kill never breaks the run: kill, no-op kill, kill still coalesces into ONE entry", () => {
    let s = type(initialEditorState(), "hello world");
    s = { ...s, cursor: { row: 0, col: 5 } };
    s = applyKey(s, "k", CTRL).state;            // kills " world" (append) — line is now "hello", cursor col 5
    s = applyKey(s, "k", CTRL).state;            // ctrl+k at end of line: kills nothing, must NOT end the run
    s = applyKey(s, "u", CTRL).state;            // kills "hello" (prepend) — must still coalesce into the same entry
    expect(s.killRing).toEqual(["hello world"]);
  });
  it("a yank ends the kill run: kill, yank, kill = TWO ring entries (upstream mode 'yanked', cli.pretty.js:394640-394652)", () => {
    let s = type(initialEditorState(), "abc");
    s = applyKey(s, "u", CTRL).state;            // ring: ["abc"], run active
    s = applyKey(s, "y", CTRL).state;            // yank — upstream leaves 'killing' mode here
    s = applyKey(s, "u", CTRL).state;            // must start a FRESH entry, not coalesce into "abcabc"
    expect(s.killRing).toEqual(["abc", "abc"]);
  });
  it("a non-kill keystroke ends the run: two separated kills are two ring entries; alt+y cycles between them", () => {
    let s = type(initialEditorState(), "one");
    s = applyKey(s, "u", CTRL).state;            // ring: ["one"]
    s = type(s, "two");                          // breaks the run
    s = applyKey(s, "u", CTRL).state;            // ring: ["one", "two"]
    expect(s.killRing).toEqual(["one", "two"]);
    s = applyKey(s, "y", CTRL).state;            // yanks "two"
    expect(s.lines).toEqual(["two"]);
    s = applyKey(s, "y", { meta: true }).state;  // alt+y → replaces with "one"
    expect(s.lines).toEqual(["one"]);
    s = applyKey(s, "y", { meta: true }).state;  // cycles back to "two"
    expect(s.lines).toEqual(["two"]);
  });
  it("alt+y without a preceding yank is a no-op, and any keystroke after a yank fixes it (no late pop)", () => {
    let s = type(initialEditorState(), "abc");
    expect(applyKey(s, "y", { meta: true }).state.lines).toEqual(["abc"]);
    s = applyKey(s, "u", CTRL).state;
    s = applyKey(s, "y", CTRL).state;            // yank
    s = type(s, "!");                            // fixes the yank
    expect(applyKey(s, "y", { meta: true }).state.lines).toEqual(["abc!"]);
  });
  it("an empty kill deposits nothing into the ring", () => {
    const s = initialEditorState();
    expect(applyKey(s, "k", CTRL).killed).toBeUndefined();
    expect(applyKey(s, "k", CTRL).state.killRing).toEqual([]);
  });
  it("the ring caps at exactly 10, dropping the oldest entries first", () => {
    let s = initialEditorState();
    const kills = Array.from({ length: 12 }, (_, i) => `kill${i}`);
    for (const t of kills) { s = type(s, t); s = applyKey(s, "u", CTRL).state; }   // 12 distinct, un-coalesced kills (typing between them breaks the run each time)
    expect(s.killRing.length).toBe(10);
    expect(s.killRing).toEqual(kills.slice(-10));                 // the two oldest (kill0, kill1) fell off the front
    expect(s.killRing[0]).toBe(kills[kills.length - 10]);         // oldest survivor = the 10th-most-recent kill pushed (kill2)
  });
  it("ctrl+y with an empty kill ring is a no-op", () => {
    const s = initialEditorState();
    const r = applyKey(s, "y", CTRL);
    expect(r.state.lines).toEqual([""]);
    expect(r.state.cursor).toEqual({ row: 0, col: 0 });
    expect(r.state.yankSite).toBeNull();
  });
  it("the kill ring survives a submit (like the stash)", () => {
    let s = type(initialEditorState(), "keep me");
    s = applyKey(s, "u", CTRL).state;
    s = type(s, "send this");
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("send this");
    expect(r.state.killRing).toEqual(["keep me"]);
  });
});
