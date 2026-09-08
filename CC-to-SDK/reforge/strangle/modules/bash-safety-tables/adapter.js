// Graph adapter for C13b's eleven owned Bash flag/effect tables.
//
// `asserted-variable-declarator` evaluates the graph initializer exactly once
// and passes that value here. A healthy adapter structurally compares it with
// the independent owned table, then returns the owned value for every original
// graph consumer. Sabotage performs the same assertion first and perturbs one
// named path, so liveness cannot be satisfied by skipping the assertion.
import { assertStructuredEqual } from "../shared/assert-structured.js";
import { createBashSafetyTables } from "./reference.js";

function cloneStructured(value) {
  if (value instanceof Set) return new Set([...value].map(cloneStructured));
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (Array.isArray(value)) return value.map(cloneStructured);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneStructured(child)]));
  }
  return value;
}

function replaceObjectPath(root, path, replacement) {
  const copy = cloneStructured(root);
  let cursor = copy;
  for (const segment of path.slice(0, -1)) cursor = cursor[segment];
  cursor[path.at(-1)] = replacement;
  return copy;
}

function replaceObjectPathAfterReads(root, path, replacement, healthyReads) {
  const copy = cloneStructured(root);
  let cursor = copy;
  for (const segment of path.slice(0, -1)) cursor = cursor[segment];
  const key = path.at(-1);
  const original = cursor[key];
  let reads = 0;
  Object.defineProperty(cursor, key, {
    configurable: true,
    enumerable: true,
    get: () => reads++ < healthyReads ? original : replacement,
  });
  return copy;
}

function replaceSetMember(root, path, index, replacement) {
  const copy = cloneStructured(root);
  let cursor = copy;
  for (const segment of path) cursor = cursor[segment];
  const members = [...cursor];
  members[index] = replacement;
  const changed = new Set(members);
  if (path.length === 1) copy[path[0]] = changed;
  else {
    let parent = copy;
    for (const segment of path.slice(0, -1)) parent = parent[segment];
    parent[path.at(-1)] = changed;
  }
  return copy;
}

/**
 * One named mutation per table. These are production sabotage definitions, not
 * test helpers: the gate loads them one row at a time and requires the affected
 * behavior to move or to remain dark for its adjudicated scenario population.
 */
export const TABLE_ADAPTER_SPECS = [
  {
    binding: "pL",
    fn: "assertPathArgumentExtractors",
    changedPath: "pL.cd",
    perturbGraph: (value) => replaceObjectPath(value, ["cd"], null),
    sabotageOwned: (value) => replaceObjectPath(value, ["cd"], () => ["__C13B_TABLE_SABOTAGE__"]),
  },
  {
    binding: "Pnn",
    fn: "assertPathEffectDescriptions",
    changedPath: "Pnn.cd",
    perturbGraph: (value) => replaceObjectPath(value, ["cd"], "changed"),
    sabotageOwned: (value) => replaceObjectPath(value, ["cd"], "C13b changed effect phrase"),
  },
  {
    binding: "DP",
    fn: "assertPathEffectKinds",
    changedPath: "DP.cd",
    perturbGraph: (value) => replaceObjectPath(value, ["cd"], "write"),
    sabotageOwned: (value) => replaceObjectPath(value, ["cd"], "write"),
  },
  {
    binding: "xnn",
    fn: "assertPathFlagValidators",
    changedPath: "xnn.mv",
    perturbGraph: (value) => replaceObjectPath(value, ["mv"], null),
    sabotageOwned: (value) => replaceObjectPath(value, ["mv"], () => true),
  },
  {
    binding: "u8e",
    fn: "assertFdFlags",
    changedPath: 'u8e["--help"]',
    perturbGraph: (value) => replaceObjectPath(value, ["--help"], "string"),
    // Bnn spreads this table twice during later module initialization. Let
    // both copies see the healthy value; subsequent reads expose the twin.
    sabotageOwned: (value) =>
      replaceObjectPathAfterReads(value, ["--help"], "string", 2),
  },
  {
    binding: "l_e",
    fn: "assertGrepFlags",
    changedPath: 'l_e["--help"]',
    perturbGraph: (value) => replaceObjectPath(value, ["--help"], "string"),
    // Bnn retains this table under grep, egrep and fgrep, and its assertion
    // traverses each reference once. Change behavior only after those reads.
    sabotageOwned: (value) =>
      replaceObjectPathAfterReads(value, ["--help"], "string", 3),
  },
  {
    binding: "Bnn",
    fn: "assertCommandAllowlist",
    changedPath: 'Bnn.xargs.safeFlags["-I"]',
    perturbGraph: (value) => replaceObjectPath(value, ["xargs", "safeFlags", "-I"], "changed"),
    sabotageOwned: (value) => replaceObjectPath(value, ["xargs", "safeFlags", "-I"], "changed"),
  },
  {
    binding: "oro",
    fn: "assertCommandAllowlistExtension",
    changedPath: 'oro.aki.safeFlags["--help"]',
    perturbGraph: (value) => replaceObjectPath(value, ["aki", "safeFlags", "--help"], "string"),
    sabotageOwned: (value) => replaceObjectPath(value, ["aki", "safeFlags", "--help"], "string"),
  },
  {
    binding: "Ern",
    fn: "assertWrapperValueFlags",
    changedPath: "Ern.env[0]",
    perturbGraph: (value) => replaceSetMember(value, ["env"], 0, "--changed"),
    sabotageOwned: (value) => replaceSetMember(value, ["env"], 0, "--changed"),
  },
  {
    binding: "Crn",
    fn: "assertWrapperCommandFlags",
    changedPath: "Crn.env[0]",
    perturbGraph: (value) => replaceSetMember(value, ["env"], 0, "--changed"),
    sabotageOwned: (value) => replaceSetMember(value, ["env"], 0, "--changed"),
  },
  {
    binding: "Arn",
    fn: "assertWrapperPositionalValidators",
    changedPath: "Arn.chrt",
    perturbGraph: (value) => replaceObjectPath(value, ["chrt"], null),
    sabotageOwned: (value) => replaceObjectPath(value, ["chrt"], () => false),
  },
];

function buildAdapters(dependencies, sabotaged) {
  const owned = createBashSafetyTables(dependencies);
  return Object.fromEntries(
    TABLE_ADAPTER_SPECS.map((spec) => [
      spec.fn,
      (graphValue) => {
        const healthy = assertStructuredEqual(`bash-table-${spec.binding}`, spec.binding, graphValue, owned[spec.binding]);
        return sabotaged ? spec.sabotageOwned(healthy) : healthy;
      },
    ]),
  );
}

export function createBashSafetyTableAdapters(dependencies) {
  return buildAdapters(dependencies, false);
}

export function createBashSafetyTableSabotageAdapters(dependencies) {
  return buildAdapters(dependencies, true);
}
