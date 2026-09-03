// W13b / C16b — SIGNALS DELIVERED MID-TURN, graded on both engines.
//
//   cd reforge && set -a; . ../.env; set +a; npx tsx w13/signals.ts [--plan <tag>] [--engineB <name>] [--rerecord]
//
// Cell L17 of the W13 scout's edge matrix, and the only one of the twenty that
// needs no synthetic response corpus and no per-event stream control: "shutdown
// during a turn (`isShuttingDown()` true → `await hang()`) — MISSING, and it
// never settles, so it must be graded as produced no further yields within N ms".
//
// ## What this grades that nothing else can
//
// The process-lifecycle chunk is three exports. Two of them are only ever
// consulted once the process has decided to go down, and nothing in a healthy
// corpus run ever decides that — the engine finishes its turn and exits. So the
// commit and the hang are unreachable by every scenario the campaign has, which
// makes this driver the only thing that can SETTLE whether they are live. The
// answer it returned is that they are not, on any path a headless engine has;
// see below, and the `darkReason`s on their manifest rows.
//
// ## THREE SIGNALS, BECAUSE THE ENGINE ANSWERS THEM WITH THREE DIFFERENT
// ## HANDLERS AND THREE DIFFERENT EXIT STATUSES
//
// The graph registers two families of signal handler and this wave's fixture
// enumerates both. The headless dispatcher installs its own SIGINT/SIGTERM pair;
// the coordinator's `install()` registers SIGINT/SIGTERM/SIGHUP inline, with the
// first two suppressed in print mode by a marker the dispatcher sets. So a
// headless engine answers SIGTERM from `ky` and SIGHUP from the coordinator, and
// the two do materially different things:
//
//   SIGTERM  `br` in `ky`:  commit the latch, ABORT the run controller, exit 143
//   SIGINT   `Hn` in `ky`:  cancel the in-flight query, abort, exit 0 — OWNED by
//                           this wave (`modules/ky-sigint-handler`), and the one
//                           handler of the graph's six that fits a target shape
//   SIGHUP   the coordinator: shut down and exit 129 — and never abort anything
//
// That difference decides what is observable, and it is the correction this
// child's premise needed. The scout's cell L17 reads "shutdown during a turn
// (`isShuttingDown()` true → `await hang()`)", but on the SIGTERM path the hang
// NEVER HAPPENS: every consultation of it in the reachable set is written
// `if (isShuttingDown() && !signal.aborted) await hang()`, and upstream's own
// handler aborts before it exits. The abort short-circuits the guard, so the
// latch contributes nothing a scenario can see. Sabotaging the commit and the
// hang under SIGTERM changes nothing — measured, both twins, both engines.
//
// SIGHUP LOOKED LIKE THE PATH WHERE THE LATCH WOULD BE LOAD-BEARING, AND IT IS
// NOT. Nothing aborts there, so the guard the commit opens is not
// short-circuited, and the hypothesis this driver was extended to test was that
// the in-flight tool would finish inside the coordinator's own shutdown window
// and its continuation would reach `await hang()`. It does not. The coordinator
// force-exits first, and `TWn.shutdown` kills the live shells on its way out, so
// the continuation the hang would have stopped never resumes to be stopped.
// Measured exactly as the SIGTERM path was: both twins, both paths, both
// engines, nothing moved.
//
// So the commit and the hang are corpus-dark on EVERY path, which is this
// wave's real finding about L17. The three plans still earn their place: they
// are what MEASURED it, they are the population the gate re-measures the
// darkness over every run, and they cover the SIGINT handler this wave owns.
//
// The tool call below sleeps for about a second, and the surviving reason is not
// the hypothesis that chose it: a second is long enough that the turn is
// unambiguously still in flight when the signal lands on the first `assistant`
// frame, and short enough that a recording is not eight seconds of waiting.
// Nothing depends on the continuation resuming, because it never does.
//
// The chain each plan exercises, end to end:
//
//   the harness delivers the signal at a declared frame count       src/signal.ts
//   SIGTERM → `br` in `ky`: commit the latch, abort, `On(143)`   OPEN (see below)
//   SIGINT  → `Hn` in `ky`: cancel the query, abort, `On(0)`      OWNED (this wave)
//   SIGHUP  → the coordinator's own handler: `shutdown(129)`      upstream's
//   the coordinator shuts down and force-exits with that status   `TWn.shutdown`
//     …committing the latch on the two paths that reach it there  OWNED (this wave)
//
// ## The verdict, and why the exit STATUS is the load-bearing half
//
// "It stopped" is not evidence: a process that ignores SIGTERM also stops. What
// separates the two is HOW — a default disposition kills the process (`signal:
// "SIGTERM"`, no code), an executed handler exits with the status it chose
// (`code: 143`, no signal). The second is the only observation that says the
// engine's own handler ran, and `src/signal.ts` grades them apart rather than
// collapsing them into a boolean.
//
// ## Why its own cassette, and why the RECORDING is not interrupted
//
// Replay topology must match recording topology. This driver builds a different
// prompt from every other lane (its own argv, its own system prompt, its own
// tool catalog), so serving it another lane's cassette would fall back
// positionally on every request — which §3.4 makes fatal, and rightly.
//
// The live take runs to COMPLETION and the signal is delivered only on replay.
// The first version of this driver signalled during the recording too, on the
// theory that record and replay should do the same thing, and it produced a
// cassette with no `/v1/messages` entry at all: the engine emits its `assistant`
// frame from the last SSE event, which is a tick before the recording proxy sees
// its upstream response END, so killing the engine on that frame killed the run
// inside that tick. The replay then had nothing to serve, the engine spent ten
// retries discovering that, and the driver graded a synthetic error turn — a
// green-looking pipeline measuring nothing.
//
// Recording clean is also the better experiment, not merely the working one. The
// cassette is then a real, complete conversation, the INTERRUPTION is the
// variable, and re-recording it is not a race. The second request — the one the
// tool result would have produced — simply goes unserved on every replay, which
// is what "the turn was abandoned" means on the request surface.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { fallbackVerdict, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { CONFIG_DIR, enginePath, REFORGE_ROOT, SANDBOX, saveTranscript, sdkEnv } from "../src/runTurn.js";
import { requireRecordCredential, type EnvMode } from "../src/env.js";
import { resetSandbox } from "../src/harness.js";
import { seedGitRepo } from "../w3/scenarios.js";
import { gateCacheCheck } from "../src/leakcheck.js";
import { describeTrigger, driveWithSignal, shutdownViolations, typesAfterSignal, type FrameTrigger, type SignalRun } from "../src/signal.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
let replayStrictnessOk = true;

