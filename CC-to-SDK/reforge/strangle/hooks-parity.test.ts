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
// AND WHAT SECTION 3 IS (C10.6 / W7.6a, Stage 0 b-d): three capabilities this
// oracle lacked, landing BEFORE the executor modules they exist for rather than
// with them. Upstream's stdout `data` handler is re-hosted so WRITE BOUNDARIES
// can be scripted — the async-detection latch is one-shot, so byte-equal stdout
// delivered in a different number of writes is different behaviour. A bounded
// driver grades the path that NEVER SETTLES, which `drain` would deadlock on.
// And upstream's shutdown module is re-evaluated per case, which is the
// module-level-state reset every later stage's replay depends on, proven by a
// once-per-process arm giving the same verdict twice and a control showing the
// reset is not a no-op.
//
// AND WHAT SECTION 5 IS (W7.6a): the layer BENEATH the dispatchers. Upstream
// `Fq` is the sole reader of a hook's parsed JSON output — every answer path the
// executor has funnels its document through it — so the dispatchers decide which
// hooks run and it decides what their answers MEAN. It carries two interleaved
// contracts (a flat legacy one, a nested per-event one with eighteen arms) that
// write the same fields in a fixed order, which makes most of its behaviour an
// ORDERING between two writes rather than a branch, and it THROWS on three
// conditions — one of them onto a call site with no try/catch. The corpus
// reaches two arms, neither MCP-rewrite path, no throw and no document that uses
// both contracts at once; the cross-product here reaches all of it, and drives
// every event with one RICH payload so each arm is graded on what it IGNORES.
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
// W7.6a: the layer beneath them all — the sole reader of a hook's JSON output.
import "./modules/hook-json-contract.js";

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

// ============================================================================
// 3. THE EXECUTOR ORACLE'S MACHINERY (C10.6 / W7.6a, Stage 0 b–d).
//
// Three capabilities the hooks oracle did not have, landing BEFORE the first
// executor module rather than with it. Each is driven here against upstream's
// own bytes, because a capability with no consumer is an untested capability
// and the consumers arrive two waves from now.
//
// They are not conveniences. Each one is a path the existing oracle would
// either mis-grade or HANG on:
//
//   (b) stdout WRITE BOUNDARIES. The command arm's async detection latches once,
//       on the first write after which the accumulated stdout's FIRST LINE
//       contains a brace. Byte-equal stdout delivered in a different number of
//       writes is therefore different behaviour, and no surface in this campaign
//       could express that.
//   (c) A PATH THAT NEVER SETTLES. Six events await a promise constructed to
//       never resolve. `drain` would deadlock and the suite would hang, which is
//       strictly worse than failing.
//   (d) MODULE-LEVEL STATE. One genuinely process-global flag with a setter and
//       no clearer, plus keyed-lazy cells. A replay that does not reset them
//       grades the previous case's residue.
// ============================================================================

