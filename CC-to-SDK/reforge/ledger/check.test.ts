// Controls for the closure-ledger checker. A checker that never rejects
// anything is this project's canonical failure mode (spec §3.1's non-vacuity
// doctrine, and the five successive hardenings of the background-task check),
// so every rule below is exercised from both sides: the mutation must be
// rejected, and a legitimate neighbour must still pass.
//
// The footprint block is the W0 boundary review's addition (lens 2): footprint
// validation used to be shape-only, so a row could claim `assembled` with a
// fabricated chunk, an arbitrary 64-hex digest and a reversed span, carry no
// evidence and no X7 registration, and contradict build/footprints.json — and
// pass. Each of those is now a control.
//
// The W0 close-out extends the same doctrine to the CAPTURE half: captures are
// required rather than warned about, and their declaration spans are resolved
// against the bundle on both sides of an import — so a backfilled span that is
// off by one, in either chunk, is rejected rather than believed.
//
// Run: cd reforge && npx tsx ledger/check.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLedger, FOOTPRINTS_PATH, LEDGER_PATH, type CheckOptions, type Footprint, type FootprintCapture, type Ledger, type LedgerRow } from "./check.js";
import { CANONICAL_ROWS } from "./rows.js";
import { ENGINE_VERSION } from "../src/pin.js";

const real = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
/** Deep clone so each case mutates in isolation. */
const clone = (): Ledger => JSON.parse(JSON.stringify(real)) as Ledger;
const rowOf = (l: Ledger, id: string): LedgerRow => {
  const r = l.rows.find((x) => x.id === id);
  if (!r) throw new Error(`fixture drift: ${id} not in ledger.json`);
  return r;
};
const HASH = "a".repeat(64);
/** A footprint that really does name bytes in the pinned bundle. */
const REAL_FOOTPRINT = rowOf(real, "subsystem/tool-result-formatters").footprint?.[0];
if (!REAL_FOOTPRINT) throw new Error("fixture drift: subsystem/tool-result-formatters has no footprint");
const realFootprint = (): Footprint => JSON.parse(JSON.stringify(REAL_FOOTPRINT)) as Footprint;
/**
 * A capture that really does name bytes in the pinned bundle, on BOTH sides —
 * the import site in the owning chunk and the declaration in the exporting one.
 * Capture spans are verified now (W0 close-out), so a fabricated one is no
 * longer a legitimate neighbour and cannot stand in for a well-formed list.
 */
const REAL_CAPTURE = REAL_FOOTPRINT.captures?.[0];
if (!REAL_CAPTURE?.from) throw new Error("fixture drift: the first tool-result-formatters capture is not an imported one");
const realCapture = (): FootprintCapture => JSON.parse(JSON.stringify(REAL_CAPTURE)) as FootprintCapture;

// A synthetic emission to cross-check against, so the controls do not depend on
// whether this machine has run strangle/build.ts. Both emitter shapes are built:
// the agreed record, and the pre-X one the transition still accepts.
const tmp = mkdtempSync(join(tmpdir(), "reforge-ledger-"));
const allFootprints = real.rows.flatMap((r) => r.footprint ?? []);
const newShape = join(tmp, "footprints.new.json");
const oldShape = join(tmp, "footprints.old.json");
writeFileSync(newShape, JSON.stringify({
  engineVersion: ENGINE_VERSION,
  splices: allFootprints.map((f, i) => ({ name: `splice-${i}`, chunk: f.chunk, target: f.target, captures: [] })),
}));
writeFileSync(oldShape, JSON.stringify({
  engineVersion: ENGINE_VERSION,
  splices: allFootprints.map((f, i) => ({ name: `splice-${i}`, chunk: f.chunk, span: { start: f.target.start, end: f.target.end }, sha256: f.target.sha256 })),
}));
/** Default options for the row-level controls: real bundle, synthetic emission, live (empty) registry. */
const BASE: CheckOptions = { footprintsPath: newShape };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
/** The mutation must be rejected, and the rejection must name the rule. */
const rejects = (name: string, mutate: (l: Ledger) => void, expect: RegExp, opts: CheckOptions = BASE) => {
  const l = clone();
  mutate(l);
  const { errors } = checkLedger(l, opts);
  check(name, errors.length > 0 && errors.some((e) => expect.test(e)), errors.length === 0 ? "accepted the mutation" : `errors did not match ${expect}: ${errors.join(" | ")}`);
};
const accepts = (name: string, mutate: (l: Ledger) => void, opts: CheckOptions = BASE) => {
  const l = clone();
  mutate(l);
  const { errors } = checkLedger(l, opts);
  check(name, errors.length === 0, errors.join(" | "));
};
const warnsAbout = (name: string, expect: RegExp, opts: CheckOptions, mutate: (l: Ledger) => void = () => {}) => {
  const l = clone();
  mutate(l);
  const { errors, warnings } = checkLedger(l, opts);
  check(name, errors.length === 0 && warnings.some((w) => expect.test(w)), errors.length > 0 ? `errored: ${errors.join(" | ")}` : `warnings did not match ${expect}: ${warnings.join(" | ")}`);
};

