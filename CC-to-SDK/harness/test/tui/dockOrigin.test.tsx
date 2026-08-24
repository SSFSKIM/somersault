// tui/test/dockOrigin.test.tsx — F10 S1: the bottom-up caret origin that replaces `dockCrowded`.
//
// FOUR LAYERS, each pinning one term of the arithmetic in ChatComposer.tsx's origin block against something
// that is not itself: `bufferPhysicalRows` (composerRows.ts) against what the REAL frame paints between the
// composer's two rules (not merely re-deriving `wrapRows`); `useDockBottom` against `FullscreenFrame`'s own
// geometry, mounted directly; the composer's occupant matrix against a real `ChatApp`, proving canon's claim
// that a busy turn, a task panel, a compaction row and a wide draft all reposition the caret rather than
// refusing it; and the two overflow checks, each covering the other's blind spot (composer-local growth the
// frame's effect cannot see, and co-occupant growth the composer cannot see).
import React from "react";
import { describe, it, expect } from "vitest";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { FullscreenFrame, dockCap, frameHeight, useDockTop, useDockBottom } from "../../src/tui/FullscreenFrame.js";
import { bufferPhysicalRows } from "../../src/tui/composerRows.js";
import { POINTER, NBSP } from "../../src/tui/composerFrame.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function tapAt(r: { stdin: { write(s: string): void } }, col: number, row: number) {
  r.stdin.write(`\x1b[<0;${col};${row}M`);
  await tick();
  r.stdin.write(`\x1b[<0;${col};${row}m`);
  await settle();
}
const PROMPT = "❯ ";                          // POINTER + NBSP
const TEST_COLUMNS = 100;  // ink-testing-library hardcodes Stdout.columns to 100 (node_modules/ink-testing-library) — the app's
// own `deps.columns()` must match it, or the composer's internal wrapRows math (against `deps.columns()`) and
// Ink's ACTUAL Yoga layout width (fixed at 100 by the harness) disagree and nothing in this file wraps.
const INNER_WIDTH_80 = TEST_COLUMNS - stringWidth(POINTER + NBSP);  // 98 at the harness's fixed 100-column width

async function mountChat(opts: { columns?: number; rows?: number; entries?: unknown[] } = {}) {
  const fake = fakeRemote();
  const r = renderWithKeymap(
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode: "fullscreen", reason: "env_on" }}
      deps={{ columns: () => opts.columns ?? 100, rows: () => opts.rows ?? 24 }} />);
  await waitFor(() => plain(r.lastFrame()).includes(PROMPT));
  await settle();
  return { r, fake };
}

/** The rows the composer's frame ACTUALLY painted for the buffer: everything between its two rules. */
const paintedBufferRows = (frame: string | undefined): number => {
  const rows = plain(frame).split("\n");
  const rule = (l: string) => /^─+$/.test(l.trim());
  const first = rows.findIndex(rule);
  const last = rows.findIndex((l, i) => i > first && rule(l));
  expect(first, `no composer rules in:\n${plain(frame)}`).toBeGreaterThanOrEqual(0);
  expect(last).toBeGreaterThan(first);
  return last - first - 1;
};

