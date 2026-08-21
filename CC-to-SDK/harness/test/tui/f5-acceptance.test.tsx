// test/tui/f5-acceptance.test.tsx — the F5 wave's five spec acceptance criteria, executed as written
// (spec `docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md` § F5 Acceptance).
//
// These are NOT re-runs of the per-task suites. T3–T12 each pin their own reducer, walker or constant in
// isolation; what had no pin anywhere was the COMPOSITE — one 40-newline paste travelling chip → submit →
// payload, one prompt surviving a real remount off disk, one `/mod` reaching both of its surfaces, one
// directory accept re-opening a walk, one composer frame carrying a live history label. Every criterion
// below therefore drives the SHIPPED component (`<ChatComposer>` under the real `<KeymapProvider>`) with
// real keystrokes, never the reducer directly.
//
// TWO CRITERIA HAVE A RECORDED WORDING SPLIT, both settled against the bundle during the wave and both
// pinned here on the surface that actually owns the behaviour (the same treatment F4 acceptance #4 got):
//
//   · #1 "pasting 40 lines" — `kmt` counts NEWLINE MATCHES, not visual rows (`chipLabel`, F5 t3), so the
//     paste that mints `+40 lines` is one containing 40 newlines, i.e. 41 lines of text. The criterion's
//     "40 lines" and the label's "+40" are the same paste only under that reading.
//   · #3 "typing `/mod` shows dim ghost text" — upstream splits this across two surfaces and so do we.
//     `Pli` (L489935) demands whitespace before the slash, so a BUFFER-LEADING `/mod` can never produce a
//     ghost; it opens the popup (`YRr`'s head branch, L490747). The ghost is the MID-TEXT surface (`Be`'s
//     first branch, L490617–L490625, which clears the suggestion list and returns). Both halves are pinned:
//     ghost + Tab on the mid-text form, Enter-accepts-and-submits on the head form, which is where a local
//     command can be executed at all.
import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { NBSP, POINTER } from "../../src/tui/composerFrame.js";
import { appendHistory, readHistory } from "../../src/tui/promptHistory.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import type { DirEnt } from "../../src/tui/fileComplete.js";

// This file OBSERVES ITS OWN WRITES — criterion 2 is "history survives a relaunch", which is a claim about
// a file — so it pins its own throwaway fleet root rather than riding the per-file backstop, and it reads
// the ambient `process.env` the composer's submit path reads (there is no injectable writer in front of
// `appendHistory`). Each criterion uses its own `project`, which is the scope key `readHistory` filters on,
// so no criterion can see another's prompts.
let root = "";
let prior: string | undefined;
beforeAll(() => { prior = process.env.CCX_FLEET_ROOT; root = mkdtempSync(join(tmpdir(), "ccx-f5acc-")); process.env.CCX_FLEET_ROOT = root; });
afterAll(() => { if (prior === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prior; rmSync(root, { recursive: true, force: true }); });

const COLUMNS = 72;
const frame = (f: () => string | undefined): string => f() ?? "";
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 30); });
const waitFor = async (p: () => boolean, ms = 4000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => { setTimeout(r, 10); }); }
  throw new Error("waitFor timed out");
};
/** What a terminal in DECSET-2004 mode sends around a paste; the composer enables the mode itself (t3). */
const bracketed = (body: string): string => "\x1b[200~" + body + "\x1b[201~";
const UP = "\x1b[A", DOWN = "\x1b[B", TAB = "\t", ENTER = "\r", BACKSPACE = "\x7f";
const GLYPH = POINTER + NBSP;   // `❯` + NBSP — the composer's own prompt, distinct from the transcript echo's `❯ `

type Props = Partial<React.ComponentProps<typeof ChatComposer>>;
const mount = (over: Props = {}) => renderWithKeymap(
  <ChatComposer onSubmit={() => {}} cwd={tmpdir()} commandCatalog={[]} columns={() => COLUMNS} rows={() => 24} {...over} />,
);

