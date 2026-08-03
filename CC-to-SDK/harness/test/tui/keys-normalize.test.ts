// tui/test/keys-normalize.test.ts — key-spec normalization (F2 task 2). A "spec" is the human-written string a
// binding table (task 3) and a user's keybindings.json (task 9) are written in; this module is the only place
// that decides what `"ctrl+shift+p"` means. Every expectation below is anchored on what the task-1 parser
// actually emits (keys/parse.ts): names are lowercase, uppercase letters arrive as lowercase + shift, the space
// key is always named `space` (never `" "`), meta is already fused into `alt`, and \x1f is `ctrl+_`.
import { describe, it, expect } from "vitest";
import { parseKeySpec, parseChordSpec, specKey, eventMatches, formatKeySpec, formatChord } from "../../src/tui/keys/normalize.js";
import type { KeyEvent } from "../../src/tui/keys/types.js";

const spec = (s: string) => { const k = parseKeySpec(s); expect(k, `parseKeySpec(${JSON.stringify(s)}) should not be null`).not.toBeNull(); return k!; };
const ev = (name: string, m: Partial<KeyEvent> = {}): KeyEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, super: false, raw: "", ...m });

describe("modifier aliases", () => {
  it.each([["ctrl+p"], ["control+p"]])("%s → ctrl", (s) =>
    expect(spec(s)).toEqual({ name: "p", ctrl: true, alt: false, shift: false, super: false }));
  it.each([["alt+p"], ["opt+p"], ["option+p"], ["meta+p"]])("%s → alt (the parser already fused meta into alt)", (s) =>
    expect(spec(s)).toEqual({ name: "p", ctrl: false, alt: true, shift: false, super: false }));
  it.each([["super+p"], ["cmd+p"], ["command+p"], ["win+p"]])("%s → super", (s) =>
    expect(spec(s)).toEqual({ name: "p", ctrl: false, alt: false, shift: false, super: true }));
  it("shift is its own modifier", () =>
    expect(spec("shift+tab")).toEqual({ name: "tab", ctrl: false, alt: false, shift: true, super: false }));
  it("modifier names are case-insensitive", () =>
    expect(spec("Ctrl+Alt+p")).toEqual(spec("ctrl+alt+p")));
  it("all four modifiers can stack", () =>
    expect(spec("ctrl+alt+shift+super+x")).toEqual({ name: "x", ctrl: true, alt: true, shift: true, super: true }));
});

describe("name aliases", () => {
  it.each([["esc", "escape"], ["escape", "escape"], ["return", "enter"], ["enter", "enter"], ["del", "delete"],
           ["delete", "delete"], ["space", "space"], ["tab", "tab"], ["backspace", "backspace"]])("%s → %s", (s, name) =>
    expect(spec(s).name).toBe(name));
  it.each([["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"]])("arrow glyph %s → %s", (s, name) =>
    expect(spec(s).name).toBe(name));
  it("names are case-insensitive (multi-char names imply no shift)", () => {
    expect(spec("ESC")).toEqual({ name: "escape", ctrl: false, alt: false, shift: false, super: false });
    expect(spec("PageUp").name).toBe("pageup");
  });
  it("unknown names pass through — the table also spells keys the parser never emits (capslock)", () =>
    expect(spec("capslock").name).toBe("capslock"));
});

describe("space is spelled `space`, never a literal blank", () => {
  it("`space` and `SPACE` both name the one key the parser emits", () => {
    expect(spec("space").name).toBe("space");
    expect(spec("SPACE").name).toBe("space");
  });
  it("a literal blank is not a key spec (it is the chord separator)", () => {
    expect(parseKeySpec(" ")).toBeNull();
    expect(parseKeySpec("")).toBeNull();
    expect(parseKeySpec("   ")).toBeNull();
  });
  it("matches the parser's bare-space and ctrl+space events", () => {
    expect(eventMatches(ev("space"), spec("space"))).toBe(true);
    expect(eventMatches(ev("space", { ctrl: true }), spec("ctrl+space"))).toBe(true);
    expect(eventMatches(ev("space", { ctrl: true }), spec("space"))).toBe(false);
  });
});

describe("modifier order does not matter", () => {
  it("shift+ctrl+p ≡ ctrl+shift+p", () => {
    expect(spec("shift+ctrl+p")).toEqual(spec("ctrl+shift+p"));
    expect(specKey(spec("shift+ctrl+p"))).toBe(specKey(spec("ctrl+shift+p")));
  });
  it("super+alt+ctrl+shift+x ≡ ctrl+alt+shift+super+x", () =>
    expect(specKey(spec("super+alt+ctrl+shift+x"))).toBe(specKey(spec("ctrl+alt+shift+super+x"))));
});

describe("ctrl+- canonicalizes to ctrl+_", () => {
  it("the terminal sends one byte (\\x1f) for both, so one spec must win", () => {
    expect(spec("ctrl+-")).toEqual(spec("ctrl+_"));
    expect(spec("ctrl+-").name).toBe("_");
    expect(eventMatches(ev("_", { ctrl: true }), spec("ctrl+-"))).toBe(true);
  });
  it("a bare - is untouched (only the ctrl'd form collapses)", () => {
    expect(spec("-").name).toBe("-");
    expect(spec("alt+-").name).toBe("-");
  });
});