/** ONE cassette for both plans: same argv, same prompt, therefore same request body. */
const cassette = join(REFORGE_ROOT, "cassettes", "w13-signals.jsonl");

/**
 * A prompt whose answer is a TOOL CALL, and a tool whose duration is chosen from
 * BOTH sides rather than made generous.
 *
 * Too short and the turn could complete between the first `assistant` frame and
 * the kill syscall, so the signal would land on a finished turn. Too long and
 * the tool outlives the shutdown itself: the coordinator force-exits after a few
 * seconds, the continuation never resumes, and the latch is unobservable for a
 * reason that has nothing to do with the engine. A second is comfortably past
 * the first and comfortably inside the second, which is what lets the SIGHUP
 * plan see the hang at all.
 */
const PROMPT = "Use the Bash tool to run exactly this command: sleep 1; echo LIFECYCLE_MARKER — then tell me what it printed.";

/** The declared delivery point. A frame count, never a clock (src/signal.ts). */
const TRIGGER: FrameTrigger = { frameType: "assistant", nth: 1 };

/**
 * How long the engine is watched after delivery before the run is called
 * non-settling.
 *
 * Upstream's handler runs `armShutdownFailsafe(max(5000, hookTimeout + 5000))`
 * before it awaits anything, so the graceful path can legitimately take several
 * seconds; anything shorter would report "did not exit" for an engine that was
 * shutting down correctly. Twelve seconds is past that failsafe with room, and
 * it bounds the phase — the whole point of a bounded observation is that a
 * non-settling path is a VERDICT rather than a hang.
 */
const QUIET_MS = 12_000;

/**
 * The frame types that may still arrive after delivery — DECLARED, and each for
 * a reason that is not "we saw it happen".
 *
 * `assistant`: one model response leaves as several frames, one per content
 * block. This turn's response is a `thinking` block followed by a `tool_use`
 * block, so the signal lands on the first of a flush the engine already holds
 * in memory; suppressing the rest would be a behaviour no shutdown latch has or
 * should have. What the latch stops is the turn CONTINUING, and the request
 * count is what measures that.
 *
 * `rate_limit_event`: an out-of-band emitter with no relationship to the turn.
 * `src/differ.ts` deletes this type from every transcript it compares, corpus
 * wide, so admitting it here is consistent with how it is treated everywhere.
 *
 * Everything else fails and names itself — a `result` frame, a `user` frame
 * carrying a tool result, a second turn's `system` frame.
 */
