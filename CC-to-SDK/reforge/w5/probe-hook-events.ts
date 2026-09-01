// W5 probe — WHICH hook events actually fire on the headless seam, and can a
// COMMAND hook (a shell script, not a callback) be registered without touching
// the filesystem's settings layers?
//
// Campaign spec C8 / the live-probe-first discipline. The W5 scout inherited
// "8 of 30 events fire headlessly" from `docs/parity/coverage.md`, which is a
// 2026-06 measurement against a different pin. The wave's whole corpus plan and
// every exclusion it records rests on that set, so it is re-measured here
// against the PINNED engine before any scenario is recorded.
//
// The second question is the wave's one non-trivial fixture. `Options.hooks`
// takes CALLBACKS only (`HookCallbackMatcher.hooks: HookCallback[]`), and a
// callback never reaches the executor's command path — so nothing in the corpus
// grades the hook-input record as the BYTE STREAM a command hook reads on stdin,
// which is what the owned PostToolUse module's field order actually is. Command
// hooks live in settings, and `settingSources: ["project"]` would drag the
// operator's ancestor `.claude/` directories in (the W3 recording trap). The
// SDK's `Options.settings` is the way out if it works: an INLINE settings object
// loaded into the flag-settings layer, no filesystem source enabled.
//
// ---------------------------------------------------------------------------
// C8 BOUNDARY-REVIEW EXTENSION (2026-09-01): the negative evidence was vacuous.
//
// The probe originally drove ONE batched-echo turn under `bypassPermissions` and
// read "did not fire" off it for thirteen events. For six of them that turn is a
// real test. For its five NEGATIVES it was not: the turn never FAILS a tool,
// never COMPACTS, never ENDS a session inside the observation window and never
// completes an MCP elicitation — and it registered callbacks ONLY, so the four
// dispatchers the engine drives without a session hooks registry were unreachable
// by construction. A negative that a working dispatcher would produce too is not
// evidence.
//
// So the probe now runs one PHASE per firing condition and, in each, registers
// BOTH kinds of hook for every watched event:
//
//   - an SDK CALLBACK (`Options.hooks`), which reaches a dispatcher only if that
//     dispatcher hands the executor the session hooks registry; and
//   - a COMMAND hook through `Options.settings` (the flag-settings layer the
//     original probe discovered), which reaches a dispatcher through the
//     settings lookup whether or not the registry was passed.
//
// Both, because the bundle says the two paths are NOT equivalent. A dispatcher's
// hooks are looked up by `Wie`, which returns settings hooks unconditionally but
// FUNCTION hooks only out of the registry it is handed. `jy` (the generator
// executor) gets a `toolUseContext` and takes the registry off it; `AE` (the
// awaiting executor) consults only the registry passed explicitly — and
// `vUt`/SessionStart, `tz`/PreCompact and `EE`/Notification are all called
// without one. Registering callbacks only, as the original probe did, therefore
// re-manufactures exactly the vacuous negative this extension exists to remove,
// one layer down: it measures the plumbing of the registration, not the
// dispatcher.
//
// Each command hook appends a line to a per-event marker file, which is also how
// SessionEnd's evidence survives: the callback for a dispatcher that runs as the
// session tears down may fire after the SDK iterator has ended, so the probe
// reads the FILES after the loop rather than trusting the in-process counter.
//
// MEASURED, 2026-09-01, engine-real on the 2.1.251 pin (full output in the wave
// record). FOUR of the five negatives were wrong:
//
//   PostToolUseFailure  FIRED  callback + command, on a Bash call that exits non-zero
//   PreCompact          FIRED  callback + command, on `/compact`
//   SessionStart        FIRED  command only (callback=0 in every phase) — `vUt`
//                              passes `jy` no registry, so no callback can see it
//   SessionEnd          FIRED  command in EVERY phase (ordinary teardown);
//                              callback as well on the `/clear` turn
//   Notification        NOT FIRED in any phase — the one condition is out of reach
//
// So the headless-live set is TWELVE events, not eight, and the two the original
// probe called genuine negatives (SessionStart, SessionEnd) were artifacts of
// watching one path.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx w5/probe-hook-events.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, type HookEvent, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, pushable, resetSandbox, userMessage, type ScenarioContext } from "../src/harness.js";
import { requireRecordCredential } from "../src/env.js";
import { startRecordProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX, sdkEnv } from "../src/runTurn.js";

requireRecordCredential();

/**
 * Every event with a dispatcher in the pinned engine chunk that a single
 * tool-using turn could plausibly reach, plus the four `coverage.md` calls
 * dormant or out of band — the point is to measure the boundary, not to confirm
 * the middle.
 */
const WATCHED: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "UserPromptSubmit",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "MessageDisplay",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "PreCompact",
];

/**
 * The five the original probe reported as not firing — the whole negative list,
 * re-measured. Each is watched on BOTH the callback and the command path in
 * every phase, and three of them get a phase that creates their firing
 * condition.
 */
const REMEASURED: HookEvent[] = ["PostToolUseFailure", "PreCompact", "SessionStart", "SessionEnd", "Notification"];

