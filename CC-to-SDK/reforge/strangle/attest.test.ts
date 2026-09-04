// Coverage-attestation negative controls (campaign spec §3.1; C5x unit 8, from
// the W2 boundary review's finding that the README claimed two controls that
// were never committed — the campaign's own defect class, so it is fixed rather
// than logged).
//
//   npx tsx strangle/attest.test.ts
//
// The attestation's value is entirely in what it REFUSES. Each rule is put in
// front of the fixture that violates it and its legitimate neighbour:
//
//   fresh          every branch executed or carrying a reason -> PASSES. A
//                  checker that fails everything proves as little as one that
//                  fails nothing.
//   unadjudicated  a branch nothing executed and nobody reviewed -> FAILS, and
//                  names the branch and the arm.
//   stale (gone)   an exclusion naming a branch the inventory no longer has ->
//                  FAILS. The code moved, so the reason now protects nothing,
//                  and leaving it means the next real gap on that id is excused.
//   stale (live)   an exclusion for a branch the corpus has since started to
//                  execute -> FAILS. Same hazard from the other direction.
//   vacuous        an empty inventory -> FAILS. A pass over nothing is the
//                  canonical false green this whole mechanism exists to forbid.
//
// C13a added a SECOND evidence channel — what a differential contract suite
// executed on the same instrumented module — and it gets the same treatment,
// because a channel whose only fixtures are the ones it passes is a channel
// nobody has watched refuse anything:
//
//   contract       a branch a suite executed is adjudicated, and reported as its
//                  own state rather than folded into `executed`.
//   order          a branch BOTH channels cover is reported as `executed`: the
//                  end-to-end evidence is the stronger claim.
//   empty          an empty contract set adjudicates nothing. The channel must
//                  not become a way to pass by existing.
//   stale (suite)  an exclusion for a branch a suite now executes -> FAILS, and
//                  says WHICH channel overtook it, because the fix differs.
import { adjudicate } from "./adjudicate.js";
import { branchSites, outcomesOf } from "./branches.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

// One fixture module with exactly two branch sites, so every rule below is
// stated against a real AST-derived inventory rather than a hand-written list.
const SOURCE =
  `export function render(mode, extra){\n` +
  `  if (mode === "lean") return "lean";\n` +
  `  return extra ?? "full";\n` +
  `}\n`;
const sites = branchSites("fixture", "/fixture/render.js", SOURCE);
const inventory = sites.flatMap(outcomesOf);
check("the fixture has the two sites the controls below assume",
  inventory.length === 4 && inventory[0] === "fixture#render@0:T", JSON.stringify(inventory));

const ALL = new Set(inventory);

// ---- fresh: the legitimate neighbour ----------------------------------------
{
  const v = adjudicate(sites, [], ALL);
  check("a fully executed inventory PASSES", v.ok && v.executedCount === 4 && v.unadjudicated.length === 0 && v.stale.length === 0);
}
{
  // Executed OR excluded — the mixed case the real attestation is always in.
  const executed = new Set(inventory.filter((b) => b !== "fixture#render@1:T"));
  const v = adjudicate(sites, [{ branch: "fixture#render@1:T", reason: "graded against upstream by the parity test" }], executed);
  check("…and so does one whose unexecuted branch carries a reviewed reason",
    v.ok && v.excludedCount === 1 && v.rows.find((r) => r.branch === "fixture#render@1:T")?.state === "excluded");
}

// ---- unadjudicated ----------------------------------------------------------
{
  const executed = new Set(inventory.filter((b) => b !== "fixture#render@0:F"));
  const v = adjudicate(sites, [], executed);
  check("an unexecuted branch with no reason FAILS",
    !v.ok && v.unadjudicated.length === 1 && v.unadjudicated[0].branch === "fixture#render@0:F",
    JSON.stringify(v.unadjudicated.map((u) => u.branch)));
  check("…and the report can say which ARM it was",
    v.unadjudicated[0]?.outcome === "F" && v.unadjudicated[0]?.site.kind === "if");
}

