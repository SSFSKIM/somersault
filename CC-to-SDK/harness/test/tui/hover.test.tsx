// test/tui/hover.test.tsx — F9 T-MOUSE Task 3: hover un-dims a transcript row-cluster and swaps its
// `userMessageBackground` band for `userMessageBackgroundHover` (spec M3, canon §2.3's `Ssi`/`QmS` pair,
// R1 §2.3). Two layers:
//   · a PURE layer over `theme.ts` — the four concrete palettes each carry the hover token, and `auto`
//     resolves it live through `resolveThemeId`/COLORFGBG rather than a hardcoded alias (mirrors
//     `theme.test.ts`'s own `themeTokens()`/`resolveThemeId` idioms so this file does not invent a second
//     style for the same question).
//   · a LIVE layer — the REAL `ChatApp` through the REAL keymap provider, fed RAW SGR MOTION BYTES on stdin
//     exactly as `fold-click.test.tsx` (T10) feeds press/release: there is no seam short of that which would
//     still be testing the thing this task built (the tap machine's own motion arm, the hitmap's `hoverAt`,
//     `Line.tsx`'s context read).
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { THEMES, resolveThemeId, themeTokens, setTheme } from "../../src/tui/theme.js";

afterEach(() => { setTheme("auto"); vi.unstubAllEnvs(); });

// ══ Layer 1 — the four concrete palettes + auto's live resolution ═════════════════════════════════════
// Values read from canon bundle L188034 (2.1.236 `cli.pretty.js`), cited per-palette in theme.ts itself;
// this is the test-side pin, not the citation.
describe("theme.ts — userMessageBackgroundHover, all four concrete palettes", () => {
  it("light: rgb(252, 252, 252)", () => expect(THEMES.light.userMessageBackgroundHover).toBe("rgb(252, 252, 252)"));
  it("dark: rgb(70, 70, 70)", () => expect(THEMES.dark.userMessageBackgroundHover).toBe("rgb(70, 70, 70)"));
  it("light-daltonized: rgb(232, 232, 232)", () => expect(THEMES["light-daltonized"].userMessageBackgroundHover).toBe("rgb(232, 232, 232)"));
  it("dark-daltonized: rgb(70, 70, 70) — byte-identical to dark's, tracking that theme's own userMessageBackground identity", () =>
    expect(THEMES["dark-daltonized"].userMessageBackgroundHover).toBe("rgb(70, 70, 70)"));

  // `auto` carries no tokens of its own (spec review finding) — it must resolve LIVE off COLORFGBG through
  // `resolveThemeId`, never a hardcoded "auto means dark" alias, which is exactly what this wave's premise
  // correction (theme.ts's own header) already forbids for every other token.
  it("auto resolves to light's token under a light-reporting terminal (COLORFGBG 0;15)", () => {
    expect(THEMES[resolveThemeId("auto", { COLORFGBG: "0;15" } as NodeJS.ProcessEnv)].userMessageBackgroundHover)
      .toBe(THEMES.light.userMessageBackgroundHover);
  });
  it("auto resolves to dark's token under a dark-reporting terminal (COLORFGBG 15;0)", () => {
    expect(THEMES[resolveThemeId("auto", { COLORFGBG: "15;0" } as NodeJS.ProcessEnv)].userMessageBackgroundHover)
      .toBe(THEMES.dark.userMessageBackgroundHover);
  });
  // The LIVE `themeTokens()` path (current === "auto", the suite default) — `theme.test.ts`'s own idiom.
  it("themeTokens().userMessageBackgroundHover flips with a live-stubbed COLORFGBG, current theme still \"auto\"", () => {
    vi.stubEnv("COLORFGBG", "0;15");
    expect(themeTokens().userMessageBackgroundHover).toBe(THEMES.light.userMessageBackgroundHover);
    vi.stubEnv("COLORFGBG", "15;0");
    expect(themeTokens().userMessageBackgroundHover).toBe(THEMES.dark.userMessageBackgroundHover);
  });
});

// ══ Layer 2 — the live ChatApp, driven with raw SGR bytes ═════════════════════════════════════════════
const plain = (s: string | undefined): string => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const unlink = (s: string): string => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
const clean = (s: string | undefined): string => unlink(plain(s));
const rowsOf = (frame: string | undefined): string[] => clean(frame).split("\n");
/** The RAW line (escapes intact) whose PLAIN text contains `needle` — `bg-dialog.test.tsx`'s own idiom: a
 *  stripped frame cannot say whether a run is dim or which background it painted. */
