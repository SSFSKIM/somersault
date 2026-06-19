// Probe 18 — IS `auto`-mode's AI permission-classifier reachable headlessly, or does `auto` silently
// degrade to `default`?  The SDK bundle DECLARES an auto-mode model+classifier (CLAUDE_CODE_AUTO_MODE_MODEL,
// CLAUDE_CODE_TWO_STAGE_CLASSIFIER, CLAUDE_CODE_BG_CLASSIFIER_MODEL, engine `lastClassifierRequests`). The
// open question (declared ≠ reachable) is whether that classifier fires through query(), or is coupled to
// claude.ai's remote-control bridge like /assistant + /bridge are.
//
// FALSIFIABLE CONTRAST: the static permission engine is prefix-allowlist based (content-BLIND) — it tends to
// auto-allow `echo` but PROMPT for `cat`/`wc` even though they are read-only. A real AI classifier is
// content-AWARE — it would auto-allow `cat note.txt`/`wc` as read-only-safe and escalate `rm` as destructive.
// So the smoking gun is a read-only-but-not-allowlisted command:
//   • `auto` SILENT where `default` FIRES on `cat`/`wc`  → classifier LIVE headlessly (user's hypothesis holds)
//   • `auto` ≡ `default` on every op                      → classifier DORMANT headlessly (bridge-coupled)
// Each (mode, op) cell runs in an isolated temp dir with a RECORDING-ALLOW broker, 2× for determinism. A final
// DENY pass on `auto` measures the auto-allow surface directly (ops that execute despite a denying broker were
// allowed UPSTREAM of the broker — by a classifier or static rule — never consulting it).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";

// Each op: a single-action prompt + a checker for whether the intended effect actually happened.
type Op = { key: string; prompt: string; effect: (dir: string) => boolean };
const OPS: Op[] = [
  { key: "read",       prompt: "Read the file note.txt and tell me its contents. Do nothing else.",
    effect: () => true /* read has no fs effect; tool-use recorded separately */ },
  { key: "bash-echo",  prompt: "Run exactly this bash command and nothing else: echo hi",
    effect: () => true },
  { key: "bash-cat",   prompt: "Run exactly this bash command and nothing else: cat note.txt",
    effect: () => true },   // read-only, NOT a typical static-allowlist prefix → KEY discriminator
  { key: "bash-wc",    prompt: "Run exactly this bash command and nothing else: wc -l note.txt",
    effect: () => true },   // read-only, NOT allowlisted → KEY discriminator
  { key: "bash-rm",    prompt: "Run exactly this bash command and nothing else: rm disposable.txt",
    effect: (d) => !existsSync(join(d, "disposable.txt")) },  // destructive → should escalate in any honest mode
  { key: "edit",       prompt: "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.",
    effect: (d) => existsSync(join(d, "note.txt")) && readFileSync(join(d, "note.txt"), "utf8").includes("CHANGED") },
  { key: "write",      prompt: "Create a new file created.txt containing the text hello. Do nothing else.",
    effect: (d) => existsSync(join(d, "created.txt")) },
];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe18-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "disposable.txt"), "delete me\n");
  return dir;
}

