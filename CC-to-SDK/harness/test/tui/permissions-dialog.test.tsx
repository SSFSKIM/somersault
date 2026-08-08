// tui/test/permissions-dialog.test.tsx — the `/permissions` dialog's own component test (Wave S t6). There
// was none before: `small-permissions.test.tsx` covers the four permission-KIND dialogs plus `PermissionDialog`
// (a different component), and `permissionsModel.test.ts` covers the pure row model.
//
// Round 6a swaps this dialog's row cursor from an INDEX to a per-row VALUE, which is a pure refactor at the
// frame level — so most of what is below are GUARDS: they pass before the swap and must still pass after it.
// The one genuinely new claim is the collision rule (two sources may declare the exact same rule string, and
// the two rows must stay separately addressable) — that one is red under the obvious `rule:${text}` scheme.
// Windowing, the paging keys and the `Select` mount are round 6b's; no test for them here yet.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { PermissionsDialog } from "../../src/tui/PermissionsDialog.js";
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
