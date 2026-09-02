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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { AMBIENT_GLOBALS, freeIdentifiers, resolveDeclaration } from "../../strangle/scope.js";
import { anchorFor, bundle, exactScans, isUnique, MIN_ANCHOR, resetExactScans, type AnchorMeasurement } from "./anchor-enum.js";
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
  /** what the declaration IS — a third of the reached set is not a function */
  declKind: DeclKind;
  /** `function`, `function*`, `async function`, `async function*`, or `arrow`/`expression` */
  form: string;
  params: number;
  /** hops from the nearest dispatcher entry point — 0 is an entry point itself */
  hops: number;
  /** how many of the belt's own functions call it */
  callersInBelt: string[];
  /**
   * Identifier-boundary references in the DEFINING chunk, excluding a preceding
   * `.` — but NOT a preceding `...` — and excluding the declaration itself.
   *
   * Both halves of that were got wrong once each in this campaign, in opposite
   * directions, on this very symbol. A regex that allows a leading dot counts
   * `x.Fq(` as a call; one that simply forbids a leading non-identifier misses
   * the SPREAD form `...Fq(`, which is how the fifth call site hides. The
   * alternation admits the spread explicitly rather than relying on either
   * default.
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
  /**
   * The SHORTEST UNIQUE UNTAINTED SUBSTRING of the declaration — an anchor by
   * `strangle/anchor.ts`'s own rule, not a string literal. `null` when the
   * enumeration found none.
   */
  anchor: AnchorMeasurement | null;
  /** how many untainted runs of >= 8 characters the enumeration considered */
  anchorCandidates: number;
}

/**
 * A module-level mutable cell the layer reads or writes, and the SCOPE its
 * lifetime is keyed by. Design \u00a77 item 7 calls all of this "process-global,
 * never reset"; the derivation disagrees, and the disagreement is what a
 * replay harness actually has to act on — a host-keyed cell is reset by using
 * a fresh host, a session-scratch cell by using a fresh session, and only a
 * genuinely process-global one needs an explicit reset with no other way in.
 */
export interface StateCell {
  name: string;
  chunk: string;
  offset: number;
  /** `host-scoped-lazy`, `module-collection`, or `process-global` */
  kind: string;
  /** the declaration source, truncated */
  declaration: string;
  /** how the cell is keyed, when it is keyed at all */
  keyedBy: string | null;
  /** the mutating call shapes seen on this binding in the layer's chunk */
  mutators: string[];
  /** whether anything in the bundle resets it */
  resetBy: string | null;
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
    /** graph text modules the anchor search counts against (cli + every .js, recursively) */
    graphModules: number;
    reached: number;
    pure: number;
    pureWithInjection: number;
    effectful: number;
    boundary: number;
    pureBytes: number;
    pureWithInjectionBytes: number;
    /**
     * BY DECLARATION KIND, because "151 in-chunk functions" was not a count of
     * functions: the reached set is top-level DECLARATIONS, and a third of it is
     * Sets, regexes, constants, classes and one module-level instance. Every
     * figure a stage plans against — how many, how many bytes, how many pure —
     * has to be read per kind or it sizes the wrong population.
     */
    byKind: Record<DeclKind, { reached: number; pure: number; bytes: number; pureBytes: number; anchorable: number; pureAnchorable: number }>;
    /** of the pure set, how many carry a unique untainted anchor */
    pureWithUniqueAnchor: number;
    /** of EVERYTHING reached, how many do — the real bound on what a splice can take */
    reachedWithUniqueAnchor: number;
    /** …and how many the enumeration found none for */
    reachedWithNoAnchor: number;
    /** how many exact graph-wide substring counts the enumeration had to run */
    anchorScans: number;
  };
  belt: BeltEntry[];
  /** what a replay has to reset between cases, and how each cell is scoped */
  moduleState: StateCell[];
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

/**
 * A minified binding may be `$hr` or `_$`, and `$` is a REGEXP ANCHOR. An
 * unescaped name therefore matches nothing and the tool reports "no references"
 * — the quiet direction again, and it silently dropped a host-scoped cell from
 * the reset list before this was noticed.
 */
