// The closure-ledger checker (campaign spec X2 — the ledger is a binding schema
// authority, and a ledger nobody validates is a progress metric nobody can
// trust).
//
//   npx tsx ledger/check.ts [path/to/ledger.json]
//   npx tsx ledger/check.test.ts     # positive + negative controls
//
// What it enforces:
//   - the row set is EXACTLY ledger/rows.ts's canonical list (§1.1 + §1.3):
//     no missing row, no unknown row, no duplicate, no §1.2-excluded row;
//   - id / kind / wave / title match the canonical row (a wave reassignment is
//     a deliberate two-file edit, reviewed like any other scope change);
//   - `state` is one of §1.1's five states;
//   - every dependency edge names an existing row and is not self-referential
//     (§2.4: an edge is a typed port into a not-yet-owned subsystem);
//   - footprint slots are `{chunk, hash}` (+ optional AST `span`), and the two
//     strongest states (`standalone-complete`, `assembled`) MUST carry one —
//     §5's pin-bump staling is blind without it. `spliced` may still be null:
//     footprint emission is C1's deliverable and the three pre-campaign splices
//     predate it;
//   - a `stale` row carries an adjudication note (§5);
//   - the ledger's `engineVersion` equals the pin, so a pin bump fails the
//     check until §5's semantic invalidation has been run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ENGINE_VERSION } from "../src/pin.js";
import { CANONICAL_ROWS, EXCLUDED_ROWS, LEDGER_STATES, ROW_KINDS, WAVES } from "./rows.js";

export const LEDGER_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "ledger.json");

export interface Footprint {
  /** the upstream chunk this row's implementation replaces, e.g. "chunk-fy12d89p.js" */
  chunk: string;
  /** sha256 (hex) of the replaced span's source at splice time */
  hash: string;
  /** optional AST node span [start, end] within the chunk */
  span?: [number, number];
}

export interface LedgerRow {
  id: string;
  kind: string;
  title: string;
  wave: string;
  state: string;
  /** row ids this row depends on — §2.4's typed ports into unowned subsystems */
  edges: string[];
  /** null until the owning wave records it; see the footprint rule above */
  footprint: Footprint[] | null;
  /** evidence links: splice names, scenario tags, commits */
  evidence?: string[];
  note?: string;
}

export interface Ledger {
  engineVersion: string;
  rows: LedgerRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const HASH_RE = /^[0-9a-f]{64}$/;

/** Validate a parsed ledger document. Returns every problem found, not just the first. */
export function checkLedger(doc: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(doc)) return ["ledger: not a JSON object"];

  if (doc.engineVersion !== ENGINE_VERSION) {
    errors.push(`engineVersion: ${JSON.stringify(doc.engineVersion)} != pinned ${ENGINE_VERSION} (a pin bump must run §5's semantic invalidation before this passes)`);
  }
  if (!Array.isArray(doc.rows)) return [...errors, "rows: missing or not an array"];
  const rows = doc.rows;
  if (rows.length === 0) return [...errors, "rows: empty — the ledger cannot pass vacuously"];

  const canonical = new Map(CANONICAL_ROWS.map((r) => [r.id, r]));
  const excluded = new Map(EXCLUDED_ROWS.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const raw of rows) if (isRecord(raw) && typeof raw.id === "string") ids.add(raw.id);

