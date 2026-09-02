// The closure-ledger checker (campaign spec X2 — the ledger is a binding schema
// authority, and a ledger nobody validates is a progress metric nobody can
// trust).
//
//   npx tsx ledger/check.ts [path/to/ledger.json]
//   npx tsx ledger/check.test.ts     # positive + negative controls
//
// What it enforces:
//   - the row set is EXACTLY ledger/rows.ts's canonical list (§1.1 + §1.3):
//     no missing row, no unknown row, no duplicate, no §1.2-excluded row;
//   - id / kind / wave / title match the canonical row (a wave reassignment is
//     a deliberate two-file edit, reviewed like any other scope change);
//   - `state` is one of §1.1's five states;
//   - every dependency edge names an existing row and is not self-referential
//     (§2.4: an edge is a typed port into a not-yet-owned subsystem);
//   - a `stale` row carries an adjudication note (§5);
//   - the ledger's `engineVersion` equals the pin, so a pin bump fails the
//     check until §5's semantic invalidation has been run;
//   - the FOOTPRINT rules below.
//
// ## Footprints (W0 boundary review, lens 2)
//
// Footprint validation used to be shape-only: a row could claim `assembled`
// while naming a chunk that does not exist, an arbitrary 64-hex "hash", and a
// reversed span, and nothing consumed C1's build/footprints.json. A footprint
// nobody resolves is decoration, and §5's pin-bump staling reads it. So a
// footprint is now checked against the artifacts it points at:
//
//   1. SHAPE — the record agreed across C1/C2:
//        { chunk, target: { start, end, sha256 }, captures: [...] }
//      `captures` is REQUIRED: a footprint that records only its target span
//      cannot be staled when a captured declaration moves, which is half of what
//      §5 exists to catch (see strangle/footprint.ts for the closure-surface
//      argument). ledger/backfill-captures.ts writes it from C1's emission.
//      An OWNED capture additionally carries `closure` — the transitive callees
//      of the helper the module reimplemented — validated the same way, span by
//      span, against whichever chunk each one names (W1 boundary review).
//   2. SPAN SANITY — integer offsets, `start < end`, and within the chunk.
//   3. UPSTREAM BYTES — with the extraction bundle present, the chunk must
//      exist and the span's bytes must hash to `target.sha256` IN THE UPSTREAM
//      BASIS. Bundle absent is a WARN-and-skip (a checkout on another machine
//      has no bundle); a mismatch is a hard FAIL, because that is exactly the
//      pin-drift signal §5 exists to catch.
//
//      This rule used to accept EITHER basis — upstream or materialized — and
//      that tolerance is what let a wrong-basis record through a green gate.
//      W7.6a's two new capture records were copied raw out of
//      build/footprints.json, so their offsets named the materialized graph
//      while the ledger's declared basis is upstream; rule 3 hashed both ways,
//      found a match in the second, and passed. The offsets pointed at bytes
//      that are a DIFFERENT DECLARATION upstream (`bge`'s recorded span lands on
//      `}}async function VE(`), so §5's whole purpose — stale this row when the
//      declaration moves — was defeated on a row that looked fully recorded.
//      A materialized-only match is therefore REFUSED by name, with the
//      conversion named in the message: ledger/backfill-captures.ts exists for
//      exactly this and is now a gate phase.
//   4. EVIDENCE — `standalone-complete` and `assembled` are ownership claims,
//      so they require a footprint AND at least one resolvable evidence link
//      (`commit:<sha>` or `scenario:<tag>`); `standalone-complete` on a
//      subsystem row additionally requires a matching registration in
//      engine-ts/modules (contract X7 — the other half of dual-wiring).
//   5. CROSS-CHECK — when reforge/build/footprints.json exists for this pin,
//      every `spliced` row's footprint must correspond to a splice in it.
//
// SPAN BASIS: the ledger records offsets into the **upstream bundle module**
// (`~/claude-code-bundle/<pin>/modules/<chunk>`), which is the same on every
// machine — targets and capture declarations alike. strangle/build.ts emits
// offsets into its *materialized* copy, whose absolute path shifts them, and
// `toUpstreamOffset` below is the conversion that puts a freshly emitted
// footprint into the committed basis. Rule 3 accepts ONE basis, the committed
// one; a record that only resolves in the emitted basis has not been converted
// and is refused rather than tolerated.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { BUNDLE_MODULES, BUNFS, ENGINE_VERSION } from "../src/pin.js";
// Contract X7's registration site, imported for its side effects so
// `ownedSubsystems()` reports what `engines/engine-ts --owned` would.
import "../engine-ts/modules/index.js";
import { ownedSubsystems } from "../engine-ts/registry.js";
import { CANONICAL_ROWS, EXCLUDED_ROWS, LEDGER_STATES, ROW_KINDS, WAVES } from "./rows.js";

const REFORGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const LEDGER_PATH = join(REFORGE_ROOT, "ledger.json");
export const FOOTPRINTS_PATH = join(REFORGE_ROOT, "build", "footprints.json");
/**
 * Where strangle/prepare.ts materializes the graph it splices. Derived here
 * rather than imported so the ledger checker does not depend on the strangler
 * build; it is only used to re-derive materialized-basis offsets (see SPAN
 * BASIS above).
 */
const STRANGLED_PREFIX = join(REFORGE_ROOT, "build", "strangled") + "/";

/** The far side of an imported capture: its declaration in the exporting chunk. */
export interface FootprintCaptureSource {
  chunk: string;
  exportedAs: string;
  declStart: number;
  declEnd: number;
  sha256: string;
}

/**
 * One node of an OWNED capture's transitive callee closure: the declaration a
 * helper the module reimplemented delegates to, or — when the emitter's walk had
 * to give up — a whole chunk. Mirrors strangle/footprint.ts's
 * `ClosureFootprint`.
 */
export interface FootprintClosure {
  name: string;
  /** the chunk the span is measured in — not necessarily the capture's own */
  chunk: string;
  depth: number;
  basis: string;
  declKind?: string;
  declStart: number;
  declEnd: number;
  sha256: string;
  note?: string;
}

/**
 * A closure identifier the spliced module receives from the graph (§2.4).
 * Mirrors strangle/footprint.ts's `CaptureFootprint`, rebased onto upstream
 * offsets (see SPAN BASIS above).
 */
export interface FootprintCapture {
  /** the upstream binding the capture is derived from */
  name: string;
  /** the owned module's parameter name for it */
  as?: string;
  kind?: string;
  /** what declares it: variable / function / class / parameter / import / catch */
  declKind?: string;
  /** span of the capture's declaration in the same chunk */
  declStart: number;
  declEnd: number;
  /** sha256 (hex) of the declaration's bytes */
  sha256: string;
  from?: FootprintCaptureSource;
  /** an owned capture's transitive callee closure; absent on a forwarded one */
  closure?: FootprintClosure[];
  /** why this record is narrower than it should be, when it is */
  note?: string;
}

/** The upstream span an owned module replaces. */
export interface FootprintTarget {
  /** offsets into the upstream bundle module (see SPAN BASIS above) */
  start: number;
  end: number;
  /** sha256 (hex) of the span's bytes */
  sha256: string;
}

export interface Footprint {
  /** the upstream chunk this row's implementation replaces, e.g. "chunk-fy12d89p.js" */
  chunk: string;
  target: FootprintTarget;
  /** the closure surface the splice consumes — required; see the footprint rules above */
  captures?: FootprintCapture[];
}

export interface LedgerRow {
  id: string;
  kind: string;
  title: string;
  wave: string;
  state: string;
  /** row ids this row depends on — §2.4's typed ports into unowned subsystems */
  edges: string[];
  /** null until the owning wave records it; see the footprint rules above */
  footprint: Footprint[] | null;
  /** evidence links: splice names, `scenario:<tag>`, `commit:<sha>` */
  evidence?: string[];
  note?: string;
}

