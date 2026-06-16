import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface ProbeResult {
  messages: SDKMessage[];
  result: any;
  systemInit: any;
}

// Runs a single SDK query to completion, collecting the message stream.
// Defaults to non-interactive, bounded runs suitable for parity probes.
export async function runProbe(
  prompt: string,
  options: Record<string, unknown> = {},
): Promise<ProbeResult> {
  const messages: SDKMessage[] = [];
  let result: any;
  let systemInit: any;
  for await (const m of query({
    prompt,
    options: { permissionMode: "bypassPermissions", maxTurns: 6, ...options },
  })) {
    messages.push(m);
    if (m.type === "system" && (m as any).subtype === "init") systemInit = m;
    if ("result" in m) result = m;
  }
  return { messages, result, systemInit };
}

// Convenience: stringify a value compactly for probe logs.
export function brief(v: unknown, max = 600): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > max ? s.slice(0, max) + "…" : String(s);
}
