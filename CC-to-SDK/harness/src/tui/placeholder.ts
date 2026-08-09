// tui/src/placeholder.ts — F5 Task 8: the composer's placeholder GENERATOR (CM47 + CM3). What text an empty
// composer shows, and where the `${file}` in it comes from. Pure except for `exampleFiles`, whose one impure
// act (a `git log`) is behind an injectable `run`.
//
// Transcribed from 2.1.220:
//  · `NVf`  (L495107)   the precedence ladder — see `pickPlaceholder`.
//  · `MVf`  (L495093)   the eight templates and the `Try "…"` wrapper, memoized once per process by `Vr`.
//  · `wNb`  (L495092)   the denylist, transcribed VERBATIM below.
//  · `CNb`  (L495033)   `!wNb.some(t => t.test(e))` — the denylist test.
//  · `INb`  (L495036)   the ramp-and-cap selector: dedup by basename, at most `i` per directory for i=1…5,
//                       and ALL OR NOTHING (`return r.length >= t ? r : []`).
//  · `xNb`  (L495054)   the git harvest.
//  · `kNb`  (L495081)   604800000 — the weekly refresh window.
//  · `LNb`  (L495120)   3 — how many sessions the queued-up hint is allowed to appear in.
//
// FOUR recorded divergences:
//
//  1. ONE GIT PASS, NOT TWO. `xNb` runs the log scoped to the committer's own email first
//     (`--author=${await D1e()}`) and re-runs it UNSCOPED when that yielded fewer than 10 distinct files.
//     Our seam is a single `run(cmd)` with no way to ask git who the user is, so only the unscoped pass is
//     built — which is upstream's own fallback, and the branch that actually runs in any repo where the
//     user has touched fewer than ten files.
//
//  2. THE `< 3` GATE HAS NO WRITER UPSTREAM. `queuedCommandUpHintCount` is defaulted (L377294) and read
//     (L495114) in 2.1.220 and incremented NOWHERE in the bundle — the gate is dead as shipped, so the
//     hint shows forever. We increment it once per mount that showed the hint (`queuedUpHintSessions` in
//     ccx's own prefs), which is the only reading under which `LNb` means anything. Recorded as an
//     invention, not as a transcription.
//
//  3. NO AGENT VIEW. `NVf`'s rule 2 (`Message @${name}…`, truncated at `PVf = 20`) fires only while the
//     REPL is viewing a spawned teammate's thread, a surface this port does not have. Carried as a comment
//     in the ladder so the numbering matches upstream's.
//
//  4. THE HARVEST IS SYNCHRONOUS, AND THAT BLOCKS. `xNb` is async and `DVf` fires it without awaiting, so
//     upstream's FIRST session in a repo always renders `<filepath>` and the real names appear from the
//     next launch on. Our `run` is sync, so whatever thread calls it stops for the duration of a `git log
//     -n 1000` — in a large repo that is real time, and on a wedged git it would be unbounded. Three things
//     keep it off the user's path: the call site is `chatMain.tsx`'s process entry, not a component (the
//     composer only READS the cache, so a remount never re-shells); it runs inside a `setTimeout(0)` so the
//     first paint is already out; and `execSync` carries `HARVEST_TIMEOUT_MS` below, whose expiry throws
//     and lands in the same empty-harvest arm as "not a git repo". The observable behaviour still matches
//     upstream: the first session in a repo shows `<filepath>`.
import { execSync } from "node:child_process";
import { loadPrefs, savePrefs } from "./prefs.js";

/** `kNb` (L495081). */
export const EXAMPLE_REFRESH_MS = 604800000;
/** `LNb` (L495120). */
export const QUEUED_UP_HINT_LIMIT = 3;
/** L495115, byte-exact (the `return`; L495114 is the gate that reaches it). */
export const QUEUED_UP_HINT = "Press up to edit queued messages";
/** The `${t}` fallback when no example file is known (L495096). */
export const EXAMPLE_FILE_FALLBACK = "<filepath>";
/** `xNb`'s argv (L495059), as one command line for the `run` seam. */
export const HARVEST_COMMAND = "git log -n 1000 --pretty=format: --name-only --diff-filter=M";
/** `INb(o, 5)` (L495077). */
const EXAMPLE_CAP = 5;

