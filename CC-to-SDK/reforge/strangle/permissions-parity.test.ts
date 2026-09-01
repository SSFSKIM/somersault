// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the permission subsystem (W6 / C9).
//
//   npx tsx strangle/permissions-parity.test.ts
//
// The fifth instance of the oracle W2 built for the tool descriptions: extract
// the upstream bodies from the PINNED BUNDLE, evaluate them with stubbed ports,
// and require deep equality with the owned modules over the full cross-product.
// Nothing here hand-writes an expectation, so nothing here can encode a
// transcription error.
//
// WHY THIS SUBSYSTEM NEEDS IT, stated as what a corpus cannot see.
//
//   THE REFUSALS. The rule checker answers `null` when nothing objects, and the
//     pre-check's twelve-rung ladder produces the same transcript whether a rung
//     was evaluated and passed or was never reached. "The deny rule did not
//     match" and "the deny rule was never consulted" are the same recording.
//     This is C8's "unrecordable by construction" family, and it covers most of
//     this subsystem rather than a corner of it.
//   THE MODES THE ENVIRONMENT FORBIDS. `auto` is gate-guarded and §3.3 pins
//     every gate to its compiled-in disabled default, so every arm behind the
//     gate — the transition's strip and restore, the guard's two auto refusals —
//     is unreachable by any recording this project can make. It is reachable
//     here, because the gate is a port.
//   THE MODE MATRIX ITSELF. The transition has thirty ordered mode pairs and a
//     scenario walks four of them. The pairs are cheap here and expensive there.
//   THE DECISION VALUE, arm by arm. Permission decisions are OBEYED results (the
//     PreCompact precedent, one subsystem over): what matters is the behavior,
//     the updatedInput, the updatedPermissions, the decisionReason and the
//     interrupt flag, and a transcript shows at most the outcome of one of them.
//   THE PORT TRACE. Two refusals that return the same value can differ in
//     nothing but WHICH ports ran and in what order — the update filter's
//     short-circuit, the streak predicate's three-term conjunction, the
//     pre-check's two calls to the permission-context reader. A value comparison
//     alone cannot see any of it, so every stubbed port records.
//
// HOW IT BINDS, and the two rules it inherits.
//
//   THE SUBJECT IS LOCATED BY THE BUILD'S OWN RULE (this file's addition to the
//     family). Rather than hand-rolling a brace matcher, it calls
//     `resolveAnchor` + `selectExcision` + `assertSignature` — the same three
//     functions `strangle/build.ts` calls — against the pinned bundle. An oracle
//     that found its subject differently from the build could grade a different
//     function; here that is impossible by construction, and a row whose anchor
//     drifted fails HERE as well as at the build.
//   THE BINDINGS COME FROM THE MANIFEST. Each body's free variables are
//     re-derived with the manifest's own `derive` regexes against the extracted
//     body, so this file cannot bind a port the splice does not forward.
//   WHERE AN UPSTREAM BODY CALLS A HELPER THIS WAVE ALSO OWNS, the helper is
//     extracted and compared on its own FIRST, and the body is then bound to
//     UPSTREAM's copy (C7's boundary-review lesson). Binding it to the owned
//     copy routes a shared defect through both sides and compares equal. Three
//     helpers are in that position: the ask-rule predicate, the safety-check
//     finder and the pluralizer.
//
// ON `eval`. It is the mechanism, not a shortcut — the oracle has to be
// upstream's own bytes, and those bytes are minified declarations that only
// exist as source. The input is the pinned, locally extracted bundle named by
// `src/pin.ts`: never network data, never user input, and this file is a
// developer test that never ships.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { resolveAnchor } from "./anchor.js";
import { assertSignature, chunkAst, selectExcision } from "./ast.js";
import { deriveCaptures, SPLICES, type Splice } from "./manifest.js";
import { readFixture } from "../research/tools/extract-permission-surface.js";
// The owned side is driven through the ADAPTERS, not through the reference
// modules directly, so the argument list this file passes IS the one the build's
// delegation synthesises — the manifest's non-owned captures, in manifest order,
// primitives and their equality assertions included.
import "./modules/permission-decision.js";
import "./modules/permission-precheck.js";
import "./modules/rule-based-permissions.js";
import "./modules/allow-rule-decision.js";
import "./modules/mode-change-guard.js";
import "./modules/mode-transition.js";
import "./modules/permission-request-hook-decision.js";
import "./modules/broker-response-map.js";
import "./modules/broker-permission-updates.js";
import "./modules/control-response-success.js";
import "./modules/control-response-error.js";
import { pluralize } from "./modules/shared/pluralize.js";
import { permissionMessage } from "./modules/shared/permission-message.js";
import { isAskRuleDrivenReason } from "./modules/shared/ask-rule-reason.js";
import { findSafetyCheckReason } from "./modules/shared/safety-check-reason.js";
import { classifierOnlyStreakActive } from "./modules/shared/classifier-streak.js";

const reforge = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => unknown> }).__reforge!;

let checks = 0;
let controls = 0;
const failures: string[] = [];

function eq(label: string, upstream: unknown, owned: unknown): void {
  checks++;
  const a = safeJson(upstream);
  const b = safeJson(owned);
  if (a === b) return;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  failures.push(
    `${label}: differs at offset ${at}\n    upstream: ${JSON.stringify(a.slice(Math.max(0, at - 40), at + 80))}\n    owned:    ${JSON.stringify(b.slice(Math.max(0, at - 40), at + 80))}`,
  );
}

/**
 * The non-vacuity control, counted separately so the `checks` floor keeps
 * meaning "the cross-product is complete" rather than being satisfiable by
 * adding controls. Each mutant is a wrong implementation this subsystem could
 * plausibly ship, perturbed IN MEMORY and on the OWNED side only.
 */
function mustDiffer(label: string, upstream: unknown, perturbedOwned: unknown): void {
  controls++;
  if (safeJson(upstream) !== safeJson(perturbedOwned)) return;
  failures.push(`CONTROL ${label}: the perturbed owned result compared EQUAL — this file cannot see a wrong implementation`);
}

/** JSON with a stable rendering for the values these bodies actually return. */
function safeJson(v: unknown): string {
  return (
    JSON.stringify(v, (_k, value) => {
      if (value instanceof Map) return { __map: [...value.entries()] };
      if (value instanceof Error) return { __error: value.constructor.name, message: value.message };
      if (typeof value === "function") return `__fn:${value.name || "anonymous"}`;
      if (value === undefined) return "__undefined";
      return value;
    }) ?? "__undefined"
  );
}

// ---- extraction, by the BUILD's own rule -------------------------------------

const BUNDLE = new Map<string, string>();
for (const f of readdirSync(BUNDLE_MODULES)) {
  if (f.endsWith(".js")) BUNDLE.set(join(BUNDLE_MODULES, f), readFileSync(join(BUNDLE_MODULES, f), "utf8"));
}

/**
 * The two owned pure helpers this wave does NOT splice (see the manifest's note
 * where their rows would be): both are takeable, both were built and
 * solo-sabotaged, and neither turned a scenario red, so they are `shared/`
 * helpers rather than manifest rows.
 *
 * They still have to be graded against upstream's bytes — that is the whole
 * bargain §2.4 strikes for a `pure-helper` — so they are extracted by the SAME
 * three functions the build uses, from a synthetic row rather than a real one.
 * Locating them any other way would reintroduce the second transcription this
 * file exists to avoid.
 */
