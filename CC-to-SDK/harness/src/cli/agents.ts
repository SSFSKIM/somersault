import type { AgentsRow } from "../fleet/project.js";

export function renderAgents(rows: AgentsRow[], opts: { json: boolean; all: boolean; cwdFilter?: string }): string {
  let out = rows;
  if (opts.cwdFilter) out = out.filter((r) => r.cwd === opts.cwdFilter || r.cwd.startsWith(opts.cwdFilter + "/"));
  if (!opts.all) out = out.filter((r) => r.state === "working" || r.state === "blocked");
  if (opts.json) return JSON.stringify(out, null, 2);   // extra keys are inert for the poller's .get() reads
  return out.map((r) => `${r.id}  ${r.state.padEnd(8)} ${r.status.padEnd(5)} ${r.name}  ${r.cwd}`
    + `${r.unresponsive ? "  (unresponsive)" : ""}${r.noHumanSeam ? "  ⚠ no human seam" : ""}`).join("\n");
}
