// tui/test/permissions-dialog.test.tsx — the `/permissions` dialog's own component test (Wave S t6). There
// was none before: `small-permissions.test.tsx` covers the four permission-KIND dialogs plus `PermissionDialog`
// (a different component), and `permissionsModel.test.ts` covers the pure row model.
//
// Round 6a swaps this dialog's row cursor from an INDEX to a per-row VALUE, which is a pure refactor at the
// frame level — so most of what is below are GUARDS: they pass before the swap and must still pass after it.
// The one genuinely new claim is the collision rule (two sources may declare the exact same rule string, and
// the two rows must stay separately addressable) — that one is red under the obvious `rule:${text}` scheme.
//
// Round 6b mounts the `Select` under that value cursor, which is what brings the WINDOW, the counted
// indicators and the four paging keys (W-S3: the fix is the migration, not four new bindings on the `Settings`
// context — binding a page key onto a list that renders every row it has is the "resolves but moves nothing"
// defect F2 exists to remove). The 6a block below is unchanged and is now doing a second job: every one of its
// claims is a behaviour `Select` had to preserve rather than quietly re-break, the delete-cursor one above all.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { PermissionsDialog, PERMISSIONS_CHROME_ROWS, permissionsVisibleRows } from "../../src/tui/PermissionsDialog.js";
import { POINTER } from "../../src/tui/select/Select.js";
import type { AddDirVerdict } from "../../src/tui/addDir.js";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Match the pointer against the SGR-STRIPPED frame throughout. The gutter and the row body share one styled
 *  span today, so a raw match works — but that is exactly the coupling 6b breaks when `Select` draws the
 *  pointer in its own coloured span, and a test that pins the raw bytes would then fail for no behavioural
 *  reason (the trap this wave hit twice). */
const plain = (f: () => string | undefined) => stripAnsi(frame(f));
/** One frame's rows, border chrome and padding stripped — the frame's own answer to "what is on screen". */
const rowsOf = (f: () => string | undefined) => plain(f).split("\n").map((l) => l.replace(/[│╭╮╰╯]/g, "").trim());
/** …and just the row(s) wearing the pointer. Naming the row the cursor IS on beats asserting it is not on some
 *  other one: when it goes wrong the diff says where it actually landed, instead of leaving that to guesswork. */
const pointerRows = (f: () => string | undefined) => rowsOf(f).filter((l) => l.startsWith("❯"));
/** `what` names the thing being waited for, so a hang reads as "waitFor timeout: the delete confirm" rather
 *  than a bare timeout that could be any of a dozen lines above it. */
async function waitFor(cond: () => boolean, what = "condition", timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error(`waitFor timeout: ${what}`); await new Promise((r) => setTimeout(r, 5)); }
}

const DOWN = "\x1b[B", ENTER = "\r", ESC = "\x1b", SPACE = " ", RIGHT = "\x1b[C", LEFT = "\x1b[D";

/** One removable rule (source "flagSettings" is the only layer this dialog treats as ours — permissionsModel
 *  gives everything else `readOnly:true`, which routes Enter to the read-only details view instead). */
const oneRemovable = { sources: [{ source: "flagSettings", settings: { permissions: { allow: ["Bash(ls)"] } } }] };

function props(over: Partial<Parameters<typeof PermissionsDialog>[0]> = {}) {
  return {
    tab: "Allow", onTabChange: () => {}, denials: [], cwd: "/tmp",
    fetchSettings: async () => oneRemovable as unknown,
    fetchDirs: async () => [],
    addRule: async () => {}, removeRule: async () => {}, removeDir: async () => {},
    addDirValidate: async () => ({ kind: "missing", abs: "" }) as AddDirVerdict,
    confirmAddDir: async () => {}, cancelAddDir: () => {}, onDone: () => {},
    ...over,
  };
}

