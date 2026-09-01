// H5 — drive the engine WITHOUT sdk.mjs, speaking stream-json over stdio
// directly. The wrapper is a lens: it normalizes, filters, and can hide
// protocol behavior (this project's original motive was hooks that never fire
// headlessly). engine-ts must satisfy the PROTOCOL, not merely whatever the
// current wrapper chooses to surface — so the harness needs one driver that
// sees the wire unmediated.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx m2/raw-protocol.ts [--engineB <name>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { diffTranscripts } from "../src/differ.js";
import { fallbackVerdict, startRecordProxy, startReplayProxy } from "../src/proxy.js";
import { CONFIG_DIR, enginePath, REFORGE_ROOT, SANDBOX, saveTranscript, sdkEnv } from "../src/runTurn.js";
import { requireRecordCredential, type EnvMode } from "../src/env.js";
import { gateCacheCheck } from "../src/leakcheck.js";

const args = process.argv.slice(2);
const engineB = args.includes("--engineB") ? args[args.indexOf("--engineB") + 1] : "engine-extracted";
/** §3.4 — set false by any fatal positional fallback; folded into the final verdict. */
let replayStrictnessOk = true;
/**
 * Its OWN cassette, not the SDK corpus's `plain` recording.
 *
 * Reusing `m1-plain.jsonl` looked economical and was quietly wrong: print mode
 * driven raw builds a materially different prompt from the same prompt text
 * driven through `sdk.mjs` (measured at this pin: 106 KB vs 77 KB, the raw path
 * additionally injecting the Agent tool's agent-type catalog). So every raw
 * replay was being served its response POSITIONALLY — invisible until §3.4 made
 * fallbacks a graded outcome. Replay topology must match recording topology;
 * `cross-resume` learned the same lesson from the other direction.
 */
const cassette = join(REFORGE_ROOT, "cassettes", "m2-raw.jsonl");

const PROMPT = "Reply with exactly the single word SELFTEST_OK and nothing else.";

/**
 * THE CONTROL-SUBTYPE DRIVER (C10 / W7).
 *
 * Until this wave the raw driver sent one `user` message and no control request
 * at all, so the "no-wrapper wire" suite graded exactly none of the control
 * protocol — the campaign spec's "raw-protocol depth (every control subtype)"
 * was entirely unpaid. It is the only surface in the harness that can grade the
 * protocol, for a structural reason: `sdk.mjs` CONSUMES control responses. An
 * `initialize` answer, a validation refusal and an unsupported-subtype error all
 * vanish inside the wrapper, so no SDK-driven scenario can ever see one. Here
 * they are ordinary wire lines that both engines must produce identically.
 *
 * WHY THE CONTROL FRAMES GO FIRST, before the prompt. Two of them decide
 * something about the turn that follows — the permission mode the turn runs
 * under, and the thinking budget that lands in the request body — so sending
 * them first is what makes their handlers observable through the REQUEST diff as
 * well as the wire diff. Sending them after the `result` would have graded
 * nothing at all: `--max-turns 1` ends the loop with the turn, and frames
 * arriving after it are never read.
 *
 * The cases are chosen so that each one grades a different thing:
 *
 *   initialize                     the handshake every SDK session sends, and
 *                                  the only path to the initialize response
 *                                  payload (upstream `Ey` -> `_f`): a ~1 KB
 *                                  object naming the session's commands,
 *                                  agents, models, output styles, permission
 *                                  mode and account shape.
 *   set_permission_mode (bad)      the arm's OWN validation, above the guard
 *   set_permission_mode (good)     the guard, the transition, and the mode the
 *                                  turn then runs under
 *   set_max_thinking_tokens (bad)  the arm's validation sentence
 *   set_max_thinking_tokens (good) the thinking-config resolver, whose answer
 *                                  goes into the turn's request body
 *   get_binary_version             an arm NO installed SDK can ask for — the
 *                                  fixture counts sixteen of those, and this is
 *                                  the cheapest proof that the raw lane reaches
 *                                  a place the wrapper cannot
 *   get_context_usage             a read-only computation over the live session
 *   <unknown subtype>              the ladder's terminal `else`
 *
 * Each case is graded on the RESPONSE FRAME the engine emits for it, correlated
 * by `request_id`, and every frame also flows into the whole-wire diff between
 * the two engines. The per-case verdicts are what makes a missing answer a named
 * failure rather than a silent absence in a line count.
 */
