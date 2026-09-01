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

  check("…while a try whose only escape is a THROW is fine (that is the arm being measured)", (() => {
    const sites = branchSites("fx", "/fixture/throwing.js", `export function f(a){try{if(a)throw new Error("x");go()}catch(e){}return 1}\n`);
    return sites.some((s) => s.kind === "try");
  })());
  check("…and a `return` inside a nested function in the try does not count as an escape", (() => {
    const sites = branchSites("fx", "/fixture/nested.js", `export function f(){try{run(()=>{return 1})}catch(e){}return 2}\n`);
    return sites.some((s) => s.kind === "try");
  })());
}

// ---- TRY WHOSE BODY RETURNS (W6) --------------------------------------------
// Refused until W6, whose permission pre-check, rule checker and allow-rule
// decision all `return` from inside a guarded body — three of the subsystem's
// four most-called functions. Rewriting them to hoist a result into a variable
// would have been changing the measured code to suit the instrument, so the
// instrument was extended instead: every escaping `return` records the SAME
// completed arm the end-of-block marker records, as an EXPRESSION, so a
// braceless `if (x) return y` keeps owning its own statement.
{
  // Four shapes in one fixture: a braceless early return, a valueless return, a
  // return that falls off the end, and the throwing arm.
  const source =
    `export function f(a){try{if(a===1)return "early";if(a===2)return;if(a===3)throw new Error("boom");return "tail"}catch(e){return "caught:"+e.message}}\n`;
  const r = await exercise(source, (m) => [m.f(1), m.f(2), m.f(3), m.f(4)]);
  const site = r.sites.find((s) => s.kind === "try")!;
  check("a try whose body returns is RECORDED, not refused", site !== undefined && site.outcomes.join() === "T,F",
    JSON.stringify(r.sites.map((s) => [s.kind, s.outcomes])));
  check("instrumenting it does not change what it returns — including the valueless return", r.identical, JSON.stringify(r.got));
  check("…and the values are the ones the plain module produced",
    JSON.stringify(r.got) === JSON.stringify(["early", undefined, "caught:boom", "tail"]), JSON.stringify(r.got));
  check("both arms are recorded: the returning exits are the completed arm, the throw is the T arm",
    r.ran.includes(`${site.id}:F`) && r.ran.includes(`${site.id}:T`), JSON.stringify(r.ran));

  // The negative control that matters: without the per-return recorders, a body
  // whose ONLY exits are returns would record no completed arm at all and the
  // attestation would report an unexercised, adjudication-demanding branch on a
  // path every call takes. That is the false-RED direction, and it is what the
  // old refusal was protecting against by refusing outright.
  const early = await exercise(
    `export function g(a){try{if(a)return "yes";return "no"}catch(e){return "caught"}}\n`,
    (m) => [m.g(true), m.g(false)],
  );
  const es = early.sites.find((s) => s.kind === "try")!;
  check("a guarded body that ONLY ever returns still records its completed arm",
    early.ran.includes(`${es.id}:F`), JSON.stringify(early.ran));
  check("…and does NOT record the throwing arm it never took",
    !early.ran.includes(`${es.id}:T`), JSON.stringify(early.ran));

  // A returned expression that is ITSELF a branch site: the two wraps nest, and
  // the inner one must sit inside the outer one rather than swallowing it.
  const nested = await exercise(
    `export function h(a,b){try{return a ?? b}catch(e){return "caught"}}\n`,
    (m) => [m.h(null, "fallback"), m.h("value", "fallback")],
  );
  const ns = nested.sites.find((s) => s.kind === "try")!;
  const nullish = nested.sites.find((s) => s.kind === "nullish")!;
  check("a wrapped expression inside a recorded return still evaluates correctly", nested.identical, JSON.stringify(nested.got));
  check("…and both the nullish arms AND the completed arm are recorded",
    nested.ran.includes(`${ns.id}:F`) && nested.ran.includes(`${nullish.id}:T`) && nested.ran.includes(`${nullish.id}:F`),
    JSON.stringify(nested.ran));

  // Still refused, and for a reason a `return` does not share.
  refuses("a try body that `break`s out of an enclosing loop is still refused — a jump has no expression position",
    `export function f(xs){for(const x of xs){try{if(x)break;go()}catch(e){}}return 1}\n`, /break` or `continue`/);
  refuses("…and so is a labelled break that jumps past the loop that would own it",
    `export function f(xs){outer:for(const x of xs){try{for(const y of x){if(y)break outer}}catch(e){}}return 1}\n`,
    /break` or `continue`/);
  check("…while an UNLABELLED break owned by a loop inside the try does not escape it", (() => {
    const sites = branchSites("fx", "/fixture/ownbreak.js", `export function f(xs){try{for(const x of xs){if(x)break}}catch(e){}return 1}\n`);
    return sites.some((s) => s.kind === "try");
  })());
}

