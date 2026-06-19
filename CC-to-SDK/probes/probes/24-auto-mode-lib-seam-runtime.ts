// Probe 24 — does mature `auto` (the LLM classifier) behave correctly in the chat REPL's lib-Session seam, and
// can it be enabled/REPAIRED at RUNTIME? Grounds increment 10 (bring auto + acceptEdits to cc-harness-chat and
// centralize the auto model-gate in resolveOptions). The chat REPL wires canUseTool via
// resolveOptions→createPermissionGate; resolveOptions just sets options.canUseTool + options.permissionMode, so
// a raw-SDK query with a COUNTING canUseTool faithfully represents that seam.
//
// Instrument: a canUseTool that COUNTS calls (and ALLOWS). Under EFFECTIVE auto the classifier handles
// allow/deny internally and canUseTool is NOT consulted for safe working-dir writes (incr-4: "auto bypasses the
// broker entirely — no pending queued") → 0 calls, file still written. Under default — or auto DEGRADED on an
// unsupported model — a Write routes to canUseTool → ≥1 call.
//
//  P1  (A): auto + SUPPORTED (sonnet-4-6)   → expect 0 calls + file written (classifier allowed silently).
//           ⇒ in the chat REPL under auto, the inline PermissionDialog never fires for safe ops.
//  P2a (B): auto + UNSUPPORTED (haiku-4-5)  → expect ≥1 call ⇒ auto silently DEGRADED to default.
//           ⇒ the model-gate MUST be centralized or "auto" is a lie on the wrong model.
//  P2b (C): runtime — start default+sonnet (turn1 ⇒ called), setPermissionMode("auto"), turn2 ⇒ expect 0 calls.
//           ⇒ auto can be toggled LIVE on an already-supported session.
//  P2c (D): runtime REPAIR — start default+haiku (turn1 ⇒ called), setModel(sonnet)+setPermissionMode(auto),
//           turn2 ⇒ 0 calls? ⇒ an unsupported session can be repaired into EFFECTIVE auto live (Gap C crux).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const SUP = "claude-sonnet-4-6";       // supports auto
const UNSUP = "claude-haiku-4-5";      // does NOT support auto → silent fallback to default (probe 18d)

const freshDir = () => mkdtempSync(join(tmpdir(), "probe24-"));
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const writePrompt = (name: string, word: string) => `Use the Write tool to create a file named ${name} containing exactly the word ${word}. Do nothing else, then reply OK.`;

// minimal async-iterable input queue (mirrors harness Session's streaming-input prompt; from probe 20)
function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}

// ── one-shot cell (Runs A, B) ──────────────────────────────────────────────
async function oneShot(label: string, model: string, mode: string, file: string) {
  const dir = freshDir();
  const calls: string[] = []; let toolUse = false; let result: any; let err: string | undefined;
  try {
    for await (const m of query({ prompt: writePrompt(file, "ALPHA"), options: {
      model, cwd: dir, maxTurns: 4, permissionMode: mode as any, settingSources: [] as any,
      canUseTool: async (tool: string, input: Record<string, unknown>) => { calls.push(tool); return { behavior: "allow", updatedInput: input }; },
    } as any })) {
      const mm = m as any;
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b?.type === "tool_use") toolUse = true;
      if (mm.type === "result") result = mm;
    }
  } catch (e) { err = (e as Error).message; }
  const written = existsSync(join(dir, file));
  console.log(`\n[${label}] model=${model} mode=${mode}`);
  console.log(`   canUseTool calls: ${calls.length} ${brief(calls, 120)} | Write tool_use seen: ${toolUse} | file written: ${written} | result.subtype: ${result?.subtype ?? "-"}${err ? " | ERR: " + err : ""}`);
  return { calls: calls.length, written, toolUse };
}

// ── streaming cell with mid-session control changes (Runs C, D) ────────────
async function streaming(label: string, model: string, startMode: string, steps: { prompt: string; after?: (q: any) => Promise<void> }[]) {
  const dir = freshDir();
  const calls: { phase: number; tool: string }[] = []; let phase = 0; let idx = 0; let err: string | undefined;
  const q = inputQueue();
  const handle = query({ prompt: q.iterable as any, options: {
    model, cwd: dir, maxTurns: 8, permissionMode: startMode as any, settingSources: [] as any,
    canUseTool: async (tool: string, input: Record<string, unknown>) => { calls.push({ phase, tool }); return { behavior: "allow", updatedInput: input }; },
  } as any });
  q.push(userTurn(steps[0].prompt));
  try {
    for await (const m of handle as any) {
      if ((m as any).type === "result") {
        if (steps[idx].after) { try { await steps[idx].after!(handle); } catch (e) { err = "control: " + (e as Error).message; } }
        idx++; phase = idx;
        if (idx < steps.length) q.push(userTurn(steps[idx].prompt)); else q.close();
      }
    }
  } catch (e) { err = (err ? err + " | " : "") + (e as Error).message; }
  const t1 = calls.filter((c) => c.phase === 0).length;
  const t2 = calls.filter((c) => c.phase === 1).length;
  console.log(`\n[${label}] start model=${model} mode=${startMode}`);
  console.log(`   turn1 canUseTool calls: ${t1} | turn2 (after control change) canUseTool calls: ${t2}${err ? " | NOTE: " + err : ""}`);
  return { t1, t2 };
}

console.log("=== PROBE 24 — auto in the lib-Session seam + runtime enable/repair ===");

const A = await oneShot("A · P1 auto+supported", SUP, "auto", "a.txt");
const B = await oneShot("B · P2a auto+UNSUPPORTED", UNSUP, "auto", "b.txt");
const C = await streaming("C · P2b runtime setPermissionMode(auto)", SUP, "default", [
  { prompt: writePrompt("c1.txt", "ONE"), after: async (q) => { await q.setPermissionMode("auto"); } },
  { prompt: writePrompt("c2.txt", "TWO") },
]);
const D = await streaming("D · P2c runtime REPAIR setModel(sup)+setPermissionMode(auto)", UNSUP, "default", [
  { prompt: writePrompt("d1.txt", "ONE"), after: async (q) => { await q.setModel(SUP); await q.setPermissionMode("auto"); } },
  { prompt: writePrompt("d2.txt", "TWO") },
]);

console.log("\n=== VERDICTS ===");
console.log(`P1  auto+supported bypasses broker:   ${A.calls === 0 && A.written ? "YES (0 canUseTool, file written)" : `NO/UNCLEAR (calls=${A.calls}, written=${A.written})`}`);
console.log(`P2a auto+unsupported DEGRADES:         ${B.calls >= 1 ? "YES (canUseTool consulted ⇒ behaving as default)" : `NO/UNCLEAR (calls=${B.calls})`}`);
console.log(`P2b runtime setPermissionMode(auto):   ${C.t1 >= 1 && C.t2 === 0 ? "TAKES EFFECT (gated→silent across turns)" : `UNCLEAR (t1=${C.t1}, t2=${C.t2})`}`);
console.log(`P2c runtime setModel+auto REPAIR:      ${D.t2 === 0 ? "REPAIRS to effective auto (t2=0)" : `does NOT repair (t1=${D.t1}, t2=${D.t2})`}`);
process.exit(0);
