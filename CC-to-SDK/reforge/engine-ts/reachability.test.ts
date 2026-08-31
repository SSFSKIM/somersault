// Controls for the static-reachability checker. The rule this project keeps
// re-learning (§3.1 non-vacuity): a checker nobody has watched reject anything
// is not a check. So every rule is exercised from both sides — a fixture that
// violates it must be REJECTED, and a legitimate neighbour must still PASS.
//
// Fixtures are written to a temp dir, never into engine-ts/: a committed
// fixture with a forbidden import would poison both `tsc --noEmit` and the
// orphan rule it exists to test.
//
// The compact-syntax and package-traversal blocks below are the W0 boundary
// review's negative controls (lens 2): before the AST rewrite the checker's
// regexes required whitespace after `import`/`export`, and the walk stopped at
// every bare specifier — so `export{x}from"<chunk>"` and a package entry that
// re-exported a chunk both passed.
//
// Run: cd reforge && npx tsx engine-ts/reachability.test.ts
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReachability, DEFAULT_ENTRY, scanModule, type Violation } from "./check-reachability.js";
import { BUNDLE_MODULES, BUNFS } from "../src/pin.js";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const roots: string[] = [];
/** Build a fixture package: { "entry.ts": source, ... } → absolute entry path. */
function fixture(files: Record<string, string>, entry = "entry.ts"): string {
  const root = mkdtempSync(join(tmpdir(), "reforge-reach-"));
  roots.push(root);
  for (const [name, src] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, src);
  }
  return join(root, entry);
}
const fmt = (vs: Violation[]) => vs.map((v) => `${v.rule}:${v.specifier ?? v.detail}`).join(", ");
const rejects = (name: string, entry: string, rule: Violation["rule"]) => {
  const r = checkReachability(entry);
  check(name, r.violations.some((v) => v.rule === rule), r.violations.length === 0 ? "accepted the fixture" : `expected ${rule}, got ${fmt(r.violations)}`);
};
const accepts = (name: string, entry: string) => {
  const r = checkReachability(entry);
  check(name, r.violations.length === 0, fmt(r.violations));
};

console.log("=== engine-ts reachability checker controls ===");

// --- positive controls ---
const skeleton = checkReachability(DEFAULT_ENTRY);
check("the skeleton itself is clean", skeleton.violations.length === 0, fmt(skeleton.violations));
check("the walk is not vacuous (reached >1 file)", skeleton.files.length > 1, `${skeleton.files.length} file(s)`);
check("the walk reached the registry (X7 surface)", skeleton.files.some((f) => f.endsWith("/registry.ts")));
accepts("an innocuous local import graph is accepted", fixture({
  "entry.ts": 'import { ok } from "./helper.js";\nexport const v = ok;\n',
  "helper.ts": "export const ok = 1;\n",
}));

// --- negative controls, one per delegation route the static gate can see ---
const chunk = readdirSync(BUNDLE_MODULES).find((f) => f.startsWith("chunk-") && f.endsWith(".js"));
if (!chunk) throw new Error(`fixture drift: no chunk-*.js under ${BUNDLE_MODULES}`);
const bundleChunk = join(BUNDLE_MODULES, chunk);
const quoted = JSON.stringify(bundleChunk);

rejects("static import of an extraction chunk is rejected", fixture({
  "entry.ts": `import * as c from ${quoted};\nexport const v = c;\n`,
}), "FORBIDDEN");

rejects("dynamic import of an extraction chunk is rejected", fixture({
  "entry.ts": `export const load = () => import(${quoted});\n`,
}), "FORBIDDEN");

rejects("require of an extraction chunk is rejected", fixture({
  "entry.ts": `export const c = require(${quoted});\n`,
}), "FORBIDDEN");

rejects("import-equals require of an extraction chunk is rejected", fixture({
  "entry.ts": `import c = require(${quoted});\nexport const v = c;\n`,
}), "FORBIDDEN");

rejects("import of the materialized build/graph is rejected", fixture({
  "entry.ts": `import ${JSON.stringify(join(import.meta.dirname, "..", "build", "graph", "cli"))};\n`,
}), "FORBIDDEN");

rejects("import of the build/real-binary symlink is rejected", fixture({
  "entry.ts": `import ${JSON.stringify(join(import.meta.dirname, "..", "build", "real-binary"))};\n`,
}), "FORBIDDEN");

rejects("a /$bunfs/root/ specifier is rejected", fixture({
  "entry.ts": `import * as c from "${BUNFS}chunk-fy12d89p.js";\nexport const v = c;\n`,
}), "BUNFS");

