// Probe 84 (P84) — "Does a client see incremental stdout for a running Bash? Any wire counterpart to the
// background affordance?"  Gates F3's LT19 (incremental stdout rows) and LT20 (the dim
// `(ctrl+b to run in background)` hint under a foreground Bash).
//
// Prior art this EXTENDS rather than repeats:
//   • probe 67 — backgroundTasks() with NO argument against an in-flight foreground Bash (Goal B era SDK).
//   • probe 74 — what a MODEL-INITIATED background Bash gives a client (output file, task frames).
//   • probe 62 — the mid-turn frame-observation house style (poll while the turn runs).
// New here: (a) the SILENT GAP — every frame between the Bash tool_use and its tool_result, with
// includePartialMessages ON, checked for incremental stdout; (b) the TARGETED control request
// backgroundTasks(toolUseId) that 0.3.220 declares (SDKControlBackgroundTasksRequest,
// "the control-request equivalent of pressing Ctrl+B"), driven with the real tool_use id.
//
//   A. observation  — 10s foreground `tick` loop, no intervention. Does ANY frame carry stdout?
//                     What DOES arrive during the gap (tool_progress heartbeats?), and how long is it?
//   B. intervention — same loop; at tool_use+3s call q.backgroundTasks(<that tool_use id>). Does the
//                     tool_result come back early with "running in the background"? Which frames announce it?
//   C. schema       — is `run_in_background` visible to a client ON THE WIRE (init frame / tool_use input),
//                     or is it client-side knowledge of the Bash input schema?
//
//   set -a; . ../../.env; set +a; npx tsx probes/84-bash-stdout-background.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const LOOP = "for i in $(seq 1 10); do echo tick $i; sleep 1; done";
const MID_MARKERS = ["tick 3", "tick 4", "tick 5"];      // only incremental stdout could carry these mid-gap

setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

const trim = (v: unknown, n = 320) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : String(s); };

interface GapFrame { atMs: number; label: string; keys: string[]; dump: string }

// `trigger`: null = observe only · {atMs} = fire N ms after the tool_use block · "task_started" = fire the
// instant the engine announces the task (the first moment the task id provably exists engine-side).
type Trigger = null | { atMs: number } | "task_started";

