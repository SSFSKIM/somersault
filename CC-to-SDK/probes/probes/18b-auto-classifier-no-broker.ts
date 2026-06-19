// Probe 18b — DECISIVE: does auto-mode's AI classifier decide permissions when NO human/broker is available?
// Probe 18 always supplied a canUseTool callback, which may SHORT-CIRCUIT the classifier (the SDK routes
// uncovered tools to your callback instead of invoking the auto-mode model). 18b removes every other decider:
//   • NO canUseTool callback at all
//   • settingSources: []  → no local ~/.claude allow-rules (closes the "my Bash settings auto-allow it" confound)
// With both removed, the ONLY thing that can approve a mutation headlessly is an in-engine classifier.
//
// PREDICTION TABLE (benign Edit of note.txt):
//   default + no broker + clean settings → mutation DENIED (nothing can approve it) → file UNCHANGED
//   auto    + no broker + clean settings → if classifier LIVE: file CHANGED (classifier approved, no human)
//                                          if classifier DORMANT: file UNCHANGED (auto ≡ default)
//   bypassPermissions                    → file CHANGED (positive control: blanket allow)
// Smoking gun = auto CHANGES a file that default REFUSES, with no human in the loop.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

type Op = { key: string; prompt: string; changed: (dir: string) => boolean };
const OPS: Op[] = [
  { key: "edit-benign", prompt: "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.",
    changed: (d) => existsSync(join(d, "note.txt")) && readFileSync(join(d, "note.txt"), "utf8").includes("CHANGED") },
  { key: "write-new",   prompt: "Create a new file out.txt containing the text hello. Do nothing else.",
    changed: (d) => existsSync(join(d, "out.txt")) },
  { key: "bash-rm",     prompt: "Run exactly this bash command and nothing else: rm disposable.txt",
    changed: (d) => !existsSync(join(d, "disposable.txt")) },
];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe18b-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "disposable.txt"), "delete me\n");
  return dir;
}

// NO canUseTool. settingSources:[]. Whatever decides allow/deny is internal to the engine.
async function cell(mode: string, op: Op) {
  const dir = freshDir();
  const toolsRun: string[] = []; const denials: string[] = [];
  let result: any, err: string | undefined;
  try {
    for await (const m of query({ prompt: op.prompt, options: {
      model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any,
      settingSources: [] as any,   // no local allow-rules
      // intentionally NO canUseTool
    } })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if (m.type === "user")
        for (const b of (m as any).message?.content ?? [])
          if (b?.type === "tool_result" && typeof b.content === "string" && /permission|denied|not allowed|requires/i.test(b.content))
            denials.push(brief(b.content, 80));
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  return { changed: op.changed(dir), toolsRun: [...new Set(toolsRun)], denials, subtype: result?.subtype, err };
}

console.log("=== PROBE 18b — auto classifier WITHOUT a broker, clean settings ===  model:", MODEL);
console.log("(NO canUseTool, settingSources:[] → only an in-engine classifier could approve a mutation)\n");

const MODES = ["default", "auto", "dontAsk", "bypassPermissions"];
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
      `  subtype:${r1.subtype}${r1.denials.length || r2.denials.length ? "  denialMsg:" + brief(r1.denials[0] ?? r2.denials[0], 70) : ""}` +
      `${r1.err || r2.err ? "  ERR:" + brief(r1.err ?? r2.err, 70) : ""}`,
    );
  }
  console.log("");
}

console.log("========================= VERDICT =========================");
const det = (a: boolean[]) => (a.every((x) => x) ? "CHANGED" : a.every((x) => !x) ? "blocked" : "FLAKY");
console.log("  op".padEnd(16), MODES.map((m) => m.padEnd(10)).join(" "));
for (const op of OPS)
  console.log("  " + op.key.padEnd(14), MODES.map((m) => det(changedMap[m][op.key]).padEnd(10)).join(" "));

const liveOps = OPS.filter((op) => det(changedMap.default[op.key]) === "blocked" && det(changedMap.auto[op.key]) === "CHANGED");
const autoEqDefault = OPS.every((op) => det(changedMap.default[op.key]) === det(changedMap.auto[op.key]));
console.log("\nDecision:");
if (liveOps.length) {
  console.log(`  → CLASSIFIER LIVE HEADLESS. With no human/broker, auto APPROVED & executed where default REFUSED: ${liveOps.map((o) => o.key).join(", ")}`);
  console.log("    ⇒ auto-mode's AI classifier IS reachable through query() — the user's hypothesis holds headlessly.");
} else if (autoEqDefault) {
  console.log("  → CLASSIFIER DORMANT HEADLESS. auto ≡ default with no broker (both blocked the same mutations).");
  console.log("    ⇒ the declared auto-mode classifier does NOT fire through query(); it is bridge-coupled. Headless 'auto' is cosmetic.");
} else {
  console.log("  → INCONCLUSIVE — inspect the table (auto differs from default but not via the blocked→CHANGED signal).");
}
