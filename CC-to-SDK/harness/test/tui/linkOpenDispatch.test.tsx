// test/tui/linkOpenDispatch.test.tsx — bl5 T-LINKOPEN Task 3: ChatApp's `useMouseSink` (the PRODUCTION mouse
// owner, ChatApp.tsx:995-ish) routes a gated release to the opener. `fold-click.test.tsx` already pins every
// OTHER path through this same sink (drag, multi-click, popup press, the dialog/overlay gates, the fold/item
// toggle, click-to-caret) — this file adds ONLY the cells T-LINKOPEN Task 3 introduces, driving REAL SGR mouse
// bytes through the REAL `ChatApp` under the REAL `KeymapProvider`, exactly like that file's own harness.
// Viewport-handle-only tests are forbidden for these cells (the false-green guard the brief names): Task 1's
// own `fold-click.test.tsx` cases already prove `linkRangesOf`/`clickTargetAt`'s ordering at that seam, so
// nothing here re-proves it — this file proves the DISPATCH wiring one layer up.
//
// TWO SEAMS ARE MOCKED, deliberately narrow:
//  · `openUrl` (`linkOpen.js`) — so no cell here ever spawns a real browser. `shouldOpenOnClick`/
//    `classifyLinkUrl` stay REAL (re-exported from the actual module): Task 2's own suite pins the gate's
//    truth table exhaustively, and re-deriving it here with a stub would test the mock, not the wiring.
//  · The pending-hyperlink timer's clock, via `linkOpenDeps` — `keys-acceptance.test.tsx`'s own documented
//    reason: `vi.useFakeTimers()` stalls Ink's render loop in this harness, so every timing-sensitive feature
//    in this tree (the ctrl+x chord clock, and now this one) is driven by an INJECTED setTimeout/clearTimeout
//    that captures the scheduled callback and fires it by hand.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import stringWidth from "string-width";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import type { HostEvent } from "../../src/host/wire.js";
import { themeTokens } from "../../src/tui/theme.js";

const openUrlMock = vi.fn();
vi.mock("../../src/tui/linkOpen.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/linkOpen.js")>();
  return { ...actual, openUrl: (url: string, io?: unknown) => openUrlMock(url, io) };
});

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const unlink = (s: string): string => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
const clean = (s: string | undefined): string => unlink(plain(s));
const rowsOf = (frame: string | undefined): string[] => clean(frame).split("\n");

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const call = (id: string, name: string, input: unknown) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `u-${id}`, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content = "body", isError = false) =>
  sdk({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const assistantText = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });

// One markdown link, rendered as a REAL OSC-8 span through the REAL markdown pipeline —
// `FORCE_HYPERLINK=1` (markdownInline.ts's own env gate) makes this deterministic across every TERM_PROGRAM
// value a cell below sets, so the link's PRESENCE never depends on the same env var the OPEN gate reads.
const LINK_URL = "https://example.com/a";
const LINK_LABEL = "here";
const LINK_DOC: readonly TranscriptBootstrapEntry[] = [assistantText(`click [${LINK_LABEL}](${LINK_URL}) now`, "link")];

// Fix-wave (task-3 review, mutation 5): a row with TWO resolvable links, far enough apart on the same row
// that a press on one and a release on the other are unambiguously different cells. If the release path's
// same-cell pairing check (`at.col === e.col && at.row === e.row`) were ever dropped, this is the doc that
// proves it — a single-link doc can't: the release cell would have no href at all, so a missing pairing
// check and a correct one would look identical (both refuse to arm).
const LINK_URL_ALPHA = "https://example.com/alpha";
const LINK_URL_BETA = "https://example.com/beta";
const LINK_LABEL_ALPHA = "alpha";
const LINK_LABEL_BETA = "beta";
const CROSS_LINK_DOC: readonly TranscriptBootstrapEntry[] = [
  assistantText(`open [${LINK_LABEL_ALPHA}](${LINK_URL_ALPHA}) or [${LINK_LABEL_BETA}](${LINK_URL_BETA}) now`, "link2"),
];