// The symlink route: the specifier's own path is innocent, only its realpath is
// forbidden. Path-prefix matching alone would wave this through.
const linkRoot = mkdtempSync(join(tmpdir(), "reforge-reach-link-"));
roots.push(linkRoot);
symlinkSync(bundleChunk, join(linkRoot, "innocent.js"));
writeFileSync(join(linkRoot, "entry.ts"), 'import * as c from "./innocent.js";\nexport const v = c;\n');
rejects("a symlink whose target is an extraction chunk is rejected", join(linkRoot, "entry.ts"), "FORBIDDEN");

rejects("a computed dynamic import is rejected", fixture({
  "entry.ts": 'const p = process.env.P ?? "";\nexport const load = () => import(p);\n',
}), "DYNAMIC");

rejects("an unresolvable local import is rejected", fixture({
  "entry.ts": 'import { x } from "./nope.js";\nexport const v = x;\n',
}), "FORBIDDEN");

rejects("an unreached file in the tree is rejected as an orphan", fixture({
  "entry.ts": "export const v = 1;\n",
  "hidden.ts": `import * as c from ${quoted};\nexport const v = c;\n`,
}), "ORPHAN");

rejects("a nonexistent entry fails instead of passing vacuously", join(tmpdir(), "reforge-reach-absent", "entry.ts"), "ENTRY");

// --- compact (whitespace-free) syntax: what the regex sweep could not see ---
rejects("a compact `import{x}from\"…\"` of a chunk is rejected", fixture({
  "entry.ts": `import{x}from${quoted};\nexport const v = x;\n`,
}), "FORBIDDEN");

rejects("a compact re-export `export{x}from\"…\"` of a chunk is rejected", fixture({
  "entry.ts": `export{x}from${quoted};\n`,
}), "FORBIDDEN");

rejects("a compact star re-export `export*from\"…\"` of a chunk is rejected", fixture({
  "entry.ts": `export*from${quoted};\n`,
}), "FORBIDDEN");

rejects("a multi-hop re-export chain through a compact line is rejected", fixture({
  "entry.ts": 'export { z } from "./mid.js";\n',
  "mid.ts": `export{z}from${quoted};\n`,
}), "FORBIDDEN");

accepts("a compact re-export of a clean local file is still accepted", fixture({
  "entry.ts": 'export{z}from"./mid.js";\n',
  "mid.ts": "export const z = 1;\n",
}));

rejects("a file the parser cannot read is rejected rather than half-walked", fixture({
  "entry.ts": "export const v = ;\n",
}), "PARSE");

// --- bare packages: the walk may not stop at the package boundary ---
/** A fixture with `node_modules/<pkg>` whose entry re-exports an extraction chunk. */
function packageFixture(pkg: string): string {
  const root = mkdtempSync(join(tmpdir(), "reforge-reach-pkg-"));
  roots.push(root);
  const dir = join(root, "node_modules", ...pkg.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0", main: "index.js" }));
  writeFileSync(join(dir, "index.js"), `export * from ${quoted};\n`);
  writeFileSync(join(root, "entry.ts"), `import { a } from ${JSON.stringify(pkg)};\nexport const v = a;\n`);
  return join(root, "entry.ts");
}

rejects("a package entry that re-exports an extraction chunk is rejected", packageFixture("shim-lib"), "FORBIDDEN");
accepts("an allowlisted package is vouched for, not traversed", packageFixture("typescript"));

rejects("an unresolved bare specifier is rejected", fixture({
  "entry.ts": 'import { x } from "no-such-package-anywhere";\nexport const v = x;\n',
}), "PACKAGE");

accepts("a node builtin is accepted without traversal", fixture({
  "entry.ts": 'import { join } from "node:path";\nexport const v = join;\n',
}));

// --- the AST must read code, not comments or string contents ---
accepts("a forbidden import that exists only in a comment is accepted", fixture({
  "entry.ts": `// import * as c from ${quoted};\n/* import "${BUNFS}chunk-x.js"; */\nexport const v = 1;\n`,
}));
rejects("the same import uncommented is rejected", fixture({
  "entry.ts": `import * as c from ${quoted};\nexport const v = c;\n`,
}), "FORBIDDEN");
check(
  "scanModule does not read a specifier out of a string literal",
  scanModule("x.ts", 'const s = \'import "./x.js"\'; export const v = s;\n').specifiers.length === 0,
);
check(
  "scanModule reads the compact forms the regexes missed",
  JSON.stringify(scanModule("x.ts", 'import{a}from"./a.js";export{b}from"./b.js";export*from"./c.js";').specifiers) ===
    JSON.stringify(["./a.js", "./b.js", "./c.js"]),
  JSON.stringify(scanModule("x.ts", 'import{a}from"./a.js";export{b}from"./b.js";export*from"./c.js";').specifiers),
);

for (const r of roots) if (existsSync(r)) rmSync(r, { recursive: true, force: true });

console.log(failures === 0 ? "\nPASS — the checker rejects every reachable delegation route and still accepts clean code" : `\nFAIL — ${failures} control(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
