// tui/test/live-window-mainscreen.test.tsx — FSW Task 3: the main screen's rendering boundary is now TWO
// phases that answer two different questions.
//   · COMMIT (reconcile, settle-driven): which finalized items have left the live window for good and must
//     be published into append-only <Static>. Owned by useChat; `publishedIds` stays the authority.
//   · WINDOW (render-time, ChatApp): which of the UNPUBLISHED tail is live right now, at the width and
//     height the terminal has THIS frame. Owned by a useMemo, so it re-derives on every re-render.
// The two are deliberately not the same decision: a window that shrank during a resize drag must NOT drag
// the commit ratchet down with it (the items simply stop rendering until the next settle), and a window
// that grew must never re-admit something already in <Static> (that would print it twice).
//
// TEST STRENGTH, deliberately chosen (plan review I3): the model is pinned by RECORDING `state.staticItems`
// per render through a harness component, never by grepping frames. `ink-testing-library` renders Ink in
// `debug: true`, where every render writes `fullStaticOutput + output` — so a live item appears in as many
// frames as there were renders and a frame census cannot count publications at all. There is exactly ONE
// frame-level assertion here (an item that left the window is absent from `lastFrame()`), because that one
// claim is about pixels rather than state.
//
// The expected counts below are LITERAL, hand-derived numbers with their arithmetic written out — never
// `mainWindowCap(rows) - WINDOW_SLACK` re-evaluated in the test, which would only pin the constant to
// itself (the wave's fixture-derived-from-constant rule).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote, type FakeRemote } from "./helpers/fakeRemote.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { useChat } from "../../src/tui/useChat.js";
import { renderItemHeight } from "../../src/tui/pager.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const flat = (f: () => string | undefined) => plain(f()).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
/** One top-level assistant text frame — projects to exactly ONE `kind: "line"` item, i.e. one row. */
const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
const ids = (items: readonly RenderItem[]) => items.map((i) => i.id);
const rowsOf = (items: readonly RenderItem[]) => items.reduce((sum, i) => sum + renderItemHeight(i), 0);

/** The harness spy: mounts `useChat` alone (no ChatApp chrome), records the `staticItems` array identity of
 *  every render, and exposes the live projection so a test can compare the two halves. */
function mountSpy(fake: FakeRemote, rows: number) {
  const renders: { published: readonly RenderItem[]; finalized: readonly RenderItem[] }[] = [];
  function H() {
    const c = useChat(() => fake, {}, { now: () => 0, columns: () => 80, rows: () => rows, scheduleRepaint: () => () => {} });
    renders.push({ published: c.state.staticItems, finalized: c.state.finalizedItems });
    return <Text>n={c.state.staticItems.length}/{c.state.finalizedItems.length}</Text>;
  }
  const inst = render(<H />);
  const last = () => renders[renders.length - 1]!;
  return { ...inst, renders, last };
}

/** FSW TASK 4 — the same spy over a MOVABLE geometry, plus the one thing the terminal supplies in production
 *  and a bare `useChat` mount does not: the RE-RENDER a size change causes. ChatApp holds the terminal size in
 *  React state (`ChatApp.tsx`'s `size`), so every SIGWINCH it observes re-renders this hook — which is the
 *  render at which the hook can notice the width moved. `rerender()` stands in for exactly that, and the
 *  companion case below drives the real path (ChatApp + `onResize`) end to end so the stand-in cannot drift. */
function mountMovableSpy(fake: FakeRemote, geo: { columns: number; rows: number }) {
  const renders: { published: readonly RenderItem[]; finalized: readonly RenderItem[] }[] = [];
  let bump: () => void = () => {};
  function H() {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    const c = useChat(() => fake, {}, { now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} });
    renders.push({ published: c.state.staticItems, finalized: c.state.finalizedItems });
    return <Text>n={c.state.staticItems.length}/{c.state.finalizedItems.length}</Text>;
  }
  const inst = render(<H />);
  const last = () => renders[renders.length - 1]!;
  return { ...inst, renders, last, rerender: () => bump() };
}