// ── 1.6/1.7 — bufferPhysicalRows PINNED AGAINST THE REAL FRAME ─────────────────────────────────────────────
// `wrapRows` alone is the text's own row count; `renderBuffer` additionally paints an inverted blank cursor
// cell at end-of-line and (with a completion live) a dim ghost run, either of which can add a row at an
// exact inner-width boundary. Measured against a real Ink layout (not merely re-derived) so a Yoga disagreement
// between the row-Box cursor cell and the concatenated-string wrap would show up here, not just in the pure
// table.
//   MEASURED, and the one surprise recorded rather than silently worked around: `ink-testing-library`'s own
// `Stdout.columns` getter is HARDCODED to 100 (node_modules/ink-testing-library/build/index.js) — it ignores
// whatever this file's `deps.columns()` reports to the APP's own width math. Mounting at `deps.columns() = 80`
// (as most of this repo's tests do, harmlessly, because they never type a line near either boundary) makes
// the composer's own `innerWidth` arithmetic disagree with the real Yoga width the harness actually lays out
// against, and every wrap-boundary case below read back ONE row where the app's own math expected two — not a
// row-Box/concatenated-string disagreement at all, just a mismatched rig. Mounting at `deps.columns() = 100`
// instead — matching the harness's real, fixed width — removed the mismatch, and Ink's row-Box cursor-cell
// layout then agreed with the concatenated-string wrap in every case below (EOL boundary and the wrapping
// ghost alike): the projection needed no adjustment once measured against the width Ink was actually using.
describe("S1 — bufferPhysicalRows against the real frame", () => {
  const atEol = (n: number) => "x".repeat(n);

  it(`innerWidth−1 (${INNER_WIDTH_80 - 1}) characters, cursor at EOL: one row`, async () => {
    const { r } = await mountChat();
    const text = atEol(INNER_WIDTH_80 - 1);
    r.stdin.write(text);
    await waitFor(() => plain(r.lastFrame()).includes(text));
    await settle();
    const projected = bufferPhysicalRows({ lines: [text], cursor: { row: 0, col: text.length }, ghost: null, placeholder: null, innerWidth: INNER_WIDTH_80 });
    expect(projected).toBe(paintedBufferRows(r.lastFrame()));
    r.unmount();
  });

  it(`innerWidth (${INNER_WIDTH_80}) characters, cursor at EOL: two rows — the blank cursor cell wraps`, async () => {
    const { r } = await mountChat();
    const text = atEol(INNER_WIDTH_80);
    r.stdin.write(text);
    // A wrapped line no longer contains the WHOLE typed string on one row — wait on its head instead.
    await waitFor(() => plain(r.lastFrame()).includes(text.slice(0, 10)));
    await settle();
    const projected = bufferPhysicalRows({ lines: [text], cursor: { row: 0, col: text.length }, ghost: null, placeholder: null, innerWidth: INNER_WIDTH_80 });
    expect(projected).toBe(paintedBufferRows(r.lastFrame()));
    r.unmount();
  });

  it(`innerWidth+1 (${INNER_WIDTH_80 + 1}) characters, cursor at EOL: two rows`, async () => {
    const { r } = await mountChat();
    const text = atEol(INNER_WIDTH_80 + 1);
    r.stdin.write(text);
    await waitFor(() => plain(r.lastFrame()).includes(text.slice(0, 10)));
    await settle();
    const projected = bufferPhysicalRows({ lines: [text], cursor: { row: 0, col: text.length }, ghost: null, placeholder: null, innerWidth: INNER_WIDTH_80 });
    expect(projected).toBe(paintedBufferRows(r.lastFrame()));
    r.unmount();
  });

  // `mod` ghosts to `/mode` — the shortest prefix match (completions.ts's own doc comment) — and the mid-text
  // trigger (`completionTriggers.ts`'s `COMMAND_TRIGGER`) needs a whitespace boundary before the `/`, so the
  // line is padded with `a`s and a space so the WHOLE line (including the one-character "e" ghost) lands
  // exactly on the innerWidth boundary: `innerWidth` characters of text (fits in one row alone) plus the
  // ghost's one character crosses it into two.
  it("a wrapping ghost: the line alone fits, the ghost pushes it over the boundary", async () => {
    const { r } = await mountChat();
    const text = "a".repeat(INNER_WIDTH_80 - 5) + " /mod";
    expect(text.length).toBe(INNER_WIDTH_80);
    r.stdin.write(text);
    // The catalog reaches the open command state through an effect — one render behind the keystroke
    // (f5-acceptance.test.tsx's own note on the same mechanism).
    await waitFor(() => plain(r.lastFrame()).includes("mode") || plain(r.lastFrame()).includes(text));
    await settle();
    const projected = bufferPhysicalRows({ lines: [text], cursor: { row: 0, col: text.length }, ghost: "e", placeholder: null, innerWidth: INNER_WIDTH_80 });
    expect(projected).toBe(paintedBufferRows(r.lastFrame()));
    r.unmount();
  });
});

