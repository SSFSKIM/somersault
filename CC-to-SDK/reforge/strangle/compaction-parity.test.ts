// UPSTREAM-DIFFERENTIAL CONTRACT TEST for W4's compaction modules.
//
//   npx tsx strangle/compaction-parity.test.ts
//
// The third instance of the oracle W2 built for the tool descriptions and W3
// reused for prompt assembly: extract the upstream bodies from the PINNED
// BUNDLE, evaluate them with stubbed ports, and require deep equality with the
// owned modules over the full cross-product. Nothing here hand-writes an
// expectation, so nothing here can encode a transcription error — and a branch
// no scenario renders ends up better evidenced than a rendered one, because a
// differential red only ever compares what some scenario happened to send.
//
// WHY THIS SUBSYSTEM NEEDS IT. The corpus compacts four times across three
// scenarios, and every one of those compactions goes through the SAME option
// set: a manual or automatic trigger, a transcript path, suppressed follow-up
// questions, and a metadata object carrying the same eight of its thirteen
// possible fields. The wire mapper alone has ten optional fields; the corpus
// exercises the presence arm of six of them and the absence arm of almost none.
// The trigger predicate is worse: a recording can only ever show the ONE path
// that ended in the decision it recorded.
//
// ON `eval`. It is the mechanism, not a shortcut — the oracle has to be
// upstream's own bytes, and those bytes are minified expressions that only exist
// as source. The input is the pinned, locally extracted bundle named by
// `src/pin.ts`: never network data, never user input, and this file is a
// developer test that never ships.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { compactBoundary } from "./modules/compact-boundary/reference.js";
import { compactBoundaryWire } from "./modules/compact-boundary-wire/reference.js";
import { compactContinuation, compactSummaryText } from "./modules/compact-continuation/reference.js";
import { autoCompactTrigger, isCompactQuerySource, isSuppressedQuerySource } from "./modules/auto-compact-trigger/reference.js";
import { SUMMARIZATION_PROMPT } from "./modules/compaction-prompt/reference.js";

let checks = 0;
let controls = 0;
const failures: string[] = [];

const ENGINE = readFileSync(join(BUNDLE_MODULES, "chunk-fy12d89p.js"), "utf8");

/** One shape-anchored extraction. Throws when the shape is gone. */
function extract(label: string, re: RegExp): string {
  const m = ENGINE.match(re);
  if (!m) throw new Error(`${label}: upstream shape not found — ${re}`);
  return m[0];
}

const nameOf = (fn: string): string => fn.match(/function\s+([\w$]+)/)![1];

/**
 * Build an upstream function from its extracted source with its free variables
 * bound. Every port binding forwards to `globalThis` AT CALL TIME rather than
 * snapshotting it, so re-pointing a stub between cases cannot compare the new
 * stub against the old one and pass.
 */
function build<T>(fn: string, bindings = ""): T {
  // eslint-disable-next-line no-eval
  return eval(`(() => { ${bindings}; ${fn} return ${nameOf(fn)}; })()`) as T;
}

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
 * adding controls. Each mutant is a wrong implementation this module could
 * plausibly ship, perturbed IN MEMORY and on the OWNED side only.
 */
function mustDiffer(label: string, upstream: unknown, perturbedOwned: unknown): void {
  controls++;
  if ((JSON.stringify(upstream) ?? "undefined") !== (JSON.stringify(perturbedOwned) ?? "undefined")) return;
  failures.push(`CONTROL ${label}: the perturbed owned result compared EQUAL — this file cannot see a wrong implementation`);
}

const ports = globalThis as unknown as Record<string, unknown>;

console.log(`compaction parity vs the pinned bundle @ ${ENGINE_VERSION}`);

