// §3.3 / C12a-W9a — the session-storage subsystem's PUBLIC SURFACE, derived
// from the artifact and carried by the ledger row.
//
//   npx tsx research/tools/extract-storage-surface.ts [--check]
//
// WHY. `subsystem/session-storage` is a §1.1 row whose artifact list, until this
// wave, was ONE 723-byte method (`materializeSessionFile`, the C1 spike) — 0.4 %
// of a 172 KB subsystem. A row whose recorded surface is 0.4 % of the thing it
// names cannot be staled by §5 when the other 99.6 % moves, and the three
// children that follow (C12b/c/d) each own a slice of it. The scout counted 235
// public names by hand; this derives them, and it derives the fact that actually
// decides the port cut: WHICH of them anyone outside the subsystem calls.
//
// THE DERIVATION. `chunk-e6cn1914.js` is the barrel: it imports locals out of
// the engine chunk and re-exports them under public names. So the surface is its
// `export{local as Public,…}` map, and the CONSUMER question is answered one
// level down — the barrel itself is reached only through `import.meta.require`
// and dynamic `import()`, so it is a cycle-breaker rather than a seam. What real
// consumers do is import the LOCAL directly from `chunk-fy12d89p.js`, so this
// walks every module's import list from the engine chunk and counts.
//
// WHAT `--check` COMPARES. The public NAME SET and the local↔public mapping are
// EXACT: a pin that renames an export, drops one or re-points it at a different
// local reddens. The consumer COUNTS are FLOORS — a pin that adds a call site
// grows the number without anything having drifted, and a fixture that reddens
// on growth taxes every wave after it. A count that FALLS is drift and fails.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../../src/pin.js";
import { REFORGE_ROOT } from "../../src/runTurn.js";

const BARREL = "chunk-e6cn1914.js";
const ENGINE_CHUNK = "chunk-fy12d89p.js";
const FIXTURE = join(REFORGE_ROOT, "research", "fixtures", `session-storage-surface-${ENGINE_VERSION}.json`);
const check = process.argv.includes("--check");

if (!existsSync(join(BUNDLE_MODULES, BARREL))) {
  console.log(`FAIL  the pinned bundle is not present at ${BUNDLE_MODULES} — this fixture cannot be derived or checked here`);
  process.exit(1);
}

/** `export{a as B,c as D}` → [{ local: "a", name: "B" }, …]. A bare `export{a}` exports under its own name. */
function exportMap(text: string): { local: string; name: string }[] {
  const m = /export\{([^}]*)\}/.exec(text);
  if (m === null) throw new Error(`${BARREL}: no export statement`);
  return m[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const as = part.split(/\s+as\s+/);
      return as.length === 2 ? { local: as[0], name: as[1] } : { local: part, name: part };
    });
}

/** Every name a module imports FROM the engine chunk, by its name in the engine chunk. */
function importsFromEngine(text: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`import\\{([^}]*)\\}from"[^"]*${ENGINE_CHUNK.replace(".", "\\.")}"`, "g");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (t) out.add(t.split(/\s+as\s+/)[0]);
    }
  }
  return out;
}

const barrelText = readFileSync(join(BUNDLE_MODULES, BARREL), "utf8");
const exports_ = exportMap(barrelText).sort((a, b) => a.name.localeCompare(b.name));

const consumers = new Map<string, string[]>(); // local -> chunks importing it from the engine chunk
const importingChunks: string[] = [];
for (const file of readdirSync(BUNDLE_MODULES).sort()) {
  if (!file.endsWith(".js") || file === BARREL || file === ENGINE_CHUNK) continue;
  const names = importsFromEngine(readFileSync(join(BUNDLE_MODULES, file), "utf8"));
  let touched = false;
  for (const e of exports_) {
    if (!names.has(e.local)) continue;
    consumers.set(e.local, [...(consumers.get(e.local) ?? []), file]);
    touched = true;
  }
  if (touched) importingChunks.push(file);
}

const rows = exports_.map((e) => ({
  name: e.name,
  local: e.local,
  consumerChunksAtLeast: (consumers.get(e.local) ?? []).length,
}));

const perChunk = new Map<string, number>();
for (const [, chunks] of consumers) for (const c of chunks) perChunk.set(c, (perChunk.get(c) ?? 0) + 1);

