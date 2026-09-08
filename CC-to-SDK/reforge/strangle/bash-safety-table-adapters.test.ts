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

  const observe = spec.observe;
  check(
    `${spec.binding}: sabotage declares an observation at ${spec.changedPath}`,
    typeof observe === "function",
  );
  if (typeof observe !== "function") continue;
  const sabotaged = sabotage[spec.fn](graphValue);
  check(
    `${spec.binding}: sabotage changes named behavior at ${spec.changedPath}`,
    JSON.stringify(observe(sabotaged)) !== JSON.stringify(observe(ownedValue)),
  );
}

console.log(`=== Bash safety table adapters: ${checks} check(s) ===`);
for (const failure of failures) console.log(`  FAIL — ${failure}`);
console.log(failures.length === 0 ? "PASS — every table assertion and named sabotage is live" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
