// tui/test/live-window-painted.test.tsx — FSW BACKLOG 3: the CLASSIC live window pays in painted rows.
//
// THE FIFTH APPEARANCE OF ONE LESSON. T13b (a dialog), T14 (the notebook arm), T17 (the viewport) and the
// pager each found a budget counting LOGICAL lines over a document Ink paints WRAPPED. The main screen's
// selector was the one that kept counting: `renderMarkdown` never wraps prose, so a 200-column paragraph is
// ONE `kind: "line"` item that Ink paints as three at 80 columns — and a window "at cap" therefore painted
// three times its budget. The budget is not advisory: past `outputHeight >= stdout.rows` Ink writes
// `clearTerminal + fullStaticOutput + output` on EVERY frame (`build/ink.js:121`), i.e. reprints the whole
// session into scrollback, which is the defect this wave exists to prevent.
//
// MEASURED AT THE WINDOW ChatApp ACTUALLY RENDERS, not at a re-derivation of it: `Transcript` is wrapped so
// the `windowItems` array handed to the live subtree is the array under assertion. A frame census cannot do
// this job — `ink-testing-library` renders with `debug: true`, where every paint writes
// `fullStaticOutput + output`, so committed and live rows are indistinguishable in `lastFrame()`.
//
// RED on the parent commit, same harness, twelve 200-column paragraphs at 80x24:
//     window items 8 · LOGICAL rows 8 (at the cap, as the selector believed) · PAINTED rows 24 (3× the cap)
// GREEN below: 2 items · 2 logical · 6 painted, against a cap of 8.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { mainWindowCap, WINDOW_SLACK } from "../../src/tui/liveWindow.js";
import { paintedHeight } from "../../src/tui/wrapItems.js";
import { renderItemHeight } from "../../src/tui/pager.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

/** The live window as ChatApp handed it to the renderer, latest first. Wrapped rather than replaced, so the
 *  tree below is the real one and the rows really are painted. */
const seen = vi.hoisted(() => ({ windows: [] as (readonly RenderItem[])[] }));
vi.mock("../../src/tui/Transcript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/Transcript.js")>();
  const Recorded = (props: React.ComponentProps<typeof actual.Transcript>) => {
    seen.windows.push(props.windowItems ?? []);
    return React.createElement(actual.Transcript, props);
  };
  return { ...actual, Transcript: Recorded };
});

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** One assistant text frame whose paragraph is 200 columns of prose — ONE item out of the projection, three
 *  rows out of Ink at 80 columns. Word-broken rather than a single token, so the wrap is the ordinary one. */
const wide = (n: number) => ({
  type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`,
  message: { id: `m-${n}`, content: [{ type: "text", text: `WIDE-${n} ${"lorem ipsum dolor ".repeat(20)}`.slice(0, 200) }] },
});
const logicalRows = (items: readonly RenderItem[]) => items.reduce((sum, i) => sum + renderItemHeight(i), 0);
const paintedRows = (items: readonly RenderItem[], width: number) => items.reduce((sum, i) => sum + paintedHeight(i, width), 0);

describe("FSW BL3 — the classic live window's budget is in painted rows", () => {
  it("keeps a prose-heavy window inside the cap at 80x24, where a logical count ran 3× past it", async () => {
    seen.windows.length = 0;
    const fake = fakeRemote();
    const app = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 80, rows: () => 24, scheduleRepaint: () => () => {} }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    for (let n = 1; n <= 12; n++) { fake.pushEvent({ kind: "message", data: wide(n) }); await new Promise((r) => setTimeout(r, 0)); }
    await waitFor(() => plain(app.lastFrame()).includes("WIDE-12"));

    const window = seen.windows[seen.windows.length - 1]!;
    // 24 rows − the measured 14-row dock − 2 rows of slack = 8. Literal, per the wave's rule that a fixture
    // re-deriving the constant only pins it to itself.
    expect(mainWindowCap(24) - WINDOW_SLACK).toBe(8);
    expect(paintedRows(window, 80)).toBeLessThanOrEqual(8);
    // Positive controls, both needed: an empty window would satisfy the bound forever, and a window whose
    // items did not wrap would satisfy it without ever exercising the change.
    expect(window.length).toBeGreaterThan(0);
    expect(paintedRows(window, 80)).toBeGreaterThan(logicalRows(window));
    // …and the newest paragraph is still LIVE rather than committed — the window is a tail, not a truncation.
    const last = window[window.length - 1]!;
    expect(last.kind === "line" ? last.line.text : "").toContain("WIDE-12");
    app.unmount();
  });

  it("leaves a window of content that does not wrap exactly where it was", async () => {
    // THE NO-CHANGE HALF. Painted and logical agree on a document that fits the width, so the classic
    // renderer's ordinary case must select the identical eight items it always did.
    seen.windows.length = 0;
    const fake = fakeRemote();
    const app = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 80, rows: () => 24, scheduleRepaint: () => () => {} }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const say = (n: number) => ({ type: "assistant", parent_tool_use_id: null, uuid: `u-${n}`, message: { id: `m-${n}`, content: [{ type: "text", text: `ALPHA-${n}` }] } });
    for (let n = 1; n <= 12; n++) { fake.pushEvent({ kind: "message", data: say(n) }); await new Promise((r) => setTimeout(r, 0)); }
    await waitFor(() => plain(app.lastFrame()).includes("ALPHA-12"));

    const window = seen.windows[seen.windows.length - 1]!;
    expect(logicalRows(window)).toBe(8);
    expect(paintedRows(window, 80)).toBe(8);
    app.unmount();
  });
});
