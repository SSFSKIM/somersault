// Probe 18d — CORRECTION of 18/18b/18c. Those ran auto mode on claude-haiku-4-5, which the docs explicitly
// list as UNSUPPORTED for auto mode (supported: Opus 4.6+ or Sonnet 4.6 on the Anthropic API). An unmet
// requirement makes auto mode silently UNAVAILABLE → the session falls back to default — which is exactly the
// "auto ≡ default" null result 18/18b/18c reported. So those probes tested a fallback, not auto mode.
// Engine gate is fine: bundled native claude binary is v2.1.178 (≥ v2.1.83 required).
//
// This re-runs the decisive test on a SUPPORTED model (claude-sonnet-4-6), NO canUseTool, settingSources:[]
// (so default genuinely BLOCKS — only auto's classifier path could approve). Per the docs' auto decision
// order, "file edits in your working directory are auto-approved" by the classifier path. So:
//   edit-benign (cwd):  auto → CHANGED (classifier auto-approves cwd edit)   default → blocked   ⇒ DISCRIMINATOR
//   bash-rm (pre-existing file): docs say "destroying files that existed before the session" is BLOCKED by
//                                the classifier → auto blocks too, BUT the denial WORDING should differ from
//                                default's "you haven't granted permission" (classifier/safety language) —
//                                a second, independent signal that auto mode is ACTIVE vs fell-back.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-4-6";   // SUPPORTED for auto mode (unlike the haiku used in 18/18b/18c)

type Op = { key: string; prompt: string; changed: (dir: string) => boolean };
const OPS: Op[] = [
  { key: "edit-benign", prompt: "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.",
    changed: (d) => existsSync(join(d, "note.txt")) && readFileSync(join(d, "note.txt"), "utf8").includes("CHANGED") },
  { key: "bash-rm",     prompt: "Run exactly this bash command and nothing else: rm disposable.txt",
    changed: (d) => !existsSync(join(d, "disposable.txt")) },
];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe18d-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "disposable.txt"), "delete me\n");
  return dir;
}

async function cell(mode: string, op: Op) {
  const dir = freshDir();
  const toolsRun: string[] = []; const denials: string[] = []; const autoHints: string[] = [];
  let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: op.prompt, options: {
      model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any, settingSources: [] as any,
      // intentionally NO canUseTool — only an in-engine classifier could approve a mutation
    } })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if (m.type === "user")
        for (const b of (m as any).message?.content ?? [])
          if (b?.type === "tool_result" && typeof b.content === "string" && /permission|denied|not allowed|requires|classif|safety|auto mode|escalat/i.test(b.content))
            denials.push(brief(b.content, 140));
      if (m.type === "system") {
        const s = JSON.stringify(m);
        if (/auto.?mode|classif/i.test(s)) autoHints.push(brief(s, 160));
      }
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  return { changed: op.changed(dir), toolsRun: [...new Set(toolsRun)], denials, autoHints, subtype: result?.subtype, err };
}

console.log("=== PROBE 18d — auto mode on a SUPPORTED model (sonnet-4-6), no broker, clean settings ===");
console.log("model:", MODEL, " engine: v2.1.178\n");

const MODES = ["default", "auto", "bypassPermissions"];
const changedMap: Record<string, Record<string, boolean[]>> = {};

for (const mode of MODES) {
  changedMap[mode] = {};
  console.log(`[mode=${mode}]`);
  for (const op of OPS) {
    const r1 = await cell(mode, op);
    const r2 = await cell(mode, op);
    changedMap[mode][op.key] = [r1.changed, r2.changed];
    console.log(
      `  ${op.key.padEnd(12)} changed:${r1.changed}/${r2.changed}  ranTools:${brief([...new Set([...r1.toolsRun, ...r2.toolsRun])])}` +
      `  subtype:${r1.subtype}`,
    );
    const d = r1.denials[0] ?? r2.denials[0];
    if (d) console.log(`               denial: ${d}`);
    const h = r1.autoHints[0] ?? r2.autoHints[0];
    if (h) console.log(`               autoHint: ${h}`);
    if (r1.err || r2.err) console.log(`               ERR: ${brief(r1.err ?? r2.err, 120)}`);
  }
  console.log("");
}

console.log("========================= VERDICT =========================");
const det = (a: boolean[]) => (a.every((x) => x) ? "CHANGED" : a.every((x) => !x) ? "blocked" : "FLAKY");
console.log("  op".padEnd(16), MODES.map((m) => m.padEnd(10)).join(" "));
for (const op of OPS)
  console.log("  " + op.key.padEnd(14), MODES.map((m) => det(changedMap[m][op.key]).padEnd(10)).join(" "));

const editAuto = det(changedMap.auto["edit-benign"]);
const editDefault = det(changedMap.default["edit-benign"]);
console.log(`\nDISCRIMINATOR — edit-benign:  default=${editDefault}  auto=${editAuto}`);
if (editDefault === "blocked" && editAuto === "CHANGED")
  console.log("  → AUTO MODE IS REACHABLE HEADLESS (on a supported model). The classifier auto-approved a cwd edit");
  ;
if (editDefault === "blocked" && editAuto === "CHANGED")
  console.log("    with NO human in the loop ⇒ user's hypothesis CONFIRMED; 18/18b/18c were a haiku-fallback artifact.");
else if (editAuto === "blocked" && editDefault === "blocked")
  console.log("  → STILL auto ≡ default even on a supported model ⇒ the SDK query() path does not surface auto mode");
else
  console.log("  → INCONCLUSIVE — inspect rows (esp. denial wording: classifier/safety language ⇒ auto active).");
