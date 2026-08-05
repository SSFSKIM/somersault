// test/tui/queue-composer.test.tsx — F5 task 8: the type-ahead queue's record shape (CM51) and CM48's
// Up/ctrl+p drain back into the composer. Pins transcribed from the 2.1.220 bundle:
//  · L148879  `P5`  — the editable predicate (`!SKg.has(mode) && !isMeta && cee(origin)`; `SKg` at L149153)
//  · L149093  `V`   — `popAllEditable`: `[...queued, draft].filter(Boolean).join("\n")`, QUEUED FIRST,
//                     cursor at `queued.join("\n").length + 1 + draftOffset`, non-editable entries survive
//  · L495509  `Uge` — the Up guard: bail on a popup with >1 items, bail with the caret past the first
//                     newline, otherwise DRAIN when anything is editable and only then walk history
//  · L495786  `GU`  — the composer-side apply
//  · L495115  the queued-up hint literal (L495114 is the gate above it), and L495120's `LNb = 3` cap
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ChatComposer, type PlaceholderMemo } from "../../src/tui/ChatComposer.js";
import { applyQueueDrain, isEditableQueueEntry, joinQueuedForComposer, type QueueEntry } from "../../src/tui/queue.js";
import { initialEditorState, setBuffer, type EditorState, type PastedMap } from "../../src/tui/editor.js";
import { chipLabel } from "../../src/tui/pasteChips.js";
import { appendHistory } from "../../src/tui/promptHistory.js";
import { savePrefs, loadPrefs } from "../../src/tui/prefs.js";
import { QUEUED_UP_HINT } from "../../src/tui/placeholder.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";

const q = (value: string, over: Partial<QueueEntry> = {}): QueueEntry => ({ value, mode: "prompt", priority: "now", origin: "user", ...over });
const text = (s: EditorState) => s.lines.join("\n");

// ————————————————————————— CM51: the record and its editable predicate —————————————————————————

describe("isEditableQueueEntry (P5, L148879)", () => {
  it("accepts every entry this port mints today — prompt and bash alike", () => {
    expect(isEditableQueueEntry(q("hello"))).toBe(true);
    expect(isEditableQueueEntry(q("!ls", { mode: "bash" }))).toBe(true);
  });
  it("rejects upstream's task-notification mode and any non-user origin", () => {
    expect(isEditableQueueEntry({ ...q("x"), mode: "task-notification" as QueueEntry["mode"] })).toBe(false);
    expect(isEditableQueueEntry({ ...q("x"), origin: "agent" as QueueEntry["origin"] })).toBe(false);
  });
});

// ————————————————————————— CM48: the join and the apply, as pure functions —————————————————————————

describe("joinQueuedForComposer (the useChat half of V, L149093)", () => {
  it("joins the editable entries with newlines, in queue order", () => {
    expect(joinQueuedForComposer([q("a"), q("b")])).toEqual({ text: "a\nb" });
  });
  it("answers null when the queue is empty or holds nothing editable", () => {
    expect(joinQueuedForComposer([])).toBeNull();
    expect(joinQueuedForComposer([{ ...q("x"), origin: "agent" as QueueEntry["origin"] }])).toBeNull();
  });
  it("keeps a bash entry's `!` — the drained buffer re-derives bash mode from it (divergence 1)", () => {
    expect(joinQueuedForComposer([q("!git status", { mode: "bash" })])?.text).toBe("!git status");
  });
  it("RE-MINTS colliding chip ids across entries so two `#1` labels cannot share one payload", () => {
    const map = (id: number, content: string): PastedMap => ({ [id]: { id, type: "text", content, lineCount: 0 } });
    const popped = joinQueuedForComposer([
      q(`look at ${chipLabel(1, 0)}`, { pastedContents: map(1, "FIRST") }),
      q(`and ${chipLabel(1, 0)}`, { pastedContents: map(1, "SECOND") }),
    ])!;
    const ids = Object.keys(popped.pastedContents!).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
    expect(popped.pastedContents![1].content).toBe("FIRST");
    expect(popped.pastedContents![2].content).toBe("SECOND");
    // …and the LABELS in the joined text were rewritten to match, so neither points at the other's payload.
    expect(popped.text).toBe(`look at ${chipLabel(1, 0)}\nand ${chipLabel(2, 0)}`);
  });
});

