// The CONTRACT-EVIDENCE DRIVER for the owned shell parser (C13a / W10a).
//
//   npx tsx strangle/parser-coverage.ts
//
// `strangle/attest.ts` measures which branches of an owned module ran by
// replaying corpus scenarios against an INSTRUMENTED build and reading what the
// recorder wrote. That answers "did the engine, driving a real recording,
// execute this branch?" — and for the shell parser the answer is no for about
// four fifths of it, because the corpus issues `echo`, `ls`, `chmod` and `pwd`
// while the module is a complete bash grammar.
//
// Those branches are not ungraded. `strangle/parser-parity.test.ts` drives every
// one of them against upstream's own pinned bytes and requires the two trees to
// be identical node for node. This file is how that fact becomes MEASURED rather
// than asserted: it runs the same partition corpus through the same instrumented
// module the scenarios ran through, in its own process, so the recorder writes a
// file of its own and the attestation can tell the two kinds of evidence apart.
//
// ## WHY A SEPARATE PROCESS AND NOT A FUNCTION CALL
//
// The recorder's output directory is baked into the generated module at
// instrumentation time and its file name is the PID. If `attest.ts` imported the
// instrumented module itself, everything this driver executes would land in the
// attestation's own coverage file and be indistinguishable from what the engine
// replays produced — which would report contract evidence as corpus evidence, in
// the direction that overstates. A child process gets its own PID and therefore
// its own file, and `attest.ts` attributes by file.
//
// ## THIS DRIVER DOES NOT ASSERT ANYTHING
//
// Deliberately. It executes; the parity test compares. Two files rather than one
// because they answer different questions and are run at different times, and
// because a driver that also graded would make the attestation depend on a
// comparison it is not the right layer to make. The one thing it does check is
// that the module it loaded is the INSTRUMENTED one — a driver that silently
// exercised the committed module would report contract coverage no recorder ever
// saw, which is the false-green shape this whole mechanism exists to refuse.
//
// ## THE RULE THIS DRIVER LIVES UNDER: NO PRIVATE INPUTS
//
// Every input executed here is also a parity case, and this file writes down no
// input of its own. That is what makes the `contract` state mean what the
// attestation says it means. The two files divide labour — one executes for
// measurement, the other compares against upstream — and the division only holds
// while they run the SAME inputs. A string only the driver had would light up a
// branch in the coverage recorder, be reported as covered by a differential
// contract suite, and have been compared against nothing: evidence-shaped, and
// not evidence. So every input comes from `strangle/parser-corpus.ts`
// (`PARTITIONS`, `LENGTH_CAP_CASES`, `ENTRY_POINT_CASES`,
// `ENTRY_POINT_NON_STRING`), which the parity suite imports the same way. A
// branch that needs a new input to reach it gets that input added THERE.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUMENTED_MODULES } from "./instrument.js";
import { PARTITIONS, LENGTH_CAP_CASES, ENTRY_POINT_CASES, ENTRY_POINT_NON_STRING } from "./parser-corpus.js";

const MODULE = join(INSTRUMENTED_MODULES, "shell-parser", "reference.js");

if (!existsSync(MODULE)) {
  console.log(`FAIL — no instrumented shell-parser at ${MODULE}; run \`npx tsx strangle/build.ts --instrument\` first`);
  process.exit(1);
}
if (!readFileSync(MODULE, "utf8").includes("__cov")) {
  console.log(`FAIL — ${MODULE} carries no branch recorder; it is the committed module, not an instrumented copy, and driving it would record nothing`);
  process.exit(1);
}

const mod = (await import(MODULE)) as {
  getParser: () => { parse: (command: string, budgetMs?: number) => Record<string, unknown> | null };
  parseCommandWithEnv: (command: unknown) => Promise<unknown>;
  parseOrAbort: (command: unknown, record: (event: string, fields: unknown) => void) => Promise<unknown>;
  findCommandNode: (node: unknown, parent: unknown) => unknown;
  commandArgv: (node: unknown) => string[];
};

// The same budget the parity test uses, for the same reason: the parser aborts on
// a wall-clock deadline, and coverage measured under a 50 ms budget would vary
// with machine load — which would make the committed attestation report drift
// for reasons that are not the code's.
const BUDGET_MS = 20000;
const parser = mod.getParser();

let parsed = 0;
for (const partition of PARTITIONS) {
  for (const command of partition.cases) {
    parsed++;
    const tree = parser.parse(command, BUDGET_MS);
    if (tree === null) continue;
    const commandNode = mod.findCommandNode(tree, null);
    if (commandNode !== null) mod.commandArgv(commandNode);
  }
}

// The two async entry points, over the corpus's own entry-point lists. These reach
// code no `parse` call can: the environment walk, the length cap's two different
// answers, the telemetry port, and the three ways `parseOrAbort` decides to give
// up. Every string below is a parity case; see the rule in this file's header.
const swallow = (): void => {};
let driven = 0;
for (const { command } of LENGTH_CAP_CASES(10000)) {
  driven++;
  await mod.parseCommandWithEnv(command);
  await mod.parseOrAbort(command, swallow);
}
for (const command of ENTRY_POINT_CASES) {
  driven++;
  await mod.parseCommandWithEnv(command);
  await mod.parseOrAbort(command, swallow);
}
// The parse that THROWS — a caller that passes a non-string with a `length`. It is
// upstream's third abort cause on `parseOrAbort` and the catch arm on
// `parseCommandWithEnv`, and no string reaches either.
driven++;
await mod.parseOrAbort(ENTRY_POINT_NON_STRING, swallow);
await mod.parseCommandWithEnv(ENTRY_POINT_NON_STRING);

console.log(`PASS — drove the instrumented shell-parser over ${parsed} partition case(s) and ${driven} entry-point case(s), every one of them a parity case`);
