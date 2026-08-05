// tui/test/keys-acceptance.test.tsx — the F2 wave's ACCEPTANCE, executed rather than asserted about
// (spec `2026-07-31-tui-clone-fidelity-design.md` § "F2 — The keymap as data" → Acceptance 1–6). Every other
// keys-*.test file pins one layer of the machine; this one drives the six user-visible promises end to end,
// through real components and raw stdin bytes, so a regression anywhere under them lands here.
//
// Two adjustments to the spec's own wording, both deliberate:
//  * Acceptance 1's example rebinding is `ctrl+g → chat:externalEditor`, which is ALREADY a default — that
//    test would pass with the whole user layer deleted. The NEW binding is `alt+e`; `ctrl+g` is kept as a
//    secondary assertion (the default survives the merge), which is what the example was really saying.
//  * Acceptance 6 is asserted as five separate `toContain` checks, one per unreachable CLASS, rather than one
//    check for the section heading — a heading with an empty body would otherwise satisfy it.
//
// Nothing here touches the real `~/.claude`: acceptance 1 writes a `mkdtemp` home and drives the reload
// through an injected watcher fake (task 9's own discipline), and every other case injects `userLayers`.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Text } from "ink";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { renderWithKeymap } from "./keysTestUtil.js";
import { UserKeymap } from "../../src/tui/keys/UserKeymap.js";
import { useKeyActions, useKeyScope } from "../../src/tui/keys/KeymapProvider.js";
import { loadUserBindings, userBindingsPath, type UserBindingsResult } from "../../src/tui/keys/userBindings.js";
import { parseKeySpec } from "../../src/tui/keys/normalize.js";
import { SHORTCUT_ROWS, defaultLookup, formatBinding } from "../../src/tui/keys/hints.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatStatusBar } from "../../src/tui/ChatStatusBar.js";
import type { KeyEvent } from "../../src/tui/keys/types.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const ESC = "\x1b", CTRL_A = "\x01", CTRL_B = "\x02", CTRL_G = "\x07", CTRL_K = "\x0b", CTRL_X = "\x18";
const ALT_E = "\x1be", ALT_M = "\x1bm", SHIFT_TAB = "\x1b[Z";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
const settle = () => new Promise((r) => setTimeout(r, 30));
/** Wait for a condition but NEVER throw. Use it where the condition is itself the thing under test: the
 *  `expect` that follows then reports the failure with the offending frame, instead of this helper reporting
 *  an opaque "waitFor timeout" from a stack frame that names nothing about what went wrong. */
const settleUntil = async (cond: () => boolean, timeout = 1000): Promise<void> => { await waitFor(cond, timeout).catch(() => {}); };

/** A bare consumer of the table: one Chat scope plus whatever actions the case wants to observe. */
function Probe({ actions }: { actions: Record<string, (e: KeyEvent) => void> }) {
  useKeyScope("Chat");
  useKeyActions(actions);
  return <Text>probe</Text>;
}
/** A `watch` fake that hands the reload callback back to the test (keys-user-keymap.test.tsx's own idiom):
 *  the hot reload is exercised without a 500 ms poll and without watching a real file. */
function fakeWatch() {
  const state = { push: undefined as undefined | ((r: UserBindingsResult) => void) };
  const watch = (_file: string, onChange: (r: UserBindingsResult) => void) => { state.push = onChange; return () => {}; };
  return { state, watch };
}
/** A throwaway `$HOME` with a real `~/.claude/keybindings.json` inside it. The REAL loader reads it, so the
 *  file's JSON shape is under test too — it is simply never the developer's own file. */