// Fix-wave (bl5 round review, finding 1, P2): a document that OVERFLOWS the 24-row terminal, alpha and beta
// on adjacent bottom rows (same shape as `fold-click.test.tsx`'s own `TWO_CLUSTER_DOC` — 30 pad lines put
// the tail against the sticky bottom, so a line arriving on the stream slides the WHOLE document up under a
// held button with no gesture anywhere). Adjacent rather than two-apart: that file's own `streamLine` helper
// moves the tail by exactly one row per pushed message, proven there by the identical mechanism, so ONE push
// is enough to slide beta onto the exact cell alpha was pressed on.
const REFLOW_PAD: readonly TranscriptBootstrapEntry[] = Array.from({ length: 30 }, (_, i) => assistantText(`PAD-${i}`, `rp${i}`));
const REFLOW_LINK_DOC: readonly TranscriptBootstrapEntry[] = [
  ...REFLOW_PAD,
  assistantText(`open [${LINK_LABEL_ALPHA}](${LINK_URL_ALPHA}) now`, "refa"),
  assistantText(`open [${LINK_LABEL_BETA}](${LINK_URL_BETA}) now`, "refb"),
];
/** One assistant line as it arrives LIVE on the host event stream — `fold-click.test.tsx`'s own `streamLine`
 *  (the model talking, not the test scrolling), reproduced locally per this suite's no-cross-file-test-
 *  imports convention (`hover-owner.test.tsx`'s header, `CLICKABLE_DOC`'s own note above). */
const streamLine = (fake: ReturnType<typeof fakeRemote>, id: string): void =>
  fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, uuid: `us-${id}`,
    message: { id: `ms-${id}`, content: [{ type: "text", text: `NEW-${id}` }] } } } as HostEvent);

// Fix-wave (task-3 review, mutation 3): the selection-paint seam (`selectionPaint.test.tsx`'s own idiom) —
// `hasSelection()` requires a non-null `focus`, so a stray one-cell anchor from a modified press is invisible
// to frame-equality or `openUrlMock`/timer-handle assertions alike. A drag that FOLLOWS the modified press
// with no intervening real press is the only thing that turns a stray anchor into a visible two-endpoint
// sweep: `dragTo`'s own guard (`mouse/selection.ts`) never seeds `anchor` itself, so if none was seeded by
// the press, the drag paints nothing at all, regardless of where it lands.
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
const SEL_BG = sgrBg(themeTokens().selectionBg);

// A genuinely CLICKABLE (click-to-expand) result with no link anywhere on it — T-CLICKGATE's own >10-line
// error shape (`fold-click.test.tsx`'s `LONG_ERROR_DOC`), reproduced locally per this suite's
// no-cross-file-test-imports convention (`hover-owner.test.tsx`'s header).
const errorLines = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
const CLICKABLE_DOC: readonly TranscriptBootstrapEntry[] = [call("err-1", "Mystery", {}), result("err-1", errorLines(12), true)];

const PROMPT = "❯ ";
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

// The ctrl+x chord clock's own shape (`keys-acceptance.test.tsx`), widened to track EVERY handle rather than
// only the latest — so a test can prove a CANCELLED timer's callback never fires even when invoked by hand
// (real `clearTimeout` gives that guarantee; a fake that only tracked "the current slot" could not tell a
// genuine cancel from a test that simply never called the stale handle).
function linkClock() {
  type Handle = { fn: () => void; ms: number; cancelled: boolean };
  const handles: Handle[] = [];
  const setT = ((fn: () => void, ms: number): unknown => { const h: Handle = { fn, ms, cancelled: false }; handles.push(h); return h; }) as (fn: () => void, ms: number) => unknown;
  const clearT = ((h: unknown): void => { (h as Handle).cancelled = true; }) as (h: unknown) => void;
  const fire = (h: unknown): void => { const handle = h as Handle; if (!handle.cancelled) handle.fn(); };
  return { deps: { setTimeout: setT, clearTimeout: clearT }, handles, fire, latest: () => handles[handles.length - 1]! };
}

function scene(entries: readonly TranscriptBootstrapEntry[], clock: ReturnType<typeof linkClock>, fake = fakeRemote()) {
  return {
    fake,
    ui: <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
      deps={{ columns: () => 80, rows: () => 24 }} linkOpenDeps={clock.deps} />,
  };
}
async function mount(entries: readonly TranscriptBootstrapEntry[], clock: ReturnType<typeof linkClock>) {
  const s = scene(entries, clock);
  const r = renderWithKeymap(s.ui);
  await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
  await settle();
  return { ...r, fake: s.fake };
}

