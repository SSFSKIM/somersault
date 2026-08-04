// test/tui/markdown-links-code.test.ts — F4 Task 3: links, images, fenced code, the strikethrough
// terminal gate and the upstream (DhH) highlight colors. Every pin cites the constants pack
// `docs/superpowers/research/2026-07-31-tui-clone/14-f4-constants-pack.md` (§1.7 dHn, §1.9 image,
// §1.10 DhH L420495, §5 code) or the bundle lines the pack points at (`ZF` L393098, `case "link"`
// L420625–420640, `jhH` L420707, `mI` L181827).
//
// The gates read `process.env` by default (the house DI shape is an optional `env` argument), so the
// renderMarkdown-level cases drive them by mutating the process env around each test; the gate
// functions themselves are pinned directly with an explicit env object.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Box } from "ink";
import { renderMarkdown } from "../../src/tui/markdown.js";
import { hyperlinksSupported, strikethroughSupported } from "../../src/tui/markdownInline.js";
import { Line } from "../../src/tui/Line.js";

const lines = (s: string) => renderMarkdown(s);
const texts = (s: string) => lines(s).map((l) => l.text);

// Every env var either gate reads — cleared wholesale so a test only ever sees what it sets.
const GATE_KEYS = ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM", "TERMINAL_EMULATOR", "LC_TERMINAL", "FORCE_HYPERLINK",
  "WT_SESSION", "TMUX", "CLAUDE_CODE_FORCE_STRIKETHROUGH", "KITTY_WINDOW_ID", "ALACRITTY_LOG", "KONSOLE_VERSION", "ZED_TERM", "VTE_VERSION", "MSYSTEM"];
