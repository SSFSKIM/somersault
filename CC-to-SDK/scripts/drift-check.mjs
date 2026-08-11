#!/usr/bin/env node
// Drift check (W4.3): name-level diff of the installed @anthropic-ai/claude-agent-sdk declared
// surface vs npm HEAD. Surfaces: Options fields, Query methods, SDKMessage union members, top-level
// exported declaration names. Usage (from CC-to-SDK/):
//   node scripts/drift-check.mjs [--json]
// Prints an actionable added/removed report per surface; exits 0 (a report, not a gate).
// The full ritual (docs sweep + probe re-runs) is docs/parity/drift-ritual.md.
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "@anthropic-ai/claude-agent-sdk";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

function surfaces(dts) {
  const block = (startRe) => {
    const m = dts.match(startRe);
    if (!m) return "";
    const start = m.index + m[0].length;
    const end = dts.indexOf("\n};", start);
    return end === -1 ? "" : dts.slice(start, end);
  };
  const fields = (body) => [...body.matchAll(/^    ([A-Za-z_$][\w$]*)\??[:(]/gm)].map((m) => m[1]);
  const optionsBody = block(/export declare type Options = \{/);
  const queryBody = block(/export declare interface Query[^{]*\{/);
  const unionM = dts.match(/export declare type SDKMessage = ([^;]+);/);
  const union = unionM ? unionM[1].split("|").map((s) => s.trim()).filter(Boolean) : [];
  const exports_ = [...dts.matchAll(/^export declare (?:abstract )?(?:type|interface|function|const|class|enum) ([\w$]+)/gm)].map((m) => m[1]);
  return {
    optionsFields: [...new Set(fields(optionsBody))].sort(),
    queryMethods: [...new Set(fields(queryBody))].sort(),
    sdkMessageMembers: [...new Set(union)].sort(),
    exportedNames: [...new Set(exports_)].sort(),
  };
}

function diff(installed, head) {
  const out = {};
  for (const k of Object.keys(installed)) {
    const a = new Set(installed[k]), b = new Set(head[k]);
    out[k] = { added: head[k].filter((x) => !a.has(x)), removed: installed[k].filter((x) => !b.has(x)) };
  }
  return out;
}

// installed
const installedPath = join(root, "harness", "node_modules", PKG, "sdk.d.ts");
const installedVersion = JSON.parse(readFileSync(join(root, "harness", "node_modules", PKG, "package.json"), "utf8")).version;
const installed = surfaces(readFileSync(installedPath, "utf8"));

// npm HEAD
const view = JSON.parse(execFileSync("npm", ["view", PKG, "version", "dist.tarball", "--json"], { encoding: "utf8" }));
const headVersion = view.version, tarball = view["dist.tarball"];
const tmp = mkdtempSync(join(tmpdir(), "sdk-drift-"));
let head;
try {
  execFileSync("bash", ["-c", `curl -fsSL '${tarball}' | tar -xz -C '${tmp}' package/sdk.d.ts`]);
  head = surfaces(readFileSync(join(tmp, "package", "sdk.d.ts"), "utf8"));
} finally { rmSync(tmp, { recursive: true, force: true }); }

// False-clean guard: an empty parse (format change breaking the regexes) must not read as "no drift".
for (const s of [["installed", installed], ["npm HEAD", head]]) {
  for (const [k, v] of Object.entries(s[1])) {
    if (!v.length) { console.error(`PARSE FAILURE: ${s[0]} ${k} extracted 0 names — fix the regexes in this script before trusting any verdict.`); process.exit(2); }
  }
}

// ---- Appserver pass (Task 12, spec D11): docs/parity/appserver.md's generated denominator. Unlike the
// SDK-vs-npm-HEAD pass above (a report, not a gate), THIS pass IS a gate: a walked token with no
// scorecard row means the "100% coverage" scorecard's row set has silently diverged from the code it
// claims to cover, so the whole script exits 1. No network needed — purely local source + doc.
// Computed BEFORE the --json early exit below: automation is told to use --json, and with the gate sitting
// after that exit a missing scorecard row always exited 0 there — i.e. the gate never ran where it mattered.
const installedDtsRaw = readFileSync(installedPath, "utf8"); // reuse the file already read for `installed` above
const appserverSources = {
  // Both quote styles: a single-quoted literal is still an op, and a walker that only sees double
  // quotes is a gate that a style change can silently switch off (review finding, T12).
  "host/ops.ts": () => [...readFileSync(join(root, "harness", "src", "host", "ops.ts"), "utf8").matchAll(/op: z\.literal\(["'](\w+)["']\)/g)].map((m) => m[1]),
  "bridge/types.ts": () => [...readFileSync(join(root, "harness", "src", "bridge", "types.ts"), "utf8").matchAll(/type: z\.literal\(["'](\w+)["']\)/g)].map((m) => m[1]),
  // Only the 7 wrappers re-exported from reader/fork/mutate — rows.ts's rowKind/promptText/
  // rewindAnchorsFrom are row-shape helpers, not their own protocol seams (spec §10(c): "the 7 session
  // store wrappers"), so a bare `export {...}` scan over-counts; scope to those three source files.
  "sessions/index.ts": () => [...readFileSync(join(root, "harness", "src", "sessions", "index.ts"), "utf8")
    .matchAll(/^export \{ ([^}]+) \} from "\.\/(?:reader|fork|mutate)\.js";$/gm)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim())),
  // Deliberately NOT reusing surfaces()'s block() helper above: that helper's "\n};" end-marker is
  // correct for `type Options = {...};` but `interface Query {...}` closes with a bare "\n}" (no
  // semicolon) — block() overruns into the next semicolon-closed type and over-counts (32 vs the true
  // 27; see docs/parity/appserver.md gap 5). This pass re-parses independently, ending at the first
  // flush-left "\n}" (verified against the installed sdk.d.ts to yield exactly 27 methods).
  "sdk.d.ts (Query)": () => {
    const m = installedDtsRaw.match(/export declare interface Query[^{]*\{/);
    if (!m) return [];
    const start = m.index + m[0].length;
    const end = installedDtsRaw.indexOf("\n}", start);
    const body = end === -1 ? "" : installedDtsRaw.slice(start, end);
    // `[(<]`, not `(`: a generic method (`foo<T>(x: T)`) is still a method, and requiring the paren
    // to follow the name immediately let one slip past the gate unseen (review finding, T12).
    return [...body.matchAll(/^\s{4}(\w+)\s*[(<]/gm)].map((mm) => mm[1]);
  },
};
const scorecardPath = join(root, "docs", "parity", "appserver.md");
const scorecardRows = new Set(
  [...readFileSync(scorecardPath, "utf8").matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm)]
    .map(([, token, source]) => `${source}::${token}`),
);
const appserverWalked = {};
const appserverMissing = [];
for (const [source, walk] of Object.entries(appserverSources)) {
  const tokens = walk();
  // Same false-clean guard the SDK surfaces get above: a walker that parses NOTHING finds no missing rows
  // and prints "no drift", so a reformatted source silently switches this gate off. Zero tokens is a
  // script bug, never a clean bill of health.
  if (!tokens.length) { console.error(`PARSE FAILURE: appserver walker ${source} extracted 0 tokens — fix the regexes in this script before trusting any verdict.`); process.exit(2); }
  appserverWalked[source] = tokens.length;
  for (const t of tokens) if (!scorecardRows.has(`${source}::${t}`)) appserverMissing.push(`${source}::${t}`);
}

// ---- Appserver staleness pass: row PRESENCE (above) is not row TRUTH. The M2a incident: 15 methods
// shipped while their rows read planned(M2) for twelve days, and this gate stayed green — it only ever
// checked that walked tokens HAD rows, never that a row's status matched the code. Two checks, each
// direction using the set that makes it fail loud without being trippable:
//   - a `shipped(...)` row's wire name must exist in the code — union of the method registry
//     (schema/index.ts methodSchemas, which pins every dispatchable method) and a broad wire-name-shaped
//     string-literal scan over appserver/**/*.ts (notifications have no registry; emission helpers vary,
//     so the scan is anchored on the names, not the call sites);
//   - a `planned(...)`/`probe-gated` row's wire name must NOT be in the method registry — registry ONLY,
//     so a planned name quoted in a comment or an error message cannot false-trip the gate. (A planned
//     NOTIFICATION that starts firing is invisible to this check — acceptable: notifications ship with
//     their methods, and the method row catches it.)
const liveMethods = new Set(
  [...readFileSync(join(root, "harness", "src", "appserver", "schema", "index.ts"), "utf8")
    .matchAll(/["']([^"']+)["']:\s*\{\s*params/g)].map((m) => m[1]),
);
if (!liveMethods.size) { console.error(`PARSE FAILURE: appserver staleness pass extracted 0 methods from schema/index.ts — fix the regexes in this script before trusting any verdict.`); process.exit(2); }
const appserverDir = join(root, "harness", "src", "appserver");
const liveWireStrings = new Set(readdirSync(appserverDir, { recursive: true })
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => [...readFileSync(join(appserverDir, f), "utf8")
    .matchAll(/["']([a-z][a-zA-Z]*(?:\/[a-zA-Z]+)+)["']/g)].map((m) => m[1])));
const wireNameRe = /^[a-z][a-zA-Z]*(?:\/[a-zA-Z]+)+$/;
const appserverStale = [];
const statusRows = [...readFileSync(scorecardPath, "utf8")
  .matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)];
if (!statusRows.length) { console.error(`PARSE FAILURE: appserver staleness pass parsed 0 scorecard rows — fix the regexes in this script before trusting any verdict.`); process.exit(2); }
for (const [, token, source, methodCol, , status] of statusRows) {
  const name = (methodCol.match(/`([^`]+)`/) || [])[1];
  if (!name || !wireNameRe.test(name)) continue; // N/A rows and non-wire-shaped columns have no status to verify
  if (/^shipped/.test(status) && !liveMethods.has(name) && !liveWireStrings.has(name)) {
    appserverStale.push(`${source}::${token} → ${name} claims "${status}" but the name exists nowhere under appserver/`);
  } else if (/^(planned|probe-gated)/.test(status) && liveMethods.has(name)) {
    appserverStale.push(`${source}::${token} → ${name} claims "${status}" but the method is registered in schema/index.ts`);
  }
}

// ---- Registry→scorecard direction (Task 6, spec §9's "zero schema-less methods"). The two checks above
// both start from the DOC: a walked token needs a row, a row's status needs to match. Neither can see a
// method that is registered, dispatchable and generated into the published JSON-Schema artifact while the
// scorecard never mentions it — which is precisely the drift a server-origin method makes (nothing walks
// `thread/start`; no seam produces it). So the third check starts from the CODE: every `methodSchemas` key
// must be named, in backticks, by SOME row's protocol-method column. All backticks in the column count,
// not just the first — a row legitimately names more than one method (`thread/status/changed` (+
// `thread/list` status field)), and reading only the first would demand duplicate rows to satisfy the gate.
const rowNamedMethods = new Set(statusRows.flatMap((r) => [...r[3].matchAll(/`([^`]+)`/g)].map((m) => m[1])));
const appserverUnrowed = [...liveMethods].filter((m) => !rowNamedMethods.has(m));

const report = {
  package: PKG, installed: installedVersion, head: headVersion, drift: diff(installed, head),
  appserver: { scorecard: "docs/parity/appserver.md", walked: appserverWalked, missing: appserverMissing, stale: appserverStale, unrowed: appserverUnrowed },
};
// The gate's verdict travels with the JSON too: exit 1 on a missing, stale or unrowed row, exactly as the
// text mode does.
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(appserverMissing.length || appserverStale.length || appserverUnrowed.length ? 1 : 0); }

console.log(`${PKG}: installed ${installedVersion} vs npm HEAD ${headVersion}\n`);
let any = false;
for (const [surface, { added, removed }] of Object.entries(report.drift)) {
  if (!added.length && !removed.length) { console.log(`  ${surface}: no drift`); continue; }
  any = true;
  console.log(`  ${surface}:`);
  for (const n of added) console.log(`    + ${n}`);
  for (const n of removed) console.log(`    - ${n}`);
}
console.log(any
  ? "\nDrift found → run the ritual: docs/parity/drift-ritual.md"
  : installedVersion === headVersion
    ? "\nInstalled IS npm HEAD — nothing to compare beyond identity."
    : "\nNo name-level drift (bodies/semantics may still have moved — spot-check the changelog).");

// ---- Appserver gate: computed above (before the --json exit); text mode only reports it here.
console.log(`\nappserver scorecard drift (docs/parity/appserver.md, spec D11):`);
for (const [source, count] of Object.entries(appserverWalked)) console.log(`  ${source}: ${count} tokens walked`);
if (appserverMissing.length) {
  console.error(`\nFAIL: walked token(s) with no scorecard row: ${appserverMissing.join(", ")}`);
  console.error(`Add a row to docs/parity/appserver.md (or fix the source) — see spec D11.`);
  process.exitCode = 1;
} else {
  console.log(`  every walked token has a scorecard row — no drift`);
}
if (appserverStale.length) {
  console.error(`\nFAIL: scorecard row status contradicts the code (${appserverStale.length}):`);
  for (const s of appserverStale) console.error(`  ${s}`);
  console.error(`Rewalk the statuses in docs/parity/appserver.md — a stale status is the gate's whole reason to exist.`);
  process.exitCode = 1;
} else {
  console.log(`  every row status matches the live surface (${liveMethods.size} registered methods) — no staleness`);
}
if (appserverUnrowed.length) {
  console.error(`\nFAIL: registered method(s) no scorecard row names (${appserverUnrowed.length}):`);
  for (const m of appserverUnrowed) console.error(`  ${m} — in schema/index.ts and in the generated artifact, absent from every row`);
  console.error(`Add a row naming each in docs/parity/appserver.md — a dispatchable method the scorecard never mentions is exactly the "100% coverage" claim going quietly false.`);
  process.exitCode = 1;
} else {
  console.log(`  every registered method is named by a scorecard row — zero schema-less methods`);
}
