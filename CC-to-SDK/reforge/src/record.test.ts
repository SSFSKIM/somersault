// Controls for the two rules that decide whether a LIVE take is promoted
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
import { capturedInfraFailure, gradesSubstanceLive } from "./record.js";
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

console.log(`=== live-take promotion rules: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — a throttle is waited out and a derived fault is not demanded of the live take" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