function tempHome(): { home: string; file: string; write: (contents: unknown) => void; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "ccx-keys-acceptance-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  const file = userBindingsPath({ home });
  return {
    home, file,
    write: (contents: unknown) => writeFileSync(file, JSON.stringify(contents, null, 2)),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

// ── Acceptance 1 ─────────────────────────────────────────────────────────────────────────────────────
describe("F2 acceptance 1 — ~/.claude/keybindings.json applies live, and `null` unbinds without inheritance", () => {
  it("a binding added to the file reaches the NEXT keypress with no remount, and the defaults survive the merge", async () => {
    const tmp = tempHome();
    try {
      tmp.write({ bindings: [] });
      const external = vi.fn(), cancel = vi.fn();
      const { state, watch } = fakeWatch();
      const h = render(
        <UserKeymap file={tmp.file} deps={{ watch }}>
          <Probe actions={{ "chat:externalEditor": external, "chat:cancel": cancel }} />
        </UserKeymap>,
      );
      await tick();
      h.stdin.write(ALT_E);
      expect(external).not.toHaveBeenCalled();                       // not a default — nothing binds alt+e yet

      tmp.write({ bindings: [{ context: "Chat", bindings: [{ key: "alt+e", action: "chat:externalEditor" }] }] });
      state.push!(loadUserBindings(tmp.file));                       // the watcher's own reload path
      await tick();
      h.stdin.write(ALT_E);
      expect(external).toHaveBeenCalledTimes(1);                     // live, same mount
      h.stdin.write(CTRL_G);
      expect(external).toHaveBeenCalledTimes(2);                     // the ctrl+g DEFAULT survived the additive merge
      h.unmount();
    } finally { tmp.cleanup(); }
  });

  it("`\"escape\": null` in Chat unbinds it, and Global does NOT inherit the key", async () => {
    const tmp = tempHome();
    try {
      // Global binds escape to something observable: without the null, escape would fall through to it, so this
      // proves the resolver STOPS at an explicit unbind rather than continuing down the context array.
      tmp.write({ bindings: [
        { context: "Chat", bindings: { escape: null } },
        { context: "Global", bindings: { escape: "app:toggleTodos" } },
      ] });
      const cancel = vi.fn(), todos = vi.fn();
      const h = render(
        <UserKeymap file={tmp.file} deps={{ watch: fakeWatch().watch }}>
          <Probe actions={{ "chat:cancel": cancel, "app:toggleTodos": todos }} />
        </UserKeymap>,
      );
      await tick();
      h.stdin.write(ESC);
      expect(cancel).not.toHaveBeenCalled();                         // the Chat default is gone
      expect(todos).not.toHaveBeenCalled();                          // …and Global never sees the key
      h.unmount();
    } finally { tmp.cleanup(); }
  });
});

// ── Acceptance 2 ─────────────────────────────────────────────────────────────────────────────────────
describe("F2 acceptance 2 — an open overlay owns the keyboard", () => {
  it("with the `?` overlay open no keypress reaches the chat: the composer buffer is untouched", async () => {
    const h = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    h.stdin.write("?");
    await waitFor(() => frame(h.lastFrame).includes("Keyboard shortcuts"));
    h.stdin.write("hello");
    // …and neither do the ROOT globals, which is the half the composer's absence does not prove: ctrl+o and
    // ctrl+t are `Global` bindings whose handlers are ChatApp's and are mounted right now. Before F0 they
    // fired THROUGH the overlay (the same keystroke closed it and opened the pager); the swallow is what
    // stops them, and this is the assertion that notices if it stops.
    h.stdin.write("\x0f"); h.stdin.write("\x14");
    await settle();
    expect(frame(h.lastFrame)).not.toContain("hello");
    expect(frame(h.lastFrame)).toContain("Keyboard shortcuts");      // still the overlay, nothing behind it acted
    expect(frame(h.lastFrame)).not.toContain("Transcript");          // ctrl+o never reached app:toggleTranscript
    h.stdin.write(ESC);                                              // Help's one binding
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    expect(frame(h.lastFrame)).not.toContain("hello");               // the composer came back EMPTY
    expect(frame(h.lastFrame)).toContain("? help");
    h.unmount();
  });

  // NB on what the transcript-anchor assertions below are and are NOT: they are a CHEAP structural witness,
  // not a scroll guard that could catch a regression on its own. `j`/`k` are bound only in the `Transcript`
  // context, which is not on the stack while this picker is up, so "the transcript did not scroll" cannot
  // fail here however the ownership rules break. The load-bearing half is the selection moving — that is the
  // half that goes red if the picker stops owning the keyboard.
  it("with a picker open, j/k move its own selection", async () => {
    const fake = fakeRemote();
    const h = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "message", data: { type: "assistant", message: { content: [{ type: "text", text: "transcript-anchor-line" }] } } });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });
    await waitFor(() => frame(h.lastFrame).includes("transcript-anchor-line"));
    fake.pushEvent({ kind: "tasks_changed", tasks: [
      { task_id: "task-aaa", task_type: "bash", description: "alpha-task" },
      { task_id: "task-bbb", task_type: "bash", description: "beta-task" },
    ] });
    await waitFor(() => frame(h.lastFrame).includes("⚙ 2 bg"));
    h.stdin.write(CTRL_B);                                           // idle ctrl+b opens the panel (Select context)
    await waitFor(() => stripAnsi(frame(h.lastFrame)).includes("Shells (2)"));
    const selected = (): string => stripAnsi(frame(h.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "";
    expect(selected()).toContain("alpha-task");
    h.stdin.write("j");
    await waitFor(() => selected().includes("beta-task"));
    expect(frame(h.lastFrame)).toContain("transcript-anchor-line");  // j never reached a scroll action
    h.stdin.write("k");
    await waitFor(() => selected().includes("alpha-task"));
    expect(frame(h.lastFrame)).toContain("transcript-anchor-line");
    expect(frame(h.lastFrame)).not.toContain("Transcript");          // no pager opened underneath
    h.unmount();
  });
});

