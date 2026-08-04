// tui/test/paste-chips.test.ts — F5 task 3: paste ingestion. The pins here are transcribed from the 2.1.220
// bundle, not invented: `k0` (L495741) for the normalisation order and the rows-aware chip threshold, `kmt`
// (L317378) for what counts as a line, `agr` (L317383) for the placeholder grammar, `KF` (L317394) for the
// recognizer and `fSe` (L317403) for the submit-time expansion.
import { describe, it, expect } from "vitest";
import { applyKey, initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { CHIP_CHARS, CHIP_RE, chipLabel, chipSpans, ingestPaste, newlineCount, newlineThreshold, normalizePaste, stripANSI, substituteChips } from "../../src/tui/pasteChips.js";

const text = (s: EditorState) => s.lines.join("\n");
const paste = (s: EditorState, raw: string, rows?: number) => applyKey(s, raw, { paste: true }, Date.now(), rows);

describe("normalizePaste — k0's three steps, in k0's order", () => {
  it("strips SGR colour runs", () => { expect(normalizePaste("\x1b[31mred\x1b[0m")).toBe("red"); });
  it("strips an OSC 8 hyperlink (BEL- and ST-terminated)", () => {
    expect(normalizePaste("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe("link");
    expect(normalizePaste("\x1b]0;title\x1b\\body")).toBe("body");
  });
  it("strips the bracketed-paste markers themselves (they are CSI sequences)", () => {
    expect(normalizePaste("\x1b[200~payload\x1b[201~")).toBe("payload");
  });
  it("folds CRLF and lone CR to LF", () => { expect(normalizePaste("a\r\nb\rc\nd")).toBe("a\nb\nc\nd"); });
  it("expands every tab to four spaces", () => { expect(normalizePaste("a\tb\t")).toBe("a    b    "); });
  it("is idempotent (the editor normalises once for afterInsert and once inside ingestPaste)", () => {
    const once = normalizePaste("\x1b[1ma\r\n\tb");
    expect(normalizePaste(once)).toBe(once);
  });
  it("leaves ordinary text untouched", () => { expect(normalizePaste("hello world")).toBe("hello world"); });
});

describe("stripANSI", () => {
  it("covers CSI, OSC and the two-byte Fe escapes", () => {
    expect(stripANSI("\x1b[2J\x1b[H\x1b]2;t\x07\x1bMx")).toBe("x");
  });
  it("never eats a bare ESC-less string", () => { expect(stripANSI("a[31mb")).toBe("a[31mb"); });
});

describe("newlineThreshold — max(0, min(rows - 10, 2))", () => {
  it("saturates at 2 on any normal terminal", () => { for (const r of [12, 24, 80]) expect(newlineThreshold(r)).toBe(2); });
  it("tightens on a short terminal", () => { expect(newlineThreshold(11)).toBe(1); expect(newlineThreshold(10)).toBe(0); });
  it("never goes negative", () => { expect(newlineThreshold(3)).toBe(0); expect(newlineThreshold(0)).toBe(0); });
});

describe("kmt — a line is a newline MATCH, not a visual row", () => {
  it("counts 40 newlines as 40 (a 40-line paste with no trailing newline is 39)", () => {
    expect(newlineCount("x\n".repeat(40))).toBe(40);
    expect(newlineCount(Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n"))).toBe(39);
  });
  it("counts CRLF as one", () => { expect(newlineCount("a\r\nb")).toBe(1); });
});

describe("chipLabel — agr", () => {
  it("omits the line suffix at zero", () => { expect(chipLabel(1, 0)).toBe("[Pasted text #1]"); });
  it("prints +N lines otherwise", () => { expect(chipLabel(2, 40)).toBe("[Pasted text #2 +40 lines]"); });
});

describe("CHIP_RE / chipSpans — the KF recognizer", () => {
  it("recognizes all four placeholder species", () => {
    const line = "a [Pasted text #1] b [Image #2] c [Audio #3] d [...Truncated text #4 +9 lines] e";
    expect(chipSpans(line).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
  it("drops id 0 (KF's `.filter(n => n.id > 0)`)", () => { expect(chipSpans("[Pasted text #0]")).toEqual([]); });
  it("spans the whole placeholder", () => {
    const line = "x[Pasted text #7 +3 lines]y";
    expect(chipSpans(line)).toEqual([{ start: 1, end: line.length - 1, id: 7 }]);
  });
  it("is exported with a lastIndex that stays 0 across calls", () => {
    chipSpans("[Pasted text #1]"); chipSpans("[Pasted text #2]");
    expect(CHIP_RE.lastIndex).toBe(0);
  });
});

describe("ingestPaste — CM21's threshold", () => {
  it("chips a >800-char paste and stores it under a fresh id", () => {
    const s = ingestPaste(initialEditorState(), "x".repeat(CHIP_CHARS + 100), 24);
    expect(text(s)).toBe("[Pasted text #1]");
    expect(s.pasteCounter).toBe(1);
    expect(s.pastedContents[1]).toEqual({ id: 1, type: "text", content: "x".repeat(900), lineCount: 0 });
    expect(s.cursor).toEqual({ row: 0, col: "[Pasted text #1]".length });
  });
  it("chips a 3-newline paste at rows 24 with a +3 lines label", () => {
    const s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    expect(text(s)).toBe("[Pasted text #1 +3 lines]");
    expect(s.pastedContents[1].content).toBe("a\nb\nc\nd");
    expect(s.pastedContents[1].lineCount).toBe(3);
  });
  it("inserts a 2-newline short paste verbatim and burns no id", () => {
    const s = ingestPaste(initialEditorState(), "a\r\nb\nc", 24);
    expect(s.lines).toEqual(["a", "b", "c"]);
    expect(s.pasteCounter).toBe(0);
    expect(s.pastedContents).toEqual({});
  });
  it("chips a 1-newline paste on a 10-row terminal (threshold 0)", () => {
    const s = ingestPaste(initialEditorState(), "a\nb", 10);
    expect(text(s)).toBe("[Pasted text #1 +1 lines]");
  });
  it("defaults to 24 rows when the composer cannot say", () => {
    expect(text(ingestPaste(initialEditorState(), "a\nb"))).toBe("a\nb");
  });
  it("stores the NORMALIZED content, so a submit round-trip is what the model reads", () => {
    const s = ingestPaste(initialEditorState(), "\x1b[32ma\r\n\tb\r\nc\r\nd", 24);
    expect(s.pastedContents[1].content).toBe("a\n    b\nc\nd");
  });
  it("inserts the chip at the cursor as ONE token in the current line", () => {
    let s = initialEditorState(); s = { ...s, lines: ["see  here"], cursor: { row: 0, col: 4 } };
    s = ingestPaste(s, "y".repeat(900), 24);
    expect(s.lines).toEqual(["see [Pasted text #1] here"]);
    expect(s.cursor).toEqual({ row: 0, col: 4 + "[Pasted text #1]".length });
  });
  it("counts ids monotonically across pastes", () => {
    let s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    s = ingestPaste(s, "e\nf\ng\nh", 24);
    expect(text(s)).toBe("[Pasted text #1 +3 lines][Pasted text #2 +3 lines]");
    expect(Object.keys(s.pastedContents)).toEqual(["1", "2"]);
  });
  it("ignores a paste that normalises to nothing", () => {
    const s = initialEditorState();
    expect(ingestPaste(s, "\x1b[0m", 24)).toBe(s);
  });
});

describe("applyKey routing — a PASTE-TAGGED event at any size, or an untagged run past CHIP_CHARS", () => {
  it("a paste-tagged text event above the threshold becomes a chip", () => {
    const r = paste(initialEditorState(), "z".repeat(900), 24);
    expect(text(r.state)).toBe("[Pasted text #1]");
  });
  // `zhn`'s keydown arm, bundle L395998–L396004: `!ctrl && !meta && T.key.length > CMt` goes down the SAME
  // onPaste path as a marked paste. It is the fallback for a terminal that never sent `\x1b[200~`.
  it("an UNTAGGED 900-char event chips too (the no-DECSET-2004 fallback)", () => {
    const r = applyKey(initialEditorState(), "z".repeat(900), {}, Date.now(), 24);
    expect(text(r.state)).toBe("[Pasted text #1]");
    expect(r.state.pasteCounter).toBe(1);
    expect(r.state.pastedContents[1].content).toBe("z".repeat(900));
  });
  it("compares the RAW length, before normalisation (upstream's `T.key.length`)", () => {
    // 900 raw characters that normalise to NOTHING still take the paste path — where `ingestPaste` discards an
    // empty payload. The plain-insert path would have put all 900 ANSI bytes in the buffer.
    const r = applyKey(initialEditorState(), "\x1b[31m".repeat(180), {}, Date.now(), 24);
    expect(text(r.state)).toBe("");
    // …and the converse: 780 raw tabs are under the threshold even though they would normalise to 3120
    // characters, so they insert verbatim, tabs and all, with no id burned.
    const t = applyKey(initialEditorState(), "\t".repeat(780), {}, Date.now(), 24);
    expect(text(t.state)).toBe("\t".repeat(780));
    expect(t.state.pastedContents).toEqual({});
  });
  it("an untagged SHORT multi-character run stays a plain insert", () => {
    const r = applyKey(initialEditorState(), "hello world", {}, Date.now(), 24);
    expect(text(r.state)).toBe("hello world");
    expect(r.state.pasteCounter).toBe(0);
    expect(r.state.pastedContents).toEqual({});
  });
  it("a sub-threshold paste still normalises (tabs and CRLF never reach the buffer)", () => {
    const r = paste(initialEditorState(), "a\tb\r\nc", 24);
    expect(r.state.lines).toEqual(["a    b", "c"]);
  });
  it("threads the composer's live rows into the threshold", () => {
    expect(text(paste(initialEditorState(), "a\nb", 10).state)).toBe("[Pasted text #1 +1 lines]");
    expect(text(paste(initialEditorState(), "a\nb", 24).state)).toBe("a\nb");
  });
  it("is undoable: Ctrl-_ restores the pre-paste buffer AND its (empty) chip map", () => {
    const s = applyKey(initialEditorState(), "hi", {}, 1000).state;
    const pasted = applyKey(s, "q".repeat(900), { paste: true }, 9000, 24).state;
    expect(text(pasted)).toBe("hi[Pasted text #1]");
    const undone = applyKey(pasted, "\x1f", {}, 9001).state;
    expect(text(undone)).toBe("hi");
    expect(undone.pastedContents).toEqual({});
  });
  it("refreshes an open command popup instead of leaving it stale", () => {
    let s = applyKey(initialEditorState(), "/", {}).state;
    expect(s.command).not.toBeNull();
    s = paste(s, "cle", 24).state;
    expect(s.command?.query).toBe("cle");
  });
});

describe("submitTurn — fSe expansion", () => {
  const submitOf = (s: EditorState) => applyKey(s, "", { return: true });
  it("sends the full content while the buffer only ever showed the chip", () => {
    const body = "line\n".repeat(50);
    const s = paste(initialEditorState(), body, 24).state;
    expect(text(s)).toBe("[Pasted text #1 +50 lines]");
    const r = submitOf(s);
    expect(r.submit).toBe(body);
    expect(r.state.history[0]).toBe("[Pasted text #1 +50 lines]");   // history keeps the DISPLAY text
  });
  it("expands a chip embedded in surrounding prose", () => {
    let s = applyKey(initialEditorState(), "review ", {}).state;
    s = paste(s, "a\nb\nc\nd", 24).state;
    s = applyKey(s, " please", {}).state;
    expect(submitOf(s).submit).toBe("review a\nb\nc\nd please");
  });
  it("leaves an unknown-id chip literal", () => {
    const s = applyKey(initialEditorState(), "[Pasted text #9 +2 lines]", {}).state;
    expect(submitOf(s).submit).toBe("[Pasted text #9 +2 lines]");
  });
  it("drops the map with the buffer that carried it", () => {
    const s = paste(initialEditorState(), "a\nb\nc\nd", 24).state;
    expect(submitOf(s).state.pastedContents).toEqual({});
    expect(submitOf(s).state.pasteCounter).toBe(0);
  });
});

describe("substituteChips — fSe directly", () => {
  it("replaces right-to-left so earlier indices stay valid", () => {
    const map = { 1: { id: 1, type: "text" as const, content: "AAA", lineCount: 0 }, 2: { id: 2, type: "text" as const, content: "B", lineCount: 0 } };
    expect(substituteChips("[Pasted text #1] and [Pasted text #2]", map)).toBe("AAA and B");
  });
  it("skips a non-text entry", () => {
    expect(substituteChips("[Image #1]", {})).toBe("[Image #1]");
  });
});