const SHARED_HELPERS: Splice[] = [
  {
    name: "ask-rule-reason",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: 'rule.ruleBehavior==="ask")return!0',
    fn: "isAskRuleDrivenReason",
    captures: [],
    coverage: [],
  },
  {
    // Forty-five call sites and every one of them discards the sentence, so it
    // is owned in `shared/` rather than spliced. The oracle grades it exactly as
    // it grades a spliced row — same anchor, same excision, same comparison —
    // because the reason it is not a row says nothing about whether it is right.
    name: "permission-message",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "blocked this action:",
    fn: "permissionMessage",
    captures: [
      { as: "renderRuleValue", kind: "effectful-port", derive: (b) => must(b, /let ([\w$]+)=([\w$]+)\([\w$]+\.rule\.ruleValue\)/, 2, "renderRuleValue") },
      { as: "renderRuleSource", kind: "effectful-port", derive: (b) => must(b, /,([\w$]+)=([\w$]+)\([\w$]+\.rule\.source\)/, 2, "renderRuleSource") },
      {
        as: "splitRedirections",
        kind: "effectful-port",
        derive: (b) => must(b, /\{commandWithoutRedirections:[\w$]+,redirections:[\w$]+\}=([\w$]+)\(/, 1, "splitRedirections"),
      },
      { as: "pluralize", kind: "pure-helper", owned: true, derive: (b) => must(b, /\$\{([\w$]+)\([\w$]+,"part"\)\}/, 1, "pluralize") },
      { as: "modeTitle", kind: "effectful-port", derive: (b) => must(b, /Current permission mode \(\$\{([\w$]+)\(/, 1, "modeTitle") },
    ],
    coverage: [],
  },
  {
    // Sixty-two bytes on the allow arm of every tool call in every mode, and
    // still not a row: §3.3 pins the streak gate off, so upstream answers
    // `false` on every graded run and the maximal twin is invisible. Graded here
    // exactly as a spliced row is.
    name: "classifier-streak",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "requestDialog!==void 0",
    coLiteral: "blocked this action:",
    siblings: 3,
    fn: "classifierOnlyStreakActive",
    captures: [
      {
        as: "streakGateEnabled",
        kind: "effectful-port",
        derive: (b) => must(b, /return ([\w$]+)\(\)&&[\w$]+\.requestDialog/, 1, "streakGateEnabled"),
      },
      {
        as: "sdkDialogHostActive",
        kind: "effectful-port",
        derive: (b) => must(b, /requestDialog!==void 0&&!([\w$]+)\(\)/, 1, "sdkDialogHostActive"),
      },
    ],
    coverage: [],
  },
  {
    name: "safety-check-reason",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: 'type==="safetyCheck")return ',
    fn: "findSafetyCheckReason",
    captures: [],
    coverage: [],
  },
];

/** One regex, one group, one loud failure — the shared-helper rows' own `derive`. */
function must(body: string, re: RegExp, group: number, as: string): string {
  const m = body.match(re);
  if (!m || m[group] === undefined) throw new Error(`shared helper: could not derive '${as}' — ${re}`);
  return m[group];
}

const splice = (name: string): Splice => {
  const sp = SPLICES.find((s) => s.name === name) ?? SHARED_HELPERS.find((s) => s.name === name);
  if (!sp) throw new Error(`no manifest row named ${name}`);
  return sp;
};

interface Extracted {
  /** the excised declaration, verbatim */
  source: string;
  /** the minified name the declaration binds */
  label: string;
  /** manifest `as` -> the identifier the body actually uses */
  binding: Map<string, string>;
  /** manifest order, non-owned only — the delegation's argument order */
  forwarded: string[];
}

const extracted = new Map<string, Extracted>();
function extract(name: string): Extracted {
  const cached = extracted.get(name);
  if (cached) return cached;
  const sp = splice(name);
  const { path, source, offsets } = resolveAnchor(BUNDLE, sp, (p) => basename(p));
  const sf = chunkAst(path, source);
  const cut = selectExcision(sp.name, sf, offsets, sp.target, sp.signature);
  assertSignature(sp.name, cut, sp.signature);
  const captures = deriveCaptures(sp, cut.original);
  const binding = new Map<string, string>();
  for (const c of captures) {
    if (c.identifier.includes(".")) throw new Error(`${name}: capture '${c.as}' is a member expression (${c.identifier}); this oracle binds identifiers`);
    binding.set(c.as, c.identifier);
  }
  const out: Extracted = {
    // An ARROW-INITIALIZER's excision is the initializer EXPRESSION, not a
    // declaration — `async(…)=>{…}` with no `kye=` in front of it, because that
    // is exactly the span the build replaces. Evaluating it needs the binding put
    // back; every other shape's excision is already a declaration that names
    // itself.
    source: sp.target === "arrow-initializer" || sp.target === "variable-declarator" ? `const ${cut.label} = ${cut.original};` : cut.original,
    label: cut.label,
    binding,
    forwarded: captures.filter((c) => !c.owned).map((c) => c.as),
  };
  extracted.set(name, out);
  return out;
}

/**
 * Upstream's body, rebuilt with THIS case's ports lexically bound.
 *
 * Rebuilt per case rather than bound through a mutable holder, deliberately: a
 * holder makes every case share one set of stubs, and the port TRACE — which is
 * half of what this file grades — would accumulate across cases.
 */
function upstream(name: string, ports: Record<string, unknown>): (...args: unknown[]) => unknown {
  const ex = extract(name);
  const scope: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const [as, identifier] of ex.binding) {
    scope[identifier] = ports[as];
    lines.push(`const ${identifier} = __scope[${JSON.stringify(identifier)}];`);
  }
  // eslint-disable-next-line no-eval
  const make = eval(`(__scope) => { ${lines.join("\n")}\n${ex.source}\nreturn ${ex.label}; }`) as (s: Record<string, unknown>) => (...a: unknown[]) => unknown;
  return make(scope);
}

/**
 * The owned side. A spliced row is driven through its ADAPTER — so the argument
 * list is the one the build's delegation synthesises, primitives and their
 * equality assertions included — and an owned-but-unspliced helper is called
 * directly, because it has no adapter to drive.
 */
const SHARED_ENTRY: Record<string, (...a: unknown[]) => unknown> = {
  "permission-message": permissionMessage as (...a: unknown[]) => unknown,
  "classifier-streak": classifierOnlyStreakActive as (...a: unknown[]) => unknown,
};

function owned(name: string, params: unknown[], ports: Record<string, unknown>): unknown {
  const ex = extract(name);
  const fn = SHARED_ENTRY[name] ?? reforge[splice(name).fn];
  return fn(...params, ...ex.forwarded.map((as) => ports[as]));
}

/**
 * Run both sides on the same case and compare the RESULT and the port TRACE.
 *
 * The parameters may be a FACTORY as well as a list, because several of these
 * bodies are handed a context object carrying callbacks of its own (a session
 * permission-context setter, a state updater, an abort signal). Those are probes
 * too, and a shared one would put both sides' calls into one trace.
 */
async function both(
  name: string,
  label: string,
  params: unknown[] | ((trace: string[]) => unknown[]),
  makePorts: (trace: string[]) => Record<string, unknown>,
): Promise<{ up: unknown; own: unknown }> {
  const upTrace: string[] = [];
  const ownTrace: string[] = [];
  const paramsOf = (trace: string[]) => (typeof params === "function" ? params(trace) : params);
  const up = await settle(() => upstream(name, makePorts(upTrace))(...paramsOf(upTrace)));
  const own = await settle(() => owned(name, paramsOf(ownTrace), makePorts(ownTrace)));
  eq(`${name} :: ${label}`, up, own);
  eq(`${name} :: ${label} [port trace]`, upTrace, ownTrace);
  return { up, own };
}

/** Await a call, turning a throw into a comparable value so both sides can be graded on it. */
async function settle(call: () => unknown): Promise<unknown> {
  try {
    return { returned: await call() };
  } catch (e) {
    return { threw: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
  }
}

console.log(`permission-subsystem parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ============================================================================
// 0. THE FIXTURE'S AXES ARE THIS FILE'S POPULATION.
//    Not a decoration: the mode matrix below iterates the fixture's own
//    enumeration, so a mode added upstream widens this file automatically
//    instead of leaving a hole nobody wrote a case for.
// ============================================================================
const SURFACE = readFixture();
const MODES = SURFACE.modes.names;
const RULE_BEHAVIORS = SURFACE.ruleBehaviors.names;
const REASON_KINDS = SURFACE.decisionReasons.rendered;
console.log(`  axes from research/fixtures/permission-surface-${ENGINE_VERSION}.json: ${MODES.length} modes, ${RULE_BEHAVIORS.length} rule behaviors, ${REASON_KINDS.length} decisionReason kinds`);

// ============================================================================
// 1. THE OWNED PURE HELPERS, graded against their own upstream bytes FIRST.
//    Every body below is bound to the UPSTREAM copies, never to these — a body
//    bound to the implementation it is grading cannot fail (C7).
// ============================================================================
const upstreamAskRule = upstream("ask-rule-reason", {}) as (r: unknown) => boolean;
const upstreamSafety = upstream("safety-check-reason", {}) as (r: unknown, f?: (c: unknown) => boolean) => unknown;
const upstreamPluralize = (() => {
  // `k` lives in its own chunk and is not a splice row, so it is extracted by
  // shape — the one hand-written extraction in this file, and the shape carries
  // the parameter DEFAULT, which is the half of its contract that is behaviour.
  const source = readFileSync(join(BUNDLE_MODULES, "chunk-04aem4bh.js"), "utf8");
  const m = source.match(/function ([\w$]+)\([\w$]+,([\w$]+),[\w$]+=\2\+"s"\)\{return [\w$]+===1\?\2:[\w$]+\}/);
  if (!m) throw new Error("the pluralizer's upstream shape is gone from chunk-04aem4bh");
  // eslint-disable-next-line no-eval
  return eval(`(() => { ${m[0]} return ${m[1]}; })()`) as (n: number, s: string, p?: string) => string;
})();

{
  const rule = (behavior: string, source = "userSettings") => ({ type: "rule", rule: { ruleBehavior: behavior, source, ruleValue: { toolName: "Bash" } } });
  const sub = (parts: [string, unknown][]) => ({ type: "subcommandResults", reasons: new Map(parts) });

  const reasons: [string, unknown][] = [
    ["undefined", undefined],
    ["null", null],
    ...RULE_BEHAVIORS.map((b) => [`a ${b} rule`, rule(b)] as [string, unknown]),
    ["a safetyCheck", { type: "safetyCheck", reason: "dangerous", classifierApprovable: false }],
    ["an approvable safetyCheck", { type: "safetyCheck", reason: "dangerous", classifierApprovable: true }],
    ["a mode reason", { type: "mode", mode: "plan" }],
    ["an empty subcommand map", sub([])],
    ["a subcommand asking on an ask rule", sub([["rm -rf", { behavior: "ask", decisionReason: rule("ask") }]])],
    ["a subcommand asking on an allow rule", sub([["rm -rf", { behavior: "ask", decisionReason: rule("allow") }]])],
    ["a subcommand with an ask rule but NOT asking", sub([["rm -rf", { behavior: "allow", decisionReason: rule("ask") }]])],
    ["a subcommand carrying a safetyCheck", sub([["curl x", { behavior: "ask", decisionReason: { type: "safetyCheck", reason: "net" } }]])],
    ["two subcommands, the second matching", sub([["a", { behavior: "allow" }], ["b", { behavior: "ask", decisionReason: rule("ask") }]])],
    [
      "a nested subcommand map",
      sub([["outer", { behavior: "ask", decisionReason: sub([["inner", { behavior: "ask", decisionReason: rule("ask") }]]) }]]),
    ],
    [
      "two safety checks, the FIRST wins",
      sub([
        ["a", { behavior: "ask", decisionReason: { type: "safetyCheck", reason: "first", classifierApprovable: false } }],
        ["b", { behavior: "ask", decisionReason: { type: "safetyCheck", reason: "second", classifierApprovable: false } }],
      ]),
    ],
  ];
  for (const [label, reason] of reasons) {
    eq(`isAskRuleDrivenReason(${label})`, upstreamAskRule(reason), isAskRuleDrivenReason(reason));
    eq(`findSafetyCheckReason(${label}, any)`, upstreamSafety(reason), findSafetyCheckReason(reason));
    const notApprovable = (c: { classifierApprovable?: boolean }) => c.classifierApprovable !== true;
    eq(`findSafetyCheckReason(${label}, not-classifier-approvable)`, upstreamSafety(reason, notApprovable as never), findSafetyCheckReason(reason, notApprovable as never));
    const never = () => false;
    eq(`findSafetyCheckReason(${label}, reject-all)`, upstreamSafety(reason, never), findSafetyCheckReason(reason, never));
  }
  mustDiffer("the ask-rule predicate accepting an ALLOW rule", upstreamAskRule(rule("allow")), true);
  mustDiffer(
    "the ask-rule predicate ignoring the subcommand's own behavior",
    upstreamAskRule(sub([["rm -rf", { behavior: "allow", decisionReason: rule("ask") }]])),
    true,
  );
  mustDiffer("the safety finder returning a BOOLEAN rather than the reason", upstreamSafety(reasons[5][1]), true);
  mustDiffer(
    "the safety finder falling through to the subcommand walk when its filter rejects",
    upstreamSafety({ type: "safetyCheck", reason: "x" }, () => false),
    { type: "safetyCheck", reason: "x" },
  );
  mustDiffer(
    "the safety finder taking the LAST nested match rather than the first",
    upstreamSafety(reasons[reasons.length - 1][1]),
    { type: "safetyCheck", reason: "second", classifierApprovable: false },
  );

  for (const [n, singular, plural] of [
    [0, "part", undefined],
    [1, "part", undefined],
    [2, "part", undefined],
    [1, "requires", "require"],
    [2, "requires", "require"],
    [0, "requires", "require"],
    [-1, "part", undefined],
  ] as [number, string, string | undefined][]) {
    const label = `pluralize(${n}, ${JSON.stringify(singular)}${plural ? `, ${JSON.stringify(plural)}` : ""})`;
    eq(label, upstreamPluralize(n, singular, plural), pluralize(n, singular, plural));
  }
  mustDiffer("the pluralizer treating zero as singular", upstreamPluralize(0, "part"), "part");
  mustDiffer("the pluralizer ignoring its explicit plural", upstreamPluralize(2, "requires", "require"), "requiress");
}

// ============================================================================
// 2. THE MESSAGE BUILDER — the decisionReason AXIS, arm by arm.
//    Eleven kinds, and the fixture's own list is what this loop walks: a kind
//    added upstream widens the cross-product instead of leaving a hole.
// ============================================================================
{
  const ports = (trace: string[]) => ({
    renderRuleValue: (v: { toolName: string; ruleContent?: string }) => {
      trace.push(`renderRuleValue(${v.toolName})`);
      return v.ruleContent === undefined ? v.toolName : `${v.toolName}(${v.ruleContent})`;
    },
    renderRuleSource: (s: string) => {
      trace.push(`renderRuleSource(${s})`);
      return `the ${s} layer`;
    },
    splitRedirections: (command: string) => {
      trace.push(`splitRedirections(${command})`);
      const at = command.indexOf(">");
      return at < 0
        ? { commandWithoutRedirections: command, redirections: [] }
        : { commandWithoutRedirections: command.slice(0, at).trim(), redirections: [command.slice(at)] };
    },
    // OWNED: bound to UPSTREAM's copy so a shared defect cannot compare equal.
    pluralize: upstreamPluralize,
    modeTitle: (mode: string) => {
      trace.push(`modeTitle(${mode})`);
      return `${mode} mode`;
    },
  });

  const sub = (parts: [string, unknown][]) => ({ type: "subcommandResults", reasons: new Map(parts) });
  const cases: [string, unknown][] = [
    ["no reason at all", undefined],
    ["a classifier reason", { type: "classifier", classifier: "auto-mode", reason: "looks destructive" }],
    ["a hook reason WITH a reason", { type: "hook", hookName: "PreToolUse", reason: "policy says no" }],
    ["a hook reason WITHOUT a reason", { type: "hook", hookName: "PreToolUse" }],
    ["a rule reason with content", { type: "rule", rule: { source: "projectSettings", ruleValue: { toolName: "Bash", ruleContent: "rm:*" } } }],
    ["a rule reason without content", { type: "rule", rule: { source: "cliArg", ruleValue: { toolName: "Write" } } }],
    ["an empty subcommand map", sub([])],
    ["subcommands where none ask", sub([["a", { behavior: "allow" }], ["b", { behavior: "deny" }]])],
    ["one asking subcommand", sub([["rm -rf /", { behavior: "ask" }]])],
    ["one passthrough subcommand", sub([["rm -rf /", { behavior: "passthrough" }]])],
    ["two asking subcommands", sub([["a b", { behavior: "ask" }], ["c d", { behavior: "passthrough" }]])],
    ["a subcommand WITH a redirection", sub([["cat x > out.txt", { behavior: "ask" }]])],
    ["a mix of redirected and not", sub([["cat x > out.txt", { behavior: "ask" }], ["ls", { behavior: "ask" }]])],
    ["a permissionPromptTool reason", { type: "permissionPromptTool", permissionPromptToolName: "stdio", toolResult: { behavior: "deny" } }],
    ["a sandboxOverride reason", { type: "sandboxOverride" }],
    ["a workingDir reason", { type: "workingDir", reason: "outside the allowed directories" }],
    ["a safetyCheck reason", { type: "safetyCheck", reason: "this looks dangerous" }],
    ["an other reason", { type: "other", reason: "requiresUserInteraction" }],
    ["a mode reason", { type: "mode", mode: "plan" }],
    ["an asyncAgent reason", { type: "asyncAgent", reason: "no prompt available" }],
    ["a reason kind that does not exist", { type: "reforge-unknown-kind", reason: "x" }],
  ];
  // The fixture's enumeration is the completeness check on the list above: every
  // kind upstream's own switch renders must appear in at least one case.
  const covered = new Set(cases.map(([, r]) => (r as { type?: string } | undefined)?.type).filter(Boolean));
  for (const kind of REASON_KINDS) {
    checks++;
    if (!covered.has(kind)) failures.push(`the message-builder cross-product has no case for the '${kind}' reason, which upstream's own switch renders`);
  }

  for (const tool of ["Bash", "Write", "mcp__server__tool"]) {
    for (const [label, reason] of cases) {
      await both("permission-message", `${tool} / ${label}`, [tool, reason], ports);
    }
  }

  const bashSub = sub([["cat x > out.txt", { behavior: "ask" }], ["ls", { behavior: "ask" }]]);
  const upTrace: string[] = [];
  const up = upstream("permission-message", ports(upTrace)) as (t: string, r: unknown) => string;
  mustDiffer("the classifier arm folded into the switch (it is checked BEFORE it)", up("Bash", cases[1][1]), "Claude requested permissions to use Bash, but you haven't granted it yet.");
  mustDiffer("the hook arm ignoring whether the hook gave a reason", up("Bash", cases[3][1]), "Hook 'PreToolUse' blocked this action: undefined");
  mustDiffer("the subcommand arm keeping the redirection", up("Bash", bashSub), "This Bash command contains multiple operations. The following 2 parts require approval: cat x > out.txt, ls");
  mustDiffer("the subcommand arm stripping redirections for a NON-Bash tool", up("Write", bashSub), "This Write command contains multiple operations. The following 2 parts require approval: cat x, ls");
  mustDiffer("the two pluralizations sharing one plural", up("Bash", sub([["a", { behavior: "ask" }]])), "This Bash command contains multiple operations. The following 1 part requires approval: a".replace("requires", "requiress"));
  mustDiffer("an unknown reason kind returning something other than the fallback", up("Bash", cases[cases.length - 1][1]), "");
}

// ============================================================================
// 3. THE CLASSIFIER-STREAK PREDICATE — three terms, and the ORDER is what is
//    graded: the gate is pinned false on this corpus, so the two ports after it
//    are never called and only the trace can see that.
// ============================================================================
{
  for (const gate of [true, false]) {
    for (const dialog of [true, false]) {
      for (const host of [true, false]) {
        const ports = (trace: string[]) => ({
          streakGateEnabled: () => {
            trace.push("streakGateEnabled");
            return gate;
          },
          sdkDialogHostActive: () => {
            trace.push("sdkDialogHostActive");
            return host;
          },
        });
        await both(
          "classifier-streak",
          `gate=${gate} dialog=${dialog} sdkHost=${host}`,
          [{ requestDialog: dialog ? () => undefined : undefined }],
          ports,
        );
      }
    }
  }
  const trace: string[] = [];
  const up = upstream("classifier-streak", {
    streakGateEnabled: () => {
      trace.push("streakGateEnabled");
      return false;
    },
    sdkDialogHostActive: () => {
      trace.push("sdkDialogHostActive");
      return false;
    },
  }) as (c: unknown) => boolean;
  up({ requestDialog: () => undefined });
  mustDiffer("the conjunction evaluating all three terms rather than short-circuiting", trace, ["streakGateEnabled", "sdkDialogHostActive"]);
  mustDiffer(
    "a truthiness test on requestDialog rather than an existence test",
    upstream("classifier-streak", { streakGateEnabled: () => true, sdkDialogHostActive: () => false })({ requestDialog: 0 as never }),
    false,
  );
}

// ============================================================================
// 4. THE CONTROL-RESPONSE ENVELOPES — zero free variables, and the nesting IS
//    the protocol: the SDK matches a response to its request by `request_id` and
//    by nothing else, so a mis-nested envelope hangs rather than errors.
// ============================================================================
{
  const payloads: [string, unknown][] = [
    ["an empty object", {}],
    ["a capabilities payload", { commands: ["a", "b"], modes: MODES }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "ok"],
    ["a nested object", { a: { b: [1, 2] } }],
  ];
  for (const [label, payload] of payloads) {
    await both("control-response-success", label, ["req-1", payload], () => ({}));
    await both("control-response-error", label, ["req-1", String(payload)], () => ({}));
  }
  // The guard's own refusals, carried out through the error envelope — this is
  // the only path a mode-change refusal reaches an SDK host by.
  for (const guarded of SURFACE.modeGuards.guarded) {
    for (const refusal of guarded.refusals) {
      await both("control-response-error", `${guarded.mode} refusal: ${refusal.slice(0, 40)}`, ["req-2", refusal], () => ({}));
    }
  }
  const up = upstream("control-response-success", {}) as (id: string, r: unknown) => unknown;
  mustDiffer("the request_id at the TOP level rather than inside the response", up("req-1", { ok: true }), {
    type: "control_response",
    request_id: "req-1",
    response: { subtype: "success", response: { ok: true } },
  });
  mustDiffer("the payload spread into the response rather than nested under it", up("req-1", { ok: true }), {
    type: "control_response",
    response: { subtype: "success", request_id: "req-1", ok: true },
  });
  const upErr = upstream("control-response-error", {}) as (id: string, e: string) => unknown;
  mustDiffer("the error envelope reusing the success subtype", upErr("req-1", "no"), {
    type: "control_response",
    response: { subtype: "success", request_id: "req-1", error: "no" },
  });
}

// ============================================================================
// 5. THE MODE-CHANGE GUARD — the mode axis, walked from the fixture.
//    Six modes x four context shapes x the auto gate, plus the modes upstream
//    accepts that the enumeration does not contain (the `manual` alias) and one
//    it rejects.
// ============================================================================
{
  const contexts: [string, unknown][] = [
    ["an ordinary session", { restricted: false, isBypassPermissionsModeAvailable: false }],
    ["a session launched with the bypass flag", { restricted: false, isBypassPermissionsModeAvailable: true }],
    ["a restricted session", { restricted: true, isBypassPermissionsModeAvailable: true }],
    ["a restricted session without the flag", { restricted: true, isBypassPermissionsModeAvailable: false }],
  ];
  for (const requested of [...MODES, "manual", "reforge-not-a-mode", "", "DEFAULT"]) {
    for (const [ctxLabel, context] of contexts) {
      for (const gate of [true, false]) {
        for (const disabled of [true, false]) {
          for (const reason of [undefined, "the org disabled it"]) {
            const ports = (trace: string[]) => ({
              parsePermissionMode: (m: string) => {
                trace.push(`parsePermissionMode(${m})`);
                const normalized = m === "manual" ? "default" : m;
                return MODES.includes(normalized) ? normalized : undefined;
              },
              unrecognizedModeError: `Cannot set permission mode: must be one of ${[...MODES].sort().join(", ")}`,
              restrictedBypassError: "bypassPermissions not supported in restricted mode",
              bypassDisabled: () => {
                trace.push("bypassDisabled");
                return disabled;
              },
              autoModeGateEnabled: () => {
                trace.push("autoModeGateEnabled");
                return gate;
              },
              autoModeUnavailableReason: () => {
                trace.push("autoModeUnavailableReason");
                return reason;
              },
              autoModeUnavailableNotification: (r: string) => {
                trace.push(`autoModeUnavailableNotification(${r})`);
                return `because ${r}`;
              },
            });
            await both("mode-change-guard", `${requested} / ${ctxLabel} / gate=${gate} disabled=${disabled} reason=${reason !== undefined}`, [requested, context], ports);
          }
        }
      }
    }
  }
  const flat = (trace: string[]) => ({
    parsePermissionMode: (m: string) => (MODES.includes(m) ? m : undefined),
    unrecognizedModeError: "UNRECOGNIZED",
    restrictedBypassError: "RESTRICTED",
    bypassDisabled: () => {
      trace.push("bypassDisabled");
      return false;
    },
    autoModeGateEnabled: () => false,
    autoModeUnavailableReason: () => undefined,
    autoModeUnavailableNotification: (r: string) => r,
  });
  const t: string[] = [];
  const up = upstream("mode-change-guard", flat(t)) as (m: string, c: unknown) => unknown;
  mustDiffer("the guard echoing the CALLER's string rather than the parsed mode", up("default", { restricted: false }), { ok: true, mode: "manual" });
  mustDiffer("the restricted check running after the disabled one", up("bypassPermissions", { restricted: true, isBypassPermissionsModeAvailable: true }), {
    ok: false,
    error: "Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration",
  });
  mustDiffer("a mode outside the enumeration accepted", up("reforge-not-a-mode", { restricted: false }), { ok: true, mode: "reforge-not-a-mode" });
}

// ============================================================================
// 6. THE MODE TRANSITION — every ordered pair of modes, which is thirty cases a
//    scenario would need thirty recordings for. The gate is a port here, so the
//    auto arms are reachable; under §3.3's pinned defaults they are not
//    reachable by any recording this project can make.
// ============================================================================
{
  for (const from of MODES) {
    for (const to of MODES) {
      for (const gate of [true, false]) {
        for (const autoActive of [true, false]) {
          for (const prePlan of [undefined, "default"]) {
            const ports = (trace: string[]) => {
              const rec = (name: string, value?: unknown) => {
                trace.push(value === undefined ? name : `${name}(${JSON.stringify(value)})`);
              };
              return {
                setProvisionalStartupMode: (v: unknown) => rec("setProvisionalStartupMode", v ?? null),
                recordModeChange: (v: unknown) => rec("recordModeChange", v),
                handlePlanModeTransition: (a: string, b: string) => rec("handlePlanModeTransition", [a, b]),
                handleAutoModeTransition: (a: string, b: string) => rec("handleAutoModeTransition", [a, b]),
                setHasExitedPlanMode: (v: boolean) => rec("setHasExitedPlanMode", v),
                prepareContextForPlanMode: (c: Record<string, unknown>) => {
                  rec("prepareContextForPlanMode");
                  return { ...c, planned: true };
                },
                isAutoModeActive: () => {
                  rec("isAutoModeActive");
                  return autoActive;
                },
                isAutoModeGateEnabled: () => {
                  rec("isAutoModeGateEnabled");
                  return gate;
                },
                setAutoModeActive: (v: boolean) => rec("setAutoModeActive", v),
                setNeedsAutoModeExitAttachment: (v: boolean) => rec("setNeedsAutoModeExitAttachment", v),
                stripDangerousPermissionsForAutoMode: (c: Record<string, unknown>) => {
                  rec("stripDangerousPermissionsForAutoMode");
                  return { ...c, stripped: true };
                },
                restoreDangerousPermissions: (c: Record<string, unknown>) => {
                  rec("restoreDangerousPermissions");
                  return { ...c, restored: true };
                },
              };
            };
            const context = { mode: from, alwaysAllowRules: [], ...(prePlan === undefined ? {} : { prePlanMode: prePlan }) };
            await both("mode-transition", `${from} -> ${to} gate=${gate} autoActive=${autoActive} prePlan=${prePlan ?? "none"}`, [from, to, context, "user"], ports);
          }
        }
      }
    }
  }
  const inert = () => ({
    setProvisionalStartupMode: () => undefined,
    recordModeChange: () => undefined,
    handlePlanModeTransition: () => undefined,
    handleAutoModeTransition: () => undefined,
    setHasExitedPlanMode: () => undefined,
    prepareContextForPlanMode: (c: Record<string, unknown>) => ({ ...c, planned: true }),
    isAutoModeActive: () => true,
    isAutoModeGateEnabled: () => false,
    setAutoModeActive: () => undefined,
    setNeedsAutoModeExitAttachment: () => undefined,
    stripDangerousPermissionsForAutoMode: (c: Record<string, unknown>) => ({ ...c, stripped: true }),
    restoreDangerousPermissions: (c: Record<string, unknown>) => ({ ...c, restored: true }),
  });
  const up = upstream("mode-transition", inert()) as (a: string, b: string, c: unknown, t: string) => unknown;
  mustDiffer("entering plan mode WITHOUT returning early", up("default", "plan", { mode: "default" }, "user"), { mode: "default", planned: true, restored: true });
  mustDiffer("plan treated as auto-like unconditionally", up("plan", "default", { mode: "plan", prePlanMode: "x" }, "user"), { mode: "plan" });
  mustDiffer("the pre-plan state cleared on a transition that does not leave plan", up("default", "acceptEdits", { mode: "default", prePlanMode: "x" }, "user"), {
    mode: "default",
  });
  mustDiffer("a same-mode transition still running its side effects", up("plan", "plan", { mode: "plan" }, "user"), { mode: "plan", planned: true });
}

// ============================================================================
// 8. THE DECISION BODIES. From here on the subjects take a TOOL and a permission
//    CONTEXT, so both are stubbed — and both are probes: a tool's schema parse,
//    its own permission check and its interaction predicate are all ports in
//    everything but name, and which of them ran is as much of the contract as
//    what came back.
// ============================================================================

/** A tool stub. Every method records, so "which of the tool's own hooks ran" is graded. */
function stubTool(trace: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Bash",
    inputSchema: {
      parse: (input: unknown) => {
        trace.push("inputSchema.parse");
        return { ...(input as Record<string, unknown>), parsed: true };
      },
    },
    checkPermissions: async (input: unknown) => {
      trace.push(`checkPermissions(${JSON.stringify(input)})`);
      return { behavior: "passthrough", message: "tool passthrough" };
    },
    isReadOnly: () => {
      trace.push("isReadOnly");
      return false;
    },
    ...over,
  };
}

/** A permission context stub. The session setter records rather than mutating. */
function stubContext(trace: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    abortController: { signal: { aborted: false }, abort: () => trace.push("abort") },
    forRemoteExecution: false,
    storageV5: { id: "storage" },
    getAppState: () => ({ denialTracking: undefined }),
    setSessionToolPermissionContext: (update: (p: unknown) => unknown) => {
      trace.push(`setSessionToolPermissionContext -> ${JSON.stringify(update({ existing: true }))}`);
    },
    ...over,
  };
}

const RULE = (behavior: string, source = "projectSettings", ruleContent?: string) => ({
  ruleBehavior: behavior,
  source,
  ruleValue: { toolName: "Bash", ...(ruleContent === undefined ? {} : { ruleContent }) },
});

// ---- 8a. the allow-rule decision --------------------------------------------
{
  const CRASH = "permission_check_crashed";
  const answers: [string, unknown][] = [
    ["the tool DENIES", { behavior: "deny", message: "tool says no", decisionReason: { type: "safetyCheck", reason: "x" } }],
    ["the tool ASKS with suggestions", { behavior: "ask", message: "tool asks", suggestions: [{ type: "addRules" }], decisionReason: { type: "other", reason: "r" } }],
    ["the tool ASKS without suggestions", { behavior: "ask", message: "tool asks", decisionReason: { type: "other", reason: "r" } }],
    ["the tool ALLOWS", { behavior: "allow", updatedInput: { command: "rewritten" } }],
    ["the tool PASSES THROUGH", { behavior: "passthrough", message: "no opinion" }],
    ["the tool answers undefined", undefined],
  ];
  const throwers: [string, unknown][] = [
    ["the classifier recognises it as a DENY", { behavior: "deny", message: "classified deny" }],
    ["the classifier recognises it as an ASK", { behavior: "ask", message: "classified ask" }],
    ["the classifier does not recognise it", undefined],
  ];

  for (const [label, answer] of answers) {
    for (const crashIsObjection of [true, false, undefined]) {
      await both(
        "allow-rule-decision",
        `${label} / crashIsObjection=${crashIsObjection}`,
        (trace) => [
          stubTool(trace, { checkPermissions: async () => (trace.push("checkPermissions"), answer) }),
          { command: "mkdir x" },
          stubContext(trace),
          RULE("allow"),
          crashIsObjection === undefined ? undefined : { crashIsObjection },
        ],
        (trace) => ({
          permissionMessage: (tool: string, reason?: unknown) => {
            trace.push(`permissionMessage(${tool},${JSON.stringify(reason) ?? "-"})`);
            return `message for ${tool}`;
          },
          classifyToolError: () => {
            trace.push("classifyToolError");
            return undefined;
          },
          crashReason: CRASH,
        }),
      );
    }
  }
  for (const [label, classified] of throwers) {
    for (const crashIsObjection of [true, false]) {
      for (const where of ["inputSchema.parse", "checkPermissions"]) {
        await both(
          "allow-rule-decision",
          `it throws in ${where}, ${label} / crashIsObjection=${crashIsObjection}`,
          (trace) => [
            stubTool(trace, {
              inputSchema: {
                parse: (i: unknown) => {
                  trace.push("inputSchema.parse");
                  if (where === "inputSchema.parse") throw new Error("bad input");
                  return i;
                },
              },
              checkPermissions: async () => {
                trace.push("checkPermissions");
                if (where === "checkPermissions") throw new Error("tool blew up");
                return { behavior: "passthrough", message: "x" };
              },
            }),
            { command: "mkdir x" },
            stubContext(trace),
            RULE("allow"),
            { crashIsObjection },
          ],
          (trace) => ({
            permissionMessage: (tool: string, reason?: unknown) => {
              trace.push(`permissionMessage(${tool},${JSON.stringify(reason) ?? "-"})`);
              return `message for ${tool}`;
            },
            classifyToolError: (error: unknown) => {
              trace.push(`classifyToolError(${(error as Error).message})`);
              return classified;
            },
            crashReason: CRASH,
          }),
        );
      }
    }
  }

  const t: string[] = [];
  const up = upstream("allow-rule-decision", {
    permissionMessage: () => "message",
    classifyToolError: () => undefined,
    crashReason: CRASH,
  }) as (...a: unknown[]) => Promise<unknown>;
  const askingTool = stubTool(t, { checkPermissions: async () => ({ behavior: "ask", message: "m", suggestions: [{ type: "addRules" }], decisionReason: { type: "other", reason: "r" } }) });
  const matched = RULE("allow");
  mustDiffer("the ask arm KEEPING the tool's suggestions", await up(askingTool, {}, stubContext(t), matched, undefined), {
    behavior: "ask",
    message: "m",
    suggestions: [{ type: "addRules" }],
    decisionReason: { type: "other", reason: "r" },
    matchedAskRule: matched,
  });
  const denyingTool = stubTool(t, { checkPermissions: async () => ({ behavior: "deny", message: "no" }) });
  mustDiffer("an allow rule OVERRULING the tool's own deny", await up(denyingTool, {}, stubContext(t), matched, undefined), {
    behavior: "ask",
    decisionReason: { type: "rule", rule: matched },
    message: "message",
  });
  const crashingTool = stubTool(t, { checkPermissions: async () => { throw new Error("boom"); } });
  mustDiffer("the crash arm firing WITHOUT the caller opting in", await up(crashingTool, {}, stubContext(t), matched, undefined), {
    behavior: "ask",
    message: "message",
    decisionReason: { type: "other", reason: CRASH },
  });
}

// ---- 8b. the rule checker — every rung, and the `null` it answers with -------
// The `null` is what a corpus can never separate from "never called", and it is
// this function's whole contract: every caller reads it as "no rule-based
// opinion" and carries on.
{
  interface RungSpec {
    label: string;
    toolDeny?: unknown;
    inputDeny?: unknown;
    allowRule?: unknown;
    askRule?: unknown;
    answer?: unknown;
    throws?: string;
    classified?: unknown;
    options?: unknown;
    tool?: Record<string, unknown>;
    sandboxable?: boolean;
    sandboxConfirmed?: boolean;
    interactionSatisfied?: boolean;
  }
  const rungs: RungSpec[] = [
    { label: "nothing objects — the null answer" },
    { label: "a tool DENY rule", toolDeny: RULE("deny") },
    { label: "an input DENY rule", inputDeny: RULE("deny", "localSettings", "rm:*") },
    { label: "both deny rules — the tool one wins", toolDeny: RULE("deny"), inputDeny: RULE("deny", "localSettings", "rm:*") },
    { label: "an ALLOW rule", allowRule: RULE("allow") },
    { label: "an allow rule on an unconfirmed sandboxed Bash call", allowRule: RULE("allow"), sandboxable: true, sandboxConfirmed: false },
    { label: "an allow rule on a CONFIRMED sandboxed Bash call", allowRule: RULE("allow"), sandboxable: true, sandboxConfirmed: true },
    { label: "the tool denies", answer: { behavior: "deny", message: "tool no" } },
    { label: "an ASK rule with a passthrough tool", askRule: RULE("ask") },
    { label: "an ASK rule with an asking tool", askRule: RULE("ask"), answer: { behavior: "ask", message: "tool asks", decisionReason: { type: "other", reason: "r" } } },
    {
      label: "a tool that requires user interaction",
      tool: { requiresUserInteraction: () => true },
      interactionSatisfied: false,
    },
    {
      label: "…satisfied by a hook's rewritten input",
      tool: { requiresUserInteraction: () => true },
      interactionSatisfied: true,
      options: { hookUpdatedInput: { command: "safe" } },
    },
    {
      label: "…and the tool was already asking",
      tool: { requiresUserInteraction: () => true },
      interactionSatisfied: false,
      answer: { behavior: "ask", message: "tool asks", decisionReason: { type: "other", reason: "r" } },
    },
    { label: "a tool with NO interaction predicate at all", tool: { requiresUserInteraction: undefined } },
    {
      label: "an ask driven by the user's own ask rule",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "rule", rule: RULE("ask") } },
    },
    {
      label: "an MCP ask ceiling",
      tool: { mcpInfo: { effectiveMaxPermission: "ask" } },
    },
    {
      label: "an MCP ceiling that is not ask",
      tool: { mcpInfo: { effectiveMaxPermission: "allow" } },
    },
    {
      label: "an ask carrying a safety check",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "safetyCheck", reason: "dangerous" } },
    },
    {
      label: "an ask carrying a sandbox override",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "sandboxOverride" } },
    },
    {
      label: "an ask carrying neither — falls through to null",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "workingDir", reason: "outside" } },
    },
    { label: "the tool throws, the classifier says deny", throws: "boom", classified: { behavior: "deny", message: "classified" } },
    { label: "the tool throws, the classifier says nothing, crashIsObjection", throws: "boom", classified: undefined, options: { crashIsObjection: true } },
    { label: "the tool throws, the classifier says nothing, no opt-in", throws: "boom", classified: undefined },
  ];

  for (const spec of rungs) {
    await both(
      "rule-based-permissions",
      spec.label,
      (trace) => [
        stubTool(trace, {
          name: spec.sandboxable ? "Bash" : "Write",
          checkPermissions: async () => {
            trace.push("checkPermissions");
            if (spec.throws) throw new Error(spec.throws);
            return spec.answer ?? { behavior: "passthrough", message: "tool passthrough" };
          },
          ...spec.tool,
        }),
        { command: "mkdir x" },
        stubContext(trace),
        spec.options,
      ],
      (trace) => ({
        toolPermissionContext: (c: unknown) => {
          trace.push("toolPermissionContext");
          return { mode: "default", alwaysAllowRules: [] };
        },
        matchedToolDenyRule: () => {
          trace.push("matchedToolDenyRule");
          return spec.toolDeny;
        },
        matchedInputRule: (_p: unknown, _t: unknown, _i: unknown, behavior: string) => {
          trace.push(`matchedInputRule(${behavior})`);
          return behavior === "deny" ? spec.inputDeny : spec.askRule;
        },
        matchedToolAllowRule: () => {
          trace.push("matchedToolAllowRule");
          return spec.allowRule;
        },
        denyRuleMessage: (tool: string) => {
          trace.push(`denyRuleMessage(${tool})`);
          return `denied ${tool} by rule`;
        },
        permissionMessage: (tool: string, reason?: unknown) => {
          trace.push(`permissionMessage(${tool},${JSON.stringify(reason) ?? "-"})`);
          return `message for ${tool}`;
        },
        allowRuleDecision: async (_t: unknown, _i: unknown, _c: unknown, rule: unknown, options: unknown) => {
          trace.push(`allowRuleDecision(${JSON.stringify(rule)},${JSON.stringify(options) ?? "-"})`);
          return { behavior: "ask", message: "from the allow-rule decision", decisionReason: { type: "rule", rule } };
        },
        classifyToolError: (error: unknown) => {
          trace.push(`classifyToolError(${(error as Error).message})`);
          return spec.classified;
        },
        crashReason: "permission_check_crashed",
        bashToolName: "Bash",
        sandbox: {
          isSandboxingEnabled: () => {
            trace.push("sandbox.isSandboxingEnabled");
            return spec.sandboxable === true;
          },
          isAutoAllowBashIfSandboxedEnabled: () => {
            trace.push("sandbox.isAutoAllowBashIfSandboxedEnabled");
            return spec.sandboxable === true;
          },
        },
        bashAutoAllowable: () => {
          trace.push("bashAutoAllowable");
          return spec.sandboxable === true;
        },
        sandboxConfirmed: () => {
          trace.push("sandboxConfirmed");
          return spec.sandboxConfirmed === true;
        },
        interactionSatisfied: () => {
          trace.push("interactionSatisfied");
          return spec.interactionSatisfied === true;
        },
        organizationAskReason: "Your organization requires approval for this tool",
        // OWNED captures (§2.4): the owned side ships and uses its own copies,
        // so these bind UPSTREAM's only — C7's rule, and the whole reason
        // section 1 grades them on their own bytes first.
        isAskRuleDrivenReason: upstreamAskRule,
        findSafetyCheckReason: upstreamSafety,
      }),
    );
  }

  const flat = () => ({
    toolPermissionContext: () => ({ mode: "default" }),
    matchedToolDenyRule: () => undefined,
    matchedInputRule: () => undefined,
    matchedToolAllowRule: () => undefined,
    denyRuleMessage: () => "denied",
    permissionMessage: () => "message",
    allowRuleDecision: async () => ({ behavior: "ask" }),
    classifyToolError: () => undefined,
    crashReason: "permission_check_crashed",
    bashToolName: "Bash",
    sandbox: { isSandboxingEnabled: () => false, isAutoAllowBashIfSandboxedEnabled: () => false },
    bashAutoAllowable: () => false,
    sandboxConfirmed: () => false,
    interactionSatisfied: () => false,
    organizationAskReason: "Your organization requires approval for this tool",
    isAskRuleDrivenReason: upstreamAskRule,
    findSafetyCheckReason: upstreamSafety,
  });
  const t: string[] = [];
  const up = upstream("rule-based-permissions", flat()) as (...a: unknown[]) => Promise<unknown>;
  mustDiffer(
    "the null answer replaced by an allow — the misreading every caller would obey",
    await up(stubTool(t), {}, stubContext(t), undefined),
    { behavior: "allow" },
  );
  mustDiffer(
    "a passthrough tool answer returned instead of null",
    await up(stubTool(t), {}, stubContext(t), undefined),
    { behavior: "passthrough", message: "tool passthrough" },
  );
  mustDiffer(
    "the ask-rule arm returning a bare ask rather than annotating the tool's",
    await (upstream("rule-based-permissions", { ...flat(), matchedInputRule: (_p: unknown, _t: unknown, _i: unknown, b: string) => (b === "ask" ? RULE("ask") : undefined) }) as (...a: unknown[]) => Promise<unknown>)(
      stubTool(t, { checkPermissions: async () => ({ behavior: "ask", message: "tool asks", decisionReason: { type: "other", reason: "r" } }) }),
      {},
      stubContext(t),
      undefined,
    ),
    { behavior: "ask", decisionReason: { type: "rule", rule: RULE("ask") }, message: "message" },
  );
}