// ── Acceptance 3 ─────────────────────────────────────────────────────────────────────────────────────
describe("F2 acceptance 3 — the ctrl+x chord machine, on the real chat surface", () => {
  /** The provider's chord clock, injected: `armed` is the 1 s expiry callback, fired by hand so the "two
   *  seconds later" arm needs no real wait and no `vi.useFakeTimers()` (which would stall Ink's own render). */
  function chordClock() {
    const state = { armed: null as null | (() => void), ms: 0 };
    const setT = ((fn: () => void, ms?: number) => { state.armed = fn; state.ms = ms ?? 0; return 1 as unknown as ReturnType<typeof setTimeout>; }) as unknown as typeof setTimeout;
    const clearT = (() => { state.armed = null; }) as unknown as typeof clearTimeout;
    return { state, deps: { setTimeout: setT, clearTimeout: clearT } };
  }

  it("ctrl+x then ctrl+k stops all agents; escape cancels the pending chord; an expired chord does nothing", async () => {
    const stopped: string[] = [];
    const fake = fakeRemote({ stopBgTask: async (id: string) => { stopped.push(id); } });
    const clock = chordClock();
    const h = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />, clock.deps);
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "d1" }] });
    await waitFor(() => frame(h.lastFrame).includes("⚙ 1 bg"));

    // The arm notice is a TRANSCRIPT line, so it stays on screen once printed — the detector is how many
    // times it has been printed, plus what actually got stopped, never "the text is absent".
    const arms = (): number => stripAnsi(frame(h.lastFrame)).split("\n").filter((l) => l.includes("again to stop background agents")).length;

    // (a) within the window: the chord completes and killAgents runs (first press arms its own confirm).
    h.stdin.write(CTRL_X);
    expect(clock.state.ms).toBe(1000);
    h.stdin.write(CTRL_K);
    await waitFor(() => arms() === 1);
    h.stdin.write(CTRL_X); h.stdin.write(CTRL_K);
    await waitFor(() => stopped.length === 1);
    expect(stopped).toEqual(["t1"]);

    // (b) escape cancels: the pending head is dropped, so the NEXT ctrl+k is an ordinary key again.
    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "t2", task_type: "bash", description: "d2" }] });
    await waitFor(() => frame(h.lastFrame).includes("⚙ 1 bg"));
    h.stdin.write(CTRL_X);
    h.stdin.write(ESC);
    h.stdin.write(CTRL_K);
    await settle();
    expect(arms()).toBe(1);                                          // no second chord completed
    expect(stopped).toEqual(["t1"]);

    // (c) the 1 s window elapses between the two keys: the completion fires nothing at all.
    h.stdin.write(CTRL_X);
    clock.state.armed?.();                                           // the chord timeout, two seconds later
    h.stdin.write(CTRL_K);
    await settle();
    expect(arms()).toBe(1);
    expect(stopped).toEqual(["t1"]);
    h.unmount();
  });
});