const rx = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isFunctionNode = (n: ts.Node): boolean =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/**
 * WHAT THE DECLARATION IS — and the reason the belt's headline number was wrong
 * in a second, independent way.
 *
 * The reached set is "top-level declarations", which is functions AND everything
 * else a chunk declares at top level. The counts reported them all as
 * "functions": "151 in-chunk functions, 43 pure (5,961 B)" folded in four Sets,
 * two regexes, eight numeric or string constants, two class declarations and a
 * class INSTANCE. A wave planning "own the pure belt" would have been sizing a
 * population a third of which is not a function at all, and the byte total is
 * not a byte total of functions either.
 *
 * `instance` is called out separately because it is the one kind that can never
 * be pure however its constructor classifies: a `new X` bound at module scope IS
 * module state, and duplicating it splits an identity two call sites share.
 */
export type DeclKind = "function" | "class" | "instance" | "set" | "regexp" | "constant";

const COLLECTION_CTORS = new Set(["Set", "Map", "WeakSet", "WeakMap"]);

function declKindOf(decl: ts.Node, node: ts.Node): DeclKind {
  if (ts.isClassDeclaration(decl)) return "class";
  if (isFunctionNode(node)) return "function";
  const init = ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
  if (init === undefined) return "constant";
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
    return COLLECTION_CTORS.has(init.expression.text) ? "set" : "instance";
  }
  if (ts.isRegularExpressionLiteral(init)) return "regexp";
  return "constant";
}

/**
 * Does this declaration reach code that is not in its own text?
 *
 * A dynamic `import()`, a `require()` or `import.meta` pulls in a whole module
 * at run time, and the scope analysis cannot see any of it: `import` is a
 * keyword, the specifier is a string literal, and `require` is an ambient
 * global. So a function that does nothing else has NO free identifiers and the
 * fixed point calls it pure — which is how `s5n`, whose entire body is
 * `await import("…/chunk-6v95pkgg.js")` followed by a `SandboxManager` call,
 * was counted among the 43 pure helpers of a hook layer.
 *
 * "No free variables" answers a question about NAMES. Purity is a question about
 * EFFECTS, and these three shapes are the ones where the two come apart.
 */
function reachesOutsideItsText(n: ts.Node): boolean {
  let found = false;
  const visit = (x: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.ImportKeyword) found = true;
    else if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "require") found = true;
    else if (ts.isMetaProperty(x)) found = true;
    if (!found) ts.forEachChild(x, visit);
  };
  visit(n);
  return found;
}

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

const DECL_KINDS: DeclKind[] = ["function", "class", "instance", "set", "regexp", "constant"];

function kindBreakdown(belt: BeltEntry[]): Record<DeclKind, { reached: number; pure: number; bytes: number; pureBytes: number; anchorable: number; pureAnchorable: number }> {
  const out = {} as Record<DeclKind, { reached: number; pure: number; bytes: number; pureBytes: number; anchorable: number; pureAnchorable: number }>;
  for (const k of DECL_KINDS) {
    const here = belt.filter((b) => b.declKind === k);
    const pure = here.filter((b) => b.verdict === "pure");
    out[k] = {
      reached: here.length,
      pure: pure.length,
      bytes: here.reduce((n, b) => n + b.bytes, 0),
      pureBytes: pure.reduce((n, b) => n + b.bytes, 0),
      anchorable: here.filter((b) => b.anchor !== null).length,
      pureAnchorable: pure.filter((b) => b.anchor !== null).length,
    };
  }
  return out;
}

