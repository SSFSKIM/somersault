// test/tui/rewind-picker.test.tsx — the rewind picker as F6 T10 rebuilt it: upstream's `Q4f` anatomy
// (bundle L487055-194) on the shared `Select`. The C5-era assertions this file replaced pinned the OLD
// shape — a hand-rolled newest-first list and a 1/2/3 scope menu — and are gone deliberately, not lost.
//
// What is pinned here, in the order the requirements land:
//   · the frame, the list prompt, the empty state and the footer literals;
//   · row anatomy: the trailing italic `(current)`, the one-line prompt text with its `(no prompt)` /
//     `((empty message))` / `!bash` / `/slash` forms, and the second line's three states;
//   · that the second line is computed BEFORE any selection, windowed, and that the window is a BOUND —
//     the 11th-newest anchor gets no dry run on open;
//   · the confirmation panel: prompt, message box, per-option explanation lines, the manual-edit warning,
//     and default focus;
//   · that navigation is Select's (j/k, ctrl+n/p, PageUp/PageDown, Home/End) and that the retargeted KB14
//     jump aliases still reach it through the `MessageSelector` scope above.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { RewindPicker } from "../../src/tui/RewindPicker.js";
import { conversationExplanation, REWIND_CHROME_ROWS, REWIND_MIN_ROWS, rewindVisibleRows } from "../../src/tui/rewindModel.js";
import type { RewindAnchor, RewindDryRun } from "../../src/session/chatSession.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
/** Strip SGR so a literal assertion is about TEXT; the colour/italic assertions use the raw frame on purpose. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// `rewindAnchorsFrom` hands the picker NEWEST-FIRST; the picker displays it reversed with `(current)` last.
const ANCHORS: RewindAnchor[] = [
  { uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2, timestamp: new Date(Date.now() - 5 * 60_000).toISOString() },
  { uuid: "uA", prevUuid: null, text: "first prompt", index: 0 },
];
const never = () => new Promise<RewindDryRun>(() => {});
const clean: RewindDryRun = { canRewind: true, filesChanged: ["/repo/src/a.ts", "/repo/src/b.ts"], insertions: 3, deletions: 1 };
const props = { onDryRun: never, onConfirm: () => {}, onClose: () => {}, rows: 40, columns: 80 };

// WAVE S T4. The window budget used to be upstream's inlined `12`, which measures upstream's frame under a
// halving (`ds()`, its split-view predicate) we do not have — so it measured nothing of ours. Re-derived
// against the frame `RewindFrame` + the list body actually draw, and pinned DIRECTLY: a test that only
// asserted `rewindVisibleRows(15) === 2` and `rewindVisibleRows(40) > 2` is satisfied by every constant from
// 7 to 31, the wrong 12 included, so it would pin nothing at all.
describe("rewindVisibleRows — the budget is our own chrome, counted", () => {
  it("sizes its window from the chrome RewindPicker actually draws", () => {
    expect(REWIND_CHROME_ROWS).toBe(9);            // border ×2 · title · blank · prompt · ↑ · ↓ · blank · footer
    expect(REWIND_MIN_ROWS).toBe(2);               // upstream's `Math.max(2, …)` floor (L487056)
    expect(rewindVisibleRows(21)).toBe(4);         // 4 at C=9, 3 at the old C=12 — THE discriminator
    expect(rewindVisibleRows(30)).toBe(7);         // 7 vs 6 — a second height where the two constants differ
    expect(rewindVisibleRows(15)).toBe(2);         // and the floor still holds where the pane is too short
    expect(rewindVisibleRows(4)).toBe(2);
  });
});

describe("<RewindPicker> — the frame and the list", () => {
  it("renders the Rewind frame, upstream's list prompt and the enter/esc footer", async () => {
    const { lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} />);
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Rewind");
    expect(f).toContain("Restore the code and/or conversation to the point before…");
    expect(f).toContain("enter to continue · esc to cancel");
  });

  it("displays OLDEST-first with the trailing italic (current) row, and opens with the cursor on it", async () => {
    const { lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    const f = plain(frame(lastFrame));
    expect(f.indexOf("first prompt")).toBeLessThan(f.indexOf("second prompt"));   // oldest first
    expect(f.indexOf("second prompt")).toBeLessThan(f.indexOf("(current)"));      // synthetic row is last
    expect(frame(lastFrame)).toMatch(/\x1b\[3m[\s\S]{0,32}?\(current\)/);        // italic (SGR 3)
    // The pointer is on the `(current)` row, not on a prompt: focus starts at T.length - 1.
    expect(plain(frame(lastFrame)).split("\n").find((r) => r.includes("❯"))).toContain("(current)");
  });

  it("an empty anchor list opens the dialog on upstream's empty state, with no list and no enter hint", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={[]} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("Nothing to rewind to yet."));
    const f = plain(frame(lastFrame));
    expect(f).toContain("esc to cancel");
    expect(f).not.toContain("enter to continue");
    expect(f).not.toContain("(current)");
    await tick();
    stdin.write("\x1b");                                                          // the empty state still cancels
    await waitFor(() => closed === 1);
  });

  it("row text: (no prompt), ((empty message)), a bash prompt and a slash command each take their own form", async () => {
    const odd: RewindAnchor[] = [
      { uuid: "u4", prevUuid: "x", text: "<command-name>compact</command-name><command-args>keep tests</command-args>", index: 6 },
      { uuid: "u3", prevUuid: "x", text: "<bash-input>ls -la</bash-input>", index: 4 },
      { uuid: "u2", prevUuid: "x", text: "<context>only a note</context>", index: 2 },
      { uuid: "u1", prevUuid: null, text: "", index: 0 },
    ];
    const { lastFrame } = render(<RewindPicker {...props} anchors={odd} />);
    await waitFor(() => frame(lastFrame).includes("(no prompt)"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("(no prompt)");
    expect(f).toContain("((empty message))");
    expect(f).toContain("! ls -la");
    expect(f).toContain("/compact keep tests");
  });

  it("a multi-line prompt is clipped to ONE line", async () => {
    const anchors: RewindAnchor[] = [{ uuid: "u1", prevUuid: "x", text: "line one\nline two\nline three", index: 0 }];
    const { lastFrame } = render(<RewindPicker {...props} anchors={anchors} />);
    await waitFor(() => frame(lastFrame).includes("line one"));
    expect(plain(frame(lastFrame))).not.toContain("line two");
  });
});

describe("<RewindPicker> — row summaries are computed before selection", () => {
  it("every row's second line lands with no selection and no keystroke, newest anchor first", async () => {
    const gate = new Map<string, ReturnType<typeof deferred<RewindDryRun>>>();
    const anchors: RewindAnchor[] = [
      { uuid: "uB", prevUuid: "aA", text: "newer", index: 2 },
      { uuid: "uA", prevUuid: null, text: "older", index: 0 },
    ];
    const { lastFrame } = render(
      <RewindPicker {...props} anchors={anchors} onDryRun={(uuid) => { const d = deferred<RewindDryRun>(); gate.set(uuid, d); return d.promise; }} />,
    );
    // The walk is sequential and newest-first: uB is asked for first, and uA is not asked at all until it lands.
    await waitFor(() => gate.has("uB"));
    expect(gate.has("uA")).toBe(false);
    gate.get("uB")!.resolve({ canRewind: true, filesChanged: ["/repo/x/only.ts"], insertions: 12, deletions: 0 });
    await waitFor(() => frame(lastFrame).includes("only.ts"));
    expect(plain(frame(lastFrame))).toContain("only.ts +12");
    await waitFor(() => gate.has("uA"));
    gate.get("uA")!.resolve({ canRewind: true, filesChanged: [] });
    await waitFor(() => frame(lastFrame).includes("No code changes"));
  });

  it("two changed files read `N files changed +A -R`; a failed dry run reads the warning", async () => {
    const anchors: RewindAnchor[] = [
      { uuid: "uB", prevUuid: "aA", text: "newer", index: 2 },
      { uuid: "uA", prevUuid: "x", text: "older", index: 0 },
    ];
    const { lastFrame } = render(
      <RewindPicker {...props} anchors={anchors}
        onDryRun={async (uuid) => (uuid === "uB" ? clean : { canRewind: false, error: "File rewinding is not enabled." })} />,
    );
    await waitFor(() => frame(lastFrame).includes("2 files changed"));
    const f = plain(frame(lastFrame));
    expect(f).toContain("2 files changed +3 -1");
    expect(f).toContain("⚠ No code restore");
  });

  it("a THROWN dry run is a result, not a hole — the row shows the warning rather than staying blank", async () => {
    const anchors: RewindAnchor[] = [{ uuid: "uA", prevUuid: "x", text: "only", index: 0 }];
    const { lastFrame } = render(<RewindPicker {...props} anchors={anchors} onDryRun={async () => { throw new Error("boom"); }} />);
    await waitFor(() => frame(lastFrame).includes("⚠ No code restore"));
  });

  it("THE WINDOW IS A BOUND: opening a 25-anchor list dry-runs the newest ten and stops", async () => {
    const anchors: RewindAnchor[] = Array.from({ length: 25 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 50 - i }));
    const asked: string[] = [];
    render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return { canRewind: true, filesChanged: [] }; }} />);
    await waitFor(() => asked.length >= 10);
    await new Promise((r) => setTimeout(r, 60));                       // give a runaway walk time to overshoot
    expect(asked).toEqual(Array.from({ length: 10 }, (_, i) => `u${i}`));
    expect(asked).not.toContain("u10");                                // the 11th newest is NOT dry-run on open
  });

  it("scrolling past the window extends it — the older rows are asked for only then", async () => {
    const anchors: RewindAnchor[] = Array.from({ length: 25 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 50 - i }));
    const asked: string[] = [];
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return { canRewind: true, filesChanged: [] }; }} />);
    await waitFor(() => asked.length === 10);
    expect(asked).not.toContain("u24");
    await tick();
    stdin.write("\x1b[H");                                             // Home → the OLDEST row (u24 in dry-run space)
    await waitFor(() => asked.includes("u24"), 4000);
    expect(frame(lastFrame)).toBeTruthy();
  });
});

// t10 review, Important 1. The destructive option list must not move under the cursor. Reproduced exactly as
// the reviewer did: select an anchor whose dry run is still in flight, then land it and watch what happens to
// the row the pointer is on. Both halves of the fix get their own pin.
describe("<RewindPicker> — a panel never opens on, or shifts to, an unlanded summary", () => {
  /** One anchor, one dry run the test controls. `k` steps off `(current)` onto it, Enter selects it. */
  const selectSole = async (d: ReturnType<typeof deferred<RewindDryRun>>) => {
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={() => d.promise} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    return r;
  };

  it("(a) Enter HOLDS the list until the summary lands, then opens with the settled option list", async () => {
    const d = deferred<RewindDryRun>();
    const { lastFrame } = await selectSole(d);
    await waitFor(() => plain(frame(lastFrame)).includes("checking file changes…"));
    expect(plain(frame(lastFrame))).not.toContain("Confirm you want to restore");   // the panel is NOT open yet
    expect(plain(frame(lastFrame))).toContain("Restore the code and/or conversation"); // still the list
    d.resolve(clean);
    await waitFor(() => plain(frame(lastFrame)).includes("Confirm you want to restore"));
    // It opens on the SETTLED list — `both` present and focused, not inserted later under the pointer.
    expect(plain(frame(lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
  });

  it("(b) a summary landing for the OPEN panel's own anchor cannot change its options — the frozen snapshot", async () => {
    // The belt, driven down the one path that still reaches it with the hold in place: TWO dry runs for the
    // SAME uuid can be outstanding at once — the background walk's, and the out-of-band one `open` issues
    // when the walk has not landed yet (upstream's `oe` does the same second lookup). The out-of-band call
    // settles first with `canRewind:false`, so the panel opens conversation-only with the pointer on index 0.
    // Then the WALK's own call lands `clean` and writes it into the summaries map. A panel reading that map
    // live would INSERT `Restore code and conversation` at index 0 — under a pointer `Select` keeps by INDEX —
    // and the next Enter would confirm a code restore the user never chose. The snapshot is what stops it.
    const calls: ReturnType<typeof deferred<RewindDryRun>>[] = [];
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const confirms: unknown[] = [];
    const r = render(
      <RewindPicker {...props} anchors={anchors} onConfirm={(a, s) => confirms.push([a.uuid, s])}
        onDryRun={() => { const d = deferred<RewindDryRun>(); calls.push(d); return d.promise; }} />,
    );
    await waitFor(() => calls.length === 1);                           // the walk's call, still in flight
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => calls.length === 2);                           // …and `open`'s out-of-band one
    calls[1]!.resolve({ canRewind: false, error: "not enabled" });      // it settles first → panel opens
    await waitFor(() => plain(frame(r.lastFrame)).includes("Confirm you want to restore"));
    expect(plain(frame(r.lastFrame))).not.toContain("Restore code and conversation");
    expect(plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");

    calls[0]!.resolve(clean);                                          // the walk lands, for the SAME uuid
    await new Promise((rs) => setTimeout(rs, 40));
    expect(plain(frame(r.lastFrame))).not.toContain("Restore code and conversation");   // options did not move
    expect(plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");
    r.stdin.write("\r");                                               // …and Enter still means what it read
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual(["uB", "conversation"]);
  });

  it("Escape during the hold abandons it — a late summary cannot pop the panel open afterwards", async () => {
    const d = deferred<RewindDryRun>();
    const { stdin, lastFrame } = await selectSole(d);
    await waitFor(() => plain(frame(lastFrame)).includes("checking file changes…"));
    stdin.write("\x1b");
    await waitFor(() => !plain(frame(lastFrame)).includes("checking file changes…"));
    d.resolve(clean);
    await new Promise((r) => setTimeout(r, 40));
    expect(plain(frame(lastFrame))).not.toContain("Confirm you want to restore");
    expect(plain(frame(lastFrame))).toContain("Restore the code and/or conversation");
  });

  it("an anchor whose summary ALREADY landed opens the panel with no second dry run and no hold", async () => {
    const asked: string[] = [];
    const anchors: RewindAnchor[] = [{ uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 }];
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={async (uuid) => { asked.push(uuid); return clean; }} />);
    await waitFor(() => frame(r.lastFrame).includes("2 files changed"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => plain(frame(r.lastFrame)).includes("Confirm you want to restore"));
    expect(plain(frame(r.lastFrame))).not.toContain("checking file changes…");
    expect(asked).toEqual(["uB"]);                                     // the walk's one call, not a second
  });
});

describe("<RewindPicker> — the confirmation panel", () => {
  const openConfirm = async (anchors: RewindAnchor[], dry: (uuid: string) => Promise<RewindDryRun>) => {
    const r = render(<RewindPicker {...props} anchors={anchors} onDryRun={dry} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");                                                // up off `(current)` onto the newest anchor
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    return r;
  };
  /** The same, but on the OLDEST row — `uA`, whose `prevUuid` is null (the session's first prompt). Home
   *  rather than `k`, which is how the pre-Wave-S null-prevUuid test below already reached it. */
  const openConfirmFirst = async (dry: (uuid: string) => Promise<RewindDryRun>) => {
    const r = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={dry} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("\x1b[H");                                           // Home → the OLDEST row (uA, prevUuid null)
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("first prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    return r;
  };

  // A4, kept as a GUARD. These passed on the build that existed when Wave S was planned; they are here so a
  // later refactor cannot quietly drop upstream's option set (L487069-072). Nothing was "fixed" to make them
  // pass — passing on arrival is the expected result, and is recorded as such.
  it("offers the four implementable options in upstream's order and wording (A4)", async () => {
    // dry run reporting one changed file → the three-way head is on
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["a.ts"], insertions: 1, deletions: 0 }));
    const f = plain(frame(lastFrame));
    const at = (s: string) => f.indexOf(s);
    expect(at("Restore code and conversation")).toBeGreaterThan(-1);
    expect(at("Restore conversation")).toBeGreaterThan(at("Restore code and conversation"));
    expect(at("Restore code")).toBeGreaterThan(-1);
    expect(at("Never mind")).toBeGreaterThan(at("Restore conversation"));
  });

  it("drops the code options when the dry run names no changed file (A4)", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: [] }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore conversation");
    expect(f).not.toContain("Restore code and conversation");
  });

  it("pairs each option with its own explanatory line — the two are trivially swapped (A4)", () => {
    expect(conversationExplanation("code")).toBe("The conversation will be unchanged.");
    expect(conversationExplanation("conversation")).toBe("The conversation will be forked.");
    expect(conversationExplanation("both")).toBe("The conversation will be forked.");
  });

  it("prompt, message box, relative time and the four options — with `both` focused when code restore is possible", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => clean);
    const f = plain(frame(lastFrame));
    expect(f).toContain("Confirm you want to restore to the point before you sent this message:");
    expect(f).toContain("second prompt");
    expect(f).toContain("(5m ago)");
    expect(f).toContain("Restore code and conversation");
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Restore code");
    expect(f).toContain("Never mind");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
    // The explanation pair for the focused option, and the manual-edit warning under the list.
    expect(f).toContain("The conversation will be forked.");
    expect(f).toContain("The code will be restored +3 -1 in a.ts and b.ts.");
    expect(f).toContain("⚠ Rewinding does not affect files edited manually or via bash.");
  });

  it("the explanation pair follows the FOCUSED option, before anything is chosen", async () => {
    const { stdin, lastFrame } = await openConfirm(ANCHORS, async () => clean);
    stdin.write("j");                                                  // → Restore conversation
    await waitFor(() => plain(frame(lastFrame)).includes("The code will be unchanged."));
    expect(plain(frame(lastFrame))).toContain("The conversation will be forked.");
    stdin.write("j");                                                  // → Restore code
    await waitFor(() => plain(frame(lastFrame)).includes("The conversation will be unchanged."));
    expect(plain(frame(lastFrame))).toContain("The code will be restored +3 -1 in a.ts and b.ts.");
    stdin.write("j");                                                  // → Never mind
    await waitFor(() => plain(frame(lastFrame)).includes("The code will be unchanged."));
  });

  it("one changed file names it; three or more read `first and N other files`", async () => {
    const one = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["/x/solo.ts"], insertions: 1, deletions: 0 }));
    expect(plain(frame(one.lastFrame))).toContain("The code will be restored +1 in solo.ts.");
    one.unmount();
    const many = await openConfirm(ANCHORS, async () => ({ canRewind: true, filesChanged: ["/x/a.ts", "/x/b.ts", "/x/c.ts"], insertions: 2, deletions: 2 }));
    expect(plain(frame(many.lastFrame))).toContain("The code will be restored +2 -2 in a.ts and 2 other files.");
  });

  it("no code restore: the prompt regains `the conversation`, the code options and the warning are absent", async () => {
    const { lastFrame } = await openConfirm(ANCHORS, async () => ({ canRewind: false, error: "File rewinding is not enabled." }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Confirm you want to restore the conversation to the point before you sent this message:");
    expect(f).toContain("Restore conversation");
    expect(f).not.toContain("Restore code");
    expect(f).not.toContain("⚠ Rewinding does not affect files");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore conversation");
  });

  // W-S8 INVERTS THIS TOO. It used to read "a null-prevUuid anchor cannot restore the conversation: only the
  // code option is offered, and it is focused" — correct while the host refused that case, and a lie the
  // moment it learned to clear instead of fork. Rewritten rather than deleted: this is the only coverage of
  // the first-prompt anchor shape.
  it("a null-prevUuid anchor CAN restore the conversation now — the full option set, with `both` focused", async () => {
    const { lastFrame } = await openConfirmFirst(async () => clean);
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore code and conversation");
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Restore code");
    expect(f.split("\n").find((l) => l.includes("❯"))).toContain("Restore code and conversation");
  });

  it("offers a conversation restore for the first message (A4b)", async () => {
    const { lastFrame } = await openConfirmFirst(async () => ({ canRewind: false }));
    const f = plain(frame(lastFrame));
    expect(f).toContain("Restore conversation");
    expect(f).toContain("Never mind");
  });

  // The pointer and the explanation line are computed from DIFFERENT state (`defaultFocusValue` at the render
  // site, `focusedOption` which `open()` also seeds), so the predicate was changed at all three sites. WHAT
  // THIS PINS IS THE RENDER SITE ALONE — and the two `open()` seeds are not independently pinnable here, for
  // an architectural reason: Select reports its focused row from a mount effect (Select.tsx's
  // `useEffect(() => reportFocus(current?.value))`), and `current` is derived from `defaultFocusValue`, so
  // `onFocus` overwrites whatever `open()` seeded within the same commit. Reverting either seed — or both —
  // leaves the whole tui suite green. Changing all three remains right for consistency: a seed that
  // disagrees with the render site is a self-contradicting frame waiting for the day the effect stops
  // running first. Not the pin for the option LIST either; the two A4b tests above own that.
  it("focuses a restorable option and explains THAT option, for a first-message anchor (A4b)", async () => {
    const { lastFrame } = await openConfirmFirst(async () => ({ canRewind: false }));
    expect(plain(frame(lastFrame))).toContain("The conversation will be forked.");        // not "…will be unchanged."
  });

  it("choosing an option confirms with that scope; Never mind and Esc both go BACK to the list, never out", async () => {
    const confirms: unknown[] = [];
    let closed = 0;
    const r = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={async () => clean} onConfirm={(a, s) => confirms.push([a.uuid, s])} onClose={() => { closed++; }} />);
    await waitFor(() => frame(r.lastFrame).includes("(current)"));
    await tick();
    r.stdin.write("k");
    await waitFor(() => (plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("❯")) ?? "").includes("second prompt"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));

    r.stdin.write("\x1b");                                             // Esc → back to the list, NOT out
    await waitFor(() => plain(frame(r.lastFrame)).includes("Restore the code and/or conversation"));
    expect(closed).toBe(0);

    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    r.stdin.write("4");                                                // Never mind, by its digit
    await waitFor(() => plain(frame(r.lastFrame)).includes("Restore the code and/or conversation"));
    expect(confirms).toEqual([]);
    expect(closed).toBe(0);

    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Confirm you want to restore"));
    r.stdin.write("2");                                                // Restore conversation
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual(["uB", "conversation"]);
  });
});

