// The BRANCH INVENTORY — §3.1's non-vacuity minimum for coverage attestation:
// "a *complete* branch inventory of the owned code (generated from its AST, not
// hand-picked), with exclusions listed and reviewed — 'major branches' is not a
// category".
//
// Complete means two things here, and the second is the one that is easy to skip:
//
//  1. every branch site is found by walking the AST, never by listing them;
//  2. any branch-forming construct the instrumenter does not know how to record
//     makes the run FAIL. A tool that quietly skips the constructs it cannot
//     handle reports a complete inventory of the subset it understood, which is
//     precisely the vacuous pass §3.1 exists to forbid.
//
// ## What a branch is, and how each one is recorded
//
// Every construct below decides control flow on the truthiness (or nullishness)
// of ONE expression, so the whole inventory reduces to "which conditions were
// evaluated, and to what". Each site is wrapped as `__cov("<id>", <expr>)`, which
// records the outcome and returns the value unchanged — so short-circuiting,
// value-carrying `||`, and the value of a conditional are all preserved. Two
// inventory entries per site: the `true` outcome and the `false` one.
//
//   IfStatement            its condition (an absent `else` is still a false arm)
//   ConditionalExpression  its condition
//   &&  ||  ??             the LEFT operand: true means the right side ran
//
// ## Branch ids are structural, not positional
//
// `<module>#<enclosing function>@<n>` — the n-th branch site of that function in
// source order. A line/column id would re-number every branch when a comment is
// added above it, which would silently invalidate every recorded exclusion. This
// id moves only when the code's branch structure moves, which is exactly when an
// exclusion SHOULD be re-adjudicated.
import { readFileSync } from "node:fs";
import ts from "typescript";

export type BranchKind = "if" | "conditional" | "and" | "or" | "nullish";

export interface BranchSite {
  /** `<module>#<function>@<n>` */
  id: string;
  kind: BranchKind;
  /** the enclosing function's name, or "<module>" for a top-level branch */
  fn: string;
  /** span of the condition expression, for the instrumenting rewrite */
  start: number;
  end: number;
  /** the condition's source text, trimmed, for the report */
  text: string;
  /** `??` records nullishness rather than truthiness */
  nullish: boolean;
  line: number;
}

/**
 * Constructs that branch but that this instrumenter does not record. Listed
 * explicitly so the refusal names what it saw rather than failing vaguely, and so
 * adding support for one is a deliberate edit here.
 */
const UNSUPPORTED: [ts.SyntaxKind, string][] = [
  [ts.SyntaxKind.SwitchStatement, "switch — each clause is a branch with no condition to wrap"],
  [ts.SyntaxKind.WhileStatement, "while — the loop condition branches per iteration"],
  [ts.SyntaxKind.DoStatement, "do/while — same"],
  [ts.SyntaxKind.ForStatement, "for — the loop condition branches per iteration"],
  [ts.SyntaxKind.ForOfStatement, "for..of — zero-iteration is an unrecorded arm"],
  [ts.SyntaxKind.ForInStatement, "for..in — same"],
  [ts.SyntaxKind.TryStatement, "try/catch — the throwing path is an unrecorded arm"],
  [ts.SyntaxKind.QuestionDotToken, "optional chaining — the short-circuit is an unrecorded arm"],
];

function enclosingName(node: ts.Node, moduleName: string): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if ((ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
      return n.parent.name.text;
    }
  }
  return moduleName;
}

/** Every branch site of one module, in source order. Throws on an unrecordable construct. */
export function branchSites(moduleName: string, path: string, source?: string): BranchSite[] {
  const text = source ?? readFileSync(path, "utf8");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new Error(`${path}: ${diagnostics.length} parse diagnostic(s)`);

  const raw: Omit<BranchSite, "id">[] = [];
  const visit = (n: ts.Node): void => {
    for (const [kind, why] of UNSUPPORTED) {
      if (n.kind === kind) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        throw new Error(
          `${moduleName}: ${path}:${line + 1} contains ${ts.SyntaxKind[kind]} (${why}).\n` +
            `  The branch inventory must be COMPLETE (§3.1), so an unrecordable construct fails rather than being skipped.\n` +
            `  Either rewrite the owned module without it, or teach strangle/branches.ts to record it.`,
        );
      }
    }
    const add = (expr: ts.Expression, kind: BranchKind, nullish = false) => {
      raw.push({
        kind,
        nullish,
        fn: enclosingName(expr, moduleName),
        start: expr.getStart(sf),
        end: expr.getEnd(),
        text: expr.getText(sf).replace(/\s+/g, " ").slice(0, 90),
        line: sf.getLineAndCharacterOfPosition(expr.getStart(sf)).line + 1,
      });
    };
    if (ts.isIfStatement(n)) add(n.expression, "if");
    else if (ts.isConditionalExpression(n)) add(n.condition, "conditional");
    else if (ts.isBinaryExpression(n)) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) add(n.left, "and");
      else if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) add(n.left, "or");
      else if (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) add(n.left, "nullish", true);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);

  raw.sort((a, b) => a.start - b.start);
  const seen = new Map<string, number>();
  return raw.map((r) => {
    const n = seen.get(r.fn) ?? 0;
    seen.set(r.fn, n + 1);
    return { ...r, id: `${moduleName}#${r.fn}@${n}` };
  });
}

/** The two outcomes every site contributes to the inventory. */
export const outcomesOf = (site: BranchSite): string[] => [`${site.id}:T`, `${site.id}:F`];

/**
 * Rewrite a module so every branch site records its outcome. Insertions only,
 * applied back to front, so nested sites keep the offsets the AST reported.
 */
export function instrumentSource(source: string, sites: readonly BranchSite[], recorderSpecifier: string): string {
  const edits: { pos: number; text: string; depth: number; open: boolean }[] = [];
  for (const s of sites) {
    const fn = s.nullish ? "__covN" : "__cov";
    // depth = how many sites contain this one; used only to break position ties
    const depth = sites.filter((o) => o.start <= s.start && s.end <= o.end).length;
    edits.push({ pos: s.start, text: `${fn}(${JSON.stringify(s.id)},(`, depth, open: true });
    edits.push({ pos: s.end, text: `))`, depth, open: false });
  }
  // Applying right-to-left, an insertion at the same position as a previous one
  // ends up BEFORE it. So at a tie: apply the INNER open last (it must sit after
  // the outer open) and the INNER close first (it must sit before the outer one).
  edits.sort((a, b) => b.pos - a.pos || (a.open ? b.depth - a.depth : a.depth - b.depth));
  let out = source;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return `import { __cov, __covN } from ${JSON.stringify(recorderSpecifier)};\n${out}`;
}
