// test/tui/RewindPicker.test.tsx — the Esc-Esc rewind picker (Stage C5 task 5): stage 1 lists user-prompt
// anchors (newest-first, as supplied) with ↑/↓ selection; stage 2 shows CC's three restore choices, gated
// by the lazy dryRun result (probe 68d: canRewind:false disables code choices) and the anchor's null
// prevUuid (probe 68c: first prompt / first-after-compact disables conversation choices). Mirrors
// planDialog.test.tsx's waitFor-before-keys discipline (useInput subscribes in a passive effect).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { RewindPicker } from "../../src/tui/RewindPicker.js";
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

// fixture order IS newest-first (uB/index2 before uA/index0) — the component renders in the order given,
// it does not sort.
const ANCHORS: RewindAnchor[] = [
  { uuid: "uB", prevUuid: "aA", text: "second prompt", index: 2 },
  { uuid: "uA", prevUuid: null, text: "first prompt", index: 0 },
];

describe("<RewindPicker>", () => {
  it("renders anchors newest-first, ↑↓ moves selection, Esc calls onClose", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => new Promise(() => {})} onConfirm={() => {}} onClose={() => { closed++; }} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    const f = frame(lastFrame);
    expect(f.indexOf("second prompt")).toBeLessThan(f.indexOf("first prompt"));   // newest-first order
    expect(f.match(/\x1b\[7m[^\x1b]*second prompt/)).not.toBeNull();               // row 0 starts selected
    await new Promise((r) => setTimeout(r, 20));                                   // let useInput subscribe
    stdin.write("\x1b[B");                                                          // ↓
    await waitFor(() => frame(lastFrame).match(/\x1b\[7m[^\x1b]*first prompt/) !== null);   // selection moved
    stdin.write("\x1b");                                                             // esc on the list → onClose
    await waitFor(() => closed === 1);
  });

  it("Enter on an anchor calls onDryRun(uuid); while unresolved the scope stage shows 'checking file changes…' and 1/3 do nothing", async () => {
    const d = deferred<RewindDryRun>();
    const calls: string[] = [];
    const confirms: unknown[] = [];
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={(uuid) => { calls.push(uuid); return d.promise; }} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");                                                               // Enter on row 0 (uB)
    await waitFor(() => frame(lastFrame).includes("checking file changes"));
    expect(calls).toEqual(["uB"]);
    stdin.write("1"); stdin.write("3");
    await new Promise((r) => setTimeout(r, 20));
    expect(confirms).toEqual([]);                                                    // both gated while dry run is in flight
  });

  it("dryRun resolves canRewind:true → summary '2 files changed (+3 −1)'; pressing 1 → onConfirm(anchor, 'both')", async () => {
    const d = deferred<RewindDryRun>();
    const confirms: unknown[] = [];
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => d.promise} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("checking file changes"));
    d.resolve({ canRewind: true, filesChanged: ["/a", "/b"], insertions: 3, deletions: 1 });
    await waitFor(() => frame(lastFrame).includes("2 files changed (+3 −1)"));
    stdin.write("1");
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual([ANCHORS[0], "both"]);
  });

  it("dryRun resolves canRewind:false → rows 1 and 3 render dim with the reason; pressing 1 does nothing; pressing 2 → onConfirm(anchor, 'conversation')", async () => {
    const d = deferred<RewindDryRun>();
    const confirms: unknown[] = [];
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => d.promise} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("checking file changes"));
    d.resolve({ canRewind: false, error: "File rewinding is not enabled." });
    await waitFor(() => frame(lastFrame).includes("File rewinding is not enabled."));
    stdin.write("1");
    await new Promise((r) => setTimeout(r, 20));
    expect(confirms).toEqual([]);                                                    // code choice stays gated
    stdin.write("2");
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual([ANCHORS[0], "conversation"]);
  });

  it("the null-prevUuid anchor: rows 1 and 2 dim with 'nothing before this prompt'; only 3 works", async () => {
    const confirms: unknown[] = [];
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => Promise.resolve({ canRewind: true })} onConfirm={(a, s) => confirms.push([a, s])} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b[B");                                                           // ↓ to "first prompt" (uA, prevUuid null)
    await waitFor(() => frame(lastFrame).match(/\x1b\[7m[^\x1b]*first prompt/) !== null);
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("nothing before this prompt"));
    stdin.write("1");
    await new Promise((r) => setTimeout(r, 20));
    expect(confirms).toEqual([]);
    stdin.write("2");
    await new Promise((r) => setTimeout(r, 20));
    expect(confirms).toEqual([]);
    stdin.write("3");
    await waitFor(() => confirms.length === 1);
    expect(confirms[0]).toEqual([ANCHORS[1], "code"]);
  });

  it("Esc in the scope stage returns to the list (onClose NOT called); Esc again closes", async () => {
    let closed = 0;
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => Promise.resolve({ canRewind: true })} onConfirm={() => {}} onClose={() => { closed++; }} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Rewind to:"));
    stdin.write("\x1b");
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    expect(closed).toBe(0);
    stdin.write("\x1b");
    await waitFor(() => closed === 1);
  });

  it("a stale dryRun for an earlier selection does not clobber a later selection's result (the seq guard)", async () => {
    const d1 = deferred<RewindDryRun>();
    const d2 = deferred<RewindDryRun>();
    let call = 0;
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => { call++; return call === 1 ? d1.promise : d2.promise; }} onConfirm={() => {}} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");                                                               // select uB → dryRun #1 (d1) in flight
    await waitFor(() => frame(lastFrame).includes("checking file changes"));
    stdin.write("\x1b");                                                              // back to the list; d1 still unresolved
    await waitFor(() => frame(lastFrame).includes("Rewind to a previous message"));
    stdin.write("\r");                                                                // re-select uB → dryRun #2 (d2), seq bumped
    await waitFor(() => frame(lastFrame).includes("checking file changes"));
    d1.resolve({ canRewind: false, error: "STALE — must be ignored" });                // the earlier request lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(frame(lastFrame)).toContain("checking file changes");                       // still pending — d1 did NOT land
    expect(frame(lastFrame)).not.toContain("STALE");
    d2.resolve({ canRewind: true, filesChanged: [] });                                  // the current request settles
    await waitFor(() => frame(lastFrame).includes("no file changes"));
  });

  it("verbatim copy: the three rows read exactly the CC restore choices", async () => {
    const { stdin, lastFrame } = render(
      <RewindPicker anchors={ANCHORS} onDryRun={() => Promise.resolve({ canRewind: true })} onConfirm={() => {}} onClose={() => {}} />,
    );
    await waitFor(() => frame(lastFrame).includes("second prompt"));
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Rewind to:"));
    const f = frame(lastFrame);
    expect(f).toContain("1. Restore conversation and code");
    expect(f).toContain("2. Restore conversation only");
    expect(f).toContain("3. Restore code only");
  });
});
