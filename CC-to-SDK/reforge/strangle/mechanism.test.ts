// Splice-mechanism negative controls — the four integrity claims the transform
// makes, each watched FAILING on a fixture that violates it and PASSING on its
// legitimate neighbour (campaign spec W0 fix, lens 1; §3.1's non-vacuity
// doctrine: a check that is only ever fed valid input proves nothing about what
// it excludes).
//
//   npx tsx strangle/mechanism.test.ts
//
// Everything here runs on synthetic fixture chunks. The real bundle is never
// mutated — these are claims about the MECHANISM, and a mechanism test that
// needs the pinned extraction to be edited would be untestable at exactly the
// moment it matters.
//
//   footprint  perturbing a CAPTURED declaration's bytes must move that
//              capture's hash and must NOT move the target's — the whole point
//              of extending §5's footprint past the excised span.
//   closure    …and one level further out: perturbing what an OWNED helper
//              CALLS must move the footprint even though the helper itself, its
//              import site and the target are all byte-identical. Plus the
//              conservative fallback, watched firing: a callee the graph cannot
//              follow, or a closure too wide to enumerate, degrades to hashing
//              whole chunks rather than to a narrower record.
//   inventory  the manifest's captures must be exactly the body's free
//              variables: dropping one fails, inventing one fails.
//   signature  an anchor that drifts into a same-shaped NESTED node must fail
//              the target-identity guard rather than silently excise the inner
//              one.
//   computed   a computed property name in parameter destructuring must be
//              refused, because forwarding it would evaluate the key twice.
//   defaults   a destructuring DEFAULT must forward by its bound name and
//              evaluate exactly once (in the adapter's own parameter list),
//              while a nested pattern stays refused.
//   anchoring  a `coLiteral`-scoped anchor must still resolve to exactly one
//              node, and every way of mis-declaring the scope must throw.
//   arrow      an arrow initializing ONE declarator of a multi-declarator
//              `var` must excise the arrow alone, leaving its siblings byte
//              for byte — and a body reading `this` or `arguments` must be
//              refused, since an arrow inherits both lexically.
//   declarator a constant's initializer must excise alone, its delegation must
//              be an EXPRESSION, and a literal value must be recoverable so the
//              build can compare it against upstream's own bytes.
//   siblings   two nodes of one chunk carrying the same literal must be
//              separated by the verified signature — and when it cannot
//              separate them, the tie must throw rather than pick one.
//   generator  a generator target must delegate by `yield*`, carrying the
//              yielded sequence, the completion value and all three caller
//              signals — `next`, `throw` and the mid-stream `return` a consumer
//              that stops reading sends — and the signature must refuse a target
//              whose generator-ness moved in either direction.
//
// Plus the §2.4 contract test for the one capture pair whose ownership retrofit
// has landed: text-delta's telemetry brands.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, excise, formatSignature, literalStringValue, selectExcision } from "./ast.js";
import { spliceFootprint } from "./footprint.js";
import { REFORGE_ROOT } from "../src/runTurn.js";
import { assertCaptureInventory } from "./scope.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
function throws(label: string, fn: () => unknown, match: RegExp): void {
  try {
    fn();
    failures.push(`${label} — expected a throw, got none`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (!match.test(msg)) failures.push(`${label} — threw the wrong error: ${msg.split("\n")[0]}`);
    else pass++;
  }
}

// ---- fixtures ----------------------------------------------------------------
// A two-chunk fixture in the shape the real graph has: an owning chunk with a
// sibling-method target that captures a local constant and an IMPORTED helper.
const HELPER_SPECIFIER = "/fixture/chunk-helper.js";
const helperChunk = `function HELPER(o){return \`helper:\${o.n}\`}\nexport{HELPER};\n`;
const ownerChunk =
  `import{HELPER as help}from"${HELPER_SPECIFIER}";\n` +
  `var SUFFIX=" (fixture suffix)";\n` +
  `export const tools={mapResult(output,id){if(output.empty)return{id,content:"FIXTURE_ANCHOR_EMPTY"};return{id,content:help(output)+SUFFIX}}};\n`;

let fixtureSeq = 0;
/** Parse a fixture under a fresh virtual path — `chunkAst` caches by path. */
const parse = (text: string, hint = "owner") => chunkAst(`/fixture/${hint}-${fixtureSeq++}.js`, text);

function footprintOf(owner: string, helper: string) {
  const sf = parse(owner);
  const cut = excise(sf, owner.indexOf("FIXTURE_ANCHOR_EMPTY"), "sibling-method");
  return spliceFootprint({
    name: "fixture",
    chunk: "chunk-owner.js",
    sf,
    cut,
    captures: [
      { as: "suffix", kind: "primitive", owned: false, identifier: "SUFFIX" },
      { as: "helper", kind: "pure-helper", owned: false, identifier: "help" },
    ],
    resolveModule: (specifier) =>
      specifier === HELPER_SPECIFIER ? { name: "chunk-helper.js", sf: parse(helper, "helper") } : null,
    upstream: (t) => t,
  });
}

// ---- FINDING 1: the footprint covers the closure surface ---------------------
{
  const base = footprintOf(ownerChunk, helperChunk);
  const suffix = () => base.captures.find((c) => c.as === "suffix")!;
  const helper = () => base.captures.find((c) => c.as === "helper")!;
  check("footprint records a hash for every capture", base.captures.length === 2 && base.captures.every((c) => /^[0-9a-f]{64}$/.test(c.sha256)));
  check("an imported capture also records the exporting chunk's declaration",
    helper().from?.chunk === "chunk-helper.js" && helper().from?.exportedAs === "HELPER" && /^[0-9a-f]{64}$/.test(helper().from!.sha256));
  check("a local capture records no far side", suffix().from === undefined && suffix().declKind === "variable");

  // Perturb the CAPTURED CONSTANT only, byte-for-byte in place so no offset moves.
  const movedConstant = ownerChunk.replace(' (fixture suffix)"', ' (fixture SUFFIX)"');
  check("the constant perturbation is length-preserving", movedConstant.length === ownerChunk.length && movedConstant !== ownerChunk);
  const afterConstant = footprintOf(movedConstant, helperChunk);
  check("perturbing a captured constant moves ITS hash",
    afterConstant.captures.find((c) => c.as === "suffix")!.sha256 !== suffix().sha256);
  check("…and leaves the TARGET hash untouched", afterConstant.target.sha256 === base.target.sha256,
    "this is the defect: the old footprint hashed only the target span, so this change was invisible");
  check("…and leaves the OTHER capture's hash untouched",
    afterConstant.captures.find((c) => c.as === "helper")!.sha256 === helper().sha256);

  // Perturb the imported helper's BODY, in the exporting chunk.
  const movedHelper = helperChunk.replace("`helper:${o.n}`", "`HELPER:${o.n}`");
  check("the helper perturbation is length-preserving", movedHelper.length === helperChunk.length && movedHelper !== helperChunk);
  const afterHelper = footprintOf(ownerChunk, movedHelper);
  check("perturbing an imported helper's body moves its far-side hash",
    afterHelper.captures.find((c) => c.as === "helper")!.from!.sha256 !== helper().from!.sha256);
  check("…and leaves the TARGET hash untouched", afterHelper.target.sha256 === base.target.sha256);
  check("…and leaves the import-site hash untouched",
    afterHelper.captures.find((c) => c.as === "helper")!.sha256 === helper().sha256);
}

// ---- FINDING 1b: the OWNED capture's transitive callee closure ---------------
// The W1 boundary review's finding, on a fixture with the exact shape the real
// graph has: the owned helper's whole body is a delegation, so every byte that
// decides its behaviour lives in a callee the old record never touched.
{
  const DEEP_SPECIFIER = "/fixture/chunk-deep.js";
  const ABSENT_SPECIFIER = "/fixture/chunk-absent.js";
  // HELPER → DEEPEST → PAD: two levels, so `depth` has something to report.
  const deepChunk =
    `var PAD=" pad";\n` +
    `function DEEPEST(n){return \`d:\${n}\`+PAD}\n` +
    `function UNRELATED(x){return "untouched:"+x}\n` +
    `function HELPER(o){return DEEPEST(o.n)}\n` +
    `export{HELPER};\n`;
  const deepOwner =
    `import{HELPER as help}from"${DEEP_SPECIFIER}";\n` +
    `export const tools={mapResult(output,id){return{id,content:"DEEP_ANCHOR"+help(output)}}};\n`;

  /** `owned` decides whether the closure is walked at all — that is the claim. */
  const deepFootprint = (helperText: string, owned = true, owner = deepOwner) => {
    const sf = parse(owner, "deep-owner");
    const cut = excise(sf, owner.indexOf("DEEP_ANCHOR"), "sibling-method");
    return spliceFootprint({
      name: "fixture-deep",
      chunk: "chunk-owner.js",
      sf,
      cut,
      captures: [{ as: "helper", kind: "pure-helper", owned, identifier: "help" }],
      resolveModule: (specifier) =>
        specifier === DEEP_SPECIFIER ? { name: "chunk-deep.js", sf: parse(helperText, "deep") } : null,
      upstream: (t) => t,
    });
  };
  const only = (fp: ReturnType<typeof deepFootprint>) => fp.captures[0];
  const base = deepFootprint(deepChunk);
  const closure = only(base).closure ?? [];
  const nodeFor = (fp: ReturnType<typeof deepFootprint>, n: string) => (only(fp).closure ?? []).find((c) => c.name === n);

  check("an owned capture records its transitive callees, with depth",
    closure.length === 2 && nodeFor(base, "DEEPEST")?.depth === 1 && nodeFor(base, "PAD")?.depth === 2,
    JSON.stringify(closure.map((c) => `${c.name}@d${c.depth}`)));
  check("…each as a resolved declaration in the chunk that holds it",
    closure.every((c) => c.basis === "declaration" && c.chunk === "chunk-deep.js" && /^[0-9a-f]{64}$/.test(c.sha256)));
  check("a FORWARDED capture records none — upstream's own function still runs there",
    only(deepFootprint(deepChunk, false)).closure === undefined);
  // …and the two absences are distinguishable: an owned helper that calls
  // nothing says so, the same way `captures: []` is a positive claim.
  {
    const flat = `function HELPER(o){return "flat:"+o.n}\nexport{HELPER};\n`;
    check("an owned capture that calls nothing records an EMPTY closure, not no closure",
      JSON.stringify(only(deepFootprint(flat)).closure) === "[]");
  }

  // THE CONTROL. Perturb only the transitive callee, length-preserving, leaving
  // the helper's own bytes, its import site and the target span untouched.
  const movedDeep = deepChunk.replace("`d:${n}`", "`D:${n}`");
  check("the transitive perturbation is length-preserving", movedDeep.length === deepChunk.length && movedDeep !== deepChunk);
  const afterDeep = deepFootprint(movedDeep);
  check("perturbing a TRANSITIVE callee moves the emitted footprint",
    JSON.stringify(afterDeep) !== JSON.stringify(base),
    "THE DEFECT: the record stopped at the directly-captured helper, so a rewritten callee was invisible");
  check("…and it moves exactly that callee's hash",
    nodeFor(base, "DEEPEST") !== undefined && nodeFor(afterDeep, "DEEPEST")?.sha256 !== nodeFor(base, "DEEPEST")?.sha256);
  check("…while the captured helper's OWN declaration is byte-identical",
    only(afterDeep).from?.sha256 !== undefined && only(afterDeep).from?.sha256 === only(base).from?.sha256);
  check("…and the import site and the TARGET are untouched",
    only(afterDeep).sha256 === only(base).sha256 && afterDeep.target.sha256 === base.target.sha256);
  check("…and the callee's own callee is untouched",
    nodeFor(base, "PAD") !== undefined && nodeFor(afterDeep, "PAD")?.sha256 === nodeFor(base, "PAD")?.sha256);

  // Depth 2 is reached for real, not just labelled.
  const movedPad = deepChunk.replace('var PAD=" pad"', 'var PAD=" PAD"');
  const afterPad = deepFootprint(movedPad);
  check("perturbing a DEPTH-2 callee moves the emitted footprint too",
    JSON.stringify(afterPad) !== JSON.stringify(base));
  check("…and it moves exactly that callee's hash",
    nodeFor(base, "PAD") !== undefined && nodeFor(afterPad, "PAD")?.sha256 !== nodeFor(base, "PAD")?.sha256);

  // …and the record is an enumeration, not a chunk hash in disguise: a change to
  // a declaration nothing in the closure references must move nothing.
  const movedUnrelated = deepChunk.replace('"untouched:"', '"UNTOUCHED:"');
  check("the unrelated perturbation is length-preserving", movedUnrelated.length === deepChunk.length);
  const afterUnrelated = deepFootprint(movedUnrelated);
  check("a declaration OUTSIDE the closure moves nothing — the record is precise, not a whole-chunk hash",
    JSON.stringify(afterUnrelated) === JSON.stringify(base));

  // ---- the conservative fallback, watched firing ----
  const unreachable =
    `import{MISSING as gone}from"${ABSENT_SPECIFIER}";\n` +
    `function HELPER(o){return gone(o.n)}\n` +
    `export{HELPER};\n`;
  const bailed = deepFootprint(unreachable);
  const bailedClosure = only(bailed).closure ?? [];
  check("a callee the graph cannot follow degrades to a WHOLE-CHUNK hash, not to silence",
    bailedClosure.length === 1 && bailedClosure[0]?.basis === "whole-chunk" && bailedClosure[0]?.chunk === "chunk-deep.js" &&
      bailedClosure[0]?.declStart === 0 && bailedClosure[0]?.declEnd === unreachable.length);
  check("…and says why, on the node and on the capture",
    /cannot reach/.test(bailedClosure[0]?.note ?? "") && /could not be enumerated/.test(only(bailed).note ?? ""));
  check("…and that hash moves on ANY edit in the chunk it covers",
    bailedClosure[0] !== undefined &&
      (only(deepFootprint(unreachable.replace("o.n", "o.N"))).closure ?? [])[0]?.sha256 !== bailedClosure[0]?.sha256);

  // A BARE specifier is a boundary, not a hole (C5x unit 6): it is not in the
  // extracted graph, so the import SITE is recorded as a leaf and the walk keeps
  // going — where degrading to whole-chunk hashes would stale the row on
  // unrelated edits AND still cover nothing extra. The DISCRIMINATOR is
  // bareness, not builtin-ness, and the two do not license the same claim
  // (C5x fix, finding 4): `fs` is pinned by the runtime, so "no bundle bump can
  // change it" is exact; a bare non-builtin like `ws` is pinned by nothing this
  // repo measures and is unresolvable on the headless path. The note has to say
  // which, or the record over-claims for half the set the bundle actually has.
  {
    const external = (specifier: string) =>
      `import{readFileSync as rf}from"${specifier}";\n` +
      `var PAD2=" pad";\n` +
      `function DEEPEST2(n){return \`d:\${n}\`+PAD2}\n` +
      `function HELPER(o){return rf(o.path)+DEEPEST2(o.n)}\n` +
      `export{HELPER};\n`;
    const fp = only(deepFootprint(external("fs")));
    const closure = fp.closure ?? [];
    const leaf = closure.find((c) => c.name === "rf");
    check("an external import is a LEAF, not an abandonment",
      fp.note === undefined && closure.every((c) => c.basis === "declaration"), String(fp.note));
    check("…recorded at the import site, saying where it goes and why there is no far side",
      leaf?.declKind === "import" && /no far side to hash|far side to hash/.test(leaf?.note ?? ""), JSON.stringify(leaf));
    check("a BUILTIN leaf makes the strong claim — the runtime pin is what moves it",
      /Node builtin 'fs'/.test(leaf?.note ?? "") && /no bundle bump can change it/.test(leaf?.note ?? ""),
      String(leaf?.note));
    check("…and the walk continues past it to the real callees",
      closure.some((c) => c.name === "DEEPEST2") && closure.some((c) => c.name === "PAD2"),
      JSON.stringify(closure.map((c) => c.name)));
    // THE CONTROL for the over-claim: same leaf shape, bare NON-builtin. `ws` is
    // the one the pinned bundle actually has.
    const bare = only(deepFootprint(external("ws")));
    const bareLeaf = (bare.closure ?? []).find((c) => c.name === "rf");
    check("a bare NON-builtin is a leaf on the same terms",
      bare.note === undefined && bareLeaf?.declKind === "import" && (bare.closure ?? []).some((c) => c.name === "DEEPEST2"),
      JSON.stringify(bareLeaf));
    check("…but does NOT claim the runtime pin holds it — it is external-unresolvable, dead on the headless path",
      /bare external module 'ws'/.test(bareLeaf?.note ?? "") &&
        /NOT a Node builtin/.test(bareLeaf?.note ?? "") &&
        !/no bundle bump can change it/.test(bareLeaf?.note ?? ""),
      String(bareLeaf?.note));
    check("…while a specifier that IS a graph path and does not resolve still abandons",
      /could not be enumerated/.test(only(deepFootprint(unreachable)).note ?? ""));
  }

  // Too WIDE rather than unreachable: the same degradation, on the budget.
  const wide = new Array(25).fill(0).map((_, i) => `function W${i}(){return ${i}}`).join("\n");
  const wideChunk = `${wide}\nfunction HELPER(o){return [${new Array(25).fill(0).map((_, i) => `W${i}`).join(",")}].length+o.n}\nexport{HELPER};\n`;
  const wideFp = only(deepFootprint(wideChunk)).closure ?? [];
  check("a closure too wide to enumerate degrades the same way",
    wideFp.length === 1 && wideFp[0]?.basis === "whole-chunk" && /exceeds 20 declarations/.test(wideFp[0]?.note ?? ""));
}

// ---- FINDING 2: the capture inventory is exhaustive, both directions ---------
{
  const sf = parse(ownerChunk);
  const cut = excise(sf, ownerChunk.indexOf("FIXTURE_ANCHOR_EMPTY"), "sibling-method");
  const declared = ["SUFFIX", "help"];
  check("the complete inventory is accepted", (() => {
    const free = assertCaptureInventory("fixture", cut.node, declared);
    return free.length === 2 && free.includes("SUFFIX") && free.includes("help");
  })());
  throws("a DROPPED capture is rejected", () => assertCaptureInventory("fixture", cut.node, ["SUFFIX"]), /UNDECLARED.*help/s);
  throws("a PHANTOM capture is rejected", () => assertCaptureInventory("fixture", cut.node, [...declared, "notThere"]), /PHANTOM.*notThere/s);
  check("parameters are not mistaken for captures", !assertCaptureInventory("fixture", cut.node, declared).includes("output"));

  // A body with genuinely no free variables: `captures: []` is a positive claim.
  const closed = `export const tools={mapResult(output,id){return{id,content:"CLOSED_ANCHOR"+output.n+JSON.stringify(output)}}};\n`;
  const closedCut = excise(parse(closed, "closed"), closed.indexOf("CLOSED_ANCHOR"), "sibling-method");
  check("a closed body reports zero free variables (globals are not captures)",
    assertCaptureInventory("fixture-closed", closedCut.node, []).length === 0);
  throws("…and a phantom on a closed body still fails",
    () => assertCaptureInventory("fixture-closed", closedCut.node, ["ghost"]), /PHANTOM/);
}

// ---- FINDING 3: the target-identity guard ------------------------------------
{
  const drift =
    `export const tools={outer(a,b){const nested={inner(x,y){return "DRIFTED_ANCHOR"+x+y}};` +
    `if(a)return "VERIFIED_ANCHOR";return nested.inner(a,b)}};\n`;
  const sf = parse(drift, "drift");
  const outer = excise(sf, drift.indexOf("VERIFIED_ANCHOR"), "sibling-method");
  const inner = excise(sf, drift.indexOf("DRIFTED_ANCHOR"), "sibling-method");
  check("the verified anchor resolves to the outer method", outer.label === "outer");
  check("an anchor inside a same-shaped nested method resolves to the INNER one — the defect", inner.label === "inner");
  check("both have the same arity, so arity alone cannot tell them apart", outer.signature.params === inner.signature.params);
  check("the recorded signature accepts the verified target", (() => {
    assertSignature("fixture", outer, { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] });
    return true;
  })());
  throws("…and REJECTS the drifted one",
    () => assertSignature("fixture", inner, { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] }),
    /no longer resolves to the verified target/);
  check("the failure names both signatures so the operator can adjudicate",
    formatSignature(inner.signature).includes("MethodDeclaration") && !formatSignature(outer.signature).includes("MethodDeclaration"));
}

