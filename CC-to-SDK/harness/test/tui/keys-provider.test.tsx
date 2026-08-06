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
import { useKeyScope, useKeyActions, useKeyFallback, useSwallowKeys, useBinding, useBindingLookup, usePasting, useSuspendInput, type SuspendInput } from "../../src/tui/keys/KeymapProvider.js";
import type { KeyContextName, KeyEvent, TextEvent } from "../../src/tui/keys/types.js";
import { createCursorReports, probeReflow } from "../../src/tui/reflowOracle.js";

// The matched ACTION is the second argument (only a `family:*` handler reads it — see the family block below).
type Handlers = Record<string, (e: KeyEvent, action: string) => void>;
const NONE: Handlers = {};
const noop = () => {};

/** One component instance = one registration of each kind. Mount order (sibling order / rerender order) is what
 *  makes a probe "innermost", so tests express precedence by WHERE they put a probe in the tree. */
function Probe(props: { scope: KeyContextName; actions?: Handlers; fallback?: (e: KeyEvent | TextEvent) => void; swallow?: boolean; active?: boolean; preemptive?: boolean; fallbackActive?: boolean }) {
  useKeyScope(props.scope, { active: props.active ?? true, preemptive: props.preemptive ?? false });
  useKeyActions(props.actions ?? NONE);
  useKeyFallback(props.fallback ?? noop, { active: props.fallbackActive ?? true });
  useSwallowKeys(!!props.swallow);
  return <Text>{props.scope}</Text>;
}

/** Renders the provider's `pasting` flag (F5 task 3) so a keyless test can observe it the way the composer's
 *  dim `Pasting…` row does. */
