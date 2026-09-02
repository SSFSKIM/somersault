// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the moat-tool belt (W8a / C11a).
//
//   npx tsx strangle/moat-parity.test.ts
//
// The seventh instance of the oracle W2 built for the tool descriptions: locate
// the upstream bodies in the PINNED BUNDLE, evaluate them with their own
// constants and with stubbed ports, and require byte identity with the owned
// modules over the full cross-product. Nothing here hand-writes an expectation,
// so nothing here can encode a transcription error — which matters more for this
// wave than for any before it, because thirty thousand bytes of prose is exactly
// the kind of thing a human comparison passes and a byte comparison does not.
//
// WHY THIS BELT NEEDS IT, stated as what the corpus cannot see.
//
//   THE ARM BEHIND A GATE-DEAD TOOL. CronCreate's description carries a
//     paragraph pointing at `Monitor` — the only place in the whole catalog
//     where one tool's prose names another that the engine never presents. It is
//     behind `RI() = I("tengu_amber_sentinel", false)`, whose compiled-in default
//     is false and which has no per-gate env override, so §3.3's pinned state
//     makes it unrenderable. Here it is a PORT, and both of its answers are
//     graded whatever the environment returns.
//   THE ARM BEHIND A GATE THAT DEFAULTS THE OTHER WAY. SendMessage's cross-session
//     sections are behind `Yo()`, whose gate default is TRUE — so the corpus
//     records the ENABLED arm and the disabled one (three paragraphs and a table
//     row shorter) is the unreachable half. A gate defaulting true hides exactly
//     as much as one defaulting false; only which half changes.
//   THE DURABILITY AXIS. All three cron descriptions branch on
//     `tengu_kairos_cron_durable`, whose default is true, so every recorded body
//     carries the durable arm and none carries the session-only one.
//   THE PROMPT-CACHE AXIS. ScheduleWakeup's builder takes a THREE-valued
//     argument — one-hour TTL, five-minute TTL, or `undefined` when the two
//     model-budget reads disagree — and the corpus's two reads always agree, so
//     one of the three arms is recorded and two are not.
//   THE TASK FORMATTERS' DOMAIN. `task-family` creates two tasks and lists them.
//     The formatters' domain is wider by a lot: an empty list, a task with no
//     description, both dependency directions, an owner suffix, an update
//     failure with and without a message, and a completion nudge behind two
//     ports that are false headlessly. Those arms are C4/W1's owned code and
//     until now they were graded against HAND-WRITTEN strings in
//     `strangle/contracts.test.ts`. That file keeps its cases deliberately — two
//     checks over one module is not duplication when one of them is a
//     transcription and the other is upstream's own bytes — but the load-bearing
//     grade moves here.
//
// HOW IT BINDS, and the rules it inherits from the six oracles before it.
//
//   THE SUBJECT IS LOCATED BY THE BUILD'S OWN RULE. `resolveAnchor` +
//     `selectExcision` + `assertSignature`, the same three functions
//     `strangle/build.ts` calls, so an oracle and a build cannot grade different
//     functions and a drifted anchor fails here too.
//   THE BINDINGS COME FROM THE MANIFEST. Every free variable is re-derived with
//     the row's own `derive` regexes, so this file cannot bind a port the splice
//     does not forward.
//   A `primitive` IS BOUND TO UPSTREAM'S OWN VALUE, resolved out of the bundle
//     rather than written down — through the import graph when the constant
//     lives in another chunk, and through the initializer's own arithmetic when
//     it is not a literal (CronCreate's retention window is
//     `AM.recurringMaxAgeMs / 86400000`, and writing "7" here would grade the
//     owned copy against a second transcription of the same number). The owned
//     side then receives that resolved value through its ADAPTER, whose
//     equality assertion is the check.
//   THE PORT TRACE IS COMPARED AS WELL AS THE VALUE, because two arms of a
//     description can differ in nothing but which gate was consulted.
//
// ON `eval`. Same argument as its six predecessors: the oracle has to be
// upstream's own bytes, and there is no other way to run a body extracted from a
// minified chunk. The input is the pinned bundle, which the build already
// executes wholesale.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { textModules } from "./prepare.js";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, literalStringValue, selectExcision } from "./ast.js";
import { deriveCaptures, SPLICES, type Splice } from "./manifest.js";

