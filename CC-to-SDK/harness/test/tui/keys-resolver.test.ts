// tui/test/keys-resolver.test.ts — the resolver + chord machine (F2 task 4). Two rules carry everything here:
//  1. PRECEDENCE IS POSITIONAL (06 §1.5): the ordered active-context array is walked front to back and the FIRST
//     context that binds the key at all consumes it — an action returns `match`, a `null` returns `unbound` and
//     STOPS the search (that is how a user unbinds a default without the next context inheriting it).
//  2. CHORDS ARE GENERIC (06 §1.5 "Chords", upstream `Q4u`): any binding that is a strict extension of what has
//     been typed arms the pending prefix; while a chord pends, only extensions and `escape` are considered.
// The module is pure — the CALLER (task 5) owns the pending array and the 1 s timeout, so every test here just
// hands `resolveKey` an explicit `pending` and reads the returned `Resolution`.
import { describe, it, expect } from "vitest";
import { compileBindings, resolveKey, bindingFor } from "../../src/tui/keys/resolver.js";
import { parseChordSpec } from "../../src/tui/keys/normalize.js";
import { DEFAULT_BINDINGS, type ContextBindings } from "../../src/tui/keys/bindings.js";
import type { KeyEvent, KeyContextName } from "../../src/tui/keys/types.js";

const ev = (name: string, m: Partial<KeyEvent> = {}): KeyEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, super: false, raw: "", ...m });
const ctrl = (name: string) => ev(name, { ctrl: true });
/** The pending prefix a caller would be holding, written as a chord spec. */
const pend = (spec: string) => { const c = parseChordSpec(spec); expect(c, `unparseable pending ${spec}`).not.toBeNull(); return c!; };
const layer = (context: KeyContextName, bindings: Record<string, string | null>): ContextBindings => ({ context, bindings });

const BASE: ContextBindings[] = [
  layer("Global", { "ctrl+r": "history:search", escape: "app:global-esc" }),
  layer("Chat", { escape: "chat:cancel", "ctrl+x ctrl+k": "chat:killAgents" }),
];

describe("precedence: the first context that binds the key consumes it", () => {
  const t = compileBindings(BASE);
  it("index 0 of the active array wins over index 1", () =>
    expect(resolveKey(ev("escape"), ["Chat", "Global"], t, [])).toMatchObject({ type: "match", action: "chat:cancel", context: "Chat" }));
  it("reversing the array reverses the winner — priority is positional, not table order", () =>
    expect(resolveKey(ev("escape"), ["Global", "Chat"], t, [])).toMatchObject({ type: "match", action: "app:global-esc", context: "Global" }));
  it("a key only a lower context binds still resolves there", () =>
    expect(resolveKey(ctrl("r"), ["Chat", "Global"], t, [])).toMatchObject({ type: "match", action: "history:search", context: "Global" }));
  it("a key nobody binds is no-match", () => expect(resolveKey(ctrl("q"), ["Chat", "Global"], t, [])).toEqual({ type: "no-match" }));
  it("an empty active array resolves nothing", () => expect(resolveKey(ev("escape"), [], t, [])).toEqual({ type: "no-match" }));
  it("matching is strict on modifiers — shift+escape is not escape", () =>
    expect(resolveKey(ev("escape", { shift: true }), ["Chat", "Global"], t, [])).toEqual({ type: "no-match" }));
  it("a spelling alias in the table resolves the same canonical event (meta+p ≡ alt+p)", () => {
    const t2 = compileBindings([layer("Chat", { "meta+p": "chat:modelPicker" })]);
    expect(resolveKey(ev("p", { alt: true }), ["Chat"], t2, [])).toMatchObject({ type: "match", action: "chat:modelPicker" });
  });
});

