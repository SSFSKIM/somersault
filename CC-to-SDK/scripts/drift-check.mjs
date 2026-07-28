#!/usr/bin/env node
// Drift check (W4.3): name-level diff of the installed @anthropic-ai/claude-agent-sdk declared
// surface vs npm HEAD. Surfaces: Options fields, Query methods, SDKMessage union members, top-level
// exported declaration names. Usage (from CC-to-SDK/):
//   node scripts/drift-check.mjs [--json]
// Prints an actionable added/removed report per surface; exits 0 (a report, not a gate).
// The full ritual (docs sweep + probe re-runs) is docs/parity/drift-ritual.md.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
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

const report = { package: PKG, installed: installedVersion, head: headVersion, drift: diff(installed, head) };
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

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

// ---- Appserver pass (Task 12, spec D11): docs/parity/appserver.md's generated denominator. Unlike the
// SDK-vs-npm-HEAD pass above (a report, not a gate), THIS pass IS a gate: a walked token with no
// scorecard row means the "100% coverage" scorecard's row set has silently diverged from the code it
// claims to cover, so the whole script exits 1. No network needed — purely local source + doc.
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

console.log(`\nappserver scorecard drift (docs/parity/appserver.md, spec D11):`);
const appserverMissing = [];
for (const [source, walk] of Object.entries(appserverSources)) {
  const tokens = walk();
  console.log(`  ${source}: ${tokens.length} tokens walked`);
  for (const t of tokens) if (!scorecardRows.has(`${source}::${t}`)) appserverMissing.push(`${source}::${t}`);
}
if (appserverMissing.length) {
  console.error(`\nFAIL: walked token(s) with no scorecard row: ${appserverMissing.join(", ")}`);
  console.error(`Add a row to docs/parity/appserver.md (or fix the source) — see spec D11.`);
  process.exitCode = 1;
} else {
  console.log(`  every walked token has a scorecard row — no drift`);
}
