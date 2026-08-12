// test/tui/composer-frame.test.tsx — F5 Task 2: the composer's visual form.
//  · CM1  (L496235) two full-width `─` rules, no verticals, no corners
//  · label (L496126) ` ${dim(label)} ` splices into the TOP rule at offset 2, dashes NOT dim
//  · CM2  (L494733/L494745) `❯\xA0` / `!\xA0`, dim while a turn runs
//  · CM5  (L395963) empty buffer → placeholder's first char inverted, remainder dim
//  · CM20 (L433221) the `Z_a` newline-hint ladder
//  · CM8  (L496237) an external edit in flight replaces the whole composer with one italic dim literal
import React from "react";
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { renderWithKeymap } from "./keysTestUtil.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { ComposerWithFooter } from "./helpers/composerFooter.js";
import { ComposerFrame, PlaceholderCursor, promptGlyph, borderTokenFor, newlineHint, EDITOR_IN_FLIGHT_TEXT, NBSP, POINTER } from "../../src/tui/composerFrame.js";
import { setTheme, themeTokens, resolveThemeColor } from "../../src/tui/theme.js";

// F5 Task 5 gave ChatComposer a real side effect on a chip: it writes the payload to the 0600 paste cache
// under `fleetRoot()`. The paste tests at the bottom of this file mint chips, so this file has to own a
// fleet root or they write into the developer's actual ~/.claude/ccx.
let fleetRootDir = "";
let priorFleetRoot: string | undefined;
beforeAll(() => { priorFleetRoot = process.env.CCX_FLEET_ROOT; fleetRootDir = mkdtempSync(join(tmpdir(), "ccx-cf-")); process.env.CCX_FLEET_ROOT = fleetRootDir; });
afterAll(() => { if (priorFleetRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = priorFleetRoot; rmSync(fleetRootDir, { recursive: true, force: true }); });

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (p: () => boolean, ms = 2000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};
/** The composer glyph is `❯` + NBSP; the transcript's user echo is `❯` + a normal space, so the NBSP is
 *  what tells "the composer is mounted" apart from "a prompt is on screen". */
const GLYPH = POINTER + NBSP;

describe("ComposerFrame (CM1): two rules, no box", () => {
  it("draws two full-width `─` runs and no border characters at all", () => {
    const { lastFrame } = render(<ComposerFrame columns={40}><React.Fragment /></ComposerFrame>);
    const lines = strip(frame(lastFrame)).split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe("─".repeat(40));
    expect(lines[lines.length - 1]).toBe("─".repeat(40));
    for (const ch of ["│", "╭", "╮", "╰", "╯"]) expect(frame(lastFrame)).not.toContain(ch);
  });
  it("wears the border token's colour", () => {
    setTheme("dark");
    const prompt = frame(render(<ComposerFrame columns={10} />).lastFrame);
    const bash = frame(render(<ComposerFrame columns={10} borderToken="bashBorder" />).lastFrame);
    expect(resolveThemeColor(themeTokens().promptBorder)).toBe("#888888");
    expect(prompt).toContain("\x1b[38;2;136;136;136m");                                 // promptBorder rgb(136,136,136)
    expect(bash).toContain("\x1b[38;2;253;93;177m");                                    // bashBorder rgb(253,93,177)
  });
});

// `offset: 2` does NOT mean two lead dashes. `$Bu` (L179465–179482) takes `a = offset + 1` for align "start"
// and paints `H[0] + Pm(top, a - 1)` — the first cell plus a-1 more, so THREE. We shipped two (t2 review).
describe("ComposerFrame label (borderText offset 2 → THREE lead dashes)", () => {
  it("splices ` label ` into the top rule after three dashes, keeping the total width", () => {
    const { lastFrame } = render(<ComposerFrame columns={40} label="History 3/57" />);
    const top = strip(frame(lastFrame)).split("\n")[0]!;
    expect(top).toBe("─── History 3/57 " + "─".repeat(40 - 3 - 14));
    expect(top.length).toBe(40);
  });
  it("dims the label TEXT and leaves the dashes on both sides undimmed", () => {
    const { lastFrame } = render(<ComposerFrame columns={40} label="History 3/57" />);
    const top = frame(lastFrame).split("\n")[0]!;
    const dimOpen = top.indexOf("\x1b[2m");
    expect(dimOpen).toBeGreaterThan(-1);
    // Everything before the dim run is leading dashes; everything after the dim CLOSE is trailing dashes.
    // Neither may sit inside a dim span — that is the sabotage this test exists to catch.
    const before = top.slice(0, dimOpen), after = top.slice(top.indexOf("\x1b[22m") + "\x1b[22m".length);
    expect(strip(before)).toBe("─── ");
    expect(strip(after).startsWith(" ─")).toBe(true);
    expect(before).not.toContain("\x1b[2m");
    expect(after).not.toContain("\x1b[2m");
    // and the dim run holds exactly the label, nothing of the rule
    expect(strip(top.slice(dimOpen, top.indexOf("\x1b[22m")))).toBe("History 3/57");
  });
  it("renders nothing extra when the label is absent", () => {
    const top = strip(frame(render(<ComposerFrame columns={20} />).lastFrame)).split("\n")[0]!;
    expect(top).toBe("─".repeat(20));
  });
  // `$Bu`'s FIRST branch, `if (Ut(content) >= s - 2)`: the label is clamped to the row instead of overflowing
  // it (which in Ink means the rule wraps onto a second line and the composer grows a phantom row).
  it("truncates an over-long label instead of overflowing the rule (t2 review, Minor)", () => {
    const top = (columns: number) => {
      const lines = strip(frame(render(<ComposerFrame columns={columns} label="History 3/57" />).lastFrame)).split("\n");
      expect(lines[0]!.length, `columns=${columns}`).toBeLessThanOrEqual(columns);   // never wraps onto a second row
      expect(lines.filter((l) => l.length > 0).length, `columns=${columns}`).toBe(2);
      return lines[0]!;
    };
    // `content` here is ` History 3/57 ` = 14 columns. The clamp at `Math.min(a, s - i - 1)` bites BEFORE the
    // overflow arm does: at 17 there is only room for 2 lead dashes, at 16 for none.
    expect(top(24)).toBe("─── History 3/57 " + "─".repeat(7));
    expect(top(17)).toBe("── History 3/57 ─");
    expect(top(16)).toBe(" History 3/57 ──");
    expect(top(15)).toBe(" History 3/57 ─");
    expect(top(14)).toBe(" History 3/57");                  // Ink trims the trailing cell; the row is still 14 wide
    expect(top(8)).toBe(" History");                        // …and below its own width the label TEXT is cut
  });
  it("still keeps the dashes undimmed in the truncating arm", () => {
    const top = frame(render(<ComposerFrame columns={16} label="History 3/57" />).lastFrame).split("\n")[0]!;
    const after = top.slice(top.indexOf("\x1b[22m") + "\x1b[22m".length);
    expect(after).not.toContain("\x1b[2m");
    expect(strip(after)).toBe(" ──");
  });
});

describe("promptGlyph (CM2)", () => {
  // WAVE C TASK 14: the `memory` arm went with the mode (spec owner-decision), which leaves upstream's own
  // two-valued split exactly as `rui` states it — bash gets the `!` glyph, everything else the pointer.
  it("is `❯` + NBSP in normal mode, `!` + NBSP coloured bashBorder in bash", () => {
    setTheme("dark");
    expect(NBSP.charCodeAt(0)).toBe(0xa0);                            // the glyph's trailing char is NOT a space
    expect(POINTER.codePointAt(0)).toBe(0x276f);                      // U+276F, not the U+203A we shipped
    expect(promptGlyph("normal")).toEqual({ text: POINTER + NBSP, color: undefined, dim: false });
    expect(promptGlyph("bash")).toEqual({ text: "!" + NBSP, color: resolveThemeColor(themeTokens().bashBorder), dim: false });
  });
  it("the border token is upstream's two — a `#` line wears the ordinary promptBorder", () => {
    expect(borderTokenFor("bash")).toBe("bashBorder");
    expect(borderTokenFor("normal")).toBe("promptBorder");
  });
  it("dims in every mode while a turn runs", () => {
    expect(promptGlyph("normal", true).dim).toBe(true);
    expect(promptGlyph("bash", true).dim).toBe(true);
  });
});

describe("PlaceholderCursor (CM5)", () => {
  it("inverts the FIRST character and dims the rest", () => {
    const out = frame(render(<PlaceholderCursor text="Ask Claude" />).lastFrame);
    expect(out).toContain("\x1b[7mA\x1b[27m");
    expect(out).toContain("\x1b[2msk Claude\x1b[22m");
    expect(strip(out)).toContain("Ask Claude");
  });
  it("degrades to a single inverted space on an empty placeholder", () => {
    const out = frame(render(<PlaceholderCursor text="" />).lastFrame);
    expect(out).toContain("\x1b[7m \x1b[27m");
    expect(strip(out).trim()).toBe("");
  });
});

describe("newlineHint (CM20 / Z_a)", () => {
  it("rung 1: Apple_Terminal gets the shift+return form", () => {
    expect(newlineHint(false, { TERM_PROGRAM: "Apple_Terminal" })).toBe("shift + ⏎ for newline");
    expect(newlineHint(true, { TERM_PROGRAM: "Apple_Terminal" })).toBe("shift + ⏎ for newline");
  });
  it("rung 3: the verbose form until the user has used \\+Return, the terse form after", () => {
    expect(newlineHint(false, {})).toBe("backslash (\\) + return (⏎) for newline");
    expect(newlineHint(true, {})).toBe("\\⏎ for newline");
    expect(newlineHint(false, { TERM_PROGRAM: "iTerm.app" })).toBe("backslash (\\) + return (⏎) for newline");
  });
});

describe("ChatComposer wears the frame", () => {
  const savedTerm = process.env.TERM_PROGRAM;
  afterEach(() => { if (savedTerm === undefined) delete process.env.TERM_PROGRAM; else process.env.TERM_PROGRAM = savedTerm; });

  it("renders rules (never a box) around a `❯`+NBSP glyph and the placeholder cursor", async () => {
    const { lastFrame } = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} />);
    await settle();
    const raw = frame(lastFrame), lines = strip(raw).split("\n");
    expect(lines[0]).toBe("─".repeat(40));
    expect(lines.filter((l) => l === "─".repeat(40)).length).toBe(2);   // exactly two rules, top and bottom
    for (const ch of ["│", "╭", "╮", "╰", "╯"]) expect(raw).not.toContain(ch);
    expect(raw).toContain(GLYPH);
    expect(raw).not.toContain("› ");                                  // the old, wrong glyph is gone
    // F5 task 8 replaced the literal with CM47's ladder; the SHAPE this test guards is unchanged — a fresh
    // composer shows rule 4's `Try "…"`, so the inverted cell is its `T` and the dim remainder its `ry "`.
    expect(raw).toContain("\x1b[7mT\x1b[27m");                        // placeholder cursor
    expect(raw).toContain("\x1b[2mry \"");
  });
  it("dims the glyph while a turn runs, and swaps it for `!`+NBSP in bash mode", async () => {
    const view = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} busy />);
    await settle();
    expect(frame(view.lastFrame)).toContain("\x1b[2m" + GLYPH);        // dimColor wraps the glyph run
    const bash = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} />);
    await settle();
    bash.stdin.write("!");
    // WAVE C TASK 2: `! bash mode — runs locally…` was a composer row and is now the footer's own
    // `! for shell mode`, so this waits on the glyph swap itself — which is this test's subject anyway.
    await waitFor(() => strip(frame(bash.lastFrame)).includes("!" + NBSP));
    expect(frame(bash.lastFrame)).not.toContain(GLYPH);
  });
  it("paints the label into the top rule when given one, and nothing when not", async () => {
    const withLabel = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} label="History 3/57" />);
    await settle();
    expect(strip(frame(withLabel.lastFrame)).split("\n")[0]).toBe("─── History 3/57 " + "─".repeat(23));
    const without = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} />);
    await settle();
    expect(strip(frame(without.lastFrame)).split("\n")[0]).toBe("─".repeat(40));
  });
  it("the Z_a ladder still shortens once \\+Return has been used — now only in the `?` grid", async () => {
    // WAVE C TASK 2: the ladder's composer ROW went with hint row 1 (upstream's home footer has no such
    // row), so it is no longer readable off a composer frame. The LADDER itself is untouched and still has
    // three rungs; `composerFrame.newlineHint` is the one derivation, and `keys/hints.ts`'s `ladder` cell in
    // the `?` shortcuts grid is now its only render site. This case therefore pins the function, which is
    // what the row was reading, and `shortcuts-grid.test.tsx` pins the grid that draws it.
    delete process.env.TERM_PROGRAM;
    expect(newlineHint(false)).toBe("backslash (\\) + return (⏎) for newline");
    expect(newlineHint(true)).toBe("\\⏎ for newline");
  });
});

