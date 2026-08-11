// tui/test/keys-parse.test.ts — the byte-level keypress parser (F2 task 1). Fixtures are ported from the
// P86 live matrix (docs/superpowers/research/2026-07-31-tui-clone/09-p86-ink-input-matrix.md §1): every byte
// string below was actually fed to a pty there. Where an expectation differs from what Ink's parse-keypress
// produced it is a DELIBERATE upgrade to upstream Claude Code's naming (P86 §4): \x00→ctrl+space (not
// ctrl+backtick), \x08→ctrl+h (not "backspace"), \x7f→backspace (not "delete"), \x1b\r→shift+enter.
import { describe, it, expect } from "vitest";
import { parseBytes } from "../../src/tui/keys/parse.js";

const one = (b: string) => { const ev = parseBytes(b); expect(ev).toHaveLength(1); return ev[0]; };

describe("navigation", () => {
  it.each([["\x1b[H","home"],["\x1bOH","home"],["\x1b[1~","home"],["\x1b[F","end"],["\x1bOF","end"],["\x1b[4~","end"],
           ["\x1b[5~","pageup"],["\x1b[6~","pagedown"],["\x1b[2~","insert"],["\x1b[3~","delete"]])("%s → %s", (b, n) => {
    const e = one(b); expect(e).toMatchObject({ kind: "key", name: n, ctrl: false, alt: false, shift: false, super: false });
  });
  it.each([["\x1b[A","up"],["\x1b[B","down"],["\x1b[C","right"],["\x1b[D","left"],
           ["\x1bOA","up"],["\x1bOB","down"],["\x1bOC","right"],["\x1bOD","left"]])("%s → %s", (b, n) =>
    expect(one(b)).toMatchObject({ kind: "key", name: n, ctrl: false, alt: false, shift: false, super: false }));
  it.each([["\x1bOP","f1"],["\x1bOQ","f2"],["\x1bOR","f3"],["\x1bOS","f4"],
           ["\x1b[11~","f1"],["\x1b[15~","f5"],["\x1b[17~","f6"],["\x1b[21~","f10"],["\x1b[23~","f11"],["\x1b[24~","f12"],
           ["\x1b[7~","home"],["\x1b[8~","end"]])("%s → %s", (b, n) =>
    expect(one(b)).toMatchObject({ kind: "key", name: n }));
});

describe("modified navigation (xterm 1;N — bits shift=1 alt=2 ctrl=4 super=8)", () => {
  it("ctrl+home ≠ ctrl+end", () => {
    expect(one("\x1b[1;5H")).toMatchObject({ name: "home", ctrl: true });
    expect(one("\x1b[1;5F")).toMatchObject({ name: "end", ctrl: true });
  });
  it("alt+up vs super+up are DISTINCT (the useInput fusion is gone)", () => {
    expect(one("\x1b[1;3A")).toMatchObject({ name: "up", alt: true, super: false });
    expect(one("\x1b[1;9A")).toMatchObject({ name: "up", alt: false, super: true });
  });
  it.each([["\x1b[1;2A","up"],["\x1b[1;2H","home"],["\x1b[1;2F","end"]])("shift+%s", (b, n) =>
    expect(one(b)).toMatchObject({ name: n, shift: true }));
  it.each([["\x1b[1;5A","up"],["\x1b[1;5B","down"],["\x1b[1;5C","right"],["\x1b[1;5D","left"]])("ctrl+%s", (b, n) =>
    expect(one(b)).toMatchObject({ name: n, ctrl: true, shift: false, alt: false }));
  it("the tilde forms carry modifiers too", () => {
    expect(one("\x1b[3;5~")).toMatchObject({ name: "delete", ctrl: true });
    expect(one("\x1b[5;2~")).toMatchObject({ name: "pageup", shift: true });
    expect(one("\x1b[1;7H")).toMatchObject({ name: "home", ctrl: true, alt: true });
  });
});

