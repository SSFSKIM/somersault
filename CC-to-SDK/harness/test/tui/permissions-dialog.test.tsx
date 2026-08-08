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
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
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
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));   // row 0 is "Add a new rule…"
    stdin.write(ENTER); await waitFor(() => frame(lastFrame).includes("Delete allowed tool?"));
    expect(frame(lastFrame)).toContain("Enter to delete");
    stdin.write(ESC); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));
    expect(frame(lastFrame)).not.toContain("Enter to delete");
    expect(frame(lastFrame), "…and Esc backed out to the LIST, not out of the dialog").toContain("Permissions");
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
    stdin.write(DOWN); await waitFor(() => plain(lastFrame).includes("❯ Bash(ls)"));
    stdin.write(RIGHT); await waitFor(() => frame(lastFrame).includes("Claude Code will always ask for confirmation before using these tools."));
    stdin.write(LEFT); await waitFor(() => frame(lastFrame).includes("Claude Code won't ask before using allowed tools."));
    await waitFor(() => plain(lastFrame).includes("❯ Add a new rule…"));
    expect(plain(lastFrame), "back on Allow, the cursor is on the top row again").not.toContain("❯ Bash(ls)");
  });
});
