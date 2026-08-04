// test/unit/placeholder.test.ts — F5 task 8: the composer's placeholder generator. Pins transcribed from
// the 2.1.220 bundle:
//  · L495107  `NVf` — the precedence ladder, over SIX inputs
//  · L495095  `MVf` — the eight templates and the `Try "…"` wrapper
//  · L495114  `Press up to edit queued messages`, byte-exact
//  · L495120  `LNb = 3` — how many sessions the queued hint may appear in
//  · L495082  `wNb` — the harvest denylist
//  · L495036  `INb` — the ramp-and-cap selector (dedup by basename, all-or-nothing at 5)
//  · L495054  `xNb` — `git log -n 1000 --pretty=format: --name-only --diff-filter=M`, counted and ordered
//  · L495081  `kNb = 604800000` — the weekly cache expiry
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXAMPLE_FILE_FALLBACK, EXAMPLE_REFRESH_MS, HARVEST_COMMAND, QUEUED_UP_HINT, QUEUED_UP_HINT_LIMIT,
  cachedExampleFiles, exampleFiles, examplePool, isExampleCandidate, pickExampleFiles, pickPlaceholder, refreshExampleFiles,
} from "../../src/tui/placeholder.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";

// ————————————————————————— CM3: the template pool (MVf, L495095) —————————————————————————

describe("examplePool — MVf's eight templates, verbatim", () => {
  it("substitutes ONE drawn file into the four slots that take one", () => {
    expect(examplePool(["parser.ts", "render.ts"], () => 0)).toEqual([
      "fix lint errors",
      "fix typecheck errors",
      "how does parser.ts work?",
      "refactor parser.ts",
      "how do I log an error?",
      "edit parser.ts to...",
      "write a test for parser.ts",
      "create a util logging.py that...",
    ]);
  });

  it("uses the SAME file in all four slots — upstream draws it once, outside the array", () => {
    const pool = examplePool(["a.ts", "b.ts", "c.ts"], () => 0.9);
    const named = pool.filter((t) => t.includes(".ts"));
    expect(named).toHaveLength(4);
    expect(new Set(named.map((t) => t.match(/[abc]\.ts/)![0])).size).toBe(1);
  });

  it("falls back to the `<filepath>` literal with no example files at all", () => {
    expect(examplePool([])).toEqual([
      "fix lint errors", "fix typecheck errors", `how does ${EXAMPLE_FILE_FALLBACK} work?`, `refactor ${EXAMPLE_FILE_FALLBACK}`,
      "how do I log an error?", `edit ${EXAMPLE_FILE_FALLBACK} to...`, `write a test for ${EXAMPLE_FILE_FALLBACK}`,
      "create a util logging.py that...",
    ]);
  });
});

// ————————————————————————— CM47: the ladder (NVf, L495107) —————————————————————————

type Inputs = Parameters<typeof pickPlaceholder>[0];
const POOL = ["fix lint errors", "refactor parser.ts"];
/** Every input at the value that makes rule 4 (the `Try "…"` suggestion) the winner. */
const base = (over: Partial<Inputs> = {}): Inputs => ({
  inputEmpty: true, queueHasEditable: false, upHintSessions: 0,
  submitCount: 0, hasMessages: false, suggestionEnabled: true,
  pool: POOL, rand: () => 0, ...over,
});