describe("applyQueueDrain (the composer half of GU, L495786)", () => {
  it("puts the queued block ABOVE the live draft and lands the caret at the end", () => {
    const s = setBuffer(initialEditorState(), "c");
    const out = applyQueueDrain(s, { text: "a\nb" });
    expect(text(out)).toBe("a\nb\nc");
    expect(out.cursor).toEqual({ row: 2, col: 1 });
  });
  it("keeps the caret's COLUMN inside the draft — upstream's `queued.length + 1 + cursorOffset`", () => {
    const s = { ...setBuffer(initialEditorState(), "hello"), cursor: { row: 0, col: 2 } };
    const out = applyQueueDrain(s, { text: "queued" });
    expect(text(out)).toBe("queued\nhello");
    expect(out.cursor).toEqual({ row: 1, col: 2 });
  });
  it("drops an EMPTY draft from the join and clamps the caret to the end (divergence 3)", () => {
    const out = applyQueueDrain(initialEditorState(), { text: "a\nb" });
    expect(text(out)).toBe("a\nb");
    expect(out.cursor).toEqual({ row: 1, col: 1 });
  });
  it("keeps the DRAFT's own pastes and lifts the queued ones above the live counter", () => {
    const draftChip: PastedMap = { 1: { id: 1, type: "text", content: "DRAFT", lineCount: 0 } };
    const s = { ...setBuffer(initialEditorState(), `d ${chipLabel(1, 0)}`), pastedContents: draftChip, pasteCounter: 1 };
    const out = applyQueueDrain(s, { text: `q ${chipLabel(1, 0)}`, pastedContents: { 1: { id: 1, type: "text", content: "QUEUED", lineCount: 0 } } });
    expect(out.pastedContents[1].content).toBe("DRAFT");
    expect(out.pastedContents[2].content).toBe("QUEUED");
    expect(text(out)).toBe(`q ${chipLabel(2, 0)}\nd ${chipLabel(1, 0)}`);
    expect(out.pasteCounter).toBe(2);
  });
  it("ends any history walk — the drained text is not a recalled entry", () => {
    const s = { ...initialEditorState([{ display: "old" }]), histIndex: 0, histRecalled: "old" };
    expect(applyQueueDrain(s, { text: "a" }).histIndex).toBeNull();
  });
});

// ————————————————————————— <ChatComposer>: the live Up/ctrl+p path —————————————————————————

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (p: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};
const UP = "\x1b[A", CTRL_P = "\x10";
const PROJECT = "/tmp/ccx-queue-composer-project";

