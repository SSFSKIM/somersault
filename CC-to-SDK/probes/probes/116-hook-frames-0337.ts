// probes/probes/116-hook-frames-0337.ts — bl6 §3.3(c) deferred probe: do PreToolUse hook
// lifecycle frames reach a HEADLESS client on the INSTALLED SDK (0.3.237)?
//
// Prior art this RE-MEASURES rather than extends: P85 (2026-08-04, SDK 0.3.220) found both hook
// species — in-process options.hooks callbacks AND settings-layer command hooks — execute
// INVISIBLY: zero hook_started/hook_progress/hook_response/tool_use_summary frames, which killed
// LT21 ("Ran N PreToolUse hooks (Xms)") and deferred bl6's expanded-cluster hook block. The wave4
// spec likewise recorded `includeHookEvents` 🚫 DEAD headless. 0.3.237 still DECLARES the triplet
// (sdk.d.ts:4196-4233: system/hook_started, hook_progress, hook_response with hook_name/hook_event/
// stdout/exit_code/outcome) and `includeHookEvents?: boolean` (sdk.d.ts:1673). Declared ≠ reachable;
// 17 releases later the question is whether the wire caught up with the declaration.
//
//   A. SETTINGS command hook — PreToolUse matcher "Read", `echo` + marker-file write so a silent
//      no-show is distinguishable from a hook that never ran. includeHookEvents: true.
//   B. in-process options.hooks callback — same matcher, counter as positive control.
//      includeHookEvents: true.
//
// Also swept per frame: any raw-JSON mention of `stop_hook_summary` (canon's TUI-internal transcript
// message — never declared in the SDK; a hit would mean the CLI leaks it) and `tool_use_summary`.
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/116-hook-frames-0337.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, haiku, OAuth) — FLIP: SETTINGS hooks are now VISIBLE. ──
// A (settings command hook): marker file written AND 2× {hook_started, hook_response} pairs on the
//   wire — hook_name "PreToolUse:Read", hook_event "PreToolUse", stdout/exit_code/outcome:"success"
//   populated; started→response arrival deltas ~10ms (echo hook), so timing IS derivable client-side.
// B (in-process options.hooks callback): ran (counter=1), zero frames — callbacks stay invisible,
//   which is fine: the harness owns the callback and can self-instrument.
// stop_hook_summary / tool_use_summary: zero raw mentions anywhere — canon's TUI transcript message
//   never leaks; a client must SYNTHESIZE the "Ran N PreToolUse hooks (Xms)" block from the pairs.
// CONSEQUENCE: P85's 0.3.220 "hooks execute invisibly" is STALE for settings-layer hooks. LT21 and
// bl6 §3.3(c)'s expanded-cluster hook block are buildable for hooks configured via settings/
// settingSources (the species end users configure); ccx's own programmatic hooks self-report.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
setTimeout(() => { console.log("\n!!! WATCHDOG (300s) — wedged, exiting"); process.exit(2); }, 300_000).unref?.();

interface Cap { kinds: Map<string, number>; hookFrames: { atMs: number; dump: string }[]; sweeps: string[]; toolResults: number }

async function runCase(name: string, opts: Record<string, unknown>, dir: string): Promise<Cap> {
  console.log(`\n========== ${name} ==========`);
  const cap: Cap = { kinds: new Map(), hookFrames: [], sweeps: [], toolResults: 0 };
  const t0 = Date.now();
  for await (const m of query({
    prompt: "Read note.txt with the Read tool, then reply with exactly one word: GAMMA",
    options: { model: MODEL, cwd: dir, settingSources: [], permissionMode: "bypassPermissions", includeHookEvents: true, ...opts } as any,
  })) {
    const mm = m as any;
    const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
    cap.kinds.set(lbl, (cap.kinds.get(lbl) ?? 0) + 1);
    if (/^system\/hook_/.test(lbl) || lbl === "system/tool_use_summary") {
      cap.hookFrames.push({ atMs: Date.now() - t0, dump: JSON.stringify(mm).slice(0, 600) });
    }
    const raw = JSON.stringify(mm);
    for (const needle of ["stop_hook_summary", "tool_use_summary"]) {
      if (raw.includes(needle)) cap.sweeps.push(`${lbl}: mentions ${needle}`);
    }
    if (mm.type === "user") cap.toolResults += (Array.isArray(mm.message?.content) ? mm.message.content : []).filter((b: any) => b?.type === "tool_result").length;
  }
  console.log("frame kinds:", [...cap.kinds.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
  return cap;
}

(async () => {
  console.log("=== PROBE 116 — hook lifecycle frames, SDK 0.3.237, includeHookEvents:true ===");

  // Case A: settings-layer command hook. Marker file = positive control that the hook RAN.
  const dirA = mkdtempSync(join(tmpdir(), "probe116a-"));
  writeFileSync(join(dirA, "note.txt"), "hello 116\n");
  const marker = join(dirA, "hook-ran.marker");
  const capA = await runCase("A: settings command hook (PreToolUse, matcher Read)", {
    settings: JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: `date +%s%N > "${marker}"; echo probe116-hook-stdout` }] }] },
    }),
  }, dirA);
  const ranA = existsSync(marker);

  // Case B: in-process callback hook. Counter = positive control.
  const dirB = mkdtempSync(join(tmpdir(), "probe116b-"));
  writeFileSync(join(dirB, "note.txt"), "hello 116\n");
  let cbCount = 0;
  const capB = await runCase("B: in-process options.hooks callback (PreToolUse)", {
    hooks: { PreToolUse: [{ matcher: "Read", hooks: [async () => { cbCount++; await new Promise((r) => setTimeout(r, 400)); return {}; }] }] },
  }, dirB);

  console.log("\n================= VERDICT =================");
  console.log(`A settings hook RAN (marker file): ${ranA} | hook frames on wire: ${capA.hookFrames.length}`);
  for (const f of capA.hookFrames) console.log(`  A@${f.atMs}ms  ${f.dump}`);
  console.log(`B callback RAN (invocations=${cbCount}) | hook frames on wire: ${capB.hookFrames.length}`);
  for (const f of capB.hookFrames) console.log(`  B@${f.atMs}ms  ${f.dump}`);
  const sweeps = [...capA.sweeps, ...capB.sweeps];
  console.log(`raw sweeps (stop_hook_summary / tool_use_summary): ${sweeps.length ? sweeps.join("; ") : "none"}`);
  const alive = capA.hookFrames.length > 0 || capB.hookFrames.length > 0;
  console.log(alive
    ? "FLIP: hook lifecycle frames NOW REACH the headless stream — P85's 0.3.220 verdict is stale; LT21/bl6 hook block becomes buildable (timing derivable from started→response arrival deltas)."
    : "HOLDS: still invisible on 0.3.237 even with includeHookEvents:true and both positive controls firing — bl6 §3.3(c) deferral stands.");
  if ((ranA && capA.hookFrames.length === 0) || (cbCount > 0 && capB.hookFrames.length === 0))
    console.log("(controls prove the hooks executed, so an all-quiet wire is a real negative, not a dead hook)");
})();
