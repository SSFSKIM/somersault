// test/tui/sgr-foldrow.test.ts — F3 Task 2: the byte grammar of the fold row's clause run. These are PURE
// tests on the string `composeFoldRun` returns, so they may assert exact bytes: nothing here goes through
// Ink, whose output pipeline re-emits a NORMALIZED SGR stream (no-op codes dropped, missing closers
// appended, adjacent closers reordered — F3 Task 1's measured caveat, pinned in sgr-passthrough.test.tsx).
// Frame-level assertions live in toolRenderer.test.tsx and assert the normalized form instead.
//
// The target shape is upstream 2.1.220's own emission (bundle L428046 — ONE `<Text dimColor>` with nested
// `<Text bold>` counts), whose per-cell attributes the tracked golden `01-read-complete.ansi` proves:
//   ⏺        dim + #999999          (the leader glyph — not this writer's business)
//    Reading  dim, uncoloured
//   1        dim + bold
//    file…   PLAIN — the count's `\x1b[22m` closes faint as well as bold, and upstream never re-opens it
// Reproducing that dim loss is the point of the task (spec Decision Log 2026-08-04), not a bug to fix.
import { describe, expect, it } from "vitest";
import { composeFoldRun, stripSgr } from "../../src/tui/sgrFoldRow.js";
import { foldClauses, type GroupCounts } from "../../src/tui/toolFold.js";
import { setTheme } from "../../src/tui/theme.js";

const DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[22m", GREY = "\x1b[38;2;153;153;153m", DEFAULT_FG = "\x1b[39m";
const UNDER = "\x1b[4m", UNDER_OFF = "\x1b[24m";
const osc8 = (href: string, label: string) => `\x1b]8;;${href}\x07${label}\x1b]8;;\x07`;
const counts = (over: Partial<GroupCounts>): GroupCounts =>
  ({ readCount: 0, searchCount: 0, listCount: 0, mcpCallCount: 0, mcpServerNames: [], ...over });
const active = (over: Partial<GroupCounts>) => foldClauses(counts(over), true);
const settled = (over: Partial<GroupCounts>) => foldClauses(counts(over), false);
// T-PRLINK cases go through the fullscreen-only PR clause (`toolFold.ts` `foldClauses`'s `fullscreen` branch),
// so they need the policy flag classic callers above never pass.
const full = (over: Partial<GroupCounts>, isActive = false) => foldClauses(counts(over), isActive, { fullscreen: true });

describe("composeFoldRun byte grammar", () => {
  it("wraps the active run in dim and emits the count as a real bold span", () => {
    expect(composeFoldRun(active({ readCount: 1 }), "active")).toBe(`${DIM}Reading ${BOLD}1${OFF} file${OFF}`);
  });

  it("does NOT re-open dim after a count — the plain tail IS upstream's artifact", () => {
    const run = composeFoldRun(active({ readCount: 3 }), "active");
    const tail = run.slice(run.indexOf(OFF) + OFF.length);          // everything after the count's closer
    expect(tail).toBe(" files" + OFF);                              // one closer, no `\x1b[2m` anywhere
    expect(tail).not.toContain(DIM);
  });

  it("joins clauses with the literal ', ' and opens/closes each count independently", () => {
    expect(composeFoldRun(active({ readCount: 2, listCount: 3 }), "active"))
      .toBe(`${DIM}Reading ${BOLD}2${OFF} files, listing ${BOLD}3${OFF} directories${OFF}`);
  });

  it("appends the active row's ellipsis INSIDE the run, riding the broken-dim tail", () => {
    const run = composeFoldRun(active({ readCount: 1 }), "active", { ellipsis: true });
    expect(run).toBe(`${DIM}Reading ${BOLD}1${OFF} file…${OFF}`);
    expect(run.slice(run.indexOf("…") - 5, run.indexOf("…"))).toBe(" file");   // no SGR between count-close and `…`
  });

  it("keeps the ellipsis dim when the run has no count to break the dim", () => {
    // A single MCP call carries no bold range (upstream drops the `N times` part), so nothing closed the
    // dim and the `…` stays inside it. Riding the tail means inheriting whatever state the tail is in —
    // the writer never forces a closer of its own. (`Calling` is capitalized: it opens the sentence.)
    expect(composeFoldRun(active({ mcpCallCount: 1, mcpServerNames: ["github"] }), "active", { ellipsis: true }))
      .toBe(`${DIM}Calling github…${OFF}`);
  });

  it("wraps the settled run in the inactive colour as well as dim, closing both", () => {
    expect(composeFoldRun(settled({ readCount: 1 }), "settled")).toBe(`${GREY}${DIM}Read ${BOLD}1${OFF} file${OFF}${DEFAULT_FG}`);
  });

  it("leaves a bold-free clause entirely dim, with no `\\x1b[1m` at all", () => {
    const run = composeFoldRun(settled({ mcpCallCount: 1, mcpServerNames: ["github"] }), "settled");
    expect(run).toBe(`${GREY}${DIM}Called github${OFF}${DEFAULT_FG}`);
    expect(run).not.toContain(BOLD);
  });

  it("resolves the colour from the LIVE theme at call time", () => {
    try {
      setTheme("light");                                            // light's `inactive` is rgb(102,102,102)
      expect(composeFoldRun(settled({ readCount: 1 }), "settled")).toContain("\x1b[38;2;102;102;102m");
    } finally { setTheme("auto"); }
  });

  it("emits nothing at all for an empty clause list (no naked open/close pair)", () => {
    expect(composeFoldRun([], "active")).toBe("");
    expect(composeFoldRun([], "settled", { ellipsis: true })).toBe("");
  });

  it("stripSgr recovers exactly the plain text the row's width math needs", () => {
    expect(stripSgr(composeFoldRun(active({ readCount: 2, listCount: 3 }), "active", { ellipsis: true })))
      .toBe("Reading 2 files, listing 3 directories…");
    expect(stripSgr(composeFoldRun(settled({ readCount: 1 }), "settled"))).toBe("Read 1 file");
  });

  // T-PRLINK: `FoldClause.linkRanges` wraps the `#N` span in an OSC-8 hyperlink, canon's `Mi` component
  // (204156–204172) as reached through the PR clause's `U9e` (531080–531126). The bold/underline SGR opens
  // BEFORE the OSC-8 introducer and closes AFTER its terminator — never inside it — which is what lets the
  // `\x1b]8;;<url>\x07#12\x1b]8;;\x07` triple sit as one unbroken substring, exactly as the brief requires.
  const PR_URL = "https://x/o/r/pull/12";
  it("wraps a linked PR span in OSC-8, with the literal `PR ` prefix OUTSIDE the link, un-dim, and bold surviving the crossing", () => {
    // Review-round fix (§1.4's table): canon's `d3l` prefix (531105) paints `PR` plain — NOT bold, NOT dim —
    // right next to the bold+linked `#N`. So the run closes the ambient dim (`OFF`) before "PR " and never
    // re-opens it (this file's existing "no dim re-open" rule), rather than leaving "PR " inside the DIM
    // this writer opens at the top. This cell fails against the pre-fix bytes, which had no `OFF` there.
    const run = composeFoldRun(full({ prs: [{ number: 12, url: PR_URL, action: "created" }] }), "active");
    expect(run).toBe(`${DIM}Created ${OFF}PR ${BOLD}${UNDER}${osc8(PR_URL, "#12")}${UNDER_OFF}${OFF}${OFF}`);
    // The exact triple the brief pins: escape → label → escape, nothing styling between them.
    expect(run).toContain(`\x1b]8;;${PR_URL}\x07#12\x1b]8;;\x07`);
    // Byte-level dim-state pin: "Created " (the verb) stays inside the ambient DIM; "PR " sits strictly
    // between the intensity-reset and the bold/link opener — plain, not dim, not bold.
    expect(run.slice(run.indexOf(DIM) + DIM.length, run.indexOf(OFF))).toBe("Created ");
    expect(run.slice(run.indexOf(OFF) + OFF.length, run.indexOf(BOLD))).toBe("PR ");
  });
  it("leaves a no-url PR clause exactly as before: the whole `PR #N` bold, no OSC-8 anywhere", () => {
    // Review-round fix (§1.4's table): the no-url arm is table row 3, "whole string bold" — nothing there
    // says "not dim" the way the linked arm's `PR` does, so this arm is UNCHANGED (the pre-existing
    // dim+bold nesting other bold counts already use). Kept as the linked arm's byte-level pin's other half.
    const run = composeFoldRun(full({ prs: [{ number: 13, action: "commented" }] }), "active");
    expect(run).toBe(`${DIM}Commented on ${BOLD}PR #13${OFF}${OFF}`);
    expect(run).not.toContain("\x1b]8");
  });
  it("the stripSgr LEAK a CSI-m-only strip would miss: OSC-8 bytes must go, the label must stay", () => {
    const run = composeFoldRun(full({ prs: [{ number: 12, url: PR_URL, action: "created" }] }), "active");
    const stripped = stripSgr(run);
    expect(stripped).toBe("Created PR #12");
    // The load-bearing assertion: a strip that only matches `/\x1b\[[0-9;]*m/g` (CSI-m) leaves the OSC-8
    // introducer and terminator untouched, so `stripped` would still contain `\x1b]8` and the escapes would
    // corrupt every width computation downstream (wrapItems' re-cut, the pager, plain-text assertions).
    expect(stripped).not.toContain("\x1b]8");
    expect(stripped).not.toContain("\x1b");
  });
});