/** `wNb` (bundle L495092), transcribed verbatim and in order. */
const DENYLIST: RegExp[] = [
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|bun\.lock|bun\.lockb|pnpm-lock\.yaml|Pipfile\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|composer\.lock|uv\.lock)$/,
  /\.generated\./,
  /(?:^|\/)(?:dist|build|out|target|node_modules|\.next|__pycache__)\//,
  /\.(?:min\.js|min\.css|map|pyc|pyo)$/,
  /\.(?:json|ya?ml|toml|xml|ini|cfg|conf|env|lock|txt|md|mdx|rst|csv|log|svg)$/i,
  /(?:^|\/)\.?(?:eslintrc|prettierrc|babelrc|editorconfig|gitignore|gitattributes|dockerignore|npmrc)/,
  /(?:^|\/)(?:tsconfig|jsconfig|biome|vitest\.config|jest\.config|webpack\.config|vite\.config|rollup\.config)\.[a-z]+$/,
  /(?:^|\/)\.(?:github|vscode|idea|claude)\//,
  /(?:^|\/)(?:CHANGELOG|LICENSE|CONTRIBUTING|CODEOWNERS|README)(?:\.[a-z]+)?$/i,
];

/** `CNb` (L495033). */
export function isExampleCandidate(path: string): boolean { return !DENYLIST.some((re) => re.test(path)); }

/** `INb` (L495036). Walks the count-sorted paths repeatedly with a per-directory cap that RAMPS from 1 to
 *  `cap`, so the first choices spread across directories before any one of them contributes a second file.
 *  Yields BASENAMES, deduplicated. All-or-nothing: fewer than `cap` survivors means an empty list, not a
 *  short one — upstream would rather say `<filepath>` than draw from a thin sample. */
export function pickExampleFiles(paths: readonly string[], cap: number = EXAMPLE_CAP): string[] {
  const out: string[] = [], seen = new Set<string>(), perDir = new Map<string, number>();
  for (let limit = 1; out.length < cap && limit <= cap; limit++) {
    for (const path of paths) {
      if (out.length >= cap) break;
      if (!isExampleCandidate(path)) continue;
      const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const base = cut >= 0 ? path.slice(cut + 1) : path;
      if (!base || seen.has(base)) continue;
      const dir = cut >= 0 ? path.slice(0, cut) : ".";
      if ((perDir.get(dir) ?? 0) >= limit) continue;
      out.push(base); seen.add(base); perDir.set(dir, (perDir.get(dir) ?? 0) + 1);
    }
  }
  return out.length >= cap ? out : [];
}

/** `xNb`'s wall-clock budget, ours: upstream spawns asynchronously and can afford to wait, our `run` is
 *  synchronous and blocks whoever calls it. 2 s is far above a warm `git log -n 1000` and far below the
 *  point where a wedged git (a stale index lock, a network-backed filesystem) would be felt. */
const HARVEST_TIMEOUT_MS = 2000;

/** The default `run`: the harvest command in `cwd`, stderr discarded, every failure (not a repo, no git,
 *  the timeout above) surfacing as a throw that `exampleFiles` turns into an empty harvest. */
const execRun = (cwd: string) => (cmd: string): string =>
  execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024, timeout: HARVEST_TIMEOUT_MS });

/** `xNb` (L495054) minus divergence 1: count every modified path in the last 1000 commits, order by count
 *  descending, hand the ordering to `INb`. Windows is excluded upstream (`Z.platform === "win32"`) and here. */
export function exampleFiles(cwd: string, run: (cmd: string) => string = execRun(cwd)): string[] {
  if (process.platform === "win32") return [];
  let stdout: string;
  try { stdout = run(HARVEST_COMMAND); } catch { return []; }
  const counts = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const path = line.trim();
    if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
  return pickExampleFiles(ordered);
}

