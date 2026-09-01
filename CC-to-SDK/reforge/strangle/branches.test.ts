// Branch-instrumenter negative controls — the inventory's two claims, each
// watched failing on a fixture that violates it and passing on its legitimate
// neighbour (campaign spec §3.1; C5x unit 7).
//
//   npx tsx strangle/branches.test.ts
//
// The claims:
//
//   COMPLETE      every branch-forming construct is either recorded or REFUSED
//                 by name. A construct the instrumenter silently skipped would
//                 make the attestation report full coverage of the subset it
//                 understood — the vacuous pass §3.1 exists to forbid. So every
//                 refusal has a fixture here, and so does its recordable
//                 neighbour: a rule that refuses everything is as useless as one
//                 that refuses nothing.
//   FAITHFUL      the instrumented module BEHAVES identically and its recorded
//                 outcomes are the arms that actually ran. Every construct below
//                 is therefore instrumented, executed for real, and its return
//                 value compared against the same fixture uninstrumented.
//
// The instrumented fixtures are written under build/ (gitignored) and imported,
// so what is graded is real execution rather than a reading of the rewrite.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { branchSites, instrumentSource, outcomesOf } from "./branches.js";
import { BUILD_DIR } from "./prepare.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
function refuses(label: string, source: string, match: RegExp): void {
  try {
    branchSites("fixture", "/fixture/x.js", source);
    failures.push(`${label} — expected a refusal, got an inventory`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (!match.test(msg)) failures.push(`${label} — refused for the wrong reason: ${msg.split("\n")[0]}`);
    else pass++;
  }
}

const ROOT = join(BUILD_DIR, "branch-fixtures");
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(
  join(ROOT, "recorder.js"),
  `export const seen = [];\n` +
    `export function __cov(id, value) { seen.push(id + (value ? ":T" : ":F")); return value; }\n` +
    `export function __covN(id, value) { seen.push(id + (value === null || value === undefined ? ":T" : ":F")); return value; }\n` +
    `export function __covS(outcome) { seen.push(outcome); }\n`,
);

let seq = 0;
/**
 * Instrument a fixture, run BOTH versions, and return what ran. The plain
 * version is the faithfulness oracle: instrumentation that changes a result is
 * measuring a different module.
 */
async function exercise(source: string, call: (m: Record<string, (...a: unknown[]) => unknown>) => unknown) {
  const n = seq++;
  const sites = branchSites("fx", `/fixture/fx${n}.js`, source);
  const plainPath = join(ROOT, `plain${n}.mjs`);
  const instrPath = join(ROOT, `instr${n}.mjs`);
  writeFileSync(plainPath, source);
  writeFileSync(instrPath, instrumentSource(source, sites, "./recorder.js"));
  const plain = (await import(pathToFileURL(plainPath).href)) as Record<string, (...a: unknown[]) => unknown>;
  const instrumented = (await import(pathToFileURL(instrPath).href)) as Record<string, (...a: unknown[]) => unknown>;
  const recorder = (await import(pathToFileURL(join(ROOT, "recorder.js")).href)) as { seen: string[] };
  const before = recorder.seen.length;
  const got = await call(instrumented);
  const want = await call(plain);
  return {
    sites,
    inventory: sites.flatMap(outcomesOf),
    ran: recorder.seen.slice(before),
    identical: JSON.stringify(got) === JSON.stringify(want),
    got,
  };
}

// ---- SWITCH ------------------------------------------------------------------
{
  const source =
    `export function classify(x){switch(x){case 1:case 2:return "low";case 3:return "three";default:return "other"}}\n`;
  const r = await exercise(source, (m) => [m.classify(1), m.classify(2), m.classify(3), m.classify(9)]);
  check("a switch clause is one site with one `taken` outcome",
    r.sites.filter((s) => s.kind === "clause").length === 4 && r.sites.every((s) => s.kind !== "clause" || s.outcomes.join() === "taken"),
    JSON.stringify(r.sites.map((s) => [s.kind, s.outcomes])));
  check("…including the empty fall-through clause, marked after its colon",
    r.inventory.filter((o) => o.endsWith(":taken")).length === 4);
  check("instrumenting a switch does not change what it returns", r.identical, JSON.stringify(r.got));
  check("every clause that ran is recorded, the empty fall-through included",
    new Set(r.ran).size === 4 && r.ran.every((o) => o.endsWith(":taken")), JSON.stringify(r.ran));

  // …and a clause nothing reaches stays unrecorded, which is what makes an
  // unexercised protocol arm visible in the attestation instead of assumed.
  const partial = await exercise(source, (m) => m.classify(9));
  check("a clause nothing reaches stays unrecorded",
    partial.ran.length === 1 && partial.ran[0] === "fx#classify@3:taken", JSON.stringify(partial.ran));

  refuses("a switch with no default is refused — the no-match path is an arm of no clause",
    `export function f(x){switch(x){case 1:return "one";case 2:return "two"}return "none"}\n`,
    /switch without a `default` clause/);
}

// ---- TRY / CATCH -------------------------------------------------------------
{
  const source =
    `export function guarded(fn){let out="ok";try{out=fn()}catch(e){out="caught:"+e.message}return out}\n`;
  const r = await exercise(source, (m) => [m.guarded(() => "fine"), m.guarded(() => { throw new Error("boom"); })]);
  const site = r.sites.find((s) => s.kind === "try");
  check("a try/catch is ONE site with two outcomes", site !== undefined && site.outcomes.join() === "T,F",
    JSON.stringify(r.sites.map((s) => [s.kind, s.outcomes])));
  check("instrumenting it does not change what it returns", r.identical, JSON.stringify(r.got));
  check("both arms are recorded when both run",
    site !== undefined && r.ran.includes(`${site.id}:T`) && r.ran.includes(`${site.id}:F`), JSON.stringify(r.ran));

  // Only the non-throwing path: the catch arm must stay UNrecorded, which is
  // what makes an unexercised error path visible in the attestation.
  const quiet = await exercise(
    `export function quiet(fn){let out="ok";try{out=fn()}catch(e){out="x"}return out}\n`,
    (m) => m.quiet(() => "fine"),
  );
  const qs = quiet.sites.find((s) => s.kind === "try")!;
  check("a try whose catch never runs records only the completed arm",
    quiet.ran.includes(`${qs.id}:F`) && !quiet.ran.includes(`${qs.id}:T`), JSON.stringify(quiet.ran));

  refuses("try/finally with no catch is refused",
    `export function f(){try{go()}finally{done()}}\n`, /try\/finally with no catch/);
  refuses("a try block that can `return` is refused — the end-of-try marker would be skipped",
    `export function f(a){try{if(a)return 1;go()}catch(e){return 2}return 3}\n`,
    /complete abruptly/);
  check("…while a try whose only escape is a THROW is fine (that is the arm being measured)", (() => {
    const sites = branchSites("fx", "/fixture/throwing.js", `export function f(a){try{if(a)throw new Error("x");go()}catch(e){}return 1}\n`);
    return sites.some((s) => s.kind === "try");
  })());
  check("…and a `return` inside a nested function in the try does not count as an escape", (() => {
    const sites = branchSites("fx", "/fixture/nested.js", `export function f(){try{run(()=>{return 1})}catch(e){}return 2}\n`);
    return sites.some((s) => s.kind === "try");
  })());
}

// ---- LOOPS -------------------------------------------------------------------
{
  // A conditional loop is recorded EXACTLY, by its condition: F is the
  // zero-iteration arm, T is "the body ran". No marker, no approximation.
  const source =
    `export function sum(n){let t=0,i=0;while(i<n){t+=i;i++}return t}\n` +
    `export function each(xs){let out=[];for(const x of xs){out.push(x)}return out}\n`;
  const r = await exercise(source, (m) => [m.sum(3), m.sum(0), m.each([1, 2]), m.each([])]);
  const loop = r.sites.filter((s) => s.kind === "loop");
  check("a while loop is recorded by its condition, with two outcomes",
    loop[0]?.outcomes.join() === "T,F", JSON.stringify(loop.map((s) => [s.text, s.outcomes])));
  check("a for..of is recorded by a body marker, with one `iterated` outcome",
    loop[1]?.outcomes.join() === "iterated");
  check("instrumenting loops does not change what they return", r.identical, JSON.stringify(r.got));
  check("the while condition records BOTH arms — the zero-iteration call is the F arm",
    r.ran.includes(`${loop[0].id}:T`) && r.ran.includes(`${loop[0].id}:F`), JSON.stringify(r.ran));
  check("the for..of records `iterated` when it iterates", r.ran.includes(`${loop[1].id}:iterated`));

  const empty = await exercise(
    `export function each(xs){let out=[];for(const x of xs){out.push(x)}return out}\n`,
    (m) => m.each([]),
  );
  check("…and does NOT when the iterable is empty, so the unexercised arm stays visible",
    empty.ran.length === 0, JSON.stringify(empty.ran));

  refuses("for(;;) is refused — there is no condition to record",
    `export function f(){for(;;){if(done())break}}\n`, /for\(;;\)/);
  refuses("a braceless for..of is refused — there is nowhere to mark",
    `export function f(xs){for(const x of xs)go(x)}\n`, /braceless body/);
}

// ---- OPTIONAL CHAINING -------------------------------------------------------
{
  const source = `export function pick(o){return o?.value}\n`;
  const r = await exercise(source, (m) => [m.pick({ value: 7 }), m.pick(undefined), m.pick(null)]);
  const site = r.sites.find((s) => s.kind === "optional");
  check("a single-link optional access is a nullish site on its LEFT side",
    site !== undefined && site.outcomes.join() === "T,F" && site.text === "o", JSON.stringify(site));
  check("instrumenting it does not change what it returns", r.identical, JSON.stringify(r.got));
  check("both arms are recorded", r.ran.includes(`${site!.id}:T`) && r.ran.includes(`${site!.id}:F`), JSON.stringify(r.ran));

  refuses("a chain over a chain is refused — the outer link never evaluates when the inner short-circuits",
    `export function f(o){return o?.a?.b}\n`, /optional chain over an optional chain/);
  refuses("an optional CALL is refused — wrapping the callee would change `this`",
    `export function f(o){return o.m?.()}\n`, /optional CALL/);
  check("…while a non-optional call on an optional access is fine", (() => {
    const sites = branchSites("fx", "/fixture/okcall.js", `export function f(o){return o?.m()}\n`);
    return sites.length === 1 && sites[0].kind === "optional";
  })());
}

// ---- the ids stay structural -------------------------------------------------
{
  const before = branchSites("fx", "/fixture/ids-a.js", `export function f(a){if(a)return 1;return 2}\n`);
  const after = branchSites("fx", "/fixture/ids-b.js", `// a new comment\n\nexport function f(a){if(a)return 1;return 2}\n`);
  check("adding a comment does not renumber a branch id — an exclusion survives it",
    before[0].id === after[0].id && before[0].id === "fx#f@0");
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`=== branch instrumenter: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — switch, try/catch, loops and optional chaining are recorded faithfully; every unrecordable form is refused by name"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
