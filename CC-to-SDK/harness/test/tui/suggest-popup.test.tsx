// F5 Task 10 — CM30 (one popup: clamped height, mid-anchored scroll, suggestion-colour selection, blank
// padding), CM36 (inline ghost text) and CM37 (inline argument hint). Keyless; Ink via ink-testing-library.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Box } from "ink";
import { applyKey, commandActive, commandArgumentHint, commandEmptyMessage, completionActive, ghostText, initialEditorState, setCommandCatalog, type EditorState } from "../../src/tui/editor.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import { catalogColumnWidth, kindLane, nameColumn, popupHeight, rowLines, scrollWindow, splitDescription, SuggestPopup, truncEnd, truncPath, truncStart, type SuggestItem } from "../../src/tui/suggestPopup.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";
import { themeTokens } from "../../src/tui/theme.js";

const type = (s: EditorState, text: string): EditorState => [...text].reduce((a, ch) => applyKey(a, ch, {}).state, s);
const key = (s: EditorState, k: Parameters<typeof applyKey>[2]): EditorState => applyKey(s, "", k).state;
const CAT: CommandEntry[] = [
  { name: "model", description: "change the model", source: "local" },
  { name: "mode", description: "cycle permission mode", source: "local" },
  { name: "review", description: "review a pull request", argumentHint: "[pr number]", source: "catalog" },
];
const open = (text: string, catalog: CommandEntry[] = CAT): EditorState => {
  const s = type(initialEditorState(), text);
  return s.command ? setCommandCatalog(s, catalog) : s;
};
const lines = (frame: string | undefined): string[] => (frame ?? "").split("\n");

// ── geometry (`DXe`, bundle L432430–L432453) ───────────────────────────────────────────────────────────
describe("CM30 geometry — DXe L432430–453", () => {
  it("visible height is max(1, min(max(6, floor(rows/2)), rows - 3)), never a fixed 8", () => {
    expect(popupHeight(24)).toBe(12);       // floor(24/2)=12, capped by 21
    expect(popupHeight(40)).toBe(20);
    expect(popupHeight(12)).toBe(6);        // max(6, 6) = 6, cap 9
    expect(popupHeight(10)).toBe(6);        // max(6, 5) = 6, cap 7
    expect(popupHeight(8)).toBe(5);         // max(6, 4) = 6, but rows - 3 = 5 wins
    expect(popupHeight(4)).toBe(1);         // rows - 3 = 1
    expect(popupHeight(2)).toBe(1);         // the max(1, …) floor
  });

  it("name column is maxColumnWidth ?? max(displayText width) + 5, and the slash catalog's override is max(name)+6", () => {
    const items: SuggestItem[] = [{ id: "cmd-model", displayText: "/model" }, { id: "cmd-x", displayText: "/x" }];
    expect(nameColumn(items)).toBe(11);                            // 6 + 5
    expect(nameColumn(items, 40)).toBe(40);
    // `k`, L490508–13 — the same arithmetic over the WHOLE catalog: `/model`.length + 5 === "model".length + 6.
    expect(catalogColumnWidth(["model", "mode", "review"])).toBe(12);
    expect(catalogColumnWidth([])).toBeUndefined();
  });

  it("a0H: a row is 2 lines only when the description overflows columns - min(nameCol, floor(columns*0.4)) - 4", () => {
    // columns 80 → min(12, 32) = 12 → budget 80 - 12 - 0 - 0 - 0 - 4 = 64.
    const short: SuggestItem = { id: "cmd-a", displayText: "/a", description: "x".repeat(64) };
    const long: SuggestItem = { id: "cmd-b", displayText: "/b", description: "x".repeat(65) };
    expect(rowLines(short, 80, 12)).toBe(1);
    expect(rowLines(long, 80, 12)).toBe(2);
    // the min() bound bites when the name column is wider than 40% of the terminal
    expect(rowLines({ id: "cmd-c", displayText: "/c", description: "x".repeat(30) }, 80, 60)).toBe(1);   // 80-32-4 = 44
    expect(rowLines({ id: "cmd-c", displayText: "/c", description: "x".repeat(45) }, 80, 60)).toBe(2);
    // no description, or a file-ish id (E_a), is always one line
    expect(rowLines({ id: "cmd-d", displayText: "/d" }, 80, 12)).toBe(1);
    expect(rowLines({ id: "file-a.ts", displayText: "a.ts", description: "x".repeat(200) }, 80, 12)).toBe(1);
  });

  it("the scroll window is MID-anchored: it walks up at most floor(d/2) lines, fills below, then backfills above", () => {
    const one = Array.from({ length: 20 }, () => 1);
    expect(scrollWindow(one, 0, 6)).toEqual({ start: 0, end: 6, rendered: 6 });
    // selection 3 with d=6: half = 3, so it walks all the way to 0 and fills to 6 — no scroll yet.
    expect(scrollWindow(one, 3, 6)).toEqual({ start: 0, end: 6, rendered: 6 });
    // selection 10: walks up 3 (the half budget) to 7, fills below to 13, backfills above to 7.
    expect(scrollWindow(one, 10, 6)).toEqual({ start: 7, end: 13, rendered: 6 });
    // the tail backfills so the window is never short
    expect(scrollWindow(one, 19, 6)).toEqual({ start: 14, end: 20, rendered: 6 });
    // a two-line row costs two of the budget in every loop
    expect(scrollWindow([2, 2, 2, 2], 0, 5)).toEqual({ start: 0, end: 2, rendered: 4 });
  });

  // The whole file-row name path had ZERO coverage before this: the t10 reviewer swapped `truncStart` for
  // `truncEnd` in `FileRow` and all 3316 tests stayed green. All three of `bLt`'s arms are pinned here, and
  // the row that uses it is pinned below.
  it("bLt (L106938-49) MIDDLE-elides a path, keeping the whole basename", () => {
    expect(truncPath("src/tui/suggestPopup.tsx", 40)).toBe("src/tui/suggestPopup.tsx");   // fits, untouched
    // budget 20: basename `/suggestPopup.tsx` is 17 wide, so the parent gets `20 - 1 - 17 = 2` columns.
    expect(truncPath("src/tui/suggestPopup.tsx", 20)).toBe("sr…/suggestPopup.tsx");
    // budget 16: basename `/name.ts` is 8, parent gets 7 → `MNe("a/b/c/d/e/f/g", 7)`.
    expect(truncPath("a/b/c/d/e/f/g/name.ts", 16)).toBe("a/b/c/d…/name.ts");
    // the invariant the whole function exists for, on both:
    expect(truncPath("src/tui/suggestPopup.tsx", 20)).toContain("/suggestPopup.tsx");
    expect(truncPath("a/b/c/d/e/f/g/name.ts", 16)).toContain("/name.ts");
    expect(truncPath("a/b/c/d/e/f/g/name.ts", 16).length).toBe(16);
  });
  it("bLt falls back to xG when the basename alone overflows, and to gi under a 5-column budget", () => {
    // `if (i >= t - 1) return xG(e, t)` — no middle left to elide, so left-elide the whole thing.
    expect(truncPath("src/aVeryLongFileNameIndeed.ts", 12)).toBe(truncStart("src/aVeryLongFileNameIndeed.ts", 12));
    expect(truncPath("src/aVeryLongFileNameIndeed.ts", 12).startsWith("…")).toBe(true);
    // `if (t < 5) return gi(e, t)` — right-elide.
    expect(truncPath("src/app.ts", 4)).toBe(truncEnd("src/app.ts", 4));
    expect(truncPath("src/app.ts", 4)).toBe("src…");
    expect(truncPath("src/app.ts", 0)).toBe("…");
    // a name with no slash at all takes the basename branch with an empty parent → xG
    expect(truncPath("averylongsinglename.ts", 10)).toBe(truncStart("averylongsinglename.ts", 10));
  });

  it("W7p splits a description at a space and hands back the remainder that makes the second line", () => {
    expect(splitDescription("short", 20)).toEqual(["short", ""]);
    expect(splitDescription("one two three four", 8)).toEqual(["one two", "three four"]);
    expect(splitDescription("unbreakablelongword", 5)).toEqual(["unbre", "akablelongword"]);
  });
});