const press = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}M`;
const release = (col: number, row: number, mods = 0) => `\x1b[<${mods};${col};${row}m`;
const drag = (col: number, row: number) => `\x1b[<32;${col};${row}M`;   // button 0 + the motion flag, `selectionPaint.test.tsx`'s own byte
const FOCUS_IN = "\x1b[I";
const ALT = 8;

/** The 1-based terminal column `needle` starts at, on the row that contains it. `stringWidth` of everything
 *  BEFORE the needle, not the JS string index: the assistant bullet gutter (`⏺ `) is one wide (2-column)
 *  character plus one narrow one, so a naive `indexOf + 1` undercounts every column after it by one — exactly
 *  the double-width backstep `columnToChar` itself accounts for (`mouse/hitmap.ts`'s own doc). */
function locate(frame: string | undefined, needle: string): { col: number; row: number } {
  const rows = rowsOf(frame);
  const row = rows.findIndex((l) => l.includes(needle));
  expect(row, `"${needle}" is not painted in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  const line = rows[row]!;
  return { col: stringWidth(line.slice(0, line.indexOf(needle))) + 1, row: row + 1 };
}

const GATE_KEYS = ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM", "TERMINAL_EMULATOR", "LC_TERMINAL", "FORCE_HYPERLINK"];
const savedEnv = Object.fromEntries(GATE_KEYS.map((k) => [k, process.env[k]]));
const savedPlatform = process.platform;
afterEach(() => {
  for (const k of GATE_KEYS) { const v = savedEnv[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  Object.defineProperty(process, "platform", { value: savedPlatform, configurable: true });
  openUrlMock.mockReset();
});
function setGates(e: Record<string, string> = {}): void {
  for (const k of GATE_KEYS) delete process.env[k];
  process.env.FORCE_HYPERLINK = "1";                    // the link's PRESENCE is never in question in this file
  Object.assign(process.env, e);
}
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("T-LINKOPEN Task 3 — alt/ctrl-click on a link cell arms the 500 ms opener", () => {
  it("opens exactly once, only after the deferred timer fires", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);

    r.stdin.write(press(col, row, ALT));
    await tick();
    r.stdin.write(release(col, row, ALT));
    await settle();
    expect(openUrlMock).not.toHaveBeenCalled();                     // deferred — not yet
    expect(clock.latest().ms).toBe(500);

    clock.fire(clock.latest());
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(LINK_URL, undefined);
    r.unmount();
  });

  it("a modified click never toggles anything, even on a NON-link cell of a CLICKABLE owner", async () => {
    const clock = linkClock();
    const r = await mount(CLICKABLE_DOC, clock);
    const { col, row } = locate(r.lastFrame(), "err line 2");
    const before = r.lastFrame();

    r.stdin.write(press(col, row, ALT));
    await tick();
    r.stdin.write(release(col, row, ALT));
    await settle();

    expect(r.lastFrame()).toBe(before);                            // no expansion — canon: modified clicks never toggle
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);                          // no link here — nothing was ever armed
    r.unmount();
  });

  it("a plain (unmodified) click on a link cell is a no-op on an ordinary terminal — zero opens, zero toggles", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);
    const before = r.lastFrame();

    r.stdin.write(press(col, row));
    await tick();
    r.stdin.write(release(col, row));
    await settle();

    expect(r.lastFrame()).toBe(before);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);
    r.unmount();
  });

  it("vscode's TERM_PROGRAM stands down entirely, even alt-clicked", async () => {
    setGates({ TERM_PROGRAM: "vscode" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);

    r.stdin.write(press(col, row, ALT));
    await tick();
    r.stdin.write(release(col, row, ALT));
    await settle();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);
    r.unmount();
  });

  it("a focus-in immediately before the press is a window activation — zero opens even alt-clicked", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);

    r.stdin.write(FOCUS_IN);
    await tick();
    r.stdin.write(press(col, row, ALT));
    await tick();
    r.stdin.write(release(col, row, ALT));
    await settle();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);
    r.unmount();
  });

  it("macOS Ghostty's PLAIN release takes the opener path too — cmd+click arrives with no SGR modifier bit", async () => {
    setGates({ TERM_PROGRAM: "ghostty" });
    setPlatform("darwin");
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);

    r.stdin.write(press(col, row));
    await tick();
    r.stdin.write(release(col, row));
    await settle();
    expect(openUrlMock).not.toHaveBeenCalled();
    clock.fire(clock.latest());
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(LINK_URL, undefined);
    r.unmount();
  });

  it("a second alt-click on the SAME link cell cancels the first pending timer and arms its own", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const { col, row } = locate(r.lastFrame(), LINK_LABEL);

    r.stdin.write(press(col, row, ALT)); await tick();
    r.stdin.write(release(col, row, ALT)); await settle();
    const first = clock.latest();

    r.stdin.write(press(col, row, ALT)); await tick();
    r.stdin.write(release(col, row, ALT)); await settle();
    const second = clock.latest();

    expect(clock.handles.length).toBe(2);
    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);

    clock.fire(first);                                             // real clearTimeout would make this inert too
    expect(openUrlMock).not.toHaveBeenCalled();
    clock.fire(second);
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it("a genuine (unmodified) double-click elsewhere cancels an alt-click's pending timer too", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const link = locate(r.lastFrame(), LINK_LABEL);
    const away = locate(r.lastFrame(), "now");                     // a different, non-link cell on the same row

    r.stdin.write(press(link.col, link.row, ALT)); await tick();
    r.stdin.write(release(link.col, link.row, ALT)); await settle();
    const armed = clock.latest();
    expect(armed.cancelled).toBe(false);

    // Two plain presses on the same cell within the window are canon's own multi-click branch (`count >= 2`,
    // `fold-click.test.tsx`'s own T9 precedent) — it never waits for a release.
    r.stdin.write(press(away.col, away.row)); await tick();
    r.stdin.write(press(away.col, away.row)); await settle();

    expect(armed.cancelled).toBe(true);
    clock.fire(armed);
    expect(openUrlMock).not.toHaveBeenCalled();
    r.unmount();
  });

  // Fix-wave (task-3 review, mutation 3, P2 coverage gap): a modified press must not seed a selection
  // anchor. `hasSelection()`/frame-equality/`openUrlMock` all stay silent even if it wrongly did (a one-cell
  // anchor with no drag paints nothing and opens nothing), so this proves it the only way that's actually
  // load-bearing: drive a plain drag with NO intervening real press, and show it paints no selection at all.
  it("a modified press seeds no selection anchor — a drag with no press between paints nothing", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(LINK_DOC, clock);
    const link = locate(r.lastFrame(), LINK_LABEL);
    const away = locate(r.lastFrame(), "now");

    r.stdin.write(press(link.col, link.row, ALT));
    await tick();
    r.stdin.write(drag(away.col, away.row));
    await settle();

    expect(r.lastFrame()).not.toContain(SEL_BG);
    r.unmount();
  });

  // Fix-wave (task-3 review, mutation 5, P2 coverage gap): every other cell in this file presses and
  // releases the SAME cell on the modified path, so none of them can tell a dropped same-cell pairing check
  // apart from a correct one. `CROSS_LINK_DOC` gives the release cell its OWN real href, so a dropped check
  // would arm the WRONG link (`beta`'s url, off the `alpha` press) instead of refusing outright.
  it("a modified press and release on DIFFERENT link cells never opens — cross-cell pairing is enforced", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(CROSS_LINK_DOC, clock);
    const alpha = locate(r.lastFrame(), LINK_LABEL_ALPHA);
    const beta = locate(r.lastFrame(), LINK_LABEL_BETA);

    r.stdin.write(press(alpha.col, alpha.row, ALT));
    await tick();
    r.stdin.write(release(beta.col, beta.row, ALT));
    await settle();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);                          // nothing was ever armed, for EITHER url
    r.unmount();
  });

  // Fix-wave (bl5 round review, finding 1, P2): the SAME (col,row) on press and release is not enough — the
  // cell's own CONTENT must not have moved. Before the fix, the release resolved `linkHrefAt` fresh at ITS
  // OWN cell and opened on that answer alone, so a reflow between press and release that slid a DIFFERENT
  // link under the identical coordinates opened the WRONG url. `REFLOW_LINK_DOC` already overflows the
  // screen (30 pad lines, `fold-click.test.tsx`'s own proven mechanism), so a single streamed line — no
  // gesture anywhere — slides the whole tail up by exactly one row: beta inherits alpha's former cell, and
  // alpha itself scrolls fully off the top.
  it("a same-cell release whose HREF changed mid-gesture never opens (content reflow under a held press)", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(REFLOW_LINK_DOC, clock);
    const alpha = locate(r.lastFrame(), LINK_LABEL_ALPHA);
    expect(locate(r.lastFrame(), LINK_LABEL_BETA).row).toBe(alpha.row + 1);   // premise: adjacent, same column

    r.stdin.write(press(alpha.col, alpha.row, ALT));
    await tick();
    streamLine(r.fake, "shift");
    await settle();
    expect(locate(r.lastFrame(), LINK_LABEL_BETA)).toEqual(alpha);           // premise: beta really took the cell

    r.stdin.write(release(alpha.col, alpha.row, ALT));
    await settle();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);                          // the mismatched href was never armed
    r.unmount();
  });

  // The control for the cell above, on the identical document and the identical press: nothing arrives
  // before the release, so the press-time and release-time hrefs agree and the open proceeds exactly as
  // every other cell in this file's opening describe already proves — pinning that the fix NARROWS only the
  // reflow case and does not regress the ordinary alt-click path.
  it("a same-cell release whose href did NOT change still opens (the fix narrows, it does not break the happy path)", async () => {
    setGates({ TERM_PROGRAM: "iTerm.app" });
    const clock = linkClock();
    const r = await mount(REFLOW_LINK_DOC, clock);
    const alpha = locate(r.lastFrame(), LINK_LABEL_ALPHA);

    r.stdin.write(press(alpha.col, alpha.row, ALT));
    await tick();
    r.stdin.write(release(alpha.col, alpha.row, ALT));
    await settle();
    expect(openUrlMock).not.toHaveBeenCalled();                    // deferred — not yet
    clock.fire(clock.latest());
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(LINK_URL_ALPHA, undefined);
    r.unmount();
  });
});

