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
// Hash basis matches the target's: spans are offsets into the MATERIALIZED chunk
// (prepare.ts rewrites `/$bunfs/root/` specifiers, which shifts offsets), while
// every hash is taken over the UPSTREAM bytes, so a footprint moves when
// upstream moves and not when this machine's paths do.
import { createHash } from "node:crypto";
import ts from "typescript";
import type { Excision, TargetSignature } from "./ast.js";
import type { CaptureClass, DerivedCapture } from "./manifest.js";
import { captureRoot, resolveDeclaration, resolveExport, type Declaration } from "./scope.js";

export interface DeclarationFootprint {
  declStart: number;
  declEnd: number;
  sha256: string;
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

export function spliceFootprint(input: FootprintInput): SpliceFootprint {
  const { name, chunk, sf, cut, captures, resolveModule, upstream } = input;
  const hash = (text: string) => createHash("sha256").update(upstream(text)).digest("hex");
  const cover = (source: ts.SourceFile, d: Declaration): DeclarationFootprint => ({
    declStart: d.start,
    declEnd: d.end,
    sha256: hash(source.text.slice(d.start, d.end)),
  });

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
      if (root !== c.identifier) {
        record.note = `derived identifier is '${c.identifier}'; the footprint covers its root binding '${root}' (a member read has no declaration of its own)`;
      }
      if (decl.kind !== "import") return record;

      const specifier = decl.moduleSpecifier;
      const exported = decl.importedName;
      if (!specifier || !exported) {
        record.note = "imported capture with no resolvable specifier — only the import site is covered";
        return record;
      }
      const mod = resolveModule(specifier);
      if (!mod) {
        record.note = `exporting module '${specifier}' is not part of the graph — only the import site is covered`;
        return record;
      }
      const far = resolveExport(mod.sf, exported);
      if (!far) {
        record.note = `'${exported}' is not a top-level declaration of ${mod.name} (re-export chain?) — only the import site is covered`;
        return record;
      }
      record.from = { chunk: mod.name, exportedAs: exported, ...cover(mod.sf, far) };
      return record;
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
