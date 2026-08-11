// probes/probes/105-reload-plugins-skills.ts — M2b Wave 4 probes 3+4 (one file, same shape): are
// Query.reloadPlugins / Query.reloadSkills reachable at runtime? Declared at sdk.d.ts:2465/2471.
// Promote-or-discard fixed in the M2b plan Task 5: ALIVE → thin chain-scoped plugin/reload /
// skill/reload handlers replying {ok:true}; DEAD → -32601, row N/A-dead. Same minimal-keyed-turn
// skeleton as probe 104 — the control channel needs a running CLI.
import { query } from "@anthropic-ai/claude-agent-sdk";

const cwd = process.cwd();
const out: Record<string, unknown> = { typeofReloadPlugins: "unset", typeofReloadSkills: "unset", pluginsVerdict: "INCONCLUSIVE", skillsVerdict: "INCONCLUSIVE" };
const deadline = setTimeout(() => { out.note = "deadline hit"; console.log(JSON.stringify(out, null, 2)); process.exit(0); }, 60_000);

const q = query({
  prompt: "Reply with exactly: ok",
  options: { cwd, permissionMode: "bypassPermissions", model: "claude-haiku-4-5-20251001", settingSources: [] },
});
out.typeofReloadPlugins = typeof (q as any).reloadPlugins;
out.typeofReloadSkills = typeof (q as any).reloadSkills;

(async () => {
  let probed = false;
  for await (const m of q as any) {
    if (m.type === "system" && m.subtype === "init" && !probed) {
      probed = true;
      if (typeof (q as any).reloadPlugins === "function") {
        try { out.pluginsResult = await (q as any).reloadPlugins(); out.pluginsVerdict = "ALIVE"; }
        catch (e: any) { out.pluginsError = String(e?.message ?? e); out.pluginsVerdict = "DEAD (call rejected)"; }
      } else out.pluginsVerdict = "DEAD (method absent)";
      if (typeof (q as any).reloadSkills === "function") {
        try { out.skillsResult = await (q as any).reloadSkills(); out.skillsVerdict = "ALIVE"; }
        catch (e: any) { out.skillsError = String(e?.message ?? e); out.skillsVerdict = "DEAD (call rejected)"; }
      } else out.skillsVerdict = "DEAD (method absent)";
    }
    if (m.type === "result") break;
  }
  clearTimeout(deadline);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { out.note = `iteration threw: ${e?.message ?? e}`; clearTimeout(deadline); console.log(JSON.stringify(out, null, 2)); process.exit(0); });
