// tui/test/fullscreen-overlays.test.tsx — FSW Task 13: the TWO overlay mechanisms, and why one was not enough.
//
// Grounding §L2.6, "Two overlay mechanisms, not one": in canonical fullscreen `/model`, `/help` and `/resume`
// render in ONE absolutely-positioned bottom slot (bundle `xDa` L455951 — `position:absolute bottom:0 …
// maxHeight: rows − 2 … opaque`) whose top edge is an upper-half-block `▔▔▔▔` rule, with the transcript
// squeezed above it; the PERMISSION DIALOG does something else entirely — it replaces the dock (bundle L549395's
// `(PA || as?.shouldHidePromptInput)` branch), the composer disappears, and the dialog sits under the ordinary
// `────` rule its own frame already paints. Ours had only the dock: every picker was living inside a
// `floor(rows/2)` cap that canon never applies to it, silently clipped at the frame's edge.
//
// THE THREE CLAIMS THIS FILE HOLDS DOWN:
//   1. The seam slot is the frame's bottom band, capped `rows − 2`, under a full-width `▔` rule, and the dock
//      is not painted underneath it — Ink 5.2.1 has `position:absolute` but no `opaque`, so canon's occlusion
//      is reproduced by NOT RENDERING the occluded band rather than by painting over it (grounding §B1).
//   2. The region's published GRANT tracks the slot. `RegionRowsContext` is what `FullscreenViewport` slices
//      against, so a grant that did not shrink with the seam would have the viewport render rows the frame is
//      about to clip — off the tail, which is the end bottom-anchoring exists to protect.
//   3. The dock mechanism survives intact, INCLUDING the scroll crossing recorded at keys/bindings.ts:280:
//      a permission dialog's ctrl+u/ctrl+d fall through to the region's `Scroll` context (the dialog is in the
//      dock's disjoint row band and the viewport stays mounted), while PlanDialog — which registers the same
//      two actions itself — still wins them by mount order.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FullscreenFrame, seamCap, useRegionRows } from "../../src/tui/FullscreenFrame.js";
import { themeTokens } from "../../src/tui/theme.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { ChatSession } from "../../src/tui/useChat.js";

const rowsOf = (frame: string | undefined): string[] => (frame ?? "").split("\n");
const strip = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim();
const frameOf = (f: () => string | undefined) => f() ?? "";
const band = (n: number, tag: string) => (
  <Box flexDirection="column">{Array.from({ length: n }, (_, i) => <Text key={i}>{`${tag}${i}`}</Text>)}</Box>
);
/** The frame converges over two passive-effect passes (T10 §4): measure the grant, then re-measure content
 *  against it. A slot mount/unmount is a third geometry change, so anything watching `onOverflow` settles four. */
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** The seam itself: a run of U+2594 and nothing else on the row. */
const isSeamRule = (line: string | undefined): boolean => /^▔+$/.test(strip(line));
const seamRuleAt = (lines: string[]): number => lines.findIndex(isSeamRule);
/** The composer's ready prompt — `❯` + U+00A0. Its absence IS "the composer is not mounted". */
const PROMPT = "❯ ";
/** What `DialogFrame` paints above every permission-family dialog: `borderStyle:"round"` with the two
 *  verticals and the bottom switched off, i.e. a bare `─` run (DialogFrame.tsx's header, bundle L438011). */
const isDialogRule = (line: string | undefined): boolean => /^─+$/.test(strip(line));