// ---- FINDING 4: computed property names in parameter destructuring -----------
{
  const computed =
    `export const tools={bad({[keyExpr()]:v},id){return{id,content:"COMPUTED_ANCHOR"+v}},` +
    `good({a:v},id){return{id,content:"PLAIN_ANCHOR"+v}}};\n`;
  const sf = parse(computed, "computed");
  throws("a computed property name in parameter destructuring fails the build",
    () => excise(sf, computed.indexOf("COMPUTED_ANCHOR"), "sibling-method"),
    /COMPUTED property name/);
  check("a plain renamed property still forwards", (() => {
    const cut = excise(sf, computed.indexOf("PLAIN_ANCHOR"), "sibling-method");
    return cut.render("f", cut.shapeArgs) === `good({a:v},id){return globalThis.__reforge.f({a:v},id)}`;
  })());
}

// ---- FINDING 4b: destructuring DEFAULTS forward; nesting still refuses -------
// C4 / W1 relaxed the blanket refusal of parameter-destructuring defaults (the
// Grep result formatter's first parameter is `{mode:e="files_with_matches", …}`).
// The claim being tested: the default is reproduced VERBATIM in the delegation's
// own parameter list, so it is applied exactly once, and what the owned module
// receives is the bound value the original body used.
{
  const defaulted =
    `export const tools={withDefault({mode:m="fallback",n},id){return{id,content:"DEFAULT_ANCHOR"+m+n}},` +
    `nestedDefault({a:{b:v}={b:1}},id){return{id,content:"NESTED_ANCHOR"+v}}};\n`;
  const sf = parse(defaulted, "defaulted");
  const cut = excise(sf, defaulted.indexOf("DEFAULT_ANCHOR"), "sibling-method");
  check("a destructuring default forwards by its BOUND name",
    cut.render("f", cut.shapeArgs) ===
      `withDefault({mode:m="fallback",n},id){return globalThis.__reforge.f({mode:m,n},id)}`);
  check("…and the default itself survives in the adapter's parameter list, so it applies exactly once",
    (cut.render("f", cut.shapeArgs).match(/"fallback"/g) ?? []).length === 1);
  // The behavioural claim, executed: an omitted property reaches the delegate
  // defaulted, and a supplied one reaches it verbatim.
  {
    const seen: unknown[] = [];
    const adapter = new Function(
      "sink",
      `globalThis.__reforge={f:(o,id)=>sink(o,id)};const t={${cut.render("f", cut.shapeArgs)}};return t;`,
    )((o: unknown, id: unknown) => {
      seen.push(o, id);
      return { id };
    }) as { withDefault(o: unknown, id: unknown): unknown };
    adapter.withDefault({ n: 7 }, "id1");
    adapter.withDefault({ mode: "explicit", n: 8 }, "id2");
    check("an omitted property arrives DEFAULTED at the delegate",
      JSON.stringify(seen[0]) === JSON.stringify({ mode: "fallback", n: 7 }));
    check("a supplied property arrives verbatim", JSON.stringify(seen[2]) === JSON.stringify({ mode: "explicit", n: 8 }));
  }
  throws("a default inside a NESTED pattern is still refused",
    () => excise(sf, defaulted.indexOf("NESTED_ANCHOR"), "sibling-method"),
    /nests a binding pattern/);
}