// ── 1.8/1.9 — useDockBottom + THE WATCHDOG ──────────────────────────────────────────────────────────────────
// Mounted the way `fullscreen-frame.test.tsx` mounts `FullscreenFrame` directly: no `ChatApp`, no keymap, a
// probe component in `dock` reading the context straight. `useDockTop()` is read alongside it in every case —
// the watchdog firing must zero `dockBottom` WITHOUT disturbing `dockTop`, which is the other half of the
// dual refusal (ChatComposer's own `bufferTop < dockTop` check covers what this watchdog cannot see).
function Probe() {
  return <Text>{`top:${useDockTop()} bottom:${useDockBottom()}`}</Text>;
}
const readProbe = (frame: string | undefined): { top: number; bottom: number } => {
  const m = /top:(-?\d+) bottom:(-?\d+)/.exec(plain(frame) ?? "");
  expect(m, `no probe output in:\n${plain(frame)}`).not.toBeNull();
  return { top: Number(m![1]), bottom: Number(m![2]) };
};
const band = (n: number, tag: string) => (
  <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`${tag}${i}`}</Text>)}</Box>
);

describe("S1 — useDockBottom + the dock-slot watchdog", () => {
  it("rows=24 with a one-row dock: FRAME_TOP_ROW + frameHeight(24) - 1 = 23", async () => {
    const { lastFrame } = render(<FullscreenFrame rows={24} regionChildren={band(2, "R")} dock={<Probe />} />);
    await tick();
    expect(readProbe(lastFrame())).toEqual({ top: expect.any(Number), bottom: 23 });
  });

  it('mode="classic": not addressable, 0', async () => {
    const { lastFrame } = render(<FullscreenFrame mode="classic" rows={24} regionChildren={band(2, "R")} dock={<Probe />} />);
    await tick();
    expect(readProbe(lastFrame())).toEqual({ top: 0, bottom: 0 });
  });

  it("a dock taller than dockCap(24, false): the watchdog fires — bottom is 0, top is UNCHANGED", async () => {
    const cap = dockCap(24, false);
    const tall = (
      <Box flexDirection="column">
        <Probe />
        {Array.from({ length: cap + 5 }, (_, i) => <Text key={i}>{`D${i}`}</Text>)}
      </Box>
    );
    const { lastFrame } = render(<FullscreenFrame rows={24} regionChildren={band(2, "R")} dock={tall} />);
    await tick();
    const { top, bottom } = readProbe(lastFrame());
    expect(bottom).toBe(0);
    expect(top).toBeGreaterThan(0);          // the watchdog's own scope: dockTop is untouched
  });
});

// ── 1.12/1.13 — THE COMPOSER'S BOTTOM-UP ORIGIN: THE OCCUPANT MATRIX ────────────────────────────────────────
// Canon's own claim (L606604 / L200134-200163): a busy turn, an open task panel, a compaction row and a
// configured statusLine all reposition the caret rather than refusing it — `dockCrowded` used to refuse every
// one of these. Five short logical lines, one digit per line ("0000000000"…), joined with Ctrl-J so each is
// its own real screen row independent of Ink's word-wrap (the same fixture `clickCaret.test.tsx`'s old
// "fail safe" block used, inverted here): a click aimed at line 0's own screen row that resolves against the
// wrong row lands on a DIFFERENT line, which is what makes this prove correct repositioning rather than an
// accidental no-op.
const NL = "\x0a";
const digitLines = (n: number) => Array.from({ length: n }, (_, i) => String(i).repeat(10)).join(NL);
const plainFrame = (r: { lastFrame(): string | undefined }) => plain(r.lastFrame());

/** Click the middle of line 0 ("0000000000"), type X, assert it landed inside line 0 rather than on
 *  whichever row a wrong (or refused) origin would have resolved against. */
async function clickFirstLineAndType(r: { stdin: { write(s: string): void }; lastFrame(): string | undefined }) {
  const rows = plainFrame(r).split("\n");
  const idx = rows.findIndex((l) => l.includes("0000000000"));
  expect(idx, `"0000000000" is not painted in:\n${plainFrame(r)}`).toBeGreaterThanOrEqual(0);
  const textCol = rows[idx]!.indexOf("0000000000") + 1;
  await tapAt(r, textCol + 5, idx + 1);                    // aim at the middle of the digit run
  r.stdin.write("X");
  await waitFor(() => plainFrame(r).includes("X"));
  await settle();
}

