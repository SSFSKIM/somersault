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
// There are two ways to record one, and which applies is a property of the
// construct rather than a choice:
//
// WRAPPED CONDITIONS. A construct that decides on the truthiness (or
// nullishness) of ONE expression is instrumented by wrapping that expression as
// `__cov("<id>", <expr>)`, which records the outcome and returns the value
// unchanged — so short-circuiting, value-carrying `||`, and the value of a
// conditional are all preserved. Two outcomes: `T` and `F`.
//
//   IfStatement            its condition (an absent `else` is still a false arm)
//   ConditionalExpression  its condition
//   &&  ||  ??             the LEFT operand: true means the right side ran
//   while / do-while / for its condition. This is EXACT rather than approximate:
//                          the condition is evaluated once per iteration plus
//                          once to exit, so `F` is the zero-iteration arm and `T`
//                          is "the body ran at least once". Iteration COUNT is
//                          not recorded, and deliberately: a loop that ran seven
//                          times instead of six is not a branch, and attesting it
//                          would be noise in a report whose whole value is that
//                          every line of it is actionable.
//   ?.                     the expression LEFT of the `?.`, recorded for
//                          nullishness. See the refusals below for the two forms
//                          that are not instrumentable this way.
//
// MARKED ARMS. A construct whose arms have no condition to wrap is instrumented
// by INSERTING a recorder statement into each arm — `__covS("<id>:<outcome>")`,
// which records and returns nothing.
//
//   case / default         one outcome, `taken`. The no-match path of a switch is
//                          not an arm of any clause, which is why a switch with
//                          no `default` is refused rather than under-reported.
//   for..of / for..in      one outcome, `iterated`, marked at the top of the
//                          body. There is no condition to wrap and no way to
//                          mark "the iterable was empty" by insertion, so an
//                          unexecuted `iterated` means "never reached OR reached
//                          and empty" — recorded here so a reader of the report
//                          knows which question it answers.
//   try / catch            two outcomes on one site: `T` is "the guarded body
//                          threw", marked at the top of the catch block, and `F`
//                          is "it completed", marked at the end of the try block.
//   try / finally          the SAME two outcomes, but there is no catch block to
//                          mark the throwing arm in — so one is INSERTED: a
//                          `catch` that records and immediately rethrows, spliced
//                          between the try block and the `finally` keyword. The
//                          exception is rethrown unchanged, so it still reaches
//                          the finally and still propagates; only the recorder is
//                          added. Needed because a `finally` is BEHAVIOUR in the
//                          code being measured — upstream's SessionStart
//                          dispatcher brackets its dispatch in one so an executor
//                          that throws still releases the activity hold — and
//                          rewriting the owned module to avoid it would be
//                          changing the code to suit the instrument.
//
//   A guarded body that RETURNS skips the end-of-block marker, so each escaping
//   `return` carries its own recorder for the SAME completed arm — written as an
//   expression (`return (__covS(id:F), EXPR)`, or `return __covS(id:F)` when
//   there is nothing to return), because a statement insertion would change
//   which statement a braceless `if` owns. Not a new outcome: "the body did not
//   throw" is one arm however control left it. Added by W6, whose permission
//   pre-check, rule checker and allow-rule decision all guard a body that
//   returns from inside it — rewriting those to hoist a result into a variable
//   would have been measuring something other than what upstream wrote.
//
//   A guarded body that neither completes nor throws — a generator whose
//   CONSUMER calls `.return()` runs the finally without either — records neither
//   outcome. That is what try/catch already does, and the escaping-jump refusal
//   below is what keeps it from happening any other way.
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

export type BranchKind = "if" | "conditional" | "and" | "or" | "nullish" | "optional" | "loop" | "clause" | "try";

