// §3.3 — snapshot the HOOK EXECUTION LAYER'S CALL GRAPH from the pinned bundle.
//
//   npx tsx research/tools/extract-hook-helpers.ts [--check]
//
// WHY A FIXTURE, and it is the same argument the five before it made. The
// executor design pass (`research/2026-09-02-w75-hook-executor-design.md`)
// counted the layer's helper belt by hand — "roughly 13.9 KB across ~34
// already-pure functions" — and named ten of them. That is a population chosen
// by the reader rather than read off the artifact, which is the enumeration
// failure this campaign has now been corrected for FOUR times: the hook events
// (twice), the control-protocol arms, and the prompt sections. A helper nobody
// thought to look for cannot be measured as missing, and Stage 1's whole claim
// is "we own the pure belt" — a claim about a population.
//
// So the belt is derived, and the derivation is mechanical end to end:
//
//   1. THE EXECUTORS ARE FOUND, NOT NAMED. Upstream's dispatcher registry is
//      already a committed fixture (`hook-registry-<pin>.json`), so the 32
//      dispatchers are given. Each one's body is parsed and its callees
//      resolved; the layer's ENTRY POINTS are the callees SHARED by six or more
//      of them. Nothing here carries a minified name, which churn per pin.
//   2. THE EXECUTORS ARE THE TWO ORCHESTRATORS in the resulting closure — the
//      two functions with by far the largest callee sets. The shape is then
//      CONFIRMED against the design's load-bearing structural claim: ONE is an
//      `async function*` and the other a plain `async function`, and their
//      callee sets overlap by well under half of the larger. That is §2's "two
//      consumers, never one core" restated as a check — if a pin ever unified
//      them, this tool fails rather than quietly re-deriving a belt for an
//      architecture that no longer holds.
//   3. THE BELT IS THE TRANSITIVE CALLEE CLOSURE of the entry points within the
//      layer's own chunk. Cross-chunk callees are recorded as boundary and not
//      descended into: they are somebody else's subsystem, and the design's
//      port cuts are drawn at exactly that line.
//   4. EVERY REACHED FUNCTION IS CLASSIFIED BY ITS FREE VARIABLES, using the
//      BUILD's own scope analysis (`strangle/scope.ts`) rather than a second
//      one written here. A function with no free variables is `pure`. One whose
//      free variables are all themselves `pure` functions or frozen literals is
//      `pure` too, computed as a fixed point. One that adds only a clock, a
//      uuid mint or an environment read is `pure-with-injection` and the fixture
//      NAMES the injections, because that is the difference between a helper
//      that can be owned outright and one that needs an argument.
//
// The verdict is therefore a function of the artifact, not of the operator, and
// `--check` fails the gate when a pin bump moves it.
//
// WHAT THIS TOOL DELIBERATELY DOES NOT DECIDE: whether a `pure` helper is worth
// SPLICING. That is a two-input judgment — purity from the pin, and whether the
// helper has more than one caller (a single-caller helper folds into its
// caller's future module rather than becoming a module of its own) — and the
// second input is recorded here while the decision lives in the wave record.
// The C10.5 lesson, applied: a pin-keyed fixture carries SHAPE, and a claim
// that needs a second input belongs where both inputs are visible.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { AMBIENT_GLOBALS, freeIdentifiers, resolveDeclaration } from "../../strangle/scope.js";
import { readFixture as readRegistry } from "./extract-hook-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "fixtures");
const fixturePath = (version: string) => join(FIXTURE_DIR, `hook-helper-belt-${version}.json`);

/**
 * How many of the 32 registry dispatchers a callee must be shared by before it
 * counts as an executor. Six is comfortably below either executor's real share
 * and comfortably above every incidental helper's: the confirmation step below
 * asserts the resulting set is exactly two, so a threshold that admitted a
 * third would fail loudly rather than widen the belt.
 */
const EXECUTOR_MIN_SHARE = 6;