const ALLOWED_AFTER = ["assistant", "rate_limit_event"];

interface SignalPlan {
  /** the coverage tag the gate's liveness loop replays (strangle/runners.ts) */
  tag: string;
  signal: NodeJS.Signals;
  /**
   * The status the HANDLER chooses, read off the pinned bundle and committed in
   * `research/fixtures/process-lifecycle-<pin>.json` as that handler's
   * `exitCode`. Observing it is what says the handler ran: the OS would have
   * killed the process instead, with no code at all.
   */
  expectedExit: number;
  /** which handler answers this signal in a headless run, and what it does */
  handler: string;
  /**
   * How many `/v1/messages` requests a turn stopped this way makes: ONE.
   *
   * The sharpest thing here, and the one an engine cannot satisfy merely by
   * going quiet on stdout. The cassette holds TWO — the live take ran the tool
   * and came back for a second turn — so a replay that continued would find its
   * answer waiting. It does not ask.
   */
  expectedRequests: number;
}

/**
 * TWO PLANS, one cassette. They differ only in the signal, and that one
 * difference selects a different handler, a different exit status and — the
 * reason both exist — a different answer to whether the shutdown latch is
 * observable at all (see the header).
 */
const PLANS: SignalPlan[] = [
  {
    tag: "sigterm-mid-turn",
    signal: "SIGTERM",
    expectedExit: 143,
    handler: "the headless dispatcher's own handler: commit the latch, abort the run controller, then the shutdown facade with 143",
    expectedRequests: 1,
  },
  {
    tag: "sighup-mid-turn",
    signal: "SIGHUP",
    expectedExit: 129,
    handler: "the coordinator's own handler, registered by install() and not suppressed in print mode: shut down with 129, aborting nothing",
    expectedRequests: 1,
  },
  {
    // The third plan, and the one whose expected status is ZERO — which is why
    // `expectedRequests` is doing load-bearing work here rather than
    // corroborating. An engine that never received the signal and simply
    // finished its turn ALSO exits 0; what it cannot do is finish the turn on
    // one API request, because the tool result would need a second.
    tag: "sigint-mid-turn",
    signal: "SIGINT",
    expectedExit: 0,
    handler: "the headless dispatcher's own handler (OWNED — `ky-sigint-handler`): cancel the in-flight query, abort the run controller, shut down with 0",
    expectedRequests: 1,
  },
];

/**
 * The recording path: same spawn, same frames, no signal.
 *
 * It returns the same shape so the recording's own guard rails read the frames
 * the same way the replay's verdicts do — `framesAtSignal` is simply `null`,
 * which every consumer already treats as "never stimulated".
 */
function driveToEnd(child: ReturnType<typeof spawn>): Promise<SignalRun> {
  const frames: unknown[] = [];
  let stderr = "";
  let buf = "";
  return new Promise((resolve) => {
    child.stdout?.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          frames.push(JSON.parse(line));
        } catch {
          frames.push({ type: "reforge-unparseable", raw: line.slice(0, 200) });
        }
      }
    });
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code, sig) =>
      resolve({ frames, framesAtSignal: null, framesAfterSignal: 0, exited: true, exitCode: code, killedBySignal: sig, stderr: stderr.slice(0, 600) }),
    );
  });
}

/**
 * Spawn the engine on this lane's argv and drive one user message.
 *
 * `plan` null runs to completion — the recording. Non-null delivers that plan's
 * signal at the declared point and observes; everything else about the two runs
 * is identical, which is what keeps the request bodies hash-matching.
 */
function driveRaw(engine: string, baseUrl: string, mode: EnvMode, plan: SignalPlan | null): Promise<SignalRun> {
  // Same seed as the raw lane, for the same reason: the sandbox sits inside this
  // repository, so an unseeded cwd makes `git` resolve to the repository itself
  // and puts the operator's branch and dirty file list into the system prompt.
  resetSandbox();
  seedGitRepo(SANDBOX);
  const child = spawn(
    enginePath(engine),
    [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      // Room for the turn to continue past the tool call — which it never gets
      // to do. `--max-turns 1` would end the loop with the first assistant
      // message, so the thing being interrupted would already be over.
      "--max-turns",
      "4",
      "--setting-sources",
      "",
    ],
    { cwd: SANDBOX, env: sdkEnv(mode, baseUrl), stdio: ["pipe", "pipe", "pipe"] },
  );

  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: PROMPT }] },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n",
  );
  // Closed in BOTH modes, as the raw lane does. EOF only decides when the
  // session ends after the turn, never what the turn asks for, so it cannot move
  // a request body; leaving it open in one mode and not the other would put an
  // untested difference between the recording and the replay.
  child.stdin.end();
  return plan === null ? driveToEnd(child) : driveWithSignal(child, TRIGGER, plan.signal, QUIET_MS);
}