describe("PermissionsDialog — row identity (Wave S t6a)", () => {
  it("still opens the delete confirm on Enter over a rule, and Esc still backs out", async () => {
    const { stdin, lastFrame } = render(<PermissionsDialog {...props()} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"), "the cursor to reach the rule");   // row 0 is "Add a new rule…"
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"), "the delete confirm to open");
    expect(frame(lastFrame)).toContain("Enter to delete");
    // Wait on the REPAINT, not on the thing being asserted. Waiting for "❯ Bash(ls)" made the two claims below
    // true by construction, so a mutation that got Esc wrong surfaced as a bare "waitFor timeout" with no clue
    // what the frame did say; wait for any repaint at all and each claim fails as itself, with the diff.
    const confirmFrame = plain(lastFrame);
    stdin.write(ESC); await waitFor(() => plain(lastFrame) !== confirmFrame, "Esc to repaint anything at all");
    const after = plain(lastFrame);
    expect(after, "Esc closed the delete confirm").not.toContain("Enter to delete");
    expect(after, "…and landed back on the LIST, cursor still on the rule").toContain("❯ Bash(ls)");
    expect(after, "…and Esc backed out to the LIST, not out of the dialog").toContain("Permissions");
  });

  it("a stray space over a rule opens the confirm but never removes it", async () => {
    const removed: string[] = [];
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({ removeRule: async (_b: unknown, rule: string) => { removed.push(rule); } })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));
    stdin.write(SPACE); await tick();
    // The positive half is what keeps the negative one honest: `select:accept` is bound to {enter, space}, so
    // the space MUST have reached this component and opened the confirm. Without this line the assertion below
    // would also pass on a dialog that never saw the key at all.
    await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"));
    expect(removed, "space opens the confirm; only the confirm's own Enter may remove").toEqual([]);
    // …and the spy IS wired: the confirm's Enter does reach removeRule, so the emptiness above is a real
    // absence rather than a callback nobody ever calls.
    stdin.write(ENTER); await waitFor(() => removed.length === 1);
    expect(removed).toEqual(["Bash(ls)"]);
  });

  // The value cursor's PURPOSE is to survive a rebuild that KEEPS your row — but every rebuild here comes from
  // a mutation, and the commonest one deletes the row you are standing on. `values.indexOf` then misses, and a
  // value has no answer left; only a position does. The pre-6a index cursor (an index plus a clamp) left the
  // pointer on the row that took the deleted one's place, which is what makes deleting a run of rules a
  // hold-Enter operation instead of one arrow press per row you had descended. 6a's first cut fell back to 0
  // and sent the cursor to the top affordance row instead — this test is red against it.
  //
  // It OUTLIVES the fallback it was written for: 6b hands focus to `Select`, which stores focus as an index and
  // clamps it to `count - 1` when `options` shrinks, so the fallback goes away and this stays as the proof that
  // `Select` preserved the behaviour rather than quietly re-breaking it.
  it("leaves the cursor on the row that replaced the one it just deleted", async () => {
    let allow = ["Bash(a)", "Bash(b)", "Bash(c)", "Bash(d)"];
    const removed: string[] = [];
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({
      fetchSettings: async () => ({ sources: [{ source: "flagSettings", settings: { permissions: { allow } } }] }) as unknown,
      removeRule: async (_b: unknown, rule: string) => { removed.push(rule); allow = allow.filter((r) => r !== rule); },
    })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"), "the rule list to load");
    for (const want of ["Bash(a)", "Bash(b)", "Bash(c)"]) {
      stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes(`❯ ${want}`), `the cursor to reach ${want}`);
    }
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"), "the delete confirm to open");
    stdin.write(ENTER); await waitFor(() => !plain(lastFrame).includes("Bash(c)"), "the refetched list to drop the deleted rule");
    expect(removed, "the confirm's Enter deleted the rule the cursor was actually on").toEqual(["Bash(c)"]);
    const pointed = pointerRows(lastFrame);
    expect(pointed, "exactly one row wears the pointer").toHaveLength(1);
    expect(pointed[0], "the cursor holds its POSITION — the row that took the deleted one's place, not the top of the list").toMatch(/^❯ Bash\(d\)/);
  });

  // THE ONE NEW CLAIM OF 6a. `ruleRows` emits one row per (source, rule) pair, so the same rule string
  // declared by two settings layers is two rows with identical text — the naive `rule:${it.row.rule}` identity
  // collapses them, and a value cursor that cannot tell them apart gets STUCK on the first (its "move down"
  // resolves to the same string it already holds). Verified red against that scheme before shipping the
  // occurrence-suffixed one.
  it("keeps two identically-named rules from different sources separately addressable", async () => {
    const dup = {
      sources: [
        { source: "userSettings", settings: { permissions: { allow: ["Bash(ls)"] } } },
        { source: "projectSettings", settings: { permissions: { allow: ["Bash(ls)"] } } },
      ],
    };
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({ fetchSettings: async () => dup as unknown })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));
    stdin.write(DOWN); await tick();
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Rule details"));
    // Both rows are read-only, so both open the SAME sub-view — the provenance line is the only thing that
    // says which row the cursor was actually on.
    expect(frame(lastFrame), "the second ↓ landed on the SECOND of the two identical rows").toContain("From shared project settings");
  });

  // …and the case the occurrence suffix alone answers: ONE source listing the same rule twice. Here the two
  // values would be byte-identical even with the source folded in, so a naive scheme leaves the cursor STUCK
  // — "move to the row below" resolves to the string it already holds. Only the frame can tell: both rows
  // read the same, so which one wears the pointer is the whole assertion.
  it("keeps a rule a single source lists twice separately addressable", async () => {
    const twice = { sources: [{ source: "userSettings", settings: { permissions: { allow: ["Bash(ls)", "Bash(ls)"] } } }] };
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({ fetchSettings: async () => twice as unknown })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));
    stdin.write(DOWN); await tick(); await tick();
    const rows = plain(lastFrame).split("\n").map((l) => l.replace(/[│╭╮╰╯]/g, "").trim()).filter((l) => l.includes("Bash(ls)"));
    expect(rows, "both duplicates render as their own row").toHaveLength(2);
    expect(rows[0].startsWith("❯"), "the cursor left the first duplicate").toBe(false);
    expect(rows[1].startsWith("❯"), "…and landed on the second").toBe(true);
  });

  it("a cursor from one tab does not carry into another tab's list", async () => {
    function Host() {
      const [tab, setTab] = React.useState("Allow");
      return <PermissionsDialog {...props({ tab, onTabChange: setTab })} />;
    }
    const { stdin, lastFrame } = render(<Host />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"), "the cursor to reach the rule");
    stdin.write(RIGHT); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."), "the Ask tab");
    stdin.write(LEFT); await waitFor(() => frame(lastFrame).includes("Claude Code won't ask before using allowed tools."), "the Allow tab to come back");
    // Wait for the LIST, then name the row the cursor is on. Waiting for "❯ Add a new rule…" and then asserting
    // "not ❯ Bash(ls)" put the whole claim in the waiting: a broken reset could only ever time out.
    await waitFor(() => plain(lastFrame).includes("Bash(ls)"), "the Allow tab's rule list to repaint");
    const pointed = pointerRows(lastFrame);
    expect(pointed, "exactly one row wears the pointer").toHaveLength(1);
    expect(pointed[0], "back on Allow the cursor is on the TOP row, not where this tab left it").toBe("❯ Add a new rule…");
  });
});

