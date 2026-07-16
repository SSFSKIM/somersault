import { DEFAULTS, type HarnessConfig } from "./types.js";

// Workflow needs its launch tool AND the async-retrieval loop allowlisted: the launch returns
// async_launched + a taskId, and the result comes back only through TaskOutput (probe 36 — the model
// ToolSearch-loads TaskOutput on demand, but an un-allowlisted call would stall on permissions).
export const WORKFLOW_TOOLS = ["Workflow", "TaskOutput", "TaskGet", "TaskList"];

export interface ResolvedTools {
  tools: { type: "preset"; preset: "claude_code" } | string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  toolAliases?: Record<string, string>;
}

export function resolveTools(config: HarnessConfig): ResolvedTools {
  const tools = (config.toolPreset ?? "claude_code") === "none"
    ? []
    : { type: "preset" as const, preset: "claude_code" as const };

  const allowedTools = [...(config.allowedTools ?? [])];
  if (config.workflow ?? DEFAULTS.workflow) {
    for (const t of WORKFLOW_TOOLS) if (!allowedTools.includes(t)) allowedTools.push(t);
  }
  const disallowedTools = [...(config.disallowedTools ?? [])];
  for (const d of config.webFetchDomains?.allow ?? []) allowedTools.push(`WebFetch(domain:${d})`);
  for (const d of config.webFetchDomains?.deny ?? []) disallowedTools.push(`WebFetch(domain:${d})`);

  const out: ResolvedTools = { tools };
  if (allowedTools.length) out.allowedTools = allowedTools;
  if (disallowedTools.length) out.disallowedTools = disallowedTools;
  if (config.toolAliases) out.toolAliases = config.toolAliases;
  return out;
}
