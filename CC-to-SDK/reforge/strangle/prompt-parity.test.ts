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

let checks = 0;
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

  for (const staticEnabled of [false, true]) {
    const upstreamEvents: [string, unknown][] = [];
    ports.__telemetry = (event: string, payload: unknown) => upstreamEvents.push([event, payload]);
    ports.__staticEnabled = () => staticEnabled;
    const upstreamFn = build<(b: unknown[], o?: unknown) => unknown>(
      fn,
      `const wO=${JSON.stringify(BOUNDARY)}, tL=${JSON.stringify(BILLING)};` +
        ` ${IDENTITY_DECL}; var ${OUTCOMES_DECL}` +
        ` const Kde=(...a)=>globalThis.__staticEnabled(...a), s=(...a)=>globalThis.__telemetry(...a);`,
    );
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

console.log(`\n=== prompt-assembly parity: ${checks} check(s) across the full branch cross-product ===`);
for (const f of failures) console.log(`  FAIL  ${f}`);
// 2 gate values x 11 inputs x 3 option sets x 2 (output + telemetry) = 132
// partition comparisons, + 7 wire + 15 identity + 5 reminder + 6 lines
// + 12 subagent + 1 compaction = 178. A run that compared fewer has lost a
// branch, which is the failure this floor exists to catch.
if (checks < 178) {
  console.log(`\nFAIL — only ${checks} comparison(s); the cross-product is incomplete`);
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "\nPASS — every arm is identical to the pinned upstream" : "\nFAIL");
  process.exitCode = failures.length === 0 ? 0 : 1;
}