// ---- FINDING 5: the owned telemetry brands (§2.4 pure-helper contract) -------
{
  await import(pathToFileURL(join(REFORGE_ROOT, "strangle", "modules", "text-delta.js")).href);
  const reforge = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => unknown> }).__reforge!;
  check("appendTextDelta takes only its effectful captures — the brands are owned",
    reforge.appendTextDelta.length === 3);

  const block = { type: "text", text: "he" };
  reforge.appendTextDelta(block, { type: "text_delta", text: "llo" }, () => {
    throw new Error("telemetry must not fire on the happy path");
  });
  check("a text delta is folded into the block in place", block.text === "hello");

  const seen: unknown[] = [];
  throws("a type-mismatched block still throws", () =>
    reforge.appendTextDelta({ type: "thinking" }, { text: "x" }, (event: unknown, payload: unknown) => {
      seen.push(event, payload);
    }), /not a text block/);
  check("…after reporting through the effectful sink", seen[0] === "tengu_streaming_error");
  check("the owned brands are identity, exactly as chunk-9rhc0mtn's `w`/`c` are",
    JSON.stringify(seen[1]) === JSON.stringify({
      error_type: "content_block_type_mismatch_text",
      expected_type: "text",
      actual_type: "thinking",
    }));
}

// ---- FINDING 6: co-literal anchor scoping (C4 / contract X3) ----------------
// The Bash formatter's only distinctive literal occurs in TWO chunks, so a row
// may name a second literal that must occur in the same chunk. Every way of
// getting that wrong has to be loud — a scope that silently selects one of two
// candidates is worse than no scope at all.
{
  const engine = `var tool={fmt(){return"AMBIGUOUS_ANCHOR"},hint:"execute shell commands"};\n`;
  const sibling = `var other={fmt(){return"AMBIGUOUS_ANCHOR"},hint:"run powershell"};\n`;
  const solo = `var third={fmt(){return"SOLO_ANCHOR"}};\n`;
  const graph = new Map([["/g/engine.js", engine], ["/g/sibling.js", sibling], ["/g/third.js", solo]]);

  check("an unscoped, graph-unique anchor resolves",
    resolveAnchor(graph, { name: "solo", anchor: "SOLO_ANCHOR" }).path === "/g/third.js");
  throws("an unscoped AMBIGUOUS anchor is refused, and the message says how to scope it",
    () => resolveAnchor(graph, { name: "amb", anchor: "AMBIGUOUS_ANCHOR" }),
    /not unique in the graph — 2 matches.*coLiteral/s);
  check("a co-occurring literal selects the intended chunk",
    resolveAnchor(graph, { name: "amb", anchor: "AMBIGUOUS_ANCHOR", coLiteral: "execute shell commands" }).path ===
      "/g/engine.js");
  throws("a coLiteral that occurs NOWHERE fails loudly instead of degrading to no scope",
    () => resolveAnchor(graph, { name: "amb", anchor: "AMBIGUOUS_ANCHOR", coLiteral: "no such literal" }),
    /occurs nowhere in the graph/);
  throws("a coLiteral that never co-occurs with the anchor fails loudly",
    () => resolveAnchor(graph, { name: "amb", anchor: "AMBIGUOUS_ANCHOR", coLiteral: "var third" }),
    /never co-occur/);
  throws("a coLiteral present in BOTH candidates leaves the anchor ambiguous, and is refused",
    () => resolveAnchor(graph, { name: "amb", anchor: "AMBIGUOUS_ANCHOR", coLiteral: "hint:" }),
    /not unique in chunks containing/);
  throws("an anchor that occurs twice in ONE chunk is refused even inside a scope",
    () =>
      resolveAnchor(new Map([["/g/engine.js", engine + engine]]), {
        name: "amb",
        anchor: "AMBIGUOUS_ANCHOR",
        coLiteral: "execute shell commands",
      }),
    /not unique in chunks containing/);
  throws("a missing anchor is still the first failure",
    () => resolveAnchor(graph, { name: "gone", anchor: "NOT_PRESENT", coLiteral: "hint:" }),
    /anchor not found anywhere/);
}

