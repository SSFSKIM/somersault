// Derivation perturbation — the non-vacuity contract behind the manifest's
// per-capture derivations.
//
//   npx tsx strangle/perturb.ts
//
// Re-deriving a splice's captured identifiers from the matched body per build
// is the whole reason a version catch-up is mechanical (2.1.241 → 2.1.251 moved
// `hui` → `q6t` and `yzv` → `APn` and nothing had to be re-anchored). That claim
// is only worth anything if the derivation actually READS the upstream body and
// FAILS LOUDLY when the shape it reads is gone. Both halves are asserted here,
// per capture, against the real spans in the pinned bundle:
//
//   tracking  rename the identifier upstream -> the derivation returns the new
//             name. A hardcoded or accidentally-constant derivation fails here.
//   loudness  destroy the identifier upstream (it becomes a numeric literal) ->
//             the derivation THROWS. A derivation that shrugs and returns
//             something plausible would splice a delegation referencing a
//             binding that no longer exists, and the corpus would have to catch
//             it much later, if at all.
//
// Read straight out of the pinned extraction — no graph is materialized and
// build/ is untouched, so this can run alongside a gate.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { chunkAst, excise } from "./ast.js";
import { SPLICES } from "./manifest.js";
import { textModules } from "./prepare.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Replace a whole token (identifier or dotted path), never a substring of one. */
const retoken = (body: string, token: string, next: string) =>
  body.replace(new RegExp(`(?<![\\w$])${escape(token)}(?![\\w$])`, "g"), next);

const sources = new Map<string, string>();
for (const path of textModules(BUNDLE_MODULES)) sources.set(path, readFileSync(path, "utf8"));

let checks = 0;
const failures: string[] = [];

console.log(`derivation perturbation @ ${ENGINE_VERSION}`);

for (const sp of SPLICES) {
  const owner = [...sources].find(([, s]) => s.includes(sp.anchor));
  if (!owner) {
    failures.push(`${sp.name}: anchor not found in the pinned bundle`);
    continue;
  }
  const [path, src] = owner;
  const cut = excise(chunkAst(path, src), src.indexOf(sp.anchor), sp.target);
  const captures = sp.captures ?? [];
  console.log(`\n  ${sp.name} [${sp.target}] ${cut.label} in ${relative(BUNDLE_MODULES, path)} — ${captures.length} capture(s)`);
  if (captures.length === 0) continue;

  for (const c of captures) {
    const identifier = c.derive(cut.original);
    checks += 2;

    // tracking: the same body with the identifier renamed must derive the rename
    const renamed = identifier
      .split(".")
      .map((seg) => `Z${seg}Z`)
      .join(".");
    let tracked: string;
    try {
      tracked = c.derive(retoken(cut.original, identifier, renamed));
    } catch (e) {
      tracked = `THREW: ${(e as Error).message}`;
    }
    const tracks = tracked === renamed;
    if (!tracks) failures.push(`${sp.name}.${c.as}: rename not tracked — expected ${renamed}, got ${tracked}`);

    // loudness: with the identifier destroyed the derivation must throw
    let loud = false;
    let derivedAnyway = "";
    try {
      derivedAnyway = c.derive(retoken(cut.original, identifier, "1"));
    } catch {
      loud = true;
    }
    if (!loud) failures.push(`${sp.name}.${c.as}: perturbation was SILENT — derived ${JSON.stringify(derivedAnyway)}`);

    console.log(`    ${tracks && loud ? "ok  " : "FAIL"} ${c.as} = ${identifier} [${c.kind}]  tracks=${tracks} loud=${loud}`);
  }
}

console.log(`\n=== derivation perturbation: ${checks} check(s) ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (checks === 0) {
  // An empty run reporting success is exactly the vacuous pass this file exists
  // to forbid.
  console.log("\nFAIL — no captures were checked");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "\nPASS — every capture tracks its rename and fails loudly when destroyed" : "\nFAIL");
  process.exitCode = failures.length === 0 ? 0 : 1;
}