// ---- TRY / FINALLY (no catch) -----------------------------------------------
// A `finally` is behaviour in the code being measured — upstream's SessionStart
// dispatcher brackets its dispatch in one so an executor that throws still
// releases the activity hold — so the instrumenter records it rather than the
// module being rewritten to suit the instrument. The recorder's catch must be
// invisible: the exception has to reach the finally and go on propagating.
{
  const source =
    `export function held(fn){const log=[];try{log.push(fn())}finally{log.push("released")}return log}\n` +
    `export function caught(fn){let out;try{out={log:held(fn)}}catch(e){out={threw:e.message}}return out}\n`;
  const r = await exercise(source, (m) => [m.caught(() => "fine"), m.caught(() => { throw new Error("boom"); })]);
  const site = r.sites.find((s) => s.kind === "try" && s.fn === "held");
  check("a try/finally is ONE site with the same two outcomes as a try/catch",
    site !== undefined && site.outcomes.join() === "T,F", JSON.stringify(r.sites.map((s) => [s.fn, s.kind, s.outcomes])));
  check("instrumenting it changes nothing — the exception still propagates past the finally", r.identical, JSON.stringify(r.got));
  check("the finally ran on BOTH paths, instrumented and not",
    JSON.stringify(r.got) === JSON.stringify([{ log: ["fine", "released"] }, { threw: "boom" }]), JSON.stringify(r.got));
  check("both arms are recorded when both run",
    site !== undefined && r.ran.includes(`${site.id}:T`) && r.ran.includes(`${site.id}:F`), JSON.stringify(r.ran));

  // The arm that must stay UNrecorded when it does not run — the whole point of
  // the inventory is that an unexercised throwing path is visible as one.
  const quiet = await exercise(
    `export function q(fn){const log=[];try{log.push(fn())}finally{log.push("r")}return log}\n`,
    (m) => m.q(() => "fine"),
  );
  const qs = quiet.sites.find((s) => s.kind === "try")!;
  check("a try/finally whose body never throws records only the completed arm",
    quiet.ran.includes(`${qs.id}:F`) && !quiet.ran.includes(`${qs.id}:T`), JSON.stringify(quiet.ran));

  // The generator shape the SessionStart dispatcher actually has, including the
  // consumer-abandonment case the header names: `.return()` runs the finally
  // without throwing, so NEITHER outcome is recorded.
  const gen = await exercise(
    `export function g(log){return (async function*(){try{yield 1;yield 2}finally{log.push("released")}})()}\n` +
      `export async function abandon(log){const it=g(log);await it.next();await it.return("done");return log}\n`,
    (m) => m.abandon([]),
  );
  const gs = gen.sites.find((s) => s.kind === "try")!;
  check("a generator's finally still runs when the consumer abandons it", JSON.stringify(gen.got) === JSON.stringify(["released"]), JSON.stringify(gen.got));
  check("…and an abandoned body records NEITHER arm, as the header says",
    !gen.ran.includes(`${gs.id}:T`) && !gen.ran.includes(`${gs.id}:F`), JSON.stringify(gen.ran));

  // A try/finally whose body returns is recorded the same way a try/catch one
  // is — and the recorder's spliced catch must still be invisible: the finally
  // runs on the returning path, and the return value is untouched.
  const returning = await exercise(
    `export function f(a,log){try{if(a)return "early";log.push("body");return "tail"}finally{log.push("released")}}\n`,
    (m) => { const l1 = [] as string[]; const l2 = [] as string[]; return [m.f(true, l1), l1, m.f(false, l2), l2]; },
  );
  const rs = returning.sites.find((s) => s.kind === "try")!;
  check("a try/finally whose body returns is recorded, and the finally still runs on that path",
    returning.identical && JSON.stringify(returning.got) === JSON.stringify(["early", ["released"], "tail", ["body", "released"]]),
    JSON.stringify(returning.got));
  check("…and the completed arm is recorded on the returning exit",
    returning.ran.includes(`${rs.id}:F`) && !returning.ran.includes(`${rs.id}:T`), JSON.stringify(returning.ran));

  refuses("a try/finally body that `continue`s out of an enclosing loop is still refused",
    `export function f(xs){for(const x of xs){try{if(x)continue;go()}finally{done()}}return 3}\n`, /break` or `continue`/);
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
    ? "PASS — switch, try/catch (including a body that returns), try/finally, loops and optional chaining are recorded faithfully; every unrecordable form is refused by name"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
