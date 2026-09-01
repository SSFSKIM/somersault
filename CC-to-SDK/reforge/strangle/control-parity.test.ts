// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the control protocol (W7 / C10).
//
//   npx tsx strangle/control-parity.test.ts
//
// The sixth instance of the oracle W2 built for the tool descriptions: extract
// the upstream bodies from the PINNED BUNDLE by the BUILD's own anchor rule,
// evaluate them with stubbed ports, and require deep equality with the owned
// modules — value AND port trace — over a cross-product. Nothing here
// hand-writes an expectation, so nothing here can encode a transcription error.
//
// WHY THIS SUBSYSTEM NEEDS IT, stated as what a recording cannot see.
//
//   A CONTROL REQUEST HAS ONE SHAPE PER RECORDING. The raw driver now sends ten
//     of them and that is a real corpus, but each handler here has a partition
//     an order of magnitude wider: the model switch alone has six refusals and
//     three acceptances, and a driver case can occupy exactly one of the nine.
//   THE REINITIALIZE ARM IS UNREACHABLE FROM THE HARNESS. It answers a host
//     RECONNECTING to a session already in flight, which no scenario in this
//     corpus does and none cheaply could. It is a third of the initialize
//     handler, it has its own telemetry, its own payload shape (two extra
//     fields) and its own return value, and this file is the only thing that
//     grades any of it.
//   THE PAYLOAD'S CONDITIONAL FIELDS ARE ENTRYPOINT-GATED. Two of them appear
//     only on a VS Code entrypoint, which the harness is not and will not
//     become. The gate is a PORT in the owned module, so both of its answers are
//     graded here whatever the environment happens to return — the same move
//     that let W6 grade the auto-mode arms.
//   THE THINKING RESOLVER IS MOSTLY INVISIBLE ON THE WIRE, measured rather than
//     assumed: the request builder decides `adaptive` vs `enabled` from the
//     MODEL and discards the budget on an adaptive-capable one. So of this
//     function's four arms a recording distinguishes two, and the partition over
//     budget, display and the config already in force lives here.
//   THE PORT TRACE. Two answers that look the same can differ in nothing but
//     which ports ran — the payload builder reads the app state three separate
//     times, the model switch's breadcrumb condition short-circuits over two
//     parses, and the initialize handler's agent arm prepends the same message
//     from two different branches. A value comparison alone sees none of it, so
//     every stub records.
//
// HOW IT BINDS, and the rules it inherits from the five oracles before it.
//
//   THE SUBJECT IS LOCATED BY THE BUILD'S OWN RULE (C9's addition): `resolveAnchor`
//     + `selectExcision` + `assertSignature`, the same three functions
//     `strangle/build.ts` calls. An oracle and a build cannot grade different
//     functions, and a row whose anchor drifted fails here as well.
//   THE BINDINGS COME FROM THE MANIFEST, re-derived with its own `derive`
//     regexes against the extracted body, so this file cannot bind a port the
//     splice does not forward.
//   WHERE ONE OWNED BODY CALLS ANOTHER, the callee is bound to UPSTREAM's copy
//     on the upstream side and forwarded as a port on the owned side (C7's
//     boundary-review lesson): the initialize handler calls the payload builder,
//     and binding both sides to the owned copy would route a shared defect
//     through both and compare equal.
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
import { readFixture } from "../research/tools/extract-control-protocol.js";
import { readFixture as readPermissionSurface } from "../research/tools/extract-permission-surface.js";
// The owned side is driven through the ADAPTERS, so the argument list this file
// passes IS the one the build's delegation synthesises — the manifest's
// non-owned captures, in manifest order, primitives and their assertions included.
import "./modules/thinking-config.js";
import "./modules/permission-mode-setter.js";
import "./modules/model-switch.js";
import "./modules/initialize-payload.js";
import "./modules/initialize-handler.js";

const reforge = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => unknown> }).__reforge!;

let checks = 0;
let controls = 0;
const failures: string[] = [];

