// tui/test/keys-migration-root.test.tsx — F2 task 6: the ROOT is on the keymap engine. ChatApp and
// ChatComposer no longer call `useInput` at all; every key they used to read now arrives through
// <KeymapProvider>'s parser → binding table → chord machine, and lands either on a registered action
// handler or on the composer's fallback (the editor adapter). These tests drive the REAL ChatApp through
// `renderWithKeymap`, which is now the only way a key reaches it.
//
// Chord timing is injected, never wall-clock: the provider takes `setTimeout`/`clearTimeout` through
// KeymapDeps, so "the 1 s inter-key window elapsed" is `fireTimers()` — deterministic, and it fails loudly
// against the old bespoke 2 s `Date.now()` chord in ChatComposer (which no injected clock can move).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { ComposerWithFooter } from "./helpers/composerFooter.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { spinnerUp } from "./helpers/spinnerRow.js";
import { UNDO_COALESCE_MS } from "../../src/tui/editor.js";

const frame = (f: () => string | undefined) => f() ?? "";
/** The status bar colors the think level, so "think default" is not contiguous in a raw frame. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** A controllable stand-in for the provider's chord timer: nothing fires until `fire()` is called. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  const deps = {
    setTimeout: ((fn: () => void) => { const k = ++id; pending.set(k, fn); return k; }) as unknown as typeof setTimeout,
    clearTimeout: ((k: unknown) => { pending.delete(k as number); }) as unknown as typeof clearTimeout,
  };
  return { deps, fire: () => { for (const [k, fn] of [...pending]) { pending.delete(k); fn(); } } };
}

describe("F2 task 6 — root migration (ChatApp + ChatComposer on the keymap)", () => {
  it("(a) Escape while a turn is running interrupts it (Chat → chat:cancel → ChatApp's onInterrupt)", async () => {
    let interrupted = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      interrupt: async () => { interrupted++; fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); },
    });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    stdin.write("\x1b");
    await waitFor(() => interrupted === 1);
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");   // busy Esc interrupts, never arms
  });

  it("(b) ctrl+x ctrl+k inside the chord window reaches chat:killAgents; after the window it does not", async () => {
    const inWindow = fakeTimers();
    const a = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />, inWindow.deps);
    await waitFor(() => frame(a.lastFrame).includes("❯\u00a0"));
    a.stdin.write("hello"); await waitFor(() => frame(a.lastFrame).includes("hello"));
    a.stdin.write("\x18");                                    // ctrl+x — arms the chord, never inserts
    a.stdin.write("\x0b");                                    // ctrl+k within the window → killAgents
    await waitFor(() => frame(a.lastFrame).includes("No background agents running"));
    expect(frame(a.lastFrame)).toContain("hello");            // the chord never touched the buffer
    a.unmount();

    const expired = fakeTimers();
    const b = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />, expired.deps);
    await waitFor(() => frame(b.lastFrame).includes("❯\u00a0"));
    b.stdin.write("hello"); await waitFor(() => frame(b.lastFrame).includes("hello"));
    b.stdin.write("\x01");                                    // ctrl+a → cursor to line start
    b.stdin.write("\x18");                                    // ctrl+x arms…
    expired.fire();                                           // …and the 1 s inter-key window elapses
    b.stdin.write("\x0b");                                    // bare ctrl+k is the editor's kill-to-end again
    await waitFor(() => !frame(b.lastFrame).includes("hello"));
    expect(frame(b.lastFrame)).not.toContain("No background agents running");
    b.unmount();
  });

  it("(c) alt+p opens the model picker (KB8, a binding that never existed before the table)", async () => {
    const fake = fakeRemote({ capabilities: () => ({ models: [{ value: "opus", displayName: "Opus" }], commands: [], mcpServers: [] }) });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1bp");
    await waitFor(() => frame(lastFrame).includes("Select model"));
  });

  it("(c2) alt+t toggles thinking through the same setThink flow /think uses", async () => {
    // WAVE C TASK 2: the `think <level>` chip left the always-on row with `ChatStatusBar` — it has no upstream
    // footer counterpart (spec EP-C1's owner-decision list), and `/status` and `/think` still report the
    // level. So this case reads the WIRE instead of the chrome: `setMaxThinkingTokens`, which is what
    // "through the same setThink flow" actually claims, and a stronger pin than a chip ever was.
    const budgets: (number | null)[] = [];
    const fake = fakeRemote({ setMaxThinkingTokens: (n: number | null) => { budgets.push(n); } });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => plain(frame(lastFrame)).includes("? for shortcuts"));
    stdin.write("\x1bt");
    await waitFor(() => budgets.length === 1);
    expect(budgets).toEqual([0]);
    stdin.write("\x1bt");
    await waitFor(() => budgets.length === 2);
    expect(budgets).toEqual([0, null]);
  });

  it("(d) typed text reaches the composer buffer, single keys and multi-character runs alike", async () => {
    const submitted: string[] = [];
    const fake = fakeRemote({ submit: async (p: string) => { submitted.push(p); return { result: "ok" }; } });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("multi char run");                            // one chunk → one text event
    await waitFor(() => frame(lastFrame).includes("multi char run"));
    stdin.write("!");                                         // single printable → one key event
    await waitFor(() => frame(lastFrame).includes("multi char run!"));
    stdin.write("\r");
    await waitFor(() => submitted.length === 1);
    expect(submitted[0]).toBe("multi char run!");
  });

  it("(e) ctrl+_ RESTORES the prior buffer through the editor's undo (the raw \\x1f form survives the adapter)", async () => {
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("hello world"); await waitFor(() => frame(lastFrame).includes("hello world"));
    // F5 task 1 (CM17): undo pushes coalesce inside a 1000 ms window, so the kill has to land OUTSIDE it to
    // be its own entry — otherwise it folds into the paste's and undo (correctly) empties the buffer instead.
    await new Promise((r) => setTimeout(r, UNDO_COALESCE_MS + 50));
    stdin.write("\x17");                                      // ctrl+w kills the last word
    await waitFor(() => !frame(lastFrame).includes("world"));
    stdin.write("\x1f");                                      // ctrl+_ = undo
    await waitFor(() => frame(lastFrame).includes("hello world"));
    expect(frame(lastFrame)).not.toContain("\x1f");
  });

  it("(f) with a / popup open, Escape dismisses the popup and never reaches chat:cancel", async () => {
    let anchors = 0;
    const fake = { ...fakeRemote(), rewindAnchors: async () => { anchors++; return []; }, rewindDryRun: async () => ({ canRewind: true }), rewind: async () => {} };
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake as never} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("/zz");                                       // F5 t9: CM38 needs a partial NAME to say anything
    await waitFor(() => frame(lastFrame).includes('No commands match "/zz"'));
    stdin.write("\x1b");                                      // Autocomplete owns Escape here
    await waitFor(() => !frame(lastFrame).includes('No commands match "/zz"'));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");   // chat:cancel never fired
    expect(anchors).toBe(0);
    stdin.write("\x1b");                                      // now that the popup is gone, Esc IS chat:cancel
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));  // (idle + text → the local clear arm)
  });

  // F5 t9 review (I2). The mirror of (f): a popup that is in STATE but draws nothing (an `@` matching no
  // file — the file popup has no empty message upstream) must release Escape, so the very FIRST Escape is
  // chat:cancel. Before the fix that Escape vanished into an invisible popup and the user had to press it
  // twice for no visible reason. This is an OUTCOME pin (t9 re-review): the three composer-level Escape
  // gates (scope predicate, handleKey arm, chat:cancel guard) are mutually redundant on this path, so it
  // fails only when all three regress together — it does NOT pin the scope predicate alone; a per-gate pin
  // would need a key only the scope routes (e.g. Up → autocomplete:previous vs the history walk).
  it("(f2) an @ popup with nothing in it holds no keys — the first Escape is chat:cancel", async () => {
    const fake = { ...fakeRemote(), rewindAnchors: async () => [], rewindDryRun: async () => ({ canRewind: true }), rewind: async () => {} };
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake as never} client={{ kind: "loopback" }} cwd="/__ccx-empty-cwd__" />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    stdin.write("@zznomatch");
    await waitFor(() => frame(lastFrame).includes("@zznomatch"));
    stdin.write("\x1b");                                      // ONE press
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));
  });

  it("(g) ctrl+d exits only on an empty buffer, and only on the second press inside the arm window", async () => {
    let exits = 0;
    // WAVE C TASK 2: the Ctrl-D arm is a FOOTER state now, so this renders the pair the app composes.
    const { stdin, lastFrame } = renderWithKeymap(<ComposerWithFooter onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onExit={() => { exits++; }} />);
    await tick();
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("x"));
    stdin.write("\x04");                                      // ctrl+d with text: nothing at all
    await tick();
    expect(exits).toBe(0);
    expect(frame(lastFrame)).not.toContain("Press Ctrl-D again to exit");
    expect(frame(lastFrame)).toContain("x");                  // and it certainly did not insert
    stdin.write("\x7f"); await waitFor(() => frame(lastFrame).includes("? for shortcuts"));
    stdin.write("\x04");                                      // empty buffer: first press arms
    await waitFor(() => frame(lastFrame).includes("Press Ctrl-D again to exit"));
    expect(exits).toBe(0);
    stdin.write("\x04");                                      // second press inside the window exits
    await waitFor(() => exits === 1);
  });

  it("(h) the Task scope is live only while a turn runs: ctrl+x ctrl+b backgrounds it", async () => {
    const background = vi.fn(async () => ({ ok: true }));
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      background,
    });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x18"); stdin.write("\x02");                 // idle: Task is inactive, so the chord dies
    await tick();
    expect(background).not.toHaveBeenCalled();
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
    stdin.write("\x18"); stdin.write("\x02");                 // busy: Task binds ctrl+x ctrl+b
    await waitFor(() => background.mock.calls.length === 1);
  });

  // F2 final whole-branch review, P2: `help:show` is declared in VALID_ACTIONS and bound to nothing by default
  // — the `?` that opens the overlay is composer-local, gated on an empty buffer, because it is a printable
  // character. Validation and resolution both accepted a user binding for it, and then nobody handled it: the
  // key fell through to the composer and typed. It has a root registration now, on the SAME `openShortcuts`
  // seam the composer's `?` calls.
  it("(j) a user layer's `help:show` opens the shortcuts overlay (the rebind-only action has a handler)", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Global", bindings: { "alt+/": "help:show" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("\x1b/");                                     // alt+/
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x1b");                                      // Help's own escape still closes it
    await waitFor(() => !frame(lastFrame).includes("Keyboard shortcuts"));
  });

  // …and it opens over a NON-empty buffer, which the composer's `?` deliberately cannot: a dedicated key has no
  // reason to inherit the gate that exists only to keep a printable character insertable.
  it("(j2) the rebound help key works with text in the composer, and never types itself", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Global", bindings: { "alt+/": "help:show" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("draft"); await waitFor(() => frame(lastFrame).includes("draft"));
    stdin.write("\x1b/");
    await waitFor(() => frame(lastFrame).includes("Keyboard shortcuts"));
    stdin.write("\x1b"); await waitFor(() => frame(lastFrame).includes("draft"));
    expect(frame(lastFrame), "the key opened the overlay instead of inserting").not.toContain("draft/");
  });

  // F2 final review, the stretch item (disclosed debt from t10). `chat:cycleMode` stopped being re-derived from
  // `key.tab && key.shift` in t10; its three neighbours — chat:cancel, chat:clearInput, app:exit — did not, so a
  // full rebind printed a correct derived hint beside a dead key. The three arms below drive the REBOUND key
  // through each state machine end to end; the default-key halves are pinned unchanged by escape.test.tsx and
  // components.test.tsx.
  it("(k) a rebound chat:cancel runs the Esc-Esc clear arm, not just the escape flag", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Chat", bindings: { escape: null, "alt+c": "chat:cancel" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("draft"); await waitFor(() => frame(lastFrame).includes("draft"));
    stdin.write("\x1bc"); await waitFor(() => frame(lastFrame).includes("again to clear"));
    expect(frame(lastFrame)).toContain("draft");                     // armed, buffer intact
    stdin.write("\x1bc"); await waitFor(() => !frame(lastFrame).includes("draft"));
  });

  it("(k2) a rebound chat:cancel interrupts a running turn, exactly as Escape does", async () => {
    let interrupted = 0;
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
      interrupt: async () => { interrupted++; fake.pushEvent({ kind: "turn", phase: "end", seq: 1 }); },
    });
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Chat", bindings: { escape: null, "alt+c": "chat:cancel" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    // NOT `esc to interrupt`: this case REBINDS `chat:cancel` off Escape, and since Wave C Task 6 that copy
    // comes from the footer hint, which spells whatever chord is actually bound (`alt+c to interrupt` here).
    stdin.write("\r"); await waitFor(() => spinnerUp(frame(lastFrame)));
    stdin.write("\x1bc"); await waitFor(() => interrupted === 1);
  });

  it("(k3) a rebound chat:clearInput clears the buffer", async () => {
    const { stdin, lastFrame } = renderWithKeymap(
      <ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />,
      { userLayers: [{ context: "Chat", bindings: { "ctrl+l": null, "alt+k": "chat:clearInput" } }] },
    );
    await waitFor(() => frame(lastFrame).includes("❯\u00a0"));
    stdin.write("draft"); await waitFor(() => frame(lastFrame).includes("draft"));
    stdin.write("\x1bk"); await waitFor(() => !frame(lastFrame).includes("draft"));
    expect(frame(lastFrame)).toContain("? for shortcuts");
  });

  it("(k4) a rebound app:exit runs the KB3 double-press arm on an empty composer, and nothing with text", async () => {
    let exits = 0;
    const { stdin, lastFrame } = renderWithKeymap(
      <ComposerWithFooter onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onExit={() => { exits++; }} />,
      { userLayers: [{ context: "Chat", bindings: { "ctrl+d": null, "alt+q": "app:exit" } }] },
    );
    await tick();
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("x"));
    stdin.write("\x1bq"); await tick();                              // with text: no arm, no exit
    expect(exits).toBe(0);
    expect(frame(lastFrame)).not.toContain("again to exit");
    stdin.write("\x7f"); await waitFor(() => frame(lastFrame).includes("? for shortcuts"));
    stdin.write("\x1bq"); await waitFor(() => frame(lastFrame).includes("again to exit"));
    expect(exits).toBe(0);
    stdin.write("\x1bq"); await waitFor(() => exits === 1);
  });

  // Task 8 turned this from a per-file list into a directory sweep: the migration is finished, so the honest
  // gate is "NOTHING under src/tui subscribes to Ink's input any more". Prose mentioning `useInput` survives in
  // several headers (it is the history these files explain) — the gate is on CALLS and IMPORTS, not comments.
  it("(i) nothing under src/tui calls or imports Ink's useInput any more (tasks 6–8 complete)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../src/tui/", import.meta.url);
    const files: string[] = [];
    const walk = (at: URL, prefix: string) => {
      for (const e of readdirSync(at, { withFileTypes: true })) {
        if (e.isDirectory()) { walk(new URL(`${e.name}/`, at), `${prefix}${e.name}/`); continue; }
        if (/\.tsx?$/.test(e.name)) files.push(`${prefix}${e.name}`);
      }
    };
    walk(dir, "");
    expect(files.length).toBeGreaterThan(30);                       // the sweep really found the tree
    for (const file of files) {
      const src = readFileSync(new URL(file, dir), "utf8");
      // Strip line and block comments first, so a header that TELLS the useInput story does not fail the gate.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `src/tui/${file} still calls useInput`).not.toMatch(/useInput\s*\(/);
      expect(code, `src/tui/${file} still imports useInput`).not.toMatch(/\buseInput\b(?![\s]*\()/);
    }
  });
});