describe("FSW T3 — commit is settle-driven, the window is render-time", () => {
  // rows − dock(14) − SLACK(2) is the live budget: 15 → −1 → 0 live rows, 24 → 8, 40 → 24.
  // Twelve one-row items therefore publish 12, 4 and 0 of themselves respectively.
  for (const [rows, expectedPublished] of [[15, 12], [24, 4], [40, 0]] as const) {
    it(`at ${rows} rows, ${expectedPublished} of twelve one-row items have left the window and been committed`, async () => {
      const fake = fakeRemote();
      const spy = mountSpy(fake, rows);
      await new Promise((r) => setTimeout(r, 0));
      for (let n = 1; n <= 12; n++) { fake.pushEvent({ kind: "message", data: say(n) }); await new Promise((r) => setTimeout(r, 0)); }
      await waitFor(() => spy.last().finalized.length === 12);

      const { published, finalized } = spy.last();
      expect(published.length).toBe(expectedPublished);
      // Projection order, and a PREFIX of it: what is committed is always the head of the transcript.
      expect(ids(published)).toEqual(ids(finalized).slice(0, expectedPublished));
      // The unpublished tail is what ChatApp will window, and it fits the budget by construction.
      expect(rowsOf(finalized.slice(expectedPublished))).toBeLessThanOrEqual(rows - 14 - 2 < 0 ? 0 : rows - 14 - 2);

      // Append-only, exactly once: every recorded render's published list is a prefix of the next.
      const seen = new Set<string>();
      let previous: string[] = [];
      for (const { published: p } of spy.renders) {
        const now = ids(p);
        expect(now.slice(0, previous.length)).toEqual(previous);
        for (const id of now.slice(previous.length)) { expect(seen.has(id)).toBe(false); seen.add(id); }
        previous = now;
      }
    });
  }

  it("an item taller than the whole budget commits WHOLE, and the window is what sits below it", async () => {
    // 18 rows → 18 − 14 − 2 = 2 live rows. The Bash result's compact body is four rows (three plus the
    // overflow marker), so it can never be in any window: it commits entire rather than being split, and
    // the one-row prose beneath it is what stays live.
    const fake = fakeRemote();
    const spy = mountSpy(fake, 18);
    await new Promise((r) => setTimeout(r, 0));
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: "u-bash", message: { id: "m-bash", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "echo hi" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "u-bash-r", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n"), is_error: false }] } } });
    fake.pushEvent({ kind: "message", data: say(99) });   // the breaker that finalizes the call, and the live tail
    await waitFor(() => spy.last().finalized.some((i) => i.kind === "line" && i.line.text.includes("ALPHA-99")));

    const { published, finalized } = spy.last();
    const body = finalized.find((i) => i.kind === "gutter-block");
    expect(body).toBeDefined();
    expect(renderItemHeight(body!)).toBeGreaterThan(2);
    // Committed whole — the same object, every row of it, never a slice.
    expect(ids(published)).toContain(body!.id);
    expect(published.find((i) => i.id === body!.id)).toEqual(body);
    // …and the prose below it is still live.
    expect(ids(published)).not.toContain(finalized[finalized.length - 1]!.id);
  });

  it("a narrowing drag shrinks the window WITHOUT committing, and a grow brings the same items back", async () => {
    // THE ONE frame-level assertion in this file: the six items are never published at 40 rows, so when the
    // window shrinks to nothing they are absent from the frame outright — not merely moved into <Static>.
    let rows = 40;
    let fire: () => void = () => {};
    const fake = fakeRemote();
    const app = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 80, rows: () => rows, scheduleRepaint: () => () => {} }}
        onResize={(cb) => { fire = cb; return () => {}; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    for (let n = 1; n <= 6; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => flat(app.lastFrame).includes("ALPHA-6"));
    expect(flat(app.lastFrame)).toContain("ALPHA-1");

    rows = 15; fire();                                    // 15 − 14 − 2 → no live rows at all
    await waitFor(() => !flat(app.lastFrame).includes("ALPHA-6"));
    const shrunk = flat(app.lastFrame);
    for (let n = 1; n <= 6; n++) expect(shrunk).not.toContain(`ALPHA-${n}`);

    rows = 40; fire();                                    // the drag ratcheted nothing away
    await waitFor(() => flat(app.lastFrame).includes("ALPHA-6"));
    expect(flat(app.lastFrame)).toContain("ALPHA-1");
  });

  it("a terminal GROW never renders a committed item twice", async () => {
    // The C1 case. At 24 rows the head of the transcript is in <Static>; growing to 40 widens the window,
    // and if the selector were fed the FINALIZED items rather than the unpublished ones those same rows
    // would be painted a second time in the live subtree — once from `fullStaticOutput`, once from `output`.
    let rows = 24;
    let fire: () => void = () => {};
    const fake = fakeRemote();
    const app = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 80, rows: () => rows, scheduleRepaint: () => () => {} }}
        onResize={(cb) => { fire = cb; return () => {}; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    for (let n = 1; n <= 12; n++) { fake.pushEvent({ kind: "message", data: say(n) }); await new Promise((r) => setTimeout(r, 0)); }
    await waitFor(() => flat(app.lastFrame).includes("ALPHA-12"));
    expect(occurrences(flat(app.lastFrame), "ALPHA-1 ")).toBe(1);

    rows = 40; fire();
    await new Promise((r) => setTimeout(r, 10));
    const grown = flat(app.lastFrame);
    for (let n = 1; n <= 12; n++) expect(occurrences(grown, `ALPHA-${n} `)).toBe(1);
  });

  // FIX ROUND (review I2) — THIS PIN CHANGED SEMANTICS, and it is the one place the change is visible.
  // T3 shipped `paneOwned` as a pure BLANK: the dock budget must not have to cover a dialog as well, so the
  // window rendered nothing while one was up. Measured consequence: for the life of ANY pane-owning surface
  // the last `rows − 16` rows of transcript left the screen — eight at 24 rows, twenty-four at 40 — and came
  // back when it closed. Before this task those rows were in scrollback ABOVE the dialog and stayed readable.
  // They are again, and by the honest route: a dialog opening is a SETTLED event, so the window is COMMITTED
  // rather than hidden, and `<Static>` is where committed rows live. The dock budget is protected exactly as
  // before (nothing unpublished is left, so the window is empty because it is EMPTY) and the accepted cost is
  // one more driver of the one-way ratchet: rows committed by a dialog are frozen at the width they had.
  it("a dialog taking the pane COMMITS the window instead of blanking it — the rows stay readable above it", async () => {
    const rows = 40;
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    // Under the keymap provider: `?` only reaches the overlay through the binding table (F2 task 6), and the
    // provider subscribes to stdin in a passive effect — hence the tick before any key is written.
    const app = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 80, rows: () => rows, scheduleRepaint: () => () => {} }} />,
    );
    await tick();
    for (let n = 1; n <= 4; n++) fake.pushEvent({ kind: "message", data: say(n) });
    await waitFor(() => flat(app.lastFrame).includes("ALPHA-4"));
    // alt+p — the model picker, one of the eight pane-owning surfaces (`paneOwned`). NOT the `?` overlay:
    // that one is content-sized and deliberately NOT on that list, which is the distinction the flag draws.
    app.stdin.write("\x1bp");
    await waitFor(() => flat(app.lastFrame).includes("Select model"));
    // THE FRAME IS THE PROOF, and it is not a weaker one than a model read would be. The render window is
    // empty for as long as `paneOwned` holds — that is unchanged and unconditional in the memo — so a row
    // that is on screen underneath the picker can only be arriving from `fullStaticOutput`, which is
    // `ink-testing-library`'s stand-in for the terminal's scrollback and holds committed rows alone.
    for (let n = 1; n <= 4; n++) expect(occurrences(flat(app.lastFrame), `ALPHA-${n} `)).toBe(1);
    // …and closing it does not print them a second time: the commit was a publish, not a copy.
    app.stdin.write("\x1b");
    await waitFor(() => !flat(app.lastFrame).includes("Select model"));
    for (let n = 1; n <= 4; n++) expect(occurrences(flat(app.lastFrame), `ALPHA-${n} `)).toBe(1);
  });
});