/**
 * How far from an entry point the belt reaches.
 *
 * A plain transitive closure does not stop: the prompt-hook arm calls the model
 * loop, which calls the query loop, and the belt becomes the engine. A SPATIAL
 * boundary was tried first — the run of top-level declarations the bundler
 * emits contiguously — and rejected: it is real, but its edge lands on whichever
 * declaration nothing inside the block happens to reference, and widening the
 * tolerance to cross that swallowed a neighbouring module. A boundary whose
 * answer moves by a factor of two under a parameter nobody can justify is not a
 * measurement.
 *
 * Hops are the boundary instead, and the campaign's own ownership doctrine is
 * the justification: a helper reachable only THROUGH a function nobody owns is
 * that function's business, and will be enumerated by the wave that owns it.
 * Three hops is exactly the distance from a dispatcher's entry point to the
 * leaves the executors touch directly — the shutdown wrapper, then the
 * streaming executor, then its own callees — so the belt is "what the executors
 * reach", stated as a distance rather than as a region. Anything further is
 * recorded as boundary WITH THE PATH THAT REACHED IT, so the next wave inherits
 * the frontier instead of re-deriving it.
 */
const MAX_HOPS = 3;

export type Verdict = "pure" | "pure-with-injection" | "effectful" | "boundary";

export interface BeltEntry {
  /** the minified binding, for cross-referencing a report against this fixture */
  name: string;
  chunk: string;
  offset: number;
  bytes: number;
  /** `function`, `function*`, `async function`, `async function*`, or `arrow`/`expression` */
  form: string;
  params: number;
  /** hops from the nearest dispatcher entry point — 0 is an entry point itself */
  hops: number;
  /** how many of the belt's own functions call it */
  callersInBelt: string[];
  /**
   * Identifier-boundary references in the DEFINING chunk, excluding a preceding
   * `.` and excluding the declaration itself.
   *
   * Scoped to the chunk deliberately. A minified local name is reused across
   * chunks for unrelated symbols — the JSON-contract interpreter's two-letter
   * binding appears in ten files and is a different function in nine of them —
   * so a bundle-wide count of a chunk-local name is not a call-site count, it is
   * a collision count.
   */
  callSitesInChunk: number;
  /** free variables, sorted — the whole basis of the verdict */
  free: string[];
  /** the subset of `free` that resolved to another belt function */
  freeThatArePure: string[];
  /** the subset of `free` this tool recognises as an injectable read */
  injections: string[];
  /** the subset of `free` that is neither, i.e. what makes it effectful */
  effectful: string[];
  verdict: Verdict;
  /** a string literal occurring inside the body, and how many bundle files carry it */
  anchor: { literal: string; files: number } | null;
}

export interface BeltFixture {
  engineVersion: string;
  generatedBy: string;
  /** the callees six or more dispatchers share — where the layer is entered */
  entryPoints: { name: string; sharedBy: number; bytes: number; form: string }[];
  /** the two orchestrators, and the overlap that says they are two consumers rather than one core */
  executors: { name: string; chunk: string; offset: number; bytes: number; form: string; callees: number }[];
  executorOverlap: { shared: number; ofLarger: number; ofSmaller: number };
  counts: {
    dispatchersRead: number;
    reached: number;
    pure: number;
    pureWithInjection: number;
    effectful: number;
    boundary: number;
    pureBytes: number;
    pureWithInjectionBytes: number;
    /** of the pure set, how many carry a literal unique across the bundle's files */
    pureWithUniqueAnchor: number;
    /** of EVERYTHING reached, how many do — the real bound on what a splice can take */
    reachedWithUniqueAnchor: number;
    /** …and how many carry no string literal at all, which is the commonest case */
    reachedWithNoLiteral: number;
  };
  belt: BeltEntry[];
}

/**
 * The reads a helper may take and still be OWNABLE as a pure function with one
 * argument.
 *
 * Deliberately a closed list of SHAPES rather than of names: a clock, a uuid
 * mint, and the platform read the design pass found behind the dedupe key. Each
 * is recognised by the callee's own body rather than by its binding, so the
 * minified names churn freely. Anything else that a helper reaches is
 * `effectful` — including, on purpose, anything this tool does not recognise,
 * because an unrecognised reach must be classified by an operator rather than
 * absorbed by a default.
 */
