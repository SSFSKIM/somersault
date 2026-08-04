// test/tui/history-nav.test.tsx — F5 task 7: the persisted prompt history wired into the composer's Up/Down
// walk. Pins transcribed from the 2.1.220 bundle (`Z6f`, L489521-L489633, plus `AVf` L494870 and the
// `yDo`/`au_`/`ou_` hydration trio at L317525-L317546):
//  · L489529  a persisted entry → the buffer: `mP(display)` picks the mode and the `!` is stripped. OUR port
//             keeps the prefix, because our mode IS the prefix — the divergence is argued in editorHistory.ts
//             and pinned here by asserting the buffer, not just the mode.
//  · L489540  CM55's latch: `if (V === 0) T.current = re === "bash" ? re : void 0`
//  · L489547  the filter, by DISPLAY: `ce ? se.filter((ae) => mP(ae.display) === ce) : se`
//  · L489583  CM54's edit cache: `w.current.set(V - 1, { display, pastedContents, mode })`
//  · L489587  CM56: `te >= 2 && !se && !m.current` → the `search history` chord hint, once per mount
//  · L494870  CM4's label: `History ${Math.max(1, t - e + 1)}/${t}`
//  · L317398  `ou_`'s literal for a paste whose body is gone
//  · L495837  chat:stash parks `{ text, cursorOffset, pastedContents }` and L495833 restores all three
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "ink";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ChatComposer, HISTORY_SEARCH_HINT } from "../../src/tui/ChatComposer.js";
import { applyKey, initialEditorState, historyLabel, historyPosition, historyEdited, rebuildChips, type EditorState, type HistNavEntry } from "../../src/tui/editor.js";
import { appendHistory, readHistory, lostPasteLabel, PASTE_INLINE_MAX } from "../../src/tui/promptHistory.js";
import { pasteHash, pastePath } from "../../src/tui/pasteCache.js";
import { expandHintText } from "../../src/tui/keys/hints.js";
import { ingestPaste } from "../../src/tui/pasteChips.js";

// ————————————————————————— pure: the walk model —————————————————————————

const h = (display: string, pastedContents?: EditorState["pastedContents"]): HistNavEntry => ({ display, mode: display.startsWith("!") ? "bash" : "normal", pastedContents });
const text = (s: EditorState) => s.lines.join("\n");
const press = (s: EditorState, k: Record<string, boolean>) => applyKey(s, "", k).state;
const up = (s: EditorState) => press(s, { upArrow: true });
const down = (s: EditorState) => press(s, { downArrow: true });
const type = (s: EditorState, t: string) => [...t].reduce((st, ch) => applyKey(st, ch, {}).state, s);

describe("CM4 — the History n/total label (AVf, L494870)", () => {
  const three = initialEditorState([h("one"), h("two"), h("three")]);
  it("reads n/total from the NEWEST end down: first Up on 3 entries is History 3/3", () => {
    const one = up(three);
    expect(text(one)).toBe("three");
    expect(historyLabel(one)).toBe("History 3/3");
  });
  it("counts down to History 1/3 at the oldest entry", () => {
    const oldest = up(up(up(three)));
    expect(text(oldest)).toBe("one");
    expect(historyLabel(oldest)).toBe("History 1/3");
  });
  it("converts our oldest-first index into upstream's 1-based `e` before applying the formula", () => {
    expect(historyPosition(up(three))).toEqual({ index: 1, total: 3 });
    expect(historyPosition(up(up(three)))).toEqual({ index: 2, total: 3 });
    expect(historyPosition(three)).toBeNull();                       // e === 0: AVf returns nothing
  });
  it("disappears while the recalled entry is edited, and comes back with the cached edit", () => {
    const edited = type(up(three), "!");
    expect(historyEdited(edited)).toBe(true);
    expect(historyLabel(edited)).toBeUndefined();
    // Arrow away and back: `W` restores the cache and re-arms `H.current`, so it reads unedited again.
    const back = down(up(edited));
    expect(text(back)).toBe("three!");
    expect(historyEdited(back)).toBe(false);
    expect(historyLabel(back)).toBe("History 3/3");
  });
  it("paints nothing at all with no walk in progress", () => {
    expect(historyLabel(three)).toBeUndefined();
  });
});

