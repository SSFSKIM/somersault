// Probe 18g — does canUseTool COMPOSE with auto mode on a supported model? (increment-4 crux)
// In auto, the classifier owns the trusted surface; the docs say "explicit ask rules still force a prompt" —
// and headless, a "prompt" == a canUseTool call. So the increment-4 "classifier handles the easy ones, human
// handles the gray zone" UX should fall out of: permissionMode:auto + canUseTool + an `ask` rule. This proves it.
//
// Inline `settings:{permissions:{ask:["Bash(*)"]}}` is a flag-layer rule (composes with settingSources:[]).
// Cells (recording-ALLOW canUseTool, sonnet-4-6):
//   auto + ask=Bash(*) + EDIT  → expect broker SILENT for Edit (classifier auto-approves), edit still happens
//   auto + ask=Bash(*) + ECHO  → expect broker FIRES for Bash (ask rule routes to canUseTool even in auto)
//   auto + no-ask     + ECHO   → expect broker SILENT (classifier approves echo; nothing forces a prompt)
//   default + no-ask  + EDIT   → control: broker FIRES for Edit (default routes mutations to the broker)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-4-6";

type Op = { key: string; prompt: string; executed: (dir: string) => boolean };
const EDIT: Op = { key: "edit", prompt: "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.",
  executed: (d) => existsSync(join(d, "note.txt")) && readFileSync(join(d, "note.txt"), "utf8").includes("CHANGED") };
const ECHO: Op = { key: "echo", prompt: "Run exactly this bash command and nothing else: echo hello-from-probe",
  executed: () => true };

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe18g-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  return dir;
}

async function cell(mode: string, ask: boolean, op: Op) {
  const dir = freshDir();
  const brokerSaw: string[] = []; const toolsRun: string[] = [];
  let result: any, err: string | undefined;
  const opts: Record<string, unknown> = {
    model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any, settingSources: [],
    canUseTool: async (tool: string, inp: any) => { brokerSaw.push(tool); return { behavior: "allow", updatedInput: inp } as any; },
  };
  if (ask) opts.settings = { permissions: { ask: ["Bash(*)"] } };
  try {
    for await (const m of query({ prompt: op.prompt, options: opts as any })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  return { brokerSaw: [...new Set(brokerSaw)], toolsRun: [...new Set(toolsRun)], executed: op.executed(dir), subtype: result?.subtype, err };
}

console.log("=== PROBE 18g — canUseTool × auto composition (sonnet-4-6) ===\n");

const ROWS: Array<{ label: string; mode: string; ask: boolean; op: Op; expect: string }> = [
  { label: "auto + ask:Bash(*) + EDIT", mode: "auto", ask: true, op: EDIT, expect: "broker SILENT (classifier owns cwd edit)" },
  { label: "auto + ask:Bash(*) + ECHO", mode: "auto", ask: true, op: ECHO, expect: "broker FIRES Bash (ask rule)" },
  { label: "auto + no-ask + ECHO",      mode: "auto", ask: false, op: ECHO, expect: "broker SILENT (classifier approves)" },
  { label: "default + no-ask + EDIT",   mode: "default", ask: false, op: EDIT, expect: "broker FIRES Edit (control)" },
];

const fired: Record<string, boolean[]> = {};
for (const row of ROWS) {
  const r1 = await cell(row.mode, row.ask, row.op);
  const r2 = await cell(row.mode, row.ask, row.op);
  const f = [r1.brokerSaw.length > 0, r2.brokerSaw.length > 0];
  fired[row.label] = f;
  console.log(`[${row.label}]`);
  console.log(`   broker fired: ${f[0] ? "YES" : "no"}/${f[1] ? "YES" : "no"}  sawTools:${brief([...new Set([...r1.brokerSaw, ...r2.brokerSaw])])}` +
    `  ranTools:${brief([...new Set([...r1.toolsRun, ...r2.toolsRun])])}  executed:${r1.executed}/${r2.executed}` +
    `${r1.err || r2.err ? "  ERR:" + brief(r1.err ?? r2.err, 60) : ""}`);
  console.log(`   expected: ${row.expect}\n`);
}

console.log("========================= VERDICT =========================");
const det = (a: boolean[]) => (a.every((x) => x) ? "FIRES" : a.every((x) => !x) ? "silent" : "FLAKY");
const editSilent = det(fired["auto + ask:Bash(*) + EDIT"]) === "silent";
const echoAskFires = det(fired["auto + ask:Bash(*) + ECHO"]) === "FIRES";
const echoNoAskSilent = det(fired["auto + no-ask + ECHO"]) === "silent";
console.log(`auto cwd-edit (ask set): broker ${det(fired["auto + ask:Bash(*) + EDIT"])}   [classifier should own it → silent]`);
console.log(`auto echo  (ask set):    broker ${det(fired["auto + ask:Bash(*) + ECHO"])}   [ask rule should route → FIRES]`);
console.log(`auto echo  (no ask):     broker ${det(fired["auto + no-ask + ECHO"])}   [classifier approves → silent]`);
console.log(`default edit (control):  broker ${det(fired["default + no-ask + EDIT"])}\n`);
if (editSilent && echoAskFires && echoNoAskSilent)
  console.log("  → COMPOSES CLEANLY: in auto, the classifier handles the trusted surface (canUseTool silent) and an");
  ;
if (editSilent && echoAskFires && echoNoAskSilent)
  console.log("    `ask` rule routes its tools to canUseTool (human seam). Increment 4 = auto + ask-rules + canUseTool.");
else
  console.log("  → does NOT compose as predicted — inspect rows (ask-rule syntax? classifier overrides ask?).");
