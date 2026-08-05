// tui/src/fileComplete.ts — pure @-mention file completion: recursive walk (basic ignores, capped) + fuzzy
// ranker. The walk takes an injected readdir so it's testable with a fake tree (no disk). Paths are
// repo-relative POSIX. Used by editor.ts (rankCandidates) and ChatComposer.tsx (collectEntries).
//
// NO `node:` import, ever: `completions.ts` imports `rankCandidates` from here, so this module sits inside the
// editor reducer's closure and test/tui/history-nav.test.tsx walks that closure and fails on any builtin. That
// is why `join` below is three characters of string concatenation rather than `path.join`, and why the walk
// takes its readdir as an argument instead of reaching for one.
import type { Candidate } from "./editor.js";

export interface DirEnt { name: string; isDir: boolean }
export type ReaddirFn = (dir: string) => DirEnt[];
/** F5 t11: the async sibling. Upstream's whole @-completion path is async (`Re`/`eQa`/`p_a` are all
 *  `async` and every caller awaits them), and the composer's walk is now too. */
export type AsyncReaddirFn = (dir: string) => Promise<DirEnt[]>;
/** `root` is a cwd-RELATIVE directory prefix, `""` or ending in `/` (see `mentionWalkRoot`). The walk starts
 *  there and still emits cwd-relative paths, so a re-rooted walk's output is interchangeable with a whole-tree
 *  one — the ranker, the popup rows and `mentionInsertion` never learn that the root moved. */
export interface WalkOpts { cap?: number; root?: string }
/** One walked entry. `isDir` is redundant with the path by construction — a directory's emitted path ALWAYS
 *  carries the trailing slash — and is kept anyway because the two readers want different halves: the composer
 *  maps to `path` and `acceptMention` asks `endsWith("/")`. Documented invariant: `isDir === path.endsWith("/")`.
 *
 *  The trailing slash is upstream's, not ours: `p_a` (bundle L432324) returns
 *  `displayText: type === "directory" ? p + "/" : p`, and the bare-`@` cwd listing `_l_` (L314127) emits
 *  `i + path.sep` for a directory. */
export interface Entry { path: string; isDir: boolean }

const IGNORE = new Set(["node_modules", ".git"]);
const skipDir = (name: string) => IGNORE.has(name) || name.startsWith(".");
const join = (a: string, b: string) => (a ? a + "/" + b : b);

export function collectFiles(cwd: string, readdir: ReaddirFn, opts: WalkOpts = {}): string[] {
  const cap = opts.cap ?? 1000; const out: string[] = [];
  const walk = (dir: string, rel: string): void => {            // dir = real path fed to readdir; rel = path emitted
    if (out.length >= cap) return;
    let ents: DirEnt[]; try { ents = readdir(dir); } catch { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      const childRel = rel ? rel + "/" + e.name : e.name;
      if (e.isDir) { if (!skipDir(e.name)) walk(join(dir, e.name), childRel); }
      else if (!e.name.startsWith(".")) out.push(childRel);     // repo-relative POSIX path
    }
  };
  walk(cwd, "");                                                // emitted paths are relative to cwd
  return out;
}

/** `collectFiles` with two differences and one addition: it is ASYNC, it lists DIRECTORIES as candidates of
 *  their own, and it can start below the cwd (`opts.root`).
 *
 *  A directory is emitted BEFORE the walk descends into it, so one level reads top-down (`src/`, then
 *  `src/app.ts`, then `src/tui/`, …). The ignore rules are unchanged and apply to listing as well as to
 *  descent: a skipped directory (`node_modules`, `.git`, any dotdir) is neither a candidate nor walked.
 *
 *  `collectFiles` stays for its existing callers and its existing test; nothing in the product reads it now. */
export async function collectEntries(cwd: string, readdir: AsyncReaddirFn, opts: WalkOpts = {}): Promise<Entry[]> {
  const cap = opts.cap ?? 1000; const root = opts.root ?? ""; const out: Entry[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    if (out.length >= cap) return;
    let ents: DirEnt[]; try { ents = await readdir(dir); } catch { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      const childRel = rel ? rel + "/" + e.name : e.name;
      if (e.isDir) {
        if (skipDir(e.name)) continue;
        out.push({ path: root + childRel + "/", isDir: true });
        await walk(join(dir, e.name), childRel);
      } else if (!e.name.startsWith(".")) out.push({ path: root + childRel, isDir: false });
    }
  };
  // `root.slice(0, -1)` drops the trailing slash the prefix carries for the emitted paths' sake.
  await walk(root ? join(cwd, root.slice(0, -1)) : cwd, "");
  return out;
}

/** Which directory the @-walk should start from, given the live mention query — the composer's one input to
 *  `WalkOpts.root`, and the thing whose CHANGE (and only whose change) schedules a new walk.
 *
 *  Upstream's counterpart is `A7p`'s `{ directory, prefix }` split inside `p_a` (bundle L432324): it reads one
 *  directory per level rather than re-searching a whole index. Two transcription notes:
 *
 *  · Upstream reaches that per-level lane ONLY for a token `d_a` accepts (L432302: `~/`, `/`, `./`, `../`, or
 *    exactly `~`, `.`, `..`); every other `@` token goes to the fuzzy git-file index (`Tcn`, L314140), which
 *    re-searches the whole repo on each keystroke and contains no directories at all. This port has one lane,
 *    so the split is by whether the query HAS a directory part instead — a plain `@app` still fuzzy-matches
 *    `src/tui/ChatApp.tsx` across the tree, and `@src/util/f` reads only `src/util`.
 *  · The three shapes upstream's `A7p` handles and we do not — absolute, `~`-relative, and dot-relative — fall
 *    back to `""`, i.e. the whole-tree walk this port has always done for them. Answering them properly needs
 *    a path resolver, which this module cannot have (see the no-builtins note at the top). */
export function mentionWalkRoot(query: string): string {
  const i = query.lastIndexOf("/");
  if (i === -1) return "";
  const dir = query.slice(0, i + 1);
  if (dir.startsWith("/") || dir.startsWith("~")) return "";
  if (dir.split("/").some((seg) => seg === "." || seg === "..")) return "";
  return dir;
}

function fuzzyScore(textLc: string, q: string): number {
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1; for (let i = ti; i < textLc.length; i++) { if (textLc[i] === q[qi]) { found = i; break; } }
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    let s = 1 + streak;
    if (found === 0) s += 5; else if (textLc[found - 1] === "/") s += 3;
    score += s; ti = found + 1;
  }
  return score;
}

export function rankCandidates(files: string[], query: string, cap = 50): Candidate[] {
  if (!query) return files.slice(0, cap).map((path) => ({ path, score: 0 }));
  const q = query.toLowerCase(); const scored: Candidate[] = [];
  for (const path of files) { const score = fuzzyScore(path.toLowerCase(), q); if (score >= 0) scored.push({ path, score }); }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return scored.slice(0, cap);
}