// ── FSW TASK 4 — the settled width change re-projects what is still live ─────────────────────────────────
// T3 split the boundary in two and gave the WINDOW half a resize-following cadence, which closed the height
// question: a shorter terminal selects fewer items on the very frame it shrinks. It could not close the WIDTH
// question, because the window SELECTS items and does not MAKE them: every row here was projected at a width
// (`projectionContext().columns`) and stays wrapped for that width until something re-projects it. Reconcile
// ran on document movement alone, so a resized-and-then-idle session showed a tail wrapped for a terminal
// that no longer existed. This is the third driver of reconcile, and the one geometry may pull.
//
// THE FIXTURE IS A USER ECHO, and it is chosen rather than convenient: prose paragraphs are NOT wrapped by
// the compact projection at all (`markdown.ts` fits only tables to the width; Ink wraps prose at paint time),
// so an assistant line's ITEM COUNT is width-invariant and would make a green test out of a broken build. The
// width-sensitive rows are the ones the projection lays out itself — the user echo's band (`userEchoLines`,
// padded to `width − 1` around a 2-column gutter), a folded tool body, a table. The echo is the smallest of
// them and the arithmetic is exact: content width is `width − 3`, the text is 40 tokens of `Wnn` at 4 columns
// each (three glyphs and a space, the last without), so a row holds `floor((width − 2) / 4)` of them.
//     width 80 → 19 tokens per row → ceil(40/19) = 3 rows
//     width 120 → 29 → ceil(40/29) = 2 rows
//     width 50 → 12 → ceil(40/12) = 4 rows
const REFLOW_TOKENS = Array.from({ length: 40 }, (_, i) => `W${String(i + 1).padStart(2, "0")}`);
const longEcho = { type: "user", uuid: "u-echo", message: { content: [{ type: "text", text: REFLOW_TOKENS.join(" ") }] } };
/** Longer than `RESIZE_SETTLE_MS` (80 ms), because the re-projection deliberately waits for the drag to stop:
 *  a commit is irreversible and must not ride a width the user is only passing through. */