export function extract(version = ENGINE_VERSION): BeltFixture {
  // The anchor enumeration's own work counter is module-level, so reset it here:
  // a second call in one process would otherwise report the sum of both and the
  // committed fixture would depend on how many times the tool was invoked.
  resetExactScans();
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
  // `executeHooks` capture has been deriving on FOURTEEN splices since W5 (six
  // more derive the awaiting executor as `executeHooksAwait`). The wrapper is
  // shared by 18 of the 33 registry dispatchers and has 19 call sites in the
  // chunk; the manifest count is smaller because not every event is spliced.
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
  //
  // TWO THINGS ARE EXCLUDED BEFORE THE FIXED POINT RUNS, and each was found by
  // reading an entry the first version called pure:
  //
  //   * a declaration that reaches outside its own text (a dynamic import, a
  //     `require`, `import.meta`) — no free NAMES, but arbitrary effects;
  //   * a module-level `new X` INSTANCE, which is state rather than a value. It
  //     also poisons its readers correctly: the flush registrar mutates
  //     `eO.exitFlushRegistered` and registers a `process.on("exit")` handler,
  //     and it was reaching the pure set through the instance being "pure".
  const impure = new Set<string>();
  for (const [name, r] of reached) {
    if (declKindOf(r.decl, r.node) === "instance" || reachesOutsideItsText(r.node)) impure.add(name);
  }
  const pure = new Set<string>();
  for (const [name, f] of free) if (f.length === 0 && !impure.has(name)) pure.add(name);
  for (;;) {
    let grew = false;
    for (const [name, f] of free) {
      if (pure.has(name) || impure.has(name)) continue;
      if (f.every((x) => pure.has(x))) {
        pure.add(name);
        grew = true;
      }
    }
    if (!grew) break;
  }

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
    // An IMPURE-BY-SHAPE entry has no free names to put in `effectful`, so the
    // reason is recorded there explicitly rather than left to be inferred from
    // an empty list — without it, `s5n` reads as "pure-with-injection with no
    // injections", which is the same wrong answer wearing a different label.
    if (impure.has(name)) {
      if (declKindOf(r.decl, r.node) === "instance") effectful.push("<module-level instance>");
      if (reachesOutsideItsText(r.node)) effectful.push("<reaches outside its own text>");
    }
    const verdict: Verdict = pure.has(name) ? "pure" : effectful.length === 0 ? "pure-with-injection" : "effectful";
    const start = r.decl.getStart(sf);
    belt.push({
      name,
      chunk: layerChunk,
      offset: start,
      bytes: r.decl.getEnd() - start,
      declKind: declKindOf(r.decl, r.node),
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
      ...(() => {
        const { anchor, candidates } = anchorFor(r.decl, sf, text);
        return { anchor, anchorCandidates: candidates };
      })(),
    });
  }

  // ---- 4. module-level mutable state, and its ACTUAL scope ----------------
  // The design pass lists this as "the failure-notice singleton, the shutdown
  // flag, six host-scoped lazy singletons and a plugin-usage map … none of it
  // per-session, so a replay that does not reset it leaks between scenarios."
  // Two thirds of that survives measurement and one third does not, and the
  // part that does not is the part a harness would have written code for.
  const moduleState: StateCell[] = [];
  // Scoped to the cells the BELT actually reaches. The chunk carries scores of
  // keyed-lazy cells belonging to neighbouring modules; a reset list that
  // included them would be a list of somebody else's obligations.
  const referenced = new Set<string>();
  for (const b of belt) for (const f of b.free) referenced.add(f);
  const cellRe = /var ([\w$]+)=new ([\w$]+)\(\(\)=>/g;
  for (const m of text.matchAll(cellRe)) {
    const name = m[1];
    if (!referenced.has(name)) continue;
    const at = topLevel.get(name);
    if (at === undefined) continue;
    // A lazy cell is one whose binding is READ through a keyed accessor. The
    // key expression is the scope, and it is read off the call rather than
    // assumed: `.of(G().host)` is host-scoped, `.of(e.session.host)` likewise,
    // and a cell with no `.of(` at all is not one of these.
    const uses = [...text.matchAll(new RegExp(`${rx(name)}\\.of\\(([^)]*\\)?[^)]*)\\)`, "g"))].map((u) => u[1]);
    if (uses.length === 0) continue;
    const keyedBy = [...new Set(uses)].sort().join(" | ");
    moduleState.push({
      name,
      chunk: layerChunk,
      offset: m.index,
      kind: /host/i.test(keyedBy) ? "host-scoped-lazy" : "keyed-lazy",
      declaration: text.slice(m.index, m.index + 120),
      keyedBy,
      mutators: [...new Set([".add(", ".set(", ".delete(", ".clear("].filter((op) => text.includes(`${name}.of(`) && text.includes(op)))],
      resetBy: null,
    });
  }
  // The chunk this layer imports its shutdown predicate from is a module whose
  // WHOLE content is one mutable flag, one never-settling promise and three
  // functions. It is the one genuinely process-global cell here, it has a
  // setter and NO clearer, and it is why the non-settling grading mode exists.
  for (const { file, text: other } of bundle()) {
    if (!/class [\w$]+\{committed=!1\}/.test(other)) continue;
    const setter = other.match(/function ([\w$]+)\(\)\{[\w$]+\.committed=!0\}/);
    const reader = other.match(/function ([\w$]+)\(\)\{return [\w$]+\.committed\}/);
    moduleState.push({
      name: reader?.[1] ?? "<committed-flag>",
      chunk: file,
      offset: other.indexOf("class"),
      kind: "process-global",
      declaration: other.slice(other.indexOf("class"), other.indexOf("export{")).trim(),
      keyedBy: null,
      mutators: setter ? [`${setter[1]}()`] : [],
      resetBy: null,
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
      graphModules: bundle().length,
      reached: belt.length,
      pure: belt.filter((b) => b.verdict === "pure").length,
      pureWithInjection: belt.filter((b) => b.verdict === "pure-with-injection").length,
      effectful: belt.filter((b) => b.verdict === "effectful").length,
      boundary: external.size,
      pureBytes: sum("pure"),
      pureWithInjectionBytes: sum("pure-with-injection"),
      byKind: kindBreakdown(belt),
      pureWithUniqueAnchor: belt.filter((b) => b.verdict === "pure" && b.anchor !== null).length,
      reachedWithUniqueAnchor: belt.filter((b) => b.anchor !== null).length,
      reachedWithNoAnchor: belt.filter((b) => b.anchor === null).length,
      anchorScans: exactScans(),
    },
    belt,
    moduleState,
  };
}

// ---- bundle-wide measurements ----------------------------------------------
//
// The anchor rule itself moved to `anchor-enum.ts` when W8a needed the same
// measurement for the moat-tool belt. Copying it would have made "measure a
// mechanism by its own definition" true of two implementations that can drift;
// one module keeps it true of one.

/**
 * Identifier-boundary call sites, EXCLUDING a preceding `.`.
 *
 * The exclusion is the C10.5 correction: a regex that allows a leading dot
 * counts `x.Fq(` as a call to `Fq`, and one that requires a leading
 * non-identifier misses the spread form `...Fq(`. Both errors were made once in
 * this campaign, in opposite directions, on the same symbol.
 */
function countCallSites(chunkText: string, name: string): number {
  const re = new RegExp(`(^|[^\\w$.]|\\.\\.\\.)${rx(name)}\\s*\\(`, "g");
  const all = [...chunkText.matchAll(re)].length;
  const declared = new RegExp(`(^|[^\\w$.])function\\*?\\s*${rx(name)}\\s*\\(`, "g");
  return all - [...chunkText.matchAll(declared)].length;
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
    `  module state: ${fx.moduleState.length} cell(s) — ` +
      `${fx.moduleState.filter((c) => c.kind === "process-global").length} process-global with no clearer, ` +
      `${fx.moduleState.filter((c) => c.kind.endsWith("lazy")).length} keyed-lazy`,
  );
  console.log(`  declarations by kind: ${DECL_KINDS.map((k) => `${k}=${fx.counts.byKind[k].reached}/${fx.counts.byKind[k].pure} pure`).join(", ")}`);
  console.log(
    `  anchorability (shortest unique untainted substring, ${fx.counts.graphModules} graph modules, ${fx.counts.anchorScans} exact scans): ` +
      `${fx.counts.reachedWithUniqueAnchor} of ${fx.counts.reached} are anchorable (${fx.counts.pureWithUniqueAnchor} of them pure); ` +
      `${fx.counts.reachedWithNoAnchor} are not`,
  );
  console.log(
    `  pure and anchorable by kind: ${DECL_KINDS.filter((k) => fx.counts.byKind[k].pureAnchorable > 0).map((k) => `${k}=${fx.counts.byKind[k].pureAnchorable}`).join(", ") || "none"}`,
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