describe("FullscreenFrame — the seam slot", () => {
  it("caps the seam at canon's rows − 2, clamped into the frame", () => {
    expect([15, 24, 40].map(seamCap)).toEqual([13, 22, 38]);
    expect(seamCap(2)).toBe(1);                    // a two-row pane still yields a slot rather than none
    expect(seamCap(1)).toBe(1);
  });

  // THE SHAPE, at one geometry. The seam is the BOTTOM band — canon's `bottom:0` — and the dock it occludes is
  // not painted at all, because stock Ink cannot paint over it.
  it("puts the slot on the frame's bottom rows under a ▔ rule, with the dock gone and the transcript above", () => {
    const { lastFrame } = render(
      <FullscreenFrame rows={24} regionChildren={band(30, "R")} dock={band(2, "D")} seam={band(5, "S")} />,
    );
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(23);
    expect(lines[0]).toBe("R0");                                     // the transcript keeps the top
    expect(isSeamRule(lines[17])).toBe(true);                        // 23 − (1 rule + 5 slot rows)
    expect(strip(lines[17]).length).toBeGreaterThan(10);             // …and it is the frame's full width
    expect(lines.slice(18)).toEqual(["S0", "S1", "S2", "S3", "S4"]);
    expect(lines.join("\n")).not.toContain("D0");                    // canon's `opaque`, by omission
  });

  // THE RULE'S COLOUR (T13b, T13 review Minor 1). The T13 report recorded it "unknowable — the captures are
  // plain text", which the bundle refutes outright: the slot's top edge is `Sg({ color: "permission", char:
  // "▔" })` (L455951), and `Sg` paints `<Text color={color} dimColor={!color}>` (L183955) — so a rule with a
  // colour is NOT dimmed. Both halves are asserted, because "coloured" and "not dim" are separate SGR runs.
  it("paints the seam rule in the permission role, undimmed (`Sg` L183955)", () => {
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens().permission);
    const { lastFrame } = render(<FullscreenFrame rows={24} regionChildren={band(4, "R")} dock={band(2, "D")} seam={band(3, "S")} />);
    const rule = rowsOf(lastFrame()).find((l) => isSeamRule(l));
    expect(rule).toBeDefined();
    expect(rule).toContain(`\x1b[38;2;${m![1]};${m![2]};${m![3]}m`);
    expect(rule).not.toContain("\x1b[2m");
  });

  // THE CAP, and the row it always leaves the transcript. `rows − 2` inside a `rows − 1` frame is exactly one
  // region row: canon's "transcript still visible above" is arithmetic, not a coincidence.
  it("clips a slot past rows − 2 and keeps one row of transcript, naming the seam on the debug seam", async () => {
    const overflow = vi.fn();
    const { lastFrame } = render(
      <FullscreenFrame rows={24} onOverflow={overflow} regionChildren={band(30, "R")} dock={band(2, "D")} seam={band(40, "S")} />,
    );
    await settle();
    const lines = rowsOf(lastFrame());
    expect(lines).toHaveLength(23);
    expect(lines[0]).toBe("R0");
    expect(isSeamRule(lines[1])).toBe(true);
    expect(lines[22]).toBe("S20");                                   // 22 slot rows: the rule + S0…S20
    expect(overflow).toHaveBeenCalled();
    expect(overflow.mock.calls.map(([m]) => m).join("\n")).toContain("seam");
  });

  // ── THE GRANT TRACKS THE SLOT ──────────────────────────────────────────────────────────────────────────
  // `useRegionRows` is what `FullscreenViewport.pageItemSlices` and `RegionPager`'s clip spend. A grant that
  // stayed at the dock's number while the seam took twenty-two rows would have both render into a band the
  // frame then clips — and Task 11 measured that the frame's diagnostic CANNOT see a viewport-local re-render,
  // so the failure would be silent.
  const GrantProbe = () => <Text>{`grant=${useRegionRows()}`}</Text>;
  it("shrinks the published grant when the slot mounts and hands it back when it goes", async () => {
    const overflow = vi.fn();
    const r = render(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={<GrantProbe />} dock={band(2, "D")} />);
    await settle();
    expect(frameOf(r.lastFrame)).toContain("grant=21");              // 23 − a two-row dock
    r.rerender(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={<GrantProbe />} dock={band(2, "D")} seam={band(5, "S")} />);
    await settle();
    expect(frameOf(r.lastFrame)).toContain("grant=17");              // 23 − (1 rule + 5 slot rows)
    r.rerender(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={<GrantProbe />} dock={band(2, "D")} />);
    await settle();
    expect(frameOf(r.lastFrame)).toContain("grant=21");
    // …AND THE TRANSIENT SAYS NOTHING. The slot's height is not known until it renders, so the grant settles
    // over two passes; the one-frame under-grant in between is the safe direction and must not be reported as
    // a caller bug.
    expect(overflow).not.toHaveBeenCalled();
    r.unmount();
  });

  // THE STAMP CARRIES THE SLOT, NOT ONLY THE CAP — and this is the one geometry where that is the difference.
  // A history search widens the DOCK's cap to `rows − 2`, which is the seam's own number, so a stamp keyed on
  // the cap alone would consider a grant measured against a two-row dock still valid on the frame where a
  // six-row slot has taken the band: twenty-one rows published to a region that now has seventeen, for the one
  // frame before the re-measure. It is a clip rather than a crash, which is exactly why it needs a test — the
  // painted frame is `rows − 1` either way, so only the intermediate FRAMES can tell.
  it("never publishes the dock's grant into a frame the seam has taken", async () => {
    const r = render(<FullscreenFrame rows={24} historySearchOpen regionChildren={<GrantProbe />} dock={band(2, "D")} />);
    await settle();
    expect(frameOf(r.lastFrame)).toContain("grant=21");
    const at = r.frames.length;
    r.rerender(<FullscreenFrame rows={24} historySearchOpen regionChildren={<GrantProbe />} dock={band(2, "D")} seam={band(5, "S")} />);
    await settle();
    const after = r.frames.slice(at);
    expect(after.some((f) => f.includes("grant=17"))).toBe(true);      // it settles on the slot's own grant…
    expect(after.every((f) => !f.includes("grant=21"))).toBe(true);    // …and never paints the dock's on the way
    r.unmount();
  });

  // The other half of the frame's Task 9 note ("a dock that overruns its cap … is clipped by the frame with
  // nothing said. A second measurement on the dock box is the fix when that lands"). T13 is when it lands.
  it("names the dock when the dock overruns its own cap", async () => {
    const overflow = vi.fn();
    render(<FullscreenFrame rows={24} onOverflow={overflow} regionChildren={band(2, "R")} dock={band(30, "D")} />);
    await settle();
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(overflow.mock.calls[0]![0]).toContain("dock");
    expect(overflow.mock.calls[0]![0]).toContain("30");
  });
});

