// test/unit/alt-screen.test.ts — FSW Task 6. The alt-screen lifecycle and THE EXIT GUARANTEE.
//
// Every byte assertion below is a LITERAL, never a comparison of a constant to itself: the point of the
// suite is that `src/tui/altScreen.ts` agrees with the 2.1.220 bundle, and a test that reads the constant
// it is checking cannot detect a drift. Canon lines are cited per assertion and were re-read from
// ~/claude-code-bundle/2.1.220/cli.pretty.js while writing them.
import { describe, it, expect, vi } from "vitest";
import {
  ENTER_ALT, EXIT_ALT, MOUSE_OFF, CURSOR_SHOW, KITTY_TERMINALS,
  kittyUpgrade, createAltScreenGuard, resumePointer, exitAltScreen,
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

  // canon `nV = mY(ev.CURSOR_VISIBLE)` L177070 (mode 25), written by the terminal-mode restore `Uho`
  // (L180343) on the way out.
  it("CURSOR_SHOW is DECTCEM set", () => {
    expect(CURSOR_SHOW).toBe("\x1b[?25h");
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

  // The divergence is deliberate and recorded in spec §A6: canon (L366419) prints `claude ${worktree}--resume`
  // and dims it; ours names our own binary and stays plain so a piped/redirected shell sees clean text.
  it("resumePointer is canon's two lines, naming ccx", () => {
    expect(resumePointer("0d7a7a9d-1111-2222-3333-444455556666"))
      .toBe("Resume this session with:\nccx --resume 0d7a7a9d-1111-2222-3333-444455556666\n");
  });
});

describe("AltScreenGuard lifecycle", () => {
  it("enter writes smcup+clear+home with the terminal's upgrade appended, as ONE write", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "ghostty" });
    expect(g.active()).toBe(false);
    g.enter();
    expect(s.writes).toEqual(["\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m"]);
    expect(g.active()).toBe(true);
  });

  it("enter on an unlisted terminal writes the bare enter sequence", () => {
    const s = sink();
    createAltScreenGuard({ writeSync: s.writeSync, termProgram: "Apple_Terminal" }).enter();
    expect(s.writes).toEqual(["\x1b[?1049h\x1b[2J\x1b[H"]);
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

  it("exit turns the mouse off FIRST, then rmcups, then shows the cursor", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync, termProgram: "kitty" });
    g.enter();
    s.writes.length = 0;
    g.exit();
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",   // canon Gpe, unconditional and first (zuy L181498)
      "\x1b[<u\x1b[?1049l\x1b[>4m",                     // canon nj  (L177100)
      "\x1b[?25h",                                      // canon nV  (Uho L180343)
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
      "\x1b[?25h",
    ]);
    expect(g.active()).toBe(false);
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
    expect(s.writes).toEqual([
      "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
      "\x1b[<u\x1b[?1049l\x1b[>4m",
      "<spawnSync>",
      "\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m",
    ]);
    expect(g.active()).toBe(true);      // the guard still owns the screen across the handoff
  });

  it("re-enters even when the child throws", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    s.writes.length = 0;
    expect(() => g.aroundSubprocess(() => { throw new Error("editor died"); })).toThrow("editor died");
    expect(s.writes.at(-1)).toBe("\x1b[?1049h\x1b[2J\x1b[H");
  });

  it("is a bare passthrough when the guard was never armed", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    expect(g.aroundSubprocess(() => "ok")).toBe("ok");
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

  it("registers SIGINT — the signal ccx has never handled — and cleans up before exiting 130", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    const before = process.listenerCount("SIGINT");
    const stop = g.installSignalSafety();
    try {
      expect(process.listenerCount("SIGINT")).toBe(before + 1);
      s.writes.length = 0;
      withExitSpy((calls) => {
        lastListener("SIGINT")();
        expect(s.writes).toEqual([
          "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l",
          "\x1b[<u\x1b[?1049l\x1b[>4m",
          "\x1b[?25h",
        ]);
        expect(calls).toEqual([130]);
      });
    } finally { stop(); }
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("does NOT double-register SIGTERM/SIGHUP when an owner (cli/main.ts:405) already has them", () => {
    const s = sink();
    const mine = () => {};
    process.on("SIGTERM", mine); process.on("SIGHUP", mine);
    const term = process.listenerCount("SIGTERM"), hup = process.listenerCount("SIGHUP");
    const stop = createAltScreenGuard({ writeSync: s.writeSync }).installSignalSafety();
    try {
      expect(process.listenerCount("SIGTERM")).toBe(term);
      expect(process.listenerCount("SIGHUP")).toBe(hup);
    } finally { stop(); process.off("SIGTERM", mine); process.off("SIGHUP", mine); }
  });

  it("DOES take SIGTERM/SIGHUP when nobody owns them (ccx attach has no host and no handler)", () => {
    const s = sink();
    const parked = { SIGTERM: process.listeners("SIGTERM"), SIGHUP: process.listeners("SIGHUP") };
    process.removeAllListeners("SIGTERM"); process.removeAllListeners("SIGHUP");
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    const stop = g.installSignalSafety();
    try {
      expect(process.listenerCount("SIGTERM")).toBe(1);
      s.writes.length = 0;
      withExitSpy((calls) => { lastListener("SIGTERM")(); expect(calls).toEqual([143]); });
      expect(s.writes[0]).toBe("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
      expect(s.writes.at(-2)).toBe("\x1b[<u\x1b[?1049l\x1b[>4m");
    } finally {
      stop();
      for (const l of parked.SIGTERM) process.on("SIGTERM", l as never);
      for (const l of parked.SIGHUP) process.on("SIGHUP", l as never);
    }
  });

  // The last-resort net: an uncaught throw never reaches any `finally`, and Node emits `exit` on its way
  // down. writeSync is the only kind of work legal there, which is exactly what the guard does.
  it("also cleans up on process 'exit', and the disposer removes every listener it added", () => {
    const s = sink();
    const g = createAltScreenGuard({ writeSync: s.writeSync });
    g.enter();
    const before = process.listenerCount("exit");
    const stop = g.installSignalSafety();
    expect(process.listenerCount("exit")).toBe(before + 1);
    s.writes.length = 0;
    (process.listeners("exit").at(-1) as () => void)();
    expect(s.writes).toHaveLength(3);
    stop();
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("an unarmed guard's handlers write nothing at all", () => {
    const s = sink();
    const stop = createAltScreenGuard({ writeSync: s.writeSync }).installSignalSafety();
    try { withExitSpy(() => { lastListener("SIGINT")(); }); } finally { stop(); }
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
      "\x1b[?25h",
      "Resume this session with:\nccx --resume abc-123\n",
    ]);
    expect(out).toEqual(["Resume this session with:\nccx --resume abc-123\n"]);
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
    expect(s.writes.at(-1)).toBe("Resume this session with:\nccx --resume detach-1\n");
    expect(s.writes.at(-2)).toBe("\x1b[?25h");
    expect(out[0]).toBe("detached — session keeps running");   // the notice, then the teardown
  });
});