// ---- FINDING 7: `yield*` delegation for generator targets (C5x unit 1) ------
// The eight hook dispatchers are `async function*`, and a `return`-shaped
// delegation cannot carry a generator: the caller drives it with
// `next`/`throw`/`return` and reads results as they arrive. The claim tested is
// that all three parts of the contract cross the seam — the yielded sequence,
// the completion value, and two-way signalling in every direction the caller can
// signal, INCLUDING the early `return()` an interrupted consumer sends — and
// that the signature refuses a target whose generator-ness moved.
{
  const gens =
    `async function*streamed(a,b){yield "GEN_ANCHOR"+a;yield b;return "done:"+a}\n` +
    `async function plainly(a,b){return "PLAIN_ANCHOR"+a+b}\n`;
  const sf = parse(gens, "gens");
  const gen = excise(sf, gens.indexOf("GEN_ANCHOR"), "free-function");
  const plain = excise(sf, gens.indexOf("PLAIN_ANCHOR"), "free-function");
  check("a generator target renders a yield* delegation, not a return",
    gen.render("f", gen.shapeArgs) === `async function*streamed(a,b){return yield*globalThis.__reforge.f(a,b)}`,
    gen.render("f", gen.shapeArgs));
  check("…and a non-generator sibling still renders the return form",
    plain.render("f", plain.shapeArgs) === `async function plainly(a,b){return globalThis.__reforge.f(a,b)}`);
  check("the signature records generator-ness", gen.signature.generator === true && plain.signature.generator === undefined);
  throws("a target that stopped being a generator fails the identity guard",
    () => assertSignature("fixture", plain, { params: 2, ancestry: ["SourceFile"], generator: true }),
    /no longer resolves to the verified target/);
  throws("…and so does one that became one",
    () => assertSignature("fixture", gen, { params: 2, ancestry: ["SourceFile"] }),
    /no longer resolves to the verified target/);
  check("the failure says which one it saw", formatSignature(gen.signature).includes("generator"));

  // The behavioural half: run the rendered delegation against a stub delegate.
  const delegation = new Function(
    "delegate",
    `globalThis.__reforge={f:delegate};${gen.render("f", gen.shapeArgs)};return streamed;`,
  )(async function* (a: string, b: string): AsyncGenerator<string, string, string> {
    const sent = yield `d:${a}`;
    yield `${b}:${sent}`;
    return `ret:${a}`;
  }) as (a: string, b: string) => AsyncGenerator<string, string, string>;

  const it = delegation("A", "B");
  const first = await it.next("ignored");
  const second = await it.next("SENT");
  const done = await it.next("x");
  check("the delegate's yields reach the caller in order", first.value === "d:A" && second.value === "B:SENT",
    JSON.stringify([first.value, second.value]));
  check("…the value the caller sends reaches the delegate", second.value === "B:SENT");
  check("…and the delegate's RETURN value becomes the generator's", done.done === true && done.value === "ret:A",
    JSON.stringify(done));

  // `throw()` must reach the delegate rather than being swallowed by the seam.
  let caughtInside: unknown = null;
  const thrower = new Function(
    "delegate",
    `globalThis.__reforge={f:delegate};${gen.render("f", gen.shapeArgs)};return streamed;`,
  )(async function* (): AsyncGenerator<string, string, unknown> {
    try {
      yield "first";
    } catch (e) {
      caughtInside = e;
      return "caught";
    }
    return "not caught";
  }) as () => AsyncGenerator<string, string, unknown>;
  const t = thrower();
  await t.next();
  const after = await t.throw(new Error("REFORGE_THROWN"));
  check("a throw() from the caller propagates INTO the delegate",
    (caughtInside as Error | null)?.message === "REFORGE_THROWN" && after.value === "caught",
    JSON.stringify({ caught: (caughtInside as Error | null)?.message, after }));

  // …and the third signal, which is the one the engine actually sends: a
  // consumer that stops reading mid-stream calls `.return()`. Upstream's hook
  // dispatchers are driven by a loop that breaks on the first blocking decision,
  // so the interrupt path is the COMMON path, not an edge case — and a seam that
  // swallowed it would leave the delegate's `finally` unrun (its abort
  // controllers, its temp files, its spans) while the caller believed the
  // generator had been closed. `return yield*` forwards it: the delegation calls
  // the delegate's own `.return()`, so the inner `finally` runs and the sentinel
  // becomes the outer generator's completion value.
  let ranFinally = false;
  let resumedAfterReturn = false;
  const closer = new Function(
    "delegate",
    `globalThis.__reforge={f:delegate};${gen.render("f", gen.shapeArgs)};return streamed;`,
  )(async function* (): AsyncGenerator<string, string, unknown> {
    try {
      yield "first";
      yield "second";
      resumedAfterReturn = true;
      return "ran to completion";
    } finally {
      ranFinally = true;
    }
  }) as () => AsyncGenerator<string, string, unknown>;
  const c = closer();
  const opened = await c.next();
  const closed = await c.return("RETURN_SENTINEL" as unknown as string);
  check("the first yield arrives before the interrupt", opened.value === "first" && opened.done === false);
  check("a return() from the caller runs the delegate's finally",
    ranFinally && !resumedAfterReturn, JSON.stringify({ ranFinally, resumedAfterReturn }));
  check("…and the caller's sentinel becomes the generator's completion value",
    closed.done === true && closed.value === "RETURN_SENTINEL", JSON.stringify(closed));
  check("…and the outer generator's own `return` never runs — the return completion propagates through the yield*",
    closed.value !== "done:A");
  const afterClose = await c.next();
  check("…and the generator stays closed afterwards",
    afterClose.done === true && afterClose.value === undefined, JSON.stringify(afterClose));
}