console.log("=== closure-ledger checker controls ===");

// --- positive controls: the committed artifact and legitimate row movement ---
const live = checkLedger(real);
check("committed ledger.json passes against the real bundle and build/footprints.json", live.errors.length === 0, live.errors.join(" | "));
check(`ledger holds all ${CANONICAL_ROWS.length} canonical rows`, real.rows.length === CANONICAL_ROWS.length, `${real.rows.length} rows`);
check("the footprint check is not vacuous — the committed ledger has footprints to verify", allFootprints.length > 0, `${allFootprints.length} footprint(s)`);
accepts("valid edge between two real rows is accepted", (l) => {
  rowOf(l, "subsystem/query-loop").edges = ["subsystem/session-storage", "subsystem/control-protocol"];
});
accepts("standalone-complete with a real footprint, evidence and a registration is accepted", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "standalone-complete";
  r.footprint = [realFootprint()];
  r.evidence = ["commit:0a3e0681", "scenario:plain"];
}, { ...BASE, ownedSubsystems: ["subsystem/tool-descriptions"] });
accepts("assembled with a real footprint and evidence is accepted (no registration gate on assembly)", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "assembled";
  r.footprint = [realFootprint()];
  r.evidence = ["scenario:subagent"];
});
accepts("a well-formed capture list is accepted", (l) => {
  const f = realFootprint();
  f.captures = [realCapture()];
  rowOf(l, "subsystem/compaction").footprint = [f];
});
accepts("a stale row with an adjudication note is accepted", (l) => {
  const r = rowOf(l, "subsystem/compaction");
  r.state = "stale";
  r.note = "pin bump 2.1.252: summarization prompt changed inside the owned span; re-coverage pending";
});

// --- negative controls: one per rule ---
rejects("invalid state is rejected", (l) => ((rowOf(l, "subsystem/compaction").state as string) = "owned"), /state:/);
rejects("dangling edge is rejected", (l) => (rowOf(l, "subsystem/compaction").edges = ["subsystem/does-not-exist"]), /dangling reference/);
rejects("self edge is rejected", (l) => (rowOf(l, "subsystem/compaction").edges = ["subsystem/compaction"]), /self-reference/);
rejects("duplicate edge is rejected", (l) => (rowOf(l, "subsystem/compaction").edges = ["subsystem/query-loop", "subsystem/query-loop"]), /duplicate/);
rejects("missing row is rejected", (l) => (l.rows = l.rows.filter((r) => r.id !== "tool/Bash")), /missing row: tool\/Bash/);
rejects("unknown row is rejected", (l) => l.rows.push({ ...rowOf(l, "tool/Bash"), id: "tool/Telepathy" }), /unknown row/);
rejects("duplicate row id is rejected", (l) => l.rows.push({ ...rowOf(l, "tool/Bash") }), /duplicate row id/);
rejects("wrong kind is rejected", (l) => ((rowOf(l, "tool/Bash").kind as string) = "subsystem"), /kind:/);
rejects("wrong wave is rejected", (l) => ((rowOf(l, "tool/Bash").wave as string) = "C7"), /wave:/);
rejects("non-existent wave is rejected", (l) => ((rowOf(l, "tool/Bash").wave as string) = "C99"), /campaign child id/);
rejects("retitled row is rejected", (l) => (rowOf(l, "tool/Bash").title = "Bash (but better)"), /title:/);
rejects("engineVersion drift is rejected", (l) => (l.engineVersion = "2.1.252"), /engineVersion/);
rejects("missing footprint field is rejected", (l) => delete (rowOf(l, "tool/Bash") as Partial<LedgerRow>).footprint, /footprint: missing/);
rejects("empty footprint array is rejected", (l) => (rowOf(l, "tool/Bash").footprint = []), /non-empty array/);
rejects("standalone-complete without a footprint is rejected", (l) => (rowOf(l, "subsystem/tool-descriptions").state = "standalone-complete"), /requires a recorded upstream footprint/);
rejects("assembled without a footprint is rejected", (l) => (rowOf(l, "subsystem/tool-descriptions").state = "assembled"), /requires a recorded upstream footprint/);
rejects("stale without an adjudication note is rejected", (l) => (rowOf(l, "subsystem/compaction").state = "stale"), /adjudication note/);
rejects("edges as a non-array is rejected", (l) => ((rowOf(l, "tool/Bash").edges as unknown) = "none"), /edges: missing/);

