// tui/test/keys-provider.test.tsx — the root input owner (F2 task 5): the one place where the pure keymap
// engine (parse → resolve → chord machine) meets React/Ink. Everything here is driven the way a real terminal
// drives it — `stdin.write(<raw bytes>)` — because that is the only way to prove the provider owns the byte
// stream itself rather than leaning on Ink's `useInput` (which P86 measured cannot express the table).
//
// The invariants under test, in the order the provider applies them:
//   ctrl+z (pre-table, even under swallowAll) → swallowAll (Help semantics) → preemptive scopes → normal
//   scopes newest-first → Global → innermost handler for the matched action → innermost fallback.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Text } from "ink";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { useKeyScope, useKeyActions, useKeyFallback, useSwallowKeys, useBinding } from "../../src/tui/keys/KeymapProvider.js";
import type { KeyContextName, KeyEvent, TextEvent } from "../../src/tui/keys/types.js";

type Handlers = Record<string, (e: KeyEvent) => void>;
const NONE: Handlers = {};
const noop = () => {};

/** One component instance = one registration of each kind. Mount order (sibling order / rerender order) is what
 *  makes a probe "innermost", so tests express precedence by WHERE they put a probe in the tree. */
function Probe(props: { scope: KeyContextName; actions?: Handlers; fallback?: (e: KeyEvent | TextEvent) => void; swallow?: boolean; active?: boolean; preemptive?: boolean }) {
  useKeyScope(props.scope, { active: props.active ?? true, preemptive: props.preemptive ?? false });
  useKeyActions(props.actions ?? NONE);
  useKeyFallback(props.fallback ?? noop);
  useSwallowKeys(!!props.swallow);
  return <Text>{props.scope}</Text>;
}

const ESC = "\x1b", CTRL_X = "\x18", CTRL_K = "\x0b", CTRL_O = "\x0f", CTRL_Z = "\x1a";

describe("KeymapProvider — scopes and action dispatch", () => {
  it("a registered scope's action fires on its bound key", async () => {
    const cancel = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:cancel": cancel }} />);
    await tick();
    h.stdin.write(ESC);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toMatchObject({ kind: "key", name: "escape" });
    h.unmount();
  });

  it("a later-mounted scope steals the key; unmounting it hands the key back", async () => {
    const chat = vi.fn(), select = vi.fn();
    const chatProbe = <Probe scope="Chat" actions={{ "chat:cancel": chat }} />;
    const h = renderWithKeymap(chatProbe);
    await tick();
    h.stdin.write(ESC);
    expect(chat).toHaveBeenCalledTimes(1);
    h.rerender(<>{chatProbe}<Probe scope="Select" actions={{ "select:cancel": select }} /></>);
    await tick();
    h.stdin.write(ESC);
    expect(select).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);                       // stolen, not doubled
    h.rerender(chatProbe);
    await tick();
    h.stdin.write(ESC);
    expect(chat).toHaveBeenCalledTimes(2);                       // restored on unmount
    expect(select).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("a preemptive scope outranks a scope mounted after it", async () => {
    const chat = vi.fn(), select = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Select" actions={{ "select:cancel": select }} preemptive /><Probe scope="Chat" actions={{ "chat:cancel": chat }} /></>,
    );
    await tick();
    h.stdin.write(ESC);
    expect(select).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    h.unmount();
  });

  it("an inactive scope does not participate", async () => {
    const chat = vi.fn(), select = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Chat" actions={{ "chat:cancel": chat }} /><Probe scope="Select" actions={{ "select:cancel": select }} active={false} /></>,
    );
    await tick();
    h.stdin.write(ESC);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    h.unmount();
  });

  it("Global is always last in the stack — a Global binding reaches an unrelated scope", async () => {
    const toggle = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "app:toggleTranscript": toggle }} />);
    await tick();
    h.stdin.write(CTRL_O);
    expect(toggle).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("a matched action with NO live handler falls through to the fallback (no dead keys mid-migration)", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);   // Chat binds escape → chat:cancel, nobody handles it
    await tick();
    h.stdin.write(ESC);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0]).toMatchObject({ kind: "key", name: "escape" });
    h.unmount();
  });

  it("the innermost registration of an action wins", async () => {
    const outer = vi.fn(), inner = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Chat" actions={{ "chat:cancel": outer }} /><Probe scope="Chat" actions={{ "chat:cancel": inner }} /></>,
    );
    await tick();
    h.stdin.write(ESC);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    h.unmount();
  });

  it("handlers are re-registered synchronously on every render (no stale closure)", async () => {
    const seen: number[] = [];
    function Counting() {
      const [n, setN] = React.useState(0);
      useKeyScope("Chat");
      useKeyActions({ "chat:cancel": () => { seen.push(n); setN(n + 1); } });
      return <Text>{n}</Text>;
    }
    const h = renderWithKeymap(<Counting />);
    await tick();
    h.stdin.write(ESC); await tick();
    h.stdin.write(ESC); await tick();
    expect(seen).toEqual([0, 1]);
    h.unmount();
  });
});