describe("<RewindPicker> — navigation is the shared list's", () => {
  const many: RewindAnchor[] = Array.from({ length: 12 }, (_, i) => ({ uuid: `u${i}`, prevUuid: "p", text: `prompt ${i}`, index: 24 - i }));
  const pointerRow = (f: string) => plain(f).split("\n").find((l) => l.includes("❯")) ?? "";

  it("j/k, ctrl+n/ctrl+p, Home/End and PageUp all move the list", async () => {
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={40} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("k"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 0"));       // newest anchor
    stdin.write("k"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 1"));
    stdin.write("\x0e"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 0"));    // ctrl+n
    stdin.write("\x10"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 1"));    // ctrl+p
    stdin.write("\x1b[H"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11")); // Home → oldest
    stdin.write("\x1b[F"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)")); // End → the synthetic row
    stdin.write("\x1b[5~"); await waitFor(() => !pointerRow(frame(lastFrame)).includes("(current)")); // PageUp moves
  });

  it("the retargeted KB14 jump aliases still reach Select through the MessageSelector scope", async () => {
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={40} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("K"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11"));         // shift+k → first
    stdin.write("J"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)"));         // shift+j → last
    stdin.write("\x1b[1;5A"); await waitFor(() => pointerRow(frame(lastFrame)).includes("prompt 11")); // ctrl+↑ → first
    stdin.write("\x1b[1;2B"); await waitFor(() => pointerRow(frame(lastFrame)).includes("(current)")); // shift+↓ → last
  });

  it("the scroll counters are caller-rendered from the list's own window", async () => {
    // rows:22 → visible = max(2, floor((22-9)/3)) = 4 of 13 options, so both counters are live. The counts
    // moved from 10 to 9 with the Wave S t4 re-derivation of `REWIND_CHROME_ROWS`: one more row fits.
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={many} onDryRun={never} rows={22} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    expect(plain(frame(lastFrame))).toContain("↑ 9 more above");
    expect(plain(frame(lastFrame))).not.toContain("more below");
    await tick();
    stdin.write("\x1b[H");                                             // Home → the top of the list
    await waitFor(() => plain(frame(lastFrame)).includes("more below"));
    expect(plain(frame(lastFrame))).toContain("↓ 9 more below");
    expect(plain(frame(lastFrame))).not.toContain("more above");
  });

  it("selecting the synthetic (current) row closes the picker and confirms nothing", async () => {
    const confirms: unknown[] = [];
    let closed = 0;
    const { stdin, lastFrame } = render(
      <RewindPicker {...props} anchors={ANCHORS} onDryRun={never} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => { closed++; }} />,
    );
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("\r");                                                 // Enter on `(current)`
    await waitFor(() => closed === 1);
    expect(confirms).toEqual([]);
  });

  it("Esc on the list closes the picker", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(<RewindPicker {...props} anchors={ANCHORS} onDryRun={never} onClose={() => { closed++; }} />);
    await waitFor(() => frame(lastFrame).includes("(current)"));
    await tick();
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });
});