// ---- 8c. the pre-check — the ladder every headless tool call descends --------
// Twelve rungs plus the abort, and the two arms the corpus can never reach on
// its own: the bypass allow (which every recording takes and none can show the
// alternative of) and the whole-tool allow-rule arm with its three suppressions.
{
  interface Rung {
    label: string;
    aborted?: boolean;
    toolDeny?: unknown;
    inputDeny?: unknown;
    allowRule?: unknown;
    askRule?: unknown;
    answer?: unknown;
    throws?: string;
    classified?: unknown;
    tool?: Record<string, unknown>;
    mode?: string;
    bypassAvailable?: boolean;
    remote?: boolean;
    sandboxable?: boolean;
    sandboxConfirmed?: boolean;
    remotePolicy?: boolean;
    gate?: boolean;
    planReadOnly?: boolean;
    immune?: boolean;
    planFloor?: boolean;
    wholeTool?: unknown;
    chrome?: boolean;
    chromeFloor?: boolean;
    scopedAway?: boolean;
  }
  const rungs: Rung[] = [
    { label: "an aborted context", aborted: true },
    { label: "a tool DENY rule", toolDeny: RULE("deny") },
    { label: "an input DENY rule", inputDeny: RULE("deny", "localSettings", "rm:*") },
    { label: "an ALLOW rule", allowRule: RULE("allow") },
    { label: "an allow rule awaiting the sandbox", allowRule: RULE("allow"), sandboxable: true, sandboxConfirmed: false },
    { label: "an allow rule the sandbox confirmed", allowRule: RULE("allow"), sandboxable: true, sandboxConfirmed: true },
    {
      label: "an MCP-policy allow rule on a remote bypass session",
      allowRule: { ...RULE("allow"), source: "mcpServerPolicy" },
      remotePolicy: true,
      mode: "bypassPermissions",
      gate: true,
    },
    {
      label: "…the same rule with the exemption gate OFF",
      allowRule: { ...RULE("allow"), source: "mcpServerPolicy" },
      remotePolicy: true,
      mode: "bypassPermissions",
      gate: false,
    },
    { label: "the tool denies", answer: { behavior: "deny", message: "tool no" } },
    {
      label: "an MCP tool that is not read-only, in plan mode",
      tool: { mcpInfo: { serverName: "s" }, isReadOnly: () => false },
      mode: "plan",
      planReadOnly: false,
    },
    {
      label: "…the same call the plan-mode allowlist covers",
      tool: { mcpInfo: { serverName: "s" }, isReadOnly: () => false },
      mode: "plan",
      planReadOnly: true,
    },
    { label: "an ASK rule", askRule: RULE("ask") },
    { label: "a tool requiring user interaction", tool: { requiresUserInteraction: () => true } },
    { label: "an ask driven by the user's ask rule", answer: { behavior: "ask", message: "m", decisionReason: { type: "rule", rule: RULE("ask") } } },
    { label: "an MCP ask ceiling", tool: { mcpInfo: { effectiveMaxPermission: "ask" } } },
    {
      label: "a bypass-IMMUNE safety check under bypass",
      mode: "bypassPermissions",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "safetyCheck", reason: "dangerous" } },
      immune: true,
    },
    {
      label: "a NON-immune safety check under bypass — bypass wins",
      mode: "bypassPermissions",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "safetyCheck", reason: "dangerous" } },
      immune: false,
    },
    {
      label: "the same safety check OUTSIDE bypass — the floor holds",
      mode: "default",
      answer: { behavior: "ask", message: "m", decisionReason: { type: "safetyCheck", reason: "dangerous" } },
      immune: false,
    },
    { label: "a sandbox override outside bypass", answer: { behavior: "ask", message: "m", decisionReason: { type: "sandboxOverride" } } },
    { label: "a plan-mode floor outside bypass", answer: { behavior: "ask", message: "m", decisionReason: { type: "mode", mode: "plan" } }, planFloor: true },
    { label: "plain bypass, nothing objecting", mode: "bypassPermissions" },
    { label: "plan mode WITH bypass available", mode: "plan", bypassAvailable: true },
    { label: "plan mode with bypass available, on a REMOTE context", mode: "plan", bypassAvailable: true, remote: true },
    { label: "a whole-tool allow rule", wholeTool: RULE("allow") },
    { label: "…on a tool that ignores whole-tool grants", wholeTool: RULE("allow"), tool: { ignoresWholeToolAllowRule: () => true } },
    { label: "…on a chrome tool with the classifier applying", wholeTool: RULE("allow"), chrome: true },
    { label: "…on a chrome tool with only the floor enabled", wholeTool: RULE("allow"), chrome: true, chromeFloor: true },
    { label: "…scoped away from this input", wholeTool: RULE("allow"), scopedAway: true },
    { label: "nothing objects — a passthrough becomes an ask", answer: { behavior: "passthrough", message: "no opinion" } },
    {
      label: "…carrying suggestions, which are logged",
      answer: { behavior: "ask", message: "m", suggestions: [{ type: "addRules", rules: [] }] },
    },
    { label: "the tool throws, the classifier recognises it", throws: "boom", classified: { behavior: "deny", message: "classified" } },
    { label: "the tool throws, the classifier does not", throws: "boom", classified: undefined },
  ];

  for (const spec of rungs) {
    await both(
      "permission-precheck",
      spec.label,
      (trace) => [
        stubTool(trace, {
          name: spec.sandboxable ? "Bash" : "Write",
          checkPermissions: async () => {
            trace.push("checkPermissions");
            if (spec.throws) throw new Error(spec.throws);
            return spec.answer ?? { behavior: "passthrough", message: "tool passthrough" };
          },
          ...spec.tool,
        }),
        { command: "mkdir x" },
        stubContext(trace, {
          abortController: { signal: { aborted: spec.aborted === true }, abort: () => trace.push("abort") },
          forRemoteExecution: spec.remote === true,
        }),
        undefined,
      ],
      (trace) => ({
        AbortError: class ReforgeAbortError extends Error {
          constructor() {
            super("aborted");
            trace.push("new AbortError");
          }
        },
        toolPermissionContext: () => {
          trace.push("toolPermissionContext");
          return {
            mode: spec.mode ?? "default",
            isBypassPermissionsModeAvailable: spec.bypassAvailable === true,
            chromeClassifierFloorEnabled: spec.chromeFloor === true,
            alwaysAllowRules: [],
          };
        },
        matchedToolDenyRule: () => {
          trace.push("matchedToolDenyRule");
          return spec.toolDeny;
        },
        matchedInputRule: (_p: unknown, _t: unknown, _i: unknown, behavior: string) => {
          trace.push(`matchedInputRule(${behavior})`);
          return behavior === "deny" ? spec.inputDeny : spec.askRule;
        },
        matchedToolAllowRule: () => {
          trace.push("matchedToolAllowRule");
          return spec.allowRule;
        },
        denyRuleMessage: (tool: string) => {
          trace.push(`denyRuleMessage(${tool})`);
          return `denied ${tool} by rule`;
        },
        permissionMessage: (tool: string, reason?: unknown) => {
          trace.push(`permissionMessage(${tool},${JSON.stringify(reason) ?? "-"})`);
          return `message for ${tool}`;
        },
        allowRuleDecision: async (_t: unknown, _i: unknown, _c: unknown, rule: unknown, options: unknown) => {
          trace.push(`allowRuleDecision(${JSON.stringify(rule)},${JSON.stringify(options) ?? "-"})`);
          return { behavior: "ask", message: "from the allow-rule decision", decisionReason: { type: "rule", rule } };
        },
        classifyToolError: (error: unknown) => {
          trace.push(`classifyToolError(${(error as Error).message})`);
          return spec.classified;
        },
        bashToolName: "Bash",
        sandbox: {
          isSandboxingEnabled: () => {
            trace.push("sandbox.isSandboxingEnabled");
            return spec.sandboxable === true;
          },
          isAutoAllowBashIfSandboxedEnabled: () => {
            trace.push("sandbox.isAutoAllowBashIfSandboxedEnabled");
            return spec.sandboxable === true;
          },
        },
        bashAutoAllowable: () => {
          trace.push("bashAutoAllowable");
          return spec.sandboxable === true;
        },
        sandboxConfirmed: () => {
          trace.push("sandboxConfirmed");
          return spec.sandboxConfirmed === true;
        },
        env: { CLAUDE_CODE_REMOTE: spec.remotePolicy === true ? "1" : undefined },
        featureGate: (name: string, fallback: unknown) => {
          trace.push(`featureGate(${name},${JSON.stringify(fallback)})`);
          return spec.gate === true;
        },
        effectiveMode: () => {
          trace.push("effectiveMode");
          return spec.mode ?? "default";
        },
        isReadOnlyMcpInput: () => {
          trace.push("isReadOnlyMcpInput");
          return spec.planReadOnly === true;
        },
        toolIdentity: (tool: { name: string }) => {
          trace.push(`toolIdentity(${tool.name})`);
          return { name: tool.name };
        },
        organizationAskReason: "Your organization requires approval for this tool",
        bypassImmuneSafetyCheck: (reason: unknown) => {
          trace.push(`bypassImmuneSafetyCheck(${JSON.stringify(reason)})`);
          return spec.immune === true;
        },
        isPlanModeFloor: (reason: unknown) => {
          trace.push(`isPlanModeFloor(${JSON.stringify(reason)})`);
          return spec.planFloor === true;
        },
        resolvedInput: (decision: unknown, input: unknown) => {
          trace.push("resolvedInput");
          return (decision as { updatedInput?: unknown })?.updatedInput ?? input;
        },
        wholeToolAllowRule: () => {
          trace.push("wholeToolAllowRule");
          return spec.wholeTool;
        },
        isChromeTool: () => {
          trace.push("isChromeTool");
          return spec.chrome === true;
        },
        chromeClassifierApplies: () => {
          trace.push("chromeClassifierApplies");
          return spec.chrome === true && spec.chromeFloor !== true;
        },
        ruleScopedAway: () => {
          trace.push("ruleScopedAway");
          return spec.scopedAway === true;
        },
        log: (line: string) => {
          trace.push(`log(${line})`);
        },
        stringify: (v: unknown, r: unknown, i: unknown) => {
          trace.push("stringify");
          return JSON.stringify(v, r as never, i as never);
        },
        isAskRuleDrivenReason: upstreamAskRule,
        findSafetyCheckReason: upstreamSafety,
      }),
    );
  }

  const flat = (over: Record<string, unknown> = {}) => ({
    AbortError: class extends Error {},
    toolPermissionContext: () => ({ mode: "default", isBypassPermissionsModeAvailable: false, alwaysAllowRules: [] }),
    matchedToolDenyRule: () => undefined,
    matchedInputRule: () => undefined,
    matchedToolAllowRule: () => undefined,
    denyRuleMessage: () => "denied",
    permissionMessage: () => "message",
    allowRuleDecision: async () => ({ behavior: "ask" }),
    classifyToolError: () => undefined,
    bashToolName: "Bash",
    sandbox: { isSandboxingEnabled: () => false, isAutoAllowBashIfSandboxedEnabled: () => false },
    bashAutoAllowable: () => false,
    sandboxConfirmed: () => false,
    env: {},
    featureGate: () => false,
    effectiveMode: () => "default",
    isReadOnlyMcpInput: () => false,
    toolIdentity: (t: { name: string }) => ({ name: t.name }),
    organizationAskReason: "Your organization requires approval for this tool",
    bypassImmuneSafetyCheck: () => false,
    isPlanModeFloor: () => false,
    resolvedInput: (d: { updatedInput?: unknown }, i: unknown) => d?.updatedInput ?? i,
    wholeToolAllowRule: () => undefined,
    isChromeTool: () => false,
    chromeClassifierApplies: () => false,
    ruleScopedAway: () => false,
    log: () => undefined,
    stringify: JSON.stringify,
    isAskRuleDrivenReason: upstreamAskRule,
    findSafetyCheckReason: upstreamSafety,
    ...over,
  });
  const t: string[] = [];
  const bypass = upstream("permission-precheck", flat({ effectiveMode: () => "bypassPermissions", toolPermissionContext: () => ({ mode: "bypassPermissions", isBypassPermissionsModeAvailable: true, alwaysAllowRules: [] }) })) as (...a: unknown[]) => Promise<unknown>;
  // THE SPEC CORRECTION, as an executable claim: bypass does NOT short-circuit
  // the deny rules. If a future engine moved the bypass arm above them, this
  // control would stop differing and the mutant would be the real behaviour.
  mustDiffer(
    "bypassPermissions short-circuiting the deny rules — the campaign spec's claim, which upstream refutes",
    await (upstream(
      "permission-precheck",
      flat({
        effectiveMode: () => "bypassPermissions",
        toolPermissionContext: () => ({ mode: "bypassPermissions", isBypassPermissionsModeAvailable: true, alwaysAllowRules: [] }),
        matchedToolDenyRule: () => RULE("deny"),
      }),
    ) as (...a: unknown[]) => Promise<unknown>)(stubTool(t), {}, stubContext(t), undefined),
    { behavior: "allow", updatedInput: {}, decisionReason: { type: "mode", mode: "bypassPermissions" } },
  );
  mustDiffer("the bypass arm returning the RAW input rather than the tool's rewrite", await bypass(stubTool(t, { checkPermissions: async () => ({ behavior: "passthrough", updatedInput: { command: "rewritten" } }) }), { command: "raw" }, stubContext(t), undefined), {
    behavior: "allow",
    updatedInput: { command: "raw" },
    decisionReason: { type: "mode", mode: "bypassPermissions" },
  });
  mustDiffer(
    "the passthrough tail returning the passthrough rather than converting it to an ask",
    await (upstream("permission-precheck", flat()) as (...a: unknown[]) => Promise<unknown>)(stubTool(t), {}, stubContext(t), undefined),
    { behavior: "passthrough", message: "tool passthrough" },
  );
  mustDiffer(
    "the abort check dropped, so an aborted context still decides",
    // `settle` because the healthy answer here is a THROW, and comparing a throw
    // against a return is exactly what this control is for.
    await settle(() =>
      (upstream("permission-precheck", flat()) as (...a: unknown[]) => Promise<unknown>)(
        stubTool(t),
        {},
        stubContext(t, { abortController: { signal: { aborted: true } } }),
        undefined,
      ),
    ),
    { returned: { behavior: "ask", message: "message" } },
  );
}