describe("an uppercase letter implies shift", () => {
  it("ctrl+B ≡ ctrl+shift+b", () => {
    expect(spec("ctrl+B")).toEqual(spec("ctrl+shift+b"));
    expect(spec("G")).toEqual({ name: "g", ctrl: false, alt: false, shift: true, super: false });
  });
  it("matches the shift+letter event the parser emits", () => {
    expect(eventMatches(ev("g", { shift: true }), spec("G"))).toBe(true);
    expect(eventMatches(ev("g"), spec("G"))).toBe(false);
  });
  it("non-letters carry no implication — shift+/ arrives as a bare `?`", () =>
    expect(spec("?")).toEqual({ name: "?", ctrl: false, alt: false, shift: false, super: false }));
});

describe("the + key itself", () => {
  it("a trailing + is the name, not a separator", () => {
    expect(spec("+")).toEqual({ name: "+", ctrl: false, alt: false, shift: false, super: false });
    expect(spec("ctrl++")).toEqual({ name: "+", ctrl: true, alt: false, shift: false, super: false });
  });
});

describe("garbage → null", () => {
  it.each([["bogus+x"], ["ctrl+shft+p"], ["ctrl+"], ["ctrl+x ctrl+k"], ["  "], [""]])("parseKeySpec(%j) is null", (s) =>
    expect(parseKeySpec(s)).toBeNull());
  it("a whitespace-separated chord is not a single key — it must go through parseChordSpec", () => {
    expect(parseKeySpec("ctrl+x k")).toBeNull();   // NOT a key named "x k"
    expect(parseKeySpec("a b")).toBeNull();
  });
  it("an unknown *name* is fine — only an unknown *modifier* is garbage", () =>
    expect(parseKeySpec("bogus")).not.toBeNull());
});

describe("chords split on whitespace", () => {
  it("ctrl+x ctrl+k is two specs", () => {
    const c = parseChordSpec("ctrl+x ctrl+k");
    expect(c).toEqual([{ name: "x", ctrl: true, alt: false, shift: false, super: false },
                       { name: "k", ctrl: true, alt: false, shift: false, super: false }]);
  });
  it("a single key is a one-element chord, and surrounding/repeated whitespace is ignored", () => {
    expect(parseChordSpec("escape")).toEqual([spec("escape")]);
    expect(parseChordSpec("  ctrl+x \t ctrl+k  ")).toEqual(parseChordSpec("ctrl+x ctrl+k"));
  });
  it("one bad member poisons the whole chord; an empty chord is null", () => {
    expect(parseChordSpec("ctrl+x bogus+k")).toBeNull();
    expect(parseChordSpec("   ")).toBeNull();
    expect(parseChordSpec("")).toBeNull();
  });
});

describe("eventMatches is strict on name + all four modifiers", () => {
  it("every modifier must agree", () => {
    expect(eventMatches(ev("p", { ctrl: true }), spec("ctrl+p"))).toBe(true);
    expect(eventMatches(ev("p", { ctrl: true, alt: true }), spec("ctrl+p"))).toBe(false);
    expect(eventMatches(ev("p", { ctrl: true }), spec("ctrl+alt+p"))).toBe(false);
    expect(eventMatches(ev("p", { super: true }), spec("alt+p"))).toBe(false);
  });
  it("an alt spec matches an alt event — the meta fusion already happened at parse time", () =>
    expect(eventMatches(ev("d", { alt: true }), spec("meta+d"))).toBe(true));
  it("the name must match too", () =>
    expect(eventMatches(ev("up"), spec("down"))).toBe(false));
});

describe("display formatting", () => {
  it("round-trips through the canonical alias", () =>
    expect(formatKeySpec(parseKeySpec("meta+d")!)).toBe("alt+d"));
  it("modifiers print in the canonical ctrl+alt+shift+super order regardless of how they were written", () => {
    expect(formatKeySpec(spec("shift+ctrl+p"))).toBe("ctrl+shift+p");
    expect(formatKeySpec(spec("super+shift+alt+ctrl+x"))).toBe("ctrl+alt+shift+super+x");
    expect(formatKeySpec(spec("shift+tab"))).toBe("shift+tab");
    expect(formatKeySpec(spec("cmd+c"))).toBe("super+c");
  });
  it("specKey and formatKeySpec agree, so a hint string is also the dedup key", () =>
    expect(specKey(spec("ctrl+B"))).toBe(formatKeySpec(spec("ctrl+shift+b"))));
  it("formatChord joins with spaces and re-parses to the same chord", () => {
    const c = parseChordSpec("ctrl+x ctrl+k")!;
    expect(formatChord(c)).toBe("ctrl+x ctrl+k");
    expect(parseChordSpec(formatChord(c))).toEqual(c);
    expect(formatChord(parseChordSpec("CTRL+X META+K")!)).toBe("ctrl+shift+x alt+shift+k");
  });
});
