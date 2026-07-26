import { resolve } from "node:path";
import type { AgentsRow } from "../fleet/project.js";

export function renderAgents(rows: AgentsRow[], opts: { json: boolean; all: boolean; cwdFilter?: string }): string {
  let out = rows;
  if (opts.cwdFilter) {
    // Both sides, or the filter silently matches nothing: `--cwd` is stored exactly as typed, so a
    // trailing slash or a relative path never equals the absolute cwd the row carries.
    const f = resolve(opts.cwdFilter), pre = f.endsWith("/") ? f : f + "/";   // resolve("/") is "/" — no "//"
    out = out.filter((r) => { const c = resolve(r.cwd); return c === f || c.startsWith(pre); });
  }
  if (!opts.all) out = out.filter((r) => r.state === "working" || r.state === "blocked");
  if (opts.json) return JSON.stringify(out, null, 2);   // extra keys are inert for the poller's .get() reads
  return out.map((r) => `${r.id}  ${r.state.padEnd(8)} ${r.status.padEnd(5)} ${r.name}  ${r.cwd}`
    + `${r.unresponsive ? "  (unresponsive)" : ""}${r.noHumanSeam ? "  ⚠ no human seam" : ""}`).join("\n");
}