/** How one site is recorded: by wrapping an expression, or by marking an arm. */
export type BranchEdit =
  | { kind: "wrap"; start: number; end: number; recorder: "__cov" | "__covN" }
  | { kind: "mark"; pos: number; outcome: string }
  /** a rethrowing `catch` spliced into a try/finally, so its throwing arm has somewhere to be marked */
  | { kind: "insertCatch"; pos: number; outcome: string }
  /**
   * A `return` that ESCAPES a guarded body: the completed arm is recorded on
   * that exit as well as at the end of the block, because the end-of-block
   * marker is exactly what a `return` skips. Written as an expression
   * (`return (__covS(id), EXPR)`) rather than a statement, so it is safe in a
   * braceless arm (`if (x) return y`) where inserting a statement would change
   * which statement the `if` owns.
   */
  | { kind: "wrapReturn"; start: number; end: number; outcome: string }
  /** the same, for a valueless `return` — the recorder BECOMES the returned expression */
  | { kind: "markReturnVoid"; pos: number; outcome: string };

export interface BranchSite {
  /** `<module>#<function>@<n>` */
  id: string;
  kind: BranchKind;
  /** the enclosing function's name, or "<module>" for a top-level branch */
  fn: string;
  /** the outcome suffixes this site contributes — `T`/`F`, or one named arm */
  outcomes: string[];
  /** the source text this site is about, trimmed, for the report */
  text: string;
  line: number;
  edits: BranchEdit[];
}

/**
 * Constructs that branch but that this instrumenter does not record. Listed
 * explicitly so the refusal names what it saw rather than failing vaguely, and so
 * adding support for one is a deliberate edit here.
 *
 * Each entry is a REASON, not a shrug. The two optional-chaining forms are the
 * interesting ones, and both are refused because instrumenting them would
 * over-report — which is the false-green direction:
 *
 *  - a `?.` whose left side contains another `?.` (`a?.b?.c`): when the inner
 *    link short-circuits, the whole chain is abandoned and the OUTER link never
 *    evaluates. A recorder wrapped around it would still see `undefined` and
 *    record the nullish arm as executed, marking as covered an arm that never
 *    ran. Write it as `a == null ? undefined : a.b?.c` — a conditional, which is
 *    recorded exactly.
 *  - an optional CALL (`f?.()`, `o.m?.()`): wrapping the callee detaches the
 *    method from its receiver, so `this` changes. That is a behaviour change in
 *    the code being measured, which is never an acceptable price for measuring
 *    it.
 */
function unsupported(n: ts.Node): string | null {
  if (ts.isSwitchStatement(n) && !n.caseBlock.clauses.some(ts.isDefaultClause)) {
    return "switch without a `default` clause — the no-match path is an arm of no clause, so it cannot be marked; add `default:` or use if/else";
  }
  if (ts.isForStatement(n) && !n.condition) {
    return "for(;;) — an unconditional loop has no branch to record; its exits are `break`/`return`, which this instrumenter does not track";
  }
  if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isBlock(n.statement)) {
    return "for..of/for..in with a braceless body — there is nowhere to mark the iterated arm; add braces";
  }
  if (ts.isTryStatement(n) && escapingJumps(n.tryBlock)) {
    return "try block that can `break` or `continue` out of the guarded body — the end-of-try marker would be skipped on a path that did not throw, and a jump has no expression position to record it in (a `return` does, and is recorded)";
  }
  if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && n.questionDotToken && hasOptionalChain(n.expression)) {
    return "optional chain over an optional chain (`a?.b?.c`) — when the inner link short-circuits the outer one never evaluates, so a recorder there would report an arm that did not run";
  }
  if (ts.isCallExpression(n) && n.questionDotToken) {
    return "optional CALL (`f?.()`) — wrapping the callee to record it would detach the method from its receiver and change `this`";
  }
  return null;
}

/** Does this subtree contain a `?.`, outside nested functions? (Chains do not cross them.) */
function hasOptionalChain(n: ts.Node): boolean {
  let found = false;
  const visit = (m: ts.Node): void => {
    if (found) return;
    if ((m as { questionDotToken?: ts.Node }).questionDotToken) found = true;
    else ts.forEachChild(m, visit);
  };
  visit(n);
  return found;
}

