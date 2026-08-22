// test/tui/autoCopy.test.tsx — F9 T-MOUSE Task 7: the auto-copy latch, `copyOnSelect`, and the selection
// lifetime keys, wired end to end through the REAL `ChatApp` + REAL keymap provider (`selectionPaint.test.tsx`'s
// (T6) own harness, extended with raw KEYBOARD bytes alongside the mouse ones it already sends). `copy.ts`'s
// own OSC 52 byte shapes and the toast-text table are `copyChannels.test.ts`'s scope, exhaustively — this
// file mocks `copyText` to a controllable stub and proves only the WIRING: how many times it fires, with
// what text, and which keys clear/copy/pass a live selection through untouched. The `copyOnSelect` row's
// own default is pinned in `settingsRows.test.ts` (pure, no mount needed for a `/config` row's shape).
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { setTheme } from "../../src/tui/theme.js";
import type { CopyResult } from "../../src/tui/copy.js";

// The mock: only `copyText` is replaced (`copyToastText` stays real — its own byte-exact table is pinned in
// `copyChannels.test.ts`, and using the real one here means a toast assertion below is proving the SAME
// string production code would show, not a test-local echo of it).
const copyTextMock = vi.fn<(text: string, deps?: unknown) => Promise<CopyResult>>();
vi.mock("../../src/tui/copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/copy.js")>();
  return { ...actual, copyText: (text: string, deps?: unknown) => copyTextMock(text, deps) };
});

afterEach(() => { setTheme("auto"); vi.unstubAllEnvs(); });
beforeEach(() => {
  copyTextMock.mockReset();
  // "native", oscBytes: null keeps every test's frame free of stray OSC 52 escape bytes and free of
  // `<mod>`-variant toast wording (that variance is `copyChannels.test.ts`'s own table) — the deterministic
  // default every test other than the toast-text case below wants.
  copyTextMock.mockResolvedValue({ channel: "native", oscBytes: null });
});

