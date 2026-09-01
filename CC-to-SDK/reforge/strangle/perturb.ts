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
import { chunkAst, selectExcision } from "./ast.js";
import { planChunkReplacement } from "./chunk.js";
import { CHUNK_REPLACEMENTS, deriveCaptures, SPLICES } from "./manifest.js";
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
  let owner: [string, string, number[]];
  try {
    const r = resolveAnchor(sources, sp, (p) => relative(BUNDLE_MODULES, p));
    owner = [r.path, r.source, r.offsets];
  } catch (e) {
    failures.push(`${sp.name}: ${(e as Error).message}`);
    continue;
  }
  const [path, src, offsets] = owner;
  const cut = selectExcision(sp.name, chunkAst(path, src), offsets, sp.target, sp.signature);
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

// ---- S-chunk: the same two contracts, one level out (§2.2) -------------------
// "Export names are minified and churn per version, so the build derives them
// from the original chunk's export statement each build; perturbing a derived
// name must fail the build loudly." Two layers are graded here: each derivation
// on its own (tracking + loudness, exactly as above), and then the WHOLE PLAN
// against four fixture mutations — because a derivation that throws is only half
// the claim. The other half is that the surface checks around it (unclaimed
// export, unclassified import, top-level side effect) actually fire.
let plans = 0;
for (const cr of CHUNK_REPLACEMENTS) {
  let owner: [string, string];
  try {
    const r = resolveAnchor(sources, cr, (p) => relative(BUNDLE_MODULES, p));
    owner = [r.path, r.source];
  } catch (e) {
    failures.push(`${cr.name}: ${(e as Error).message}`);
    continue;
  }
  const [path, src] = owner;
  const bindings = [...cr.exports.map((e) => ["export", e] as const), ...cr.imports.map((i) => ["import", i] as const)];
  console.log(`\n  ${cr.name} [chunk] ${relative(BUNDLE_MODULES, path)} — ${cr.exports.length} export(s), ${cr.imports.length} import(s)`);

  for (const [role, b] of bindings) {
    const identifier = b.derive(src);
    checks += 2;
    const renamed = `Z${identifier}Z`;
    let tracked: string;
    try {
      tracked = b.derive(retoken(src, identifier, renamed));
    } catch (e) {
      tracked = `THREW: ${(e as Error).message}`;
    }
    const tracks = tracked === renamed;
    if (!tracks) failures.push(`${cr.name}.${b.as}: rename not tracked — expected ${renamed}, got ${tracked}`);

    let loud = false;
    let derivedAnyway = "";
    try {
      derivedAnyway = b.derive(retoken(src, identifier, "1"));
    } catch {
      loud = true;
    }
    if (!loud) failures.push(`${cr.name}.${b.as}: perturbation was SILENT — derived ${JSON.stringify(derivedAnyway)}`);
    console.log(`    ${tracks && loud ? "ok  " : "FAIL"} ${role} ${b.as} = ${identifier} [${b.kind}]  tracks=${tracks} loud=${loud}`);
  }

  // Fixture controls on the plan itself. Each mutation is a way the chunk could
  // move that a per-derivation check cannot see, and each must ABORT the build.
  // `chunkAst` caches per path, so every fixture gets its own.
  let n = 0;
  const mustReject = (label: string, mutate: (s: string) => string, expect: RegExp) => {
    plans++;
    const fixture = `${path}.perturb${n++}.js`;
    const map = new Map([[fixture, mutate(src)]]);
    let threw: string | null = null;
    try {
      planChunkReplacement(map, cr, () => "fixture.js");
    } catch (e) {
      threw = (e as Error).message;
    }
    const ok = threw !== null && expect.test(threw);
    if (!ok) failures.push(`${cr.name}: fixture '${label}' was accepted${threw ? ` with the wrong error: ${threw.split("\n")[0]}` : " SILENTLY"}`);
    console.log(`    ${ok ? "ok  " : "FAIL"} fixture ${label} -> ${ok ? "rejected" : threw === null ? "ACCEPTED" : "wrong error"}`);
  };
  // The §2.2 rule, stated exactly: a derived export name that no longer matches
  // the chunk's export clause must fail the build.
  const first = cr.exports[0];
  mustReject(
    "derived export name perturbed in the export clause",
    (s) => s.replace(/export\{([^}]*)\}/, (m, names: string) => `export{${names.replace(new RegExp(`(^|,)${first.derive(src)}(,|$)`), `$1Z${first.derive(src)}Z$2`)}}`),
    /export clause does not list|whole export surface/,
  );
  mustReject(
    "an export the manifest does not claim",
    (s) => s.replace(/var ([\w$]+)="Glob"/, 'var reforgeUnclaimed="x";var $1="Glob"').replace(/export\{/, "export{reforgeUnclaimed,"),
    /whole export surface|UNCLAIMED/,
  );
  mustReject(
    "an import binding the manifest does not classify",
    (s) => s.replace(/^import\{/m, "import{reforgeUnclassified,"),
    /classify every import binding|UNCLASSIFIED/,
  );
  mustReject(
    "a top-level side effect",
    (s) => s.replace(/\nexport\{/, '\nglobalThis.__reforgeSideEffect=1;\nexport{'),
    /top-level|side effects/,
  );
}

console.log(`\n=== derivation perturbation: ${checks} check(s) + ${inventories} capture inventor(ies) + ${plans} chunk fixture(s) ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
const expectedPlans = CHUNK_REPLACEMENTS.length * 4;
if (checks === 0 || inventories !== SPLICES.length || plans !== expectedPlans) {
  // An empty run reporting success is exactly the vacuous pass this file exists
  // to forbid — and a run that skipped a splice's inventory, or a chunk row's
  // fixture controls, is the same shape.
  console.log(
    `\nFAIL — ${
      checks === 0
        ? "no captures were checked"
        : inventories !== SPLICES.length
          ? `only ${inventories}/${SPLICES.length} splices reached the inventory check`
          : `only ${plans}/${expectedPlans} chunk fixture controls ran`
    }`,
  );
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "\nPASS — every capture and every derived chunk name tracks its rename, fails loudly when destroyed, and the declared sets ARE the real ones"
      : "\nFAIL",
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
