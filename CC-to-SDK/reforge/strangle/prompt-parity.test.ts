// UPSTREAM-DIFFERENTIAL CONTRACT TEST for W3's prompt-assembly modules.
//
//   npx tsx strangle/prompt-parity.test.ts
//
// The same oracle W2 built for the tool descriptions (`description-parity.test.ts`),
// pointed at the functions this wave owns. §2.4 buys ownership of a reimplemented
// body against "the differential surfaces its output flows into PLUS a contract
// test where its domain is wider than the corpus" — and prompt assembly is where
// that gap is widest in the campaign so far:
//
//  - the block partition has THREE paths and the corpus reaches one, because
//    `staticPromptEnabled()` is pinned false by §3.3's gate environment;
//  - the identity selector has three outcomes and the corpus reaches two;
//  - the reporting-outcomes block is provider-gated and never present;
//  - the boundary marker is a caller-supplied sentinel no recording carries;
//  - the context renderers' empty-map arms cannot occur (`currentDate` is
//    unconditional).
//
// So the branches `strangle/attestation.ts` records as reviewed exclusions are
// exactly the branches THIS file grades, and it grades them the strong way: it
// extracts the upstream bodies from the PINNED BUNDLE, evaluates them with
// stubbed ports, and requires deep equality with the owned module over the full
// cross-product. Nothing here hand-writes an expectation, so nothing here can
// encode a transcription error — and an unrendered branch ends up better
// evidenced than a rendered one, since a differential red only ever compares
// what some scenario happened to send.
//
// ON `eval`. It is the mechanism, not a shortcut: the oracle has to be
// upstream's own bytes, and those bytes are minified expressions that only
// exist as source. The input is the PINNED, locally extracted bundle named by
// `src/pin.ts` — never network data, never user input — and this file is a
// developer test that never ships. `description-parity.test.ts` established the
// pattern; the extraction regexes are shape-based and fail loudly, so a pin bump
// that moves a body breaks this test rather than quietly comparing something
// else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { systemPromptBlocks } from "./modules/system-prompt-blocks/reference.js";
import { systemPromptTextBlocks } from "./modules/system-prompt-wire/reference.js";
import { identityPrompt } from "./modules/identity-prompt/reference.js";
import { contextReminderMessages } from "./modules/context-reminder/reference.js";
import { contextPromptLines } from "./modules/context-prompt-lines/reference.js";
import { subagentPrompt } from "./modules/subagent-prompt/reference.js";
import { SUMMARIZATION_PROMPT } from "./modules/compaction-prompt/reference.js";
// W7.5 — the six OS() section builders.
import { executingActionsSection } from "./modules/executing-actions-section/reference.js";
import { doingTasksSection } from "./modules/doing-tasks-section/reference.js";
import { systemSection } from "./modules/system-section/reference.js";
import { toneAndStyleSection } from "./modules/tone-and-style-section/reference.js";
import {
  BASH_TOOL,
  EDIT_TOOL,
  GLOB_TOOL,
  GREP_TOOL,
  POWERSHELL_TOOL,
  READ_TOOL,
  TASK_CREATE_TOOL,
  TODO_WRITE_TOOL,
  WRITE_TOOL,
  usingToolsSection,
} from "./modules/using-tools-section/reference.js";
import { AGENT_IDENTITY, SECURITY_POLICY, identitySecuritySection } from "./modules/identity-security-section/reference.js";

let checks = 0;
let controls = 0;
const failures: string[] = [];

const ENGINE = readFileSync(join(BUNDLE_MODULES, "chunk-fy12d89p.js"), "utf8");
/** The boundary marker is declared in a shared-constants chunk, not the engine chunk. */
const CONSTANTS = readFileSync(join(BUNDLE_MODULES, "chunk-7g4v1yq9.js"), "utf8");
/** The catalog's tool-name literals live in the primitives chunk. */
const PRIMITIVES = readFileSync(join(BUNDLE_MODULES, "chunk-bsdtxcdc.js"), "utf8");

/** One shape-anchored extraction. Throws when the shape is gone. */
function extract(label: string, re: RegExp, source: string = ENGINE): string {
  const m = source.match(re);
  if (!m) throw new Error(`${label}: upstream shape not found — ${re}`);
  return m[0];
}

