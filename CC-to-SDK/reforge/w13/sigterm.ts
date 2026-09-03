// W13b / C16b — SIGTERM MID-TURN, graded on both engines.
//
//   cd reforge && set -a; . ../.env; set +a; npx tsx w13/sigterm.ts [--engineB <name>] [--rerecord]
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
// makes this driver the only thing that can turn "these are live" from a claim
// into a measurement.
//
// The chain it exercises, end to end, is upstream's own and is worth stating
// because each link belongs to a different owner:
//
//   the harness delivers SIGTERM at a declared frame count          src/signal.ts
//   the headless dispatcher's handler runs                          `br` in `ky`
//     …commits the latch                                            OWNED (this wave)
//     …aborts the run controller
//     …calls the shutdown facade with 143                           `On(143)`
//   the coordinator shuts down and force-exits with that status     `TWn.shutdown`
//   everything still in flight consults the latch and hangs         OWNED (this wave)
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
const TAG = "sigterm-mid-turn";
let replayStrictnessOk = true;

const cassette = join(REFORGE_ROOT, "cassettes", "w13-sigterm.jsonl");

/**
 * A prompt whose answer is a TOOL CALL, and a tool that takes long enough that
 * the turn is unambiguously still in flight when the signal lands.
 *
 * The window is what makes the trigger safe rather than lucky. Delivery happens
 * on the first `assistant` frame, which the engine writes before it runs the
 * tool; the sleep means the tool result — and therefore the second API request —
 * cannot arrive first on any machine. Without it a fast host could complete the
 * turn between the frame and the syscall, and the cassette would be answering a
 * conversation the replay does not have.
 */
const PROMPT = "Use the Bash tool to run exactly this command: sleep 8; echo LIFECYCLE_MARKER — then tell me what it printed.";

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
 * The status upstream's SIGTERM handler chooses: `On(143)`, read off the pinned
 * bundle and committed in `research/fixtures/process-lifecycle-<pin>.json` as
 * the handler's `exitCode`. 143 is 128 + 15, the shell's convention for
 * "terminated by SIGTERM" — chosen by the handler, not imposed by the OS, which
 * is exactly why observing it proves the handler ran.
 */
const EXPECTED_EXIT = 143;

/**
 * The frame types that may still arrive after delivery — DECLARED, and each for
 * a reason that is not "we saw it happen".
 *
 * `assistant`: one model response leaves as several frames, one per content
 * block. This turn's response is a `thinking` block followed by a `tool_use`
 * block, so the signal lands on the first of a flush the engine already holds
 * in memory; suppressing the rest would be a behaviour no shutdown latch has or
 * should have. What the latch stops is the turn CONTINUING, and the request
 * count below is what measures that.
 *
 * `rate_limit_event`: an out-of-band emitter with no relationship to the turn.
 * `src/differ.ts` deletes this type from every transcript it compares, corpus
 * wide, so admitting it here is consistent with how it is treated everywhere.
 *
 * Everything else fails and names itself — a `result` frame, a `user` frame
 * carrying a tool result, a second turn's `system` frame.
 */
const ALLOWED_AFTER = ["assistant", "rate_limit_event"];

/**
 * How many `/v1/messages` requests a turn that was abandoned makes: ONE.
 *
 * This is the sharpest thing the scenario measures and the one that cannot be
 * satisfied by an engine that merely stopped writing to stdout. The cassette
 * holds TWO — the live take ran the tool and came back for a second turn — so a
 * replay that continued would find its answer waiting. It does not ask.
 */
const EXPECTED_REQUESTS = 1;

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
 * `trigger` null runs to completion — the recording. Non-null delivers SIGTERM
 * at the declared point and observes; everything else about the two runs is
 * identical, which is what keeps the request bodies hash-matching.
 */
function driveRaw(engine: string, baseUrl: string, mode: EnvMode, trigger: FrameTrigger | null): Promise<SignalRun> {
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
  return trigger === null ? driveToEnd(child) : driveWithSignal(child, trigger, "SIGTERM", QUIET_MS);
}

async function run(engine: string, side: string): Promise<SignalRun> {
  const observed = join(REFORGE_ROOT, "cassettes", `w13-sigterm-observed-${side}.jsonl`);
  rmSync(observed, { force: true });
  const proxy = await startReplayProxy(cassette, observed);
  try {
    return await driveRaw(engine, `http://127.0.0.1:${proxy.port}`, "replay", TRIGGER);
  } finally {
    if (!fallbackVerdict(engineB, side, proxy.fallbackServed())) replayStrictnessOk = false;
    await proxy.close();
  }
}

