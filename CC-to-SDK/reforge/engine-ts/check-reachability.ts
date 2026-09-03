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
//   PACKAGE    a bare specifier that neither resolves nor is a node builtin —
//              an import nothing can prove clean.
//   PARSE      a file the TypeScript parser reports syntax errors for. AST
//              discovery under-reports on a broken parse, so an unparseable
//              file must fail loudly instead of walking half of itself.
//   DYNAMIC    a computed `import(x)` / `require(x)`.
//   ORPHAN     any .ts file under engine-ts/ that the walk never reached.
//              Without this rule a module could carry a forbidden import and
//              stay invisible simply by never being registered — the checker
//              would pass while looking at nothing.
//
// Discovery is an **AST walk**, not a regex sweep (W0 boundary review, lens 2).
// The regexes it replaces required whitespace after `import`/`export`, so the
// compact forms a bundler emits — `export{x}from"…"`, `export*from"…"`,
// `import{x}from"…"` — were invisible, and a re-export chain through one such
// line hid an entire subgraph from the walk. The same `typescript` parser
// strangle/ast.ts excises with reads every module-loading form instead:
// ImportDeclaration, ExportDeclaration with a module specifier,
// ImportEqualsDeclaration, dynamic `import()`, and `require()`. Comments and
// string contents fall out of the grammar for free, so the hand-rolled
// comment-stripper this file used to carry is gone.
//
// Scope, stated honestly: this is a *static* gate. An engine that reads and
// evals extracted source at runtime, or spawns the real binary, passes it while
// owning nothing — which is precisely why §3.6 adds the OS-enforced hermetic
// gate at W13/W14, with one negative control per delegation route. This checker
// is the cheap continuous half, not the proof.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, BUNFS, CLAUDE_INSTALL_DIR, REAL_BINARY } from "../src/pin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFORGE_ROOT = dirname(HERE);
export const DEFAULT_ENTRY = join(HERE, "main.ts");

/**
 * Roots no engine-ts file may reach into, derived from the pin so a bump
 * follows automatically:
 *  - the whole extraction bundle tree (…/claude-code-bundle)
 *  - reforge/toolchain, which now holds the pinned oracle binary AND the pinned
 *    runtime (`dirname(REAL_BINARY)` since §3.5's oracle pin)
 *  - Claude Code's own installed-versions dir. Nothing in reforge points there
 *    any more, which is exactly why it is named EXPLICITLY: a forbidden root
 *    that was only forbidden as a side effect of where the pin happened to live
 *    would have quietly stopped being forbidden when the pin moved.
 *  - reforge/build (graph, strangled, real-binary symlink) — all generated
 *    artifacts of the extracted substrate
 */
export const FORBIDDEN_ROOTS: string[] = [
  dirname(dirname(BUNDLE_MODULES)),
  dirname(REAL_BINARY),
  CLAUDE_INSTALL_DIR,
  join(REFORGE_ROOT, "build"),
];

/**
 * The bare packages engine-ts may depend on without the walk entering them
 * (§1.2 puts vendored libraries out of scope; node builtins are allowed
 * separately and are not packages at all). Everything else that resolves is
 * **traversed**: a workspace or node_modules entry that re-exports an extracted
 * chunk is a delegation route, and terminating the walk at the package boundary
 * is how it used to pass. Adding a name here is the deliberate act of vouching
 * for a dependency's own import graph.
 */
export const ALLOWED_PACKAGES: ReadonlySet<string> = new Set(["typescript"]);

/** Bound on the walk, so vouching for nothing cannot turn the checker into a hang. */
const MAX_FILES = 2000;

/** Files that are tooling around the skeleton, not part of it. */
const TOOLING = (name: string) => name.endsWith(".test.ts") || name.startsWith("check-");