interface ControlCase {
  /** stable name, printed in the verdict table */
  name: string;
  request: Record<string, unknown>;
  /** what the engine must answer with */
  expect: "success" | "error";
  /** a fragment the error text must contain — the arm's own sentence */
  errorContains?: string;
  /** for a success, keys the response payload must carry */
  responseKeys?: string[];
  /** what this case grades, printed so the table is self-explaining */
  grades: string;
}

const ALL_CONTROL_CASES: ControlCase[] = [
  {
    name: "initialize",
    request: { subtype: "initialize" },
    expect: "success",
    // the payload's stable shape; `pid` is deliberately NOT asserted (it is a
    // per-process value the differ scrubs) and `account` is empty under the
    // replay credential, so neither can carry the claim.
    responseKeys: ["commands", "agents", "output_style", "available_output_styles", "models", "current_permission_mode"],
    grades: "the initialize handler and the response payload builder",
  },
  {
    name: "set_permission_mode-invalid",
    request: { subtype: "set_permission_mode", mode: "reforge_not_a_mode" },
    expect: "error",
    // upstream's sentence joins its own mode enumeration, so the fragment
    // asserted here stops before the list — the list itself is what
    // `research/fixtures/permission-surface-<pin>.json` grades.
    errorContains: "Cannot set permission mode: must be one of",
    grades: "the arm's own mode validation, above the guard",
  },
  {
    name: "set_permission_mode-valid",
    request: { subtype: "set_permission_mode", mode: "default" },
    expect: "success",
    grades: "the mode setter: guard, unchanged-mode short circuit, transition",
  },
  {
    name: "set_max_thinking_tokens-invalid",
    request: { subtype: "set_max_thinking_tokens", max_thinking_tokens: "lots" },
    expect: "error",
    errorContains: "max_thinking_tokens must be an integer",
    grades: "the arm's thinking validation sentence",
  },
  {
    name: "set_max_thinking_tokens-valid",
    request: { subtype: "set_max_thinking_tokens", max_thinking_tokens: 2048, thinking_display: "summarized" },
    expect: "success",
    grades: "the thinking-config resolver's enabled arm, into the request body",
  },
  {
    name: "get_binary_version",
    request: { subtype: "get_binary_version" },
    expect: "success",
    responseKeys: ["version", "buildTime"],
    grades: "an arm no installed SDK can reach at all",
  },
  {
    name: "get_context_usage",
    request: { subtype: "get_context_usage" },
    expect: "success",
    grades: "a read-only computation over the live session",
  },
  {
    name: "unsupported-subtype",
    request: { subtype: "reforge_no_such_subtype" },
    expect: "error",
    errorContains: "Unsupported control request subtype",
    grades: "the ladder's terminal else",
  },
];

/**
 * Bisection hatch for authoring a new case, and nothing else: the committed
 * surface is the whole list. Left in because a control frame that stops the
 * session is the failure mode this driver actually hits (`get_context_usage`
 * did, at authoring time), and finding which one requires running them singly.
 */
const CONTROL_CASES = process.env.REFORGE_RAW_CASES
  ? ALL_CONTROL_CASES.filter((c) => process.env.REFORGE_RAW_CASES!.split(",").includes(c.name))
  : ALL_CONTROL_CASES;