function PastingProbe() { return <Text>{usePasting() ? "PASTING" : "idle"}</Text>; }

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

  // ── F6 task 5: `{active}` on the fallback, the mirror of the scope option the registry already had.
  // An INACTIVE fallback is not registered at all — which is what lets a component that is still MOUNTED and
  // visible (the composer, sitting below an inline decision dialog) stop owning the keyboard without
  // unmounting. Without it the composer's fallback is the innermost one on every remount ordering and it eats
  // the digits, letters and Escape the dialog reads (plan-review finding 1).
  it("an INACTIVE fallback does not fire at all", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} fallbackActive={false} />);
    await tick();
    h.stdin.write("h");
    h.stdin.write("hi");
    expect(fallback).not.toHaveBeenCalled();
    h.unmount();
  });

  it("an EARLIER-mounted dialog's fallback wins once the later composer's is inactive — and takes it back when it re-activates", async () => {
    const dialog = vi.fn(), composer = vi.fn();
    const dialogProbe = <Probe scope="Confirmation" fallback={dialog} />;
    // The dialog mounts FIRST (it renders above the composer in ChatApp's tree), so by mount order the
    // composer's fallback is the innermost one and would otherwise shadow it.
    const h = renderWithKeymap(<>{dialogProbe}<Probe scope="Chat" fallback={composer} active={false} fallbackActive={false} /></>);
    await tick();
    h.stdin.write("2");                                  // a digit: the numbered rows are the dialog's fallback
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(composer).not.toHaveBeenCalled();
    h.rerender(<>{dialogProbe}<Probe scope="Chat" fallback={composer} /></>);
    await tick();
    h.stdin.write("2");
    expect(composer).toHaveBeenCalledTimes(1);           // ownership handed back: innermost by mount order again
    expect(dialog).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("an inactive Chat scope hands Escape to the earlier dialog's `Confirmation` action", async () => {
    const confirmNo = vi.fn(), chatCancel = vi.fn(), composerFallback = vi.fn();
    const h = renderWithKeymap(
      <><Probe scope="Confirmation" actions={{ "confirm:no": confirmNo }} />
        <Probe scope="Chat" actions={{ "chat:cancel": chatCancel }} fallback={composerFallback} active={false} fallbackActive={false} /></>);
    await tick();
    h.stdin.write(ESC);
    expect(confirmNo).toHaveBeenCalledTimes(1);
    expect(chatCancel).not.toHaveBeenCalled();           // `escape → chat:cancel`'s early-return would have eaten it
    expect(composerFallback).not.toHaveBeenCalled();
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

// F5 task 3. PROVENANCE is what the editor's chip path keys off first (size is only the untagged fallback, see
// paste-chips.test.ts): a marked paste collapses into `[Pasted text #N]` at any size. parse.ts sees one chunk
// and cannot answer the provenance question — the markers can be torn across reads and the overflow latch emits
// a capped prefix with no end marker at all — so the tag is applied HERE, where the stream lives.
describe("KeymapProvider — paste provenance and the Pasting… flag", () => {
  const tagged = (fallback: ReturnType<typeof vi.fn>) =>
    fallback.mock.calls.filter((c) => c[0].kind === "text").map((c) => `${c[0].paste ? "paste" : "typed"}:${c[0].text}`);

  it("tags a paste that completes in ONE chunk", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[200~pasted\x1b[201~");
    expect(tagged(fallback)).toEqual(["paste:pasted"]);
    h.unmount();
  });

  it("tags a paste ASSEMBLED across two chunks", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[200~line one\r");
    h.stdin.write("line two\x1b[201~");
    expect(tagged(fallback)).toEqual(["paste:line one\rline two"]);
    h.unmount();
  });

  it("does NOT tag a plain multi-character run typed into the same chunk", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("hello");
    expect(tagged(fallback)).toEqual(["typed:hello"]);
    h.unmount();
  });

  it("keeps text around a paste untagged, and the payload tagged, within one chunk", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("ab\x1b[200~body\x1b[201~cd");
    expect(tagged(fallback)).toEqual(["typed:ab", "paste:body", "typed:cd"]);
    h.unmount();
  });

  it("tags the capped prefix the overflow latch releases (an unterminated paste)", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[200~" + "x".repeat((1 << 20) + 1));      // past PASTE_CAP: prefix emitted, latch set
    expect(tagged(fallback).map((s) => s.slice(0, 8))).toEqual(["paste:xx"]);
    h.unmount();
  });

  it("exposes `pasting` while a paste is held open, and clears it on release", async () => {
    const h = renderWithKeymap(<><Probe scope="Chat" /><PastingProbe /></>);
    await tick();
    expect(h.lastFrame()).toContain("idle");
    h.stdin.write("\x1b[200~line one\r");
    await tick();
    expect(h.lastFrame()).toContain("PASTING");
    h.stdin.write("line two\x1b[201~");
    await tick();
    expect(h.lastFrame()).toContain("idle");
    h.unmount();
  });

  it("never reports `pasting` for a paste that arrives whole", async () => {
    const h = renderWithKeymap(<><Probe scope="Chat" /><PastingProbe /></>);
    await tick();
    h.stdin.write("\x1b[200~whole\x1b[201~");
    await tick();
    expect(h.lastFrame()).toContain("idle");
    h.unmount();
  });

  // t3 review, Minor. The overflow latch is still INSIDE the paste — it is discarding its bytes — but the flag
  // was computed from the paste buffer alone, which the latch empties. `Pasting…` flickered off on the chunk
  // that crossed the cap and stayed off for the rest of a gesture the user was still making.
  it("keeps `pasting` true through the overflow latch, until the end marker lands", async () => {
    const h = renderWithKeymap(<><Probe scope="Chat" /><PastingProbe /></>);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat((1 << 20) + 1));       // past PASTE_CAP: prefix emitted, latch set
    await tick();
    expect(h.lastFrame()).toContain("PASTING");
    h.stdin.write("still inside");                                 // discarded bytes, same gesture
    await tick();
    expect(h.lastFrame()).toContain("PASTING");
    h.stdin.write("done\x1b[201~");
    await tick();
    expect(h.lastFrame()).toContain("idle");
    h.unmount();
  });
});

// t3 review, Critical. Nothing in the tree wrote `\x1b[?2004h`, so no real terminal ever sent paste markers and
// every paste-shaped behaviour above was reachable only from hand-fed bytes. Upstream enables the mode the
// moment it takes raw mode (`ev.BRACKETED_PASTE`, bundle L177069; written at L177900) — the provider owns raw
// mode here, so it owns this too. ink-testing-library's stdout stub IS the frame buffer and carries no `isTTY`,
// so the writes are observed through the `deps.stdout` seam instead of polluting `lastFrame()`.
describe("KeymapProvider — DECSET 2004", () => {
  const sink = (isTTY?: boolean) => {
    const writes: string[] = [];
    return { writes, stdout: { isTTY, write: (d: string) => { writes.push(d); return true; } } };
  };

  it("enables the mode on mount and disables it at teardown", async () => {
    const out = sink(true);
    const h = renderWithKeymap(<Probe scope="Chat" />, { stdout: out.stdout });
    await tick();
    expect(out.writes).toEqual(["\x1b[?2004h"]);
    h.unmount(); await tick();
    expect(out.writes).toEqual(["\x1b[?2004h", "\x1b[?2004l"]);    // the terminal is left as we found it
  });

  it("hands the mode back for a suspendInput flight and re-enables it on restore", async () => {
    const out = sink(true);
    let seam: SuspendInput | null = null;
    function Grab() { seam = useSuspendInput(); return <Text>g</Text>; }
    const h = renderWithKeymap(<><Probe scope="Chat" /><Grab /></>, { stdout: out.stdout });
    await tick();
    out.writes.length = 0;
    await seam!(async () => { out.writes.push("child-owns-tty"); });
    expect(out.writes).toEqual(["\x1b[?2004l", "child-owns-tty", "\x1b[?2004h"]);
    h.unmount();
  });

  it("writes nothing to a sink that is not a TTY", async () => {
    const out = sink();                                              // no `isTTY` at all: a pipe, or ink-testing-library
    const h = renderWithKeymap(<Probe scope="Chat" />, { stdout: out.stdout });
    await tick();
    h.unmount(); await tick();
    expect(out.writes).toEqual([]);
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

  // Final-fix re-review: a discarded chunk used to retain NOTHING, so an end marker split across two reads
  // ("\x1b[2" | "01~") was invisible to indexOf and the latch never released — every later key including
  // ctrl+c was discarded for the life of the process. The latch now carries the last marker-length-minus-one
  // bytes of every miss (and of the chunk that ENTERED overflow, whose emitted prefix can end with the
  // marker's front half) so a straddling marker is re-joined and found.
  it("releases the latch when PASTE_END straddles a chunk boundary", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat(CAP + 1));
    seen.length = 0;
    h.stdin.write("tail\x1b[2");                          // marker torn: front half ends this chunk
    h.stdin.write("01~ok");                               // …back half opens the next
    expect(seen).toEqual(["text:ok"]);
    h.stdin.write("\r");
    expect(seen).toEqual(["text:ok", "key:enter"]);
    h.unmount();
  });

  it("releases the latch when the OVERFLOW-ENTERING chunk itself ends with the marker's front half", async () => {
    const seen: string[] = [];
    const h = renderWithKeymap(<Probe scope="Chat" fallback={(e) => { seen.push(e.kind === "text" ? `text:${e.text}` : `key:${e.name}`); }} />);
    await tick();
    h.stdin.write("\x1b[200~" + "a".repeat(CAP + 1) + "\x1b[2");   // over the cap AND torn marker, one chunk
    seen.length = 0;
    h.stdin.write("01~ok");
    expect(seen).toEqual(["text:ok"]);
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

// F5 final whole-branch review, P1. The cross-chunk carry held a torn CHARACTER but not a torn OPEN MARKER:
// `…\x1b[20` | `0~payload…` left the front half parsing as an unknown CSI (discarded) and the payload parsing
// as ordinary input, so an embedded `\r` became `enter` and submitted half a paste — the accident bracketed
// paste exists to prevent. Measured before the fix: all five split points leaked; four are closed here and the
// fifth (a lone trailing `\x1b`) is deliberately not, because holding it would break the Escape key.
describe("KeymapProvider — the paste OPEN marker torn across two stdin reads", () => {
  const seenOf = () => { const seen: string[] = []; return { seen, on: (e: KeyEvent | TextEvent) => { seen.push(e.kind === "text" ? `${e.paste ? "paste" : "typed"}:${e.text}` : `key:${e.name}`); } }; };

  it("re-joins the marker at every split point from 2 bytes in — one tagged paste, no stray enter", async () => {
    for (const n of [2, 3, 4, 5]) {
      const { seen, on } = seenOf();
      const h = renderWithKeymap(<Probe scope="Chat" fallback={on} />);
      await tick();
      h.stdin.write("\x1b[200~".slice(0, n));
      expect(seen, `held ${n}`).toEqual([]);                       // the front half is held, never parsed
      h.stdin.write("\x1b[200~".slice(n) + "line one\rline two\x1b[201~");
      expect(seen, `split after ${n}`).toEqual(["paste:line one\rline two"]);
      h.unmount();
    }
  });

  // The one split point left open, and the reason is a key that must never wait: a chunk that is just `\x1b`
  // is overwhelmingly the Escape KEY, and this file has no escape timeout to tell the two apart (parse.ts
  // §1.10). Escape answering on the read that carries it outranks a 1-in-6 marker tear.
  it("does NOT hold a lone trailing ESC — the Escape key still fires on its own read", async () => {
    const cancel = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" actions={{ "chat:cancel": cancel }} />);
    await tick();
    h.stdin.write(ESC);
    expect(cancel).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("re-feeds a held prefix that turns out NOT to be a paste marker", async () => {
    const { seen, on } = seenOf();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={on} />);
    await tick();
    h.stdin.write("\x1b[2");                                       // a prefix of `\x1b[200~` — and of `\x1b[2~`
    expect(seen).toEqual([]);
    h.stdin.write("~");                                            // …which it turns out to be: insert
    expect(seen).toEqual(["key:insert"]);
    h.stdin.write("ab\x1b[20");                                    // held again, with text ahead of it flushed
    expect(seen).toEqual(["key:insert", "typed:ab"]);
    h.stdin.write("x");                                            // `\x1b[20x`: an unknown CSI, consumed silently
    expect(seen).toEqual(["key:insert", "typed:ab"]);
    h.unmount();
  });

  it("reports nothing `pasting` while only the marker's front half is held", async () => {
    const h = renderWithKeymap(<><Probe scope="Chat" /><PastingProbe /></>);
    await tick();
    h.stdin.write("\x1b[20");
    await tick();
    expect(h.lastFrame()).toContain("idle");                       // no paste has OPENED yet — a prefix is a guess
    h.stdin.write("0~body");
    await tick();
    expect(h.lastFrame()).toContain("PASTING");
    h.stdin.write("\x1b[201~");
    await tick();
    expect(h.lastFrame()).toContain("idle");
    h.unmount();
  });

  // The END marker needs no carry of its own on this path: the chunk that would tear it is one whose paste is
  // still open, so `pasteOpen` is already holding the whole buffer and the halves meet there. Unpinned until
  // now — pinned so a future refactor of the carry cannot quietly take it away.
  it("re-joins a torn END marker through the ordinary paste hold", async () => {
    const { seen, on } = seenOf();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={on} />);
    await tick();
    h.stdin.write("\x1b[200~body\x1b[20");
    expect(seen).toEqual([]);
    h.stdin.write("1~ok");
    expect(seen).toEqual(["paste:body", "typed:ok"]);
    h.unmount();
  });

  it("drops a held marker prefix at teardown, like the character carry and the paste buffer", async () => {
    const fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />);
    await tick();
    h.stdin.write("\x1b[20");
    h.unmount(); await tick();
    h.stdin.write("0~late\x1b[201~");
    expect(fallback).not.toHaveBeenCalled();
  });
});

// Wave R task 3 — the DELIVERY GAP. A terminal REPLY (a DSR cursor report, `\x1b[<row>;<col>R`) parses to
// `ignored("unknown-sequence")`, which is correct — `CSI_LETTER` has no `R` — but `dispatch`'s first line then
// dropped it on the floor, so nothing in the tree could ever read a terminal's answer. The reflow oracle needs
// exactly one such answer per resize, and it must NOT get it by adding a second stdin reader: two consumers of
// raw stdin race and the failures are intermittent and unreproducible. So the provider, which owns the one
// reader, forwards the raw bytes instead.
describe("KeymapProvider — onUnknownSequence (terminal replies)", () => {
  it("forwards an unknown CSI reply raw, and it still reaches nothing in the keymap", async () => {
    const onUnknownSequence = vi.fn(), fallback = vi.fn(), cancel = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} actions={{ "chat:cancel": cancel }} />, { onUnknownSequence });
    await tick();
    h.stdin.write("\x1b[38;121R");
    expect(onUnknownSequence.mock.calls).toEqual([["\x1b[38;121R"]]);
    expect(fallback).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    h.unmount();
  });

  it("forwards a reply that arrives in the same chunk as real keystrokes, without disturbing them", async () => {
    const onUnknownSequence = vi.fn(), fallback = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" fallback={fallback} />, { onUnknownSequence });
    await tick();
    h.stdin.write("ab\x1b[3;41Rcd");
    expect(onUnknownSequence.mock.calls).toEqual([["\x1b[3;41R"]]);
    expect(fallback.mock.calls.map((c) => c[0].text)).toEqual(["ab", "cd"]);
    h.unmount();
  });

  // Mouse and focus reports are `ignored` too, and the oracle must not be handed a stream of them: the forward
  // is named for what it carries. (They still never reach the keymap — that invariant is pinned above.)
  it("does NOT forward mouse or focus reports", async () => {
    const onUnknownSequence = vi.fn();
    const h = renderWithKeymap(<Probe scope="Chat" />, { onUnknownSequence });
    await tick();
    h.stdin.write("\x1b[<0;10;5M");
    h.stdin.write("\x1b[I");
    h.stdin.write("\x1b[O");
    expect(onUnknownSequence).not.toHaveBeenCalled();
    h.unmount();
  });

  it("carries a whole reflow probe from raw stdin to a verdict", async () => {
    const reports = createCursorReports();
    const h = renderWithKeymap(<Probe scope="Chat" />, { onUnknownSequence: reports.deliver });
    await tick();
    const verdict = probeReflow({ write: () => {}, onReply: reports.onReply, colBefore: 121, oldWidth: 120, newWidth: 80 });
    h.stdin.write("\x1b[3;41R");                          // what a reflowing terminal answers after 120→80
    expect(await verdict).toBe("reflow");
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

// t2 review, Important. An external editor spawned with stdio "inherit" shares fd 0 with us; while our `data`
// listener keeps the stream flowing we RACE the child for its keystrokes, and a stolen `\r` submits the turn
// mid-edit. `suspendInput` is the explicit handoff upstream gets for free from spawnSync blocking the loop.
describe("KeymapProvider — suspendInput (the external-editor terminal handoff)", () => {
  /** Grab the provider's seam out of the tree, and register a probe under the same provider. */
  const mount = () => {
    const cancel = vi.fn(), fallback = vi.fn();
    let seam: SuspendInput | null = null;
    function Grab() { seam = useSuspendInput(); return <Text>g</Text>; }
    const h = renderWithKeymap(<><Probe scope="Chat" actions={{ "chat:cancel": cancel }} fallback={fallback} /><Grab /></>);
    return { h, cancel, fallback, seam: () => seam! };
  };

  it("dispatches NOTHING while suspended, and hands the keyboard back afterwards", async () => {
    const { h, cancel, fallback, seam } = mount();
    await tick();
    h.stdin.write(ESC);
    expect(cancel).toHaveBeenCalledTimes(1);                     // baseline: the key path is live
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const flight = seam()(async () => {
      // ink-testing-library's stdin stub has a NO-OP pause(), so every one of these still emits "data" — which
      // is precisely why the provider must drop them itself rather than trusting the pause.
      h.stdin.write(ESC); h.stdin.write("\r"); h.stdin.write("typed");
      await held;
      return "edited";
    });
    await tick();
    expect(cancel).toHaveBeenCalledTimes(1);                     // …and nothing reached it during the flight
    expect(fallback).not.toHaveBeenCalled();
    release();
    expect(await flight).toBe("edited");
    h.stdin.write(ESC);
    expect(cancel).toHaveBeenCalledTimes(2);                     // restored
    h.unmount();
  });

  it("releases raw mode for the flight and takes it back, balanced, even when fn throws", async () => {
    const { h, seam } = mount();
    const calls: boolean[] = [];
    (h.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode = (v) => { calls.push(v); };
    await tick();
    calls.length = 0;
    await expect(seam()(async () => { throw new Error("editor blew up"); })).rejects.toThrow("editor blew up");
    expect(calls).toEqual([false, true]);                        // symmetric: Ink's refcount ends where it started
    h.unmount();
  });

  it("pauses and resumes the stream, and re-applies the latin1 encoding Ink resets on every toggle", async () => {
    const { h, seam } = mount();
    const order: string[] = [];
    const stub = h.stdin as unknown as { pause: () => void; resume: () => void; setEncoding: (e: string) => void };
    stub.pause = () => order.push("pause");
    stub.resume = () => order.push("resume");
    stub.setEncoding = (e) => order.push("encoding:" + e);
    await tick();
    order.length = 0;
    await seam()(async () => { order.push("edit"); });
    // Ink's handleSetRawMode sets utf8 on BOTH the disable and the enable (App.js:114) — without the re-flip the
    // provider would decode every later keystroke as utf8 and mangle high bytes.
    expect(order.filter((o) => o === "pause" || o === "edit" || o === "resume")).toEqual(["pause", "edit", "resume"]);
    expect(order[order.length - 1]).toBe("encoding:latin1");
    h.unmount();
  });

  it("a re-entrant call just runs fn (the terminal is already handed over)", async () => {
    const { h, seam } = mount();
    const calls: boolean[] = [];
    (h.stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode = (v) => { calls.push(v); };
    await tick();
    calls.length = 0;
    const inner = await seam()(async () => seam()(async () => "nested"));
    expect(inner).toBe("nested");
    expect(calls).toEqual([false, true]);                        // ONE handoff, not two
    h.unmount();
  });

  it("is null with no provider above — a tree with no input path has nothing to hand over", async () => {
    let seam: SuspendInput | null | undefined;
    function Grab() { seam = useSuspendInput(); return <Text>g</Text>; }
    const h = render(<Grab />);
    await tick();
    expect(seam).toBeNull();
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