const STDIN_DUMP = join(SANDBOX, "probe-command-hook-stdin.json");
/**
 * Where each event's command hook appends its marker — one file per event.
 *
 * Deliberately NOT in the sandbox: `resetSandbox()` runs at the top of every
 * phase, so a marker written there would be wiped by the next phase before it
 * could be read. `.scratch/` is gitignored and drained per phase instead.
 */
const MARKERS = join(REFORGE_ROOT, ".scratch", "w5-probe-markers");
const markerFile = (e: string) => join(MARKERS, `${e}.log`);

/**
 * A command hook that appends one line naming the event it was dispatched for.
 *
 * Appending rather than overwriting so a phase that fires the same event twice
 * is visible as two lines, and reading the record's own `hook_event_name` off
 * stdin rather than trusting the registration — a dispatcher that stamped the
 * wrong event name would otherwise be invisible here.
 */
const markerHook = (e: string) => ({
  hooks: [
    {
      type: "command" as const,
      command: `node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{let n;try{n=JSON.parse(s).hook_event_name}catch{n="<unparsed>"}require("fs").appendFileSync(${JSON.stringify(
        markerFile(e),
      )},n+"\\n")})'`,
    },
  ],
});

interface PhaseResult {
  /** callback fires, by event */
  callbacks: Map<string, number>;
  /** command-hook marker lines, by event */
  commands: Map<string, string[]>;
  error?: string;
}

/** Read every marker file written so far and clear them, so a phase reports only its own fires. */
function drainMarkers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(MARKERS)) return out;
  for (const f of readdirSync(MARKERS)) {
    const lines = readFileSync(join(MARKERS, f), "utf8").split("\n").filter(Boolean);
    if (lines.length > 0) out.set(f.replace(/\.log$/, ""), lines);
    rmSync(join(MARKERS, f), { force: true });
  }
  return out;
}

/**
 * Run one phase: a fresh sandbox, a throwaway cassette, callbacks and command
 * hooks for every watched event, and whatever conversation the phase needs.
 *
 * `drive` is handed a `next` in the W4 shape (return the next user message, or
 * null to end) so a phase can be a single prompt or a multi-exchange
 * conversation without two code paths.
 */
async function phase(
  label: string,
  extra: Partial<Options>,
  next: (results: number) => string | null,
  knobs?: Parameters<typeof sdkEnv>[2],
): Promise<PhaseResult> {
  const cassette = join(REFORGE_ROOT, "cassettes", `w5-probe-${label}.jsonl.tmp`);
  rmSync(cassette, { force: true });
  mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });
  rmSync(MARKERS, { recursive: true, force: true });
  mkdirSync(MARKERS, { recursive: true });
  resetSandbox();
  const proxy = await startRecordProxy(cassette);
  const callbacks = new Map<string, number>();
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event) => callbacks.set(event, (callbacks.get(event) ?? 0) + 1),
    mode: "record",
    knobs,
  };

  const hooks = Object.fromEntries(
    WATCHED.map((e) => [e, [{ hooks: [async () => (ctx.collect(e), { continue: true } as const)] }]]),
  );
  // The command-hook side. PostToolUse keeps the original stdin dump (the
  // field-order question this probe also answers); every watched event gets a
  // marker hook, so a dispatcher unreachable by callback is still measured.
  const settingsHooks: Record<string, unknown[]> = {
    PostToolUse: [{ hooks: [{ type: "command", command: `cat > ${JSON.stringify(STDIN_DUMP)}` }] }, markerHook("PostToolUse")],
  };
  for (const e of WATCHED) if (e !== "PostToolUse") settingsHooks[e] = [markerHook(e)];

  const options: Options = {
    ...baseOptions(ctx),
    permissionMode: "bypassPermissions",
    hooks,
    settings: { hooks: settingsHooks },
    ...extra,
  };

  const input = pushable<SDKUserMessage>();
  const first = next(0);
  if (first === null) throw new Error(`probe phase ${label}: needs at least one user message`);
  input.push(userMessage(first));
  let error: string | undefined;
  try {
    let results = 0;
    for await (const m of query({ prompt: input, options })) {
      if ((m as { type?: string }).type !== "result") continue;
      results++;
      const following = next(results);
      if (following === null) input.end();
      else input.push(userMessage(following));
    }
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
  }
  await proxy.close();
  rmSync(cassette, { force: true });
  // Read the FILES after the iterator ends: a dispatcher that runs during
  // teardown (SessionEnd) can fire after the last message is yielded, so an
  // in-process counter read at this point would under-report it.
  return { callbacks, commands: drainMarkers(), error };
}

