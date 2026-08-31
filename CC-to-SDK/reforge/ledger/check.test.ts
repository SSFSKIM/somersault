// Controls for the closure-ledger checker. A checker that never rejects
// anything is this project's canonical failure mode (spec §3.1's non-vacuity
// doctrine, and the five successive hardenings of the background-task check),
// so every rule below is exercised from both sides: the mutation must be
// rejected, and a legitimate neighbour must still pass.
//
// Run: cd reforge && npx tsx ledger/check.test.ts
import { readFileSync } from "node:fs";
import { checkLedger, LEDGER_PATH, type Ledger, type LedgerRow } from "./check.js";
import { CANONICAL_ROWS } from "./rows.js";

const real = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
/** Deep clone so each case mutates in isolation. */
const clone = (): Ledger => JSON.parse(JSON.stringify(real)) as Ledger;
const rowOf = (l: Ledger, id: string): LedgerRow => {
  const r = l.rows.find((x) => x.id === id);
  if (!r) throw new Error(`fixture drift: ${id} not in ledger.json`);
  return r;
};
const HASH = "a".repeat(64);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
/** The mutation must be rejected, and the rejection must name the rule. */
const rejects = (name: string, mutate: (l: Ledger) => void, expect: RegExp) => {
  const l = clone();
  mutate(l);
  const errs = checkLedger(l);
  check(name, errs.length > 0 && errs.some((e) => expect.test(e)), errs.length === 0 ? "accepted the mutation" : `errors did not match ${expect}: ${errs.join(" | ")}`);
};
const accepts = (name: string, mutate: (l: Ledger) => void) => {
  const l = clone();
  mutate(l);
  const errs = checkLedger(l);
  check(name, errs.length === 0, errs.join(" | "));
};

console.log("=== closure-ledger checker controls ===");

// --- positive controls: the committed artifact and legitimate row movement ---
check("committed ledger.json passes", checkLedger(real).length === 0, checkLedger(real).join(" | "));
check(`ledger holds all ${CANONICAL_ROWS.length} canonical rows`, real.rows.length === CANONICAL_ROWS.length, `${real.rows.length} rows`);
accepts("valid edge between two real rows is accepted", (l) => {
  rowOf(l, "subsystem/query-loop").edges = ["subsystem/session-storage", "subsystem/control-protocol"];
});
accepts("owned state with a well-formed footprint is accepted", (l) => {
  const r = rowOf(l, "subsystem/tool-descriptions");
  r.state = "standalone-complete";
  r.footprint = [{ chunk: "chunk-y30v0ja7.js", hash: HASH, span: [0, 1420] }];
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
rejects("malformed footprint hash is rejected", (l) => (rowOf(l, "tool/Bash").footprint = [{ chunk: "chunk-fy12d89p.js", hash: "deadbeef" }]), /sha256/);
rejects("footprint without a chunk is rejected", (l) => (rowOf(l, "tool/Bash").footprint = [{ chunk: "", hash: HASH }]), /chunk: missing/);
rejects("empty footprint array is rejected", (l) => (rowOf(l, "tool/Bash").footprint = []), /non-empty array/);
rejects("standalone-complete without a footprint is rejected", (l) => (rowOf(l, "subsystem/tool-descriptions").state = "standalone-complete"), /requires a recorded upstream footprint/);
rejects("assembled without a footprint is rejected", (l) => (rowOf(l, "subsystem/tool-descriptions").state = "assembled"), /requires a recorded upstream footprint/);
rejects("stale without an adjudication note is rejected", (l) => (rowOf(l, "subsystem/compaction").state = "stale"), /adjudication note/);
rejects("edges as a non-array is rejected", (l) => ((rowOf(l, "tool/Bash").edges as unknown) = "none"), /edges: missing/);

// --- vacuity controls: emptiness must never pass ---
check("empty row set is rejected", checkLedger({ engineVersion: real.engineVersion, rows: [] }).length > 0);
check("missing rows key is rejected", checkLedger({ engineVersion: real.engineVersion }).length > 0);
check("non-object document is rejected", checkLedger("ledger").length > 0);

console.log(failures === 0 ? "\nPASS — every ledger rule rejects its violation and accepts its legitimate neighbour" : `\nFAIL — ${failures} control(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
