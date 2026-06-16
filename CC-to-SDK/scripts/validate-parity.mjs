import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS } from "./parity-areas.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs/parity/data");
const VERDICTS = new Set(["provided","configurable","build","not-possible","unknown"]);
const CONF = new Set(["verified","doc","inferred"]);
const SNAP = new Set(["feb","post-feb"]);
const PHASE = new Set(["1","2","3","non-goal"]);
const ID_RE = /^\d{2}[a-d]?\.\d+$/;

const errors = [];
const rows = [];
for (const f of existsSync(DATA) ? readdirSync(DATA) : []) {
  if (!f.endsWith(".json")) continue;
  let arr;
  try { arr = JSON.parse(readFileSync(join(DATA, f), "utf8")); }
  catch (e) { errors.push(`${f}: invalid JSON — ${e.message}`); continue; }
  if (!Array.isArray(arr)) { errors.push(`${f}: top-level must be an array`); continue; }
  for (const r of arr) rows.push([f, r]);
}

const reqStr = ["feature","what","ccSource","bridge"];
for (const [f, r] of rows) {
  const at = `${f} ${r.id ?? "?"}`;
  if (!ID_RE.test(r.id || "")) errors.push(`${at}: bad id`);
  if (!AREAS.includes(r.area)) errors.push(`${at}: unknown area "${r.area}"`);
  if (!VERDICTS.has(r.verdict)) errors.push(`${at}: bad verdict`);
  if (r.verdict === "unknown") errors.push(`${at}: unresolved "unknown" verdict`);
  if (!CONF.has(r.confidence)) errors.push(`${at}: bad confidence`);
  if (!SNAP.has(r.snapshot)) errors.push(`${at}: bad snapshot`);
  if (!PHASE.has(r.targetPhase)) errors.push(`${at}: bad targetPhase`);
  for (const k of reqStr) if (typeof r[k] !== "string" || !r[k].trim()) errors.push(`${at}: empty ${k}`);
  const surfaceOptional = r.verdict === "build" || r.verdict === "not-possible";
  if (!surfaceOptional && (typeof r.sdkSurface !== "string" || !r.sdkSurface.trim()))
    errors.push(`${at}: sdkSurface required for verdict "${r.verdict}"`);
}

const covered = new Set(rows.map(([, r]) => r.area));
const missing = AREAS.filter((a) => !covered.has(a));
if (missing.length) errors.push(`Areas with no rows: ${missing.join(", ")}`);

const verified = rows.filter(([, r]) => r.confidence === "verified").length;
if (verified < 15) errors.push(`Only ${verified} verified rows; need >=15`);

const ids = rows.map(([, r]) => r.id);
const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dupes.length) errors.push(`Duplicate ids: ${[...new Set(dupes)].join(", ")}`);

if (errors.length) {
  console.error(`PARITY VALIDATION FAILED (${errors.length}):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`OK: ${rows.length} rows, ${AREAS.length} areas covered, ${verified} verified.`);