// ---- (b) the stdout write-boundary driver ----------------------------------
// UPSTREAM'S OWN HANDLER, not a model of it. The `data` handler is an arrow
// initializer inside the subprocess runner's 7.2 KB body, so it is extracted by
// its own text and re-hosted in a factory that declares the five closure
// variables it mutates. Everything else it reads is passed in, which is exactly
// the shape `ProcessPort` will have when C10.8 owns this.
{
  const NQ = extract(ENGINE, "Nq", /async function Nq\([\s\S]{0,80}?\)\{/);
  void NQ;
  const handlerSource = extract(
    ENGINE,
    "the command arm's stdout data handler",
    /Tn=\(Yn\)=>\{if\(Sn\+=Yn,fn\+=Yn,!hn\)\{[\s\S]*?catch\(er\)\{[\w$]+\(`Hooks: Failed to parse initial response as JSON: \$\{er\}`\)\}\}\}/,
  );

  /** Upstream's first-line helper, and the `async` predicate the latch spends. */
  const upstreamFirstLine = build<(s: string) => string>(
    extract(readFileSync(join(BUNDLE_MODULES, "chunk-04aem4bh.js"), "utf8"), "wr", /function wr\([\w$]+\)\{return St\([\w$]+,`\n`\)\}/),
    extract(readFileSync(join(BUNDLE_MODULES, "chunk-04aem4bh.js"), "utf8"), "St", /function St\([\w$]+,[\w$]+\)\{let [\w$]+=[\w$]+\.indexOf\([\w$]+\);return [\w$]+===-1\?[\w$]+:[\w$]+\.slice\(0,[\w$]+\)\}/),
  );
  const upstreamIsAsync = build<(v: Record<string, unknown>) => boolean>(
    extract(ENGINE, "mS", /function mS\([\w$]+\)\{return"async"in [\w$]+&&[\w$]+\.async===!0\}/),
  );

  eq("the first-line helper cuts at the first newline", upstreamFirstLine('{"a":1}\n{"b":2}'), '{"a":1}');
  eq("…and returns the whole buffer when there is none", upstreamFirstLine('{"a":1}'), '{"a":1}');
  mustDiffer("the first line taken as the LAST line", upstreamFirstLine('{"a":1}\n{"b":2}'), '{"b":2}');
  eq("the async predicate wants the literal true", upstreamIsAsync({ async: true }), true);
  eq("…and refuses a truthy non-true", upstreamIsAsync({ async: 1 } as unknown as Record<string, unknown>), false);
  mustDiffer("the async predicate accepting any truthy value", upstreamIsAsync({ async: 1 } as unknown as Record<string, unknown>), true);

  /**
   * Re-host the handler with its five mutated closure variables declared, and
   * return both a feeder and the state the runner would go on to read.
   */
  interface Feeder {
    feed: (chunk: string) => void;
    state: () => { stdout: string; output: string; latched: boolean; backgrounded: boolean };
  }
  const makeFeeder = (forceSync: boolean, log: EventLog): Feeder => {
    const factory = eval(
      `(function make(wr,V,mS,b,n,B,Kxt,ht,jn,A,dn,t,r,nt,F){` +
        `let Sn="",yn="",fn="",hn=!1,Lt=!1,ct=null;` +
        `let ${handlerSource};` +
        `return {feed:Tn,state:()=>({stdout:Sn,output:fn,latched:hn,backgrounded:Lt})};` +
        `})`,
    ) as (...a: unknown[]) => Feeder;
    return factory(
      upstreamFirstLine,
      JSON.parse,
      upstreamIsAsync,
      (v: unknown) => JSON.stringify(v),
      (m: string) => log.record("log", [m]),
      forceSync,
      (spec: Record<string, unknown>) => {
        log.record("adoptBackground", [spec]);
        return true;
      },
      { pid: 4242, stdout: { removeListener: () => log.record("stdoutOff", []) }, stderr: { removeListener: () => log.record("stderrOff", []) } },
      () => undefined,
      "hook-1",
      "echo",
      "PreToolUse",
      "a hook",
      "echo hi",
      undefined,
    );
  };

  /** Feed one payload under one boundary script; report the verdict and the log. */
  const runBoundary = (payload: string, boundaries: number[], forceSync = false) => {
    const log = new EventLog();
    const f = makeFeeder(forceSync, log);
    const writes = writeInChunks(f.feed, payload, boundaries);
    return { writes, ...f.state(), log };
  };

  // THE RED DIRECTION, and it is the whole point of the capability: the same
  // bytes, two boundary scripts, two different verdicts. The document has a
  // NESTED object, so a write ending at its inner brace leaves a first line
  // that already contains `}` — the latch is spent on a truncated document, the
  // parse throws into a catch that only logs, and the complete document that
  // arrives next is never examined.
  const NESTED = '{"a":{"b":1},"async":true}';
  const whole = runBoundary(NESTED, []);
  const split = runBoundary(NESTED, [NESTED.indexOf("}") + 1]);
  eq("one write: the whole document parses and the async hook is adopted", { writes: whole.writes, latched: whole.latched, backgrounded: whole.backgrounded }, {
    writes: 1,
    latched: true,
    backgrounded: true,
  });
  eq("two writes split after the NESTED brace: same bytes, latch spent, never adopted", { writes: split.writes, latched: split.latched, backgrounded: split.backgrounded }, {
    writes: 2,
    latched: true,
    backgrounded: false,
  });
  eq("…and the accumulated stdout is byte-identical across both", whole.stdout, split.stdout);
  mustDiffer("a replay that reproduces stdout BYTES and not stdout WRITES", whole.backgrounded, split.backgrounded);
  eq("the truncated parse is swallowed into a debug line, not raised", split.log.count("adoptBackground"), 0);

  // THE MECHANISM THE DESIGN FIRST GOT WRONG, stated as a test so it stays
  // corrected. Splitting mid-KEY — `{"async"` then `:true}` — behaves
  // IDENTICALLY to one write, because the first write leaves no brace in the
  // first line and the handler returns without spending the latch. The
  // sensitivity is real and narrower than "any two writes differ".
  const FLAT = '{"async":true}';
  const midKey = runBoundary(FLAT, [FLAT.indexOf(":")]);
  const flatWhole = runBoundary(FLAT, []);
  eq("split mid-key is indistinguishable from one write", { latched: midKey.latched, backgrounded: midKey.backgrounded }, { latched: flatWhole.latched, backgrounded: flatWhole.backgrounded });
  eq("…and it really was two writes", midKey.writes, 2);
  mustDiffer("every boundary treated as significant, which would make this case differ", midKey.backgrounded, !flatWhole.backgrounded);

  // The latch is ONE-SHOT across the whole call, not per line: a first line
  // that parses to a non-async document spends it too, so a hook that prints a
  // banner and then an async document is never adopted.
  const banner = runBoundary('{"ok":1}\n{"async":true}\n', []);
  eq("a non-async first line spends the latch for good", { latched: banner.latched, backgrounded: banner.backgrounded }, { latched: true, backgrounded: false });
  mustDiffer("the handler re-reading later lines", banner.backgrounded, true);

  // …and the forceSyncExecution arm: detected, deliberately not adopted.
  const forced = runBoundary(FLAT, [], true);
  eq("forceSyncExecution detects the async hook and waits anyway", { latched: forced.latched, backgrounded: forced.backgrounded }, { latched: true, backgrounded: false });
  mustDiffer("forceSyncExecution ignored", forced.backgrounded, true);
}


// ---- (d) module-level state, and the reset between cases -------------------
// The obligation comes with the wave (design §7 item 7), and the derivation
// narrowed it: `research/fixtures/hook-helper-belt-<pin>.json` lists six cells
// the layer reaches and exactly ONE is genuinely process-global — the shutdown
// module's `committed` flag, whose whole chunk is a class with one boolean, a
// setter, a reader and a promise constructed to never resolve. It has a setter
// and NO clearer anywhere in the bundle, so a replay that commits shutdown in
// one case has committed it for the life of the process.
//
// The reset is therefore STRUCTURAL rather than a list of assignments: the
// module's own bytes are re-evaluated per case, so each case gets its own
// class instance and its own never-settling promise. The forwarder discipline
// is the same one the ports use, and for the same reason — a body `eval`ed once
// holds its first binding forever.
interface ModuleState {
  isShuttingDown: () => boolean;
  commitShutdown: () => void;
  hang: () => Promise<never>;
  /** the session-scratch set the once-per-process spawn-failure arm consults */
  surfacedSpawnFailures: Set<string>;
}

const SHUTDOWN_CHUNK = readFileSync(join(BUNDLE_MODULES, "chunk-29shcjw2.js"), "utf8");
/**
 * Upstream's shutdown module, whole. It is four declarations, so it is taken as
 * a unit rather than function by function: the flag, the reader, the setter and
 * the never-settling promise are one another's meaning.
 */
const SHUTDOWN_SOURCE = extract(
  SHUTDOWN_CHUNK,
  "the shutdown module",
  /class [\w$]+\{committed=!1\}var [\w$]+=new [\w$]+;function [\w$]+\(\)\{return [\w$]+\.committed\}function [\w$]+\(\)\{[\w$]+\.committed=!0\}var [\w$]+=new Promise\(\(\)=>\{\}\);function [\w$]+\(\)\{return [\w$]+\}/,
);
const SHUTDOWN_NAMES = [...SHUTDOWN_SOURCE.matchAll(/function ([\w$]+)\(\)/g)].map((m) => m[1]);

function freshModuleState(): ModuleState {
  const mod = eval(`(() => { ${SHUTDOWN_SOURCE} return {read:${SHUTDOWN_NAMES[0]},commit:${SHUTDOWN_NAMES[1]},hang:${SHUTDOWN_NAMES[2]}}; })()`) as {
    read: () => boolean;
    commit: () => void;
    hang: () => Promise<never>;
  };
  return { isShuttingDown: mod.read, commitShutdown: mod.commit, hang: mod.hang, surfacedSpawnFailures: new Set<string>() };
}

let STATE: ModuleState = freshModuleState();
/** What the oracle calls between cases. Every later stage's replay depends on it. */
const resetModuleState = (): void => {
  STATE = freshModuleState();
};

{
  eq("the shutdown module declares exactly three functions", SHUTDOWN_NAMES.length, 3);
  eq("…the reader answers false on a fresh instance", freshModuleState().isShuttingDown(), false);
  mustDiffer("a shutdown module that starts committed", freshModuleState().isShuttingDown(), true);
  eq("the whole module carries no clearer", /committed=!1[^]*?committed=!0/.test(SHUTDOWN_SOURCE) && !/committed=!1;/.test(SHUTDOWN_SOURCE.slice(SHUTDOWN_SOURCE.indexOf("=!0"))), true);

  // The once-per-process arm, graded against upstream's own bytes: the FIRST
  // `event:command` spawn failure is surfaced and the second is not. That is
  // the arm design §5 names as gradeable "only by sequencing two identical
  // failures in one scenario, with the port resettable between replays".
  const upstreamNoteFailure = build<(event: string, command: string) => boolean>(
    extract(ENGINE, "Vxt", /function Vxt\([\w$]+,[\w$]+\)\{let [\w$]+=mxn\(\),[\w$]+=`\$\{[\w$]+\}:\$\{[\w$]+\}`;if\([\w$]+\.has\([\w$]+\)\)return!1;return [\w$]+\.add\([\w$]+\),!0\}/),
    "const mxn=()=>globalThis.__p_surfacedSpawnFailures();",
  );
  (globalThis as { __p_surfacedSpawnFailures?: () => Set<string> }).__p_surfacedSpawnFailures = () => STATE.surfacedSpawnFailures;

  /** One case: the same spawn failure twice, which is the whole observable. */
  const twice = (): boolean[] => [upstreamNoteFailure("PreToolUse", "echo hi"), upstreamNoteFailure("PreToolUse", "echo hi")];

  resetModuleState();
  const firstRun = twice();
  eq("the same spawn failure is surfaced once and then suppressed", firstRun, [true, false]);
  mustDiffer("a surfaced-failure set that forgets, so both are messaged", firstRun, [true, true]);
  mustDiffer("the key built from the event alone, so a second COMMAND is suppressed too", upstreamNoteFailure("PreToolUse", "echo other"), false);

  // THE PROOF THE OBLIGATION ASKS FOR: the same case, run again after a reset,
  // gives the same verdict. Without this every later stage's second replay
  // grades the first replay's residue.
  resetModuleState();
  const secondRun = twice();
  eq("the same case after a reset gives the same verdict", secondRun, firstRun);

  // …and the control that says the reset DOES something. A twin that cannot be
  // observed proves nothing, and it fails in the quiet direction (C9).
  const withoutReset = twice();
  mustDiffer("the reset skipped: the second run grades the first run's residue", withoutReset, firstRun);
  eq("…and what it grades instead is a fully suppressed pair", withoutReset, [false, false]);

  // The process-global flag, same shape. A case that commits shutdown must not
  // reach the next one.
  resetModuleState();
  STATE.commitShutdown();
  const leaked = STATE.isShuttingDown();
  resetModuleState();
  eq("a committed shutdown does not survive the reset", { before: leaked, after: STATE.isShuttingDown() }, { before: true, after: false });
  mustDiffer("a reset that reuses the module instance, so shutdown leaks", STATE.isShuttingDown(), true);
}

// ---- (c) grading the path that never settles -------------------------------
// The shutdown wrapper is 261 bytes and it is where the whole behaviour lives.
// `Qxt` and `AE` do not consult the flag themselves on the streaming path — the
// wrapper the twenty-one dispatcher splices already capture as `executeHooks`
// does — which is a correction to the design pass worth stating: the arm that
// hangs is not inside the executor.
{
  // ORDER MATTERS HERE, and getting it wrong cost a debugging round worth
  // writing down. `build` evaluates its bindings ONCE, at build time, so a
  // binding that is a VALUE rather than a thunk captures whatever the global
  // held then. Binding the allowlist as `c6n=globalThis.__p_shutdownHangEvents`
  // before that global was assigned captured `undefined`, and `c6n.has(...)`
  // then threw a TypeError that the comparison could not see because it
  // compared yields and the return value but not the THROW. So: every global
  // is assigned first, every binding that can be a thunk is one, and every
  // comparison below carries `threw`.
  const HANG_EVENTS = build<Set<string>>(
    `function hangEvents(){return ${extract(ENGINE, "c6n", /new Set\(\["PreToolUse","PermissionRequest","UserPromptSubmit","UserPromptExpansion","TaskCompleted","TeammateIdle"\]\)/)}}`,
  ) as unknown as () => Set<string>;

  const g = globalThis as Record<string, unknown>;
  g.__p_isShuttingDown = () => STATE.isShuttingDown();
  g.__p_hang = () => STATE.hang();
  g.__p_shutdownHangEvents = HANG_EVENTS();

  const streamed: unknown[] = [{ decision: "continue" }, { decision: "second" }];
  g.__p_streamingExecutor = async function* () {
    for (const r of streamed) yield r;
    return { executed: streamed.length };
  };

  const upstreamShutdownWrapper = build<(req: unknown) => AsyncGenerator<unknown, unknown>>(
    extract(ENGINE, "jy", /async function\*jy\([\w$]+\)\{let [\w$]+=\(\)=>xo\(\)&&![\w$]+\.signal\?\.aborted;[\s\S]*?if\([\w$]+\(\)\)await pm\(\)\}/),
    "const xo=()=>globalThis.__p_isShuttingDown(),pm=()=>globalThis.__p_hang(),Xxt=(r)=>globalThis.__p_streamingExecutor(r),c6n=globalThis.__p_shutdownHangEvents;",
  );
  const upstreamAwaitingGuard = build<(event: string, signal?: { aborted: boolean }) => boolean>(
    extract(ENGINE, "Yxt", /function Yxt\([\w$]+,[\w$]+\)\{return [\w$]+!=="SessionEnd"&&xo\(\)&&![\w$]+\?\.aborted\}/),
    "const xo=()=>globalThis.__p_isShuttingDown();",
  );

  const request = (event: string) => ({ hookInput: { hook_event_name: event }, signal: undefined });

  // The allowlist is upstream's, read out of the bundle rather than retyped.
  eq("the hang allowlist is the six events upstream names", [...HANG_EVENTS()].sort(), [
    "PermissionRequest",
    "PreToolUse",
    "TaskCompleted",
    "TeammateIdle",
    "UserPromptExpansion",
    "UserPromptSubmit",
  ]);
  mustDiffer("SessionEnd read into the hang allowlist", HANG_EVENTS().has("SessionEnd"), true);

  // 1. HEALTHY. Not shutting down: the wrapper is transparent.
  resetModuleState();
  const healthy = await drainBounded(upstreamShutdownWrapper(request("PreToolUse")));
  eq("not shutting down: the wrapper streams its executor through", { yielded: healthy.yielded, settled: healthy.settled, returned: healthy.returned, threw: healthy.threw }, {
    yielded: streamed,
    settled: true,
    // AND THE COMPLETION VALUE IS DROPPED, on BOTH arms, which is behaviour
    // rather than an artifact of the stub. The allowlisted arm reads the
    // executor with `for await (… of Xxt(e)) { yield r }` and never sees the
    // return; the other arm writes `yield* Xxt(e); return`, where the bare
    // `return` discards the value the delegation just produced. So no caller of
    // this wrapper can observe what the executor returned. C8 found this exact
    // shape as a real DEFECT in a shipped module (`return yield*` written where
    // upstream discards); here it is upstream's own, on both sides, and an
    // owned copy that "fixed" it would diverge.
    returned: undefined,
    threw: undefined,
  });
  const forwarding = await drainBounded(upstreamShutdownWrapper(request("PostToolUse")));
  eq("…and the delegating arm drops it too, because its `return` is bare", forwarding.returned, undefined);
  mustDiffer("either arm rewritten as `return yield*`, which would forward it", healthy.returned, { executed: 2 });
  propertyControl("a HEALTHY path must FAIL the non-settling mode", nonSettling(healthy));

  // 2. THE NON-SETTLING PATH. Shutting down on an allowlisted event: no yields,
  // and it never settles. The bounded driver is what makes this gradeable at
  // all — `drain` would deadlock the suite.
  resetModuleState();
  STATE.commitShutdown();
  const hung = await drainBounded(upstreamShutdownWrapper(request("PreToolUse")));
  property("the shutdown arm produces no yields and does not settle", nonSettling(hung));
  eq("…and the bounded driver reports it as unsettled rather than hanging the suite", { yielded: hung.yielded, settled: hung.settled, threw: hung.threw }, { yielded: [], settled: false, threw: undefined });
  mustDiffer("the shutdown arm read as an ordinary empty return", hung.settled, true);

  // 3. THE OTHER TWENTY-SEVEN EVENTS return SILENTLY under the same flag — a
  // different behaviour that produces the same zero yields, which is exactly
  // the pair an output-only comparison cannot separate.
  resetModuleState();
  STATE.commitShutdown();
  const silent = await drainBounded(upstreamShutdownWrapper(request("PostToolUse")));
  eq("a non-allowlisted event returns silently under shutdown", { yielded: silent.yielded, settled: silent.settled, returned: silent.returned, threw: silent.threw }, {
    yielded: [],
    settled: true,
    returned: undefined,
    threw: undefined,
  });
  propertyControl("the silent-return arm must FAIL the non-settling mode", nonSettling(silent));
  eq("the two shutdown arms are INDISTINGUISHABLE by what they yield", silent.yielded, hung.yielded);
  mustDiffer("…and are told apart only by settling, which is what this mode adds", silent.settled, hung.settled);

  // 4. AN ABORTED CALLER short-circuits the whole predicate, so a cancelled hook
  // dispatch under shutdown neither hangs nor goes silent.
  resetModuleState();
  STATE.commitShutdown();
  const aborted = await drainBounded(
    upstreamShutdownWrapper({ hookInput: { hook_event_name: "PreToolUse" }, signal: { aborted: true } }),
  );
  eq("an already-aborted caller streams through even under shutdown", { yielded: aborted.yielded, settled: aborted.settled, threw: aborted.threw }, { yielded: streamed, settled: true, threw: undefined });
  propertyControl("the aborted path must FAIL the non-settling mode", nonSettling(aborted));

  // 5. THE AWAITING EXECUTOR'S GUARD is a different rule with the same flag:
  // SessionEnd is exempt so shutdown can still run it, and everything else
  // hangs with no allowlist at all.
  resetModuleState();
  STATE.commitShutdown();
  const guarded = [...HANG_EVENTS(), "PostToolUse", "SessionEnd", "PreCompact"].sort().map((e) => [e, upstreamAwaitingGuard(e)] as const);
  eq("the awaiting guard exempts SessionEnd and nothing else", guarded.filter(([, v]) => !v).map(([e]) => e), ["SessionEnd"]);
  mustDiffer("the awaiting guard reusing the streaming allowlist", guarded.filter(([, v]) => v).map(([e]) => e).length, HANG_EVENTS().size);
  eq("…and an aborted signal exempts every event", upstreamAwaitingGuard("PreToolUse", { aborted: true }), false);
  resetModuleState();
  eq("…as does not shutting down", upstreamAwaitingGuard("PreToolUse"), false);
  mustDiffer("a guard that hangs whenever the flag is clear", upstreamAwaitingGuard("PreToolUse"), true);
}

// ============================================================================
// 5. THE HOOK JSON CONTRACT — the layer BENEATH the dispatchers (W7.6a).
//
// Upstream `Fq` is the only thing in the engine that reads a hook's parsed JSON
// output. The dispatchers above decide WHICH hooks run; this decides what a
// hook's answer MEANS, and all five of the executor's answer paths funnel their
// document through it.
//
// WHY IT NEEDS AN ORACLE MORE THAN THE DISPATCHERS DID. A dispatcher has one
// shape and a handful of guards. This has TWO INTERLEAVED CONTRACTS — a flat
// legacy one and a nested per-event one with eighteen arms — that write the same
// four fields in a fixed order, so almost every interesting behaviour is an
// ORDERING between two writes rather than a branch. The corpus reaches two of
// the eighteen arms. It reaches none of the three throws, neither MCP-rewrite
// path, the terminal-sequence allowlist on either side, and no case at all where
// a document uses both contracts at once.
//
// THE CROSS-PRODUCT IS THE POINT, and it is built so each arm's SELECTIVITY is
// graded rather than only its output: every event is driven once with a RICH
// payload carrying every field any arm reads, so an arm that copied a
// neighbour's field is a difference rather than a coincidence.
//
// THE THROWS ARE GRADED, NOT SWALLOWED. Three conditions raise, and one of them
// reaches the dispatcher because the internal-callback fast path has no
// try/catch. `runContract` records the throw as an outcome and compares it, the
// same way `drain` does one layer up.
// ============================================================================

/** The delegation the build synthesises: the re-assembled parameter, then the five ports. */
type ContractFn = (input: Record<string, unknown>, ...ports: unknown[]) => unknown;

/**
 * The five ports, per case.
 *
 * All `effectful-port` (§2.4) and none owned here, so both sides get the SAME
 * stub — the C7 rule about binding a body to the implementation it is grading
 * does not bite, because this module implements none of them. What each stub
 * does is chosen so the port is OBSERVABLE rather than inert: the allowlist
 * filter rejects on a marker prefix so both of its arms are reachable, and the
 * attachment builder ECHOES its argument (upstream's mints a uuid and reads a
 * clock, which would make every comparison nondeterministic) so the returned
 * `message` grades the whole spec rather than its existence.
 */
function contractPorts(log: EventLog) {
  return {
    sanitizeTerminalSequence: (seq: unknown) => {
      log.record("sanitize", [seq]);
      return typeof seq === "string" && seq.startsWith("REJECT") ? null : `sanitized(${String(seq)})`;
    },
    logDebug: (...args: unknown[]) => {
      log.record("logDebug", args);
    },
    stringify: (value: unknown, replacer: unknown, indent: unknown) => {
      log.record("stringify", [value, replacer, indent]);
      return JSON.stringify(value, replacer as null, indent as number);
    },
    probeMcpRewrite: (...args: unknown[]) => {
      log.record("probeMcpRewrite", args);
    },
    hookMessage: (spec: unknown) => {
      log.record("hookMessage", [spec]);
      return { attachment: spec, type: "attachment", uuid: "<stub-uuid>", timestamp: "<stub-clock>" };
    },
  };
}
type ContractPorts = ReturnType<typeof contractPorts>;

/** The live-binding forwarders, installed once — see `CURRENT` above for why. */
let CONTRACT: ContractPorts | null = null;
const liveContract = (): ContractPorts => {
  if (CONTRACT === null) throw new Error("hooks-parity: a contract port was called with no case bound");
  return CONTRACT;
};
ports.__p_sanitizeTerminalSequence = (s: unknown) => liveContract().sanitizeTerminalSequence(s);
ports.__p_logDebug = (...a: unknown[]) => liveContract().logDebug(...a);
ports.__p_stringify = (v: unknown, r: unknown, i: unknown) => liveContract().stringify(v, r, i);
ports.__p_probeMcpRewrite = (...a: unknown[]) => liveContract().probeMcpRewrite(...a);
ports.__p_hookMessage = (s: unknown) => liveContract().hookMessage(s);

/**
 * Upstream's body, located by the MANIFEST ROW'S OWN ANCHOR and its enclosing
 * `function` declaration — the same two facts the build resolves it by, so the
 * oracle cannot end up grading a different node than the splice replaces. The
 * anchor's uniqueness inside the chunk is restated here rather than assumed.
 *
 * Brace matching skips `'` and `"` strings and counts through template
 * literals, which is the same rule `dispatcherSource` uses and is safe for the
 * same reason: every `${…}` in this body contributes a balanced pair.
 */
function contractSource(row: { anchor: string; signature: { params: number } }): string {
  const at = ENGINE.indexOf(row.anchor);
  if (at < 0) throw new Error(`hook-json-contract: anchor not found in the chunk`);
  if (ENGINE.indexOf(row.anchor, at + 1) >= 0) throw new Error(`hook-json-contract: anchor is not unique in the chunk`);
  const start = ENGINE.lastIndexOf("function ", at);
  if (start < 0) throw new Error(`hook-json-contract: no enclosing function declaration above the anchor`);
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
  if (!source.includes(row.anchor)) throw new Error("hook-json-contract: the matched span does not contain the anchor");
  const openParen = source.indexOf("(");
  let paren = 0;
  let closeParen = openParen;
  for (; closeParen < source.length; closeParen++) {
    if (source[closeParen] === "(") paren++;
    else if (source[closeParen] === ")" && --paren === 0) break;
  }
  const declared = splitParams(source.slice(openParen + 1, closeParen));
  if (declared.length !== row.signature.params) {
    throw new Error(`hook-json-contract: expected ${row.signature.params} parameter(s), found ${declared.length}`);
  }
  return source;
}

const contractRow = SPLICES.find((s) => s.name === "hook-json-contract");
if (!contractRow) throw new Error("hook-json-contract: no manifest row");
const CONTRACT_SOURCE = contractSource(contractRow);
const contractCaptures = deriveCaptures(contractRow, CONTRACT_SOURCE);
const upstreamContract = build<ContractFn>(
  CONTRACT_SOURCE,
  contractCaptures.map((c) => `const ${c.identifier}=globalThis.__p_${c.as};`).join(""),
);
const ownedContract = reforge.hookJsonContract as unknown as ContractFn;
/** The forwarded argument list, in manifest order — what the build's delegation passes. */
const contractPortArgs = (p: ContractPorts): unknown[] =>
  contractCaptures.filter((c) => !c.owned).map((c) => p[c.as as keyof ContractPorts]);

interface Outcome {
  returned?: unknown;
  threw?: string;
}

/** One side of one case: what it returned, or how it THREW. */
function runContract(fn: ContractFn, input: Record<string, unknown>, p: ContractPorts): Outcome {
  CONTRACT = p;
  try {
    return { returned: fn(input, ...contractPortArgs(p)) };
  } catch (e) {
    return { threw: `${(e as Error).name}: ${(e as Error).message}` };
  } finally {
    CONTRACT = null;
  }
}

/**
 * The executor's own call shape: TEN keys, always present, some undefined. The
 * build re-assembles upstream's destructured parameter into exactly this object,
 * so a case that omitted a key would be grading a call the graph never makes.
 */
function contractInput(json: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    json,
    command: "run-hook.sh --json",
    hookName: "my-hook",
    toolUseID: "toolu_01",
    hookEvent: "PostToolUse",
    expectedHookEvent: undefined,
    stdout: "the hook's stdout",
    stderr: "the hook's stderr",
    exitCode: 0,
    durationMs: 42,
    ...over,
  };
}