/** The declared name of an extracted `function NAME(...)`. */
const nameOf = (fn: string): string => fn.match(/function\s+([\w$]+)/)![1];

/**
 * The same extraction, by BALANCED BRACES rather than by a tail pattern.
 *
 * The section builders end in `.join(`\n`)` — a template literal containing a
 * real newline — and a regex tail that has to spell that is brittle for no
 * benefit. This walks from the declaration to its matching close brace, which is
 * exact where a tail pattern is a guess, and still fails loudly: a name that
 * moved throws, and the caller asserts a fragment it must contain.
 */
function extractFn(name: string, mustContain: string, source: string = ENGINE): string {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name}: no declaration in the pinned chunk — the binding moved`);
  let depth = 0;
  let i = source.indexOf("{", source.indexOf(")", at));
  for (let k = i; k < source.length; k++) {
    if (source[k] === "{") depth++;
    else if (source[k] === "}" && --depth === 0) {
      const body = source.slice(at, k + 1);
      if (!body.includes(mustContain)) throw new Error(`${name}: extracted body does not contain ${JSON.stringify(mustContain)}`);
      return body;
    }
  }
  throw new Error(`${name}: unbalanced braces from ${at}`);
}


/**
 * Build an upstream function from its extracted source with its free variables
 * bound. `bindings` is prelude source; ports are reached through `globalThis` so
 * a live JS value (a stub with behaviour) can be handed to a body that has no
 * other way to close over one.
 *
 * Every port binding is an arrow that forwards to `globalThis` AT CALL TIME
 * rather than a `const` snapshot of it. That is not style: a snapshot captures
 * whatever the stub happened to be when the body was built, so re-pointing a
 * stub between cases would compare the new stub against the old one and pass.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build<T>(fn: string, bindings: string): T {
  // eslint-disable-next-line no-eval
  return eval(`(() => { ${bindings}; ${fn} return ${nameOf(fn)}; })()`) as T;
}

const ports = globalThis as unknown as Record<string, unknown>;

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
 * The inverse of `eq`, and this file's non-vacuity control (C6 boundary review,
 * finding 5).
 *
 * The `checks` floor at the bottom counts COMPARISONS; it cannot say whether a
 * comparison is able to fail. Every input above is legitimate and every owned
 * module is correct, so a stubbed-out `eq` — or an oracle accidentally compared
 * against itself, which is the specific way a differential test dies — would
 * print the same green. So each block below also hands `mustDiffer` a
 * deliberately WRONG owned result and requires the comparison to see it.
 *
 * Perturbed IN MEMORY and on the OWNED side only, the shape `mechanism.test.ts`
 * established for the build's value comparison: upstream is the measuring stick
 * and is never touched, nothing is written to disk, and each mutant is a wrong
 * implementation this module could plausibly ship rather than an arbitrary
 * corruption.
 *
 * Counted separately from `checks` so the floor keeps meaning "the cross-product
 * is complete" rather than being satisfiable by adding controls.
 */
function mustDiffer(label: string, upstream: unknown, perturbedOwned: unknown): void {
  controls++;
  if ((JSON.stringify(upstream) ?? "undefined") !== (JSON.stringify(perturbedOwned) ?? "undefined")) return;
  failures.push(`CONTROL ${label}: the perturbed owned result compared EQUAL — this file cannot see a wrong implementation`);
}

console.log(`prompt-assembly parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// The constants the owned modules recognise blocks BY, located in the bundle
// rather than written down: the owned side reads its own copies, so a drifted
// owned constant shows up as an output mismatch below rather than as a tautology.
const BOUNDARY = extract("wO", /wO="__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"/, CONSTANTS).split('"')[1];
const BILLING = extract("tL", /var tL="x-anthropic-billing-header:"/).split('"')[1];
/** `aE=\`# Reporting outcomes …\`;` — kept as SOURCE so a prelude can declare it. */
const OUTCOMES_DECL = extract("aE", /aE=`# Reporting outcomes[\s\S]*?`;/);
/** `var Efe=… , Wze=… , Qze=… , i9t=[…], n6=new Set(i9t)` — the identity trio and its Set. */
const IDENTITY_DECL = extract("identities", /var Efe="You are Claude Code[\s\S]*?n6=new Set\(i9t\)/);
// eslint-disable-next-line no-eval
const OUTCOMES = eval(`(()=>{ var ${OUTCOMES_DECL} return aE })()`) as string;
// eslint-disable-next-line no-eval
const IDENTITIES = eval(`(()=>{ ${IDENTITY_DECL}; return [Efe, Wze, Qze] })()`) as [string, string, string];

// ---- the block partition (upstream `tOe`) -----------------------------------
// Every block-kind combination against both values of the gate, with the
// telemetry sink compared as well: two of the three paths differ only in which
// event they emit, so an output-only comparison would call them equivalent.
{
  const fn = extract("tOe", /function tOe\(e,t\)\{let [\w$]+=[\w$]+\(\),[\w$]+=e\.findIndex[\s\S]*?cacheScope:"org"\}\);return A\}/);
  const [cli, append, sdk] = IDENTITIES;
  const billing = `${BILLING} cc_version=2.1.251;`;

  const inputs: [string, unknown[]][] = [
    ["empty", []],
    ["billing+identity", [billing, sdk]],
    ["billing+identity+sections", [billing, sdk, "# One", "# Two"]],
    ["full, no marker", [billing, append, OUTCOMES, "# One", "# Two"]],
    ["full, with marker", [billing, cli, OUTCOMES, "# Static", BOUNDARY, "# Dynamic"]],
    ["marker first", [BOUNDARY, billing, sdk, "# After"]],
    ["outcomes without identity", [billing, OUTCOMES, "# One"]],
    ["outcomes without billing", [sdk, OUTCOMES, "# One"]],
    ["falsy entries", [billing, "", sdk, null, "# One"]],
    ["sections only", ["# One", "# Two", "# Three"]],
    ["marker only", [BOUNDARY]],
  ];
  const optionSets: [string, { skipGlobalCacheForSystemPrompt?: boolean } | undefined][] = [
    ["opts=undefined", undefined],
    ["skipGlobal=true", { skipGlobalCacheForSystemPrompt: true }],
    ["skipGlobal=false", { skipGlobalCacheForSystemPrompt: false }],
  ];

  const PRELUDE =
    `const wO=${JSON.stringify(BOUNDARY)}, tL=${JSON.stringify(BILLING)};` +
    ` ${IDENTITY_DECL}; var ${OUTCOMES_DECL}` +
    ` const Kde=(...a)=>globalThis.__staticEnabled(...a), s=(...a)=>globalThis.__telemetry(...a);`;

  for (const staticEnabled of [false, true]) {
    const upstreamEvents: [string, unknown][] = [];
    ports.__telemetry = (event: string, payload: unknown) => upstreamEvents.push([event, payload]);
    ports.__staticEnabled = () => staticEnabled;
    const upstreamFn = build<(b: unknown[], o?: unknown) => unknown>(fn, PRELUDE);
    for (const [inputLabel, blocks] of inputs) {
      for (const [optLabel, options] of optionSets) {
        const label = `partition static=${staticEnabled} ${inputLabel} ${optLabel}`;
        upstreamEvents.length = 0;
        const ownedEvents: [string, unknown][] = [];
        eq(
          label,
          upstreamFn(blocks, options),
          systemPromptBlocks(blocks, options, () => staticEnabled, (e: string, p: unknown) => ownedEvents.push([e, p])),
        );
        eq(`${label} [telemetry]`, [...upstreamEvents], ownedEvents);
      }
    }
  }

  // ---- the non-vacuity controls for this block --------------------------------
  // Driven on the boundary path, which is the richest one and the one no
  // scenario reaches: it is the only path that mints a "global" scope, the only
  // one that leaves the identity block unscoped, and the only one that emits the
  // boundary event. Each mutant below is a wrong partition this module could
  // plausibly ship.
  {
    ports.__staticEnabled = () => true;
    const seen: [string, unknown][] = [];
    ports.__telemetry = (event: string, payload: unknown) => seen.push([event, payload]);
    const upstreamFn = build<(b: unknown[], o?: unknown) => unknown>(fn, PRELUDE);
    const blocks = [billing, cli, OUTCOMES, "# Static", BOUNDARY, "# Dynamic"];
    type ScopedBlock = { text: string; cacheScope: string | null };
    const upstreamOut = upstreamFn(blocks) as ScopedBlock[];
    const owned = (mutate: (b: ScopedBlock) => ScopedBlock): ScopedBlock[] =>
      (systemPromptBlocks(blocks, undefined, () => true, () => {}) as ScopedBlock[]).map(mutate);

    mustDiffer("the static prefix demoted from the global cache scope to org", upstreamOut, owned((b) => (b.cacheScope === "global" ? { ...b, cacheScope: "org" } : b)));
    mustDiffer("the identity block cached instead of left unscoped on the boundary path", upstreamOut, owned((b) => (b.text === cli ? { ...b, cacheScope: "org" } : b)));
    mustDiffer("the boundary marker left in the block it split", upstreamOut, owned((b) => (b.cacheScope === "org" ? { ...b, text: `${BOUNDARY}\n\n${b.text}` } : b)));
    mustDiffer("the blocks emitted in arrival order rather than upstream's push order", upstreamOut, [...(owned((b) => b))].reverse());

    // …and the telemetry half. Paths 1 and 3 differ from each other in nothing
    // BUT the event they emit, so a comparison blind to the event name would
    // call two different implementations equivalent.
    seen.length = 0;
    upstreamFn(blocks);
    const ownedEvents: [string, unknown][] = [];
    systemPromptBlocks(blocks, undefined, () => true, (e: string, p: unknown) => ownedEvents.push([e, p]));
    mustDiffer(
      "the boundary event renamed to the missing-marker event",
      [...seen],
      ownedEvents.map(([e, p]) => [e === "tengu_sysprompt_boundary_found" ? "tengu_sysprompt_missing_boundary_marker" : e, p]),
    );
    mustDiffer("the event emitted with no payload", [...seen], ownedEvents.map(([e]) => [e, {}]));
  }
}