const rawLineIncluding = (frame: string | undefined, needle: string): string =>
  (frame ?? "").split("\n").find((l) => clean(l).includes(needle)) ?? "";
const rowOfIncluding = (frame: string | undefined, needle: string): number => {
  const at = rowsOf(frame).findIndex((l) => l.includes(needle));
  expect(at, `no row contains "${needle}" in:\n${clean(frame)}`).toBeGreaterThanOrEqual(0);
  return at + 1;
};
/** `rgb(r,g,b)` (theme.ts's TH2 grammar, e.g. the string a test reads straight off `themeTokens()`) → the
 *  literal 24-bit background SGR chalk emits for it — `bg-dialog.test.tsx`'s `sgr()` widened to background. */
const sgrBg = (rgbToken: string): string => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgbToken)!;
  return `\x1b[48;2;${m[1]};${m[2]};${m[3]}m`;
};
const BAND = sgrBg(themeTokens().userMessageBackground);
const HOVER_BAND = sgrBg(themeTokens().userMessageBackgroundHover);

const sdk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
const call = (id: string, name: string, input: unknown) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `u-${id}`, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, content = "body") =>
  sdk({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });
// A single-line, 15 000-character prompt echo — trips `render.ts`'s 10 000-char fold (`FOLD_THRESHOLD`,
// canon `tWp`) and produces the "(N lines hidden)" RULE row, whose TITLE span is `dim: true` AND
// `bg: userMessageBackground` (`render.ts`'s `ruleRow`; the same fixture shape `f4-acceptance.test.tsx:441`
// pins for the renderer alone) — a real, producible dim-and-banded row, not an invented one.
const LONG_PROMPT = "word ".repeat(3000);
const longUser = (id: string) => sdk({ type: "user", uuid: `ul-${id}`, message: { content: [{ type: "text", text: LONG_PROMPT }] } });
const CLUSTER: readonly TranscriptBootstrapEntry[] = [
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
];
const COLLAPSED = "Read 2 files";
const MEMBER_BODY = "Read 1 line";
const COL = 5;
const PROMPT = "❯ ";

const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
// SGR motion (bit 32 + low bits 3, no button, no modifiers) — the exact byte shape `keys-provider.test.tsx`'s
// own T2 cells decode, and canon's own `?1003h` any-motion report.
const motion = (col: number, row: number) => `\x1b[<35;${col};${row}M`;
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
// `bindings.ts`'s `Scroll` context, `scroll:halfPageUp` — the byte a terminal's PgUp key actually sends.
// `LONG_PROMPT`'s fixed-2500-char head (`render.ts`'s `FOLD_HEAD`) wraps to more rows than a 24-row
// terminal's region on its own, so the rule row this file hovers starts scrolled off the sticky-bottom
// tail by an amount that depends on wrap arithmetic this file has no reason to duplicate — it is walked
// into view a half-page at a time instead, exactly as `fullscreen-scroll.test.tsx` drives the same context.
const PAGE_UP = "\x1b[5~";
async function scrollUntilVisible(r: { stdin: { write(s: string): void }; lastFrame(): string | undefined }, needle: string, maxSteps = 40): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if (clean(r.lastFrame()).includes(needle)) return;
    r.stdin.write(PAGE_UP);
    await settle();
  }
  throw new Error(`"${needle}" never scrolled into view after ${maxSteps} page-ups:\n${clean(r.lastFrame())}`);
}
const scene = (entries: readonly TranscriptBootstrapEntry[], fake = fakeRemote()) => ({
  fake,
  ui: <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
    renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={entries}
    deps={{ columns: () => 80, rows: () => 24 }} />,
});
async function mount(entries: readonly TranscriptBootstrapEntry[], fake?: ReturnType<typeof fakeRemote>) {
  const s = scene(entries, fake);
  const r = renderWithKeymap(s.ui);
  await waitFor(() => clean(r.lastFrame()).includes(PROMPT));
  await settle();
  return { ...r, fake: s.fake };
}
async function tap(r: { stdin: { write(s: string): void } }, col: number, row: number) {
  r.stdin.write(press(col, row));
  await tick();
  r.stdin.write(release(col, row));
  await settle();
}

