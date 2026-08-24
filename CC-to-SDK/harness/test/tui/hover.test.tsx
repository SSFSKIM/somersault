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
import { render } from "ink-testing-library";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { JumpPill } from "../../src/tui/JumpPill.js";
import { HoverContext } from "../../src/tui/mouse/hoverContext.js";
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
const result = (id: string, content = "body", isError = false) =>
  sdk({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const prose = (text: string, id: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: `up-${id}`, message: { id: `mp-${id}`, content: [{ type: "text", text }] } });
// A single-line, 15 000-character prompt echo — trips `render.ts`'s 10 000-char fold (`FOLD_THRESHOLD`,
// canon `tWp`) and produces the "(N lines hidden)" RULE row, whose TITLE span is `dim: true` AND
// `bg: userMessageBackground` (`render.ts`'s `ruleRow`; the same fixture shape `f4-acceptance.test.tsx:441`
// pins for the renderer alone) — a real, producible dim-and-banded row, not an invented one.
const LONG_PROMPT = "word ".repeat(3000);
// T-CLICKGATE Task 2 (a) — a `Mystery` tool (no fold-grouping species claims it, `toolFold.ts`'s own
// `collapsible` rule; `hover-owner.test.tsx`'s own T-CLICKGATE fixture uses the same tool name for the same
// reason) whose ERROR result is 12 physical lines — one past `ERROR_PHYSICAL_ROWS` (ten) — so `resultBody`
// stamps its gutter-block `clickable: true` (Task 1) AND its rendered body genuinely carries a dim
// "… +2 lines" overflow marker under the transcript's default `compact` projection: a real dim row on a
// real clickable owner, not an invented one.
const errorLines = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
const longUser = (id: string) => sdk({ type: "user", uuid: `ul-${id}`, message: { content: [{ type: "text", text: LONG_PROMPT }] } });
const CLUSTER: readonly TranscriptBootstrapEntry[] = [
  call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1"),
  call("read-2", "Read", { file_path: "/work/b.ts" }), result("read-2"),
];
const COLLAPSED = "Read 2 files";
const MEMBER_BODY = "Read 1 line";
// The review's own repro (task-3-report.md, Critical finding): two Bash calls whose head word (`cat`) is in
// `toolFold.ts`'s `BASH_READ` set, so `classifyBashCommand` folds them into the SAME "read" cluster a pair of
// `Read` calls would (`absorb`'s read arm increments `readOperationCount` when the call carries no
// `file_path`, and `emit`'s `readCount` falls back to it) — the clause text is therefore byte-identical to
// `COLLAPSED` above, a coincidence the fixture relies on rather than hides. The second call's EMPTY result is
// what makes `toolSummaries.ts`'s `bashRows` emit a `dim: true` "(No output)" row unconditionally (its
// flat-fallback empty-output arm), which is content an expanded Read member never has — this is the row the
// Critical finding's live repro un-dimmed.
const CLUSTER_BASH: readonly TranscriptBootstrapEntry[] = [
  call("bash-1", "Bash", { command: "cat a.txt" }), result("bash-1", "line one"),
  call("bash-2", "Bash", { command: "cat b.txt" }), result("bash-2", ""),
];
const NO_OUTPUT = "(No output)";
const COL = 5;
const PROMPT = "❯ ";

const press = (col: number, row: number) => `\x1b[<0;${col};${row}M`;
const release = (col: number, row: number) => `\x1b[<0;${col};${row}m`;
// SGR motion (bit 32 + low bits 3, no button, no modifiers) — the exact byte shape `keys-provider.test.tsx`'s
// own T2 cells decode, and canon's own `?1003h` any-motion report.
const motion = (col: number, row: number) => `\x1b[<35;${col};${row}M`;
// SGR wheel-up (button 64, no modifiers) — `fold-click.test.tsx` T10(d)'s own byte shape. The cell named in
// the report is irrelevant to dispatch (`KeymapProvider` resolves it as a KEY, `scroll:lineUp`, off the
// escape sequence alone, never the coordinates) so a fixed cell is honest rather than a shortcut.
const WHEEL_UP = "\x1b[<64;5;5M";
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

describe("T-CLICKGATE Task 2 (a): motion over a CLICKABLE row (a >10-line error result) un-dims it", () => {
  it("un-dims the error's overflow marker on hover of a DIFFERENT row of the SAME owner, restoring it once the pointer leaves", async () => {
    const DOC = [prose("hello there", "a"), call("mystery-1", "Mystery", {}), result("mystery-1", errorLines(12), true), prose("all done", "b")];
    const r = await mount(DOC);
    const markerRow = rowOfIncluding(r.lastFrame(), "+2 lines");

    // PREMISE: the marker row really is dim before any hover, so the test can fail for the right reason.
    const before = rawLineIncluding(r.lastFrame(), "+2 lines");
    expect(before).toContain("\x1b[2m");

    // Hovered row is the error's FIRST line, not the marker itself — proving this is OWNER-level un-dim
    // (H1), not "the row directly under the pointer happened to un-dim".
    const firstErrRow = rowOfIncluding(r.lastFrame(), "err line 1");
    r.stdin.write(motion(COL, firstErrRow));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "+2 lines")).not.toContain("\x1b[2m");

    // Moving OFF the owner (a column past the hovered row's own painted width) restores the dim.
    r.stdin.write(motion(300, firstErrRow));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "+2 lines")).toContain("\x1b[2m");
    r.unmount();
  });
});