async function phase(name: string, trigger: Trigger) {
  console.log(`\n===================== PHASE ${name} =====================`);
  const dir = mkdtempSync(join(tmpdir(), "probe84-"));
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), 120_000);
  const q: any = query({
    prompt: `Use the Bash tool ONCE, in the FOREGROUND (do NOT set run_in_background), to run exactly this command: ${LOOP}\nWait for it to finish, then reply with exactly DONE.`,
    options: {
      model: MODEL, maxTurns: 3, settingSources: [], permissionMode: "bypassPermissions",
      includePartialMessages: true, cwd: dir, abortController: controller,
    } as any,
  });

  const t0 = Date.now();
  const dt = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
  let toolUseId: string | undefined, toolUseAt = 0, toolResultAt = 0;
  let bgCalled = false, bgReturn: unknown = "(not called)", bgCalledAt = 0, bgThrew: string | undefined;
  let bgAllReturn: unknown = "(not called)";

  // The control request under test. Targeted form first; if it declines, immediately try the no-argument
  // "background everything" form (the literal Ctrl+B semantics) so a false cannot be blamed on targeting.
  const fireBackground = async (id: string) => {
    bgCalled = true; bgCalledAt = Date.now() - t0;
    console.log(`[${((bgCalledAt) / 1000).toFixed(1)}s] >>> calling q.backgroundTasks(${id})`);
    try { bgReturn = await q.backgroundTasks(id); console.log(`[${dt()}] <<< backgroundTasks(id) returned ${JSON.stringify(bgReturn)}`); }
    catch (e: any) { bgThrew = e?.message ?? String(e); console.log(`[${dt()}] <<< backgroundTasks(id) THREW: ${bgThrew}`); }
    if (bgReturn !== true) {
      try { bgAllReturn = await q.backgroundTasks(); console.log(`[${dt()}] <<< backgroundTasks() [no arg, background-all] returned ${JSON.stringify(bgAllReturn)}`); }
      catch (e: any) { bgAllReturn = `THREW ${e?.message}`; console.log(`[${dt()}] <<< backgroundTasks() THREW: ${e?.message}`); }
    }
  };
  const gap: GapFrame[] = [];
  const gapKinds = new Map<string, number>();
  const stdoutHits: string[] = [];
  let initFrame: any;
  let toolUseInput: any;
  let toolResultText = "";
  let resultSubtype: string | undefined;

  const label = (mm: any) =>
    mm.type === "stream_event" ? `stream_event/${mm.event?.type ?? "?"}${mm.event?.delta?.type ? ":" + mm.event.delta.type : ""}`
    : mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);

  for await (const m of q) {
    const mm = m as any;
    const at = Date.now() - t0;
    const lbl = label(mm);

    if (mm.type === "system" && mm.subtype === "init") { initFrame = mm; continue; }

    if (mm.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use" && b.name === "Bash" && !toolUseId) {
          toolUseId = b.id; toolUseAt = at; toolUseInput = b.input;
          console.log(`[${dt()}] tool_use Bash id=${b.id} input=${trim(b.input, 220)}`);
          if (trigger && trigger !== "task_started") setTimeout(() => void fireBackground(b.id), trigger.atMs);
        }
      }
    }

    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_result" && !toolResultAt) {
          toolResultAt = at; toolResultText = trim(b.content, 400);
          console.log(`[${dt()}] tool_result is_error=${b.is_error} content=${toolResultText}`);
        }
      }
    }

    // THE GAP: everything the client sees between the Bash tool_use and its tool_result.
    if (toolUseId && !toolResultAt && !(mm.type === "assistant")) {
      gapKinds.set(lbl, (gapKinds.get(lbl) ?? 0) + 1);
      const dump = trim(mm, 400);
      if (gap.length < 60) gap.push({ atMs: at, label: lbl, keys: Object.keys(mm), dump });
      const hay = JSON.stringify(mm);
      for (const marker of MID_MARKERS) if (hay.includes(marker)) stdoutHits.push(`${lbl}@${(at / 1000).toFixed(1)}s carries "${marker}"`);
      if (mm.type !== "stream_event") console.log(`[${dt()}] GAP ${lbl} ${dump}`);
      if (trigger === "task_started" && mm.subtype === "task_started" && !bgCalled) void fireBackground(toolUseId);
    }

    if (mm.type === "result") { resultSubtype = mm.subtype; console.log(`[${dt()}] result subtype=${mm.subtype} num_turns=${mm.num_turns} denials=${JSON.stringify(mm.permission_denials ?? [])}`); break; }
  }
  clearTimeout(killer);

  const gapMs = (toolResultAt || Date.now() - t0) - toolUseAt;
  console.log(`\n--- PHASE ${name} summary ---`);
  console.log(`tool_use at ${(toolUseAt / 1000).toFixed(1)}s → tool_result at ${(toolResultAt / 1000).toFixed(1)}s  (gap ${(gapMs / 1000).toFixed(1)}s)`);
  console.log(`frames observed inside the gap (${[...gapKinds.values()].reduce((a, b) => a + b, 0)} total):`);
  for (const [k, v] of [...gapKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k} ×${v}`);
  console.log(`non-stream_event gap frames: ${gap.filter((g) => !g.label.startsWith("stream_event")).length}`);
  console.log(`incremental-stdout hits    : ${stdoutHits.length ? stdoutHits.join(" | ") : "NONE (no frame carried mid-loop stdout)"}`);
  if (trigger !== null) console.log(`backgroundTasks(toolUseId)  : called=${bgCalled}@${(bgCalledAt / 1000).toFixed(1)}s return=${JSON.stringify(bgReturn)}${bgThrew ? ` THREW=${bgThrew}` : ""} | no-arg form: ${JSON.stringify(bgAllReturn)}`);
  return { gapMs, gapKinds, stdoutHits, bgReturn, bgAllReturn, bgThrew, bgCalledAt, toolUseInput, initFrame, toolResultText, resultSubtype, toolResultAt, toolUseAt, gap };
}

console.log("=== PROBE 84 — incremental Bash stdout + the background affordance's wire counterpart ===");
console.log(`model=${MODEL} loop=${LOOP}`);

const A = await phase("A (observation: no intervention)", null);
const B = await phase("B (intervention: backgroundTasks(toolUseId) at tool_use+3s)", { atMs: 3000 });
// B fired BEFORE system/task_started announced the task engine-side. B2 removes that confound by firing the
// instant the task exists on the wire — the earliest a real client could honestly offer the affordance.
const B2 = await phase("B2 (intervention: backgroundTasks(toolUseId) ON system/task_started)", "task_started");

// ---- C: where can the affordance come from? ----
console.log("\n===================== PHASE C (schema visibility) =====================");
const initKeys = A.initFrame ? Object.keys(A.initFrame) : [];
const toolsField = A.initFrame?.tools;
console.log(`init frame keys      : ${initKeys.join(", ")}`);
console.log(`init.tools is        : ${Array.isArray(toolsField) ? `string[] (${toolsField.length} entries), Bash present=${toolsField.includes("Bash")}` : typeof toolsField}`);
console.log(`init.tools sample    : ${trim(Array.isArray(toolsField) ? toolsField.slice(0, 8) : toolsField, 200)}`);
const anySchema = JSON.stringify(A.initFrame ?? {}).includes("run_in_background");
console.log(`"run_in_background" anywhere in the init frame: ${anySchema ? "YES" : "NO"}`);
console.log(`foreground tool_use input keys (A): ${Object.keys(A.toolUseInput ?? {}).join(", ") || "(none)"} — run_in_background present=${"run_in_background" in (A.toolUseInput ?? {})}`);

console.log("\n========================= VERDICTS =========================");
const anyStdout = A.stdoutHits.length > 0 || B.stdoutHits.length > 0 || B2.stdoutHits.length > 0;
console.log(`LT19 (incremental stdout rows): ${anyStdout ? "ALIVE — a frame carried mid-loop stdout" : "DEAD — no frame between tool_use and tool_result carried stdout"}`);
const heartbeats = [...A.gapKinds.entries()].filter(([k]) => k.includes("tool_progress")).reduce((a, [, v]) => a + v, 0);
console.log(`gap heartbeat frames (tool_progress) in A: ${heartbeats}`);
for (const [n, P] of [["B  (fired at tool_use+3s, before task_started)", B], ["B2 (fired ON task_started)", B2]] as const) {
  const worked = P.bgReturn === true || P.bgAllReturn === true;
  const early = P.toolResultAt > 0 && P.toolResultAt - P.bgCalledAt < 4000;
  console.log(`LT20 ${n}: targeted=${JSON.stringify(P.bgReturn)} no-arg=${JSON.stringify(P.bgAllReturn)}${P.bgThrew ? ` THREW=${P.bgThrew}` : ""}; tool_result ${((P.toolResultAt - P.bgCalledAt) / 1000).toFixed(1)}s after the call (A's uninterrupted gap was ${(A.gapMs / 1000).toFixed(1)}s) ⇒ ${worked && early ? "ACCEPTED and short-circuited" : worked ? "ACCEPTED but the tool call ran to completion anyway" : "DECLINED"}`);
  console.log(`     tool_result text: ${P.toolResultText}`);
}
console.log(`   earliest wire announcement of the running task: system/task_started (A at ${(A.gap.find((g) => g.label === "system/task_started")?.atMs ?? 0) / 1000}s, i.e. ${(((A.gap.find((g) => g.label === "system/task_started")?.atMs ?? 0) - A.toolUseAt) / 1000).toFixed(1)}s after the tool_use block)`);
console.log(`   the HINT itself   : ${anySchema ? "wire-declared" : "NOT wire-declared — client-side knowledge (Bash input schema / static keymap), since nothing on the stream announces the affordance"}`);
process.exit(0);