describe("pickPlaceholder — the precedence ladder, exhaustive over all six inputs", () => {
  it("rule 1: a non-empty input suppresses EVERY later rule, including the queued hint", () => {
    expect(pickPlaceholder(base({ inputEmpty: false }))).toBeUndefined();
    expect(pickPlaceholder(base({ inputEmpty: false, queueHasEditable: true }))).toBeUndefined();
  });

  it("rule 3: an editable queued entry wins over the suggestion, byte-exact", () => {
    expect(pickPlaceholder(base({ queueHasEditable: true }))).toBe("Press up to edit queued messages");
    expect(QUEUED_UP_HINT).toBe("Press up to edit queued messages");
  });

  it("rule 3 needs an EDITABLE entry — a queue of nothing editable falls through to rule 4", () => {
    expect(pickPlaceholder(base({ queueHasEditable: false }))).toBe(`Try "${POOL[0]}"`);
  });

  it("rule 3 stops at LNb = 3 sessions and then yields to whatever comes next", () => {
    expect(QUEUED_UP_HINT_LIMIT).toBe(3);
    for (const n of [0, 1, 2]) expect(pickPlaceholder(base({ queueHasEditable: true, upHintSessions: n }))).toBe(QUEUED_UP_HINT);
    // At the cap the hint is gone. With rule 4 still eligible the suggestion takes over; with it ineligible
    // (a session that has already submitted) the composer shows nothing at all.
    expect(pickPlaceholder(base({ queueHasEditable: true, upHintSessions: 3 }))).toBe(`Try "${POOL[0]}"`);
    expect(pickPlaceholder(base({ queueHasEditable: true, upHintSessions: 3, submitCount: 1 }))).toBeUndefined();
    expect(pickPlaceholder(base({ queueHasEditable: true, upHintSessions: 99, submitCount: 1 }))).toBeUndefined();
  });

  it("rule 4 fires only on a session that has submitted nothing AND holds no messages", () => {
    expect(pickPlaceholder(base())).toBe(`Try "${POOL[0]}"`);
    expect(pickPlaceholder(base({ submitCount: 1 }))).toBeUndefined();
    expect(pickPlaceholder(base({ hasMessages: true }))).toBeUndefined();
    expect(pickPlaceholder(base({ submitCount: 1, hasMessages: true }))).toBeUndefined();
  });

  it("rule 4 is gated on suggestionEnabled — off, the ladder ends with no placeholder", () => {
    expect(pickPlaceholder(base({ suggestionEnabled: false }))).toBeUndefined();
    // …but suggestionEnabled has NO say over rule 3, which sits above it.
    expect(pickPlaceholder(base({ suggestionEnabled: false, queueHasEditable: true }))).toBe(QUEUED_UP_HINT);
  });

  it("rule 4 draws from the pool with the supplied rand, and never overruns it", () => {
    expect(pickPlaceholder(base({ rand: () => 0.99 }))).toBe(`Try "${POOL[1]}"`);
    expect(pickPlaceholder(base({ rand: () => 1 }))).toBe(`Try "${POOL[1]}"`);      // clamped, never undefined
    expect(pickPlaceholder(base({ pool: [] }))).toBeUndefined();                    // `N1([])` — never `Try "undefined"`
  });
});

// ————————————————————————— CM3: the harvest (xNb / INb / wNb) —————————————————————————

describe("the denylist (wNb, L495082)", () => {
  it("rejects lockfiles, build dirs, config and every data/doc extension", () => {
    for (const path of [
      "package-lock.json", "src/yarn.lock", "Cargo.lock", "go.sum",
      "src/schema.generated.ts", "dist/main.js", "node_modules/x/index.js", "build/out.js", "__pycache__/x.pyc",
      "app.min.js", "app.min.css", "bundle.map", "x.pyc",
      "data.json", "conf.yaml", "conf.yml", "Cargo.toml", "notes.md", "log.txt", "icon.svg",
      ".eslintrc", "src/.prettierrc", ".gitignore",
      "tsconfig.json", "vitest.config.ts", "vite.config.js",
      ".github/workflows/ci.yml", ".vscode/settings.json", ".claude/hooks.ts",
      "CHANGELOG.md", "LICENSE", "README", "docs/CONTRIBUTING.rst",
    ]) expect(isExampleCandidate(path), path).toBe(false);
  });

  it("accepts ordinary source files", () => {
    for (const path of ["src/parser.ts", "lib/render.tsx", "main.py", "cmd/server.go", "a/b/c/deep.rs"]) {
      expect(isExampleCandidate(path), path).toBe(true);
    }
  });
});

describe("pickExampleFiles (INb, L495036)", () => {
  it("spreads across directories before taking a second file from any one of them", () => {
    // Directory `a` leads the count ordering, but the ramp lets it contribute only one file per pass.
    const picked = pickExampleFiles(["a/1.ts", "a/2.ts", "a/3.ts", "b/4.ts", "c/5.ts", "d/6.ts"]);
    expect(picked).toEqual(["1.ts", "4.ts", "5.ts", "6.ts", "2.ts"]);
  });

  it("deduplicates by BASENAME across directories", () => {
    const picked = pickExampleFiles(["a/x.ts", "b/x.ts", "c/y.ts", "d/z.ts", "e/w.ts", "f/v.ts"]);
    expect(picked).toEqual(["x.ts", "y.ts", "z.ts", "w.ts", "v.ts"]);
  });

  it("is ALL OR NOTHING: fewer than five survivors is an empty list, not a short one", () => {
    expect(pickExampleFiles(["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts"])).toEqual([]);
    expect(pickExampleFiles([])).toEqual([]);
    // Four real files plus a denied one still cannot reach five.
    expect(pickExampleFiles(["a/1.ts", "b/2.ts", "c/3.ts", "d/4.ts", "e/README.md"])).toEqual([]);
  });
});

