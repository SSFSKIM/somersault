// tui/src/fileComplete.ts — pure @-mention file completion: recursive walk (basic ignores, capped) + fuzzy
// ranker. The walk takes an injected readdir so it's testable with a fake tree (no disk). Paths are
// repo-relative POSIX. Used by editor.ts (rankCandidates) and ChatComposer.tsx (collectFiles).
import type { Candidate } from "./editor.js";

export interface DirEnt { name: string; isDir: boolean }
export type ReaddirFn = (dir: string) => DirEnt[];
export interface WalkOpts { cap?: number }

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