describe("<ChatComposer> — CM48's drain (Uge, L495509)", () => {
  let root = "", env: NodeJS.ProcessEnv;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-queue-")); env = { ...process.env, CCX_FLEET_ROOT: root }; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  /** A `queuePop` that answers once with `text`, then reports the queue empty — the real seam's contract. */
  const popper = (text: string) => { let left = 1; return () => (left-- > 0 ? { text } : null); };
  const mount = (over: Partial<React.ComponentProps<typeof ChatComposer>> = {}) =>
    renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} {...over} />);

  it("Up on an empty composer drains the whole queue into the buffer", async () => {
    const { stdin, lastFrame } = mount({ queuePop: popper("a\nb") });
    await settle();
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("a"));
    const out = strip(frame(lastFrame));
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("Up MERGES the queue above a live draft — queued first, draft last (the pre-review misreading)", async () => {
    const { stdin, lastFrame } = mount({ queuePop: popper("a\nb") });
    await settle();
    stdin.write("c");
    await waitFor(() => strip(frame(lastFrame)).includes("c"));
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("b"));
    const rows = strip(frame(lastFrame)).split("\n").map((l) => l.trim());
    const ai = rows.findIndex((l) => l.endsWith("a")), bi = rows.findIndex((l) => l === "b"), ci = rows.findIndex((l) => l === "c");
    expect(ai).toBeGreaterThanOrEqual(0);
    expect(bi).toBe(ai + 1);
    expect(ci).toBe(bi + 1);                                      // the draft is LAST, not first
  });

  it("ctrl+p takes the same interception — it IS the onUp body", async () => {
    const { stdin, lastFrame } = mount({ queuePop: popper("queued line") });
    await settle();
    stdin.write(CTRL_P);
    await waitFor(() => strip(frame(lastFrame)).includes("queued line"));
  });

  it("does NOT drain with the caret past the first newline of a multiline draft", async () => {
    let asked = 0;
    const { stdin, lastFrame } = mount({ queuePop: () => { asked++; return { text: "queued" }; } });
    await settle();
    stdin.write("one\\");                                          // `\` + Return is the composer's newline
    await settle();
    stdin.write("\r");
    await settle();
    stdin.write("two");
    await waitFor(() => strip(frame(lastFrame)).includes("two"));
    // The draft really is two lines — without that this test would prove nothing.
    const rows = strip(frame(lastFrame)).split("\n").map((l) => l.trim());
    expect(rows.findIndex((l) => l.endsWith("one"))).toBeGreaterThanOrEqual(0);
    expect(rows.findIndex((l) => l === "two")).toBe(rows.findIndex((l) => l.endsWith("one")) + 1);
    stdin.write(UP);                                               // caret is on line 2 → cursor move, no drain
    await settle();
    expect(asked).toBe(0);
    expect(strip(frame(lastFrame))).not.toContain("queued");
  });

  it("does not drain while a command popup offers more than one choice", async () => {
    let asked = 0;
    const catalog: CommandEntry[] = [
      { name: "clear", description: "", source: "local" },
      { name: "compact", description: "", source: "local" },
      { name: "config", description: "", source: "local" },
    ];
    const { stdin, lastFrame } = mount({ queuePop: () => { asked++; return { text: "queued" }; }, commandCatalog: catalog });
    await settle();
    stdin.write("/");
    await settle();
    stdin.write("c");
    await waitFor(() => strip(frame(lastFrame)).includes("/compact"));
    stdin.write(UP);
    await settle();
    expect(asked).toBe(0);
    expect(strip(frame(lastFrame))).not.toContain("queued");
  });

  it("falls through to the HISTORY walk when the queue declines", async () => {
    appendHistory({ display: "an older prompt", project: PROJECT }, env);
    const { stdin, lastFrame } = mount({ queuePop: () => null });
    await settle();
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("an older prompt"));
  });

  it("a drained bash command re-enters BASH mode from its own `!` (divergence 1)", async () => {
    const { stdin, lastFrame } = mount({ queuePop: popper("!git status") });
    await settle();
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("!git status"));
    expect(strip(frame(lastFrame))).toContain("bash mode");
  });
});

// ————————————————————————— CM47: the placeholder, rendered —————————————————————————

