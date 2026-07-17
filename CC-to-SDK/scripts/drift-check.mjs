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
