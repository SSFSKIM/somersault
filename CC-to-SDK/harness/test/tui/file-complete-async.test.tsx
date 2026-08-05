// tui/test/file-complete-async.test.tsx — F5 Task 11: the @-mention walk goes ASYNC (debounced, generation-
// guarded) and directories become ITERATIVE completions.
//
// Bundle anchors this file pins:
//  · CM39, `Ae = Dee(Re, 50)` (L490598). `Dee` (L182690) is a TRAILING-ONLY debounce — every call clears the
//    pending timer and reschedules, so there is no leading edge and the first scheduled walk waits the full
//    window too. Our React effect + `clearTimeout` cleanup IS that shape.
//  · The staleness guard: upstream re-checks `oe.current !== mt` after every await inside `Re` (L490566/L490574)
//    and drops the resolution. Ours is a generation counter, which subsumes it (see the report).
//  · CM40, the descent. `O9f` (L490462) splices `"@" + id + (isDir ? "/" : " ")` — a directory gets a trailing
//    SLASH and NO trailing space, which leaves the `@` trigger live; `Pe`'s directory arm (L490889–L490893)
//    then re-suggests (`Be(fr, cursorPos)`) instead of closing (`he()`).
//  · Directories DISPLAY with the trailing slash: `p_a` (L432324) emits `displayText: type === "directory" ?
//    p + "/" : p`, and the bare-`@` cwd listing `_l_` (L314127) emits `i + path.sep` for a directory.
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { collectEntries, collectFiles, mentionWalkRoot, rankCandidates, type DirEnt } from "../../src/tui/fileComplete.js";
import { applyKey, initialEditorState, setMentionFiles, type EditorState, type KeyFlags } from "../../src/tui/editor.js";
import { mentionInsertion } from "../../src/tui/completionTriggers.js";

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const frame = (f: () => string | undefined) => (f() ?? "").replace(/ /g, " ");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

// The one fake tree every leg here shares. Keyed by the dir path the walk feeds `readdir`; the root is "".
const TREE: Record<string, DirEnt[]> = {
  "": [{ name: "src", isDir: true }, { name: "node_modules", isDir: true }, { name: ".git", isDir: true }, { name: "README.md", isDir: false }],
  src: [{ name: "app.ts", isDir: false }, { name: "util", isDir: true }, { name: ".hidden", isDir: false }],
  "src/util": [{ name: "fs.ts", isDir: false }, { name: "deep", isDir: true }],
  "src/util/deep": [{ name: "leaf.ts", isDir: false }],
  node_modules: [{ name: "pkg.js", isDir: false }],
};

describe("collectEntries — the async walk that lists directories too", () => {
  it("emits directories WITH a trailing slash and files without, skipping node_modules/.git/dotfiles", async () => {
    const entries = await collectEntries("", async (d) => TREE[d] ?? []);
    expect(entries.map((e) => e.path).sort()).toEqual([
      "README.md", "src/", "src/app.ts", "src/util/", "src/util/deep/", "src/util/deep/leaf.ts", "src/util/fs.ts",
    ]);
    expect(entries.filter((e) => e.isDir).map((e) => e.path).sort()).toEqual(["src/", "src/util/", "src/util/deep/"]);
    // The invariant the composer's dir-accept keys off: isDir IS the trailing slash.
    for (const e of entries) expect(e.isDir).toBe(e.path.endsWith("/"));
  });

  it("a directory is emitted BEFORE its contents, so a level reads top-down", async () => {
    const paths = (await collectEntries("", async (d) => TREE[d] ?? [])).map((e) => e.path);
    expect(paths.indexOf("src/")).toBeLessThan(paths.indexOf("src/app.ts"));
    expect(paths.indexOf("src/util/")).toBeLessThan(paths.indexOf("src/util/fs.ts"));
  });

  it("`root` re-roots the walk: only that subtree is read, and the emitted paths stay cwd-relative", async () => {
    const read: string[] = [];
    const entries = await collectEntries("", async (d) => { read.push(d); return TREE[d] ?? []; }, { root: "src/util/" });
    expect(entries.map((e) => e.path).sort()).toEqual(["src/util/deep/", "src/util/deep/leaf.ts", "src/util/fs.ts"]);
    expect(read).toEqual(["src/util", "src/util/deep"]);          // the cwd root was never read
  });

  it("honours the cap and survives a rejecting readdir", async () => {
    expect((await collectEntries("", async (d) => TREE[d] ?? [], { cap: 2 })).length).toBe(2);
    expect(await collectEntries("", async () => { throw new Error("ENOENT"); })).toEqual([]);
    expect(await collectEntries("", async (d) => TREE[d] ?? [], { root: "nope/" })).toEqual([]);
  });

  it("collectFiles (the sync walk) is unchanged and still files-only", () => {
    const sync = collectFiles("", (d) => TREE[d] ?? []);
    expect(sync.sort()).toEqual(["README.md", "src/app.ts", "src/util/deep/leaf.ts", "src/util/fs.ts"]);
  });
});