describe("a null binding consumes the key and STOPS the search", () => {
  const t = compileBindings([...BASE, layer("Chat", { escape: null })]);
  it("Global does NOT inherit an escape the higher context unbound", () =>
    expect(resolveKey(ev("escape"), ["Chat", "Global"], t, [])).toEqual({ type: "unbound" }));
  it("the unbind is context-local — dropping Chat from the array frees Global's binding again", () =>
    expect(resolveKey(ev("escape"), ["Global"], t, [])).toMatchObject({ type: "match", action: "app:global-esc" }));
});

describe("merge: later layers win within a context", () => {
  it("a second layer overwrites the same key in the same context", () => {
    const t = compileBindings([layer("Chat", { "ctrl+l": "chat:clearInput" }), layer("Chat", { "ctrl+l": "chat:cancel" })]);
    expect(resolveKey(ctrl("l"), ["Chat"], t, [])).toMatchObject({ type: "match", action: "chat:cancel" });
  });
  it("overwrite is by CANONICAL key, so a re-spelling of the same key still overwrites", () => {
    const t = compileBindings([layer("Chat", { "ctrl+B": "a" }), layer("Chat", { "ctrl+shift+b": "b" })]);
    expect(resolveKey(ev("b", { ctrl: true, shift: true }), ["Chat"], t, [])).toMatchObject({ type: "match", action: "b" });
  });
  it("a later null unbinds an earlier action; a later action revives an earlier null", () => {
    expect(resolveKey(ctrl("l"), ["Chat"], compileBindings([layer("Chat", { "ctrl+l": "x" }), layer("Chat", { "ctrl+l": null })]), []))
      .toEqual({ type: "unbound" });
    expect(resolveKey(ctrl("l"), ["Chat"], compileBindings([layer("Chat", { "ctrl+l": null }), layer("Chat", { "ctrl+l": "x" })]), []))
      .toMatchObject({ type: "match", action: "x" });
  });
  it("layers for different contexts do not bleed into each other", () => {
    const t = compileBindings([layer("Chat", { "ctrl+l": "a" }), layer("Global", { "ctrl+l": "b" })]);
    expect(resolveKey(ctrl("l"), ["Global"], t, [])).toMatchObject({ type: "match", action: "b", context: "Global" });
  });
});

describe("the chord machine", () => {
  const t = compileBindings(BASE);
  it("a strict prefix arms the chord", () =>
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toMatchObject({ type: "chord-started", pending: [{ name: "x", ctrl: true }] }));
  it("the continuation completes it", () =>
    expect(resolveKey(ctrl("k"), ["Chat", "Global"], t, pend("ctrl+x"))).toMatchObject({ type: "match", action: "chat:killAgents", context: "Chat" }));
  it("escape while pending cancels and eats the key — Chat's own escape binding does NOT fire", () =>
    expect(resolveKey(ev("escape"), ["Chat", "Global"], t, pend("ctrl+x"))).toEqual({ type: "chord-cancelled" }));
  it("a key that extends nothing yields no-match (upstream drops it; the caller clears pending)", () =>
    expect(resolveKey(ctrl("z"), ["Chat", "Global"], t, pend("ctrl+x"))).toEqual({ type: "no-match" }));
  it("a key that is bound on its OWN but does not extend the chord still yields no-match while pending", () =>
    expect(resolveKey(ctrl("r"), ["Chat", "Global"], t, pend("ctrl+x"))).toEqual({ type: "no-match" }));
  it("a chord completion in a context that is not active does not fire", () =>
    expect(resolveKey(ctrl("k"), ["Global"], t, pend("ctrl+x"))).toEqual({ type: "no-match" }));
  it("chords longer than two keys walk one step at a time", () => {
    const t3 = compileBindings([layer("Chat", { "ctrl+x g s": "chat:killAgents" })]);
    expect(resolveKey(ctrl("x"), ["Chat"], t3, [])).toMatchObject({ type: "chord-started", pending: [{ name: "x", ctrl: true }] });
    expect(resolveKey(ev("g"), ["Chat"], t3, pend("ctrl+x"))).toMatchObject({ type: "chord-started", pending: [{ name: "x", ctrl: true }, { name: "g" }] });
    expect(resolveKey(ev("s"), ["Chat"], t3, pend("ctrl+x g"))).toMatchObject({ type: "match", action: "chat:killAgents" });
    expect(resolveKey(ev("s"), ["Chat"], t3, pend("ctrl+x"))).toEqual({ type: "no-match" });
  });
  it("a chord unbound to null resolves as unbound, not no-match", () => {
    const t4 = compileBindings([layer("Chat", { "ctrl+x ctrl+k": "chat:killAgents" }), layer("Chat", { "ctrl+x ctrl+k": null })]);
    expect(resolveKey(ctrl("k"), ["Chat"], t4, pend("ctrl+x"))).toEqual({ type: "unbound" });
  });
  it("escape that is itself a live continuation completes the chord instead of cancelling", () => {
    const t5 = compileBindings([layer("Chat", { "ctrl+x escape": "chat:cancel" })]);
    expect(resolveKey(ev("escape"), ["Chat"], t5, pend("ctrl+x"))).toMatchObject({ type: "match", action: "chat:cancel" });
  });
});

