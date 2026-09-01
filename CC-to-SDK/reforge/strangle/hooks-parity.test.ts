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
// that oracle, and `post-tool-hooks` is graded here alongside the ten dispatchers
// W5 owns — six from its first pass, four more that C8's boundary review found
// live after the wave's probe had recorded them as dead.
//
// TWO SHAPES, NOT ONE. Nine dispatchers are `async function*` and stream their
// executor's results back to a caller that folds them into the conversation.
// PreCompact and SessionEnd are plain `async function`s that AWAIT a different
// executor (upstream `AE`), because a compaction and a session teardown have no
// conversation to stream into — and PreCompact goes further: it reduces its
// results to a verdict the compactor obeys. That reduction is the largest thing
// this file grades that no scenario can reach at all, since a callback that
// returns `{continue:true}` can neither add instructions nor block.
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

/** The adapters' registration surface — exactly what the strangled graph calls. */
const reforge = (globalThis as { __reforge?: Record<string, (...a: unknown[]) => AsyncGenerator<unknown, unknown>> }).__reforge!;

let checks = 0;
let controls = 0;
const failures: string[] = [];

const ENGINE = readFileSync(join(BUNDLE_MODULES, "chunk-fy12d89p.js"), "utf8");
/** The plain-object predicate lives in its own single-export chunk. */
const PREDICATE_CHUNK = readFileSync(join(BUNDLE_MODULES, "chunk-79e2v0j6.js"), "utf8");

function eq(label: string, upstream: unknown, owned: unknown): void {
  checks++;
  const a = JSON.stringify(upstream) ?? "undefined";
  const b = JSON.stringify(owned) ?? "undefined";
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
  if ((JSON.stringify(upstream) ?? "undefined") !== (JSON.stringify(perturbedOwned) ?? "undefined")) return;
  failures.push(`CONTROL ${label}: the perturbed owned result compared EQUAL — this file cannot see a wrong implementation`);
}

// ---- extraction -------------------------------------------------------------

/**
 * The span of the function that carries an event's anchor, found the same way
 * the SPLICE finds it: by the `hook_event_name:"<Event>"` literal, then outward
 * to the enclosing declaration. Locating the oracle's subject by a different
 * rule than the build's would let the two grade different functions.
 *
 * `kind` distinguishes the two shapes this family has. Seven dispatchers are
 * `async function*` and stream their executor's results; PreCompact and
 * SessionEnd are plain `async function`s that await a different executor,
 * because their callers have no conversation to stream into. The minifier
 * writes the first with no space before the name and the second with one, so
 * the two searches cannot pick up each other's declarations.
 *
 * Brace matching skips `'` and `"` strings; template literals are counted
 * through, which is safe here because every `${…}` in these bodies contributes a
 * balanced pair. A body that grew an unbalanced brace inside a template would
 * fail loudly at the `params` check below rather than silently truncate.
 */
function dispatcherSource(event: string, params: number, kind: "generator" | "awaited" = "generator"): string {
  const anchor = `hook_event_name:"${event}"`;
  const declaration = kind === "generator" ? "async function*" : "async function ";
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
    const declared = source.slice(source.indexOf("(") + 1, source.indexOf(")"));
    if (splitParams(declared).length === params) found.push(source);
  }
  if (found.length !== 1) throw new Error(`${event}: expected exactly one ${params}-parameter dispatcher, found ${found.length}`);
  return found[0];
}

/** Top-level commas of a minified parameter list (defaults may contain none here, but `!1`/`"turn_end"` do not nest). */
const splitParams = (text: string): string[] => (text.trim() === "" ? [] : text.split(","));

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