// ── ACCEPTANCE #1 ─────────────────────────────────────────────────────────────────────────────────────
// "Pasting 40 lines inserts `[Pasted text #1 +40 lines]`; one backspace deletes the whole chip; the
//  submitted message contains the full 40 lines."
//
// The three clauses are three different machines and the composite is the point: `ingestPaste`'s threshold
// arm (`CMt`/`kmt`, t3) mints the chip and parks the body out of band; `submitTurn`'s `fSe` expansion (t3)
// puts the body back at submit; `deleteTokenBefore` (L395149, t4) is what makes one keystroke eat 25
// characters. A buffer that shows the label while the payload rides beside it is only correct if all three
// agree, and no per-task suite drives them in one sitting through the real component.
const PASTE_LINES = Array.from({ length: 41 }, (_, k) => `row-${String(k).padStart(2, "0")}`);
const PASTE_BODY = PASTE_LINES.join("\n");
const CHIP = "[Pasted text #1 +40 lines]";

describe("F5 acceptance #1 — a 40-newline paste is one atomic chip that submits its full payload", () => {
  it("mints `+40 lines`, hands `onSubmit` the whole body, and dies to a single backspace", async () => {
    expect(PASTE_BODY.split("\n").length - 1).toBe(40);          // 40 newlines — `kmt`'s unit, see the header
    expect(PASTE_BODY.length).toBeLessThan(800);                 // …so the NEWLINE arm decides, not `CMt`

    const sent: string[] = [];
    const { stdin, lastFrame } = mount({ onSubmit: (t) => { sent.push(typeof t === "string" ? t : t.submitText); }, project: "/tmp/ccx-f5-paste" });
    await settle();

    stdin.write(bracketed(PASTE_BODY));
    await waitFor(() => strip(frame(lastFrame)).includes(CHIP));
    // The buffer holds the LABEL and nothing else: the 41 lines never reach the screen at all.
    expect(strip(frame(lastFrame))).not.toContain("row-07");
    expect(strip(frame(lastFrame))).not.toContain(PASTE_LINES[40]!);

    stdin.write(ENTER);
    await waitFor(() => sent.length === 1);
    expect(sent[0]).toBe(PASTE_BODY);                            // the full content, not the label
    expect(strip(frame(lastFrame))).not.toContain("Pasted text");  // …and the composer is empty again

    // ONE backspace, the whole chip. A submit resets the counter (`fSe` drops the map with the buffer that
    // carried it), so the second paste is `#1` again — which is also why this clause runs after the submit.
    stdin.write(bracketed(PASTE_BODY));
    await waitFor(() => strip(frame(lastFrame)).includes(CHIP));
    stdin.write(BACKSPACE);
    await waitFor(() => !strip(frame(lastFrame)).includes("Pasted text"));
    expect(strip(frame(lastFrame))).not.toContain("[Pasted text #1 +40 line");   // no partial label survives
  });
});

// ── ACCEPTANCE #2 ─────────────────────────────────────────────────────────────────────────────────────
// "Prompt history survives quitting and relaunching ccx. The same prompt sent twice appears once,
//  newest-first. Editing a recalled prompt, arrowing away and arrowing back preserves the edit."
//
// "Relaunching" is modelled as what it is on this side: a composer mount that has never seen the first
// one's memory, reading `history.jsonl` off disk (`readHistory`, t6) through the seed at mount (t7). The
// first mount is unmounted before the second exists, so nothing in-process can carry the prompts across.
const HIST_PROJECT = "/tmp/ccx-f5-history";

