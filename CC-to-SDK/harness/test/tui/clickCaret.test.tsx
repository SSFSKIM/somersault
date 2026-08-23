// tui/test/clickCaret.test.tsx — F9 T-MOUSE Task 4: click positions the composer caret.
//
// TWO LAYERS, like `hitmap.test.ts` / `fold-hitmap.test.tsx` before it. The first half pins the PURE inverse
// map (`offsetFromPosition`, `caretFromLocalPosition` — `editor.ts`) with no React tree anywhere: it is the
// spec's own contract (M4), independently correct or not regardless of how `ChatComposer` wires it up. The
// second half drives the REAL `ChatApp` through the REAL keymap provider with raw SGR bytes — the same
// `fold-click.test.tsx` harness — because the GESTURE (press/release pairing, the fold-anchor priority, the
// "different cell" refusal) lives in `ChatApp`'s one tap machine and nothing else can see it.
import React from "react";
import { describe, it, expect } from "vitest";
import { offsetFromPosition, caretFromLocalPosition } from "../../src/tui/editor.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";

// ── LAYER 1 — THE PURE INVERSE MAP ──────────────────────────────────────────────────────────────────────
describe("offsetFromPosition (spec M4)", () => {
  it("unwrapped line: exact offset is column minus prefix", () => {
    // No prefix (ccx's own composer call: PromptGlyph is a separate flex column, never text) — column IS
    // the offset, 1-based column N landing the caret just before the Nth character.
    expect(offsetFromPosition("hello world", 0, 80, 0, 4)).toBe(3);
    // WITH a prefix (canon's search-input shape, R1 §2.6): three padding columns wrapped WITH the text, the
    // column counted THROUGH them, and the prefix's own width subtracted back off at the end.
    expect(offsetFromPosition("hello", 3, 80, 0, 6)).toBe(2);         // "he|llo" — before the first 'l'
  });

  // TASK REVIEW IMPORTANT FINDING — the prior fixtures' prefix never changed where the wrap itself broke
  // ("hello",3,80,…): at innerWidth 80 the whole padded blob fits on one row either way, so a mutation that
  // wraps the UNPREFIXED string (`wrapRows(text, width)` instead of `wrapRows(pad + text, width)`) produced
  // the SAME numeric answer as the real code and no test caught it. This fixture is chosen so the padding
  // actually crosses a word-wrap boundary: `wrapRows("hello world foo", 12)` (no prefix) breaks
  // `["hello world ", "foo"]`, but `wrapRows("   hello world foo", 12)` (WITH the 3-column prefix) breaks
  // `["   hello ", "world foo"]` — a genuinely different row split, not just a different column within the
  // same rows. Line 1 column 1 lands on "world foo"'s own start (offset 6, the 'w') when wrapped correctly;
  // the unprefixed-wrap mutation instead wraps to `["hello world ", "foo"]` and Line 1 column 1 lands on
  // "foo"'s start (offset 9) — a different, wrong answer, which is what makes this fixture prove the
  // function wraps the PREFIXED string rather than coincidentally agreeing with a mutation that doesn't.
  it("a prefix that crosses a word-wrap boundary changes which row a click resolves against", () => {
    expect(offsetFromPosition("hello world foo", 3, 12, 1, 1)).toBe(6);
  });

  it("wrapped second line: the offset accounts for every row before it", () => {
    // wrap-ansi hard-breaks at exactly `width` with no separator lost — "abcdefghij" at width 5 is
    // ["abcde","fghij"]. Line 1's own column 1 is character index 5 of the original text, not 0.
    expect(offsetFromPosition("abcdefghij", 0, 5, 1, 1)).toBe(5);
    expect(offsetFromPosition("abcdefghij", 0, 5, 1, 3)).toBe(7);
  });

  it("click past the line's end clamps to the line's own end", () => {
    expect(offsetFromPosition("hello", 0, 80, 0, 100)).toBe(5);       // text.length
    // …and past the end of an EARLIER wrapped row, not the buffer's — clamps to THAT row's own end.
    expect(offsetFromPosition("abcdefghij", 0, 5, 0, 100)).toBe(5);
  });

  it("click on the prefix clamps to 0", () => {
    expect(offsetFromPosition("hello", 3, 80, 0, 1)).toBe(0);
    expect(offsetFromPosition("hello", 3, 80, 0, 3)).toBe(0);
  });

  it("wide-char (CJK) line snaps via the T1 grapheme helpers", () => {
    // "a你b": 'a' 1 col, '你' 2 cols, 'b' 1 col — total width 4, three characters (UTF-16 length 3).
    expect(offsetFromPosition("a你b", 0, 80, 0, 1)).toBe(0);           // before 'a'
    expect(offsetFromPosition("a你b", 0, 80, 0, 2)).toBe(1);           // leading half of '你'
    expect(offsetFromPosition("a你b", 0, 80, 0, 3)).toBe(1);           // trailing half snaps BACK to the same offset
    expect(offsetFromPosition("a你b", 0, 80, 0, 4)).toBe(2);           // before 'b'
    expect(offsetFromPosition("a你b", 0, 80, 0, 99)).toBe(3);          // past the end clamps to text.length
  });

  it("an empty line addresses offset 0 regardless of column", () => {
    expect(offsetFromPosition("", 0, 80, 0, 1)).toBe(0);
    expect(offsetFromPosition("", 2, 80, 0, 5)).toBe(0);
  });
});

