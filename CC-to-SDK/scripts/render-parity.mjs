import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS } from "./parity-areas.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs/parity");
const DATA = join(DIR, "data");
const EMOJI = { provided: "✅", configurable: "🔧", build: "🏗", "not-possible": "🚫", unknown: "❔" };

const rows = [];
for (const f of readdirSync(DATA)) if (f.endsWith(".json"))
  rows.push(...JSON.parse(readFileSync(join(DATA, f), "utf8")));
rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

const cell = (s = "") => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const rowLine = (r) =>
  `| ${r.id} | ${cell(r.feature)} | ${EMOJI[r.verdict]} ${r.verdict} | ${cell(r.sdkSurface || "—")} | ${cell(r.bridge)} | P${r.targetPhase} | ${r.confidence} | ${r.snapshot} |`;
const HEAD =
  "| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |\n|---|---|---|---|---|---|---|---|";

// Per-area files
for (const area of AREAS) {
  const ar = rows.filter((r) => r.area === area);
  if (!ar.length) continue;
  writeFileSync(join(DIR, `${area}.md`), `# Parity — ${area}\n\n${HEAD}\n${ar.map(rowLine).join("\n")}\n`);
}

// Tallies
const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
const tallyTable = Object.entries(EMOJI).map(([k, e]) => `| ${e} ${k} | ${tally[k] || 0} |`).join("\n");

// 43-area summary
const summary = AREAS.map((a) => {
  const ar = rows.filter((r) => r.area === a);
  const t = {};
  for (const r of ar) t[r.verdict] = (t[r.verdict] || 0) + 1;
  const dom = Object.entries(t).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "—";
  return `| ${a} | ${ar.length} | ${EMOJI[dom] || ""} ${dom} |`;
}).join("\n");

const verified = rows.filter((r) => r.confidence === "verified").length;

writeFileSync(join(DIR, "INDEX.md"),
`# CC → Agent SDK Parity Map — Index

Total rows: **${rows.length}**. Verified (live SDK): **${verified}**. Generated from \`docs/parity/data/*.json\` via \`scripts/render-parity.mjs\` — do not hand-edit the tables; edit the JSON and re-render.

**Navigation:** [methodology](./methodology.md) · [roadmap](./roadmap.md) · [since-February delta](./since-february.md) · [SDK surface](./_sdk-surface.md) · [current-harness surface](./_current-surface.md)

## Verdict tallies
| verdict | count |
|---|---|
${tallyTable}

## Per-area summary
| area | rows | dominant verdict |
|---|---|---|
${summary}

## All rows
${HEAD}
${rows.map(rowLine).join("\n")}
`);

// since-february.md
const post = rows.filter((r) => r.snapshot === "post-feb");
writeFileSync(join(DIR, "since-february.md"),
`# Since-February delta

Capabilities present in current Claude Code / the Agent SDK but **absent from the February source snapshot**. Count: **${post.length}**. These were caught by the reconciliation pass (diffing the current surface against the Feb-derived rows), not incidentally.

${HEAD}
${post.map(rowLine).join("\n")}
`);

console.log(`Rendered INDEX + ${new Set(rows.map((r) => r.area)).size} area files + since-february (${post.length} post-Feb rows). ${rows.length} rows, ${verified} verified.`);