describe("F5 acceptance #2 — prompt history outlives the process, dedups newest-first, and caches edits", () => {
  it("recalls a previous launch's prompts, once each, and keeps an edit across an arrow round trip", async () => {
    const first = mount({ project: HIST_PROJECT });
    await settle();
    for (const prompt of ["alpha prompt", "beta prompt", "alpha prompt"]) {
      for (const ch of prompt) first.stdin.write(ch);
      await waitFor(() => strip(frame(first.lastFrame)).includes(prompt));
      first.stdin.write(ENTER);
      await waitFor(() => !strip(frame(first.lastFrame)).includes(prompt));
    }
    // Three submits reached the file; the DEDUP lives in the reader, so the file may hold three lines and
    // the walk still has to show two. Both halves are asserted, so a dedup moved into the writer would not
    // pass silently.
    expect(readHistory({ scope: "project", project: HIST_PROJECT }).map((e) => e.display)).toEqual(["alpha prompt", "beta prompt"]);
    first.unmount();

    // ── the relaunch ──
    const { stdin, lastFrame } = mount({ project: HIST_PROJECT });
    await settle();
    expect(strip(frame(lastFrame))).not.toContain("alpha prompt");    // nothing recalled until asked

    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("alpha prompt"));
    expect(strip(frame(lastFrame))).toContain("History 2/2");         // NEWEST first, and only two entries
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("beta prompt"));
    expect(strip(frame(lastFrame))).toContain("History 1/2");         // the repeat did not take a third slot

    for (const ch of " edited") stdin.write(ch);
    await waitFor(() => strip(frame(lastFrame)).includes("beta prompt edited"));
    stdin.write(DOWN);                                                 // away…
    await waitFor(() => strip(frame(lastFrame)).includes("alpha prompt"));
    stdin.write(UP);                                                   // …and back
    await waitFor(() => strip(frame(lastFrame)).includes("beta prompt edited"));
  });
});

// ── ACCEPTANCE #3 ─────────────────────────────────────────────────────────────────────────────────────
// "Typing `/mod` shows dim ghost text completing it; Tab accepts without submitting; Enter accepts and
//  submits." — split across the two surfaces upstream splits it across; see the file header.
const GHOST_CAT: CommandEntry[] = [
  { name: "model", description: "switch model", source: "local" },
  { name: "review", description: "review a pull request", argumentHint: "[pr number]", source: "catalog" },
];

describe("F5 acceptance #3 — `/mod` completes to `/model`: ghost + Tab mid-text, popup + Enter at the head", () => {
  it("draws dim ghost text and accepts it on Tab without submitting; Enter on the head popup runs the command", async () => {
    // ── the ghost surface (mid-text) ──
    const sent: string[] = [];
    const ghost = mount({ onSubmit: (t) => { sent.push(typeof t === "string" ? t : t.submitText); }, commandCatalog: GHOST_CAT, project: "/tmp/ccx-f5-ghost" });
    await settle();
    ghost.stdin.write("see /mod");
    // The catalog reaches the open command state through an EFFECT, so the ghost is one render behind the
    // keystroke; waiting on the buffer alone would read the frame before the completion exists.
    await waitFor(() => strip(frame(ghost.lastFrame)).includes("see /model"));
    const drawn = frame(ghost.lastFrame);
    // CM36's own cursor rule (`renderBuffer`, t10): the ghost's first grapheme is INVERTED — that is the
    // caret — and the remainder is dim. `/mod` → `model`, so `e` inverted and `l` dim.
    expect(drawn).toContain("\x1b[7me\x1b[27m");
    expect(drawn).toContain("\x1b[2ml\x1b[22m");
    expect(strip(drawn)).toContain("see /model");
    expect(strip(drawn)).not.toContain("switch model");                // ghost, not a popup row

    ghost.stdin.write(TAB);
    await waitFor(() => strip(frame(ghost.lastFrame)).includes("see /model "));
    expect(sent).toEqual([]);                                          // Tab accepts, it never executes
    ghost.unmount();

    // ── the popup surface (head), where a LOCAL command is executable ──
    const head = mount({ onSubmit: (t) => { sent.push(typeof t === "string" ? t : t.submitText); }, commandCatalog: GHOST_CAT, project: "/tmp/ccx-f5-ghost" });
    await settle();
    head.stdin.write("/mod");
    await waitFor(() => strip(frame(head.lastFrame)).includes("switch model"));   // the popup, with its row
    head.stdin.write(ENTER);
    await waitFor(() => sent.length === 1);
    expect(sent[0]).toBe("/model");                                    // accepted AND executed, in one key
  });
});