// ---- FINDING 8: same-chunk sibling disambiguation (C5x unit 4) --------------
// `coLiteral` scopes to a CHUNK, so it cannot separate two nodes inside one —
// and the graph has such pairs for reasons that are not drift (a shared prompt
// preamble; a decision value the caller and the callee both stamp). The
// signature can tell them apart; before this it only ever verified AFTER
// selection. Both halves are watched: it selects, and when it cannot, it says so
// instead of picking one.
{
  const twins =
    `function first(a){return "TWIN_ANCHOR"+a}\n` +
    `function second(a,b){return "TWIN_ANCHOR"+a+b}\n`;
  const sf = parse(twins, "twins");
  const offsets: number[] = [];
  for (let i = twins.indexOf("TWIN_ANCHOR"); i >= 0; i = twins.indexOf("TWIN_ANCHOR", i + 1)) offsets.push(i);
  check("the fixture really is ambiguous", offsets.length === 2);
  check("the signature SELECTS the one-parameter sibling",
    selectExcision("fixture", sf, offsets, "free-function", { params: 1, ancestry: ["SourceFile"] }).label === "first");
  check("…and the two-parameter one",
    selectExcision("fixture", sf, offsets, "free-function", { params: 2, ancestry: ["SourceFile"] }).label === "second");
  throws("a signature matching NEITHER names every candidate rather than guessing",
    () => selectExcision("fixture", sf, offsets, "free-function", { params: 3, ancestry: ["SourceFile"] }),
    /none of the 2 same-anchored candidates.*first.*second/s);

  // THE TIE. Two siblings the signature cannot separate must fail loudly:
  // picking the first is the coin flip the uniqueness rule exists to forbid.
  const tied = `function alpha(a){return "TIED_ANCHOR"+a}\nfunction beta(a){return "TIED_ANCHOR"+a}\n`;
  const tsf = parse(tied, "tied");
  const tOffsets: number[] = [];
  for (let i = tied.indexOf("TIED_ANCHOR"); i >= 0; i = tied.indexOf("TIED_ANCHOR", i + 1)) tOffsets.push(i);
  throws("two candidates the signature cannot separate is a TIE, and a tie throws",
    () => selectExcision("fixture", tsf, tOffsets, "free-function", { params: 1, ancestry: ["SourceFile"] }),
    /TIE across 2 candidates/);

  // The count is part of what the row verified: the resolver refuses an anchor
  // that occurs a different number of times than declared, in either direction.
  const graph = new Map([["/g/twins.js", twins], ["/g/other.js", `function far(a){return "FAR_ANCHOR"+a}\n`]]);
  throws("an undeclared second occurrence is still refused",
    () => resolveAnchor(graph, { name: "amb", anchor: "TWIN_ANCHOR" }), /not unique in the graph — 2 matches/);
  check("a declared count admits exactly that many offsets",
    resolveAnchor(graph, { name: "amb", anchor: "TWIN_ANCHOR", siblings: 2 }).offsets.length === 2);
  throws("a declared count that no longer matches fails loudly",
    () => resolveAnchor(graph, { name: "amb", anchor: "TWIN_ANCHOR", siblings: 3 }),
    /declares siblings: 3 but the anchor occurs 2×/);
  throws("…and siblings never spans two chunks, whatever the count says",
    () =>
      resolveAnchor(new Map([["/g/a.js", twins], ["/g/b.js", twins]]), { name: "amb", anchor: "TWIN_ANCHOR", siblings: 4 }),
    /not all in one chunk/);
}