describe("mentionWalkRoot — which directory the walk starts from", () => {
  it("is the query's directory part", () => {
    expect(mentionWalkRoot("")).toBe("");
    expect(mentionWalkRoot("src")).toBe("");
    expect(mentionWalkRoot("src/")).toBe("src/");
    expect(mentionWalkRoot("src/ut")).toBe("src/");
    expect(mentionWalkRoot("src/util/")).toBe("src/util/");
    expect(mentionWalkRoot("src/util/f")).toBe("src/util/");
  });
  it("declines anything that is not a plain relative path — those fall back to the whole-tree walk", () => {
    expect(mentionWalkRoot("/etc/pass")).toBe("");
    expect(mentionWalkRoot("~/notes/x")).toBe("");
    expect(mentionWalkRoot("../sibling/x")).toBe("");
    expect(mentionWalkRoot("./src/x")).toBe("");
  });
});

describe("ranking treats a directory like any other candidate", () => {
  it("scores `src/` for the query `src`", () => {
    const items = rankCandidates(["src/", "src/app.ts", "README.md"], "src");
    expect(items.map((c) => c.path)).toContain("src/");
    expect(items[0].path).toBe("src/");                            // shortest match wins the length tiebreak
  });
});

// ── the reducer half: accepting a directory descends, accepting a file closes ───────────────────────────
const type = (s: EditorState, t: string): EditorState => [...t].reduce((a, ch) => applyKey(a, ch, {}).state, s);
const press = (s: EditorState, key: KeyFlags): EditorState => applyKey(s, "", key).state;
const open = (files: string[], q = ""): EditorState => setMentionFiles(type(initialEditorState(), "@" + q), files);

