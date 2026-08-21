// test/tui/inline-history-search.test.tsx — CM58, the ctrl+r inline reverse-i-search (F5 task 12). Pins
// transcribed from 2.1.220's `r9f` (bundle L489642-L489728) and `xWf` (L493443-L493466):
//  · L489752  the ROUTING — `Mn("history:search", B, {context:"Global", isActive: yie() ? !1 : !a})`: the
//             inline hook claims ctrl+r only when the fullscreen check is FALSE. The picker's own render
//             site (L496209) is `if (yie() && mr)`. Classic layout ⇒ inline; the picker gets `/history`.
//  · L489664  the match — `ne.toLowerCase().lastIndexOf(ce)`: a substring test whose answer is the offset of
//             the LAST occurrence, and the caret lands there
//  · L489665  the dedup Set, and L489656/L489686 the two walk modes it distinguishes (restart vs. continue)
//  · L489683  the open parks `{ value, cursorOffset, mode, pastedContents }`
//  · L489692  ACCEPT keeps the match — the surprising one, and the sabotage target
//  · L489704  CANCEL restores the parked draft
//  · L489707  EXECUTE submits (the parked draft on an empty query, the match otherwise)
//  · L489725  a backspace on an empty query IS the cancel
//  · L493445  the two literals, and L493769 the expand hint's `!isSearching` gate
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ChatComposer, PASTE_EXPAND_HINT } from "../../src/tui/ChatComposer.js";
import { ComposerWithFooter } from "./helpers/composerFooter.js";
import { appendHistory } from "../../src/tui/promptHistory.js";
import { bufferText, initialEditorState, type EditorState, type PastedEntry, type PastedMap } from "../../src/tui/editor.js";
import { findInlineMatch, offsetToCursor, cursorToOffset, installMatch, restoreDraft, NO_MATCH_PROMPT, SEARCH_PROMPT } from "../../src/tui/historySearchInline.js";

// F9 T-IMAGE (I2) widened `PastedEntry` to a 3-arm union; this file's own maps are text-only, so this
// narrows the read side rather than casting blindly at each call site (see paste-chips.test.ts's twin).
const textEntry = (e: PastedEntry | undefined): Extract<PastedEntry, { type: "text" }> => {
  if (e?.type !== "text") throw new Error(`expected a text pasted entry, got ${JSON.stringify(e)}`);
  return e;
};

// ————————————————————————— pure: the walk and the two buffer transforms —————————————————————————

describe("findInlineMatch — `M`'s while-loop (bundle L489660)", () => {
  const es = [{ display: "run typecheck" }, { display: "fix the tests" }, { display: "run typecheck again" }];
  it("takes the FIRST (newest) entry containing the query, and reports the LAST occurrence's offset", () => {
    // "run run run": lastIndexOf("run") is 8, not 0 — the pin that separates lastIndexOf from indexOf.
    expect(findInlineMatch([{ display: "run run run" }], 0, "run", new Set())).toMatchObject({ index: 0, offset: 8 });
    expect(findInlineMatch(es, 0, "type", new Set())).toMatchObject({ index: 0, offset: 4 });
  });
  it("is case-insensitive on both sides", () => {
    expect(findInlineMatch([{ display: "Run TypeCheck" }], 0, "typecheck", new Set())).toMatchObject({ offset: 4 });
  });
  it("skips displays the walk has already shown (`R.current`)", () => {
    const seen = new Set(["run typecheck"]);
    expect(findInlineMatch(es, 0, "run", seen)).toMatchObject({ index: 2 });
  });
  it("resumes from `from` — which is what makes ctrl+r step OLDER", () => {
    expect(findInlineMatch(es, 1, "run", new Set())).toMatchObject({ index: 2 });
    expect(findInlineMatch(es, 3, "run", new Set())).toBeNull();
  });
  it("answers null for an empty query and for a miss", () => {
    expect(findInlineMatch(es, 0, "", new Set())).toBeNull();
    expect(findInlineMatch(es, 0, "zzz", new Set())).toBeNull();
  });
});

describe("offsetToCursor / cursorToOffset — the flat-offset ⇄ {row,col} seam", () => {
  const t = "one\ntwo\nthree";
  it("round-trips every offset in a multi-line buffer", () => {
    for (let i = 0; i <= t.length; i++) expect(cursorToOffset(t, offsetToCursor(t, i))).toBe(i);
  });
  it("lands on the row the offset is inside, not the newline before it", () => {
    expect(offsetToCursor(t, 0)).toEqual({ row: 0, col: 0 });
    expect(offsetToCursor(t, 3)).toEqual({ row: 0, col: 3 });      // end of "one"
    expect(offsetToCursor(t, 4)).toEqual({ row: 1, col: 0 });      // start of "two"
    expect(offsetToCursor(t, 9)).toEqual({ row: 2, col: 1 });
  });
  it("clamps past the end", () => {
    expect(offsetToCursor(t, 999)).toEqual({ row: 2, col: 5 });
    expect(cursorToOffset(t, { row: 9, col: 9 })).toBe(t.length);
  });
});