const settled = () => new Promise((r) => setTimeout(r, 250));
const echoRows = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line" && /W\d\d/.test(i.line.text)).length;

describe("FSW T4 — a settled column change re-projects the live tail", () => {
  it("re-wraps the unpublished tail at the new width and leaves every committed row byte-identical", async () => {
    // 24 rows → 24 − 14 − 2 = 8 live rows. Six one-row prose items plus a three-row echo is nine rows, so
    // exactly one item is committed at 80 columns and the other eight are the window.
    const geo = { columns: 80, rows: 24 };
    const fake = fakeRemote();
    const spy = mountMovableSpy(fake, geo);
    await new Promise((r) => setTimeout(r, 0));
    for (let n = 1; n <= 6; n++) { fake.pushEvent({ kind: "message", data: say(n) }); await new Promise((r) => setTimeout(r, 0)); }
    fake.pushEvent({ kind: "message", data: longEcho });
    await waitFor(() => spy.last().finalized.some((i) => i.kind === "line" && i.line.text.includes("W40")));
    expect(echoRows(spy.last().finalized)).toBe(3);
    const committedAt80 = spy.last().published.map((i) => JSON.parse(JSON.stringify(i)));
    expect(committedAt80.length).toBe(1);

    // A WIDENING first, because it is the direction that cannot be confused with a commit: the tail gets
    // SHORTER, so nothing new can leave the window and `staticItems` must come through untouched.
    geo.columns = 120; spy.rerender();
    await settled();
    expect(echoRows(spy.last().finalized)).toBe(2);
    expect(spy.last().published).toEqual(committedAt80);      // byte-identical, not merely the same length

    // …and a narrowing, which is where the two halves are visible at once: the echo costs a fourth row, the
    // tail no longer fits the eight-row budget, and one more item commits. What was already committed is
    // still exactly what it was — the ratchet APPENDS, it never re-writes (and never re-wraps) its head.
    geo.columns = 50; spy.rerender();
    await settled();
    expect(echoRows(spy.last().finalized)).toBe(4);
    const committedAt50 = spy.last().published;
    expect(committedAt50.length).toBeGreaterThan(committedAt80.length);
    expect(committedAt50.slice(0, committedAt80.length)).toEqual(committedAt80);
  });

  it("…and the terminal's own resize is what drives it: the frame re-wraps after `onResize` fires", async () => {
    // The companion to the case above, through the REAL path — ChatApp holds the size in React state, so the
    // resize callback is what re-renders `useChat` and lets it notice the width moved. `resize-state.test.tsx`'s
    // `fire()` pattern; the geometry stays under `ink-testing-library`'s own 100-column stdout so that Ink is
    // never the thing doing the wrapping.
    const geo = { columns: 80, rows: 40 };
    let fire: () => void = () => {};
    const fake = fakeRemote();
    const app = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => geo.columns, rows: () => geo.rows, scheduleRepaint: () => () => {} }}
        onResize={(cb) => { fire = cb; return () => {}; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    fake.pushEvent({ kind: "message", data: longEcho });
    await waitFor(() => (app.lastFrame() ?? "").includes("W40"));
    const rowWith = (needle: string) => plain(app.lastFrame()).split("\n").find((l) => l.includes(needle)) ?? "";
    expect(rowWith("W01")).toContain("W19");                  // 19 tokens fit the 77-column band
    expect(rowWith("W01")).not.toContain("W20");

    geo.columns = 50; fire();
    await settled();
    expect(rowWith("W01")).toContain("W12");                  // …12 fit the 47-column one
    expect(rowWith("W01")).not.toContain("W13");
  });
});