async function run(plan: SignalPlan, engine: string, side: string): Promise<SignalRun> {
  const observed = observedPath(plan, side);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  try {
    return await driveRaw(engine, `http://127.0.0.1:${proxy.port}`, "replay", plan);
  } finally {
    if (!fallbackVerdict(engineB, side, proxy.fallbackServed())) replayStrictnessOk = false;
    await proxy.close();
  }
}

const observedPath = (plan: SignalPlan, side: string) => join(REFORGE_ROOT, "cassettes", `w13-${plan.tag}-observed-${side}.jsonl`);

// ---- the substance claim: the turn really was IN FLIGHT ---------------------
// Without this a plan could pass on a run where the model answered in one shot,
// the `result` arrived first, and the signal was delivered to an engine with
// nothing left to abandon. That is a different experiment with the same verdict,
// which is the hollow-pass shape every suite in this harness carries a guard for.
function midTurnViolations(r: SignalRun): string[] {
  const bad: string[] = [];
  if (r.framesAtSignal === null) return ["no delivery point"];
  const before = r.frames.slice(0, r.framesAtSignal) as { type?: string }[];
  if (!before.some((f) => f.type === "assistant")) bad.push("no assistant frame preceded the signal");
  if (before.some((f) => f.type === "result")) bad.push("the turn had already produced a result, so the signal did not land mid-turn");
  return bad;
}

/**
 * THE TURN DID NOT CONTINUE, read off the request surface rather than off stdout.
 *
 * A frame count says what the engine printed; this says what it ASKED FOR, and
 * the second is what an abandoned turn is defined by. The proxy writes every
 * request it was handed to the observation dump, so counting is exact.
 */
function requestViolations(plan: SignalPlan, side: string): string[] {
  const messages = readFileSync(observedPath(plan, side), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method: string; path: string })
    .filter((r) => r.method === "POST" && r.path.startsWith("/v1/messages"));
  return messages.length === plan.expectedRequests
    ? []
    : [`${messages.length} /v1/messages request(s), expected ${plan.expectedRequests} — the turn continued past the signal`];
}

const kinds = (r: SignalRun) =>
  r.frames.map((l) => {
    const m = l as { type?: string; subtype?: string };
    return `${m.type}${m.subtype ? ":" + m.subtype : ""}`;
  });

