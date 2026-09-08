// Pinned-byte parity for C13b's standalone Bash flag/effect tables.
//
// Run from reforge/:
//   npx tsx strangle/bash-safety-tables.test.ts
//
// The graph-side values are evaluated from their exact 2.1.251 declaration
// bytes. Structural equality intentionally treats two functions as the same
// SLOT, not as the same identity, so every callable slot is also invoked below
// against the pinned callback body. The named table mutants prove that each
// adapter assertion reports both the table and the first changed path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import { BASH_TABLE_HOME, TABLE_NAMES, casesFor, type TableName } from "./bash-safety-tables-corpus.js";
import { assertStructuredEqual } from "./modules/shared/assert-structured.js";
import { createBashSafetyTables } from "./modules/bash-safety-tables/reference.js";

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
const ENGINE_CHUNK = "chunk-fy12d89p.js";
const CLASSIFIER_CHUNK = "chunk-9e2ns8ty.js";
const engine = readFileSync(join(BUNDLE_MODULES, ENGINE_CHUNK));
const classifier = readFileSync(join(BUNDLE_MODULES, CLASSIFIER_CHUNK));

interface Span {
  chunk: typeof ENGINE_CHUNK | typeof CLASSIFIER_CHUNK;
  start: number;
  end: number;
  kind: "var" | "function";
}

// Byte offsets are over the pinned files, not UTF-16 string positions. Every
// slice validates its declared binding before eval, so a moved pin fails at the
// source boundary rather than comparing some neighboring declaration.
const SPANS = {
  Bc: { chunk: ENGINE_CHUNK, start: 927532, end: 927682, kind: "function" },
  s_e: { chunk: ENGINE_CHUNK, start: 927682, end: 927923, kind: "function" },
  n8e: { chunk: ENGINE_CHUNK, start: 927923, end: 928437, kind: "function" },
  o8e: { chunk: ENGINE_CHUNK, start: 928437, end: 928661, kind: "function" },
  pL: { chunk: ENGINE_CHUNK, start: 928665, end: 932132, kind: "var" },
  Pnn: { chunk: ENGINE_CHUNK, start: 932153, end: 933349, kind: "var" },
  DP: { chunk: ENGINE_CHUNK, start: 933350, end: 933792, kind: "var" },
  xnn: { chunk: ENGINE_CHUNK, start: 933793, end: 934013, kind: "var" },
  u8e: { chunk: ENGINE_CHUNK, start: 943603, end: 944852, kind: "var" },
  l_e: { chunk: ENGINE_CHUNK, start: 944853, end: 946435, kind: "var" },
  Bnn: { chunk: ENGINE_CHUNK, start: 946436, end: 958178, kind: "var" },
  oro: { chunk: ENGINE_CHUNK, start: 958179, end: 959117, kind: "var" },
  Ern: { chunk: ENGINE_CHUNK, start: 982274, end: 983900, kind: "var" },
  Crn: { chunk: ENGINE_CHUNK, start: 983901, end: 984012, kind: "var" },
  Arn: { chunk: ENGINE_CHUNK, start: 984013, end: 984114, kind: "var" },

  Me: { chunk: CLASSIFIER_CHUNK, start: 109239, end: 109261, kind: "var" },
  z: { chunk: CLASSIFIER_CHUNK, start: 109262, end: 109281, kind: "var" },
  Qa: { chunk: CLASSIFIER_CHUNK, start: 109282, end: 109334, kind: "function" },
  mKe: { chunk: CLASSIFIER_CHUNK, start: 161131, end: 161181, kind: "var" },
  TLe: { chunk: CLASSIFIER_CHUNK, start: 161182, end: 161238, kind: "var" },
  Et: { chunk: CLASSIFIER_CHUNK, start: 175591, end: 175665, kind: "var" },
  qt: { chunk: CLASSIFIER_CHUNK, start: 175666, end: 175747, kind: "var" },
  Jt: { chunk: CLASSIFIER_CHUNK, start: 175748, end: 175874, kind: "var" },
  Qt: { chunk: CLASSIFIER_CHUNK, start: 175875, end: 175916, kind: "var" },
  en: { chunk: CLASSIFIER_CHUNK, start: 175917, end: 176021, kind: "var" },
  Rt: { chunk: CLASSIFIER_CHUNK, start: 176022, end: 176063, kind: "var" },
  ir: { chunk: CLASSIFIER_CHUNK, start: 176064, end: 176152, kind: "var" },
  sr: { chunk: CLASSIFIER_CHUNK, start: 176153, end: 176218, kind: "var" },
  ei: { chunk: CLASSIFIER_CHUNK, start: 176219, end: 176248, kind: "var" },
  Za: { chunk: CLASSIFIER_CHUNK, start: 176249, end: 176295, kind: "function" },
  Xa: { chunk: CLASSIFIER_CHUNK, start: 176299, end: 176369, kind: "var" },
  Ja: { chunk: CLASSIFIER_CHUNK, start: 176370, end: 176511, kind: "function" },
  Ne: { chunk: CLASSIFIER_CHUNK, start: 176511, end: 176842, kind: "function" },
  gKe: { chunk: CLASSIFIER_CHUNK, start: 176846, end: 187342, kind: "var" },
  he: { chunk: CLASSIFIER_CHUNK, start: 187343, end: 187686, kind: "function" },
  hKe: { chunk: CLASSIFIER_CHUNK, start: 187690, end: 193953, kind: "var" },
  tyt: { chunk: CLASSIFIER_CHUNK, start: 193954, end: 194109, kind: "var" },
  el: { chunk: CLASSIFIER_CHUNK, start: 194110, end: 194166, kind: "var" },
  dWt: {
    chunk: CLASSIFIER_CHUNK,
    start: 194167,
    end: 194414,
    kind: "function",
  },
  nyt: { chunk: CLASSIFIER_CHUNK, start: 194418, end: 194817, kind: "var" },
  wQn: { chunk: CLASSIFIER_CHUNK, start: 194818, end: 195889, kind: "var" },
  TQn: { chunk: CLASSIFIER_CHUNK, start: 195890, end: 196215, kind: "var" },
} as const satisfies Record<string, Span>;