/** Speak stream-json to the engine binary directly; return every wire line. */
function driveRaw(engine: string, baseUrl: string, mode: EnvMode): Promise<{ lines: unknown[]; exitCode: number | null; stderr: string }> {
  mkdirSync(SANDBOX, { recursive: true });
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
      "--max-turns",
      "1",
      "--setting-sources",
      "",
    ],
    {
      cwd: SANDBOX,
      // X6 — the no-wrapper driver spawns the engine itself, so it builds the
      // same allowlisted env sdk.mjs would have been handed. This path was the
      // last one still inheriting the operator's environment wholesale.
      env: sdkEnv(mode, baseUrl),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const lines: unknown[] = [];
  let buf = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) {
        try {
          lines.push(JSON.parse(line));
        } catch {
          lines.push({ type: "reforge-unparseable", raw: line.slice(0, 200) });
        }
      }
    }
  });
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));

  // The control frames first (see the ControlCase header), then the prompt. The
  // request ids are FIXED strings rather than uuids: the driver correlates
  // answers by them, and a per-run id would be one more thing the differ has to
  // scrub out of a surface whose whole point is being unmediated.
  for (const c of CONTROL_CASES) {
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: `reforge-${c.name}`, request: c.request }) + "\n");
  }
  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: PROMPT }] },
      parent_tool_use_id: null,
      session_id: "",
    }) + "\n",
  );
  child.stdin.end();

  return new Promise((resolve) => {
    child.on("close", (exitCode) => resolve({ lines, exitCode, stderr: stderr.slice(0, 400) }));
  });
}

async function run(engine: string, side: string) {
  const observed = join(REFORGE_ROOT, "cassettes", `m2-raw-observed-${side}.jsonl`);
  rmSync(observed, { force: true }); // appended to, so a stale file would blend runs
  const proxy = await startReplayProxy(cassette, observed);
  try {
    return await driveRaw(engine, `http://127.0.0.1:${proxy.port}`, "replay");
  } finally {
    if (!fallbackVerdict(engineB, side, proxy.fallbackServed())) replayStrictnessOk = false;
    await proxy.close();
  }
}

console.log("=== H5: raw stream-json protocol (no sdk.mjs) ===");

if (!existsSync(cassette) || args.includes("--rerecord")) {
  requireRecordCredential();
  const staged = `${cassette}.recording`;
  rmSync(staged, { force: true });
  console.log("  recording live through the RAW driver ...");
  const rec = await startRecordProxy(staged);
  await driveRaw("engine-real", `http://127.0.0.1:${rec.port}`, "record");
  await rec.close();
  if (!existsSync(staged)) {
    console.error("FAIL — the raw recording produced no cassette");
    process.exit(1);
  }
  // Same H1 guard the corpus runner applies: a recording that captured the
  // operator's config dir is not a cassette.
  const text = readFileSync(staged, "utf8");
  const markers: [string, string][] = [[join(homedir(), ".claude"), "operator config dir"], ["Memory index", "operator memory index"], ["@gmail.com", "operator email"]];
  const hits = markers.filter(([m]) => text.includes(m)).map(([, l]) => l);
  if (hits.length > 0 || !gateCacheCheck(CONFIG_DIR, "m2-raw/record")) {
    rmSync(staged, { force: true });
    console.error(`FAIL — raw recording rejected: ${hits.join(", ") || "gate-cache leak"}`);
    process.exit(1);
  }
  renameSync(staged, cassette);
  console.log(`  recorded ${text.split("\n").filter(Boolean).length} API exchange(s)`);
}
const a = await run("engine-real", "A");
const b = await run(engineB, "B");
saveTranscript("m2-raw-A", { engine: "engine-real", messages: a.lines, durationMs: 0 });
saveTranscript("m2-raw-B", { engine: engineB, messages: b.lines, durationMs: 0 });

const kinds = (r: { lines: unknown[] }) =>
  r.lines.map((l) => {
    const m = l as { type?: string; subtype?: string };
    return `${m.type}${m.subtype ? ":" + m.subtype : ""}`;
  });