// ---- the boundary constructor (upstream `H1`) -------------------------------
// The wall clock is the one thing neither side can agree on by construction, so
// it is PINNED for both rather than excluded from the comparison: `new Date()`
// resolves through the global, and both bodies call it.
{
  const fn = extract("H1", /function H1\([\w$,]+\)\{return\{type:"system",subtype:"compact_boundary"[\s\S]*?logicalParentUuid:[\w$]+\}\}\}/);
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(1600000000000);
      else super(...(args as ConstructorParameters<typeof Date>));
    }
  }
  (globalThis as { Date: DateConstructor }).Date = PinnedDate as unknown as DateConstructor;
  try {
    const upstreamFn = build<(...a: unknown[]) => unknown>(fn, "const bg=(...a)=>globalThis.__uuid(...a);");
    ports.__uuid = () => "11111111-2222-4333-8444-555555555555";
    const uuid = () => "11111111-2222-4333-8444-555555555555";

    const cases: [string, [unknown, unknown, unknown, unknown, unknown]][] = [
      ["manual, full", ["manual", 28074, "parent-uuid", "keep the codeword", 6]],
      ["auto, full", ["auto", 69434, "parent-uuid", undefined, 4]],
      // The spread is `...parent && {…}`, so every falsy parent must omit the key
      // rather than emit it — four different falsy values, because a rewrite that
      // tested `!== undefined` would pass on three of them.
      ["no parent (undefined)", ["auto", 1, undefined, undefined, undefined]],
      ["no parent (null)", ["auto", 1, null, undefined, undefined]],
      ["no parent (empty string)", ["auto", 1, "", undefined, undefined]],
      ["no parent (false)", ["auto", 1, false, undefined, undefined]],
      ["zero pre-tokens", ["manual", 0, "parent-uuid", "", 0]],
      ["no user context", ["manual", 100, "parent-uuid", undefined, 2]],
      ["no messages summarized", ["auto", 100, "parent-uuid", "ctx", undefined]],
    ];
    for (const [label, [trigger, pre, parent, ctx, summarized]] of cases) {
      eq(
        `boundary ${label}`,
        upstreamFn(trigger, pre, parent, ctx, summarized),
        compactBoundary(trigger as string, pre as number, parent, ctx, summarized, uuid),
      );
    }

    // Controls, on the fullest case.
    const args = ["manual", 28074, "parent-uuid", "keep the codeword", 6] as const;
    const up = upstreamFn(...args) as Record<string, unknown>;
    const own = () => compactBoundary(args[0], args[1], args[2], args[3], args[4], uuid) as Record<string, unknown>;
    mustDiffer("the boundary's content prose reworded", up, { ...own(), content: "Conversation summarized" });
    mustDiffer("isMeta flipped", up, { ...own(), isMeta: true });
    mustDiffer("the parent key emitted as null instead of omitted", up, { ...own(), logicalParentUuid: null });
    mustDiffer("a metadata field dropped", up, (() => {
      const o = own();
      const meta = { ...(o.compactMetadata as Record<string, unknown>) };
      delete meta.messagesSummarized;
      return { ...o, compactMetadata: meta };
    })());
    mustDiffer("the metadata keys emitted in snake_case here rather than at the wire", up, (() => {
      const o = own();
      const meta = o.compactMetadata as Record<string, unknown>;
      return { ...o, compactMetadata: { trigger: meta.trigger, pre_tokens: meta.preTokens } };
    })());
    mustDiffer("the clock left unstamped", up, { ...own(), timestamp: undefined });
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

// ---- the wire mapper (upstream `rSe`) ---------------------------------------
// Ten optional fields, each `!== undefined` rather than truthy. The zero cases
// are the ones that matter: `post_tokens: 0` and `cumulative_dropped_tokens: 0`
// are real measurements, and a `value && {…}` rewrite drops them silently.
{
  const fn = extract("rSe", /function rSe\([\w$]+\)\{let\{preservedSegment[\s\S]*?all_uuids:[\w$]+\.allUuids\}\}\}\}\}/);
  const upstreamFn = build<(m: unknown) => unknown>(fn);

  const segment = { headUuid: "head", anchorUuid: "anchor", tailUuid: "tail" };
  const cases: [string, Record<string, unknown>][] = [
    ["minimal", { trigger: "manual", preTokens: 28074 }],
    ["everything", {
      trigger: "auto",
      preTokens: 69434,
      postTokens: 42189,
      cumulativeDroppedTokens: 27427,
      durationMs: 9,
      userContext: "keep the codeword",
      messagesSummarized: 6,
      precomputed: true,
      preCompactDiscoveredTools: ["Bash", "Read"],
      preservedSegment: segment,
      preservedMessages: { anchorUuid: "anchor", uuids: ["a", "b"], allUuids: ["a", "b", "c"] },
    }],
    ["zeros are measurements, not absences", {
      trigger: "auto",
      preTokens: 0,
      postTokens: 0,
      cumulativeDroppedTokens: 0,
      durationMs: 0,
      messagesSummarized: 0,
      precomputed: false,
      userContext: "",
    }],
    ["preserved messages without allUuids", {
      trigger: "auto",
      preTokens: 1,
      preservedMessages: { anchorUuid: "anchor", uuids: ["a"] },
    }],
    ["a segment but no preserved messages", { trigger: "auto", preTokens: 1, preservedSegment: segment }],
    ["preserved messages but no segment", {
      trigger: "manual",
      preTokens: 1,
      preservedMessages: { anchorUuid: "anchor", uuids: [], allUuids: [] },
    }],
    ["an empty discovered-tool list", { trigger: "manual", preTokens: 1, preCompactDiscoveredTools: [] }],
    ["explicit undefineds are still absences", {
      trigger: "manual",
      preTokens: 1,
      postTokens: undefined,
      durationMs: undefined,
      preservedSegment: undefined,
      preservedMessages: undefined,
    }],
    ["a null segment is falsy and omitted", { trigger: "manual", preTokens: 1, preservedSegment: null, preservedMessages: null }],
  ];
  for (const [label, metadata] of cases) eq(`wire ${label}`, upstreamFn(metadata), compactBoundaryWire(metadata));

  const full = cases[1][1];
  const up = upstreamFn(full) as Record<string, unknown>;
  const own = () => compactBoundaryWire(full) as Record<string, unknown>;
  mustDiffer("pre_tokens left camelCase", up, (() => {
    const o = own();
    delete o.pre_tokens;
    return { ...o, preTokens: full.preTokens };
  })());
  mustDiffer("a nested segment spread wholesale, leaking internal keys", up, { ...own(), preserved_segment: full.preservedSegment });
  mustDiffer("all_uuids promoted to unconditional", up, {
    ...own(),
    preserved_messages: { anchor_uuid: "anchor", uuids: ["a", "b"], all_uuids: undefined },
  });
  mustDiffer("trigger dropped", up, (() => {
    const o = own();
    delete o.trigger;
    return o;
  })());
  const zeros = upstreamFn(cases[2][1]) as Record<string, unknown>;
  mustDiffer("optional fields tested for truthiness rather than definedness", zeros, (() => {
    const o = compactBoundaryWire(cases[2][1]) as Record<string, unknown>;
    delete o.post_tokens;
    delete o.cumulative_dropped_tokens;
    delete o.duration_ms;
    return o;
  })());
}