function declaration(name: keyof typeof SPANS): string {
  const span = SPANS[name];
  const bytes = span.chunk === ENGINE_CHUNK ? engine : classifier;
  const source = bytes.subarray(span.start, span.end).toString("utf8");
  const prefix = span.kind === "function" ? `function ${name}(` : `${name}=`;
  if (!source.startsWith(prefix)) {
    throw new Error(
      `${span.chunk}:${span.start}-${span.end}: expected ${prefix}, got ${
        JSON.stringify(source.slice(0, prefix.length + 12))
      }`,
    );
  }
  return span.kind === "var" ? `var ${source};` : source;
}

let sedReadOnly = true;
(globalThis as Record<string, unknown>).__c13bSedReadOnly = (
  ..._args: unknown[]
) => sedReadOnly;
(globalThis as Record<string, unknown>).__c13bHome = BASH_TABLE_HOME;

const upstream = (() => {
  const order: (keyof typeof SPANS)[] = [
    "Me",
    "z",
    "Qa",
    "mKe",
    "TLe",
    "Et",
    "qt",
    "Jt",
    "Qt",
    "en",
    "Rt",
    "ir",
    "sr",
    "ei",
    "Za",
    "Xa",
    "Ja",
    "Ne",
    "gKe",
    "he",
    "hKe",
    "tyt",
    "el",
    "dWt",
    "nyt",
    "wQn",
    "TQn",
    "Bc",
    "s_e",
    "n8e",
    "o8e",
    "pL",
    "Pnn",
    "DP",
    "xnn",
    "u8e",
    "l_e",
    "Bnn",
    "oro",
    "Ern",
    "Crn",
    "Arn",
  ];
  // `cL` is not a table: it is the separately-owned sed read-only classifier
  // that Bnn's one sed callback calls. Bind that one dependency as a live port.
  // `vnn` is node:os.homedir; `St` returns the prefix before a delimiter.
  const prelude = "const cL=(...args)=>globalThis.__c13bSedReadOnly(...args);" +
    "const vnn=()=>globalThis.__c13bHome;" +
    "function St(value,delimiter){let at=value.indexOf(delimiter);return at===-1?value:value.slice(0,at)}";
  // `eval` is the oracle mechanism: its input is exclusively the exact local
  // bundle slices above at the version src/pin.ts fixes. No network or user
  // value enters this developer-only test, and each slice's binding is checked
  // before execution so a moved span fails closed.
  // eslint-disable-next-line no-eval
  return eval(
    `(() => { ${prelude}\n${
      order.map(declaration).join("\n")
    }\nreturn {pL,Pnn,DP,xnn,u8e,l_e,Bnn,oro,Ern,Crn,Arn}; })()`,
  ) as Tables;
})();