export interface Ledger {
  engineVersion: string;
  rows: LedgerRow[];
}

export interface CheckOptions {
  /** extraction-bundle modules dir; `null` skips the upstream-bytes check outright */
  bundleModules?: string | null;
  /** strangler footprint emission to cross-check against; `null` skips it */
  footprintsPath?: string | null;
  /** subsystem row ids engine-ts registers a module for; defaults to the live registry */
  ownedSubsystems?: readonly string[];
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isOffset = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const HASH_RE = /^[0-9a-f]{64}$/;
/** An evidence link an owned state must carry at least one of — something a reader can resolve. */
const EVIDENCE_LINK_RE = /^(commit:[0-9a-f]{7,40}|scenario:[A-Za-z0-9._-]+)$/;
const OWNED_STATES = new Set(["standalone-complete", "assembled"]);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** One splice as the cross-check consumes it, normalized across the emitter's two shapes. */
interface SpliceRecord {
  name: string;
  chunk: string;
  sha256: string;
}

/**
 * Read strangle/build.ts's footprint emission. Returns `null` when there is
 * nothing to cross-check against (absent, unreadable, or built for another pin).
 */
function readSplices(path: string, warn: (m: string) => void): SpliceRecord[] | null {
  if (!existsSync(path)) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    warn(`build/footprints.json: unreadable (${(e as Error).message}) — cross-check skipped`);
    return null;
  }
  if (!isRecord(doc) || !Array.isArray(doc.splices)) {
    warn("build/footprints.json: no `splices` array — cross-check skipped");
    return null;
  }
  if (doc.engineVersion !== ENGINE_VERSION) {
    warn(`build/footprints.json: built for ${JSON.stringify(doc.engineVersion)}, pin is ${ENGINE_VERSION} — cross-check skipped (re-run strangle/build.ts)`);
    return null;
  }
  const out: SpliceRecord[] = [];
  let deprecated = 0;
  doc.splices.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.chunk !== "string") return;
    const name = typeof raw.name === "string" ? raw.name : `splices[${i}]`;
    if (isRecord(raw.target) && typeof raw.target.sha256 === "string") {
      out.push({ name, chunk: raw.chunk, sha256: raw.target.sha256 });
    } else if (typeof raw.sha256 === "string") {
      deprecated++;
      out.push({ name, chunk: raw.chunk, sha256: raw.sha256 });
    }
  });
  if (deprecated > 0) {
    warn(
      `build/footprints.json: ${deprecated} splice(s) still use the pre-X emitter shape (top-level span+sha256 instead of ` +
        `{chunk, target:{start,end,sha256}, captures}). Accepted during the C1 transition — re-run strangle/build.ts once ` +
        `it emits the agreed record, after which this becomes an error.`,
    );
  }
  return out;
}

/**
 * Materialized-basis offset → upstream-basis offset, for the same dual basis
 * rule 3 above accepts by hashing both ways.
 *
 * prepare.ts rewrites every `/$bunfs/root/` specifier to an absolute path under
 * build/strangled, so an offset into the materialized chunk sits `n × delta`
 * further along than its upstream twin, where `n` is the number of specifiers
 * that precede it. Rule 3 only has to *recognize* either basis; writing the
 * ledger needs the conversion itself (ledger/backfill-captures.ts), which is why
 * it lives beside the logic it mirrors rather than in a second copy.
 *
 * Returns null when the offset lands strictly inside a rewritten specifier —
 * there is no upstream offset that corresponds to it, and inventing one would be
 * a guess.
 */
export function toUpstreamOffset(upstream: string, offset: number): number | null {
  const delta = STRANGLED_PREFIX.length - BUNFS.length;
  let n = 0;
  for (let site = upstream.indexOf(BUNFS); site >= 0; site = upstream.indexOf(BUNFS, site + BUNFS.length)) {
    const materializedSite = site + n * delta;
    if (offset >= materializedSite + STRANGLED_PREFIX.length) {
      n++;
      continue;
    }
    if (offset > materializedSite) return null;
    break;
  }
  return offset - n * delta;
}