describe("installMatch / restoreDraft", () => {
  it("puts the display in VERBATIM — the `!` included — with the caret on the match", () => {
    const s = installMatch(initialEditorState(), { display: "!git status" }, 4, "sta");
    expect(s.lines).toEqual(["!git status"]);
    expect(s.cursor).toEqual({ row: 0, col: 5 });
  });
  it("re-mints a recalled entry's chips above the live counter (editorHistory's FRESH CHIP IDS)", () => {
    const base = { ...initialEditorState(), pasteCounter: 3 };
    const s = installMatch(base, { display: "see [Pasted text #1 +2 lines]", pastedContents: { 1: { id: 1, type: "text", content: "a\nb\nc", lineCount: 2 } } }, 0, "see");
    expect(s.lines[0]).toBe("see [Pasted text #4 +2 lines]");
    expect(textEntry(s.pastedContents[4]).content).toBe("a\nb\nc");
    expect(s.pastedContents[1]).toBeUndefined();
  });
  it("recomputes the caret against the REBUILT text, so a re-minted chip cannot shift it", () => {
    // The stored display numbers the chip #9 (two digits of label ahead of "tail"); re-minting drops it to
    // #1, so the offset measured on the stored text would land one character early.
    const base = { ...initialEditorState(), pasteCounter: 0 };
    const stored = "[Pasted text #10 +1 lines] tail";
    const s = installMatch(base, { display: stored, pastedContents: { 10: { id: 10, type: "text", content: "x\ny", lineCount: 1 } } }, stored.indexOf("tail"), "tail");
    expect(s.lines[0]).toBe("[Pasted text #1 +1 lines] tail");
    expect(s.lines[0].slice(s.cursor.col)).toBe("tail");
  });
  // The no-op exists for the UNDISTURBED buffer — open the search, close it again without typing — where
  // re-running `replaceBufferFromOutside` would drop a live Up-arrow walk (`histIndex`), the undo stack and
  // the popups for nothing. So the fixture is what `open()` actually parks: the state's OWN cursor and its
  // OWN pastes map, not a hand-written pair that the buffer never had (which is what let a text-only guard
  // look correct here while silently covering the case below too).
  it("restoreDraft is a NO-OP when the buffer is still the parked one (it must not eat a live walk)", () => {
    const s: EditorState = { ...initialEditorState(), lines: ["draft"], cursor: { row: 0, col: 5 }, histIndex: 2 };
    expect(restoreDraft(s, { display: "draft", cursor: s.cursor, pastedContents: s.pastedContents })).toBe(s);
  });

  // F5 final whole-branch review, P2. A match can have the SAME display as the parked draft — recall the
  // prompt you are halfway through retyping — and `installMatch` has by then moved the caret onto the match
  // and swapped the pastes map for the recalled entry's. A text-only no-op called that "already restored"
  // and cancel left the caret parked mid-word.
  it("restores the caret when the MATCH's text equals the parked draft's", () => {
    const parked: EditorState = { ...initialEditorState(), lines: ["deploy the app"], cursor: { row: 0, col: 14 } };
    const draft = { display: bufferText(parked), cursor: parked.cursor, pastedContents: parked.pastedContents };
    const installed = installMatch(parked, { display: "deploy the app" }, 7, "the");
    expect(installed.cursor).toEqual({ row: 0, col: 7 });          // the walk parked the caret on the match
    expect(restoreDraft(installed, draft).cursor).toEqual({ row: 0, col: 14 });
  });

  it("restores the parked pastes map even when text and caret both already match", () => {
    const map: PastedMap = { 1: { id: 1, type: "text", content: "MINE", lineCount: 0 } };
    const parked: EditorState = { ...initialEditorState(), lines: ["x"], pastedContents: map };
    const recalled: EditorState = { ...parked, pastedContents: { 1: { id: 1, type: "text", content: "RECALLED", lineCount: 0 } } };
    expect(textEntry(restoreDraft(recalled, { display: "x", cursor: parked.cursor, pastedContents: map }).pastedContents[1]).content).toBe("MINE");
  });

  it("a restore is itself idempotent — restoring twice does not re-clobber the buffer a second time", () => {
    const draft = { display: "my draft", cursor: { row: 0, col: 2 }, pastedContents: {} };
    const once = restoreDraft({ ...initialEditorState(), lines: ["a match"] }, draft);
    expect(restoreDraft(once, draft)).toBe(once);                  // value-equal caret, same map object
  });
  it("…and puts text, caret and pastes back when it is not", () => {
    const s: EditorState = { ...initialEditorState(), lines: ["a match"] };
    const back = restoreDraft(s, { display: "my draft", cursor: { row: 0, col: 2 }, pastedContents: {} });
    expect(back.lines).toEqual(["my draft"]);
    expect(back.cursor).toEqual({ row: 0, col: 2 });
  });
});