describe("prefix detection and the single-key/chord race", () => {
  it("a prefix in a HIGHER context arms even though a lower context binds the plain key to nothing", () => {
    const t = compileBindings([layer("Chat", { "ctrl+x ctrl+k": "chat:killAgents" }), layer("Global", { "ctrl+x": null })]);
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toMatchObject({ type: "chord-started" });
  });
  it("a prefix in a lower context still arms when no higher context claims the key", () => {
    const t = compileBindings([layer("Chat", { "ctrl+l": "chat:clearInput" }), layer("Global", { "ctrl+x ctrl+k": "a" })]);
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toMatchObject({ type: "chord-started" });
  });
  it("a single-key binding in a HIGHER context beats a chord continuation in a lower one (pending empty)", () => {
    const t = compileBindings([layer("Chat", { "ctrl+x": "chat:clearInput" }), layer("Global", { "ctrl+x ctrl+k": "a" })]);
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toMatchObject({ type: "match", action: "chat:clearInput", context: "Chat" });
  });
  it("a null in a HIGHER context likewise beats a lower context's chord", () => {
    const t = compileBindings([layer("Chat", { "ctrl+x": null }), layer("Global", { "ctrl+x ctrl+k": "a" })]);
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toEqual({ type: "unbound" });
  });
  it("exact beats prefix INSIDE one context — the same key bound alone and as a chord head", () => {
    const t = compileBindings([layer("Chat", { "ctrl+x": "chat:clearInput", "ctrl+x ctrl+k": "chat:killAgents" })]);
    expect(resolveKey(ctrl("x"), ["Chat"], t, [])).toMatchObject({ type: "match", action: "chat:clearInput" });
  });
});

describe("unknown context names", () => {
  const t = compileBindings(BASE);
  it("are skipped harmlessly in the active array", () =>
    expect(resolveKey(ev("escape"), ["Nope" as KeyContextName, "Chat", "Global"], t, []))
      .toMatchObject({ type: "match", action: "chat:cancel", context: "Chat" }));
  it("do not swallow a chord prefix either", () =>
    expect(resolveKey(ctrl("x"), ["Nope" as KeyContextName, "Chat"], t, [])).toMatchObject({ type: "chord-started" }));
});

describe("compileBindings tolerance (task 9 validates and reports; the resolver stays tolerant)", () => {
  it("an unparseable key spec is skipped, not thrown", () => {
    const t = compileBindings([layer("Chat", { "ctrl+": "bogus", "bad+mod+p": "bogus", "": "bogus", "ctrl+l": "chat:clearInput" })]);
    expect(resolveKey(ctrl("l"), ["Chat"], t, [])).toMatchObject({ type: "match", action: "chat:clearInput" });
  });
  it("an unknown context block is skipped, not thrown", () => {
    const t = compileBindings([{ context: "Nope" as KeyContextName, bindings: { "ctrl+l": "x" } }, layer("Chat", { "ctrl+l": "y" })]);
    expect(resolveKey(ctrl("l"), ["Nope" as KeyContextName, "Chat"], t, [])).toMatchObject({ type: "match", action: "y", context: "Chat" });
  });
  it("an empty layer list compiles to a table that resolves nothing", () =>
    expect(resolveKey(ctrl("l"), ["Chat"], compileBindings([]), [])).toEqual({ type: "no-match" }));
});