const fx = {
  engineVersion: ENGINE_VERSION,
  generatedBy: "research/tools/extract-storage-surface.ts",
  barrel: BARREL,
  engineChunk: ENGINE_CHUNK,
  note:
    "The public surface of subsystem/session-storage, derived from the barrel's export map, with each name's cross-chunk consumers " +
    "counted by who imports its LOCAL directly out of the engine chunk (the barrel itself is reached only dynamically and is not a seam). " +
    "Names and the local mapping are exact; consumer counts are floors.",
  counts: {
    exports: rows.length,
    withConsumer: rows.filter((r) => r.consumerChunksAtLeast > 0).length,
    barrelOnly: rows.filter((r) => r.consumerChunksAtLeast === 0).length,
    forTesting: rows.filter((r) => r.name.endsWith("ForTesting")).length,
    importingChunksAtLeast: importingChunks.length,
  },
  topConsumers: [...perChunk]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([chunk, namesTakenAtLeast]) => ({ chunk, namesTakenAtLeast })),
  exports: rows,
};

if (!check) {
  writeFileSync(FIXTURE, JSON.stringify(fx, null, 2) + "\n");
  console.log(`=== session-storage public surface (pin ${ENGINE_VERSION}) ===`);
  console.log(`  ${fx.counts.exports} exports · ${fx.counts.withConsumer} with a cross-chunk consumer · ${fx.counts.barrelOnly} barrel-only (${fx.counts.forTesting} *ForTesting) · ${fx.counts.importingChunksAtLeast} importing chunks`);
  for (const t of fx.topConsumers) console.log(`  ${t.chunk.padEnd(24)} ${t.namesTakenAtLeast}`);
  console.log(`PASS — wrote ${rows.length} public name(s)`);
} else {
  if (!existsSync(FIXTURE)) {
    console.log(`FAIL  no committed fixture at ${FIXTURE} — generate it with: npx tsx research/tools/extract-storage-surface.ts`);
    process.exit(1);
  }
  const committed = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof fx;
  const problems: string[] = [];
  const now = new Map(rows.map((r) => [r.name, r]));
  for (const c of committed.exports) {
    const r = now.get(c.name);
    if (r === undefined) {
      problems.push(`'${c.name}' is no longer exported by ${BARREL} — the subsystem's public surface moved`);
      continue;
    }
    if (r.local !== c.local) problems.push(`${c.name}: re-points from local '${c.local}' to '${r.local}'`);
    if (r.consumerChunksAtLeast < c.consumerChunksAtLeast)
      problems.push(`${c.name}: consumers fell from ${c.consumerChunksAtLeast} to ${r.consumerChunksAtLeast} (floor)`);
  }
  for (const r of rows) if (!committed.exports.some((c) => c.name === r.name)) problems.push(`'${r.name}' is exported now and is not in the pinned surface`);
  for (const k of ["exports", "withConsumer", "barrelOnly", "forTesting"] as const) {
    if (fx.counts[k] !== committed.counts[k]) problems.push(`counts.${k}: ${committed.counts[k]} -> ${fx.counts[k]}`);
  }
  if (fx.counts.importingChunksAtLeast < committed.counts.importingChunksAtLeast)
    problems.push(`counts.importingChunksAtLeast fell from ${committed.counts.importingChunksAtLeast} to ${fx.counts.importingChunksAtLeast} (floor)`);
  const topNow = new Map(fx.topConsumers.map((t) => [t.chunk, t.namesTakenAtLeast]));
  for (const t of committed.topConsumers) {
    const n = topNow.get(t.chunk);
    if (n === undefined) problems.push(`${t.chunk} no longer imports any storage name (it took ${t.namesTakenAtLeast})`);
    else if (n < t.namesTakenAtLeast) problems.push(`${t.chunk}: names taken fell from ${t.namesTakenAtLeast} to ${n} (floor)`);
  }
  if (problems.length > 0) {
    for (const p of problems.slice(0, 20)) console.log(`  FAIL  ${p}`);
    console.log("FAIL — regenerate with: npx tsx research/tools/extract-storage-surface.ts");
    process.exit(1);
  }
  console.log(`PASS — ${committed.counts.exports} public name(s) match the pin; ${committed.counts.withConsumer} have a cross-chunk consumer, ${committed.counts.barrelOnly} are barrel-only`);
}
