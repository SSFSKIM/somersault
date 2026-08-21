// test/unit/alt-screen.test.ts — FSW Task 6. The alt-screen lifecycle and THE EXIT GUARANTEE.
//
// Every byte assertion below is a LITERAL, never a comparison of a constant to itself: the point of the
// suite is that `src/tui/altScreen.ts` agrees with the 2.1.220 bundle, and a test that reads the constant
// it is checking cannot detect a drift. Canon lines are cited per assertion and were re-read from
// ~/claude-code-bundle/2.1.220/cli.pretty.js while writing them.
import { describe, it, expect, vi } from "vitest";
import {
  ENTER_ALT, EXIT_ALT, MOUSE_OFF, MOUSE_ON_SCROLL, CURSOR_SHOW, PASTE_OFF, SGR_RESET, KITTY_TERMINALS,
  kittyUpgrade, resolveTerminalName, createAltScreenGuard, resumePointer, exitAltScreen,
  createChatTeardown,
} from "../../src/tui/altScreen.js";

/** A recording writeSync sink — the DI seam the guard takes instead of touching fd 1. */
function sink() {
  const writes: string[] = [];
  return { writes, writeSync: (s: string) => { writes.push(s); } };
}

describe("alt-screen bytes (canon 2.1.220)", () => {
  // canon `pVe()` L177097 → `uho + h1 + fI + Ybe()`, with `uho = mY(ev.ALT_SCREEN_CLEAR)` (L177070,
  // `ev.ALT_SCREEN_CLEAR = 1049`, `mY(e) = uA("?" + e + "h")` L177051), `h1 = uA(2, "J")` (L166402) and
  // `fI = uA("H")` (L166401). `uA` prefixes `Lps = X7 + CSI` — `X7 = "\x1B"` (L148086).
  it("ENTER_ALT is smcup + erase-all + home, and carries NO kitty upgrade of its own", () => {
    expect(ENTER_ALT).toBe("\x1b[?1049h\x1b[2J\x1b[H");
  });

  // canon `nj()` L177100 → `mUe + S2u + nVe`: `mUe = uA("<u")` (L166403, pop the kitty keyboard stack),
  // `S2u = Kbe(ev.ALT_SCREEN_CLEAR)` (L177070, `Kbe(e) = uA("?" + e + "l")` L177054),
  // `nVe = uA(">4m")` (L166403, modifyOtherKeys reset).
  it("EXIT_ALT pops kitty, rmcups, and resets modifyOtherKeys — in that order", () => {
    expect(EXIT_ALT).toBe("\x1b[<u\x1b[?1049l\x1b[>4m");
  });

  // canon `Gpe` L177070 → `Kbe(MOUSE_SGR) + Kbe(MOUSE_ANY) + Kbe(MOUSE_BUTTON) + Kbe(MOUSE_NORMAL)`,
  // modes 1006 / 1003 / 1002 / 1000 (`ev`, L177069). The ORDER is canon's, SGR first.
  it("MOUSE_OFF disables all four tracking modes, SGR first", () => {
    expect(MOUSE_OFF).toBe("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
  });

  // canon `ncy` L177070 → `mY(MOUSE_NORMAL) + mY(MOUSE_SGR)`, modes 1000 and 1006, which is exactly what
  // `AUe("scroll")` (L177057-177061) returns. The name is canon's own for this subset. NOT `rcy`/`"full"`,
  // which adds 1002 and 1003 (button-drag and any-motion tracking) for hover and click — a recorded divergence,
  // because ccx has no hover and no click targets and would only be paying for a motion flood.
  //   IT DOES NOT BUY BACK NATIVE SELECTION, and the comment must not claim it does: mode 1000 alone routes
  // press and release to the application, so drag-to-select inside fullscreen needs the terminal's override
  // modifier (Shift on xterm-family, Option on iTerm2/Terminal.app) at this width just as it does at canon's.
  it("MOUSE_ON_SCROLL is canon's `scroll` set — wheel reporting plus SGR encoding, and nothing else", () => {
    expect(MOUSE_ON_SCROLL).toBe("\x1b[?1000h\x1b[?1006h");
  });

  // canon `nV = mY(ev.CURSOR_VISIBLE)` L177070 (mode 25), written by the terminal-mode restore `Uho`
  // (L180343) on the way out.
  it("CURSOR_SHOW is DECTCEM set", () => {
    expect(CURSOR_SHOW).toBe("\x1b[?25h");
  });

  // canon `Usr = Kbe(ev.BRACKETED_PASTE)` L177070 (mode 2004), written by the same terminal-mode restore
  // `Uho` (L180343) one write ahead of `nV`. The crash path is the whole reason it is here: KeymapProvider
  // turns 2004 ON and only turns it off in an effect cleanup, which a throwing unmount never reaches.
  it("PASTE_OFF is DECRST 2004 — bracketed paste, off unconditionally", () => {
    expect(PASTE_OFF).toBe("\x1b[?2004l");
  });

  // canon L180654's leave writes `\x1B[0m\x1B[?25h` before handing the terminal to the child.
  it("SGR_RESET is the bare SGR reset", () => {
    expect(SGR_RESET).toBe("\x1b[0m");
  });

  // canon `ocy` L177175 — the seven terminals that get the upgrade, verbatim and in canon's order.
  it("the kitty-upgrade terminal list is canon's seven, in canon's order", () => {
    expect([...KITTY_TERMINALS]).toEqual(
      ["iTerm.app", "kitty", "WezTerm", "ghostty", "tmux", "windows-terminal", "WarpTerminal"]);
  });

  // canon `Ybe()` L177094 → `icy() ? mUe + vNu + TNu : ""`, with `vNu = uA(">1u")` and
  // `TNu = uA(">4;2m")` (L166403) and `icy(e) = ocy.includes(e ?? …)` (L177092).
  it("kittyUpgrade pushes the keyboard stack and modifyOtherKeys=2 for each of the seven", () => {
    for (const term of ["iTerm.app", "kitty", "WezTerm", "ghostty", "tmux", "windows-terminal", "WarpTerminal"])
      expect(kittyUpgrade(term)).toBe("\x1b[<u\x1b[>1u\x1b[>4;2m");
  });

  it("kittyUpgrade is empty for an unlisted terminal and for no terminal at all", () => {
    expect(kittyUpgrade("Apple_Terminal")).toBe("");
    expect(kittyUpgrade("")).toBe("");
    expect(kittyUpgrade(undefined)).toBe("");
  });

  // FIX ROUND F5. The list is canon's; the GATE INPUT was `TERM_PROGRAM` alone, and kitty does not set it —
  // so the terminal the feature is named after could never take the upgrade. Canon feeds `Ybe()` from
  // `oeh()` (L22139-22210), whose ordered reads these mirror for the subset that can name one of the seven.
  it("resolveTerminalName reads TERM before TERM_PROGRAM, as canon does", () => {
    expect(resolveTerminalName({ TERM: "xterm-ghostty", TERM_PROGRAM: "Apple_Terminal" })).toBe("ghostty");
    expect(resolveTerminalName({ TERM: "xterm-kitty" })).toBe("kitty");
    expect(resolveTerminalName({ TERM: "xterm-256color", TERM_PROGRAM: "WezTerm" })).toBe("WezTerm");
  });

  it("resolveTerminalName falls through to the env facts that carry no TERM_PROGRAM", () => {
    expect(resolveTerminalName({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
    expect(resolveTerminalName({ WT_SESSION: "abc" })).toBe("windows-terminal");
    expect(resolveTerminalName({ TMUX: "/tmp/tmux-501/default,1,0" })).toBe("tmux");
    expect(resolveTerminalName({})).toBeUndefined();
    expect(resolveTerminalName({ TERM: "xterm-256color" })).toBeUndefined();
  });

  it("the resolved name is what actually earns the upgrade — kitty by window id, ghostty by TERM", () => {
    expect(kittyUpgrade(resolveTerminalName({ KITTY_WINDOW_ID: "1" }))).toBe("\x1b[<u\x1b[>1u\x1b[>4;2m");
    expect(kittyUpgrade(resolveTerminalName({ TERM: "xterm-ghostty" }))).toBe("\x1b[<u\x1b[>1u\x1b[>4;2m");
    expect(kittyUpgrade(resolveTerminalName({ TERM: "xterm-256color" }))).toBe("");
  });

  // Three deliberate divergences from canon L366419, and only three: our binary's name, no dim (a piped or
  // redirected shell sees clean text), and — as of the fix round — NOTHING ELSE. The leading newline is
  // canon's and is back: after rmcup the cursor is restored to its pre-smcup position, so without it the
  // hint prints flush against the command line that launched us.
  it("resumePointer is canon's blank line and two lines, naming ccx", () => {
    expect(resumePointer("0d7a7a9d-1111-2222-3333-444455556666"))
      .toBe("\nResume this session with:\nccx --resume 0d7a7a9d-1111-2222-3333-444455556666\n");
  });
});

describe("AltScreenGuard lifecycle", () => {
  // FSW BACKLOG 5 — AND THE MOUSE COMES ON WITH THE SCREEN. Canon's alt-screen mount is `pVe() + AUe(mode)`
  // (L535814): the enter bytes, then the tracking enable, in one write. Ours appends `AUe("scroll")` to the
  // same string for the same reason, and that placement is the whole of the change: `enterSeq` is ALSO the
  // handoff's return leg, and every leave/teardown leg already writes MOUSE_OFF, so the editor/suspend round
  // trips and the `/tui` flips stay symmetric with no new call site to keep in step.
  it("enter writes smcup+clear+home, the terminal's upgrade and mouse-on, as ONE write", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "ghostty" });
    expect(g.active()).toBe(false);
    g.enter();
    expect(s.writes).toEqual(["\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m\x1b[?1000h\x1b[?1006h"]);
    expect(g.active()).toBe(true);
  });

  it("enter on an unlisted terminal writes the bare enter sequence, mouse-on still appended", () => {
    const s = sink();
    createAltScreenGuard({ writeSync: s.writeSync, termProgram: "Apple_Terminal" }).enter();
    expect(s.writes).toEqual(["\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h"]);
  });

  // THE PAIR THAT MUST NOT DRIFT. The enable is armed in exactly one place and disarmed in three (exit,
  // leave, handoff), and a terminal left reporting is the one damage this module exists to prevent — so the
  // symmetry is pinned as a property rather than re-asserted byte by byte at each site.
  it.each([["exit", (g: ReturnType<typeof createAltScreenGuard>) => g.exit()],
           ["leave", (g: ReturnType<typeof createAltScreenGuard>) => g.leave()],
           ["handoff", (g: ReturnType<typeof createAltScreenGuard>) => { g.handoff(); }]] as const)(
    "every %s leg turns the mouse back off, first", (_name, act) => {
      const s = sink();
      const g = createAltScreenGuard({ writeSync: s.writeSync });
      g.enter();
      expect(s.writes.join("")).toContain(MOUSE_ON_SCROLL);
      s.writes.length = 0;
      act(g);
      expect(s.writes[0]).toBe(MOUSE_OFF);
      expect(s.writes.join("")).not.toContain(MOUSE_ON_SCROLL);
    });

  // A guard that never took the screen never armed the mouse either — a classic launch must not emit a
  // tracking enable it would then owe a disable for.
  it("an unarmed guard writes no mouse-on at all", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.leave(); g.handoff()();
    expect(s.writes).toEqual([]);
  });

  it("a second enter is a no-op — the flag guards a re-entry that would clear the frame", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter(); g.enter();
    expect(s.writes).toHaveLength(1);
  });

  // The unarmed case: T9 arms the guard by CALLING enter() under the fullscreen renderer. A classic launch
  // never does, and then every other method must be inert — no stray rmcup into a terminal we never took.
  it("an unarmed guard writes NOTHING on exit and stays inactive", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.exit();
    expect(s.writes).toEqual([]);
    expect(g.active()).toBe(false);
  });

  it("exit turns the mouse off FIRST, then rmcups, then ends bracketed paste and shows the cursor", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "kitty" });
    g.enter();
    s.writes.length = 0;
    g.exit();
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",   // canon Gpe, unconditional and first (zuy L181498)
      "\x1b[<u\x1b[?1049l\x1b[>4m",                     // canon nj  (L177100)
      "\x1b[?2004l",                                    // canon Usr (Uho L180343) — F5 fix round
      "\x1b[?25h",                                      // canon nV  (Uho L180343), Usr's neighbour there too
    ]);
    expect(g.active()).toBe(false);
  });

  it("exit is idempotent — a crash path may race the finally", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter(); g.exit();
    const after = s.writes.length;
    g.exit();
    expect(s.writes).toHaveLength(after);
  });

  // canon `zuy` L181494-181509: mouse off, THEN `try { e.unmount() } catch { writeSync(nj()) }`. The
  // guarantee is that a renderer that throws on the way down cannot cost the user their terminal.
  it("a throwing unmount still gets MOUSE_OFF first and the hand-written rmcup after", () => {
    const s = sink();
    const g = createAltScreenGuard({
      writeSync: s.writeSync,
      unmount: () => { s.writes.push("<unmount threw>"); throw new Error("ink is gone"); },
    });
    g.enter();
    s.writes.length = 0;
    expect(() => g.exit()).not.toThrow();
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "<unmount threw>",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "\x1b[?2004l",
      "\x1b[?25h",
    ]);
    expect(g.active()).toBe(false);
  });

  // F2. The bracketed-paste pair is KeymapProvider's (`keys/KeymapProvider.tsx:326`/`:352`): DECSET 2004 on
  // at mount, off in an effect cleanup that a throwing unmount never runs. Leaked, every later paste into
  // the user's shell arrives wrapped in a literal `200~…201~` — the same durability as leaked mouse
  // reporting, and the reason this byte is on the unconditional side of the try/catch.
  it("bracketed paste is turned off even when the renderer's own cleanup never runs", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, unmount: () => { throw new Error("ink is gone"); } });
    g.enter();
    s.writes.length = 0;
    g.exit();
    expect(s.writes).toContain("\x1b[?2004l");
  });
});

