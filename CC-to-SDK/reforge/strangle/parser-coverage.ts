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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTRUMENTED_MODULES } from "./instrument.js";
import { PARTITIONS, LENGTH_CAP_CASES } from "./parser-corpus.js";

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

// The two async entry points, and every abort cause the parity test drives. These
// reach code no `parse` call can: the length cap, the telemetry port, and the
// three ways `parseOrAbort` decides to give up.
const swallow = (): void => {};
for (const { command } of LENGTH_CAP_CASES(10000)) {
  await mod.parseCommandWithEnv(command);
  await mod.parseOrAbort(command, swallow);
}
for (const command of [
  "A=1 cmd",
  "A=1 B=2 cmd",
  "A=1",
  "cmd A=1",
  "A=$(x) cmd",
  "A='v' cmd",
  "export A=1",
  "",
  "ls -la",
  // The two below are here for branches only THIS entry point can reach, because
  // the corpus does not choose the arguments `parseCommandWithEnv` is called with
  // — it is called by the engine, on a command the model wrote.
  //
  // A command whose parse returns null, so the `!rootNode` arm is taken rather
  // than adjudicated. Same string the abort block below hands `parseOrAbort`: a
  // heredoc delimiter carrying a `$` inside double quotes is one of the three
  // shapes the parser refuses to guess about.
  'cat <<"E$F"\nbody\nE$F',
  // A command node whose first child is neither an assignment nor a command name
  // — `A=1 > out` is one `variable_assignment` and one `file_redirect` — which is
  // the only way the environment walk reaches its loop's non-breaking arm.
  "A=1 > out",
]) {
  await mod.parseCommandWithEnv(command);
  await mod.parseOrAbort(command, swallow);
}
// A parse that returns null (a heredoc delimiter the parser refuses to guess
// about) and a parse that THROWS (a caller that passes a non-string with a
// `length`) — upstream's second and third abort causes.
await mod.parseOrAbort('cat <<"E$F"\nbody\nE$F', swallow);
await mod.parseOrAbort({ length: 5 }, swallow);
await mod.parseCommandWithEnv({ length: 5 });

console.log(`PASS — drove the instrumented shell-parser over ${parsed} partition case(s) plus the async entry points and all three abort causes`);