// ── Acceptance 4 ─────────────────────────────────────────────────────────────────────────────────────
// The chip parenthetical follows upstream's own trigger rule (`04-chrome.md` §1.2 rung 10 and §1.3): it is
// printed only for a NON-DEFAULT mode, so a fresh session's footer carries none at all. Every case below
// therefore drives the ladder off `default` FIRST — with the very key under test, which makes the same
// keystroke prove two things at once: the rebinding fires, and the hint it rewrote names the key that fired.
describe("F2 acceptance 4 — rebinding an action rewrites its hints, with no code change", () => {
  const MOVE_CYCLE_MODE = [{ context: "Chat" as const, bindings: { "shift+tab": null, "alt+m": "chat:cycleMode" } }];

  it("a default-mode session prints no parenthetical; the first cycle is what brings it on", async () => {
    const h = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    expect(stripAnsi(frame(h.lastFrame))).toContain("mode default");
    expect(stripAnsi(frame(h.lastFrame))).not.toContain("to cycle");    // upstream: default mode, no rung 10
    expect(stripAnsi(frame(h.lastFrame))).toContain("⇧Tab mode");       // the composer ladder is mode-independent
    h.stdin.write(SHIFT_TAB);
    await settleUntil(() => stripAnsi(frame(h.lastFrame)).includes("mode acceptEdits"));
    expect(stripAnsi(frame(h.lastFrame))).toContain("mode acceptEdits");
    expect(stripAnsi(frame(h.lastFrame))).toContain("⇧Tab to cycle");   // the DEFAULT hint, derived
    h.unmount();
  });

  it("the footer mode chip and the shortcuts-overlay row both follow chat:cycleMode to alt+m", async () => {
    const h = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: MOVE_CYCLE_MODE },
    );
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    expect(stripAnsi(frame(h.lastFrame))).toContain("Alt-M mode");             // composer footer ladder
    h.stdin.write(SHIFT_TAB);                                                  // the unbound default does nothing
    await settle();
    expect(stripAnsi(frame(h.lastFrame))).toContain("mode default");
    h.stdin.write(ALT_M);                                                      // …the user's own key cycles
    await settleUntil(() => stripAnsi(frame(h.lastFrame)).includes("mode acceptEdits"));
    const bar = stripAnsi(frame(h.lastFrame));
    expect(bar).toContain("mode acceptEdits");                                 // the rebinding FIRES, not just prints
    expect(bar).toContain("Alt-M to cycle");                                   // status-bar mode chip
    expect(bar).not.toContain("⇧Tab");
    h.stdin.write("?");
    await waitFor(() => frame(h.lastFrame).includes("Keyboard shortcuts"));
    const overlay = stripAnsi(frame(h.lastFrame));
    expect(overlay).toContain("Alt-M");                                        // the overlay row moved too
    expect(overlay).not.toContain("⇧Tab");
    h.unmount();
  });

  it("an action the user unbinds outright shows as unbound instead of keeping a stale literal", async () => {
    const h = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Global", bindings: { "ctrl+t": null } }] },
    );
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    h.stdin.write("?");
    await waitFor(() => frame(h.lastFrame).includes("Keyboard shortcuts"));
    const overlay = stripAnsi(frame(h.lastFrame));
    const todoRow = overlay.split("\n").find((l) => l.includes("todo panel")) ?? "";
    expect(todoRow).toContain("(unbound)");
    expect(todoRow).not.toContain("Ctrl-T");
    h.unmount();
  });

  it("two rows that unbind to the SAME key column render as two rows, with no duplicate React key", async () => {
    // `chat:cancel` owns two grid rows (the busy interrupt and the Esc-Esc clear/rewind). Unbind it and both
    // print `(unbound)` — identical strings. The overlay used to key its rows BY that rendered string, so the
    // list handed React two children under one key (t10 review, Minor). Both rows still PAINT that way on a
    // fresh mount, which is why the row count alone cannot catch it; React's own duplicate-key diagnostic is
    // the assertion that does, and it is the thing that makes a later re-render reconcile onto the wrong row.
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
    try {
      const h = renderWithKeymap(
        <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
        { userLayers: [{ context: "Chat", bindings: { escape: null } }] },
      );
      await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
      h.stdin.write("?");
      await waitFor(() => frame(h.lastFrame).includes("Keyboard shortcuts"));
      const overlay = stripAnsi(frame(h.lastFrame));
      expect(overlay).toContain("interrupt (while running)");
      expect(overlay).toContain("clear input · rewind when empty");
      expect(overlay.split("\n").filter((l) => l.includes("(unbound)")).length).toBe(2);
      expect(errors.filter((e) => e.includes("same key"))).toEqual([]);
      h.unmount();
    } finally { spy.mockRestore(); }
  });
});