describe("AltScreenGuard.aroundSubprocess", () => {
  it("hands the main screen back before the child and takes it again after — value passed through", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "WezTerm" });
    g.enter();
    s.writes.length = 0;
    const out = g.aroundSubprocess(() => { s.writes.push("<spawnSync>"); return 42; });
    expect(out).toBe(42);
    // F3 fix round: the child gets a VISIBLE cursor and a clean SGR. Ink's log-update hides the cursor on
    // every render (`ink/build/log-update.js:9`) and only shows it in `done()`, so without these two bytes
    // `$EDITOR` / `!bash` / the `v` dump ran with an invisible one. Canon's leave writes exactly this pair,
    // in this order, at L180654.
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "\x1b[0m",
      "\x1b[?25h",
      "<spawnSync>",
      "\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m\x1b[?1000h\x1b[?1006h",
    ]);
    expect(g.active()).toBe(true);      // the guard still owns the screen across the handoff
  });

  it("re-enters even when the child throws", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    s.writes.length = 0;
    expect(() => g.aroundSubprocess(() => { throw new Error("editor died"); })).toThrow("editor died");
    expect(s.writes.at(-1)).toBe("\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h");
  });

  it("is a bare passthrough when the guard was never armed", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    expect(g.aroundSubprocess(() => "ok")).toBe("ok");
    expect(s.writes).toEqual([]);
  });
});

