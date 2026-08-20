// harness/test/unit/terminal-title.test.ts — Wave C Task 8 (EP-C4a): the OSC 0 terminal-title writer.
//
// This file pins BYTES, not prose. Upstream assembles the sequence at runtime (`Mv`, bundle L148174) out of
// `Oas = "\x1B]"`, the code `Bb.SET_TITLE_AND_ICON = 0`, `Ilt = ";"` and `M5 = "\x07"`, so the only way to
// know the port emits the same thing is to spell the escape out here and compare it whole. OSC 0 (icon name
// AND window title), BEL-terminated, never OSC 2, never DCS-wrapped for tmux.
//
// The 960 ms frame flip (`abm`, L549863) is driven through the injected `setInterval`/`clearInterval` seam
// (plan constraint 15) — no vitest fake timers and no `await sleep`, so a mistake in when the writer arms or
// disarms its interval fails deterministically.
import { describe, it, expect } from "vitest";
import {
  createTerminalTitle, resolveTerminalTitle,
  TERMINAL_TITLE_BUSY_FRAMES, TERMINAL_TITLE_CLEAR, TERMINAL_TITLE_FALLBACK,
  TERMINAL_TITLE_FRAME_MS, TERMINAL_TITLE_IDLE_PREFIX,
} from "../../src/tui/terminalTitle.js";

/** The `deps` seam driven synthetically. `fire()` runs every armed interval once — the writer only ever arms
 *  one, so "one tick of the animation" and "one call to fire" are the same event. `armed` is what proves the
 *  interval is CLEARED on idle rather than left spinning against a prefix that no longer changes. */
function harness(env: NodeJS.ProcessEnv = {}) {
  const writes: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let seq = 0;
  const title = createTerminalTitle({
    write: (s) => { writes.push(s); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearInterval: (h) => { timers.delete(h as number); },
    env,
  });
  return {
    title, writes,
    armed: (): number => timers.size,
    /** Every armed interval's period — one entry while busy, so a test can pin the 960 ms itself. */
    periods: (): number[] => [...timers.values()].map((t) => t.ms),
    fire(times = 1): void { for (let i = 0; i < times; i++) for (const t of [...timers.values()]) t.fn(); },
  };
}

/** The sequence a title of `text` must produce, spelled from the parts rather than pasted, so the constants
 *  and the expectation cannot drift apart silently. */
const osc = (text: string): string => `\x1b]0;${text}\x07`;

describe("the OSC 0 escape itself (`Mv` + `Bb.SET_TITLE_AND_ICON`, bundle L148174/L148427)", () => {
  it("writes `\\x1b]0;✳ <title>\\x07` at idle — OSC 0, one space after the prefix, BEL-terminated", () => {
    const h = harness();
    h.title.setTitle("ccx");
    expect(h.writes).toEqual(["\x1b]0;✳ ccx\x07"]);
    expect(h.writes[0]).toBe(osc(`${TERMINAL_TITLE_IDLE_PREFIX} ccx`));
  });

  it("is never OSC 2 and never wrapped in the tmux/screen DCS passthrough", () => {
    const h = harness();
    h.title.setTitle("a project");
    h.title.setBusy(true);
    h.title.clear();
    for (const w of h.writes) {
      expect(w.startsWith("\x1b]0;")).toBe(true);
      expect(w).not.toContain("\x1b]2;");
      expect(w).not.toContain("\x1bPtmux;");
      expect(w.endsWith("\x07")).toBe(true);
      expect(w).not.toContain("\x1b\\");             // the kitty ST variant is a recorded skip: BEL everywhere
    }
  });

  it("keeps BEL under kitty — the title does NOT follow canon's ST rule (Wave C's recorded skip)", () => {
    // F8 T2 characterization. The recorded skip lives in prose two files away (terminalEscapes.ts's
    // terminator-is-a-parameter note); this pins it in bytes, so recomposing the write onto the shared
    // builder cannot quietly acquire canon's kitty rule along with it.
    const h = harness({ TERM: "xterm-kitty" });
    h.title.setTitle("work");
    expect(h.writes.at(-1)).toBe("\x1b]0;✳ work\x07");
  });

  it("clears to the empty title on exit (`a0u`, L148428)", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.clear();
    expect(h.writes.at(-1)).toBe("\x1b]0;\x07");
    expect(TERMINAL_TITLE_CLEAR).toBe("\x1b]0;\x07");
  });

  it("strips ANSI and control bytes out of the title so a coloured string cannot break the sequence", () => {
    const h = harness();
    h.title.setTitle("\x1b[31mred\x1b[0m\x07 title\n");
    expect(h.writes).toEqual([osc("✳ red title")]);
  });
});

describe("the busy prefix animation (`dhi`/`phi` L549523/L549863, `abm = 960`)", () => {
  it("swaps ✳ for the first braille frame the moment a turn starts, keeping the title", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    expect(h.writes.at(-1)).toBe(osc(`${TERMINAL_TITLE_BUSY_FRAMES[0]} ccx`));
    expect(h.writes.at(-1)).toBe("\x1b]0;⠂ ccx\x07");
  });

  it("alternates ⠂ ↔ ⠐ every 960 ms, and only while busy", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    expect(h.armed()).toBe(1);
    expect(h.periods()).toEqual([TERMINAL_TITLE_FRAME_MS]);
    h.fire(); expect(h.writes.at(-1)).toBe(osc("⠐ ccx"));
    h.fire(); expect(h.writes.at(-1)).toBe(osc("⠂ ccx"));
    h.fire(); expect(h.writes.at(-1)).toBe(osc("⠐ ccx"));
  });

  it("runs NO timer while idle — the interval exists only for the duration of a turn", () => {
    const h = harness();
    h.title.setTitle("ccx");
    expect(h.armed()).toBe(0);
    h.title.setBusy(true); expect(h.armed()).toBe(1);
    h.title.setBusy(false); expect(h.armed()).toBe(0);
  });

  it("reverts the prefix at turn end but KEEPS the title (upstream never restores the fallback)", () => {
    const h = harness();
    h.title.setTitle("Fix login button");
    h.title.setBusy(true);
    h.fire();
    h.title.setBusy(false);
    expect(h.writes.at(-1)).toBe(osc("✳ Fix login button"));
  });

  it("re-emits under the BUSY prefix when the title changes mid-turn", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    h.title.setTitle("Fix login button");
    expect(h.writes.at(-1)).toBe(osc("⠂ Fix login button"));
  });
});

