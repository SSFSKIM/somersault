// UPSTREAM-DIFFERENTIAL CONTRACT TEST for the hook dispatchers (W5 / C8).
//
//   npx tsx strangle/hooks-parity.test.ts
//
// The fourth instance of the oracle W2 built for the tool descriptions: extract
// the upstream bodies from the PINNED BUNDLE, evaluate them with stubbed ports,
// and require deep equality with the owned modules over the full cross-product.
// Nothing here hand-writes an expectation, so nothing here can encode a
// transcription error.
//
// It also closes C5x's DEFERRED OBLIGATION. The mechanism wave shipped three
// modules unattested, on the reasoning that an exclusion needs an oracle and
// building one for a hook dispatcher is the owning wave's design work. This is
// that oracle, and `post-tool-hooks` is graded here alongside the NINETEEN
// dispatchers W5 owns — six from its first pass, four that C8's boundary review
// found live after the wave's probe had recorded them as dead, and nine more
// that C8's SECOND round found once the population under test came from
// upstream's dispatcher registry rather than from a hand-written list.
//
// THREE SHAPES, NOT ONE. Thirteen dispatchers are `async function*` and stream
// their executor's results back to a caller that folds them into the
// conversation. Six are plain `async function`s that AWAIT a different executor
// (upstream `AE`), because a compaction, a session teardown, a notification, a
// memory load and a failed turn have no conversation to stream into — and
// PreCompact goes further: it reduces its results to a verdict the compactor
// obeys. That reduction is the largest thing this file grades that no scenario
// can reach at all, since a callback that returns `{continue:true}` can neither
// add instructions nor block. FileChanged is the third shape: a synchronous
// function that reaches NEITHER executor, returning the watcher-hooks helper's
// promise for its caller to chain.
//
// WHY THIS SUBSYSTEM NEEDS IT, stated as what a callback corpus cannot see. A
// scenario proves a dispatcher RAN and that its callback received a record. It
// does not reach:
//
//   the REFUSALS. Several dispatchers return without building anything when no
//       hook is registered — which is the common case on every session in the
//       world and is exercised by no scenario, because a scenario that registers
//       no hook produces no observable at all.
//   the FIELDS THE SEAM NEVER FILLS. Five of the SessionStart record's ten keys
//       are undefined headlessly and vanish when the record is serialised onto a
//       hook's stdin, so the corpus grades half a record. Here the ports can be
//       given values the seam never supplies.
//   the SECOND PATH. The PreToolUse dispatcher's function-hook chain needs an
//       in-process module handler or a managed pass, neither of which the SDK
//       seam exposes.
//   the GUARD MATRIX on the stop dispatcher: a delegated-observation subagent, a
//       built-in web-fetch subagent, and three turn-end phases, each producing a
//       different executor request.
//   the EXECUTOR REQUEST. A callback sees the hook INPUT; it never sees the
//       options the executor was asked for — timeouts, match queries,
//       `skipSessionFunctionHooks`, `managedHooksOnly` — and those options are
//       most of what distinguishes one dispatcher from another.
//
// AND WHAT IT GRADES THAT ONLY IT CAN, in this round: five REFUSAL arms (a
// StopFailure or UserPromptExpansion dispatch with no hook registered is the
// common case on every session in the world and produces no observable at all),
// the fields the seam never fills (InstructionsLoaded builds six event-specific
// keys and a top-level project memory fills three), and the executor requests —
// where these nine differ from each other far more than their records do.
//
// WHAT THE PORT TRACE IS, since C10.6 / W7.6a: ONE ORDERED EVENT LOG, not a
// struct of per-port call lists. The retired shape could not see order ACROSS
// ports — a dispatcher that built its record before taking the activity hold
// instead of after produced identical per-port lists — and it could not state
// cleanup pairing at all. Both matter here for the layer this oracle is being
// prepared to grade rather than for the dispatchers it grades today: the hook
// EXECUTOR spawns processes, races timeouts and propagates cancellation, and
// releases a per-hook derived signal on six paths plus its catch. `EventLog`
// below carries the ordering, `unpaired()` states the pairing, and
// `comparePerHook` carries the multi-hook mode the executor's unbounded merge
// will need. The rewrite's own red direction is measured rather than asserted:
// swapping ONE adjacent pair of differently-ported events in each owned log
// reddens 204 of the 226 log comparisons and moves the retired per-port
// projection in NONE of them.
//
// HOW IT BINDS, and the lesson it inherits (C7's boundary review). Where an
// upstream body calls a helper this wave also OWNS, the helper is extracted and
// compared on its own first, and the body is then bound to UPSTREAM's copy.
// Binding it to the owned copy routes a shared defect through both sides and
// compares EQUAL — so all SIX DISTINCT owned pure helpers (`hookAgentIds`, the
// two agent-context predicates, the two message-text helpers and the plain-object
// test — seven capture usages across the manifest, because two dispatchers
// capture `hookAgentIds`) are graded against their own upstream bytes before any
// dispatcher is built on them.
//
// THE BINDINGS COME FROM THE MANIFEST, not from a second transcription. Each
// dispatcher's free variables are re-derived with the manifest's own `derive`
// regexes against the extracted body, so this file cannot bind a port the splice
// does not forward, and a derivation that stopped resolving fails here as well
// as at the build.
//
// ON `eval`. It is the mechanism, not a shortcut — the oracle has to be
// upstream's own bytes, and those bytes are minified expressions that only exist
// as source. The input is the pinned, locally extracted bundle named by
// `src/pin.ts`: never network data, never user input, and this file is a
// developer test that never ships.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { deriveCaptures, SPLICES } from "./manifest.js";
import { hookAgentIds, isBuiltInWebFetchSubagent, isDelegatedObservationSubagent } from "./modules/shared/hook-agent-context.js";
import { lastAssistantMessage, textOfContent } from "./modules/shared/assistant-text.js";
import { DEFAULT_HOOK_TIMEOUT_MS } from "./modules/post-tool-hooks/reference.js";
import { PROMPT_SUBMIT_TIMEOUT_MS } from "./modules/user-prompt-submit-hooks/reference.js";
import { isPlainObject } from "./modules/pre-tool-hooks/reference.js";
// The owned side is driven through the ADAPTERS, not through the reference
// modules directly, so the argument list this file passes IS the one the build's
// delegation synthesises — the manifest's non-owned captures, in manifest order,
// primitives included. That also puts each adapter's `primitive` equality
// assertion (§2.4) on the graded path rather than only on the built graph's.
import "./modules/post-tool-hooks.js";
import "./modules/pre-tool-hooks.js";
import "./modules/post-tool-batch-hooks.js";
import "./modules/user-prompt-submit-hooks.js";
import "./modules/stop-hooks.js";
import "./modules/subagent-start-hooks.js";
import "./modules/message-display-hooks.js";
// C8's boundary round: the four dispatchers the re-measured probe found live.
import { SESSION_END_TIMEOUT_MS } from "./modules/session-end-hooks/reference.js";
import { ACTIVITY_HOLD } from "./modules/session-start-hooks/reference.js";
import "./modules/post-tool-failure-hooks.js";
import "./modules/session-start-hooks.js";
import "./modules/session-end-hooks.js";
import "./modules/pre-compact-hooks.js";
// C8's second round: the nine dispatchers the registry-derived re-measurement
// made spliceable.
import "./modules/post-compact-hooks.js";
import "./modules/notification-hooks.js";
import "./modules/instructions-loaded-hooks.js";
import "./modules/stop-failure-hooks.js";
import "./modules/task-created-hooks.js";
import "./modules/task-completed-hooks.js";
import "./modules/permission-request-hooks.js";
// C9's fix round: the PermissionRequest dispatcher's counterpart, reachable once
// the auto-mode classifier's fail-closed arm could be created.
import "./modules/permission-denied-hooks.js";
import "./modules/user-prompt-expansion-hooks.js";
import "./modules/file-changed-hooks.js";
// W7.5: FileChanged's twin, spliceable once its firing condition was created.
import "./modules/cwd-changed-hooks.js";

/** The adapters' registration surface — exactly what the strangled graph calls. */
const reforge = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => AsyncGenerator<unknown, unknown>> }).__reforge!;

let checks = 0;
let controls = 0;
let properties = 0;
/** cases whose log carried a lifecycle edge at all — the pairing property's own floor */
let pairedCases = 0;
const failures: string[] = [];

const ENGINE = readFileSync(join(BUNDLE_MODULES, "chunk-fy12d89p.js"), "utf8");
/** The plain-object predicate lives in its own single-export chunk. */
const PREDICATE_CHUNK = readFileSync(join(BUNDLE_MODULES, "chunk-79e2v0j6.js"), "utf8");

/**
 * The serialization both comparisons run through.
 *
 * `JSON.stringify` drops a key whose value is `undefined`, so a record that
 * CARRIES a field with no value and one that omits the field entirely compared
 * EQUAL — one of the two smaller blindnesses the retired trace entry named
 * alongside the ordering one. The replacer rewrites a present-but-undefined
 * value to a sentinel; an absent key is never visited, so the two now differ.
 * A top-level `undefined` becomes the sentinel on both sides, which leaves the
 * old `?? "undefined"` fallback reachable only for a value the replacer cannot
 * see.
 */
const UNDEFINED = "<undefined>";
const show = (v: unknown): string => JSON.stringify(v, (_k, x) => (x === undefined ? UNDEFINED : x)) ?? "undefined";