// FSW T14, AMENDMENT 3 — the same handoff with its two halves in the caller's hands. ctrl+z cannot use the
// wrapper: the stop and the resume are separated by a round trip through the shell's job control, so there is
// no `run()` to wrap. `handoff()` is what `aroundSubprocess` is written in terms of, which is the point — one
// definition of the byte order, two callers.
describe("AltScreenGuard.handoff", () => {
  it("writes the leave immediately and the return only when the caller says so", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "WezTerm" });
    g.enter();
    s.writes.length = 0;
    const back = g.handoff();
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "\x1b[0m",
      "\x1b[?25h",
    ]);
    expect(g.active()).toBe(true);      // still ours across the stop: a kill while suspended must find a guard
    back();
    expect(s.writes.at(-1)).toBe("\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m\x1b[?1000h\x1b[?1006h");
  });

  it("hands back a no-op on an unarmed guard, so a classic ctrl+z writes nothing", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.handoff()();
    expect(s.writes).toEqual([]);
  });
});

describe("installSignalSafety", () => {
  /** Runs `body` with process.exit stubbed, and always disposes the handlers it installed. */
  function withExitSpy<T>(body: (calls: number[]) => T): T {
    const calls: number[] = [];
    const spy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { calls.push(code ?? 0); }) as never);
    try { return body(calls); } finally { spy.mockRestore(); }
  }
  const lastListener = (sig: string) => process.listeners(sig as NodeJS.Signals).at(-1) as () => void;
  const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  /** Run `body` with the runner's own signal handlers parked, so "does this guard register?" is answerable
   *  by a listener COUNT — and put every one of them back afterwards, guard's listeners included. */
  function withNoSignalOwners<T>(body: () => T): T {
    const parked = Object.fromEntries(SIGNALS.map((s) => [s, process.listeners(s)])) as Record<string, unknown[]>;
    for (const s of SIGNALS) process.removeAllListeners(s);
    try { return body(); } finally {
      for (const s of SIGNALS) { process.removeAllListeners(s); for (const l of parked[s]!) process.on(s, l as never); }
    }
  }

  // FIX ROUND F4/F8. `signalsOwned` replaces the `listenerCount(sig) > 0` sniff. The predicate the guard
  // actually needs is not "is a listener attached" but "will somebody drain my cleanup before exiting" —
  // and only the caller knows, because it is the caller that both registers the handler (cli/main.ts:418)
  // and holds the `beforeExit` array the handler drains. Sniffing conflated the two: a launch that owned
  // the signal but passed no array got no cleanup at all, silently.
  it("registers all three signals when nobody owns them (ccx attach: no host, no handler, no array)", () => {
    const s = sink();
    withNoSignalOwners(() => {
      const g = createAltScreenGuard({ writeSync: s.writeSync });
      g.enter();
      const stop = g.installSignalSafety();
      try { for (const sig of SIGNALS) expect(process.listenerCount(sig)).toBe(1); } finally { stop(); }
      for (const sig of SIGNALS) expect(process.listenerCount(sig)).toBe(0);
    });
  });

  it("registers NONE of them when the launch owns them and drains the guard itself (cli/main.ts:418)", () => {
    const s = sink();
    withNoSignalOwners(() => {
      const g = createAltScreenGuard({ writeSync: s.writeSync, signalsOwned: true });
      g.enter();
      const stop = g.installSignalSafety();
      try { for (const sig of SIGNALS) expect(process.listenerCount(sig)).toBe(0); } finally { stop(); }
    });
  });

  it("SIGINT — the signal ccx has never handled — cleans up before exiting 130", () => {
    const s = sink();
    withNoSignalOwners(() => {
      const g = createAltScreenGuard({ writeSync: s.writeSync });
      g.enter();
      const stop = g.installSignalSafety();
      try {
        s.writes.length = 0;
        withExitSpy((calls) => {
          lastListener("SIGINT")();
          expect(s.writes).toEqual([
            "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
            "\x1b[<u\x1b[?1049l\x1b[>4m",
            "\x1b[?2004l",
            "\x1b[?25h",
          ]);
          expect(calls).toEqual([130]);
        });
      } finally { stop(); }
    });
  });

  it("SIGTERM hands the screen back and exits 143", () => {
    const s = sink();
    withNoSignalOwners(() => {
      const g = createAltScreenGuard({ writeSync: s.writeSync });
      g.enter();
      const stop = g.installSignalSafety();
      try {
        s.writes.length = 0;
        withExitSpy((calls) => { lastListener("SIGTERM")(); expect(calls).toEqual([143]); });
        expect(s.writes[0]).toBe("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
        expect(s.writes.at(-3)).toBe("\x1b[<u\x1b[?1049l\x1b[>4m");
      } finally { stop(); }
    });
  });

  // The last-resort net: an uncaught throw never reaches any `finally`, and Node emits `exit` on its way
  // down. Synchronous `writeSync` is the ONLY legal work there — which is why this limb, alone among the
  // three, does not attempt the renderer's unmount (fix round, review ruling (d)): Ink's `unmount()` runs
  // `onRender`, `log.done()` and React unmount effects through `stdout.write`, and an exit handler is no
  // place to find out whether that stream still flushes synchronously. The bytes are the guarantee.
  it("also cleans up on process 'exit' — pure bytes, no unmount — and the disposer removes what it added", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, unmount: () => { s.writes.push("<unmount>"); } });
    g.enter();
    const before = process.listenerCount("exit");
    const stop = g.installSignalSafety();
    expect(process.listenerCount("exit")).toBe(before + 1);
    s.writes.length = 0;
    (process.listeners("exit").at(-1) as () => void)();
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "\x1b[?2004l",
      "\x1b[?25h",
    ]);
    stop();
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("an unarmed guard's handlers write nothing at all", () => {
    const s = sink();
    withNoSignalOwners(() => {
      const stop = createAltScreenGuard({ writeSync: s.writeSync }).installSignalSafety();
      try { withExitSpy(() => { lastListener("SIGINT")(); }); } finally { stop(); }
    });
    expect(s.writes).toEqual([]);
  });
});