function eq(label: string, upstreamValue: unknown, ownedValue: unknown): void {
  checks++;
  const a = safeJson(upstreamValue);
  const b = safeJson(ownedValue);
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
function mustDiffer(label: string, upstreamValue: unknown, perturbedOwned: unknown): void {
  controls++;
  if (safeJson(upstreamValue) !== safeJson(perturbedOwned)) return;
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

const splice = (name: string): Splice => {
  const sp = SPLICES.find((s) => s.name === name);
  if (!sp) throw new Error(`no manifest row named ${name}`);
  return sp;
};

interface Extracted {
  source: string;
  label: string;
  binding: Map<string, string>;
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
  const out: Extracted = { source: cut.original, label: cut.label, binding, forwarded: captures.filter((c) => !c.owned).map((c) => c.as) };
  extracted.set(name, out);
  return out;
}

/**
 * Upstream's body, rebuilt with THIS case's ports lexically bound. Rebuilt per
 * case rather than through a mutable holder, so the port trace cannot accumulate
 * across cases.
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

function owned(name: string, params: unknown[], ports: Record<string, unknown>): unknown {
  const ex = extract(name);
  return reforge[splice(name).fn](...params, ...ex.forwarded.map((as) => ports[as]));
}

/** Run both sides on the same case and compare the RESULT and the port TRACE. */
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

async function settle(call: () => unknown): Promise<unknown> {
  try {
    return { returned: await call() };
  } catch (e) {
    return { threw: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
  }
}

console.log(`control-protocol parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ============================================================================
// 0. THE FIXTURES ARE THIS FILE'S POPULATION.
//    The subtype axis comes from the control-protocol fixture and the mode axis
//    from the permission-surface one, so a pin that adds either widens this file
//    automatically instead of leaving a hole nobody wrote a case for.
// ============================================================================
const PROTOCOL = readFixture();
const MODES = readPermissionSurface().modes.names;
/** The subtypes this wave owns a named handler for — the rows below, by name. */
const OWNED_SUBTYPES = ["initialize", "set_permission_mode", "set_model", "set_max_thinking_tokens"];
console.log(
  `  axes from research/fixtures/control-protocol-${ENGINE_VERSION}.json: ${PROTOCOL.counts.arms} arms / ${PROTOCOL.counts.subtypes} subtypes, ` +
    `${PROTOCOL.counts.sendable} sendable by sdk ${PROTOCOL.sdk.version}; ${MODES.length} permission modes`,
);
for (const subtype of OWNED_SUBTYPES) {
  checks++;
  if (!PROTOCOL.arms.some((a) => a.subtypes.includes(subtype))) {
    failures.push(`the pinned engine has no '${subtype}' arm — this wave owns a handler for a subtype the dispatcher no longer dispatches`);
  }
}

// ============================================================================
// 1. THE THINKING RESOLVER — the full cross-product, because the wire sees two
//    of its four arms and this file is the only thing that sees the rest.
// ============================================================================
{
  const requested: [string, unknown][] = [
    ["absent", undefined],
    ["null", null],
    ["zero", 0],
    ["one", 1],
    ["2048", 2048],
  ];
  const displays: [string, unknown][] = [
    ["no display", undefined],
    ["summarized", "summarized"],
    ["omitted", "omitted"],
    ["null display", null],
  ];
  const currents: [string, unknown][] = [
    ["nothing in force", undefined],
    ["disabled in force", { type: "disabled" }],
    ["enabled in force", { type: "enabled", budgetTokens: 9, display: "omitted" }],
    ["adaptive in force", { type: "adaptive", display: "summarized" }],
  ];
  for (const [rl, r] of requested) {
    for (const [dl, d] of displays) {
      for (const [cl, c] of currents) {
        for (const allowed of [true, false]) {
          await both("thinking-config", `${rl} / ${dl} / ${cl} / adaptive ${allowed}`, [r, d, c], (trace) => ({
            adaptiveThinkingAllowed: () => {
              trace.push("adaptiveThinkingAllowed");
              return allowed;
            },
          }));
        }
      }
    }
  }
  const upstreamResolve = upstream("thinking-config", { adaptiveThinkingAllowed: () => true }) as (...a: unknown[]) => unknown;
  mustDiffer("a resolver that keeps a DISABLED config's display", upstreamResolve(null, "summarized", { type: "disabled" }), { type: "disabled", display: "summarized" });
  mustDiffer("a resolver that treats zero as a budget rather than as OFF", upstreamResolve(0, "summarized", undefined), { type: "enabled", budgetTokens: 0, display: "summarized" });
  mustDiffer("a resolver that returns a disabled config where upstream returns NOTHING", upstreamResolve(null, undefined, undefined), { type: "disabled" });
  mustDiffer("a resolver that ignores the adaptive gate", (upstream("thinking-config", { adaptiveThinkingAllowed: () => false }) as (...a: unknown[]) => unknown)(null, "summarized", undefined), {
    type: "adaptive",
    display: "summarized",
  });
}

// ============================================================================
// 2. THE MODE SETTER — every mode the permission fixture knows, against every
//    guard outcome. The corpus reaches one refusal and one acceptance.
// ============================================================================
{
  const guardOutcomes: [string, (requested: string) => Record<string, unknown>][] = [
    ["refused", () => ({ ok: false, error: "Cannot set permission mode: must be one of a, b" })],
    ["accepted as asked", (requested) => ({ ok: true, mode: requested })],
    // upstream's `manual` alias normalises INSIDE the guard, so the setter must
    // carry the guard's parsed mode rather than the caller's string.
    ["accepted, normalised to default", () => ({ ok: true, mode: "default" })],
  ];
  for (const current of MODES) {
    for (const requestedMode of MODES) {
      for (const [gl, guard] of guardOutcomes) {
        await both("permission-mode-setter", `${current} -> ${requestedMode} (${gl})`, [{ mode: requestedMode }, { mode: current, launchFlag: true }], (trace) => ({
          guardPermissionModeChange: (requested: string, context: { mode: string }) => {
            trace.push(`guard(${requested},${context.mode})`);
            return guard(requested);
          },
          transitionPermissionMode: (from: string, to: string, context: Record<string, unknown>) => {
            trace.push(`transition(${from},${to})`);
            return { ...context, mode: to, transitioned: true };
          },
        }));
      }
    }
  }
  const noTransition = { guardPermissionModeChange: () => ({ ok: true, mode: "plan" }), transitionPermissionMode: (f: string, t: string, c: object) => ({ ...c, mode: t, transitioned: true }) };
  const up = upstream("permission-mode-setter", noTransition) as (...a: unknown[]) => unknown;
  mustDiffer("a setter that transitions even when the mode did not change", up({ mode: "plan" }, { mode: "plan", launchFlag: true }), {
    ok: true,
    mode: "plan",
    context: { mode: "plan", launchFlag: true, transitioned: true },
  });
  mustDiffer("a setter that returns the caller's string instead of the guard's parsed mode", (upstream("permission-mode-setter", {
    guardPermissionModeChange: () => ({ ok: true, mode: "default" }),
    transitionPermissionMode: (f: string, t: string, c: object) => ({ ...c, mode: t }),
  }) as (...a: unknown[]) => unknown)({ mode: "manual" }, { mode: "plan" }), { ok: true, mode: "manual", context: { mode: "manual" } });
  mustDiffer("a setter that drops the guard's refusal and accepts anyway", (upstream("permission-mode-setter", {
    guardPermissionModeChange: () => ({ ok: false, error: "no" }),
    transitionPermissionMode: (f: string, t: string, c: object) => ({ ...c, mode: t }),
  }) as (...a: unknown[]) => unknown)({ mode: "bypassPermissions" }, { mode: "default" }), { ok: true, mode: "bypassPermissions", context: { mode: "bypassPermissions" } });
  mustDiffer("a setter that forgets to stamp the mode over the transition's own context", (upstream("permission-mode-setter", {
    guardPermissionModeChange: () => ({ ok: true, mode: "plan" }),
    transitionPermissionMode: (f: string, t: string, c: object) => ({ ...(c as object), mode: "SOMETHING-ELSE" }),
  }) as (...a: unknown[]) => unknown)({ mode: "plan" }, { mode: "default" }), { ok: true, mode: "plan", context: { mode: "SOMETHING-ELSE" } });
}

// ============================================================================
// 3. THE MODEL SWITCH — six refusals and three acceptances, against a
//    system_prompt that may ride along and a hook that may refuse. The driver's
//    two cases occupy two of the resulting cells.
// ============================================================================
{
  const classifications: [string, Record<string, unknown>][] = [
    ["unrecognized, no suggestion", { kind: "unrecognized", shape: "gibberish" }],
    ["unrecognized, with suggestion", { kind: "unrecognized", shape: "typo", suggestion: "sonnet" }],
    ["blocked", { kind: "blocked" }],
    ["default", { kind: "default" }],
    ["allowed", { kind: "allowed", model: "claude-haiku-9" }],
    ["steppedDown", { kind: "steppedDown", model: "claude-sonnet-5" }],
  ];
  const systemPrompts: [string, unknown][] = [
    ["no system_prompt", undefined],
    ["a system_prompt", "be terse"],
    ["an empty system_prompt", ""],
    ["a non-string system_prompt", 17],
  ];
  const hookDecisions: [string, Record<string, unknown>][] = [
    ["hook proceeds", { decision: "proceed", messages: [] }],
    ["hook proceeds with notices", { decision: "proceed", messages: ["a notice", "another"] }],
    ["hook refuses", { decision: "block", messages: [], reason: "policy" }],
  ];
  const models: [string, unknown][] = [
    ["a model string", "haiku"],
    ["no model", undefined],
    ["a non-string model", 7],
  ];

  const makeSurface = (trace: string[], activeModel: string | undefined) => ({
    surface: "sdk",
    session: { id: "s" },
    getActiveModel: () => {
      trace.push("getActiveModel");
      return activeModel;
    },
    getConversationModel: () => {
      trace.push("getConversationModel");
      return "claude-sonnet-5";
    },
    readAppState: () => {
      trace.push("readAppState");
      return { mainLoopModel: "claude-sonnet-5", mainLoopModelForSession: "claude-sonnet-5", toolPermissionContext: { mode: "default" } };
    },
    noticeRestrictedModel: (asked: string, source: unknown) => trace.push(`noticeRestrictedModel(${asked},${String(source)})`),
    applyModel: (m: string) => trace.push(`applyModel(${m})`),
    injectModelSwitchBreadcrumbs: (asked: string, applied: string) => trace.push(`breadcrumbs(${asked},${applied})`),
    recordAllowedModelApplied: () => trace.push("recordAllowedModelApplied"),
    setSystemPrompt: (p: string) => trace.push(`setSystemPrompt(${p})`),
  });

  const makePorts = (trace: string[], classified: Record<string, unknown>, hook: Record<string, unknown>, breadcrumbs: boolean) => ({
    logFeatureBad: (a: string, b: string) => trace.push(`bad(${a},${b})`),
    normalizeModel: (m: string) => {
      trace.push(`normalizeModel(${m})`);
      return classified;
    },
    logEvent: (name: string, payload: Record<string, unknown>) => trace.push(`event(${name},${JSON.stringify(payload)})`),
    enumShape: (s: unknown) => `shape:${String(s)}`,
    unrecognizedModelError: (described: string, suggestion: unknown) => `unrecognized ${described}${suggestion ? ` (did you mean ${String(suggestion)}?)` : ""}`,
    describeModel: (m: string) => `<${m}>`,
    authTokenSource: (m: unknown) => {
      trace.push(`authTokenSource(${String(m)})`);
      return "oauth";
    },
    restrictedModelError: (asked: string, source: unknown) => `restricted ${asked} via ${String(source)}`,
    activeMainLoopModel: () => {
      trace.push("activeMainLoopModel");
      return "claude-sonnet-5";
    },
    defaultMainLoopModel: () => {
      trace.push("defaultMainLoopModel");
      return "claude-sonnet-5";
    },
    consultModelSwitchHooks: async (session: unknown, readState: () => unknown, explicit: unknown, source: string) => {
      trace.push(`consult(${String(explicit)},${source})`);
      readState();
      return hook;
    },
    logFeatureSad: (a: string, b: string) => trace.push(`sad(${a},${b})`),
    hookRefusalError: (d: Record<string, unknown>) => `hook refused: ${String(d.reason)}`,
    recordModelChange: (session: unknown, state: unknown, explicit: unknown, src: string) => trace.push(`recordModelChange(${String(explicit)},${src})`),
    parseModel: (m: unknown) => {
      trace.push(`parseModel(${String(m)})`);
      return `parsed:${String(m)}`;
    },
    shouldInjectBreadcrumbs: (arg: Record<string, unknown>) => {
      trace.push(`shouldInjectBreadcrumbs(${JSON.stringify(arg)})`);
      return breadcrumbs;
    },
    logFeatureOk: (a: string) => trace.push(`ok(${a})`),
    toNotice: (m: string) => ({ notice: m }),
  });

  for (const [cl, classified] of classifications) {
    for (const [sl, systemPrompt] of systemPrompts) {
      for (const [hl, hook] of hookDecisions) {
        await both(
          "model-switch",
          `${cl} / ${sl} / ${hl}`,
          (trace) => [{ model: "haiku", ...(systemPrompt !== undefined && { system_prompt: systemPrompt }) }, makeSurface(trace, "claude-sonnet-5")],
          (trace) => makePorts(trace, classified, hook, true),
        );
      }
    }
  }
  // the model argument's own partition, and the breadcrumb condition's other answer
  for (const [ml, model] of models) {
    for (const breadcrumbs of [true, false]) {
      await both(
        "model-switch",
        `${ml} / breadcrumbs ${breadcrumbs}`,
        (trace) => [{ ...(model !== undefined && { model }) }, makeSurface(trace, "claude-sonnet-5")],
        (trace) => makePorts(trace, { kind: "allowed", model: "claude-haiku-9" }, { decision: "proceed", messages: [] }, breadcrumbs),
      );
    }
  }
  // A KIND OUTSIDE THE FIVE-WAY UNION. Upstream's switch has no default clause,
  // so an unknown kind falls straight through with no applied model; the owned
  // module writes that arm down as `default: break` because the branch inventory
  // refuses an unmarkable construct. This case is what proves the two agree.
  await both(
    "model-switch",
    "a kind outside the normaliser's union",
    (trace) => [{ model: "haiku" }, makeSurface(trace, "claude-sonnet-5")],
    (trace) => makePorts(trace, { kind: "some-future-kind" }, { decision: "proceed", messages: [] }, true),
  );

  // the active model being absent is its own arm: `previous ?? before` feeds
  // both the parse comparison and the breadcrumb argument.
  for (const active of [undefined, "claude-sonnet-5", "claude-opus-4"]) {
    await both(
      "model-switch",
      `active model ${String(active)}`,
      (trace) => [{ model: "haiku" }, makeSurface(trace, active)],
      (trace) => makePorts(trace, { kind: "allowed", model: "claude-haiku-9" }, { decision: "proceed", messages: [] }, true),
    );
  }

  const plainPorts = makePorts([], { kind: "allowed", model: "claude-haiku-9" }, { decision: "proceed", messages: [] }, true);
  const up = upstream("model-switch", plainPorts) as (...a: unknown[]) => Promise<unknown>;
  const surface = makeSurface([], "claude-sonnet-5");
  mustDiffer("a switch that accepts a non-string model", await up({ model: 7 }, surface), { ok: true });
  mustDiffer("a switch that accepts an EMPTY system_prompt", await up({ model: "haiku", system_prompt: "" }, surface), { ok: true });
  mustDiffer(
    "a switch that reports notices when the hook returned none",
    await up({ model: "haiku" }, surface),
    { ok: true, notices: [] },
  );
  mustDiffer(
    "a switch that passes the resolved model to the hook where upstream passes NULL for `default`",
    await (upstream("model-switch", makePorts([], { kind: "default" }, { decision: "proceed", messages: [] }, true)) as (...a: unknown[]) => Promise<unknown>)(
      { model: "default" },
      makeSurface([], "claude-sonnet-5"),
    ),
    { ok: false, error: "hook refused: undefined" },
  );
  const refusedTrace: string[] = [];
  await (upstream("model-switch", makePorts(refusedTrace, { kind: "blocked" }, { decision: "proceed", messages: [] }, true)) as (...a: unknown[]) => Promise<unknown>)(
    { model: "haiku" },
    makeSurface(refusedTrace, "claude-sonnet-5"),
  );
  mustDiffer("a blocked switch that still consulted the hook", refusedTrace.includes("consult(claude-haiku-9,sdk)"), true);
}

// ============================================================================
// 4. THE INITIALIZE PAYLOAD — every conditional field, including the two the
//    harness's entrypoint can never produce.
// ============================================================================
{
  const makePorts = (
    trace: string[],
    opts: { vscode: boolean; nudge: unknown; preference: unknown; suppressed: boolean; rcDefault: boolean; outputStyle: string | undefined; account: unknown; defaultFallback: boolean },
  ) => ({
    settings: () => {
      trace.push("settings");
      return opts.outputStyle === undefined ? undefined : { outputStyle: opts.outputStyle };
    },
    defaultOutputStyle: "default",
    listOutputStyles: async (cwd: string) => {
      trace.push(`listOutputStyles(${cwd})`);
      return { default: 1, explanatory: 1 };
    },
    cwd: () => {
      trace.push("cwd");
      return "/sandbox";
    },
    accountInformation: () => {
      trace.push("accountInformation");
      return opts.account;
    },
    isVsCodeEntrypoint: () => {
      trace.push("isVsCodeEntrypoint");
      return opts.vscode;
    },
    autoDefaultNudgeEligible: () => {
      trace.push("autoDefaultNudgeEligible");
      return opts.nudge !== null;
    },
    autoDefaultNudge: (context: unknown, o: unknown) => {
      trace.push(`autoDefaultNudge(${JSON.stringify(o)})`);
      return opts.nudge;
    },
    toSlashCommands: (src: unknown) => {
      trace.push("toSlashCommands");
      return ["clear", "compact"];
    },
    apiProvider: () => "firstParty",
    renderPermissionMode: (m: string) => `mode:${m}`,
    modeIsDefaultFallback: () => {
      trace.push("modeIsDefaultFallback");
      return opts.defaultFallback;
    },
    feedbackSurveyConfig: () => ({ enabled: false }),
    analyticsDisabled: () => true,
    footerIndicator: () => "none",
    proactivity: (state: unknown) => {
      trace.push("proactivity");
      return { level: "off" };
    },
    remoteControlPreference: () => {
      trace.push("remoteControlPreference");
      return opts.preference;
    },
    remoteControlSuppressed: () => {
      trace.push("remoteControlSuppressed");
      return opts.suppressed;
    },
    remoteControlDefault: () => {
      trace.push("remoteControlDefault");
      return opts.rcDefault;
    },
    remoteControlAvailable: () => true,
    featureGate: (name: string, fallback: boolean) => {
      trace.push(`featureGate(${name},${fallback})`);
      return fallback;
    },
    fastModeState: (input: unknown, state: unknown) => {
      trace.push(`fastModeState(${String(input)},${String(state)})`);
      return "off";
    },
    fastModeDisabledReason: (input: unknown) => {
      trace.push(`fastModeDisabledReason(${String(input)})`);
      return undefined;
    },
  });

  const agents = [{ agentType: "explorer", whenToUse: "search", model: "haiku" }];
  const appState = (mode: string) => () => ({ toolPermissionContext: { mode }, fastMode: "auto", mcp: { clients: [] } });
  const sessionState = () => ({ turns: 1 });

  const cells: [string, Parameters<typeof makePorts>[1]][] = [
    ["ordinary session", { vscode: false, nudge: null, preference: undefined, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false }],
    ["chosen output style", { vscode: false, nudge: null, preference: undefined, suppressed: false, rcDefault: false, outputStyle: "explanatory", account: undefined, defaultFallback: false }],
    [
      "authenticated account",
      {
        vscode: false,
        nudge: null,
        preference: undefined,
        suppressed: false,
        rcDefault: false,
        outputStyle: undefined,
        account: { email: "a@b", organization: "org", subscription: "max", tokenSource: "oauth", apiKeySource: undefined },
        defaultFallback: false,
      },
    ],
    ["vscode, no nudge", { vscode: true, nudge: null, preference: undefined, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false }],
    ["vscode, nudge, default fallback", { vscode: true, nudge: "auto", preference: undefined, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: true }],
    ["vscode, nudge resolves to nothing", { vscode: true, nudge: undefined, preference: undefined, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: true }],
    ["remote control preferred on", { vscode: false, nudge: null, preference: true, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false }],
    ["remote control preferred off", { vscode: false, nudge: null, preference: false, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false }],
    ["remote control default on, no preference", { vscode: false, nudge: null, preference: undefined, suppressed: false, rcDefault: true, outputStyle: undefined, account: undefined, defaultFallback: false }],
    ["remote control suppressed", { vscode: false, nudge: null, preference: true, suppressed: true, rcDefault: true, outputStyle: undefined, account: undefined, defaultFallback: false }],
  ];

  for (const [label, opts] of cells) {
    for (const mode of MODES) {
      for (const unavailable of [[], ["claude-opus-4"]]) {
        for (const hooksApplied of [undefined, true, false]) {
          await both(
            "initialize-payload",
            `${label} / ${mode} / ${unavailable.length} unavailable / hooks ${String(hooksApplied)}`,
            ["src", agents, ["claude-sonnet-5"], unavailable, appState(mode), "fast-in", sessionState, hooksApplied, { store: true }],
            (trace) => makePorts(trace, opts),
          );
        }
      }
    }
  }

  const base = makePorts([], { vscode: false, nudge: null, preference: undefined, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false });
  const up = upstream("initialize-payload", base) as (...a: unknown[]) => Promise<Record<string, unknown>>;
  const args = ["src", agents, ["claude-sonnet-5"], [], appState("default"), "fast-in", sessionState, undefined, { store: true }] as const;
  mustDiffer("a payload that lists unavailable_models when there are none", { ...(await up(...args)), unavailable_models: [] }, await up(...args));
  mustDiffer("a payload that reports the agent's own type where upstream reports its NAME field", (await up(...args)).agents, [{ agentType: "explorer", description: "search", model: "haiku" }]);
  mustDiffer("a payload that auto-enables remote control when the preference is explicitly false", (
    await (upstream("initialize-payload", makePorts([], { vscode: false, nudge: null, preference: false, suppressed: false, rcDefault: true, outputStyle: undefined, account: undefined, defaultFallback: false })) as (
      ...a: unknown[]
    ) => Promise<Record<string, unknown>>)(...args)
  ).remote_control_auto_enable, true);
  mustDiffer("a payload that claims auto-on-by-default when a preference WAS stored", (
    await (upstream("initialize-payload", makePorts([], { vscode: false, nudge: null, preference: true, suppressed: false, rcDefault: false, outputStyle: undefined, account: undefined, defaultFallback: false })) as (
      ...a: unknown[]
    ) => Promise<Record<string, unknown>>)(...args)
  ).remote_control_auto_on_by_default, true);
}

// ============================================================================
// 5. THE INITIALIZE HANDLER — including the reinitialize arm, which no scenario
//    in this corpus reaches and none cheaply could.
// ============================================================================
{
  const makeTransport = (trace: string[], pending: { permissions: unknown[]; dialogs: unknown[] }) => ({
    retireSdkHostHookCallbacks: (answer: unknown) => {
      trace.push(`retire(${typeof answer})`);
      return 2;
    },
    createHookCallback: (event: string, id: string) => {
      trace.push(`createHookCallback(${event},${id})`);
      return () => undefined;
    },
    getPendingPermissionRequests: () => {
      trace.push("getPendingPermissionRequests");
      return pending.permissions;
    },
    getPendingUserDialogRequests: () => {
      trace.push("getPendingUserDialogRequests");
      return pending.dialogs;
    },
    sessionState: {
      getState: () => ({ turns: 3 }),
      notifyInternalMetadataChanged: (meta: unknown) => trace.push(`notifyInternalMetadataChanged(${JSON.stringify(meta)})`),
    },
    prependUserMessage: (m: string) => trace.push(`prependUserMessage(${m})`),
  });

  const makePorts = (
    trace: string[],
    opts: { hostOwnsHooks: boolean; agentDefinition: Record<string, unknown> | undefined; mainThreadAgent: string | undefined; exempt: boolean; allowed: boolean; restartedEpoch: boolean },
  ) => ({
    hostOwnsHooks: (request: Record<string, unknown>, transport: unknown) => {
      trace.push("hostOwnsHooks");
      return opts.hostOwnsHooks ? request.hooks : undefined;
    },
    retiredCallbackAnswer: () => ({ deny: true }),
    registerHookCallbacks: (hooks: unknown, make: (e: string, i: string) => unknown) => {
      trace.push(`registerHookCallbacks(${JSON.stringify(hooks)})`);
      make("PreToolUse", "cb1");
    },
    // `uptime_ms` is a CLOCK — upstream reads `process.uptime()` inside the
    // handshake event — so the two sides are evaluated a millisecond apart and
    // would differ on it forever. Blanked here for the same reason the differ
    // scrubs `*_ms` keys (§3.4), and only here: every other field of the same
    // payload is compared verbatim, and the two mustDiffer controls below prove
    // the trace still sees a handler that stopped emitting.
    logEvent: (name: string, payload: Record<string, unknown>) =>
      trace.push(`event(${name},${JSON.stringify({ ...payload, ...("uptime_ms" in payload && { uptime_ms: "<clock>" }) })})`),
    telemetryNumber: (n: number) => `n:${n}`,
    buildPayload: async (...a: unknown[]) => {
      trace.push(`buildPayload(agents=${JSON.stringify(a[1])},hooksApplied=${String(a[7])})`);
      return { built: true, hooksApplied: a[7] };
    },
    activeAgents: (list: unknown[]) => {
      trace.push(`activeAgents(${list.length})`);
      return list;
    },
    onReinitialized: (state: unknown) => trace.push("onReinitialized"),
    isEmptySystemPrompt: (p: unknown) => Array.isArray(p) && p.length === 1 && p[0] === "",
    normalizeDialogKinds: (kinds: unknown[]) => kinds.map((k) => `k:${String(k)}`),
    recordDialogKinds: (kinds: unknown, when: string) => trace.push(`recordDialogKinds(${JSON.stringify(kinds)},${when})`),
    isRestartedWorkerEpoch: (epoch: unknown) => {
      trace.push(`isRestartedWorkerEpoch(${String(epoch)})`);
      return opts.restartedEpoch;
    },
    env: { CLAUDE_CODE_WORKER_EPOCH: "2" },
    setPerTaskStopAffordance: (v: boolean) => trace.push(`setPerTaskStopAffordance(${v})`),
    applySkills: (s: unknown) => trace.push(`applySkills(${JSON.stringify(s)})`),
    parseAgentDefinitions: (a: unknown, source: string) => {
      trace.push(`parseAgentDefinitions(${source})`);
      return [{ agentType: "from-host" }];
    },
    mainThreadAgentType: () => {
      trace.push("mainThreadAgentType");
      return opts.mainThreadAgent;
    },
    findAgentDefinition: (list: unknown[], type: string) => {
      trace.push(`findAgentDefinition(${type})`);
      return opts.agentDefinition;
    },
    setActiveAgentType: (t: string) => trace.push(`setActiveAgentType(${t})`),
    applyAgentDefinition: (d: unknown) => trace.push("applyAgentDefinition"),
    isBuiltInAgent: (d: Record<string, unknown>) => d.source === "built-in",
    parseModel: (m: string) => {
      trace.push(`parseModel(${m})`);
      return `parsed:${m}`;
    },
    isExemptModelPick: (m: string) => {
      trace.push(`isExemptModelPick(${m})`);
      return opts.exempt;
    },
    isModelAllowed: (m: string) => {
      trace.push(`isModelAllowed(${m})`);
      return opts.allowed;
    },
    applyModelOverride: (m: string) => trace.push(`applyModelOverride(${m})`),
    applyJsonSchema: (s: unknown) => trace.push("applyJsonSchema"),
    countBy: (list: unknown[], p: (x: unknown) => boolean) => list.filter(p).length,
    mcpNonBlocking: () => true,
    authStatusService: { getInstance: () => ({ getStatus: () => ({ isAuthenticating: true, output: "o", error: undefined }) }) },
    newUuid: () => "uuid-fixed",
    currentSessionId: () => "session-fixed",
  });

  const appState = () => ({ mcp: { clients: [{ type: "pending" }, { type: "connected" }] } });

  /** The launch options this handler MUTATES — a fresh one per side, or the two would share. */
  const makeOptions = () => ({ storageV5: { store: true }, agent: undefined as string | undefined, userSpecifiedModel: undefined as string | undefined, systemPrompt: undefined as unknown, sessionMirror: false });

  const requests: [string, Record<string, unknown>][] = [
    ["bare", {}],
    ["a system prompt", { systemPrompt: "be terse" }],
    ["an explicitly EMPTY system prompt", { systemPrompt: [""] }],
    ["an appended system prompt", { appendSystemPrompt: "and be kind" }],
    ["plan-mode instructions", { planModeInstructions: "plan first" }],
    ["a subagent prompt suffix", { appendSubagentSystemPrompt: "subagent note" }],
    ["tool aliases", { toolAliases: { Bash: "Shell" } }],
    ["dynamic-section exclusions", { excludeDynamicSections: ["gitStatus"] }],
    ["prompt suggestions", { promptSuggestions: true }],
    ["subagent text forwarding", { forwardSubagentText: true }],
    ["skills", { skills: ["one", "two"] }],
    ["declared dialog kinds", { supportedDialogKinds: ["permission"] }],
    ["a per-task stop affordance", { perTaskStopAffordance: true }],
    ["a per-task stop affordance that is not exactly true", { perTaskStopAffordance: 1 }],
    ["host hooks", { hooks: { PreToolUse: [{ matcher: "Bash", hookCallbackIds: ["cb1"] }] } }],
    ["a json schema", { jsonSchema: { type: "object" } }],
    ["host agents", { agents: [{ agentType: "host" }] }],
    ["everything at once", { systemPrompt: "s", appendSystemPrompt: "a", toolAliases: { Bash: "B" }, skills: ["s"], hooks: { Stop: [{ hookCallbackIds: ["c"] }] }, jsonSchema: {}, agents: [{ agentType: "h" }] }],
  ];

  const baseOpts = { hostOwnsHooks: true, agentDefinition: undefined, mainThreadAgent: undefined, exempt: false, allowed: false, restartedEpoch: false };

  for (const [label, request] of requests) {
    for (const authStatus of [true, false]) {
      await both(
        "initialize-handler",
        `initialize :: ${label} / auth status ${authStatus}`,
        (trace) => [request, "req-1", false, { enqueue: (f: unknown) => trace.push(`enqueue(${safeJson(f)})`) }, "src", ["claude-sonnet-5"], [], makeTransport(trace, { permissions: [], dialogs: [] }), authStatus, makeOptions(), () => [{ agentType: "local" }], appState, (u: unknown) => trace.push("setAppState"), () => "fast-in"],
        (trace) => makePorts(trace, baseOpts),
      );
    }
  }

  // the agent arm, whose two prepend branches are the subtle part
  const agentCells: [string, Partial<typeof baseOpts> & { selected?: string; userModel?: string }][] = [
    ["no agent selected", {}],
    ["agent selected, not resolved", { selected: "explorer" }],
    ["agent selected and already active", { selected: "explorer", mainThreadAgent: "explorer", agentDefinition: { agentType: "explorer", initialPrompt: "hello", getSystemPrompt: () => "agent prompt" } }],
    ["agent selected, resolved, built-in", { selected: "explorer", agentDefinition: { agentType: "explorer", source: "built-in", getSystemPrompt: () => "agent prompt" } }],
    ["agent selected, resolved, donates its prompt", { selected: "explorer", agentDefinition: { agentType: "explorer", getSystemPrompt: () => "agent prompt" } }],
    ["agent whose prompt is empty", { selected: "explorer", agentDefinition: { agentType: "explorer", getSystemPrompt: () => "" } }],
    ["agent with an inherit model", { selected: "explorer", agentDefinition: { agentType: "explorer", model: "inherit", getSystemPrompt: () => "p" } }],
    ["agent with an exempt model", { selected: "explorer", exempt: true, agentDefinition: { agentType: "explorer", model: "haiku", getSystemPrompt: () => "p" } }],
    ["agent with an allowed model", { selected: "explorer", allowed: true, agentDefinition: { agentType: "explorer", model: "haiku", getSystemPrompt: () => "p" } }],
    ["agent with a RESTRICTED model", { selected: "explorer", agentDefinition: { agentType: "explorer", model: "opus", getSystemPrompt: () => "p" } }],
    ["agent with a model the user pinned over", { selected: "explorer", userModel: "sonnet", agentDefinition: { agentType: "explorer", model: "opus", getSystemPrompt: () => "p" } }],
    ["agent with an initial prompt", { selected: "explorer", agentDefinition: { agentType: "explorer", initialPrompt: "hello", getSystemPrompt: () => "p" } }],
  ];
  for (const [label, cell] of agentCells) {
    await both(
      "initialize-handler",
      `initialize :: ${label}`,
      (trace) => {
        const options = makeOptions();
        options.agent = cell.selected;
        options.userSpecifiedModel = cell.userModel;
        return [{}, "req-2", false, { enqueue: (f: unknown) => trace.push(`enqueue(${safeJson(f)})`) }, "src", ["claude-sonnet-5"], [], makeTransport(trace, { permissions: [], dialogs: [] }), false, options, () => [{ agentType: "local" }], appState, (u: unknown) => trace.push("setAppState"), () => "fast-in"];
      },
      (trace) => makePorts(trace, { ...baseOpts, ...cell }),
    );
  }

  // the REINITIALIZE arm — no scenario reaches it
  for (const hooks of [undefined, { PreToolUse: [{ hookCallbackIds: ["cb"] }] }]) {
    for (const hostOwnsHooks of [true, false]) {
      for (const pending of [
        { permissions: [], dialogs: [] },
        { permissions: [{ request_id: "p1" }], dialogs: [{ request_id: "d1" }, { request_id: "d2" }] },
      ]) {
        await both(
          "initialize-handler",
          `reinitialize :: hooks ${hooks ? "resent" : "absent"} / host owns ${hostOwnsHooks} / ${pending.permissions.length}+${pending.dialogs.length} pending`,
          (trace) => [
            { ...(hooks && { hooks }) },
            "req-3",
            true,
            { enqueue: (f: unknown) => trace.push(`enqueue(${safeJson(f)})`) },
            "src",
            ["claude-sonnet-5"],
            [],
            makeTransport(trace, pending),
            false,
            makeOptions(),
            () => [{ agentType: "local" }],
            appState,
            (u: unknown) => trace.push("setAppState"),
            () => "fast-in",
          ],
          (trace) => makePorts(trace, { ...baseOpts, hostOwnsHooks }),
        );
      }
    }
  }

  // controls
  const trace: string[] = [];
  const upFn = upstream("initialize-handler", makePorts(trace, baseOpts)) as (...a: unknown[]) => Promise<unknown>;
  const frames: unknown[] = [];
  const opts = makeOptions();
  await upFn({ appendSystemPrompt: "and be kind" }, "c1", false, { enqueue: (f: unknown) => frames.push(f) }, "src", ["m"], [], makeTransport(trace, { permissions: [], dialogs: [] }), false, opts, () => [], appState, () => undefined, () => "f");
  mustDiffer("a handler that does not apply the appended system prompt", opts.appendSystemPrompt, undefined);
  mustDiffer("a handler that answers with no payload at all", frames, [{ type: "control_response", response: { subtype: "success", request_id: "c1", response: {} } }]);

  const reinitFrames: unknown[] = [];
  const reinitOpts = makeOptions();
  await upFn({ systemPrompt: "should be ignored" }, "c2", true, { enqueue: (f: unknown) => reinitFrames.push(f) }, "src", ["m"], [], makeTransport(trace, { permissions: [], dialogs: [] }), false, reinitOpts, () => [], appState, () => undefined, () => "f");
  mustDiffer("a reinitialize that applied the request's configuration", reinitOpts.systemPrompt, "should be ignored");
  mustDiffer(
    "a reinitialize whose answer omits the pending-request fields",
    reinitFrames,
    [{ type: "control_response", response: { subtype: "success", request_id: "c2", response: { built: true, hooksApplied: undefined } } }],
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
//
// WHAT IS INSIDE THE COMPARISON COUNT: two `eq` calls per `both` (the value and
// the port trace) plus one enumeration-coverage assertion per subtype this wave
// owns a handler for, which increments the same counter without comparing two
// implementations.
if (checks < 1536) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 21) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);

console.log(`=== control-protocol parity: ${checks} comparison(s), ${controls} control(s) ===`);
for (const f of failures.slice(0, 40)) console.log(`  FAIL — ${f}`);
if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
console.log(
  failures.length === 0
    ? "PASS — every owned control-protocol module matches the pinned upstream body over the full cross-product, values and port traces alike"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