describe("external editor in flight (CM8)", () => {
  it("replaces the whole composer with the italic dim literal, then applies the edited text", async () => {
    let release: (v: string | null) => void = () => {};
    const pending = new Promise<string | null>((r) => { release = r; });
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} editExternal={() => pending} />,
    );
    await settle();
    stdin.write("draft");
    await waitFor(() => strip(frame(lastFrame)).includes("draft"));
    stdin.write("\x07");                                               // ctrl+g = chat:externalEditor
    await waitFor(() => strip(frame(lastFrame)).includes(EDITOR_IN_FLIGHT_TEXT));
    const held = frame(lastFrame);
    const literal = held.split("\n").find((l) => l.includes(EDITOR_IN_FLIGHT_TEXT))!;
    expect(literal).toContain("\x1b[3m");                              // italic…
    expect(literal).toContain("\x1b[2m");                              // …and dim
    expect(strip(held)).not.toContain("draft");                        // glyph + input row are gone
    expect(strip(held)).not.toContain("⏎ send");                       // …and so is everything below them
    expect(held).not.toContain(GLYPH);
    expect(strip(held).split("\n")[0]).toBe("─".repeat(40));           // but the rules survive (`...t_`)

    release("edited in $EDITOR");
    await waitFor(() => strip(frame(lastFrame)).includes("edited in $EDITOR"));
    expect(strip(frame(lastFrame))).not.toContain(EDITOR_IN_FLIGHT_TEXT);
    expect(frame(lastFrame)).toContain(GLYPH);
  });
  it("still accepts a SYNCHRONOUS injected editor (the pre-F5 DI shape)", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} editExternal={(t) => t + " [sync]"} />,
    );
    await settle();
    stdin.write("draft");
    await waitFor(() => strip(frame(lastFrame)).includes("draft"));
    stdin.write("\x07");
    await waitFor(() => strip(frame(lastFrame)).includes("draft [sync]"));
  });
  // t2 review, Important: the editor is spawned with stdio "inherit", so the harness must stop reading fd 0 for
  // the flight or it races the child for its keystrokes. The seam is the keymap provider's `suspendInput`; here
  // it is injected so the ordering is observable without a real terminal.
  it("runs the editor INSIDE the keymap's terminal handoff", async () => {
    const order: string[] = [];
    let release: (v: string | null) => void = () => {};
    const pending = new Promise<string | null>((r) => { release = r; });
    const suspendInput = async <T,>(fn: () => Promise<T>): Promise<T> => {
      order.push("suspend");
      try { return await fn(); } finally { order.push("resume"); }
    };
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40}
        suspendInput={suspendInput} editExternal={() => { order.push("edit"); return pending; }} />,
    );
    await settle();
    stdin.write("\x07");
    await waitFor(() => order.includes("edit"));
    expect(order).toEqual(["suspend", "edit"]);                  // NOT resumed while the editor still holds the tty
    expect(strip(frame(lastFrame))).toContain(EDITOR_IN_FLIGHT_TEXT);
    release("done");
    await waitFor(() => strip(frame(lastFrame)).includes("done"));
    expect(order).toEqual(["suspend", "edit", "resume"]);
  });
  it("resumes the handoff even when the editor rejects", async () => {
    const order: string[] = [];
    const suspendInput = async <T,>(fn: () => Promise<T>): Promise<T> => {
      order.push("suspend");
      try { return await fn(); } finally { order.push("resume"); }
    };
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40}
        suspendInput={suspendInput} editExternal={() => Promise.reject(new Error("no editor"))} />,
    );
    await settle();
    stdin.write("keep");
    await waitFor(() => strip(frame(lastFrame)).includes("keep"));
    stdin.write("\x07");
    await waitFor(() => order.includes("resume"));
    await waitFor(() => !strip(frame(lastFrame)).includes(EDITOR_IN_FLIGHT_TEXT));
    expect(order).toEqual(["suspend", "resume"]);
    expect(strip(frame(lastFrame))).toContain("keep");
  });
  // F5 real-TTY fix, THE pin for the whole redesign. The app path is the SYNC `editExternal` again (an
  // awaited editor deadlocks the process on a real terminal — see restoreTtyNonblock's diagnosis), and a
  // sync editor freezes the event loop, so the in-flight row is only ever seen if Ink has already WRITTEN it
  // when the editor is entered. That ordering is the contract: at the instant the editor is called, the row
  // is on screen. A regression to "call the editor straight from the key handler" fails this.
  it("has already PAINTED the in-flight row by the time the editor is entered (paint-then-block)", async () => {
    let frameAtEditTime = "";
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40}
        editExternal={(t) => { frameAtEditTime = strip(frame(lastFrame)); return t + "!"; }} />,
    );
    await settle();
    stdin.write("draft");
    await waitFor(() => strip(frame(lastFrame)).includes("draft"));
    stdin.write("\x07");
    await waitFor(() => frameAtEditTime !== "");
    expect(frameAtEditTime).toContain(EDITOR_IN_FLIGHT_TEXT);
    expect(frameAtEditTime).not.toContain("draft");                    // the composer really is swapped out
    await waitFor(() => strip(frame(lastFrame)).includes("draft!"));
  });
  it("keeps the buffer and clears the in-flight row when the editor returns null", async () => {
    let release: (v: string | null) => void = () => {};
    const pending = new Promise<string | null>((r) => { release = r; });
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} editExternal={() => pending} />,
    );
    await settle();
    stdin.write("keep me");
    await waitFor(() => strip(frame(lastFrame)).includes("keep me"));
    stdin.write("\x07");
    await waitFor(() => strip(frame(lastFrame)).includes(EDITOR_IN_FLIGHT_TEXT));
    release(null);
    await waitFor(() => strip(frame(lastFrame)).includes("keep me"));
    expect(strip(frame(lastFrame))).not.toContain(EDITOR_IN_FLIGHT_TEXT);
  });
  // M1 review, finding 2. The in-flight early return draws no popup, so a completion state left standing is
  // a claim about the screen that is no longer true — and it is not cosmetic: `ChatApp` subtracts
  // `popupHeight(rows)` from the live window's cap for as long as this component reports the popup open, so a
  // stale `true` shrinks the window for the whole edit. The null arm is the one that used to persist (`done`
  // returns before any `commitState`), which is why the report is re-checked after the editor comes back.
  it("closes an open suggestion popup — releasing the live window's cap — before the editor takes the terminal", async () => {
    const open: boolean[] = [];
    let release: (v: string | null) => void = () => {};
    const pending = new Promise<string | null>((r) => { release = r; });
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} columns={() => 40} rows={() => 40}
        commandCatalog={[{ name: "status", description: "show model", source: "local" }]}
        onSuggestOpen={(v) => open.push(v)} editExternal={() => pending} />,
    );
    await settle();
    stdin.write("/");
    await waitFor(() => strip(frame(lastFrame)).includes("show model"));
    expect(open).toEqual([true]);
    stdin.write("\x07");                                               // ctrl+g = chat:externalEditor
    await waitFor(() => strip(frame(lastFrame)).includes(EDITOR_IN_FLIGHT_TEXT));
    expect(open).toEqual([true, false]);                               // released, not held for the edit
    release(null);                                                     // the arm that skips `done`'s commitState
    await waitFor(() => !strip(frame(lastFrame)).includes(EDITOR_IN_FLIGHT_TEXT));
    expect(open).toEqual([true, false]);                               // …and it stays released
    expect(strip(frame(lastFrame))).not.toContain("show model");
  });
});