// ---- stale, both directions -------------------------------------------------
{
  const v = adjudicate(sites, [{ branch: "fixture#render@7:T", reason: "a branch that used to exist" }], ALL);
  check("an exclusion naming a branch the inventory no longer has FAILS",
    !v.ok && v.stale.length === 1 && v.stale[0].why === "no such branch in the inventory",
    JSON.stringify(v.stale));
}
{
  const v = adjudicate(sites, [{ branch: "fixture#render@0:F", reason: "no scenario renders the full arm" }], ALL);
  check("an exclusion for a branch the corpus NOW executes FAILS",
    !v.ok && v.stale.length === 1 && v.stale[0].why === "the corpus now executes it", JSON.stringify(v.stale));
  check("…even though nothing is unadjudicated — staleness is its own failure",
    v.unadjudicated.length === 0);
}

// ---- contract evidence, and its own three ways of being wrong ---------------
// The second executed-set (C13a). Each rule gets its fixture and its legitimate
// neighbour, on the same argument the rules above are held to: a channel that
// only ever passes is a channel nobody has watched refuse anything.
{
  const corpus = new Set([inventory[0]]);
  const suite = new Set([inventory[1], inventory[2], inventory[3]]);
  const v = adjudicate(sites, [], corpus, suite);
  check("a branch a contract suite executed is ADJUDICATED rather than missing",
    v.ok && v.unadjudicated.length === 0 && v.contractCount === 3 && v.executedCount === 1,
    JSON.stringify({ executed: v.executedCount, contract: v.contractCount, unadjudicated: v.unadjudicated.length }));
  check("…and it is reported as its own state, not folded into `executed`",
    v.rows.find((r) => r.branch === inventory[1])?.state === "contract" && v.rows.find((r) => r.branch === inventory[0])?.state === "executed");
}
{
  // The evidence ORDER: corpus wins, because end-to-end is the stronger claim
  // and the report should say the strongest true thing about each branch.
  const v = adjudicate(sites, [], ALL, ALL);
  check("a branch BOTH executed and contract-covered is reported as executed",
    v.executedCount === 4 && v.contractCount === 0);
}
{
  // The channel must not become a way to pass without evidence.
  const v = adjudicate(sites, [], new Set(), new Set());
  check("an EMPTY contract set adjudicates nothing — the channel cannot excuse a branch by existing",
    !v.ok && v.unadjudicated.length === 4 && v.contractCount === 0);
}
{
  // Staleness, third direction: a reason that has been overtaken by a suite.
  const v = adjudicate(sites, [{ branch: inventory[3], reason: "nothing drives the nullish arm" }], new Set(), new Set([inventory[3]]));
  check("an exclusion for a branch a CONTRACT SUITE now executes FAILS as stale",
    !v.ok && v.stale.length === 1 && v.stale[0].why === "a contract suite now executes it", JSON.stringify(v.stale));
  const byCorpus = adjudicate(sites, [{ branch: inventory[3], reason: "nothing drives the nullish arm" }], new Set([inventory[3]]), new Set());
  check("…and it is distinguishable from the corpus-executes-it case, so the fix is legible",
    byCorpus.stale[0]?.why === "the corpus now executes it", JSON.stringify(byCorpus.stale));
}

// ---- vacuity ----------------------------------------------------------------
{
  const v = adjudicate([], [], new Set());
  check("an empty inventory FAILS rather than reporting 100%", v.vacuous && !v.ok && v.rows.length === 0);
  const empty = branchSites("fixture", "/fixture/flat.js", `export const NAME = "Glob";\n`);
  check("…and a module with genuinely no branches is what that looks like", empty.length === 0);
}

console.log(`=== attestation adjudicator: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — a fresh attestation passes; an unadjudicated branch, a stale exclusion in any of its three directions and an empty inventory each fail, and the contract channel adjudicates without excusing"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