describe("<ChatComposer> — the placeholder ladder (NVf, L495107)", () => {
  let root = "", env: NodeJS.ProcessEnv;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-placeholder-c-")); env = { ...process.env, CCX_FLEET_ROOT: root }; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const mount = (over: Partial<React.ComponentProps<typeof ChatComposer>> = {}) =>
    renderWithKeymap(<ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} {...over} />);

  it("rule 3: an editable queued entry advertises the Up gesture, byte-exact", async () => {
    const { lastFrame } = mount({ queueHasEditable: true });
    await settle();
    expect(strip(frame(lastFrame))).toContain("Press up to edit queued messages");
  });

  it("rule 4: a fresh session suggests something to try", async () => {
    const { lastFrame } = mount();
    await settle();
    expect(strip(frame(lastFrame))).toMatch(/Try "/);
  });

  it("a session with messages gets no placeholder at all", async () => {
    const { lastFrame } = mount({ hasMessages: true });
    await settle();
    const out = strip(frame(lastFrame));
    expect(out).not.toMatch(/Try "/);
    expect(out).not.toContain(QUEUED_UP_HINT);
  });

  it("the pick is STABLE across re-renders — a keystroke must not reroll the sentence", async () => {
    const { stdin, lastFrame } = mount();
    await settle();
    const first = strip(frame(lastFrame)).match(/Try "[^"]+"/)![0];
    stdin.write("x");
    await waitFor(() => strip(frame(lastFrame)).includes("x"));
    stdin.write("\x7f");                                            // backspace back to empty
    await waitFor(() => strip(frame(lastFrame)).includes("Try \""));
    expect(strip(frame(lastFrame))).toContain(first);
  });

  it("the queued hint counts its sessions in prefs and stops after LNb = 3", async () => {
    for (let i = 0; i < 3; i++) {
      const { lastFrame, unmount } = mount({ queueHasEditable: true });
      await settle();
      expect(strip(frame(lastFrame))).toContain(QUEUED_UP_HINT);
      unmount();
    }
    expect(loadPrefs(env).queuedUpHintSessions).toBe(3);
    const { lastFrame } = mount({ queueHasEditable: true, hasMessages: true });
    await settle();
    expect(strip(frame(lastFrame))).not.toContain(QUEUED_UP_HINT);
  });

  it("keeps the SAME sentence across composer remounts — upstream's `Vr` memoizes once per PROCESS", async () => {
    // The composer unmounts behind the `?` overlay (and every dialog), so a per-mount freeze re-rolled the
    // suggestion the moment you pressed Escape out of help. ChatApp owns the memo for exactly that reason.
    const memo: { current: PlaceholderMemo } = { current: { draws: [] } };
    const first = mount({ placeholderMemoRef: memo });
    await settle();
    const sentence = strip(frame(first.lastFrame)).match(/ry "[^"]+"/)![0];
    first.unmount();
    for (let i = 0; i < 4; i++) {
      const again = mount({ placeholderMemoRef: memo });
      await settle();
      expect(strip(frame(again.lastFrame))).toContain(sentence);
      again.unmount();
    }
    // …and WITHOUT the shared ref each mount is free to re-roll, which is the bug this guards against: the
    // draws record is the only thing carrying the freeze across the remount.
    expect(memo.current.draws.length).toBeGreaterThan(0);
  });

  it("counts ONE session across composer remounts when ChatApp owns the guard ref", async () => {
    // The composer is unmounted and remounted behind every dialog; a component-local guard would spend all
    // three of the hint's sessions inside one, which is why ChatApp owns this ref (as it does CM56's).
    const shared = { current: false };
    for (let i = 0; i < 3; i++) {
      const { unmount } = mount({ queueHasEditable: true, queueHintCountedRef: shared });
      await settle();
      unmount();
    }
    expect(loadPrefs(env).queuedUpHintSessions).toBe(1);
  });

  // F5 final whole-branch review, P2. `savePrefs` is mkdir + write and it THROWS on a root it cannot write
  // (a read-only home, an `~/.claude` that is a file, a full disk). Thrown from a passive effect that lands
  // on the very first frame, it propagated out of Ink and took the whole REPL down — for a hint counter.
  // Every other prefs writer on a non-essential path is already best-effort (placeholder.ts's example cache,
  // and `appendHistory` swallows its own); this one now matches them.
  it("survives a prefs root it cannot write — the hint still draws, nothing throws", async () => {
    const blocked = { ...process.env, CCX_FLEET_ROOT: join(root, "not-a-dir", "prefs") };
    writeFileSync(join(root, "not-a-dir"), "");                     // mkdir -p through a FILE → ENOTDIR
    const { lastFrame } = mount({ queueHasEditable: true, historyEnv: blocked });
    await settle();
    expect(strip(frame(lastFrame))).toContain(QUEUED_UP_HINT);      // the frame the user came for is unharmed
  });

  it("an existing count at the cap suppresses the hint from the first frame", async () => {
    savePrefs({ queuedUpHintSessions: 3 }, env);
    const { lastFrame } = mount({ queueHasEditable: true, hasMessages: true });
    await settle();
    expect(strip(frame(lastFrame))).not.toContain(QUEUED_UP_HINT);
    expect(loadPrefs(env).queuedUpHintSessions).toBe(3);            // a suppressed hint does not count a session
  });
});
