// The contract-evidence driver for C13b's owned Bash flag/effect tables.
//
//   npx tsx strangle/bash-safety-tables-coverage.ts
//
// `bash-safety-tables.test.ts` compares every callable table slot against the
// pinned bundle's own declaration bytes. This driver executes those same inputs
// against the instrumented owned module in a separate process, so attestation
// can credit the resulting branch outcomes to that differential contract rather
// than to the recorded scenario corpus.
//
// The driver deliberately makes no parity assertions: the parity suite grades
// the behavior and this process measures it. It does fail closed when the
// instrumented copy is missing or has no recorder, because driving the committed
// module would produce a false-green contract claim with no coverage evidence.
//
// Every invocation input and dependency result comes from
// `bash-safety-tables-corpus.ts`, the same source the parity suite imports. A
// branch that needs another input must add it there; this driver must not gain a
// private case that pinned-byte parity never compared.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASH_TABLE_HOME, TABLE_NAMES, casesFor, type TableName } from "./bash-safety-tables-corpus.js";
import { INSTRUMENTED_MODULES } from "./instrument.js";

const MODULE = join(INSTRUMENTED_MODULES, "bash-safety-tables", "reference.js");

if (!existsSync(MODULE)) {
  console.log(`FAIL — no instrumented bash-safety-tables at ${MODULE}; run \`npx tsx strangle/build.ts --instrument\` after registering its attestation contract first`);
  process.exit(1);
}
if (!readFileSync(MODULE, "utf8").includes("__cov")) {
  console.log(`FAIL — ${MODULE} carries no branch recorder; it is the committed module, not an instrumented copy, and driving it would record nothing`);
  process.exit(1);
}

type AnyFunction = (...args: any[]) => unknown;
type Structured =
  | null
  | boolean
  | number
  | string
  | RegExp
  | Set<unknown>
  | AnyFunction
  | Structured[]
  | { [key: string]: Structured };
type Tables = Record<TableName, Structured>;

const mod = (await import(MODULE)) as {
  createFileArgumentExtractors: (homeDirectory: () => string) => Structured;
  createSafeCommandTable: (isSedReadOnly: (...args: unknown[]) => boolean) => Structured;
  createBashSafetyTables: (dependencies: {
    homeDirectory: () => string;
    isSedReadOnly: (...args: unknown[]) => boolean;
  }) => Tables;
};

function callableEntries(value: Structured): AnyFunction[] {
  if (typeof value === "function") return [value];
  if (
    value === null || typeof value !== "object" || value instanceof Set ||
    value instanceof RegExp
  ) return [];
  return Object.values(value).flatMap((child) => callableEntries(child));
}

let sedReadOnly = true;
const homeDirectory = (): string => BASH_TABLE_HOME;
const isSedReadOnly = (..._args: unknown[]): boolean => sedReadOnly;

// Execute every exported table factory. `createBashSafetyTables` also composes
// the two specialized factories, but calling each export makes the full owned
// callable surface part of the measured contract rather than relying on that
// implementation detail.
mod.createFileArgumentExtractors(homeDirectory);
mod.createSafeCommandTable(isSedReadOnly);
const tables = mod.createBashSafetyTables({ homeDirectory, isSedReadOnly });

let callableSlots = 0;
let invocations = 0;
const sedStates = new Set<boolean>();
for (const name of TABLE_NAMES) {
  const callables = callableEntries(tables[name]);
  callableSlots += callables.length;
  for (const fn of callables) {
    for (const testCase of casesFor(name)) {
      sedReadOnly = testCase.sed ?? true;
      if (testCase.sed !== undefined) sedStates.add(testCase.sed);
      try {
        fn(...testCase.args);
      } catch {
        // Throwing is an outcome the parity suite compares; keep driving the
        // remaining slots so their branch evidence is not lost with this one.
      }
      invocations++;
    }
  }
}

console.log(
  `PASS — drove 3 instrumented Bash safety-table factories and ${callableSlots} callable slot(s) over ${invocations} shared parity invocation(s); sed dependency states: ${[...sedStates].join(", ")}`,
);