console.log(`  A(real):  exit=${a.exitCode} lines=${a.lines.length} → ${kinds(a).join(" ")}`);
console.log(`  B(${engineB}): exit=${b.exitCode} lines=${b.lines.length} → ${kinds(b).join(" ")}`);
if (a.stderr) console.log(`  A stderr: ${a.stderr.split("\n")[0]}`);
if (b.stderr) console.log(`  B stderr: ${b.stderr.split("\n")[0]}`);

const substantive = a.lines.some((l) => (l as { type?: string }).type === "result");
console.log(`  protocol produced a result: ${substantive ? "yes" : "NO — raw driver never completed a turn"}`);

// ---- per-case control-subtype verdicts -------------------------------------
// Graded on BOTH engines independently rather than only on the oracle: the
// whole-wire diff below would catch a payload that differs, but a case that BOTH
// engines answer wrongly (or not at all) diffs to nothing. A driver whose
// negative cannot fail is the vacuity this campaign keeps finding.
interface ControlResponseFrame {
  type?: string;
  response?: { subtype?: string; request_id?: string; error?: string; response?: Record<string, unknown> };
}
function answerFor(lines: unknown[], requestId: string): ControlResponseFrame["response"] | undefined {
  for (const l of lines) {
    const f = l as ControlResponseFrame;
    if (f.type === "control_response" && f.response?.request_id === requestId) return f.response;
  }
  return undefined;
}
function gradeCase(c: ControlCase, lines: unknown[]): string | null {
  const r = answerFor(lines, `reforge-${c.name}`);
  if (!r) return "no control_response for this request_id";
  if (r.subtype !== c.expect) return `answered ${r.subtype}, expected ${c.expect}`;
  if (c.expect === "error") {
    if (typeof r.error !== "string" || r.error.length === 0) return "error answer carries no message";
    if (c.errorContains && !r.error.includes(c.errorContains)) return `error text does not mention ${JSON.stringify(c.errorContains)}: ${r.error.slice(0, 90)}`;
  }
  for (const k of c.responseKeys ?? []) {
    if (r.response === undefined || !(k in r.response)) return `success payload is missing '${k}'`;
  }
  return null;
}

let controlOk = true;
console.log("\n  control-subtype cases (each graded on BOTH engines):");
for (const c of CONTROL_CASES) {
  const fa = gradeCase(c, a.lines);
  const fb = gradeCase(c, b.lines);
  const ok = fa === null && fb === null;
  controlOk &&= ok;
  console.log(`    ${ok ? "ok  " : "BAD "} ${c.name.padEnd(31)} ${c.grades}`);
  if (fa) console.log(`         A(real): ${fa}`);
  if (fb) console.log(`         B(${engineB}): ${fb}`);
}

const diff = diffTranscripts(a.lines, b.lines);
console.log(`  wire lines: ${diff.length === 0 ? "identical" : `${diff.length} difference(s)`}`);
for (const f of diff.slice(0, 8)) console.log(`    ${f.path}: ${JSON.stringify(f.a)?.slice(0, 70)} != ${JSON.stringify(f.b)?.slice(0, 70)}`);

const ok = replayStrictnessOk && substantive && controlOk && diff.length === 0 && a.exitCode === b.exitCode;
// The tag-shaped verdict line the strangler gate's liveness phase reads. Its
// rule (C9's tightening) is that a RED needs the runner's OWN verdict for the
// tag, so this suite has to name itself the way `m1/run.ts` names a scenario —
// otherwise a control-protocol splice could only ever be graded as INCONCLUSIVE.
console.log(`  ${ok ? "PASS" : "FAIL"}  raw-protocol`);
console.log(ok ? "\nPASS — engines are equivalent at the raw protocol layer" : "\nFAIL");
process.exitCode = ok ? 0 : 1;