/** A chunk reference: a path relative to the bundle's modules dir, or null when it is not one. */
function chunkPath(v: unknown, report: (m: string) => void, where: string): string | null {
  if (typeof v !== "string" || v.length === 0) {
    report(`${where}: missing`);
    return null;
  }
  if (v.startsWith("/") || v.split("/").includes("..")) {
    report(`${where}: must be a path relative to the bundle's modules dir`);
    return null;
  }
  return v;
}

/** Cache of upstream chunk text and its materialized rendering, per chunk path. */
function chunkReader() {
  const cache = new Map<string, { upstream: string; materialized: string } | null>();
  return (path: string) => {
    if (!cache.has(path)) {
      if (!existsSync(path) || !statSync(path).isFile()) cache.set(path, null);
      else {
        const upstream = readFileSync(path, "utf8");
        cache.set(path, { upstream, materialized: upstream.replaceAll(BUNFS, STRANGLED_PREFIX) });
      }
    }
    return cache.get(path)!;
  };
}

/** Validate a parsed ledger document. Returns every problem found, not just the first. */
export function checkLedger(doc: unknown, opts: CheckOptions = {}): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  if (!isRecord(doc)) return { errors: ["ledger: not a JSON object"], warnings };

  if (doc.engineVersion !== ENGINE_VERSION) {
    errors.push(`engineVersion: ${JSON.stringify(doc.engineVersion)} != pinned ${ENGINE_VERSION} (a pin bump must run §5's semantic invalidation before this passes)`);
  }
  if (!Array.isArray(doc.rows)) return { errors: [...errors, "rows: missing or not an array"], warnings };
  const rows = doc.rows;
  if (rows.length === 0) return { errors: [...errors, "rows: empty — the ledger cannot pass vacuously"], warnings };

  const bundleModules = opts.bundleModules === undefined ? BUNDLE_MODULES : opts.bundleModules;
  const bundlePresent = bundleModules !== null && existsSync(bundleModules);
  if (bundleModules !== null && !bundlePresent) {
    warn(`extraction bundle absent at ${bundleModules} — footprint bytes were NOT verified (this machine cannot prove them)`);
  }
  const readChunk = chunkReader();

  const footprintsPath = opts.footprintsPath === undefined ? FOOTPRINTS_PATH : opts.footprintsPath;
  const splices = footprintsPath === null ? null : readSplices(footprintsPath, warn);
  const spliceKeys = new Set((splices ?? []).map((s) => `${s.chunk} ${s.sha256}`));
  const claimedSpliceKeys = new Set<string>();

  const owned = new Set(opts.ownedSubsystems ?? ownedSubsystems());
  const canonical = new Map(CANONICAL_ROWS.map((r) => [r.id, r]));
  const excluded = new Map(EXCLUDED_ROWS.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const raw of rows) if (isRecord(raw) && typeof raw.id === "string") ids.add(raw.id);

  rows.forEach((raw, i) => {
    const at = (msg: string) => errors.push(`rows[${i}]${isRecord(raw) && typeof raw.id === "string" ? ` (${raw.id})` : ""}: ${msg}`);
    if (!isRecord(raw)) return at("not an object");
    const id = raw.id;
    if (typeof id !== "string" || id.length === 0) return at("id: missing or not a string");
    if (seen.has(id)) at("duplicate row id");
    seen.add(id);

    if (excluded.has(id)) at(`row is on the §1.2 exclusion list (${excluded.get(id)!.reason}) and must not appear in the ledger`);
    const spec = canonical.get(id);
    if (!spec) {
      if (!excluded.has(id)) at("unknown row — not in ledger/rows.ts's canonical list");
    } else {
      if (raw.kind !== spec.kind) at(`kind: ${JSON.stringify(raw.kind)} != canonical ${spec.kind}`);
      if (raw.wave !== spec.wave) at(`wave: ${JSON.stringify(raw.wave)} != canonical ${spec.wave}`);
      if (raw.title !== spec.title) at("title: does not match ledger/rows.ts");
    }
    if (typeof raw.kind !== "string" || !(ROW_KINDS as readonly string[]).includes(raw.kind)) at(`kind: ${JSON.stringify(raw.kind)} is not one of ${ROW_KINDS.join(" | ")}`);
    if (typeof raw.wave !== "string" || !(WAVES as readonly string[]).includes(raw.wave)) at(`wave: ${JSON.stringify(raw.wave)} is not a campaign child id (C1..C17)`);

    const state = raw.state;
    if (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state)) {
      at(`state: ${JSON.stringify(state)} is not one of ${LEDGER_STATES.join(" | ")}`);
    }

    if (!isStringArray(raw.edges)) {
      at("edges: missing or not an array of row ids");
    } else {
      const local = new Set<string>();
      for (const e of raw.edges) {
        if (e === id) at(`edges: self-reference ${e}`);
        else if (!ids.has(e)) at(`edges: dangling reference ${JSON.stringify(e)} — no such row`);
        if (local.has(e)) at(`edges: duplicate ${JSON.stringify(e)}`);
        local.add(e);
      }
    }

    const fp = raw.footprint;
    if (fp === undefined) at("footprint: missing (use null until the owning wave records it)");
    else if (fp !== null) {
      if (!Array.isArray(fp) || fp.length === 0) at("footprint: must be null or a non-empty array of {chunk, target}");
      else fp.forEach((f, j) => checkFootprint(f, j));
    } else if (typeof state === "string" && OWNED_STATES.has(state)) {
      at(`footprint: state '${state}' requires a recorded upstream footprint (§5 staling is blind without it)`);
    }

    function checkFootprint(f: unknown, j: number): void {
      const fail = (msg: string): void => {
        at(`footprint[${j}]${msg}`);
      };
      /** Rule 3, for any recorded span: the bytes it names must hash to what it recorded. */
      const verifyBytes = (where: string, chunkName: string, start: number, end: number, digest: string): void => {
        if (!bundlePresent) return;
        const src = readChunk(join(bundleModules!, chunkName));
        if (src === null) return fail(`${where}: '${chunkName}' does not exist under ${bundleModules}`);
        if (end > src.upstream.length && end > src.materialized.length) {
          return fail(`${where}: span [${start}, ${end}] runs past the end of ${chunkName} (${src.upstream.length} chars)`);
        }
        if (sha256(src.upstream.slice(start, end)) === digest) return;
        // ONE BASIS, AND IT IS THE COMMITTED ONE. A span that resolves only
        // against the materialized rendering is a record copied straight out of
        // build/footprints.json without the conversion — which points at
        // different bytes upstream, so §5 can no longer stale the row when the
        // declaration moves. Named as its own failure rather than folded into
        // the generic mismatch, because the fix is a tool rather than an
        // investigation.
        if (sha256(src.materialized.slice(start, end).replaceAll(STRANGLED_PREFIX, BUNFS)) === digest) {
          return fail(
            `${where}: bytes at [${start}, ${end}] of ${chunkName} hash to ${digest.slice(0, 12)}… only in the MATERIALIZED basis — ` +
              `this record was copied from build/footprints.json without conversion, and upstream those offsets are a different declaration. ` +
              `Rebase it: npx tsx ledger/backfill-captures.ts`,
          );
        }
        fail(`${where}: bytes at [${start}, ${end}] of ${chunkName} do not hash to ${digest.slice(0, 12)}… — the footprint points at something the pinned bundle does not contain`);
      };
      if (!isRecord(f)) return fail(": not an object");
      const chunk = chunkPath(f.chunk, fail, ".chunk");
      if ((f as { hash?: unknown }).hash !== undefined || (f as { span?: unknown }).span !== undefined) {
        fail(": uses the retired {chunk, hash, span} shape — record {chunk, target:{start,end,sha256}, captures}");
      }

      const t = f.target;
      if (!isRecord(t)) return fail(".target: missing — record {start, end, sha256}");
      if (!isOffset(t.start) || !isOffset(t.end)) return fail(".target: start/end must be non-negative integer offsets");
      if (t.start >= t.end) return fail(`.target: span [${t.start}, ${t.end}] is empty or reversed`);
      if (typeof t.sha256 !== "string" || !HASH_RE.test(t.sha256)) fail(".target.sha256: not a sha256 hex digest");

      if (f.captures === undefined) {
        fail(
          ".captures: missing — a footprint covers the target span AND its closure surface (§2.4), and a row whose captures " +
            "are unrecorded cannot be staled when a captured declaration moves. Backfill it: npx tsx ledger/backfill-captures.ts",
        );
      } else if (!Array.isArray(f.captures)) {
        fail(".captures: must be an array of {name, declStart, declEnd, sha256}");
      } else {
        f.captures.forEach((c, k) => {
          const cf = (msg: string): void => {
            fail(`.captures[${k}]${msg}`);
          };
          if (!isRecord(c)) return cf(": not an object");
          if (typeof c.name !== "string" || c.name.length === 0) cf(".name: missing");
          if (!isOffset(c.declStart) || !isOffset(c.declEnd)) return cf(": declStart/declEnd must be non-negative integer offsets");
          if (c.declStart >= c.declEnd) return cf(`: declaration span [${c.declStart}, ${c.declEnd}] is empty or reversed`);
          if (typeof c.sha256 !== "string" || !HASH_RE.test(c.sha256)) return cf(".sha256: not a sha256 hex digest");
          // Rule 3 is not a target-only rule: a capture span nobody resolves is
          // the same decoration, one level in.
          if (chunk !== null) verifyBytes(`.captures[${k}]`, chunk, c.declStart, c.declEnd, c.sha256);

          // An owned capture's transitive callees: the same argument one level
          // out. The module reimplemented the helper, so upstream is free to
          // rewrite what the helper CALLS with the helper itself byte-identical
          // (campaign spec W1 fix).
          if (c.closure !== undefined) {
            if (!Array.isArray(c.closure)) cf(".closure: must be an array of {name, chunk, depth, basis, declStart, declEnd, sha256}");
            else {
              c.closure.forEach((cl, m) => {
                const zf = (msg: string): void => {
                  cf(`.closure[${m}]${msg}`);
                };
                if (!isRecord(cl)) return zf(": not an object");
                if (typeof cl.name !== "string" || cl.name.length === 0) zf(".name: missing");
                if (cl.basis !== "declaration" && cl.basis !== "whole-chunk") zf(".basis: must be 'declaration' or 'whole-chunk'");
                if (!isOffset(cl.depth)) zf(".depth: must be a non-negative integer");
                if (cl.basis === "whole-chunk" && typeof cl.note !== "string") {
                  zf(".note: a whole-chunk record must say why the closure could not be enumerated");
                }
                const clChunk = chunkPath(cl.chunk, zf, ".chunk");
                if (!isOffset(cl.declStart) || !isOffset(cl.declEnd)) return zf(": declStart/declEnd must be non-negative integer offsets");
                if (cl.declStart >= cl.declEnd) return zf(`: declaration span [${cl.declStart}, ${cl.declEnd}] is empty or reversed`);
                if (typeof cl.sha256 !== "string" || !HASH_RE.test(cl.sha256)) return zf(".sha256: not a sha256 hex digest");
                if (clChunk !== null) verifyBytes(`.captures[${k}].closure[${m}]`, clChunk, cl.declStart, cl.declEnd, cl.sha256);
              });
            }
          }

          // The far side of an imported capture lives in another chunk — where
          // the behaviour actually is, and where upstream is free to move it
          // with the import site byte-identical.
          if (c.from === undefined) return;
          const from = c.from;
          if (!isRecord(from)) return cf(".from: must be {chunk, exportedAs, declStart, declEnd, sha256}");
          if (typeof from.exportedAs !== "string" || from.exportedAs.length === 0) cf(".from.exportedAs: missing");
          const farChunk = chunkPath(from.chunk, cf, ".from.chunk");
          if (!isOffset(from.declStart) || !isOffset(from.declEnd)) return cf(".from: declStart/declEnd must be non-negative integer offsets");
          if (from.declStart >= from.declEnd) return cf(`.from: declaration span [${from.declStart}, ${from.declEnd}] is empty or reversed`);
          if (typeof from.sha256 !== "string" || !HASH_RE.test(from.sha256)) return cf(".from.sha256: not a sha256 hex digest");
          if (farChunk !== null) verifyBytes(`.captures[${k}].from`, farChunk, from.declStart, from.declEnd, from.sha256);
        });
      }

      if (chunk === null || typeof t.sha256 !== "string" || !HASH_RE.test(t.sha256)) return;

      // --- the span must name real upstream bytes ---
      verifyBytes(".target", chunk, t.start, t.end, t.sha256);

      // --- cross-check against C1's emission ---
      const key = `${chunk} ${t.sha256}`;
      claimedSpliceKeys.add(key);
      if (splices !== null && state === "spliced" && !spliceKeys.has(key)) {
        fail(`: no splice in build/footprints.json replaces ${chunk}@${t.sha256.slice(0, 12)}… — the ledger claims a splice the strangler build did not emit`);
      }
    }

    if (typeof state === "string" && OWNED_STATES.has(state)) {
      const evidence = isStringArray(raw.evidence) ? raw.evidence : [];
      if (!evidence.some((e) => EVIDENCE_LINK_RE.test(e))) {
        at(`evidence: state '${state}' requires at least one resolvable link — 'commit:<sha>' or 'scenario:<tag>' (a claim of ownership with no evidence is a claim)`);
      }
      if (state === "standalone-complete" && raw.kind === "subsystem" && !owned.has(id)) {
        at(`state 'standalone-complete' but engine-ts registers no module for this subsystem — dual-wiring (§2.4/X7) needs both halves; register it in engine-ts/modules/index.ts`);
      }
    }

    if (state === "stale" && (typeof raw.note !== "string" || raw.note.trim().length === 0)) {
      at("note: a 'stale' row requires an adjudication note (§5)");
    }
    if (raw.evidence !== undefined && !isStringArray(raw.evidence)) at("evidence: must be an array of strings if present");
    if (raw.note !== undefined && typeof raw.note !== "string") at("note: must be a string if present");
  });

  for (const r of CANONICAL_ROWS) if (!seen.has(r.id)) errors.push(`missing row: ${r.id} (${r.kind}, ${r.wave})`);

  // Drift the other way: a splice that landed without a ledger row recording it.
  for (const s of splices ?? []) {
    if (!claimedSpliceKeys.has(`${s.chunk} ${s.sha256}`)) {
      warn(`build/footprints.json splice '${s.name}' (${s.chunk}) has no footprint in the ledger — a splice landed without its row moving`);
    }
  }
  return { errors, warnings };
}

export function summarize(doc: Ledger): string[] {
  const byKind = new Map<string, number>();
  const byState = new Map<string, number>();
  for (const r of doc.rows) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  }
  return [
    `rows: ${doc.rows.length} (${[...byKind].map(([k, n]) => `${k}=${n}`).join(", ")})`,
    `states: ${[...byState].map(([s, n]) => `${s}=${n}`).join(", ")}`,
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ? resolve(process.argv[2]) : LEDGER_PATH;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`ledger: cannot read ${path} — ${(e as Error).message}`);
    process.exit(2);
  }
  const { errors, warnings } = checkLedger(doc);
  console.log(`=== closure ledger: ${path} ===`);
  if (errors.length === 0) for (const line of summarize(doc as Ledger)) console.log(`  ${line}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log(errors.length === 0 ? "\nPASS — ledger matches the canonical row list" : `\nFAIL — ${errors.length} problem(s)`);
  process.exit(errors.length === 0 ? 0 : 1);
}