describe("S1 — the composer's bottom-up origin: the occupant matrix", () => {
  it("idle composer (no occupant): a click moves the caret", async () => {
    const { r } = await mountChat();
    r.stdin.write(digitLines(3));
    await waitFor(() => plainFrame(r).includes("2222222222"));
    await settle();
    await clickFirstLineAndType(r);
    expect(plainFrame(r)).toContain("00000X00000");
    r.unmount();
  });

  it("live-turn spinner (busy: true): a click still moves the caret", async () => {
    const submitted: string[] = [];
    let fake!: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({ submit: async (prompt) => { submitted.push(prompt); fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); } });
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => TEST_COLUMNS, rows: () => 24 }} />);
    await waitFor(() => plainFrame(r).includes(PROMPT));
    await settle();
    r.stdin.write("go");
    await waitFor(() => plainFrame(r).includes("go"));
    r.stdin.write("\r");
    await waitFor(() => submitted.length === 1);
    await settle();
    r.stdin.write(digitLines(3));
    await waitFor(() => plainFrame(r).includes("2222222222"));
    await settle();
    await clickFirstLineAndType(r);
    expect(plainFrame(r)).toContain("00000X00000");
    r.unmount();
  });

  for (const n of [1, 3, 6]) {
    // Six tasks + a five-line spinner-panel header + a three-line draft genuinely OUTGROWS `dockCap(24,
    // false)` (12) — a real overflow (§1.19's own territory), not a co-occupant repositioning question. A
    // taller pane (40 rows → cap 20) keeps this cell about "does a large task panel still let the caret
    // reposition," not about the separate overflow-refusal claim step 1.19 owns.
    const paneRows = n >= 6 ? 40 : 24;
    it(`task panel with ${n} task(s): a click still moves the caret`, async () => {
      let fake!: ReturnType<typeof fakeRemote>;
      fake = fakeRemote({});
      const r = renderWithKeymap(
        <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
          renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => TEST_COLUMNS, rows: () => paneRows }} />);
      await waitFor(() => plainFrame(r).includes(PROMPT));
      await settle();
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      for (let i = 1; i <= n; i++) {
        const id = `tu${i}`;
        fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
        fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: `Task #${i} created successfully: todo-item-${i}` }] } } });
      }
      fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
      await waitFor(() => plainFrame(r).includes("todo-item-1"));
      await settle();
      r.stdin.write(digitLines(3));
      await waitFor(() => plainFrame(r).includes("2222222222"));
      await settle();
      await clickFirstLineAndType(r);
      expect(plainFrame(r)).toContain("00000X00000");
      r.unmount();
    });
  }

  for (const withBar of [true, false]) {
    // `barWidth(columns) > 0` at `columns=TEST_COLUMNS` (100); a narrow 15-column mount drops the bar
    // (`barWidth(15) = 0` — compactionBar.ts's own floor) while leaving the composer usable.
    const cols = withBar ? TEST_COLUMNS : 15;
    it(`compaction row ${withBar ? "WITH" : "WITHOUT"} the progress bar: a click still moves the caret`, async () => {
      const fake = fakeRemote({});
      const r = renderWithKeymap(
        <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
          renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => cols, rows: () => 24, now: () => 0 }} />);
      await waitFor(() => plainFrame(r).includes(PROMPT));
      await settle();
      fake.pushEvent({ kind: "message", data: { type: "system", subtype: "status", status: "compacting" } });
      await waitFor(() => plainFrame(r).toLowerCase().includes("compacting"));
      await settle();
      r.stdin.write(digitLines(3));
      await waitFor(() => plainFrame(r).includes("2222222222"));
      await settle();
      await clickFirstLineAndType(r);
      expect(plainFrame(r)).toContain("00000X00000");
      r.unmount();
    });
  }

  for (const lines of [1, 3]) {
    it(`a footer statusLine of ${lines} line(s): a click still moves the caret`, async () => {
      const text = Array.from({ length: lines }, (_, i) => `STATUS${i}`).join("\n");
      const fake = fakeRemote({});
      const r = renderWithKeymap(
        <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
          renderer={{ mode: "fullscreen", reason: "env_on" }}
          hookOpts={{ statusLine: { type: "command", command: "my-status" } }}
          deps={{ columns: () => TEST_COLUMNS, rows: () => 24, statusLine: { runStatusLine: async () => text } } as never} />);
      await waitFor(() => plainFrame(r).includes(PROMPT));
      await waitFor(() => plainFrame(r).includes("STATUS0"));
      await settle();
      r.stdin.write(digitLines(3));
      await waitFor(() => plainFrame(r).includes("2222222222"));
      await settle();
      await clickFirstLineAndType(r);
      expect(plainFrame(r)).toContain("00000X00000");
      r.unmount();
    });
  }

  it("a long draft that wraps ≥ 2 physical rows: a click on the SECOND painted row lands in the second row's text", async () => {
    const { r } = await mountChat();
    // One logical line of innerWidth + 5 characters — long enough to wrap to (at least) two painted rows.
    const text = "y".repeat(INNER_WIDTH_80 + 5);
    r.stdin.write(text);
    await waitFor(() => plainFrame(r).includes(text.slice(0, 10)));
    await settle();
    // The ROW POSITION is read off the two rules (`paintedBufferRows`'s own discipline) rather than off the
    // buffer's painted characters: the cursor's own row-Box, at exactly this boundary, paints the wrapped
    // text one column removed from a plain `wrapRows` split (measured — Ink lays the trailing cursor cell out
    // as a ROW SIBLING of the wrapped `before` Text rather than after its own last wrapped line), so hunting
    // for a specific character at a specific column is fragile here. The ROW COUNT is not affected (1.6/1.7
    // already pins it) — only where exactly a character sits within it — so this cell drives the click off
    // rule-relative row arithmetic, the same terms `composerOriginRow` itself is computed in, and lets
    // `caretFromLocalPosition`'s own (pure, paint-independent) wrap walk resolve the column.
    const rows = plainFrame(r).split("\n");
    const rule = (l: string) => /^─+$/.test(l.trim());
    const firstRule = rows.findIndex(rule);
    expect(firstRule, `no composer rule in:\n${plainFrame(r)}`).toBeGreaterThanOrEqual(0);
    const bufferTop = firstRule + 2;                     // 1-based: rule is row `firstRule+1`, buffer starts next
    const secondRow = bufferTop + 1;                      // the wrapped continuation
    await tapAt(r, 5, secondRow);                         // column 5 is safely inside the wrapped continuation
    r.stdin.write("Z");
    await waitFor(() => plainFrame(r).includes("Z"));
    await settle();
    // The click must resolve INTO the second (wrapped-continuation) row — not the first row, and not a
    // refusal that leaves "Z" appended wherever the cursor's true end already was.
    const finalRows = plainFrame(r).split("\n");
    const zRowIdx = finalRows.findIndex((l) => l.includes("Z"));
    expect(zRowIdx + 1, `Z landed on the wrong row:\n${plainFrame(r)}`).toBe(secondRow);
    r.unmount();
  });
});

