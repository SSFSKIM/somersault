// test/tui/paste-expand.test.tsx — F5 task 5, the interactive half: paste-again-to-expand and the dim hint
// that advertises it. Pins transcribed from the 2.1.220 bundle:
//  · `k0`  (L495750) the short-circuit, checked BEFORE the id is minted: `L[Uo]?.type === "text" &&
//                    L[Uo].content === Cn && kne(Uo)` with `Uo = Ln.current - 1`, the LAST-MINTED id
//  · `kne` (L495730) locate → replace → drop the map entry → hide the hint; cursor at the END of the text
//  · `bDo` (L317410) the locator: highest-id TEXT chip in the buffer, and its own `> lgr` refusal
//  · `k0`  (L495756) the hint: shown only when the new chip's content is `<= lgr`, for 8000 ms, resettable
//  · L493772 the literal `paste again to expand`, dim
//
// THE ONE THING THIS FILE EXISTS TO PIN (t3/f4 review, then confirmed against the bundle): the 8 s window
// gates the HINT ONLY. An expand fires long after the hint is gone. The `lgr` cap, by contrast, gates BOTH —
// it lives inside `bDo`, so a paste over 100 000 chars can never be expanded either. The brief said the
// expand had no cap; the bundle says otherwise and the bundle wins.
import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ComposerWithFooter } from "./helpers/composerFooter.js";
import { ChatComposer, PASTE_EXPAND_HINT } from "../../src/tui/ChatComposer.js";
import { applyKey, initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { PASTE_LIMIT, expandRepeatedPaste, ingestPaste } from "../../src/tui/pasteChips.js";
import { loadPaste, pasteHash } from "../../src/tui/pasteCache.js";
import { PASTE_INLINE_MAX } from "../../src/tui/promptHistory.js";

// Since t7 the composer's disk writes (the prompt-history line and, past the inline cap, the paste cache it
// points into) go through `appendHistory` at SUBMIT with no injectable writer in front of them — the ambient
// env IS the seam. So this file owns a fleet root, or every submit below lands in the developer's actual
// ~/.claude/ccx. Set on process.env rather than injected, because the ambient read is what is under test.
let root = "";
let prior: string | undefined;
beforeAll(() => { prior = process.env.CCX_FLEET_ROOT; root = mkdtempSync(join(tmpdir(), "ccx-pexp-")); process.env.CCX_FLEET_ROOT = root; });
afterAll(() => { if (prior === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prior; rmSync(root, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (p: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};
const bracketed = (body: string) => "\x1b[200~" + body + "\x1b[201~";
/** Four lines, so the chip decision is the NEWLINE arm and every frame below stays small — an 800-char body
 *  wraps to fifteen rows once expanded and turns every `waitFor` into a scan of the whole paste. The
 *  character arm has its own coverage in the pure block (`LONG`) and in paste-chips.test.ts. */
const BODY = "alpha\nbravo\ncharlie\ndelta";
const OTHER = "other\ncontent\nhere\nnow";
const LONG = "alpha\nbravo\n" + "x".repeat(900);
const text = (s: EditorState) => s.lines.join("\n");
const paste = (s: EditorState, raw: string) => applyKey(s, raw, { paste: true }, Date.now(), 24);

// ————— the pure reducer: expandRepeatedPaste / ingestPaste's short-circuit —————

describe("expandRepeatedPaste — bDo + kne, no timer anywhere in sight", () => {
  it("replaces the chip with its content and drops the map entry", () => {
    const chipped = ingestPaste(initialEditorState(), LONG, 24);
    expect(text(chipped)).toBe("[Pasted text #1 +2 lines]");
    const back = expandRepeatedPaste(chipped, LONG)!;
    expect(back).not.toBeNull();
    expect(text(back)).toBe(LONG);
    expect(back.pastedContents[1]).toBeUndefined();
    expect(back.pasteCounter).toBe(1);                      // the id is SPENT, not rewound
  });
  it("leaves the cursor at the end of the inserted text (kne's cursorOffset), not the end of the line", () => {
    let s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    s = applyKey(s, "!", {}).state;                         // trailing text after the chip
    expect(text(s)).toBe("[Pasted text #1 +3 lines]!");
    const back = expandRepeatedPaste(s, "a\nb\nc\nd")!;
    expect(text(back)).toBe("a\nb\nc\nd!");
    expect(back.cursor).toEqual({ row: 3, col: 1 });         // after "d", BEFORE the "!"
  });
  it("keeps text that sits in front of the chip on the same line", () => {
    let s = applyKey(initialEditorState(), "see ", {}).state;
    s = ingestPaste(s, "a\nb\nc\nd", 24);
    const back = expandRepeatedPaste(s, "a\nb\nc\nd")!;
    expect(text(back)).toBe("see a\nb\nc\nd");
    expect(back.cursor).toEqual({ row: 3, col: 1 });
  });
  it("refuses content that is not the LAST-MINTED entry's", () => {
    let s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    s = ingestPaste(s, "e\nf\ng\nh", 24);
    expect(expandRepeatedPaste(s, "a\nb\nc\nd")).toBeNull();  // chip #1 is still in the buffer, but #2 is newest
    expect(expandRepeatedPaste(s, "e\nf\ng\nh")).not.toBeNull();
  });
  it("refuses when the newest label was deleted out of the buffer (bDo finds nothing / an older id)", () => {
    let s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    s = applyKey(s, "", { backspace: true }).state;           // deleteTokenBefore eats the whole chip
    expect(text(s)).toBe("");
    expect(s.pastedContents[1]).toBeDefined();                // the entry survives — there is no live GC
    expect(expandRepeatedPaste(s, "a\nb\nc\nd")).toBeNull();
  });
  it("refuses over lgr — bDo's own cap, which is why a huge paste can never round-trip", () => {
    const huge = "z".repeat(PASTE_LIMIT + 1);
    const s = ingestPaste(initialEditorState(), huge, 24);
    expect(text(s)).toBe("[Pasted text #1]");
    expect(expandRepeatedPaste(s, huge)).toBeNull();
  });
  it("accepts exactly lgr (the cap is `>`, not `>=`)", () => {
    const big = "z".repeat(PASTE_LIMIT);
    const s = ingestPaste(initialEditorState(), big, 24);
    expect(expandRepeatedPaste(s, big)).not.toBeNull();
  });
  it("compares NORMALIZED content, so a CRLF re-paste of an LF chip still expands", () => {
    const s = ingestPaste(initialEditorState(), "a\nb\nc\nd", 24);
    expect(text(paste(s, "a\r\nb\r\nc\r\nd").state)).toBe("a\nb\nc\nd");
  });
});

describe("ingestPaste's short-circuit — before the id is minted (k0's order)", () => {
  it("a re-paste expands instead of minting a second chip", () => {
    const s = ingestPaste(initialEditorState(), LONG, 24);
    const back = ingestPaste(s, LONG, 24);
    expect(text(back)).toBe(LONG);
    expect(back.pasteCounter).toBe(1);                       // no id burned on the gesture
  });
  it("reports itself through EditorResult.paste so the composer can react", () => {
    const first = paste(initialEditorState(), LONG);
    expect(first.paste).toEqual({ kind: "chip", content: LONG });
    const second = paste(first.state, LONG);
    expect(second.paste).toEqual({ kind: "expand" });
    const third = paste(second.state, LONG);                 // nothing to expand now — a fresh chip
    expect(third.paste).toEqual({ kind: "chip", content: LONG });
  });
  it("a small paste reports nothing (no chip, no cache write)", () => {
    expect(paste(initialEditorState(), "short").paste).toBeUndefined();
  });
});

// ————— the composer: the cache write, the hint, and the window that gates only the hint —————

describe("ChatComposer — the paste cache and `paste again to expand`", () => {
  // WAVE C TASK 2: `paste again to expand` is `Wci`'s third early-return FOOTER state now, so the mount is
  // the composer WITH the footer the app puts under it. Every assertion below is unchanged.
  const mount = (over: Partial<React.ComponentProps<typeof ChatComposer>> = {}) =>
    renderWithKeymap(
      <ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 60} rows={() => 24} {...over} />,
    );

  // ————— CM26's cache write, RELOCATED by t7 —————
  // Task 5 wrote the cache the moment a chip was minted. That was wrong about upstream and wrong about
  // privacy: the ONLY `DUd` call in the bundle is inside `uu_` (L317608) — the history append — behind the
  // `CLAUDE_CODE_SKIP_PROMPT_HISTORY` gate and behind the `content.length <= nu_` inline split, so a body
  // reaches the disk only when a prompt carrying it is SUBMITTED and is too big to live in the history line.
  // These three pins were the creation-time assertions; they are inverted here rather than deleted, because
  // "no file until submit" is the property that has to be guarded from coming back.
  it("writes NOTHING to the cache when a chip is minted — the file appears only at SUBMIT", async () => {
    const body = "x".repeat(PASTE_INLINE_MAX + 1);
    const { stdin, lastFrame } = mount();
    await settle();
    stdin.write(bracketed(body));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1]"));
    expect(loadPaste(pasteHash(body))).toBeNull();               // unsubmitted pastes never touch the disk
    stdin.write("\r");
    await waitFor(() => loadPaste(pasteHash(body)) !== null);
    expect(loadPaste(pasteHash(body))).toBe(body);
  });

  it("a body at or under the inline cap is never cached at all — it rides inside the history line", async () => {
    const sent: string[] = [];
    const { stdin, lastFrame } = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    stdin.write(bracketed(BODY));                                 // 25 chars: a chip by the NEWLINE arm, well under nu_
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +3 lines]"));
    stdin.write("\r");
    await waitFor(() => sent.length > 0);
    expect(loadPaste(pasteHash(BODY))).toBeNull();
  });

  it("CLAUDE_CODE_SKIP_PROMPT_HISTORY suppresses the cache write too (the gate wraps the whole append)", async () => {
    const body = "q".repeat(PASTE_INLINE_MAX + 1);
    const sent: string[] = [];
    const { stdin, lastFrame } = mount({ onSubmit: (t) => sent.push(t), historyEnv: { ...process.env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" } });
    await settle();
    stdin.write(bracketed(body));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1]"));
    stdin.write("\r");
    await waitFor(() => sent.length > 0);
    expect(loadPaste(pasteHash(body))).toBeNull();
  });

  it("shows the dim hint on a chip and drops it when the window closes", async () => {
    const { stdin, lastFrame } = mount({ pasteHintMs: 120 });
    await settle();
    expect(strip(frame(lastFrame))).not.toContain(PASTE_EXPAND_HINT);
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    expect(frame(lastFrame)).toContain("\x1b[2m" + PASTE_EXPAND_HINT);        // dimColor, upstream L493772
    await waitFor(() => !strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
  });

  it("EXPANDS long after the hint expired — the 8 s window gates the hint, not the gesture (f4)", async () => {
    const { stdin, lastFrame } = mount({ pasteHintMs: 60 });
    await settle();
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +3 lines]"));
    await waitFor(() => !strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));  // window closed
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes("charlie"));
    expect(strip(frame(lastFrame))).not.toContain("Pasted text");
  });

  it("a fresh chip resets the window", async () => {
    const { stdin, lastFrame } = mount({ pasteHintMs: 400 });
    await settle();
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    await new Promise((r) => setTimeout(r, 250));
    stdin.write(bracketed(OTHER));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #2 +3 lines]"));
    await new Promise((r) => setTimeout(r, 250));                              // past the FIRST chip's deadline
    expect(strip(frame(lastFrame))).toContain(PASTE_EXPAND_HINT);
  });

  it("the expand hides the hint immediately (kne's Yg(!1))", async () => {
    const { stdin, lastFrame } = mount({ pasteHintMs: 5000 });
    await settle();
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    stdin.write(bracketed(BODY));
    await waitFor(() => !strip(frame(lastFrame)).includes(PASTE_EXPAND_HINT));
    expect(strip(frame(lastFrame))).toContain("charlie");
  });

  it("a DIFFERENT second paste mints a second chip rather than expanding the first", async () => {
    const { stdin, lastFrame } = mount({});
    await settle();
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +3 lines]"));
    stdin.write(bracketed(OTHER));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #2 +3 lines]"));
    expect(strip(frame(lastFrame))).toContain("[Pasted text #1 +3 lines]");
  });

  it("over lgr: the hint never shows and a re-paste cannot expand (the chip still submits its payload)", async () => {
    const huge = "z".repeat(PASTE_LIMIT + 1);
    const { stdin, lastFrame } = mount({ pasteHintMs: 5000 });
    await settle();
    stdin.write(bracketed(huge));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1]"));
    expect(loadPaste(pasteHash(huge))).toBeNull();                             // still nothing on disk pre-submit
    expect(strip(frame(lastFrame))).not.toContain(PASTE_EXPAND_HINT);
    stdin.write(bracketed(huge));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #2]"));  // bDo refused; a second chip
    expect(strip(frame(lastFrame))).not.toContain(PASTE_EXPAND_HINT);
  });

  it("an expanded paste submits ONCE, as plain text (the map entry really is gone)", async () => {
    const sent: string[] = [];
    const { stdin, lastFrame } = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +3 lines]"));
    stdin.write(bracketed(BODY));
    await waitFor(() => strip(frame(lastFrame)).includes("charlie"));
    stdin.write("\r");
    await waitFor(() => sent.length > 0);
    expect(sent).toEqual([BODY]);
  });
});
