// Probe 67 — does Query.backgroundTasks() actually detach an IN-FLIGHT foreground Bash?
//
// Goal B acceptance ③ phase B found that pressing Ctrl+B in our REPL while an ordinary foreground Bash
// ran produced no background_tasks_changed snapshot, and the model reported the command completed in the
// foreground. Our wiring calls the same SDK method probe 39 used (session.backgroundAll → callQ
// "backgroundTasks"), so the open question is whether the negative is OURS or the CLI's.
//
// Phase A: start a long foreground Bash loop, call backgroundTasks() mid-flight, log its return and every
//          system frame (does background_tasks_changed arrive? does the tool_result come back early?).
// Phase B: control — the same command with run_in_background:true, to confirm the snapshot frame DOES
//          arrive on the model-initiated path (that half is already proven live; this pins the contrast).
import { query } from "@anthropic-ai/claude-agent-sdk";

const LOOP = "for i in $(seq 1 30); do echo tick $i; sleep 1; done";

async function phase(name: string, prompt: string, backgroundMidFlight: boolean) {
  console.log(`\n=== PHASE ${name} ===`);
  const q = query({
    prompt,
    options: {
      model: "claude-haiku-4-5-20251001",
      maxTurns: 4,
      settingSources: [],
      permissionMode: "bypassPermissions",
      cwd: process.env.PROBE_CWD ?? process.cwd(),
    },
  });
  let fired = false, bgResult: unknown, snapshots = 0;
  const t0 = Date.now();
  for await (const m of q) {
    const mm = m as any;
    const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    if (mm.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_use") {
          console.log(`[${dt()}] tool_use ${b.name} ${JSON.stringify(b.input).slice(0, 160)}`);
          if (backgroundMidFlight && b.name === "Bash" && !fired) {
            fired = true;
            setTimeout(async () => {
              try { bgResult = await (q as any).backgroundTasks(); console.log(`[bg] backgroundTasks() → ${JSON.stringify(bgResult)}`); }
              catch (e: any) { console.log(`[bg] backgroundTasks() THREW: ${e?.message}`); }
            }, 3000);
          }
        }
      }
    }
    if (mm.type === "system" && mm.subtype !== "init") {
      if (mm.subtype === "background_tasks_changed") { snapshots++; console.log(`[${dt()}] background_tasks_changed tasks=${JSON.stringify(mm.tasks)?.slice(0, 300)}`); }
      else console.log(`[${dt()}] system/${mm.subtype} ${JSON.stringify(mm).slice(0, 200)}`);
    }
    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b.type === "tool_result") console.log(`[${dt()}] tool_result is_error=${b.is_error} ${JSON.stringify(b.content).slice(0, 220)}`);
      }
    }
    if ("result" in mm) { console.log(`[${dt()}] result subtype=${mm.subtype}`); break; }
  }
  console.log(`--- ${name}: backgroundTasks()=${JSON.stringify(bgResult)} snapshots=${snapshots}`);
}

console.log("=== PROBE 67 backgroundTasks() vs an in-flight foreground Bash ===");
await phase("A (foreground + mid-flight backgroundTasks)", `Use the Bash tool in the FOREGROUND (do not set run_in_background) to run exactly: ${LOOP}`, true);
await phase("B (control: model-initiated background)", `Use the Bash tool with run_in_background set to true to run exactly: ${LOOP} — then just say STARTED.`, false);