const BUNDLE = new Map(textModules(BUNDLE_MODULES).map((p) => [p, readFileSync(p, "utf8")]));

let checks = 0;
let controls = 0;
const failures: string[] = [];

function eq(label: string, upstream: unknown, owned: unknown): boolean {
  checks++;
  // A promise stringifies to `{}` on both sides, so an un-awaited comparison
  // passes by comparing nothing. TaskOutput's prompt is `async`, which is
  // exactly how this file first passed a case it had not run.
  if (upstream instanceof Promise || owned instanceof Promise) {
    failures.push(`${label}: a side is still a promise — the comparison would have been vacuous`);
    return false;
  }
  const a = typeof upstream === "string" ? upstream : JSON.stringify(upstream);
  const b = typeof owned === "string" ? owned : JSON.stringify(owned);
  if (a === b) return true;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  failures.push(
    `${label}: differs at offset ${at}\n    upstream: ${JSON.stringify(a.slice(Math.max(0, at - 30), at + 50))}\n    owned:    ${JSON.stringify(b.slice(Math.max(0, at - 30), at + 50))}`,
  );
  return false;
}

/**
 * THE RED DIRECTION, per family (§3.1's non-vacuity contract).
 *
 * A file that compared an implementation against itself would pass by being
 * unable to fail. Each control feeds the comparator two values that MUST differ
 * — upstream's own output against the same output with one character moved — and
 * fails when it cannot tell them apart.
 */
function mustDiffer(label: string, a: string, b: string): void {
  controls++;
  if (a !== b) return;
  failures.push(`${label}: the control could not distinguish two values that differ — this file cannot fail`);
}

/** Perturb one character of a string, for the control above. */
const perturb = (s: string): string => (s.length === 0 ? "x" : `${s.slice(0, s.length - 1)}${s[s.length - 1] === "x" ? "y" : "x"}`);

// ---------------------------------------------------------------------------
// locating and binding
// ---------------------------------------------------------------------------

const splice = (name: string): Splice => {
  const sp = SPLICES.find((s) => s.name === name);
  if (!sp) throw new Error(`no manifest row named ${name}`);
  return sp;
};

interface Extracted {
  /** statements that declare the subject, evaluable in an empty scope once its bindings are supplied */
  source: string;
  /** the expression that names the callable, after `source` */
  entry: string;
  /** the chunk the anchor resolved to */
  path: string;
  /** manifest `as` -> the identifier the body actually uses */
  binding: Map<string, string>;
  /** manifest order, non-owned only — the delegation's argument order */
  forwarded: string[];
}

const cache = new Map<string, Extracted>();
function extract(name: string): Extracted {
  const hit = cache.get(name);
  if (hit) return hit;
  const sp = splice(name);
  const { path, source, offsets } = resolveAnchor(BUNDLE, sp, (p) => basename(p));
  const sf = chunkAst(path, source);
  const cut = selectExcision(sp.name, sf, offsets, sp.target, sp.signature);
  assertSignature(sp.name, cut, sp.signature);
  const captures = deriveCaptures(sp, cut.original);
  const binding = new Map<string, string>();
  for (const c of captures) binding.set(c.as, c.identifier);
  // Each shape's excision is a different KIND of span, and evaluating it needs a
  // different wrapper: a free function names itself, a declarator's excision is
  // a bare VALUE (the delegation replaces the initializer, so upstream's side is
  // a thunk over it), and a sibling method is a member of an object literal that
  // is not in the span at all.
  const wrapped: Extracted =
    sp.target === "free-function"
      ? { source: cut.original, entry: cut.label, path, binding, forwarded: [] }
      : sp.target === "variable-declarator"
        ? { source: `const __value = ${cut.original};`, entry: "(() => __value)", path, binding, forwarded: [] }
        : { source: `const __obj = { ${cut.original} };`, entry: `__obj[${JSON.stringify(cut.label)}].bind(__obj)`, path, binding, forwarded: [] };
  wrapped.forwarded = captures.filter((c) => !c.owned).map((c) => c.as);
  cache.set(name, wrapped);
  return wrapped;
}

// ---- upstream's own constants, resolved rather than transcribed -------------

