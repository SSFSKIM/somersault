// C13b owned-data adapter controls.
//
//   npx tsx strangle/bash-safety-table-adapters.test.ts
//
// The pinned-byte table oracle proves the owned values are right. This suite
// proves the graph-facing adapter actually performs the promised assertion for
// every table and that each sabotage twin changes its named table rather than
// merely returning some unrelated difference.
import { createBashSafetyTables } from "./modules/bash-safety-tables/reference.js";
import {
  createBashSafetyTableAdapters,
  createBashSafetyTableSabotageAdapters,
  TABLE_ADAPTER_SPECS,
} from "./modules/bash-safety-tables/adapter.js";

let checks = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  checks++;
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const independentCopy = (value: any): any => {
  if (value instanceof Set) return new Set([...value].map(independentCopy));
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (Array.isArray(value)) return value.map(independentCopy);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, independentCopy(child)]));
  }
  return value;
};

const OBSERVE_NAMED_BEHAVIOR: Record<string, (value: any) => unknown> = {
  pL: (value) => value.cd([]),
  Pnn: (value) => value.cd,
  DP: (value) => value.cd,
  xnn: (value) => value.mv(["-f"]),
  u8e: (value) => [value["--help"], value["--help"], value["--help"]],
  l_e: (value) => [
    value["--help"],
    value["--help"],
    value["--help"],
    value["--help"],
  ],
  Bnn: (value) => value.xargs.safeFlags["-I"],
  oro: (value) => value.aki.safeFlags["--help"],
  Ern: (value) => [...value.env],
  Crn: (value) => [...value.env],
  Arn: (value) => value.chrt("42"),
};

const deps = { homeDirectory: () => "/home/reforge", isSedReadOnly: () => true };
// The real graph evaluates a different initializer. Clone the fixture so this
// test does not accidentally hand the adapter its own exported singleton.
const graph = independentCopy(createBashSafetyTables(deps)) as Record<string, unknown>;
const healthy = createBashSafetyTableAdapters(deps);
const sabotage = createBashSafetyTableSabotageAdapters(deps);

for (const spec of TABLE_ADAPTER_SPECS) {
  const graphValue = graph[spec.binding];
  const ownedValue = healthy[spec.fn](graphValue);
  check(`${spec.binding}: healthy adapter selects an independent owned value`, ownedValue !== graphValue);

  let stale = "";
  try {
    healthy[spec.fn](spec.perturbGraph(graphValue));
  } catch (error) {
    stale = String((error as Error).message);
  }
  check(
    `${spec.binding}: a perturbed graph entry fires this adapter's assertion`,
    stale.includes(`table '${spec.binding}'`) && stale.includes(spec.changedPath),
    stale.split("\n")[0],
  );

  const observe = OBSERVE_NAMED_BEHAVIOR[spec.binding];
  check(`${spec.binding}: test observes ${spec.changedPath}`, typeof observe === "function");
  if (typeof observe !== "function") continue;
  const sabotaged = sabotage[spec.fn](graphValue);
  check(
    `${spec.binding}: sabotage changes named behavior at ${spec.changedPath}`,
    JSON.stringify(observe(sabotaged)) !== JSON.stringify(observe(ownedValue)),
  );
}

// u8e and l_e are dependencies of the later Bnn initializer. Their semantic
// twins must survive Bnn's healthy assertion rather than turning a named table
// sabotage into an unrelated module-startup crash before any scenario runs.
{
  const sabotagedFdFlags = sabotage.assertFdFlags(graph.u8e);
  const dependent = independentCopy(graph.Bnn) as any;
  dependent.fd.safeFlags = { ...sabotagedFdFlags };
  dependent.fdfind.safeFlags = { ...sabotagedFdFlags };
  let accepted = true;
  try {
    healthy.assertCommandAllowlist(dependent);
  } catch {
    accepted = false;
  }
  check("u8e sabotage survives both downstream Bnn spreads", accepted);
}
{
  const sabotagedGrepFlags = sabotage.assertGrepFlags(graph.l_e);
  const dependent = independentCopy(graph.Bnn) as any;
  dependent.grep.safeFlags = sabotagedGrepFlags;
  dependent.egrep.safeFlags = sabotagedGrepFlags;
  dependent.fgrep.safeFlags = sabotagedGrepFlags;
  let accepted = true;
  try {
    healthy.assertCommandAllowlist(dependent);
  } catch {
    accepted = false;
  }
  check("l_e sabotage survives all three downstream Bnn references", accepted);
}

console.log(`=== Bash safety table adapters: ${checks} check(s) ===`);
for (const failure of failures) console.log(`  FAIL — ${failure}`);
console.log(failures.length === 0 ? "PASS — every table assertion and named sabotage is live" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