describe("control bytes", () => {
  it("\\x1f is ctrl+_ (the K39 fix at the parser level; editor's live branch is editor.ts:278)", () =>
    expect(one("\x1f")).toMatchObject({ name: "_", ctrl: true }));
  it.each([["\x1c","\\"],["\x1d","]"],["\x1e","^"]])("0x1c–0x1e → ctrl+%s", (b, n) =>
    expect(one(b)).toMatchObject({ name: n, ctrl: true }));
  it("\\x00 is ctrl+space", () => expect(one("\x00")).toMatchObject({ name: "space", ctrl: true }));
  it("\\x08 is ctrl+h; \\x7f is backspace (upstream naming, not Ink's delete)", () => {
    expect(one("\x08")).toMatchObject({ name: "h", ctrl: true });
    expect(one("\x7f")).toMatchObject({ name: "backspace", ctrl: false });
  });
  it("\\r enter, \\n ctrl+j, \\t tab", () => {
    expect(one("\r")).toMatchObject({ name: "enter" });
    expect(one("\n")).toMatchObject({ name: "j", ctrl: true });
    expect(one("\t")).toMatchObject({ name: "tab" });
  });
  it.each([["\x01","a"],["\x0b","k"],["\x18","x"],["\x1a","z"]])("ctrl+letter", (b, n) =>
    expect(one(b)).toMatchObject({ name: n, ctrl: true }));
  it("enter and tab are not reported as ctrl+m / ctrl+i", () => {
    expect(one("\r")).toMatchObject({ name: "enter", ctrl: false, shift: false, alt: false, super: false });
    expect(one("\t")).toMatchObject({ name: "tab", ctrl: false, shift: false });
  });
});

describe("escape & meta", () => {
  it("bare ESC chunk is escape", () => expect(one("\x1b")).toMatchObject({ name: "escape", alt: false }));
  it.each(["d","p","t","o","w","b","f","y","v","m"])("ESC+%s is alt+letter", (c) =>
    expect(one("\x1b" + c)).toMatchObject({ name: c, alt: true }));
  it("ESC+uppercase carries shift", () => expect(one("\x1bD")).toMatchObject({ name: "d", alt: true, shift: true }));
  it("ESC+DEL is alt+backspace", () => expect(one("\x1b\x7f")).toMatchObject({ name: "backspace", alt: true }));
  it("ESC CR (terminal-setup shift+enter) is shift+enter", () =>
    expect(one("\x1b\r")).toMatchObject({ name: "enter", shift: true }));
  it("shift+tab \\x1b[Z", () => expect(one("\x1b[Z")).toMatchObject({ name: "tab", shift: true }));
  it("ESC ESC is two escapes (the Esc-Esc rewind chord survives one chunk)", () => {
    const ev = parseBytes("\x1b\x1b");
    expect(ev).toHaveLength(2);
    expect(ev.every(e => e.kind === "key" && e.name === "escape" && !e.alt)).toBe(true);
  });
  it("ESC then a digit is still alt+<digit>", () => expect(one("\x1b7")).toMatchObject({ name: "7", alt: true }));
  it("ESC before a control byte is escape, then the control byte itself", () => {
    const ev = parseBytes("\x1b\x01");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ name: "escape" }); expect(ev[1]).toMatchObject({ name: "a", ctrl: true });
  });
});

/** The full four-modifier record, so a spuriously-set extra modifier fails the assertion. */
const mods = (m: { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean } = {}) =>
  ({ ctrl: !!m.ctrl, alt: !!m.alt, shift: !!m.shift, super: !!m.super });