describe("caretFromLocalPosition — the composer's per-logical-line walk", () => {
  it("resolves an unwrapped single line", () => {
    expect(caretFromLocalPosition(["hello"], 80, 0, 4)).toEqual({ row: 0, col: 3 });
  });

  it("walks past earlier lines' own painted row counts to find a later line's wrapped row", () => {
    // line 0 "ab" paints 1 row at width 3; line 1 "cdefgh" wraps to ["cde","fgh"], 2 rows. So the buffer's
    // OWN painted rows are: 0 → line0, 1 → line1's first wrapped row, 2 → line1's second.
    const lines = ["ab", "cdefgh"];
    expect(caretFromLocalPosition(lines, 3, 0, 1)).toEqual({ row: 0, col: 0 });
    expect(caretFromLocalPosition(lines, 3, 1, 1)).toEqual({ row: 1, col: 0 });
    expect(caretFromLocalPosition(lines, 3, 2, 2)).toEqual({ row: 1, col: 4 });   // "cde|fgh" col2 of "fgh" → before 'g'
  });

  it("is not addressable above the first line or past the buffer's last painted row", () => {
    expect(caretFromLocalPosition(["hello"], 80, -1, 1)).toBeUndefined();
    expect(caretFromLocalPosition(["hello"], 80, 1, 1)).toBeUndefined();
    expect(caretFromLocalPosition(["ab", "cdefgh"], 3, 3, 1)).toBeUndefined();
  });
});

