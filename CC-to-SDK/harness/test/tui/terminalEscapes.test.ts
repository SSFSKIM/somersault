import { describe, expect, it, vi } from "vitest";
import { osc, passthrough, isMuxed, notifyTerminator, sanitizeNotificationText, BELL, OSC_ITERM2, OSC_KITTY, OSC_GHOSTTY, OSC_TITLE } from "../../src/tui/terminalEscapes.js";

describe("osc", () => {
  it("joins parts with ';' and terminates with BEL or ST", () => {
    expect(osc("bel", OSC_TITLE, "✳ ccx")).toBe("\x1b]0;✳ ccx\x07");
    expect(osc("st", OSC_KITTY, "i=1:d=0:p=title", "ccx")).toBe("\x1b]99;i=1:d=0:p=title;ccx\x1b\\");
  });
  it("takes the terminator as a parameter, never sniffing — even standing ON kitty", () => {
    // the title keeps BEL on EVERY terminal, kitty included (terminalTitle.ts's Wave C skip), so make
    // the env hostile: a sniffing builder would flip to ST here, and only here can this assertion fail.
    vi.stubEnv("TERM", "xterm-kitty"); vi.stubEnv("KITTY_WINDOW_ID", "1");
    try {
      expect(osc("bel", OSC_TITLE, "x").endsWith("\x07")).toBe(true);
      expect(osc("st", OSC_TITLE, "x").endsWith("\x1b\\")).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("passthrough", () => {
  const seq = "\x1b]9;hi\x07";
  it("wraps for tmux, doubling inner ESCs", () => {
    expect(passthrough(seq, { TMUX: "/tmp/s,1,0" } as NodeJS.ProcessEnv)).toBe("\x1bPtmux;\x1b\x1b]9;hi\x07\x1b\\");
  });
  it("wraps for screen without the tmux tag", () => {
    expect(passthrough(seq, { STY: "1.pts" } as NodeJS.ProcessEnv)).toBe("\x1bP\x1b\x1b]9;hi\x07\x1b\\");
  });
  it("passes through bare, and passes zellij through bare too (canon's Fq has no zellij arm)", () => {
    expect(passthrough(seq, {} as NodeJS.ProcessEnv)).toBe(seq);
    expect(passthrough(seq, { ZELLIJ: "0" } as NodeJS.ProcessEnv)).toBe(seq);
  });
});

describe("isMuxed", () => {
  it("is truthy-gated, not `!== undefined` — the exact divergence F8 review Finding C found between "
    + "this module's passthrough check and desktopNotify's old bell check", () => {
    expect(isMuxed({ TMUX: "/tmp/s,1,0" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMuxed({ STY: "1.pts" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMuxed({} as NodeJS.ProcessEnv)).toBe(false);
    // TMUX="" is SET (`!== undefined`) but not truthy: `passthrough` never wraps for it, so the shared
    // predicate must answer false here too, or desktopNotify's bell would fire for a sequence that was
    // never wrapped.
    expect(isMuxed({ TMUX: "" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMuxed({ STY: "" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("notifyTerminator", () => {
  it("is ST under kitty and BEL everywhere else", () => {
    expect(notifyTerminator({ TERM: "xterm-kitty" } as NodeJS.ProcessEnv)).toBe("st");
    expect(notifyTerminator({ TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv)).toBe("bel");
    expect(notifyTerminator({} as NodeJS.ProcessEnv)).toBe("bel");
  });
  it("recognises kitty by EACH of its three markers, not just TERM", () => {
    expect(notifyTerminator({ KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv)).toBe("st");
    expect(notifyTerminator({ TERM_PROGRAM: "kitty" } as NodeJS.ProcessEnv)).toBe("st");
  });
});

describe("sanitizeNotificationText", () => {
  it("replaces C0, DEL and C1 with a SPACE — canon's s$n, not the title's stripper", () => {
    expect(sanitizeNotificationText("a\x1b[31mb")).toBe("a [31mb");   // ESC → space, the rest is literal
    expect(sanitizeNotificationText(`a${BELL}b`)).toBe("a b");
    expect(sanitizeNotificationText("a\x7fb")).toBe("a b");
    expect(sanitizeNotificationText("a\x9bb")).toBe("a b");           // C1 — the title stripper leaves this
    expect(sanitizeNotificationText("plain")).toBe("plain");
  });
  it("never shortens the string", () => {
    const s = "\x00\x01\x02abc\x7f";
    expect(sanitizeNotificationText(s)).toHaveLength(s.length);
  });
  it("leaves every character above the C1 range alone", () => {
    // pins the UPPER bound: a `c >= 127` implementation with no ceiling passes every assertion above
    // and still mangles accents, the spinner glyphs, and every box-drawing rule we paint.
    expect(sanitizeNotificationText("a é✳b")).toBe("a é✳b");
    expect(sanitizeNotificationText("\x9f")).toBe(" ");               // last C1 byte, still replaced
    expect(sanitizeNotificationText("\xa0")).toBe("\xa0");            // first byte past it, preserved
  });
});