const INJECTION_SHAPES: { kind: string; test: (body: string) => boolean }[] = [
  { kind: "clock", test: (b) => /^function [\w$]*\(\)\{return (new Date|Date\.now)/.test(b) },
  { kind: "isoClock", test: (b) => /toISOString\(\)/.test(b) && b.length < 120 },
  { kind: "uuid", test: (b) => /randomUUID|crypto\.randomUUID/.test(b) && b.length < 200 },
  { kind: "platform", test: (b) => /process\.platform/.test(b) && b.length < 200 },
  { kind: "defaultShell", test: (b) => /\?"bash":"powershell"|\?"powershell":"bash"/.test(b) },
];

const isFunctionNode = (n: ts.Node): boolean =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

function formOf(n: ts.Node): string {
  if (ts.isArrowFunction(n)) return "arrow";
  const fn = n as ts.FunctionLikeDeclaration;
  const isAsync = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true;
  const isGen = fn.asteriskToken !== undefined;
  if (ts.isMethodDeclaration(n)) return `${isAsync ? "async " : ""}method${isGen ? "*" : ""}`;
  return `${isAsync ? "async " : ""}function${isGen ? "*" : ""}`;
}

/** Every identifier used in CALL position inside `root`, whether or not it is free. */
function calleeNames(root: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) out.add(c.text);
    }
    // A spread call — `...Fq(x)` — is an ordinary CallExpression inside a
    // SpreadElement, so it is already covered. What is NOT is a bare reference
    // passed as a callback (`.map(Fq)`), which this deliberately misses: a
    // helper reached only that way is reached through a higher-order call whose
    // shape the belt would have to model, and treating it as a call site would
    // over-claim reachability.
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, visit);
  return out;
}

/** The declaring node of `name` at top level of `sf`, if it is function-shaped. */
function topLevelFunction(sf: ts.SourceFile, name: string): { node: ts.Node; decl: ts.Node } | null {
  const found = resolveDeclaration(sf, sf.endOfFileToken, name);
  if (!found) return null;
  if (ts.isFunctionDeclaration(found.node)) return { node: found.node, decl: found.node };
  if (ts.isVariableDeclaration(found.node) && found.node.initializer && isFunctionNode(found.node.initializer)) {
    return { node: found.node.initializer, decl: found.node };
  }
  return null;
}