// ————————————————————————— the composer: ctrl+r end to end —————————————————————————

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (p: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};
const CTRL_R = "\x12", CTRL_C = "\x03", CTRL_S = "\x13", ESC = "\x1b", BS = "\x7f", CR = "\r";
const PROJECT = "/tmp/ccx-inline-search-project";

describe("<ChatComposer> — CM58's inline reverse-i-search", () => {
  let root = "";
  let env: NodeJS.ProcessEnv;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-inline-")); env = { ...process.env, CCX_FLEET_ROOT: root }; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const seed = (...displays: string[]) => { for (const display of displays) appendHistory({ display, project: PROJECT }, env); };
  // WAVE C TASK 2: the paste-expand hint and the search-suppression that gates it are FOOTER concerns now
  // (`Wci`'s third early return, `pasteExpandHint && !searching`), so the mount composes the pair the app
  // does. `InlineSearchRow` itself still renders inside the composer — see `Footer.tsx`'s divergence 4.
  const mount = (over: Partial<React.ComponentProps<typeof ChatComposer>> = {}) =>
    renderWithKeymap(<ComposerWithFooter onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} {...over} />);

  it("ctrl+r opens the INLINE search, not the picker — its dim `search prompts:` row, in the composer", async () => {
    seed("run typecheck");
    const { stdin, lastFrame } = mount();
    await settle();
    stdin.write(CTRL_R);
    await waitFor(() => strip(frame(lastFrame)).includes(SEARCH_PROMPT));
    expect(frame(lastFrame)).toContain("\x1b[2m" + SEARCH_PROMPT);   // dim, upstream's own paint
    expect(frame(lastFrame)).not.toContain("Search prompts");        // the PICKER's title never appears
    expect(strip(frame(lastFrame))).toContain("❯");                  // …and the composer is still on screen
  });

  it("typing rewrites the buffer to the newest match with the caret ON the match offset", async () => {
    seed("run typecheck", "fix the tests");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("tes");
    await waitFor(() => strip(frame(lastFrame)).includes("fix the tests"));
    expect(editorStateRef.current.lines).toEqual(["fix the tests"]);
    expect(editorStateRef.current.cursor).toEqual({ row: 0, col: "fix the ".length });
    expect(strip(frame(lastFrame))).toContain(`${SEARCH_PROMPT} tes`);
  });

  it("a second ctrl+r walks to the next OLDER distinct match", async () => {
    seed("run one", "run two", "run three");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin } = mount({ editorStateRef });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("run");
    await waitFor(() => editorStateRef.current.lines[0] === "run three");
    stdin.write(CTRL_R);
    await waitFor(() => editorStateRef.current.lines[0] === "run two");
    stdin.write(CTRL_R);
    await waitFor(() => editorStateRef.current.lines[0] === "run one");
  });

  it("ESC ACCEPTS: the match stays in the buffer, the search closes, and no interrupt fires (bundle L489692)", async () => {
    seed("deploy the thing");
    let interrupts = 0;
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef, onInterrupt: () => { interrupts++; } });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("deploy");
    await waitFor(() => editorStateRef.current.lines[0] === "deploy the thing");
    stdin.write(ESC);
    await waitFor(() => !strip(frame(lastFrame)).includes(SEARCH_PROMPT));
    expect(editorStateRef.current.lines).toEqual(["deploy the thing"]);   // KEPT, not reverted
    expect(interrupts).toBe(0);                                           // …and Escape was not the cancel
    expect(strip(frame(lastFrame))).not.toContain("again to clear");      // nor the Esc-Esc clear arm
  });

  it("ctrl+c CANCELS: the pre-search draft comes back exactly as it was", async () => {
    seed("deploy the thing");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write("my own draft");
    await waitFor(() => editorStateRef.current.lines[0] === "my own draft");
    const cursor = editorStateRef.current.cursor;
    stdin.write(CTRL_R); await settle();
    stdin.write("deploy");
    await waitFor(() => editorStateRef.current.lines[0] === "deploy the thing");
    stdin.write(CTRL_C);
    await waitFor(() => editorStateRef.current.lines[0] === "my own draft");
    expect(editorStateRef.current.cursor).toEqual(cursor);
    expect(strip(frame(lastFrame))).not.toContain(SEARCH_PROMPT);
  });

  it("backspacing the query to empty restores the draft; one more backspace is the cancel (L489725)", async () => {
    seed("deploy the thing");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write("draft");
    await waitFor(() => editorStateRef.current.lines[0] === "draft");
    stdin.write(CTRL_R); await settle();
    stdin.write("de");
    await waitFor(() => editorStateRef.current.lines[0] === "deploy the thing");
    stdin.write(BS); stdin.write(BS);
    await waitFor(() => editorStateRef.current.lines[0] === "draft");
    expect(strip(frame(lastFrame))).toContain(SEARCH_PROMPT);      // still searching, query empty
    stdin.write(BS);
    await waitFor(() => !strip(frame(lastFrame)).includes(SEARCH_PROMPT));
    expect(editorStateRef.current.lines).toEqual(["draft"]);
  });

  it("ENTER executes the match through the composer's own submit path", async () => {
    seed("!git status", "run typecheck");
    const sent: string[] = [];
    const { stdin } = mount({ onSubmit: (t) => sent.push(typeof t === "string" ? t : t.submitText) });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("git");
    await waitFor(() => sent.length === 0);
    stdin.write(CR);
    // The `!` survives into the submit — this port's mode IS the prefix (editorHistory divergence 1).
    await waitFor(() => sent.length === 1);
    expect(sent).toEqual(["!git status"]);
  });

  it("a miss shows `no matching prompt:` and leaves the buffer alone", async () => {
    seed("run typecheck");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write("draft"); await waitFor(() => editorStateRef.current.lines[0] === "draft");
    stdin.write(CTRL_R); await settle();
    stdin.write("zzz");
    await waitFor(() => strip(frame(lastFrame)).includes(NO_MATCH_PROMPT));
    expect(strip(frame(lastFrame))).not.toContain(SEARCH_PROMPT);
    expect(editorStateRef.current.lines).toEqual(["draft"]);
  });

  it("ctrl+s is INERT inside the inline search — no scope, no handler, and it never reaches the editor", async () => {
    // `r9f`'s action memo (bundle L489750) registers four actions and `historySearch:cycleScope` is not one
    // of them; only the picker registers it (L492190), because only the picker has a scope. ctrl+s therefore
    // resolves to a handler-less action, falls through to the composer fallback, and is dropped as a ctrl
    // key. Pinned because "nothing happens" is the intended outcome and is otherwise indistinguishable from
    // a wiring mistake.
    seed("run typecheck");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("type");
    await waitFor(() => editorStateRef.current.lines[0] === "run typecheck");
    const before = strip(frame(lastFrame));
    stdin.write(CTRL_S);
    await settle();
    expect(strip(frame(lastFrame))).toBe(before);                     // nothing moved at all
    expect(strip(frame(lastFrame))).toContain(`${SEARCH_PROMPT} type`);   // the query did not eat the byte
    expect(editorStateRef.current.lines).toEqual(["run typecheck"]);      // …and the editor never saw it
  });

  it("the search row carries no scope chip — xWf renders the label, the query and nothing else", async () => {
    seed("run typecheck");
    const { stdin, lastFrame } = mount();
    await settle();
    stdin.write(CTRL_R);
    await waitFor(() => strip(frame(lastFrame)).includes(SEARCH_PROMPT));
    for (const scope of ["everywhere", "session", "project"]) expect(strip(frame(lastFrame))).not.toContain(scope);
  });

  it("suppresses the paste-expand hint while searching (bundle L493769: `Rpk && !xMr`)", async () => {
    seed("run typecheck");
    const { stdin, lastFrame } = mount({ pasteHintMs: 60_000 });
    await settle();
    stdin.write("\x1b[200~alpha\nbravo\ncharlie\ndelta\x1b[201~");   // a chip → the expand hint comes up
    await waitFor(() => strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    stdin.write(CTRL_R);
    await waitFor(() => strip(frame(lastFrame)).includes(SEARCH_PROMPT));
    // WAVE C TASK 2: `isSearching` reaches the footer through the composer's `onFooterState` effect, so the
    // suppression lands one flush after the search row itself. Same assertion, waited for.
    await waitFor(() => !strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    stdin.write(CTRL_C);                                             // cancel → the hint's own window is still open
    await waitFor(() => strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
  });

  it("while searching, ordinary keys never reach the editor (divergence 3)", async () => {
    seed("run typecheck");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame } = mount({ editorStateRef });
    await settle();
    stdin.write(CTRL_R); await settle();
    stdin.write("\x1b[A");                                            // an Up that would otherwise walk history
    await settle();
    expect(editorStateRef.current.lines).toEqual([""]);
    expect(editorStateRef.current.histIndex).toBeNull();
    expect(strip(frame(lastFrame))).toContain(SEARCH_PROMPT);
  });
});