function report(label: string, condition: string, r: PhaseResult, focus: HookEvent[]): void {
  console.log(`\n=== phase ${label} — ${condition} ===`);
  if (r.error) console.log(`  query threw: ${r.error}`);
  const rows = focus.length > 0 ? focus : WATCHED;
  for (const e of rows) {
    const cb = r.callbacks.get(e) ?? 0;
    const cmd = r.commands.get(e) ?? [];
    const verdict = cb > 0 || cmd.length > 0 ? "FIRED" : "-    ";
    console.log(`  ${verdict}  ${e.padEnd(20)} callback=${cb}  command=${cmd.length}${cmd.length > 0 ? ` [${[...new Set(cmd)].join(",")}]` : ""}`);
  }
}

/** `/compact` refuses a conversation with too little history — W4's lesson, reused. */
const FILLER = [
  "Remember the codeword REFORGE_PROBE_PRECOMPACT. Reply with exactly OK.",
  "Name three primary colors, one per line, nothing else.",
  "Name three prime numbers under 20, one per line, nothing else.",
  "Name three continents, one per line, nothing else.",
  "Name three planets, one per line, nothing else.",
  "Name three metals, one per line, nothing else.",
];

async function main(): Promise<void> {
  // ---- phase 1: the original batched-echo turn (unchanged) ----------------
  const batch = await phase(
    "batch",
    { allowedTools: ["Bash"], maxTurns: 4 },
    (r) =>
      r === 0
        ? "You must emit TWO Bash tool_use blocks in a SINGLE assistant response — do not wait for any result before issuing the next. The two commands, in this order: `echo REFORGE_PROBE_1`, `echo REFORGE_PROBE_2`. After both results come back, reply with their outputs joined by a comma."
        : null,
  );
  report("batch", "one batched two-tool turn, nothing fails", batch, []);

  console.log("\n=== command hook via Options.settings (flag-settings layer) ===");
  try {
    const raw = readFileSync(STDIN_DUMP, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    console.log(`  RAN — ${raw.length} bytes on stdin`);
    console.log(`  key order: ${Object.keys(parsed).join(", ")}`);
  } catch {
    console.log("  did NOT run (no stdin dump written)");
  }

  // ---- phase 2: a tool that FAILS ----------------------------------------
  // `dQ` (the tool-failure dispatcher) calls `zNt`/PostToolUseFailure on the
  // error arm of tool execution, so the condition is an is_error tool_result.
  const failure = await phase(
    "tool-failure",
    { allowedTools: ["Bash"], maxTurns: 4 },
    (r) =>
      r === 0
        ? "Use the Bash tool to run exactly `reforge-no-such-command-probe --fail` ONCE. It will fail; that is expected and correct. Do not retry it, do not try a different command. After the failure, reply with exactly REFORGE_PROBE_FAILED."
        : null,
  );
  report("tool-failure", "a Bash call that exits non-zero", failure, REMEASURED);

  // ---- phase 3: an actual compaction --------------------------------------
  // W4's slash-compact recipe, which is the cheaper of its two (the auto
  // threshold needs a ~40,000-token payload); `tz`/PreCompact is awaited on the
  // same path both take.
  const compact = await phase("compact", { allowedTools: [] }, (r) => {
    if (r < FILLER.length) return FILLER[r];
    if (r === FILLER.length) return "/compact";
    return null;
  });
  report("compact", "/compact drives a real compaction", compact, REMEASURED);

  // ---- phase 4: a session that ENDS inside the window ---------------------
  // `ZSe`/SessionEnd has exactly two callers in the pinned bundle — session
  // RESUME and `/clear` — so `/clear` is the one a headless run can reach.
  const ended = await phase("session-end", { allowedTools: [] }, (r) => {
    if (r === 0) return "Reply with exactly REFORGE_PROBE_SESSION.";
    if (r === 1) return "/clear";
    return null;
  });
  report("session-end", "/clear ends the session inside the run", ended, REMEASURED);

  console.log("\n=== summary: the original probe's five negatives, re-measured ===");
  const phases: [string, PhaseResult][] = [
    ["batch", batch],
    ["tool-failure", failure],
    ["compact", compact],
    ["session-end", ended],
  ];
  for (const e of REMEASURED) {
    const where = phases
      .filter(([, p]) => (p.callbacks.get(e) ?? 0) > 0 || (p.commands.get(e) ?? []).length > 0)
      .map(([label, p]) => `${label}(cb=${p.callbacks.get(e) ?? 0},cmd=${(p.commands.get(e) ?? []).length})`);
    console.log(`  ${where.length > 0 ? "FIRED" : "NOT-FIRED"}  ${e.padEnd(20)} ${where.join(" ") || "in no phase"}`);
  }
  console.log(
    "\n  Notification has no phase of its own: its ONE call site in the pinned bundle is\n" +
      "  the MCP-elicitation completion notification in the headless runner chunk\n" +
      "  (chunk-dvbbv89q.js), which needs an external MCP server that elicits — machinery\n" +
      "  out of proportion to the cell. It is registered on both paths in all four phases\n" +
      "  and fired in none, and `EE` calls `AE` with no session hooks registry, so no SDK\n" +
      "  CALLBACK could observe it however the condition were created.\n" +
      "  SessionStart has no phase either, for the opposite reason: every run starts one.",
  );
  rmSync(MARKERS, { recursive: true, force: true });
}

await main();
