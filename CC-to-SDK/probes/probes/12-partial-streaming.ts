// Probe 12 — PARTIAL-MESSAGE STREAMING + thinking surfacing (P2). Confirms
// includePartialMessages:true emits SDKPartialAssistantMessage frames (type:'stream_event')
// headlessly, captures their shape, and checks whether thinking blocks surface (effort:'high'
// on a thinking-capable model). Part B probes forwardSubagentText for nested subagent transcripts.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6"; // adaptive thinking + rich streaming

// --- Part A: partial messages + thinking blocks ---
let partials = 0;
let partialSample: any;
let thinkingBlocks = 0;
let textDeltas = 0;
const seenStreamEventTypes = new Set<string>();
for await (const m of query({
  prompt: "In 2-3 sentences, reason about why 17 is prime, then state the conclusion.",
  options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 2, includePartialMessages: true, effort: "high" },
})) {
  if ((m as any).type === "stream_event") {
    partials++;
    const ev = (m as any).event;
    if (ev?.type) seenStreamEventTypes.add(ev.type);
    if (ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta") textDeltas++;
    if (!partialSample) partialSample = { type: (m as any).type, eventType: ev?.type, frameKeys: Object.keys(m as any) };
  }
  if (m.type === "assistant")
    for (const b of (m as any).message?.content ?? [])
      if (b?.type === "thinking" || b?.type === "redacted_thinking") thinkingBlocks++;
}
console.log("=== PROBE 12 partial streaming ===  model:", MODEL);
console.log("partial (stream_event) frames:", partials);
console.log("stream_event sub-types seen:", brief([...seenStreamEventTypes]));
console.log("text_delta frames:", textDeltas, "| thinking blocks in assistant msgs:", thinkingBlocks);
console.log("partial sample:", brief(partialSample, 300));

// --- Part B: forwardSubagentText (nested subagent transcript) ---
let subagentParented = 0;
for await (const m of query({
  prompt: "Use the Task tool to launch a general-purpose subagent that replies with the word PINECONE, then tell me you are done.",
  options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 8, forwardSubagentText: true },
})) {
  if ((m.type === "assistant" || m.type === "user") && (m as any).parent_tool_use_id) subagentParented++;
}
console.log("forwardSubagentText — parented subagent msgs:", subagentParented);

const pass = partials > 0 && textDeltas > 0;
console.log(pass ? "RESULT: PASS (partial streaming live)" : "RESULT: FAIL");
