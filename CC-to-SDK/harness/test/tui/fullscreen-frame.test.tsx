// tui/test/fullscreen-frame.test.tsx — FSW Task 9: the fixed-height frame, and the machinery left outside it.
//
// WHAT THIS FILE IS ABOUT, in one sentence: on the alternate screen the frame is a BUDGET, not a consequence.
// The main-screen renderer lets the tree be as tall as it likes and repairs the damage afterwards (the whole
// Wave-R correction stack); the fullscreen renderer gives the tree `rows − 1` physical rows and CLIPS whatever
// does not fit. So every case below is a height assertion, and the two that matter most assert what does NOT
// happen: no growth past the budget (I9a), and no main-screen repair firing on a screen that cannot need one.
//
// `rows − 1`, not `rows`, is the recorded divergence of spec §A4: the dock's last row IS `rows − 1` and the
// park row sits beneath it, because log-update terminates every frame with a trailing `'\n'` and a frame that
// exactly fills the terminal therefore scrolls it — one row of slack is what canon buys with
// `viewport.height = rows + 1` (grounding §5.1, bundle L180330).
//
// `ink-testing-library` is enough for the geometry (its `debug: true` arm writes `fullStaticOutput + output`
// and nothing else, so `lastFrame()` IS the serialized frame, line for line). It is NOT enough for the
// tall-branch claim — that branch is the one thing `debug: true` returns before — so the "no tall write" case
// runs on `helpers/fakeTty.tsx` with `debug: false`, the same instrument Task 3/4 measured on.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import isInCi from "is-in-ci";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FullscreenFrame, dockCap, frameHeight } from "../../src/tui/FullscreenFrame.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { renderRealInk } from "./helpers/fakeTty.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t9-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

/** The frame's serialized rows. `Output.get()` pre-initializes exactly `height` rows and `trimEnd`s each one,
 *  so a blank row is `""` and the array length IS the physical height of the paint. */
const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
/** `n` one-row `<Text>` children, each carrying its own index so a clip can be located rather than counted. */
const band = (n: number, tag: string) => (
  <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`${tag}${i}`}</Text>)}</Box>
);
const frame = (f: () => string | undefined) => f() ?? "";
/** The composer's ready prompt: `❯` + a NON-BREAKING space (U+00A0), which is what it actually paints. */
const PROMPT = "\u276f\u00a0";
/** Sixty committed assistant rows — enough transcript to reach `state.staticItems`, which is the ONLY input
 *  that makes a `<Static>` visible: Ink commits static children once and `ink-testing-library` renders with
 *  `debug: true`, whose arm writes `fullStaticOutput + output`. So a tree that mounts a `<Static>` with these
 *  in it paints them into `lastFrame()` and the frame stops being `rows − 1`. Shared by the no-`<Static>` pin
 *  below and the tall-branch case at the bottom of the file, which are the two halves of the same claim. */
