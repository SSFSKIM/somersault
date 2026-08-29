// probes/probes/117-memory-recall-stream.ts — bl6 §3.3(d) deferred probe: does the memory recall
// supervisor run HEADLESSLY and surface `system/memory_recall` frames to an SDK client?
//
// Canon (2.1.250, research-cluster.md) absorbs `relevant_memories` attachments into an expanded
// cluster ("⎿ Recalled {basename}" + body). SDK 0.3.237 DECLARES the mirror — SDKMemoryRecallMessage
// (sdk.d.ts:4292: system/memory_recall, mode select|synthesize, memories[{path,scope,content?}]),
// docstring: "Mirrors the CLI relevant_memories attachment so SDK renderers can show 'Recalled from
// memory' inline" — plus settings keys autoMemoryEnabled / autoMemoryDirectory (sdk.d.ts:~7451,
// dir default ~/.claude/projects/<sanitized-cwd>/memory/, custom dir ignored only from PROJECT
// settings — the flag layer we use here is allowed). Declared ≠ reachable: the supervisor is a
// server/CLI-side feature that may be gated off headless sessions entirely.
//
// Setup: temp cwd + temp memory dir seeded like a real auto-memory dir (MEMORY.md index + one topic
// file) with a fact the model cannot know (passphrase). Two axes measured per case:
//   1. WIRE: any system/memory_recall frame (full dump) — the bl6 renderer's input.
//   2. INJECTION: does the reply contain the passphrase? (Memory can be injected via MEMORY.md into
//      the system prompt without any recall frame — distinguishes "injected, not surfaced" from
//      "feature off".) MEMORY.md deliberately does NOT contain the passphrase, only the topic file,
//      so a correct answer proves the supervisor (or a lazy-load) actually pulled the topic file.
//   A: haiku  B: sonnet-5 (supervisor may be model-gated; canon's synthesize mode is Sonnet-authored)
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/117-memory-recall-stream.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, haiku + sonnet-5, OAuth) — INJECTED-BUT-SILENT. ──
// Both cases: init acknowledges the dir (init.memory_paths.auto = our temp memdir), the model
// answers with the passphrase (haiku narrates "I can see from my memory…" then Reads the topic
// file; sonnet answers cold) — so autoMemoryDirectory + autoMemoryEnabled WORK headlessly and the
// index is injected. But ZERO system/memory_recall frames and zero raw `relevant_memories` mentions.
// P117b escalated to a 14-file population: still zero frames. The recall supervisor's wire mirror is
// declared-but-gated headless on 0.3.237 → bl6 §3.3(d) "Recalled {basename}" stays unbuildable.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PASS = "MULBERRY-47";
setTimeout(() => { console.log("\n!!! WATCHDOG (300s) — wedged, exiting"); process.exit(2); }, 300_000).unref?.();

function seed(): { cwd: string; mem: string } {
  const cwd = mkdtempSync(join(tmpdir(), "probe117-"));
  const mem = join(cwd, "memdir");
  mkdirSync(mem);
  writeFileSync(join(mem, "MEMORY.md"), "# Memory index\n\n- [zebra-quartz protocol](zebra-quartz-protocol.md) — the deployment passphrase and rotation rules for the zebra-quartz protocol\n");
  writeFileSync(join(mem, "zebra-quartz-protocol.md"), `# zebra-quartz protocol\n\nThe deployment passphrase for the zebra-quartz protocol is ${PASS}. It rotates never; this value is canonical.\n`);
  return { cwd, mem };
}

async function runCase(name: string, model: string) {
  console.log(`\n========== ${name} (${model}) ==========`);
  const { cwd, mem } = seed();
  const kinds = new Map<string, number>();
  const recalls: string[] = [];
  const sweeps: string[] = [];
  let reply = "";
  let initMemoryBits = "(none)";
  for await (const m of query({
    prompt: "What is the deployment passphrase for the zebra-quartz protocol? Consult your memory. Reply with the passphrase only.",
    options: {
      model, cwd, settingSources: [], permissionMode: "bypassPermissions",
      settings: JSON.stringify({ autoMemoryEnabled: true, autoMemoryDirectory: mem }),
    } as any,
  })) {
    const mm = m as any;
    const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
    kinds.set(lbl, (kinds.get(lbl) ?? 0) + 1);
    if (lbl === "system/memory_recall") recalls.push(JSON.stringify(mm).slice(0, 800));
    if (mm.type === "system" && mm.subtype === "init") {
      const raw = JSON.stringify(mm);
      const hit = raw.match(/"memory[^"]*":[^,}]{0,200}/g);
      initMemoryBits = hit ? hit.join(" | ").slice(0, 300) : "(no memory field on init)";
    }
    const raw = JSON.stringify(mm);
    if (raw.includes("relevant_memories")) sweeps.push(`${lbl}: mentions relevant_memories`);
    if (mm.type === "assistant") for (const b of (Array.isArray(mm.message?.content) ? mm.message.content : [])) if (typeof b?.text === "string") reply += b.text;
  }
  console.log("frame kinds:", [...kinds.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
  console.log("init memory fields:", initMemoryBits);
  console.log(`memory_recall frames: ${recalls.length}`);
  for (const r of recalls) console.log("  ", r);
  console.log(`raw relevant_memories sweep: ${sweeps.length ? sweeps.join("; ") : "none"}`);
  console.log(`reply: ${JSON.stringify(reply.trim().slice(0, 120))}  | contains passphrase: ${reply.includes(PASS)}`);
  return { recalls: recalls.length, injected: reply.includes(PASS) };
}

(async () => {
  console.log("=== PROBE 117 — system/memory_recall headless reachability, SDK 0.3.237 ===");
  const a = await runCase("A", "claude-haiku-4-5-20251001");
  const b = await runCase("B", "claude-sonnet-5");
  console.log("\n================= VERDICT =================");
  const wire = a.recalls + b.recalls;
  if (wire > 0) console.log("REACHABLE: system/memory_recall frames arrive headlessly — bl6 §3.3(d) 'Recalled {basename}' block becomes buildable off this frame.");
  else if (a.injected || b.injected) console.log("INJECTED-BUT-SILENT: the model answered from the memory file, yet no memory_recall frame was emitted — recall happens but the wire mirror is absent/gated; renderer stays unbuildable.");
  else console.log("DEAD: no frame AND no injection — auto-memory (or its recall supervisor) does not run for headless sessions under these settings; deferral stands. (Check init fields above for whether the dir was even acknowledged.)");
})();