// ── ROUND 6b — THE WINDOW ────────────────────────────────────────────────────────────────────────────────
const PAGE_DOWN = "\x1b[6~", PAGE_UP = "\x1b[5~", HOME = "\x1b[H", END = "\x1b[F";
/** Thirty rules is past any window this dialog can be given in a test, and `flagSettings` keeps them all
 *  removable — the same layer `oneRemovable` uses, so the Enter path stays the delete confirm. */
const MANY = Array.from({ length: 30 }, (_, i) => `Bash(cmd${i}:*)`);
const manyRules = { sources: [{ source: "flagSettings", settings: { permissions: { allow: MANY } } }] };
/** `ruleRows` emits its rows LEXICOGRAPHICALLY, so the bottom of this list is `cmd9`, not `cmd29`. Named once
 *  because three cases below turn on it and the first draft of two of them assumed insertion order. The row
 *  renders as `<rule>  From <source>`; `flagSettings` is "command line arguments". */
const LAST_RULE = "Bash(cmd9:*)  From command line arguments";
/** The label on the row carrying the `❯` gutter (settings-dialog.test.tsx's own helper). Reads from the FIRST
 *  pointer on the line so the box's `│` rule does not get in. */
const focusedRow = (f: () => string | undefined): string => {
  const line = rowsOf(f).find((l) => l.includes(POINTER));
  return line === undefined ? "" : line.slice(line.indexOf(POINTER) + POINTER.length).trim();
};
/** How many RULE rows the frame paints. Matched on the row's gutter + label, not on the bare rule text: the
 *  gutter is `❯` on the focused row, `↑`/`↓` on a window edge with more beyond it (Select.tsx:282-284) and a
 *  space otherwise — and a bare-text match would also count the delete confirm's own echo of the rule. */
const ruleRowCount = (f: () => string | undefined): number =>
  plain(f).split("\n").filter((l) => new RegExp(`[${POINTER}↑↓ ] Bash\\(cmd\\d+:\\*\\)`).test(l)).length;

