// Rebase C1's emitted capture records into the ledger's upstream basis.
//
//   npx tsx ledger/backfill-captures.ts [--check]
//
// strangle/build.ts emits build/footprints.json with spans measured against the
// MATERIALIZED graph (build/strangled/…, whose bytes differ from the bundle only
// by prepare.ts's `/$bunfs/root/` specifier rewrite) and hashes taken over the
// UPSTREAM bytes. ledger.json records both in the upstream basis, because that
// is the one every machine shares. This converts the spans — via
// `toUpstreamOffset`, the same dual-basis fact ledger/check.ts's rule 3 accepts
// by hashing both ways — and copies the record in.
//
// Nothing here guesses. A rebased span is written only when the bytes it lands
// on actually hash to the digest the emitter recorded; anything that does not
// resolve is reported and the run fails, because a capture recorded at offsets
// nobody verified is exactly the decoration the footprint rules exist to refuse.
// (A capture the EMITTER could only cover narrowly — an import whose exporting
// chunk is out of the graph — arrives carrying footprint.ts's `note` and is
// copied through with it, which is the schema's way of saying so out loud.)
//
// Re-run it after any `npx tsx strangle/build.ts`, then `npx tsx ledger/check.ts`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { FOOTPRINTS_PATH, LEDGER_PATH, toUpstreamOffset, type FootprintCapture, type Ledger } from "./check.js";
import type { FootprintFile } from "../strangle/footprint.js";

const checkOnly = process.argv.includes("--check");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const problems: string[] = [];

const texts = new Map<string, string | null>();
function upstreamText(chunk: string): string | null {
  if (!texts.has(chunk)) {
    const path = join(BUNDLE_MODULES, chunk);
    texts.set(chunk, existsSync(path) ? readFileSync(path, "utf8") : null);
  }
  return texts.get(chunk)!;
}

/** A materialized-basis declaration span, re-measured against the upstream module. */
function rebase(label: string, chunk: string, span: { declStart: number; declEnd: number; sha256: string }): { declStart: number; declEnd: number } | null {
  const text = upstreamText(chunk);
  if (text === null) {
    problems.push(`${label}: ${chunk} is not in ${BUNDLE_MODULES}`);
    return null;
  }
  const declStart = toUpstreamOffset(text, span.declStart);
  const declEnd = toUpstreamOffset(text, span.declEnd);
  if (declStart === null || declEnd === null) {
    problems.push(`${label}: [${span.declStart}, ${span.declEnd}] in ${chunk} falls inside a rewritten specifier — no upstream offset corresponds to it`);
    return null;
  }
  const got = sha256(text.slice(declStart, declEnd));
  if (got !== span.sha256) {
    problems.push(`${label}: upstream [${declStart}, ${declEnd}] of ${chunk} hashes to ${got.slice(0, 12)}…, emitter recorded ${span.sha256.slice(0, 12)}… — declaration not located`);
    return null;
  }
  return { declStart, declEnd };
}

// ---- inputs -----------------------------------------------------------------
if (!existsSync(FOOTPRINTS_PATH)) {
  console.error(`no ${relative(process.cwd(), FOOTPRINTS_PATH)} — run: npx tsx strangle/build.ts`);
  process.exit(2);
}
const emission = JSON.parse(readFileSync(FOOTPRINTS_PATH, "utf8")) as FootprintFile;
if (emission.engineVersion !== ENGINE_VERSION) {
  console.error(`build/footprints.json is built for ${emission.engineVersion}, pin is ${ENGINE_VERSION} — re-run strangle/build.ts`);
  process.exit(2);
}
if (emission.spanBasis !== "materialized-chunk") {
  console.error(`build/footprints.json declares spanBasis ${JSON.stringify(emission.spanBasis)} — this tool converts 'materialized-chunk' only`);
  process.exit(2);
}
if (emission.variant !== "faithful") {
  console.error(`build/footprints.json is the '${emission.variant}' variant — backfill from a faithful build (npx tsx strangle/build.ts)`);
  process.exit(2);
}
if (!existsSync(BUNDLE_MODULES)) {
  console.error(`extraction bundle absent at ${BUNDLE_MODULES} — the upstream basis cannot be measured on this machine`);
  process.exit(2);
}

// A footprint names its splice by the pair the ledger's cross-check already
// keys on, so the two files agree on identity or neither does.
const bySplice = new Map<string, FootprintFile["splices"][number]>();
for (const sp of emission.splices) {
  const key = `${sp.chunk} ${sp.target.sha256}`;
  if (bySplice.has(key)) problems.push(`build/footprints.json: two splices claim ${key} (${bySplice.get(key)!.name}, ${sp.name})`);
  bySplice.set(key, sp);
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
const before = JSON.stringify(ledger, null, 2) + "\n";

// ---- rebase -----------------------------------------------------------------
console.log(`=== capture backfill: ${emission.splices.length} splice(s) @ ${ENGINE_VERSION} ===`);
for (const row of ledger.rows) {
  for (const [j, f] of (row.footprint ?? []).entries()) {
    const key = `${f.chunk} ${f.target.sha256}`;
    const sp = bySplice.get(key);
    if (!sp) {
      problems.push(`${row.id}[${j}]: no splice in build/footprints.json replaces ${f.chunk}@${f.target.sha256.slice(0, 12)}…`);
      continue;
    }
    const captures: FootprintCapture[] = [];
    for (const c of sp.captures) {
      const here = rebase(`${sp.name}/${c.as}`, f.chunk, c);
      if (!here) continue;
      const record: FootprintCapture = { name: c.name, as: c.as, kind: c.kind, declKind: c.declKind, ...here, sha256: c.sha256 };
      if (c.note) record.note = c.note;
      if (c.from) {
        const far = rebase(`${sp.name}/${c.as} <- ${c.from.chunk}`, c.from.chunk, c.from);
        if (!far) continue;
        record.from = { chunk: c.from.chunk, exportedAs: c.from.exportedAs, ...far, sha256: c.from.sha256 };
      }
      captures.push(record);
    }
    if (captures.length !== sp.captures.length) continue; // the misses are already reported
    f.captures = captures;
    console.log(`  ${row.id}[${j}] ← ${sp.name}: ${captures.length} capture(s)${captures.length ? ` (${captures.map((c) => c.as).join(", ")})` : ""}`);
  }
}

// ---- write ------------------------------------------------------------------
const after = JSON.stringify(ledger, null, 2) + "\n";
for (const p of problems) console.log(`  UNRESOLVED ${p}`);
if (problems.length > 0) {
  console.log(`\nFAIL — ${problems.length} capture(s) could not be located upstream; ledger left unchanged`);
  process.exit(1);
}
if (checkOnly) {
  const drifted = after !== before;
  console.log(drifted ? "\nFAIL — ledger.json captures differ from build/footprints.json (re-run without --check)" : "\nPASS — ledger.json captures match the emitted footprints, rebased upstream");
  process.exit(drifted ? 1 : 0);
}
if (after !== before) writeFileSync(LEDGER_PATH, after);
console.log(`\nPASS — ${after === before ? "already current" : "ledger.json updated"}; now run: npx tsx ledger/check.ts`);
