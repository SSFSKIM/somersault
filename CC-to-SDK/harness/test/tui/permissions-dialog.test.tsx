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
import { Box } from "ink";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { PermissionsDialog, PERMISSIONS_CHROME_ROWS, PERMISSIONS_FRAME_INSET, PERMISSIONS_ROW_INSET, permissionsRowWidth, permissionsVisibleRows, permissionsWrapRows } from "../../src/tui/PermissionsDialog.js";
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

  // …AND THE HALF THE CASE ABOVE CANNOT REACH (review round). It deletes a MIDDLE row, where index 3 of five
  // is still index 3 of four: the index simply PERSISTS and `normalize()`'s clamp never fires — mutating that
  // clamp to reset to zero leaves the case above green, which is how the review found the comment in
  // PermissionsDialog.tsx crediting it for coverage it did not have. Deleting the row at the BOTTOM is the one
  // that falls out of range, so this is the case the clamp actually owns. Verified red against that same
  // mutation (the cursor lands on the affordance row at the top instead of on `Bash(b)`).
  it("clamps the cursor to the new last row when the row it deleted WAS the last one", async () => {
    let allow = ["Bash(a)", "Bash(b)", "Bash(c)"];
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
    expect(removed, "the confirm's Enter deleted the row the cursor was on — the LAST one").toEqual(["Bash(c)"]);
    const pointed = pointerRows(lastFrame);
    expect(pointed, "exactly one row wears the pointer").toHaveLength(1);
    expect(pointed[0], "the out-of-range index clamps to the new bottom row, not to the top of the list").toMatch(/^❯ Bash\(b\)/);
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

  // THE STRAY-SPACE INVARIANT, PINNED AT LAST (review round). `onSubKey` keeps the six sub-views PHYSICAL
  // precisely so a space cannot act as Enter inside a destructive confirm — `select:accept` is bound to
  // {enter, SPACE} and four of the six sub-views ARE destructive confirms — and nothing in the shipped suite
  // held it: the review mutated the deleteConfirm branch to take `key.return || input === " "` and the whole
  // file stayed green. The case above ("a stray space over a rule…") covers the TOP LEVEL, where space is a
  // deliberate widening; these two cover the confirms, where it must do nothing at all. Both verified red
  // against that mutation.
  it("a space inside the delete confirm deletes nothing and leaves the confirm up", async () => {
    const removed: string[] = [];
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({ removeRule: async (_b: unknown, rule: string) => { removed.push(rule); } })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"), "the cursor to reach the rule");
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"), "the delete confirm to open");
    stdin.write(SPACE); await tick(); await tick();
    expect(removed, "space is not Enter inside a destructive confirm").toEqual([]);
    expect(frame(lastFrame), "…and it did not dismiss the confirm either").toContain("Delete allowed tool?");
    // The confirm's OWN Enter still works, so the emptiness above is a real absence and not a dead dialog.
    stdin.write(ENTER); await waitFor(() => removed.length === 1, "the confirm's Enter to reach removeRule");
    expect(removed).toEqual(["Bash(ls)"]);
  });

  it("a space inside the remove-directory confirm removes nothing and leaves the confirm up", async () => {
    const removed: string[] = [];
    const dirs = [{ path: "/tmp/ws/added", source: "session" as const }];
    const { stdin, lastFrame } = render(<PermissionsDialog {...props({
      tab: "Workspace", fetchDirs: async () => dirs, removeDir: async (p: string) => { removed.push(p); },
    })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add directory…"), "the workspace list to load");
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ /tmp/ws/added"), "the cursor to reach the directory");
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Remove directory from workspace?"), "the remove confirm to open");
    stdin.write(SPACE); await tick(); await tick();
    expect(removed, "space is not Enter inside a destructive confirm").toEqual([]);
    expect(frame(lastFrame), "…and it did not dismiss the confirm either").toContain("Remove directory from workspace?");
    stdin.write(ENTER); await waitFor(() => removed.length === 1, "the confirm's Enter to reach removeDir");
    expect(removed).toEqual(["/tmp/ws/added"]);
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
    // NAMES WHAT THE CURSOR LANDED ON rather than what it left (review round): `focusedRow` answers `""` when
    // NO row wears the pointer, so a bare `.not.toBe(before)` also passes on a frame that lost the cursor
    // entirely. A rule row is the only correct answer here, and it cannot be spelled by an empty frame.
    expect(focusedRow(r.lastFrame), "pagedown moved off the top row and onto a rule").toMatch(/^Bash\(cmd\d+:\*\)/);
    r.stdin.write(END); await tick(); await tick();
    // LAST BY `ruleRows`' OWN ORDER, which is lexicographic — `Bash(cmd9:*)`, not `cmd29`. Written against
    // `cmd29` first and caught red by the assertion above, which is the reason the End claim names the row
    // rather than saying "not the one before".
    expect(focusedRow(r.lastFrame), "end jumps to the last rule").toBe(LAST_RULE);
    r.stdin.write(PAGE_UP); await tick(); await tick();
    expect(focusedRow(r.lastFrame), "pageup came back off the end, onto another rule").toMatch(/^Bash\(cmd\d+:\*\)/);
    expect(focusedRow(r.lastFrame), "…which is not the one End left it on").not.toBe(LAST_RULE);
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
  //   IT NAMES THE EXACT COUNT, not merely "fewer than twenty" (review round). The loose form pinned "something
  // windows this list" rather than "THIS budget windows it": deleting `visibleOptionCount` outright leaves
  // `Select`'s own `clampVisible` reserving 8 rows, which shows 12 of the 21 options at a pane of 20 — still
  // fewer than twenty, still green. `permissionsVisibleRows(20)` is 7, and the counted indicator has to agree
  // with it, so both assertions below go red under that mutation.
  //   THE CALL IT NAMES IS THE TAB-AWARE ONE (chrome-wrap round): at 80 columns this tab's own 89-column intro
  // wraps, so the window is `20 − 13 − 1` and not `20 − 13`. Spelling the same call the component makes is what
  // keeps this a pin on the WINDOW rather than on a number that happens to match at one width.
  it("windows the Workspace directory list too", async () => {
    const dirs = Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/ws/dir-${i}`, source: "session" as const }));
    const visible = permissionsVisibleRows(20, "Workspace", 80);
    const r = render(<PermissionsDialog {...props({ tab: "Workspace", fetchDirs: async () => dirs })} rows={20} columns={80} />);
    await waitFor(() => plain(r.lastFrame).includes("Add directory…"), "the workspace list to load");
    expect(plain(r.lastFrame)).toMatch(/↓ \d+ more below/);
    expect(plain(r.lastFrame).split("\n").filter((l) => l.includes("/tmp/ws/dir-")).length)
      .toBe(visible - 1);                                       // less the "Add directory…" affordance row
    expect(plain(r.lastFrame)).toContain(`↓ ${dirs.length + 1 - visible} more below`);
    r.unmount();
  });

  it("takes its row width from the frame's own inset, and never returns a width of zero", () => {
    // 6 = `borderStyle="round"`'s two rules + `paddingX={1}`'s two columns + the one column `Select` spends on
    // its pointer gutter and the one its `gap={1}` spends (Select.tsx:347-352). Read off a rendered 80-column
    // frame: the row body occupies exactly 74 columns.
    expect(PERMISSIONS_ROW_INSET).toBe(6);
    expect(permissionsRowWidth(80)).toBe(74);
    expect(permissionsRowWidth(6)).toBe(1);                      // the floor, not 0 — truncateLabel needs a column
    expect(permissionsRowWidth(2)).toBe(1);
  });

  it("takes its chrome budget from an enumeration, and never returns a window of zero", () => {
    // 13 = 9 unconditional box rows (border ×2, title, tab strip, blank, intro, blank, blank, footer) + 2 for
    // the pair of counted indicators, which unlike Settings' third conditional row CAN coexist mid-list + 1
    // the footer row (`ChatStatusBar` before Wave C Task 2) + 1 for Ink's `>=`. Measured, not asserted: on the real `ChatApp` behind `/permissions`
    // at 100 columns the composed frame is `rows − 2` at the top of the list and `rows − 1` mid-list with
    // both indicators up, and draws zero `clearTerminal` writes at every pane from 14 to 30.
    expect(PERMISSIONS_CHROME_ROWS).toBe(13);
    expect(permissionsVisibleRows(24)).toBe(11);                 // 24 − 13
    expect(permissionsVisibleRows(15)).toBe(2);                  // 15 − 13
    expect(permissionsVisibleRows(14)).toBe(1);                  // 14 − 13
    expect(permissionsVisibleRows(13)).toBe(1);                  // the floor, not 0 — a one-row list beats none
    expect(permissionsVisibleRows(4)).toBe(1);
  });

  // ── CHROME-WRAP ROUND ───────────────────────────────────────────────────────────────────────────────────
  // The constant above counts ONE row per chrome line, which is what a line costs at a comfortable width. The
  // intro and the footer are literals long enough to WRAP at a narrow one, and unlike a wrapped ROW (which the
  // review round CLIPPED, because its cost scales with how many wrapped rows the window holds and a term can
  // only subtract a constant) each of them renders exactly ONCE per frame — so their extra lines are a genuine
  // constant and a term is exactly right. `rewindWrapRows`' shape, made TAB-DEPENDENT because this dialog has
  // five intros and three footers where the rewind picker has one of each.
  it("adds the rows the intro and the footer actually wrap to, per TAB", () => {
    expect(PERMISSIONS_FRAME_INSET).toBe(4);                     // border ×2 + paddingX ×2 — NOT the row's 6
    // Bands from `wrap-ansi` itself, the call Ink's own `wrap-text.js` makes; `ceil(width / inner)` is a
    // different function and disagrees at most widths. The rendered-frame case below proves these ARE the rows
    // the renderer spends, so nothing here rests on our reading of the wrapper.
    expect(permissionsWrapRows("Allow", 100)).toBe(0);
    expect(permissionsWrapRows("Allow", 69)).toBe(0);            // DEFAULT_FOOTER is 65 over an inner 65 — the last width it fits
    expect(permissionsWrapRows("Allow", 68)).toBe(1);            // …and the first where it takes a second line
    expect(permissionsWrapRows("Allow", 60)).toBe(1);
    expect(permissionsWrapRows("Allow", 52)).toBe(2);            // INTRO.Allow (49) takes a second line as well
    expect(permissionsWrapRows("Ask", 74)).toBe(0);              // INTRO.Ask (70) is the second-widest intro
    expect(permissionsWrapRows("Ask", 73)).toBe(1);
    expect(permissionsWrapRows("Workspace", 93)).toBe(0);        // INTRO.Workspace (89) over an inner 89
    expect(permissionsWrapRows("Workspace", 92)).toBe(1);
    expect(permissionsWrapRows("Workspace", 60)).toBe(2);        // the intro AND the footer, and the MAX of the two
                                                                 // footers this tab can show — MANAGED_DIR_FOOTER (47)
                                                                 // still fits at 60, and charging the live one would
                                                                 // resize the list as the cursor crossed a managed row
    expect(permissionsWrapRows("Recently denied", 60)).toBe(0);  // 53-column intro, 31-column footer: the SAME width, a
    expect(permissionsWrapRows("Recently denied", 56)).toBe(1);  // different answer — which is why the term takes a tab
    expect(permissionsWrapRows("nonsense", 60)).toBe(permissionsWrapRows("Allow", 60));   // the component's own activeTab fallback
  });

  it("reaches the window only when the caller knows BOTH the tab and the width", () => {
    expect(permissionsVisibleRows(20)).toBe(7);                        // the height-only budget, unchanged
    expect(permissionsVisibleRows(20, "Allow")).toBe(7);               // a tab with no width names no allowance
    expect(permissionsVisibleRows(20, undefined, 60)).toBe(7);         // …and neither does a width with no tab
    expect(permissionsVisibleRows(20, "Allow", 100)).toBe(7);          // wrap 0: a comfortable width is the same budget
    expect(permissionsVisibleRows(20, "Allow", 60)).toBe(6);
    expect(permissionsVisibleRows(20, "Workspace", 60)).toBe(5);       // two wrapped literals, two rows
    expect(permissionsVisibleRows(20, "Recently denied", 60)).toBe(7); // the tab, not the width alone, decides
    expect(permissionsVisibleRows(14, "Allow", 60)).toBe(1);           // THE RESIDUAL, pinned: the floor outvotes the
    expect(permissionsVisibleRows(15, "Workspace", 60)).toBe(1);       // term at and below a pane of 13 + wrap, and the
    expect(permissionsVisibleRows(14, "Workspace", 70)).toBe(1);       // frame reaches the pane there whatever we subtract
  });
});

// ── REVIEW ROUND — THE HORIZONTAL HALF OF THE WINDOW ──────────────────────────────────────────────────────
// The window reserves ROWS and counts OPTIONS, which only adds up while ONE OPTION IS ONE LINE. A row wider
// than the frame breaks that: it still counts as one option and costs two lines, and the frame grows by
// however many wrapped rows the window happens to be holding — measured on the fixture below, before the clip,
// the real ChatApp behind /permissions drew a full-screen `clearTerminal` on EVERY cursor move at EVERY pane
// from 15 to 24 at 80 columns. The repair is the clip in `renderItem`, not a budget term (a term can only
// subtract a constant, and this shortfall is not one).
//
// EACH CASE HOLDS THE FRAME'S LINE COUNT FIXED ACROSS TWO WIDTHS, which is the invariant stated directly:
// pick a pair of widths at which every wrappable CHROME literal wraps identically, and the count can then move
// only if a ROW wrapped. Both cases were verified red by handing `renderItem` an unbounded width.
//
// THE `<Box width>` WRAPPER IS LOAD-BEARING, not decoration. `ink-testing-library`'s fake stdout reports a
// FIXED 100 columns whatever a test says, and an Ink box with no width shrink-wraps its content — so a dialog
// handed `columns={70}` still lays out inside 100 and an unclipped 67-column row simply widens the box instead
// of wrapping. Pinning the parent's width is what makes the wrap real, and it is what makes the line-count
// assertion below a measurement rather than a formality.
const frameLines = (f: () => string | undefined) => plain(f).split("\n").length;

describe("PermissionsDialog — a row body is clipped to the width it is given (review round)", () => {
  /** 67 columns. It FITS the row body at 80 columns (74) and overflows it at 70 (64), while the Workspace
   *  intro (89) wraps to two lines at BOTH — its content width is `columns − 4`, so 66 and 76 alike — and
   *  `DEFAULT_FOOTER` (65) fits on one line at both. */
  const WS = (i: number) => `/Users/someone/Developer/GitHub/repo/packages/workspace-directory-${i}`;
  const wsDirs = Array.from({ length: 8 }, (_, i) => ({ path: WS(i), source: "session" as const }));
  const at = (cols: number, over: Partial<Parameters<typeof PermissionsDialog>[0]>) => (
    <Box width={cols}><PermissionsDialog {...props(over)} rows={40} columns={cols} /></Box>
  );

  it("keeps a workspace row to one line at a width its path does not fit", async () => {
    const ws = { tab: "Workspace", fetchDirs: async () => wsDirs };
    const wide = render(at(80, ws));
    await waitFor(() => plain(wide.lastFrame).includes(WS(0)), "the workspace list at 80 columns");
    const tall = frameLines(wide.lastFrame);
    wide.unmount();
    const narrow = render(at(70, ws));
    await waitFor(() => plain(narrow.lastFrame).includes("/Users/someone"), "the workspace list at 70 columns");
    // `truncateLabel` reserves one column for its own `…`, so a 64-column body keeps 63 columns of the path.
    expect(plain(narrow.lastFrame), "the path that no longer fits is clipped, ellipsis and all").toContain(`${WS(0).slice(0, 63)}…`);
    expect(plain(narrow.lastFrame), "…and the whole path is gone from the frame").not.toContain(WS(0));
    expect(frameLines(narrow.lastFrame), "…and the frame is no taller for it — one option is still one line").toBe(tall);
    narrow.unmount();
  });

  /** The same invariant on a RULE row, which is the reason the clip lives in this dialog's `renderItem` and not
   *  in `permissionsModel`'s `workspaceRows`: a workspace path is one of four row kinds that can overflow, and
   *  a clip in that formatter would have fixed exactly one of them. 54 columns of rule plus two spaces plus
   *  `From command line arguments` (29) is an 85-column row: it fits the body at 100 columns (94) and
   *  overflows it at 80 (74), while the Allow intro (49), the tab strip and the footer (65) fit on one line at
   *  both. */
  const RULE = (i: number) => `Bash(/Users/someone/GitHub/repo/pkgs/thing-${i}:*)`.padEnd(54, "x");
  const wideRules = { sources: [{ source: "flagSettings", settings: { permissions: { allow: Array.from({ length: 6 }, (_, i) => RULE(i)) } } }] };

  it("keeps a rule row to one line at a width its rule plus provenance does not fit", async () => {
    const rules = { fetchSettings: async () => wideRules as unknown };
    const wide = render(at(100, rules));
    await waitFor(() => plain(wide.lastFrame).includes(`${RULE(0)}  From command line arguments`), "the rule list at 100 columns");
    const tall = frameLines(wide.lastFrame);
    wide.unmount();
    const narrow = render(at(80, rules));
    await waitFor(() => plain(narrow.lastFrame).includes(RULE(0)), "the rule list at 80 columns");
    expect(plain(narrow.lastFrame), "the DIM provenance span is what the clip eats into first").not.toContain("From command line arguments");
    expect(plain(narrow.lastFrame), "…leaving the rule itself, which still fits").toContain(RULE(0));
    expect(frameLines(narrow.lastFrame), "…and the frame is no taller for it").toBe(tall);
    narrow.unmount();
  });
});

// ── CHROME-WRAP ROUND — THE VERTICAL COST OF THE SAME NARROW WIDTH ────────────────────────────────────────
// The clip above holds every ROW to one line; the intro and the footer are the two lines it does NOT govern,
// and they are the whole of what is left. `permissionsWrapRows` charges them, and these two blocks are its two
// halves: the first proves the number is the number the RENDERER spends, the second proves that subtracting it
// keeps the composed frame under the pane. The `<Box width>` wrapper is load-bearing in both, for the reason
// the block above spells out.
//
// NEITHER BLOCK COUNTS A `lastFrame()` LINE COUNT AGAINST INK'S OWN THRESHOLD, which would be the wrong
// quantity: `ink-testing-library` renders with `debug: true` and that branch returns BEFORE the
// `outputHeight >= stdout.rows` check. What is asserted instead is the HEIGHT — the dialog rendered alone, so
// there is no static half to inflate it — against the pane the budget claims it fits in, plus the one row
// the footer row costs beside it (`ChatStatusBar` before Wave C Task 2 — one row either way). The clear-count instrument that measures Ink's actual branch is the one in
// `PERMISSIONS_CHROME_ROWS`'s docblock, and it is what the numbers there come from.
describe("PermissionsDialog — the chrome's wrap allowance is what the frame really spends (chrome-wrap round)", () => {
  /** Four short rules plus the affordance row is five options and a pane of 40 shows every one of them at every
   *  width here, so neither indicator is drawn and no row is clipped — leaving the intro and the footer as the
   *  ONLY things a width change can move. `height(columns) − height(100)` is therefore the allowance itself,
   *  with nothing else in the difference (`rewindWrapRows`' own subtraction, rewind-picker.test.tsx). */
  const shortRules = { sources: [{ source: "flagSettings", settings: { permissions: { allow: ["Bash(a)", "Bash(b)", "Bash(c)", "Bash(d)"] } } }] };
  const shortDirs = Array.from({ length: 3 }, (_, i) => ({ path: `/tmp/w${i}`, source: "session" as const }));
  /** Three denials so the Recently-denied tab renders its LIST and not `RECENT_EMPTY`, whose 80 columns wrap on
   *  their own and are deliberately not in the term (they can only appear while both indicator rows are off). */
  const denials = Array.from({ length: 3 }, (_, i) => ({ display: `cmd ${i}`, by: "auto", at: 1_700_000_000_000 + i }));
  const marker: Record<string, string> = { Allow: "Add a new rule…", Workspace: "Add directory…", "Recently denied": "cmd 0" };

  it("equals the rows the RENDERED frame spends on the intro and the footer, at every tab", async () => {
    const heightAt = async (tab: string, cols: number) => {
      const r = render(
        <Box width={cols}>
          <PermissionsDialog {...props({ tab, denials, fetchSettings: async () => shortRules as unknown, fetchDirs: async () => shortDirs })} rows={40} columns={cols} />
        </Box>,
      );
      await waitFor(() => plain(r.lastFrame).includes(marker[tab]!), `the ${tab} list at ${cols} columns`);
      const h = frameLines(r.lastFrame);
      expect(plain(r.lastFrame), "the whole catalog is on screen, so nothing but the chrome differs").not.toContain("more below");
      r.unmount();
      return h;
    };
    for (const tab of ["Allow", "Workspace", "Recently denied"]) {
      const base = await heightAt(tab, 100);
      for (const cols of [80, 70, 60]) {
        const actual = await heightAt(tab, cols) - base;
        const budgeted = permissionsWrapRows(tab, cols);
        // T-MENU task 2 fix wave: Recently denied still renders its own literal `RECENT_FOOTER` — exact
        // equality holds unchanged. Allow/Workspace render DialogFrame's auto keyhint bar instead of
        // `DEFAULT_FOOTER`/`MANAGED_DIR_FOOTER` now, and the bar (~49 columns under default bindings) wraps
        // LATER than those wider literals did — `permissionsWrapRows` still models the old, wider ones (a
        // pure function with no live-table access to derive the bar's real text), so it now OVER-reserves
        // rather than under. That is the safe direction for the invariant this budget exists for (never let
        // the composed frame reach the pane) — bound it rather than pin an equality the fix deliberately loosened.
        if (tab === "Recently denied") expect([tab, cols, actual]).toEqual([tab, cols, budgeted]);
        else expect([tab, cols, actual <= budgeted]).toEqual([tab, cols, true]);
      }
    }
  }, 20000);

  /** …AND THE INVARIANT THE ALLOWANCE EXISTS FOR. Ink writes `clearTerminal + fullStaticOutput + output` when
   *  `outputHeight >= stdout.rows` (ink.js:121) — a full-screen wipe on every cursor move — so the composed
   *  frame has to be STRICTLY shorter than the pane. Composed here is this dialog plus the one unconditional
   *  sibling `ChatApp` draws beside it, the footer row; everything else is handled by that file's `paneOwned`
   *  gate. The state is mid-list with BOTH counted indicators up, which is the tallest this dialog reaches.
   *
   *  MEASURED RED WITHOUT THE TERM, and the 60-column column is the one that carries it: with the allowance
   *  removed from `permissionsVisibleRows` the composed frame is EXACTLY `rows` there at every pane in the
   *  sweep, which is the clear-drawing case the non-debug instrument counts at 12 clears per six cursor moves.
   *  70 and 80 stay green without it (the Allow intro and footer both fit at those widths) and are here as the
   *  control: a term that fired at every width would be over-subtracting, and this case would not notice. */
  it("keeps the composed frame strictly shorter than the pane at a width where the chrome wraps", async () => {
    const manyRules = { sources: [{ source: "flagSettings", settings: { permissions: { allow: Array.from({ length: 30 }, (_, i) => `Bash(cmd${i}:*)`) } } }] };
    for (const cols of [60, 70, 80, 100]) {
      for (const rows of [16, 20, 24]) {
        const r = render(
          <Box width={cols}><PermissionsDialog {...props({ fetchSettings: async () => manyRules as unknown })} rows={rows} columns={cols} /></Box>,
        );
        await waitFor(() => plain(r.lastFrame).includes("Add a new rule…"), `the rule list at ${cols}×${rows}`);
        for (let n = 0; n < 40 && !/more above/.test(plain(r.lastFrame)); n++) { r.stdin.write(DOWN); await tick(); }
        // Asserted, not assumed: a walk that never reached the both-indicators state would leave the tallest
        // geometry untested and the case would pass on a shorter frame than the one that matters.
        expect([cols, rows, /more above/.test(plain(r.lastFrame)), /more below/.test(plain(r.lastFrame))]).toEqual([cols, rows, true, true]);
        expect([cols, rows, frameLines(r.lastFrame) + 1 < rows]).toEqual([cols, rows, true]);
        r.unmount();
      }
    }
  }, 20000);
});

// ── T-MENU TASK 2 — THE SHELL MIGRATION + THE AUTO MODE TAB (spec D12) ────────────────────────────────────
// D12 (plan-review F5, corrected from R1's own misread): canon's TRUE order is Recently denied · Allow · Ask
// · Deny · Auto mode · Workspace (cli.pretty.js:829914-829953) — the five pre-existing tabs already matched
// canon's order, so Auto mode is an INSERT before Workspace, never a reorder. This block pins that order
// exactly, keyboard cycling across the new tab in both directions, its display-only content (no data
// contract yet — canon's own empty-state literal, transcribed verbatim), and its narrow-pane wrap geometry.
describe("PermissionsDialog — the six-tab order and the Auto mode tab (T-MENU task 2, spec D12)", () => {
  /** `tab` is CONTROLLED (the same reason SettingsDialog's is — `useChat`'s hook state owns it across the
   *  whole app), so cycling needs a real state-carrying host, exactly like the pre-existing "a cursor from one
   *  tab does not carry into another tab's list" case above: a no-op `onTabChange` still FIRES on every
   *  keypress (proving the key resolved and the handler ran) but the prop the component reads never moves. */
  function Host({ initial }: { initial: string }) {
    const [tab, setTab] = React.useState(initial);
    return <PermissionsDialog {...props({ tab, onTabChange: setTab })} />;
  }

  it("cycles right through the exact canon order, Recently denied → … → Workspace, Auto mode before Workspace", async () => {
    const { stdin, lastFrame } = render(<Host initial="Recently denied" />);
    await waitFor(() => frame(lastFrame).includes("Permissions"));
    const order = ["Recently denied", "Allow", "Ask", "Deny", "Auto mode", "Workspace"];
    // The intro line is unique per tab (unlike the tab chip strip, which truncates nothing here but is a
    // weaker signal) — each step's own wait proves the STEP landed, not merely that six steps happened.
    const introOf: Record<string, string> = {
      "Recently denied": "Commands recently denied by the auto mode classifier.",
      Allow: "Claude Code won't ask before using allowed tools.",
      Ask: "Claude Code will always ask for confirmation before using these tools.",
      Deny: "Claude Code will always reject requests to use denied tools.",
      "Auto mode": "Extra rules for the auto mode classifier.",
      Workspace: "Claude Code can read files in the workspace",
    };
    await waitFor(() => frame(lastFrame).includes(introOf["Recently denied"]!), "starts on Recently denied");
    for (let i = 1; i < order.length; i++) {
      stdin.write(RIGHT);
      await waitFor(() => frame(lastFrame).includes(introOf[order[i]!]!), `RIGHT lands on ${order[i]}`);
    }
    // One more RIGHT wraps back to the first tab (`Tabs`' own modular cycling, select/Tabs.tsx:106).
    stdin.write(RIGHT);
    await waitFor(() => frame(lastFrame).includes(introOf["Recently denied"]!), "wraps back to Recently denied");
  });

  it("cycles left (the reverse direction) across the new tab too — Workspace → Auto mode → Deny", async () => {
    const { stdin, lastFrame } = render(<Host initial="Workspace" />);
    await waitFor(() => frame(lastFrame).includes("Claude Code can read files in the workspace"));
    stdin.write(LEFT);
    await waitFor(() => frame(lastFrame).includes("Extra rules for the auto mode classifier."), "LEFT from Workspace lands on Auto mode");
    stdin.write(LEFT);
    await waitFor(() => frame(lastFrame).includes("Claude Code will always reject requests to use denied tools."), "LEFT from Auto mode lands on Deny");
  });

  it("shows the tab chip strip in the exact six-tab order", async () => {
    const { lastFrame } = render(<PermissionsDialog {...props({ tab: "Allow" })} />);
    await waitFor(() => plain(lastFrame).includes("Auto mode"));
    // The chip strip is one row; each chip reads ` <title> ` (Tabs.tsx:121) so the raw indexOf order IS the
    // rendered order, left to right.
    const strip = plain(lastFrame).split("\n").find((l) => l.includes("Recently denied") && l.includes("Workspace"))!;
    const positions = ["Recently denied", "Allow", "Ask", "Deny", "Auto mode", "Workspace"].map((t) => strip.indexOf(t));
    expect(positions.every((p) => p >= 0), "every one of the six chips is on the strip").toBe(true);
    expect(positions, "…in canon's exact order, left to right").toEqual([...positions].sort((a, b) => a - b));
  });

  it("Auto mode is display-only: no data contract yet, so it always shows canon's own empty-state literal, never a false affordance", async () => {
    // 130 columns keeps the 111-column intro on ONE line (`permissionsWrapRows` below pins the wrap boundary
    // separately) — otherwise Ink's own word-wrap would split the literal across two frame lines and a plain
    // `toContain` on the un-wrapped sentence would fail for a reason that has nothing to do with this claim.
    // The `<Box width>` wrapper is load-bearing (same trap the chrome-wrap describes above spell out):
    // `ink-testing-library`'s fake stdout reports a fixed 100 columns whatever the component prop says.
    const { lastFrame } = render(<Box width={130}><PermissionsDialog {...props({ tab: "Auto mode" })} columns={130} /></Box>);
    await waitFor(() => plain(lastFrame).includes("Extra rules for the auto mode classifier."));
    const f = plain(lastFrame);
    // The intro (canon `or`, ~L828247) and the empty state (canon `Qt`, ~L828045, `control === "empty"`) are
    // both transcribed VERBATIM — see PermissionsDialog.tsx's own `INTRO["Auto mode"]`/`AUTO_MODE_EMPTY` docs
    // for why "Add a rule to customize it" stays even though this round ships no add flow (the plan's own
    // "never invent copy" constraint outranks trimming a phrase that describes a real, just-not-yet-wired
    // feature).
    expect(f).toContain("Extra rules for the auto mode classifier. Rules are plain sentences; new rules are saved to your user settings.");
    expect(f).toContain("This section has no configured rules, so the built-ins apply. Add a rule to customize it.");
    // No "Add a new rule…" affordance row (unlike Allow/Ask/Deny) and no add/edit mutation surface at all —
    // this tab ships display-only (D12).
    expect(f).not.toContain("Add a new rule…");
    // The footer must not claim a working Enter/↑↓ over a list that is PERMANENTLY empty — the exact false
    // affordance RECENT_FOOTER's own divergence note already exists to avoid (PermissionsDialog.tsx).
    expect(f).toContain("Esc to cancel");
    expect(f).not.toContain("Enter to select");
    expect(f).not.toContain("to navigate");
  });

  it("renders real auto-mode rule rows instead of the empty state IF the model ever exposes them (guards the display-only contract, not just its current absence)", async () => {
    // `permissionsModel.ts` exposes no `autoMode` parsing today (verified by reading it for this task) — this
    // guard pins that the DIALOG side of the contract (surface real data when present, else the empty state)
    // stays true regardless, by asserting the CURRENT, honest state: with no model support, Auto mode is
    // ALWAYS the empty state, never a stale or fabricated row.
    const { lastFrame } = render(<PermissionsDialog {...props({ tab: "Auto mode" })} />);
    await waitFor(() => frame(lastFrame).includes("Extra rules for the auto mode classifier."));
    expect(frame(lastFrame)).toContain("This section has no configured rules, so the built-ins apply.");
  });

  // ── NARROW-PANE GEOMETRY, DELIBERATE (per the task brief) ───────────────────────────────────────────────
  // `permissionsWrapRows`/`permissionsVisibleRows` are already TAB-DEPENDENT (five intros, three footers,
  // pinned above) — adding a sixth tab must widen that dependency correctly rather than silently falling
  // through the `nonsense` fallback arm. The 111-column intro is the LONGEST of the six (Workspace's 89 was
  // previously the widest), so Auto mode is now the tab that wraps earliest as the pane narrows.
  it("adds the wrap allowance for Auto mode's own (now the LONGEST) intro, and its short Esc-only footer never wraps", () => {
    // Computed from `wrap-ansi` itself (the call the renderer makes), the same instrument the sibling cases
    // above use — never `Math.ceil(width / inner)` (a different function, disagrees at most widths).
    expect(permissionsWrapRows("Auto mode", 115)).toBe(0);         // inner 111 — the intro's own length, last 1-line width
    expect(permissionsWrapRows("Auto mode", 114)).toBe(1);         // …and the first where it takes a second line
    expect(permissionsWrapRows("Auto mode", 61)).toBe(1);
    expect(permissionsWrapRows("Auto mode", 60)).toBe(2);          // a third line
    expect(permissionsWrapRows("nonsense", 60)).not.toBe(permissionsWrapRows("Auto mode", 60));   // distinct from the fallback tab (Allow)
  });

  it("reaches the window for Auto mode exactly like every other tab — the tab AND the width, both required", () => {
    expect(permissionsVisibleRows(20, "Auto mode")).toBe(7);              // a tab with no width names no allowance
    expect(permissionsVisibleRows(20, "Auto mode", 115)).toBe(7);         // comfortable width: wrap 0, same as height-only
    expect(permissionsVisibleRows(20, "Auto mode", 100)).toBe(6);         // wrap 1: the 111-column intro takes a second line
    expect(permissionsVisibleRows(20, "Auto mode", 60)).toBe(5);          // wrap 2: a third line too
  });

  it("keeps the composed Auto mode frame strictly shorter than the pane at a width where its intro wraps", async () => {
    for (const cols of [60, 80, 100, 115]) {
      const r = render(<Box width={cols}><PermissionsDialog {...props({ tab: "Auto mode" })} rows={16} columns={cols} /></Box>);
      await waitFor(() => plain(r.lastFrame).includes("Extra rules for the auto mode classifier."), `Auto mode at ${cols} columns`);
      const h = plain(r.lastFrame).split("\n").length;
      // The dialog alone plus the one unconditional `ChatApp` sibling (the footer row) must stay strictly
      // under the pane — Ink's `outputHeight >= stdout.rows` clear/replay cliff (ink.js:121).
      expect([cols, h + 1 < 16]).toEqual([cols, true]);
      r.unmount();
    }
  });
});

// ── T-MENU TASK 2 FIX WAVE — THE AUTO KEYHINT BAR REPLACES THE HAND-WRITTEN BROWSING FOOTER ────────────────
// Review finding 1: `DialogFrame`'s `hintScope` (never `onCancel` — this dialog's own Escape routing through
// `route(() => onDone())` stays authoritative) derives the footer from the `Settings`/`Tabs` scopes this
// dialog already registers (PermissionsDialog.tsx:569-570), instead of the hand-typed `DEFAULT_FOOTER`/
// `MANAGED_DIR_FOOTER`. `RECENT_FOOTER`/`AUTO_MODE_FOOTER` stay exactly as they render today — both exist
// BECAUSE their tabs cannot honestly claim "navigate"/"select" (a permanently empty list, a read-only log),
// and the scope-derived bar has no per-tab awareness to reproduce that carve-out, so those two tabs keep
// their own literal footer instead of adopting the bar.
describe("PermissionsDialog — the auto keyhint bar replaces the browsing footer (T-MENU task 2 fix wave)", () => {
  it("derives the Allow-tab footer from the registry instead of the hand-written DEFAULT_FOOTER", async () => {
    const { lastFrame } = render(<PermissionsDialog {...props({ tab: "Allow" })} />);
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    const f = plain(lastFrame);
    // The old literal is gone outright...
    expect(f).not.toContain("↑/↓ to navigate · Enter to select · ←/→ to switch · Esc to cancel");
    // ...replaced by the derived bar: `select:cancel`'s "cancel", `select:previous`'s "navigate",
    // `select:accept`'s "select" and `tabs:next`'s "switch tab" — the true reachable set at exactly the
    // 4-hint cap (bl10 fix wave 1, finding 3). The scope this derives from is `Select`, not `Settings`:
    // `Settings`' own table also carries `settings:search`, a hard no-op here (this dialog binds it to
    // nothing — "`/` opens no query here", above) that used to fill the 4th slot and evict "switch tab".
    expect(f).toContain("cancel");
    expect(f).toContain("navigate");
    expect(f).toContain("select");
    expect(f).toContain("switch tab");
    expect(f).not.toContain("search");
  });

  it("leaves Recently denied's and Auto mode's own false-affordance-safe footers untouched", async () => {
    const recent = render(<PermissionsDialog {...props({ tab: "Recently denied" })} />);
    await waitFor(() => plain(recent.lastFrame).includes("Commands recently denied"));
    expect(plain(recent.lastFrame)).toContain("↑/↓ to navigate · Esc to cancel");
    recent.unmount();

    const auto = render(<PermissionsDialog {...props({ tab: "Auto mode" })} />);
    await waitFor(() => plain(auto.lastFrame).includes("Extra rules for the auto mode classifier."));
    const f = plain(auto.lastFrame);
    expect(f).toContain("Esc to cancel");
    // The bar must not leak "navigate"/"select" onto a permanently empty list — the exact false affordance
    // AUTO_MODE_FOOTER exists to avoid, which is why this tab's hintScope stays off.
    expect(f).not.toContain("navigate");
    expect(f).not.toContain("select");
    auto.unmount();
  });
});
