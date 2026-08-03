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
import { render } from "ink-testing-library";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { useKeyScope, useKeyActions, useKeyFallback, useSwallowKeys, useBinding, useBindingLookup } from "../../src/tui/keys/KeymapProvider.js";
import type { KeyContextName, KeyEvent, TextEvent } from "../../src/tui/keys/types.js";

// The matched ACTION is the second argument (only a `family:*` handler reads it — see the family block below).
type Handlers = Record<string, (e: KeyEvent, action: string) => void>;
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
  it("the latin1 flip is gated on a migrated consumer: no registrations → setEncoding never called", async () => {
    const h = renderWithKeymap(<Text>plain</Text>);
    const spy = vi.fn();
    (h.stdin as unknown as { setEncoding: typeof spy }).setEncoding = spy;   // stub lacks it; install before effects flush
    await tick();
    // Ink's own handleSetRawMode calls setEncoding("utf8") — seeing it here is the baseline surviving. What
    // the gate forbids is OUR latin1 flip landing on top of it while legacy useInput components are live.
    expect(spy).not.toHaveBeenCalledWith("latin1");
    h.unmount();
  });

  it("a text event breaks a pending chord — ctrl+x, fast-typed text, ctrl+k must not fire killAgents", async () => {
    const kill = vi.fn();
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:killAgents": kill }} fallback={fallback} />);
    await tick();
    h.stdin.write(CTRL_X);
    h.stdin.write("hello");                               // one chunk → one text event, inside the 1 s window
    h.stdin.write(CTRL_K);
    expect(kill).not.toHaveBeenCalled();
    expect(fallback.mock.calls.map((c) => c[0].kind)).toEqual(["text", "key"]);   // text delivered, ctrl+k reaches the editor path
    h.unmount();
  });

  it("…and IS applied once a consumer registers during render", async () => {
    const h = renderWithKeymap(<Probe scope="Chat" />);
    const spy = vi.fn();
    (h.stdin as unknown as { setEncoding: typeof spy }).setEncoding = spy;
    await tick();
    expect(spy).toHaveBeenCalledWith("latin1");
    h.unmount();
  });

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

// F2 final whole-branch review, P2. stdin is a BYTE stream read under latin1 (see the provider header), so a
// multibyte character can be torn across two reads. Each half was printable-in-latin1 and one byte long, so the
// parser named it a KeyEvent — and the provider's utf8 re-decode only ever touched TextEvents, so the editor got
// two mojibake keystrokes instead of one character. The parser stays pure (it sees one chunk and cannot know a
// tail is incomplete); the provider owns the stream, so the carry lives here.
describe("KeymapProvider — a multibyte character torn across two stdin reads", () => {
  const textOf = (fallback: ReturnType<typeof vi.fn>) => fallback.mock.calls.map((c) => (c[0].kind === "text" ? `text:${c[0].text}` : `key:${c[0].name}`));

  it("é split C3 | A9 arrives as ONE text event, not two latin1 key events", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\xc3");                                // the lead byte alone: held, never dispatched
    expect(fallback).not.toHaveBeenCalled();
    h.stdin.write("\xa9");
    expect(textOf(fallback)).toEqual(["text:é"]);
    h.unmount();
  });

  it("a 4-byte emoji survives both split points (1+3 and 3+1)", async () => {
    for (const [a, b] of [["\xf0", "\x9f\x98\x80"], ["\xf0\x9f\x98", "\x80"]] as const) {
      const fallback = vi.fn();
      const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
      await tick();
      h.stdin.write(a);
      expect(fallback, `held ${JSON.stringify(a)}`).not.toHaveBeenCalled();
      h.stdin.write(b);
      expect(textOf(fallback), `${JSON.stringify(a)} | ${JSON.stringify(b)}`).toEqual(["text:😀"]);
      h.unmount();
    }
  });

  it("a chunk ending in a COMPLETE multibyte character is not held back (no false positive)", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("a\xc3\xa9");                           // "aé" whole: must dispatch on this chunk, not the next
    expect(textOf(fallback)).toEqual(["text:aé"]);
    h.stdin.write("\xf0\x9f\x98\x80");                    // a whole 4-byte emoji, likewise
    expect(textOf(fallback)).toEqual(["text:aé", "text:😀"]);
    h.unmount();
  });

  it("the carry never grows past the 3 bytes a lead byte can be waiting on", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("hi\xf0");                              // ASCII flushes; only the lead byte waits
    expect(textOf(fallback)).toEqual(["text:hi"]);
    h.stdin.write("\x9f\x98\x80!");                       // completion + a following ASCII byte
    expect(textOf(fallback)).toEqual(["text:hi", "text:😀!"]);
    h.unmount();
  });

  it("a held carry is dropped at teardown, like the paste buffer — nothing is delivered late", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\xc3");
    h.unmount(); await tick();
    h.stdin.write("\xa9");
    expect(fallback).not.toHaveBeenCalled();
  });
});