/** `MVf`'s template array (L495097), verbatim and in order, with ONE example file substituted into the four
 *  slots that take one — upstream draws that file once (`N1(e.exampleFiles)`) and reuses it across the
 *  array, so all four templates in a given draw name the same file. */
export function examplePool(files: readonly string[], rand: () => number = Math.random): string[] {
  const f = files.length > 0 ? files[Math.min(files.length - 1, Math.floor(rand() * files.length))] : EXAMPLE_FILE_FALLBACK;
  return [
    "fix lint errors",
    "fix typecheck errors",
    `how does ${f} work?`,
    `refactor ${f}`,
    "how do I log an error?",
    `edit ${f} to...`,
    `write a test for ${f}`,
    "create a util logging.py that...",
  ];
}

/** `NVf` (L495107). First match wins; no match is no placeholder at all.
 *
 *   0. (W-C T12) the model's follow-up suggestion, when there is one to show
 *   1. a non-empty input has nothing to hint at
 *   2. (upstream: the agent-view `Message @name…` — divergence 3, not reachable here)
 *   3. some queued entry is EDITABLE and the hint has not used up its sessions
 *   4. a session that has submitted nothing, holds no messages, and has suggestions on
 *
 *  RULE 0 IS UPSTREAM'S OWN PRECEDENCE, just expressed one level down. Upstream never puts the suggestion
 *  into `NVf` at all: the composer picks `b9 && as ? as : Wge ?? iH` (L496158) — model suggestion, then the
 *  diff-comment hint, then whatever this ladder returned. ccx has no diff-comment surface, so folding rule 0
 *  into the ladder yields the identical order with one decision site instead of two. The CALLER still owns
 *  whether a suggestion is showable at all (annex §C5.4's `b9`: prompt mode, empty buffer, not responding);
 *  what arrives here is already that answer. */
export function pickPlaceholder(i: {
  inputEmpty: boolean; queueHasEditable: boolean; upHintSessions: number;
  submitCount: number; hasMessages: boolean; suggestionEnabled: boolean;
  suggestion?: string | null;
  pool: readonly string[]; rand: () => number;
}): string | undefined {
  if (!i.inputEmpty) return undefined;
  if (i.suggestion) return i.suggestion;
  if (i.queueHasEditable && i.upHintSessions < QUEUED_UP_HINT_LIMIT) return QUEUED_UP_HINT;
  if (i.submitCount < 1 && !i.hasMessages && i.suggestionEnabled) {
    if (i.pool.length === 0) return undefined;                        // `N1([])` is undefined; never `Try "undefined"`
    return `Try "${i.pool[Math.min(i.pool.length - 1, Math.floor(i.rand() * i.pool.length))]}"`;
  }
  return undefined;
}

/** The cached half of `DVf` (L495100): what this session gets to draw from. A cache older than `kNb` is
 *  treated as absent (upstream clears `e.exampleFiles` outright at that age), which is what makes the very
 *  next draw fall back to `<filepath>` while the refresh below repopulates it for the session after. */
export function cachedExampleFiles(env?: NodeJS.ProcessEnv, now: number = Date.now()): string[] {
  const cached = loadPrefs(env).exampleFiles;
  if (!cached || !Array.isArray(cached.files) || cached.files.length === 0) return [];
  if (now - (cached.at ?? 0) > EXAMPLE_REFRESH_MS) return [];
  return cached.files;
}

/** The refreshing half of `DVf`: harvest and persist when the cache is empty or stale, otherwise do nothing.
 *  Never throws — `exampleFiles` swallows the git failure and a save failure is not worth a crashed REPL. */
export function refreshExampleFiles(o: { cwd: string; env?: NodeJS.ProcessEnv; run?: (cmd: string) => string; now?: number }): void {
  const now = o.now ?? Date.now();
  if (cachedExampleFiles(o.env, now).length > 0) return;
  const files = exampleFiles(o.cwd, o.run ?? execRun(o.cwd));
  if (files.length === 0) return;                                     // `if (n.length)` — an empty harvest is not cached
  try { savePrefs({ exampleFiles: { files, at: now } }, o.env); } catch { /* prefs are best-effort */ }
}