/** Everything the stubs saw, per case. Compared alongside the yielded sequence. */
interface Trace {
  hasHookForEvent: unknown[][];
  base: unknown[][];
  cwd: number;
  executor: unknown[][];
  chain: unknown[][];
  confined: unknown[][];
  stableKey: unknown[];
  moduleHandlers: unknown[][];
  backgroundTasks: unknown[][];
  sessionCrons: number;
  agentTranscriptPath: unknown[][];
  sessionTitle: unknown[][];
  uuid: number;
  log: unknown[][];
  /** the AWAITING executor (upstream `AE`) — PreCompact's and SessionEnd's */
  executorAwait: unknown[][];
  /** the session-id coercion SessionStart applies to an override */
  sessionId: unknown[][];
  /** the activity-hold bracket around a SessionStart dispatch, in call order */
  activity: string[];
  /** what SessionEnd wrote to stderr, and what it cleared from the registry */
  stderr: string[];
  registryClear: unknown[][];
}
const emptyTrace = (): Trace => ({
  hasHookForEvent: [],
  base: [],
  cwd: 0,
  executor: [],
  chain: [],
  confined: [],
  stableKey: [],
  moduleHandlers: [],
  backgroundTasks: [],
  sessionCrons: 0,
  agentTranscriptPath: [],
  sessionTitle: [],
  uuid: 0,
  log: [],
  executorAwait: [],
  sessionId: [],
  activity: [],
  stderr: [],
  registryClear: [],
});

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