describe("exitAltScreen — the one teardown every REPL exit funnels through", () => {
  it("prints the resume pointer AFTER rmcup, onto the main screen", () => {
    const s = sink(); const out: string[] = [];
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    s.writes.length = 0;
    exitAltScreen(g, "abc-123", (t) => { out.push(t); s.writes.push(t); });
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "\x1b[?2004l",
      "\x1b[?25h",
      "\nResume this session with:\nccx --resume abc-123\n",
    ]);
    expect(out).toEqual(["\nResume this session with:\nccx --resume abc-123\n"]);
  });

  it("prints nothing when the guard was never armed — the classic renderer keeps today's silent exit", () => {
    const s = sink(); const out: string[] = [];
    exitAltScreen(createAltScreenGuard({ writeSync: s.writeSync }), "abc-123", (t) => out.push(t));
    expect(out).toEqual([]);
    expect(s.writes).toEqual([]);
  });

  it("prints nothing when there is no session id to point at", () => {
    const s = sink(); const out: string[] = [];
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    exitAltScreen(g, undefined, (t) => out.push(t));
    expect(out).toEqual([]);
  });

  // m5 carry-forward. `/exit`, the double-ctrl-C arm and `ccx attach`'s onDetach all reach the shell the
  // same way: they call Ink's `exit()`, which settles `waitUntilExit()`, whose `finally` is this call. The
  // pin is that the DETACH arm is not a bypass — it lands on the same teardown, pointer included.
  it("onDetach lands on the same exit path as a graceful quit (m5)", async () => {
    const s = sink(); const out: string[] = [];
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    s.writes.length = 0;
    let resolveExit!: () => void;
    const waitUntilExit = new Promise<void>((r) => { resolveExit = r; });
    const onDetach = () => { out.push("detached — session keeps running"); resolveExit(); };
    const run = (async () => {
      try { await waitUntilExit; }
      finally { exitAltScreen(g, "detach-1", (t) => { out.push(t); s.writes.push(t); }); }
    })();
    onDetach();
    await run;
    expect(s.writes.at(-1)).toBe("\nResume this session with:\nccx --resume detach-1\n");
    expect(s.writes.at(-2)).toBe("\x1b[?25h");
    expect(out[0]).toBe("detached — session keeps running");   // the notice, then the teardown
  });
});