describe("CSI-u (kitty/iTerm2)", () => {
  it.each<[string, string, Record<string, boolean>]>([["\x1b[13;2u","enter",mods({shift:true})],["\x1b[13;5u","enter",mods({ctrl:true})],
           ["\x1b[98;6u","b",mods({ctrl:true,shift:true})],["\x1b[107;9u","k",mods({super:true})],["\x1b[112;9u","p",mods({super:true})]])
    ("%s", (b, n, m) => expect(one(b)).toMatchObject({ kind: "key", name: n, ...m }));
  it("an out-of-range CSI-u codepoint is ignored, not thrown on", () =>
    expect(one("\x1b[9999999u")).toMatchObject({ kind: "ignored", reason: "unknown-sequence" }));
  it("unmodified CSI-u and the named codes", () => {
    expect(one("\x1b[97u")).toMatchObject({ name: "a", ctrl: false, shift: false, alt: false, super: false });
    expect(one("\x1b[9;5u")).toMatchObject({ name: "tab", ctrl: true });
    expect(one("\x1b[27u")).toMatchObject({ name: "escape" });
    expect(one("\x1b[32;5u")).toMatchObject({ name: "space", ctrl: true });
    expect(one("\x1b[127;3u")).toMatchObject({ name: "backspace", alt: true });
  });
  it("an uppercase CSI-u codepoint lowercases and sets shift", () =>
    expect(one("\x1b[66;5u")).toMatchObject({ name: "b", ctrl: true, shift: true }));
});

describe("non-key sequences never leak as text", () => {
  it.each([["\x1b[<64;10;10M","mouse"],["\x1b[<65;10;10M","mouse"],["\x1b[<0;10;10M","mouse"],["\x1b[<0;10;10m","mouse"],
           ["\x1b[I","focus"],["\x1b[O","focus"]])("%s → ignored:%s", (b, r) =>
    expect(one(b)).toMatchObject({ kind: "ignored", reason: r }));
  it("X10 mouse consumes its 3 payload bytes", () =>
    expect(one("\x1b[M\x20\x2a\x2a")).toMatchObject({ kind: "ignored", reason: "mouse" }));
  it("an X10 report truncated at the chunk boundary consumes what there is and does not crash", () =>
    expect(one("\x1b[M\x20")).toMatchObject({ kind: "ignored", reason: "mouse", raw: "\x1b[M\x20" }));
  it("a stray paste close marker is ignored, not inserted", () =>
    expect(one("\x1b[201~")).toMatchObject({ kind: "ignored", reason: "unknown-sequence" }));
  it("an unrecognised private-parameter CSI stops at its final byte and does not eat the next key", () => {
    const ev = parseBytes("\x1b[?1;2cA");                                   // a DA reply arriving mid-typing
    expect(ev.map(e => e.kind)).toEqual(["ignored", "key"]);
    expect(ev[0]).toMatchObject({ reason: "unknown-sequence", raw: "\x1b[?1;2c" });
    expect(ev[1]).toMatchObject({ name: "a", shift: true });
  });
  it("a CSI with intermediate bytes (a DECRQM mode report) stops at its final byte too", () => {
    const ev = parseBytes("\x1b[?2004;1$y\r");
    expect(ev.map(e => e.kind)).toEqual(["ignored", "key"]);
    expect(ev[0]).toMatchObject({ reason: "unknown-sequence", raw: "\x1b[?2004;1$y" });
    expect(ev[1]).toMatchObject({ name: "enter" });
  });
  it("an OSC string is consumed through its BEL terminator, not leaked as alt+] plus text", () => {
    const ev = parseBytes("\x1b]8;;http://x\x07k");
    expect(ev.map(e => e.kind)).toEqual(["ignored", "key"]);
    expect(ev[0]).toMatchObject({ reason: "unknown-sequence", raw: "\x1b]8;;http://x\x07" });
    expect(ev[1]).toMatchObject({ name: "k" });
  });
  it("a DCS string is consumed through its ST terminator, not leaked as alt+p plus text", () => {
    const ev = parseBytes("\x1bP1$r\x1b\\q");
    expect(ev.map(e => e.kind)).toEqual(["ignored", "key"]);
    expect(ev[0]).toMatchObject({ reason: "unknown-sequence", raw: "\x1bP1$r\x1b\\" });
    expect(ev[1]).toMatchObject({ name: "q" });
  });
  it.each([["\x1b_payload\x1b\\","APC"],["\x1b^payload\x1b\\","PM"]])("%s (%s) is ignored whole", (b) =>
    expect(one(b)).toMatchObject({ kind: "ignored", reason: "unknown-sequence", raw: b }));
  it("a string sequence with no terminator in this chunk takes the rest of the chunk", () =>
    expect(one("\x1b]0;title-with-no-st")).toMatchObject({ kind: "ignored", reason: "unknown-sequence" }));
  it("an X10 report followed by text does not swallow the text", () => {
    const ev = parseBytes("\x1b[M\x20\x2a\x2ahi");
    expect(ev.map(e => e.kind)).toEqual(["ignored", "text"]);
    expect(ev[1]).toMatchObject({ text: "hi" });
  });
});

