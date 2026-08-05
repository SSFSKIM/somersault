// F5 Task 10 — CM30 (one popup: clamped height, mid-anchored scroll, suggestion-colour selection, blank
// padding), CM36 (inline ghost text) and CM37 (inline argument hint). Keyless; Ink via ink-testing-library.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Box } from "ink";
import { applyKey, commandActive, commandArgumentHint, commandEmptyMessage, completionActive, ghostText, initialEditorState, setCommandCatalog, type EditorState } from "../../src/tui/editor.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import { catalogColumnWidth, nameColumn, popupHeight, rowLines, scrollWindow, splitDescription, SuggestPopup, truncEnd, truncPath, truncStart, type SuggestItem } from "../../src/tui/suggestPopup.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";

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
    expect(a.lastFrame()).toContain("/review");
    expect(a.lastFrame()).toContain("review a pull request");

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

  // I2 (t10 review). The footer and the suggestion region are alternatives sharing one slot (`Ptl`,
  // bundle L494604), so the footer must go only when something is actually DRAWN. Keying it off the raw
  // presence of `state.command` meant a mid-text `/zzz` that matches nothing — or any visible ghost — took
  // two rows away and put nothing in their place.
  const FOOTER = "⏎ send";
  it("the composer footer survives a mid-text `/` that draws nothing (Ptl, L494604)", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("see /zzz");
    await tick();
    expect(lastFrame()).toContain(FOOTER);
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
    expect(lastFrame()).toContain(FOOTER);
    expect(plain()).toBe(noTrigger);
  });

  it("a head `/` that DOES draw takes the footer's slot, as upstream's Ptl branch does", async () => {
    const { stdin, lastFrame } = render(wrap(<ChatComposer onSubmit={() => {}} cwd="/tmp" commandCatalog={CAT} />));
    await tick();
    stdin.write("/revi");
    await tick();
    expect(lastFrame()).toContain("/review");
    expect(lastFrame()).not.toContain(FOOTER);
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
