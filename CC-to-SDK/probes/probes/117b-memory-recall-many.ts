// probes/probes/117b-memory-recall-many.ts — escalation of P117: does the memory recall SUPERVISOR
// (system/memory_recall, mode select|synthesize) fire when the auto-memory dir looks REAL — an index
// plus many tiny topic files — rather than P117's minimal two-file seed?
//
// P117 found INJECTED-BUT-SILENT: init.memory_paths.auto acknowledged the dir, MEMORY.md reached the
// system prompt, the model Read the topic file and answered — but zero memory_recall frames. The
// declared docstring says 'select' is "chosen by the parallel selector" and 'synthesize' is
// "distilled from many tiny memories" (sdk.d.ts:4296), so the supervisor may only arm above some
// population threshold. 14 tiny memories here, question spans two of them.
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/117b-memory-recall-many.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, sonnet-5, OAuth) — STILL SILENT AT POPULATION. ──
// 14 files: zero memory_recall frames. Sonnet answered BOTH facts with ZERO tool calls (assistant×1,
// no tool_result frame) — memory content reaches the model wholesale at injection time, so the
// supervisor either doesn't run headlessly or its surfacing never mirrors to the wire. (Seed-design
// caveat: this run's MEMORY.md index lines themselves carried both facts, so "which layer injected"
// is not distinguished here — P117's cleaner seed already proved topic-file retrieval. The WIRE
// verdict — zero frames — is unaffected.) Verdict: declared-but-gated; §3.3(d) deferral stands.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PASS = "MULBERRY-47";
const PORT = "6117";
setTimeout(() => { console.log("\n!!! WATCHDOG (240s) — wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const cwd = mkdtempSync(join(tmpdir(), "probe117b-"));
const mem = join(cwd, "memdir");
mkdirSync(mem);
const topics: [string, string][] = [
  ["zebra-quartz-protocol", `deployment passphrase is ${PASS}; rotates never`],
  ["staging-gateway", `staging gateway listens on port ${PORT}; TLS terminated at the LB`],
  ["ci-flake-imageCodec", "imageCodec-encode unit flake is pre-existing; rerun once before investigating"],
  ["release-cadence", "releases cut Thursdays; hotfixes any day with two approvals"],
  ["db-naming", "postgres schemas are singular nouns; migrations timestamped UTC"],
  ["oncall-rotation", "oncall rotates Mondays 09:00 UTC; handoff notes in runbook"],
  ["retry-budget", "external calls get 3 retries, exponential from 200ms, jitter full"],
  ["logging-style", "structured JSON logs only; no printf debugging in main"],
  ["feature-flags", "flags live in flags.yaml; delete within two sprints of 100% rollout"],
  ["perf-budget", "TTI budget 1.8s on reference hardware; regressions block merge"],
  ["security-headers", "CSP is enforced report-only in staging first for one week"],
  ["vendor-quota", "vendor API quota 10k/day; batch endpoints preferred after 8k"],
  ["design-tokens", "spacing scale is 4px base; never hardcode hex outside tokens.css"],
  ["meeting-notes", "weekly sync notes filed under docs/sync/YYYY-MM-DD.md"],
];
writeFileSync(join(mem, "MEMORY.md"), `# Memory index\n\n${topics.map(([n, s]) => `- [${n}](${n}.md) — ${s.split(";")[0]}`).join("\n")}\n`);
for (const [n, s] of topics) writeFileSync(join(mem, `${n}.md`), `# ${n}\n\n${s}.\n`);

(async () => {
  console.log("=== PROBE 117b — memory_recall with a 14-file auto-memory population ===");
  const kinds = new Map<string, number>();
  const recalls: string[] = [];
  let reply = "";
  for await (const m of query({
    prompt: "Two questions from memory: (1) the zebra-quartz deployment passphrase, (2) the staging gateway port. Answer as 'PASS=<x> PORT=<y>'.",
    options: {
      model: "claude-sonnet-5", cwd, settingSources: [], permissionMode: "bypassPermissions",
      settings: JSON.stringify({ autoMemoryEnabled: true, autoMemoryDirectory: mem }),
    } as any,
  })) {
    const mm = m as any;
    const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
    kinds.set(lbl, (kinds.get(lbl) ?? 0) + 1);
    if (lbl === "system/memory_recall") recalls.push(JSON.stringify(mm).slice(0, 900));
    if (mm.type === "assistant") for (const b of (Array.isArray(mm.message?.content) ? mm.message.content : [])) if (typeof b?.text === "string") reply += b.text;
  }
  console.log("frame kinds:", [...kinds.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
  console.log(`memory_recall frames: ${recalls.length}`);
  for (const r of recalls) console.log("  ", r);
  console.log(`reply: ${JSON.stringify(reply.trim().slice(0, 140))} | both facts: ${reply.includes(PASS) && reply.includes(PORT)}`);
  console.log(recalls.length > 0
    ? "REACHABLE at population: the supervisor arms with a realistic memory set — renderer buildable; note the mode and whether content is inline or lazy-load."
    : "STILL SILENT at 14 files: treat system/memory_recall as declared-but-gated for headless sessions on 0.3.237; bl6 §3.3(d) deferral stands (injection works, the wire mirror does not).");
})();
