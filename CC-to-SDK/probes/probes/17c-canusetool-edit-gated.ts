// Probe 17c — conclusive canUseTool contract using EDIT (which gates in default mode), correcting 17/17b
// which only exercised auto-safe ops (Read, echo-Bash) the broker never sees. Two runs:
//   Run 1 (runtime switch): streaming auto→default, an Edit in each phase. Expect broker SILENT in auto
//          (file still changes), broker FIRES for Edit in default (file changes after allow).
//   Run 2 (deny): default mode, broker DENIES the Edit. Expect broker fires, file is UNCHANGED, turn completes.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }) as any;
function makeInput() {
  const q: any[] = []; let wake: (() => void) | null = null; let closed = false;
  return { push(m: any) { q.push(m); wake?.(); wake = null; }, close() { closed = true; wake?.(); wake = null; },
    async *[Symbol.asyncIterator]() { while (true) { while (q.length) yield q.shift(); if (closed) return; await new Promise<void>((r) => { wake = r; }); } } };
}

// ── Run 1: auto→default runtime switch, Edit in each phase ──────────────────────────────────────────────
async function runtimeSwitch() {
  const dir = mkdtempSync(join(tmpdir(), "probe17c1-"));
  writeFileSync(join(dir, "a.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "b.txt"), "ORIGINAL\n");
  const byPhase: Record<number, string[]> = { 0: [], 1: [] };
  let phase = 0, r0: any, r1: any, err: string | undefined;
  const input = makeInput();
  const q = query({ prompt: input as any, options: {
    model: MODEL, cwd: dir, maxTurns: 12, permissionMode: "auto",
    canUseTool: async (tool: string, inp: any) => { byPhase[phase].push(tool); return { behavior: "allow", updatedInput: inp } as any; },
  } });
  input.push(userTurn("Edit a.txt, replacing ORIGINAL with CHANGED. Then say done."));
  try {
    for await (const m of q as any) {
      if (m.type === "result") {
        if (phase === 0) { r0 = m; phase = 1; await (q as any).setPermissionMode("default"); input.push(userTurn("Edit b.txt, replacing ORIGINAL with CHANGED. Then say done.")); }
        else { r1 = m; input.close(); }
      }
    }
  } catch (e: any) { err = e.message; }
  const a = readFileSync(join(dir, "a.txt"), "utf8").trim(), b = readFileSync(join(dir, "b.txt"), "utf8").trim();
  console.log(`\n[Run1 runtime switch] phase0(auto)=${r0?.subtype} phase1(default)=${r1?.subtype}${err ? " THREW " + err : ""}`);
  console.log(`   AUTO  phase — broker fired for: ${brief(byPhase[0]) || "NOTHING"}  | a.txt = ${a}  (expect: NOTHING fired, a=CHANGED)`);
  console.log(`   DEFAULT phase — broker fired for: ${brief(byPhase[1]) || "NOTHING"}  | b.txt = ${b}  (expect: Edit fired, b=CHANGED)`);
  return { auto: byPhase[0], def: byPhase[1], a, b };
}

// ── Run 2: deny the Edit in default mode ───────────────────────────────────────────────────────────────
async function denyEdit() {
  const dir = mkdtempSync(join(tmpdir(), "probe17c2-"));
  writeFileSync(join(dir, "c.txt"), "ORIGINAL\n");
  const seen: string[] = []; let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: "Edit c.txt, replacing ORIGINAL with CHANGED. Then say done.", options: {
      model: MODEL, cwd: dir, maxTurns: 6, permissionMode: "default",
      canUseTool: async (tool: string, inp: any) => { seen.push(tool); if (tool === "Edit" || tool === "Write") return { behavior: "deny", message: "User denied the edit" } as any; return { behavior: "allow", updatedInput: inp } as any; },
    } })) { if ("result" in m) result = m; }
  } catch (e: any) { err = e.message; }
  const c = readFileSync(join(dir, "c.txt"), "utf8").trim();
  console.log(`\n[Run2 deny] subtype=${result?.subtype}${err ? " THREW " + err : ""}  broker saw: ${brief([...new Set(seen)])}`);
  console.log(`   c.txt = ${c}  (expect: ORIGINAL — deny left the file untouched)`);
  return { seen: [...new Set(seen)], c, subtype: result?.subtype, err };
}

console.log("=== PROBE 17c canUseTool gated-by-Edit (conclusive) ===  model:", MODEL);
const s = await runtimeSwitch();
const d = await denyEdit();

console.log("\n--- VERDICT (supersedes probe 17 §4+5 and §3-deny) ---");
console.log(`auto bypasses broker:        ${s.auto.length === 0 ? "YES ✓" : "NO — fired for " + brief(s.auto)}  (a.txt=${s.a})`);
console.log(`default routes Edit→broker:  ${s.def.includes("Edit") ? "YES ✓" : "NO — fired for " + brief(s.def)}  (b.txt=${s.b})`);
console.log(`runtime auto→default switch: ${s.auto.length === 0 && s.def.includes("Edit") ? "WORKS ✓ (silent in auto, fires after switch)" : "INCONCLUSIVE"}`);
console.log(`deny leaves file untouched:  ${d.seen.includes("Edit") && d.c === "ORIGINAL" ? "YES ✓" : "CHECK — saw " + brief(d.seen) + ", c=" + d.c}`);