async function gradePlan(plan: SignalPlan): Promise<boolean> {
  console.log(`\n━━━ ${plan.tag}: ${plan.signal} ${describeTrigger(TRIGGER)} ━━━`);
  console.log(`  handler: ${plan.handler}`);
  const a = await run(plan, "engine-real", "A");
  const b = await run(plan, engineB, "B");
  saveTranscript(`w13-${plan.tag}-A`, { engine: "engine-real", messages: a.frames, durationMs: 0 });
  saveTranscript(`w13-${plan.tag}-B`, { engine: engineB, messages: b.frames, durationMs: 0 });

  for (const [side, name, r] of [
    ["A", "engine-real", a],
    ["B", engineB, b],
  ] as [string, string, SignalRun][]) {
    console.log(
      `  ${side}(${name}): frames=${r.frames.length} signalAt=${r.framesAtSignal ?? "NEVER"} after=${r.framesAfterSignal} ` +
        `exit=${r.exitCode}${r.killedBySignal ? ` killedBy=${r.killedBySignal}` : ""} exited=${r.exited} → ${kinds(r).join(" ")}`,
    );
    console.log(`    after the signal: ${typesAfterSignal(r).join(", ") || "nothing"}`);
    if (r.stderr) console.log(`    ${side} stderr: ${r.stderr.split("\n")[0]}`);
  }

  const checks: [string, string[]][] = [
    ["A(engine-real) landed mid-turn", midTurnViolations(a)],
    [`B(${engineB}) landed mid-turn`, midTurnViolations(b)],
    [`A(engine-real) stopped silently and exited ${plan.expectedExit}`, shutdownViolations(a, TRIGGER, plan.expectedExit, ALLOWED_AFTER)],
    [`B(${engineB}) stopped silently and exited ${plan.expectedExit}`, shutdownViolations(b, TRIGGER, plan.expectedExit, ALLOWED_AFTER)],
    ["A(engine-real) made no further API request", requestViolations(plan, "A")],
    [`B(${engineB}) made no further API request`, requestViolations(plan, "B")],
  ];
  let graded = true;
  console.log("  verdicts (each graded on BOTH engines, because a defect both share diffs to nothing):");
  for (const [label, bad] of checks) {
    console.log(`    ${bad.length === 0 ? "ok  " : "BAD "} ${label}${bad.length > 0 ? ` — ${bad.join("; ")}` : ""}`);
    graded &&= bad.length === 0;
  }

  const diff = diffTranscripts(a.frames, b.frames);
  console.log(`  wire lines: ${diff.length === 0 ? "identical" : `${diff.length} difference(s)`}`);
  for (const f of diff.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

  const sameStop = a.exitCode === b.exitCode && a.killedBySignal === b.killedBySignal && a.framesAfterSignal === b.framesAfterSignal;
  if (!sameStop) console.log(`  STOP SHAPE DIFFERS: A exit=${a.exitCode}/${a.killedBySignal} after=${a.framesAfterSignal} vs B exit=${b.exitCode}/${b.killedBySignal} after=${b.framesAfterSignal}`);

  const ok = graded && diff.length === 0 && sameStop;
  // The tag-shaped verdict line the gate's liveness loop reads (strangle/runners.ts).
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${plan.tag}`);
  return ok;
}

console.log("=== W13b: signals delivered mid-turn ===");

const planArg = args.includes("--plan") ? args[args.indexOf("--plan") + 1] : undefined;
const selected = planArg === undefined ? PLANS : PLANS.filter((p) => p.tag === planArg);
if (selected.length === 0) {
  console.error(`ABORT: unknown plan '${planArg}'. Known: ${PLANS.map((p) => p.tag).join(", ")}`);
  process.exit(2);
}

if (!existsSync(cassette) || args.includes("--rerecord")) {
  requireRecordCredential();
  const staged = `${cassette}.recording`;
  rmSync(staged, { force: true });
  console.log("  recording a COMPLETE turn live; the signal is delivered on replay only ...");
  const rec = await startRecordProxy(staged);
  const live = await driveRaw("engine-real", `http://127.0.0.1:${rec.port}`, "record", null);
  await rec.close();
  if (!existsSync(staged)) {
    console.error("FAIL — the recording produced no cassette");
    process.exit(1);
  }
  const text = readFileSync(staged, "utf8");
  const markers: [string, string][] = [
    [join(homedir(), ".claude"), "operator config dir"],
    ["Memory index", "operator memory index"],
    ["@gmail.com", "operator email"],
  ];
  const hits = markers.filter(([m]) => text.includes(m)).map(([, l]) => l);
  if (hits.length > 0 || !gateCacheCheck(CONFIG_DIR, "w13-signals/record")) {
    rmSync(staged, { force: true });
    console.error(`FAIL — recording rejected: ${hits.join(", ") || "gate-cache leak"}`);
    process.exit(1);
  }
  // THE RECORDING HAS TO CONTAIN THE THING THE REPLAY INTERRUPTS. A take whose
  // first assistant message is plain text finished the turn in one request, so
  // the replay's "mid-turn" signal would land on an engine with nothing left to
  // abandon — and every verdict below would still look reasonable. This is what
  // makes the recording's SHAPE part of the contract rather than something the
  // model happened to do that day.
  const usedTool = live.frames.some((f) => {
    const c = (f as { type?: string; message?: { content?: unknown } }).message?.content;
    return (f as { type?: string }).type === "assistant" && Array.isArray(c) && c.some((b: { type?: string }) => b?.type === "tool_use");
  });
  const exchanges = text.split("\n").filter(Boolean).length;
  if (!usedTool || exchanges < 3) {
    rmSync(staged, { force: true });
    console.error(
      `FAIL — the live take is not a multi-request tool turn (tool_use=${usedTool}, ${exchanges} exchange(s) incl. the HEAD probe); ` +
        `there would be no mid-turn for the signal to land in. Re-record.`,
    );
    process.exit(1);
  }
  renameSync(staged, cassette);
  console.log(`  recorded ${exchanges} API exchange(s) from a complete turn (tool_use present)`);
}

const verdicts: [string, boolean][] = [];
for (const plan of selected) verdicts.push([plan.tag, await gradePlan(plan)]);

console.log("\n=== W13b signal plans ===");
for (const [tag, ok] of verdicts) console.log(`  ${ok ? "PASS" : "FAIL"}  ${tag}`);
const ok = replayStrictnessOk && verdicts.every(([, v]) => v);
console.log(ok ? "\nPASS — both engines stop the turn the same way and exit with the status their own handler chose" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