const alphaEntries = (n = 60) => Array.from({ length: n }, (_, i) => ({
  kind: "sdk" as const, source: "disk" as const,
  message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
}));
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("FullscreenFrame — the height contract", () => {
  // §A4's arithmetic, stated once so the cases below can name it instead of re-deriving it.
  it("frameHeight is rows − 1 and dockCap is floor(rows/2), rows − 2 for its two wide tenants (history search, a parked decision)", () => {
    expect([15, 24, 40].map(frameHeight)).toEqual([14, 23, 39]);
    expect([15, 24, 40].map((r) => dockCap(r, false))).toEqual([7, 12, 20]);
    expect([15, 24, 40].map((r) => dockCap(r, true))).toEqual([13, 22, 38]);
    // A pane too short to hold both still yields a frame and a dock rather than a negative one.
    expect(frameHeight(1)).toBe(1);
    expect(dockCap(1, true)).toBe(1);
  });

  it.each([15, 24, 40])("paints exactly rows − 1 lines at %i rows, with the dock on the last one", (rows) => {
    const { lastFrame } = render(<FullscreenFrame rows={rows} regionChildren={band(2, "R")} dock={band(2, "D")} />);
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(rows - 1);
    expect(lines[0]).toBe("R0");
    expect(lines.at(-1)).toBe("D1");        // the dock is PINNED to the bottom, not floating under the region
  });

  // The region takes the slack: short content sits at the TOP of the frame and the blank rows are between it
  // and the dock, which is the shape T10's anchor case needs (short document → dock pinned, content above it).
  it("gives the region every row the dock does not want", () => {
    const { lastFrame } = render(<FullscreenFrame rows={24} regionChildren={band(3, "R")} dock={band(4, "D")} />);
    const lines = rowsOf(lastFrame());
    expect(lines.slice(0, 3)).toEqual(["R0", "R1", "R2"]);
    expect(lines.slice(3, 19).join("")).toBe("");
    expect(lines.slice(19)).toEqual(["D0", "D1", "D2", "D3"]);
  });

  // THE DOCK CAP. A hungry composer is the real case: `flexShrink: 0` says the dock never gives its rows back
  // to the region, so the only thing standing between it and the whole frame is this cap.
  it("caps a hungry dock at floor(rows/2) and keeps the rest for the region", () => {
    const { lastFrame } = render(<FullscreenFrame rows={24} regionChildren={band(3, "R")} dock={band(30, "D")} />);
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(23);
    expect(lines.slice(0, 3)).toEqual(["R0", "R1", "R2"]);   // the region keeps its 23 − 12 = 11 rows
    expect(lines[11]).toBe("D0");
    expect(lines[22]).toBe("D11");                           // …and the dock gets exactly twelve of them
    expect(lines.join("\n")).not.toContain("D12");
  });

  it("widens the cap to rows − 2 while a history search is open", () => {
    const { lastFrame } = render(<FullscreenFrame rows={24} historySearchOpen regionChildren={band(3, "R")} dock={band(30, "D")} />);
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(23);
    expect(lines[0]).toBe("R0");
    expect(lines[1]).toBe("D0");
    expect(lines[22]).toBe("D21");                           // twenty-two dock rows, one row of region left
  });

  // ── I9a: OVERFLOW IS CLIPPED, NEVER GROWN ─────────────────────────────────────────────────────────────
  // The failure this forbids is the whole wave's failure: a region one row too tall makes the frame `rows`
  // instead of `rows − 1`, log-update's trailing newline scrolls the alternate screen, and the fixed frame
  // stops being fixed. Canon treats the same condition as a bug in the CALLER and says so (bundle L180317:
  // "alt-screen: yoga height N > terminalRows M — something is rendering outside <AlternateScreen>. Overflow
  // clipped."), which is what `onOverflow` reproduces.
  // The diagnostic is a passive EFFECT, not a render-time write: it reports a measurement, and the measurement
  // is only true after Yoga has laid out. Hence the tick — and hence, in production, one frame of latency on a
  // message nobody is watching for in real time.
  it("clips region children taller than the frame — the total stays rows − 1 and the dock survives", async () => {
    const overflow = vi.fn();
    const { lastFrame } = render(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={band(100, "R")} dock={band(3, "D")} />);
    await tick();
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(23);
    expect(lines[0]).toBe("R0");
    expect(lines[19]).toBe("R19");
    expect(lines.join("\n")).not.toContain("R20");           // clipped at the region's edge, not scrolled
    expect(lines.slice(20)).toEqual(["D0", "D1", "D2"]);     // …and the dock was not pushed off the screen
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(overflow.mock.calls[0]![0]).toContain("100");      // the diagnostic names both heights, as canon's does
    expect(overflow.mock.calls[0]![0]).toContain("20");
  });

  it("says nothing when the region fits", async () => {
    const overflow = vi.fn();
    render(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={band(4, "R")} dock={band(3, "D")} />);
    await tick();
    expect(overflow).not.toHaveBeenCalled();
  });
});

