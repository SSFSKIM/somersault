// probes/probes/104-readfile.ts — M2b Wave 4 probe 2 (spec table row 2): is Query.readFile reachable
// at runtime? Declared at sdk.d.ts:2455 (path + options). Per the M2 spec, EITHER verdict ships NO
// M2b method — ALIVE records backing knowledge for M3's fs/read; DEAD records N/A-dead. The probe
// opens a minimal keyed turn (the control channel needs a running CLI), then calls readFile on a tmp
// file this probe wrote, and on a nonexistent path for the error shape.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "probe104-"));
const file = join(dir, "hello.txt");
writeFileSync(file, "readFile probe payload 104\n");

const out: Record<string, unknown> = { typeofReadFile: "unset", verdict: "INCONCLUSIVE" };
const deadline = setTimeout(() => { out.note = "deadline hit"; console.log(JSON.stringify(out, null, 2)); process.exit(0); }, 60_000);

const q = query({
  prompt: "Reply with exactly: ok",
  options: { cwd, permissionMode: "bypassPermissions", model: "claude-haiku-4-5-20251001", settingSources: [] },
});
out.typeofReadFile = typeof (q as any).readFile;

(async () => {
  let probed = false;
  for await (const m of q as any) {
    if (m.type === "system" && m.subtype === "init" && !probed) {
      probed = true;
      if (typeof (q as any).readFile !== "function") { out.verdict = "DEAD (method absent)"; break; }
      try {
        const r = await (q as any).readFile(file);
        out.readResult = r;
        out.verdict = "ALIVE";
      } catch (e: any) { out.readError = String(e?.message ?? e); out.verdict = "DEAD (call rejected)"; }
      try { await (q as any).readFile(join(dir, "missing.txt")); out.missingPath = "resolved?!"; }
      catch (e: any) { out.missingPath = `threw: ${e?.message ?? e}`; }
    }
    if (m.type === "result") break;
  }
  clearTimeout(deadline);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { out.note = `iteration threw: ${e?.message ?? e}`; clearTimeout(deadline); console.log(JSON.stringify(out, null, 2)); process.exit(0); });
