// PINNED-BYTE DIFFERENTIAL CONTRACT for the C13b command-classifier core.
//
//   npx tsx strangle/classifier-parity.test.ts
//
// `KTe` is a synchronous classifier over a command string and the bash AST
// produced for that string. It rejects byte/parser ambiguities first, then
// walks the tree while tracking shell variables, substitutions, redirections,
// declaration commands, tests and compound statements. The recorded scenario
// corpus is far narrower than that input domain, so this contract compares the
// owned classifier against the 2.1.251 implementation over C13a's partitioned
// parser corpus plus classifier-specific guard and malformed-tree cases.
//
// THE UPSTREAM SIDE IS UPSTREAM ALL THE WAY DOWN. The classifier body is sliced
// directly from pinned `chunk-9e2ns8ty.js`; its local helpers are evaluated from
// that same slice. Its parse result and `w3` identity come from evaluating pinned
// `chunk-fgwne0fb.js`, not from the owned C13a module. The owned side separately
// consumes C13a's `parseOrAbort` and `PARSE_ABORTED`. Sharing either side's
// helper or sentinel with the other would turn this into a same-implementation
// comparison and hide exactly the seam defect the contract exists to catch.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { LENGTH_CAP_CASES, PARTITIONS } from "./parser-corpus.js";
import {
  PARSE_ABORTED as ownedParseAborted,
  parseOrAbort as ownedParseOrAbort,
} from "./modules/shell-parser/reference.js";
import { createCommandClassifier } from "./modules/command-classifier/reference.js";

const CLASSIFIER_CHUNK = "chunk-9e2ns8ty.js";
const PARSER_CHUNK = "chunk-fgwne0fb.js";
const SCRUB_GATE_CHUNK = "chunk-zjeqf9vh.js";
const BOOLEAN_HELPER_CHUNK = "chunk-5b2g0bc6.js";
const CLASSIFIER_START = 108_945;
const CLASSIFIER_END = 163_205; // exclusive; the final declaration ends at 163204

type ShellNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: (ShellNode | null)[];
};

type ParseResult = ShellNode | symbol | null;
type ClassifierResult =
  | { kind: "simple"; commands: unknown[]; bareAssignmentNames: string[] }
  | {
      kind: "too-complex";
      reason: string;
      differential?: boolean;
      nodeType?: string;
    };

type UpstreamParser = {
  parseOrAbort: (command: unknown) => Promise<ParseResult>;
  parseAborted: symbol;
};

type UpstreamClassifier = (
  command: string,
  parsed: ParseResult,
) => ClassifierResult;

let checks = 0;
const failures: string[] = [];

function fail(label: string, detail: string): void {
  failures.push(`${label}: ${detail}`);
}

function eq(label: string, upstream: unknown, owned: unknown): void {
  checks++;
  const a = JSON.stringify(upstream);
  const b = JSON.stringify(owned);
  if (a === b) return;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  fail(
    label,
    `differs at JSON offset ${at}\n    upstream: ${a.slice(Math.max(0, at - 60), at + 100)}\n    owned:    ${b.slice(Math.max(0, at - 60), at + 100)}`,
  );
}

function mustDiffer(label: string, a: unknown, b: unknown): void {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) return;
  fail(`CONTROL ${label}`, "the deliberately wrong result compared equal");
}