// ---- scoped blocks -> API text blocks (upstream `U8n`) ----------------------
{
  const fn = extract("U8n", /function U8n\(e,t,r\)\{return tOe\([\s\S]*?\}\)\)\}/);
  const cacheControl = ({ scope, ttl }: { scope?: string | null; ttl?: string } = {}) => ({
    type: "ephemeral",
    ...(ttl && { ttl }),
    ...(scope === "global" && { scope }),
  });
  const scoped = [
    { text: "billing", cacheScope: null },
    { text: "identity", cacheScope: "org" },
    { text: "static", cacheScope: "global" },
  ];
  const partition = (_blocks: unknown, _options: unknown) => scoped;
  ports.__partition = partition;
  ports.__cacheControl = cacheControl;
  const upstreamFn = build<(b: unknown, t: unknown, r?: unknown) => unknown>(
    fn,
    "const tOe=(...a)=>globalThis.__partition(...a), fF=(...a)=>globalThis.__cacheControl(...a);",
  );

  for (const caching of [true, false]) {
    for (const [optLabel, options] of [
      ["opts=undefined", undefined],
      ["ttl=1h", { cacheTtl: "1h", skipGlobalCacheForSystemPrompt: true }],
      ["ttl absent", { skipGlobalCacheForSystemPrompt: false }],
    ] as [string, { cacheTtl?: string; skipGlobalCacheForSystemPrompt?: boolean } | undefined][]) {
      eq(
        `wire caching=${caching} ${optLabel}`,
        upstreamFn(["ignored"], caching, options),
        systemPromptTextBlocks(["ignored"], caching, options, partition, cacheControl),
      );
    }
  }

  // The options object the wire hands the partition is part of its contract: it
  // forwards ONLY `skipGlobalCacheForSystemPrompt`, never the whole object — so
  // a `cacheTtl` must not leak into the partition's own decision.
  const upstreamSeen: unknown[] = [];
  const ownedSeen: unknown[] = [];
  ports.__partition = (_b: unknown, o: unknown) => {
    upstreamSeen.push(o);
    return scoped;
  };
  upstreamFn(["x"], true, { cacheTtl: "1h", skipGlobalCacheForSystemPrompt: true });
  systemPromptTextBlocks(
    ["x"],
    true,
    { cacheTtl: "1h", skipGlobalCacheForSystemPrompt: true },
    (_b: unknown, o: unknown) => {
      ownedSeen.push(o);
      return scoped;
    },
    cacheControl,
  );
  eq("wire forwards only skipGlobalCacheForSystemPrompt", upstreamSeen, ownedSeen);
}