export function extract(version = ENGINE_VERSION): BeltFixture {
  const registry = readRegistry(version);
  const layerChunk = registry.registry.chunk;
  const text = readFileSync(join(BUNDLE_MODULES, layerChunk), "utf8");
  const sf = ts.createSourceFile(layerChunk, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

  // ---- 1. the layer's entry points, by how many dispatchers share them ----
  const share = new Map<string, Set<string>>();
  let dispatchersRead = 0;
  for (const ev of registry.events) {
    if (ev.definedIn !== layerChunk) continue;
    const fn = topLevelFunction(sf, ev.dispatcher);
    if (!fn) continue;
    dispatchersRead++;
    for (const callee of calleeNames(fn.node)) {
      const at = share.get(callee);
      if (at === undefined) share.set(callee, new Set([ev.dispatcher]));
      else at.add(ev.dispatcher);
    }
  }
  // The ENTRY POINTS into the layer: the callees the dispatchers share. The
  // measurement corrects the design pass here, and the correction matters for
  // Stage 2: the streaming dispatchers do NOT call the streaming executor —
  // they call the SHUTDOWN WRAPPER, which is what the manifest's own
  // `executeHooks` capture has been deriving on twenty-one splices since W5.
  // The awaiting executor they do call directly. So "which function do the
  // dispatchers delegate to" and "which function is the executor" are two
  // questions with different answers, and a belt rooted at the first is the
  // whole layer rather than a slice of it.
  const entryPoints = [...share.entries()]
    .filter(([name, by]) => by.size >= EXECUTOR_MIN_SHARE && topLevelFunction(sf, name) !== null)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([name, by]) => ({ name, sharedBy: by.size }));
  if (entryPoints.length === 0) {
    throw new Error(`hook-helper belt: no callee is shared by ${EXECUTOR_MIN_SHARE} or more dispatchers; the layer's shape moved.`);
  }

  // ---- 2. the belt, bounded by HOPS from the entry points -----------------
  const topLevel = new Map<string, { node: ts.Node; decl: ts.Node }>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      if (!topLevel.has(st.name.text)) topLevel.set(st.name.text, { node: st, decl: st });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && !topLevel.has(d.name.text)) topLevel.set(d.name.text, { node: d.initializer ?? d, decl: d });
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      if (!topLevel.has(st.name.text)) topLevel.set(st.name.text, { node: st, decl: st });
    }
  }

  const rootNames = entryPoints.map((e) => e.name);
  const reached = new Map<string, { node: ts.Node; decl: ts.Node; callers: Set<string>; hops: number }>();
  const external = new Map<string, Set<string>>();
  let queue: string[] = [];
  for (const n of rootNames) {
    const at = topLevel.get(n);
    if (at === undefined) continue;
    reached.set(n, { node: at.node, decl: at.decl, callers: new Set(), hops: 0 });
    queue.push(n);
  }
  while (queue.length > 0) {
    const name = queue.shift()!;
    const here = reached.get(name)!;
    for (const ref of freeIdentifiers(here.node)) {
      if (AMBIENT_GLOBALS.has(ref) || ref === name) continue;
      const at = topLevel.get(ref);
      if (at === undefined) {
        const seen = external.get(ref);
        if (seen === undefined) external.set(ref, new Set([name]));
        else seen.add(name);
        continue;
      }
      const seen = reached.get(ref);
      if (seen !== undefined) {
        seen.callers.add(name);
        continue;
      }
      if (here.hops + 1 > MAX_HOPS) {
        const beyond = external.get(ref);
        if (beyond === undefined) external.set(ref, new Set([name]));
        else beyond.add(name);
        continue;
      }
      reached.set(ref, { node: at.node, decl: at.decl, callers: new Set([name]), hops: here.hops + 1 });
      queue.push(ref);
    }
  }

  // ---- 2b. the two orchestrators, and the design-\u00a72 confirmation ---------
  // Counted by CALL expressions rather than by references, because that is what
  // design \u00a72's "30 of 87 and 30 of 38" measured and a fixture that reports a
  // different statistic under the same name is worse than one that reports none.
  const calleeSets = new Map<string, Set<string>>();
  for (const [name, r] of reached) calleeSets.set(name, calleeNames(r.node));
  const byCallees = [...calleeSets.entries()].sort((a, b) => b[1].size - a[1].size);
  if (process.env.BELT_DEBUG) {
    for (const [n, c] of byCallees.slice(0, 12)) {
      const r = reached.get(n)!;
      console.log(`   DEBUG ${n}: ${c.size} callees, ${r.decl.getEnd() - r.decl.getStart(sf)} B, ${formOf(r.node)}`);
    }
  }
  // THE STREAMING EXECUTOR is the layer's largest orchestrator outright. THE
  // AWAITING ONE is the largest orchestrator among the ENTRY POINTS — which is
  // the asymmetry the measurement found and the design pass did not: the
  // dispatchers reach the streaming executor through a wrapper and call the
  // awaiting one directly, so the two are found by two different questions.
  // The subprocess runner sits between them by callee count, which is why
  // "the two largest" alone does not separate them.
  const big = byCallees[0];
  const small = byCallees.find(([n]) => rootNames.includes(n) && formOf(reached.get(n)!.node) === "async function");
  if (small === undefined) throw new Error("hook-helper belt: no entry point is a plain async function; the awaiting executor is not findable by shape");
  const executors = [big, small].map(([name]) => {
    const r = reached.get(name)!;
    const at = r.decl.getStart(sf);
    return { name, chunk: layerChunk, offset: at, bytes: r.decl.getEnd() - at, form: formOf(r.node), callees: calleeSets.get(name)!.size };
  });
  const forms = executors.map((e) => e.form).sort();
  if (forms.join("|") !== "async function|async function*") {
    throw new Error(
      `hook-helper belt: the two orchestrators are ${forms.join(" and ")}, not one generator and one awaited one. ` +
        `Design \u00a72 — "two consumers, never one core" — rests on that split; it no longer holds at this pin.`,
    );
  }
  const sharedCallees = [...big[1]].filter((c) => small[1].has(c));
  const executorOverlap = { shared: sharedCallees.length, ofLarger: big[1].size, ofSmaller: small[1].size };
  if (sharedCallees.length * 2 >= big[1].size) {
    throw new Error(
      `hook-helper belt: the two orchestrators share ${sharedCallees.length} of the larger's ${big[1].size} callees. ` +
        `Design \u00a72 measured 30 of 87; at this overlap they are one core with two facades and the staging is wrong.`,
    );
  }

  // ---- 3. classify ---------------------------------------------------------
  const bodyOf = (n: ts.Node) => text.slice(n.getStart(sf), n.getEnd());
  const injectionKind = (name: string): string | null => {
    const fn = topLevelFunction(sf, name);
    if (fn === null) return null;
    const body = bodyOf(fn.decl);
    for (const shape of INJECTION_SHAPES) if (shape.test(body)) return shape.kind;
    return null;
  };

  const free = new Map<string, string[]>();
  for (const [name, r] of reached) free.set(name, freeIdentifiers(r.node).filter((f) => f !== name).sort());

  // A fixed point: a function is pure when every free name it has is itself a
  // pure belt function. Seeded with the zero-free-variable set and grown until
  // it stops growing, so a two-deep chain of pure leaves is pure rather than
  // effectful-by-depth.
  const pure = new Set<string>();
  for (const [name, f] of free) if (f.length === 0) pure.add(name);
  for (;;) {
    let grew = false;
    for (const [name, f] of free) {
      if (pure.has(name)) continue;
      if (f.every((x) => pure.has(x))) {
        pure.add(name);
        grew = true;
      }
    }
    if (!grew) break;
  }

  // THE SOURCE FORM, NOT THE VALUE. A minified bundle stores `\n` as a
  // backslash and an `n`, so searching for the DECODED literal returns zero
  // files for every anchor containing an escape — and zero files reads as "no
  // anchor" rather than as "wrong question", which is the quiet direction. The
  // splice's own anchor matching is a true-substring test against the chunk
  // TEXT, so the text is what has to be counted. This is the same lesson W7.5
  // learned from the other side (read what a function RETURNS, not what its
  // source says) arriving in the mirror image: here the SOURCE is the truth
  // because the consumer is a text search.
  const literalsIn = (n: ts.Node): string[] => {
    const out: string[] = [];
    const visit = (x: ts.Node): void => {
      if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
        const raw = x.getText(sf);
        out.push(raw.slice(1, -1));
      } else if (ts.isTemplateLiteral(x) && ts.isTemplateExpression(x)) {
        for (const span of [x.head, ...x.templateSpans.map((t) => t.literal)]) {
          const raw = span.getText(sf);
          out.push(raw.replace(/^[`}]/, "").replace(/[`$]\{?$/, ""));
        }
      }
      ts.forEachChild(x, visit);
    };
    visit(n);
    return [...new Set(out)].filter((s) => s.length >= 12).sort((a, b) => b.length - a.length);
  };

  const belt: BeltEntry[] = [];
  for (const [name, r] of [...reached].sort((a, b) => a[0].localeCompare(b[0]))) {
    const f = free.get(name)!;
    const freeThatArePure = f.filter((x) => pure.has(x));
    const rest = f.filter((x) => !pure.has(x));
    const injections: string[] = [];
    const effectful: string[] = [];
    for (const x of rest) {
      const kind = injectionKind(x);
      if (kind === null) effectful.push(x);
      else injections.push(`${x}:${kind}`);
    }
    const verdict: Verdict = pure.has(name) ? "pure" : effectful.length === 0 ? "pure-with-injection" : "effectful";
    const start = r.decl.getStart(sf);
    belt.push({
      name,
      chunk: layerChunk,
      offset: start,
      bytes: r.decl.getEnd() - start,
      form: formOf(r.node),
      hops: r.hops,
      params: (r.node as ts.FunctionLikeDeclaration).parameters?.length ?? 0,
      callersInBelt: [...r.callers].sort(),
      callSitesInChunk: countCallSites(text, name),
      free: f,
      freeThatArePure,
      injections: injections.sort(),
      effectful: effectful.sort(),
      verdict,
      // Computed for EVERY entry, not only the pure ones. Ownability and purity
      // are different questions — the JSON-contract interpreter's only effects
      // are a debug log and a telemetry probe, both ordinary ports — and an
      // anchor scan restricted to the pure set would have said nothing about
      // the single largest thing this layer has to own.
      anchor: anchorFor(literalsIn(r.node)),
    });
  }

  const sum = (v: Verdict) => belt.filter((b) => b.verdict === v).reduce((n, b) => n + b.bytes, 0);
  return {
    engineVersion: version,
    generatedBy: "research/tools/extract-hook-helpers.ts",
    entryPoints: entryPoints.map((e) => {
      const r = reached.get(e.name)!;
      return { name: e.name, sharedBy: e.sharedBy, bytes: r.decl.getEnd() - r.decl.getStart(sf), form: formOf(r.node) };
    }),
    executors,
    executorOverlap,
    counts: {
      dispatchersRead,
      reached: belt.length,
      pure: belt.filter((b) => b.verdict === "pure").length,
      pureWithInjection: belt.filter((b) => b.verdict === "pure-with-injection").length,
      effectful: belt.filter((b) => b.verdict === "effectful").length,
      boundary: external.size,
      pureBytes: sum("pure"),
      pureWithInjectionBytes: sum("pure-with-injection"),
      pureWithUniqueAnchor: belt.filter((b) => b.verdict !== "effectful" && b.anchor !== null && b.anchor.files === 1).length,
      reachedWithUniqueAnchor: belt.filter((b) => b.anchor !== null && b.anchor.files === 1).length,
      reachedWithNoLiteral: belt.filter((b) => b.anchor === null).length,
    },
    belt,
  };
}

