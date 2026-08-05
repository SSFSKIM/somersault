// tui/test/keys-bindings.test.ts — the default binding table (F2 task 3). The table is DATA: these are the
// invariants that keep it honest as it grows (every context real, every key parseable, every action declared, no
// key bound twice under two spellings, no error-reserved key quietly rebound). Every check runs on the canonical
// chord string from keys/normalize.ts, never on the raw spec text — `ctrl+B` and `ctrl+shift+b` are ONE key, and a
// dedup that compares raw text would wave that collision through.
import { describe, it, expect } from "vitest";
import { VALID_CONTEXTS, VALID_ACTIONS, DEFAULT_BINDINGS, RESERVED_KEYS, type ContextBindings } from "../../src/tui/keys/bindings.js";
import { parseChordSpec, specKey } from "../../src/tui/keys/normalize.js";

/** The canon a table key is compared by: parse the chord, canonicalize each member, rejoin. Null on garbage. */
const canon = (spec: string): string | null => { const c = parseChordSpec(spec); return c ? c.map(specKey).join(" ") : null; };
const block = (name: string): ContextBindings => {
  const b = DEFAULT_BINDINGS.find((x) => x.context === name);
  expect(b, `DEFAULT_BINDINGS is missing a ${name} block`).toBeTruthy();
  return b!;
};
const entries = (b: ContextBindings) => Object.entries(b.bindings);
/** Every (context, key, action) triple, flattened — null actions (explicit unbinds) included. */
const all = DEFAULT_BINDINGS.flatMap((b) => entries(b).map(([key, action]) => ({ context: b.context, key, action })));

/** The reserved-collision invariant, as a function so a synthetic bad table can prove it actually bites. */
function reservedCollisions(table: readonly ContextBindings[]): string[] {
  const out: string[] = [];
  for (const b of table) for (const [key, action] of entries(b)) {
    if (action === null) continue;                                  // an explicit unbind is not a rebind
    const c = canon(key); if (!c) continue;
    if (RESERVED_KEYS[c]?.severity === "error") out.push(`${b.context} ${c}`);
  }
  return out;
}
/** The duplicate invariant, likewise: two spellings of one key inside one context block. */
function duplicateKeys(table: readonly ContextBindings[]): string[] {
  const out: string[] = [];
  for (const b of table) {
    const seen = new Set<string>();
    for (const [key] of entries(b)) { const c = canon(key); if (!c) continue; if (seen.has(c)) out.push(`${b.context} ${c}`); seen.add(c); }
  }
  return out;
}