describe("ChatApp's fullscreen branch", () => {
  const FULLSCREEN = { mode: "fullscreen", reason: "env_on" } as const;
  const mount = (extra: Record<string, unknown> = {}) => renderWithKeymap(
    <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      deps={{ columns: () => 80, rows: () => 24 }} {...extra} />,
  );

  // The frame is a BUDGET now: whatever the transcript is doing, the paint is 23 rows at a 24-row terminal.
  it("paints a rows − 1 frame regardless of what the transcript holds", async () => {
    const r = mount({ renderer: FULLSCREEN });
    await waitFor(() => frame(r.lastFrame).includes(PROMPT));
    expect(rowsOf(r.lastFrame())).toHaveLength(23);
    r.unmount();

    // …AND THE SAME FRAME WITH A TRANSCRIPT THAT REACHES `state.staticItems` — the pin for "no `<Static>` in
    // the fullscreen tree", which is the invariant T12's switch safety and T15's step-1 acceptance both rest
    // on and which nothing else in the repository catches. The two facts are independent: the root box carries
    // an explicit `height`, so the paint is `rows − 1` whether or not a `<Static>` is mounted, and Ink's tall
    // branch stays unreachable either way. What DOES separate them is the serializer — `debug: true` writes
    // `fullStaticOutput + output`, so committed static rows land in `lastFrame()` directly. Measured both
    // ways: `<LiveRegion>` gives 23 lines, swapping in `<Transcript>` gives 75 with `ALPHA-0` in them.
    const s = mount({ renderer: FULLSCREEN, initialEntries: alphaEntries() });
    await waitFor(() => frame(s.lastFrame).includes(PROMPT));
    await tick();
    expect(rowsOf(s.lastFrame())).toHaveLength(23);
    expect(frame(s.lastFrame)).not.toContain("ALPHA-0");
    s.unmount();
  });

  // …and the contrast that keeps the case above from being vacuous: the classic tree is as tall as its content.
  it("leaves the classic tree content-sized", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes(PROMPT));
    expect(rowsOf(r.lastFrame()).length).toBeLessThan(23);
    r.unmount();
  });

  // ── OBLIGATION A (T8 review) — THE MAIN-SCREEN RESYNC DOES NOT RUN HERE ───────────────────────────────
  // `ChatApp`'s viewport resync exists to repair Ink's tall-frame branch, and its fallback writes the
  // MAIN-SCREEN erase arm (`eraseViewport(rows)`, clearViewport.ts:40). On the alternate screen that is the
  // wrong arm of the D6 split — and, more to the point, the repair itself has nothing to repair: the frame is
  // fixed at `rows − 1`, so `outputHeight >= rows` never fires and no tall chunk ever reaches the pane. Gated
  // off rather than mode-threaded; see ChatApp's own note.
  it("never fires the viewport resync on a pager cycle, where the classic path does", async () => {
    const proxy = { repaint: (run: () => void) => run(), tallWrites: () => 1, screenResynced: () => {} };
    const resync = vi.fn(() => true);
    const r = mount({ renderer: FULLSCREEN, resumeOutput: proxy, resyncViewport: resync });
    await waitFor(() => frame(r.lastFrame).includes(PROMPT));
    r.stdin.write("\x0f");                                   // ctrl+o opens the pager
    await waitFor(() => frame(r.lastFrame).includes("Transcript"));
    r.stdin.write("\x0f");                                   // …and closes it: the classic path's resync edge
    await waitFor(() => !frame(r.lastFrame).includes("Transcript"));
    expect(resync).not.toHaveBeenCalled();
    r.unmount();

    const classic = { repaint: (run: () => void) => run(), tallWrites: () => 1, screenResynced: () => {} };
    const classicResync = vi.fn(() => true);
    const c = mount({ resumeOutput: classic, resyncViewport: classicResync });
    await waitFor(() => frame(c.lastFrame).includes(PROMPT));
    c.stdin.write("\x0f");
    await waitFor(() => frame(c.lastFrame).includes("Transcript"));
    c.stdin.write("\x0f");
    await waitFor(() => !frame(c.lastFrame).includes("Transcript"));
    expect(classicResync).toHaveBeenCalledTimes(1);
    c.unmount();
  });
});

// `is-in-ci` is read by `ink.js` at import time and takes a different `onRender` branch there, so the tall
// check this case exists for does not run under CI at all — skipped rather than silently green (the same
// reason `live-window-frame-bound.test.tsx` skips).
describe.skipIf(isInCi)("the fullscreen frame never reaches Ink's tall-frame branch", () => {
  const settle = () => new Promise((r) => setTimeout(r, 120));

  // THE CLAIM T12'S SWITCH-SAFETY RESTS ON. `fullStaticOutput` is reset only in Ink's constructor, so the one
  // thing keeping a fullscreen session from ever replaying a committed transcript is that `outputHeight >=
  // stdout.rows` never fires. That is invisible to `ink-testing-library`; here it is counted.
  it("writes no tall chunk with a full transcript at 24 rows", async () => {
    const entries = alphaEntries();
    const tty = renderRealInk(
      <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries} resyncViewport={() => false}
        deps={{ now: () => 0, columns: () => 80, rows: () => 24, scheduleRepaint: () => () => {} }} />,
      { columns: 80, rows: 24 },
    );
    await settle();
    expect(tty.tallWritesSince(0)).toBe(0);
    tty.unmount();
  });
});