// ── The chip parenthetical's OTHER gate: ownership ────────────────────────────────────────────────────
// Both cases are the task-10 reviewer's own probes, made permanent. The parenthetical is a claim about a key
// only the COMPOSER can deliver (`chat:cycleMode` lives in the Chat context), so every frame where the
// composer is not the visible owner must carry no such claim. The first version of this shipped reading the
// registry during render — a `Set` a passive cleanup mutates, which repaints nothing — so the hint stayed on
// screen under an open overlay and only ever cleared by accident, when something unrelated re-rendered.
describe("F2 — the mode-chip parenthetical is honest about who owns the keyboard", () => {
  it("clears while the `?` overlay and the background-tasks picker are open, and returns with the composer", async () => {
    const fake = fakeRemote();
    const h = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    h.stdin.write(SHIFT_TAB);                                        // off `default` — otherwise there is no hint to hide
    await settleUntil(() => stripAnsi(frame(h.lastFrame)).includes("⇧Tab to cycle"));
    expect(stripAnsi(frame(h.lastFrame))).toContain("⇧Tab to cycle");

    h.stdin.write("?");
    await waitFor(() => frame(h.lastFrame).includes("Keyboard shortcuts"));
    // Asserted while the overlay is STILL up: the status bar renders under it, and shift+tab reaches nothing
    // from here (Help swallows), so advertising it would be the lie this gate exists to prevent.
    expect(stripAnsi(frame(h.lastFrame))).not.toContain("to cycle");
    expect(frame(h.lastFrame)).toContain("Keyboard shortcuts");
    h.stdin.write(ESC);
    await waitFor(() => stripAnsi(frame(h.lastFrame)).includes("⇧Tab to cycle"));   // the composer owns it again

    fake.pushEvent({ kind: "tasks_changed", tasks: [{ task_id: "task-aaa", task_type: "bash", description: "alpha-task" }] });
    await waitFor(() => frame(h.lastFrame).includes("⚙ 1 bg"));
    h.stdin.write(CTRL_B);                                           // idle ctrl+b opens the picker over the composer
    await waitFor(() => stripAnsi(frame(h.lastFrame)).includes("Shells (1)"));
    expect(stripAnsi(frame(h.lastFrame))).not.toContain("to cycle");
    expect(stripAnsi(frame(h.lastFrame))).toContain("Shells (1)");
    h.unmount();
  });

  it("a <ChatStatusBar> with no provider above it never claims a cycle key", async () => {
    // A bare render has no input path at all — no provider, no composer, nothing that could deliver the key.
    // The mode is deliberately NON-default here, so the mode gate cannot be what makes this pass.
    const bare = render(<ChatStatusBar mode="acceptEdits" busy />);
    await tick();
    expect(stripAnsi(frame(bare.lastFrame))).toContain("mode acceptEdits");
    expect(stripAnsi(frame(bare.lastFrame))).not.toContain("to cycle");
    bare.unmount();
  });
});