// F2 final whole-branch review, P2. A bracketed paste bigger than the cap used to stop buffering and emit its
// prefix, with NOTHING recording that the stream was still inside the paste — so the next chunk was parsed as
// keystrokes and an embedded \r submitted the composer mid-paste, which is the exact accident paste protection
// exists to prevent. Overflow is an explicit state now: discard to the end marker, then resume.
describe("KeymapProvider — a bracketed paste that overruns the 1 MiB cap", () => {
  const CAP = 1 << 20;

  it("emits the capped prefix, then DISCARDS the rest of the paste — an embedded \\r never becomes a key", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text.length}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat(CAP + 1));     // one chunk over the cap, paste still open
    expect(seen).toEqual([`text:${CAP + 1}`]);            // the prefix is delivered, exactly as before the fix
    seen.length = 0;
    h.stdin.write("still\rinside\x03the\x1bpaste");       // control bytes mid-paste: every one of them discarded
    expect(seen).toEqual([]);
    h.unmount();
  });

  it("resumes normal key parsing at the end marker, mid-chunk", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat(CAP + 1));
    seen.length = 0;
    h.stdin.write("tail\r\x1b[201~ok");                   // the \r is still INSIDE; "ok" follows the marker
    expect(seen).toEqual(["text:ok"]);
    h.stdin.write("\r");                                  // …and the very next enter is an ordinary key again
    expect(seen).toEqual(["text:ok", "key:enter"]);
    h.unmount();
  });

  it("teardown during the overflow drops it cleanly (no late dispatch, no crash)", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat(CAP + 1));
    fallback.mockClear();
    h.unmount(); await tick();
    h.stdin.write("more\x1b[201~after");
    expect(fallback).not.toHaveBeenCalled();
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

// K6 (task 10): `command:<name>` actions come from the USER's file, so no component can enumerate their
// handlers — a family registration catches them all and is told which one matched. The precedence has to be
// the same as everywhere else here (innermost wins), or a dialog's family handler would swallow a key the
// composer explicitly owns.
describe("KeymapProvider — family handlers (`family:*`)", () => {
  it("dispatches an action nobody registered by name, passing the matched action", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(
      <Probe scope="Chat" actions={{ "command:*": (_e, action) => { seen.push(action); } }} />,
      { userLayers: [{ context: "Chat", bindings: { "ctrl+q": "command:clear" } }] },
    );
    await tick();
    h.stdin.write("\x11");                                        // ctrl+q
    expect(seen).toEqual(["command:clear"]);
    h.unmount();
  });

  it("an exact handler beats the family, and a fallback still gets a key nothing claims", async () => {
    const exact = vi.fn(), family = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(
      <Probe scope="Chat" actions={{ "command:clear": exact, "command:*": family }} fallback={fallback} />,
      { userLayers: [{ context: "Chat", bindings: { "ctrl+q": "command:clear" } }] },
    );
    await tick();
    h.stdin.write("\x11");
    expect(exact).toHaveBeenCalledTimes(1);
    expect(family).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    h.unmount();
  });

  it("an INNER family handler outranks an outer exact one (innermost wins, as for every other action)", async () => {
    const outer = vi.fn(), inner = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Chat" actions={{ "command:clear": outer }} /><Probe scope="Select" actions={{ "command:*": inner }} /></>,
      { userLayers: [{ context: "Select", bindings: { "ctrl+q": "command:clear" } }] },
    );
    await tick();
    h.stdin.write("\x11");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("useBindingLookup — the no-provider branch", () => {
  it("answers from the default table, but reports NOTHING live: with no provider no key can fire", async () => {
    const seen: string[][] = [];
    function Reader() { const lookup = useBindingLookup(); seen.push(lookup("chat:cycleMode"), lookup("chat:cycleMode", { live: true })); return <Text>r</Text>; }
    const h = render(<Reader />);                       // deliberately BARE — no <KeymapProvider> above it
    await tick();
    expect(seen[0]).toEqual(["shift+tab"]);             // "what is bound" — the defaults are the truthful answer
    // "what would fire HERE, right now" is a different question, and the honest answer for a tree with no
    // input path at all is "nothing". Returning the defaults again let a `{live:true}` caller print a hint for
    // a key nobody can deliver — the branch used to take one parameter and drop `opts` on the floor.
    expect(seen[1]).toEqual([]);
    h.unmount();
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

  it("prefers the binding from a LIVE scope over another context's when both bind the action", async () => {
    const seen: (string | null)[] = [];
    function Reader() { seen.push(useBinding("go:somewhere")); return <Text>r</Text>; }
    const h = renderWithKeymap(
      <><Probe scope="Select" /><Reader /></>,
      { userLayers: [
        { context: "Chat", bindings: { "ctrl+g": "go:somewhere" } },        // Chat is NOT mounted here
        { context: "Select", bindings: { "ctrl+l": "go:somewhere" } },      // Select IS the live scope
      ] },
    );
    await tick();
    expect(seen[seen.length - 1]).toBe("ctrl+l");       // the key that would actually fire in this tree
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
