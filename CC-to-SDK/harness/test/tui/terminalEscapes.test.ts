import { describe, expect, it, vi } from "vitest";
import { osc, passthrough, isMuxed, notifyTerminator, sanitizeNotificationText, BELL, OSC_ITERM2, OSC_KITTY, OSC_GHOSTTY, OSC_TITLE, ITERM2_PROGRESS, PROGRESS_STATE, progressOsc, PROGRESS_TEARDOWN_CLEAR } from "../../src/tui/terminalEscapes.js";

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

describe("progressOsc — the OSC 9;4 progress bar wire form (research report §1)", () => {
  it("CLEAR carries an empty value, which still renders as a TRAILING semicolon before the terminator", () => {
    // `Koi` (L188791) hardcodes `9;4;0;` — not `9;4;0` — because `join(";")` on [9,4,0,""] keeps the
    // fourth (empty) slot. A builder that dropped the trailing `;` for a falsy/empty value would pass
    // every other assertion here and still disagree with canon on the wire.
    expect(progressOsc("bel", PROGRESS_STATE.CLEAR)).toBe("\x1b]9;4;0;\x07");
  });
  it("INDETERMINATE — the only state ccx's driver ever wires — same trailing-semicolon shape", () => {
    expect(progressOsc("bel", PROGRESS_STATE.INDETERMINATE)).toBe("\x1b]9;4;3;\x07");
  });
  it("SET and ERROR carry a percent and NO trailing semicolon — built for fidelity, reached by nothing", () => {
    expect(progressOsc("bel", PROGRESS_STATE.SET, 42)).toBe("\x1b]9;4;1;42\x07");
    expect(progressOsc("bel", PROGRESS_STATE.ERROR, 0)).toBe("\x1b]9;4;2;0\x07");
  });
  it("takes ST when the caller passes it, exactly like every other osc() caller — no internal sniff", () => {
    expect(progressOsc("st", PROGRESS_STATE.INDETERMINATE)).toBe("\x1b]9;4;3;\x1b\\");
  });
  it("uses OSC_ITERM2 (9) and ITERM2_PROGRESS (4), the exact codes canon's Onr/wC pair names", () => {
    expect(OSC_ITERM2).toBe(9);
    expect(ITERM2_PROGRESS).toBe(4);
    expect(PROGRESS_STATE).toEqual({ CLEAR: 0, SET: 1, ERROR: 2, INDETERMINATE: 3 });
  });
});

describe("PROGRESS_TEARDOWN_CLEAR — canon's `Koi` (L188791), pre-built and asymmetric on purpose", () => {
  it("is the CLEAR form, BEL-terminated, byte for byte", () => {
    expect(PROGRESS_TEARDOWN_CLEAR).toBe("\x1b]9;4;0;\x07");
  });
  it("is NOT DCS-wrapped by itself — the unwrapped constant is what teardown call sites write directly, "
    + "never through passthrough()", () => {
    expect(PROGRESS_TEARDOWN_CLEAR.startsWith("\x1bPtmux;")).toBe(false);
    expect(PROGRESS_TEARDOWN_CLEAR.startsWith("\x1bP")).toBe(false);
  });
  it("is a CONSTANT, always BEL, even where the hook-path builder would pick ST — the asymmetry is canon's "
    + "own (Koi bypasses tI entirely), not a reading error", () => {
    // The would-be hook-path equivalent under a kitty terminator picks ST; the pre-built constant never does.
    expect(progressOsc(notifyTerminator({ TERM: "xterm-kitty" } as NodeJS.ProcessEnv), PROGRESS_STATE.CLEAR)).toBe("\x1b]9;4;0;\x1b\\");
    expect(PROGRESS_TEARDOWN_CLEAR.endsWith(BELL)).toBe(true);
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