describe("PermissionsDialog — the rule list windows from the height it is given (Wave S t6b, A6)", () => {
  it("windows an unbounded rule list and reports what it clipped", async () => {
    const r = render(<PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={20} columns={80} />);
    await waitFor(() => plain(r.lastFrame).includes("Add a new rule…"), "the rule list to load");
    expect(plain(r.lastFrame)).toMatch(/↓ \d+ more below/);
    // 31 rows (the affordance row plus 30 rules) cannot fit under a pane of 20, and the count in the
    // indicator has to agree with what was actually clipped.
    expect(ruleRowCount(r.lastFrame)).toBeLessThan(MANY.length);
    expect(plain(r.lastFrame)).toContain(`↓ ${31 - permissionsVisibleRows(20)} more below`);
    r.unmount();
  });

  it("shows every row and neither indicator when the pane is tall enough", async () => {
    const r = render(<PermissionsDialog {...props()} rows={40} columns={80} />);   // 1 affordance row + 1 rule
    await waitFor(() => plain(r.lastFrame).includes("Bash(ls)"), "the rule list to load");
    expect(plain(r.lastFrame)).not.toMatch(/more below/);
    expect(plain(r.lastFrame)).not.toMatch(/more above/);
    r.unmount();
  });

  // The window is a FUNCTION of the height, not two states: two panes one row apart must differ by one
  // visible row AND by one in the counted indicator. A constant satisfies neither.
  it("grows the window one row per row of pane, and counts the clipped rows", async () => {
    const a = render(<PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={20} columns={80} />);
    await waitFor(() => plain(a.lastFrame).includes("Add a new rule…"));
    expect(ruleRowCount(a.lastFrame)).toBe(permissionsVisibleRows(20) - 1);        // less the "Add a new rule…" row
    expect(plain(a.lastFrame)).toContain(`↓ ${31 - permissionsVisibleRows(20)} more below`);
    a.unmount();
    const b = render(<PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={21} columns={80} />);
    await waitFor(() => plain(b.lastFrame).includes("Add a new rule…"));
    expect(permissionsVisibleRows(21)).toBe(permissionsVisibleRows(20) + 1);
    expect(ruleRowCount(b.lastFrame)).toBe(permissionsVisibleRows(21) - 1);
    expect(plain(b.lastFrame)).toContain(`↓ ${31 - permissionsVisibleRows(21)} more below`);
    b.unmount();
  });

  it("draws `↑ N more above` once the cursor has scrolled the window off the top", async () => {
    const r = render(<PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={20} columns={80} />);
    await waitFor(() => plain(r.lastFrame).includes("Add a new rule…"));
    r.stdin.write(END);
    await waitFor(() => focusedRow(r.lastFrame) === LAST_RULE, "the cursor to reach the last rule");
    expect(plain(r.lastFrame)).toMatch(/↑ \d+ more above/);
    expect(plain(r.lastFrame)).not.toMatch(/more below/);
    r.unmount();
  });

  // W-S11: upstream's Permissions gets pageup/pagedown from `jr`'s raw handler and has NO home/end at all.
  // These four resolve in the `Select` context the inner list pushes, which is what the migration bought.
  it("moves the selection with the four paging keys", async () => {
    const r = render(<PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={20} columns={80} />);
    await waitFor(() => focusedRow(r.lastFrame) !== "");
    const before = focusedRow(r.lastFrame);
    expect(before).toBe("Add a new rule…");
    r.stdin.write(PAGE_DOWN); await tick(); await tick();
    expect(focusedRow(r.lastFrame), "pagedown moved off the top row").not.toBe(before);
    r.stdin.write(END); await tick(); await tick();
    // LAST BY `ruleRows`' OWN ORDER, which is lexicographic — `Bash(cmd9:*)`, not `cmd29`. Written against
    // `cmd29` first and caught red by the assertion above, which is the reason the End claim names the row
    // rather than saying "not the one before".
    expect(focusedRow(r.lastFrame), "end jumps to the last rule").toBe(LAST_RULE);
    r.stdin.write(PAGE_UP); await tick(); await tick();
    expect(focusedRow(r.lastFrame), "pageup came back off the end").not.toBe(LAST_RULE);
    r.stdin.write(HOME); await tick(); await tick();
    expect(focusedRow(r.lastFrame), "home jumps to the top row").toBe("Add a new rule…");
    r.unmount();
  });

  // The gutter is the `Select`'s now. Reproducing the old `❯ `/`  ` prefix inside the row body would render
  // `❯ ❯ Add a new rule…` and break every frame assertion that greps for `❯ Add a new rule…`.
  it("draws exactly one pointer, on the focused row", async () => {
    const r = render(<PermissionsDialog {...props()} rows={40} columns={80} />);
    await waitFor(() => plain(r.lastFrame).includes("Bash(ls)"));
    expect(plain(r.lastFrame)).toContain(`${POINTER} Add a new rule…`);
    expect(plain(r.lastFrame)).not.toContain(`${POINTER} ${POINTER}`);
    expect(pointerRows(r.lastFrame), "exactly one row wears the pointer").toHaveLength(1);
    r.unmount();
  });

  // THE `key={activeTab}` PIN. `Select` reads `defaultFocusValue` only in its `useState` initializers
  // (Select.tsx:160-167) and a tab change does NOT remount it on its own, so this component's
  // `setFocusValue(undefined)` effect clears the mirror while the list keeps its own `view.focus` — deep in
  // the Allow list, through a short tab, and back onto row 20 with no keypress. Verified red by deleting the
  // `key` prop: `focusedRow` then comes back on a `Bash(cmd…)` row instead of the affordance row. The 6a case
  // above cannot see this — its fixture is two rows long and one `↓` deep.
  it("a cursor deep in a long tab does not survive a trip through another tab", async () => {
    function Host() {
      const [tab, setTab] = React.useState("Allow");
      return <PermissionsDialog {...props({ tab, onTabChange: setTab, fetchSettings: async () => manyRules as unknown })} rows={20} columns={80} />;
    }
    const r = render(<Host />);
    await waitFor(() => plain(r.lastFrame).includes("Add a new rule…"));
    r.stdin.write(END);
    await waitFor(() => focusedRow(r.lastFrame) === LAST_RULE, "the cursor to reach the bottom of the Allow list");
    r.stdin.write(RIGHT); await waitFor(() => plain(r.lastFrame).includes("Claude Code will always ask for confirmation"), "the Ask tab");
    r.stdin.write(LEFT); await waitFor(() => plain(r.lastFrame).includes("Claude Code won't ask before using allowed tools."), "the Allow tab to come back");
    await waitFor(() => plain(r.lastFrame).includes("Bash(cmd0:*)"), "the Allow list to repaint from the top");
    expect(focusedRow(r.lastFrame), "the remounted list opens on the top row, not where this tab left it").toBe("Add a new rule…");
    expect(plain(r.lastFrame), "…and the window came back with it").not.toMatch(/more above/);
    r.unmount();
  });

  // The Workspace tab is the fourth unbounded list and it is a DIFFERENT item kind (`dir` rows carry
  // `RenderLine` segments, not a plain string), so it gets its own window pin rather than riding on the rules'.
  it("windows the Workspace directory list too", async () => {
    const dirs = Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/ws/dir-${i}`, source: "session" as const }));
    const r = render(<PermissionsDialog {...props({ tab: "Workspace", fetchDirs: async () => dirs })} rows={20} columns={80} />);
    await waitFor(() => plain(r.lastFrame).includes("Add directory…"), "the workspace list to load");
    expect(plain(r.lastFrame)).toMatch(/↓ \d+ more below/);
    expect(plain(r.lastFrame).split("\n").filter((l) => l.includes("/tmp/ws/dir-")).length).toBeLessThan(dirs.length);
    r.unmount();
  });

  it("takes its chrome budget from an enumeration, and never returns a window of zero", () => {
    // 13 = 9 unconditional box rows (border ×2, title, tab strip, blank, intro, blank, blank, footer) + 2 for
    // the pair of counted indicators, which unlike Settings' third conditional row CAN coexist mid-list + 1
    // ChatStatusBar + 1 for Ink's `>=`. Measured, not asserted: on the real `ChatApp` behind `/permissions`
    // at 100 columns the composed frame is `rows − 2` at the top of the list and `rows − 1` mid-list with
    // both indicators up, and draws zero `clearTerminal` writes at every pane from 14 to 30.
    expect(PERMISSIONS_CHROME_ROWS).toBe(13);
    expect(permissionsVisibleRows(24)).toBe(11);                 // 24 − 13
    expect(permissionsVisibleRows(15)).toBe(2);                  // 15 − 13
    expect(permissionsVisibleRows(14)).toBe(1);                  // 14 − 13
    expect(permissionsVisibleRows(13)).toBe(1);                  // the floor, not 0 — a one-row list beats none
    expect(permissionsVisibleRows(4)).toBe(1);
  });
});