describe("text, paste, chunking", () => {
  it("single printable is a key; multi-char run is text", () => {
    expect(one("a")).toMatchObject({ kind: "key", name: "a" });
    expect(one("G")).toMatchObject({ kind: "key", name: "g", shift: true });
    expect(one("abc")).toMatchObject({ kind: "text", text: "abc" });
  });
  it("a lone space is name:\"space\", the same spelling ctrl+space and CSI-u 32 use", () => {
    expect(one(" ")).toMatchObject({ kind: "key", name: "space", ctrl: false, alt: false, shift: false, super: false });
    expect(one("\x1b ")).toMatchObject({ kind: "key", name: "space", alt: true });
  });
  it("a space inside a text run stays a literal space", () => {
    const e = one("a b");
    expect(e).toMatchObject({ kind: "text", text: "a b" });
  });
  it("bracketed-paste markers are stripped; payload is one text event", () =>
    expect(one("\x1b[200~hello\nworld\x1b[201~")).toMatchObject({ kind: "text", text: "hello\nworld" }));
  it("mixed chunk parses iteratively", () => {
    const ev = parseBytes("\x1b[Aabc\r");
    expect(ev.map(e => e.kind)).toEqual(["key", "text", "key"]);
    expect(ev[0]).toMatchObject({ name: "up" }); expect(ev[2]).toMatchObject({ name: "enter" });
  });
  it("torn CSI tail parses as its own chunk's content, never crashes", () => {
    expect(parseBytes("[5~")).toMatchObject([{ kind: "text", text: "[5~" }]);   // the P86 §1.10 torn case: prior chunk delivered escape
  });
  it("unknown CSI is ignored, not inserted", () =>
    expect(one("\x1b[99;99;99X")).toMatchObject({ kind: "ignored", reason: "unknown-sequence" }));
  it("an empty chunk yields no events", () => expect(parseBytes("")).toEqual([]));
  it("a paste with an unterminated marker still yields its payload", () =>
    expect(one("\x1b[200~tail")).toMatchObject({ kind: "text", text: "tail" }));
  it("an empty paste yields nothing", () => expect(parseBytes("\x1b[200~\x1b[201~")).toEqual([]));
  it("a paste keeps its neighbours as separate events", () => {
    const ev = parseBytes("\x1b[200~hi\x1b[201~\r");
    expect(ev.map(e => e.kind)).toEqual(["text", "key"]);
    expect(ev[0]).toMatchObject({ text: "hi" }); expect(ev[1]).toMatchObject({ name: "enter" });
  });
  it("a lone high-latin1 byte is a single key, and a run of them is text", () => {
    expect(one("\u00e9")).toMatchObject({ kind: "key", name: "\u00e9" });
    expect(one("\u00a0")).toMatchObject({ kind: "key", name: "\u00a0" });
    expect(one("\u00c3\u00a9")).toMatchObject({ kind: "text", text: "\u00c3\u00a9" });
  });
  it("a truncated CSI at the end of a chunk is ignored, not inserted", () =>
    expect(one("\x1b[1;")).toMatchObject({ kind: "ignored", reason: "unknown-sequence" }));
  it("every event carries the exact bytes it consumed as raw", () => {
    expect(one("\x1b[1;5H")).toMatchObject({ raw: "\x1b[1;5H" });
    expect(one("\x1b[M\x20\x2a\x2a")).toMatchObject({ raw: "\x1b[M\x20\x2a\x2a" });
    expect(one("\x1b[200~hi\x1b[201~")).toMatchObject({ raw: "\x1b[200~hi\x1b[201~" });
    expect(parseBytes("\x1b[Aabc\r").map(e => e.raw)).toEqual(["\x1b[A", "abc", "\r"]);
  });
});