// ---- 8d. the broker seam — the headless return leg ---------------------------
// Three modules, and between them they are everything that happens between an
// SDK host's `canUseTool` answer and the tool executor.
{
  const UPDATE = (destination: string) => ({ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow", destination });

  // --- the update filter, whose two refusals return `undefined` rather than []
  for (const remote of [true, false]) {
    for (const exempt of [true, false]) {
      for (const updates of [undefined, [], [UPDATE("session")], [UPDATE("session"), UPDATE("localSettings")]]) {
        for (const suppressesAll of [true, false, undefined, null]) {
          for (const suppressesRule of [true, false, undefined]) {
            for (const callerSuppress of [true, false]) {
              await both(
                "broker-permission-updates",
                `remote=${remote} exempt=${exempt} updates=${updates === undefined ? "none" : updates.length} all=${String(suppressesAll)} rule=${String(suppressesRule)} caller=${callerSuppress}`,
                (trace) => [
                  updates,
                  stubTool(trace, {
                    suppressesAllPermissionUpdates:
                      suppressesAll === undefined || suppressesAll === null
                        ? suppressesAll
                        : () => {
                            trace.push("suppressesAllPermissionUpdates");
                            return suppressesAll;
                          },
                    suppressesAlwaysAllowRule:
                      suppressesRule === undefined
                        ? undefined
                        : () => {
                            trace.push("suppressesAlwaysAllowRule");
                            return suppressesRule;
                          },
                  }),
                  { command: "mkdir x" },
                  stubContext(trace, { forRemoteExecution: remote }),
                  callerSuppress,
                ],
                (trace) => ({
                  isExemptContext: () => {
                    trace.push("isExemptContext");
                    return exempt;
                  },
                  withoutRemoteScope: (u: unknown[]) => {
                    trace.push("withoutRemoteScope");
                    return u.filter((x) => (x as { destination: string }).destination !== "localSettings");
                  },
                  stripWholeToolGrants: (u: unknown[]) => {
                    trace.push("stripWholeToolGrants");
                    return u.map((x) => ({ ...(x as object), stripped: true }));
                  },
                  toolPermissionContext: () => {
                    trace.push("toolPermissionContext");
                    return { mode: "default" };
                  },
                }),
              );
            }
          }
        }
      }
    }
  }
  const flatFilter = () => ({
    isExemptContext: () => false,
    withoutRemoteScope: (u: unknown[]) => u.filter((x) => (x as { destination: string }).destination !== "localSettings"),
    stripWholeToolGrants: (u: unknown[]) => u.map((x) => ({ ...(x as object), stripped: true })),
    toolPermissionContext: () => ({ mode: "default" }),
  });
  const ft: string[] = [];
  const upFilter = upstream("broker-permission-updates", flatFilter()) as (...a: unknown[]) => unknown;
  mustDiffer(
    "the exempt refusal returning an EMPTY LIST rather than undefined",
    (upstream("broker-permission-updates", { ...flatFilter(), isExemptContext: () => true }) as (...a: unknown[]) => unknown)([UPDATE("session")], stubTool(ft), {}, stubContext(ft), false),
    [],
  );
  mustDiffer(
    "the whole-tool strip applied without the tool or the caller asking for it",
    upFilter([UPDATE("session")], stubTool(ft), {}, stubContext(ft), false),
    [{ ...UPDATE("session"), stripped: true }],
  );
  mustDiffer(
    "the caller's own suppression flag ignored",
    upFilter([UPDATE("session")], stubTool(ft), {}, stubContext(ft), true),
    [UPDATE("session")],
  );

  // --- the response mapper
  const answers: [string, unknown][] = [
    ["an allow with no updates and no rewrite", { behavior: "allow" }],
    ["an allow with an EMPTY updatedInput", { behavior: "allow", updatedInput: {} }],
    ["an allow with a rewritten input", { behavior: "allow", updatedInput: { command: "rewritten" } }],
    ["an allow with session updates", { behavior: "allow", updatedPermissions: [UPDATE("session")] }],
    ["an allow with an EMPTY update list", { behavior: "allow", updatedPermissions: [] }],
    ["an allow with both", { behavior: "allow", updatedInput: { command: "rewritten" }, updatedPermissions: [UPDATE("localSettings")] }],
    ["a plain deny", { behavior: "deny", message: "host says no" }],
    ["a deny with interrupt", { behavior: "deny", message: "host says no", interrupt: true }],
    ["a deny with interrupt false", { behavior: "deny", message: "host says no", interrupt: false }],
    ["an answer with neither behavior", { behavior: "cancelled" }],
  ];
  for (const [label, answer] of answers) {
    for (const filtered of [true, false]) {
      await both(
        "broker-response-map",
        `${label} / filterKeeps=${filtered}`,
        (trace) => [answer, { name: "stdio-prompt" }, { command: "raw" }, stubContext(trace), stubTool(trace), false],
        (trace) => ({
          filterPermissionUpdates: (u: unknown[] | undefined) => {
            trace.push(`filterPermissionUpdates(${u === undefined ? "none" : u.length})`);
            return filtered ? u : undefined;
          },
          applySessionUpdates: (previous: unknown, u: unknown[]) => {
            trace.push(`applySessionUpdates(${u.length})`);
            return { ...(previous as object), applied: u.length };
          },
          persistUpdates: (u: unknown[]) => {
            trace.push(`persistUpdates(${u.length})`);
            return Promise.resolve();
          },
          lastKnownInput: (name: string, input: unknown) => {
            trace.push(`lastKnownInput(${name})`);
            return input;
          },
          logError: () => {
            trace.push("logError");
          },
          log: (line: string) => {
            trace.push(`log(${line})`);
          },
        }),
      );
    }
  }
  const flatMap = () => ({
    filterPermissionUpdates: (u: unknown[] | undefined) => u,
    applySessionUpdates: (p: unknown) => p,
    persistUpdates: () => Promise.resolve(),
    lastKnownInput: (_n: string, i: unknown) => i,
    logError: () => undefined,
    log: () => undefined,
  });
  const mt: string[] = [];
  const upMap = upstream("broker-response-map", flatMap()) as (...a: unknown[]) => unknown;
  mustDiffer(
    "an EMPTY updatedInput accepted instead of falling back to the engine's own",
    upMap({ behavior: "allow", updatedInput: {} }, { name: "p" }, { command: "raw" }, stubContext(mt), stubTool(mt), false),
    {
      behavior: "allow",
      updatedInput: {},
      decisionReason: { type: "permissionPromptTool", permissionPromptToolName: "p", toolResult: { behavior: "allow", updatedInput: {} } },
    },
  );
  mustDiffer(
    "the ask-path stamp missing from the non-allow arm",
    upMap({ behavior: "deny", message: "no" }, { name: "p" }, { command: "raw" }, stubContext(mt), stubTool(mt), false),
    { behavior: "deny", message: "no", decisionReason: { type: "permissionPromptTool", permissionPromptToolName: "p", toolResult: { behavior: "deny", message: "no" } } },
  );
  mustDiffer(
    "the ask-path stamp ADDED to the allow arm, which upstream leaves off",
    upMap({ behavior: "allow" }, { name: "p" }, { command: "raw" }, stubContext(mt), stubTool(mt), false),
    {
      behavior: "allow",
      updatedInput: { command: "raw" },
      decisionReason: { type: "permissionPromptTool", permissionPromptToolName: "p", toolResult: { behavior: "allow" } },
      decideLocation: "ask-path",
    },
  );

  // --- the PermissionRequest hook decision, which races the host
  const frames = (...f: unknown[]) =>
    async function* () {
      for (const frame of f) yield frame;
    };
  const hookCases: [string, unknown[], Record<string, unknown>][] = [
    ["no hook registered at all", [], {}],
    ["a hook that abstains", [{ continue: true }], {}],
    ["a hook whose result is neither allow nor deny", [{ permissionRequestResult: { behavior: "ask" } }], {}],
    ["a hook that denies", [{ permissionRequestResult: { behavior: "deny", message: "hook says no" } }], {}],
    ["a hook that denies with NO message", [{ permissionRequestResult: { behavior: "deny" } }], {}],
    ["a hook that denies and interrupts", [{ permissionRequestResult: { behavior: "deny", message: "stop", interrupt: true } }], {}],
    ["a hook that allows", [{ permissionRequestResult: { behavior: "allow" } }], {}],
    ["a hook that allows with a rewritten input", [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "rewritten" } } }], {}],
    [
      "…whose rewrite the rules then ASK about",
      [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "rewritten" } } }],
      { objection: { behavior: "ask", message: "rule asks", decisionReason: { type: "rule", rule: RULE("ask") } } },
    ],
    [
      "…whose rewrite the rules ask about with NO reason",
      [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "rewritten" } } }],
      { objection: { behavior: "ask", message: "rule asks" } },
    ],
    [
      "…whose rewrite the rules DENY",
      [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "rewritten" } } }],
      { objection: { behavior: "deny", message: "rule denies" } },
    ],
    ["a hook that allows a tool needing interaction", [{ permissionRequestResult: { behavior: "allow" } }], { requiresInteraction: true }],
    [
      "…with a rewrite that satisfies it",
      [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "safe" } } }],
      { requiresInteraction: true, interactionSatisfied: true },
    ],
    ["a hook that allows with session grants", [{ permissionRequestResult: { behavior: "allow", updatedPermissions: [UPDATE("session")] } }], {}],
    [
      "a hook that allows with PERSISTED grants",
      [{ permissionRequestResult: { behavior: "allow", updatedPermissions: [UPDATE("localSettings")] } }],
      { persisted: true },
    ],
    [
      "…on a tool that suppresses all updates",
      [{ permissionRequestResult: { behavior: "allow", updatedPermissions: [UPDATE("localSettings")] } }],
      { suppressesAll: true },
    ],
    [
      "two frames, the FIRST decisive one wins",
      [{ permissionRequestResult: { behavior: "allow" } }, { permissionRequestResult: { behavior: "deny", message: "too late" } }],
      {},
    ],
    [
      "an abstaining frame followed by a decisive one",
      [{ continue: true }, { permissionRequestResult: { behavior: "deny", message: "second" } }],
      {},
    ],
  ];
  for (const [label, yielded, spec] of hookCases) {
    await both(
      "permission-request-hook-decision",
      label,
      (trace) => [
        stubTool(trace, {
          requiresUserInteraction: spec.requiresInteraction === true ? () => (trace.push("requiresUserInteraction"), true) : undefined,
          suppressesAllPermissionUpdates:
            spec.suppressesAll === true
              ? () => {
                  trace.push("suppressesAllPermissionUpdates");
                  return true;
                }
              : undefined,
        }),
        "toolu_1",
        { command: "raw" },
        stubContext(trace),
        [{ type: "addRules" }],
      ],
      (trace) => ({
        toolPermissionContext: () => {
          trace.push("toolPermissionContext");
          return { mode: "default" };
        },
        dispatchHooks: (name: string, id: string, input: unknown, _c: unknown, mode: string) => {
          trace.push(`dispatchHooks(${name},${id},${mode})`);
          return frames(...yielded)();
        },
        guardHookUpdatedInput: (decision: unknown) => {
          trace.push(`guardHookUpdatedInput(${JSON.stringify(decision)})`);
          return decision ?? undefined;
        },
        checkRules: async (_t: unknown, input: unknown, _c: unknown, options: unknown) => {
          trace.push(`checkRules(${JSON.stringify(input)},${JSON.stringify(options)})`);
          return spec.objection ?? null;
        },
        headlessDenyReason: { type: "asyncAgent", reason: "headless" },
        interactionSatisfied: () => {
          trace.push("interactionSatisfied");
          return spec.interactionSatisfied === true;
        },
        withoutRemoteScope: (u: unknown[]) => {
          trace.push(`withoutRemoteScope(${u.length})`);
          return u;
        },
        applySessionUpdates: (previous: unknown, u: unknown[]) => {
          trace.push(`applySessionUpdates(${u.length})`);
          return { ...(previous as object), applied: u.length };
        },
        persistUpdates: async (u: unknown[]) => {
          trace.push(`persistUpdates(${u.length})`);
        },
        isPersistedDestination: (d: string) => {
          trace.push(`isPersistedDestination(${d})`);
          return d !== "session";
        },
      }),
    );
  }
  const flatHook = (over: Record<string, unknown> = {}) => ({
    toolPermissionContext: () => ({ mode: "default" }),
    dispatchHooks: () => frames({ permissionRequestResult: { behavior: "allow", updatedInput: { command: "rewritten" } } })(),
    guardHookUpdatedInput: (d: unknown) => d ?? undefined,
    checkRules: async () => null,
    headlessDenyReason: { type: "asyncAgent", reason: "headless" },
    interactionSatisfied: () => false,
    withoutRemoteScope: (u: unknown[]) => u,
    applySessionUpdates: (p: unknown) => p,
    persistUpdates: async () => undefined,
    isPersistedDestination: (d: string) => d !== "session",
    ...over,
  });
  const ht: string[] = [];
  mustDiffer(
    "the rewrite accepted WITHOUT re-checking it against the rules",
    await settle(() =>
      (upstream("permission-request-hook-decision", flatHook({ checkRules: async () => ({ behavior: "deny", message: "rule denies" }) })) as (...a: unknown[]) => Promise<unknown>)(
        stubTool(ht),
        "toolu_1",
        { command: "raw" },
        stubContext(ht),
        [],
      ),
    ),
    {
      returned: {
        decision: { behavior: "allow", updatedInput: { command: "rewritten" }, userModified: false, decisionReason: { type: "hook", hookName: "PermissionRequest" } },
        interrupt: false,
        permanent: false,
      },
    },
  );
  mustDiffer(
    "a rule ASK converted to an allow rather than to a deny",
    await settle(() =>
      (upstream("permission-request-hook-decision", flatHook({ checkRules: async () => ({ behavior: "ask", message: "rule asks" }) })) as (...a: unknown[]) => Promise<unknown>)(
        stubTool(ht),
        "toolu_1",
        { command: "raw" },
        stubContext(ht),
        [],
      ),
    ),
    {
      returned: {
        decision: { behavior: "allow", updatedInput: { command: "rewritten" }, userModified: false, decisionReason: { type: "hook", hookName: "PermissionRequest" } },
        interrupt: false,
        permanent: false,
      },
    },
  );
  mustDiffer(
    "`permanent` taken from the hook rather than computed from the destinations",
    await settle(() =>
      (upstream(
        "permission-request-hook-decision",
        flatHook({ dispatchHooks: () => frames({ permissionRequestResult: { behavior: "allow", updatedPermissions: [UPDATE("session")] } })() }),
      ) as (...a: unknown[]) => Promise<unknown>)(stubTool(ht), "toolu_1", { command: "raw" }, stubContext(ht), []),
    ),
    {
      returned: {
        decision: { behavior: "allow", updatedInput: { command: "raw" }, userModified: false, decisionReason: { type: "hook", hookName: "PermissionRequest" } },
        interrupt: false,
        permanent: true,
      },
    },
  );
  mustDiffer(
    "an empty dispatch answering `null` rather than `undefined` — the caller tests one and not the other",
    await settle(() => (upstream("permission-request-hook-decision", flatHook({ dispatchHooks: () => frames()() })) as (...a: unknown[]) => Promise<unknown>)(stubTool(ht), "t", {}, stubContext(ht), [])),
    { returned: null },
  );
}