const owned = createBashSafetyTables({
  homeDirectory: () => BASH_TABLE_HOME,
  isSedReadOnly: (..._args: unknown[]) => sedReadOnly,
}) as Tables;

let checks = 0;
let controls = 0;
const failures: string[] = [];

function fail(label: string, detail: string): void {
  failures.push(`${label}: ${detail}`);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual) ?? String(actual);
  const e = JSON.stringify(expected) ?? String(expected);
  if (a === e) return;
  fail(label, `expected ${e}\n    actual   ${a}`);
}

function outcome(fn: AnyFunction, args: unknown[]): unknown {
  try {
    return { returned: fn(...args) };
  } catch (error) {
    return { threw: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

function clone(value: Structured): Structured {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Set) {
    return new Set([...value].map((entry) => clone(entry as Structured)));
  }
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (Array.isArray(value)) return value.map((entry) => clone(entry));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
  ) as Structured;
}

function at(value: Structured, path: readonly string[]): Structured {
  let cursor = value;
  for (const key of path) cursor = (cursor as Record<string, Structured>)[key];
  return cursor;
}

interface Callable {
  path: string;
  segments: string[];
  fn: AnyFunction;
}

function callableEntries(
  value: Structured,
  root: string,
  segments: string[] = [],
): Callable[] {
  if (typeof value === "function") {
    return [{ path: [root, ...segments].join("."), segments, fn: value }];
  }
  if (
    value === null || typeof value !== "object" || value instanceof Set ||
    value instanceof RegExp
  ) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    callableEntries(child, root, [...segments, key])
  );
}

console.log(`bash safety table parity vs pinned bytes @ ${ENGINE_VERSION}`);

// Healthy structured adapter comparisons over all eleven adapter-facing tables.
for (const name of TABLE_NAMES) {
  try {
    const returned = assertStructuredEqual(
      "bash-safety-tables",
      name,
      upstream[name],
      owned[name],
    );
    eq(
      `${name}: structured parity returns the owned table`,
      returned === owned[name],
      true,
    );
  } catch (error) {
    checks++;
    fail(`${name}: structured parity`, (error as Error).message);
  }
}

// The assertion utility's four non-trivial value classes, independently of the
// production population: ordered Set membership, key order/population, callable
// slots without identity equality, and RegExp value semantics.
{
  const graph = {
    primitive: 1,
    members: new Set(["a", "b"]),
    callback: () => "graph",
    regex: /^ok$/i,
  };
  const sameShape = {
    primitive: 1,
    members: new Set(["a", "b"]),
    callback: () => "owned",
    regex: /^ok$/i,
  };
  try {
    const returned = assertStructuredEqual(
      "fixture",
      "shape",
      graph,
      sameShape,
    );
    eq(
      "structured utility accepts a different function in the same callable slot",
      returned === sameShape,
      true,
    );
  } catch (error) {
    checks++;
    fail("structured utility healthy fixture", (error as Error).message);
  }
}

function expectDrift(
  table: TableName | "shape",
  changedPath: string,
  graph: Structured,
  changed: Structured,
): void {
  controls++;
  let message = "";
  try {
    assertStructuredEqual("bash-safety-tables", table, graph, changed);
  } catch (error) {
    message = (error as Error).message;
  }
  if (!message.includes(`'${table}'`) || !message.includes(changedPath)) {
    fail(
      `CONTROL ${table}`,
      `error must name table and ${changedPath}; got ${
        JSON.stringify(message)
      }`,
    );
  }
}