// ── LAYER 2 — THE REAL TAP MACHINE ──────────────────────────────────────────────────────────────────────
const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const rowsOf = (frame: string | undefined): string[] => plain(frame).split("\n");
const strip = (line: string | undefined): string => (line ?? "").trim();
/** The 1-based terminal row a line is painted on — read out of the frame, never derived. */
const rowOf = (frame: string | undefined, pred: (line: string) => boolean): number => {
  const at = rowsOf(frame).findIndex((line) => pred(strip(line)));
  expect(at, `no matching row in:\n${plain(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
const PROMPT = "❯ ";                    // ❯ + NBSP, `promptGlyph`'s normal-mode text

const press = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}M`;
const release = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}m`;
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function tap(r: { stdin: { write(s: string): void } }, col: number, row: number, mods = 0) {
  r.stdin.write(press(col, row, mods));
  await tick();
  r.stdin.write(release(col, row, mods));
  await settle();
}

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });

async function mount(entries: readonly TranscriptBootstrapEntry[] = []) {
  const fake = fakeRemote();
  const r = renderWithKeymap(
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
      deps={{ columns: () => 80, rows: () => 24 }} />);
  await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
  await settle();
  return r;
}

/** The composer's own row and the 1-based column its typed text starts at — read out of the painted frame,
 *  the same discipline `fold-click.test.tsx`'s `rowOf` documents (no case derives a coordinate it then
 *  asserts against itself). */
function composerOrigin(frame: string | undefined, needle: string): { row: number; textCol: number } {
  const rows = rowsOf(frame);
  const idx = rows.findIndex((l) => l.includes(needle));
  expect(idx, `"${needle}" is not painted in:\n${plain(frame)}`).toBeGreaterThanOrEqual(0);
  return { row: idx + 1, textCol: rows[idx]!.indexOf(needle) + 1 };
}

describe("T4: a tap on a composer cell moves the caret via the inverse map", () => {
  it("clicking mid-line, then typing, inserts at the clicked offset rather than at the end", async () => {
    const r = await mount();
    r.stdin.write("abcdef");
    await waitFor(() => plain(r.lastFrame()).includes("abcdef"));
    await settle();
    const { row, textCol } = composerOrigin(r.lastFrame(), "abcdef");
    // Click on 'd' (index 3 of "abcdef") — the caret lands just BEFORE it.
    await tap(r, textCol + 3, row);
    r.stdin.write("X");
    await waitFor(() => plain(r.lastFrame()).includes("abcXdef"));
    expect(plain(r.lastFrame())).toContain("abcXdef");
    r.unmount();
  });

  it("clicking past the end of the line clamps the caret to the line's own end", async () => {
    const r = await mount();
    r.stdin.write("abc");
    await waitFor(() => plain(r.lastFrame()).includes("abc"));
    await settle();
    const { row, textCol } = composerOrigin(r.lastFrame(), "abc");
    await tap(r, textCol + 40, row);              // far past the painted text, same row
    r.stdin.write("X");
    await waitFor(() => plain(r.lastFrame()).includes("abcX"));
    expect(plain(r.lastFrame())).toContain("abcX");
    r.unmount();
  });
});

describe("T4: a press on the transcript and a release on the composer does nothing", () => {
  it("leaves the caret where it was — the different-cell rule refuses the pair before any lookup runs", async () => {
    const r = await mount([prose("hello there", "a")]);
    r.stdin.write("abcdef");
    await waitFor(() => plain(r.lastFrame()).includes("abcdef"));
    await settle();
    const transcriptRow = rowOf(r.lastFrame(), (l) => l.includes("hello there"));
    const { row: composerRow, textCol } = composerOrigin(r.lastFrame(), "abcdef");
    expect(transcriptRow).not.toBe(composerRow);          // premise: genuinely two different cells
    r.stdin.write(press(3, transcriptRow));
    await tick();
    r.stdin.write(release(textCol + 3, composerRow));      // would be "abc|def" if the pair were honoured
    await settle();
    // The caret never moved off the end: typing now still appends.
    r.stdin.write("X");
    await waitFor(() => plain(r.lastFrame()).includes("abcdefX"));
    expect(plain(r.lastFrame())).toContain("abcdefX");
    expect(plain(r.lastFrame())).not.toContain("abcXdef");
    r.unmount();
  });
});

// ── F10 S1 — A DOCK OCCUPANT NO LONGER SUPPRESSES THE CARET ORIGIN ──────────────────────────────────────
//
// This block used to pin the OPPOSITE claim (task review Critical, fix round): `DockTopContext` publishes
// the DOCK BAND's first row, not the composer's, so a `TaskPanel` or the live-turn spinner painting above it
// left the old top-down origin stale, and `dockCrowded` refused every click while either was up rather than
// resolve against a wrong row. Canon does neither: L606604 shows the composer's caret handler has exactly
// ONE early return (the reverse-search flag), never busy or an open task list; L200134-200163 hit-tests a
// layout tree and recomputes the click fresh every time, so a busy turn or a task panel repositions the
// caret exactly like an idle composer would. S1's bottom-up origin (`composerOriginRow`, computed from
// `useDockBottom()` — the frame's LAST row — rather than the dock band's first) needs no term for either
// occupant at all, so there is nothing left for a "crowded" flag to gate: same fixtures, inverted claim.
//
// FIVE SHORT LOGICAL LINES, joined with Ctrl-J ("\x0a" — `editorAdapter.ts`'s own newline binding, not
// Enter), one digit per line ("0000000000" … "4444444444"), kept from the original fixture: `renderBuffer`
// (ChatComposer.tsx) paints ONE `<Text>` per logical line, so each is its own real screen row independent of
// exactly where Ink itself would word-wrap a longer string. The click aims at the FIRST line's own screen
// row and types "X" there — a caret that is still refusing (or resolving against the wrong line) leaves
// "00000X00000" unreachable, either appending past the buffer's true end or landing on some other digit run.
describe("F10 S1 — a dock occupant no longer suppresses the caret origin", () => {
  const NL = "\x0a";                                                     // Ctrl-J: insert newline, not submit
  const digitLines = (n: number) => Array.from({ length: n }, (_, i) => String(i).repeat(10)).join(NL);

  it("busy: true (the spinner row is rendered above the composer) — a composer click still moves the caret", async () => {
    const submitted: string[] = [];
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async (prompt) => { submitted.push(prompt); fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
    });
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }}
        deps={{ columns: () => 80, rows: () => 24 }} />);
    await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
    await settle();
    r.stdin.write("go");
    await waitFor(() => plain(r.lastFrame()).includes("go"));
    r.stdin.write("\r");
    await waitFor(() => submitted.length === 1);           // the spinner row now paints above the composer
    await settle();
    r.stdin.write(digitLines(5));
    await waitFor(() => plain(r.lastFrame()).includes("4444444444"));
    await settle();
    const { row, textCol } = composerOrigin(r.lastFrame(), "0000000000");   // the FIRST line's real screen row
    await tap(r, textCol + 5, row);
    r.stdin.write("X");
    await waitFor(() => plain(r.lastFrame()).includes("X"));
    // The caret MOVED to the clicked line — canon's own behaviour during a busy turn.
    expect(plain(r.lastFrame())).toContain("00000X00000");
    r.unmount();
  });

  it("an open task panel (rendered above the composer) — a composer click still moves the caret", async () => {
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({});
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }}
        deps={{ columns: () => 80, rows: () => 24 }} />);
    await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
    await settle();
    // Seed one task through a completed turn (taskList.ts's own wire pair), so `state.busy` is back to
    // false and the panel's visibility is entirely `todosOpen`'s doing (default true) — an unconflated cell.
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "todo-item-one" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: todo-item-one" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => plain(r.lastFrame()).includes("todo-item-one"));
    await settle();
    r.stdin.write(digitLines(5));
    await waitFor(() => plain(r.lastFrame()).includes("4444444444"));
    await settle();
    const { row, textCol } = composerOrigin(r.lastFrame(), "0000000000");
    await tap(r, textCol + 5, row);
    r.stdin.write("X");
    await waitFor(() => plain(r.lastFrame()).includes("X"));
    expect(plain(r.lastFrame())).toContain("00000X00000");
    r.unmount();
  });
});