// ── the component ──────────────────────────────────────────────────────────────────────────────────────
describe("CM30 rendering — SuggestPopup", () => {
  const items: SuggestItem[] = [
    { id: "cmd-model", displayText: "/model", description: "change the model" },
    { id: "cmd-mode", displayText: "/mode", description: "cycle permission mode" },
    { id: "cmd-review", displayText: "/review", description: "review a pull request" },
  ];

  it("rows=24 → the popup region is exactly 12 lines with a 3-item list (9 of them blank padding)", () => {
    const { lastFrame } = render(<SuggestPopup items={items} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    expect(lines(lastFrame()).length).toBe(popupHeight(24));
    expect(lines(lastFrame()).length).toBe(12);
  });

  it("the height does NOT change as the list shrinks — the composer above it cannot jump", () => {
    const one = render(<SuggestPopup items={items.slice(0, 1)} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    const three = render(<SuggestPopup items={items} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    expect(lines(one.lastFrame()).length).toBe(lines(three.lastFrame()).length);
  });

  it("a list longer than the height renders exactly the height, no padding", () => {
    const many: SuggestItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `cmd-c${i}`, displayText: `/c${i}` }));
    const { lastFrame } = render(<SuggestPopup items={many} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    expect(lines(lastFrame()).length).toBe(12);
    expect(lastFrame()).toContain("/c0");
    expect(lastFrame()).toContain("/c11");
    expect(lastFrame()).not.toContain("/c12");
  });

  // ── the OVERLAY arms (FSW T14 fix round) — `DXe`'s `o`/`i`, which only `rCn` passes (L456226) ────────────
  // `d = o ? s0H : …` (L432431, `s0H = 5` at L432478) and `w = i ? 0 : Math.max(0, d − E)` (L432446). Canon
  // uses them for a palette floating at `bottom:"100%"`; the port uses them for one sitting in the flow above
  // the dock, where every padded row is a row of transcript.
  it("overlay+noPad: the popup is exactly as tall as the rows it drew, whatever the pane", () => {
    for (const rows of [24, 40, 12]) {
      const one = render(<SuggestPopup items={items.slice(0, 1)} selected={0} columns={80} rows={rows} maxColumnWidth={12} overlay noPad />);
      expect(lines(one.lastFrame()).length).toBe(1);
      const three = render(<SuggestPopup items={items} selected={0} columns={80} rows={rows} maxColumnWidth={12} overlay noPad />);
      expect(lines(three.lastFrame()).length).toBe(3);
    }
  });

  it("overlay windows a long list to canon's FIVE rows at every pane height", () => {
    const many: SuggestItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `cmd-c${i}`, displayText: `/c${i}` }));
    for (const rows of [24, 40, 12]) {
      const { lastFrame } = render(<SuggestPopup items={many} selected={0} columns={80} rows={rows} maxColumnWidth={12} overlay noPad />);
      expect(lines(lastFrame()).length).toBe(5);
      expect(lastFrame()).toContain("/c4");
      expect(lastFrame()).not.toContain("/c5");
    }
  });

  it("overlay+noPad: an empty list with a message is ONE row, not a padded region", () => {
    const { lastFrame } = render(<SuggestPopup items={[]} selected={0} columns={80} rows={24} emptyMessage="no matches" overlay noPad />);
    expect(lines(lastFrame()).length).toBe(1);
    expect(lastFrame()).toContain("no matches");
  });

  it("the INLINE arm is untouched — no props, canon's padded `popupHeight` region", () => {
    const one = render(<SuggestPopup items={items.slice(0, 1)} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    expect(lines(one.lastFrame()).length).toBe(popupHeight(24));
    const empty = render(<SuggestPopup items={[]} selected={0} columns={80} rows={24} emptyMessage="no matches" />);
    expect(lines(empty.lastFrame()).length).toBe(popupHeight(24));
  });

  it("the selected row carries the `suggestion` colour SGR and NO inverse; unselected rows are dim", () => {
    const { lastFrame } = render(<SuggestPopup items={items} selected={1} columns={80} rows={24} maxColumnWidth={12} />);
    const out = lastFrame() ?? "";
    const body = lines(out).filter((l) => l.trim().length > 0);
    const [modelRow, modeRow] = body;                              // list order, not a substring search
    expect(modeRow).toContain("/mode ");
    expect(modeRow).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);            // truecolor — the `suggestion` token
    expect(out).not.toContain("\x1b[7m");                          // `inverse` is gone from the popup entirely
    expect(modelRow).toContain("/model");
    expect(modelRow).toContain("\x1b[2m");                         // dimColor
    expect(modelRow).not.toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it("an overflowing description wraps onto a second, name-column-indented line", () => {
    const wide: SuggestItem[] = [{ id: "cmd-a", displayText: "/a", description: "w".repeat(30) + " " + "z".repeat(30) }];
    const { lastFrame } = render(<SuggestPopup items={wide} selected={0} columns={60} rows={24} maxColumnWidth={12} />);
    const body = lines(lastFrame()).filter((l) => l.includes("w") || l.includes("z"));
    expect(body.length).toBe(2);
    expect(body[1]).toContain("z".repeat(30));
  });

  it("an empty list with a message renders the message plus d-1 blanks; with no message it renders nothing", () => {
    const withMsg = render(<SuggestPopup items={[]} selected={-1} columns={80} rows={24} emptyMessage={'No commands match "/zz"'} />);
    expect(withMsg.lastFrame()).toContain('No commands match "/zz"');
    expect(lines(withMsg.lastFrame()).length).toBe(12);
    const without = render(<SuggestPopup items={[]} selected={-1} columns={80} rows={24} />);
    expect((without.lastFrame() ?? "").trim()).toBe("");
  });

  it("a file-ish row is the icon lane, and only a DESCRIBED one gets q7p's en-dash (L432530)", () => {
    const files: SuggestItem[] = [
      { id: "file-src/app.ts", displayText: "src/app.ts" },
      { id: "file-README.md", displayText: "README.md", description: "the readme" },
    ];
    const { lastFrame } = render(<SuggestPopup items={files} selected={0} columns={80} rows={24} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("+ src/app.ts");
    expect(out).toContain("+ README.md – the readme");
    expect(out).not.toContain("src/app.ts –");
  });

  it("an overlong file row middle-elides through bLt (L432510), keeping the basename — not xG's left-elide", () => {
    const deep = "packages/harness/src/tui/components/composer/suggestPopup.tsx";
    const files: SuggestItem[] = [{ id: `file-${deep}`, displayText: deep }];
    const { lastFrame } = render(<SuggestPopup items={files} selected={0} columns={40} rows={24} />);
    const row = lines(lastFrame()).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).find((l) => l.includes("suggestPopup")) ?? "";
    expect(row).toContain("/suggestPopup.tsx");                    // the basename survives
    expect(row).toContain("packages");                             // …and so does the head of the parent
    expect(row).toContain("…");
    expect(row.trimStart().startsWith("+ …")).toBe(false);         // xG would have produced exactly this
  });
});

