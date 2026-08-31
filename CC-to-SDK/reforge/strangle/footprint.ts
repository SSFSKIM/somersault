// The upstream-footprint record — §5's staleness contract, made complete.
//
// §5 requires each owned row to record "the chunk(s) and AST-node spans it
// replaces, content-hashed at splice time", so that a pin bump can stale
// exactly the rows whose upstream actually moved. The first implementation
// hashed only the excised TARGET span, which quietly under-covers what an owned
// module actually depends on (campaign spec W0 fix, lens 1): a splice also
// consumes captured declarations that live OUTSIDE its span — a constant's
// value, a helper function's body, often in another chunk entirely. Upstream can
// change `q6t`'s string or `APn`'s formatting with the target span byte-identical,
// and the old footprint would have declared the row fresh while the behaviour it
// grades had changed.
//
// So the footprint covers the target PLUS its closure surface: for every derived
// capture, the span of the declaration the identifier resolves to, hashed the
// same way. An IMPORTED capture is covered on both sides — the import site in
// the owning chunk (which is what breaks if the export is renamed or dropped)
// and the declaration in the exporting chunk (which is where the behaviour
// lives, and which carries the real content signal). When the exporting chunk is
// out of reach the import site still records, carrying a `note` that says what
// is missing rather than silently narrowing the contract.
//
// That closed the FIRST hole. The second (campaign spec W1 fix) is one level
// further out: an OWNED capture is one the reforge module REIMPLEMENTS, and a
// reimplementation replaces not just the helper but everything the helper
// delegates to. Read's owned notebook formatter is upstream's `hyt`, whose whole
// body is `e.flatMap(UDn)` — and `UDn` calls `NDn` and `$Dn`, which are where
// notebook cell and output formatting actually live. Bash's owned image block is
// `y1t`, which delegates to `iyt` (data-URI parsing) and `$v` (magic-byte image
// sniffing, in another chunk entirely). Hashing only `hyt` and `y1t` means
// upstream can rewrite image sniffing or notebook output formatting with every
// recorded span byte-identical: the ledger stays green while the owned module
// has gone stale on a branch no scenario renders.
//
// So an owned capture's footprint also covers the TRANSITIVE CLOSURE of what its
// declaration references — each callee resolved to its own declaration (same
// chunk, or across an import with the resolution the closure surface already
// uses) and hashed, recursively, breadth-first, with the depth recorded. The
// walk is BOUNDED, and when the bound is hit — or a callee resolves somewhere
// the graph cannot follow — the enumeration is abandoned for the conservative
// alternative: hash every chunk the walk reached WHOLE, carrying a note that
// says so. That stales the row on edits it does not depend on, which is the
// right way to be wrong here; a closure recorded as complete when it is not is a
// false green, and a false green is the failure this record exists to prevent.
//
// Hash basis matches the target's: spans are offsets into the MATERIALIZED chunk
// (prepare.ts rewrites `/$bunfs/root/` specifiers, which shifts offsets), while
// every hash is taken over the UPSTREAM bytes, so a footprint moves when
// upstream moves and not when this machine's paths do.
import { createHash } from "node:crypto";
import ts from "typescript";
import type { Excision, TargetSignature } from "./ast.js";
import type { CaptureClass, DerivedCapture } from "./manifest.js";
import { captureRoot, freeIdentifiers, resolveDeclaration, resolveExport, type Declaration } from "./scope.js";

/**
 * How far the transitive walk goes before it gives up and hashes whole chunks.
 *
 * Both bounds are about the SHAPE of what was reached, not about cost: a helper
 * whose callees fan out into dozens of declarations has stopped being a helper
 * and is reaching into a subsystem (or a vendored library), and enumerating that
 * would record a closure so wide it is indistinguishable from the chunk itself.
 * The measured closures on the pinned graph are 0–4 declarations at depth ≤ 2,
 * so these are room, not a ceiling anything is pressed against.
 */
export const CLOSURE_MAX_DEPTH = 6;
export const CLOSURE_MAX_DECLARATIONS = 20;

export interface DeclarationFootprint {
  declStart: number;
  declEnd: number;
  sha256: string;
}

/**
 * One node of an owned capture's transitive callee closure — either a resolved
 * declaration, or (when the walk had to give up) a whole chunk.
 */
export interface ClosureFootprint extends DeclarationFootprint {
  /** the identifier that reached it; the chunk's own name for a whole-chunk record */
  name: string;
  /** the chunk the span is measured in — not necessarily the capture's own */
  chunk: string;
  /** 1 = a direct callee of the capture's declaration; 0 = a whole-chunk record */
  depth: number;
  basis: "declaration" | "whole-chunk";
  declKind?: Declaration["kind"];
  /** why this record is a whole chunk rather than a declaration, when it is */
  note?: string;
}

