// Probe 68d — F2 alone: rewindFiles({dryRun}) with checkpointing OFF vs ON, on a query shaped like
// the product's Session: STREAMING INPUT held open, control call made in-loop at result-time.
// (68b called after the loop — break had closed it; 68c used string prompts — transport closes at
// result regardless, even with checkpointing on. This is the first probe where the transport is
// actually alive at call time.)
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe68d-"));
console.log("=== PROBE 68d no-checkpoint dryRun on a held-open streaming query ===\ncwd:", dir);

async function phase(label: string, checkpointing: boolean) {
  const f = join(dir, `${label}.txt`);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  async function* input(): AsyncGenerator<any> {
    yield { type: "user", message: { role: "user", content: `Create ${f} containing exactly ONE. Say DONE-1.` },
            parent_tool_use_id: null, session_id: "pending" };
    await held;
    yield { type: "user", message: { role: "user", content: `Overwrite ${f} to contain exactly TWO. Say DONE-2.` },
            parent_tool_use_id: null, session_id: "pending" };
    await new Promise(() => {});   // never exhaust — generator return starts CLI shutdown (the 68d rev-1 bug)
  }
  const q = query({ prompt: input(), options: { model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions",
    cwd: dir, maxTurns: 12, settingSources: [], enableFileCheckpointing: checkpointing } });
  let sid: string | undefined; let results = 0;
  for await (const m of q) {
    if (m.type === "system" && (m as any).subtype === "init") sid = (m as any).session_id;
    if ("result" in m) {
      results++;
      if (results === 1) { release(); continue; }         // turn 1 done → send turn 2
      const rows = (await getSessionMessages(sid!)) as any[];
      const anchor = rows.find((r: any) => r.type === "user" && r.uuid && /TWO/.test(JSON.stringify(r.message?.content)))?.uuid;
      console.log(`[${label}] anchor ${anchor?.slice(0, 8)} | disk before: ${readFileSync(f, "utf8")}`);
      try { console.log(`[${label}] dryRun →`, JSON.stringify(await (q as any).rewindFiles(anchor, { dryRun: true }))); }
      catch (e: any) { console.log(`[${label}] dryRun THREW:`, e?.message); }
      try { console.log(`[${label}] real →`, JSON.stringify(await (q as any).rewindFiles(anchor)), "| disk:", readFileSync(f, "utf8")); }
      catch (e: any) { console.log(`[${label}] real THREW:`, e?.message, "| disk:", readFileSync(f, "utf8")); }
      break;
    }
  }
  await (q as any).close?.();
}

await phase("cp-on", true);    // control first: proves the held-open harness itself works
await phase("cp-off", false);  // the actual F2 answer
process.exit(0);