/**
 * Every `return` that ESCAPES this guarded block, in source order.
 *
 * A nested function's `return` is its own and does not escape; a `return` inside
 * a loop or switch nested in the block DOES, which is why those are still walked
 * for returns while their own `break`/`continue` are left alone.
 *
 * Each one is an exit path that skips the end-of-block marker, so each gets its
 * own recorder — which is what makes a guarded body that returns measurable
 * instead of refused. The alternative was rewriting the owned module to hoist
 * its result into a variable, and that would be measuring something other than
 * the code upstream wrote (C8's "extend the instrument, not the owned code").
 */
function escapingReturns(block: ts.Block): ts.ReturnStatement[] {
  const found: ts.ReturnStatement[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isReturnStatement(n)) {
      found.push(n);
      return;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(block, visit);
  return found.sort((a, b) => a.getStart() - b.getStart());
}

/**
 * Does this block `break` or `continue` OUT of itself?
 *
 * Still refused, and for a reason `return` does not share: a jump has no
 * expression position to hang a recorder on, so recording it would need a
 * statement insertion — which is unsafe in a braceless arm — or a flag variable,
 * which is a rewrite of the measured code rather than an insertion into it.
 * A jump owned by a loop or switch INSIDE the block does not leave it.
 */
function escapingJumps(block: ts.Block): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBreakStatement(n) || ts.isContinueStatement(n)) {
      found = true;
      return;
    }
    // A nested function's jumps are its own; loops and switches inside the try
    // own their `break`/`continue`, so those do not escape either.
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    if (ts.isIterationStatement(n, false) || ts.isSwitchStatement(n)) {
      // …unless it is LABELLED, which jumps past the construct that would
      // otherwise own it and can therefore still leave the guarded block.
      const labelled = (m: ts.Node): void => {
        if (found) return;
        if ((ts.isBreakStatement(m) || ts.isContinueStatement(m)) && m.label) found = true;
        else if (!ts.isFunctionLike(m) && !ts.isClassLike(m)) ts.forEachChild(m, labelled);
      };
      ts.forEachChild(n, labelled);
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(block, visit);
  return found;
}

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

  const raw: (Omit<BranchSite, "id"> & { sort: number })[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const label = (n: ts.Node) => n.getText(sf).replace(/\s+/g, " ").slice(0, 90);

  const wrapped = (expr: ts.Expression, kind: BranchKind, nullish = false) => {
    raw.push({
      kind,
      outcomes: ["T", "F"],
      fn: enclosingName(expr, moduleName),
      text: label(expr),
      line: at(expr),
      sort: expr.getStart(sf),
      edits: [{ kind: "wrap", start: expr.getStart(sf), end: expr.getEnd(), recorder: nullish ? "__covN" : "__cov" }],
    });
  };
  const marked = (n: ts.Node, kind: BranchKind, arms: { outcome: string; pos: number }[], textOf: ts.Node = n) => {
    raw.push({
      kind,
      outcomes: arms.map((a) => a.outcome),
      fn: enclosingName(n, moduleName),
      text: label(textOf),
      line: at(n),
      sort: n.getStart(sf),
      edits: arms.map((a) => ({ kind: "mark", pos: a.pos, outcome: a.outcome }) as const),
    });
  };

  const visit = (n: ts.Node): void => {
    const why = unsupported(n);
    if (why !== null) {
      throw new Error(
        `${moduleName}: ${path}:${at(n)} contains ${ts.SyntaxKind[n.kind]} (${why}).\n` +
          `  The branch inventory must be COMPLETE (§3.1), so an unrecordable construct fails rather than being skipped.\n` +
          `  Either rewrite the owned module without it, or teach strangle/branches.ts to record it.`,
      );
    }

    if (ts.isIfStatement(n)) wrapped(n.expression, "if");
    else if (ts.isConditionalExpression(n)) wrapped(n.condition, "conditional");
    else if (ts.isBinaryExpression(n)) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) wrapped(n.left, "and");
      else if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) wrapped(n.left, "or");
      else if (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) wrapped(n.left, "nullish", true);
    } else if (ts.isWhileStatement(n) || ts.isDoStatement(n)) wrapped(n.expression, "loop");
    else if (ts.isForStatement(n) && n.condition) wrapped(n.condition, "loop");
    else if (ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      marked(n, "loop", [{ outcome: "iterated", pos: (n.statement as ts.Block).getStart(sf) + 1 }], n.expression);
    } else if (ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      // The mark goes before the clause's first statement — or, for an empty
      // fall-through clause, at its end, which is immediately after the colon.
      const pos = n.statements.length > 0 ? n.statements[0].getStart(sf) : n.getEnd();
      marked(n, "clause", [{ outcome: "taken", pos }], ts.isCaseClause(n) ? n.expression : n);
    } else if (ts.isTryStatement(n)) {
      // The end-of-block marker only exists for a body that can FALL OFF its
      // end. One whose last statement is a `return` or a `throw` cannot, and
      // marking there would both be dead code and collide with the recorder on
      // that final `return`'s expression (they share a position).
      const last = n.tryBlock.statements[n.tryBlock.statements.length - 1];
      const fallsOff = last === undefined || !(ts.isReturnStatement(last) || ts.isThrowStatement(last));
      const completed = { outcome: "F", pos: n.tryBlock.getEnd() - 1 };
      // Every `return` that leaves the guarded body is a completed-arm exit that
      // skips the end-of-block marker, so each carries its own recorder. They
      // are EXTRA edits on the same site with the same outcome, not new
      // outcomes: "the body did not throw" is one arm however it left.
      const returnEdits: BranchEdit[] = escapingReturns(n.tryBlock).map((r) =>
        r.expression
          ? { kind: "wrapReturn", start: r.expression.getStart(sf), end: r.expression.getEnd(), outcome: "F" }
          : { kind: "markReturnVoid", pos: r.getStart(sf) + "return".length, outcome: "F" },
      );
      if (n.catchClause) {
        const arms = [{ outcome: "T", pos: n.catchClause.block.getStart(sf) + 1 }, ...(fallsOff ? [completed] : [])];
        marked(n, "try", arms, n.tryBlock);
        const site = raw[raw.length - 1];
        site.edits.push(...returnEdits);
        // The site still has both outcomes even when the block cannot fall off
        // its end: `F` is then recorded on the returning exits alone.
        if (!fallsOff) site.outcomes = ["T", "F"];
      } else {
        // try/finally, no catch. There is no arm to mark the throwing path in,
        // so one is INSERTED: a catch that records and immediately rethrows,
        // between the try block and the `finally` keyword. The exception object
        // is rethrown unchanged, so it still reaches the finally and still
        // propagates; only the recorder is added.
        //
        // Not a workaround for a missing arm — it is the same two outcomes
        // try/catch has, stated the same way: `T` is "the guarded body threw",
        // `F` is "it completed". A body the CONSUMER abandons (a generator's
        // `.return()` runs the finally without throwing) records neither, which
        // is exactly what try/catch already does and what the abrupt-completion
        // refusal above keeps from happening any other way.
        raw.push({
          kind: "try",
          outcomes: ["T", "F"],
          fn: enclosingName(n, moduleName),
          text: label(n.tryBlock),
          line: at(n),
          sort: n.getStart(sf),
          edits: [
            { kind: "insertCatch", pos: n.tryBlock.getEnd(), outcome: "T" },
            ...(fallsOff ? [{ kind: "mark" as const, ...completed }] : []),
            ...returnEdits,
          ],
        });
      }
    } else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && n.questionDotToken) {
      wrapped(n.expression, "optional", true);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);

  raw.sort((a, b) => a.sort - b.sort);
  const seen = new Map<string, number>();
  return raw.map((r) => {
    const n = seen.get(r.fn) ?? 0;
    seen.set(r.fn, n + 1);
    const { sort: _sort, ...site } = r;
    return { ...site, id: `${moduleName}#${r.fn}@${n}` };
  });
}

