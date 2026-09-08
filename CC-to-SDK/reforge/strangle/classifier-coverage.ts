// The CONTRACT-EVIDENCE DRIVER for the owned command classifier (C13b / W10b).
//
//   npx tsx strangle/classifier-coverage.ts
//
// `strangle/classifier-parity.test.ts` compares this module with the classifier
// evaluated from the pinned bundle. This driver executes the same inputs against
// the instrumented owned copy so `strangle/attest.ts` can measure that contract
// evidence separately from corpus replay coverage. It deliberately makes no
// assertions: the parity suite grades, while this process only records.
//
// Every classifier-specific command or synthetic parse value comes from
// `classifier-corpus.ts`; the parser-domain commands come from
// `parser-corpus.ts`. The driver owns no private input that could light a branch
// without the differential suite comparing it. The sole local checks refuse a
// missing or uninstrumented module, because either would make coverage vacuous.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLASSIFIER_GUARD_CASES,
  MALFORMED_ROOT_CASES,
  SCRUB_ENABLED_CASES,
  SENTINEL_IDENTITY_CASES,
  type ClassifierShellNode,
} from "./classifier-corpus.js";
import { INSTRUMENTED_MODULES } from "./instrument.js";
import {
  PARSE_ABORTED as ownedParseAbortedSentinel,
  parseOrAbort as parseWithOwnedParser,
} from "./modules/shell-parser/reference.js";
import { LENGTH_CAP_CASES, PARTITIONS } from "./parser-corpus.js";

const CLASSIFIER_MODULE = join(
  INSTRUMENTED_MODULES,
  "command-classifier",
  "reference.js",
);
const PARSER_MODULE = join(
  INSTRUMENTED_MODULES,
  "shell-parser",
  "reference.js",
);

if (!existsSync(CLASSIFIER_MODULE)) {
  console.log(
    `FAIL — no instrumented command-classifier at ${CLASSIFIER_MODULE}; run \`npx tsx strangle/build.ts --instrument\` first`,
  );
  process.exit(1);
}
if (!readFileSync(CLASSIFIER_MODULE, "utf8").includes("__cov")) {
  console.log(
    `FAIL — ${CLASSIFIER_MODULE} carries no branch recorder; it is the committed module, not an instrumented copy, and driving it would record nothing`,
  );
  process.exit(1);
}

interface ClassifierResult {
  kind: "simple" | "too-complex";
}
type ParseResult = ClassifierShellNode | symbol | null;
type ClassifyCommand = (
  command: string,
  parsed: ParseResult,
) => ClassifierResult;

const classifierModule = (await import(CLASSIFIER_MODULE)) as {
  createCommandClassifier: (
    isSubprocessEnvironmentScrubbingEnabled: () => boolean,
  ) => ClassifyCommand;
};
// Parse with the same committed C13a implementation the owned parity side uses,
// not its instrumented copy: this process is evidence for command-classifier,
// and must not accidentally credit shell-parser branches. Import the copied
// parser only to obtain the exact sentinel identity captured by the copied
// classifier, then translate that one identity at the boundary.
const instrumentedParserModule = (await import(PARSER_MODULE)) as {
  PARSE_ABORTED: symbol;
};

const classifyCommand = classifierModule.createCommandClassifier(() => false);
const classifyCommandWithScrub = classifierModule.createCommandClassifier(
  () => true,
);
const noTelemetry = (): void => {};

let parsedCases = 0;
async function driveParsedCommand(
  command: string,
  classify: ClassifyCommand = classifyCommand,
): Promise<void> {
  const ownedParsed = (await parseWithOwnedParser(
    command,
    noTelemetry,
  )) as ParseResult;
  const classifierParsed =
    ownedParsed === ownedParseAbortedSentinel
      ? instrumentedParserModule.PARSE_ABORTED
      : ownedParsed;
  classify(command, classifierParsed);
  parsedCases++;
}

for (const [, command] of CLASSIFIER_GUARD_CASES) {
  await driveParsedCommand(command);
}
for (const { command } of LENGTH_CAP_CASES(10_000)) {
  await driveParsedCommand(command);
}
for (const partition of PARTITIONS) {
  for (const command of partition.cases) {
    await driveParsedCommand(command);
  }
}
for (const [, command] of SCRUB_ENABLED_CASES) {
  await driveParsedCommand(command, classifyCommandWithScrub);
}

let directCases = 0;
for (const { command, root } of MALFORMED_ROOT_CASES) {
  classifyCommand(command, root);
  directCases++;
}
for (const { command, input } of SENTINEL_IDENTITY_CASES) {
  if (input === "canonical") {
    classifyCommand(command, instrumentedParserModule.PARSE_ABORTED);
  } else {
    try {
      classifyCommand(command, Symbol("parse-aborted"));
    } catch {
      // A fresh same-description symbol reaches the non-sentinel failure path.
      // The parity suite compares the exact error; this execution-only driver
      // merely lets that path run to completion without aborting its process.
    }
  }
  directCases++;
}

console.log(
  `PASS — drove the instrumented command-classifier over ${parsedCases} parsed case(s) and ${directCases} direct case(s), every one of them a classifier parity case`,
);