describe("exampleFiles (xNb, L495054)", () => {
  const log = (...paths: string[]) => paths.join("\n");

  it("runs upstream's exact git command through the injected run", () => {
    const seen: string[] = [];
    exampleFiles("/repo", (cmd) => { seen.push(cmd); return ""; });
    expect(seen).toEqual(["git log -n 1000 --pretty=format: --name-only --diff-filter=M"]);
    expect(HARVEST_COMMAND).toBe("git log -n 1000 --pretty=format: --name-only --diff-filter=M");
  });

  it("counts repeats, orders by count descending, filters and caps at five basenames", () => {
    const out = exampleFiles("/repo", () => log(
      "src/hot.ts", "", "src/hot.ts", "src/hot.ts",
      "package-lock.json", "package-lock.json", "package-lock.json", "package-lock.json",
      "lib/warm.ts", "lib/warm.ts",
      "a/one.ts", "b/two.ts", "c/three.ts", "d/four.ts", "e/five.ts",
    ));
    expect(out[0]).toBe("hot.ts");                       // most-modified survivor first
    expect(out).toHaveLength(5);
    expect(out).not.toContain("package-lock.json");      // denied despite being the most-modified path
  });

  it("swallows a failing run (no git, not a repo) as an empty harvest", () => {
    expect(exampleFiles("/nowhere", () => { throw new Error("not a git repository"); })).toEqual([]);
  });

  it("returns nothing when the log is too thin to fill the cap", () => {
    expect(exampleFiles("/repo", () => log("a/only.ts", "b/other.ts"))).toEqual([]);
  });
});

// ————————————————————————— the prefs cache (DVf, L495100 + kNb) —————————————————————————

describe("the example-file cache in prefs", () => {
  let root = "", env: NodeJS.ProcessEnv;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-placeholder-")); env = { ...process.env, CCX_FLEET_ROOT: root }; });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const five = ["a/1.ts", "b/2.ts", "c/3.ts", "d/4.ts", "e/5.ts"].join("\n");

  it("harvests and persists when nothing is cached", () => {
    refreshExampleFiles({ cwd: "/repo", env, run: () => five, now: 1000 });
    expect(loadPrefs(env).exampleFiles).toEqual({ files: ["1.ts", "2.ts", "3.ts", "4.ts", "5.ts"], at: 1000 });
    expect(cachedExampleFiles(env, 1000)).toEqual(["1.ts", "2.ts", "3.ts", "4.ts", "5.ts"]);
  });

  it("does NOT re-run git while the cache is fresh", () => {
    savePrefs({ exampleFiles: { files: ["cached.ts"], at: 1000 } }, env);
    let ran = 0;
    refreshExampleFiles({ cwd: "/repo", env, run: () => { ran++; return five; }, now: 1000 + EXAMPLE_REFRESH_MS });
    expect(ran).toBe(0);
    expect(loadPrefs(env).exampleFiles?.files).toEqual(["cached.ts"]);
  });

  it("treats a cache older than kNb as absent, and re-harvests", () => {
    savePrefs({ exampleFiles: { files: ["stale.ts"], at: 1000 } }, env);
    const now = 1000 + EXAMPLE_REFRESH_MS + 1;
    expect(cachedExampleFiles(env, now)).toEqual([]);
    refreshExampleFiles({ cwd: "/repo", env, run: () => five, now });
    expect(loadPrefs(env).exampleFiles).toEqual({ files: ["1.ts", "2.ts", "3.ts", "4.ts", "5.ts"], at: now });
  });

  it("never caches an EMPTY harvest — `if (n.length)` (L495104)", () => {
    refreshExampleFiles({ cwd: "/repo", env, run: () => "", now: 1000 });
    expect(loadPrefs(env).exampleFiles).toBeUndefined();
  });

  it("leaves other prefs alone (savePrefs read-merge-write)", () => {
    savePrefs({ theme: "dark" }, env);
    refreshExampleFiles({ cwd: "/repo", env, run: () => five, now: 1000 });
    expect(loadPrefs(env).theme).toBe("dark");
  });
});