let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-t13-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const alphaEntries = (n = 40) => Array.from({ length: n }, (_, i) => ({
  kind: "sdk" as const, source: "disk" as const,
  message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
}));
const permissionEntry = (toolUseID = "t"): PendingEntry =>
  ({ sessionId: "s", toolUseID, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });
const planEntry = (plan: string): PendingEntry =>
  ({ sessionId: "s", toolUseID: "p", toolName: "ExitPlanMode", kind: "plan", input: { plan }, createdAt: Date.now() });
const MODELS = { models: [{ value: "opus", displayName: "Opus" }, { value: "sonnet", displayName: "Sonnet" }], commands: [], mcpServers: [] };

describe("ChatApp routes the two mechanisms", () => {
  const app = (mode: "fullscreen" | "classic", fake: ReturnType<typeof fakeRemote>) => (
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode, reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => 24 }} />
  );
  const openModel = async (r: ReturnType<typeof renderWithKeymap>) => {
    r.stdin.write("/model");
    await waitFor(() => frameOf(r.lastFrame).includes("/model"));
    r.stdin.write("\r");
    await waitFor(() => frameOf(r.lastFrame).includes("Select model"));
    await settle();
  };

  // ── MECHANISM ONE: the seam ────────────────────────────────────────────────────────────────────────────
  it("draws /model in the seam slot, transcript above, composer and footer occluded", async () => {
    const r = renderWithKeymap(app("fullscreen", fakeRemote({ capabilities: () => MODELS })));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    await openModel(r);
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);                                   // still rows − 1
    const rule = seamRuleAt(lines);
    expect(rule).toBeGreaterThan(0);                                  // …with transcript rows ABOVE the rule
    expect(lines.slice(0, rule).join("\n")).toContain("ALPHA-");
    expect(lines.length - rule).toBeLessThanOrEqual(22);              // the slot is capped at rows − 2
    expect(lines.slice(rule + 1).join("\n")).toContain("Select model");
    expect(r.lastFrame()).not.toContain(PROMPT);                      // the composer is gone
    r.unmount();
  });

  it("takes the seam down again and gives the transcript its rows back", async () => {
    const r = renderWithKeymap(app("fullscreen", fakeRemote({ capabilities: () => MODELS })));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    await openModel(r);
    r.stdin.write("\x1b");                                            // escape closes the picker
    await waitFor(() => !frameOf(r.lastFrame).includes("Select model"));
    await settle();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);
    expect(seamRuleAt(lines)).toBe(-1);
    expect(r.lastFrame()).toContain(PROMPT);
    r.unmount();
  });

  // …AND THE SURFACE IN IT SIZES TO THE SLOT, NOT THE TERMINAL. Canon's own `/help` loses its `Esc to cancel`
  // line off the bottom at 24 rows because the modal windows itself for a height the slot does not have —
  // "an upstream clipping defect, not something to reproduce" (grounding §L2.6). The discriminating geometry is
  // a short pane with a long list: handed the slot's budget the picker windows itself and SAYS how many it hid;
  // handed `rows` it renders more and the frame eats the counter, leaving a list that appears to end.
  //   THE BUDGET IS THE CAP MINUS ONE (T13b). The `▔` rule is a BORDER on the slot's box, so it is charged
  //   against the same `rows − 2` the tenant is capped at, and the rows that actually paint content are
  //   `rows − 3`. Canon hands its modal exactly that: `Q0r = Wbt − aIr − 1` with `aIr = 2` (bundle L455845),
  //   while the box around it takes `maxHeight: Wbt − aIr` (L455951). So at 18 rows the picker gets fourteen,
  //   not fifteen, and hides one model more than it did before this correction.
  it("hands a seam surface the slot's rows MINUS the rule, so its own window stays honest at a short pane", async () => {
    const models = { models: Array.from({ length: 12 }, (_, i) => ({ value: `m${i}`, displayName: `Model ${i}` })), commands: [], mcpServers: [] };
    const r = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote({ capabilities: () => models }) as unknown as ChatSession}
        client={{ kind: "loopback" }} cwd="/work" renderer={{ mode: "fullscreen", reason: "env_on" }}
        initialEntries={alphaEntries()} deps={{ columns: () => 80, rows: () => 18 }} />,
    );
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    await openModel(r);
    expect(rowsOf(r.lastFrame())).toHaveLength(17);
    expect(r.lastFrame()).toContain("… +5 models");
    r.unmount();
  });

  // ── MECHANISM TWO: the dock ────────────────────────────────────────────────────────────────────────────
  it("gives a permission dialog the dock — composer gone, no seam, the dialog's own ──── rule above it", async () => {
    const fake = fakeRemote();
    const r = renderWithKeymap(app("fullscreen", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.parkPermission(permissionEntry());
    await waitFor(() => frameOf(r.lastFrame).includes("Edit file"));
    await settle();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);
    expect(seamRuleAt(lines)).toBe(-1);                               // NOT the overlay slot
    expect(r.lastFrame()).not.toContain(PROMPT);                      // the composer disappeared
    const rule = lines.findIndex(isDialogRule);
    expect(rule).toBeGreaterThan(0);
    expect(lines.slice(0, rule).join("\n")).toContain("ALPHA-");      // transcript above the rule
    expect(lines.slice(rule).join("\n")).toContain("Edit file");      // dialog under it
    r.unmount();
  });

  // ── THE CROSSING (keys/bindings.ts:280), WHICH THE DOCK REPLACEMENT MUST NOT BREAK ─────────────────────
  it("still scrolls the region on ctrl+u while a permission dialog owns the dock", async () => {
    const fake = fakeRemote();
    const r = renderWithKeymap(app("fullscreen", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.parkPermission(permissionEntry());
    await waitFor(() => frameOf(r.lastFrame).includes("Edit file"));
    await settle();
    const before = strip(rowsOf(r.lastFrame())[0]);
    r.stdin.write("\x15");                                            // ctrl+u — SelectDecision's scroll:halfPageUp
    await settle();
    const after = strip(rowsOf(r.lastFrame())[0]);
    expect(after).not.toBe(before);
    expect(after).toMatch(/ALPHA-/);
    r.unmount();
  });

  // ── THE ONE DECISION THAT IS A SEAM SURFACE ────────────────────────────────────────────────────────────
  // `ypi` (bundle L507338) is a one-entry layout table — `{ [exit-plan-mode]: "modal" }` — and `Api` returns
  // null unless the pending decision's layout matches the variant it was mounted with (L507350), so the plan
  // dialog is exactly what `cZo`'s `modal` prop carries besides the user-opened surfaces. Left in the dock it
  // does not fit: seventeen rows of dialog into a twelve-row cap at 24 rows, and the rows the frame drops are
  // the option block — every answer the dialog exists to collect.
  it("gives the plan dialog the seam, where its options survive the frame", async () => {
    const fake = fakeRemote();
    const r = renderWithKeymap(app("fullscreen", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.parkPermission(planEntry(Array.from({ length: 30 }, (_, i) => `- P${i}`).join("\n")));
    await waitFor(() => frameOf(r.lastFrame).includes("Ready to code?"));
    await settle();
    const lines = rowsOf(r.lastFrame());
    expect(lines).toHaveLength(23);
    const rule = seamRuleAt(lines);
    expect(rule).toBeGreaterThan(0);
    expect(lines.slice(0, rule).join("\n")).toContain("ALPHA-");        // transcript squeezed, not gone
    expect(lines.slice(rule + 1).join("\n")).toContain("Ready to code?");
    expect(r.lastFrame()).toContain("Yes, auto-accept edits");          // …and the options are ON SCREEN
    r.unmount();
  });

  // BOTH HALVES OF THE CROSSING, which the T13 version only asserted the negative of. "The region did not
  // scroll" is also what a dead key looks like, so the marker is read too: it is the plan's own report of
  // where its window sits, and it MOVES on ctrl+d and comes back on ctrl+u.
  const planMarker = (f: string): string => (/… .*(?=\(ctrl)/.exec(strip(f.split("\n").find((l) => l.includes("…")) ?? "")) ?? [""])[0];
  it("lets PlanDialog keep ctrl+u for its own body — the plan pages and the transcript does not move", async () => {
    const fake = fakeRemote();
    const r = renderWithKeymap(app("fullscreen", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.parkPermission(planEntry(Array.from({ length: 30 }, (_, i) => `- P${i}`).join("\n")));
    await waitFor(() => frameOf(r.lastFrame).includes("Ready to code?"));
    await settle();
    const before = strip(rowsOf(r.lastFrame())[0]);
    const markerBefore = planMarker(frameOf(r.lastFrame));
    expect(markerBefore).toMatch(/\+\d+ more lines/);
    r.stdin.write("\x04");                                            // ctrl+d — the plan's own half page down
    await settle();
    expect(strip(rowsOf(r.lastFrame())[0])).toBe(before);             // the region did NOT scroll
    const markerAfter = planMarker(frameOf(r.lastFrame));
    expect(markerAfter).not.toBe(markerBefore);                       // …because the PLAN took the key
    r.stdin.write("\x15");                                            // …and back up
    await settle();
    expect(strip(rowsOf(r.lastFrame())[0])).toBe(before);
    expect(planMarker(frameOf(r.lastFrame))).toBe(markerBefore);
    r.unmount();
  });

  // ── FSW TASK 13b — THE BUDGET INVERSION: WHAT A DIALOG CANNOT SHRINK, IT MUST NOT CLIP ─────────────────
  // The T13 review's Critical. A dock-pinned permission dialog carrying a long diff composed to sixty rows
  // into a twelve-row band at 24 rows, and the rows the frame dropped were the QUESTION, every OPTION and the
  // `esc cancel` row — with no marker to say so and, because the dock is not the pager's region, no scroll
  // path to reach them. The user would have been authorising an edit they could not see. The fix inverts what
  // gives way: chrome is reserved, the DIFF windows into whatever is left, and the `… +N more lines` marker
  // rides INSIDE the window (a marker after the content would itself be the row that clips).
  const OLD_TEXT = Array.from({ length: 25 }, (_, i) => `old ${i}`).join("\n");
  const NEW_TEXT = Array.from({ length: 25 }, (_, i) => `new ${i}`).join("\n");
  const diffEntry = (): PendingEntry => ({
    sessionId: "s", toolUseID: "d", toolName: "Edit", kind: "permission",
    input: { file_path: "/work/f.ts", old_string: OLD_TEXT, new_string: NEW_TEXT }, createdAt: Date.now(),
  });
  const appAt = (rows: number, fake: ReturnType<typeof fakeRemote>) => (
    <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
      renderer={{ mode: "fullscreen", reason: "env_on" }} initialEntries={alphaEntries()}
      deps={{ columns: () => 80, rows: () => rows }} />
  );

  for (const rows of [24, 40]) {
    it(`keeps a permission dialog's question, every option and its Esc row on screen at ${rows} rows`, async () => {
      const fake = fakeRemote();
      const r = renderWithKeymap(appAt(rows, fake));
      await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
      await tick();
      fake.parkPermission(diffEntry());
      await waitFor(() => frameOf(r.lastFrame).includes("Edit file"));
      await settle();
      const lines = rowsOf(r.lastFrame());
      expect(lines).toHaveLength(rows - 1);
      const f = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
      expect(f).toContain("Do you want to make this edit to f.ts?");     // the question
      expect(f).toContain("1. Yes");                                     // …every option…
      expect(f).toContain("2. Yes, allow all edits during this session");
      expect(f).toContain("3. No");
      expect(f).toContain("esc cancel");                                 // …and the way out
      expect(f).toMatch(/… \+\d+ more lines/);                           // the withheld rows are NAMED
      expect(f).toContain("old 0");                                      // …and the diff still starts at its top
      r.unmount();
    });
  }

  // The plan dialog's own half of the inversion. It is a SEAM surface (T13), so its budget is the slot's, and
  // below roughly 21 rows it used to compose to a fixed eighteen whatever it was handed: the T13 review
  // measured options 2–3 gone at 18 rows and the whole option block gone at 14.
  for (const rows of [14, 18, 24]) {
    it(`keeps the plan dialog's whole option box on screen at ${rows} rows`, async () => {
      const fake = fakeRemote();
      const r = renderWithKeymap(appAt(rows, fake));
      await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
      await tick();
      fake.parkPermission(planEntry(Array.from({ length: 30 }, (_, i) => `- P${i}`).join("\n")));
      await waitFor(() => frameOf(r.lastFrame).includes("Ready to code?"));
      await settle();
      const lines = rowsOf(r.lastFrame());
      expect(lines).toHaveLength(rows - 1);
      const f = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
      expect(f).toContain("1. Yes, auto-accept edits");
      expect(f).toContain("2. Yes, manually approve edits");
      expect(f).toContain("Tell Claude what to change");
      expect(f).toMatch(/… \+\d+ more lines/);                           // …with the plan windowed, not clipped
      r.unmount();
    });
  }

  // ── STEP 3: THE TURN STAYS VISIBLE UNDER THE SEAM ──────────────────────────────────────────────────────
  // `paneOwned` blanks `pendingItems`/`streaming` out of the transcript while a surface owns the keyboard.
  // On the main screen that is a trade for dock budget; in the frame the region is a fixed virtualised band
  // the seam has ALREADY shrunk, so the blanking bought nothing and cost the only sign the turn was still
  // running — open `/model` mid-answer and the stream vanished until you closed it. Canon keeps its spinner in
  // `scrollable`, above the absolute overlay, where the overlay never occludes it (grounding §L2.6).
  const streamDelta = (text: string) => ({ kind: "message" as const, data: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } } });
  it("keeps the streaming tail in the region while a seam surface is open mid-turn", async () => {
    const fake = fakeRemote({ capabilities: () => MODELS });
    const r = renderWithKeymap(app("fullscreen", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } } });
    fake.pushEvent(streamDelta("STREAMTAIL"));
    await waitFor(() => frameOf(r.lastFrame).includes("STREAMTAIL"));
    await openModel(r);
    const lines = rowsOf(r.lastFrame());
    const rule = seamRuleAt(lines);
    expect(rule).toBeGreaterThan(0);
    expect(lines.slice(rule + 1).join("\n")).toContain("Select model");     // the picker really is up…
    expect(lines.slice(0, rule).join("\n")).toContain("STREAMTAIL");        // …and the turn is still on screen
    r.unmount();
  });

  it("still blanks the live turn behind a main-screen dialog, where the dock budget needs the rows", async () => {
    const fake = fakeRemote({ capabilities: () => MODELS });
    const r = renderWithKeymap(app("classic", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } } });
    fake.pushEvent(streamDelta("STREAMTAIL"));
    await waitFor(() => frameOf(r.lastFrame).includes("STREAMTAIL"));
    await openModel(r);
    expect(frameOf(r.lastFrame)).not.toContain("STREAMTAIL");
    r.unmount();
  });

  // ── CLASSIC IS UNTOUCHED ───────────────────────────────────────────────────────────────────────────────
  it("puts neither mechanism on the main screen", async () => {
    const fake = fakeRemote({ capabilities: () => MODELS });
    const r = renderWithKeymap(app("classic", fake));
    await waitFor(() => frameOf(r.lastFrame).includes(PROMPT));
    await tick();
    await openModel(r);
    expect(seamRuleAt(rowsOf(r.lastFrame()))).toBe(-1);               // no seam rule anywhere
    expect(r.lastFrame()).toContain("Select model");
    expect(r.lastFrame()).not.toContain(PROMPT);
    r.unmount();

    const f2 = fakeRemote();
    const c = renderWithKeymap(app("classic", f2));
    await waitFor(() => frameOf(c.lastFrame).includes(PROMPT));
    await tick();
    f2.parkPermission(permissionEntry());
    await waitFor(() => frameOf(c.lastFrame).includes("Edit file"));
    expect(seamRuleAt(rowsOf(c.lastFrame()))).toBe(-1);
    c.unmount();
  });
});