console.log(`=== W13b: SIGTERM mid-turn (${describeTrigger(TRIGGER)}) ===`);

if (!existsSync(cassette) || args.includes("--rerecord")) {
  requireRecordCredential();
  const staged = `${cassette}.recording`;
  rmSync(staged, { force: true });
  console.log("  recording live, with the signal delivered at the same declared point ...");
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
  if (hits.length > 0 || !gateCacheCheck(CONFIG_DIR, "w13-sigterm/record")) {
    rmSync(staged, { force: true });
    console.error(`FAIL — recording rejected: ${hits.join(", ") || "gate-cache leak"}`);
    process.exit(1);
  }
  // THE RECORDING HAS TO CONTAIN THE THING THE REPLAY INTERRUPTS. A take whose
  // first assistant message is plain text finished the turn in one request, so
  // the replay's "mid-turn" signal would land on an engine with nothing left to
  // abandon — and every verdict below would still look reasonable. This is the
  // check that makes the recording's SHAPE part of the contract rather than
  // something the model happened to do that day.
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
  console.log(`  recorded ${exchanges} API exchange(s) from a complete turn (tool_use present); the signal is delivered on REPLAY only`);
}

const a = await run("engine-real", "A");
const b = await run(engineB, "B");
saveTranscript("w13-sigterm-A", { engine: "engine-real", messages: a.frames, durationMs: 0 });
saveTranscript("w13-sigterm-B", { engine: engineB, messages: b.frames, durationMs: 0 });

const kinds = (r: SignalRun) =>
  r.frames.map((l) => {
    const m = l as { type?: string; subtype?: string };
    return `${m.type}${m.subtype ? ":" + m.subtype : ""}`;
  });

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

// ---- the substance claim: the turn really was IN FLIGHT ---------------------
// Without this the scenario could pass on a run where the model answered in one
// shot, the `result` arrived first, and SIGTERM was delivered to an engine with
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
 * the second is the one an abandoned turn is defined by. The proxy writes every
 * request it was handed to the observation dump, so counting is exact.
 */
function requestViolations(side: string): string[] {
  const dump = join(REFORGE_ROOT, "cassettes", `w13-sigterm-observed-${side}.jsonl`);
  const messages = readFileSync(dump, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method: string; path: string })
    .filter((r) => r.method === "POST" && r.path.startsWith("/v1/messages"));
  return messages.length === EXPECTED_REQUESTS
    ? []
    : [`${messages.length} /v1/messages request(s), expected ${EXPECTED_REQUESTS} — the turn continued past the signal`];
}

const checks: [string, string[]][] = [
  ["A(engine-real) landed mid-turn", midTurnViolations(a)],
  [`B(${engineB}) landed mid-turn`, midTurnViolations(b)],
  ["A(engine-real) stopped silently and chose its own exit status", shutdownViolations(a, TRIGGER, EXPECTED_EXIT, ALLOWED_AFTER)],
  [`B(${engineB}) stopped silently and chose its own exit status`, shutdownViolations(b, TRIGGER, EXPECTED_EXIT, ALLOWED_AFTER)],
  ["A(engine-real) made no further API request", requestViolations("A")],
  [`B(${engineB}) made no further API request`, requestViolations("B")],
];
let graded = true;
console.log("\n  verdicts (each graded on BOTH engines, because a defect both share diffs to nothing):");
for (const [label, bad] of checks) {
  console.log(`    ${bad.length === 0 ? "ok  " : "BAD "} ${label}${bad.length > 0 ? ` — ${bad.join("; ")}` : ""}`);
  graded &&= bad.length === 0;
}

const diff = diffTranscripts(a.frames, b.frames);
console.log(`  wire lines: ${diff.length === 0 ? "identical" : `${diff.length} difference(s)`}`);
for (const f of diff.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

const sameStop = a.exitCode === b.exitCode && a.killedBySignal === b.killedBySignal && a.framesAfterSignal === b.framesAfterSignal;
if (!sameStop) console.log(`  STOP SHAPE DIFFERS: A exit=${a.exitCode}/${a.killedBySignal} after=${a.framesAfterSignal} vs B exit=${b.exitCode}/${b.killedBySignal} after=${b.framesAfterSignal}`);

const ok = replayStrictnessOk && graded && diff.length === 0 && sameStop;
// The tag-shaped verdict line the gate's liveness loop reads (strangle/runners.ts).
console.log(`  ${ok ? "PASS" : "FAIL"}  ${TAG}`);
console.log(ok ? "\nPASS — both engines abandon the turn silently and exit with the status their own handler chose" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