// ---- the summary rewriter (upstream `d1n`) ----------------------------------
{
  const fn = extract("d1n", /function d1n\([\w$]+\)\{[\s\S]*?,[\w$]+\.trim\(\)\}/);
  const upstreamFn = build<(s: string) => string>(fn);

  const cases: [string, string][] = [
    ["both blocks", "<analysis>\nthinking\n</analysis>\n\n<summary>\n1. Primary Request\n</summary>"],
    ["summary only", "<summary>\nthe summary\n</summary>"],
    ["analysis only", "<analysis>\nthinking\n</analysis>\n\nleftover prose"],
    ["neither", "Iron\nCopper\nGold"],
    ["empty summary", "<summary></summary>"],
    ["whitespace-only summary", "<summary>   \n  </summary>"],
    ["two analysis blocks — only the first is dropped", "<analysis>a</analysis><analysis>b</analysis><summary>s</summary>"],
    ["two summary blocks — the first is promoted", "<summary>one</summary>\n<summary>two</summary>"],
    ["blank-line runs collapse", "a\n\n\n\n\nb\n\n\nc"],
    ["leading and trailing whitespace", "\n\n  text  \n\n"],
    ["unclosed analysis is not a block", "<analysis>never closed <summary>s</summary>"],
    ["unclosed summary is not a block", "<summary>never closed"],
    ["tags inside the summary body", "<summary>mentions <analysis> as a word</summary>"],
    // The replacement string is a template literal on both sides, so `$&` and
    // friends expand identically. Faithful, not improved — see the module header.
    ["a dollar pattern in the summary", "<summary>cost $& and $1 and $$</summary>"],
    ["empty input", ""],
    ["a summary spanning blank lines", "<summary>one\n\n\n\ntwo</summary>"],
  ];
  for (const [label, raw] of cases) eq(`summary ${label}`, upstreamFn(raw), compactSummaryText(raw));

  const raw = cases[0][1];
  const up = upstreamFn(raw);
  mustDiffer("the analysis block left in", up, `<analysis>\nthinking\n</analysis>\n\n${compactSummaryText(raw)}`);
  mustDiffer("the summary tags left in place of the heading", up, upstreamFn(raw).replace("Summary:", "<summary>"));
  mustDiffer("the summary body left untrimmed", up, compactSummaryText(raw).replace("Summary:\n1.", "Summary:\n\n1."));
  mustDiffer("blank-line runs left uncollapsed", up, `${compactSummaryText(raw)}\n\n\n`);
  mustDiffer("the fall-through arm returning the input untouched", upstreamFn(cases[1][1]), cases[1][1]);
}