function makePorts(spec: StubSpec, sink: Trace) {
  const results = spec.results ?? [{ decision: "continue" }, { decision: "second" }];
  return {
    hasHookForEvent: (...args: unknown[]) => {
      sink.hasHookForEvent.push(args);
      return spec.registered;
    },
    createBaseHookInput: (...args: unknown[]) => {
      sink.base.push(args);
      return { ...BASE_PREFIX };
    },
    cwd: () => {
      sink.cwd++;
      return "/sandbox";
    },
    executeHooks: async function* (request: unknown) {
      sink.executor.push([request]);
      if (spec.executorThrows !== undefined) throw new Error(spec.executorThrows);
      for (const r of results) yield r;
      return { executed: results.length };
    },
    executeHooksAwait: async (request: unknown) => {
      sink.executorAwait.push([request]);
      if (spec.executorThrows !== undefined) throw new Error(spec.executorThrows);
      return spec.awaitResults ?? [];
    },
    sessionId: (...args: unknown[]) => {
      sink.sessionId.push(args);
      return `coerced:${String(args[0])}`;
    },
    beginActivity: (...args: unknown[]) => {
      sink.activity.push(`begin(${args.join(",")})`);
    },
    endActivity: (...args: unknown[]) => {
      sink.activity.push(`end(${args.join(",")})`);
    },
    // NOT a capture: SessionEnd reads the registry off its own options bag. It
    // is stubbed here anyway so each side gets its own sink — an argument shared
    // between the two runs would record both into one and grade neither.
    sessionHooks: {
      clear: (...args: unknown[]) => {
        sink.registryClear.push(args);
      },
    },
    /** Collect what a dispatcher wrote to stderr instead of printing it. */
    captureStderr: async <T>(run: () => Promise<T>): Promise<T> => {
      const original = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        sink.stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      }) as typeof process.stderr.write;
      try {
        return await run();
      } finally {
        process.stderr.write = original;
      }
    },
    uuid: () => {
      sink.uuid++;
      return "44444444-4444-4444-8444-444444444444";
    },
    sessionTitle: (...args: unknown[]) => {
      sink.sessionTitle.push(args);
      return "a session title";
    },
    backgroundTasks: (...args: unknown[]) => {
      sink.backgroundTasks.push(args);
      return [{ id: "task-1", type: "local_bash", status: "running" }];
    },
    sessionCrons: () => {
      sink.sessionCrons++;
      return [];
    },
    agentTranscriptPath: (...args: unknown[]) => {
      sink.agentTranscriptPath.push(args);
      return `/t/agent-${String(args[0])}.jsonl`;
    },
    log: (...args: unknown[]) => {
      sink.log.push(args);
    },
    stableKeys: {
      stableKey: (v: unknown) => {
        sink.stableKey.push(v);
        return JSON.stringify(v);
      },
    },
    moduleHandlers: {
      hasModuleHandlers: (...args: unknown[]) => {
        sink.moduleHandlers.push(args);
        return spec.moduleHandlers === true;
      },
    },
    preToolChain: {
      executePreToolUseChain: async function* (request: { runSettingsHooks: (i?: unknown, o?: unknown) => AsyncIterable<unknown> }) {
        sink.chain.push([{ ...request, runSettingsHooks: "<closure>" }]);
        for (const r of spec.chainResults ?? [{ type: "chain" }]) yield r;
        // The chain calls back into the dispatcher's closure — with a rewritten
        // input and with per-call options — and that closure's request is the
        // half of this dispatcher a scenario cannot reach at all.
        for await (const r of request.runSettingsHooks({ rewritten: true }, { managedHooksOnly: true })) yield r;
      },
    },
    stripConfinedHookApproval: (result: unknown, label: unknown) => {
      sink.confined.push([result, label]);
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
function prepare(row: string, event: string, params: number, kind: "generator" | "awaited" = "generator") {
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
 * The same, for the two dispatchers that are not generators. `prepare` is typed
 * for the streaming shape because seven of the nine are; PreCompact and
 * SessionEnd await a value instead, and the difference is in the CALLING
 * convention only — the extraction, the manifest bindings and the forwarded
 * argument list are identical.
 */
function prepareAwaited(row: string, event: string, params: number) {
  const p = prepare(row, event, params, "awaited");
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

/** Run both sides of one case against fresh sinks, and compare output AND trace. */
async function compare(
  label: string,
  spec: StubSpec,
  constants: Record<string, unknown>,
  runUpstream: (p: PortSet) => AsyncGenerator<unknown, unknown>,
  runOwned: (p: PortSet) => AsyncGenerator<unknown, unknown>,
): Promise<{ upstream: { yielded: unknown[]; returned?: unknown; threw?: string }; trace: Trace }> {
  const upSink = emptyTrace();
  const upPorts = makePorts(spec, upSink);
  bindGlobals(upPorts);
  const up = await drain(runUpstream(upPorts));

  const ownSink = emptyTrace();
  const ownPorts = makePorts(spec, ownSink);
  const own = await drain(runOwned(ownPorts));

  eq(`${label} [yields+return]`, up, own);
  // The trace is the half a callback corpus cannot see: which ports ran, with
  // what, and how often. The EXECUTOR REQUEST rides in it, so this comparison is
  // what actually grades the hook record's field set and order.
  eq(`${label} [ports]`, upSink, ownSink);
  return { upstream: up, trace: upSink };
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
): Promise<{ upstream: { returned?: unknown; threw?: string }; trace: Trace }> {
  const upSink = emptyTrace();
  const upPorts = makePorts(spec, upSink);
  bindGlobals(upPorts);
  const up = await upPorts.captureStderr(() => settle(runUpstream(upPorts)));

  const ownSink = emptyTrace();
  const ownPorts = makePorts(spec, ownSink);
  const own = await ownPorts.captureStderr(() => settle(runOwned(ownPorts)));

  eq(`${label} [returns]`, up, own);
  eq(`${label} [ports]`, upSink, ownSink);
  return { upstream: up, trace: upSink };
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
  const record = (trace.executor[0][0] as { hookInput: Record<string, unknown> }).hookInput;
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
  mustDiffer("the confined-session filter skipped on the chain path", chained.trace.confined.length, 0);
  mustDiffer("the chain path falling through to the settings path as well", chained.upstream.yielded.length, 0);
  const arrayInput = await compare(
    "pre-tool-hooks array-input control",
    { registered: true, moduleHandlers: true },
    constants,
    () => upstream(...cases[8][2]),
    (p) => owned(...(cases[8][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  mustDiffer("an array tool input offered to the chain", arrayInput.trace.chain.length, 1);
  const refused = await compare(
    "pre-tool-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 8), ...forwarded(p, constants)),
  );
  mustDiffer("a refusal that still built the record", refused.trace.base.length, 1);
  mustDiffer("a refusal that still logged", refused.trace.log.length, 1);
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
  mustDiffer("the batch guard consulted under the acting agent alone", fanned.trace.hasHookForEvent[0][2], ["agent-1"]);
  const off = await compare(
    "post-tool-batch-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 6), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered batch that still called the executor", off.trace.executor.length, 1);
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
  const request = trace.executor[0][0] as { timeoutMs: number };
  mustDiffer("the shared 600 s hook timeout used instead of this event's own 30 s", request.timeoutMs, DEFAULT_HOOK_TIMEOUT_MS);
  mustDiffer("the prompt-submit timeout drifting from the pinned declaration", PROMPT_SUBMIT_TIMEOUT_MS, 60000);
  const off = await compare(
    "user-prompt-submit-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 5), ...forwarded(p, constants)),
  );
  mustDiffer("an unregistered submission that still called the executor", off.trace.executor.length, 1);
  mustDiffer("the fan-out rule applied to a prompt submission", off.trace.hasHookForEvent[0][2], ["session-1"]);
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
  const subRecord = (sub.trace.executor[0][0] as { hookInput: Record<string, unknown> }).hookInput;
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
  const plainRecord = (plain.trace.executor[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  mustDiffer("the Stop arm carrying the subagent fields", Object.keys(plainRecord), Object.keys(subRecord));
  mustDiffer("the Stop arm resolving an agent transcript path", plain.trace.agentTranscriptPath.length, 1);
  const toolOnlyRun = await compare(
    "stop-hooks empty-text control",
    { registered: true },
    constants,
    () => upstream(...cases[10][2]),
    (p) => owned(...(cases[10][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  const emptyTextRecord = (toolOnlyRun.trace.executor[0][0] as { hookInput: { last_assistant_message?: unknown } }).hookInput;
  mustDiffer("an empty last-assistant text carried as \"\" rather than dropped", emptyTextRecord.last_assistant_message, "");
  const reactionsOff = await compare(
    "stop-hooks reactions control",
    { registered: true },
    constants,
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("the reactions phase running without a registered function hook", reactionsOff.trace.executor.length, 1);
  const delegated = await compare(
    "stop-hooks delegated control",
    { registered: true },
    constants,
    () => upstream(...cases[4][2]),
    (p) => owned(...(cases[4][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("a delegated-observation subagent that still consulted the registry", delegated.trace.hasHookForEvent.length, 1);
  const managed = await compare(
    "stop-hooks web-fetch control",
    { registered: false },
    constants,
    () => upstream(...cases[5][2]),
    (p) => owned(...(cases[5][2] as unknown[]).slice(0, 9), ...forwarded(p, constants)),
  );
  mustDiffer("the web-fetch subagent running with settings hooks as well", (managed.trace.executor[0][0] as { managedHooksOnly: boolean }).managedHooksOnly, false);
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
  const request = trace.executor[0][0] as { matchQuery: string; toolUseID: string };
  mustDiffer("the agent ID used as the match query instead of the agent TYPE", request.matchQuery, "agent-1");
  mustDiffer("a real tool-use id expected where this event mints one", request.toolUseID, "tu-1");
  mustDiffer("this dispatcher gaining a registration guard it does not have", trace.hasHookForEvent.length, 1);
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
  const request = trace.executor[0][0] as { toolUseID: string; forceSyncExecution: boolean; suppressPerInvocationTelemetry: boolean };
  mustDiffer("the correlation id built from the turn rather than the message", request.toolUseID, "turn-1-3");
  mustDiffer("display hooks deferred rather than run synchronously", request.forceSyncExecution, false);
  mustDiffer("per-invocation telemetry left on for a per-message event", request.suppressPerInvocationTelemetry, false);
  mustDiffer("the common prefix built with a permission mode this event does not have", trace.base[0].length, 4);
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
  const record = (trace.executor[0][0] as { hookInput: Record<string, unknown> }).hookInput;
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
  const request = trace.executor[0][0] as Record<string, unknown>;
  mustDiffer("a managed-hooks option forwarded, which this dispatcher does not take", "managedHooksOnly" in request, true);
  const refused = await compare(
    "post-tool-failure-hooks refusal control",
    { registered: false },
    constants,
    () => upstream(...cases[1][2]),
    (p) => owned(...(cases[1][2] as unknown[]).slice(0, 10), ...forwarded(p, constants)),
  );
  mustDiffer("a refusal that still built the record", refused.trace.base.length, 1);
  mustDiffer("a refusal that still called the executor", refused.trace.executor.length, 1);
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
  const request = trace.executor[0][0] as { session: { id: string }; hookInput: Record<string, unknown> };
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
  mustDiffer("the title derived from the REAL session id rather than the record's", trace.sessionTitle[0], ["session-1"]);
  const spread = await compare(
    "session-start-hooks spread control",
    { registered: true },
    constants,
    () => upstream(...cases[4][2]),
    (p) => owned(...(cases[4][2] as unknown[]).slice(0, 12), ...forwarded(p, constants)),
  );
  const spreadRecord = (spread.trace.executor[0][0] as { hookInput: Record<string, unknown> }).hookInput;
  mustDiffer("the extra fields merged BEFORE the named ones, so the named one wins", spreadRecord.model, "claude-opus-5");
  const threw = await compare(
    "session-start-hooks hold control",
    { registered: true, executorThrows: "executor exploded" },
    constants,
    () => upstream(...cases[7][2]),
    (p) => owned(...(cases[7][2] as unknown[]).slice(0, 12), ...forwarded(p, constants)),
  );
  mustDiffer("the hold left un-released when the executor throws", threw.trace.activity, [`begin(hook_exec,${ACTIVITY_HOLD})`]);
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
  eq("session-end-hooks field order", Object.keys((trace.executorAwait[0][0] as { hookInput: Record<string, unknown> }).hookInput), [
    "session_id",
    "transcript_path",
    "cwd",
    "prompt_id",
    "permission_mode",
    "effort",
    "hook_event_name",
    "reason",
  ]);
  mustDiffer("a failed hook reported without naming the command that failed", trace.stderr, ["SessionEnd hook failed: it broke\n"]);
  mustDiffer("the registry left uncleared", trace.registryClear, []);
  const quiet = await compareValue(
    "session-end-hooks silence control",
    specs[2][1],
    (p) => upstream(SESSION, "clear", optionSets[0][1](p)),
    (p) => owned(SESSION, "clear", optionSets[0][1](p), ...forwarded(p, constants)),
  );
  mustDiffer("a SUCCEEDED hook's output written to stderr as well", quiet.trace.stderr.length, 1);
  const empty = await compareValue(
    "session-end-hooks teardown control",
    specs[0][1],
    (p) => upstream(SESSION, "clear", optionSets[0][1](p)),
    (p) => owned(SESSION, "clear", optionSets[0][1](p), ...forwarded(p, constants)),
  );
  mustDiffer("the clear skipped when no hook ran", empty.trace.registryClear, []);
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
  eq("pre-compact-hooks field order", Object.keys((trace.executorAwait[0][0] as { hookInput: Record<string, unknown> }).hookInput), [
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

// ---- verdict ----------------------------------------------------------------
// Floors set to the counts this file actually reaches, so an edit that deletes
// half the cross-product fails rather than passing faster.
if (checks < 503) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 58) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);

console.log(`=== hook-dispatch parity: ${checks} comparison(s), ${controls} control(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — every owned hook dispatcher matches the pinned upstream body over the full cross-product"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