// ── 1.19 — BOTH OVERFLOW CHECKS ──────────────────────────────────────────────────────────────────────────
// The dual refusal's two halves, each proven in the scenario that is ITS OWN (the other cannot fire there):
// composer-only growth past `dockCap`, with no other occupant and no ChatApp-level state change alongside
// it, where the frame's own watchdog effect never gets a re-render to run in (this component's OWN
// `bufferTop`/`composerTop` arithmetic is what refuses); and co-occupant growth (a task panel plus the
// live-turn spinner) that mounts through ChatApp state and so DOES reach the frame, letting its watchdog fire
// and zero `useDockBottom()`.
describe("S1 — both overflow checks", () => {
  it("composer growth alone, after the tree has settled, past dockCap: a click is refused", async () => {
    const { r } = await mountChat({ rows: 24 });
    // `settle()` inside `mountChat` already leaves no pending state; ten Ctrl-J lines push the dock
    // (composer: 10 rows + 2 rules = 12, plus the 1-row footer = 13) one row past `dockCap(24, false)` = 12,
    // with NOTHING else in the dock and no ChatApp-level state change riding along with the growth — a
    // MINIMAL overflow chosen so the frame's own outer clip (which eats from the BOTTOM once the dock
    // outgrows the frame — FullscreenFrame's own header) takes only the footer's row, leaving every digit
    // line on screen to assert against. `waitFor` is anchored on the LAST digit specifically (not merely
    // "a 9 appears somewhere") so it cannot resolve before the whole draft has landed.
    const lines = 10;
    r.stdin.write(Array.from({ length: lines }, (_, i) => String(i % 10)).join(NL));
    const rowsOf = () => plainFrame(r).split("\n");
    await waitFor(() => rowsOf().some((l) => l.trim() === `${(lines - 1) % 10}`));
    await settle();
    await tapAt(r, 5, 10);                        // some earlier row in the buffer's own band
    r.stdin.write("X");
    await waitFor(() => rowsOf().some((l) => l.trim() === `${(lines - 1) % 10}X`));
    await settle();
    // Refused: "X" landed at the buffer's TRUE end (the last typed digit), not at the clicked cell —
    // checked positively rather than merely "the frame changed," which a wrong-row resolution would too.
    expect(rowsOf().some((l) => l.trim() === `${(lines - 1) % 10}X`), `"X" did not land at the buffer's true end:\n${plainFrame(r)}`).toBe(true);
    r.unmount();
  });

  // `useDockBottom()` reading 0 here is the frame's own watchdog firing — proven directly, against the exact
  // geometry this cell reaches, by the "S1 — useDockBottom + the dock-slot watchdog" block above (a dock
  // taller than `dockCap` zeroes it with `dockTop` untouched). `ChatApp` exposes no seam to mount a probe
  // INSIDE its own `dock` JSX without a product code change outside this task's scope, so the claim here is
  // the observable end of that same mechanism: the combined occupants below cross `dockCap(24, false)` = 12
  // (task panel ~8 rows + spinner 1 + composer 5 + footer 1 = 15), and both mount through ChatApp state
  // (`state.tasks`, `state.busy`) — the one condition under which the frame DOES re-render and the watchdog
  // is fresh — so the refusal below is `dockBottom` answering 0, not `dockTop` going stale.
  it("task panel + spinner + composer growth combined, crossing dockCap: a click is refused", async () => {
    let fake!: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({});
    // Six tasks + the live-turn spinner + a three-line draft (28 rows / `dockCap(28, false)` = 14): the
    // combined band is one row over the cap — a MINIMAL overflow, chosen so the outer clip (which eats from
    // the bottom once the dock outgrows the frame) takes only the footer's row, leaving the task panel, the
    // spinner and all three draft lines on screen to assert against.
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => TEST_COLUMNS, rows: () => 28 }} />);
    await waitFor(() => plainFrame(r).includes(PROMPT));
    await settle();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });   // the live-turn spinner
    for (let i = 1; i <= 6; i++) {
      const id = `tu${i}`;
      fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
      fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: `Task #${i} created successfully: todo-item-${i}` }] } } });
    }
    await waitFor(() => plainFrame(r).includes("todo-item-1"));
    await settle();
    r.stdin.write(digitLines(3));
    await waitFor(() => plainFrame(r).includes("2222222222"));
    await settle();
    await tapAt(r, 5, 10);                       // aimed at the FIRST line — a working origin would land here
    r.stdin.write("X");
    await waitFor(() => plainFrame(r).includes("X"));
    await settle();
    // Refused: "X" landed at the buffer's TRUE end ("2222222222X"), not spliced into the clicked first line
    // ("00000X00000") — the same positive check `clickCaret.test.tsx`'s own fail-safe fixture used.
    expect(plainFrame(r)).toContain("2222222222X");
    expect(plainFrame(r)).not.toContain("00000X00000");
    r.unmount();
  });

  it("palette hoisted: a click is refused", async () => {
    const { r } = await mountChat();
    r.stdin.write("/");
    await waitFor(() => plainFrame(r).includes("/"));
    await settle();
    const before = plainFrame(r);
    await tapAt(r, 5, 10);
    r.stdin.write("X");
    await waitFor(() => plainFrame(r) !== before);
    await settle();
    // Refused: "X" lands right after the buffer's true end ("/X"), not spliced mid-command.
    expect(plainFrame(r)).toContain("/X");
    r.unmount();
  });
});