// ---- FINDING 9: the arrow-initializer shape (C5x unit 2) --------------------
// The permission chain is one `var` statement with three arrow declarators, so
// the transform has to take ONE initializer and leave its neighbours, the commas
// between them and the `var` keyword exactly where they were. The two things an
// arrow inherits lexically — `this` and `arguments` — make a body unmovable, and
// both are refused rather than approximated.
{
  const chain =
    `var first=async(a,b)=>{return "ARROW_ANCHOR"+a+b},second=(x)=>{return "SIB_ANCHOR"+x},third=42;\n` +
    `function outer(){var bound=()=>{return "THIS_ANCHOR"+this.x},args=()=>{return "ARGS_ANCHOR"+arguments.length};return [bound,args]}\n`;
  const sf = parse(chain, "arrows");
  const cut = excise(sf, chain.indexOf("ARROW_ANCHOR"), "arrow-initializer");
  check("the excised span is the ARROW, not the declarator or the statement",
    cut.original === `async(a,b)=>{return "ARROW_ANCHOR"+a+b}`, cut.original);
  check("the delegation keeps the arrow shape and the async modifier",
    cut.render("f", cut.shapeArgs) === `async (a,b)=>globalThis.__reforge.f(a,b)`, cut.render("f", cut.shapeArgs));
  check("the signature records which declarator it is", cut.signature.declarator === 0 && cut.signature.params === 2);
  check("…and its sibling's is different",
    excise(sf, chain.indexOf("SIB_ANCHOR"), "arrow-initializer").signature.declarator === 1);

  // Applied to the source, the neighbours must survive byte-for-byte.
  const spliced = chain.slice(0, cut.start) + cut.render("f", cut.shapeArgs) + chain.slice(cut.end);
  check("splicing one declarator leaves the siblings untouched",
    spliced.includes(`second=(x)=>{return "SIB_ANCHOR"+x}`) && spliced.includes("third=42") && spliced.startsWith("var first="),
    spliced.split("\n")[0]);

  throws("an arrow whose body reads `this` is refused — it inherits it lexically",
    () => excise(sf, chain.indexOf("THIS_ANCHOR"), "arrow-initializer"), /reads `this`/);
  throws("…and one reading `arguments`, which the capture inventory calls ambient",
    () => excise(sf, chain.indexOf("ARGS_ANCHOR"), "arrow-initializer"), /reads `arguments`/);

  // The real pair this shape exists for: same anchor, same arity, same ancestry
  // — separable ONLY by declaration-list position.
  const twins = `var small=(a)=>{return "PAIR_ANCHOR"+a},big=(a)=>{return "PAIR_ANCHOR"+a+a+a};\n`;
  const tsf = parse(twins, "arrow-twins");
  const offsets: number[] = [];
  for (let i = twins.indexOf("PAIR_ANCHOR"); i >= 0; i = twins.indexOf("PAIR_ANCHOR", i + 1)) offsets.push(i);
  check("the declarator index selects among otherwise identical siblings",
    selectExcision("fixture", tsf, offsets, "arrow-initializer", { params: 1, ancestry: ["SourceFile"], declarator: 1 }).label === "big");
  throws("…and without it they tie, exactly as params+ancestry alone would",
    () => selectExcision("fixture", tsf, offsets, "arrow-initializer", { params: 1, ancestry: ["SourceFile"] }),
    /TIE across 2 candidates/);
}

