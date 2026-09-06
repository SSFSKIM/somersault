// Controls for the rules that decide whether a LIVE take is promoted
// (`src/record.ts`), both of which cost an API take to discover by running.
//
//   npx tsx src/record.test.ts
//
// Neither rule is reachable from a replay: `recordCassette` only runs against
// `engine-real` with a credential, and the failures under test are an API
// throttle and a scenario whose behaviour does not exist yet. So the two
// predicates it decides with are exported and checked here against the sentences
// the API actually produced and against the corpus's own scenarios — the shape
// C13c's fix round settled on after both rules were found wrong by reading.
//
// This file touches neither `sandbox/` nor `config/`: it imports the scenario
// lists for their DECLARATIONS and never runs one, so it needs no sandbox lock.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturedInfraFailure, gradesSubstanceLive, mintedPathsIn } from "./record.js";
import { type Scenario } from "./harness.js";
import { W5_SCENARIOS } from "../w5/scenarios.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

// ---- the infrastructure-failure vocabulary ---------------------------------
// A capture the harness threw on, as `runScenarioOnce` records it.
const thrown = (message: string): unknown[] => [{ type: "reforge-exception", name: "Error", message }];

// VERBATIM, because the point of this list is that it is not a paraphrase. The
// first is the sentence this campaign was refused with for three hours on
// 2026-09-05 and again during C12a's `store-read-only` re-record.
check("the measured account throttle is an infrastructure failure",
  capturedInfraFailure(thrown(
    "API Error: Server is temporarily limiting requests (not your usage limit) · This request would exceed your account's rate limit. Please try again later.",
  )));
check("…and so is a subscription usage limit, which names neither 'rate limit' nor a status",
  capturedInfraFailure(thrown("Claude AI usage limit reached. Your limit will reset at 3pm.")));
check("…and a quota refusal", capturedInfraFailure(thrown("API Error: quota exceeded for this organization")));
check("…and 429, the status the rate limit itself is served as",
  capturedInfraFailure(thrown('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}')));
check("…and 529, which is what Overloaded is served as",
  capturedInfraFailure(thrown('API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}')));
check("…and the three gateway statuses", ["502", "503", "504"].every((s) => capturedInfraFailure(thrown(`API Error: ${s} Bad Gateway`))));

// THE NEGATIVE HALF, which is what keeps the widening honest: a take discarded
// as "infrastructure" is a take the walk RETRIES, so a predicate that swallowed
// an engine failure would loop on a finding instead of reporting it.
check("an engine that exited non-zero is NOT an infrastructure failure",
  !capturedInfraFailure(thrown("Claude Code process exited with code 1")));
check("a status-shaped substring inside a larger number does not count",
  !capturedInfraFailure(thrown("the tool result was 15042 bytes, over the 30000 clamp")));
check("the same words in a MESSAGE the engine produced are not the harness throwing",
  !capturedInfraFailure([{ type: "assistant", message: "the docs mention a rate limit of 429 requests" }]));
check("a clean capture carries no infrastructure failure",
  !capturedInfraFailure([{ type: "assistant", message: "REFORGE_OK" }, { type: "result", subtype: "success" }]));

// ---- which takes are graded on their substance ------------------------------
const scenario = (over: Partial<Scenario>): Scenario => ({ tag: "t", title: "t", run: async () => [], ...over });

check("a scenario with a check is graded live",
  gradesSubstanceLive(scenario({ check: () => null })));
check("a scenario with no check has no substance to grade",
  !gradesSubstanceLive(scenario({})));
check("a caller may turn the check off, but has to say so",
  !gradesSubstanceLive(scenario({ check: () => null }), false));
// THE FIX ITSELF. The behaviour is authored into the cassette AFTER the take, so
// the check is a claim about the derived artifact and is false of the take.
check("a scenario whose fault is DERIVED is not graded on the live take",
  !gradesSubstanceLive(scenario({ check: () => null, deriveFault: "server-error" })));

// …and against the corpus rather than against a fixture, because the scenario
// that exposed this is a real one and the rule has to hold for it by name.
const stopFailure = W5_SCENARIOS.find((s) => s.tag === "hooks-stop-failure");
check("hooks-stop-failure still both derives a fault and carries a check",
  stopFailure?.deriveFault !== undefined && stopFailure?.check !== undefined);
check("…so a fresh live take of it is promoted rather than discarded",
  stopFailure !== undefined && !gradesSubstanceLive(stopFailure));
// Its check would in fact fail on a healthy take — which is what made the old
// rule discard every one of them. Asserted, not assumed: a check that happened
// to pass on a healthy turn would make this whole exception unnecessary.
check("…because that check DOES reject the healthy turn the take records",
  stopFailure?.check?.([{ type: "result", subtype: "success" }], [{ event: "Stop" }]) !== null);