// One isolated query for one (mode, op). `decision` is the broker's verdict (allow|deny).
async function cell(mode: string, op: Op, decision: "allow" | "deny") {
  const dir = freshDir();
  const brokerSaw: string[] = [];   // tools that REACHED canUseTool (i.e. were NOT auto-allowed upstream)
  const toolsRun: string[] = [];    // tools the model actually invoked
  let result: any, err: string | undefined;
  const t0 = Date.now();
  try {
    for await (const m of query({ prompt: op.prompt, options: {
      model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any,
      canUseTool: async (tool: string, inp: any) => {
        brokerSaw.push(tool);
        return decision === "allow"
          ? { behavior: "allow", updatedInput: inp } as any
          : { behavior: "deny", message: "probe-deny" } as any;
      },
    } })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  const ms = Date.now() - t0;
  return {
    brokerFired: brokerSaw.length > 0,
    brokerSaw: [...new Set(brokerSaw)],
    toolsRun: [...new Set(toolsRun)],
    executed: op.effect(dir),
    subtype: result?.subtype, ms, err,
  };
}

console.log("=== PROBE 18 — auto-mode AI-classifier headless reachability ===  model:", MODEL);
console.log("(brokerFired=true ⇒ op was routed to canUseTool; false ⇒ auto-allowed UPSTREAM of the broker)\n");

const MODES = ["default", "auto", "dontAsk"];
// brokerSet[mode][op.key] = [run1.brokerFired, run2.brokerFired]
const brokerSet: Record<string, Record<string, boolean[]>> = {};
const latency: Record<string, Record<string, number[]>> = {};

console.log("--- PASS 1: RECORDING-ALLOW broker, each cell 2× ---");
for (const mode of MODES) {
  brokerSet[mode] = {}; latency[mode] = {};
  console.log(`\n[mode=${mode}]`);
  for (const op of OPS) {
    const r1 = await cell(mode, op, "allow");
    const r2 = await cell(mode, op, "allow");
    brokerSet[mode][op.key] = [r1.brokerFired, r2.brokerFired];
    latency[mode][op.key] = [r1.ms, r2.ms];
    const fired = `${r1.brokerFired ? "FIRED" : "silent"}/${r2.brokerFired ? "FIRED" : "silent"}`;
    console.log(
      `  ${op.key.padEnd(10)} broker:${fired.padEnd(13)} ranTools:${brief([...new Set([...r1.toolsRun, ...r2.toolsRun])])}` +
      `  exec:${r1.executed}/${r2.executed}  ~${Math.round((r1.ms + r2.ms) / 2)}ms` +
      `${r1.err || r2.err ? "  ERR:" + (r1.err ?? r2.err) : ""}`,
    );
  }
}

console.log("\n--- PASS 2: RECORDING-DENY broker under `auto` (which ops execute despite denial?) ---");
for (const op of OPS) {
  const r = await cell("auto", op, "deny");
  // executed===true under a DENYING broker ⇒ allowed upstream (classifier or static rule), broker never consulted/honored
  console.log(
    `  ${op.key.padEnd(10)} brokerFired:${String(r.brokerFired).padEnd(5)}  executedAnyway:${r.executed}` +
    `  ranTools:${brief(r.toolsRun)}  subtype:${r.subtype}`,
  );
}

console.log("\n========================= VERDICT =========================");
const det = (a: boolean[]) => (a.every((x) => x) ? "FIRES" : a.every((x) => !x) ? "silent" : "FLAKY");
console.log("Per-op broker behavior (FIRES = routed to human/broker; silent = auto-allowed upstream):");
console.log("  op".padEnd(14), MODES.map((m) => m.padEnd(8)).join(" "));
for (const op of OPS)
  console.log("  " + op.key.padEnd(12), MODES.map((m) => det(brokerSet[m][op.key]).padEnd(8)).join(" "));

// Decisive test: is there ANY op where `auto` is silent but `default` FIRES (auto auto-allows strictly more)?
const discriminators = OPS.filter((op) => det(brokerSet.default[op.key]) === "FIRES" && det(brokerSet.auto[op.key]) === "silent");
const autoEqualsDefault = OPS.every((op) => det(brokerSet.default[op.key]) === det(brokerSet.auto[op.key]));
console.log("\nDecisive contrast (auto auto-allows where default prompts):");
if (discriminators.length) {
  console.log(`  → CLASSIFIER LIVE HEADLESS. auto is SILENT where default FIRES on: ${discriminators.map((o) => o.key).join(", ")}`);
  console.log("    (content-aware auto-allow that default's static engine does not grant ⇒ auto-mode classifier reachable via query())");
} else if (autoEqualsDefault) {
  console.log("  → CLASSIFIER DORMANT HEADLESS. auto ≡ default on every op ⇒ the declared auto-mode classifier is");
  console.log("    NOT wired through query() (bridge-coupled, like /assistant + /bridge). 'auto' is cosmetic headlessly.");
} else {
  console.log("  → MIXED/INCONCLUSIVE. auto differs from default but not via the read-only-allow signal; inspect rows above.");
}
console.log("\nLatency note (extra classifier round-trip would show as auto > default for the same op):");
for (const op of OPS) {
  const avg = (m: string) => Math.round(latency[m][op.key].reduce((a, b) => a + b, 0) / latency[m][op.key].length);
  console.log(`  ${op.key.padEnd(10)} default ${String(avg("default")).padStart(6)}ms   auto ${String(avg("auto")).padStart(6)}ms   dontAsk ${String(avg("dontAsk")).padStart(6)}ms`);
}
