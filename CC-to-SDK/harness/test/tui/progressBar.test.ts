// harness/test/tui/progressBar.test.ts — T-CH34: the OSC 9;4 terminal progress bar.
//
// Two subjects, kept in separate describe blocks because they are independent gates (research report §2):
// `progressBarCapability` (canon's `Wnr()`, L199046) decides whether ANY byte reaches the terminal at all,
// and `createProgressBar`'s driver (canon's `m6h`, L558744) decides WHICH state to ask for. A test that
// only ever exercises one gate through the other would leave the second one's dead branch unproven.
import { describe, expect, it } from "vitest";
import { progressBarCapability, createProgressBar } from "../../src/tui/progressBar.js";
import { PROGRESS_STATE } from "../../src/tui/terminalEscapes.js";

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("progressBarCapability — canon's Wnr() (L199046), transcribed faithfully", () => {
  it("iTerm2 below 3.6.6 is OFF, at or above is ON", () => {
    expect(progressBarCapability(E({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.6.5" }))).toBe(false);
    expect(progressBarCapability(E({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.6.6" }))).toBe(true);
    expect(progressBarCapability(E({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.7.0" }))).toBe(true);
  });
  it("Ghostty below 1.2.0 is OFF, at or above is ON", () => {
    expect(progressBarCapability(E({ TERM_PROGRAM: "ghostty", TERM_PROGRAM_VERSION: "1.1.0" }))).toBe(false);
    expect(progressBarCapability(E({ TERM_PROGRAM: "ghostty", TERM_PROGRAM_VERSION: "1.2.0" }))).toBe(true);
  });
  it("ConEmu is unconditionally ON, via any one of its three markers", () => {
    expect(progressBarCapability(E({ ConEmuANSI: "ON" }))).toBe(true);
    expect(progressBarCapability(E({ ConEmuPID: "123" }))).toBe(true);
    expect(progressBarCapability(E({ ConEmuTask: "{cmd}" }))).toBe(true);
  });
  it("Windows Terminal is EXPLICITLY excluded — WT_SESSION wins even over a name it would otherwise never match", () => {
    expect(progressBarCapability(E({ WT_SESSION: "1" }))).toBe(false);
    // Same env, WT_SESSION removed: nothing else names a supported terminal, so still false — proves the
    // exclusion isn't just "unmatched name", it's checked and wins ahead of everything else too.
    expect(progressBarCapability(E({ WT_SESSION: "1", ConEmuANSI: "ON" }))).toBe(false);
  });
  it("tmux overwrites TERM_PROGRAM to \"tmux\", which matches none of the three named emulators — OFF, and "
    + "that is canon's OWN behavior (decided, not a marker-sniff fallback like desktopNotify's)", () => {
    expect(progressBarCapability(E({ TERM_PROGRAM: "tmux", TMUX: "/tmp/s,1,0" }))).toBe(false);
  });
  it("an unrecognised TERM_PROGRAM, or none at all, is OFF", () => {
    expect(progressBarCapability(E({ TERM_PROGRAM: "Apple_Terminal", TERM_PROGRAM_VERSION: "440" }))).toBe(false);
    expect(progressBarCapability(E({}))).toBe(false);
  });
  it("a version canon's own coerce could not parse (no digit anywhere) fails the gate", () => {
    expect(progressBarCapability(E({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "unknown" }))).toBe(false);
  });
});

describe("createProgressBar — the driver, canon's m6h (L558744) over the writer (research report §2)", () => {
  function harness(capability = true, env: NodeJS.ProcessEnv = {}) {
    const writes: string[] = [];
    const bar = createProgressBar({ write: (s) => writes.push(s), capability, env });
    return { bar, writes };
  }

  it("capability OFF: the driver never writes anything, active or not, enabled or not", () => {
    const { bar, writes } = harness(false);
    bar.update({ enabled: true, active: true });
    bar.update({ enabled: true, active: false });
    bar.clear();
    expect(writes).toEqual([]);
  });

  it("first mount emits exactly one CLEAR — canon's ref starts null, m6h('completed') on the first pass", () => {
    const { bar, writes } = harness();
    bar.update({ enabled: true, active: false });
    expect(writes).toEqual(["\x1b]9;4;0;\x07"]);
  });

  it("idle -> turn start emits INDETERMINATE exactly once, not per re-render (no per-frame spam)", () => {
    const { bar, writes } = harness();
    bar.update({ enabled: true, active: false });               // mount: CLEAR
    bar.update({ enabled: true, active: true });                 // turn start: INDETERMINATE
    bar.update({ enabled: true, active: true });                 // a re-render with the SAME inputs — no-op
    bar.update({ enabled: true, active: true });
    expect(writes).toEqual(["\x1b]9;4;0;\x07", "\x1b]9;4;3;\x07"]);
  });

  it("turn settle emits CLEAR — 'completed' is a CLEAR, never a 100% bar", () => {
    const { bar, writes } = harness();
    bar.update({ enabled: true, active: false });
    bar.update({ enabled: true, active: true });
    writes.length = 0;
    bar.update({ enabled: true, active: false });
    expect(writes).toEqual(["\x1b]9;4;0;\x07"]);
  });

  it("setting toggled off mid-turn emits CLEAR once, then goes silent even while still 'active'", () => {
    const { bar, writes } = harness();
    bar.update({ enabled: true, active: true });                 // INDETERMINATE
    writes.length = 0;
    bar.update({ enabled: false, active: true });                // off -> CLEAR
    bar.update({ enabled: false, active: true });                // still off, still "active" -> silence
    bar.update({ enabled: false, active: false });                // still off -> silence
    expect(writes).toEqual(["\x1b]9;4;0;\x07"]);
  });

  it("clear() always writes, bypassing the change-dedupe — canon's unconditional ut(null) on unmount", () => {
    const { bar, writes } = harness();
    bar.update({ enabled: true, active: false });                // mount CLEAR
    writes.length = 0;
    bar.clear();                                                  // already CLEAR, but unmount still writes
    expect(writes).toEqual(["\x1b]9;4;0;\x07"]);
  });

  it("live emissions are DCS-wrapped for tmux; the driver goes through passthrough() like every other "
    + "hook-path write (only the teardown constant bypasses it)", () => {
    const { bar, writes } = harness(true, E({ TMUX: "/tmp/s,1,0" }));
    bar.update({ enabled: true, active: true });
    expect(writes.some((w) => w.startsWith("\x1bPtmux;"))).toBe(true);
  });

  it("picks ST under a kitty terminator, BEL otherwise — via notifyTerminator, no internal sniff of its own", () => {
    const kitty = harness(true, E({ TERM: "xterm-kitty" }));
    kitty.bar.update({ enabled: true, active: true });
    expect(kitty.writes[0]!.endsWith("\x1b\\")).toBe(true);
    const bare = harness(true, {});
    bare.bar.update({ enabled: true, active: true });
    expect(bare.writes[0]!.endsWith("\x07")).toBe(true);
  });
});