// --- footprint shape ---
rejects("the retired {chunk, hash, span} footprint shape is rejected", (l) => {
  (rowOf(l, "tool/Bash").footprint as unknown) = [{ chunk: "chunk-fy12d89p.js", hash: HASH, span: [0, 10] }];
}, /retired \{chunk, hash, span\} shape/);
rejects("a footprint with no target is rejected", (l) => {
  (rowOf(l, "tool/Bash").footprint as unknown) = [{ chunk: "chunk-fy12d89p.js" }];
}, /\.target: missing/);
rejects("footprint without a chunk is rejected", (l) => {
  const f = realFootprint();
  f.chunk = "";
  rowOf(l, "tool/Bash").footprint = [f];
}, /chunk: missing/);
rejects("a chunk path that escapes the modules dir is rejected", (l) => {
  const f = realFootprint();
  f.chunk = "../../../etc/passwd";
  rowOf(l, "tool/Bash").footprint = [f];
}, /relative to the bundle's modules dir/);
rejects("malformed target sha256 is rejected", (l) => {
  const f = realFootprint();
  f.target.sha256 = "deadbeef";
  rowOf(l, "tool/Bash").footprint = [f];
}, /sha256/);

// --- span sanity (the review's reversed-span defect) ---
rejects("a reversed span is rejected", (l) => {
  const f = realFootprint();
  f.target.start = 99;
  f.target.end = 1;
  rowOf(l, "tool/Bash").footprint = [f];
}, /is empty or reversed/);
rejects("an empty span is rejected", (l) => {
  const f = realFootprint();
  f.target.end = f.target.start;
  rowOf(l, "tool/Bash").footprint = [f];
}, /is empty or reversed/);
rejects("a non-integer offset is rejected", (l) => {
  const f = realFootprint();
  (f.target.start as unknown) = 12.5;
  rowOf(l, "tool/Bash").footprint = [f];
}, /non-negative integer offsets/);
rejects("a span past the end of the chunk is rejected", (l) => {
  const f = realFootprint();
  f.target.start = 900_000_000;
  f.target.end = 900_001_000;
  rowOf(l, "tool/Bash").footprint = [f];
}, /runs past the end of/);

// --- upstream bytes (the review's fabricated-chunk and arbitrary-hash defects) ---
rejects("a fabricated chunk name is rejected", (l) => {
  const f = realFootprint();
  f.chunk = "chunk-nosuchthing.js";
  rowOf(l, "tool/Bash").footprint = [f];
}, /does not exist under/, { ...BASE, footprintsPath: null });
rejects("an arbitrary 64-hex digest that no upstream span hashes to is rejected", (l) => {
  const f = realFootprint();
  f.target.sha256 = HASH;
  rowOf(l, "tool/Bash").footprint = [f];
}, /do not hash to/, { ...BASE, footprintsPath: null });
rejects("a span shifted off its recorded bytes is rejected", (l) => {
  const f = realFootprint();
  f.target.start += 1;
  rowOf(l, "tool/Bash").footprint = [f];
}, /do not hash to/, { ...BASE, footprintsPath: null });
warnsAbout("an absent extraction bundle warns and skips instead of failing", /bundle absent/, { ...BASE, bundleModules: join(tmp, "no-such-bundle") });

// --- capture list ---
rejects("a reversed capture declaration span is rejected", (l) => {
  const f = realFootprint();
  f.captures = [{ name: "q6t", declStart: 400, declEnd: 100, sha256: HASH }];
  rowOf(l, "tool/Bash").footprint = [f];
}, /declaration span .* is empty or reversed/);
rejects("a capture without a name is rejected", (l) => {
  const f = realFootprint();
  const c = realCapture();
  c.name = "";
  f.captures = [c];
  rowOf(l, "tool/Bash").footprint = [f];
}, /captures\[0\]\.name: missing/);
rejects("a capture list that is not an array is rejected", (l) => {
  const f = realFootprint();
  (f.captures as unknown) = "none";
  rowOf(l, "tool/Bash").footprint = [f];
}, /captures: must be an array/);
rejects("a footprint with no capture list is rejected", (l) => {
  const f = realFootprint();
  delete f.captures;
  rowOf(l, "subsystem/query-loop").footprint = [f];
}, /captures: missing/);
// The capture half of rule 3: the same "does it name real upstream bytes?"
// question, asked of the closure surface. Without these two, a backfilled span
// could be off by one in either chunk and nothing would notice.
rejects("a capture span shifted off its recorded bytes is rejected", (l) => {
  const f = realFootprint();
  const c = realCapture();
  c.declStart += 1;
  f.captures = [c];
  rowOf(l, "tool/Bash").footprint = [f];
}, /captures\[0\]: bytes at .* do not hash to/, { ...BASE, footprintsPath: null });
rejects("an imported capture's far-side declaration is verified in its own chunk", (l) => {
  const f = realFootprint();
  const c = realCapture();
  c.from!.declEnd -= 1;
  f.captures = [c];
  rowOf(l, "tool/Bash").footprint = [f];
}, /captures\[0\]\.from: bytes at .* do not hash to/, { ...BASE, footprintsPath: null });
rejects("a far-side chunk that escapes the modules dir is rejected", (l) => {
  const f = realFootprint();
  const c = realCapture();
  c.from!.chunk = "../../../etc/passwd";
  f.captures = [c];
  rowOf(l, "tool/Bash").footprint = [f];
}, /from\.chunk: must be a path relative to the bundle's modules dir/);

// --- evidence + X7 registration for owned states ---
rejects("standalone-complete with no evidence is rejected", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "standalone-complete";
  r.footprint = [realFootprint()];
  r.evidence = ["strangle/manifest.ts:some-splice"];
}, /requires at least one resolvable link/, { ...BASE, ownedSubsystems: ["subsystem/tool-descriptions"] });
rejects("assembled with no evidence is rejected", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "assembled";
  r.footprint = [realFootprint()];
  delete r.evidence;
}, /requires at least one resolvable link/);
rejects("standalone-complete with no engine-ts registration is rejected", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "standalone-complete";
  r.footprint = [realFootprint()];
  r.evidence = ["commit:0a3e0681"];
}, /engine-ts registers no module for this subsystem/, { ...BASE, ownedSubsystems: [] });
rejects("standalone-complete is refused against the live (empty) registry too", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "standalone-complete";
  r.footprint = [realFootprint()];
  r.evidence = ["commit:0a3e0681"];
}, /engine-ts registers no module for this subsystem/, { footprintsPath: newShape });

