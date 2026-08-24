// Guard for the M3-A review finding: nondeterminism triage must excuse a
// difference only when the engine under test produced one of the values the
// ORACLE was actually observed to produce. Blanket path suppression would let a
// third, invalid value pass as "identical".
//
// Run: cd reforge && npx tsx m3/variance-guard.test.ts
import { diffTranscripts } from "../src/differ.js";

type Variance = Map<string, unknown[]>;
const varianceOf = (findings: { path: string; a: unknown; b: unknown }[]): Variance => {
  const m: Variance = new Map();
  for (const f of findings) m.set(f.path, [f.a, f.b]);
  return m;
};
const withinVariance = (f: { path: string; b: unknown }, v: Variance): boolean => {
  const alts = v.get(f.path);
  if (!alts) return false;
  const b = JSON.stringify(f.b);
  return alts.some((alt) => JSON.stringify(alt) === b);
};

// Oracle is nondeterministic at msg[0].order: two runs give P1 then P3.
const oracleRun1 = [{ type: "user", order: "P1" }];
const oracleRun2 = [{ type: "user", order: "P3" }];
const variance = varianceOf(diffTranscripts(oracleRun1, oracleRun2));

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

// Case 1: engine emits the oracle's OTHER observed value — excusable.
const legit = diffTranscripts(oracleRun1, [{ type: "user", order: "P3" }]);
check("engine value seen from the oracle is excused", legit.length > 0 && legit.every((f) => withinVariance(f, variance)));

// Case 2: engine emits a value the oracle NEVER produced — must NOT be excused.
const bogus = diffTranscripts(oracleRun1, [{ type: "user", order: "REFORGE_INVALID" }]);
check("third, unobserved engine value is NOT excused", bogus.length > 0 && bogus.every((f) => !withinVariance(f, variance)));

// Case 3: a difference at an unrelated path is never excused by another path's variance.
const elsewhere = diffTranscripts(oracleRun1, [{ type: "assistant", order: "P1" }]);
check("difference at a stable path is not excused", elsewhere.length > 0 && elsewhere.every((f) => !withinVariance(f, variance)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