describe("bindingFor — the display string task 10 hints with", () => {
  const t = compileBindings(DEFAULT_BINDINGS);
  it("returns the canonical display form of a single key", () => expect(bindingFor(t, "history:search")).toBe("ctrl+r"));
  it("returns a chord space-separated", () => expect(bindingFor(t, "chat:killAgents")).toBe("ctrl+x ctrl+k"));
  it("returns null for an action nothing binds", () => expect(bindingFor(t, "help:show")).toBeNull());
  it("honors the context search order when an action is bound in several contexts", () => {
    const t2 = compileBindings([layer("Global", { "ctrl+g": "go" }), layer("Chat", { "ctrl+c": "go" })]);
    expect(bindingFor(t2, "go", ["Chat", "Global"])).toBe("ctrl+c");
    expect(bindingFor(t2, "go", ["Global", "Chat"])).toBe("ctrl+g");
  });
  it("searches every context when none are given", () => expect(bindingFor(t, "select:cancel")).toBe("escape"));
  it("ignores contexts that do not bind the action, and unknown ones", () =>
    expect(bindingFor(t, "chat:cycleMode", ["Nope" as KeyContextName, "Global", "Chat"])).toBe("shift+tab"));
  it("never reports a null (unbound) entry as a binding", () => {
    const t3 = compileBindings([layer("Chat", { "ctrl+l": "x" }), layer("Chat", { "ctrl+l": null })]);
    expect(bindingFor(t3, "x")).toBeNull();
  });
  it("prefers a single key over a chord when both bind the action (hints print ctrl+g, not ctrl+x ctrl+e)", () => {
    expect(bindingFor(t, "chat:externalEditor")).toBe("ctrl+g");
    const t4 = compileBindings([layer("Chat", { "ctrl+x ctrl+e": "ed" })]);
    expect(bindingFor(t4, "ed")).toBe("ctrl+x ctrl+e");   // chord still reported when it is all there is
  });
});

describe("a null-unbound chord must not arm its head (merge can never delete, so an armed null would eat the key forever)", () => {
  it("the plain key stays reachable in a lower context", () => {
    const t = compileBindings([
      layer("Chat", { "ctrl+x ctrl+k": "kill" }), layer("Global", { "ctrl+x": "app:interrupt" }),
      layer("Chat", { "ctrl+x ctrl+k": null }),
    ]);
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toEqual({ type: "match", action: "app:interrupt", context: "Global" });
  });
  it("with nothing below, the head simply no-matches instead of swallowing the next key", () => {
    const t = compileBindings([layer("Chat", { "ctrl+x ctrl+k": null })]);
    expect(resolveKey(ctrl("x"), ["Chat"], t, [])).toEqual({ type: "no-match" });
  });
  it("cross-context shadowing still works: a live chord below arms, and the null above wins the completion as unbound", () => {
    const t = compileBindings([layer("Global", { "ctrl+x ctrl+k": "kill" }), layer("Chat", { "ctrl+x ctrl+k": null })]);
    const armed = resolveKey(ctrl("x"), ["Chat", "Global"], t, []);
    expect(armed.type).toBe("chord-started");
    if (armed.type !== "chord-started") return;
    expect(resolveKey(ctrl("k"), ["Chat", "Global"], t, armed.pending)).toEqual({ type: "unbound" });
  });
});

