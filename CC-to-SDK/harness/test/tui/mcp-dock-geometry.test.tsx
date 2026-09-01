// tui/test/mcp-dock-geometry.test.tsx — bl10 merge-battery, D15's combined post-merge integration test.
// T-MENU (`/mcp`, a full-pane dialog that joined `paneOwned` in ChatApp.tsx so the transcript/task-panel/
// spinner unmount under it) and T-SPACE (the live-turn slot's + composer's own `marginTop={1}`, and
// `MAIN_DOCK_ROWS` 14→16 to reserve for them) each shipped their own geometry coverage, but neither branch
// could see the OTHER's effect: T-MENU's own suite never fills the dock to its T-SPACE-sized worst case, and
// T-SPACE's own suite (`chrome-margin-tallwrite.test.tsx`) never opens a pane-owning dialog. This file is the
// one scenario that needs both landed at once: the `/mcp` dialog, opened over a maxed todo panel and a
// ticking turn spinner, at the SHORT (18) and NORMAL (40) terminal heights the two branches' own specs name.
//
// Uses `renderRealInk` (`fakeTty.tsx`), not `ink-testing-library`: that library's `debug: true` render skips
// Ink's tall-frame check entirely (`ink.js:121`), so the one defect this file exists to catch — the combined
// dock overflowing the pane and Ink reprinting the whole session into scrollback — would be invisible to it.
// The tall-write assertion idiom (`tallWritesSince(mark)` after a `mark()` taken right before the action
// under test) is `chrome-margin-tallwrite.test.tsx`'s own.
//
// SABOTAGE EVIDENCE (recorded, both reverted via `git checkout` before this file was committed — no
// production source changed):
//   (a) removing `state.mcpDialog.open` from `paneOwned`'s disjunction (ChatApp.tsx) turned RED:
//       "the /mcp dialog owns the pane over a maxed todo panel + a ticking spinner at 18 rows"
//       "the /mcp dialog owns the pane over a maxed todo panel + a ticking spinner at 40 rows"
//   (b) reverting `MAIN_DOCK_ROWS` (liveWindow.ts) from 16 to 14 turned RED:
//       "closing /mcp again lets the maxed worst-case dock (queue + busy + max todo) refill with no tall-frame replay at 24 rows"
//       "closing /mcp again lets the maxed worst-case dock (queue + busy + max todo) refill with no tall-frame replay at 40 rows"
//   NOTE on (b)'s height: `chrome-margin-tallwrite.test.tsx`'s own "combined worst case" block already
//   established (and this file's dev loop re-confirmed by hand) that 18 rows cannot reach `MAIN_DOCK_ROWS`'s
//   true worst case AT ALL regardless of the constant's value — `todoWindowSize` itself caps the todo panel
//   below its 5-row maximum at that height, an existing and unrelated trade-off. 24 rows is this suite's
//   "short" case for the reservation check specifically because it is the shortest height where the todo
//   panel actually reaches its max, matching the range `chrome-margin-tallwrite.test.tsx`'s own sabotage
//   check uses (24/30/40, never 18).
import { describe, it, expect } from "vitest";
import React from "react";
import isInCi from "is-in-ci";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { renderRealInk, type FakeTty } from "./helpers/fakeTty.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";
import { SPINNER_VERBS } from "../../src/tui/spinner.js";

/** One top-level assistant text frame — exactly one row (same fixture `chrome-margin-tallwrite.test.tsx` uses). */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Ink's throttled log write is on a 32 ms leading/trailing timer; a settle has to outlast it. */
const settle = () => new Promise((r) => setTimeout(r, 120));

// The TurnSpinner's gerund is always one of these 186 made-up words (`spinner.ts`) followed by `…` — a
// discriminator that cannot collide with anything the MCP dialog, the todo panel or the footer render,
// unlike the pulse glyph itself (`SPINNER_BASE`'s `"·"` frame is also the dialog's own hint-list joiner).
const spinnerVerbLive = new RegExp(SPINNER_VERBS.join("|"));