// ---- the identity selector (upstream `r6`) ----------------------------------
{
  // Spelled out rather than lazily matched: the lazy form stops at the INNER
  // block's `return Qze}` and silently drops the interactive arm.
  const fn = extract(
    "r6",
    /function r6\(e\)\{if\([\w$]+\(\)==="vertex"\)return [\w$]+;if\(e\?\.isNonInteractive\)\{if\(e\.hasAppendSystemPrompt\)return [\w$]+;return [\w$]+\}return [\w$]+\}/,
  );
  const sessions: [string, unknown][] = [
    ["undefined", undefined],
    ["interactive", { isNonInteractive: false, hasAppendSystemPrompt: false }],
    ["sdk", { isNonInteractive: true, hasAppendSystemPrompt: false }],
    ["sdk+append", { isNonInteractive: true, hasAppendSystemPrompt: true }],
    ["interactive+append", { isNonInteractive: false, hasAppendSystemPrompt: true }],
  ];
  for (const provider of ["firstParty", "vertex", "anthropicAws"]) {
    const upstreamFn = build<(s?: unknown) => string>(
      fn,
      `${IDENTITY_DECL}; const Ne=()=>${JSON.stringify(provider)};`,
    );
    for (const [label, session] of sessions) {
      eq(`identity provider=${provider} ${label}`, upstreamFn(session), identityPrompt(session, () => provider));
    }
  }

  // The control for this block. The Vertex arm is unreachable under §3.3's
  // pinned provider, so nothing but this file grades it — and the wrong
  // implementation it is exposed to is a selector that keys off the session
  // first and never reaches the provider override, which is correct on every
  // arm the corpus DOES render.
  //
  // Only the two SDK arms are listed: on an interactive session the override is
  // a no-op (both routes return the CLI sentence), so those arms have no
  // difference for a control to detect and claiming otherwise would be theatre.
  const vertexFn = build<(s?: unknown) => string>(fn, `${IDENTITY_DECL}; const Ne=()=>"vertex";`);
  const forgotVertex = (session: unknown) => identityPrompt(session, () => "firstParty");
  for (const [label, session] of sessions.filter(([l]) => l === "sdk" || l === "sdk+append")) {
    mustDiffer(`the vertex override skipped on the ${label} arm`, vertexFn(session), forgotVertex(session));
  }
}

