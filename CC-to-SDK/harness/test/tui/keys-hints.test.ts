// tui/test/keys-hints.test.ts — the canonical→human translation and the shortcut-grid row model (F2 task 10).
// Pure module, so this file needs no Ink and no provider; the LIVE end of the derivation (a user layer moving a
// hint, an unbind printing `(unbound)`) is proven against real components in keys-acceptance.test.tsx.
//
// The load-bearing property pinned here: under the DEFAULT keymap the derived grid reproduces the exact strings
// the overlay used to hardcode. That is what lets `honesty.test.tsx`'s corpus of executable proofs — written
// against those literals — keep auditing the grid without being rewritten to match a new vocabulary.
import { describe, it, expect } from "vitest";
import { UNBOUND, backgroundHintText, defaultLookup, formatBinding, formatBindingLower, formatBindings, shortcutRows } from "../../src/tui/keys/hints.js";
import { ROWS } from "../../src/tui/ShortcutsOverlay.js";

describe("formatBinding", () => {
  it("renders control chords the way the overlay always printed them", () => {
    expect(formatBinding("ctrl+t")).toBe("Ctrl-T");
    expect(formatBinding("ctrl+x ctrl+k")).toBe("Ctrl-X Ctrl-K");
    expect(formatBinding("alt+m")).toBe("Alt-M");
  });

  it("names the multi-character keys, not their canonical spellings", () => {
    expect(formatBinding("escape")).toBe("Esc");
    expect(formatBinding("shift+tab")).toBe("⇧Tab");
    expect(formatBinding("enter")).toBe("⏎");
    expect(formatBinding("pageup")).toBe("PgUp");
    expect(formatBinding("up")).toBe("↑");
  });

  it("passes an unknown name through capitalized rather than dropping the row", () => {
    expect(formatBinding("f13")).toBe("F13");
    expect(formatBinding("ctrl+mysterykey")).toBe("Ctrl-Mysterykey");
  });

  it("keeps the literal plus key readable", () => {
    expect(formatBinding("ctrl++")).toBe("Ctrl-+");
  });

  it("says `(unbound)` rather than printing nothing", () => {
    expect(formatBinding(null)).toBe(UNBOUND);
    expect(formatBinding("")).toBe(UNBOUND);
    expect(formatBindings([])).toBe(UNBOUND);
  });

  it("joins an alias pair, capped at what the row asked for", () => {
    expect(formatBindings(["ctrl+x ctrl+e", "ctrl+g", "ctrl+x ctrl+g"], 2)).toBe("Ctrl-X Ctrl-E / Ctrl-G");
    expect(formatBindings(["ctrl+x ctrl+e", "ctrl+g"])).toBe("Ctrl-X Ctrl-E");   // default: one
  });
});

describe("shortcutRows", () => {
  it("reproduces the hand-written grid exactly under the default keymap", () => {
    const rows = new Map(shortcutRows(defaultLookup, "darwin"));
    expect(rows.get("Ctrl-L")).toBe("clear input");
    expect(rows.get("⇧Tab")).toBe("mode ladder");
    expect(rows.get("Esc")).toBe("interrupt (while running)");
    expect(rows.get("Esc Esc")).toBe("clear input · rewind when empty");
    expect(rows.get("Ctrl-X Ctrl-E / Ctrl-G")).toBe("edit in $EDITOR");
    expect(rows.get("Ctrl-X Ctrl-K")).toBe("stop background agents (×2)");
    expect(rows.get("Ctrl-C ×2")).toBe("exit");
    expect(rows.get("Ctrl-D ×2")).toBe("exit");
  });

  it("follows a rebinding, and reports an unbind as unbound", () => {
    const moved = (action: string) => (action === "chat:cycleMode" ? ["alt+m"] : action === "app:toggleTodos" ? [] : defaultLookup(action));
    const rows = new Map(shortcutRows(moved, "darwin").map(([k, v]) => [v, k]));
    expect(rows.get("mode ladder")).toBe("Alt-M");
    expect(rows.get("todo panel")).toBe(UNBOUND);
  });

  it("never prints `(unbound) (unbound)` for a double-press row", () => {
    const none = () => [] as string[];
    const rows = new Map(shortcutRows(none, "darwin").map(([k, v]) => [v, k]));
    expect(rows.get("clear input · rewind when empty")).toBe(UNBOUND);
  });

  it("drops the Ctrl-Z row on Windows, where suspendProcess is a no-op", () => {
    const keys = shortcutRows(defaultLookup, "win32").map(([k]) => k);
    expect(keys).not.toContain("Ctrl-Z");
    expect(shortcutRows(defaultLookup, "darwin").map(([k]) => k)).toContain("Ctrl-Z");
  });

  it("is what ShortcutsOverlay exports as the audited default grid", () => {
    expect(ROWS).toEqual(shortcutRows(defaultLookup));
  });
});

// ── F3 Task 9 (LT20): the Bash background hint's chord, in upstream's OTHER display grammar ──────────────
// `BackgroundHint` (2.1.220 bundle 240646037) renders `$e({chord, action:"run in background", parens:true,
// format:{keyCase:"lower"}})`, i.e. `("(", chord, " to ", action, ")")` with the LOWERCASE preset — not the
// `Ctrl-B` grammar the shortcuts grid uses. Both are derived from the same live table, so a rebind moves both.
describe("backgroundHintText (LT20)", () => {
  it("prints the lower-case chord grammar upstream's BackgroundHint uses", () => {
    expect(formatBindingLower("ctrl+b")).toBe("ctrl+b");
    expect(formatBindingLower("ctrl+x ctrl+b")).toBe("ctrl+x ctrl+b");
    expect(formatBindingLower("escape")).toBe("esc");
    expect(formatBindingLower("pageup")).toBe("pgup");
    expect(formatBindingLower("alt+m", "darwin")).toBe("opt+m");
    expect(formatBindingLower("alt+m", "linux")).toBe("alt+m");
  });

  it("composes the parenthetical from the live binding for task:background", () => {
    expect(backgroundHintText(["ctrl+b"], false)).toBe("(ctrl+b to run in background)");
    expect(backgroundHintText(defaultLookup("task:background"), false)).toBe("(ctrl+b to run in background)");
  });

  it("prefers a plain key over a chord alias, exactly as the shortcuts grid does", () => {
    expect(backgroundHintText(["ctrl+x ctrl+b", "ctrl+b"], false)).toBe("(ctrl+b to run in background)");
    expect(backgroundHintText(["ctrl+x ctrl+b"], false)).toBe("(ctrl+x ctrl+b to run in background)");
  });

  it("doubles the chord under tmux — but ONLY when it is still upstream's own ctrl+b", () => {
    expect(backgroundHintText(["ctrl+b"], true)).toBe("(ctrl+b ctrl+b (twice) to run in background)");
    expect(backgroundHintText(["ctrl+k"], true)).toBe("(ctrl+k to run in background)");
  });

  it("renders NO hint at all for an unbound action — never `(unbound)` inside this parenthetical", () => {
    expect(backgroundHintText([], false)).toBeUndefined();
    expect(backgroundHintText([], true)).toBeUndefined();
  });
});