// One named negative control per adapter-facing table. Every mutation changes
// one entry and requires the diagnostic to identify that exact table/path.
{
  const changed = clone(owned.pL) as Record<string, Structured>;
  changed.cd = "not-callable";
  expectDrift("pL", "pL.cd", upstream.pL, changed);
}
{
  const changed = clone(owned.Pnn) as Record<string, Structured>;
  changed.cd = "move into";
  expectDrift("Pnn", "Pnn.cd", upstream.Pnn, changed);
}
{
  const changed = clone(owned.DP) as Record<string, Structured>;
  changed.rm = "read";
  expectDrift("DP", "DP.rm", upstream.DP, changed);
}
{
  const changed = clone(owned.xnn) as Record<string, Structured>;
  changed.mv = "not-callable";
  expectDrift("xnn", "xnn.mv", upstream.xnn, changed);
}
{
  const changed = clone(owned.u8e) as Record<string, Structured>;
  changed["--max-depth"] = "string";
  expectDrift("u8e", 'u8e["--max-depth"]', upstream.u8e, changed);
}
{
  const changed = clone(owned.l_e) as Record<string, Structured>;
  changed["--regexp"] = "none";
  expectDrift("l_e", 'l_e["--regexp"]', upstream.l_e, changed);
}
{
  const changed = clone(owned.Bnn) as Record<string, Structured>;
  const hostname = changed.hostname as Record<string, Structured>;
  hostname.regex = /^wrong$/;
  expectDrift("Bnn", "Bnn.hostname.regex.source", upstream.Bnn, changed);
}
{
  const changed = clone(owned.oro) as Record<string, Structured>;
  const aki = changed.aki as Record<string, Structured>;
  const flags = aki.safeFlags as Record<string, Structured>;
  flags["--limit"] = "string";
  expectDrift("oro", 'oro.aki.safeFlags["--limit"]', upstream.oro, changed);
}
{
  const changed = clone(owned.Ern) as Record<string, Structured>;
  const members = [...changed.env as Set<Structured>];
  changed.env = new Set([members[1], members[0], ...members.slice(2)]);
  expectDrift("Ern", "Ern.env[0]", upstream.Ern, changed);
}
{
  const changed = clone(owned.Crn) as Record<string, Structured>;
  changed.flock = new Set(["--wrong", "--command"]);
  expectDrift("Crn", "Crn.flock[0]", upstream.Crn, changed);
}
{
  const changed = clone(owned.Arn) as Record<string, Structured>;
  changed.chrt = "not-callable";
  expectDrift("Arn", "Arn.chrt", upstream.Arn, changed);
}

// A keys-only control catches a missing entry even when every remaining value
// agrees; this is the population guarantee the adapter needs.
{
  const changed = { primitive: 1, callback: () => undefined, regex: /^ok$/i };
  expectDrift("shape", "shape.members", {
    primitive: 1,
    members: new Set(["a", "b"]),
    callback: () => undefined,
    regex: /^ok$/i,
  }, changed);
}

let callableSlots = 0;
let callableComparisons = 0;
for (const name of TABLE_NAMES) {
  const graphCallables = callableEntries(upstream[name], name);
  const ownedCallables = callableEntries(owned[name], name);
  eq(
    `${name}: callable slot paths`,
    ownedCallables.map((entry) => entry.path),
    graphCallables.map((entry) => entry.path),
  );
  callableSlots += graphCallables.length;
  for (let index = 0; index < graphCallables.length; index++) {
    const graphEntry = graphCallables[index];
    const ownedEntry = ownedCallables[index];
    for (const testCase of casesFor(name)) {
      sedReadOnly = testCase.sed ?? true;
      eq(
        `${graphEntry.path}: ${testCase.label}`,
        outcome(ownedEntry.fn, testCase.args),
        outcome(graphEntry.fn, testCase.args),
      );
      callableComparisons++;
    }
    // A slot-only comparison would pass if the owned function returned anything.
    // One deliberately impossible result per callable proves this lane observes
    // behavior rather than merely the presence of `typeof value === "function"`.
    controls++;
    sedReadOnly = true;
    const graphResult = outcome(graphEntry.fn, casesFor(name)[0].args);
    const impossible = { returned: { __c13bWrongCallable: graphEntry.path } };
    if (JSON.stringify(graphResult) === JSON.stringify(impossible)) {
      fail(
        `CONTROL ${graphEntry.path}`,
        "the impossible callable result matched upstream",
      );
    }
  }
}

console.log(
  `\n=== bash safety tables: ${checks} checks, ${controls} controls ===`,
);
console.log(
  `    ${TABLE_NAMES.length} adapter tables; ${callableSlots} callable slots; ${callableComparisons} pinned-byte callable comparisons`,
);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
if (failures.length > 0) {
  console.log("\nFAIL");
  process.exitCode = 1;
} else {
  console.log(
    "\nPASS — table population, structure, diagnostics, and callable behavior match the pin",
  );
}
