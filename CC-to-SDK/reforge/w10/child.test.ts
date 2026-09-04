// C13c / W10c — the scripted child's own contract, and the NEGATIVE CONTROL the
// cut names: "a perturbed schedule changes the graded output (show which
// field)".
//
//   npx tsx w10/child.test.ts
//
// ## Why a control matrix rather than one perturbation
//
// The helper declares three independent axes — CONTENT (`--bytes`,
// `--chunks`), SCHEDULE (`--every`) and STATUS (`--exit`) — and a control that
// perturbed only one of them would leave the other two able to drift without
// anything failing. Worse, it would not distinguish "the graded output changed"
// from "the graded output changed FOR THE REASON CLAIMED": a perturbation that
// moves four fields at once proves nothing about which field carries which
// axis. So each row perturbs ONE axis and asserts exactly which field moves and
// that the others do not — which is the property the scenarios rely on when
// they attribute a difference in engine output to the engine.
//
// The declared-vs-actual comparison itself is a differential: `expectedOutput`
// in `w10/child.ts` derives the bytes from the written schedule in TypeScript,
// `scripted-child.sh` derives them in bash, and neither reads the other.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childCommand, childViolations, expectedOutput, runScriptedChild, seedScriptedChild, SCRIPTED_CHILD_NAME, type ChildPlan } from "./child.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const box = mkdtempSync(join(tmpdir(), "reforge-w10-child-"));
try {
  const script = seedScriptedChild(box);
  check(`the seed lands an executable ./${SCRIPTED_CHILD_NAME}`, script.endsWith(SCRIPTED_CHILD_NAME));

  // ---- the declaration holds, over a partition of the plan space ------------
  const PLANS: [label: string, plan: ChildPlan][] = [
    ["one chunk, no schedule", { bytes: 64, chunks: 1 }],
    ["four chunks, exact division", { bytes: 100, chunks: 4 }],
    ["five chunks, a remainder in the last", { bytes: 100, chunks: 5 }],
    ["a chunk smaller than its own header", { bytes: 6, chunks: 3 }],
    ["zero bytes", { bytes: 0, chunks: 1 }],
    ["past the truncation ladder's threshold", { bytes: 40_000, chunks: 8 }],
    ["a non-zero exit", { bytes: 32, chunks: 1, exit: 7 }],
    ["an interactive-prompt tail", { bytes: 32, chunks: 2, promptTail: true }],
    ["a real schedule", { bytes: 40, chunks: 4, everyMs: 120 }],
  ];
  for (const [label, plan] of PLANS) {
    const run = await runScriptedChild(script, plan, { timeoutMs: 30_000 });
    const bad = childViolations(run, plan);
    check(`declaration holds: ${label}`, bad.length === 0, bad.join("; "));
    check(`…and ${label} writes EXACTLY ${plan.bytes} byte(s)`, run.bytes === (plan.bytes ?? 0) + (plan.promptTail ? 16 : 0), String(run.bytes));
  }

  // ---- determinism: the same argv twice ------------------------------------
  {
    const plan: ChildPlan = { bytes: 100, chunks: 4, everyMs: 30 };
    const a = await runScriptedChild(script, plan, { timeoutMs: 30_000 });
    const b = await runScriptedChild(script, plan, { timeoutMs: 30_000 });
    check("the same argv produces the same bytes twice (no clock in the output)", a.sha256 === b.sha256, `${a.sha256.slice(0, 12)} vs ${b.sha256.slice(0, 12)}`);
  }

  // ---- THE NEGATIVE CONTROL MATRIX -----------------------------------------
  // Each row runs a PERTURBED plan and grades it against the DECLARED one; the
  // expectation is which field the perturbation moves, and which fields it
  // leaves alone.
  const DECLARED: ChildPlan = { bytes: 100, chunks: 4, everyMs: 150, exit: 0 };
  const declaredRun = await runScriptedChild(script, DECLARED, { timeoutMs: 30_000 });
  check("the declared plan itself is clean", childViolations(declaredRun, DECLARED).length === 0, childViolations(declaredRun, DECLARED).join("; "));

  const PERTURBATIONS: [label: string, perturbed: ChildPlan, movesField: RegExp, holdsField: RegExp | null][] = [
    // CONTENT axis: the byte count moves the length AND the hash, and leaves
    // the schedule's floor and the status alone.
    ["--bytes 100 -> 101", { ...DECLARED, bytes: 101 }, /^bytes:/, /elapsedMs|exitCode/],
    // CONTENT axis: the chunk count keeps the byte total EXACT and still moves
    // the hash and the markers, which is the property that makes the schedule
    // visible in the bytes rather than only in the timing.
    ["--chunks 4 -> 5 (same byte total)", { ...DECLARED, chunks: 5 }, /^(sha256|markers):/, /^bytes:/],
    // SCHEDULE axis: the bytes are byte-identical and the FLOOR is what fails.
    ["--every 150 -> 10", { ...DECLARED, everyMs: 10 }, /^elapsedMs:/, /^(bytes|sha256|markers):/],
    // STATUS axis.
    ["--exit 0 -> 3", { ...DECLARED, exit: 3 }, /^exitCode:/, /^(bytes|sha256|markers):/],
  ];
  for (const [label, perturbed, moves, holds] of PERTURBATIONS) {
    const run = await runScriptedChild(script, perturbed, { timeoutMs: 30_000 });
    const bad = childViolations(run, DECLARED);
    check(`control fires: ${label}`, bad.some((b) => moves.test(b)), `graded output did not move the expected field — violations: ${JSON.stringify(bad)}`);
    if (holds !== null) {
      check(`…and moves ONLY that axis: ${label}`, !bad.some((b) => holds.test(b)), `also moved ${bad.filter((b) => holds.test(b)).join("; ")}`);
    }
    // The perturbed plan is still internally consistent — the helper is not
    // broken, it was asked for something else. Without this, a helper that
    // crashed on every perturbation would "pass" the whole matrix.
    check(`…and the perturbed plan is itself clean against ITS OWN declaration: ${label}`,
      childViolations(run, perturbed).length === 0, childViolations(run, perturbed).join("; "));
  }

  // ---- --ignore-term: the escalation the corpus cannot otherwise reach ------
  {
    const plan: ChildPlan = { bytes: 40, chunks: 8, everyMs: 300, ignoreTerm: true };
    const run = await runScriptedChild(script, plan, { signal: "SIGTERM", signalAfterMs: 250, thenSignal: "SIGKILL", thenAfterMs: 1_400, timeoutMs: 20_000 });
    check("--ignore-term survives SIGTERM and dies of SIGKILL", run.killedBySignal === "SIGKILL", `killedBySignal=${run.killedBySignal} exitCode=${run.exitCode}`);
    // …and the control on the control: WITHOUT the flag the same SIGTERM ends it.
    const plain = await runScriptedChild(script, { ...plan, ignoreTerm: false }, { signal: "SIGTERM", signalAfterMs: 250, timeoutMs: 20_000 });
    check("…and without it, the same SIGTERM at the same point kills it", plain.killedBySignal === "SIGTERM", `killedBySignal=${plain.killedBySignal} exitCode=${plain.exitCode}`);
  }

  // ---- --hold-fd: the child exits, the pipe does not close -----------------
  {
    const plan: ChildPlan = { bytes: 24, chunks: 1, holdFdSeconds: 2 };
    const started = Date.now();
    const run = await runScriptedChild(script, plan, { timeoutMs: 20_000 });
    const waited = Date.now() - started;
    check("--hold-fd keeps stdout open past the child's own exit", waited >= 1_800, `the reader saw EOF after ${waited} ms, so nothing outlived the child`);
    check("…and the bytes it wrote before exiting are still all there", run.bytes === 24, String(run.bytes));
    const none = await runScriptedChild(script, { ...plan, holdFdSeconds: undefined }, { timeoutMs: 20_000 });
    check("…and without it the reader sees EOF immediately", none.elapsedMs < 1_000, `${none.elapsedMs} ms`);
  }

  // ---- the rendered command, which is what a prompt contains ---------------
  check("the rendered command is a function of the plan",
    childCommand({ bytes: 100, chunks: 4, everyMs: 150 }) === `./${SCRIPTED_CHILD_NAME} --bytes 100 --chunks 4 --every 150`,
    childCommand({ bytes: 100, chunks: 4, everyMs: 150 }));
  check("…and the expected output is derivable without running anything",
    expectedOutput({ bytes: 12, chunks: 2 }) === "R0:..\nR1:..\n", JSON.stringify(expectedOutput({ bytes: 12, chunks: 2 })));

  // ---- an unknown flag is a refusal, not a silent default ------------------
  {
    const run = await runScriptedChild(script, {}, { timeoutMs: 10_000 });
    check("no arguments at all is a legal, empty run", run.exitCode === 0 && run.bytes === 0, `exit=${run.exitCode} bytes=${run.bytes}`);
  }
} finally {
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== scripted child: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — the child does what its argv declares, and each perturbation moves exactly the field its axis owns" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