check("every scenario that derives a fault is excluded, and there is at least one",
  W5_SCENARIOS.filter((s) => s.deriveFault !== undefined).length > 0 &&
    W5_SCENARIOS.filter((s) => s.deriveFault !== undefined).every((s) => !gradesSubstanceLive(s)));

// ---- the third rule: a recorded tool call may not name an engine-minted path -
//
// Written against SYNTHESISED cassettes rather than a corpus one, deliberately.
// The corpus is the thing this rule protects, so a control that reads it would
// go green the moment the rule worked and stop testing anything; and the shape
// under test is the shape a cassette must NOT have. `bash-timeout-background`'s
// first cassette had it — a `Read` of `…/<session>/tasks/bjg986xvr.output` —
// and it kept replaying until the machine rebooted and took `/tmp` with it,
// which is precisely why the rule is enforced at promotion rather than reviewed.
const box = mkdtempSync(join(tmpdir(), "reforge-record-"));
const cassetteOf = (...bodies: unknown[]): string => {
  const f = join(box, `c${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(f, bodies.map((b) => JSON.stringify({ method: "POST", path: "/v1/messages", requestBody: typeof b === "string" ? b : JSON.stringify(b) })).join("\n") + "\n");
  return f;
};
const turn = (blocks: unknown[]) => ({ messages: [{ role: "assistant", content: blocks }] });

try {
  const taskRead = cassetteOf(turn([{ type: "tool_use", name: "Read", input: { file_path: "/private/tmp/claude-501/x-sandbox/a2ec2b6d/tasks/bjg986xvr.output" } }]));
  check("a recorded Read of a backgrounded task's output file is named", mintedPathsIn(taskRead).length === 1, JSON.stringify(mintedPathsIn(taskRead)));
  check("…and the reason quotes the call, so the fix can be aimed at the prompt", mintedPathsIn(taskRead)[0]?.startsWith("Read(") === true, mintedPathsIn(taskRead)[0]);

  const resultRead = cassetteOf(turn([{ type: "tool_use", name: "Read", input: { file_path: "/x/y/tool-results/b1a2b3c4d.txt" } }]));
  check("a recorded read of a persisted tool-result file is named too", mintedPathsIn(resultRead).length === 1, JSON.stringify(mintedPathsIn(resultRead)));

  // THE NEGATIVE DIRECTION, and it is the half that matters: the engine writes
  // these paths into tool RESULTS on every backgrounded run, and a rule that
  // rejected those would reject every healthy take of three scenarios.
  const inResult = cassetteOf({
    messages: [{ role: "user", content: [{ type: "tool_result", content: "…was moved to the background (ID: bjg986xvr). Output is being written to: /tmp/s/a2ec/tasks/bjg986xvr.output." }] }],
  });
  check("the same path in a tool RESULT is not a finding — a result is the engine answering", mintedPathsIn(inResult).length === 0, JSON.stringify(mintedPathsIn(inResult)));
  const prose = cassetteOf(turn([{ type: "text", text: "the file at /tasks/bjg986xvr.output is where output goes" }]));
  check("…and so is the path in the model's own prose, which no replay has to match", mintedPathsIn(prose).length === 0, JSON.stringify(mintedPathsIn(prose)));
  const ordinary = cassetteOf(turn([{ type: "tool_use", name: "Read", input: { file_path: "/x/sandbox/reforge-child.sh" } }]));
  check("an ordinary Read is not a finding", mintedPathsIn(ordinary).length === 0, JSON.stringify(mintedPathsIn(ordinary)));
  const bare = cassetteOf(turn([{ type: "tool_use", name: "Bash", input: { command: "echo bjg986xvr" } }]));
  check("…nor is the bare id shape, which also occurs in prose", mintedPathsIn(bare).length === 0, JSON.stringify(mintedPathsIn(bare)));

  const boot = cassetteOf("");
  check("a non-JSON body (the boot probe) is skipped rather than thrown on", mintedPathsIn(boot).length === 0);

  const many = cassetteOf(
    turn([{ type: "tool_use", name: "Read", input: { file_path: "/a/tasks/bjg986xvr.output" } }]),
    turn([{ type: "tool_use", name: "Read", input: { file_path: "/a/tasks/bjg986xvr.output" } }]),
  );
  check("the same call in two entries is reported once", mintedPathsIn(many).length === 1, JSON.stringify(mintedPathsIn(many)));
} finally {
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== live-take promotion rules: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "PASS — a throttle is waited out, a derived fault is not demanded of the live take, and a take that names an engine-minted path is refused"
      : `FAIL — ${failures.length} control(s) failed`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