describe("KeymapProvider — fallback", () => {
  it("text and unmatched keys reach the innermost fallback, in order", async () => {
    const events: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { events.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("hi");           // a printable run → one text event
    h.stdin.write("h");            // a single unbound printable → a key event
    h.stdin.write("\x1b[2~");      // insert: bound nowhere
    expect(events).toEqual(["text:hi", "key:h", "key:insert"]);
    h.unmount();
  });

  it("the innermost fallback shadows the outer one", async () => {
    const outer = vi.fn(), inner = vi.fn();
    const h = renderWithKeymap(<><Probe scope="Chat" fallback={outer} /><Probe scope="Chat" fallback={inner} /></>);
    await tick();
    h.stdin.write("h");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    h.unmount();
  });

  it("ignored events (mouse/focus reports) never reach the fallback", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[<0;10;5M");   // SGR mouse
    h.stdin.write("\x1b[I");          // focus in
    expect(fallback).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("KeymapProvider — swallowAll (Help semantics)", () => {
  const mount = () => {
    const chat = vi.fn(), toggle = vi.fn(), fallback = vi.fn(), dismiss = vi.fn(), suspend = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Chat" actions={{ "chat:cancel": chat, "app:toggleTranscript": toggle }} fallback={fallback} />
        <Probe scope="Help" actions={{ "help:dismiss": dismiss }} swallow /></>,
      { suspend },
    );
    return { h, chat, toggle, fallback, dismiss, suspend };
  };

  it("an ordinary key fires nothing and reaches no fallback", async () => {
    const { h, chat, toggle, fallback } = mount();
    await tick();
    h.stdin.write("q");
    h.stdin.write("hello");
    expect(chat).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
    h.unmount();
  });

  it("a Global binding is swallowed too (the F0 ctrl+o double-fire guard, now structural)", async () => {
    const { h, toggle } = mount();
    await tick();
    h.stdin.write(CTRL_O);
    expect(toggle).not.toHaveBeenCalled();
    h.unmount();
  });

  it("the swallowing scope's own binding still fires", async () => {
    const { h, dismiss, chat } = mount();
    await tick();
    h.stdin.write(ESC);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    h.unmount();
  });

  it("ctrl+z suspends even under swallowAll (pre-table, F0 contract)", async () => {
    const { h, suspend, dismiss } = mount();
    await tick();
    h.stdin.write(CTRL_Z);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("KeymapProvider — ctrl+z", () => {
  it("calls deps.suspend before any resolution and consumes the key", async () => {
    const suspend = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />, { suspend });
    await tick();
    h.stdin.write(CTRL_Z);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("KeymapProvider — chords (1 s window)", () => {
  it("ctrl+x then ctrl+k within 1 s fires chat:killAgents; the head itself fires nothing", async () => {
    const kill = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:killAgents": kill }} fallback={fallback} />);
    await tick();
    vi.useFakeTimers();
    try {
      h.stdin.write(CTRL_X);
      expect(kill).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();   // the head is consumed
      vi.advanceTimersByTime(999);
      h.stdin.write(CTRL_K);
      expect(kill).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
    h.unmount();
  });

  it("past 1 s the pending chord has expired — the completion fires nothing", async () => {
    const kill = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:killAgents": kill }} fallback={fallback} />);
    await tick();
    vi.useFakeTimers();
    try {
      h.stdin.write(CTRL_X);
      vi.advanceTimersByTime(1001);
      h.stdin.write(CTRL_K);
      expect(kill).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalledTimes(1);        // ctrl+k is bound nowhere on its own → fallback
    } finally { vi.useRealTimers(); }
    h.unmount();
  });

  it("escape cancels a pending chord and is CONSUMED (chat:cancel must not also fire)", async () => {
    const kill = vi.fn(), cancel = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:killAgents": kill, "chat:cancel": cancel }} fallback={fallback} />);
    await tick();
    h.stdin.write(CTRL_X);
    h.stdin.write(ESC);
    expect(cancel).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
    h.stdin.write(ESC);                                  // pending cleared: the next escape is an ordinary escape
    expect(cancel).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("a key that breaks a pending chord is dropped, not handed to the fallback", async () => {
    const fallback = vi.fn(), cancel = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:cancel": cancel }} fallback={fallback} />);
    await tick();
    h.stdin.write(CTRL_X);
    h.stdin.write("h");
    expect(fallback).not.toHaveBeenCalled();
    h.stdin.write("h");                                   // pending cleared → ordinary text path
    expect(fallback).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("the chord clock is injectable and the timer is cleared when the provider unmounts mid-chord", async () => {
    let armed: (() => void) | null = null;
    const setT = vi.fn((fn: () => void, _ms?: number) => { armed = fn; return 7 as unknown as ReturnType<typeof setTimeout>; });
    const clearT = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:killAgents": vi.fn() }} />, { setTimeout: setT as unknown as typeof setTimeout, clearTimeout: clearT as unknown as typeof clearTimeout });
    await tick();
    h.stdin.write(CTRL_X);
    expect(setT).toHaveBeenCalledTimes(1);
    expect(setT.mock.calls[0][1]).toBe(1000);
    expect(armed).not.toBeNull();
    h.unmount(); await tick();                            // React flushes passive cleanups a tick after unmount
    expect(clearT).toHaveBeenCalledWith(7);
  });
});

describe("KeymapProvider — byte-stream hygiene", () => {
  it("re-decodes latin1 bytes to UTF-8 before the fallback sees them", async () => {
    const events: TextEvent[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { if (e.kind === "text") events.push(e); }} />);
    await tick();
    h.stdin.write("Ã©");                                  // the two latin1 bytes of a UTF-8 'é'
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("é");
    h.unmount();
  });

  it("buffers a paste torn across two chunks into ONE text event (no stray enter from its \\r)", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~line one\r");                 // paste opened, never closed in this chunk
    expect(seen).toEqual([]);                             // held: parsing now would fire `enter` mid-paste
    h.stdin.write("line two\x1b[201~");
    expect(seen).toEqual(["text:line one\rline two"]);
    h.unmount();
  });

  it("a complete paste in one chunk is not delayed", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~pasted\x1b[201~");
    expect(seen).toEqual(["text:pasted"]);
    h.unmount();
  });
});

describe("KeymapProvider — stdin ownership", () => {
  it("attaches exactly one data listener and detaches it on unmount", async () => {
    const h = renderWithKeymap(<Probe scope="Chat" />);
    await tick();
    const before = h.stdin.listenerCount("data");
    expect(before).toBeGreaterThanOrEqual(1);
    h.unmount(); await tick();
    expect(h.stdin.listenerCount("data")).toBe(before - 1);
  });

  it("keys written after unmount reach nothing", async () => {
    const cancel = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:cancel": cancel }} />);
    await tick();
    h.unmount();
    h.stdin.write(ESC);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("useBinding", () => {
  it("reports the live display string for an action, and null for an unbound one", async () => {
    const seen: (string | null)[] = [];
    function Reader() { seen.push(useBinding("chat:cycleMode"), useBinding("nope:nothing")); return <Text>r</Text>; }
    const h = renderWithKeymap(<Reader />);
    await tick();
    expect(seen[0]).toBe("shift+tab");
    expect(seen[1]).toBeNull();
    h.unmount();
  });

  it("reflects a user layer that moves the action to another key", async () => {
    const seen: (string | null)[] = [];
    function Reader() { seen.push(useBinding("chat:cycleMode")); return <Text>r</Text>; }
    const h = renderWithKeymap(<Reader />, { userLayers: [{ context: "Chat", bindings: { "shift+tab": null, "alt+m": "chat:cycleMode" } }] });
    await tick();
    expect(seen[seen.length - 1]).toBe("alt+m");        // the unbound default is never reported
    h.unmount();
  });

  it("a user layer's rebinding of a key changes which action that key fires", async () => {
    const cancel = vi.fn(), clear = vi.fn();
    const h = renderWithKeymap(
      <Probe scope="Chat" actions={{ "chat:cancel": cancel, "chat:clearInput": clear }} />,
      { userLayers: [{ context: "Chat", bindings: { escape: "chat:clearInput" } }] },
    );
    await tick();
    h.stdin.write(ESC);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    h.unmount();
  });
});