describe("CM54 — the per-index edit cache carries the FULL triple", () => {
  it("an edited recall survives arrowing away and back, WITH its paste map", () => {
    // A history entry that carries a chip, so the restored edit has a payload to lose.
    const body = "a\nb\nc\nd";
    const entry = h("[Pasted text #1 +3 lines] review this", { 1: { id: 1, type: "text", content: body, lineCount: 3 } });
    let s = initialEditorState([h("older"), entry]);
    s = up(s);
    expect(text(s)).toBe("[Pasted text #1 +3 lines] review this");
    s = type(s, " please");                                          // edit the recalled entry
    expect(text(s)).toBe("[Pasted text #1 +3 lines] review this please");
    s = up(s);                                                       // away to the older entry
    expect(text(s)).toBe("older");
    s = down(s);                                                     // and back
    expect(text(s)).toBe("[Pasted text #1 +3 lines] review this please");
    // THE POINT: the map came back too, so the submit sends the payload and not the label.
    expect(applyKey(s, "", { return: true }).submit).toBe(`${body} review this please`);
  });
  it("the cache is dropped by a submit (a fresh state carries none)", () => {
    let s = initialEditorState([h("one"), h("two")]);
    s = type(up(s), "X");
    const after = applyKey(s, "", { return: true }).state;
    expect(after.histEdits.size).toBe(0);
    expect(after.histIndex).toBeNull();
    expect(text(up(after))).toBe("twoX");                            // it went into HISTORY, not into a cache
  });
  it("stores the edit on the way DOWN too (upstream's j, L489615)", () => {
    let s = initialEditorState([h("one"), h("two")]);
    s = up(up(s));                                                   // at "one"
    s = type(s, "!");
    s = down(s);                                                     // → "two", storing the edit of "one"
    expect(text(s)).toBe("two");
    s = up(s);
    expect(text(s)).toBe("one!");
  });
});