const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const clean = plain;
const rowsOf = (frame: string | undefined): string[] => clean(frame).split("\n");
const rowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = rowsOf(frame).findIndex((l) => l.includes(needle));
  expect(at, `no row contains "${needle}" in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });
// Assistant prose carries a 3-column "⏺ " gutter ahead of the text (selectionPaint.test.tsx's own fixture,
// reused verbatim): "click " lands cols 4-9, "select" cols 10-15, " target word" after.
const DOC: readonly TranscriptBootstrapEntry[] = [prose("click select target word", "a")];
const PROMPT = "\u276f\u00a0";   // composerFrame.ts's own `POINTER + NBSP` — the trailing char is NBSP, not a plain space

const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
const drag = (col: number, row: number) => `\x1b[<32;${col};${row}M`;
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function scene(entries: readonly TranscriptBootstrapEntry[], hookOpts?: Record<string, unknown>) {
  return <ChatApp makeSession={() => fakeRemote() as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
    renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
    deps={{ columns: () => 80, rows: () => 24 }} hookOpts={hookOpts as any} />;
}
async function mount(entries: readonly TranscriptBootstrapEntry[], hookOpts?: Record<string, unknown>) {
  const r = renderWithKeymap(scene(entries, hookOpts));
  await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
  await settle();
  return r;
}
/** press → drag → release: the shape every latch/copy test drives. Leaves the highlight ON (T6's own
 *  "release keeps the highlight" contract) so a following key-lifetime probe has a real selection to act on. */
async function sweep(r: { stdin: { write(s: string): void } }, fromCol: number, toCol: number, row: number) {
  r.stdin.write(press(fromCol, row));
  await tick();
  r.stdin.write(drag(toCol, row));
  await settle();
  r.stdin.write(release(toCol, row));
  await settle();
}
/** The observable proxy for "is a selection still live" — the same signal the app itself would show a real
 *  user: send Ctrl+C and read whether the IDLE exit-arm hint (`Footer.tsx`'s "Press Ctrl-C again to exit",
 *  `app:interrupt`'s idle branch, `ctrlCArmRef.press()`) appeared. It can appear ONLY if `app:interrupt` ran
 *  at all, which the selection-lifetime handler's `return true` (Task 7's own Ctrl+C branch) forbids for as
 *  long as `hasSelection()` answers true — so its ABSENCE after a Ctrl+C press is direct proof the selection
 *  was still live and consumed the keystroke; its PRESENCE is proof there was nothing left for Ctrl+C to
 *  consume. One-shot per selection instance: a live selection's own Ctrl+C branch clears it (copyOnSelect
 *  default true) as a side effect of asking. */
async function ctrlCConsumedBySelection(r: { stdin: { write(s: string): void }; lastFrame(): string | undefined }): Promise<boolean> {
  r.stdin.write("\x03");
  await settle();
  return !plain(r.lastFrame()).includes("Press Ctrl-C again to exit");
}

describe("auto-copy latch (canon's Lts, R1 §2.5)", () => {
  it("a press-drag-release sweep fires copyText exactly once, with the swept text", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    expect(copyTextMock.mock.calls[0]![0]).toBe("select");
    r.unmount();
  });

  it("does NOT fire mid-drag — only the release (mouse-up) triggers it", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(10, row)); await tick();
    r.stdin.write(drag(12, row)); await settle();
    expect(copyTextMock).not.toHaveBeenCalled();
    r.stdin.write(drag(15, row)); await settle();
    expect(copyTextMock).not.toHaveBeenCalled();
    r.stdin.write(release(15, row)); await settle();
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it("a second, independent selection fires again (a fresh press resets the latch)", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);                     // "select"
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    await sweep(r, 4, 9, row);                       // "click "
    expect(copyTextMock).toHaveBeenCalledTimes(2);
    expect(copyTextMock.mock.calls[1]![0]).toBe("click ");
    r.unmount();
  });

  it("a keystroke clear, then a reselect, fires again", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    r.stdin.write("z");                              // an ordinary key: clears the selection, still types
    await settle();
    expect(await ctrlCConsumedBySelection(r)).toBe(false);   // proves the clear really happened
    await sweep(r, 4, 9, row);                       // reselect "click "
    expect(copyTextMock).toHaveBeenCalledTimes(2);
    r.unmount();
  });

  it("release with no drag (a plain click) copies nothing — there is no selection to copy", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    r.stdin.write(press(20, row)); await tick();
    r.stdin.write(release(20, row)); await settle();
    expect(copyTextMock).not.toHaveBeenCalled();
    r.unmount();
  });

  it("shows the toast text copyToastText itself produces for the resolved channel", async () => {
    copyTextMock.mockResolvedValue({ channel: "native", oscBytes: null });
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    await waitFor(() => plain(r.lastFrame()).includes("copied 6 chars to clipboard"));   // "select".length === 6
    r.unmount();
  });
});

describe("copyOnSelect off", () => {
  it("release copies nothing, but Ctrl+C copies once — and is not the idle exit-arm", async () => {
    const r = await mount(DOC, { initialCopyOnSelect: false });
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    expect(copyTextMock).not.toHaveBeenCalled();               // auto-copy never fires with the setting off
    r.stdin.write("\x03");
    await settle();
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    expect(copyTextMock.mock.calls[0]![0]).toBe("select");
    expect(plain(r.lastFrame())).not.toContain("Press Ctrl-C again to exit");   // consumed, not app:interrupt
    r.unmount();
  });

  it("Ctrl+C with copyOnSelect off does NOT clear — a second Ctrl+C copies again, not the exit arm", async () => {
    const r = await mount(DOC, { initialCopyOnSelect: false });
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    r.stdin.write("\x03"); await settle();
    expect(copyTextMock).toHaveBeenCalledTimes(1);
    r.stdin.write("\x03"); await settle();
    expect(copyTextMock).toHaveBeenCalledTimes(2);                            // the selection is still live
    expect(plain(r.lastFrame())).not.toContain("Press Ctrl-C again to exit");
    r.unmount();
  });
});

describe("copyOnSelect on (default): Ctrl+C clears rather than re-copying", () => {
  it("release already auto-copied once; Ctrl+C then clears without a second copy", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    expect(copyTextMock).toHaveBeenCalledTimes(1);               // the release's own auto-copy
    r.stdin.write("\x03"); await settle();
    expect(copyTextMock).toHaveBeenCalledTimes(1);               // Ctrl+C cleared, it did not copy again
    expect(plain(r.lastFrame())).not.toContain("Press Ctrl-C again to exit");   // still consumed
    r.stdin.write("\x03"); await settle();                       // now there is nothing left to consume
    expect(plain(r.lastFrame())).toContain("Press Ctrl-C again to exit");
    r.unmount();
  });
});

describe("selection lifetime keys — the allow-list does NOT clear", () => {
  const ALLOW_LISTED: [string, string][] = [
    ["escape", "\x1b"],
    ["pageup", "\x1b[5~"],
    ["pagedown", "\x1b[6~"],
    ["ctrl+home", "\x1b[1;5H"],
    ["ctrl+end", "\x1b[1;5F"],
    ["shift+up", "\x1b[1;2A"],
    ["shift+home", "\x1b[1;2H"],
    ["shift+end", "\x1b[1;2F"],
  ];
  it.each(ALLOW_LISTED)("%s leaves the selection intact", async (_name, bytes) => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    r.stdin.write(bytes);
    await settle();
    // Still selected: this Ctrl+C is the one that consumes/clears it (copyOnSelect default true), so the
    // idle exit-arm text must NOT appear.
    expect(await ctrlCConsumedBySelection(r)).toBe(true);
    r.unmount();
  });
});

describe("selection lifetime keys — any other key clears (and still runs its own action)", () => {
  const CLEARING: [string, string][] = [
    ["a plain letter", "q"],
    ["a bare (unshifted) up arrow", "\x1b[A"],
    ["a bare home (no ctrl, no shift)", "\x1b[H"],
    ["a bare end (no ctrl, no shift)", "\x1b[F"],
  ];
  it.each(CLEARING)("%s clears the selection", async (_name, bytes) => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    r.stdin.write(bytes);
    await settle();
    // Already cleared: THIS Ctrl+C finds nothing, so it is the ordinary idle arm — the exit-arm text DOES
    // appear, and this Ctrl+C is therefore NOT "consumed by a selection".
    expect(await ctrlCConsumedBySelection(r)).toBe(false);
    r.unmount();
  });

  it("an ordinary letter still types into the composer draft after clearing the selection", async () => {
    const r = await mount(DOC);
    const row = rowOfIncluding(r.lastFrame(), "click select");
    await sweep(r, 10, 15, row);
    r.stdin.write("q");
    await settle();
    // Not consumed: the composer's own draft echo shows the typed character.
    await waitFor(() => plain(r.lastFrame()).includes(`${PROMPT}q`));
    r.unmount();
  });
});
