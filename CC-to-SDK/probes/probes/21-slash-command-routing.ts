// Probe 21 — slash-command routing in the multi-turn streaming-input Session path (the chat REPL's seam).
// Increment 6 (slash commands) must know, BEFORE designing the dispatch model: when "/command" is submitted
// as a PROMPT (not via a dedicated method like Session.compact), does the SDK EXECUTE it (native-command
// handling → a non-conversational result / system frame) or treat it as LITERAL text the model replies to?
// And what is actually in supportedCommands()? Answer decides intercept-local vs pass-through vs hybrid.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-sonnet-4-6";
const dir = mkdtempSync(join(tmpdir(), "probe21-"));
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

function inputQueue() {
  const items: unknown[] = [];
  let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () {
    while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); }
  })();
  return { iterable, push, close };
}

// --- Part A: supportedCommands() — what native commands exist, are our targets among them? ---
{
  const q = inputQueue();
  const Q = query({ prompt: q.iterable as any, options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 1 } });
  let cmds: any[] = [];
  try { cmds = (await (Q as any).supportedCommands?.()) ?? []; } catch (e: any) { console.log("supportedCommands ERR:", e.message); }
  console.log("=== PROBE 21 — slash-command routing ===  model:", MODEL);
  console.log("supportedCommands count:", cmds.length);
  console.log("sample (first 10):", brief(cmds.slice(0, 10).map((c: any) => (c?.name ?? c)), 400));
  console.log("one entry shape:", brief(cmds[0], 220));
  for (const name of ["compact", "model", "context", "resume", "clear", "help", "cost", "init", "exit"]) {
    const hit = cmds.find((c: any) => c?.name === name || c === name || c?.name === "/" + name);
    console.log(`  native /${name}:`, hit ? "YES " + brief(hit?.name ?? hit, 60) : "no");
  }
  q.close();
}

// --- Part B: submit "/command" as a PROMPT — does the SDK execute it or treat it as literal text? ---
// One streaming session; drive the test prompts as sequential turns, attribute frames per turn by result count.
const tests = ["/help", "/compact", "/model", "/context", "/cost", "/status", "/zzznotacommand", "hello there"];
const q = inputQueue();
const Q = query({ prompt: q.iterable as any, options: { model: MODEL, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 2 } });

let idx = 0;
const results: any[] = [];
let cur = { prompt: tests[0], frames: new Set<string>(), sys: new Set<string>(), text: "", subtype: "" };
q.push(userTurn(tests[0]));
for await (const m of Q) {
  const mm = m as any;
  cur.frames.add(mm.type);
  if (mm.type === "system" && mm.subtype) cur.sys.add(mm.subtype);
  if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b?.type === "text") cur.text += b.text;
  if (mm.type === "result") {
    cur.subtype = mm.subtype;
    results.push({ prompt: cur.prompt, subtype: cur.subtype, sys: [...cur.sys], frames: [...cur.frames], text: cur.text.replace(/\n/g, " ").slice(0, 90) });
    idx++;
    if (idx >= tests.length) { q.close(); }
    else { cur = { prompt: tests[idx], frames: new Set(), sys: new Set(), text: "", subtype: "" }; q.push(userTurn(tests[idx])); }
  }
}

console.log("\n--- per-prompt routing (subtype, system subtypes, whether the model produced conversational text) ---");
for (const r of results) {
  const conversational = r.text.trim().length > 0;
  console.log(`  ${JSON.stringify(r.prompt).padEnd(20)} subtype=${r.subtype} sys=[${r.sys.join(",")}] convo=${conversational}  text="${r.text}"`);
}
console.log("\nINTERPRETATION: if a slash command's turn looks like normal conversation (convo=true, no special system");
console.log("subtype) → the SDK does NOT execute it; the REPL must INTERCEPT locally and dispatch to engine ops.");
console.log("If a command yields a distinct system subtype / non-conversational result → the SDK handles it (pass-through).");
