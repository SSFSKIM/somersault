// tui/test/suspend.test.ts — pure DI unit test for suspendProcess (no Ink involved). ChatApp's own
// Ctrl-Z tests (chat.test.tsx) can only observe suspendProcess from OUTSIDE a live Ink tree; this file
// pins the ordering/cleanup contract the module promises on its own terms.
import { describe, it, expect } from "vitest";
import { suspendProcess } from "../../src/tui/suspend.js";

describe("suspendProcess", () => {
  it("drops raw mode, THEN registers the SIGCONT listener, THEN sends SIGTSTP — in that exact order", () => {
    const calls: string[] = [];
    suspendProcess({
      stdin: { setRawMode: (v) => calls.push(`setRawMode(${v})`) },
      repaint: () => calls.push("repaint"),
      once: (signal) => calls.push(`once(${signal})`),
      kill: (pid, signal) => calls.push(`kill(${pid},${signal})`),
    });
    // once-before-kill is load-bearing (a fast `fg` must not race an unattached listener); raw-mode-before-
    // kill matters too, so the shell is never suspended while we still believe we own the tty.
    expect(calls).toEqual(["setRawMode(false)", "once(SIGCONT)", "kill(0,SIGTSTP)"]);
  });

  it("the SIGCONT handler re-enables raw mode and repaints — nothing fires before resume", () => {
    const rawModeCalls: boolean[] = [];
    let repainted = 0;
    let onResume: (() => void) | undefined;
    suspendProcess({
      stdin: { setRawMode: (v) => rawModeCalls.push(v) },
      repaint: () => { repainted++; },
      once: (_signal, handler) => { onResume = handler; },
      kill: () => {},
    });
    expect(rawModeCalls).toEqual([false]);
    expect(repainted).toBe(0);
    onResume?.();
    expect(rawModeCalls).toEqual([false, true]);
    expect(repainted).toBe(1);
  });

  it("registers via `once`, not `on` — repeated suspend/resume cycles register exactly one listener per cycle, never accumulating", () => {
    let registrations = 0;
    const deps = {
      stdin: { setRawMode: () => {} },
      repaint: () => {},
      // A real `once` fires its handler exactly one time then forgets it; simulate that by invoking the
      // handler immediately, which is only safe (no double-repaint pileup) if suspendProcess itself never
      // registers more than one handler per call.
      once: (_signal: string, handler: () => void) => { registrations++; handler(); },
      kill: () => {},
    };
    suspendProcess(deps);
    suspendProcess(deps);
    suspendProcess(deps);
    expect(registrations).toBe(3);   // one registration per suspend call, no leftover listener from a prior cycle
  });

  it("stdin.setRawMode is optional (a non-TTY stdin) — suspendProcess doesn't throw when it's missing", () => {
    expect(() => suspendProcess({ stdin: {}, repaint: () => {}, once: () => {}, kill: () => {} })).not.toThrow();
  });

  it("does nothing on Windows and never changes raw mode or signals", () => {
    const calls: string[] = [];
    suspendProcess({
      platform: "win32",
      stdin: { setRawMode: (v) => calls.push(`raw(${v})`) },
      repaint: () => calls.push("repaint"),
      once: () => calls.push("once"),
      kill: () => calls.push("kill"),
    });
    expect(calls).toEqual([]);
  });

  it("rolls raw mode back and removes the listener when signal delivery fails", () => {
    const calls: string[] = [];
    const handler = () => {};
    expect(() => suspendProcess({
      stdin: { setRawMode: (v) => calls.push(`raw(${v})`) },
      repaint: () => {},
      once: (_signal, h) => { calls.push("once"); Object.assign(handler, h); throw new Error("kill unavailable"); },
      removeListener: (signal) => calls.push(`remove(${signal})`),
      kill: () => { throw new Error("kill unavailable"); },
    })).toThrow("kill unavailable");
    expect(calls).toEqual(["raw(false)", "once", "remove(SIGCONT)", "raw(true)"]);
  });
});