// ── ACCEPTANCE #4 ─────────────────────────────────────────────────────────────────────────────────────
// "Accepting `@src/` in the file popup reopens the popup one level deeper instead of closing it."
//
// `O9f` (L490462) splices `"@" + id + "/"` with NO trailing space, which leaves the `@` trigger alive, and
// `Pe`'s directory arm (L490889–L490893) re-suggests instead of closing. The walk is injected so the
// criterion is about the descent rather than about whatever happens to be on the runner's disk.
const TREE: Record<string, DirEnt[]> = {
  "": [{ name: "src", isDir: true }, { name: "README.md", isDir: false }],
  src: [{ name: "app.ts", isDir: false }, { name: "util", isDir: true }],
  "src/util": [{ name: "fs.ts", isDir: false }],
};

describe("F5 acceptance #4 — accepting a directory descends instead of closing", () => {
  it("re-roots the walk at `src/` and shows its children, with the trigger still live", async () => {
    const roots: string[] = [];
    const readdir = async (d: string): Promise<DirEnt[]> => { roots.push(d); return TREE[d] ?? []; };
    const { stdin, lastFrame } = mount({ cwd: "", mentionReaddir: readdir, mentionWalkMs: 5, project: "/tmp/ccx-f5-mention" });
    await settle();

    stdin.write("@src");
    await waitFor(() => strip(frame(lastFrame)).includes("src/"));     // directories DISPLAY with the slash (`p_a`)
    stdin.write(TAB);
    await waitFor(() => strip(frame(lastFrame)).includes("@src/"));    // …and are spliced WITHOUT a trailing space
    // The popup did not close: a second walk fires with `src` as its OWN root. That second read is the
    // criterion — `app.ts` alone would not prove it, because the whole-tree walk already listed it and the
    // descent carries the previous level's files forward so the popup never blanks.
    await waitFor(() => roots.filter((d) => d === "src").length >= 2);
    await waitFor(() => strip(frame(lastFrame)).includes("app.ts"));
    await settle();
    expect(strip(frame(lastFrame))).not.toContain("README.md");        // the level above is gone from the list
  });
});

// ── ACCEPTANCE #5 ─────────────────────────────────────────────────────────────────────────────────────
// "The composer has a rule above and below and no side borders; `❯` dims while a turn runs; arrowing
//  history writes `── History 3/57 ──` into the top rule and hides it once the entry is edited."
const FRAME_PROJECT = "/tmp/ccx-f5-frame";
const RULE = "─".repeat(COLUMNS);

describe("F5 acceptance #5 — two rules, a dimming pointer, and a live history label in the top rule", () => {
  it("wears CM1's rules, CM2's busy dim and CM4's label, and drops the label on the first edit", async () => {
    for (const display of ["first prompt", "second prompt", "third prompt"]) appendHistory({ display, project: FRAME_PROJECT });

    const { stdin, lastFrame } = mount({ project: FRAME_PROJECT });
    await settle();
    const rows = () => strip(frame(lastFrame)).split("\n").filter((l) => l.length > 0);

    // CM1 — two full-width horizontal rules and NOT ONE vertical or corner character anywhere.
    expect(rows()[0]).toBe(RULE);
    expect(rows().filter((l) => l === RULE).length).toBe(2);
    for (const ch of ["│", "╭", "╮", "╰", "╯"]) expect(frame(lastFrame)).not.toContain(ch);

    // CM2 — `❯` + NBSP, undimmed while idle.
    expect(frame(lastFrame)).toContain(GLYPH);
    expect(frame(lastFrame)).not.toContain("\x1b[2m" + GLYPH);

    // CM4 — the label is spliced INTO the top rule (`$Bu`, three lead dashes) and the rule keeps its width.
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("third prompt"));
    const labelled = rows()[0]!;
    expect(labelled).toBe("─── History 3/3 " + "─".repeat(COLUMNS - 16));
    expect(labelled.length).toBe(COLUMNS);

    // …and it disappears the moment the recalled entry is edited (`AVf`'s own gate), leaving a bare rule.
    stdin.write("z");
    await waitFor(() => strip(frame(lastFrame)).includes("third promptz"));
    expect(rows()[0]).toBe(RULE);
    expect(strip(frame(lastFrame))).not.toContain("History 3/3");

    // CM2's other half needs a composer that believes a turn is running, which is a mount-time prop here.
    const busy = mount({ busy: true, project: FRAME_PROJECT });
    await settle();
    expect(frame(busy.lastFrame)).toContain("\x1b[2m" + GLYPH);
  });
});
