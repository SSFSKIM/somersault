// tui/test/editor.test.ts — pure editor-reducer units. Probe 17d7116: a paste arrives as one `input` with
// embedded \n; submit = a lone key.return; `\`+Enter = continuation.
import { describe, it, expect } from "vitest";
import { applyKey, initialEditorState, stripPasteMarkers, type EditorState, type KeyFlags } from "../src/editor.js";
import { setMentionFiles } from "../src/editor.js";

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