// ── FIX ROUND F1/F7 — THE WHOLE EXIT, IN ONE LATCHED ORDER ────────────────────────────────────────────
// The defect this closes: `chatMain`'s `finally` held the title reset and the cursor unpark, and the SIGNAL
// path did not run it — it pushed `altGuard.exit()` into `beforeExit` instead. But `exit()`'s unmount limb
// resolves Ink's `waitUntilExit()`, so the `finally` ran anyway, one microtask later — i.e. AFTER rmcup, on
// the user's own shell screen, where the unpark's `\x1b[2K` erases a line of it. Nine steps, traced by the
// reviewer against the compiled guard. There is now ONE teardown, both paths call it, and the second call
// is a no-op.
describe("createChatTeardown", () => {
  /** The whole exit as a recorded byte/effect log: the guard's writeSync and the main-screen writer share
   *  one array, which is the only way "before rmcup" and "after rmcup" are comparable at all. */
  function harness(opts: { parkedColumn?: number; sessionId?: string | undefined } = {}) {
    const parkedColumn = opts.parkedColumn ?? 117;
    const sessionId = "sessionId" in opts ? opts.sessionId : "sig-1";
    const log: string[] = [];
    const guard = createAltScreenGuard({ writeSync: (t) => log.push(t) });
    guard.enter();
    log.length = 0;
    const teardown = createChatTeardown({
      offResizeListener: () => log.push("<resize listener off>"),
      stopResize: () => log.push("<resize.stop>"),
      clearTitle: () => log.push("<title.clear>"),
      clearProgress: () => log.push("<progress.clear>"),
      parkedColumn: () => parkedColumn,
      stopSignalSafety: () => log.push("<signal safety off>"),
      guard, sessionId: () => sessionId, write: (t) => log.push(t),
    });
    return { log, teardown };
  }

  it("paints everything it is going to paint BEFORE rmcup, and the pointer after", () => {
    const { log, teardown } = harness();
    teardown();
    expect(log).toEqual([
      "<resize listener off>",
      "<resize.stop>",
      "<title.clear>",
      "<progress.clear>",                               // T-CH34 — beside clearTitle, both near-side of rmcup
      "\x1b[2K\x1b[G",                                  // the unpark — the write the trace caught landing late
      "<signal safety off>",
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",                     // RMCUP: nothing above may follow it, spec §A6
      "\x1b[?2004l",
      "\x1b[?25h",
      "\nResume this session with:\nccx --resume sig-1\n",
    ]);
    const rmcup = log.indexOf("\x1b[<u\x1b[?1049l\x1b[>4m");
    expect(log.indexOf("<title.clear>")).toBeLessThan(rmcup);
    expect(log.indexOf("\x1b[2K\x1b[G")).toBeLessThan(rmcup);
    expect(log.findIndex((l) => l.startsWith("\nResume"))).toBeGreaterThan(rmcup);
  });

  // The latch is the fix's other half: the signal path drains this out of `beforeExit`, the guard's unmount
  // settles `waitUntilExit()`, and the `finally` then calls the SAME function. It must be silent.
  it("is once-latched — the second call writes nothing", () => {
    const { log, teardown } = harness();
    teardown();
    const after = [...log];
    teardown();
    expect(log).toEqual(after);
  });

  it("skips the unpark when the cursor is not parked, and the pointer when there is no session", () => {
    const { log, teardown } = harness({ parkedColumn: 0, sessionId: undefined });
    teardown();
    expect(log).not.toContain("\x1b[2K\x1b[G");
    expect(log.some((l) => l.includes("Resume this session"))).toBe(false);
    expect(log.at(-1)).toBe("\x1b[?25h");
  });

  // The classic launch (the guard never armed): the resize and title obligations are still real, the
  // terminal ones are not — no rmcup for a screen we never took, and no pointer either.
  it("still stops the resize machinery and clears the title when the guard was never armed", () => {
    const log: string[] = [];
    const guard = createAltScreenGuard({ writeSync: (t) => log.push(t) });
    createChatTeardown({
      offResizeListener: () => log.push("<resize listener off>"),
      stopResize: () => log.push("<resize.stop>"),
      clearTitle: () => log.push("<title.clear>"),
      clearProgress: () => log.push("<progress.clear>"),
      parkedColumn: () => 117,
      stopSignalSafety: () => log.push("<signal safety off>"),
      guard, sessionId: () => "quiet-1", write: (t) => log.push(t),
    })();
    expect(log).toEqual(["<resize listener off>", "<resize.stop>", "<title.clear>", "<progress.clear>", "\x1b[2K\x1b[G", "<signal safety off>"]);
  });

  // T-CH34 — the graceful-exit half of the two mandated teardown call sites (report §4d's `createChatTeardown`
  // insertion point). Gated on CAPABILITY only, never on `terminalProgressBarEnabled` — a debt to the terminal,
  // not a feature — so this dep is a plain callback the CALLER (chatMain.tsx) has already gated; this suite
  // only proves the STEP is in the sequence, beside clearTitle, before rmcup.
  it("runs clearProgress exactly once, beside clearTitle and strictly before rmcup", () => {
    const { log, teardown } = harness();
    teardown();
    expect(log.filter((l) => l === "<progress.clear>")).toHaveLength(1);
    expect(log.indexOf("<progress.clear>")).toBe(log.indexOf("<title.clear>") + 1);
    expect(log.indexOf("<progress.clear>")).toBeLessThan(log.indexOf("\x1b[<u\x1b[?1049l\x1b[>4m"));
  });
});

