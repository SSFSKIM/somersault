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
});