export interface CaptureFootprint extends DeclarationFootprint {
  /** the binding whose declaration this covers — the root of the derived identifier */
  name: string;
  /** the owned module's parameter name for it */
  as: string;
  kind: CaptureClass;
  /** what declares it: variable / function / class / parameter / import / catch */
  declKind: Declaration["kind"];
  /** the far side of an imported capture: the declaration in the exporting chunk */
  from?: DeclarationFootprint & { chunk: string; exportedAs: string };
  /**
   * For an OWNED capture only: everything its declaration transitively
   * references. Absent on a forwarded capture — the graph's own function is what
   * runs there, so upstream's callees cannot go stale behind an owned copy.
   */
  closure?: ClosureFootprint[];
  /** why this record is narrower than it should be, when it is */
  note?: string;
}

export interface SpliceFootprint {
  chunk: string;
  target: { start: number; end: number; sha256: string };
  captures: CaptureFootprint[];
}

/** A parsed chunk plus the name the footprint should record it under. */
export interface ResolvedModule {
  name: string;
  sf: ts.SourceFile;
}

export interface FootprintInput {
  name: string;
  /** the owning chunk's name, relative to the graph root */
  chunk: string;
  sf: ts.SourceFile;
  cut: Excision;
  captures: DerivedCapture[];
  /** resolve an import specifier to its parsed chunk; null when it is out of reach */
  resolveModule: (specifier: string) => ResolvedModule | null;
  /** undo prepare.ts's specifier rewrite so hashes are taken over upstream bytes */
  upstream: (text: string) => string;
}

/** Where the closure walk currently stands: a declaration node and the chunk it lives in. */
interface Site {
  sf: ts.SourceFile;
  chunk: string;
  node: ts.Node;
}