export interface Violation {
  rule: "FORBIDDEN" | "BUNFS" | "PACKAGE" | "PARSE" | "ORPHAN" | "ENTRY" | "DYNAMIC" | "BUDGET";
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

export interface ModuleScan {
  /** every module specifier written as a literal, in source order */
  specifiers: string[];
  /**
   * `import(x)` / `require(x)` sites whose specifier is not a literal. §3.6
   * names a dynamic import of an extracted chunk as a delegation route, and a
   * computed specifier is exactly the shape static analysis cannot follow — so
   * engine-ts forbids it outright rather than pretending to have checked it.
   */
  computed: string[];
  /** syntax errors the parser reported; a nonzero count makes the scan unsound */
  parseErrors: number;
}

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Every module-loading site in `src`, found through the parser rather than by pattern. */
export function scanModule(file: string, src: string): ModuleScan {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  // `parseDiagnostics` is not on the public SourceFile type; strangle/ast.ts
  // reads it the same way, and the `?? []` keeps this a no-op if it ever moves.
  const parseErrors = ((sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? []).length;
  const scan: ModuleScan = { specifiers: [], computed: [], parseErrors };

  const snippet = (node: ts.Node) => node.getText(sf).replace(/\s+/g, " ").slice(0, 60);
  const take = (node: ts.Node, spec: ts.Node | undefined) => {
    if (spec && ts.isStringLiteralLike(spec)) scan.specifiers.push(spec.text);
    else scan.computed.push(snippet(node));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) take(node, node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) take(node, node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      take(node, node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) take(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return scan;
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
  const jsLess = base.endsWith(".js") ? base.slice(0, -3) : null;
  const candidates = [
    jsLess ? `${jsLess}.ts` : null,
    jsLess ? `${jsLess}.tsx` : null,
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ].filter((c): c is string => c !== null);
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
function packageNameOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.split("/").includes("node_modules"))
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
    if (seen.size >= MAX_FILES) {
      report.violations.push({ rule: "BUDGET", file, detail: `walk exceeded ${MAX_FILES} files — an unvouched dependency tree; allowlist it in ALLOWED_PACKAGES or cut it` });
      break;
    }
    seen.add(file);
    const scan = scanModule(file, readFileSync(file, "utf8"));
    if (scan.parseErrors > 0) {
      report.violations.push({ rule: "PARSE", file, detail: `${scan.parseErrors} syntax error(s) — a file the parser cannot read is a file the walk cannot check` });
    }
    for (const site of scan.computed) {
      report.violations.push({ rule: "DYNAMIC", file, detail: `computed module specifier '${site}' — not statically checkable (§3.6 delegation route)` });
    }
    for (const spec of scan.specifiers) {
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
        if (!report.externals.includes(spec)) report.externals.push(spec);
        if (isBuiltin(spec)) continue;
        // Resolve from the IMPORTING file. `import.meta.resolve(spec, parent)`
        // silently ignores its second argument under tsx, which resolved every
        // bare specifier against this checker's own location instead.
        let resolved: string | null = null;
        try {
          resolved = createRequire(file).resolve(spec);
        } catch {
          resolved = null;
        }
        if (!resolved) {
          report.violations.push({ rule: "PACKAGE", file, specifier: spec, detail: "bare specifier does not resolve — an unresolved import cannot be proven clean" });
          continue;
        }
        const root = inForbiddenRoot(resolved);
        if (root) {
          report.violations.push({ rule: "FORBIDDEN", file, specifier: spec, resolved, detail: `bare specifier resolves under ${root}` });
          continue;
        }
        if (!ALLOWED_PACKAGES.has(packageNameOf(spec))) queue.push(resolved);
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
  console.log(`  allowlisted packages: ${[...ALLOWED_PACKAGES].join(", ")}`);
  console.log(`  forbidden roots: ${FORBIDDEN_ROOTS.join(", ")}`);
  for (const v of report.violations) console.log(`  ${v.rule}  ${rel(v.file)}${v.specifier ? ` → ${v.specifier}` : ""}: ${v.detail}`);
  const ok = report.violations.length === 0;
  console.log(ok ? "\nPASS — no engine-ts import reaches the extracted substrate" : `\nFAIL — ${report.violations.length} violation(s)`);
  process.exit(ok ? 0 : 1);
}