const saved = Object.fromEntries(GATE_KEYS.map((k) => [k, process.env[k]]));
function setEnv(e: Record<string, string> = {}): void {
  for (const k of GATE_KEYS) delete process.env[k];
  Object.assign(process.env, e);
}
afterEach(() => { for (const k of GATE_KEYS) { const v = saved[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

// `iTerm.app` is on BOTH allowlists (hyperlinks `X3u` L181855, strikethrough `UhH` L420509).
const ITERM = { TERM_PROGRAM: "iTerm.app" };
const OSC = (href: string, text: string) => `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;
const plain = (s: string) => s.replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");

describe("F4 Task 3 — links (bundle `case \"link\"` L420625–420640 → `ZF` L393098)", () => {
  it("link emits OSC-8 wrapping when supported, text (url) when not", () => {
    setEnv(ITERM);
    const on = lines("[docs](https://example.com)")[0];
    expect(on.text).toBe(OSC("https://example.com", "docs"));
    expect(on.color).toBe("blueBright");                  // dark theme (`auto`); light themes take `blue`
    // The OSC bytes ride INSIDE the segment text with `preStyled` NOT set — the segment still carries its
    // colour, because a chalk-style wrapper does not rewrite OSC bytes (unlike the raw SGR of F3 Task 1).
    const mixed = lines("see [docs](https://example.com) here")[0].segments!;
    const link = mixed.find((s) => s.text.includes("\x1b]8;;"))!;
    expect(link).toEqual({ text: OSC("https://example.com", "docs"), color: "blueBright" });
    setEnv({});
    const off = lines("[docs](https://example.com)")[0];
    expect(off.text).toBe("docs (https://example.com)");
    expect(off.color).toBeUndefined();                    // ZF's unsupported branch returns UNCOLORED text
  });

  it("a link whose text IS the url collapses to the bare url when unsupported", () => {
    setEnv({});
    expect(texts("[https://example.com](https://example.com)")).toEqual(["https://example.com"]);
  });

  it("mailto: collapses to the bare address; a differing label keeps `text (addr)`", () => {
    setEnv(ITERM);
    expect(texts("[a@b.co](mailto:a@b.co)")).toEqual(["a@b.co"]);
    expect(texts("[mail me](mailto:a@b.co)")).toEqual(["mail me (a@b.co)"]);
  });

  it("a link title becomes the ` (\"title\")` suffix (bundle L420626)", () => {
    setEnv({});
    expect(texts('[docs](https://example.com "T")')).toEqual(['docs (https://example.com) ("T")']);
  });

  it("a file: url is normalised to an absolute file:// href (`jhH` L420707)", () => {
    setEnv(ITERM);
    const t = lines("[f](file:///tmp/a.txt)")[0].text;
    expect(t).toBe(OSC("file:///tmp/a.txt", "f"));
    expect(texts("[h](file://localhost/tmp/a.txt)")[0]).toBe(OSC("file:///tmp/a.txt", "h"));
  });

  it("no `⧉` ever reaches our OSC-8 runs (bundle `Oro`/`AIg` L100700 — claude.ai artifact hrefs only)", () => {
    setEnv(ITERM);
    for (const md of ["[docs](https://example.com)", "[art](https://claude.ai/code/artifact/abc123)", "![a](https://x.dev/i.png)"])
      expect(lines(md)[0].text).not.toContain("⧉");
  });

  it("Ink width treats the OSC-8 run as text-only (frame does not overflow)", () => {
    setEnv(ITERM);
    const l = lines("[docs](https://example.com/a/quite/long/path/indeed)")[0];
    const { lastFrame } = render(React.createElement(Box, { width: 20 }, React.createElement(Line, { l })));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("\x1b]8;;");                  // the hyperlink really is in the frame
    const body = plain(frame).split("\n").filter((x) => x.trim() !== "");
    expect(body).toEqual(["docs"]);                       // one line, no wrap artifacts from the ~50 raw bytes
  });
});

describe("F4 Task 3 — images (constants pack §1.9, L420619–420624)", () => {
  it("renders all three upstream forms", () => {
    setEnv(ITERM);
    expect(texts("![](https://x.dev/i.png)")).toEqual(["https://x.dev/i.png"]);          // no alt, no title → bare href
    expect(texts("![alt](https://x.dev/i.png)")).toEqual(["alt (https://x.dev/i.png)"]);  // `u` carries its own trailing space
    expect(texts('![alt](https://x.dev/i.png "T")')).toEqual(['alt (https://x.dev/i.png "T")']);
    expect(texts('![](https://x.dev/i.png "T")')).toEqual(['(https://x.dev/i.png "T")']);  // no leading space
  });
});

describe("F4 Task 3 — fenced code (constants pack §5, L420597–420602)", () => {
  it("code block is flush-left and unlabelled for a recognized language", () => {
    expect(renderMarkdown("```ts\nconst x = 1;\n```")).toEqual([
      { text: "const x = 1;", segments: [{ text: "const", color: "blue" }, { text: " x = " }, { text: "1", color: "green" }, { text: ";" }] },
    ]);
  });

  it("unknown language gets a dim label line and a PLAIN body", () => {
    // `f = u && !s?.supportsLanguage(u) ? vt.dim(u) + aW : ""` — label exactly when lang is present and
    // unrecognized; the body then resolves to "plaintext", which hljs leaves unscoped, i.e. plain.
    expect(renderMarkdown("```weirdlang\nfoo bar\n```")).toEqual([{ text: "weirdlang", dim: true }, { text: "foo bar" }]);
  });

  it("an untagged fence gets no label and a plain body", () => {
    expect(renderMarkdown("```\nplain text\n```")).toEqual([{ text: "plain text" }]);
  });

  it("fence info string 'ts title=x' resolves ts via the prefix regex", () => {
    // The label tests the FULL lang string `u`, not the prefix `d` — so this fence is labelled AND highlighted.
    const out = renderMarkdown("```ts title=x\nconst y = 2;\n```");
    expect(out[0]).toEqual({ text: "ts title=x", dim: true });
    expect(out[1].segments![0]).toEqual({ text: "const", color: "blue" });
  });

  it("multi-line bodies keep every line flush-left", () => {
    expect(renderMarkdown("```\na\nb\n```").map((l) => l.text)).toEqual(["a", "b"]);
  });
});

describe("F4 Task 3 — the dHn strikethrough gate (constants pack §1.7, L420498–420509)", () => {
  it("del falls back to literal ~~text~~ when unsupported", () => {
    setEnv({ TERM_PROGRAM: "Apple_Terminal" });
    expect(renderMarkdown("~~gone~~")).toEqual([{ text: "~~gone~~" }]);
    setEnv({ TERM: "linux" });
    expect(renderMarkdown("~~gone~~")).toEqual([{ text: "~~gone~~" }]);
    setEnv(ITERM);
    expect(renderMarkdown("~~gone~~")).toEqual([{ text: "gone", strikethrough: true }]);
  });

  it("ports the allowlist verbatim", () => {
    for (const p of ["iTerm.app", "vscode", "WezTerm", "WarpTerminal", "Hyper", "Tabby", "rio", "contour", "alacritty"])
      expect(strikethroughSupported({ TERM_PROGRAM: p })).toBe(true);
    expect(strikethroughSupported({ TERM: "xterm-ghostty" })).toBe(true);
    expect(strikethroughSupported({ TERM_PROGRAM: "ghostty" })).toBe(true);
    expect(strikethroughSupported({ TERM_PROGRAM: "mintty" })).toBe(true);
    expect(strikethroughSupported({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toBe(true);
    expect(strikethroughSupported({ LC_TERMINAL: "iTerm2" })).toBe(true);
    for (const e of [{ TERM: "xterm-kitty" }, { TERM: "alacritty" }, { TERM: "foot-extra" }, { KITTY_WINDOW_ID: "1" },
      { ALACRITTY_LOG: "/tmp/l" }, { KONSOLE_VERSION: "220300" }, { WT_SESSION: "x" }, { ZED_TERM: "true" }, { VTE_VERSION: "4400" }])
      expect(strikethroughSupported(e)).toBe(true);
    expect(strikethroughSupported({ VTE_VERSION: "4399" })).toBe(false);
    expect(strikethroughSupported({})).toBe(false);
    expect(strikethroughSupported({ TERM_PROGRAM: "xterm.js" })).toBe(false);
  });

  it("CLAUDE_CODE_FORCE_STRIKETHROUGH short-circuits BEFORE the Apple_Terminal / TERM=linux exclusion", () => {
    expect(strikethroughSupported({ CLAUDE_CODE_FORCE_STRIKETHROUGH: "1", TERM_PROGRAM: "Apple_Terminal" })).toBe(true);
    expect(strikethroughSupported({ CLAUDE_CODE_FORCE_STRIKETHROUGH: "1", TERM: "linux" })).toBe(true);
    // the exclusions beat the allowlist when not forced
    expect(strikethroughSupported({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
    expect(strikethroughSupported({ TERM: "linux", TERM_PROGRAM: "vscode" })).toBe(false);
  });
});

describe("F4 Task 3 — the hyperlink gate (bundle `mI` L181827, `X3u` L181855)", () => {
  it("accepts the TERM_PROGRAM / LC_TERMINAL allowlist and kitty's TERM", () => {
    for (const p of ["ghostty", "Hyper", "kitty", "alacritty", "iTerm.app", "iTerm2"]) expect(hyperlinksSupported({ TERM_PROGRAM: p })).toBe(true);
    expect(hyperlinksSupported({ LC_TERMINAL: "iTerm2" })).toBe(true);
    expect(hyperlinksSupported({ TERM: "xterm-kitty" })).toBe(true);
    expect(hyperlinksSupported({ TERMINAL_EMULATOR: "JetBrains-JediTerm" })).toBe(true);
    expect(hyperlinksSupported({})).toBe(false);
    expect(hyperlinksSupported({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
  });
  it("WT_SESSION counts except under tmux; tmux needs >= 3.4", () => {
    expect(hyperlinksSupported({ WT_SESSION: "x" })).toBe(true);
    expect(hyperlinksSupported({ WT_SESSION: "x", TMUX: "/tmp/s" })).toBe(false);
    expect(hyperlinksSupported({ TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.4" })).toBe(true);
    expect(hyperlinksSupported({ TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.3" })).toBe(false);
  });
  it("FORCE_HYPERLINK forces on, and `FORCE_HYPERLINK=0` forces off", () => {
    expect(hyperlinksSupported({ FORCE_HYPERLINK: "1" })).toBe(true);
    expect(hyperlinksSupported({ FORCE_HYPERLINK: "" })).toBe(true);
    expect(hyperlinksSupported({ FORCE_HYPERLINK: "0", TERM_PROGRAM: "iTerm.app" })).toBe(false);
  });
});