describe("against the REAL default table", () => {
  const t = compileBindings(DEFAULT_BINDINGS);
  it("escape under an open list overlay is select:cancel, not chat:cancel", () =>
    expect(resolveKey(ev("escape"), ["Select", "Chat", "Global"], t, []))
      .toMatchObject({ type: "match", action: "select:cancel", context: "Select" }));
  it("ctrl+d over a confirmation dialog is unbound — the composer that owns it is unmounted", () =>
    expect(resolveKey(ctrl("d"), ["Confirmation", "Global"], t, [])).toEqual({ type: "unbound" }));
  it("ctrl+c over a confirmation dialog still reaches Global (the decision owner falls through)", () =>
    expect(resolveKey(ctrl("c"), ["Confirmation", "Global"], t, []))
      .toMatchObject({ type: "match", action: "app:interrupt", context: "Global" }));
  it("ctrl+x in chat arms the chord, and ctrl+k completes it", () => {
    expect(resolveKey(ctrl("x"), ["Chat", "Global"], t, [])).toMatchObject({ type: "chord-started" });
    expect(resolveKey(ctrl("k"), ["Chat", "Global"], t, pend("ctrl+x"))).toMatchObject({ type: "match", action: "chat:killAgents" });
    expect(resolveKey(ctrl("e"), ["Chat", "Global"], t, pend("ctrl+x"))).toMatchObject({ type: "match", action: "chat:externalEditor" });
  });
  it("the Task context contributes its own ctrl+x continuation while a turn runs", () =>
    expect(resolveKey(ctrl("b"), ["Task", "Chat", "Global"], t, pend("ctrl+x")))
      .toMatchObject({ type: "match", action: "task:background", context: "Task" }));
  // t8 review, Minor B. `Task` is pushed for the WHOLE turn and stays live under every overlay, so the two
  // stacks below are the real ones a user is in when a turn runs behind the bg panel or /config. Plain ctrl+b
  // is null there; the chord alias must drop the same way or one key is unbound while its alias still fires.
  it.each(["Select", "Settings"] as const)("%s drops ctrl+x ctrl+b during the pending walk, though Task armed it from underneath", (overlay) => {
    const stack: KeyContextName[] = [overlay, "Task", "Global"];
    expect(resolveKey(ctrl("x"), stack, t, []), "Task's chord head still arms — the null above does not").toMatchObject({ type: "chord-started" });
    expect(resolveKey(ctrl("b"), stack, t, pend("ctrl+x"))).toEqual({ type: "unbound" });
    expect(resolveKey(ctrl("b"), stack, t, []), "and the plain key is unbound too").toEqual({ type: "unbound" });
  });
  it("with the overlay closed the very same two keys background the turn again", () => {
    expect(resolveKey(ctrl("x"), ["Task", "Chat", "Global"], t, [])).toMatchObject({ type: "chord-started" });
    expect(resolveKey(ctrl("b"), ["Task", "Chat", "Global"], t, pend("ctrl+x")))
      .toMatchObject({ type: "match", action: "task:background", context: "Task" });
  });
  it("the overlay's own null never arms a prefix: with no turn running, ctrl+x inside it is dead", () =>
    expect(resolveKey(ctrl("x"), ["Select", "Global"], t, [])).toEqual({ type: "no-match" }));
  it("ctrl+r inside the history overlay is historySearch:next, and ctrl+o is dead there", () => {
    expect(resolveKey(ctrl("r"), ["HistorySearch", "Global"], t, []))
      .toMatchObject({ type: "match", action: "historySearch:next", context: "HistorySearch" });
    expect(resolveKey(ctrl("o"), ["HistorySearch", "Global"], t, [])).toEqual({ type: "unbound" });
  });
  it("shift+g in the pager is scroll:bottom while plain g is scroll:top (strict shift matching)", () => {
    expect(resolveKey(ev("g", { shift: true }), ["Transcript", "Global"], t, [])).toMatchObject({ type: "match", action: "scroll:bottom" });
    expect(resolveKey(ev("g"), ["Transcript", "Global"], t, [])).toMatchObject({ type: "match", action: "scroll:top" });
  });
});