/** Top-level declarations of one chunk, by bound name. */
const declsOf = new Map<string, Map<string, ts.VariableDeclaration>>();
/** `local name -> { chunk basename, exported name }` for one chunk. */
const importsOf = new Map<string, Map<string, { from: string; name: string }>>();

function indexChunk(path: string): void {
  if (declsOf.has(path)) return;
  const sf = chunkAst(path, BUNDLE.get(path)!);
  const decls = new Map<string, ts.VariableDeclaration>();
  const imports = new Map<string, { from: string; name: string }>();
  ts.forEachChild(sf, (n) => {
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) decls.set(d.name.text, d);
    }
    if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
      const from = basename((n.moduleSpecifier as ts.StringLiteral).text);
      for (const el of n.importClause.namedBindings.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
    }
  });
  declsOf.set(path, decls);
  importsOf.set(path, imports);
}

/** Resolve an export alias (`export{X as Name}`) to the local name it re-exports. */
function localFor(path: string, exported: string): string {
  const sf = chunkAst(path, BUNDLE.get(path)!);
  let local = exported;
  ts.forEachChild(sf, (n) => {
    if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
      for (const el of n.exportClause.elements) if (el.name.text === exported) local = (el.propertyName ?? el.name).text;
    }
  });
  return local;
}

const pathOf = (base: string): string => {
  const p = join(BUNDLE_MODULES, base);
  if (!BUNDLE.has(p)) throw new Error(`chunk ${base} is not in the graph`);
  return p;
};

/**
 * UPSTREAM'S VALUE FOR ONE `primitive` CAPTURE.
 *
 * Three cases, in order, each one loud when it does not apply:
 *   1. a plain literal (or a template whose spans are literals, which the
 *      minifier emits for a constant fold) — read with the build's own
 *      `literalStringValue`, so the oracle's idea of "literal" is the build's;
 *   2. an import — resolved one hop through the export clause and recursed;
 *   3. anything else — evaluated in a scope built from the initializer's own
 *      free names, resolved the same way. CronCreate's retention window is
 *      `AM.recurringMaxAgeMs / 86400000`, and writing `7` in this file would
 *      grade the owned constant against a second transcription of it.
 */
function upstreamConstant(path: string, ident: string, seen = 0): unknown {
  if (seen > 4) throw new Error(`${ident}: constant resolution recursed too deep`);
  indexChunk(path);
  const decl = declsOf.get(path)!.get(ident);
  if (decl?.initializer) {
    const literal = literalStringValue(decl.initializer);
    if (literal !== null) return literal;
    if (ts.isNumericLiteral(decl.initializer)) return Number(decl.initializer.text);
    // The general case: evaluate the initializer with its own free names bound.
    const src = decl.initializer.getText();
    const free = new Set<string>();
    // A property NAME is not a free variable, and neither is the right-hand
    // side of a member access. `AM = {recurringFrac: 0.5, …}` has no free names
    // at all once both are excluded, which is the common case here.
    const walk = (n: ts.Node): void => {
      const nameOfParent =
        ts.isIdentifier(n) &&
        ((ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) ||
          (ts.isPropertyAssignment(n.parent) && n.parent.name === n) ||
          (ts.isMethodDeclaration(n.parent) && n.parent.name === n) ||
          (ts.isBindingElement(n.parent) && n.parent.propertyName === n));
      if (ts.isIdentifier(n) && !nameOfParent) free.add(n.text);
      ts.forEachChild(n, walk);
    };
    walk(decl.initializer);
    const scope: Record<string, unknown> = {};
    for (const f of free) scope[f] = upstreamConstant(path, f, seen + 1);
    const names = [...free];
    // eslint-disable-next-line no-eval
    return (eval(`((${names.join(",")}) => (${src}))`) as (...a: unknown[]) => unknown)(...names.map((n) => scope[n]));
  }
  // An object literal reached as a whole (the `AM` config record above).
  if (decl === undefined) {
    const imported = importsOf.get(path)!.get(ident);
    if (!imported) throw new Error(`${ident}: neither declared nor imported in ${basename(path)}`);
    const far = pathOf(imported.from);
    return upstreamConstant(far, localFor(far, imported.name), seen + 1);
  }
  throw new Error(`${ident}: declared without an initializer in ${basename(path)}`);
}

