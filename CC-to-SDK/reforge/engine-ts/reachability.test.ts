// Controls for the static-reachability checker. The rule this project keeps
// re-learning (§3.1 non-vacuity): a checker nobody has watched reject anything
// is not a check. So every rule is exercised from both sides — a fixture that
// violates it must be REJECTED, and a legitimate neighbour must still PASS.
//
// Fixtures are written to a temp dir, never into engine-ts/: a committed
// fixture with a forbidden import would poison both `tsc --noEmit` and the
// orphan rule it exists to test.
//
// Run: cd reforge && npx tsx engine-ts/reachability.test.ts
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReachability, DEFAULT_ENTRY, stripComments, type Violation } from "./check-reachability.js";
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

rejects("static import of an extraction chunk is rejected", fixture({
  "entry.ts": `import * as c from ${JSON.stringify(bundleChunk)};\nexport const v = c;\n`,
}), "FORBIDDEN");

rejects("dynamic import of an extraction chunk is rejected", fixture({
  "entry.ts": `export const load = () => import(${JSON.stringify(bundleChunk)});\n`,
}), "FORBIDDEN");

rejects("require of an extraction chunk is rejected", fixture({
  "entry.ts": `export const c = require(${JSON.stringify(bundleChunk)});\n`,
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
  "hidden.ts": `import * as c from ${JSON.stringify(bundleChunk)};\nexport const v = c;\n`,
}), "ORPHAN");

rejects("a nonexistent entry fails instead of passing vacuously", join(tmpdir(), "reforge-reach-absent", "entry.ts"), "ENTRY");

// --- the comment-stripping pair: it must not blind the checker ---
accepts("a forbidden import that exists only in a comment is accepted", fixture({
  "entry.ts": `// import * as c from ${JSON.stringify(bundleChunk)};\n/* import "${BUNFS}chunk-x.js"; */\nexport const v = 1;\n`,
}));
rejects("the same import uncommented is rejected", fixture({
  "entry.ts": `import * as c from ${JSON.stringify(bundleChunk)};\nexport const v = c;\n`,
}), "FORBIDDEN");
check(
  "stripComments does not eat '//' inside a string literal",
  stripComments('const u = "https://example.com/x"; // gone\n').includes("https://example.com/x"),
);
check("stripComments does blank a real line comment", !stripComments('const a = 1; // import "./x.js"\n').includes("./x.js"));

for (const r of roots) if (existsSync(r)) rmSync(r, { recursive: true, force: true });

console.log(failures === 0 ? "\nPASS — the checker rejects every reachable delegation route and still accepts clean code" : `\nFAIL — ${failures} control(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