describe("T-CLICKGATE Task 2 (b): motion over a NON-clickable dim row does NOT un-dim it", () => {
  // The F10-era hover machine un-dimmed EVERY painted row under the pointer, no matter what it was — this
  // cell used to pin exactly that ("un-dims the fold rule's title span on hover"). This long-prompt fold
  // rule is a USER PROMPT's own overflow marker (`render.ts`'s `ruleRow`), never a `tool_result`, so
  // `toolRenderer.tsx`'s `resultBody` never touches it and it is never stamped `clickable` — it is exactly
  // the kind of row this ticket's gate now excludes, and the pin moves here to say so.
  it("leaves the fold rule's dim, banded title span byte-identical across a motion report", async () => {
    const DOC = [prose("hello there", "a"), longUser("long"), prose("all done", "b")];
    const r = await mount(DOC);
    await scrollUntilVisible(r, "hidden)");
    const ruleRow = rowOfIncluding(r.lastFrame(), "hidden)");

    const before = rawLineIncluding(r.lastFrame(), "hidden)");
    expect(before).toContain("\x1b[2m");
    expect(before).toContain(BAND);

    r.stdin.write(motion(COL, ruleRow));
    await settle();
    expect(rawLineIncluding(r.lastFrame(), "hidden)")).toBe(before);
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

describe("T3 (b, review Critical): a Bash cluster member's DIM body row is unaffected by hover once expanded", () => {
  // task-3-report.md's own live repro: T3(b) above passed only because its `Read` fixture's expanded body
  // (`MEMBER_BODY = "Read 1 line"`) happens to carry no dim/banded content to begin with — so the shipped
  // suite could not tell "hover suppressed on an expanded member" from "this row was never dim". This
  // fixture's second Bash call returns EMPTY output, which `toolSummaries.ts`'s `bashRows` renders as a
  // genuinely dim `(No output)` row even under `detail-all` (the projection an opened cluster member uses) —
  // real dim content on an expanded member, reproducing the review's exact scenario.
  it("leaves the '(No output)' row's dim SGR intact — byte-identical — before and after a motion report over it", async () => {
    const DOC = [prose("hello there", "a"), ...CLUSTER_BASH, prose("all done", "b")];
    const r = await mount(DOC);
    await tap(r, COL, rowOfIncluding(r.lastFrame(), COLLAPSED));               // open the cluster
    const memberRow = rowOfIncluding(r.lastFrame(), NO_OUTPUT);
    const before = rawLineIncluding(r.lastFrame(), NO_OUTPUT);
    // The fixture's own premise: the row really is dim before any hover, so the assertion below can fail for
    // the right reason (T3(a)'s own discipline).
    expect(before).toContain("\x1b[2m");

    r.stdin.write(motion(COL, memberRow));
    await settle();
    const after = rawLineIncluding(r.lastFrame(), NO_OUTPUT);
    // Canon's provider is `hovered && !expanded` (bundle L562783) — an already-expanded cluster member gets
    // NO hover effect at all, dim included. Byte-identical, not merely "still contains \x1b[2m", matching
    // T3(b)'s own assertion shape above.
    expect(after).toBe(before);
    r.unmount();
  });
});

describe("T3 (review Important): a wheel tick clears an active hover", () => {
  // Mutation (a) in the review removed `clearHover()` from `discardTap` and NOTHING failed — the wiring
  // (`ChatApp.tsx`'s `discardTap`, wired to `FullscreenViewport`'s `onWheelTick`) was correct but unproven.
  //   T-CLICKGATE Task 2: this cell's own fixture (the long-prompt fold rule) is no longer clickable and so
  // no longer hovers at all (moved to Task 2 (b) above) — re-pointed at the >10-line error result Task 2
  // (a) uses, the one fixture in this file that genuinely activates a hover for the wheel to clear.
  it("restores the dim on the currently-hovered row when the wheel turns; HOVER_BAND is absent throughout", async () => {
    const DOC = [prose("hello there", "a"), call("mystery-1", "Mystery", {}), result("mystery-1", errorLines(12), true), prose("all done", "b")];
    const r = await mount(DOC);
    const markerRow = rowOfIncluding(r.lastFrame(), "+2 lines");

    r.stdin.write(motion(COL, markerRow));
    await settle();
    const hovered = rawLineIncluding(r.lastFrame(), "+2 lines");
    // Premise: the hover really landed, so the assertion below can fail for the right reason.
    expect(hovered).not.toContain("\x1b[2m");
    expect(hovered).not.toContain(HOVER_BAND);

    // The wheel tick's cell is irrelevant (dispatched as a KEY, not resolved against the pointer's last
    // position) — only that a wheel event reached `onWheelTick` while a row was hovered.
    r.stdin.write(WHEEL_UP);
    await settle();
    const afterWheel = rawLineIncluding(r.lastFrame(), "+2 lines");
    expect(afterWheel).toContain("\x1b[2m");
    expect(afterWheel).not.toContain(HOVER_BAND);
    r.unmount();
  });
});

// ══ F10 T-HOVER H1 — the band leaves the transcript and lands on the pill ═════════════════════════════
describe("H1: no transcript row ever changes background on hover", () => {
  it("no transcript row changes background on hover — canon's Ssi never reaches a background (L203984)", async () => {
    const DOC = [prose("hello there", "a"), longUser("long"), prose("all done", "b")];
    const r = await mount(DOC);
    for (let row = 1; row <= 20; row++) {
      r.stdin.write(motion(COL, row));
      await settle();
      expect(r.lastFrame()).not.toContain(HOVER_BAND);
    }
    r.unmount();
  });
});

describe("H1: the hover band is re-homed on JumpPill (chrome, not transcript)", () => {
  it("swaps JumpPill's own band on hover and restores it off hover, in isolation", () => {
    const hovered = render(<HoverContext.Provider value={true}><JumpPill newRows={0} columns={40} /></HoverContext.Provider>);
    expect(hovered.lastFrame()).toContain(HOVER_BAND);
    expect(hovered.lastFrame()).not.toContain(BAND);
    hovered.unmount();

    const idle = render(<HoverContext.Provider value={false}><JumpPill newRows={0} columns={40} /></HoverContext.Provider>);
    expect(idle.lastFrame()).toContain(BAND);
    expect(idle.lastFrame()).not.toContain(HOVER_BAND);
    idle.unmount();
  });

  it("a motion report on the live pill's row swaps its band; one row above does not", async () => {
    const DOC = [prose("hello there", "a"), longUser("long"), prose("all done", "b")];
    const r = await mount(DOC);
    r.stdin.write(PAGE_UP);
    await settle();
    const pillRow = rowOfIncluding(r.lastFrame(), "Jump to bottom");
    const before = rawLineIncluding(r.lastFrame(), "Jump to bottom");
    expect(before).toContain(BAND);
    expect(before).not.toContain(HOVER_BAND);

    r.stdin.write(motion(COL, pillRow));
    await settle();
    const onPill = rawLineIncluding(r.lastFrame(), "Jump to bottom");
    expect(onPill).toContain(HOVER_BAND);
    expect(onPill).not.toContain(BAND);

    r.stdin.write(motion(COL, pillRow - 1));
    await settle();
    const oneAbove = rawLineIncluding(r.lastFrame(), "Jump to bottom");
    expect(oneAbove).toContain(BAND);
    expect(oneAbove).not.toContain(HOVER_BAND);
    r.unmount();
  });
});

describe("H1: message-level hover grouping over a multi-line local event — gated on `clickable` now (T-CLICKGATE Task 2)", () => {
  // Pre-T-CLICKGATE this cell proved the OPPOSITE ("un-dims EVERY dim line of it") — the F10-era hover
  // machine grouped and brightened any owner, local status events included. No producer ever stamps a
  // `local`/status row `clickable` (only `toolRenderer.tsx`'s tool-result gutter-blocks do, T-CLICKGATE
  // Task 1), so this owner is never in `clickableOwners` and the grouping wiring, still fully exercised
  // here (multiple dim rows sharing one owner), must now leave every one of them untouched.
  it("hovering the middle line of a multi-line local event un-dims nothing — its owner is never clickable", async () => {
    const statusA: TranscriptBootstrapEntry = { kind: "local", identity: "status-a", event: { kind: "visual", lines: [
      { text: "Status" },
      { text: "  model: opus-a", dim: true },
      { text: "  cwd: /work-a", dim: true },
      { text: "  branch: main-a", dim: true },
    ] } };
    const statusB: TranscriptBootstrapEntry = { kind: "local", identity: "status-b", event: { kind: "visual", lines: [
      { text: "  neighbor: dim-b", dim: true },
    ] } };
    const DOC = [prose("hello there", "a"), statusA, statusB, prose("all done", "b")];
    const r = await mount(DOC);
    const midRow = rowOfIncluding(r.lastFrame(), "cwd: /work-a");   // hover the MIDDLE line of the block

    // premise: every named line really is dim before any hover.
    for (const needle of ["model: opus-a", "cwd: /work-a", "branch: main-a", "neighbor: dim-b"])
      expect(rawLineIncluding(r.lastFrame(), needle)).toContain("\x1b[2m");

    r.stdin.write(motion(COL, midRow));
    await settle();
    for (const needle of ["model: opus-a", "cwd: /work-a", "branch: main-a", "neighbor: dim-b"])
      expect(rawLineIncluding(r.lastFrame(), needle), `${needle} must stay dim — its owner is not clickable`).toContain("\x1b[2m");
    r.unmount();
  });
});