// ---- the continuation message (upstream `Cq`) -------------------------------
// Bound to upstream's OWN `d1n`, so this block grades the composition the graph
// performs rather than re-grading the rewriter above.
{
  const rewriter = extract("d1n", /function d1n\([\w$]+\)\{[\s\S]*?,[\w$]+\.trim\(\)\}/);
  const fn = extract("Cq", /function Cq\([\w$]+,[\w$]+\)\{let [\s\S]*?happened\.`;return [\w$]+\}/);
  const upstreamFn = build<(s: string, o?: unknown) => string>(fn, rewriter);

  const summary = "<analysis>a</analysis><summary>the summary</summary>";
  const path = "/reforge/config/projects/-sandbox/session.jsonl";
  const optionSets: [string, Record<string, unknown> | undefined][] = [
    ["opts=undefined", undefined],
    ["empty opts", {}],
    ["path only", { transcriptPath: path }],
    ["recent only", { recentMessagesPreserved: true }],
    ["repl only", { replStateCleared: true }],
    ["suppress only", { suppressFollowUpQuestions: true }],
    ["path + suppress (what every recording carries)", { transcriptPath: path, suppressFollowUpQuestions: true }],
    ["everything", { transcriptPath: path, recentMessagesPreserved: true, replStateCleared: true, suppressFollowUpQuestions: true }],
    ["every flag explicitly false", {
      transcriptPath: "",
      recentMessagesPreserved: false,
      replStateCleared: false,
      suppressFollowUpQuestions: false,
    }],
  ];
  for (const [label, options] of optionSets) {
    for (const [rawLabel, raw] of [["with tags", summary], ["no tags", "Iron\nCopper\nGold"], ["empty", ""]] as [string, string][]) {
      eq(`continuation ${label} / ${rawLabel}`, upstreamFn(raw, options), compactContinuation(raw, options));
    }
  }

  const options = optionSets[7][1];
  const up = upstreamFn(summary, options);
  mustDiffer("the resume clause joined by a blank line instead of one newline", up, up.replace(/\n(Continue the conversation)/, "\n\n$1"));
  mustDiffer("the clauses appended in a different order", up, (() => {
    const [head, ...rest] = up.split("\n\n");
    return [head, ...rest.reverse()].join("\n\n");
  })());
  mustDiffer("the preamble reworded", up, up.replace("ran out of context", "reached its limit"));
  mustDiffer("an em dash normalized to a hyphen", up, up.replace(/—/g, "-"));
  mustDiffer("the transcript clause dropped", up, up.replace(/\n\nIf you need specific details[\s\S]*?\.jsonl/, ""));
  // The early return is the arm a rewrite flattens into a fall-through: with
  // `suppressFollowUpQuestions` the resume clause must be LAST and the function
  // must not append anything after it.
  mustDiffer("the suppress arm falling through instead of returning", up, `${up}\n\nRecent messages are preserved verbatim.`);
}

// ---- the trigger predicate (upstream `nKn`) ---------------------------------
// A recording can only ever show the one path that ended in the decision it
// recorded, so every refusal below and every level except `compact` is graded
// here and nowhere else.
{
  const fn = extract("nKn", /async function nKn\([\s\S]*?level==="blocked"\}/);
  const upstreamFn = build<(...a: unknown[]) => Promise<boolean>>(
    fn,
    "const FD=(...a)=>globalThis.__isCompact(...a), tC=(...a)=>globalThis.__isSuppressed(...a)," +
      " Qf=(...a)=>globalThis.__enabled(...a), QB=(...a)=>globalThis.__surfaceOpen(...a)," +
      " $G=(...a)=>globalThis.__configured(...a), Ih=(...a)=>globalThis.__tokens(...a)," +
      " If=(...a)=>globalThis.__charsPerToken(...a), Nee=(...a)=>globalThis.__classify(...a)," +
      " n=(...a)=>globalThis.__log(...a), eF=(...a)=>globalThis.__effectiveWindow(...a);",
  );

  // Upstream's own `FD`/`tC` are bound to the OWNED implementations, which is
  // exactly the §2.4 claim being made about them: the module ships them and the
  // graph's copies are never called, so if the owned pair were wrong upstream's
  // body would take a different arm here and the comparison would fire.
  ports.__isCompact = isCompactQuerySource;
  ports.__isSuppressed = isSuppressedQuerySource;
  ports.__charsPerToken = () => 4;
  ports.__effectiveWindow = () => 180000;

  interface Trace {
    log: string[];
    tokens: number[];
    classified: unknown[];
  }
  let trace: Trace = { log: [], tokens: [], classified: [] };

  function stub(enabled: boolean, surfaceOpen: boolean, configured: boolean, contextTokens: number, level: string): void {
    trace = { log: [], tokens: [], classified: [] };
    ports.__enabled = () => enabled;
    ports.__surfaceOpen = () => surfaceOpen;
    ports.__configured = () => configured;
    ports.__tokens = (_messages: unknown, chars: number) => {
      trace.tokens.push(chars);
      return contextTokens;
    };
    ports.__classify = (t: number) => {
      trace.classified.push(t);
      return { level };
    };
    ports.__log = (line: string) => trace.log.push(line);
  }

  const owned = (args: {
    querySource?: unknown;
    offset?: number;
    enabled: boolean;
    surfaceOpen: boolean;
    configured: boolean;
    tokens: number;
    level: string;
    sink: Trace;
  }): Promise<boolean> =>
    autoCompactTrigger(
      ["messages"],
      "claude-sonnet-5",
      undefined,
      args.querySource,
      args.offset,
      { agent: "context" },
      () => args.enabled,
      () => args.surfaceOpen,
      () => args.configured,
      (_messages: unknown, chars: number) => {
        args.sink.tokens.push(chars);
        return args.tokens;
      },
      () => 4,
      (t: number) => {
        args.sink.classified.push(t);
        return { level: args.level };
      },
      (line: string) => args.sink.log.push(line),
      () => 180000,
    );

  const cases: [string, { querySource?: unknown; offset?: number; enabled: boolean; surfaceOpen: boolean; configured: boolean; tokens: number; level: string }][] = [
    ["sdk, compact level", { querySource: "sdk", enabled: true, surfaceOpen: true, configured: true, tokens: 69434, level: "compact" }],
    ["sdk, blocked level", { querySource: "sdk", enabled: true, surfaceOpen: true, configured: true, tokens: 177000, level: "blocked" }],
    ["sdk, warn level", { querySource: "sdk", enabled: true, surfaceOpen: true, configured: true, tokens: 160000, level: "warn" }],
    ["sdk, ok level", { querySource: "sdk", enabled: true, surfaceOpen: true, configured: true, tokens: 100, level: "ok" }],
    ["the recursion guard", { querySource: "compact", enabled: true, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["a prompt suggestion", { querySource: "prompt_suggestion", enabled: true, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["an away summary", { querySource: "away_summary", enabled: true, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["an agent summary", { querySource: "agent_summary", enabled: true, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["a narration", { querySource: "narration", enabled: true, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["an unnamed source is a real turn", { querySource: undefined, enabled: true, surfaceOpen: true, configured: true, tokens: 69434, level: "compact" }],
    ["auto-compaction switched off", { querySource: "sdk", enabled: false, surfaceOpen: true, configured: true, tokens: 999999, level: "compact" }],
    ["surface open but window unconfigured", { querySource: "sdk", enabled: true, surfaceOpen: true, configured: false, tokens: 999999, level: "compact" }],
    ["surface CLOSED, window unconfigured — the conjunct's other arm", { querySource: "sdk", enabled: true, surfaceOpen: false, configured: false, tokens: 69434, level: "compact" }],
    ["a token offset moves the measurement", { querySource: "sdk", offset: 20000, enabled: true, surfaceOpen: true, configured: true, tokens: 69434, level: "compact" }],
    ["an offset larger than the measurement", { querySource: "sdk", offset: 100000, enabled: true, surfaceOpen: true, configured: true, tokens: 69434, level: "ok" }],
    ["a repl query source is a real turn", { querySource: "repl_main_thread", enabled: true, surfaceOpen: true, configured: true, tokens: 69434, level: "compact" }],
  ];

  for (const [label, c] of cases) {
    stub(c.enabled, c.surfaceOpen, c.configured, c.tokens, c.level);
    const up = await upstreamFn(["messages"], "claude-sonnet-5", undefined, c.querySource, c.offset, { agent: "context" });
    const upTrace = trace;
    const sink: Trace = { log: [], tokens: [], classified: [] };
    eq(`trigger ${label}`, up, await owned({ ...c, sink }));
    // The ports are compared too: which of them ran, with what, and how often.
    // Two of the refusals differ from each other in NOTHING BUT that — an
    // output-only comparison would call a predicate that measured the context
    // before refusing equivalent to one that refused first.
    eq(`trigger ${label} [ports]`, upTrace, sink);
  }

  // Controls, on the decision path.
  const c = cases[0][1];
  stub(c.enabled, c.surfaceOpen, c.configured, c.tokens, c.level);
  const up = await upstreamFn(["messages"], "claude-sonnet-5", undefined, c.querySource, c.offset, {});
  mustDiffer("`blocked` treated as too late to compact", up, false);
  const suppressed = cases[5][1];
  stub(suppressed.enabled, suppressed.surfaceOpen, suppressed.configured, suppressed.tokens, suppressed.level);
  const upSuppressed = await upstreamFn(["messages"], "claude-sonnet-5", undefined, suppressed.querySource, undefined, {});
  mustDiffer("a non-conversational source allowed through", upSuppressed, true);
  // The port trace is what catches a refusal that happens in the wrong ORDER.
  stub(c.enabled, c.surfaceOpen, c.configured, c.tokens, c.level);
  await upstreamFn(["messages"], "claude-sonnet-5", undefined, "compact", undefined, {});
  const guardTrace = trace;
  mustDiffer("the recursion guard checked AFTER the measurement", guardTrace, {
    log: [`autocompact: tokens=${c.tokens} level=${c.level} effectiveWindow=180000`],
    tokens: [4],
    classified: [c.tokens],
  });
  stub(c.enabled, c.surfaceOpen, c.configured, c.tokens, c.level);
  await upstreamFn(["messages"], "claude-sonnet-5", undefined, "sdk", 20000, {});
  mustDiffer("the offset subtracted from the threshold rather than the measurement", trace.classified, [c.tokens]);
}

// ---- the summarization prompt (upstream `l1n`, C5x's declarator spike) ------
// C6 recorded this module's attestation adjudication: its parity IS the build's
// comparison of the initializer against the pinned chunk's bytes, which runs on
// every build and is stronger than a differential red. Re-extracted here so the
// claim is checked by something other than the build that makes it, and so this
// file covers the whole subsystem rather than the part W4 added.
{
  const decl = extract("l1n", /var l1n=`Your task is to create a detailed summary of the conversation[\s\S]*?`(?=[,;])/);
  // eslint-disable-next-line no-eval
  const upstreamValue = eval(`(()=>{ ${decl}; return l1n })()`) as string;
  eq("summarization prompt is byte-identical to the pinned chunk", upstreamValue, SUMMARIZATION_PROMPT);
  mustDiffer("a single character of the prompt changed", upstreamValue, `${SUMMARIZATION_PROMPT} `);
}

// ---- verdict ----------------------------------------------------------------
// Floors set to the counts this file actually reaches, so an edit that deletes
// half the cross-product fails rather than passing faster.
if (checks < 94) failures.push(`only ${checks} comparison(s) ran — the cross-product is incomplete`);
if (controls < 27) failures.push(`only ${controls} non-vacuity control(s) ran — this file's ability to fail is unproven`);

console.log(`=== compaction parity: ${checks} comparison(s), ${controls} control(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(
  failures.length === 0
    ? "PASS — every owned compaction body matches the pinned upstream body over the full cross-product"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