function eq(label: string, upstream: unknown, owned: unknown): void {
  checks++;
  const a = show(upstream);
  const b = show(owned);
  if (a === b) return;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  failures.push(
    `${label}: differs at offset ${at}\n    upstream: ${JSON.stringify(a.slice(Math.max(0, at - 40), at + 60))}\n    owned:    ${JSON.stringify(b.slice(Math.max(0, at - 40), at + 60))}`,
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
  if (show(upstream) !== show(perturbedOwned)) return;
  failures.push(`CONTROL ${label}: the perturbed owned result compared EQUAL — this file cannot see a wrong implementation`);
}

/**
 * A PROPERTY of one run, counted apart from both of the above.
 *
 * A comparison says "the two sides agree"; a property says "the thing that
 * happened is a legal shape", and cleanup pairing is the second kind: two sides
 * that both leak a derived signal agree with each other. `mustDiffer` is the
 * non-vacuity control for a comparison; `propertyControl` below is the one for
 * this.
 */
function property(label: string, violations: string[]): void {
  properties++;
  if (violations.length === 0) return;
  failures.push(`PROPERTY ${label}: ${violations.join("; ")}`);
}

/** The non-vacuity control for a property: a shape that MUST be reported. */
function propertyControl(label: string, violations: string[]): void {
  controls++;
  if (violations.length > 0) return;
  failures.push(`CONTROL ${label}: the property reported no violation on a log that violates it`);
}

// ---- extraction -------------------------------------------------------------

/**
 * The span of the function that carries an event's anchor, found the same way
 * the SPLICE finds it: by the `hook_event_name:"<Event>"` literal, then outward
 * to the enclosing declaration. Locating the oracle's subject by a different
 * rule than the build's would let the two grade different functions.
 *
 * `kind` distinguishes the three shapes this family has. Ten dispatchers are
 * `async function*` and stream their executor's results; six are plain
 * `async function`s that await a different executor, because their callers have
 * no conversation to stream into; and FileChanged is neither — a synchronous
 * `function` that returns the watcher helper's promise for its caller to chain.
 * The minifier writes the generator with no space before the name and the async
 * one with a space, so those two searches cannot pick up each other's
 * declarations; `plain` searches the bare keyword, which an `async function`
 * also contains, and is separated from it by the parameter count below.
 *
 * Brace matching skips `'` and `"` strings; template literals are counted
 * through, which is safe here because every `${…}` in these bodies contributes a
 * balanced pair. A body that grew an unbalanced brace inside a template would
 * fail loudly at the `params` check below rather than silently truncate.
 */
function dispatcherSource(event: string, params: number, kind: "generator" | "awaited" | "plain" = "generator"): string {
  const anchor = `hook_event_name:"${event}"`;
  const declaration = kind === "generator" ? "async function*" : kind === "awaited" ? "async function " : "function ";
  const found: string[] = [];
  for (let at = ENGINE.indexOf(anchor); at >= 0; at = ENGINE.indexOf(anchor, at + 1)) {
    const start = ENGINE.lastIndexOf(declaration, at);
    if (start < 0) continue;
    const open = ENGINE.indexOf("{", ENGINE.indexOf(")", start));
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    let end = open;
    for (; end < ENGINE.length; end++) {
      const c = ENGINE[end];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    const source = ENGINE.slice(start, end + 1);
    // The signature the manifest verified is what selects among same-anchored
    // siblings — `UserPromptSubmit` has two carriers in this chunk.
    // The whole list, not up to the first `)`: matched to the OPENING paren's
    // partner, so a destructured parameter with a nested default cannot cut it
    // short. (Flat lists are unaffected — their first `)` is the closer.)
    const openParen = source.indexOf("(");
    let paren = 0;
    let closeParen = openParen;
    for (; closeParen < source.length; closeParen++) {
      if (source[closeParen] === "(") paren++;
      else if (source[closeParen] === ")" && --paren === 0) break;
    }
    const declared = source.slice(openParen + 1, closeParen);
    if (splitParams(declared).length === params) found.push(source);
  }
  if (found.length !== 1) throw new Error(`${event}: expected exactly one ${params}-parameter dispatcher, found ${found.length}`);
  return found[0];
}

/**
 * Top-level commas of a minified parameter list.
 *
 * Depth-aware, because one dispatcher needs it: Notification destructures its
 * options bag IN THE PARAMETER LIST (`{timeoutMs:r=Li,storageV5:o,credentials:u}={}`),
 * and a naive split counts its three fields as three parameters — so the
 * three-parameter search found nothing and the extraction failed with a message
 * about the wrong thing. Every other member has a flat list, where this is the
 * same split it always was.
 */
function splitParams(text: string): string[] {
  if (text.trim() === "") return [];
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** One shape-anchored extraction of a helper. Throws when the shape is gone. */
function extract(source: string, label: string, re: RegExp): string {
  const m = source.match(re);
  if (!m) throw new Error(`${label}: upstream shape not found — ${re}`);
  return m[0];
}

const nameOf = (fn: string): string => fn.match(/function\*?\s*([\w$]+)/)![1];

/** Build an upstream function from its extracted source, with the given prelude in scope. */
function build<T>(fn: string, bindings = ""): T {
  // eslint-disable-next-line no-eval
  return eval(`(() => { ${bindings}; ${fn} return ${nameOf(fn)}; })()`) as T;
}

const ports = globalThis as unknown as Record<string, unknown>;

console.log(`hook-dispatch parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ============================================================================
// 1. THE OWNED PURE HELPERS, graded against their own upstream bytes FIRST.
//    Every dispatcher below is bound to the UPSTREAM copies, never to these —
//    a body bound to the implementation it is grading cannot fail (C7).
// ============================================================================
ports.__upstreamIsWebFetch = undefined;
const upstreamIsWebFetch = build<(c: unknown) => boolean>(
  extract(ENGINE, "DR", /function DR\([\w$]+\)\{return [\w$]+\.agentType==="subagent"&&[\w$]+\.isBuiltIn===!0&&[\w$]+\.subagentName===[\w$]+\}/),
  // `Dc` is the agent-type constant DR compares against. Bound from upstream's
  // own declaration, so a value change fails here rather than being absorbed.
  extract(ENGINE, "Dc", /var Dc="[^"]+"/) + ";",
);
const upstreamIsDelegated = build<(c: unknown) => boolean>(
  extract(readFileSync(join(BUNDLE_MODULES, "chunk-bsdtxcdc.js"), "utf8"), "ka", /function ka\([\w$]+\)\{return [\w$]+\?\.agentType==="subagent"&&[\w$]+\.delegatedObservation===!0\}/),
);
ports.__upstreamIsWebFetch = upstreamIsWebFetch;
const upstreamHookAgentIds = build<(c: unknown, e: string, s: string) => string[]>(
  extract(
    ENGINE,
    "Hb",
    /function Hb\([\w$,]+\)\{let [\w$]+=[\w$]+\?\.agentId\?\?[\w$]+,[\w$]+=[\w$]+\?\.agentContext;return [\s\S]{0,160}?:\[[\w$]+\]\}/,
  ),
  // The event sets come from upstream's own declaration, and `DR` is resolved
  // through the global AT CALL TIME rather than snapshotted — the house rule
  // that stops a stub swapped between cases from being compared against itself.
  `${extract(ENGINE, "D_e/Lon", /var D_e=new Set\(\[[^\]]*\]\),Lon=new Set\(\[\.\.\.D_e,"PostToolBatch"\]\)/)};const DR=(...a)=>globalThis.__upstreamIsWebFetch(...a);`,
);
const upstreamLastAssistant = build<(m: unknown[]) => unknown>(
  extract(ENGINE, "Wy", /function Wy\([\w$]+\)\{return [\w$]+\.findLast\(\([\w$]+\)=>[\w$]+\.type==="assistant"\)\}/),
);
const upstreamTextOf = build<(c: unknown[], sep?: string) => string>(
  extract(ENGINE, "zr", /function zr\([\w$]+,[\w$]+=""\)\{return [\w$]+\.filter\([\s\S]{0,120}?\.join\([\w$]+\)\}/),
);
const upstreamIsPlainObject = build<(v: unknown) => boolean>(
  extract(PREDICATE_CHUNK, "He", /function He\([\w$]+\)\{return typeof [\w$]+==="object"&&[\w$]+!==null&&!Array\.isArray\([\w$]+\)\}/),
);

{
  const contexts: [string, unknown][] = [
    ["a built-in web-fetch subagent", { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "parent-1" }],
    ["a built-in subagent of another kind", { agentType: "subagent", isBuiltIn: true, subagentName: "general-purpose", parentAgentId: "parent-1" }],
    ["a user-defined web-fetch subagent", { agentType: "subagent", isBuiltIn: false, subagentName: "web-fetch", parentAgentId: "parent-1" }],
    ["a web-fetch subagent with no parent", { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch" }],
    ["a delegated-observation subagent", { agentType: "subagent", delegatedObservation: true }],
    ["a subagent that delegates nothing", { agentType: "subagent", delegatedObservation: false }],
    ["the main agent", { agentType: "main" }],
    ["no agent context", undefined],
  ];
  // Every event that decides a fan-out, plus one that does not: the set's
  // membership is behaviour, so each member is asserted rather than the set.
  const events = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied", "PostToolBatch", "Stop", "UserPromptSubmit"];
  for (const [label, agentContext] of contexts) {
    if (agentContext !== undefined) {
      eq(`isBuiltInWebFetchSubagent(${label})`, upstreamIsWebFetch(agentContext), isBuiltInWebFetchSubagent(agentContext));
    }
    eq(`isDelegatedObservationSubagent(${label})`, upstreamIsDelegated(agentContext), isDelegatedObservationSubagent(agentContext));
    for (const event of events) {
      for (const [ctxLabel, context] of [
        ["with an agent id", { agentId: "agent-1", agentContext }],
        ["without an agent id", { agentContext }],
        ["no context at all", undefined],
      ] as [string, unknown][]) {
        eq(
          `hookAgentIds(${label}, ${ctxLabel}, ${event})`,
          upstreamHookAgentIds(context, event, "session-1"),
          hookAgentIds(context, event, "session-1"),
        );
      }
    }
  }
  const webFetch = { agentId: "agent-1", agentContext: contexts[0][1] };
  mustDiffer("the fan-out applied to every event rather than the permission-scoped set", upstreamHookAgentIds(webFetch, "Stop", "session-1"), [
    "agent-1",
    "parent-1",
  ]);
  mustDiffer("PostToolBatch dropped from the fan-out set", upstreamHookAgentIds(webFetch, "PostToolBatch", "session-1"), ["agent-1"]);
  mustDiffer("the fan-out order reversed", upstreamHookAgentIds(webFetch, "PreToolUse", "session-1"), ["parent-1", "agent-1"]);
  mustDiffer("the web-fetch predicate ignoring isBuiltIn", upstreamIsWebFetch(contexts[2][1]), true);
  mustDiffer("the delegated predicate accepting any subagent", upstreamIsDelegated(contexts[5][1]), true);

  const messageSets: [string, unknown[]][] = [
    ["no assistant message", [{ type: "user", message: { content: [{ type: "text", text: "hi" }] } }]],
    ["one assistant message", [{ type: "assistant", message: { content: [{ type: "text", text: "the answer" }] } }]],
    [
      "the LAST assistant message wins",
      [
        { type: "assistant", message: { content: [{ type: "text", text: "first" }] } },
        { type: "user", message: { content: [] } },
        { type: "assistant", message: { content: [{ type: "text", text: "second" }] } },
      ],
    ],
    ["an assistant message with two text blocks", [{ type: "assistant", message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }]],
    ["an assistant message with no text at all", [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }]],
    ["an assistant message of whitespace", [{ type: "assistant", message: { content: [{ type: "text", text: "   " }] } }]],
    ["an empty list", []],
  ];
  for (const [label, messages] of messageSets) {
    const up = upstreamLastAssistant(messages) as { message?: { content: unknown[] } } | undefined;
    const owned = lastAssistantMessage(messages as never) as { message?: { content: unknown[] } } | undefined;
    eq(`lastAssistantMessage(${label})`, up, owned);
    if (up !== undefined) {
      for (const sep of ["", "\n", " · "]) {
        eq(`textOfContent(${label}, ${JSON.stringify(sep)})`, upstreamTextOf(up.message!.content, sep), textOfContent(up.message!.content as never, sep));
      }
      // The default separator is part of the contract: upstream's is `""`.
      eq(`textOfContent(${label}, default separator)`, upstreamTextOf(up.message!.content), textOfContent(up.message!.content as never));
    }
  }
  mustDiffer(
    "text blocks joined by a space instead of nothing",
    upstreamTextOf([{ type: "text", text: "a" }, { type: "text", text: "b" }] as never),
    "a b",
  );
  mustDiffer(
    "non-text blocks stringified rather than dropped",
    upstreamTextOf([{ type: "text", text: "a" }, { type: "tool_use", name: "Bash" }] as never),
    "aBash",
  );
  mustDiffer("the FIRST assistant message taken instead of the last", upstreamLastAssistant(messageSets[2][1]), messageSets[2][1][0]);

  for (const [label, value] of [
    ["a plain object", {}],
    ["a populated object", { a: 1 }],
    ["an array", [1]],
    ["an empty array", []],
    ["null", null],
    ["a string", "text"],
    ["a number", 7],
    ["undefined", undefined],
    ["a function", () => 0],
  ] as [string, unknown][]) {
    eq(`isPlainObject(${label})`, upstreamIsPlainObject(value), isPlainObject(value));
  }
  mustDiffer("an array accepted as a plain object", upstreamIsPlainObject([1]), true);
  mustDiffer("null accepted as a plain object", upstreamIsPlainObject(null), true);
}

// ============================================================================
// 2. THE DISPATCHERS.
// ============================================================================

/**
 * ONE ORDERED EVENT LOG, not a struct of per-port call lists (C10.6 / W7.6a,
 * Stage 0 — it retires the tech-debt entry of 2026-09-01).
 *
 * The shape this replaced put every `createBaseHookInput` call in one array,
 * every executor request in another, and compared the arrays. That proves each
 * port ran the right number of times with the right arguments and is BLIND TO
 * ORDER ACROSS PORTS: a dispatcher that built its record before taking the
 * activity hold instead of after produces identical per-port lists. The debt
 * entry deferring the rewrite named its own trigger — "the hook EXECUTOR
 * itself: it spawns processes, races timeouts and propagates cancellation, and
 * for that one interleaving IS the behaviour" — and the executor design pass
 * added a second reason it did not anticipate: CLEANUP PAIRING. The command arm
 * releases its per-hook derived signal on six paths plus its catch, and "every
 * derived signal was cleaned exactly once" is a property only an ordered log
 * can state. Both are stated here, and the ordering half carries its own
 * two-sided control (`orderControl`) showing what the retired shape could not
 * see.
 *
 * It lands BEFORE the first executor module rather than with it, which is the
 * whole reason Stage 0 is its own wave: an oracle capability shipped after the
 * module it grades is a module shipped ahead of its oracle.
 */
type PairPhase = "acquire" | "release";

interface LogEvent {
  /** the port that ran, or the value that was written */
  port: string;
  /** what it was called with */
  args: unknown[];
  /** set on a lifecycle edge: which resource, and which half of the pair */
  pair?: { key: string; phase: PairPhase };
  /**
   * Which hook this event belongs to, when a case drives more than one.
   *
   * UNSET on every case this file grades today, and deliberately so: `Qxt`
   * races its per-hook generators with unbounded concurrency, so a global
   * sequence comparison is unsound the moment a case has two hooks. The
   * comparison mode that handles it (`comparePerHook`) is built and controlled
   * here so its shape is settled before the executor arrives; nothing grades
   * with it until a multi-hook scenario exists, and it is proven on synthetic
   * logs rather than left as an untested capability.
   */
  hook?: string;
}

class EventLog {
  readonly events: LogEvent[] = [];

  record(port: string, args: unknown[], extra: Omit<LogEvent, "port" | "args"> = {}): void {
    this.events.push({ port, args, ...extra });
  }

  /** the argument list of every call to `port`, in order */
  calls(port: string): unknown[][] {
    return this.events.filter((e) => e.port === port).map((e) => e.args);
  }

  /** how many times `port` ran */
  count(port: string): number {
    return this.events.reduce((n, e) => n + (e.port === port ? 1 : 0), 0);
  }

  /** the first argument of every call to `port` — for the ports that take one */
  writes(port: string): unknown[] {
    return this.calls(port).map((a) => a[0]);
  }

  /** every lifecycle edge in call order, rendered `<phase>:<key>` */
  lifecycle(): string[] {
    return this.events.filter((e) => e.pair !== undefined).map((e) => `${e.pair!.phase}:${e.pair!.key}`);
  }

  /** the ordered port names — the thing the retired per-port lists could not state */
  order(): string[] {
    return this.events.map((e) => e.port);
  }

  /**
   * The PER-PORT PROJECTION: exactly what the retired shape compared, kept so
   * the rewrite can prove it bought something rather than asserting it. A
   * permutation that leaves this equal and the ordered log different is the
   * whole finding.
   */
  perPort(): Record<string, unknown[][]> {
    const grouped = new Map<string, unknown[][]>();
    for (const e of this.events) {
      const at = grouped.get(e.port);
      if (at === undefined) grouped.set(e.port, [e.args]);
      else at.push(e.args);
    }
    // Keys in NAME order, not first-seen order. The struct this models had a
    // fixed field order, so a port swap could not move it; a record built in
    // first-seen order would move its own key order under the permutation and
    // the control would read that as "the old shape saw it too".
    const out: Record<string, unknown[][]> = {};
    for (const port of [...grouped.keys()].sort()) out[port] = grouped.get(port)!;
    return out;
  }

  /**
   * "Every derived signal was cleaned exactly once", said as violations.
   *
   * Four shapes are violations and each is one an executor could ship: a
   * resource acquired and never released (the leak the command arm's six
   * release paths exist to avoid), one released twice, one released before it
   * was acquired, and one acquired twice without an intervening release.
   */
  unpaired(): string[] {
    const held = new Map<string, number>();
    const bad: string[] = [];
    for (const e of this.events) {
      if (e.pair === undefined) continue;
      const { key, phase } = e.pair;
      const depth = held.get(key) ?? 0;
      if (phase === "acquire") {
        if (depth > 0) bad.push(`${key} acquired again while still held`);
        held.set(key, depth + 1);
      } else {
        if (depth === 0) bad.push(`${key} released without being acquired`);
        held.set(key, Math.max(0, depth - 1));
      }
    }
    for (const [key, depth] of held) if (depth > 0) bad.push(`${key} acquired and never released`);
    return bad;
  }

  /** what the comparison serialises: the ordered events, with `undefined` visible */
  snapshot(): unknown {
    return this.events;
  }
}

/**
 * The MULTI-HOOK comparison mode of design §5(a): per-hook subsequences plus a
 * global multiset.
 *
 * `Qxt` merges its per-hook generators with unbounded concurrency, so which
 * hook's event lands first is wall-clock timing rather than behaviour, while
 * the order WITHIN one hook is entirely behaviour. Comparing the global
 * sequence would grade the scheduler; comparing only per-hook lists would lose
 * "these are all the events there were". So: each hook's subsequence must be
 * equal in order, and the multiset of all events must be equal.
 *
 * Returns the violations rather than throwing, so the same function serves the
 * grading path and its own controls.
 */
function comparePerHook(upstream: EventLog, owned: EventLog): string[] {
  const bad: string[] = [];
  const bucket = (l: EventLog): Map<string, LogEvent[]> => {
    const m = new Map<string, LogEvent[]>();
    for (const e of l.events) {
      const k = e.hook ?? "";
      const at = m.get(k);
      if (at === undefined) m.set(k, [e]);
      else at.push(e);
    }
    return m;
  };
  const up = bucket(upstream);
  const own = bucket(owned);
  for (const k of new Set([...up.keys(), ...own.keys()])) {
    const a = show(up.get(k) ?? []);
    const b = show(own.get(k) ?? []);
    if (a !== b) bad.push(`hook ${k || "<none>"}: subsequence differs`);
  }
  const multiset = (l: EventLog): string => [...l.events].map((e) => show(e)).sort().join("\n");
  if (multiset(upstream) !== multiset(owned)) bad.push("the global event multiset differs");
  return bad;
}

/**
 * THE REWRITE'S OWN RED DIRECTION, and it is two-sided.
 *
 * Permute one REAL log so two adjacent events with DIFFERENT ports swap places.
 * The per-port projection — exactly what the retired shape compared — must stay
 * EQUAL, because a rewrite claiming to see more has to show the old shape
 * seeing less rather than assert it. The ordered log must differ. A log that
 * cannot carry the permutation fails the control instead of passing quietly,
 * which is the vacuity shape this campaign has been corrected for twice.
 */
function orderControl(label: string, log: EventLog): void {
  controls++;
  const at = log.events.findIndex((e, i) => i > 0 && e.port !== log.events[i - 1].port);
  if (at < 1) {
    failures.push(`CONTROL ${label}: no two adjacent events have different ports, so the permutation is not expressible on this log`);
    return;
  }
  const permuted = logOf(...log.events);
  [permuted.events[at - 1], permuted.events[at]] = [permuted.events[at], permuted.events[at - 1]];
  if (show(log.perPort()) !== show(permuted.perPort())) {
    failures.push(`CONTROL ${label}: the permutation moved the PER-PORT projection too, so it does not isolate ordering`);
    return;
  }
  if (show(log.snapshot()) === show(permuted.snapshot())) {
    failures.push(`CONTROL ${label}: the ordered log compared EQUAL to a permutation of itself — this rewrite bought nothing`);
  }
}

/** A log assembled from given events — for the synthetic controls and the permutation. */
const logOf = (...events: LogEvent[]): EventLog => {
  const l = new EventLog();
  for (const e of events) l.events.push(e);
  return l;
};

// ---- Stage 0 machinery: the log's two new capabilities, driven ---------------
// Neither has a live consumer inside this file yet, and a capability with no
// consumer is an untested capability — which is the exact shape "a module
// shipped ahead of its oracle" takes one level down. So both are driven here on
// SYNTHETIC logs, which is also the only place their violating shapes can
// exist: a dispatcher that leaked a derived signal would be a failure, not a
// fixture.
{
  const edge = (key: string, phase: PairPhase): LogEvent => ({
    port: phase === "acquire" ? "deriveSignal" : "cleanupSignal",
    args: [key],
    pair: { key, phase },
  });

  // (i) CLEANUP PAIRING — the property the design pass added to the debt
  // entry's own argument. The command arm releases its per-hook derived signal
  // on six paths plus its catch; the shape below is that arm with five hooks
  // released and one leaked, which is the defect an ordered log exists to see.
  property("a signal acquired and released exactly once is paired", logOf(edge("sig", "acquire"), edge("sig", "release")).unpaired());
  propertyControl("a signal acquired and never released", logOf(edge("sig", "acquire")).unpaired());
  propertyControl(
    "a signal released twice — two of the six release paths both running",
    logOf(edge("sig", "acquire"), edge("sig", "release"), edge("sig", "release")).unpaired(),
  );
  propertyControl("a signal released before it was acquired", logOf(edge("sig", "release")).unpaired());
  propertyControl("a signal acquired again while still held", logOf(edge("sig", "acquire"), edge("sig", "acquire")).unpaired());
  propertyControl(
    "one hook of six leaking its derived signal while the other five release",
    logOf(
      ...["h1", "h2", "h3", "h4", "h5"].flatMap((k) => [edge(k, "acquire"), edge(k, "release")]),
      edge("h6", "acquire"),
    ).unpaired(),
  );

  // (ii) THE MULTI-HOOK MODE — design §5(a). `Qxt` merges its per-hook
  // generators with unbounded concurrency, so WHICH hook's event lands first is
  // wall-clock timing and the order WITHIN one hook is entirely behaviour.
  // Grading the global sequence would grade the scheduler; grading only
  // per-hook lists would lose "these are all the events there were".
  const ev = (hook: string, port: string, ...args: unknown[]): LogEvent => ({ port, args, hook });
  const merged = logOf(ev("h1", "spawn"), ev("h2", "spawn"), ev("h1", "exit", 0), ev("h2", "exit", 0));
  const racedTheOtherWay = logOf(ev("h2", "spawn"), ev("h1", "spawn"), ev("h2", "exit", 0), ev("h1", "exit", 0));
  property("a merge that raced the other way is legal per-hook", comparePerHook(merged, racedTheOtherWay));
  mustDiffer("the ORDERED mode, which is what single-hook cases use, rejects that same reordering", merged.snapshot(), racedTheOtherWay.snapshot());
  propertyControl(
    "one hook's own order reversed — behaviour, not scheduling",
    comparePerHook(merged, logOf(ev("h1", "exit", 0), ev("h2", "spawn"), ev("h1", "spawn"), ev("h2", "exit", 0))),
  );
  propertyControl(
    "an event dropped from the merge, which only the global multiset can see",
    comparePerHook(merged, logOf(ev("h1", "spawn"), ev("h2", "spawn"), ev("h1", "exit", 0))),
  );
  propertyControl(
    "one hook's exit code changed",
    comparePerHook(merged, logOf(ev("h1", "spawn"), ev("h2", "spawn"), ev("h1", "exit", 1), ev("h2", "exit", 0))),
  );
  // The mode is EXPRESSIBLE, not in use: no case in this file drives two hooks,
  // so every `hook` field above is synthetic and every graded comparison below
  // is the ordered one. It is built now because settling its shape after the
  // executor arrives is settling it under the pressure of a failing case.
}

interface StubSpec {
  /** what the registration guard answers */
  registered: boolean;
  /** what the module-handler registry answers (PreToolUse only) */
  moduleHandlers?: boolean;
  /** what the executor yields, and what it returns */
  results?: unknown[];
  /** what the function-hook chain yields (PreToolUse only) */
  chainResults?: unknown[];
  /**
   * What the AWAITING executor resolves to (PreCompact, SessionEnd). Defaults to
   * the empty list, which is upstream's own "nothing ran" arm.
   */
  awaitResults?: unknown[];
  /** make the executor THROW, so the SessionStart hold's `finally` is graded */
  executorThrows?: string;
  /** what the watcher-hooks helper resolves to (FileChanged) */
  watcherResult?: unknown;
}

/** The common prefix every dispatcher spreads. A fixed object, so a difference is the dispatcher's. */
const BASE_PREFIX = {
  session_id: "session-1",
  transcript_path: "/t/session-1.jsonl",
  cwd: "/sandbox",
  prompt_id: "prompt-1",
  permission_mode: "bypassPermissions",
  effort: undefined,
};

function makePorts(spec: StubSpec, log: EventLog) {
  const results = spec.results ?? [{ decision: "continue" }, { decision: "second" }];
  return {
    hasHookForEvent: (...args: unknown[]) => {
      log.record("hasHookForEvent", args);
      return spec.registered;
    },
    createBaseHookInput: (...args: unknown[]) => {
      log.record("base", args);
      return { ...BASE_PREFIX };
    },
    cwd: () => {
      log.record("cwd", []);
      return "/sandbox";
    },
    executeHooks: async function* (request: unknown) {
      log.record("executor", [request]);
      if (spec.executorThrows !== undefined) throw new Error(spec.executorThrows);
      for (const r of results) yield r;
      return { executed: results.length };
    },
    executeWatcherHooks: async (...args: unknown[]) => {
      log.record("watcher", args);
      return spec.watcherResult ?? { results: [], watchPaths: [], systemMessages: [] };
    },
    executeHooksAwait: async (request: unknown) => {
      log.record("executorAwait", [request]);
      if (spec.executorThrows !== undefined) throw new Error(spec.executorThrows);
      return spec.awaitResults ?? [];
    },
    sessionId: (...args: unknown[]) => {
      log.record("sessionId", args);
      return `coerced:${String(args[0])}`;
    },
    beginActivity: (...args: unknown[]) => {
      // The one acquire/release pair in the dispatcher family, and the shape the
      // executor's per-hook derived signals will reuse: the log carries the edge,
      // and `unpaired()` states the property over it.
      log.record("beginActivity", args, { pair: { key: `activity:${String(args[0])}`, phase: "acquire" } });
    },
    endActivity: (...args: unknown[]) => {
      log.record("endActivity", args, { pair: { key: `activity:${String(args[0])}`, phase: "release" } });
    },
    // NOT a capture: SessionEnd reads the registry off its own options bag. It
    // is stubbed here anyway so each side gets its own sink — an argument shared
    // between the two runs would record both into one and grade neither.
    sessionHooks: {
      clear: (...args: unknown[]) => {
        log.record("registryClear", args);
      },
    },
    /** Collect what a dispatcher wrote to stderr instead of printing it. */
    captureStderr: async <T>(run: () => Promise<T>): Promise<T> => {
      const original = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        log.record("stderr", [typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()]);
        return true;
      }) as typeof process.stderr.write;
      try {
        return await run();
      } finally {
        process.stderr.write = original;
      }
    },
    uuid: () => {
      log.record("uuid", []);
      return "44444444-4444-4444-8444-444444444444";
    },
    sessionTitle: (...args: unknown[]) => {
      log.record("sessionTitle", args);
      return "a session title";
    },
    backgroundTasks: (...args: unknown[]) => {
      log.record("backgroundTasks", args);
      return [{ id: "task-1", type: "local_bash", status: "running" }];
    },
    sessionCrons: () => {
      log.record("sessionCrons", []);
      return [];
    },
    agentTranscriptPath: (...args: unknown[]) => {
      log.record("agentTranscriptPath", args);
      return `/t/agent-${String(args[0])}.jsonl`;
    },
    log: (...args: unknown[]) => {
      log.record("log", args);
    },
    stableKeys: {
      stableKey: (v: unknown) => {
        log.record("stableKey", [v]);
        return JSON.stringify(v);
      },
    },
    moduleHandlers: {
      hasModuleHandlers: (...args: unknown[]) => {
        log.record("moduleHandlers", args);
        return spec.moduleHandlers === true;
      },
    },
    preToolChain: {
      executePreToolUseChain: async function* (request: { runSettingsHooks: (i?: unknown, o?: unknown) => AsyncIterable<unknown> }) {
        log.record("chain", [{ ...request, runSettingsHooks: "<closure>" }]);
        for (const r of spec.chainResults ?? [{ type: "chain" }]) yield r;
        // The chain calls back into the dispatcher's closure — with a rewritten
        // input and with per-call options — and that closure's request is the
        // half of this dispatcher a scenario cannot reach at all.
        for await (const r of request.runSettingsHooks({ rewritten: true }, { managedHooksOnly: true })) yield r;
      },
    },
    stripConfinedHookApproval: (result: unknown, label: unknown) => {
      log.record("confined", [result, label]);
      return result;
    },
  };
}

type PortSet = ReturnType<typeof makePorts>;

/**
 * The port globals every extracted body is bound to, installed ONCE.
 *
 * Each is a stable forwarder into `CURRENT`, never the case's stub itself: the
 * bodies are `eval`ed once per dispatcher and their bindings are `const`, so
 * assigning a fresh stub to the global between cases would leave every body
 * still holding the FIRST case's stub — every trace would be recorded into one
 * sink and every comparison after the first would grade the wrong run.
 */
let CURRENT: PortSet | null = null;
const live = (): PortSet => {
  if (CURRENT === null) throw new Error("hooks-parity: a port was called with no case bound");
  return CURRENT;
};

ports.__p_hasHookForEvent = (...a: unknown[]) => live().hasHookForEvent(...a);
ports.__p_createBaseHookInput = (...a: unknown[]) => live().createBaseHookInput(...a);
ports.__p_cwd = () => live().cwd();
ports.__p_executeHooks = async function* (request: unknown) {
  return yield* live().executeHooks(request);
};
ports.__p_uuid = () => live().uuid();
ports.__p_sessionTitle = (...a: unknown[]) => live().sessionTitle(...a);
ports.__p_backgroundTasks = (...a: unknown[]) => live().backgroundTasks(...a);
ports.__p_sessionCrons = () => live().sessionCrons();
ports.__p_agentTranscriptPath = (...a: unknown[]) => live().agentTranscriptPath(...a);
ports.__p_log = (...a: unknown[]) => live().log(...a);
ports.__p_stableKeys = { stableKey: (v: unknown) => live().stableKeys.stableKey(v) };
ports.__p_moduleHandlers = { hasModuleHandlers: (...a: unknown[]) => live().moduleHandlers.hasModuleHandlers(...a) };
ports.__p_preToolChain = {
  executePreToolUseChain: async function* (request: never) {
    return yield* live().preToolChain.executePreToolUseChain(request);
  },
};
ports.__p_stripConfinedHookApproval = (result: unknown, label: unknown) => live().stripConfinedHookApproval(result, label);
ports.__p_executeHooksAwait = (request: unknown) => live().executeHooksAwait(request);
ports.__p_executeWatcherHooks = (...a: unknown[]) => live().executeWatcherHooks(...a);
ports.__p_sessionId = (...a: unknown[]) => live().sessionId(...a);
ports.__p_beginActivity = (...a: unknown[]) => live().beginActivity(...a);
ports.__p_endActivity = (...a: unknown[]) => live().endActivity(...a);
// The timeout and hold constants: upstream's own parameter defaults and literals,
// bound to the OWNED values. They are not stubs — the owned copy IS the claim,
// and the adapter equality-asserts the graph's copy against it on every
// delegation.
ports.__p_defaultHookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS;
ports.__p_promptSubmitTimeoutMs = PROMPT_SUBMIT_TIMEOUT_MS;
ports.__p_sessionEndTimeoutMs = SESSION_END_TIMEOUT_MS;
ports.__p_activityHold = ACTIVITY_HOLD;
// The OWNED pure helpers are bound to UPSTREAM's bytes, never to the module's
// own — the whole point of section 1 (C7's lesson).
ports.__p_hookAgentIds = upstreamHookAgentIds;
ports.__p_isDelegatedObservationSubagent = upstreamIsDelegated;
ports.__p_isBuiltInWebFetchSubagent = upstreamIsWebFetch;
ports.__p_lastAssistantMessage = upstreamLastAssistant;
ports.__p_textOfContent = upstreamTextOf;
ports.__p_isPlainObject = upstreamIsPlainObject;

/** Point the forwarders at one case's stub set. */
function bindGlobals(p: PortSet): void {
  CURRENT = p;
}

/**
 * One dispatcher, prepared: upstream's body with its manifest-derived captures
 * bound to the shared stubs, and the owned entry point with the FORWARDED
 * captures appended in manifest order — the same argument list the build's
 * delegation synthesises.
 */
function prepare(row: string, event: string, params: number, kind: "generator" | "awaited" | "plain" = "generator") {
  const splice = SPLICES.find((s) => s.name === row);
  if (!splice) throw new Error(`${row}: no manifest row`);
  const source = dispatcherSource(event, params, kind);
  const captures = deriveCaptures(splice, source);
  const seen = new Set<string>();
  const bindings = captures
    .filter((c) => (seen.has(c.identifier) ? false : (seen.add(c.identifier), true)))
    .map((c) => `const ${c.identifier}=globalThis.__p_${c.as};`)
    .join("");
  const upstream = build<(...a: unknown[]) => AsyncGenerator<unknown, unknown>>(source, bindings);
  const forwarded = (p: PortSet, constants: Record<string, unknown>): unknown[] =>
    captures
      .filter((c) => !c.owned)
      .map((c) => {
        const key = c.as as keyof PortSet;
        if (key in p) return p[key];
        if (c.as in constants) return constants[c.as];
        throw new Error(`${row}: no stub for forwarded capture '${c.as}'`);
      });
  return { upstream, forwarded, captures, owned: reforge[splice.fn] };
}

/**
 * The same, for the dispatchers that are not generators — the awaited ones and
 * FileChanged, which is not even async. `prepare` is typed for the streaming
 * shape because that is the family's majority; the difference here is in the
 * CALLING convention only, since the extraction, the manifest bindings and the
 * forwarded argument list are identical. `settle` awaits either way, so a
 * synchronous function that returns a promise is graded on what it returns.
 */
function prepareAwaited(row: string, event: string, params: number, kind: "awaited" | "plain" = "awaited") {
  const p = prepare(row, event, params, kind);
  const cast = (fn: unknown) => fn as (...a: unknown[]) => Promise<unknown>;
  return { ...p, upstream: cast(p.upstream), owned: cast(p.owned) };
}

/**
 * Drive a generator to completion: what it yielded, what it returned — or how it
 * THREW.
 *
 * A throw is graded, not swallowed. The stop dispatcher reads
 * `agentContext.agentType` without an optional chain where its own first guard
 * uses one, so a call with no agent context is a TypeError upstream; the owned
 * module reproduces that rather than defending against it, and this is what says
 * so. Silently catching would have let a defensive `?.` in the owned copy pass.
 */
async function drain(g: AsyncGenerator<unknown, unknown>): Promise<{ yielded: unknown[]; returned?: unknown; threw?: string }> {
  const yielded: unknown[] = [];
  try {
    for (;;) {
      const step = await g.next();
      if (step.done) return { yielded, returned: step.value };
      yielded.push(step.value);
    }
  } catch (e) {
    return { yielded, threw: `${(e as Error).name}: ${(e as Error).message}` };
  }
}

/**
 * How long a bounded drive waits on one `next()` before calling the path
 * non-settling. Every settling path in this file resolves in microtasks — the
 * ports are synchronous stubs — so a quarter second is three orders of
 * magnitude of headroom, and the control below measures that rather than
 * assuming it: a healthy case driven through the same driver must report
 * SETTLED.
 */
const NON_SETTLING_MS = 250;

/**
 * `drain`, bounded — the grading mode for a path that NEVER SETTLES (Stage 0c).
 *
 * `drain` runs to completion, which is right for every dispatcher and wrong for
 * the layer beneath them. The executor's shutdown wrapper awaits a promise
 * constructed to never resolve, so six events HANG rather than return; an
 * oracle that drained that path would deadlock, and a suite that hangs is worse
 * than one that fails — it is the vacuity shape the gate's own three-outcome
 * fix refused, one level down. So the drive is bounded and "did not settle" is
 * a graded OUTCOME rather than an absence of one.
 *
 * The abandoned `next()` promise stays pending after a timeout. That is
 * deliberate and it is why this is safe to run in-process: a promise nobody
 * resolves holds no timer and no handle, so it cannot keep the event loop
 * alive.
 */
async function drainBounded(
  g: AsyncGenerator<unknown, unknown>,
  ms = NON_SETTLING_MS,
): Promise<{ yielded: unknown[]; settled: boolean; returned?: unknown; threw?: string }> {
  const yielded: unknown[] = [];
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = await Promise.race([
      g.next().then((s) => ({ s }) as const, (e: Error) => ({ e }) as const),
      new Promise<{ readonly late: true }>((res) => {
        timer = setTimeout(() => res({ late: true }), ms);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if ("late" in step) return { yielded, settled: false };
    if ("e" in step) return { yielded, settled: true, threw: `${step.e.name}: ${step.e.message}` };
    if (step.s.done) return { yielded, settled: true, returned: step.s.value };
    yielded.push(step.s.value);
  }
}

/**
 * The non-settling VERDICT, said as violations: "produced no yields and did not
 * settle within N ms".
 *
 * Both halves matter and the second is the one a lazier mode would drop. A path
 * that yields a progress message and THEN hangs is a different behaviour from
 * one that hangs before producing anything, and upstream's shutdown arm is the
 * second — so a mode that only checked "did not settle" would pass an
 * implementation that streamed first.
 */
function nonSettling(run: { yielded: unknown[]; settled: boolean }): string[] {
  const bad: string[] = [];
  if (run.settled) bad.push("the run SETTLED, so this is not the non-settling path");
  if (run.yielded.length > 0) bad.push(`the run yielded ${run.yielded.length} value(s) before hanging`);
  return bad;
}

/**
 * Deliver one stdout payload to a `data` handler in a SCRIPTED number of writes
 * (Stage 0b).
 *
 * Byte-equal stdout delivered in a different number of writes is different
 * behaviour in this layer, so a replay surface that reproduces stdout BYTES is
 * not reproducing stdout. `boundaries` are absolute offsets into the payload at
 * which a write ends; `[]` is the single-write case.
 */
function writeInChunks(onData: (chunk: string) => void, payload: string, boundaries: number[]): number {
  let at = 0;
  let writes = 0;
  for (const stop of [...boundaries, payload.length]) {
    const end = Math.min(stop, payload.length);
    if (end <= at) continue;
    onData(payload.slice(at, end));
    writes++;
    at = end;
  }
  if (at < payload.length) {
    onData(payload.slice(at));
    writes++;
  }
  return writes;
}

/**
 * Grade one case's two event logs, and state the pairing property over them.
 *
 * The comparison is the ORDERED log, so it now sees what the retired per-port
 * lists could not: which port ran before which. The property is separate on
 * purpose — two sides that both leak a derived signal COMPARE EQUAL, so a
 * comparison can never state "cleaned exactly once" no matter how ordered it is.
 */
function gradeLogs(label: string, upstream: EventLog, owned: EventLog): void {
  // The log is the half a callback corpus cannot see: which ports ran, with
  // what, in what order, and how often. The EXECUTOR REQUEST rides in it, so
  // this comparison is what actually grades the hook record's field set.
  eq(`${label} [ports]`, upstream.snapshot(), owned.snapshot());
  property(`${label} [cleanup pairing, upstream]`, upstream.unpaired());
  property(`${label} [cleanup pairing, owned]`, owned.unpaired());
  if (upstream.lifecycle().length > 0) pairedCases++;
}

/** Run both sides of one case against fresh logs, and compare output AND the log. */
async function compare(
  label: string,
  spec: StubSpec,
  constants: Record<string, unknown>,
  runUpstream: (p: PortSet) => AsyncGenerator<unknown, unknown>,
  runOwned: (p: PortSet) => AsyncGenerator<unknown, unknown>,
): Promise<{ upstream: { yielded: unknown[]; returned?: unknown; threw?: string }; trace: EventLog }> {
  const upLog = new EventLog();
  const upPorts = makePorts(spec, upLog);
  bindGlobals(upPorts);
  const up = await drain(runUpstream(upPorts));

  const ownLog = new EventLog();
  const ownPorts = makePorts(spec, ownLog);
  const own = await drain(runOwned(ownPorts));

  eq(`${label} [yields+return]`, up, own);
  gradeLogs(label, upLog, ownLog);
  return { upstream: up, trace: upLog };
}

/** Await a value-returning dispatcher, grading a throw rather than swallowing it. */
async function settle(p: Promise<unknown>): Promise<{ returned?: unknown; threw?: string }> {
  try {
    return { returned: await p };
  } catch (e) {
    return { threw: `${(e as Error).name}: ${(e as Error).message}` };
  }
}

/**
 * `compare`, for the two dispatchers that return a value instead of streaming.
 *
 * Both sides run with `process.stderr.write` swapped for a per-side collector:
 * SessionEnd REPORTS through stderr, and that reporting policy — which results
 * are named and which are silent — is behaviour no other surface here can see.
 * The swap is per side and restored in a `finally`, so a throwing dispatcher
 * cannot leave the process's stderr redirected into a dead sink.
 */
async function compareValue(
  label: string,
  spec: StubSpec,
  runUpstream: (p: PortSet) => Promise<unknown>,
  runOwned: (p: PortSet) => Promise<unknown>,
): Promise<{ upstream: { returned?: unknown; threw?: string }; trace: EventLog }> {
  const upLog = new EventLog();
  const upPorts = makePorts(spec, upLog);
  bindGlobals(upPorts);
  const up = await upPorts.captureStderr(() => settle(runUpstream(upPorts)));

  const ownLog = new EventLog();
  const ownPorts = makePorts(spec, ownLog);
  const own = await ownPorts.captureStderr(() => settle(runOwned(ownPorts)));

  eq(`${label} [returns]`, up, own);
  gradeLogs(label, upLog, ownLog);
  return { upstream: up, trace: upLog };
}

const SESSION = { id: "session-1", project: "/sandbox" };
const registry = (functionHooks: number) => ({
  has: () => true,
  getFunctionHooks: () => new Map([["Stop", new Array(functionHooks).fill({})], ["SubagentStop", new Array(functionHooks).fill({})]]),
});
const context = (over: Record<string, unknown> = {}) => ({
  session: SESSION,
  // Always present in the engine, and the stop dispatcher DEPENDS on that: it
  // reads `agentContext.agentType` without an optional chain. One case below
  // omits it deliberately, and grades the TypeError both sides raise.
  agentContext: { agentType: "main" },
  sessionHooksRegistry: registry(1),
  abortController: new AbortController(),
  taskRegistry: { all: () => ({ "task-1": { id: "task-1" } }) },
  storageV5: { store: "v5" },
  credentials: { kind: "placeholder" },
  hookOrigin: "test",
  ...over,
});

// ---- PostToolUse (upstream `b3e`; C5x's spike, attested by W5) --------------
{
  const { upstream, forwarded, owned } = prepare("post-tool-hooks", "PostToolUse", 10);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    ["plain", { registered: true }, ["Bash", "tu-1", { command: "echo hi" }, { stdout: "hi\n" }, context(), "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, 12, undefined]],
    ["managed only", { registered: true }, ["Bash", "tu-1", { command: "echo hi" }, { stdout: "hi\n" }, context(), "default", undefined, 1000, 0, { managedHooksOnly: true }]],
    ["managed excluded", { registered: true }, ["Write", "tu-2", { file_path: "/a" }, { ok: true }, context(), "acceptEdits", undefined, 1000, 3, { managedHooksExcluded: ["plugin"] }]],
    ["no options at all", { registered: true }, ["Read", "tu-3", { file_path: "/b" }, "a string response", context(), undefined, undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined, undefined]],
    ["the executor yields nothing", { registered: true, results: [] }, ["Bash", "tu-4", {}, {}, context(), "default", undefined, 1, 1, {}]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `post-tool-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 10), ...forwarded(p, constants)),
    );
  }
  // The field ORDER is the byte stream a command hook reads (`hooks-command`
  // grades the same claim end-to-end). A reordered record compares unequal here.
  const { trace } = await compare(
    "post-tool-hooks order control",
    { registered: true },
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 10), ...forwarded(p, constants)),
  );
  // The rewrite's red direction, on a REAL streaming dispatcher's log rather
  // than a toy: this dispatcher's ports are compared in the order they ran, and
  // the projection the retired shape compared is asserted blind to the swap.
  orderControl("post-tool-hooks: the ordered log sees a port swap the per-port lists cannot", trace);
  const record = (trace.calls("executor")[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  eq("post-tool-hooks field order", Object.keys(record), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "tool_name",
    "tool_input",
    "tool_response",
    "tool_use_id",
    "duration_ms",
  ]);
  mustDiffer("tool_use_id and duration_ms swapped in the record", Object.keys(record).join(","), [
    "session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort",
    "hook_event_name", "tool_name", "tool_input", "tool_response", "duration_ms", "tool_use_id",
  ].join(","));
  mustDiffer("the timeout constant drifting from the pinned declaration", DEFAULT_HOOK_TIMEOUT_MS, 300000);
}