// `is-in-ci` is read by `ink.js` at import time, and under CI it takes a different `onRender` branch where
// the tall-frame mechanism this file measures does not exist (see `chrome-margin-tallwrite.test.tsx`'s
// identical guard).
describe.skipIf(isInCi)("bl10 merge-battery (D15) — /mcp dialog + chrome margins, combined geometry", () => {
  /** 45 same-scope servers: `mcpListVisibleRows(40)` is 32, so this overflows the window at EITHER height
   *  under test (`mcpListVisibleRows(18)` is 10), which is what proves the dialog windows its own list
   *  rather than dumping it past the pane. */
  const MANY_SERVERS = Array.from({ length: 45 }, (_, i) => ({ name: `srv-${i}`, status: "connected" as const, scope: "project", tools: [] }));

  function mount(geo: { columns: number; rows: number }) {
    const fake = fakeRemote({ mcpServerStatus: () => MANY_SERVERS });
    const tree = <KeymapProvider><ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
      deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }} /></KeymapProvider>;
    const tty = renderRealInk(tree, geo);
    return { fake, tty };
  }

  /** Enough one-row items to leave a live, uncommitted tail in the window at either geometry under test —
   *  the same fixture and wait `chrome-margin-tallwrite.test.tsx`'s own `fill` uses. */
  async function fillTranscript(fake: FakeRemote, tty: FakeTty) {
    await settle();
    for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => tty.textSince(0).includes("ALPHA-40"));
    await settle();
  }

  /** Six tasks: one past `todoWindowSize`'s 5-row cap, so the todo panel reaches its true maximum — the
   *  same TaskCreate/tool_result shape `chrome-margin-tallwrite.test.tsx`'s combined worst-case block uses. */
  async function fillTasks(fake: FakeRemote, tty: FakeTty) {
    for (let i = 1; i <= 6; i++) {
      const id = `tu${i}`;
      fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
      fake.pushEvent({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: `Task #${i} created successfully: todo-item-${i}` }] } } });
    }
    await waitFor(() => tty.textSince(0).includes("6 tasks"));
    await settle();
  }

  for (const rows of [18, 40] as const) {
    it(`the /mcp dialog owns the pane over a maxed todo panel + a ticking spinner at ${rows} rows`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mount(geo);
      await fillTranscript(fake, tty);
      await fillTasks(fake, tty);
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });          // busy → the spinner would tick
      await settle();
      // Sanity: the spinner and the maxed todo panel really are up BEFORE the dialog opens — otherwise
      // their later absence would prove nothing.
      expect(tty.textSince(0)).toMatch(spinnerVerbLive);
      expect(tty.textSince(0)).toContain("6 tasks");

      const openMark = tty.mark();
      tty.stdin.write("/mcp");
      await waitFor(() => tty.textSince(openMark).includes("/mcp"));
      tty.stdin.write("\r");
      await waitFor(() => tty.textSince(openMark).includes("Manage MCP servers"));
      await settle();
      // NOT asserted here: `tallWritesSince(openMark)`. The SUBMIT transition itself — the composer's own
      // suggestion palette opening on the typed `/`, then the echoed `/mcp` line landing in the transcript a
      // frame before the dialog mounts — is measured (by hand, at 18 rows) to take a few over-height frames
      // on its own, independent of anything T-MENU or T-SPACE changed; `chrome-margin-tallwrite.test.tsx`'s
      // own palette case is never combined with its worst-case dock for the same reason. What D15 actually
      // cares about — the dialog's own STEADY frame, with the pane it now owns — is what the redraw below
      // measures instead: a clean, isolated repaint of exactly the frame that stays on screen.
      const opened = tty.textSince(openMark);
      expect(opened).toContain("Manage MCP servers");
      // Windowed, not dumped: 45 servers past either height's visible-row budget shows the counter instead
      // of overflowing.
      expect(opened).toMatch(/↓ \d+ more below/);

      // A SECOND live repaint (an in-list cursor move) is both the "frame fits" check for the settled dialog
      // AND the real test of "unmounted": everything outside Ink's <Static> repaints in full on every
      // render, so a transcript/task-panel/spinner that were only BLANKED (not actually removed from the
      // tree) would reappear right here, on the very next frame — the same reasoning `ChatApp.tsx`'s own
      // `paneOwned` commentary gives for why blanking alone is not enough (review finding I2).
      const redrawMark = tty.mark();
      tty.stdin.write("\x1b[B");
      await settle();
      expect(tty.tallWritesSince(redrawMark)).toBe(0);
      const redrawn = tty.textSince(redrawMark);
      expect(redrawn).not.toContain("ALPHA-");
      expect(redrawn).not.toContain("6 tasks");
      expect(redrawn).not.toMatch(spinnerVerbLive);

      tty.unmount();
    });
  }

  /** `chrome-margin-tallwrite.test.tsx`'s own "combined worst case" mount: a `submit` that never resolves
   *  (so the turn stays busy indefinitely, past the fake's default which ends the turn immediately) — the
   *  fixture that test's own sabotage check (MAIN_DOCK_ROWS 16→14) is proven against. Needed here in full,
   *  not the simpler direct `pushEvent({kind:"turn"})` the item-1 tests above use: opening `/mcp` commits
   *  every currently-unpublished transcript row to `<Static>` for good (the `paneOwned` publish effect,
   *  ChatApp.tsx), so unless the QUEUE band is also live (the one dock occupant that direct event injection
   *  alone does not reproduce) the post-close dock's real row cost lands one row under `MAIN_DOCK_ROWS`'s
   *  worst case and the reservation's own correctness is never actually exercised by the close. */
  function mountWorstCase(geo: { columns: number; rows: number }) {
    let fake!: FakeRemote;
    fake = fakeRemote({ mcpServerStatus: () => MANY_SERVERS, submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); } });
    const tree = <KeymapProvider><ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
      deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows }} /></KeymapProvider>;
    const tty = renderRealInk(tree, geo);
    return { fake, tty };
  }

  // 24/30-class heights are where `todoWindowSize` lets the todo panel actually reach its 5-row maximum
  // (`chrome-margin-tallwrite.test.tsx`'s own range) — 18 structurally cannot, regardless of the constant.
  for (const rows of [24, 40] as const) {
    it(`closing /mcp again lets the maxed worst-case dock (queue + busy + max todo) refill with no tall-frame replay at ${rows} rows`, async () => {
      const geo = { columns: 80, rows };
      const { fake, tty } = mountWorstCase(geo);
      await fillTranscript(fake, tty);
      await fillTasks(fake, tty);
      // The busy slot, via a REAL submission (not a direct `pushEvent`) — this is what also occupies the
      // composer's own draft, which the second, queued submission below needs to land in the QUEUE band
      // rather than dispatch immediately.
      tty.stdin.write("first prompt");
      await waitFor(() => tty.textSince(0).includes("first prompt"));
      await settle();
      tty.stdin.write("\r");
      await waitFor(() => spinnerVerbLive.test(tty.textSince(0)));
      await settle();
      // The queue band: MAIN_DOCK_ROWS's own itemization counts it as one of the seven occupants, and it is
      // the one this recipe cannot reach any other way.
      tty.stdin.write("queued prompt");
      await waitFor(() => tty.textSince(0).includes("queued prompt"));
      await settle();
      tty.stdin.write("\r");
      await settle();

      // Open, then close, the `/mcp` dialog over this dock — the D15 scenario itself.
      tty.stdin.write("/mcp");
      await waitFor(() => tty.textSince(0).includes("/mcp"));
      tty.stdin.write("\r");
      await waitFor(() => tty.textSince(0).includes("Manage MCP servers"));
      await settle();
      tty.stdin.write("\x1b");                                          // root Esc closes the dialog
      await settle();

      // The commit-on-open effect just flushed every then-unpublished transcript row to `<Static>` for
      // good, so the window is genuinely EMPTY right now — insensitive to `MAIN_DOCK_ROWS` by construction
      // (an empty window fits any cap). Fresh rows have to arrive AFTER the close to put real pressure back
      // on the reservation, exactly as `chrome-margin-tallwrite.test.tsx`'s own `fillWorstCase` does.
      const mark = tty.mark();
      for (let n = 1; n <= 40; n++) fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: `u-beta-${n}`, message: { id: `m-beta-${n}`, content: [{ type: "text", text: `BETA-${n}` }] } } });
      await waitFor(() => tty.textSince(mark).includes("BETA-40"));
      await settle();
      expect(tty.tallWritesSince(mark)).toBe(0);
      const refilled = tty.textSince(mark);
      expect(refilled).toContain("6 tasks");                            // the todo panel is back, at its max
      expect(refilled).toMatch(spinnerVerbLive);                        // the spinner slot is back
      expect(refilled).toContain("queued prompt");                      // the queue band is back
      expect(refilled).not.toContain("Manage MCP servers");             // the dialog itself stays gone

      tty.unmount();
    });
  }

  // Item 3 (spec): the suggest palette, combined with the dialog already closed, at the SHORT height only —
  // the one geometry where the composer's own marginTop actually has to drop to 0 for the palette's five
  // rows to fit at all (`chrome-margin-tallwrite.test.tsx`'s own palette case, now chained after a real
  // `/mcp` open/close instead of starting from a bare mount). NO busy turn and NO maxed todo panel here —
  // that combination is `chrome-margin-tallwrite.test.tsx`'s own "combined worst case" block, which
  // deliberately excludes 18 rows (its own header note: the todo panel cannot even reach its true max at
  // that height, and the worst-case dock plus the palette's own reserved rows together do not fit any
  // terminal this short — an existing, unrelated trade-off, not something this merge changed). What THIS
  // item verifies is narrower and IS in scope for the merge: that the palette's own margin math and the
  // `/mcp` dialog's pane-ownership do not corrupt each other across a real open → close → palette sequence.
  it("the suggest palette still fits at 18 rows after the /mcp dialog has been opened and closed", async () => {
    const geo = { columns: 80, rows: 18 };
    const { fake, tty } = mount(geo);
    await fillTranscript(fake, tty);

    tty.stdin.write("/mcp");
    await waitFor(() => tty.textSince(0).includes("/mcp"));
    tty.stdin.write("\r");
    await waitFor(() => tty.textSince(0).includes("Manage MCP servers"));
    await settle();
    const closeMark = tty.mark();
    tty.stdin.write("\x1b");                                            // root Esc closes the dialog
    await waitFor(() => tty.since(closeMark).length > 0);
    await settle();
    expect(tty.textSince(closeMark)).not.toContain("Manage MCP servers");

    const mark = tty.mark();
    tty.stdin.write("/");
    await waitFor(() => tty.textSince(mark).includes("/status"));
    await settle();
    expect(tty.tallWritesSince(mark)).toBe(0);
    expect(tty.textSince(mark)).toContain("/status");                   // the palette really opened

    tty.stdin.write("\x1b");                                            // close it — leaves no dangling listener
    await settle();
    tty.unmount();
  });

  // bl10 fix wave 1, finding 4: `mcpListVisibleRows` budgets exactly ONE row per root-list entry, but
  // `ServerLabel` used to render the name and the full status/failure text verbatim — a long name or a long
  // `failed: <error>` string wraps under Ink the moment it exceeds the pane's width, so one entry silently
  // costs two-plus lines and the window overflows the budget it was sized to, at a narrow pane clipping the
  // footer/counters off the bottom (the same "tall-frame replay" signal this file's own battery reads
  // elsewhere for an overflowing dock).
  it("clips a long server name + failure detail to one line at a narrow width — no tall-frame replay, footer survives", async () => {
    const LONG_FAIL = {
      name: "a-very-long-mcp-server-name-that-would-not-fit-on-one-narrow-line",
      status: "failed" as const,
      error: "connection refused after multiple retries against a very long diagnostic endpoint address",
      scope: "project" as const, tools: [] as never[],
    };
    const geo = { columns: 30, rows: 16 };
    const fake = fakeRemote({ mcpServerStatus: () => [LONG_FAIL] });
    const tree = <KeymapProvider><ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
      deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }} /></KeymapProvider>;
    const tty = renderRealInk(tree, geo);
    const mark = tty.mark();
    tty.stdin.write("/mcp");
    await waitFor(() => tty.textSince(mark).includes("/mcp"));
    tty.stdin.write("\r");
    await waitFor(() => tty.textSince(mark).includes("Manage MCP servers"));
    await settle();
    // One entry, one line: nothing about opening the dialog overflowed the pane and forced a scrollback replay.
    expect(tty.tallWritesSince(mark)).toBe(0);
    const f = tty.textSince(0);
    expect(f).toContain("…");                                           // the label was clipped, not wrapped
    expect(f).toMatch(/cancel|navigate/);                                // the hint bar still made it onto the frame
    tty.unmount();
  });
});
