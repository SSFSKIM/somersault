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
//
// Plus the §2.4 contract test for the one capture pair whose ownership retrofit
// has landed: text-delta's telemetry brands.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, excise, formatSignature } from "./ast.js";
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

console.log(`=== splice mechanism: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — footprint covers the closure surface, the inventory is exhaustive, the target guard holds, computed keys are refused, defaults forward once, anchor scoping is unambiguous"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