// ---- the context reminder (upstream `HAt`) ----------------------------------
{
  const fn = extract("HAt", /function HAt\(e,t\)\{if\(Object\.entries\(t\)\.length===0\)[\s\S]*?\.\.\.e\]\}/);
  // The message constructor is a port on both sides; stubbing it to identity is
  // what makes the rendered CONTENT comparable.
  const makeMessage = (m: { content: string; isMeta: boolean }) => m;
  ports.__makeMessage = makeMessage;
  const upstreamFn = build<(m: unknown[], c: Record<string, string>) => unknown>(fn, "const xe=(...a)=>globalThis.__makeMessage(...a);");
  const contexts: [string, Record<string, string>][] = [
    ["empty", {}],
    ["one entry", { currentDate: "Today's date is 2026-09-01." }],
    ["two entries", { claudeMd: "# Conventions\nline two", currentDate: "Today's date is 2026-09-01." }],
    ["three entries", { claudeMd: "a", userEmail: "b", currentDate: "c" }],
    ["empty value", { claudeMd: "" }],
  ];
  for (const [label, context] of contexts) {
    const messages = [{ role: "user", content: "hi" }];
    eq(`reminder ${label}`, upstreamFn(messages, context), contextReminderMessages(messages, context, makeMessage));
  }
}