// ── T-X4T: query-substring highlight — `T_r`/`FIh`, bundle L536230–536285 (2.1.236, NOT 2.1.220's recolor) ─
// Command rows only (`GeneralRow`); `FileRow` never receives a `query` and is untouched — see the file-ish
// tests just above, which set no `query` and still pass unmodified after this feature ships.
const strip = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const BOLD = /\x1b\[1m([^\x1b]*)\x1b\[22m/g;
/** every bold-wrapped run in `s`, in order — lets a test assert exactly which characters got the `\x1b[1m`
 *  treatment without caring about the dim/color SGR around them. */
const boldRuns = (s: string): string[] => [...s.matchAll(BOLD)].map((m) => m[1]!);

describe("T-X4T query highlight — T_r/FIh (L536230–536285)", () => {
  it("a contiguous hit on the NAME column bolds exactly the matched span, nothing else", () => {
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request", query: "revi" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    const raw = lastFrame() ?? "";
    // the name column bolds "revi" (the leading "/" is not part of the query and stays unbolded, per canon's
    // own offset note in the research report).
    expect(boldRuns(raw)).toContain("revi");
    expect(strip(raw)).toContain("/review");
  });

  it("the NAME column falls back to fuzzy subsequence matching when there is no contiguous hit", () => {
    // "rvw" is not a substring of "review", so a contiguousOnly implementation would find nothing; the fuzzy
    // walk finds r@0, v@3, w@5 as three separate one-character runs.
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", query: "rvw" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    const raw = lastFrame() ?? "";
    expect(boldRuns(raw)).toEqual(["r", "v", "w"]);
  });

  it("the DESCRIPTION lanes are contiguousOnly — a query that only fuzzy-matches leaves the WHOLE row plain", () => {
    // "rprq" is a subsequence of "review a pull request" (r@0, p@9, r@14, q@16 — the fuzzy walk WOULD find it)
    // but not a contiguous substring, so contiguousOnly on the description must refuse it. It is also not a
    // subsequence of the name "/review" at all (no "p"/"q" there), so the name lane is plain independently —
    // this test's job is specifically the description's refusal, not the name's ordinary miss.
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request", query: "rprq" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    const raw = lastFrame() ?? "";
    // name: no match at all ("rprq" is not a subsequence of "review") → plain.
    // description: contiguousOnly refuses the fuzzy subsequence that WOULD have matched → plain too.
    expect(boldRuns(raw)).toEqual([]);
  });

  it("a query that IS a contiguous substring of the description highlights there, contiguousOnly and all", () => {
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request", query: "pull" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    const raw = lastFrame() ?? "";
    expect(boldRuns(raw)).toEqual(["pull"]);
  });

  it("ANY unmatched query character paints the WHOLE row plain — no partial highlight survives", () => {
    // "z" appears nowhere in "/review" or its description: FIh returns [] for both lanes, so there must be
    // ZERO bold SGR anywhere in the frame, not a partial highlight of the characters that did match before "z".
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request", query: "revz" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    expect(boldRuns(lastFrame() ?? "")).toEqual([]);
  });

  it("survives selection: the SELECTED row keeps its suggestion-colour SGR AND gains bold on the match — the L173 pin is unmodified by this feature", () => {
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request", query: "revi" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    const raw = lastFrame() ?? "";
    expect(raw).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);                  // the suggestion truecolor token, unchanged
    expect(raw).not.toContain("\x1b[7m");                            // still no inverse
    expect(boldRuns(raw)).toContain("revi");                         // …and the match is bold on top of it
  });

  it("no query on the item → identical output to before this feature (no bold anywhere)", () => {
    const items: SuggestItem[] = [{ id: "cmd-review", displayText: "/review", description: "review a pull request" }];
    const { lastFrame } = render(<SuggestPopup items={items} selected={-1} columns={80} rows={24} maxColumnWidth={12} />);
    expect(boldRuns(lastFrame() ?? "")).toEqual([]);
  });

  it("a file-ish row ignores `query` entirely — canon's own gate (`vql`/`E_a`), not a case ccx invents", () => {
    const files: SuggestItem[] = [{ id: "file-src/app.ts", displayText: "src/app.ts", query: "app" }];
    const { lastFrame } = render(<SuggestPopup items={files} selected={-1} columns={80} rows={24} />);
    expect(boldRuns(lastFrame() ?? "")).toEqual([]);
  });
});

// ── DG55: the kind lane, COMMAND ROWS ONLY (`S_a` L432454, colours L432563) ─────────────────────────────
describe("DG55 kind lane — S_a (L432454)", () => {
  it("S_a: undefined → NO lane; action → seven BLANK columns; info → 'config'; every other kind padded to 7", () => {
    expect(kindLane(undefined).text).toBe("");                       // `e.kind === void 0 ? "" : …`
    expect(kindLane(undefined).label).toBe("");
    expect(kindLane("action").text).toBe(" ".repeat(7));             // label "" → seven columns of padding
    expect(kindLane("action").label).toBe("");
    expect(kindLane("info").label).toBe("config");                   // `e.kind === "info" ? "config" : e.kind`
    expect(kindLane("info").text).toBe("config ");
    expect(kindLane("config").text).toBe("config ");
    expect(kindLane("skill").text).toBe("skill  ");
    expect(kindLane("agent").text).toBe("agent  ");
    // the point of the lane: every DEFINED kind occupies exactly 7 columns, so the description lane lines up
    for (const k of ["skill", "config", "action", "info", "agent"] as const) expect(kindLane(k).text.length).toBe(7);
  });
  it("the lane's colour (L432563) is a ROLE: skill → `skill`, agent → `background`, everything else dim", () => {
    expect(kindLane("skill").role).toBe("skill");
    expect(kindLane("agent").role).toBe("background");
    expect(kindLane("config").role).toBeUndefined();
    expect(kindLane("info").role).toBeUndefined();
    expect(kindLane("action").role).toBeUndefined();
    expect(kindLane(undefined).role).toBeUndefined();
  });

  it("a0H's kind subtrahend is real once a row carries one: the description budget loses the 7 columns", () => {
    // columns 80, nameCol 12 → without a kind the budget is 80 - 12 - 4 = 64 (pinned above); with one, 57.
    const desc = (n: number) => "x".repeat(n);
    expect(rowLines({ id: "cmd-a", displayText: "/a", description: desc(57), kind: "config" }, 80, 12)).toBe(1);
    expect(rowLines({ id: "cmd-a", displayText: "/a", description: desc(58), kind: "config" }, 80, 12)).toBe(2);
    // `action` costs the same 7 columns even though it prints nothing — the lane is blank, not absent
    expect(rowLines({ id: "cmd-a", displayText: "/a", description: desc(58), kind: "action" }, 80, 12)).toBe(2);
    expect(rowLines({ id: "cmd-a", displayText: "/a", description: desc(58) }, 80, 12)).toBe(1);      // no kind, no cost
  });

  const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  const rowFor = (frame: string | undefined, needle: string) => lines(plain(frame)).find((l) => l.includes(needle)) ?? "";

  it("the lane sits between the name pad and the description, and a kindless row has none at all", () => {
    const withKind: SuggestItem[] = [
      { id: "cmd-model", displayText: "/model", description: "change the model", kind: "config" },
      { id: "cmd-compact", displayText: "/compact", description: "compact the context", kind: "action" },
      { id: "cmd-context", displayText: "/context", description: "context usage", kind: "info" },
    ];
    const a = render(<SuggestPopup items={withKind} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    // nameCol 12: `/model` + 6 pad, then the 7-column lane, then the description.
    expect(rowFor(a.lastFrame(), "/model")).toContain("/model      config change the model");
    expect(rowFor(a.lastFrame(), "/compact")).toContain("/compact           compact the context");   // 4 pad + 7 blanks
    expect(rowFor(a.lastFrame(), "/context")).toContain("/context    config context usage");         // `info` prints `config`
    // the same rows without a kind: the description butts straight up against the name pad
    const b = render(<SuggestPopup items={withKind.map(({ kind, ...r }) => r)} selected={0} columns={80} rows={24} maxColumnWidth={12} />);
    expect(rowFor(b.lastFrame(), "/model")).toContain("/model      change the model");
    expect(rowFor(b.lastFrame(), "/compact")).toContain("/compact    compact the context");
  });

  it("SsI's kind term (L432540): a DESCRIPTION-LESS row with a kind still caps its name lane at 40%", () => {
    // Reachable, not theoretical: `toCatalogEntry` gives a catalog command with no description
    // `description: ""` — falsy — so a kinded row with no description is an ordinary live row.
    const bare: SuggestItem[] = [{ id: "cmd-x", displayText: "/x", kind: "config" }];
    const { lastFrame } = render(<SuggestPopup items={bare} selected={0} columns={80} rows={24} maxColumnWidth={60} />);
    // `description || tag || kind !== void 0 || sourceTag ? floor(80*0.4) : 80 - 4` — the kind term makes the
    // 40% cap win over the 60-column name lane, so the lane opens at paddingX 2 + 32 and not at 2 + 60.
    expect(rowFor(lastFrame(), "/x").indexOf("config")).toBe(34);
  });

  it("skill and agent rows carry their theme ROLE colour on the lane; a config lane is dim", () => {
    const sgr = (token: string) => { const m = token.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)!; return `\x1b[38;2;${m[1]};${m[2]};${m[3]}m`; };
    const items: SuggestItem[] = [
      { id: "cmd-brainstorming", displayText: "/brainstorming", description: "a skill", kind: "skill" },
      { id: "cmd-tasks", displayText: "/tasks", description: "an agent", kind: "agent" },
      { id: "cmd-model", displayText: "/model", description: "a control", kind: "config" },
    ];
    // selected: 2 — the CONFIG row — so neither coloured lane can be borrowing the `suggestion` colour.
    const { lastFrame } = render(<SuggestPopup items={items} selected={2} columns={80} rows={24} maxColumnWidth={16} />);
    const raw = lines(lastFrame() ?? "");
    const rawRow = (needle: string) => raw.find((l) => plain(l).includes(needle)) ?? "";
    expect(rawRow("/brainstorming")).toContain(sgr(themeTokens().skill));
    expect(rawRow("/tasks")).toContain(sgr(themeTokens().background));
    expect(rawRow("/model")).toContain("\x1b[2m");                    // `dimColor: GTr === void 0`
    expect(rawRow("/model")).not.toContain(sgr(themeTokens().skill));
  });

  it("the wrapped second line is indented past the kind lane too (Nzo = RRe + y_a + H_a)", () => {
    const wide: SuggestItem[] = [{ id: "cmd-a", displayText: "/a", description: "w".repeat(30) + " " + "z".repeat(20), kind: "config" }];
    const { lastFrame } = render(<SuggestPopup items={wide} selected={0} columns={60} rows={24} maxColumnWidth={12} />);
    const body = lines(plain(lastFrame())).filter((l) => l.includes("w") || l.includes("z"));
    expect(body.length).toBe(2);
    // paddingX 2 + nameCol 12 + the 7-column lane = 21 columns of indent before the continuation.
    expect(body[1]).toBe(" ".repeat(21) + "z".repeat(20));
  });

  it("FILE rows ignore a kind entirely — E_a's branch never reaches S_a (L432489)", () => {
    const files: SuggestItem[] = [{ id: "file-src/app.ts", displayText: "src/app.ts", kind: "skill" } as SuggestItem];
    const { lastFrame } = render(<SuggestPopup items={files} selected={0} columns={80} rows={24} />);
    expect(plain(lastFrame())).toContain("+ src/app.ts");
    expect(plain(lastFrame())).not.toContain("skill");
    expect(rowLines({ id: "file-a.ts", displayText: "a.ts", description: "x".repeat(200), kind: "skill" }, 80, 12)).toBe(1);
  });
});

// ── CM36 ghost text ────────────────────────────────────────────────────────────────────────────────────
describe("CM36 inline ghost text", () => {
  it("a mid-text `/` produces GHOST TEXT and no popup — Be's first branch clears suggestions and returns (L490617-25)", () => {
    const s = open("see /revi");
    expect(s.command).not.toBeNull();
    expect(s.command!.head).toBe(false);
    expect(commandActive(s)).toBe(false);                          // no list → nothing to draw, nothing to nav
    expect(ghostText(s)).toEqual({ span: { row: 0, start: 4, end: 9 }, suffix: "ew", fullCommand: "review", visible: true });
  });

  it("the head arm keeps the popup and produces no ghost", () => {
    const s = open("/revi");
    expect(s.command!.head).toBe(true);
    expect(commandActive(s)).toBe(true);
    expect(ghostText(s)).toBeNull();
  });

  it("zJa picks the first RANKED entry that is a PREFIX of the query, not the top fuzzy hit (L489949)", () => {
    expect(ghostText(open("see /rev"))!.fullCommand).toBe("review");
    expect(ghostText(open("see /vew"))).toBeNull();                   // ranks /review, but it is no prefix
    // Both `/mode` and `/model` are prefixes of `mod`; the SHORTER one wins on both sides — ours by
    // fileComplete's `a.path.length - b.path.length`, upstream by `w - k` over prefix lengths (L490060).
    expect(ghostText(open("see /mod"))!.fullCommand).toBe("mode");
  });

  it("no ghost when the completion is empty (the token IS the command) — zJa's `if (s)` guard", () => {
    expect(ghostText(open("see /model"))).toBeNull();
  });

  it("`visible` is upstream's RENDER gate only — caret at the end of the buffer (L395860 / L394780) — and Tab accepts either way", () => {
    let s = open("see /revi");
    expect(ghostText(s)!.visible).toBe(true);
    // A caret motion INSIDE the token keeps the trigger alive (the query is the whole token, past the caret —
    // t9's finding (d)), so the ghost still exists; `insertPosition === M` is what turns the drawing off.
    s = key(s, { leftArrow: true });
    expect(ghostText(s)!.visible).toBe(false);
    // Caret past the token entirely: no trigger, no ghost. Walking back into it reopens one that is still
    // not drawn, because the caret is no longer at the end of the buffer.
    let t = type(initialEditorState(), "see /revi end");
    expect(t.command).toBeNull();
    for (let i = 0; i < 4; i++) t = key(t, { leftArrow: true });
    t = setCommandCatalog(t, CAT);
    expect(t.command?.head).toBe(false);
    expect(ghostText(t)!.visible).toBe(false);                       // not drawn — `isAtEnd()` is false
    expect(completionActive(t)).toBe(true);                          // but `Lt` reads the UNGATED memo
  });

  it("Tab accepts the ghost — upstream's tab branch returns early when Y exists (L491091-92) and hands the key to autocomplete:accept (co() L491073) → Pe's ghost arm (L490840, splice L490847)", () => {
    const s = open("see /revi");
    const r = applyKey(s, "", { tab: true });
    expect(r.submit).toBeUndefined();                                // Pe's ghost arm has no onSubmit
    expect(r.state.lines).toEqual(["see /review "]);
    expect(r.state.cursor).toEqual({ row: 0, col: 12 });             // startPos + 1 + fullCommand.length + 1
    expect(r.state.command).toBeNull();
  });

  it("the ghost accept splices the SPAN, keeping the tail — and Enter with a ghost submits instead (L491101)", () => {
    let s = type(initialEditorState(), "see /revi end");
    for (let i = 0; i < 4; i++) s = key(s, { leftArrow: true });     // caret at the end of `/revi`
    s = setCommandCatalog(s, CAT);
    expect(s.command?.head).toBe(false);
    const tab = applyKey(s, "", { tab: true });
    expect(tab.state.lines).toEqual(["see /review  end"]);           // span replaced, ` end` intact
    const ret = applyKey(s, "", { return: true });
    expect(ret.submit).toBe("see /revi end");                        // `if (c.length === 0) return` — no intercept
  });

  it("the Autocomplete scope follows upstream's Lt = c.length > 0 || !!Y (L491072): ghost alone activates it", () => {
    const s = open("see /revi");
    expect(commandActive(s)).toBe(false);
    expect(commandEmptyMessage(s)).toBeNull();
    expect(completionActive(s)).toBe(true);                          // the ghost term
    const dismissed = applyKey(s, "", { escape: true }).state;
    expect(ghostText(dismissed)).toBeNull();
    expect(completionActive(dismissed)).toBe(false);
  });

  it("CM38's empty message is head-only — a mid-text miss draws nothing and holds nothing", () => {
    const s = open("see /zzz");
    expect(s.command?.head).toBe(false);
    expect(commandEmptyMessage(s)).toBeNull();
    expect(completionActive(s)).toBe(false);
  });
});

// ── CM37 argument hint ─────────────────────────────────────────────────────────────────────────────────
describe("CM37 inline argument hint (L490749-62 model, L396283 render)", () => {
  it("fires only when a resolvable command is followed by a trailing space that is the LAST character (`De`)", () => {
    expect(commandArgumentHint("/review ", CAT)).toBe("[pr number]");
    expect(commandArgumentHint("/review", CAT)).toBeNull();          // no space yet
    expect(commandArgumentHint("/review 42", CAT)).toBeNull();       // the argument is being typed
    expect(commandArgumentHint("/review  ", CAT)).toBeNull();        // `mt.length === Nn + 1` fails
    expect(commandArgumentHint("/model ", CAT)).toBeNull();          // resolvable, but declares no hint
    expect(commandArgumentHint("/nope ", CAT)).toBeNull();           // unresolvable
    expect(commandArgumentHint("see /review ", CAT)).toBeNull();     // YRr needs a LEADING slash
    expect(commandArgumentHint("/re view ", CAT)).toBeNull();
    expect(commandArgumentHint("/review\nx ", CAT)).toBeNull();      // KJa's class rejects \n
  });

  it("accepting a command from the popup lands directly on the hint (the accept inserts `/name `)", () => {
    const s = open("/rev");
    const accepted = applyKey(s, "", { tab: true }).state;
    expect(accepted.lines).toEqual(["/review "]);
    expect(accepted.command).toBeNull();                              // the popup is gone
    expect(commandArgumentHint(accepted.lines.join("\n"), CAT)).toBe("[pr number]");
  });
});

// ── end to end through the real composer ───────────────────────────────────────────────────────────────
const wrap = (node: React.ReactNode) => <KeymapProvider><Box flexDirection="column">{node}</Box></KeymapProvider>;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("through ChatComposer", () => {
  it("`/revi` opens the popup; `see /revi` shows dim ghost text and no popup rows", async () => {
    const a = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    a.stdin.write("/revi");
    await tick();
    // T-X4T: the live query is now highlighted (`\x1b[1mrevi\x1b[22m` inside both the name and the
    // description), so a RAW-frame `toContain` on the full un-split string would fail — strip SGR first, per
    // the brief (fix the assert, don't weaken the feature).
    expect(strip(a.lastFrame())).toContain("/review");
    expect(strip(a.lastFrame())).toContain("review a pull request");

    const b = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    b.stdin.write("see /revi");
    await tick();
    const out = b.lastFrame() ?? "";
    expect(out).toContain("see /revi");
    expect(out).not.toContain("review a pull request");               // no popup row
    // CM36's cursor rule: `e` inverted (the ghost's first grapheme), then the remainder dim.
    expect(out).toContain("\x1b[7me\x1b[27m");
    expect(out).toContain("\x1b[2mw\x1b[22m");
  });

  it("Tab on the ghost completes without submitting", async () => {
    let submitted: string | null = null;
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={(t) => { submitted = t; }} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("see /revi");
    await tick();
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("see /review");
    expect(submitted).toBeNull();
  });

  it("the ghost is NOT drawn with the caret away from the end of the buffer, even though the model still has one", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("see /revi end");
    await tick();
    for (let i = 0; i < 4; i++) stdin.write("\x1b[D");               // caret back to the end of `/revi`
    await tick();
    const plain = (lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("see /revi end");                        // the buffer as typed
    expect(plain).not.toContain("see /review");                      // `isAtEnd()` is false → nothing drawn
  });

  // I2 (t10 review), RESTATED BY WAVE C TASK 2. The subject is unchanged — a mid-text `/` that draws nothing
  // must cost the frame nothing — but the evidence moved. Upstream's `Ptl` branch (L494609) returns the
  // suggestion box INSTEAD of the whole below-composer block, so its footer row and the popup alternate;
  // this port's footer row lives in `ChatApp` (`Footer.tsx`, and the three dialog budgets that count it as
  // their one unconditional sibling), and it does NOT alternate — a drawn popup is drawn ABOVE it.
  // RECORDED DIVERGENCE, deliberate: implementing the alternation would mean the popup's appearance and the
  // footer's disappearance landing in two different flushes (the composer reports its state up through an
  // effect), i.e. trading one honest extra row for a two-step layout jump. So these cases assert the
  // property that actually matters and that the old `⏎ send` needle was standing in for: FRAME HEIGHT.
  const lineCount = (f: string | undefined) => lines(f).length;
  it("a mid-text `/` that draws nothing costs the frame nothing (Ptl, L494604)", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    const before = lineCount(lastFrame());
    stdin.write("see /zzz");
    await tick();
    expect(lineCount(lastFrame())).toBe(before);
    expect(lastFrame()).not.toContain("No commands match");        // head-only; nothing is drawn here
  });

  it("the frame height is stable across `see zzz` → `see /zzz` → a visible ghost", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("see zzz");
    await tick();
    const plain = () => lines(lastFrame()).length;
    const noTrigger = plain();
    for (let i = 0; i < 3; i++) stdin.write("\x7f");                // backspace to `see `
    stdin.write("/zzz");
    await tick();
    expect(plain()).toBe(noTrigger);                                // mid-text miss: nothing gained, nothing lost
    for (let i = 0; i < 3; i++) stdin.write("\x7f");
    stdin.write("revi");                                            // `see /revi` → a visible ghost
    await tick();
    expect(plain()).toBe(noTrigger);
  });

  it("a head `/` that DOES draw adds the popup rows", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    const before = lineCount(lastFrame());
    stdin.write("/revi");
    await tick();
    // T-X4T: same SGR-stripping fix as the test above — the query highlight now splits "/review" into
    // separate un-bold/bold/un-bold `<Text>` spans in the raw frame.
    expect(strip(lastFrame())).toContain("/review");
    expect(lineCount(lastFrame())).toBeGreaterThan(before);
  });

  it("T-X4T wiring: `/revi` bolds the matched span through the REAL chain, and a CAPITALIZED query still matches (the lowercase trap)", async () => {
    // Drives the real chain end to end — editor → completionTriggers → completions → ChatComposer's
    // suggestProps → SuggestPopup — rather than mounting the popup with hand-built items. This is the test
    // that would catch a regression at ANY of those seams, including the specific trap the brief calls out:
    // `state.command.query` (`completionTriggers.ts` L60) is the RAW, un-lowered trigger text, so a
    // suggestProps that forgot to lowercase it before handing it to `matchRanges` would silently produce zero
    // highlights for this exact keystroke sequence.
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("/REVI");
    await tick();
    const raw = lastFrame() ?? "";
    expect(strip(raw)).toContain("/review");                          // ranking is case-insensitive already
    expect(raw).toContain("\x1b[1mrevi\x1b[22m");                     // …and now so is the highlight
  });

  // DG55: the lane only exists because the SLASH source feeds a kind (`VJa`, L490007), and `VJa` feeds one
  // only when the menu-kind-lanes flag is on. The composer is the one place our three sources meet AND the
  // one place that gate lives, so both arms of it are pinned here.
  const popupOf = async (env?: NodeJS.ProcessEnv) => {
    const a = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} historyEnv={env} />));
    await tick();
    a.stdin.write("/");
    await tick();
    return (a.lastFrame() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  };

  it("DEFAULT: no lane on any row — the installed 2.1.220 caches tengu_mint_lanes:false, so this is canon", async () => {
    const out = await popupOf();
    expect(out).toMatch(/\/model\s+change the model/);
    expect(out).not.toContain("config");
    expect(out).not.toContain("skill");
    // and the description starts exactly where F5 put it: nameCol is catalogColumnWidth(["model","mode","review"]) = 12
    expect(lines(out).find((l) => l.includes("/model"))).toBe("  /model      change the model");
  });

  it("CLAUDE_CODE_ENABLE_MENU_KIND_LANES: every command row gains p9f's kind", async () => {
    const out = await popupOf({ ...process.env, CLAUDE_CODE_ENABLE_MENU_KIND_LANES: "1" });
    expect(out).toMatch(/\/model\s+config change the model/);          // ZLb: model → config
    expect(out).toMatch(/\/mode\s{8,}cycle permission mode/);          // not in ZLb → action → seven blanks
    expect(out).toMatch(/\/review\s+skill\s+review a pull request/);   // a catalog entry is a prompt command
  });

  it("`/review ` shows the argument hint inline and dim", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("/review ");
    await tick();
    const out = lastFrame() ?? "";
    expect(out).toContain("[pr number]");
    expect(out).toContain("\x1b[2m[pr number]\x1b[22m");
  });
});