  rows.forEach((raw, i) => {
    const at = (msg: string) => errors.push(`rows[${i}]${isRecord(raw) && typeof raw.id === "string" ? ` (${raw.id})` : ""}: ${msg}`);
    if (!isRecord(raw)) return at("not an object");
    const id = raw.id;
    if (typeof id !== "string" || id.length === 0) return at("id: missing or not a string");
    if (seen.has(id)) at("duplicate row id");
    seen.add(id);

    if (excluded.has(id)) at(`row is on the §1.2 exclusion list (${excluded.get(id)!.reason}) and must not appear in the ledger`);
    const spec = canonical.get(id);
    if (!spec) {
      if (!excluded.has(id)) at("unknown row — not in ledger/rows.ts's canonical list");
    } else {
      if (raw.kind !== spec.kind) at(`kind: ${JSON.stringify(raw.kind)} != canonical ${spec.kind}`);
      if (raw.wave !== spec.wave) at(`wave: ${JSON.stringify(raw.wave)} != canonical ${spec.wave}`);
      if (raw.title !== spec.title) at("title: does not match ledger/rows.ts");
    }
    if (typeof raw.kind !== "string" || !(ROW_KINDS as readonly string[]).includes(raw.kind)) at(`kind: ${JSON.stringify(raw.kind)} is not one of ${ROW_KINDS.join(" | ")}`);
    if (typeof raw.wave !== "string" || !(WAVES as readonly string[]).includes(raw.wave)) at(`wave: ${JSON.stringify(raw.wave)} is not a campaign child id (C1..C17)`);

    const state = raw.state;
    if (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state)) {
      at(`state: ${JSON.stringify(state)} is not one of ${LEDGER_STATES.join(" | ")}`);
    }

    if (!isStringArray(raw.edges)) {
      at("edges: missing or not an array of row ids");
    } else {
      const local = new Set<string>();
      for (const e of raw.edges) {
        if (e === id) at(`edges: self-reference ${e}`);
        else if (!ids.has(e)) at(`edges: dangling reference ${JSON.stringify(e)} — no such row`);
        if (local.has(e)) at(`edges: duplicate ${JSON.stringify(e)}`);
        local.add(e);
      }
    }

    const fp = raw.footprint;
    if (fp === undefined) at("footprint: missing (use null until the owning wave records it)");
    else if (fp !== null) {
      if (!Array.isArray(fp) || fp.length === 0) at("footprint: must be null or a non-empty array of {chunk, hash}");
      else
        fp.forEach((f, j) => {
          if (!isRecord(f)) return at(`footprint[${j}]: not an object`);
          if (typeof f.chunk !== "string" || f.chunk.length === 0) at(`footprint[${j}].chunk: missing`);
          if (typeof f.hash !== "string" || !HASH_RE.test(f.hash)) at(`footprint[${j}].hash: not a sha256 hex digest`);
          if (f.span !== undefined && !(Array.isArray(f.span) && f.span.length === 2 && f.span.every((n) => typeof n === "number"))) {
            at(`footprint[${j}].span: must be [start, end] if present`);
          }
        });
    } else if (state === "standalone-complete" || state === "assembled") {
      at(`footprint: state '${state}' requires a recorded upstream footprint (§5 staling is blind without it)`);
    }

    if (state === "stale" && (typeof raw.note !== "string" || raw.note.trim().length === 0)) {
      at("note: a 'stale' row requires an adjudication note (§5)");
    }
    if (raw.evidence !== undefined && !isStringArray(raw.evidence)) at("evidence: must be an array of strings if present");
    if (raw.note !== undefined && typeof raw.note !== "string") at("note: must be a string if present");
  });

  for (const r of CANONICAL_ROWS) if (!seen.has(r.id)) errors.push(`missing row: ${r.id} (${r.kind}, ${r.wave})`);
  return errors;
}

export function summarize(doc: Ledger): string[] {
  const byKind = new Map<string, number>();
  const byState = new Map<string, number>();
  for (const r of doc.rows) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  }
  return [
    `rows: ${doc.rows.length} (${[...byKind].map(([k, n]) => `${k}=${n}`).join(", ")})`,
    `states: ${[...byState].map(([s, n]) => `${s}=${n}`).join(", ")}`,
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ? resolve(process.argv[2]) : LEDGER_PATH;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`ledger: cannot read ${path} — ${(e as Error).message}`);
    process.exit(2);
  }
  const errors = checkLedger(doc);
  console.log(`=== closure ledger: ${path} ===`);
  if (errors.length === 0) for (const line of summarize(doc as Ledger)) console.log(`  ${line}`);
  else for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(errors.length === 0 ? "\nPASS — ledger matches the canonical row list" : `\nFAIL — ${errors.length} problem(s)`);
  process.exit(errors.length === 0 ? 0 : 1);
}