describe("reduced motion (F8 T6) — the STARTUP `deps.reducedMotion`, not a live resolver read", () => {
  it("does not alternate the busy prefix under reduced motion", () => {
    const writes: string[] = [];
    let fire: (() => void) | undefined;
    const title = createTerminalTitle({
      write: (s) => writes.push(s), reducedMotion: true,
      setInterval: (fn) => { fire = fn; return 1; }, clearInterval: () => {},
    });
    title.setTitle("work"); title.setBusy(true);
    expect(fire).toBeUndefined();                        // no animation timer armed at all
    expect(writes.at(-1)).toBe("\x1b]0;✳ work\x07");     // the IDLE prefix, held
  });

  it("animates normally when reducedMotion is absent or explicitly false", () => {
    const h = harness();                                  // harness()'s deps carry no `reducedMotion` at all
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    expect(h.armed()).toBe(1);
    expect(h.writes.at(-1)).toBe(osc(`${TERMINAL_TITLE_BUSY_FRAMES[0]} ccx`));
    h.fire();
    expect(h.writes.at(-1)).toBe(osc(`${TERMINAL_TITLE_BUSY_FRAMES[1]} ccx`));
  });
});

describe("dedupe — one write per CHANGE of the composed string", () => {
  it("ignores a repeated setTitle with the same text", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setTitle("ccx");
    h.title.setTitle("ccx");
    expect(h.writes).toHaveLength(1);
  });

  it("ignores a repeated setBusy(true) and does not arm a second interval", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    h.title.setBusy(true);
    h.title.setBusy(true);
    expect(h.writes).toHaveLength(2);
    expect(h.armed()).toBe(1);
  });

  it("ignores setBusy(false) while already idle, and a second clear()", () => {
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(false);
    expect(h.writes).toHaveLength(1);
    h.title.clear(); h.title.clear();
    expect(h.writes).toHaveLength(2);
  });

  it("a busy tick that composes the SAME string as the last write does not double-write", () => {
    // Reached by setting the title back to what the tick already painted: the tick wrote `⠐ ccx`, and the
    // setTitle below recomposes exactly that. Without a last-written guard this would emit a duplicate.
    const h = harness();
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    h.fire();
    const before = h.writes.length;
    h.title.setTitle("ccx");
    expect(h.writes).toHaveLength(before);
  });
});

describe("CLAUDE_CODE_DISABLE_TERMINAL_TITLE (`G`, L547561 — `CVe(null)` is a no-op)", () => {
  it("suppresses every write, INCLUDING the exit clear, and arms no timer", () => {
    const h = harness({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1" });
    h.title.setTitle("ccx");
    h.title.setBusy(true);
    h.fire(3);
    h.title.setTitle("Fix login button");
    h.title.setBusy(false);
    h.title.clear();
    expect(h.writes).toEqual([]);
    expect(h.armed()).toBe(0);
  });

  it("stays off for an empty-string value too — upstream tests the env var for truthiness", () => {
    const off = harness({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "" });
    off.title.setTitle("ccx");
    expect(off.writes).toEqual([osc("✳ ccx")]);      // "" is falsy, so titles stay ON
    const on = harness({ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "0" });
    on.title.setTitle("ccx");
    expect(on.writes).toEqual([]);                   // any non-empty value, "0" included, is the kill switch
  });
});

describe("the precedence ladder (`Ht = mo ?? dl ?? mk ?? Ql ?? \"Claude Code\"`, L547730)", () => {
  it("prefers the /rename title over everything", () => {
    expect(resolveTerminalTitle({ renameTitle: "Renamed", aiTitle: "Topic", name: "worker" })).toBe("Renamed");
  });
  it("falls to the engine ai-title when nothing was renamed", () => {
    expect(resolveTerminalTitle({ aiTitle: "Topic", name: "worker" })).toBe("Topic");
  });
  it("falls to --name when there is no ai-title yet", () => {
    expect(resolveTerminalTitle({ name: "worker" })).toBe("worker");
  });
  it("falls to the literal `ccx` when nothing is known", () => {
    expect(resolveTerminalTitle({})).toBe("ccx");
    expect(resolveTerminalTitle({})).toBe(TERMINAL_TITLE_FALLBACK);
  });
  it("treats blank rungs as absent — an empty rename must not blank the tab", () => {
    expect(resolveTerminalTitle({ renameTitle: "  ", aiTitle: "Topic" })).toBe("Topic");
    expect(resolveTerminalTitle({ renameTitle: "", aiTitle: "", name: "" })).toBe("ccx");
  });
  it("the writer applies the same fallback when handed undefined", () => {
    const h = harness();
    h.title.setTitle(undefined);
    expect(h.writes).toEqual([osc("✳ ccx")]);
  });
});
