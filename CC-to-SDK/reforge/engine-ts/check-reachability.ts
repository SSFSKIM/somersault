// Static reachability — the machine-checked half of "engine-ts owns its code"
// (campaign spec §2.4: "static reachability over the skeleton proves no
// extracted-chunk import in the standalone set").
//
//   npx tsx engine-ts/check-reachability.ts [entry.ts]
//   npx tsx engine-ts/reachability.test.ts     # positive + negative controls
//
// It walks the import graph from the skeleton's entry and fails on:
//
//   FORBIDDEN  any specifier that resolves — or textually points — into the
//              extraction bundle, the pinned real binary, or reforge/build/
//              (the materialized graph, the strangled build, the binary
//              symlink). Symlinks are followed: build/real-binary is a link to
//              the pinned binary, so path-prefix matching alone is evadable.
//   BUNFS      any specifier carrying the extraction's own `/$bunfs/root/`
//              scheme, resolvable or not.
//   ORPHAN     any .ts file under engine-ts/ that the walk never reached.
//              Without this rule a module could carry a forbidden import and
//              stay invisible simply by never being registered — the checker
//              would pass while looking at nothing.
//
// Scope, stated honestly: this is a *static* gate. An engine that reads and
// evals extracted source at runtime, or spawns the real binary, passes it while
// owning nothing — which is precisely why §3.6 adds the OS-enforced hermetic
// gate at W13/W14, with one negative control per delegation route. This checker
// is the cheap continuous half, not the proof.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_MODULES, BUNFS, REAL_BINARY } from "../src/pin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFORGE_ROOT = dirname(HERE);
export const DEFAULT_ENTRY = join(HERE, "main.ts");

/**
 * Roots no engine-ts file may reach into, derived from the pin so a bump
 * follows automatically:
 *  - the whole extraction bundle tree (…/claude-code-bundle)
 *  - the installed-versions dir holding the pinned real binary
 *  - reforge/build (graph, strangled, real-binary symlink) — all generated
 *    artifacts of the extracted substrate
 */
export const FORBIDDEN_ROOTS: string[] = [
  dirname(dirname(BUNDLE_MODULES)),
  dirname(REAL_BINARY),
  join(REFORGE_ROOT, "build"),
];

/** Files that are tooling around the skeleton, not part of it. */
const TOOLING = (name: string) => name.endsWith(".test.ts") || name.startsWith("check-");

export interface Violation {
  rule: "FORBIDDEN" | "BUNFS" | "ORPHAN" | "ENTRY" | "DYNAMIC";
  file: string;
  specifier?: string;
  resolved?: string;
  detail: string;
}

export interface ReachabilityReport {
  entry: string;
  files: string[];
  specifiers: number;
  externals: string[];
  violations: Violation[];
}

/**
 * Blank out comments (replacing them with spaces so offsets survive) before
 * scanning for specifiers. Without this the checker reads example imports out
 * of doc comments and accuses them; with a naive regex instead it would risk
 * the far worse error — blanking real code that merely contains "//" inside a
 * string — so this walks the source tracking string and template state.
 */
export function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      i++;
    }
  }
  return out.join("");
}

const SPEC_PATTERNS = [
  /(?:^|[\s;})])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
  /(?:^|[\s;})])import\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every static/dynamic module specifier written as a literal in `src`. */
export function specifiersOf(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1]);
  }
  return out;
}

/**
 * Dynamic `import(x)` / `require(x)` with a computed specifier. §3.6 names a
 * dynamic import of an extracted chunk as a delegation route, and a computed
 * specifier is exactly the shape static analysis cannot follow — so engine-ts
 * forbids it outright rather than pretending to have checked it.
 */
export function computedSpecifierSites(src: string): string[] {
  const code = stripComments(src);
  const sites: string[] = [];
  const re = /\b(import|require)\s*\(\s*([^\s)])/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[2] !== '"' && m[2] !== "'") sites.push(code.slice(m.index, m.index + 40).trim());
  }
  return sites;
}

const underRoot = (path: string, root: string) => path === root || path.startsWith(root + "/");

function inForbiddenRoot(path: string): string | null {
  const candidates = [path];
  if (existsSync(path)) {
    try {
      candidates.push(realpathSync(path));
    } catch {
      /* unreadable — the literal path check still applies */
    }
  }
  for (const c of candidates) for (const root of FORBIDDEN_ROOTS) if (underRoot(c, root)) return root;
  return null;
}