// ---- bundle-wide measurements ----------------------------------------------

let BUNDLE_TEXT: { file: string; text: string }[] | null = null;
const bundle = (): { file: string; text: string }[] => {
  if (BUNDLE_TEXT === null) {
    BUNDLE_TEXT = readdirSync(BUNDLE_MODULES)
      .filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"))
      .map((f) => ({ file: f, text: readFileSync(join(BUNDLE_MODULES, f), "utf8") }));
  }
  return BUNDLE_TEXT;
};

/**
 * Identifier-boundary call sites, EXCLUDING a preceding `.`.
 *
 * The exclusion is the C10.5 correction: a regex that allows a leading dot
 * counts `x.Fq(` as a call to `Fq`, and one that requires a leading
 * non-identifier misses the spread form `...Fq(`. Both errors were made once in
 * this campaign, in opposite directions, on the same symbol.
 */
function countCallSites(chunkText: string, name: string): number {
  const re = new RegExp(`(^|[^\\w$.])${name}\\s*\\(`, "g");
  const all = [...chunkText.matchAll(re)].length;
  const declared = new RegExp(`(^|[^\\w$.])function\\*?\\s*${name}\\s*\\(`, "g");
  return all - [...chunkText.matchAll(declared)].length;
}

/** The longest literal in the body that occurs in the fewest bundle FILES. */
function anchorFor(literals: string[]): { literal: string; files: number } | null {
  let best: { literal: string; files: number } | null = null;
  for (const literal of literals.slice(0, 12)) {
    const files = bundle().filter((b) => b.text.includes(literal)).length;
    if (files === 0) continue;
    if (best === null || files < best.files) best = { literal, files };
    if (best.files === 1) break;
  }
  return best;
}

