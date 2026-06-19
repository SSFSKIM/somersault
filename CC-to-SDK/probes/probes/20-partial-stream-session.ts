// Probe 20 — partial streaming in the MULTI-TURN streaming-input Session path (the chat REPL's actual seam).
// Probe 12 proved includePartialMessages emits stream_event/text_delta in ONE-SHOT (string prompt) mode.
// The chat REPL drives a long-lived Session whose prompt is an ASYNC-ITERABLE input queue (harness Session).
// This verifies partials still flow in that streaming-input mode and captures the EXACT ordered frame shapes
// the render branch must handle: content_block_start (block.type + index), *_delta (text/thinking/input_json),
// content_block_stop, plus the tool_use→tool_result (running→done) boundary that drives live tool status.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6"; // adaptive thinking + rich streaming (the chat REPL's class of model)
const dir = mkdtempSync(join(tmpdir(), "probe20-"));
writeFileSync(join(dir, "fact.txt"), "The codeword is PINECONE.\n");

// Minimal async-iterable input queue mirroring harness Session's streaming-input prompt (swarm/AsyncQueue).
function inputQueue() {
  const items: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () {
    while (true) {
      if (items.length) { yield items.shift(); continue; }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

const q = inputQueue();
q.push(userTurn(`Read the file fact.txt in ${dir} using the Read tool, then tell me the codeword. Think briefly first.`));

const order: string[] = [];                 // ordered stream_event sub-types (+ block type on start)
const deltaTypes = new Set<string>();
const blockStartTypes = new Set<string>();
let partials = 0, textDeltas = 0, thinkingDeltas = 0, inputJsonDeltas = 0, resultCount = 0;
let toolUseSeen = false, toolResultSeen = false;
let frameSample: any, blockStartSample: any, textDeltaSample: any, toolStartSample: any, blockStopSample: any;

for await (const m of query({ prompt: q.iterable as any, options: {
  model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 6, includePartialMessages: true, effort: "high",
} })) {
  const mm = m as any;
  if (mm.type === "stream_event") {
    partials++;
    const ev = mm.event;
    const t = ev?.type;
    if (t === "content_block_start") {
      const bt = ev?.content_block?.type;
      blockStartTypes.add(bt);
      order.push(`start:${bt}@${ev?.index}`);
      if (!blockStartSample) blockStartSample = ev;
      if (bt === "tool_use" && !toolStartSample) toolStartSample = ev;
    } else if (t === "content_block_delta") {
      const dt = ev?.delta?.type;
      deltaTypes.add(dt);
      if (dt === "text_delta") { textDeltas++; if (!textDeltaSample) textDeltaSample = ev; }
      else if (dt === "thinking_delta") thinkingDeltas++;
      else if (dt === "input_json_delta") inputJsonDeltas++;
    } else if (t === "content_block_stop") {
      order.push(`stop@${ev?.index}`);
      if (!blockStopSample) blockStopSample = ev;
    } else if (t) {
      order.push(t);
    }
    if (!frameSample) frameSample = { type: mm.type, frameKeys: Object.keys(mm), eventKeys: Object.keys(ev ?? {}) };
  }
  if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b?.type === "tool_use") toolUseSeen = true;
  if (mm.type === "user") for (const b of mm.message?.content ?? []) if (b?.type === "tool_result") toolResultSeen = true;
  if (mm.type === "result") { resultCount++; q.close(); } // end after the turn's result → query loop drains
}

console.log("=== PROBE 20 — partial streaming in streaming-input Session path ===  model:", MODEL);
console.log("stream_event frames:", partials, "| result frames:", resultCount);
console.log("block_start types:", brief([...blockStartTypes]));
console.log("delta types:", brief([...deltaTypes]));
console.log("text_delta:", textDeltas, " thinking_delta:", thinkingDeltas, " input_json_delta:", inputJsonDeltas);
console.log("tool_use full block seen:", toolUseSeen, "| tool_result full block seen:", toolResultSeen);
console.log("ordered events (first 30):", brief(order.slice(0, 30), 500));
console.log("frame sample:", brief(frameSample, 240));
console.log("block_start sample:", brief(blockStartSample, 260));
console.log("text_delta sample:", brief(textDeltaSample, 200));
console.log("content_block_stop sample:", brief(blockStopSample, 200));
console.log("tool_use start sample:", brief(toolStartSample, 300));
const pass = partials > 0 && textDeltas > 0 && toolUseSeen && toolResultSeen;
console.log(pass ? "RESULT: PASS — partials flow in streaming-input mode; running→done boundary present" : "RESULT: FAIL");
