// Derivation perturbation — the non-vacuity contract behind the manifest's
// per-capture derivations, and the INVENTORY contract behind the manifest's
// capture list.
//
//   npx tsx strangle/perturb.ts
//
// Two contracts, because the first alone is not enough. Perturbation grades
// each derivation the manifest DECLARES; it is silent about the ones it does
// not, so an incomplete inventory passed cleanly — deleting text-delta's
// telemetry captures made this file quieter rather than louder, and the corpus
// could not tell either, because the helpers only matter on the type-mismatch
// branch a healthy stream never takes (campaign spec W0 fix, lens 1). The
// inventory phase therefore derives each body's free variables from the AST,
// independent of the manifest, and requires an exact match in both directions.
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
import { resolveAnchor } from "./anchor.js";
import { chunkAst, excise } from "./ast.js";
import { deriveCaptures, SPLICES } from "./manifest.js";
import { textModules } from "./prepare.js";
import { assertCaptureInventory } from "./scope.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Replace a whole token (identifier or dotted path), never a substring of one. */
const retoken = (body: string, token: string, next: string) =>
  body.replace(new RegExp(`(?<![\\w$])${escape(token)}(?![\\w$])`, "g"), next);

const sources = new Map<string, string>();
for (const path of textModules(BUNDLE_MODULES)) sources.set(path, readFileSync(path, "utf8"));

let checks = 0;
let inventories = 0;
const failures: string[] = [];

console.log(`derivation perturbation + capture inventory @ ${ENGINE_VERSION}`);

for (const sp of SPLICES) {
  // Same resolver the build uses, so a `coLiteral`-scoped row is perturbed
  // against the chunk it will actually be spliced in rather than whichever
  // sibling happens to be scanned first.
  let owner: [string, string];
  try {
    const r = resolveAnchor(sources, sp, (p) => relative(BUNDLE_MODULES, p));
    owner = [r.path, r.source];
  } catch (e) {
    failures.push(`${sp.name}: ${(e as Error).message}`);
    continue;
  }
  const [path, src] = owner;
  const cut = excise(chunkAst(path, src), src.indexOf(sp.anchor), sp.target);
  const captures = sp.captures;
  console.log(`\n  ${sp.name} [${sp.target}] ${cut.label} in ${relative(BUNDLE_MODULES, path)} — ${captures.length} capture(s)`);

  // inventory: the manifest's capture list must BE the body's free-variable set
  inventories++;
  try {
    const free = assertCaptureInventory(sp.name, cut.node, deriveCaptures(sp, cut.original).map((c) => c.identifier));
    console.log(`    ok   inventory: ${free.length} free variable(s) [${free.join(", ") || "none"}] — exactly the declared captures`);
  } catch (e) {
    const detail = (e as Error).message.split("\n").slice(1).join(" ").trim();
    failures.push(`${sp.name}: ${detail}`);
    console.log(`    FAIL inventory: ${detail}`);
  }
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

console.log(`\n=== derivation perturbation: ${checks} check(s) + ${inventories} capture inventor(ies) ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (checks === 0 || inventories !== SPLICES.length) {
  // An empty run reporting success is exactly the vacuous pass this file exists
  // to forbid — and a run that skipped a splice's inventory is the same shape.
  console.log(`\nFAIL — ${checks === 0 ? "no captures were checked" : `only ${inventories}/${SPLICES.length} splices reached the inventory check`}`);
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "\nPASS — every capture tracks its rename, fails loudly when destroyed, and the declared set IS the body's free-variable set"
      : "\nFAIL",
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