const constants = new Map<string, unknown>();
function primitiveValue(name: string, as: string): unknown {
  const key = `${name}/${as}`;
  if (!constants.has(key)) {
    const ex = extract(name);
    constants.set(key, upstreamConstant(ex.path, ex.binding.get(as)!));
  }
  return constants.get(key);
}

/** Upstream's body, with this case's bindings lexically in scope. */
function upstream(name: string, bound: Record<string, unknown>): (...args: unknown[]) => unknown {
  const ex = extract(name);
  const scope: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const [as, identifier] of ex.binding) {
    scope[identifier] = bound[as];
    lines.push(`const ${identifier} = __scope[${JSON.stringify(identifier)}];`);
  }
  // eslint-disable-next-line no-eval
  const make = eval(`(__scope) => { ${lines.join("\n")}\n${ex.source}\nreturn ${ex.entry}; }`) as (
    s: Record<string, unknown>,
  ) => (...a: unknown[]) => unknown;
  return make(scope);
}

/** The owned side, driven through its ADAPTER — argument order included. */
async function owned(name: string, params: unknown[], bound: Record<string, unknown>): Promise<unknown> {
  await import(`./modules/${name}.js`);
  const table = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => unknown> }).__reforge ?? {};
  const fn = table[splice(name).fn];
  if (typeof fn !== "function") throw new Error(`${name}: the adapter registered no '${splice(name).fn}'`);
  return fn(...params, ...extract(name).forwarded.map((as) => bound[as]));
}

/**
 * Grade one case: upstream's body against the owned module, value and port
 * trace alike, with the primitives resolved from the bundle for BOTH sides.
 *
 * `makePorts` receives a fresh trace per side, so a port called a different
 * number of times on the two sides is a difference rather than an accumulation.
 */
async function both(
  name: string,
  label: string,
  params: unknown[],
  makePorts: (trace: string[]) => Record<string, unknown> = () => ({}),
): Promise<string> {
  const ex = extract(name);
  const sp = splice(name);
  const primitives: Record<string, unknown> = {};
  for (const c of sp.captures) if (c.kind === "primitive") primitives[c.as] = primitiveValue(name, c.as);
  const upTrace: string[] = [];
  const ownTrace: string[] = [];
  // AWAITED ON BOTH SIDES. Upstream's TaskOutput prompt is `async` and the
  // delegation preserves that, so an un-awaited compare would put two promises
  // through JSON.stringify and pass on `{}` === `{}`.
  const up = (await upstream(name, { ...primitives, ...makePorts(upTrace) })(...params)) as string;
  const own = (await owned(name, params, { ...primitives, ...makePorts(ownTrace) })) as string;
  eq(`${name} :: ${label}`, up, own);
  eq(`${name} :: ${label} [port trace]`, upTrace, ownTrace);
  void ex;
  return up;
}

