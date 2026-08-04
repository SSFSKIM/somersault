// tui/test/paste-chips.test.ts — F5 task 3: paste ingestion. The pins here are transcribed from the 2.1.220
// bundle, not invented: `k0` (L495741) for the normalisation order and the rows-aware chip threshold, `kmt`
// (L317378) for what counts as a line, `agr` (L317383) for the placeholder grammar, `KF` (L317394) for the
// recognizer and `fSe` (L317403) for the submit-time expansion.
import { describe, it, expect } from "vitest";
import { applyKey, clearToHistory, initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { CHIP_CHARS, CHIP_RE, chipLabel, chipSpans, deleteTokenBefore, gcPastedContents, ingestPaste, newlineCount, newlineThreshold, normalizePaste, snapOut, stripANSI, substituteChips } from "../../src/tui/pasteChips.js";

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
  it("boundary is STRICT like upstream's `Cn.length > CMt`: exactly 800 chars inserts, 801 chips", () => {
    const at = ingestPaste(initialEditorState(), "x".repeat(CHIP_CHARS), 24);
    expect(text(at)).toBe("x".repeat(CHIP_CHARS));
    expect(at.pasteCounter).toBe(0);
    const over = ingestPaste(initialEditorState(), "x".repeat(CHIP_CHARS + 1), 24);
    expect(text(over)).toBe("[Pasted text #1]");
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

// ─── F5 task 4: chip mechanics ────────────────────────────────────────────────────────────────────────
// `deleteTokenBefore` (bundle L395149) verbatim, incl. the f18 guard `if (t !== void 0 && !/\s/.test(t)) return null`
// and the forward arm for a placeholder that STARTS at the cursor; the snap-out effect (L495400) and its
// midpoint rule `Qe(xe < Cn ? Wt.start : Wt.end)`; the placeholder-aware `left()`/`right()` (L394793/L394803).
const LABEL3 = "[Pasted text #1 +3 lines]";                 // the label a 4-line paste mints (25 chars)
const LABEL0 = "[Pasted text #1]";                          // the label a 900-char one-liner mints (16 chars)
const chipped = () => paste(initialEditorState(), "a\nb\nc\nd", 24).state;
const bksp = (s: EditorState, now?: number) => applyKey(s, "", { backspace: true }, now);

describe("deleteTokenBefore — the atomic one-keystroke chip delete", () => {
  it("backspace right after a chip empties the buffer and GCs the entry", () => {
    const s = chipped();
    expect(text(s)).toBe(LABEL3);
    const r = bksp(s);
    expect(text(r.state)).toBe("");
    expect(r.state.cursor).toEqual({ row: 0, col: 0 });
    expect(r.state.pastedContents).toEqual({});
    expect(r.state.pasteCounter).toBe(1);                   // ids stay monotonic — the counter is not a live count
  });
  it("ctrl+h takes the same path (bundle L395676: `h` → `deleteTokenBefore() ?? backspace()`)", () => {
    const r = applyKey(chipped(), "h", { ctrl: true });
    expect(text(r.state)).toBe("");
    expect(r.state.pastedContents).toEqual({});
  });
  it("eats only the placeholder, keeping the whitespace that precedes it (`o = n.index + n[1].length`)", () => {
    let s = applyKey(initialEditorState(), "see ", {}).state;
    s = paste(s, "a\nb\nc\nd", 24).state;
    expect(text(s)).toBe("see " + LABEL3);
    expect(text(bksp(s).state)).toBe("see ");
  });
  it("f18 guard: a NON-space character at the cursor blocks the atomic delete", () => {
    let s = chipped();
    s = applyKey(s, "x", {}).state;                          // LABEL3 + "x"
    s = applyKey(s, "", { leftArrow: true }).state;          // cursor between "]" and "x"
    expect(s.cursor.col).toBe(LABEL3.length);
    const r = bksp(s);
    expect(text(r.state)).toBe("[Pasted text #1 +3 linesx"); // a plain backspace ate the "]" …
    expect(r.state.pastedContents).toEqual({});              // … and the mangled label GC'd the entry
  });
  it("whitespace at the cursor passes the guard (a chip mid-line still dies whole)", () => {
    let s = chipped();
    s = applyKey(s, " tail", {}).state;
    s = { ...s, cursor: { row: 0, col: LABEL3.length } };
    expect(text(bksp(s).state)).toBe(" tail");
  });
  it("branch 1 (L395150): with the cursor at a chip's START the chip dies FORWARD, plus one trailing space", () => {
    let s = chipped();
    s = applyKey(s, " tail", {}).state;
    const r = bksp({ ...s, cursor: { row: 0, col: 0 } });
    expect(text(r.state)).toBe("tail");
    expect(r.state.cursor).toEqual({ row: 0, col: 0 });
    expect(r.state.pastedContents).toEqual({});
  });
  it("returns null (→ plain backspace) when no placeholder ends at the cursor", () => {
    const s = applyKey(initialEditorState(), "ab", {}).state;
    expect(deleteTokenBefore(s)).toBeNull();
    expect(text(bksp(s).state)).toBe("a");
  });
  it("returns null at column 0 with no chip ahead (upstream's `isAtStart()`)", () => {
    expect(deleteTokenBefore(initialEditorState())).toBeNull();
  });
  it("recognizes the other three species the bundle's regex names", () => {
    for (const label of ["[Image #2]", "[Audio #3]", "[...Truncated text #4 +9 lines...]"]) {
      const s = applyKey(initialEditorState(), "x " + label, {}).state;
      expect(text(bksp(s).state)).toBe("x ");
    }
  });
  it("produces exactly ONE undo entry, and undo restores the chip AND its map entry", () => {
    const pasted = applyKey(initialEditorState(), "a\nb\nc\nd", { paste: true }, 1000, 24).state;
    const gone = bksp(pasted, 9000).state;
    expect(text(gone)).toBe("");
    expect(gone.undo.length).toBe(pasted.undo.length + 1);
    const back = applyKey(gone, "\x1f", {}, 9001).state;
    expect(text(back)).toBe(LABEL3);
    expect(back.pastedContents[1].content).toBe("a\nb\nc\nd");
  });
});

describe("snapOut — a cursor strictly inside a chip lands on an edge", () => {
  it("two cells in from the left edge → the start; two cells in from the right edge → the end", () => {
    const base = chipped();
    expect(applyKey({ ...base, cursor: { row: 0, col: 2 } }, "", { rightArrow: true }).state.cursor.col).toBe(0);
    expect(applyKey({ ...base, cursor: { row: 0, col: LABEL3.length - 2 } }, "", { leftArrow: true }).state.cursor.col).toBe(LABEL3.length);
  });
  it("breaks the midpoint tie toward the END (`xe < Cn ? start : end`)", () => {
    const s = paste(initialEditorState(), "x".repeat(900), 24).state;   // LABEL0, midpoint exactly 8
    expect(applyKey({ ...s, cursor: { row: 0, col: 9 } }, "", { leftArrow: true }).state.cursor.col).toBe(LABEL0.length);
  });
  it("also catches a vertical move that drops the cursor into a chip", () => {
    let s = applyKey(initialEditorState(), "a long first line", {}).state;
    s = applyKey(s, "", { return: true, shift: true }).state;
    s = paste(s, "a\nb\nc\nd", 24).state;
    const up = applyKey({ ...s, cursor: { row: 0, col: 3 } }, "", { downArrow: true }).state;
    expect(up.cursor).toEqual({ row: 1, col: 0 });                       // col 3 is inside the chip → start
  });
  it("leaves an edge or outside cursor alone (identity, so no spurious state churn)", () => {
    const s = chipped();
    expect(snapOut(s)).toBe(s);                                          // sitting on the end edge
    const atStart = { ...s, cursor: { row: 0, col: 0 } };
    expect(snapOut(atStart)).toBe(atStart);
    const plain = applyKey(initialEditorState(), "hello", {}).state;
    expect(snapOut({ ...plain, cursor: { row: 0, col: 2 } }).cursor.col).toBe(2);
  });
  it("never fires on a key that CHANGED the text (the key owns its own cursor)", () => {
    const s = chipped();
    const r = applyKey({ ...s, cursor: { row: 0, col: 10 } }, "Z", {});
    expect(r.state.cursor).toEqual({ row: 0, col: 11 });
    expect(text(r.state)).toBe("[Pasted teZxt #1 +3 lines]");
  });
  it("an arrow AT an edge steps over the whole chip (bundle left()/right())", () => {
    const s = paste(initialEditorState(), "x".repeat(900), 24).state;
    expect(applyKey(s, "", { leftArrow: true }).state.cursor.col).toBe(0);
    expect(applyKey({ ...s, cursor: { row: 0, col: 0 } }, "", { rightArrow: true }).state.cursor.col).toBe(LABEL0.length);
  });
  it("a WORD motion crosses the chip instead of stopping at the spaces inside the label", () => {
    let s = applyKey(initialEditorState(), "one ", {}).state;
    s = paste(s, "a\nb\nc\nd", 24).state;
    s = applyKey(s, " two", {}).state;                                   // "one " + LABEL3 + " two"
    const back = applyKey({ ...s, cursor: { row: 0, col: 4 + LABEL3.length } }, "", { meta: true, leftArrow: true });
    expect(back.state.cursor.col).toBe(4);                               // prevWord → snapOutOfPlaceholder(…, "start")
    const fwd = applyKey({ ...s, cursor: { row: 0, col: 4 } }, "", { meta: true, rightArrow: true });
    expect(fwd.state.cursor.col).toBe(4 + LABEL3.length);                // nextWord → snapOutOfPlaceholder(…, "end")
  });
});

describe("map GC — an edit that removes a label removes its entry", () => {
  it("ctrl+k through half a chip leaves a literal remainder and GCs the entry", () => {
    const s = chipped();
    const cut = applyKey({ ...s, cursor: { row: 0, col: 10 } }, "k", { ctrl: true });
    expect(text(cut.state)).toBe("[Pasted te");
    expect(cut.state.pastedContents).toEqual({});
    expect(applyKey(cut.state, "", { return: true }).submit).toBe("[Pasted te");
  });
  it("drops only the entry whose label left the buffer", () => {
    let s = chipped();
    s = applyKey(s, " ", {}).state;
    s = paste(s, "e\nf\ng\nh", 24).state;
    const r = bksp(s);
    expect(text(r.state)).toBe(LABEL3 + " ");
    expect(Object.keys(r.state.pastedContents)).toEqual(["1"]);
  });
  it("scans EVERY line, so an edit on one line cannot GC a chip living on another", () => {
    let s = chipped();
    s = applyKey(s, "", { return: true, shift: true }).state;
    s = applyKey(s, "hello", {}).state;
    const r = bksp(s);
    expect(r.state.lines).toEqual([LABEL3, "hell"]);
    expect(r.state.pastedContents[1]).toBeDefined();
  });
  it("gcPastedContents is identity when nothing died (and on an empty map)", () => {
    const s = chipped();
    expect(gcPastedContents(s)).toBe(s);
    const empty = initialEditorState();
    expect(gcPastedContents(empty)).toBe(empty);
  });
  it("a history Up/Down round trip keeps the DRAFT's payload (the map parks with the draft text)", () => {
    // The buffer swap is a text change, so the GC empties the live map on the way into history. `stash` therefore
    // has to park the map alongside the draft text, or Down restores a label with nothing behind it and the
    // submit sends `[Pasted text #1 +3 lines]` literally (t4 review, Critical).
    let s = initialEditorState(["an older turn"]);
    s = paste(s, "a\nb\nc\nd", 24).state;
    expect(text(s)).toBe(LABEL3);
    const up = applyKey(s, "", { upArrow: true }).state;
    expect(text(up)).toBe("an older turn");
    expect(up.pastedContents).toEqual({});                      // GC'd — the label is not in the history text
    const down = applyKey(up, "", { downArrow: true }).state;
    expect(text(down)).toBe(LABEL3);
    expect(down.pastedContents[1].content).toBe("a\nb\nc\nd");
    expect(applyKey(down, "", { return: true }).submit).toBe("a\nb\nc\nd");
  });
  it("ctrl+w right after a chip kills the WHOLE label into the ring and GCs the entry", () => {
    let s = applyKey(initialEditorState(), "keep ", {}).state;
    s = paste(s, "a\nb\nc\nd", 24).state;
    const r = applyKey(s, "w", { ctrl: true });
    expect(text(r.state)).toBe("keep ");
    expect(r.killed?.text).toBe(LABEL3);
    expect(r.state.killRing[r.state.killRing.length - 1]).toBe(LABEL3);   // …so Ctrl-Y reinserts a live label
    expect(r.state.pastedContents).toEqual({});
    expect(text(applyKey(r.state, "y", { ctrl: true }).state)).toBe("keep " + LABEL3);
  });
  it("clearToHistory resets the map with the buffer, keeping the label in history", () => {
    const c = clearToHistory(chipped());
    expect(c.pastedContents).toEqual({});
    expect(c.pasteCounter).toBe(0);
    expect(c.history[c.history.length - 1]).toBe(LABEL3);
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