/**
 * "Every settled result carries exactly one attachment, and it is the BLOCKING
 * one precisely when a blocking error was built."
 *
 * A legal-shape statement rather than a comparison: two sides that both attach
 * the wrong kind agree with each other. Stated on BOTH sides of every settled
 * case, which is the convention the pairing property set one section up.
 */
function attachmentShape(outcome: Outcome): string[] {
  if (outcome.threw !== undefined) return [];
  const r = outcome.returned as { blockingError?: unknown; message?: { attachment?: { type?: string } } } | undefined;
  if (r === undefined || r === null) return ["a settled call returned nothing"];
  if (r.message === undefined) return ["no message attachment"];
  const wanted = r.blockingError ? "hook_blocking_error" : "hook_success";
  const got = r.message.attachment?.type;
  return got === wanted ? [] : [`attachment is ${String(got)}, expected ${wanted}`];
}

/** Drive one case through both sides and grade the outcome, the ports and the shape. */
function contractCase(label: string, input: Record<string, unknown>): { up: Outcome; own: Outcome } {
  const upLog = new EventLog();
  const ownLog = new EventLog();
  const up = runContract(upstreamContract, input, contractPorts(upLog));
  const own = runContract(ownedContract, input, contractPorts(ownLog));
  eq(`contract ${label}`, up, own);
  eq(`contract ${label} — ports`, upLog.snapshot(), ownLog.snapshot());
  if (up.threw === undefined) {
    property(`contract ${label}: upstream's attachment matches its blocking state`, attachmentShape(up));
    property(`contract ${label}: the owned attachment matches its blocking state`, attachmentShape(own));
  }
  return { up, own };
}