// ============================================================================
// 9. THE INHERITED LINK — C5x's `kye`, and the carve-out it left open.
//
//    C5x spliced the chain's deny-stamping link as its mechanism spike for the
//    ARROW-INITIALIZER target shape, and left the VALUE ungraded: the corpus
//    proves the link is live, but nothing compared what it returns against
//    upstream's bytes. That obligation was handed to this wave. It is small —
//    one decision, stamped on one arm — and small is exactly where a
//    transcription error survives, because every scenario that reaches it also
//    reaches thirteen other rungs that would mask a wrong stamp.
//
//    Three claims, and each has a control below: the stamp lands ONLY on a deny;
//    it OVERWRITES a location the body already set; and a non-deny is returned
//    UNCHANGED rather than rebuilt, which a spread would silently break.
// ============================================================================
{
  const behaviours = [
    { behavior: "deny", message: "no", decisionReason: { type: "rule", rule: { ruleBehavior: "deny" } } },
    { behavior: "deny", decideLocation: "already-set", message: "no" },
    { behavior: "allow", updatedInput: { a: 1 } },
    { behavior: "ask", message: "may I", suggestions: [{ type: "addRules" }] },
    { behavior: "passthrough", message: "…" },
  ];
  for (const decision of behaviours) {
    for (const sink of [undefined, { note: "sink" }]) {
      await both(
        "permission-decision",
        `${decision.behavior}${"decideLocation" in decision ? " (pre-stamped)" : ""} sink=${sink !== undefined}`,
        (trace) => [stubTool(trace), { file_path: "/x" }, stubContext(trace), { id: "msg" }, "toolu_1", undefined, sink],
        (trace) => ({
          decide: async (...args: unknown[]) => {
            trace.push(`decide(${args.length})`);
            return decision;
          },
        }),
      );
    }
  }

  const up = (d: Record<string, unknown>) =>
    upstream("permission-decision", { decide: async () => d }) as (...a: unknown[]) => Promise<unknown>;
  const call = (d: Record<string, unknown>) => up(d)(stubTool([]), {}, stubContext([]), undefined, "t", undefined, undefined);

  mustDiffer(
    "the stamp landing on an ALLOW as well as a deny",
    await call({ behavior: "allow", updatedInput: {} }),
    { behavior: "allow", updatedInput: {}, decideLocation: "pre-ask" },
  );
  mustDiffer(
    "a pre-set decideLocation surviving instead of being overwritten",
    await call({ behavior: "deny", decideLocation: "already-set" }),
    { behavior: "deny", decideLocation: "already-set" },
  );
  mustDiffer(
    "the stamp written BEFORE the spread, so the body's own value wins",
    safeJson(await call({ behavior: "deny", decideLocation: "already-set" })),
    safeJson({ decideLocation: "already-set", behavior: "deny" }),
  );
  mustDiffer(
    "a non-deny REBUILT rather than returned, which changes key order on a passthrough",
    safeJson(await call({ behavior: "passthrough", message: "m", decisionReason: { type: "other" } })),
    safeJson({ decisionReason: { type: "other" }, message: "m", behavior: "passthrough" }),
  );
}

// ============================================================================
// SUMMARY
// ============================================================================
// The floors are the non-vacuity contract (§3.1): a file that stopped running
// its cross-product would otherwise pass by running nothing, and one that
// stopped being able to FAIL would pass by comparing an implementation against
// itself. Both numbers are measured, not aspirational — raise them when the
// cross-product grows.
if (checks < 2508) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 49) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);

console.log(`=== permission-subsystem parity: ${checks} comparison(s), ${controls} control(s) ===`);
for (const f of failures.slice(0, 40)) console.log(`  FAIL — ${f}`);
if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
console.log(
  failures.length === 0
    ? "PASS — every owned permission module matches the pinned upstream body over the full cross-product, values and port traces alike"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