/** The committed fixture, for the oracle and the wave record. */
export function readFixture(version = ENGINE_VERSION): BeltFixture {
  return JSON.parse(readFileSync(fixturePath(version), "utf8")) as BeltFixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes("--check");
  const fx = extract();
  const out = fixturePath(fx.engineVersion);
  const body = JSON.stringify(fx, null, 2) + "\n";

  console.log(`pin: ${fx.engineVersion}`);
  console.log(`  entry points (shared by >=${EXECUTOR_MIN_SHARE} of ${fx.counts.dispatchersRead} dispatchers): ${fx.entryPoints.map((e) => `${e.name}=${e.sharedBy}`).join(", ")}`);
  for (const e of fx.executors) {
    console.log(`  executor ${e.name} (${e.form}, ${e.bytes} B) @${e.offset} — ${e.callees} callees`);
  }
  console.log(`  executor callee overlap: ${fx.executorOverlap.shared} shared of ${fx.executorOverlap.ofLarger} / ${fx.executorOverlap.ofSmaller}`);
  console.log(
    `  reached ${fx.counts.reached} in-chunk functions (+${fx.counts.boundary} cross-chunk boundaries): ` +
      `${fx.counts.pure} pure (${fx.counts.pureBytes} B), ${fx.counts.pureWithInjection} pure-with-injection ` +
      `(${fx.counts.pureWithInjectionBytes} B), ${fx.counts.effectful} effectful`,
  );
  console.log(
    `  anchorability: ${fx.counts.reachedWithUniqueAnchor} of ${fx.counts.reached} carry a literal occurring in exactly ONE bundle file ` +
      `(${fx.counts.pureWithUniqueAnchor} of them pure); ${fx.counts.reachedWithNoLiteral} carry no string literal at all`,
  );

  if (checkOnly) {
    if (!existsSync(out)) {
      console.error(`FAIL — no committed fixture at ${out}. Run without --check to generate it.`);
      process.exit(1);
    }
    if (readFileSync(out, "utf8") !== body) {
      console.error(`FAIL — the committed fixture is stale. Regenerate and review the diff:\n  npx tsx research/tools/extract-hook-helpers.ts`);
      process.exit(1);
    }
    console.log("PASS — committed fixture matches the pinned bundle");
  } else {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(out, body);
    console.log(`wrote ${out}`);
  }
}