{
  console.log("  section 5: the hook JSON contract");

  // ---- the LEGACY, flat contract -------------------------------------------
  // `decision` × `reason`: the switch, its two known values, the falsy values
  // that skip it entirely, and the two that THROW — including a correctly
  // spelled one in the wrong case, since the comparison is exact.
  for (const decision of [undefined, "approve", "block", "", null, 0, "reject", "Approve", "deny"]) {
    for (const reason of [undefined, "the hook's reason", ""]) {
      contractCase(`decision=${show(decision)} reason=${show(reason)}`, contractInput({ decision, reason }));
    }
  }
  // `continue`: identity against `false`, not truthiness — so `0` and `"no"` do
  // NOT stop the turn, and `stopReason` rides along only when truthy.
  for (const cont of [undefined, true, false, 0, "no", null]) {
    for (const stopReason of [undefined, "out of budget", ""]) {
      contractCase(`continue=${show(cont)} stopReason=${show(stopReason)}`, contractInput({ continue: cont, stopReason }));
    }
  }
  // `systemMessage` × `terminalSequence`: the allowlist's accept arm, its reject
  // arm (which logs and sets NOTHING), and the falsy values that skip the port.
  for (const systemMessage of [undefined, "a system message", ""]) {
    for (const terminalSequence of [undefined, "OSC-TITLE", "REJECT-ME", "", null]) {
      contractCase(
        `systemMessage=${show(systemMessage)} terminalSequence=${show(terminalSequence)}`,
        contractInput({ systemMessage, terminalSequence }),
      );
    }
  }

  // ---- the MODERN, per-event contract --------------------------------------
  // Eighteen handled event names, one that no arm names, and the absent case.
  const EVENT_NAMES = [
    "PreToolUse",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "SessionStart",
    "Setup",
    "PreModelSwitch",
    "PostModelSwitch",
    "SubagentStart",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "Stop",
    "SubagentStop",
    "PermissionDenied",
    "PermissionRequest",
    "Elicitation",
    "ElicitationResult",
    "MessageDisplay",
    "NotAnEvent",
    undefined,
  ];
  /**
   * ONE payload carrying every field ANY arm reads. Driven at every event name,
   * so each arm is graded on what it IGNORES as well as on what it copies — an
   * arm that picked up its neighbour's field is a difference here rather than a
   * coincidence nothing looks at.
   */
  const RICH = {
    additionalContext: "context from the hook",
    sessionTitle: "a title",
    suppressOriginalPrompt: true,
    initialUserMessage: "the first message",
    watchPaths: ["/sandbox/watched"],
    reloadSkills: true,
    classifierContext: "classifier says",
    updatedToolOutput: "rewritten output",
    updatedMCPToolOutput: { content: [{ type: "text", text: "mcp" }] },
    retry: true,
    decision: { behavior: "allow", updatedInput: { file_path: "/rewritten" } },
    action: "decline",
    content: { field: "value" },
    displayContent: "shown to the user",
    permissionDecision: "deny",
    permissionDecisionReason: "the arm's own reason",
    updatedInput: { file_path: "/from-the-arm" },
  };
  for (const hookEventName of EVENT_NAMES) {
    for (const [payloadLabel, payload] of [
      ["rich", RICH],
      ["bare", {}],
    ] as [string, Record<string, unknown>][]) {
      // `expectedHookEvent` is the guard's only input: matching, unset (the
      // guard is skipped entirely), and pinned to a DIFFERENT event, which
      // throws for every name but that one.
      for (const expectedHookEvent of [hookEventName, undefined, "PostToolUse"]) {
        contractCase(
          `event=${show(hookEventName)} ${payloadLabel} expected=${show(expectedHookEvent)}`,
          contractInput({ hookSpecificOutput: { hookEventName, ...payload }, reason: "top-level reason" }, { expectedHookEvent }),
        );
      }
    }
  }
  // …and the document with NO `hookSpecificOutput` at all, which skips the guard
  // and the switch even when the caller pinned an event.
  for (const expectedHookEvent of [undefined, "PostToolUse"]) {
    contractCase(`no hookSpecificOutput expected=${show(expectedHookEvent)}`, contractInput({ reason: "r" }, { expectedHookEvent }));
  }

  // ---- the branchy arms, one axis at a time --------------------------------
  // PreToolUse: the pre-pass switch (which THROWS on an unknown value) and the
  // arm's own (which does not), the reason overwrite, and `updatedInput`.
  for (const permissionDecision of [undefined, "allow", "deny", "ask", "defer", "", "elevate"]) {
    for (const permissionDecisionReason of [undefined, "the arm's reason"]) {
      for (const updatedInput of [undefined, { file_path: "/x" }, {}]) {
        contractCase(
          `PreToolUse decision=${show(permissionDecision)} armReason=${show(permissionDecisionReason)} updatedInput=${show(updatedInput)}`,
          contractInput({
            reason: "the top-level reason",
            hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason, updatedInput },
          }),
        );
      }
    }
  }
  // …and the same, with NO top-level reason, because the arm's overwrite is only
  // visible against a value it can erase.
  for (const permissionDecision of [undefined, "allow", "deny"]) {
    contractCase(
      `PreToolUse decision=${show(permissionDecision)} with no top-level reason`,
      contractInput({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision } }),
    );
  }
  // PreModelSwitch: three arms rather than four (a model switch cannot be
  // DEFERRED), no default clause at all, and a GUARDED reason assignment.
  for (const permissionDecision of [undefined, "allow", "deny", "ask", "defer", "elevate"]) {
    for (const permissionDecisionReason of [undefined, "the arm's reason"]) {
      contractCase(
        `PreModelSwitch decision=${show(permissionDecision)} armReason=${show(permissionDecisionReason)}`,
        contractInput({
          reason: "the top-level reason",
          hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision, permissionDecisionReason },
        }),
      );
    }
  }
  // SessionStart: the one field in the function gated on PRESENCE as well as on
  // truthiness, so a key holding `undefined` differs from an absent key.
  for (const [label, specific] of [
    ["absent", { hookEventName: "SessionStart" }],
    ["present undefined", { hookEventName: "SessionStart", watchPaths: undefined }],
    ["present null", { hookEventName: "SessionStart", watchPaths: null }],
    ["present empty array", { hookEventName: "SessionStart", watchPaths: [] }],
    ["present populated", { hookEventName: "SessionStart", watchPaths: ["/a", "/b"] }],
  ] as [string, Record<string, unknown>][]) {
    for (const reloadSkills of [undefined, true, false]) {
      contractCase(`SessionStart watchPaths ${label} reloadSkills=${show(reloadSkills)}`, contractInput({ hookSpecificOutput: { ...specific, reloadSkills } }));
    }
  }
  // PostToolUse: the modern field, the legacy one, and the probe that fires only
  // on the legacy one's TRUTHY arm — a present-but-falsy value suppresses the
  // rewrite and says so instead.
  for (const updatedToolOutput of [undefined, null, "", "rewritten"]) {
    for (const updatedMCPToolOutput of [undefined, null, false, "", { content: [] }]) {
      contractCase(
        `PostToolUse updatedToolOutput=${show(updatedToolOutput)} updatedMCPToolOutput=${show(updatedMCPToolOutput)}`,
        contractInput({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput, updatedMCPToolOutput } }),
      );
    }
  }
  // PermissionRequest: anything that is not an explicit allow is a deny, and
  // only an allow may carry a rewritten input.
  for (const decision of [
    undefined,
    null,
    { behavior: "allow" },
    { behavior: "allow", updatedInput: { file_path: "/rewritten" } },
    { behavior: "allow", updatedInput: {} },
    { behavior: "deny", message: "denied by the hook" },
    { behavior: "deny", updatedInput: { file_path: "/ignored" } },
    { behavior: "ask" },
    {},
  ]) {
    contractCase(`PermissionRequest decision=${show(decision)}`, contractInput({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }));
  }
  // Elicitation and its result twin: same shape, different response key and a
  // different default blocking message.
  for (const event of ["Elicitation", "ElicitationResult"]) {
    for (const action of [undefined, "", "accept", "decline"]) {
      for (const reason of [undefined, "the hook's reason"]) {
        contractCase(
          `${event} action=${show(action)} reason=${show(reason)}`,
          contractInput({ reason, hookSpecificOutput: { hookEventName: event, action, content: { answer: 7 } } }),
        );
      }
    }
  }
  // The two single-field arms whose field is not `additionalContext`.
  for (const retry of [undefined, true, false]) {
    contractCase(`PermissionDenied retry=${show(retry)}`, contractInput({ hookSpecificOutput: { hookEventName: "PermissionDenied", retry } }));
  }
  for (const displayContent of [undefined, "shown", ""]) {
    contractCase(`MessageDisplay displayContent=${show(displayContent)}`, contractInput({ hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent } }));
  }

  // ---- the two contracts on ONE document -----------------------------------
  // The interleaving is the behaviour no scenario can produce: the legacy switch
  // writes `permissionBehavior`, the pre-pass overwrites it, and the arm
  // overwrites it again — in that order.
  for (const decision of ["approve", "block"]) {
    for (const specific of [
      { hookEventName: "PreToolUse", permissionDecision: "allow" },
      { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "the arm's reason" },
      { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
      { hookEventName: "UserPromptSubmit", additionalContext: "ctx" },
    ]) {
      for (const reason of [undefined, "the top-level reason"]) {
        contractCase(
          `both contracts: decision=${decision} + ${String(specific.hookEventName)} reason=${show(reason)}`,
          contractInput({ decision, reason, hookSpecificOutput: specific }),
        );
      }
    }
  }
  // The attachment's stdio half, which only the SUCCESS arm carries — and the
  // callback paths supply none of it.
  for (const [label, over] of [
    ["a command hook", {}],
    ["a callback hook", { command: "callback", stdout: undefined, stderr: undefined, exitCode: undefined, durationMs: undefined }],
    ["no tool use", { toolUseID: undefined }],
    ["a failed hook", { exitCode: 2, stderr: "boom" }],
  ] as [string, Record<string, unknown>][]) {
    for (const json of [{}, { decision: "block", reason: "blocked" }]) {
      contractCase(`attachment: ${label} ${show(json)}`, contractInput(json, over));
    }
  }

  // ---- the controls: one per behaviour family ------------------------------
  // Each is a wrong implementation this layer could plausibly ship, applied to
  // the OWNED side in memory. Without them the block above proves nothing about
  // its own ability to fail.
  const outcomeOf = (json: unknown, over: Record<string, unknown> = {}): Outcome =>
    runContract(upstreamContract, contractInput(json, over), contractPorts(new EventLog()));
  const returnedOf = (json: unknown, over: Record<string, unknown> = {}): Record<string, unknown> =>
    outcomeOf(json, over).returned as Record<string, unknown>;
  /** `returned`, with one field rewritten — the shape a wrong arm would produce. */
  const mutate = (json: unknown, over: Record<string, unknown>, patch: Record<string, unknown>): unknown => ({
    ...returnedOf(json, over),
    ...patch,
  });
  const without = (json: unknown, drop: string[]): unknown => {
    const copy = { ...returnedOf(json) };
    for (const k of drop) delete copy[k];
    return copy;
  };

  mustDiffer(
    "`continue` read for truthiness rather than identity against false",
    outcomeOf({ continue: 0 }).returned,
    mutate({ continue: 0 }, {}, { preventContinuation: true }),
  );
  mustDiffer(
    "`stopReason` carried through even when the hook did not stop the turn",
    outcomeOf({ continue: true, stopReason: "ignored" }).returned,
    mutate({ continue: true, stopReason: "ignored" }, {}, { stopReason: "ignored" }),
  );
  mustDiffer(
    "the legacy `approve` mapped to a permission behaviour of its own name",
    outcomeOf({ decision: "approve" }).returned,
    mutate({ decision: "approve" }, {}, { permissionBehavior: "approve" }),
  );
  mustDiffer(
    "an unknown legacy decision tolerated instead of throwing",
    outcomeOf({ decision: "reject" }),
    { returned: mutate({}, {}, {}) },
  );
  mustDiffer(
    "the legacy block arm defaulting its message to the empty string",
    outcomeOf({ decision: "block" }).returned,
    mutate({ decision: "block" }, {}, { blockingError: { blockingError: "", command: "run-hook.sh --json" } }),
  );
  mustDiffer(
    "`systemMessage` copied even when the hook sent an empty one",
    outcomeOf({ systemMessage: "" }).returned,
    mutate({ systemMessage: "" }, {}, { systemMessage: "" }),
  );
  mustDiffer(
    "a REJECTED terminal sequence written through rather than logged",
    outcomeOf({ terminalSequence: "REJECT-ME" }).returned,
    mutate({ terminalSequence: "REJECT-ME" }, {}, { terminalSequence: "REJECT-ME" }),
  );
  mustDiffer(
    "the allowlist's answer discarded and the raw sequence kept",
    outcomeOf({ terminalSequence: "OSC-TITLE" }).returned,
    mutate({ terminalSequence: "OSC-TITLE" }, {}, { terminalSequence: "OSC-TITLE" }),
  );
  mustDiffer(
    "an unknown PreToolUse permissionDecision falling through instead of throwing",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "elevate" } }),
    { returned: { message: { attachment: { type: "hook_success" } } } },
  );
  mustDiffer(
    "the top-level reason attached without a behaviour to explain",
    outcomeOf({ reason: "why" }).returned,
    mutate({ reason: "why" }, {}, { hookPermissionDecisionReason: "why" }),
  );
  mustDiffer(
    "the event-name guard skipped, so a mismatched answer is accepted",
    outcomeOf({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "c" } }, { expectedHookEvent: "PostToolUse" }),
    { returned: { additionalContext: "c" } },
  );
  mustDiffer(
    "the PreToolUse arm's reason overwrite made conditional, so the top-level one survives",
    outcomeOf({ reason: "top", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }).returned,
    mutate({ reason: "top", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }, {}, {
      hookPermissionDecisionReason: "top",
    }),
  );
  mustDiffer(
    "the PreToolUse deny arm preferring the top-level reason over the arm's own",
    outcomeOf({
      reason: "top",
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "arm" },
    }).returned,
    mutate(
      { reason: "top", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "arm" } },
      {},
      { blockingError: { blockingError: "top", command: "run-hook.sh --json" } },
    ),
  );
  mustDiffer(
    "UserPromptSubmit's fields guarded on truthiness, so an absent title vanishes",
    outcomeOf({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "c" } }).returned,
    without({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "c" } }, ["sessionTitle", "suppressOriginalPrompt"]),
  );
  mustDiffer(
    "UserPromptExpansion given UserPromptSubmit's third field",
    outcomeOf({ hookSpecificOutput: { hookEventName: "UserPromptExpansion", additionalContext: "c", sessionTitle: "t" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "UserPromptExpansion", additionalContext: "c", sessionTitle: "t" } }, {}, { sessionTitle: "t" }),
  );
  mustDiffer(
    "SessionStart's watchPaths gate reduced to truthiness, so an absent key writes one",
    outcomeOf({ hookSpecificOutput: { hookEventName: "SessionStart" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "SessionStart" } }, {}, { watchPaths: undefined }),
  );
  mustDiffer(
    "PreModelSwitch given PreToolUse's fourth arm, so a model switch can be deferred",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "defer" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "defer" } }, {}, { permissionBehavior: "defer" }),
  );
  mustDiffer(
    "PreModelSwitch's guarded reason written unconditionally, PreToolUse-style",
    outcomeOf({ reason: "top", hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "allow" } }).returned,
    mutate({ reason: "top", hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "allow" } }, {}, {
      hookPermissionDecisionReason: undefined,
    }),
  );
  mustDiffer(
    "the legacy MCP rewrite honoured when it is present but falsy",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: null } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: null } }, {}, { updatedMCPToolOutput: null }),
  );
  mustDiffer(
    "the MCP suppression flag dropped, so a refused rewrite is silent",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: "" } }).returned,
    without({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: "" } }, ["legacyMcpRewriteSuppressed"]),
  );
  mustDiffer(
    "PermissionRequest reading `permissionRequestResult` where the contract says `decision`",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } }).returned,
    without({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } }, [
      "permissionRequestResult",
      "permissionBehavior",
    ]),
  );
  mustDiffer(
    "a denying PermissionRequest allowed to rewrite the input as well",
    outcomeOf({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", updatedInput: { file_path: "/x" } } },
    }).returned,
    mutate(
      { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", updatedInput: { file_path: "/x" } } } },
      {},
      { updatedInput: { file_path: "/x" } },
    ),
  );
  mustDiffer(
    "an Elicitation decline blocked with the ElicitationResult message",
    outcomeOf({ hookSpecificOutput: { hookEventName: "Elicitation", action: "decline" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "Elicitation", action: "decline" } }, {}, {
      blockingError: { blockingError: "Elicitation result blocked by hook", command: "run-hook.sh --json" },
    }),
  );
  mustDiffer(
    "an Elicitation ACCEPT blocked as though it had declined",
    outcomeOf({ hookSpecificOutput: { hookEventName: "Elicitation", action: "accept" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "Elicitation", action: "accept" } }, {}, {
      blockingError: { blockingError: "Elicitation denied by hook", command: "run-hook.sh --json" },
    }),
  );
  mustDiffer(
    "PermissionDenied's retry guarded, so a hook that refuses to retry says nothing",
    outcomeOf({ hookSpecificOutput: { hookEventName: "PermissionDenied" } }).returned,
    without({ hookSpecificOutput: { hookEventName: "PermissionDenied" } }, ["retry"]),
  );
  mustDiffer(
    "an unnamed event falling into the additionalContext arm the twelve others share",
    outcomeOf({ hookSpecificOutput: { hookEventName: "NotAnEvent", additionalContext: "c" } }).returned,
    mutate({ hookSpecificOutput: { hookEventName: "NotAnEvent", additionalContext: "c" } }, {}, { additionalContext: "c" }),
  );
  mustDiffer(
    "the blocking attachment built as a success one, so a blocked hook reads as having run",
    outcomeOf({ decision: "block", reason: "no" }).returned,
    mutate({ decision: "block", reason: "no" }, {}, {
      message: {
        attachment: { type: "hook_success", hookName: "my-hook", toolUseID: "toolu_01", hookEvent: "PostToolUse", content: "" },
        type: "attachment",
        uuid: "<stub-uuid>",
        timestamp: "<stub-clock>",
      },
    }),
  );
  mustDiffer(
    "the success attachment built without the executor's own measurements",
    outcomeOf({}).returned,
    mutate({}, {}, {
      message: {
        attachment: { type: "hook_success", hookName: "my-hook", toolUseID: "toolu_01", hookEvent: "PostToolUse", content: "" },
        type: "attachment",
        uuid: "<stub-uuid>",
        timestamp: "<stub-clock>",
      },
    }),
  );
  // The PORT trace's own control: a wrong implementation can agree on the result
  // and disagree on what it did to get there.
  {
    const log = new EventLog();
    runContract(upstreamContract, contractInput({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: { a: 1 } } }), contractPorts(log));
    mustDiffer("the MCP dead probe never fired", log.order(), ["hookMessage"]);
    mustDiffer("the MCP dead probe told the wrong thing about the modern field", log.calls("probeMcpRewrite"), [[true]]);
  }
  {
    const log = new EventLog();
    runContract(upstreamContract, contractInput({ terminalSequence: "REJECT-ME" }), contractPorts(log));
    mustDiffer("the rejected sequence logged nothing", log.count("logDebug"), 0);
    orderControl("the contract's port order", log);
  }
  // The property's own non-vacuity control: a result whose attachment does not
  // match its blocking state MUST be reported.
  propertyControl("an attachment that contradicts its blocking state must be reported", attachmentShape({
    returned: { blockingError: { blockingError: "x" }, message: { attachment: { type: "hook_success" } } },
  }));
  propertyControl("a settled call that returned nothing must be reported", attachmentShape({ returned: undefined }));
}

// ---- verdict ----------------------------------------------------------------
// Floors set to the counts this file actually reaches, so an edit that deletes
// half the cross-product fails rather than passing faster.
if (checks < 1408) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 188) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);
// Two properties are stated per graded case — upstream's and the owned side's —
// so the floor tracks the comparison count's shape: the dispatchers' pairing
// property plus the two synthetic ones, and section 5's attachment-shape
// statement on every case that settled. And `pairedCases` is the floor that
// matters more — a property nothing ever satisfies non-vacuously is a property
// nobody tested.
if (properties < 1005) failures.push(`only ${properties} property statement(s) ran`);
if (pairedCases < 11) failures.push(`only ${pairedCases} case(s) carried a lifecycle edge — the pairing property is vacuous on the rest`);

console.log(`=== hook-dispatch parity: ${checks} comparison(s), ${controls} control(s), ${properties} property statement(s) over ${pairedCases} paired case(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — every owned hook dispatcher matches the pinned upstream body over the full cross-product"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