// --- build/footprints.json cross-check ---
rejects("a spliced footprint absent from build/footprints.json is rejected", (l) => {
  const f = realFootprint();
  f.target.sha256 = HASH;
  rowOf(l, "subsystem/query-loop").footprint = [f];
}, /no splice in build\/footprints\.json/, { ...BASE, bundleModules: null });
rejects("a spliced footprint attributed to the wrong chunk is rejected", (l) => {
  const f = realFootprint();
  f.chunk = "chunk-somewhere-else.js";
  rowOf(l, "subsystem/query-loop").footprint = [f];
}, /no splice in build\/footprints\.json/, { ...BASE, bundleModules: null });
warnsAbout("a splice with no ledger footprint warns about the drift", /has no footprint in the ledger/, { ...BASE, bundleModules: null }, (l) => {
  const r = rowOf(l, "subsystem/query-loop");
  r.footprint = null;
  r.state = "unowned";
});
warnsAbout("the pre-X emitter shape is accepted with a deprecation warning", /pre-X emitter shape/, { ...BASE, footprintsPath: oldShape });
warnsAbout("an emission built for another pin is skipped, not trusted", /built for .* pin is/, { ...BASE, footprintsPath: (() => {
  const p = join(tmp, "footprints.stale.json");
  writeFileSync(p, JSON.stringify({ engineVersion: "2.1.999", splices: [] }));
  return p;
})() });
check("the checker reads the real build/footprints.json by default", FOOTPRINTS_PATH.endsWith("/build/footprints.json"));

// --- vacuity controls: emptiness must never pass ---
check("empty row set is rejected", checkLedger({ engineVersion: real.engineVersion, rows: [] }).errors.length > 0);
check("missing rows key is rejected", checkLedger({ engineVersion: real.engineVersion }).errors.length > 0);
check("non-object document is rejected", checkLedger("ledger").errors.length > 0);

rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? "\nPASS — every ledger rule rejects its violation and accepts its legitimate neighbour" : `\nFAIL — ${failures} control(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