function capture<T>(
  run: () => T,
): { value: T } | { error: string; message: string } {
  try {
    return { value: run() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function derive(source: string, role: string, re: RegExp): string {
  const match = source.match(re);
  if (!match) {
    throw new Error(
      `${role}: shape did not match ${re}; the ${ENGINE_VERSION} pin moved`,
    );
  }
  return match[1];
}

function loadUpstreamParser(): UpstreamParser {
  const source = readFileSync(join(BUNDLE_MODULES, PARSER_CHUNK), "utf8");
  const telemetryName = derive(
    source,
    `${PARSER_CHUNK} telemetry import`,
    /^import\{([A-Za-z_$][\w$]*)\}from"/m,
  );
  const parseAbortedName = derive(
    source,
    `${PARSER_CHUNK} abort sentinel`,
    /var ([A-Za-z_$][\w$]*)=Symbol\("parse-aborted"\)/,
  );
  const parseOrAbortName = derive(
    source,
    `${PARSER_CHUNK} parse-or-abort`,
    /async function ([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*\)\{if\(![A-Za-z_$][\w$]*\)return null;if\([A-Za-z_$][\w$]*\.length>/,
  );
  const body = source
    .replace(/^import\{[^}]*\}from"[^"]*";/m, "")
    .replace(/export\{[^}]*\};?\s*$/, "");

  // The eval is the oracle: these are the pinned module's statements, with only
  // its telemetry edge supplied. Re-expressing the parser in test code would no
  // longer be an upstream side.
  // eslint-disable-next-line no-eval
  return eval(
    `(() => { const ${telemetryName}=()=>{};\n${body}\nreturn {parseOrAbort:${parseOrAbortName},parseAborted:${parseAbortedName}}; })()`,
  ) as UpstreamParser;
}

function loadUpstreamScrubGate(rawValue: "false" | "true"): () => boolean {
  const booleanSource = readFileSync(
    join(BUNDLE_MODULES, BOOLEAN_HELPER_CHUNK),
    "utf8",
  );
  const parseTrueStart = booleanSource.indexOf("function Me(");
  const parseTrueEnd = booleanSource.indexOf("function bo(", parseTrueStart);
  if (parseTrueStart !== 615 || parseTrueEnd !== 757) {
    throw new Error(
      `${BOOLEAN_HELPER_CHUNK}: boolean helper moved from 615-757`,
    );
  }
  const parseTrueDeclaration = booleanSource.slice(
    parseTrueStart,
    parseTrueEnd,
  );

  const scrubSource = readFileSync(
    join(BUNDLE_MODULES, SCRUB_GATE_CHUNK),
    "utf8",
  );
  const stateClassStart = scrubSource.indexOf("class BZn{");
  const stateInitializerStart = scrubSource.indexOf(
    "var JM=new BZn,",
    stateClassStart,
  );
  const scrubGateStart = scrubSource.indexOf(
    "function bu(){",
    stateInitializerStart,
  );
  const scrubGateEnd = scrubSource.indexOf("function X(){", scrubGateStart);
  if (
    stateClassStart !== 4_860 ||
    stateInitializerStart !== 5_402 ||
    scrubGateStart !== 5_536 ||
    scrubGateEnd !== 5_695
  ) {
    throw new Error(
      `${SCRUB_GATE_CHUNK}: subprocess-environment gate moved from its pinned offsets`,
    );
  }
  const stateClass = scrubSource.slice(stateClassStart, stateInitializerStart);
  const scrubGate = scrubSource.slice(scrubGateStart, scrubGateEnd);

  // `Me`, the state class and `bu` are evaluated from their own pinned chunks.
  // Only the comma-separated `JM` declarator is restated so unrelated siblings
  // (whose initializers have effects) do not enter this focused oracle.
  // eslint-disable-next-line no-eval
  const gate = eval(
    `(() => { ${parseTrueDeclaration}\n${stateClass}\nvar JM=new BZn;\n${scrubGate}\nreturn bu; })()`,
  ) as () => boolean;
  const key = "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB";
  const previous = process.env[key];
  process.env[key] = rawValue;
  try {
    gate(); // latch through the pinned boolean parser while the requested mode is set
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  return gate;
}

function loadUpstreamClassifier(
  upstreamParseAborted: symbol,
  upstreamScrubGate: () => boolean,
): UpstreamClassifier {
  const source = readFileSync(join(BUNDLE_MODULES, CLASSIFIER_CHUNK), "utf8");
  if (source.length !== 243_672) {
    throw new Error(
      `${CLASSIFIER_CHUNK}: expected 243672 pinned bytes, got ${source.length}`,
    );
  }
  const startShape =
    'import{homedir as Sa}from"os";var er=new Set(["program","list","pipeline","redirected_statement"])';
  if (source.indexOf(startShape) !== CLASSIFIER_START) {
    throw new Error(
      `${CLASSIFIER_CHUNK}: classifier start moved from ${CLASSIFIER_START}`,
    );
  }
  if (source.slice(CLASSIFIER_END - 12, CLASSIFIER_END) !== "Ht=/\\n\\s*#/;") {
    throw new Error(
      `${CLASSIFIER_CHUNK}: classifier closure end moved from ${CLASSIFIER_END}`,
    );
  }

  const pinnedRegion = source
    .slice(CLASSIFIER_START, CLASSIFIER_END)
    .replace('import{homedir as Sa}from"os";', "");

  // All 86 transitive declarations reached by KTe are defined by pinnedRegion.
  // `Sa`, `w3` and `bu` are its only live imports: native homedir, the sentinel
  // from the PINNED parser instance above, and the PINNED subprocess-env gate.
  // eslint-disable-next-line no-eval
  return eval(`((Sa,w3,bu) => { ${pinnedRegion}\nreturn KTe; })`)(
    homedir,
    upstreamParseAborted,
    upstreamScrubGate,
  ) as UpstreamClassifier;
}

const upstreamParser = loadUpstreamParser();
const upstreamScrubGate = loadUpstreamScrubGate("false");
const upstreamScrubGateEnabled = loadUpstreamScrubGate("true");
const upstreamClassifyCommand = loadUpstreamClassifier(
  upstreamParser.parseAborted,
  upstreamScrubGate,
);
const upstreamClassifyCommandWithScrub = loadUpstreamClassifier(
  upstreamParser.parseAborted,
  upstreamScrubGateEnabled,
);
const ownedClassifyCommand = createCommandClassifier(
  () => false,
) as unknown as UpstreamClassifier;
const ownedClassifyCommandWithScrub = createCommandClassifier(
  () => true,
) as unknown as UpstreamClassifier;
const noTelemetry = (): void => {};

async function compareCommand(
  label: string,
  command: string,
  upstreamClassifier: UpstreamClassifier = upstreamClassifyCommand,
  ownedClassifier: UpstreamClassifier = ownedClassifyCommand,
): Promise<void> {
  const [upstreamParsed, ownedParsed] = await Promise.all([
    upstreamParser.parseOrAbort(command),
    ownedParseOrAbort(command, noTelemetry) as unknown as Promise<ParseResult>,
  ]);
  const upstream = upstreamClassifier(command, upstreamParsed);
  const owned = ownedClassifier(command, ownedParsed);
  eq(label, upstream, owned);
  if (
    upstreamParsed !== null &&
    ownedParsed !== null &&
    typeof upstreamParsed !== "symbol" &&
    typeof ownedParsed !== "symbol"
  ) {
    eq(
      `${label}/same upstream tree`,
      upstream,
      ownedClassifier(command, upstreamParsed),
    );
    eq(
      `${label}/same owned tree`,
      upstreamClassifier(command, ownedParsed),
      owned,
    );
  }
}

console.log(
  `command-classifier parity vs pinned ${ENGINE_VERSION} (${CLASSIFIER_CHUNK} @ ${CLASSIFIER_START}-${CLASSIFIER_END})`,
);

// Pre-parse guards are ordered. Several strings deliberately satisfy a later
// guard too; comparing the exact verdict catches reordering as well as deletion.
const GUARD_CASES: readonly [string, string][] = [
  ["empty", ""],
  ["ASCII whitespace", " \t\n"],
  ["lone high surrogate", "echo \ud800"],
  ["lone low surrogate", "echo \udc00"],
  ["control character", "echo \u0001"],
  ["Unicode no-break space", "echo x"],
  ["backslash escaped space", "echo a\\ b"],
  ["backslash continued line", "echo a\\\nb"],
  ["zsh dynamic directory", "echo ~[name]"],
  ["zsh equals expansion", "=git status"],
  ["zsh numeric range glob", "echo <1-9>"],
  ["brace carrying quote", 'echo {a"b,c}'],
  ["comment bytes are preserved", 'echo ok # {a"b,c}'],
  ["quoted brace is masked", 'echo "{a"'],
];
for (const [label, command] of GUARD_CASES) {
  await compareCommand(`guard/${label}`, command);
}

for (const { label, command } of LENGTH_CAP_CASES(10_000)) {
  await compareCommand(`parse-abort/${label}`, command);
}

// C13a already partitions the model-writable command-string domain. Reusing the
// input table (not either implementation's output helpers) exercises this unit
// over quoting, substitutions, declarations, tests, heredocs, redirects,
// compound statements, byte offsets and deterministic generated recovery cases.
for (const partition of PARTITIONS) {
  if (partition.cases.length === 0) {
    fail(`partition/${partition.name}`, "partition is empty");
    continue;
  }
  for (let index = 0; index < partition.cases.length; index++) {
    await compareCommand(`${partition.name}/${index}`, partition.cases[index]);
  }
}

// `bu` is the closure's one non-pure import. Evaluate the pinned gate in both
// latched states and bind the owned factory to the corresponding boolean; a
// hand-written gate stub on the upstream side would not be an upstream oracle.
const SCRUB_MODE_CASES: readonly [string, string][] = [
  ["for loop", 'for item in a b; do echo "$item"; done'],
  ["while loop", "while true; do echo x; done"],
  ["expanded command name", "$COMMAND arg"],
  ["quoted expanded command name", '"$COMMAND" arg'],
];
for (const [label, command] of SCRUB_MODE_CASES) {
  await compareCommand(
    `subprocess-env-scrub/${label}`,
    command,
    upstreamClassifyCommandWithScrub,
    ownedClassifyCommandWithScrub,
  );
}

// These two malformed roots select KTe's byte-coverage checks directly. A real
// parser should never emit them; the classifier nevertheless owns the boundary
// and must reject skipped source and unconsumed trailing bytes exactly as pinned.
const skippedRoot: ShellNode = {
  type: "program",
  text: "x echo hi",
  startIndex: 0,
  endIndex: 9,
  children: [
    {
      type: "command",
      text: "echo hi",
      startIndex: 2,
      endIndex: 9,
      children: [],
    },
  ],
};
const trailingRoot: ShellNode = {
  type: "program",
  text: "echo hi x",
  startIndex: 0,
  endIndex: 9,
  children: [
    {
      type: "command",
      text: "echo hi",
      startIndex: 0,
      endIndex: 7,
      children: [],
    },
  ],
};
eq(
  "malformed/skipped top-level bytes",
  upstreamClassifyCommand("x echo hi", skippedRoot),
  ownedClassifyCommand("x echo hi", skippedRoot),
);
eq(
  "malformed/trailing top-level bytes",
  upstreamClassifyCommand("echo hi x", trailingRoot),
  ownedClassifyCommand("echo hi x", trailingRoot),
);

// Identity is tested within each side. Passing a fresh same-description symbol
// must not take the parse-abort arm; importing C13a's sentinel is the behavior.
eq(
  "abort sentinel/each side recognises its own identity",
  upstreamClassifyCommand("echo ok", upstreamParser.parseAborted),
  ownedClassifyCommand("echo ok", ownedParseAborted),
);
eq(
  "abort sentinel/fresh symbols are not mistaken for the sentinel",
  capture(() => upstreamClassifyCommand("echo ok", Symbol("parse-aborted"))),
  capture(() => ownedClassifyCommand("echo ok", Symbol("parse-aborted"))),
);
mustDiffer(
  "an always-simple classifier",
  upstreamClassifyCommand(
    "echo $(date)",
    await upstreamParser.parseOrAbort("echo $(date)"),
  ),
  { kind: "simple", commands: [], bareAssignmentNames: [] },
);
mustDiffer(
  "the subprocess-environment scrub gate",
  upstreamClassifyCommand(
    SCRUB_MODE_CASES[0][1],
    await upstreamParser.parseOrAbort(SCRUB_MODE_CASES[0][1]),
  ),
  upstreamClassifyCommandWithScrub(
    SCRUB_MODE_CASES[0][1],
    await upstreamParser.parseOrAbort(SCRUB_MODE_CASES[0][1]),
  ),
);
mustDiffer(
  "the parse-abort branch",
  upstreamClassifyCommand("echo ok", upstreamParser.parseAborted),
  { kind: "simple", commands: [], bareAssignmentNames: [] },
);

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s) across ${checks} checks:`);
  for (const failure of failures.slice(0, 50)) console.error(`  - ${failure}`);
  if (failures.length > 50) console.error(`  ... ${failures.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks} classifier differential checks`);
}