// F5 Task 3: paste ingestion as the composer actually experiences it — real bracketed-paste bytes down the
// provider's stdin, upstream's `Pasting…` row (L493764) while a paste is still arriving, and the chip that
// expands back to its content on submit.
describe("ChatComposer — paste chips and the Pasting… row", () => {
  it("collapses a large paste into `[Pasted text #1 …]` and sends the full content on submit", async () => {
    const sent: string[] = [];
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={(t) => sent.push(t)} cwd={tmpdir()} commandCatalog={[]} columns={() => 60} rows={() => 24} />,
    );
    await settle();
    const body = "alpha\nbravo\ncharlie\ndelta";
    stdin.write("\x1b[200~" + body + "\x1b[201~");
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +3 lines]"));
    expect(strip(frame(lastFrame))).not.toContain("bravo");
    stdin.write("\r");
    await waitFor(() => sent.length > 0);
    expect(sent[0]).toBe(body);
  });
  it("inserts a small paste verbatim — no chip", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 60} rows={() => 24} />,
    );
    await settle();
    stdin.write("\x1b[200~one\r\ntwo\x1b[201~");
    await waitFor(() => strip(frame(lastFrame)).includes("two"));
    expect(strip(frame(lastFrame))).not.toContain("Pasted text");
  });
  it("uses the LIVE row count: the same two-line paste chips on a 10-row terminal", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 60} rows={() => 10} />,
    );
    await settle();
    stdin.write("\x1b[200~one\ntwo\x1b[201~");
    await waitFor(() => strip(frame(lastFrame)).includes("[Pasted text #1 +1 lines]"));
  });
  it("paints the dim `Pasting…` row while a paste is torn across chunks, and drops it on release", async () => {
    // WAVE C TASK 2: `Pasting…` is `Wci`'s second early-return FOOTER state now, so this composes the pair.
    const { stdin, lastFrame } = renderWithKeymap(
      <ComposerWithFooter onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 60} rows={() => 24} />,
    );
    await settle();
    expect(strip(frame(lastFrame))).not.toContain("Pasting…");
    stdin.write("\x1b[200~first half\r");
    await waitFor(() => strip(frame(lastFrame)).includes("Pasting…"));
    expect(frame(lastFrame)).toContain("\x1b[2mPasting…");                 // dimColor, upstream L493764
    stdin.write("second half\x1b[201~");
    await waitFor(() => !strip(frame(lastFrame)).includes("Pasting…"));
  });
});
