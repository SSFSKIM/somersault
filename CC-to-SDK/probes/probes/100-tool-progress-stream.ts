// Probe 100 (P100) — "Does the installed @anthropic-ai/claude-agent-sdk deliver a PER-TOOL PROGRESS
// FEED headlessly, and does it carry the two numbers canon's fullscreen bash cluster header needs —
// in-flight ELAPSED SECONDS and OUTPUT LINE COUNT — while the tool is still running?"
// Gates Tool-Stream Task 11 (the live `(Ns · N lines)` suffix + mid-flight hint updates, spec §3.1).
//
// Prior art this EXTENDS rather than repeats:
//   • probe 84 — asked whether any frame in the tool_use→tool_result gap carries incremental Bash
//     STDOUT (it does not) and counted gap frame kinds. It did NOT interrogate the `tool_progress`
//     frame's own fields, and it did not test the environment gate found below.
//   • probe 74 — model-initiated background Bash (output file, task frames). Different affordance.
// New here: the progress CHANNEL itself, field by field, plus the gate that decides whether it exists.
//
// STATIC GROUND (read out of node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude, 0.3.220 —
// stated here as HYPOTHESES the live run must confirm or refute, never as findings):
//   H1. `sdk.d.ts` declares `SDKToolProgressMessage = { type:'tool_progress', tool_use_id, tool_name,
//       parent_tool_use_id, elapsed_time_seconds, task_id?, uuid, session_id, heartbeat?, ... }`.
//       It declares NO line-count field anywhere.
//   H2. Inside the binary the Bash tool emits a RICHER in-process record than the wire type:
//         {type:"bash_progress", output, fullOutput, elapsedTimeSeconds, totalLines, totalBytes,
//          taskId, timeoutMs}
//       …and canon's own renderer reads `totalLines` off it:
//         `he = ge>0 ? \` (${Me} · ${ge} ${ge===1?"line":"lines"})\` : \` (${Me})\``, taken from
//         `progressMessagesByToolUseID.get(id).at(-1).data`, gated on `elapsedTimeSeconds >= 2`.
//       So canon reads IN-PROCESS state, not the wire. HYPOTHESIS: `totalLines` is DROPPED at the
//       wire boundary — the bash_progress→tool_progress projection copies only elapsed + task_id.
//   H3. One of the two projection sites is env-gated:
//         if (e.data.type==="bash_progress"||…) { if(!Z.CLAUDE_CODE_REMOTE && !Z.CLAUDE_CODE_CONTAINER_ID) break; … }
//       A second, "yield-twin" site shows no such gate. Which one serves `query()` is exactly what a
//       live run has to decide — hence PHASE B, which sets CLAUDE_CODE_REMOTE=1 and nothing else.
//   H4. A separate 30s-interval `tool_heartbeat` producer exists (`elapsedTimeSeconds`, id suffixed
//       `-heartbeat-N`) and also projects to `tool_progress`. Too slow to drive a 1Hz suffix, and our
//       ~15s command should not reach it — recorded if it appears.
//   H5. `mcp_progress` (status started/progress/completed/failed, elapsedTimeMs) exists in-process but
//       appears in NO wire projection. Not separately probed: the brief calls the MCP arm optional and
//       a negative on the Bash arm (the cheaper, canon-relevant one) already decides Task 11.
//
//   set -a; . ../.env; set +a; npx tsx probes/100-tool-progress-stream.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
// ~14s wall clock, output growing 40 lines/s to ~560 — long enough to cross canon's >=2s render gate
// many times over, and big enough that a truthful line counter could not be mistaken for a constant.
const LOOP = "for i in $(seq 1 14); do seq 1 40; sleep 1; done";
// Any key a line counter could plausibly hide behind, in either casing convention.
const LINE_KEYS = ["totalLines", "total_lines", "numLines", "num_lines", "lineCount", "line_count", "lines", "totalBytes", "total_bytes", "output", "fullOutput"];

setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

const trim = (v: unknown, n = 400) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : String(s); };