export function spliceFootprint(input: FootprintInput): SpliceFootprint {
  const { name, chunk, sf, cut, captures, resolveModule, upstream } = input;
  const hash = (text: string) => createHash("sha256").update(upstream(text)).digest("hex");
  const cover = (source: ts.SourceFile, d: Declaration): DeclarationFootprint => ({
    declStart: d.start,
    declEnd: d.end,
    sha256: hash(source.text.slice(d.start, d.end)),
  });

  /**
   * Breadth-first over what `origin` references, following each free identifier
   * to the declaration whose bytes carry its behaviour. Returns the enumerated
   * closure, or — when the walk cannot be completed — a whole-chunk record for
   * every chunk it reached, plus the note that says why.
   */
  function walkClosure(origin: Site): { closure: ClosureFootprint[]; note?: string } {
    const records: ClosureFootprint[] = [];
    const reached = new Map<string, ts.SourceFile>([[origin.chunk, origin.sf]]);
    const seen = new Set<string>([`${origin.chunk}:${origin.node.getStart(origin.sf)}-${origin.node.getEnd()}`]);
    let frontier: Site[] = [origin];
    let abandoned: string | null = null;

    for (let depth = 1; depth <= CLOSURE_MAX_DEPTH && frontier.length > 0 && abandoned === null; depth++) {
      const next: Site[] = [];
      for (const site of frontier) {
        for (const identifier of freeIdentifiers(site.node)) {
          let decl = resolveDeclaration(site.sf, site.node, identifier);
          let source = site.sf;
          let where = site.chunk;
          if (!decl) {
            abandoned = `'${identifier}' (referenced from ${site.chunk}) resolves to no declaration in the graph`;
            break;
          }
          if (decl.kind === "import") {
            const mod = decl.moduleSpecifier ? resolveModule(decl.moduleSpecifier) : null;
            const far = mod && decl.importedName ? resolveExport(mod.sf, decl.importedName) : null;
            if (!mod || !far) {
              abandoned = `'${identifier}' is imported from ${decl.moduleSpecifier ?? "an unresolvable specifier"}, whose declaration the graph cannot reach`;
              break;
            }
            decl = far;
            source = mod.sf;
            where = mod.name;
          }
          const key = `${where}:${decl.start}-${decl.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          reached.set(where, source);
          records.push({ name: identifier, chunk: where, depth, basis: "declaration", declKind: decl.kind, ...cover(source, decl) });
          if (records.length > CLOSURE_MAX_DECLARATIONS) {
            abandoned = `the closure exceeds ${CLOSURE_MAX_DECLARATIONS} declarations, which is a subsystem rather than a helper`;
            break;
          }
          // A parameter or a catch binding has no callees of its own, and a
          // parameter's node reads its own name as a free variable.
          if (decl.kind !== "parameter" && decl.kind !== "catch") next.push({ sf: source, chunk: where, node: decl.node });
        }
        if (abandoned !== null) break;
      }
      frontier = next;
      if (abandoned === null && depth === CLOSURE_MAX_DEPTH && frontier.length > 0) {
        abandoned = `the closure is deeper than ${CLOSURE_MAX_DEPTH} levels`;
      }
    }
    if (abandoned === null) return { closure: records };

    const whole = [...reached].map(([where, source]): ClosureFootprint => ({
      name: where,
      chunk: where,
      depth: 0,
      basis: "whole-chunk",
      declStart: 0,
      declEnd: source.text.length,
      sha256: hash(source.text),
      note: `whole-chunk hash — ${abandoned}`,
    }));
    return {
      closure: whole,
      note:
        `the transitive closure could not be enumerated (${abandoned}); every chunk the walk reached is hashed WHOLE instead, ` +
        `so an unrelated upstream edit in one of them stales this row — conservative staling, not a narrowed contract`,
    };
  }

  return {
    chunk,
    target: { start: cut.start, end: cut.end, sha256: hash(cut.original) },
    captures: captures.map((c) => {
      const root = captureRoot(c.identifier);
      const decl = resolveDeclaration(sf, cut.node, root);
      if (!decl) {
        // Unreachable once the inventory contract holds — every free variable is
        // declared somewhere up the chunk's scope chain. Loud rather than
        // note-and-continue: a capture we cannot locate is a capture we cannot
        // stale, which is the exact hole this record exists to close.
        throw new Error(`${name}: capture '${c.as}' (${c.identifier}) has no resolvable declaration in ${chunk}`);
      }
      const record: CaptureFootprint = {
        name: root,
        as: c.as,
        kind: c.kind,
        declKind: decl.kind,
        ...cover(sf, decl),
      };
      // Notes ACCUMULATE: a derived member read on an imported binding has two
      // things to say, and the second silently replacing the first is how a
      // record ends up claiming more coverage than it has.
      const say = (line: string) => {
        record.note = record.note ? `${record.note}; ${line}` : line;
      };
      if (root !== c.identifier) {
        say(`derived identifier is '${c.identifier}'; the footprint covers its root binding '${root}' (a member read has no declaration of its own)`);
      }
      /**
       * An OWNED capture is reimplemented by the reforge module, so upstream's
       * callees are part of what went stale-able; a forwarded one still runs
       * upstream's own function and needs no closure.
       */
      const withClosure = (origin: Site): CaptureFootprint => {
        if (!c.owned) return record;
        const { closure, note } = walkClosure(origin);
        if (closure.length > 0) record.closure = closure;
        if (note) say(note);
        return record;
      };

      if (decl.kind !== "import") return withClosure({ sf, chunk, node: decl.node });

      const specifier = decl.moduleSpecifier;
      const exported = decl.importedName;
      // An import site whose far side is out of reach cannot be walked either:
      // the behaviour the owned module replaced is in a chunk this graph does
      // not contain, so there is nothing to hash and the note has to say it.
      const unreachable = (why: string): CaptureFootprint => {
        say(why);
        if (c.owned) say("its transitive closure is therefore unrecorded — this row cannot be staled by a change to what the helper calls");
        return record;
      };
      if (!specifier || !exported) return unreachable("imported capture with no resolvable specifier — only the import site is covered");
      const mod = resolveModule(specifier);
      if (!mod) return unreachable(`exporting module '${specifier}' is not part of the graph — only the import site is covered`);
      const far = resolveExport(mod.sf, exported);
      if (!far) return unreachable(`'${exported}' is not a top-level declaration of ${mod.name} (re-export chain?) — only the import site is covered`);
      record.from = { chunk: mod.name, exportedAs: exported, ...cover(mod.sf, far) };
      return withClosure({ sf: mod.sf, chunk: mod.name, node: far.node });
    }),
  };
}

/** The whole ledger file the build writes. */
export interface FootprintFile {
  engineVersion: string;
  variant: string;
  spanBasis: "materialized-chunk";
  hashBasis: "upstream-bytes";
  splices: (SpliceFootprint & {
    name: string;
    shape: string;
    fn: string;
    node: string;
    anchor: string;
    signature: TargetSignature;
    coverage: string[];
  })[];
}
