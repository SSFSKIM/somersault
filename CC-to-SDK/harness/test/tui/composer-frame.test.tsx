// test/tui/composer-frame.test.tsx — F5 Task 2: the composer's visual form.
//  · CM1  (L496235) two full-width `─` rules, no verticals, no corners
//  · label (L496126) ` ${dim(label)} ` splices into the TOP rule at offset 2, dashes NOT dim
//  · CM2  (L494733/L494745) `❯\xA0` / `!\xA0`, dim while a turn runs
//  · CM5  (L395963) empty buffer → placeholder's first char inverted, remainder dim
//  · CM20 (L433221) the `Z_a` newline-hint ladder
//  · CM8  (L496237) an external edit in flight replaces the whole composer with one italic dim literal
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { renderWithKeymap } from "./keysTestUtil.js";
import { tmpdir } from "node:os";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { ComposerFrame, PlaceholderCursor, promptGlyph, newlineHint, EDITOR_IN_FLIGHT_TEXT, NBSP, POINTER } from "../../src/tui/composerFrame.js";
import { setTheme, themeTokens, resolveThemeColor } from "../../src/tui/theme.js";

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

describe("ComposerFrame label (borderText offset 2)", () => {
  it("splices ` label ` into the top rule at offset 2, keeping the total width", () => {
    const { lastFrame } = render(<ComposerFrame columns={40} label="History 3/57" />);
    const top = strip(frame(lastFrame)).split("\n")[0]!;
    expect(top).toBe("── History 3/57 " + "─".repeat(40 - 2 - 14));
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
    expect(strip(before)).toBe("── ");
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
});

describe("promptGlyph (CM2)", () => {
  it("is `❯` + NBSP in normal and memory mode, `!` + NBSP coloured bashBorder in bash", () => {
    setTheme("dark");
    expect(NBSP.charCodeAt(0)).toBe(0xa0);                            // the glyph's trailing char is NOT a space
    expect(POINTER.codePointAt(0)).toBe(0x276f);                      // U+276F, not the U+203A we shipped
    expect(promptGlyph("normal")).toEqual({ text: POINTER + NBSP, color: undefined, dim: false });
    expect(promptGlyph("memory")).toEqual({ text: POINTER + NBSP, color: undefined, dim: false });
    expect(promptGlyph("bash")).toEqual({ text: "!" + NBSP, color: resolveThemeColor(themeTokens().bashBorder), dim: false });
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
    expect(raw).toContain("\x1b[7mA\x1b[27m");                        // placeholder cursor
    expect(raw).toContain("\x1b[2msk Claude anything…");
  });
  it("dims the glyph while a turn runs, and swaps it for `!`+NBSP in bash mode", async () => {
    const view = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} busy />);
    await settle();
    expect(frame(view.lastFrame)).toContain("\x1b[2m" + GLYPH);        // dimColor wraps the glyph run
    const bash = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} />);
    await settle();
    bash.stdin.write("!");
    await waitFor(() => frame(bash.lastFrame).includes("bash mode"));
    expect(strip(frame(bash.lastFrame))).toContain("!" + NBSP);
    expect(frame(bash.lastFrame)).not.toContain(GLYPH);
  });
  it("paints the label into the top rule when given one, and nothing when not", async () => {
    const withLabel = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} label="History 3/57" />);
    await settle();
    expect(strip(frame(withLabel.lastFrame)).split("\n")[0]).toBe("── History 3/57 " + "─".repeat(24));
    const without = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 40} />);
    await settle();
    expect(strip(frame(without.lastFrame)).split("\n")[0]).toBe("─".repeat(40));
  });
  it("carries the Z_a ladder in the footer and shortens it once \\+Return has been used", async () => {
    delete process.env.TERM_PROGRAM;
    const { stdin, lastFrame } = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => 120} />);
    await settle();
    expect(strip(frame(lastFrame))).toContain("backslash (\\) + return (⏎) for newline");
    stdin.write("a\\");
    await waitFor(() => strip(frame(lastFrame)).includes("a\\"));
    stdin.write("\r");                                                 // `\` + Return = the continuation
    await waitFor(() => strip(frame(lastFrame)).includes("\\⏎ for newline"));
    expect(strip(frame(lastFrame))).not.toContain("backslash (\\) + return (⏎) for newline");
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
});