console.log(`moat-tool parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ============================================================================
// 1. THE DESCRIPTION BELT — sixteen rows, every branch each one has.
// ============================================================================
{
  // --- the cron family: one durability axis, and CronCreate's Monitor arm ---
  for (const durable of [true, false]) {
    for (const monitor of [true, false]) {
      await both("cron-create-description", `durable=${durable} monitor=${monitor}`, [durable], (t) => ({
        monitorEnabled: () => {
          t.push("monitorEnabled");
          return monitor;
        },
      }));
    }
    await both("cron-delete-description", `durable=${durable}`, [durable]);
    await both("cron-list-description", `durable=${durable}`, [durable]);
  }

  // --- the capture-free rows: one case apiece, and one case is the domain ---
  for (const name of [
    "enter-worktree-description",
    "exit-worktree-description",
    "report-findings-description",
    "task-stop-description",
    "remote-trigger-description",
    "task-output-description",
    "list-agents-description",
    "workflow-description",
    "exit-plan-mode-description",
    "ask-user-question-description",
  ]) {
    await both(name, "the only arm", []);
  }

  // --- ScheduleWakeup: three prompt-cache arms, one of them recorded --------
  for (const ttl of [true, false, undefined]) {
    await both("schedule-wakeup-description", `oneHourCacheTtl=${String(ttl)}`, [ttl]);
  }

  // --- SendMessage: the kill switch × the team context ----------------------
  for (const crossSession of [true, false]) {
    for (const team of [true, false]) {
      await both("send-message-description", `crossSession=${crossSession} team=${team}`, [team], (t) => ({
        crossSessionEnabled: () => {
          t.push("crossSessionEnabled");
          return crossSession;
        },
      }));
    }
  }

  // --- EnterPlanMode: two prose ports, distinguishable by their stubs -------
  for (const what of ["<WHAT-A>", "<WHAT-B>"]) {
    for (const note of ["<NOTE-A>", "<NOTE-B>"]) {
      await both("enter-plan-mode-description", `what=${what} note=${note}`, [], (t) => ({
        whatHappensSection: () => {
          t.push("whatHappensSection");
          return what;
        },
        agentToolNote: () => {
          t.push("agentToolNote");
          return note;
        },
      }));
    }
  }
}

// ============================================================================
// 2. THE PRIMITIVES ARE UPSTREAM'S, AND THE ADAPTERS SAY SO.
//    Section 1 already routes every owned module through its adapter, so every
//    `assertGraphValue` above has already fired. These assertions record WHAT
//    was compared, because a value resolved from the bundle and then never
//    printed is a check whose subject nobody can see.
// ============================================================================
{
  const named: [string, string, unknown][] = [
    ["cron-create-description", "cronCreateToolName", "CronCreate"],
    ["cron-create-description", "cronDeleteToolName", "CronDelete"],
    ["cron-create-description", "monitorToolName", "Monitor"],
    ["cron-create-description", "recurringMaxAgeDays", 7],
    ["list-agents-description", "sendMessageToolName", "SendMessage"],
    ["send-message-description", "listAgentsToolName", "ListAgents"],
    ["workflow-description", "agentToolName", "Agent"],
    ["ask-user-question-description", "enterPlanModeToolName", "EnterPlanMode"],
    ["ask-user-question-description", "exitPlanModeToolName", "ExitPlanMode"],
    ["exit-plan-mode-description", "askUserQuestionToolName", "AskUserQuestion"],
    ["enter-plan-mode-description", "askUserQuestionToolName", "AskUserQuestion"],
  ];
  for (const [row, as, expected] of named) {
    eq(`${row} :: primitive ${as} resolved from the bundle`, String(expected), String(primitiveValue(row, as)));
  }
  // The preamble is 1,242 bytes of prose rather than a name, and it is the one
  // primitive in the belt whose VALUE is the behaviour on its own.
  const preamble = primitiveValue("schedule-wakeup-description", "scheduleWakeupPreamble") as string;
  eq("schedule-wakeup-description :: the preamble is upstream's own bytes", String(preamble.length > 1000), "true");
}

// ============================================================================
// 3. THE TASK-FAMILY FORMATTERS — C4/W1's rows, over a domain `task-family`
//    does not reach, and against upstream's own bytes rather than against a
//    transcription. `strangle/contracts.test.ts` keeps its hand-written cases
//    for the same four modules on purpose: two graders over one module is not
//    duplication when one of them is a second artifact.
// ============================================================================
{
  const ID = "toolu_1";
  const task = (over: Record<string, unknown> = {}) => ({
    id: 1,
    subject: "S",
    status: "pending",
    description: "D",
    blockedBy: [] as number[],
    blocks: [] as number[],
    ...over,
  });

  await both("task-create-result", "a created task", [{ task: { id: 7, subject: "S" } }, ID]);

  await both("task-get-result", "no such task", [{ task: undefined }, ID]);
  await both("task-get-result", "a plain task", [{ task: task() }, ID]);
  await both("task-get-result", "blocked-by chain", [{ task: task({ blockedBy: [2, 3] }) }, ID]);
  await both("task-get-result", "both dependency directions", [{ task: task({ blockedBy: [2, 3], blocks: [4] }) }, ID]);
  await both("task-get-result", "no description", [{ task: task({ description: undefined }) }, ID]);

  await both("task-list-result", "the empty list", [{ tasks: [] }, ID]);
  await both("task-list-result", "one plain task", [{ tasks: [task()] }, ID]);
  await both("task-list-result", "owner suffix", [{ tasks: [task({ owner: "alice" })] }, ID]);
  await both("task-list-result", "owner suffix and a blocker", [{ tasks: [task({ owner: "alice", blockedBy: [2] })] }, ID]);
  await both("task-list-result", "several, mixed", [
    { tasks: [task(), task({ id: 2, status: "completed", owner: "bob" }), task({ id: 3, blockedBy: [1, 2] })] },
    ID,
  ]);

  for (const [ctx, enabled] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as [boolean, boolean][]) {
    const ports = (t: string[]) => ({
      agentTeamContext: () => {
        t.push("agentTeamContext");
        return ctx;
      },
      agentTeamsEnabled: () => {
        t.push("agentTeamsEnabled");
        return enabled;
      },
    });
    await both("task-update-result", `completed, ctx=${ctx} enabled=${enabled}`, [
      { success: true, taskId: 1, updatedFields: ["status"], statusChange: { to: "completed" } },
      ID,
    ], ports);
    await both("task-update-result", `failure with a message, ctx=${ctx} enabled=${enabled}`, [
      { success: false, taskId: 1, error: "nope" },
      ID,
    ], ports);
  }
  await both("task-update-result", "failure without a message", [{ success: false, taskId: 1 }, ID], (t) => ({
    agentTeamContext: () => {
      t.push("agentTeamContext");
      return false;
    },
    agentTeamsEnabled: () => {
      t.push("agentTeamsEnabled");
      return false;
    },
  }));
  await both("task-update-result", "success lists the changed fields", [
    { success: true, taskId: 1, updatedFields: ["status", "owner"] },
    ID,
  ], (t) => ({
    agentTeamContext: () => {
      t.push("agentTeamContext");
      return false;
    },
    agentTeamsEnabled: () => {
      t.push("agentTeamsEnabled");
      return false;
    },
  }));
}

// ============================================================================
// 4. RED DIRECTION, one control per family.
//    Each takes a real upstream output and requires the comparator to see a
//    one-character change in it. Without these the file could pass by comparing
//    a value against itself, which is the vacuity §3.1 refuses.
// ============================================================================
{
  const samples: [string, unknown[], (t: string[]) => Record<string, unknown>][] = [
    ["cron-create-description", [true], (t) => ({ monitorEnabled: () => (t.push("m"), true) })],
    ["cron-delete-description", [true], () => ({})],
    ["enter-worktree-description", [], () => ({})],
    ["report-findings-description", [], () => ({})],
    ["schedule-wakeup-description", [true], () => ({})],
    ["send-message-description", [false], (t) => ({ crossSessionEnabled: () => (t.push("c"), true) })],
    ["task-output-description", [], () => ({})],
    ["workflow-description", [], () => ({})],
    ["enter-plan-mode-description", [], (t) => ({
      whatHappensSection: () => (t.push("w"), "<W>"),
      agentToolNote: () => (t.push("n"), "<N>"),
    })],
  ];
  for (const [name, params, ports] of samples) {
    const sp = splice(name);
    const primitives: Record<string, unknown> = {};
    for (const c of sp.captures) if (c.kind === "primitive") primitives[c.as] = primitiveValue(name, c.as);
    const trace: string[] = [];
    const value = String(await upstream(name, { ...primitives, ...ports(trace) })(...params));
    mustDiffer(`${name} :: a one-character change is visible`, value, perturb(value));
  }
  // …and the same for the formatter family, whose result is an object rather
  // than a string, so the comparison runs through JSON.
  const ID = "toolu_1";
  const listed = (await both("task-list-result", "control sample", [{ tasks: [] }, ID])) as unknown as { content?: string };
  mustDiffer(
    "task-list-result :: a one-character change is visible",
    JSON.stringify(listed),
    JSON.stringify({ ...listed, content: perturb(String(listed.content ?? "")) }),
  );
}

// ============================================================================
// SUMMARY — the floors are the non-vacuity contract (§3.1). Both numbers are
// measured; raise them when the cross-product grows.
// ============================================================================
if (checks < 96) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 10) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);

console.log(`=== moat-tool parity: ${checks} comparison(s), ${controls} control(s) ===`);
for (const f of failures.slice(0, 30)) console.log(`  FAIL — ${f}`);
if (failures.length > 30) console.log(`  … and ${failures.length - 30} more`);
console.log(
  failures.length === 0
    ? "PASS — every owned moat-tool module matches the pinned upstream body over the full cross-product, values and port traces alike"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