describe("CM40 — accepting a directory reopens the mention one level deeper", () => {
  it("splices `@src/` with NO trailing space and leaves the popup open at the new base", () => {
    const s = press(open(["src/", "src/app.ts"], "src"), { tab: true });
    expect(s.lines[0]).toBe("@src/");
    expect(s.mention).not.toBeNull();
    expect(s.mention!.query).toBe("src/");
    expect(s.cursor.col).toBe("@src/".length);
  });
  it("carries the previous level's files forward so the popup never blanks mid-descent", () => {
    const s = press(open(["src/", "src/app.ts", "README.md"], "src"), { tab: true });
    expect(s.mention!.files).toEqual(["src/", "src/app.ts", "README.md"]);
    expect(s.mention!.items.map((c) => c.path)).toContain("src/app.ts");
  });
  it("Enter behaves EXACTLY like Tab on a directory — it descends, it never submits", () => {
    const r = applyKey(open(["src/", "src/app.ts"], "src"), "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(r.state.lines[0]).toBe("@src/");
    expect(r.state.mention).not.toBeNull();
  });
  it("two accepts in a row walk two levels down", () => {
    let s = press(open(["src/", "src/util/", "src/util/fs.ts"], "src"), { tab: true });   // → @src/
    s = setMentionFiles(s, ["src/util/", "src/util/fs.ts"]);
    s = press(s, { tab: true });                                                          // → @src/util/
    expect(s.lines[0]).toBe("@src/util/");
    expect(s.mention!.query).toBe("src/util/");
  });
  it("a FILE still accepts-and-closes with the trailing space", () => {
    const s = press(open(["src/app.ts"], "app"), { tab: true });
    expect(s.lines[0]).toBe("@src/app.ts ");
    expect(s.mention).toBeNull();
  });
  it("a quoted directory keeps the quotes and still descends", () => {
    const s = press(open(["my docs/"], "\"my"), { tab: true });
    expect(s.lines[0]).toBe("@\"my docs/\"");
    expect(s.mention).not.toBeNull();
    expect(s.mention!.query).toBe("my docs/");
  });
  it("mentionInsertion's `complete` flag is oQa's `isComplete` — the directory arm drops the space", () => {
    expect(mentionInsertion("src/a.ts")).toBe("@src/a.ts ");
    expect(mentionInsertion("src/", false, false)).toBe("@src/");
    expect(mentionInsertion("my docs/", false, false)).toBe("@\"my docs/\"");
  });
});

// ── the composer half: debounce + generation guard ─────────────────────────────────────────────────────
/** A readdir whose every call is parked until the test resolves it, so a stale walk can be made to land
 *  AFTER a newer one on purpose. `calls` records the directory each pending read is for. */
function deferredReaddir() {
  const pending: { dir: string; resolve: (e: DirEnt[]) => void }[] = [];
  const readdir = (dir: string): Promise<DirEnt[]> => new Promise((resolve) => { pending.push({ dir, resolve }); });
  return {
    readdir, pending,
    /** Settle every parked read from `tree`, then keep pumping: the walk RECURSES, so each round of
     *  resolutions parks the next one, and a `while (pending.length)` loop would exit on the gap between a
     *  resolve and the continuation that queues the next read. Fixed rounds, each after a real tick. */
    async drain(tree: Record<string, DirEnt[]>) {
      for (let i = 0; i < 30; i++) {
        await tick(0);
        const batch = pending.splice(0, pending.length);
        for (const p of batch) p.resolve(tree[p.dir] ?? []);
      }
    },
  };
}

describe("CM39 — the walk is debounced and generation-guarded", () => {
  it("rapid descent schedules ONE walk per window, not one per root change", async () => {
    const dirs: string[] = [];
    const readdir = async (d: string): Promise<DirEnt[]> => { dirs.push(d); return TREE[d] ?? []; };
    const { stdin, lastFrame } = render(
      <ChatComposer onSubmit={() => {}} cwd="" commandCatalog={[]} mentionReaddir={readdir} mentionWalkMs={150} />,
    );
    await tick(20);
    stdin.write("@src"); await tick(5);                            // root ""
    stdin.write("/ut"); await tick(5);                             // root "src/"
    stdin.write("il/"); await tick(5);                             // root "src/util/" — all three inside one window
    expect(dirs).toEqual([]);                                      // trailing-only (Dee): nothing has fired yet
    await waitFor(() => frame(lastFrame).includes("leaf.ts"), 3000);
    expect(dirs).not.toContain("");                                // the cwd-wide walk was CANCELLED, never run
    expect(dirs).not.toContain("src");                             // …and so was the src-level one
    expect(dirs).toEqual(["src/util", "src/util/deep"]);           // exactly the one surviving walk
  });

  it("a slow walk that resolves after a newer one landed is DISCARDED", async () => {
    // `srcx/STALEMARK.ts` exists ONLY in the cwd-wide (gen 1) listing, and it still fuzzy-matches the deeper
    // query `src/` — so it is visible evidence of a stale resolution rather than of a query that stopped
    // matching. Asserting on a path gen 2 merely happens not to contain would pass with no guard at all.
    const STALE: Record<string, DirEnt[]> = {
      "": [{ name: "srcx", isDir: true }, { name: "src", isDir: true }],
      srcx: [{ name: "STALEMARK.ts", isDir: false }],
      src: TREE.src, "src/util": TREE["src/util"], "src/util/deep": TREE["src/util/deep"],
    };
    const slow = deferredReaddir();
    const { stdin, lastFrame } = render(
      <ChatComposer onSubmit={() => {}} cwd="" commandCatalog={[]} mentionReaddir={slow.readdir} mentionWalkMs={5} />,
    );
    await tick(20);
    stdin.write("@");                                              // gen 1: root "" — parks on readdir("")
    await waitFor(() => slow.pending.length > 0);
    expect(slow.pending[0].dir).toBe("");
    stdin.write("src/");                                           // gen 2: root "src/"
    await waitFor(() => slow.pending.length > 1);
    // Settle gen 2 FIRST, then gen 1's stale read. The stale one must not repaint the list.
    const stale = slow.pending.shift()!;
    await slow.drain(STALE);                                       // resolves everything still parked (gen 2)
    await waitFor(() => frame(lastFrame).includes("fs.ts"));
    expect(frame(lastFrame)).not.toContain("STALEMARK");
    stale.resolve(STALE[""]);                                      // gen 1 lands late with the cwd listing
    await slow.drain(STALE);
    await tick(30);
    expect(frame(lastFrame)).toContain("fs.ts");
    expect(frame(lastFrame)).not.toContain("STALEMARK");           // gen 1's result never reached the popup
  });

  it("draws NO popup and NO loading row while the first walk is in flight", async () => {
    const slow = deferredReaddir();
    const { stdin, lastFrame } = render(
      <ChatComposer onSubmit={() => {}} cwd="" commandCatalog={[]} mentionReaddir={slow.readdir} mentionWalkMs={5} />,
    );
    await tick(20);
    stdin.write("@");
    await waitFor(() => slow.pending.length > 0);
    await tick(20);
    const f = frame(lastFrame);
    expect(f).toContain("@");
    expect(f).not.toMatch(/Loading/i);                             // controller note 1: no such row exists here
    expect(f).not.toContain("README.md");
    await slow.drain(TREE);
    await waitFor(() => frame(lastFrame).includes("README.md"));   // …and it appears when the walk lands
  });

  it("`@src` lists `src/`, and accepting it reopens the popup on src's children", async () => {
    const dirs: string[] = [];
    const readdir = async (d: string): Promise<DirEnt[]> => { dirs.push(d); return TREE[d] ?? []; };
    const { stdin, lastFrame } = render(
      <ChatComposer onSubmit={() => {}} cwd="" commandCatalog={[]} mentionReaddir={readdir} mentionWalkMs={5} />,
    );
    await tick(20);
    stdin.write("@src");
    await waitFor(() => frame(lastFrame).includes("src/"));
    expect(frame(lastFrame)).toContain("src/");
    stdin.write("\t");                                             // accept the directory
    await waitFor(() => frame(lastFrame).includes("@src/"));
    // The deeper walk fired: `src` is read a SECOND time, this time as the walk's own root.
    await waitFor(() => dirs.filter((d) => d === "src").length >= 2);
    await waitFor(() => frame(lastFrame).includes("app.ts"));
  });
});