describe("T3 (a): motion over a dim, banded row un-dims it and swaps the hover bg; moving off restores both", () => {
  it("un-dims the fold rule's title span and swaps its band on hover, and restores both once the pointer leaves", async () => {
    const DOC = [prose("hello there", "a"), longUser("long"), prose("all done", "b")];
    const r = await mount(DOC);
    await scrollUntilVisible(r, "hidden)");
    const ruleRow = rowOfIncluding(r.lastFrame(), "hidden)");
    // A row immediately beside the rule — still on screen once it is — but a SEPARATE `RenderItem`: every
    // line of a rendered message block gets its own id (`toolRenderer.tsx`'s `projectMessageEntry`,
    // `block:<i>:<lineIndex>`), so a head row of the SAME echoed prompt is already a different `itemKey`
    // from the rule row, exactly as a wholly different message would be.
    const otherRow = ruleRow > 1 ? ruleRow - 1 : ruleRow + 1;

    // PREMISE: the row really is dim-and-banded before any hover, so the test can fail for the right reason.
    const before = rawLineIncluding(r.lastFrame(), "hidden)");
    expect(before).toContain("\x1b[2m");
    expect(before).toContain(BAND);
    expect(before).not.toContain(HOVER_BAND);

    r.stdin.write(motion(COL, ruleRow));
    await settle();
    const hovered = rawLineIncluding(r.lastFrame(), "hidden)");
    expect(hovered).not.toContain("\x1b[2m");
    expect(hovered).toContain(HOVER_BAND);
    expect(hovered).not.toContain(BAND);

    // Moving to the DIFFERENT row restores the first.
    r.stdin.write(motion(COL, otherRow));
    await settle();
    const restored = rawLineIncluding(r.lastFrame(), "hidden)");
    expect(restored).toContain("\x1b[2m");
    expect(restored).toContain(BAND);
    expect(restored).not.toContain(HOVER_BAND);
    r.unmount();
  });
});

describe("T3 (b): an already-expanded cluster member is unaffected by hover", () => {
  it("leaves an expanded member's row byte-identical before and after a motion report over it", async () => {
    const DOC = [prose("hello there", "a"), ...CLUSTER, prose("all done", "b")];
    const r = await mount(DOC);
    await tap(r, COL, rowOfIncluding(r.lastFrame(), COLLAPSED));                 // open the cluster
    const memberRow = rowOfIncluding(r.lastFrame(), MEMBER_BODY);
    const before = rawLineIncluding(r.lastFrame(), MEMBER_BODY);
    // The fixture's own premise: this row carries no dim and no band to begin with (`toolSummaries.ts`'s
    // `readRows` default arm; `toolRenderer.tsx`'s plain result gutter-block carries no `gutterStyle`) — so
    // "unaffected" is a real absence of change, not a coincidence of what the assertion happened to check.
    expect(before).not.toContain("\x1b[2m");
    expect(before).not.toContain(BAND);

    r.stdin.write(motion(COL, memberRow));
    await settle();
    const after = rawLineIncluding(r.lastFrame(), MEMBER_BODY);
    expect(after).toBe(before);
    r.unmount();
  });
});

describe("T3 (c): scroll mode — hover has no effect at all", () => {
  it("leaves the dim, banded rule row untouched under CLAUDE_CODE_DISABLE_MOUSE_CLICKS", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_MOUSE_CLICKS", "1");
    const DOC = [prose("hello there", "a"), longUser("long"), prose("all done", "b")];
    const r = await mount(DOC);
    // `scroll:halfPageUp` is bound to PgUp in every mouse mode (it is a KEY, not a mouse report) — scrolling
    // under `scroll` mode is unaffected by the gate this case exists to prove.
    await scrollUntilVisible(r, "hidden)");
    const ruleRow = rowOfIncluding(r.lastFrame(), "hidden)");
    const before = rawLineIncluding(r.lastFrame(), "hidden)");
    expect(before).toContain("\x1b[2m");
    expect(before).toContain(BAND);

    // `scroll` mode drops motion unconditionally at the KeymapProvider dispatch gate (T2) — this sink never
    // even sees the report — so the row must be BYTE-IDENTICAL, not merely "still dim".
    r.stdin.write(motion(COL, ruleRow));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "hidden)")).toBe(before);
    r.unmount();
  });
});