// ---- PreToolUse (upstream `Tye`) -------------------------------------------
{
  const { upstream, forwarded, owned } = prepare("pre-tool-hooks", "PreToolUse", 8);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const pass = { toolUseId: "tu-1", input: { command: "echo hi" }, pass: { granted: true } };
  const cases: [string, StubSpec, unknown[]][] = [
    ["settings path", { registered: true }, ["Bash", "tu-1", { command: "echo hi" }, context(), "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined]],
    ["no hook registered", { registered: false }, ["Bash", "tu-1", { command: "echo hi" }, context(), "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined]],
    ["managed only, no hook registered", { registered: false }, ["Bash", "tu-1", { command: "echo hi" }, context(), "default", undefined, 1000, { managedHooksOnly: true }]],
    ["managed only with a matching pass", { registered: true }, ["Bash", "tu-1", { command: "echo hi" }, context({ managedPass: pass }), "default", undefined, 1000, { managedHooksOnly: true }]],
    ["a matching managed pass arms the chain", { registered: false }, ["Bash", "tu-1", { command: "echo hi" }, context({ managedPass: pass }), "default", undefined, 1000, undefined]],
    ["a pass for a different tool_use id", { registered: true }, ["Bash", "tu-2", { command: "echo hi" }, context({ managedPass: pass }), "default", undefined, 1000, undefined]],
    ["a pass whose input does not match", { registered: true }, ["Bash", "tu-1", { command: "echo bye" }, context({ managedPass: pass }), "default", undefined, 1000, undefined]],
    ["module handlers arm the chain", { registered: false, moduleHandlers: true }, ["Bash", "tu-1", { command: "echo hi" }, context(), "default", undefined, 1000, undefined]],
    ["module handlers but a non-object input", { registered: true, moduleHandlers: true }, ["Bash", "tu-1", ["not", "an", "object"], context(), "default", undefined, 1000, undefined]],
    ["module handlers but a null input", { registered: false, moduleHandlers: true }, ["Bash", "tu-1", null, context(), "default", undefined, 1000, undefined]],
    ["the chain yields nothing", { registered: false, moduleHandlers: true, chainResults: [] }, ["Bash", "tu-1", { command: "echo hi" }, context(), "default", undefined, 1000, undefined]],
    ["an explicit signal beats the abort controller", { registered: true }, ["Bash", "tu-1", { command: "echo hi" }, context(), "default", new AbortController().signal, 1000, undefined]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `pre-tool-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 8), ...forwarded(p, constants)),
    );
  }
  // Controls, on the branch a scenario cannot reach.
  const chained = await compare(
    "pre-tool-hooks chain control",
    { registered: false, moduleHandlers: true },
    constants,
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  mustDiffer("the confined-session filter skipped on the chain path", chained.trace.count("confined"), 0);
  mustDiffer("the chain path falling through to the settings path as well", chained.upstream.yielded.length, 0);
  const arrayInput = await compare(
    "pre-tool-hooks array-input control",
    { registered: true, moduleHandlers: true },
    constants,
    () => upstream(...cases[8][2]),
    (p) => owned(...(cases[8][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  mustDiffer("an array tool input offered to the chain", arrayInput.trace.count("chain"), 1);
  const refused = await compare(
    "pre-tool-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  mustDiffer("a refusal that still built the record", refused.trace.count("base"), 1);
  mustDiffer("a refusal that still logged", refused.trace.count("log"), 1);
}

// ---- PostToolBatch (upstream `Fct`) ----------------------------------------
{
  const { upstream, forwarded, owned } = prepare("post-tool-batch-hooks", "PostToolBatch", 6);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const calls = [{ tool_name: "Bash", tool_input: { command: "echo 1" } }, { tool_name: "Bash", tool_input: { command: "echo 2" } }];
  const cases: [string, StubSpec, unknown[]][] = [
    ["registered", { registered: true }, [calls, "tu-batch", context(), "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["not registered", { registered: false }, [calls, "tu-batch", context(), "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["an empty batch", { registered: true }, [[], "tu-batch", context(), "default", undefined, 1000]],
    [
      "a web-fetch subagent fans the lookup out to its parent",
      { registered: true },
      [calls, "tu-batch", context({ agentId: "agent-1", agentContext: { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "parent-1" } }), "default", undefined, 1000],
    ],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `post-tool-batch-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 6), ...forwarded(p, constants)),
    );
  }
  const fanned = await compare(
    "post-tool-batch-hooks fan-out control",
    { registered: true },
    constants,
    () => upstream(...cases[3][2]),
    (p) => owned(...(cases[3][2] as unknown[]).slice(0, 6), ...forwarded(p, constants)),
  );
  mustDiffer("the batch guard consulted under the acting agent alone", fanned.trace.calls("hasHookForEvent")[0][2], ["agent-1"]);
  const off = await compare(
    "post-tool-batch-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 6), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered batch that still called the executor", off.trace.count("executor"), 1);
}

// ---- UserPromptSubmit (upstream `bSe`) -------------------------------------
{
  const { upstream, forwarded, owned } = prepare("user-prompt-submit-hooks", "UserPromptSubmit", 5);
  const constants = { promptSubmitTimeoutMs: PROMPT_SUBMIT_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    ["registered", { registered: true }, ["what is the codeword?", "bypassPermissions", context(), undefined, {}]],
    ["not registered", { registered: false }, ["what is the codeword?", "bypassPermissions", context(), undefined, {}]],
    ["managed only skips the guard", { registered: false }, ["prompt", "default", context(), undefined, { managedHooksOnly: true }]],
    ["managed excluded rides the option spread", { registered: true }, ["prompt", "default", context(), undefined, { managedHooksExcluded: ["plugin"] }]],
    ["an agent id overrides the session id in the lookup", { registered: true }, ["prompt", "default", context({ agentId: "agent-1" }), undefined, {}]],
    ["an empty prompt", { registered: true }, ["", undefined, context(), undefined, {}]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `user-prompt-submit-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 5), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "user-prompt-submit-hooks timeout control",
    { registered: true },
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { timeoutMs: number };
  mustDiffer("the shared 600 s hook timeout used instead of this event's own 30 s", request.timeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
  mustDiffer("the prompt-submit timeout drifting from the pinned declaration", PROMPT_SUBMIT_TIMEOUT_MS, 60000);
  const off = await compare(
    "user-prompt-submit-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered submission that still called the executor", off.trace.count("executor"), 1);
  mustDiffer("the fan-out rule applied to a prompt submission", off.trace.calls("hasHookForEvent")[0][2], ["session-1"]);
}

// ---- Stop / SubagentStop (upstream `y9`) -----------------------------------
{
  const { upstream, forwarded, owned } = prepare("stop-hooks", "SubagentStop", 9);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const messages = [
    { type: "assistant", message: { content: [{ type: "text", text: "the answer" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
  ];
  const toolOnly = [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }];
  const webFetch = { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "parent-1" };
  const cases: [string, StubSpec, unknown[]][] = [
    ["the plain Stop arm", { registered: true }, ["bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, false, undefined, context(), messages, undefined, "turn_end"]],
    ["the SubagentStop arm", { registered: true }, ["bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, false, "agent-1", context(), messages, "general-purpose", "turn_end"]],
    ["a subagent with no declared type", { registered: true }, ["default", undefined, 1000, true, "agent-1", context(), messages, undefined, "turn_end"]],
    ["not registered", { registered: false }, ["default", undefined, 1000, false, undefined, context(), messages, undefined, "turn_end"]],
    ["a delegated-observation subagent refuses outright", { registered: true }, ["default", undefined, 1000, false, undefined, context({ agentContext: { agentType: "subagent", delegatedObservation: true } }), messages, undefined, "turn_end"]],
    ["a web-fetch subagent skips the guard and runs managed-only", { registered: false }, ["default", undefined, 1000, false, "agent-1", context({ agentContext: webFetch }), messages, "web-fetch", "turn_end"]],
    ["the reactions phase with a function hook", { registered: true }, ["default", undefined, 1000, false, undefined, context(), messages, undefined, "turn_end_reactions"]],
    ["the reactions phase with NO function hook", { registered: true }, ["default", undefined, 1000, false, undefined, context({ sessionHooksRegistry: registry(0) }), messages, undefined, "turn_end_reactions"]],
    ["a phase that is neither turn_end nor reactions", { registered: true }, ["default", undefined, 1000, false, undefined, context(), messages, undefined, "session_end"]],
    ["no messages at all", { registered: true }, ["default", undefined, 1000, false, undefined, context(), undefined, undefined, "turn_end"]],
    ["a turn that ended with a tool call and no prose", { registered: true }, ["default", undefined, 1000, false, undefined, context(), toolOnly, undefined, "turn_end"]],
    ["a turn whose last message is whitespace", { registered: true }, ["default", undefined, 1000, false, undefined, context(), [{ type: "assistant", message: { content: [{ type: "text", text: "  \n " }] } }], undefined, "turn_end"]],
    ["stop_hook_active", { registered: true }, ["default", undefined, 1000, true, undefined, context(), messages, undefined, "turn_end"]],
    // No agent context at all: upstream throws, and so must the owned copy.
    ["no agent context — both sides raise", { registered: true }, ["default", undefined, 1000, false, undefined, context({ agentContext: undefined }), messages, undefined, "turn_end"]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `stop-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 9), ...forwarded(p, constants)),
    );
  }
  const sub = await compare(
    "stop-hooks arm control",
    { registered: true },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  const subRecord = (sub.trace.calls("executor")[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  eq("stop-hooks SubagentStop field order", Object.keys(subRecord), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "stop_hook_active",
    "agent_id",
    "agent_transcript_path",
    "agent_type",
    "last_assistant_message",
    "background_tasks",
    "session_crons",
  ]);
  const plain = await compare(
    "stop-hooks plain-arm control",
    { registered: true },
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  const plainRecord = (plain.trace.calls("executor")[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  mustDiffer("the Stop arm carrying the subagent fields", Object.keys(plainRecord), Object.keys(subRecord));
  mustDiffer("the Stop arm resolving an agent transcript path", plain.trace.count("agentTranscriptPath"), 1);
  const toolOnlyRun = await compare(
    "stop-hooks empty-text control",
    { registered: true },
    constants,
    () => upstream(...cases[10][2]),
    (p) => owned(...(cases[10][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  const emptyTextRecord = (toolOnlyRun.trace.calls("executor")[0][0] as { hookInput: { last_assistant_message?: unknown } }).hookInput;
  mustDiffer("an empty last-assistant text carried as \"\" rather than dropped", emptyTextRecord.last_assistant_message, "");
  const reactionsOff = await compare(
    "stop-hooks reactions control",
    { registered: true },
    constants,
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("the reactions phase running without a registered function hook", reactionsOff.trace.count("executor"), 1);
  const delegated = await compare(
    "stop-hooks delegated control",
    { registered: true },
    constants,
    () => upstream(...cases[4][2]),
    (p) => owned(...(cases[4][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("a delegated-observation subagent that still consulted the registry", delegated.trace.count("hasHookForEvent"), 1);
  const managed = await compare(
    "stop-hooks web-fetch control",
    { registered: false },
    constants,
    () => upstream(...cases[5][2]),
    (p) => owned(...(cases[5][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("the web-fetch subagent running with settings hooks as well", (managed.trace.calls("executor")[0][0] as { managedHooksOnly: boolean }).managedHooksOnly, false);
}

// ---- SubagentStart (upstream `kUt`) ----------------------------------------
{
  const { upstream, forwarded, owned } = prepare("subagent-start-hooks", "SubagentStart", 8);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const agentContext = { agentType: "subagent", isBuiltIn: false, subagentName: "general-purpose" };
  const cases: [string, StubSpec, unknown[]][] = [
    ["plain", { registered: true }, [context(), "agent-1", "general-purpose", undefined, DEFAULT_HOOK_TIMEOUT_MS, registry(1), agentContext, undefined]],
    ["managed only", { registered: true }, [context(), "agent-1", "web-fetch", undefined, 1000, registry(1), agentContext, { managedHooksOnly: true }]],
    ["no session hooks and no agent context", { registered: true }, [context(), "agent-2", "explore", undefined, 1000, undefined, undefined, undefined]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `subagent-start-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 8), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "subagent-start-hooks match-query control",
    { registered: true },
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { matchQuery: string; toolUseID: string };
  mustDiffer("the agent ID used as the match query instead of the agent TYPE", request.matchQuery, "agent-1");
  mustDiffer("a real tool-use id expected where this event mints one", request.toolUseID, "tu-1");
  mustDiffer("this dispatcher gaining a registration guard it does not have", trace.count("hasHookForEvent"), 1);
}

// ---- MessageDisplay (upstream `Zqe`) ---------------------------------------
{
  const { upstream, forwarded, owned } = prepare("message-display-hooks", "MessageDisplay", 7);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const message = { turnId: "turn-1", messageId: "msg-1", index: 0, final: true, delta: "the answer" };
  const cases: [string, StubSpec, unknown[]][] = [
    ["a final message", { registered: true }, [SESSION, message, registry(1), undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined, undefined]],
    ["a non-final delta", { registered: true }, [SESSION, { ...message, index: 3, final: false, delta: "partial" }, registry(1), undefined, 1000, { store: "v5" }, { kind: "placeholder" }]],
    ["an empty delta", { registered: true }, [SESSION, { ...message, delta: "" }, undefined, undefined, 1000, undefined, undefined]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `message-display-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 7), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "message-display-hooks id control",
    { registered: true },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 7), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { toolUseID: string; forceSyncExecution: boolean; suppressPerInvocationTelemetry: boolean };
  mustDiffer("the correlation id built from the turn rather than the message", request.toolUseID, "turn-1-3");
  mustDiffer("display hooks deferred rather than run synchronously", request.forceSyncExecution, false);
  mustDiffer("per-invocation telemetry left on for a per-message event", request.suppressPerInvocationTelemetry, false);
  mustDiffer("the common prefix built with a permission mode this event does not have", trace.calls("base")[0].length, 4);
}

// ============================================================================
// 3. THE FOUR DISPATCHERS C8's BOUNDARY REVIEW FOUND LIVE.
//    Each one's corpus scenario grades what its firing condition renders; these
//    grade what no scenario can reach — the refusals, the arms the seam never
//    supplies values for, and (for PreCompact) an entire reduction the engine
//    obeys and a callback cannot influence.
// ============================================================================

// ---- PostToolUseFailure (upstream `zNt`) ------------------------------------
{
  const { upstream, forwarded, owned } = prepare("post-tool-failure-hooks", "PostToolUseFailure", 10);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const webFetch = context({ agentContext: { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "parent-1" }, agentId: "agent-1" });
  const cases: [string, StubSpec, unknown[]][] = [
    ["registered", { registered: true }, ["Bash", "tu-1", { command: "nope" }, "command not found", context(), false, "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, 12]],
    ["not registered", { registered: false }, ["Bash", "tu-1", { command: "nope" }, "command not found", context(), false, "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, 12]],
    ["an INTERRUPT rather than a failure", { registered: true }, ["Bash", "tu-2", { command: "sleep 60" }, "Interrupted", context(), true, "default", undefined, 1000, 900]],
    ["no duration measured", { registered: true }, ["Read", "tu-3", { file_path: "/a" }, "ENOENT", context(), false, "acceptEdits", undefined, 1000, undefined]],
    ["an empty error string", { registered: true }, ["Write", "tu-4", {}, "", context(), false, "default", undefined, 1000, 0]],
    ["an explicit signal", { registered: true }, ["Bash", "tu-5", {}, "boom", context(), false, "default", new AbortController().signal, 1000, 5]],
    ["the executor yields nothing", { registered: true, results: [] }, ["Bash", "tu-6", {}, "boom", context(), false, "default", undefined, 1, 1]],
    // The fan-out set includes this event, so a built-in web-fetch subagent's
    // failure is looked up under the PARENT session's ids as well as its own.
    ["a web-fetch subagent fans the lookup out to its parent", { registered: true }, ["Bash", "tu-7", {}, "boom", webFetch, false, "default", undefined, 1000, 7]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `post-tool-failure-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 10), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "post-tool-failure-hooks order control",
    { registered: true },
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 10), ...forwarded(p, constants)),
  );
  const record = (trace.calls("executor")[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  eq("post-tool-failure-hooks field order", Object.keys(record), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "tool_name",
    "tool_input",
    "tool_use_id",
    "error",
    "is_interrupt",
    "duration_ms",
  ]);
  // The failure record carries an error where its sibling carries a response.
  // A module that copied PostToolUse's record would pass every yield comparison
  // and change what every failure hook in the world reads.
  mustDiffer("the failure record carrying a tool_response like its sibling", Object.keys(record).includes("tool_response"), true);
  mustDiffer("error and tool_use_id swapped in the record", Object.keys(record).join(","), [
    "session_id", "transcript_path", "cwd", "prompt_id", "permission_mode", "effort",
    "hook_event_name", "tool_name", "tool_input", "error", "tool_use_id", "is_interrupt", "duration_ms",
  ].join(","));
  const request = trace.calls("executor")[0][0] as Record<string, unknown>;
  mustDiffer("a managed-hooks option forwarded, which this dispatcher does not take", "managedHooksOnly" in request, true);
  const refused = await compare(
    "post-tool-failure-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 10), ...forwarded(p, constants)),
  );
  mustDiffer("a refusal that still built the record", refused.trace.count("base"), 1);
  mustDiffer("a refusal that still called the executor", refused.trace.count("executor"), 1);
}

// ---- SessionStart (upstream `vUt`) ------------------------------------------
{
  const { upstream, forwarded, owned } = prepare("session-start-hooks", "SessionStart", 12);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS, activityHold: ACTIVITY_HOLD };
  const cases: [string, StubSpec, unknown[]][] = [
    // What the corpus actually renders: every tail field undefined, which is why
    // only five of the record's ten keys survive JSON onto a hook's stdin.
    ["the headless shape", { registered: true }, [SESSION, "startup", undefined, undefined, undefined, undefined, undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined, undefined, undefined, undefined]],
    ["a session id OVERRIDE builds a synthetic session", { registered: true }, [SESSION, "resume", "other-session", undefined, undefined, undefined, undefined, DEFAULT_HOOK_TIMEOUT_MS, undefined, undefined, undefined, undefined]],
    ["an explicit title beats the lookup", { registered: true }, [SESSION, "startup", undefined, "a given title", undefined, undefined, undefined, 1000, undefined, undefined, undefined, undefined]],
    ["a subagent start", { registered: true }, [SESSION, "startup", undefined, undefined, "general-purpose", "claude-sonnet-5", undefined, 1000, true, undefined, { store: "v5" }, { kind: "k" }]],
    ["extra fields are merged LAST and may override a named one", { registered: true }, [SESSION, "clear", undefined, undefined, "explorer", "claude-opus-5", undefined, 1000, false, { model: "overridden", extra: 1 }, undefined, undefined]],
    ["an explicit signal", { registered: true }, [SESSION, "startup", undefined, undefined, undefined, undefined, new AbortController().signal, 1000, undefined, undefined, undefined, undefined]],
    ["the executor yields nothing", { registered: true, results: [] }, [SESSION, "startup", undefined, undefined, undefined, undefined, undefined, 1, undefined, undefined, undefined, undefined]],
    // The hold has to be released even when the executor throws — the `finally`
    // is the difference between an idle session and one wedged open forever.
    ["the executor THROWS and the hold is still released", { registered: true, executorThrows: "executor exploded" }, [SESSION, "startup", undefined, undefined, undefined, undefined, undefined, 1000, undefined, undefined, undefined, undefined]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `session-start-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 12), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "session-start-hooks override control",
    { registered: true },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 12), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { session: { id: string }; hookInput: Record<string, unknown> };
  eq("session-start-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "source",
    "agent_type",
    "model",
    "session_title",
  ]);
  // Two sessions in one call: the RECORD describes the override, the EXECUTOR is
  // still given the real session. Collapsing them either stamps the wrong id or
  // runs the hooks against the wrong registry, and nothing else here sees it.
  mustDiffer("the executor handed the synthetic session instead of the real one", request.session.id, "coerced:other-session");
  mustDiffer("the title derived from the REAL session id rather than the record's", trace.calls("sessionTitle")[0], ["session-1"]);
  const spread = await compare(
    "session-start-hooks spread control",
    { registered: true },
    constants,
    () => upstream(...cases[4][2]),
    (p) => owned(...(cases[4][2] as unknown[]).slice(0, 12), ...forwarded(p, constants)),
  );
  const spreadRecord = (spread.trace.calls("executor")[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  mustDiffer("the extra fields merged BEFORE the named ones, so the named one wins", spreadRecord.model, "claude-opus-5");
  const threw = await compare(
    "session-start-hooks hold control",
    { registered: true, executorThrows: "executor exploded" },
    constants,
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 12), ...forwarded(p, constants)),
  );
  // The same intent as before the log rewrite — a `finally` that does not run
  // leaves the hold taken — restated against the lifecycle edges rather than
  // against a formatted string. The hold's REASON is still graded: it rides in
  // the `beginActivity` event's arguments inside the ordered log, which is
  // compared whole. And this control now has a second, stronger reading below:
  // `unpaired()` states the leak as a PROPERTY of one run, which no comparison
  // between two leaking sides could ever state.
  // The same intent as before the log rewrite — a `finally` that does not run
  // leaves the hold taken — restated against the lifecycle EDGES rather than
  // against a formatted string. The hold's reason still rides in the
  // `beginActivity` event's arguments inside the compared log, and it has its
  // own constant control on the next line. The stronger reading is the property
  // rather than this comparison: `unpaired()` states the leak over ONE run,
  // which no comparison between two equally leaking sides could state.
  mustDiffer("the hold left un-released when the executor throws", threw.trace.lifecycle(), ["acquire:activity:hook_exec"]);
  mustDiffer("the hold released without ever being taken", threw.trace.lifecycle(), ["release:activity:hook_exec"]);
  mustDiffer("the hold's reason string drifting from the pinned declaration", ACTIVITY_HOLD, "hook-hold");
  mustDiffer("the timeout constant drifting from the pinned declaration", DEFAULT_HOOK_TIMEOUT_MS, 60000);
}

// ---- SessionEnd (upstream `ZSe`) — not a generator --------------------------
{
  const { upstream, forwarded, owned } = prepareAwaited("session-end-hooks", "SessionEnd", 3);
  const constants = { sessionEndTimeoutMs: SESSION_END_TIMEOUT_MS };
  const result = (over: Record<string, unknown>) => ({ succeeded: true, blocked: false, cancelled: false, output: "", command: "hook.sh", ...over });
  const specs: [string, StubSpec][] = [
    ["nothing ran", { registered: true, awaitResults: [] }],
    ["one hook succeeded quietly", { registered: true, awaitResults: [result({})] }],
    ["one hook succeeded with output", { registered: true, awaitResults: [result({ output: "all good" })] }],
    // The reporting policy, which is the whole reason the results are drained.
    ["one hook FAILED with output", { registered: true, awaitResults: [result({ succeeded: false, output: "it broke" })] }],
    ["one hook failed with NO output", { registered: true, awaitResults: [result({ succeeded: false, output: "" })] }],
    ["a mix of failures and successes", { registered: true, awaitResults: [result({ succeeded: false, output: "first" }), result({ output: "quiet" }), result({ succeeded: false, output: "second", command: "other.sh" })] }],
  ];
  const optionSets: [string, (p: PortSet) => unknown][] = [
    ["with every option", (p) => ({ sessionHooks: p.sessionHooks, getAppState: () => ({ state: 1 }), signal: undefined, storageV5: { store: "v5" }, credentials: { kind: "k" } })],
    // Upstream's `r||{}`: called with nothing, every option destructures to
    // undefined and the executor still runs. That is the ordinary-teardown
    // shape, where the settings layers resolve with no registry at all.
    ["with no options at all", () => undefined],
  ];
  for (const [label, spec] of specs) {
    for (const [optLabel, options] of optionSets) {
      for (const reason of ["clear", "resume"]) {
        await compareValue(
          `session-end-hooks ${label}, ${optLabel}, reason=${reason}`,
          spec,
          (p) => upstream(SESSION, reason, options(p)),
          (p) => owned(SESSION, reason, options(p), ...forwarded(p, constants)),
        );
      }
    }
  }
  const { trace } = await compareValue(
    "session-end-hooks report control",
    specs[3][1],
    (p) => upstream(SESSION, "clear", optionSets[0][1](p)),
    (p) => owned(SESSION, "clear", optionSets[0][1](p), ...forwarded(p, constants)),
  );
  // …and on an AWAITING dispatcher, whose ports differ from the streaming
  // family's and whose stderr reporting is interleaved with them.
  orderControl("session-end-hooks: the ordered log sees a port swap the per-port lists cannot", trace);
  eq("session-end-hooks field order", Object.keys((trace.calls("executorAwait")[0][0] as { hookInput: Record<string, unknown> }).hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "reason",
  ]);
  mustDiffer("a failed hook reported without naming the command that failed", trace.writes("stderr"), ["SessionEnd hook failed: it broke\n"]);
  mustDiffer("the registry left uncleared", trace.calls("registryClear"), []);
  const quiet = await compareValue(
    "session-end-hooks silence control",
    specs[2][1],
    (p) => upstream(SESSION, "clear", optionSets[0][1](p)),
    (p) => owned(SESSION, "clear", optionSets[0][1](p), ...forwarded(p, constants)),
  );
  mustDiffer("a SUCCEEDED hook's output written to stderr as well", quiet.trace.count("stderr"), 1);
  const empty = await compareValue(
    "session-end-hooks teardown control",
    specs[0][1],
    (p) => upstream(SESSION, "clear", optionSets[0][1](p)),
    (p) => owned(SESSION, "clear", optionSets[0][1](p), ...forwarded(p, constants)),
  );
  mustDiffer("the clear skipped when no hook ran", empty.trace.calls("registryClear"), []);
  mustDiffer("this event's own 1500 ms timeout replaced by the shared one", SESSION_END_TIMEOUT_MS, DEFAULT_HOOK_TIMEOUT_MS);
}

// ---- PreCompact (upstream `tz`) — not a generator, and its result is obeyed --
{
  const { upstream, forwarded, owned } = prepareAwaited("pre-compact-hooks", "PreCompact", 5);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const r = (over: Record<string, unknown>) => ({ succeeded: true, blocked: false, cancelled: false, output: "", command: "hook.sh", ...over });
  const delegated = context({ agentContext: { agentType: "subagent", delegatedObservation: true } });
  const cases: [string, StubSpec, unknown[]][] = [
    // Upstream's early return: ZERO results is not the same as results that said
    // nothing — it returns `{}`, with none of the verdict's keys present.
    ["nothing ran", { registered: true, awaitResults: [] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["one hook ran and said nothing", { registered: true, awaitResults: [r({})] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["one hook added instructions", { registered: true, awaitResults: [r({ output: "  keep the plan  " })] }, [SESSION, { trigger: "auto", customInstructions: "focus on X" }, context(), undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["two hooks added instructions", { registered: true, awaitResults: [r({ output: "first" }), r({ output: "second", command: "other.sh" })] }, [SESSION, { trigger: "auto", customInstructions: null }, context(), undefined, 1000]],
    ["a hook FAILED with output", { registered: true, awaitResults: [r({ succeeded: false, output: "it broke" })] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, 1000]],
    ["a hook failed with NO output", { registered: true, awaitResults: [r({ succeeded: false, output: "" })] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, 1000]],
    ["a hook BLOCKED with a reason", { registered: true, awaitResults: [r({ blocked: true, output: "not now" })] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, 1000]],
    ["a hook blocked with no reason", { registered: true, awaitResults: [r({ blocked: true, output: "" })] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), undefined, 1000]],
    // A cancelled hook is narrated as nothing — but it is NOT excluded from the
    // instruction filter, which reads succeeded/blocked/output alone. The
    // asymmetry is upstream's, and it is invisible to every other surface.
    ["a CANCELLED hook is silent but still contributes instructions", { registered: true, awaitResults: [r({ cancelled: true, output: "still counted" })] }, [SESSION, { trigger: "auto", customInstructions: null }, context(), undefined, 1000]],
    ["everything at once", { registered: true, awaitResults: [r({ output: "instr" }), r({ succeeded: false, output: "broke", command: "b.sh" }), r({ blocked: true, output: "no", command: "c.sh" }), r({ cancelled: true, output: "hidden", command: "d.sh" })] }, [SESSION, { trigger: "manual", customInstructions: "given" }, context(), undefined, 1000]],
    // The delegated-observation arm: blocking only, no instructions, no display.
    ["a delegated-observation subagent gets a blocking-only verdict", { registered: true, awaitResults: [r({ output: "instr" }), r({ blocked: true, output: "no" })] }, [SESSION, { trigger: "auto", customInstructions: null }, delegated, undefined, 1000]],
    ["a delegated-observation subagent with nothing blocking", { registered: true, awaitResults: [r({ output: "instr" })] }, [SESSION, { trigger: "auto", customInstructions: null }, delegated, undefined, 1000]],
    ["an explicit signal", { registered: true, awaitResults: [r({})] }, [SESSION, { trigger: "manual", customInstructions: null }, context(), new AbortController().signal, 1000]],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `pre-compact-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 5), ...forwarded(p, constants)),
    );
  }
  const { trace, upstream: verdict } = await compareValue(
    "pre-compact-hooks verdict control",
    cases[9][1],
    () => upstream(...cases[9][2]),
    (p) => owned(...(cases[9][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  eq("pre-compact-hooks field order", Object.keys((trace.calls("executorAwait")[0][0] as { hookInput: Record<string, unknown> }).hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "trigger",
    "custom_instructions",
  ]);
  const v = verdict.returned as { newCustomInstructions?: string; userDisplayMessage?: string; blockedBy?: string };
  // Each separator is a different message reaching the model or the operator.
  mustDiffer("instructions joined by a newline rather than a blank line", v.newCustomInstructions, "instr");
  mustDiffer("display lines joined by a blank line rather than a newline", v.userDisplayMessage, v.userDisplayMessage?.split("\n").join("\n\n"));
  mustDiffer("a cancelled hook narrated in the display message", v.userDisplayMessage?.includes("hidden"), true);
  mustDiffer("blocking computed from FAILURE rather than the blocked flag", v.blockedBy, "[b.sh]: broke\n[c.sh]: no");
  const nothing = await compareValue(
    "pre-compact-hooks empty-verdict control",
    cases[0][1],
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  // `{}` and `{newCustomInstructions: undefined, userDisplayMessage: undefined}`
  // are the same JSON, so the control asserts the KEYS: a module that fell
  // through to the general return instead of taking the early one is a
  // difference only this sees.
  mustDiffer("the zero-results arm falling through to the full verdict", Object.keys(nothing.upstream.returned as object), [
    "newCustomInstructions",
    "userDisplayMessage",
  ]);
  const obs = await compareValue(
    "pre-compact-hooks delegated-observation control",
    cases[10][1],
    () => upstream(...cases[10][2]),
    (p) => owned(...(cases[10][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  mustDiffer("the delegated arm returning the full verdict", Object.keys(obs.upstream.returned as object), [
    "newCustomInstructions",
    "userDisplayMessage",
    "blockedBy",
  ]);
}

// ============================================================================
// 4. THE NINE DISPATCHERS C8's SECOND ROUND FOUND LIVE.
//    The first round re-measured the hook set but still chose its own watched
//    list; this one derives the population from upstream's dispatcher registry
//    and creates a firing condition per event. Twenty-three fire. Each of these
//    nine has a corpus scenario that grades what its condition renders; this
//    section grades what no scenario can — the refusals, the fields the seam
//    never fills, and the executor requests that are where one dispatcher
//    differs from another.
// ============================================================================

// ---- PostCompact (upstream `kPe`) — not a generator; PreCompact's sibling ----
{
  const { upstream, forwarded, owned } = prepareAwaited("post-compact-hooks", "PostCompact", 5);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const r = (over: Record<string, unknown>) => ({ succeeded: true, blocked: false, cancelled: false, output: "", command: "hook.sh", ...over });
  const delegated = context({ agentContext: { agentType: "subagent", delegatedObservation: true } });
  const req = (over: Record<string, unknown> = {}) => ({ trigger: "manual", compactSummary: "the summary text", ...over });
  const cases: [string, StubSpec, unknown[]][] = [
    ["nothing ran", { registered: true, awaitResults: [] }, [SESSION, req(), context(), undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["one hook ran and said nothing", { registered: true, awaitResults: [r({})] }, [SESSION, req(), context(), undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["one hook succeeded with output", { registered: true, awaitResults: [r({ output: "  narrate me  " })] }, [SESSION, req({ trigger: "auto" }), context(), undefined, 1000]],
    ["a hook FAILED with output", { registered: true, awaitResults: [r({ succeeded: false, output: "it broke" })] }, [SESSION, req(), context(), undefined, 1000]],
    ["a hook failed with NO output", { registered: true, awaitResults: [r({ succeeded: false, output: "" })] }, [SESSION, req(), context(), undefined, 1000]],
    // Upstream's loop tests `succeeded` alone here, where PreCompact's tests
    // `succeeded && !blocked` — so a BLOCKED-but-succeeded result is narrated as
    // a SUCCESS by this dispatcher and as nothing by its sibling. There is
    // nothing left to block once the summary exists, and this is the byte-level
    // trace of that.
    ["a hook that blocked but succeeded", { registered: true, awaitResults: [r({ blocked: true, output: "too late" })] }, [SESSION, req(), context(), undefined, 1000]],
    ["a CANCELLED hook is narrated as nothing", { registered: true, awaitResults: [r({ cancelled: true, output: "hidden" })] }, [SESSION, req(), context(), undefined, 1000]],
    ["everything at once", { registered: true, awaitResults: [r({ output: "one" }), r({ succeeded: false, output: "two", command: "b.sh" }), r({ cancelled: true, output: "hidden", command: "c.sh" }), r({ succeeded: false, output: "", command: "d.sh" })] }, [SESSION, req(), context(), undefined, 1000]],
    // Decided BEFORE the executor and returned immediately: unlike PreCompact,
    // whose delegated arm still RUNS the hooks and only drops their reporting,
    // this one never reaches the executor at all.
    ["a delegated-observation subagent", { registered: true, awaitResults: [r({ output: "one" })] }, [SESSION, req(), delegated, undefined, 1000]],
    ["an explicit signal", { registered: true, awaitResults: [r({})] }, [SESSION, req({ trigger: "auto" }), context(), new AbortController().signal, 1000]],
    ["an empty summary", { registered: true, awaitResults: [r({})] }, [SESSION, req({ compactSummary: "" }), context(), undefined, 1000]],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `post-compact-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 5), ...forwarded(p, constants)),
    );
  }
  const { trace, upstream: verdict } = await compareValue(
    "post-compact-hooks verdict control",
    cases[7][1],
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  eq("post-compact-hooks field order", Object.keys((trace.calls("executorAwait")[0][0] as { hookInput: Record<string, unknown> }).hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "trigger",
    "compact_summary",
  ]);
  const v = verdict.returned as { userDisplayMessage?: string };
  mustDiffer("display lines joined by a blank line rather than a newline", v.userDisplayMessage, v.userDisplayMessage?.split("\n").join("\n\n"));
  mustDiffer("a cancelled hook narrated in the display message", v.userDisplayMessage?.includes("hidden"), true);
  mustDiffer("the sibling's PreCompact prefix on this event's lines", v.userDisplayMessage?.includes("PostCompact ["), false);
  mustDiffer("this dispatcher gaining PreCompact's instruction reduction", Object.keys(verdict.returned as object), ["newCustomInstructions", "userDisplayMessage"]);
  const nothing = await compareValue(
    "post-compact-hooks empty-verdict control",
    cases[0][1],
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  // `{}` and `{userDisplayMessage: undefined}` are the same JSON, so the control
  // asserts the KEYS: falling through to the general return instead of taking
  // the early one is a difference nothing else here sees.
  mustDiffer("the zero-results arm falling through to the full verdict", Object.keys(nothing.upstream.returned as object), ["userDisplayMessage"]);
  const obs = await compareValue(
    "post-compact-hooks delegated-observation control",
    cases[8][1],
    () => upstream(...cases[8][2]),
    (p) => owned(...(cases[8][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  mustDiffer("the delegated arm still running the hooks", obs.trace.count("executorAwait"), 1);
}

// ---- Notification (upstream `EE`) — the family's simplest awaited one --------
{
  const { upstream, forwarded, owned } = prepareAwaited("notification-hooks", "Notification", 3);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const note = (over: Record<string, unknown> = {}) => ({ message: "a tool needs your approval", notificationType: "permission_request", ...over });
  const cases: [string, StubSpec, unknown[]][] = [
    // The permission-timer caller's shape: a message and a type, no title. The
    // record still BUILDS a `title` key, set to undefined — which JSON drops on
    // the way to a command hook's stdin, and which the corpus therefore grades
    // as an absence while this grades it as a present-but-undefined key.
    ["no title, no options", { registered: true }, [SESSION, note(), undefined]],
    ["no title, an empty options bag", { registered: true }, [SESSION, note(), {}]],
    ["with a title", { registered: true }, [SESSION, note({ title: "Claude Code" }), {}]],
    ["with every option", { registered: true }, [SESSION, note({ title: "t" }), { timeoutMs: 1000, storageV5: { store: "v5" }, credentials: { kind: "k" } }]],
    ["a different notification type", { registered: true }, [SESSION, note({ notificationType: "idle" }), {}]],
    ["a notification with no type at all", { registered: true }, [SESSION, { message: "bare" }, {}]],
    // The results ARE returned by the executor and are dropped on the floor —
    // nothing reads them, and the dispatcher returns undefined either way.
    ["results that nothing reads", { registered: true, awaitResults: [{ succeeded: true, output: "ignored", command: "hook.sh" }] }, [SESSION, note(), {}]],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `notification-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 3), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compareValue(
    "notification-hooks request control",
    cases[3][1],
    () => upstream(...cases[3][2]),
    (p) => owned(...(cases[3][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  const request = trace.calls("executorAwait")[0][0] as { matchQuery: string; hookInput: Record<string, unknown> };
  eq("notification-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "message",
    "title",
    "notification_type",
  ]);
  mustDiffer("the message used as the match query instead of the notification TYPE", request.matchQuery, "a tool needs your approval");
  mustDiffer("the common prefix built with a permission mode this event does not pass", trace.calls("base")[0].length, 4);
  const defaulted = await compareValue(
    "notification-hooks timeout-default control",
    cases[0][1],
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  mustDiffer(
    "the timeout left undefined when the caller passes no options",
    (defaulted.trace.calls("executorAwait")[0][0] as { timeoutMs: unknown }).timeoutMs,
    undefined,
  );
}

// ---- InstructionsLoaded (upstream `Qqe`) ------------------------------------
{
  const { upstream, forwarded, owned } = prepareAwaited("instructions-loaded-hooks", "InstructionsLoaded", 5);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    // The recorded seam: a top-level project memory, no options at all. Three of
    // the record's six event-specific fields are undefined here, which is
    // exactly what `hooks-memory` grades as absence.
    ["a project memory with no options", { registered: true }, [SESSION, "/repo/CLAUDE.md", "Project", "startup", undefined]],
    ["an empty options bag", { registered: true }, [SESSION, "/repo/CLAUDE.md", "Project", "startup", {}]],
    ["a glob-matched memory", { registered: true }, [SESSION, "/repo/src/CLAUDE.md", "Project", "path_glob_match", { globs: ["src/**"], triggerFilePath: "/repo/src/a.ts" }]],
    ["an included memory with a parent", { registered: true }, [SESSION, "/repo/inc.md", "Project", "include", { parentFilePath: "/repo/CLAUDE.md" }]],
    ["a nested traversal", { registered: true }, [SESSION, "/repo/a/b/CLAUDE.md", "Local", "nested_traversal", { globs: undefined, triggerFilePath: undefined, parentFilePath: undefined }]],
    ["a user memory", { registered: true }, [SESSION, "/home/u/.claude/CLAUDE.md", "User", "startup", {}]],
    ["a managed memory with every option", { registered: true }, [SESSION, "/etc/managed.md", "Managed", "startup", { globs: ["**"], triggerFilePath: "/t", parentFilePath: "/p", timeoutMs: 1000, storageV5: { store: "v5" }, credentials: { kind: "k" } }]],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `instructions-loaded-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 5), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compareValue(
    "instructions-loaded-hooks request control",
    cases[6][1],
    () => upstream(...cases[6][2]),
    (p) => owned(...(cases[6][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  const request = trace.calls("executorAwait")[0][0] as { matchQuery: string; hookInput: Record<string, unknown> };
  eq("instructions-loaded-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "file_path",
    "memory_type",
    "load_reason",
    "globs",
    "trigger_file_path",
    "parent_file_path",
  ]);
  mustDiffer("the memory TYPE used as the match query instead of the load reason", request.matchQuery, "Managed");
  mustDiffer("the options bag's own keys copied through verbatim rather than renamed to snake_case", request.hookInput.triggerFilePath, "/t");
  const bare = await compareValue(
    "instructions-loaded-hooks absent-options control",
    cases[0][1],
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  const bareRequest = bare.trace.calls("executorAwait")[0][0] as { timeoutMs: unknown; hookInput: Record<string, unknown> };
  mustDiffer("the three optional fields dropped rather than set to undefined", Object.keys(bareRequest.hookInput).length, 10);
  mustDiffer("the timeout left undefined when the caller passes no options", bareRequest.timeoutMs, undefined);
}

// ---- StopFailure (upstream `HPe`) — the turn-end dispatcher's failure arm ----
{
  const { upstream, forwarded, owned } = prepareAwaited("stop-failure-hooks", "StopFailure", 3);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const message = (content: unknown[], over: Record<string, unknown> = {}) => ({ message: { content }, error: "api_error", errorDetails: "500 from upstream", ...over });
  const delegated = context({ agentContext: { agentType: "subagent", delegatedObservation: true } });
  const cases: [string, StubSpec, unknown[]][] = [
    // The REFUSALS, which are the common case and which no scenario can record:
    // a run with no hook registered produces no consult, no record, no observable.
    ["no hook registered", { registered: false }, [message([{ type: "text", text: "partial answer" }]), context(), DEFAULT_HOOK_TIMEOUT_MS]],
    ["a delegated-observation subagent", { registered: true }, [message([{ type: "text", text: "partial answer" }]), delegated, DEFAULT_HOOK_TIMEOUT_MS]],
    ["a failing turn that had produced text", { registered: true }, [message([{ type: "text", text: "partial answer" }]), context(), DEFAULT_HOOK_TIMEOUT_MS]],
    // The empty-join coercion: `"" || undefined` is undefined, which JSON drops.
    ["a failing turn with NO text at all", { registered: true }, [message([{ type: "tool_use", name: "Bash" }]), context(), 1000]],
    ["a failing turn whose text is whitespace", { registered: true }, [message([{ type: "text", text: "   " }]), context(), 1000]],
    ["two text blocks, joined by a NEWLINE", { registered: true }, [message([{ type: "text", text: "a" }, { type: "text", text: "b" }]), context(), 1000]],
    // `e.error ?? "unknown"` — the record never carries an undefined error, and
    // the fallback is also the match query.
    ["no error kind at all", { registered: true }, [message([{ type: "text", text: "x" }], { error: undefined }), context(), 1000]],
    ["no error details", { registered: true }, [message([{ type: "text", text: "x" }], { errorDetails: undefined }), context(), 1000]],
    ["a prompt_too_long failure", { registered: true }, [message([{ type: "text", text: "x" }], { error: "prompt_too_long" }), context(), 1000]],
    ["an app-state reader on the context", { registered: true }, [message([{ type: "text", text: "x" }]), context({ getAppState: () => ({ state: 1 }) }), 1000]],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `stop-failure-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 3), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compareValue(
    "stop-failure-hooks request control",
    cases[2][1],
    () => upstream(...cases[2][2]),
    (p) => owned(...(cases[2][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  const request = trace.calls("executorAwait")[0][0] as { matchQuery: string; sessionHooks: unknown; getAppState: unknown; hookInput: Record<string, unknown> };
  eq("stop-failure-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "error",
    "error_details",
    "last_assistant_message",
  ]);
  // The registration guard is called with the SESSION ID, not with the
  // permission-scoped agent fan-out every tool event uses.
  eq("stop-failure-hooks guard arguments", trace.calls("hasHookForEvent")[0], ["StopFailure", trace.calls("hasHookForEvent")[0][1], "session-1"]);
  mustDiffer("the guard keyed on the agent fan-out rather than the session id", trace.calls("hasHookForEvent")[0][2], ["agent-1"]);
  mustDiffer("the session hooks registry left off the executor request", request.sessionHooks, undefined);
  mustDiffer("the app-state reader left off the executor request", "getAppState" in request, false);
  mustDiffer("the error kind not used as the match query", request.matchQuery, "StopFailure");
  const refused = await compareValue(
    "stop-failure-hooks refusal control",
    cases[0][1],
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered session still reaching the executor", refused.trace.count("executorAwait"), 1);
  mustDiffer("an unregistered session still building a record", refused.trace.count("base"), 1);
  const obs = await compareValue(
    "stop-failure-hooks delegated-observation control",
    cases[1][1],
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  mustDiffer("the delegated guard checked AFTER the registration guard", obs.trace.count("hasHookForEvent"), 1);
  const silent = await compareValue(
    "stop-failure-hooks empty-text control",
    cases[3][1],
    () => upstream(...cases[3][2]),
    (p) => owned(...(cases[3][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  mustDiffer(
    "an empty join left as the empty string rather than coerced to undefined",
    (silent.trace.calls("executorAwait")[0][0] as { hookInput: { last_assistant_message: unknown } }).hookInput.last_assistant_message,
    "",
  );
  const unknownError = await compareValue(
    "stop-failure-hooks unknown-error control",
    cases[6][1],
    () => upstream(...cases[6][2]),
    (p) => owned(...(cases[6][2] as unknown[]).slice(0, 3), ...forwarded(p, constants)),
  );
  mustDiffer(
    "a missing error kind left undefined rather than falling back to 'unknown'",
    (unknownError.trace.calls("executorAwait")[0][0] as { hookInput: { error: unknown } }).hookInput.error,
    undefined,
  );
}

// ---- TaskCreated / TaskCompleted (upstream `xUt` / `eGe`) — near-twins -------
for (const [row, event] of [
  ["task-created-hooks", "TaskCreated"],
  ["task-completed-hooks", "TaskCompleted"],
] as [string, string][]) {
  const { upstream, forwarded, owned } = prepare(row, event, 9);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    // The headless seam: no teammate, no team. Both fields are BUILT and left
    // undefined, so JSON drops them — which is what `hooks-tasks` grades.
    ["a solo task", { registered: true }, ["task-1", "the subject", "the description", undefined, undefined, "bypassPermissions", undefined, DEFAULT_HOOK_TIMEOUT_MS, context()]],
    ["a teammate's task", { registered: true }, ["task-2", "s", "d", "ada", "the team", "default", undefined, 1000, context()]],
    ["no permission mode", { registered: true }, ["task-3", "s", "d", undefined, undefined, undefined, undefined, 1000, context()]],
    ["an explicit signal", { registered: true }, ["task-4", "s", "d", undefined, undefined, "default", new AbortController().signal, 1000, context()]],
    ["an empty subject and description", { registered: true }, ["task-5", "", "", undefined, undefined, "default", undefined, 1000, context()]],
    ["a subagent context", { registered: true }, ["task-6", "s", "d", undefined, undefined, "default", undefined, 1000, context({ agentId: "agent-1", agentContext: { agentType: "subagent", isBuiltIn: false, subagentName: "explore" } })]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `${row} ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 9), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    `${row} request control`,
    { registered: true },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { toolUseID: string; hookInput: Record<string, unknown> };
  eq(`${row} field order`, Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "task_id",
    "task_subject",
    "task_description",
    "teammate_name",
    "team_name",
  ]);
  eq(`${row} stamps its own event`, request.hookInput.hook_event_name, event);
  // Three claims a twin could quietly break: these two dispatchers pass NO match
  // query (so a matcher cannot narrow by task), MINT a tool-use id (there is no
  // real tool call to correlate to), and build the common prefix with THREE
  // arguments — the tool-use context is in hand and handed to the executor, but
  // is not passed to the prefix builder, so `agent_id` and `effort` come out
  // undefined and `agent_type` falls back to the ambient default.
  mustDiffer("a match query added, letting a matcher narrow by task", "matchQuery" in request, true);
  mustDiffer("a real tool-use id expected where this event mints one", request.toolUseID, "tu-1");
  mustDiffer("the common prefix given the tool-use context as its fourth argument", trace.calls("base")[0].length, 4);
  mustDiffer("the twin's event name stamped instead of this one's", request.hookInput.hook_event_name, event === "TaskCreated" ? "TaskCompleted" : "TaskCreated");
  mustDiffer("this dispatcher gaining a registration guard it does not have", trace.count("hasHookForEvent"), 1);
}

// ---- PermissionRequest (upstream `Tee`) -------------------------------------
{
  const { upstream, forwarded, owned } = prepare("permission-request-hooks", "PermissionRequest", 8);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    ["a plain consult", { registered: true }, ["Bash", "toolu_1", { command: "mkdir -p x" }, context(), "default", undefined, undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["with permission suggestions", { registered: true }, ["Bash", "toolu_2", { command: "rm -rf /" }, context(), "default", [{ type: "addRules", rules: [{ toolName: "Bash" }] }], undefined, 1000]],
    ["an empty suggestion list", { registered: true }, ["Write", "toolu_3", { file_path: "/a" }, context(), "acceptEdits", [], undefined, 1000]],
    ["an explicit signal", { registered: true }, ["Read", "toolu_4", { file_path: "/a" }, context(), "plan", undefined, new AbortController().signal, 1000]],
    ["a subagent context", { registered: true }, ["Bash", "toolu_5", {}, context({ agentId: "agent-1", agentContext: { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "p" } }), "default", undefined, undefined, 1000]],
    // The permission chain calls this with a result-shaped stream, and a hook
    // for this event can allow, deny or rewrite — so the yielded sequence is
    // the contract, not a side effect.
    ["hooks that answer the request", { registered: true, results: [{ permissionRequestResult: { behavior: "allow", updatedInput: { command: "safe" } } }, { permissionRequestResult: { behavior: "deny", message: "no" } }] }, ["Bash", "toolu_6", { command: "x" }, context(), "default", undefined, undefined, 1000]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `permission-request-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 8), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "permission-request-hooks request control",
    cases[1][1],
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { toolUseID: string; matchQuery: string; hookInput: Record<string, unknown> };
  eq("permission-request-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "tool_name",
    "tool_input",
    "permission_suggestions",
  ]);
  eq("permission-request-hooks logs its entry", trace.calls("log")[0], ["executePermissionRequestHooks called for tool: Bash"]);
  mustDiffer("the entry log dropped", trace.count("log"), 0);
  mustDiffer("a log level passed where upstream passes one argument", trace.calls("log")[0].length, 2);
  // The only tool-scoped dispatcher that forwards the REAL tool-use id: at this
  // point the call exists and has not run, so there is something to correlate to.
  mustDiffer("a minted uuid used where the real tool-use id is in hand", request.toolUseID, "44444444-4444-4444-8444-444444444444");
  mustDiffer("the tool-use id used as the match query instead of the tool name", request.matchQuery, "toolu_2");
  mustDiffer("a tool_use_id field added to the record", "tool_use_id" in request.hookInput, true);
  mustDiffer("this dispatcher gaining a registration guard it does not have", trace.count("hasHookForEvent"), 1);
}

// ---- PermissionDenied (upstream `VNt`) --------------------------------------
// The corpus reaches this dispatcher on ONE condition — the auto-mode
// classifier's fail-closed deny — so everything about it that is not that
// condition is graded here: the registration guard's refusal (unrecordable by
// construction, since a run with no hook registered produces no observable), the
// reasons other than the classifier's that the FUNCTION accepts even though its
// call site never passes them, and the fan-out agent ids the guard reads under.
{
  const { upstream, forwarded, owned } = prepare("permission-denied-hooks", "PermissionDenied", 8);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    // The guard's refusal, and the reason this block exists at all: no scenario
    // can record a dispatcher that returns before building anything.
    ["no hook registered", { registered: false }, ["Bash", "toolu_1", { command: "chmod 600 x" }, "Classifier unavailable", context(), "auto", undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["the classifier's fail-closed deny", { registered: true }, ["Bash", "toolu_1", { command: "chmod 600 x" }, "Classifier unavailable", context(), "auto", undefined, DEFAULT_HOOK_TIMEOUT_MS]],
    ["a reason the call site never passes", { registered: true }, ["Write", "toolu_2", { file_path: "/a" }, "Permission denied", context(), "default", undefined, 1000]],
    ["an empty reason", { registered: true }, ["Read", "toolu_3", { file_path: "/a" }, "", context(), "dontAsk", undefined, 1000]],
    ["no permission mode", { registered: true }, ["Bash", "toolu_4", {}, "why", context(), undefined, undefined, 1000]],
    ["an explicit signal", { registered: true }, ["Bash", "toolu_5", {}, "why", context(), "auto", new AbortController().signal, 1000]],
    ["a subagent context", { registered: true }, ["Bash", "toolu_6", {}, "why", context({ agentId: "agent-1", agentContext: { agentType: "subagent", isBuiltIn: true, subagentName: "web-fetch", parentAgentId: "p" } }), "auto", undefined, 1000]],
    // The results are a CHANNEL here: the caller reads `retry` off them and, if
    // any hook asks, invites another attempt. A dispatcher that reordered or
    // dropped them changes what the turn does next.
    ["hooks that ask for a retry", { registered: true, results: [{ retry: false }, { retry: true }] }, ["Bash", "toolu_7", { command: "x" }, "Classifier unavailable", context(), "auto", undefined, 1000]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `permission-denied-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 8), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "permission-denied-hooks request control",
    cases[1][1],
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { toolUseID: string; matchQuery: string; hookInput: Record<string, unknown> };
  eq("permission-denied-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "tool_name",
    "tool_input",
    "tool_use_id",
    "reason",
  ]);
  eq("permission-denied-hooks stamps its own event", request.hookInput.hook_event_name, "PermissionDenied");
  eq("permission-denied-hooks asks its guard once", trace.count("hasHookForEvent"), 1);
  // What separates it from the sibling it is otherwise a copy of, and what a
  // twin could quietly break.
  mustDiffer("the registration guard dropped, dispatching on every session in the world", trace.count("hasHookForEvent"), 0);
  mustDiffer("a minted uuid used where the real tool-use id is in hand", request.toolUseID, "44444444-4444-4444-8444-444444444444");
  mustDiffer("the match query dropped, so a tool-scoped matcher stops narrowing", "matchQuery" in request, false);
  mustDiffer("the tool-use id used as the match query instead of the tool name", request.matchQuery, "toolu_1");
  mustDiffer("the denial's own sentence dropped from the record", "reason" in request.hookInput, false);
  mustDiffer("the tool_use_id field dropped from the record, as its PermissionRequest sibling does", "tool_use_id" in request.hookInput, false);
  mustDiffer("permission_suggestions carried instead, as its sibling does", "permission_suggestions" in request.hookInput, true);
  mustDiffer("the sibling's event name stamped instead of this one's", request.hookInput.hook_event_name, "PermissionRequest");
  mustDiffer("an entry log added, which this dispatcher does not write", trace.count("log"), 1);
}

// ---- UserPromptExpansion (upstream `Ldt`) -----------------------------------
{
  const { upstream, forwarded, owned } = prepare("user-prompt-expansion-hooks", "UserPromptExpansion", 7);
  const constants = { defaultHookTimeoutMs: DEFAULT_HOOK_TIMEOUT_MS };
  const cases: [string, StubSpec, unknown[]][] = [
    ["no hook registered", { registered: false }, ["slash_command", "reforgeprobe", undefined, "project", "/reforgeprobe", "bypassPermissions", context()]],
    ["a project slash command", { registered: true }, ["slash_command", "reforgeprobe", undefined, "project", "/reforgeprobe", "bypassPermissions", context()]],
    ["a slash command with arguments", { registered: true }, ["slash_command", "review", "--base main", "user", "/review --base main", "default", context()]],
    ["an MCP prompt", { registered: true }, ["mcp_prompt", "server__prompt", "arg", "mcp", "/server__prompt arg", "default", context()]],
    // The guard keys on the AGENT id when there is one — the only guarded
    // dispatcher in the family that chooses between the agent and the session.
    ["inside a subagent", { registered: true }, ["slash_command", "x", undefined, "project", "/x", "default", context({ agentId: "agent-1" })]],
    ["no permission mode", { registered: true }, ["slash_command", "x", undefined, "project", "/x", undefined, context()]],
  ];
  for (const [label, spec, args] of cases) {
    await compare(
      `user-prompt-expansion-hooks ${label}`,
      spec,
      constants,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 7), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compare(
    "user-prompt-expansion-hooks request control",
    cases[2][1],
    constants,
    () => upstream(...cases[2][2]),
    (p) => owned(...(cases[2][2] as unknown[]).slice(0, 7), ...forwarded(p, constants)),
  );
  const request = trace.calls("executor")[0][0] as { toolUseID: string; timeoutMs: number; hookInput: Record<string, unknown> };
  eq("user-prompt-expansion-hooks field order", Object.keys(request.hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "expansion_type",
    "command_name",
    "command_args",
    "command_source",
    "prompt",
  ]);
  eq("user-prompt-expansion-hooks guard keys on the session when there is no agent", trace.calls("hasHookForEvent")[0][2], "session-1");
  mustDiffer("the guard keyed on the session id even inside a subagent", trace.calls("hasHookForEvent")[0][2], "agent-1");
  // No timeout PARAMETER: the constant is read inside the body, which makes the
  // owned copy load-bearing at runtime rather than only as a differential check.
  eq("user-prompt-expansion-hooks uses the shared timeout", request.timeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
  mustDiffer("this event's timeout drifting from the shared constant", request.timeoutMs, 1000);
  mustDiffer("a match query added, letting a matcher narrow by command name", "matchQuery" in request, true);
  mustDiffer("the common prefix given the tool-use context as its fourth argument", trace.calls("base")[0].length, 4);
  const agent = await compare(
    "user-prompt-expansion-hooks agent-keyed guard control",
    cases[4][1],
    constants,
    () => upstream(...cases[4][2]),
    (p) => owned(...(cases[4][2] as unknown[]).slice(0, 7), ...forwarded(p, constants)),
  );
  eq("user-prompt-expansion-hooks guard keys on the agent when there is one", agent.trace.calls("hasHookForEvent")[0][2], "agent-1");
  const refused = await compare(
    "user-prompt-expansion-hooks refusal control",
    cases[0][1],
    constants,
    () => upstream(...cases[0][2]),
    (p) => owned(...(cases[0][2] as unknown[]).slice(0, 7), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered session still reaching the executor", refused.trace.count("executor"), 1);
  mustDiffer("an unregistered session still minting a tool-use id", refused.trace.count("uuid"), 1);
}

// ---- FileChanged (upstream `CUt`) — neither async nor a generator -----------
{
  const { upstream, forwarded, owned } = prepareAwaited("file-changed-hooks", "FileChanged", 4, "plain");
  const constants = {};
  const cases: [string, StubSpec, unknown[]][] = [
    ["a file created", { registered: true }, [SESSION, "/sandbox/watched.txt", "add", undefined]],
    ["a file changed", { registered: true }, [SESSION, "/sandbox/watched.txt", "change", {}]],
    ["a file unlinked", { registered: true }, [SESSION, "/sandbox/watched.txt", "unlink", {}]],
    ["with every option", { registered: true }, [SESSION, "/sandbox/a.txt", "change", { timeoutMs: 1000, storageV5: { store: "v5" }, credentials: { kind: "k" } }]],
    // The helper's fold is the caller's contract, and this dispatcher returns it
    // untouched — a watchPaths union that stopped crossing would re-arm the
    // watcher on the wrong set.
    [
      "the helper's fold returned untouched",
      { registered: true, watcherResult: { results: [{ succeeded: true, output: "", command: "h.sh" }], watchPaths: ["/sandbox", "/other"], systemMessages: ["a message"] } },
      [SESSION, "/sandbox/watched.txt", "change", {}],
    ],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `file-changed-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 4), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compareValue(
    "file-changed-hooks request control",
    cases[3][1],
    () => upstream(...cases[3][2]),
    (p) => owned(...(cases[3][2] as unknown[]).slice(0, 4), ...forwarded(p, constants)),
  );
  const call = trace.calls("watcher")[0] as [unknown, Record<string, unknown>, unknown];
  eq("file-changed-hooks field order", Object.keys(call[1]), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "file_path",
    "event",
  ]);
  // The helper is called POSITIONALLY with three arguments, not with a request
  // object like either executor — which is why this row's port is a third
  // execution path rather than a differently-named `AE`.
  eq("file-changed-hooks calls the watcher helper with three arguments", call.length, 3);
  mustDiffer("the record wrapped in a request object, the way both executors take theirs", call[1], { hookInput: call[1] });
  mustDiffer("the event kind stamped under a different key", "change_type" in call[1], true);
  mustDiffer("the common prefix built with a permission mode this event does not have", trace.calls("base")[0].length, 4);
  mustDiffer("this dispatcher reaching an executor rather than the watcher helper", trace.count("executorAwait"), 1);
  mustDiffer("the options bag dropped rather than forwarded", call[2], undefined);
}

// ---- CwdChanged (upstream `AUt`) — FileChanged's twin ----------------------
// The two differ in four things: the binding, the event literal and the two
// record fields. That is exactly why the record's field ORDER is graded here
// and not just its contents — `old_cwd`/`new_cwd` are the only bytes that
// distinguish this dispatcher's stdin stream from its twin's, so a comparison
// blind to them would pass on a record built for the wrong event.
{
  const { upstream, forwarded, owned } = prepareAwaited("cwd-changed-hooks", "CwdChanged", 4, "plain");
  const constants = {};
  const cases: [string, StubSpec, unknown[]][] = [
    ["a move into a subdirectory", { registered: true }, [SESSION, "/sandbox", "/sandbox/moved", undefined]],
    ["a move back out", { registered: true }, [SESSION, "/sandbox/moved", "/sandbox", {}]],
    // Upstream does not compare the two ends — the notifier upstream of it does
    // — so a same-directory call still builds a record. Graded because a
    // reimplementation that "helpfully" short-circuits on equality would be a
    // different function.
    ["both ends the same", { registered: true }, [SESSION, "/sandbox", "/sandbox", {}]],
    ["with every option", { registered: true }, [SESSION, "/a", "/b", { timeoutMs: 1000, storageV5: { store: "v5" }, credentials: { kind: "k" } }]],
    [
      "the helper's fold returned untouched",
      { registered: true, watcherResult: { results: [{ succeeded: true, output: "", command: "h.sh" }], watchPaths: ["/sandbox", "/other"], systemMessages: ["a message"] } },
      [SESSION, "/sandbox", "/sandbox/moved", {}],
    ],
  ];
  for (const [label, spec, args] of cases) {
    await compareValue(
      `cwd-changed-hooks ${label}`,
      spec,
      () => upstream(...args),
      (p) => owned(...(args as unknown[]).slice(0, 4), ...forwarded(p, constants)),
    );
  }
  const { trace } = await compareValue(
    "cwd-changed-hooks request control",
    cases[3][1],
    () => upstream(...cases[3][2]),
    (p) => owned(...(cases[3][2] as unknown[]).slice(0, 4), ...forwarded(p, constants)),
  );
  // …and on the third shape, which reaches neither executor.
  orderControl("cwd-changed-hooks: the ordered log sees a port swap the per-port lists cannot", trace);
  const call = trace.calls("watcher")[0] as [unknown, Record<string, unknown>, unknown];
  eq("cwd-changed-hooks field order", Object.keys(call[1]), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "old_cwd",
    "new_cwd",
  ]);
  eq("cwd-changed-hooks calls the watcher helper with three arguments", call.length, 3);
  mustDiffer("the two ends stamped in the wrong order", [call[1].old_cwd, call[1].new_cwd], ["/b", "/a"]);
  mustDiffer("the destination stamped under the twin's key", "file_path" in call[1], true);
  mustDiffer("the event literal left as the twin's", call[1].hook_event_name, "FileChanged");
  mustDiffer("this dispatcher reaching an executor rather than the watcher helper", trace.count("executorAwait"), 1);
  mustDiffer("the options bag dropped rather than forwarded", call[2], undefined);
}

// ---- verdict ----------------------------------------------------------------
// Floors set to the counts this file actually reaches, so an edit that deletes
// half the cross-product fails rather than passing faster.
if (checks < 721) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 134) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);
// The pairing property is stated on every case, so its floor is the comparison
// count's shape: two statements (upstream and owned) per graded case, plus the
// two synthetic ones. And `pairedCases` is the floor that matters more — a
// property nothing ever satisfies non-vacuously is a property nobody tested.
if (properties < 452) failures.push(`only ${properties} property statement(s) ran`);
if (pairedCases < 11) failures.push(`only ${pairedCases} case(s) carried a lifecycle edge — the pairing property is vacuous on the rest`);

console.log(`=== hook-dispatch parity: ${checks} comparison(s), ${controls} control(s), ${properties} property statement(s) over ${pairedCases} paired case(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — every owned hook dispatcher matches the pinned upstream body over the full cross-product"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