// ── Acceptance 5 ─────────────────────────────────────────────────────────────────────────────────────
describe("F2 acceptance 5 — alt ≡ meta", () => {
  it("`alt+d` and `meta+d` parse to the same spec", () => {
    expect(parseKeySpec("meta+d")).toEqual(parseKeySpec("alt+d"));
    expect(parseKeySpec("opt+d")).toEqual(parseKeySpec("alt+d"));
  });

  it("the ESC-prefixed byte pair fires a binding DECLARED as meta+d", async () => {
    const hit = vi.fn();
    const h = renderWithKeymap(<Probe actions={{ "chat:clearInput": hit }} />, {
      userLayers: [{ context: "Chat", bindings: { "meta+d": "chat:clearInput" } }],
    });
    await tick();
    h.stdin.write("\x1bd");
    expect(hit).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});

// ── Acceptance 6 ─────────────────────────────────────────────────────────────────────────────────────
describe("F2 acceptance 6 — every key P86 found undeliverable is recorded as unreachable", () => {
  const doc = readFileSync(new URL("../../../docs/parity/tui-ux.md", import.meta.url), "utf8");

  it("the parity doc carries an unreachable-keys section", () => {
    expect(doc).toContain("Unreachable keys");
  });
  it("names super+letter chords on non-CSI-u terminals", () => {
    expect(doc).toContain("`super`+letter on a non-CSI-u terminal");
  });
  it("names ctrl+shift+<letter> on non-CSI-u terminals", () => {
    expect(doc).toContain("`ctrl+shift+<letter>` on a non-CSI-u terminal");
  });
  it("names shift+enter without /terminal-setup", () => {
    expect(doc).toContain("`shift+enter` without `/terminal-setup`");
  });
  it("names ctrl+m as indistinguishable from enter", () => {
    expect(doc).toContain("`ctrl+m` as distinct from `enter`");
  });
  it("names Windows / ConPTY as undetermined", () => {
    expect(doc).toContain("Windows / ConPTY");
  });
  it("records meta+o and meta+w as dropped with a rationale", () => {
    expect(doc).toContain("`meta+o`");
    expect(doc).toContain("`meta+w`");
  });
});

// ── K6: the `command:<name>` action form ──────────────────────────────────────────────────────────────
// Task 9 made these bindings VALIDATE; they were inert until task 10 gave them a dispatcher. The three
// promises: a bound key runs the command for real, an unknown name is as honest as typing it, and the key
// stops falling through to the readline editor underneath.
describe("F2 — `command:<name>` bindings run the slash command", () => {
  it("a user-bound key runs the command, and the key no longer reaches the editor", async () => {
    const h = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Chat", bindings: { "ctrl+k": "command:status" } }] },
    );
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    h.stdin.write("keep me");
    await waitFor(() => frame(h.lastFrame).includes("keep me"));
    // Park the cursor at the START of the line first. Default ctrl+k is `killToEnd`, so pressing it where
    // typing left the cursor (end of line) kills NOTHING — the buffer would survive a fully broken binding
    // and the assertion below would prove nothing at all. From column 0 the default eats the whole line.
    h.stdin.write(CTRL_A);
    await settle();
    h.stdin.write(CTRL_K);
    await waitFor(() => frame(h.lastFrame).includes("Status"));
    // stripAnsi, because the cursor now sits ON the `k`: Ink's inverse-video escape splits the raw frame's
    // "keep me" in two, and a raw `toContain` would report the buffer as gone when it is intact.
    expect(stripAnsi(frame(h.lastFrame))).toContain("keep me");      // the editor never saw the key
    h.unmount();
  });

  it("an unknown command name produces the same notice typing it would", async () => {
    const h = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Chat", bindings: { "alt+k": "command:nosuchthing" } }] },
    );
    await waitFor(() => frame(h.lastFrame).includes("❯\u00a0"));
    h.stdin.write("\x1bk");
    await waitFor(() => frame(h.lastFrame).includes("Unknown command: /nosuchthing"));
    h.unmount();
  });
});

// A source-level guard against the drift this whole task exists to remove: a derived hint quietly replaced by
// the string it happens to print today. It greps the three DERIVING surfaces for the display literal of EVERY
// table action they hint — not just `⇧Tab`, which one hardcoded `Ctrl-T` or `Esc` would sail straight past —
// and the ban list is itself generated from the default table, so adding a binding extends the guard for free.
describe("F2 — hint derivation coverage", () => {
  /** Every display string the default keymap would produce for an action one of these surfaces advertises.
   *  Seeing one written out in the source means someone typed a key instead of asking the table for it. */
  const BANNED = [...new Set(SHORTCUT_ROWS.filter((r) => r.action).flatMap((r) => defaultLookup(r.action!)).map(formatBinding))];

  it("the composer, the status bar and the overlay carry no hardcoded chord literal for a table action", () => {
    expect(BANNED).toContain("⇧Tab");                                 // the list is really populated
    expect(BANNED).toContain("Ctrl-T");
    expect(BANNED).toContain("Esc");
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const file of ["../../src/tui/ChatComposer.tsx", "../../src/tui/ChatStatusBar.tsx", "../../src/tui/ShortcutsOverlay.tsx"]) {
      // Comments are not rendered, so they are not lies — whole `//` / `/*` / jsdoc-`*` lines drop out, and so
      // does the tail of a line-end `//` comment, which is what lets these files keep explaining what they
      // derive and why. Cutting at `//` can over-strip (a `://` inside a string), which would only ever HIDE a
      // literal from this grep, never invent one — the failure mode is a missed catch, not a false alarm.
      // `\uXXXX` escapes are decoded first: `"⇧Tab"` renders exactly as `⇧Tab`, and a grep for the glyph
      // would sail past the spelling that hides it.
      const body = src(file).split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n").replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
      for (const literal of BANNED) expect(body, `${file} still prints a literal ${literal}`).not.toContain(literal);
    }
  });
});