// ---- the context prompt tail (upstream `NAt`) -------------------------------
{
  const fn = extract("NAt", /function NAt\(e,t\)\{return\[\.\.\.e,Object\.entries\(t\)[\s\S]*?filter\(Boolean\)\}/);
  const upstreamFn = build<(b: unknown[], c: Record<string, string>) => unknown>(fn, "");
  const cases: [string, string[], Record<string, string>][] = [
    ["empty context", ["# One"], {}],
    ["one entry", ["# One"], { gitStatus: "Current branch: main" }],
    ["two entries", ["# One", "# Two"], { gitStatus: "clean", claudeMd: "x" }],
    ["falsy blocks", ["", "# Two"], { gitStatus: "clean" }],
    ["no blocks", [], {}],
    ["no blocks, one entry", [], { gitStatus: "clean" }],
  ];
  for (const [label, blocks, context] of cases) {
    eq(`prompt lines ${label}`, upstreamFn(blocks, context), contextPromptLines(blocks, context));
  }
}

// ---- the subagent prompt (upstream `zH`) ------------------------------------
{
  const fn = extract("zH", /async function zH\(e,t,r\)\{let [\w$]+=`Notes:[\s\S]*?\]\}/);
  const writeName = extract("ar", /var [\w$]+="Write"/, PRIMITIVES).split('"')[1];
  const upstreamFn = build<(s: string[], c: unknown, d: unknown) => Promise<unknown>>(
    fn,
    `const ar=${JSON.stringify(writeName)}, W8t=(...a)=>globalThis.__envSection(...a), kKe=(...a)=>globalThis.__tokenAttachment(...a);`,
  );
  const env = async () => "ENV_PARAGRAPH";
  const envNull = async () => null;
  const tokens = () => "<total_tokens>123 tokens left</total_tokens>";
  const tokensNull = () => null;
  const stubs: [string, () => Promise<string | null>, () => string | null][] = [
    ["both", env, tokens],
    ["env null", envNull, tokens],
    ["tokens null", env, tokensNull],
    ["both null", envNull, tokensNull],
  ];
  for (const [label, envStub, tokenStub] of stubs) {
    ports.__envSection = envStub;
    ports.__tokenAttachment = tokenStub;
    for (const sections of [[], ["AGENT PROMPT"], ["A", "B"]]) {
      eq(
        `subagent ${label} sections=${sections.length}`,
        await upstreamFn(sections, { ctx: 1 }, ["/extra"]),
        await subagentPrompt(sections, { ctx: 1 }, ["/extra"], envStub, tokenStub),
      );
    }
  }
}

// ---- the compaction prompt (upstream `l1n`, C5x's deferred obligation) ------
// The summarization prompt has no branches at all, so its attestation is not a
// coverage argument: what grades it is the build-time comparison of the owned
// initializer against the pinned chunk's own bytes (ast.ts `gradeDeclaratorValue`),
// which runs on every build. Repeated here so this file carries the whole
// subsystem's parity claim rather than only its branching half — and so the
// attestation report can name ONE oracle for every module it lists.
{
  const decl = extract("l1n", /l1n=`Your task is to create a detailed summary[\s\S]*?`(?=,[\w$]+=)/);
  // eslint-disable-next-line no-eval
  const upstream = eval(`(()=>{ var ${decl}; return l1n })()`) as string;
  eq("compaction prompt", upstream, SUMMARIZATION_PROMPT);
}


// ============================================================================
// W7.5 — the OS() prompt SECTIONS.
//
// A different corpus/domain gap from the pipeline above it. These six builders
// are all RENDERED — `sysprompt-preset`'s recorded request carries every one of
// them, and each row's solo sabotage reddens it — so unlike the partition, their
// happy path is differentially covered. What no recording can reach is their
// ALTERNATIVES: a feature gate pinned false, a REPL predicate that is false on
// every headless run, a latch nothing sets, an output style the harness does not
// select, and the tool catalogs the corpus does not have. Each of those is one
// side of a branch whose other side is the only one a recording will ever show.
//
// Upstream is bound to UPSTREAM's own helpers here (W4's boundary lesson): the
// bullet formatter is extracted from the bundle as source and declared in each
// prelude, never imported from the owned module, so a wrong owned formatter
// cannot flow through both sides and compare equal.
{
  const KM_DECL = extractFn("km", "flatMap");
  const HOOKS_DECL = extractFn("_8t", "Users may configure");

  // ---- x8t: the zero-capture section ---------------------------------------
  {
    const fn = extractFn("x8t", "# Executing actions with care");
    const upstream = build<() => string>(fn, "");
    eq("executing-actions section", upstream(), executingActionsSection());
    // NOT a trailing-whitespace strip: this section has none, so such a control
    // would compare EQUAL and prove nothing. Dropping the closing sentence is a
    // wrong implementation this module could plausibly ship.
    mustDiffer("the closing sentence dropped", upstream(), executingActionsSection().replace(" In short: only take risky actions carefully, and when in doubt, ask before acting.", ""));
    mustDiffer("upstream's escaped backticks dropped", upstream(), executingActionsSection().replaceAll("`", ""));
  }

  // ---- P8t: both arms of the verified-vs-assumed gate ----------------------
  {
    const fn = extractFn("P8t", "# Doing tasks");
    for (const gate of [false, true]) {
      const upstream = build<() => string>(fn, `${KM_DECL} const I=(...a)=>globalThis.__gate(...a);`);
      ports.__gate = () => gate;
      eq(`doing-tasks section, gate=${gate}`, upstream(), doingTasksSection(() => gate));
    }
    ports.__gate = () => true;
    const upstream = build<() => string>(fn, `${KM_DECL} const I=(...a)=>globalThis.__gate(...a);`);
    // The gate-true arm is the one no recording reaches, so its bullet is the
    // one a transcription error would hide. Both controls target it.
    mustDiffer("the gated bullet appended at the end instead of before the feedback intro", upstream(), doingTasksSection(() => false) + "\n - x");
    mustDiffer("the gate read as its own default", upstream(), doingTasksSection(() => false));
    // And the NESTED pair: flattening it changes the indent and nothing else.
    mustDiffer("the feedback pair flattened to the top-level indent", upstream(), upstream().replaceAll("  - ", " - "));
  }

  // ---- R8t: both arms of the system-reminder note --------------------------
  {
    const fn = extractFn("R8t", "# System");
    const upstream = build<(s: unknown) => string>(fn, `${KM_DECL} ${HOOKS_DECL} const SKe=(...a)=>globalThis.__note(...a);`);
    for (const [label, note] of [
      ["standard", "Tool results and user messages may include <system-reminder> or other tags."],
      ["latched", "The system may send updates, reminders, or modifications to rules via mid-conversation system turns."],
    ] as [string, string][]) {
      ports.__note = () => note;
      eq(`system section, note=${label}`, upstream("SESSION"), systemSection("SESSION", () => note));
    }
    ports.__note = (s: unknown, kind: unknown) => `${String(s)}|${String(kind)}`;
    eq("system section forwards the session and the kind", upstream("SESSION"), systemSection("SESSION", (s, k) => `${String(s)}|${String(k)}`));
    mustDiffer("the note asked for the lean kind instead of the standard one", upstream("SESSION"), systemSection("SESSION", (s) => `${String(s)}|lean`));
    mustDiffer("the folded-in hooks paragraph dropped", upstream("SESSION"), systemSection("SESSION", (s, k) => `${String(s)}|${String(k)}`).split("\n").filter((l) => !l.includes("hooks")).join("\n"));
  }

  // ---- D8t -----------------------------------------------------------------
  {
    const fn = extractFn("D8t", "# Tone and style");
    const upstream = build<() => string>(fn, KM_DECL);
    eq("tone-and-style section", upstream(), toneAndStyleSection());
    mustDiffer("a bullet dropped by an over-eager filter", upstream(), toneAndStyleSection().split("\n").slice(0, -1).join("\n"));
  }

  // ---- M8t: the whole cross-product, including the REPL arm ----------------
  {
    const fn = extractFn("M8t", "# Using your tools");
    const TOOLS = `const NE=${JSON.stringify(TASK_CREATE_TOOL)},ME=${JSON.stringify(TODO_WRITE_TOOL)},Qe=${JSON.stringify(BASH_TOOL)},Bt=${JSON.stringify(POWERSHELL_TOOL)},_t=${JSON.stringify(READ_TOOL)},Kt=${JSON.stringify(EDIT_TOOL)},ar=${JSON.stringify(WRITE_TOOL)},ti=${JSON.stringify(GLOB_TOOL)},Xo=${JSON.stringify(GREP_TOOL)};`;
    const upstream = build<(t: Set<string>) => string>(
      fn,
      `${TOOLS}${KM_DECL} const ty=(...a)=>globalThis.__repl(...a), Ny=(...a)=>globalThis.__search(...a);`,
    );
    const catalogs: [string, string[]][] = [
      ["todo+bash", [TODO_WRITE_TOOL, BASH_TOOL]],
      ["task+bash", [TASK_CREATE_TOOL, BASH_TOOL]],
      ["both task tools", [TASK_CREATE_TOOL, TODO_WRITE_TOOL, BASH_TOOL]],
      ["bash only", [BASH_TOOL]],
      ["todo, no shell", [TODO_WRITE_TOOL]],
      ["empty", []],
      ["everything", [TASK_CREATE_TOOL, TODO_WRITE_TOOL, BASH_TOOL, READ_TOOL, EDIT_TOOL, WRITE_TOOL, GLOB_TOOL, GREP_TOOL]],
    ];
    for (const repl of [false, true])
      for (const search of [false, true])
        for (const [label, names] of catalogs) {
          ports.__repl = () => repl;
          ports.__search = () => search;
          const set = new Set(names);
          eq(`using-tools section, repl=${repl} search=${search} ${label}`, upstream(set), usingToolsSection(set, () => repl, () => search));
        }
    // The REPL arm's empty-string answer is the only "" in the pipeline, and no
    // recording can produce it — a null would be dropped by the section filter
    // instead of joined, which is a different thing.
    ports.__repl = () => true;
    ports.__search = () => true;
    mustDiffer("the REPL arm answering null instead of the empty string", upstream(new Set()), null);
    mustDiffer("the REPL arm rendering the heading with no bullets", upstream(new Set()), "# Using your tools");
    ports.__repl = () => false;
    mustDiffer("the search tools named when Bash is present and search is on", upstream(new Set([BASH_TOOL])), usingToolsSection(new Set([BASH_TOOL]), () => false, () => false));
    mustDiffer("PowerShell named while Bash is in the catalog", upstream(new Set([BASH_TOOL])), usingToolsSection(new Set([]), () => false, () => true));
  }

  // ---- C8t: all three identity arms ----------------------------------------
  {
    const fn = extractFn("C8t", "IMPORTANT: You must NEVER generate or guess URLs");
    const upstream = build<(s: unknown) => string>(
      fn,
      `const rKe=${JSON.stringify(AGENT_IDENTITY)}, jfe=${JSON.stringify(SECURITY_POLICY)};` +
        ` const iKe=(...a)=>globalThis.__style(...a), eKe=(...a)=>globalThis.__frame(...a);`,
    );
    const STYLE_SENTENCE = 'You are an interactive agent that helps users according to your "Output Style", which describes how you should respond to user queries.';
    for (const [label, style] of [["a style", "STYLE"], ["no style", null]] as [string, unknown][])
      for (const frame of [false, true]) {
        ports.__style = () => STYLE_SENTENCE;
        ports.__frame = () => frame;
        eq(`identity-security section, ${label}, frame=${frame}`, upstream(style), identitySecuritySection(style, () => STYLE_SENTENCE, () => frame));
      }
    ports.__frame = () => false;
    mustDiffer("the style arm taken when there is no style", upstream(null), identitySecuritySection("STYLE", () => STYLE_SENTENCE, () => false));
    mustDiffer("the security paragraph dropped", upstream(null), identitySecuritySection(null, () => STYLE_SENTENCE, () => false).replace(SECURITY_POLICY, ""));
    ports.__frame = () => true;
    mustDiffer("the intro-frame arm ignored", upstream(null), identitySecuritySection(null, () => STYLE_SENTENCE, () => false));
  }
}

console.log(`\n=== prompt-assembly parity: ${checks} check(s) across the full branch cross-product, ${controls} non-vacuity control(s) ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
// 2 gate values x 11 inputs x 3 option sets x 2 (output + telemetry) = 132
// partition comparisons, + 7 wire + 15 identity + 5 reminder + 6 lines
// + 12 subagent + 1 compaction = 178 for the W3 pipeline. W7.5's six section
// builders add 39: 1 x8t + 2 P8t + 3 R8t + 1 D8t + 28 M8t (2 repl x 2 search x
// 7 catalogs) + 4 C8t. A run that compared fewer has lost a branch, which is the
// failure this floor exists to catch.
if (checks < 217) {
  console.log(`\nFAIL — only ${checks} comparison(s); the cross-product is incomplete`);
  process.exitCode = 1;
} else if (controls < 23) {
  // The floor's own floor: a run that dropped the mutants would be a run whose
  // greenness is unwitnessed. 4 partition + 2 telemetry + 2 identity, and 15
  // more for the sections — every one of them aimed at an arm no recording
  // reaches, since the rendered arms are already covered differentially.
  console.log(`\nFAIL — only ${controls} non-vacuity control(s); the comparison is unwitnessed`);
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "\nPASS — every arm is identical to the pinned upstream" : "\nFAIL");
  process.exitCode = failures.length === 0 ? 0 : 1;
}