// ---- FINDING 10: the variable-declarator shape (C5x unit 3) -----------------
// Prompt text lives in `var` initializers, and a prompt's VALUE is its
// behaviour — the one class of upstream change no anchor, target hash or capture
// hash can see. The shape excises the initializer alone, and the build compares
// the owned value against upstream's bytes (`literalStringValue`), which is what
// makes that class of change loud.
{
  const consts =
    "var promptA=`head ${\"middle\"} tail: DECL_ANCHOR`,promptB=\"other\",count=7;\n" +
    "var lazy=(x)=>{return \"FN_ANCHOR\"+x};\n";
  const sf = parse(consts, "consts");
  const cut = excise(sf, consts.indexOf("DECL_ANCHOR"), "variable-declarator");
  check("the excised span is the INITIALIZER, not the declarator",
    cut.original.startsWith("`head") && cut.original.endsWith("`"), cut.original);
  check("the delegation is an expression, not a statement",
    cut.render("f", cut.shapeArgs) === "globalThis.__reforge.f()", cut.render("f", cut.shapeArgs));
  check("the value is folded through the template's literal substitution",
    literalStringValue(cut.node) === "head middle tail: DECL_ANCHOR", String(literalStringValue(cut.node)));
  const spliced = consts.slice(0, cut.start) + cut.render("f", cut.shapeArgs) + consts.slice(cut.end);
  check("splicing it leaves the sibling declarators untouched",
    spliced.includes('promptB="other"') && spliced.includes("count=7") && spliced.startsWith("var promptA=globalThis"));
  throws("a function-like initializer is refused, and names the shape that owns it",
    () => excise(sf, consts.indexOf("FN_ANCHOR"), "variable-declarator"), /arrow-initializer/);
  check("a non-literal initializer reports no value rather than being evaluated",
    literalStringValue(excise(sf, consts.indexOf("FN_ANCHOR"), "arrow-initializer").node) === null);
}

console.log(`=== splice mechanism: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — footprint covers the closure surface, the inventory is exhaustive, the target guard holds, computed keys are refused, defaults forward once, anchor scoping is unambiguous, generators delegate by yield*, same-anchored siblings are selected or refused, arrow initializers excise alone, declarator values are recoverable"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