describe("T-LINKOPEN fix-wave finding 2 — the popup never accepts a MODIFIED press", () => {
  // Pre-bl5, the blanket modifier drop ran BEFORE `popupHitRef.current?.pressAt(...)`, so the popup never
  // saw a modified click at all. T-LINKOPEN Task 3 moved the modifier handling below that call to make room
  // for the transcript link opener, which let an alt/ctrl-click on a visible popup row reach `pressAt` →
  // `onSelect` for the first time — restored here by gating the call itself on `!modified`, the smallest
  // change that puts the popup back to never seeing one, exactly `popup-hover.test.tsx`'s own palette-opening
  // technique (typing `/`, reading the popup rows out of the painted frame) reproduced locally per this
  // suite's no-cross-file-test-imports convention.
  const popupRowIndices = (frame: string | undefined): number[] => {
    const idxs: number[] = [];
    rowsOf(frame).forEach((l, idx) => { if (/^ {2}\/[a-zA-Z]/.test(l)) idxs.push(idx); });
    return idxs;
  };
  const popupRowOf = (frame: string | undefined, i: number): number => {
    const idxs = popupRowIndices(frame);
    expect(idxs.length, `fewer than ${i + 1} popup rows painted:\n${clean(frame)}`).toBeGreaterThan(i);
    return idxs[i]! + 1;
  };
  const POPUP_COL = 5;   // two leading spaces of paddingX + "/" — comfortably inside every command's own row

  it("alt-click on a command-palette row selects nothing — the query and the popup are untouched", async () => {
    const clock = linkClock();
    const r = await mount([], clock);
    r.stdin.write("/");
    await settle();
    await waitFor(() => clean(r.lastFrame()).includes("/model"));
    const row = popupRowOf(r.lastFrame(), 0);
    const before = r.lastFrame();

    r.stdin.write(press(POPUP_COL, row, ALT));
    await tick();
    r.stdin.write(release(POPUP_COL, row, ALT));
    await settle();

    expect(r.lastFrame()).toBe(before);                             // nothing selected — bl5's own regression
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(clock.handles.length).toBe(0);                           // the dock band has no link under it either
    r.unmount();
  });
});
