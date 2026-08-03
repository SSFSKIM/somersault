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
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("⟳"));
    stdin.write("\x1b");
    await waitFor(() => interrupted === 1);
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");   // busy Esc interrupts, never arms
  });

  it("(b) ctrl+x ctrl+k inside the chord window reaches chat:killAgents; after the window it does not", async () => {
    const inWindow = fakeTimers();
    const a = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />, inWindow.deps);
    await waitFor(() => frame(a.lastFrame).includes("›"));
    a.stdin.write("hello"); await waitFor(() => frame(a.lastFrame).includes("hello"));
    a.stdin.write("\x18");                                    // ctrl+x — arms the chord, never inserts
    a.stdin.write("\x0b");                                    // ctrl+k within the window → killAgents
    await waitFor(() => frame(a.lastFrame).includes("No background agents running"));
    expect(frame(a.lastFrame)).toContain("hello");            // the chord never touched the buffer
    a.unmount();

    const expired = fakeTimers();
    const b = renderWithKeymap(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />, expired.deps);
    await waitFor(() => frame(b.lastFrame).includes("›"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x1bp");
    await waitFor(() => frame(lastFrame).includes("switch model"));
  });

  it("(c2) alt+t toggles thinking through the same setThink flow /think uses", async () => {
    const budgets: (number | null)[] = [];
    const fake = fakeRemote({ setMaxThinkingTokens: (n: number | null) => { budgets.push(n); } });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => plain(frame(lastFrame)).includes("think default"));
    stdin.write("\x1bt");
    await waitFor(() => plain(frame(lastFrame)).includes("think off"));
    expect(budgets).toEqual([0]);
    stdin.write("\x1bt");
    await waitFor(() => plain(frame(lastFrame)).includes("think default"));
    expect(budgets).toEqual([0, null]);
  });

  it("(d) typed text reaches the composer buffer, single keys and multi-character runs alike", async () => {
    const submitted: string[] = [];
    const fake = fakeRemote({ submit: async (p: string) => { submitted.push(p); return { result: "ok" }; } });
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("›"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("hello world"); await waitFor(() => frame(lastFrame).includes("hello world"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("/");
    await waitFor(() => frame(lastFrame).includes("no matches"));
    stdin.write("\x1b");                                      // Autocomplete owns Escape here
    await waitFor(() => !frame(lastFrame).includes("no matches"));
    expect(frame(lastFrame)).not.toContain("Press Esc again to rewind");   // chat:cancel never fired
    expect(anchors).toBe(0);
    stdin.write("\x1b");                                      // now that the popup is gone, Esc IS chat:cancel
    await waitFor(() => frame(lastFrame).includes("Esc again to clear"));  // (idle + text → the local clear arm)
  });

  it("(g) ctrl+d exits only on an empty buffer, and only on the second press inside the arm window", async () => {
    let exits = 0;
    const { stdin, lastFrame } = renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={process.cwd()} commandCatalog={[]} onExit={() => { exits++; }} />);
    await tick();
    stdin.write("x"); await waitFor(() => frame(lastFrame).includes("x"));
    stdin.write("\x04");                                      // ctrl+d with text: nothing at all
    await tick();
    expect(exits).toBe(0);
    expect(frame(lastFrame)).not.toContain("Press Ctrl-D again to exit");
    expect(frame(lastFrame)).toContain("x");                  // and it certainly did not insert
    stdin.write("\x7f"); await waitFor(() => frame(lastFrame).includes("Ask Claude anything…"));
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
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("\x18"); stdin.write("\x02");                 // idle: Task is inactive, so the chord dies
    await tick();
    expect(background).not.toHaveBeenCalled();
    stdin.write("go"); await waitFor(() => frame(lastFrame).includes("go"));
    stdin.write("\r"); await waitFor(() => frame(lastFrame).includes("⟳"));
    stdin.write("\x18"); stdin.write("\x02");                 // busy: Task binds ctrl+x ctrl+b
    await waitFor(() => background.mock.calls.length === 1);
  });

  it("(i) neither ChatApp nor ChatComposer calls useInput any more", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../../src/tui/ChatApp.tsx", "../../src/tui/ChatComposer.tsx"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src).not.toMatch(/useInput\(/);
    }
  });
});