interface Phase {
  name: string;
  gapKinds: Map<string, number>;
  progress: any[];          // every type:"tool_progress" frame, verbatim
  progressAtMs: number[];
  gapMs: number;
  toolUseAt: number;
  toolResultAt: number;
  lineKeyHits: string[];    // any gap frame carrying a line/byte/output-ish key
  otherGap: string[];       // non-stream_event gap frames, verbatim-trimmed
  resultSubtype?: string;
}

async function phase(name: string, extraEnv: Record<string, string> | undefined): Promise<Phase> {
  console.log(`\n===================== PHASE ${name} =====================`);
  const dir = mkdtempSync(join(tmpdir(), "probe100-"));
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), 150_000);
  const q: any = query({
    prompt: `Use the Bash tool ONCE, in the FOREGROUND (do NOT set run_in_background), to run exactly this command: ${LOOP}\nWait for it to finish, then reply with exactly DONE. Do not use any other tool.`,
    options: {
      model: MODEL, maxTurns: 3, settingSources: [], permissionMode: "bypassPermissions",
      includePartialMessages: true, cwd: dir, abortController: controller,
      // NOTE: `env` REPLACES the subprocess env wholesale, so the spread is load-bearing — it is what
      // keeps the credential reaching the spawned CLI. Nothing here is ever printed.
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
    } as any,
  });

  const t0 = Date.now();
  const dt = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
  const P: Phase = { name, gapKinds: new Map(), progress: [], progressAtMs: [], gapMs: 0, toolUseAt: 0, toolResultAt: 0, lineKeyHits: [], otherGap: [] };
  let toolUseId: string | undefined;

  const label = (m: any) =>
    m.type === "stream_event" ? `stream_event/${m.event?.type ?? "?"}`
    : m.type === "system" ? `system/${m.subtype}` : String(m.type);

  for await (const m of q) {
    const mm = m as any;
    const at = Date.now() - t0;

    if (mm.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use" && b.name === "Bash" && !toolUseId) {
          toolUseId = b.id; P.toolUseAt = at;
          console.log(`[${dt()}] tool_use Bash id=${b.id}`);
        }
      }
    }
    if (mm.type === "user" && !P.toolResultAt) {
      for (const b of mm.message?.content ?? []) if (b.type === "tool_result") {
        P.toolResultAt = at;
        console.log(`[${dt()}] tool_result is_error=${b.is_error} content=${trim(b.content, 120)}`);
      }
    }

    // THE GAP: everything a client sees while the Bash call is still in flight.
    if (toolUseId && !P.toolResultAt && mm.type !== "assistant") {
      const lbl = label(mm);
      P.gapKinds.set(lbl, (P.gapKinds.get(lbl) ?? 0) + 1);
      if (mm.type === "tool_progress") {
        P.progress.push(mm); P.progressAtMs.push(at);
        console.log(`[${dt()}] tool_progress VERBATIM ${JSON.stringify(mm)}`);
      } else if (mm.type !== "stream_event") {
        const dump = trim(mm, 300);
        if (P.otherGap.length < 40) P.otherGap.push(`${(at / 1000).toFixed(1)}s ${lbl} ${dump}`);
        console.log(`[${dt()}] GAP ${lbl} ${dump}`);
      }
      // Could a line count be hiding on ANY in-flight frame, under any name?
      const hay = JSON.stringify(mm);
      for (const k of LINE_KEYS) if (hay.includes(`"${k}"`)) P.lineKeyHits.push(`${lbl}@${(at / 1000).toFixed(1)}s has "${k}"`);
    }

    if (mm.type === "result") { P.resultSubtype = mm.subtype; console.log(`[${dt()}] result subtype=${mm.subtype} num_turns=${mm.num_turns}`); break; }
  }
  clearTimeout(killer);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}

  P.gapMs = (P.toolResultAt || Date.now() - t0) - P.toolUseAt;
  const deltas = P.progressAtMs.map((v, i) => (i ? v - P.progressAtMs[i - 1] : v - P.toolUseAt));
  console.log(`\n--- PHASE ${name} summary ---`);
  console.log(`in-flight window: ${(P.toolUseAt / 1000).toFixed(1)}s → ${(P.toolResultAt / 1000).toFixed(1)}s  (gap ${(P.gapMs / 1000).toFixed(1)}s)`);
  console.log(`frame kinds inside the gap:`);
  for (const [k, v] of [...P.gapKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k} ×${v}`);
  console.log(`tool_progress frames: ${P.progress.length}${P.progress.length ? ` — inter-arrival ms: [${deltas.join(", ")}]` : ""}`);
  if (P.progress.length) {
    const keys = [...new Set(P.progress.flatMap((f) => Object.keys(f)))].sort();
    console.log(`tool_progress key union: ${keys.join(", ")}`);
    console.log(`elapsed_time_seconds series: [${P.progress.map((f) => f.elapsed_time_seconds).join(", ")}]`);
    console.log(`heartbeat flags: [${P.progress.map((f) => String(f.heartbeat)).join(", ")}]`);
  }
  console.log(`line/byte/output-key hits on in-flight frames: ${P.lineKeyHits.length ? P.lineKeyHits.join(" | ") : "NONE"}`);
  return P;
}

console.log("=== PROBE 100 — per-tool progress stream: is it reachable, and what does it carry? ===");
console.log(`model=${MODEL}  command=${LOOP}`);

// A: the honest default a real headless host runs under. Nothing set.
const A = await phase("A (default env — the shipping headless case)", undefined);
// B: the ONLY variable changed is the flag H3 says gates one of the two projection sites.
const B = await phase("B (CLAUDE_CODE_REMOTE=1 — testing the statically-found gate)", { CLAUDE_CODE_REMOTE: "1" });

console.log("\n========================= VERDICTS =========================");
for (const P of [A, B]) {
  const cadenceOk = P.progress.length >= 2;
  console.log(`\n[${P.name}]`);
  console.log(`  Q1 does a per-tool progress feed arrive?      ${P.progress.length ? `YES — ${P.progress.length} type:"tool_progress" frames` : "NO — zero tool_progress frames in flight"}`);
  console.log(`  Q2 does anything carry in-flight ELAPSED?     ${P.progress.some((f) => typeof f.elapsed_time_seconds === "number") ? "YES — tool_progress.elapsed_time_seconds" : "NO"}`);
  console.log(`  Q3 does anything carry OUTPUT LINE COUNT?     ${P.lineKeyHits.length ? `MAYBE — ${P.lineKeyHits.join(" | ")}` : "NO — no in-flight frame carries any line/byte/output key"}`);
  console.log(`  Q4 is the cadence fast enough for a live suffix? ${cadenceOk ? "YES (>=2 frames inside one call)" : "NO (a static suffix at best)"}`);
}
const gateFlipped = A.progress.length === 0 && B.progress.length > 0;
console.log(`\n  GATE: ${gateFlipped ? "CONFIRMED — the feed exists only under CLAUDE_CODE_REMOTE/CONTAINER_ID" : A.progress.length && B.progress.length ? "NOT a gate for query() — the feed arrives with or without the flag" : A.progress.length === 0 && B.progress.length === 0 ? "IRRELEVANT — no feed either way" : "INVERTED — feed under default but not under the flag (re-run)"}`);
process.exit(0);

// ================================ ANSWER (live run 2026-08-19, SDK 0.3.220) ================================
//
// A1. THE FEED IS ENV-GATED, AND OFF BY DEFAULT. H3 is CONFIRMED for `query()`: the gated projection
//     site is the one that serves the SDK, not the ungated "yield-twin" site.
//       PHASE A (default env) — 18.1s in-flight Bash, and the ENTIRE gap between tool_use and
//       tool_result was:
//           system/task_started ×1 · system/task_notification ×1
//           stream_event/content_block_stop ×1 · message_delta ×1 · message_stop ×1
//           tool_progress ×0            ← zero. no per-tool progress feed at all.
//       PHASE B (identical, only CLAUDE_CODE_REMOTE=1 added) — tool_progress ×1 appeared.
//     Same model, same command, same 18s window. The flag is the whole difference.
//
// A2. UNDER THE FLAG, ELAPSED IS ON THE WIRE — LINES ARE NOT. The one frame, verbatim and complete:
//       {"type":"tool_progress","tool_use_id":"bash-progress-0","tool_name":"Bash",
//        "parent_tool_use_id":"toolu_015g7MshVaGeVbMTUwSAsnhj","elapsed_time_seconds":3,
//        "task_id":"b7yhcq8wi","session_id":"e6dee775-…","uuid":"f01eee39-…"}
//     Key union across all observed frames: elapsed_time_seconds, parent_tool_use_id, session_id,
//     task_id, tool_name, tool_use_id, type, uuid. `heartbeat` was undefined (H4 producer not reached).
//     H2 is CONFIRMED: `totalLines`/`totalBytes`/`output`/`fullOutput` exist on the in-process
//     bash_progress record and are DROPPED at the wire boundary. The scan for every plausible spelling
//     of a line counter (totalLines, total_lines, numLines, num_lines, lineCount, line_count, lines,
//     totalBytes, total_bytes, output, fullOutput) over EVERY in-flight frame — both phases —
//     returned NONE. Nothing headless carries output-line growth for a running tool.
//
// A3. EVEN UNDER THE FLAG THE CADENCE CANNOT DRIVE A LIVE COUNTER. Exactly ONE frame arrived in an
//     17.9s call, at elapsed_time_seconds:3, and never again. The projection throttles per
//     parent_tool_use_id behind a Date.now() comparison (LRU capped at 100 entries), and the interval
//     resolves in the bundle to THIRTY SECONDS (`NN_=pIs`, `pIs=30000`, the sole definition) — matching
//     the live run exactly. So a host gets one stale integer per tool call under ~30s, and one every
//     30s beyond that. Not a ticking clock. A live "(Ns)" suffix would have to be computed client-side
//     from local timestamps regardless.
//
// A4. WHAT A CLIENT DOES GET, UNGATED, IS THE BRACKET — NOT THE PROGRESS. Both phases delivered
//     system/task_started at the start of the Bash call and system/task_notification at its end, each
//     carrying task_id AND tool_use_id:
//       {"type":"system","subtype":"task_started","task_id":"b7yhcq8wi",
//        "tool_use_id":"toolu_015g7…","description":"for i in $(seq 1 14); do seq 1 40; sleep 1; done",
//        "task_type":"local_bash","uuid":…,"session_id":…}
//       {"type":"system","subtype":"task_notification","task_id":"b7yhcq8wi","tool_use_id":"toolu_015g7…",
//        "status":"completed","output_file":"","summary":"for i in …","uuid":…,"session_id":…}
//     That is a start edge and an end edge with correlation ids — enough to run a client-side wall
//     clock, and it needs no flag. It carries no line count.
//
// A5. CORRELATION TRAP for anyone who does consume tool_progress: its `tool_use_id` is the SYNTHETIC
//     producer id ("bash-progress-0"), NOT the tool call. The real Bash tool_use id is in
//     `parent_tool_use_id`. Keying a cluster header off tool_use_id would match nothing.
//
// A6. NOT PROBED, and why: the MCP arm (H5). In-process `mcp_progress` records exist (status
//     started/progress/completed/failed, elapsedTimeMs) but no wire projection was found for them, and
//     the Bash arm — the cheaper one, and the one canon's suffix actually renders — already returns a
//     negative on line counts. If an MCP progress feed is ever wanted, it needs its own probe.
//
// VERDICT — NOT REACHABLE for the feature as specified.
//   • output-line growth for an in-flight tool: NOT REACHABLE by any message, field, or env flag tested.
//   • in-flight elapsed seconds: reachable ONLY as tool_progress.elapsed_time_seconds, and only behind
//     CLAUDE_CODE_REMOTE / CLAUDE_CODE_CONTAINER_ID, at roughly one sample per call — worse than a
//     client-side timer started on system/task_started, which is ungated and free.
//   Task 11's `(Ns · N lines)` suffix cannot be fed from the SDK. The "Ns" half is buildable from
//   task_started/task_notification edges + a local clock; the "N lines" half has no source.
//
// Cost: two ~25s haiku turns, one Bash call each, in temp cwds removed on exit. Nothing printed the
// credential; PHASE B's `env` spread carries process.env through so the OAuth token still reaches the
// spawned CLI (env REPLACES the subprocess env — the spread is required, not cosmetic).
// ==========================================================================================================