describe("the context registry", () => {
  // 20 upstream + 1 of ours. `SelectDecision` is the only name in the registry that upstream does not have,
  // and it is deliberate: upstream routes root globals by OWNER while we route by context name, so a `Select`
  // list that is a DECISION surface needs a second name to stop inheriting the overlay suppression (F6 T2
  // review, Important 1 — see the block in bindings.ts and the pins further down this file).
  it("has exactly the 20 upstream contexts plus SelectDecision, with no duplicates", () => {
    expect(VALID_CONTEXTS).toHaveLength(21);
    expect(new Set(VALID_CONTEXTS).size).toBe(21);
    expect(VALID_CONTEXTS).toContain("SelectDecision");
  });
  it("includes DiffPanel — a valid context with zero default bindings (06 §1.1)", () =>
    expect(VALID_CONTEXTS).toContain("DiffPanel"));
  it("every context block names a registered context", () => {
    for (const b of DEFAULT_BINDINGS) expect(VALID_CONTEXTS, `unknown context ${b.context}`).toContain(b.context);
  });
  it("no context is declared twice", () => {
    const names = DEFAULT_BINDINGS.map((b) => b.context);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("every key spec in the table parses", () => {
  it.each(DEFAULT_BINDINGS.map((b) => [b.context] as const))("%s", (context) => {
    for (const [key] of entries(block(context))) expect(canon(key), `${context}: unparseable key ${JSON.stringify(key)}`).not.toBeNull();
  });
  it("chord specs survive the round trip (ctrl+x ctrl+k is two keys, not a name)", () =>
    expect(canon("ctrl+x ctrl+k")).toBe("ctrl+x ctrl+k"));
});

describe("actions", () => {
  it("every bound action is declared in VALID_ACTIONS", () => {
    for (const { context, key, action } of all) if (action !== null)
      expect(VALID_ACTIONS, `${context} ${key} → undeclared action ${action}`).toContain(action);
  });
  it("VALID_ACTIONS is exactly the table's actions plus the rebind-only help:show", () => {
    const used = new Set(all.map((x) => x.action).filter((a): a is string => a !== null));
    expect([...VALID_ACTIONS].sort()).toEqual([...new Set([...used, "help:show"])].sort());
  });
  it("has no duplicates", () => expect(new Set(VALID_ACTIONS).size).toBe(VALID_ACTIONS.length));
});

describe("reserved keys", () => {
  it("every reserved key is itself a parseable, already-canonical spec", () => {
    for (const key of Object.keys(RESERVED_KEYS)) expect(canon(key), `reserved ${key}`).toBe(key);
  });
  it("carries upstream's severities — ctrl+z is the lone warning (06 §1.4)", () => {
    expect(RESERVED_KEYS["ctrl+z"].severity).toBe("warning");
    expect(Object.entries(RESERVED_KEYS).filter(([, v]) => v.severity === "warning").map(([k]) => k)).toEqual(["ctrl+z"]);
    for (const [k, v] of Object.entries(RESERVED_KEYS)) expect(v.reason.length, `${k} needs a reason`).toBeGreaterThan(0);
  });
  it("ships the macOS block unconditionally (ccx targets darwin first)", () => {
    for (const k of ["super+c", "super+v", "super+x", "super+q", "super+w", "super+tab", "super+space"])
      expect(RESERVED_KEYS[k]?.severity).toBe("error");
  });
  it("cmd+c is the same reserved key as super+c — the registry is keyed by the canon", () =>
    expect(RESERVED_KEYS[canon("cmd+c")!]).toBeTruthy());
  // The only error-reserved keys the DEFAULT table is allowed to bind: keys ccx hardcodes anyway, kept in the
  // table so hints and the resolver can see them, still blocked from USER rebinding by RESERVED_KEYS.
  const GRANDFATHERED = ["Global ctrl+c", "Global ctrl+d", "Chat ctrl+d", "Transcript ctrl+c", "Transcript ctrl+d", "HistorySearch ctrl+c"];
  it("no default binding collides with an error-reserved key beyond the grandfathered pairs", () =>
    expect(reservedCollisions(DEFAULT_BINDINGS).sort()).toEqual([...GRANDFATHERED].sort()));
  it("the collision check bites — a new reserved binding is caught", () =>
    expect(reservedCollisions([{ context: "Select", bindings: { "ctrl+\\": "select:cancel" } }])).toEqual(["Select ctrl+\\"]));
  it("an explicit unbind of a reserved key is not a collision", () =>
    expect(reservedCollisions([{ context: "Select", bindings: { "ctrl+c": null } }])).toEqual([]));
});

describe("no key is bound twice inside one context", () => {
  it("the real table is clean", () => expect(duplicateKeys(DEFAULT_BINDINGS)).toEqual([]));
  it("the check compares CANONICAL chords, so aliased spellings are caught", () => {
    expect(duplicateKeys([{ context: "Chat", bindings: { "ctrl+B": "a", "ctrl+shift+b": "b" } }])).toEqual(["Chat ctrl+shift+b"]);
    expect(duplicateKeys([{ context: "Chat", bindings: { "meta+p": "a", "alt+p": "b" } }])).toEqual(["Chat alt+p"]);
    expect(duplicateKeys([{ context: "Chat", bindings: { "ctrl+-": "a", "ctrl+shift+_": "b" } }])).toEqual(["Chat ctrl+_"]);
  });
});

// The gate this pins is ChatApp.tsx:126-159 (plus ChatComposer.tsx:165 for ctrl+d, whose owner check lives in the
// composer). owner === "overlay" returns before EVERY root global; owner === "decision" falls through and keeps
// them all. Null here means "this Global binding does not reach this context" — today's truth, not a redesign.
describe("overlay gating, expressed as null bindings", () => {
  const GLOBAL_KEYS = ["ctrl+c", "ctrl+d", "ctrl+o", "ctrl+t", "ctrl+r", "ctrl+b"];
  it("Global binds exactly the six keys the owner gate arbitrates", () =>
    expect(Object.keys(block("Global").bindings).sort()).toEqual([...GLOBAL_KEYS].sort()));
  it.each(["Select", "Settings", "MessageSelector"])("%s is an overlay owner: every Global key is unbound", (context) => {
    const b = block(context).bindings;
    for (const k of GLOBAL_KEYS) expect(b[k], `${context} ${k} must be null`).toBeNull();
  });
  // t8 review, Minor B: `Task` stays pushed for the whole turn and sits BELOW any overlay, so unbinding plain
  // ctrl+b without its chord alias left `ctrl+x ctrl+b` still backgrounding the turn from inside the bg panel
  // or /config — one key unbound while its alias worked, exactly the split this table exists to remove.
  // Costs the overlay nothing: a null-bound chord does not arm its own prefix (resolver.ts's compile step), it
  // is only consulted during the pending walk — keys-resolver.test.ts pins that half.
  // Final review (deferred t8 minor), extended to the other three surfaces the same split reached:
  // MessageSelector and HistorySearch nulled the plain key and stopped there, and Transcript REBOUND ctrl+b to
  // scroll:fullPageUp while leaving the alias to fall through to `Task` — a pager whose ctrl+b scrolls and
  // whose ctrl+x ctrl+b backgrounds the running turn from inside it.
  it.each(["Select", "Settings", "MessageSelector", "HistorySearch", "Transcript"])("%s unbinds task:background's chord alias too, not just the plain ctrl+b", (context) => {
    expect(block(context).bindings["ctrl+x ctrl+b"], `${context} ctrl+x ctrl+b must be null`).toBeNull();
  });
  // The other half of the gate, and the defect that produced this context: owner === "decision" FALLS THROUGH
  // and keeps every root global. `Confirmation` has always expressed that; `SelectDecision` is the same claim
  // for a list-shaped decision surface, and without it QuestionDialog's migration onto `Select` silently made
  // Ctrl-C and Ctrl-O dead over a parked question.
  it("SelectDecision is a DECISION owner: it keeps every root global, exactly like Confirmation", () => {
    const b = block("SelectDecision").bindings;
    for (const k of ["ctrl+c", "ctrl+o", "ctrl+t", "ctrl+r", "ctrl+b", "ctrl+x ctrl+b"]) {
      expect(k in b, `SelectDecision must not bind ${k} at all`).toBe(false);
    }
    expect(b["ctrl+d"], "…except ctrl+d, whose owner (the composer) is unmounted").toBeNull();
    for (const k of ["alt+p", "alt+t"]) expect(b[k], `SelectDecision ${k} must be null (Confirmation's rule)`).toBeNull();
  });
  it("SelectDecision offers the same eight actions as Select — only the suppression differs", () => {
    const sel = block("Select").bindings, dec = block("SelectDecision").bindings;
    const actions = (b: Record<string, string | null>) => Object.entries(b).filter(([, v]) => v !== null).sort();
    expect(actions(dec)).toEqual(actions(sel));
  });
  it("HistorySearch is an overlay owner too, but rebinds ctrl+r/ctrl+c instead of unbinding them", () => {
    const b = block("HistorySearch").bindings;
    for (const k of ["ctrl+o", "ctrl+t", "ctrl+b", "ctrl+d"]) expect(b[k], `HistorySearch ${k} must be null`).toBeNull();
    expect(b["ctrl+r"]).toBe("historySearch:next");
    expect(b["ctrl+c"]).toBe("historySearch:cancel");
  });
  // F2 task 7 carry-forward: the pager used to be gated by owner === "transcript", which killed every root
  // global except ChatApp's own ctrl+o close arm. Transcript rebinds four of the six to pager operations, so
  // the remaining two MUST be explicit unbinds — otherwise migrating the pager onto the scope stack would
  // newly fire history-search and the todo panel from inside it, through Global.
  it("Transcript rebinds four Global keys to pager operations and unbinds the other two", () => {
    const b = block("Transcript").bindings;
    expect(b["ctrl+c"]).toBe("transcript:exit");
    expect(b["ctrl+o"]).toBe("transcript:exit");
    expect(b["ctrl+d"]).toBe("scroll:halfPageDown");
    expect(b["ctrl+b"]).toBe("scroll:fullPageUp");
    for (const k of ["ctrl+r", "ctrl+t"]) expect(b[k], `Transcript ${k} must be null`).toBeNull();
    for (const k of GLOBAL_KEYS) expect(b, `Transcript ${k} must be spoken for`).toHaveProperty(k);
  });
  it("Confirmation is the decision owner: the gate deliberately keeps the root globals live", () => {
    const b = block("Confirmation").bindings;
    for (const k of ["ctrl+c", "ctrl+o", "ctrl+t", "ctrl+r", "ctrl+b"]) expect(b, `Confirmation must not touch ${k}`).not.toHaveProperty(k);
    expect(b["ctrl+d"], "ctrl+d is composer-gated (ChatComposer.tsx:165), dead behind a dialog").toBeNull();
  });
  it("the composer contexts never unbind a global", () => {
    for (const context of ["Chat", "Autocomplete", "Task"]) {
      for (const [key, action] of entries(block(context))) expect(action, `${context} ${key}`).not.toBeNull();
    }
  });
});
