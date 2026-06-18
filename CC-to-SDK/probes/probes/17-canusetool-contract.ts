// Probe 17 — canUseTool CONTRACT for the increment-3 chat REPL (spec 2026-06-19).
// Complements probe 15 (which covered acceptEdits/dontAsk). The REPL prompts in `default` mode, so this
// pins, against the INSTALLED SDK (not sdk.d.ts):
//   A) default mode — which tools route to canUseTool, and the FULL `options` payload the callback receives
//      headlessly (is title/displayName/description/suggestions present, or absent because the bridge that
//      renders them is claude.ai-coupled?).
//   B) deny — returning {behavior:"deny",message} skips the tool and the turn still completes (no crash).
//   C) runtime auto→default setPermissionMode switch — canUseTool is NOT consulted in auto, and STARTS being
//      consulted after switching to default mid-session (streaming input).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }) as any;
const optKeys = (o: any) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, k === "signal" ? `[AbortSignal aborted=${(v as any)?.aborted}]` : v]));

// ── A) default mode: record canUseTool calls + dump the options payload ────────────────────────────────
async function probeDefaultPayload() {
  const dir = mkdtempSync(join(tmpdir(), "probe17a-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  const calls: Array<{ tool: string; opts: any }> = [];
  let result: any, err: string | undefined;
  try {
    for await (const m of query({
      prompt: "Do two things in the current directory: (1) read note.txt, (2) run the bash command: echo hi. Then say done.",
      options: {
        model: MODEL, cwd: dir, maxTurns: 8, permissionMode: "default",
        canUseTool: async (tool: string, input: any, opts: any) => { calls.push({ tool, opts: optKeys(opts) }); return { behavior: "allow", updatedInput: input } as any; },
      },
    })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  console.log(`\n[A default] subtype=${result?.subtype}${err ? "  THREW " + err : ""}`);
  console.log(`   canUseTool called for tools: ${brief(calls.map((c) => c.tool))}`);
  for (const c of calls) console.log(`   • ${c.tool} → options keys: ${brief(Object.keys(c.opts))}\n     payload: ${brief(c.opts, 500)}`);
  return calls;
}

// ── B) default mode: DENY one tool, confirm the turn still completes ────────────────────────────────────
async function probeDeny() {
  const dir = mkdtempSync(join(tmpdir(), "probe17b-"));
  const seen: string[] = [];
  let result: any, err: string | undefined;
  try {
    for await (const m of query({
      prompt: "Run the bash command: echo hi. Then say done.",
      options: {
        model: MODEL, cwd: dir, maxTurns: 6, permissionMode: "default",
        canUseTool: async (tool: string, input: any) => {
          seen.push(tool);
          if (tool === "Bash") return { behavior: "deny", message: "User denied Bash" } as any;
          return { behavior: "allow", updatedInput: input } as any;
        },
      },
    })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  console.log(`\n[B deny] subtype=${result?.subtype}${err ? "  THREW " + err : ""}  canUseTool saw: ${brief([...new Set(seen)])}`);
  console.log(`   → deny path ${err ? "CRASHED" : "completed cleanly"} (turn resolved with subtype=${result?.subtype})`);
  return { subtype: result?.subtype, err };
}

// ── C) runtime auto→default switch on a streaming session ──────────────────────────────────────────────
function makeInput() {
  const q: any[] = []; let wake: (() => void) | null = null; let closed = false;
  return {
    push(m: any) { q.push(m); wake?.(); wake = null; },
    close() { closed = true; wake?.(); wake = null; },
    async *[Symbol.asyncIterator]() { while (true) { while (q.length) yield q.shift(); if (closed) return; await new Promise<void>((r) => { wake = r; }); } },
  };
}
async function probeRuntimeSwitch() {
  const dir = mkdtempSync(join(tmpdir(), "probe17c-"));
  const byPhase: Record<number, string[]> = { 0: [], 1: [] };
  let phase = 0, result0: any, result1: any, err: string | undefined;
  const input = makeInput();
  const q = query({
    prompt: input as any,
    options: {
      model: MODEL, cwd: dir, maxTurns: 12, permissionMode: "auto",
      canUseTool: async (tool: string, input: any) => { byPhase[phase].push(tool); return { behavior: "allow", updatedInput: input } as any; },
    },
  });
  input.push(userTurn("Run the bash command: echo one. Then say done."));
  try {
    for await (const m of q as any) {
      if (m.type === "result") {
        if (phase === 0) {
          result0 = m; phase = 1;
          await (q as any).setPermissionMode("default");
          input.push(userTurn("Now run the bash command: echo two. Then say done."));
        } else { result1 = m; input.close(); }
      }
    }
  } catch (e: any) { err = e.message; }
  console.log(`\n[C runtime switch] phase0(auto) subtype=${result0?.subtype} · phase1(default) subtype=${result1?.subtype}${err ? "  THREW " + err : ""}`);
  console.log(`   canUseTool in AUTO phase:    ${brief(byPhase[0])}  (expect EMPTY — auto bypasses broker)`);
  console.log(`   canUseTool in DEFAULT phase: ${brief(byPhase[1])}  (expect Bash — switch routed through broker)`);
  return { auto: byPhase[0], def: byPhase[1] };
}

console.log("=== PROBE 17 canUseTool contract (increment-3 chat REPL) ===  model:", MODEL);
const a = await probeDefaultPayload();
const b = await probeDeny();
const c = await probeRuntimeSwitch();

console.log("\n--- VERDICT (maps to spec §'Live-probe gate') ---");
console.log(`1. default consults broker for: ${brief([...new Set(a.map((x) => x.tool))])}`);
const hints = a.flatMap((x) => Object.keys(x.opts)).filter((k) => ["title", "displayName", "description", "suggestions"].includes(k));
console.log(`2. UI hints present headlessly: ${hints.length ? brief([...new Set(hints)]) : "NONE — dialog MUST reconstruct from toolName+input"}`);
console.log(`3. return shapes accepted: allow(updatedInput) ✓ ; deny(message) → ${b.err ? "ERROR " + b.err : "OK (subtype=" + b.subtype + ")"}`);
console.log(`4+5. auto→default switch — auto consulted: ${c.auto.length ? "YES (unexpected)" : "NO ✓"} ; default consulted: ${c.def.length ? "YES ✓ (" + brief(c.def) + ")" : "NO (unexpected)"}`);