describe("pushHistory dedups the WHOLE list, newest-wins (t7 review, I1)", () => {
  it("a repeated NON-adjacent prompt moves to the newest slot instead of appearing twice", () => {
    const s = initialEditorState([h("ls"), h("pwd")]);
    const after = applyKey(type(s, "ls"), "", { return: true }).state;
    expect(after.history.map((e) => e.display)).toEqual(["pwd", "ls"]);
    // The walk and its labels see two entries, which is what a remount would rebuild from the file.
    const one = up(after);
    expect([text(one), historyLabel(one)]).toEqual(["ls", "History 2/2"]);
    const two = up(one);
    expect([text(two), historyLabel(two)]).toEqual(["pwd", "History 1/2"]);
    expect(text(up(two))).toBe("pwd");                               // clamped: there is no third entry
  });
  it("still collapses the adjacent repeat the old rule handled", () => {
    const s = applyKey(type(initialEditorState([h("ls")]), "ls"), "", { return: true }).state;
    expect(s.history.map((e) => e.display)).toEqual(["ls"]);
  });
  it("agrees with readHistory's own dedup, which is what a reseed replays", async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-dedup-"));
    const env = { ...process.env, CCX_FLEET_ROOT: root };
    try {
      for (const display of ["ls", "pwd", "ls"]) appendHistory({ display, project: PROJECT }, env);
      const onDisk = readHistory({ scope: "project", project: PROJECT }, env).map((e) => e.display).reverse();
      const inMemory = ["ls", "pwd", "ls"].reduce<HistNavEntry[]>((acc, display) => {
        const next = applyKey(type({ ...initialEditorState(acc) }, display), "", { return: true }).state;
        return next.history;
      }, []).map((e) => e.display);
      expect(inMemory).toEqual(onDisk);                              // ["pwd", "ls"] both ways
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("the reducer's import graph stays filesystem-free (t7 review, I2)", () => {
  // The reducer's header promises "No React/Ink/fs". Before this pass `editorHistory.ts` took one
  // `startsWith("!")` helper from `promptHistory.ts`, which reaches node:fs / node:crypto / node:os — so the
  // promise was false by one import. This walks the real closure rather than trusting the comment.
  const ROOT = new URL("../../src/tui/", import.meta.url);
  const closure = (entry: string): Set<string> => {
    const seen = new Set<string>(); const queue = [entry];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(new URL(file, ROOT), "utf8");
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^\n]*?from\s+"(\.\/[^"]+)"/gm)) {
        // `import type` / `export type` are erased at build time and cost no runtime graph.
        if (/^\s*(?:import|export)\s+type\b/.test(m[0])) continue;
        queue.push(m[1].replace(/^\.\//, "").replace(/\.js$/, ".ts"));
      }
    }
    return seen;
  };
  it("nothing reachable from editor.ts imports a node: builtin", () => {
    const files = [...closure("editor.ts")];
    expect(files).toContain("editorHistory.ts");
    expect(files).toContain("promptMode.ts");
    expect(files).not.toContain("promptHistory.ts");
    const offenders = files.filter((f) => {
      let src: string;
      try { src = readFileSync(new URL(f, ROOT), "utf8"); } catch { return false; }
      return /from\s+"node:/.test(src);
    });
    expect(offenders).toEqual([]);
  });
  it("promptMode.ts is a true leaf — no imports at all", () => {
    const src = readFileSync(new URL("promptMode.ts", ROOT), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});

describe("the caret a recall lands on (M's fourth argument, L489525)", () => {
  const two = initialEditorState([h("first"), h("second")]);
  it("an UP recall lands at the END of the text", () => {
    const s = up(two);
    expect(s.cursor).toEqual({ row: 0, col: "second".length });
  });
  it("a DOWN recall lands at offset 0", () => {
    const s = down(up(up(two)));
    expect(text(s)).toBe("second");
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });
  it("the restored draft lands at offset 0 too (`M(p.display, …, \"start\")`, L489621)", () => {
    const s = down(up(type(initialEditorState([h("older")]), "my draft")));
    expect(text(s)).toBe("my draft");
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });
  it("which is what keeps the vertical keys usable inside a MULTI-LINE recalled entry", () => {
    const s = up(initialEditorState([h("alpha\nbeta\ngamma")]));
    expect(s.cursor.row).toBe(2);                                    // arrived from below: on the last row
    expect(up(s).cursor.row).toBe(1);                                // so another Up walks the TEXT first
    expect(up(s).histIndex).toBe(0);                                 // …not the history
  });
});

describe("CM55 — the bash latch (L489540, filtered at L489547)", () => {
  const mixed = [h("plain one"), h("!git status"), h("plain two"), h("!ls -a")];
  it("entering navigation from bash mode filters the walk to bash entries only", () => {
    let s = type(initialEditorState(mixed), "!");                    // `!` alone puts the composer in bash mode
    s = up(s);
    expect(text(s)).toBe("!ls -a");
    expect(s.histMode).toBe("bash");
    expect(historyLabel(s)).toBe("History 2/2");                     // two bash entries, not four
    s = up(s);
    expect(text(s)).toBe("!git status");
    s = up(s);
    expect(text(s)).toBe("!git status");                             // clamped: the plain entries are invisible
  });
  it("entering otherwise is unfiltered", () => {
    const s = up(initialEditorState(mixed));
    expect(s.histMode).toBeUndefined();
    expect(text(s)).toBe("!ls -a");
    expect(historyLabel(s)).toBe("History 4/4");
    expect(text(up(s))).toBe("plain two");
  });
  it("a bash entry comes back WITH its `!`, which is what puts the composer back in bash mode", () => {
    // Upstream strips the prefix and sets its separate `mode` state (L489529); ours derives the mode FROM the
    // prefix, so keeping it is how the same observable state is reached. See editorHistory.ts divergence 1.
    const s = up(initialEditorState([h("!git status")]));
    expect(s.lines).toEqual(["!git status"]);
  });
  it("a latch CHANGE clears the edit cache (L489543)", () => {
    let s = initialEditorState(mixed);
    s = type(up(s), " edited");                                      // unfiltered walk, edit at view index 3
    expect(s.histEdits.size).toBe(0);                                // not stored until the next step
    s = up(s);                                                       // store it, move on
    expect(s.histEdits.size).toBe(1);
    s = down(down(s));                                               // back off the end → draft ("")
    expect(s.histIndex).toBeNull();
    s = up(type(s, "!"));                                            // re-enter from bash: latch flips
    expect(s.histMode).toBe("bash");
    expect(s.histEdits.size).toBe(0);
  });
});

describe("fresh chip ids on recall — the collision a shared counter would cause", () => {
  it("re-mints a recalled entry's chips above the live pasteCounter and relabels the buffer", () => {
    const entry = h("[Pasted text #1 +1 lines]", { 1: { id: 1, type: "text", content: "p\nq", lineCount: 1 } });
    let s = initialEditorState([entry]);
    s = ingestPaste(s, "draft\npaste\nof\nmine", 24);                // the live draft mints #1
    expect(text(s)).toBe("[Pasted text #1 +3 lines]");
    s = up(s);
    expect(text(s)).toBe("[Pasted text #2 +1 lines]");               // the recall took #2, not #1
    expect(s.pasteCounter).toBe(2);
    expect(applyKey(s, "", { return: true }).submit).toBe("p\nq");
  });
  it("a paste made AFTER a recall cannot collide with the recalled chip", () => {
    const entry = h("[Pasted text #1 +1 lines]", { 1: { id: 1, type: "text", content: "history body", lineCount: 1 } });
    let s = up(initialEditorState([entry]));
    expect(text(s)).toBe("[Pasted text #1 +1 lines]");               // no live chips yet, so #1 is free
    expect(s.pasteCounter).toBe(1);                                  // …but the counter DID advance
    s = ingestPaste(s, "fresh\npaste\nbody\nhere", 24);
    expect(text(s)).toBe("[Pasted text #1 +1 lines][Pasted text #2 +3 lines]");
    expect(applyKey(s, "", { return: true }).submit).toBe("history bodyfresh\npaste\nbody\nhere");
  });
  it("rebuildChips leaves a label with no entry exactly as it found it", () => {
    const out = rebuildChips(h("[Pasted text #4] and [Pasted text #5]", { 5: { id: 5, type: "text", content: "five", lineCount: 0 } }), 0);
    expect(out.display).toBe("[Pasted text #4] and [Pasted text #1]");
    expect(out.pasteCounter).toBe(1);
  });
});

describe("CM-stash — Ctrl-S parks the whole record (L495837/L495833)", () => {
  it("round-trips the paste map and the cursor, so the submit still sends the payload", () => {
    let s = ingestPaste(initialEditorState(), "one\ntwo\nthree\nfour", 24);
    s = type(s, " tail");
    s = applyKey(s, "", { leftArrow: true }).state;                  // cursor two cells from the end
    s = applyKey(s, "", { leftArrow: true }).state;
    const parkedCursor = { ...s.cursor };
    s = applyKey(s, "s", { ctrl: true }).state;                      // park
    expect(s.lines).toEqual([""]);
    expect(s.pastedContents).toEqual({});                            // upstream's `x({})`
    s = applyKey(s, "s", { ctrl: true }).state;                      // restore
    expect(text(s)).toBe("[Pasted text #1 +3 lines] tail");
    expect(s.cursor).toEqual(parkedCursor);
    expect(applyKey(s, "", { return: true }).submit).toBe("one\ntwo\nthree\nfour tail");
  });
});

// ————————————————————————— the composer: disk seeding, persistence, hints —————————————————————————

const frame = (f: () => string | undefined) => f() ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const settle = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (p: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (p()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("waitFor timed out");
};
const UP = "\x1b[A", DOWN = "\x1b[B", ESC = "\x1b";
const PROJECT = "/tmp/ccx-history-nav-project";

describe("<ChatComposer> — the persisted history it seeds from and appends to", () => {
  let root = "";
  let env: NodeJS.ProcessEnv;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-hnav-")); env = { ...process.env, CCX_FLEET_ROOT: root }; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const seed = (...displays: string[]) => { for (const display of displays) appendHistory({ display, project: PROJECT }, env); };
  const mount = (over: Partial<React.ComponentProps<typeof ChatComposer>> = {}, deps?: Parameters<typeof renderWithKeymap>[1]) =>
    renderWithKeymap(
      <ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} {...over} />,
      deps,
    );

  it("seeds from readHistory({scope:'project'}) at mount and recalls the NEWEST entry first", async () => {
    seed("first prompt", "second prompt", "third prompt");
    const { stdin, lastFrame } = mount();
    await settle();
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("third prompt"));
    expect(strip(frame(lastFrame))).toContain("History 3/3");
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("second prompt"));
    expect(strip(frame(lastFrame))).toContain("History 2/3");
  });

  it("scopes the seed to the SESSION's project, not to process.cwd()", async () => {
    appendHistory({ display: "mine", project: PROJECT }, env);
    appendHistory({ display: "someone else's", project: "/tmp/other-project" }, env);
    const { stdin, lastFrame } = mount();
    await settle();
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("mine"));
    expect(strip(frame(lastFrame))).toContain("History 1/1");
    expect(strip(frame(lastFrame))).not.toContain("someone else");
  });

  it("appends a submitted prompt to memory AND to disk, and the walk sees it immediately", async () => {
    const sent: string[] = [];
    const { stdin, lastFrame } = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    for (const ch of "hello there") stdin.write(ch);
    await waitFor(() => strip(frame(lastFrame)).includes("hello there"));
    stdin.write("\r");
    await waitFor(() => sent.length === 1);
    expect(readHistory({ scope: "project", project: PROJECT }, env).map((e) => e.display)).toEqual(["hello there"]);
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("History 1/1"));
  });

  it("Esc-Esc persists the cleared draft too (upstream `cgr(e)` at L395632 — text only, no pastes)", async () => {
    const { stdin, lastFrame } = mount();
    await settle();
    for (const ch of "abandoned draft") stdin.write(ch);
    await waitFor(() => strip(frame(lastFrame)).includes("abandoned draft"));
    stdin.write(ESC); stdin.write(ESC);
    await waitFor(() => !strip(frame(lastFrame)).includes("abandoned draft"));
    expect(readHistory({ scope: "project", project: PROJECT }, env).map((e) => e.display)).toEqual(["abandoned draft"]);
  });

  it("a REMOUNT does not re-seed over the in-session appends (the durable historySeeded flag)", async () => {
    seed("on disk");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame, rerender } = mount({ editorStateRef });
    await settle();
    for (const ch of "typed now") stdin.write(ch);
    await waitFor(() => strip(frame(lastFrame)).includes("typed now"));
    stdin.write("\r");
    await waitFor(() => editorStateRef.current.history.length === 2);
    // Another ccx writes the shared file while this composer is alive. A re-seed would pick it up; the flag
    // means the list this session walks is the one it built, and only a fresh app ever reads the file again.
    appendHistory({ display: "from another process", project: PROJECT }, env);
    // Something else takes the screen and hands it back. The intermediate render is load-bearing: React
    // reconciles a same-type element in the same slot instead of remounting it, so re-rendering the composer
    // straight over itself would never re-run the `useState` initializer this test is about.
    rerender(<Text>a dialog owns the screen</Text>);
    await settle();
    rerender(<ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} editorStateRef={editorStateRef} />);
    await settle();
    expect(editorStateRef.current.history.map((e) => e.display)).toEqual(["on disk", "typed now"]);
    expect(editorStateRef.current.historySeeded).toBe(true);
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("History 2/2"));
    expect(strip(frame(lastFrame))).toContain("typed now");
  });

  it("a remount cannot clobber an in-session append that never reached disk", async () => {
    // `CLAUDE_CODE_SKIP_PROMPT_HISTORY` suppresses the WRITE, not the walk: the prompt still enters the
    // in-memory list, so the only thing standing between it and a remount is the seed gate.
    const quiet = { ...env, CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1" };
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const { stdin, lastFrame, rerender } = mount({ editorStateRef, historyEnv: quiet });
    await settle();
    for (const ch of "unpersisted") stdin.write(ch);
    await waitFor(() => strip(frame(lastFrame)).includes("unpersisted"));
    stdin.write("\r");
    await waitFor(() => editorStateRef.current.history.length === 1);
    expect(readHistory({ scope: "project", project: PROJECT }, quiet)).toEqual([]);   // nothing on disk
    rerender(<Text>a dialog owns the screen</Text>);
    await settle();
    rerender(<ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={quiet} commandCatalog={[]} columns={() => 72} rows={() => 24} editorStateRef={editorStateRef} />);
    await settle();
    expect(editorStateRef.current.history.map((e) => e.display)).toEqual(["unpersisted"]);
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("History 1/1"));
  });

  it("CM56: the SECOND Up raises the derived `search history` chord hint, once per mount", async () => {
    seed("a one", "b two", "c three");
    const { stdin, lastFrame } = mount({ searchHintMs: 60_000 });
    await settle();
    const expected = expandHintText(["ctrl+r"], process.platform, HISTORY_SEARCH_HINT);
    expect(expected).toBe("(ctrl+r to search history)");
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes("History 3/3"));
    expect(strip(frame(lastFrame))).not.toContain(HISTORY_SEARCH_HINT);   // not on the first Up
    stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes(expected));
    expect(frame(lastFrame)).toContain("\x1b[2m" + expected);             // dim, upstream's own paint
  });

  it("CM56's chord is DERIVED — a rebind moves it and never prints a literal ctrl+r", async () => {
    seed("a one", "b two");
    const { stdin, lastFrame } = mount({ searchHintMs: 60_000 }, {
      userLayers: [{ context: "Global", bindings: { "ctrl+r": null, "alt+h": "history:search" } }],
    });
    await settle();
    stdin.write(UP); stdin.write(UP);
    const expected = expandHintText(["alt+h"], process.platform, HISTORY_SEARCH_HINT);
    await waitFor(() => strip(frame(lastFrame)).includes(expected));
    expect(strip(frame(lastFrame))).not.toContain("ctrl+r");
  });

  it("M1: a prompt carries the SAME mode in-session as it does after a reseed", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const first = mount({ editorStateRef });
    await settle();
    for (const ch of "#remember this") first.stdin.write(ch);
    await waitFor(() => strip(frame(first.lastFrame)).includes("#remember this"));
    first.stdin.write("\r");
    await waitFor(() => editorStateRef.current.history.length === 1);
    expect(editorStateRef.current.history[0].mode).toBe("memory");
    first.unmount();
    // A brand-new app: fresh durable ref, so this one really does seed off the file.
    const reseeded = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    mount({ editorStateRef: reseeded });
    await settle();
    expect(reseeded.current.history.map((e) => [e.display, e.mode])).toEqual([["#remember this", "memory"]]);
  });

  it("M2: CM56's once-only guard survives a remount (the dialog cycle must not re-arm it)", async () => {
    seed("a one", "b two", "c three");
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const searchHintFiredRef = { current: false } as React.MutableRefObject<boolean>;
    const { stdin, lastFrame, rerender } = mount({ editorStateRef, searchHintFiredRef, searchHintMs: 60_000 });
    await settle();
    stdin.write(UP); stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes(HISTORY_SEARCH_HINT));
    expect(searchHintFiredRef.current).toBe(true);
    // A permission prompt takes the screen and hands it back — a genuinely new component instance.
    rerender(<Text>a dialog owns the screen</Text>);
    await settle();
    rerender(<ChatComposer onSubmit={() => {}} cwd={PROJECT} project={PROJECT} historyEnv={env} commandCatalog={[]} columns={() => 72} rows={() => 24} editorStateRef={editorStateRef} searchHintFiredRef={searchHintFiredRef} searchHintMs={60_000} />);
    await settle();
    expect(strip(frame(lastFrame))).not.toContain(HISTORY_SEARCH_HINT);   // the remount did not re-show it
    stdin.write(DOWN); stdin.write(DOWN);                                 // back to the draft
    await settle();
    stdin.write(UP); stdin.write(UP);                                     // and a whole fresh run through 2
    await waitFor(() => strip(frame(lastFrame)).includes("History 2/3"));
    expect(strip(frame(lastFrame))).not.toContain(HISTORY_SEARCH_HINT);
  });

  it("CM56 expires on its own window and does not fire twice in one mount", async () => {
    seed("a one", "b two", "c three");
    const { stdin, lastFrame } = mount({ searchHintMs: 120 });
    await settle();
    stdin.write(UP); stdin.write(UP);
    await waitFor(() => strip(frame(lastFrame)).includes(HISTORY_SEARCH_HINT));
    await waitFor(() => !strip(frame(lastFrame)).includes(HISTORY_SEARCH_HINT));
    stdin.write(DOWN); stdin.write(UP); stdin.write(UP);                  // a second run through position 2
    await settle();
    expect(strip(frame(lastFrame))).not.toContain(HISTORY_SEARCH_HINT);
  });

  it("CM57: a recalled chip whose body is still cached comes back expandable", async () => {
    const body = "z".repeat(PASTE_INLINE_MAX + 1);                        // over `nu_`, so it goes to the cache
    const sent: string[] = [];
    const first = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    first.stdin.write("\x1b[200~" + body + "\x1b[201~");
    await waitFor(() => strip(frame(first.lastFrame)).includes("[Pasted text #1]"));
    first.stdin.write("\r");
    await waitFor(() => sent.length === 1);
    first.unmount();
    // A NEW composer (a new process, as far as the cache is concerned) recalls it.
    const second = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    second.stdin.write(UP);
    await waitFor(() => strip(frame(second.lastFrame)).includes("[Pasted text #1]"));
    second.stdin.write("\r");
    await waitFor(() => sent.length === 2);
    expect(sent[1]).toBe(body);
  });

  it("CM57: a recalled chip whose body is GONE is rewritten to ou_'s literal (L317398)", async () => {
    const body = "y".repeat(PASTE_INLINE_MAX + 1);
    const sent: string[] = [];
    const first = mount({ onSubmit: (t) => sent.push(t) });
    await settle();
    first.stdin.write("\x1b[200~" + body + "\x1b[201~");
    await waitFor(() => strip(frame(first.lastFrame)).includes("[Pasted text #1]"));
    first.stdin.write("\r");
    await waitFor(() => sent.length === 1);
    first.unmount();
    rmSync(pastePath(pasteHash(body), env), { force: true });             // the cache was purged under us
    const second = mount();
    await settle();
    second.stdin.write(UP);
    await waitFor(() => strip(frame(second.lastFrame)).includes("content no longer available"));
    expect(strip(frame(second.lastFrame))).toContain(lostPasteLabel(1));
    expect(lostPasteLabel(1)).toBe("[Pasted text #1 — content no longer available]");
  });
});