/** Resolve a relative/absolute specifier the way NodeNext + bun do (`.js` → `.ts`). */
function resolveLocal(fromFile: string, spec: string): string | null {
  const base = isAbsolute(spec) ? spec : resolve(dirname(fromFile), spec);
  const candidates = [
    base.endsWith(".js") ? base.slice(0, -3) + ".ts" : null,
    base.endsWith(".js") ? base.slice(0, -3) + ".tsx" : null,
    base,
    `${base}.ts`,
    join(base, "index.ts"),
  ].filter((c): c is string => c !== null);
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

export function checkReachability(entryPath: string): ReachabilityReport {
  const entry = resolve(entryPath);
  const report: ReachabilityReport = { entry, files: [], specifiers: 0, externals: [], violations: [] };
  if (!existsSync(entry)) {
    report.violations.push({ rule: "ENTRY", file: entry, detail: "entry does not exist — the walk would pass vacuously" });
    return report;
  }

  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const site of computedSpecifierSites(src)) {
      report.violations.push({ rule: "DYNAMIC", file, detail: `computed module specifier '${site}' — not statically checkable (§3.6 delegation route)` });
    }
    for (const spec of specifiersOf(src)) {
      report.specifiers++;
      if (spec.includes(BUNFS)) {
        report.violations.push({ rule: "BUNFS", file, specifier: spec, detail: `carries the extraction's ${BUNFS} scheme` });
        continue;
      }
      const isLocal = spec.startsWith(".") || isAbsolute(spec);
      if (isLocal) {
        const literalRoot = inForbiddenRoot(isAbsolute(spec) ? spec : resolve(dirname(file), spec));
        const resolved = resolveLocal(file, spec);
        const root = literalRoot ?? (resolved ? inForbiddenRoot(resolved) : null);
        if (root) {
          report.violations.push({ rule: "FORBIDDEN", file, specifier: spec, resolved: resolved ?? undefined, detail: `resolves under ${root}` });
          continue;
        }
        if (!resolved) {
          report.violations.push({ rule: "FORBIDDEN", file, specifier: spec, detail: "unresolvable local specifier — cannot be proven clean" });
          continue;
        }
        queue.push(resolved);
      } else {
        // A bare specifier is an npm package: §1.2 puts vendored libraries out
        // of scope, engine-ts imports the real packages. Recorded, and checked
        // for a forbidden resolution, but not walked.
        if (!report.externals.includes(spec)) report.externals.push(spec);
        try {
          const resolved = fileURLToPath(import.meta.resolve(spec, `file://${file}`));
          const root = inForbiddenRoot(resolved);
          if (root) report.violations.push({ rule: "FORBIDDEN", file, specifier: spec, resolved, detail: `bare specifier resolves under ${root}` });
        } catch {
          /* unresolved package (types-only, or not installed) — nothing to accuse */
        }
      }
    }
  }
  report.files = [...seen].sort();

  // Orphans: every non-tooling .ts under the entry's own tree must be reached.
  const root = dirname(entry);
  for (const f of tsFilesUnder(root)) {
    const name = f.slice(root.length + 1);
    if (TOOLING(name.split("/").pop()!)) continue;
    if (!seen.has(f)) {
      report.violations.push({ rule: "ORPHAN", file: f, detail: "not reachable from the entry — an unwalked file is an unchecked file" });
    }
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entry = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ENTRY;
  const report = checkReachability(entry);
  const rel = (p: string) => relative(REFORGE_ROOT, p) || p;
  console.log(`=== engine-ts static reachability: ${rel(report.entry)} ===`);
  console.log(`  files walked: ${report.files.length} → ${report.files.map(rel).join(", ")}`);
  console.log(`  specifiers checked: ${report.specifiers}`);
  console.log(`  external packages: ${report.externals.length ? report.externals.join(", ") : "none"}`);
  console.log(`  forbidden roots: ${FORBIDDEN_ROOTS.join(", ")}`);
  for (const v of report.violations) console.log(`  ${v.rule}  ${rel(v.file)}${v.specifier ? ` → ${v.specifier}` : ""}: ${v.detail}`);
  const ok = report.violations.length === 0;
  console.log(ok ? "\nPASS — no engine-ts import reaches the extracted substrate" : `\nFAIL — ${report.violations.length} violation(s)`);
  process.exit(ok ? 0 : 1);
}