describe("installSignalSafety's process-'exit' limb — the un-armed-gated progress-bar CLEAR (T-CH34)", () => {
  // "Un-armed-gated" is the brief's own word for the shape: this limb runs on EVERY process exit regardless
  // of `armed` (a classic, non-fullscreen launch never calls `handBack`, so a limb living THERE would never
  // fire for it — research report §4d's flagged gap), gated on CAPABILITY alone, matching canon's own `dsi()`
  // (never on `terminalProgressBarEnabled`: a debt to the terminal, not a feature).
  it("writes the unwrapped teardown constant on 'exit' even when the guard was NEVER armed", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, progressBarCapability: true });
    // deliberately no g.enter() — a classic launch
    const stop = g.installSignalSafety();
    s.writes.length = 0;
    (process.listeners("exit").at(-1) as () => void)();
    expect(s.writes).toEqual(["\x1b]9;4;0;\x07"]);   // PROGRESS_TEARDOWN_CLEAR, and NOTHING else — unarmed writes no other byte
    stop();
  });

  it("writes it ALONGSIDE the armed teardown's own bytes when the guard WAS armed", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, progressBarCapability: true });
    g.enter();
    const stop = g.installSignalSafety();
    s.writes.length = 0;
    (process.listeners("exit").at(-1) as () => void)();
    expect(s.writes).toContain("\x1b]9;4;0;\x07");
    expect(s.writes).toContain("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");   // MOUSE_OFF still there too
    stop();
  });

  it("writes NOTHING when capability is false/absent — the flag is the gate, not `armed`", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });   // no progressBarCapability at all
    const stop = g.installSignalSafety();
    s.writes.length = 0;
    (process.listeners("exit").at(-1) as () => void)();
    expect(s.writes).toEqual([]);
    stop();
  });
});