/** The outcomes this site contributes to the inventory. */
export const outcomesOf = (site: BranchSite): string[] => site.outcomes.map((o) => `${site.id}:${o}`);

/**
 * Rewrite a module so every branch site records its outcome. Insertions only,
 * applied back to front, so nested sites keep the offsets the AST reported.
 */
export function instrumentSource(source: string, sites: readonly BranchSite[], recorderSpecifier: string): string {
  // Both span-based edit kinds share the depth computation and the tie ranks:
  // a condition wrap (`__cov(id,(EXPR))`, which records by truthiness) and a
  // returned-expression wrap (`(__covS(id:F), EXPR)`, which records an arm and
  // evaluates to EXPR). They nest inside each other freely — a `return` inside a
  // guarded body can return a `??` expression that is itself wrapped — so they
  // must be ordered together rather than in two independent passes.
  const wraps = sites.flatMap((s) =>
    s.edits
      .filter((e): e is Extract<BranchEdit, { kind: "wrap" | "wrapReturn" }> => e.kind === "wrap" || e.kind === "wrapReturn")
      .map((e) => ({
        start: e.start,
        end: e.end,
        open: e.kind === "wrap" ? `${e.recorder}(${JSON.stringify(s.id)},(` : `(__covS(${JSON.stringify(`${s.id}:${e.outcome}`)}),`,
        close: e.kind === "wrap" ? "))" : ")",
      })),
  );
  const edits: { pos: number; text: string; depth: number; rank: number }[] = [];
  for (const w of wraps) {
    // depth = how many wrapped spans contain this one; used only to break ties
    const depth = wraps.filter((o) => o.start <= w.start && w.end <= o.end).length;
    edits.push({ pos: w.start, text: w.open, depth, rank: 1 });
    edits.push({ pos: w.end, text: w.close, depth, rank: -1 });
  }
  for (const site of sites) {
    for (const edit of site.edits) {
      if (edit.kind !== "markReturnVoid") continue;
      // `return;` has no expression to wrap, so the recorder BECOMES the
      // returned expression: `__covS` returns undefined, which is what a
      // valueless `return` already produced.
      edits.push({ pos: edit.pos, text: ` __covS(${JSON.stringify(`${site.id}:${edit.outcome}`)})`, depth: 0, rank: 2 });
    }
  }
  for (const site of sites) {
    for (const edit of site.edits) {
      if (edit.kind !== "mark") continue;
      // The leading `;` is not cosmetic: a mark at the END of a try block lands
      // straight after a statement that may have relied on ASI (`out=fn()`),
      // and `out=fn()__covS(…)` is a syntax error. An empty statement is legal
      // in every position a mark is inserted into.
      edits.push({ pos: edit.pos, text: `;__covS(${JSON.stringify(`${site.id}:${edit.outcome}`)});`, depth: 0, rank: 2 });
    }
  }
  for (const site of sites) {
    for (const edit of site.edits) {
      if (edit.kind !== "insertCatch") continue;
      // Between the try block's `}` and the `finally` keyword. The binding is
      // named for the recorder so it cannot shadow anything the module declares.
      const id = JSON.stringify(`${site.id}:${edit.outcome}`);
      edits.push({ pos: edit.pos, text: `catch(__covErr){__covS(${id});throw __covErr}`, depth: 0, rank: 3 });
    }
  }
  // Applying right-to-left, an insertion at the same position as a previous one
  // ends up BEFORE it. At a tie: apply the INNER open last (it must sit after
  // the outer open), the INNER close first (it must sit before the outer one),
  // and a statement MARK last of all, so it lands leftmost — a marker must
  // precede the expression it introduces, never sit inside its wrapper.
  edits.sort((a, b) => b.pos - a.pos || a.rank - b.rank || (a.rank > 0 ? b.depth - a.depth : a.depth - b.depth));
  let out = source;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return `import { __cov, __covN, __covS } from ${JSON.stringify(recorderSpecifier)};\n${out}`;
}
