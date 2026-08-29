// probes/probes/118-goal-advisor-reachability.ts — bl6 D8 stretch gate: can a HEADLESS session ever
// receive the stream content that would make canon's two unbuilt clickable kinds renderable?
//
//   1. GOAL — canon's clickable `goal_status` attachment. The SDK never declares `goal_status`; its
//      mirror is SDKActiveGoalMessage (`type:'active_goal'`, sdk.d.ts:3019, "from internal QueryEvent
//      'active_goal'", set by the /goal Stop hook). Wave 2 (probes 46/46b/46c, older SDK) settled
//      /goal DEAD headless across all three dispatch forms ("goal is a UI command"). Re-measured here
//      on 0.3.237 because this wave already flipped one Wave-2-era verdict (P85 hooks → P116 alive):
//      plain-text "/goal …" and the <command-name> wrapper form, watching for `active_goal` frames.
//   2. ADVISOR — canon's advisor result rows (`advisor_tool_result` blocks; never declared in
//      sdk.d.ts — the only advisor surface is the `advisorModel` settings key, "Advisor model for
//      the server-side advisor tool"). Measured: with advisorModel set, does the init frame mount an
//      advisor-named tool, and does any frame across a consult-tempting turn mention advisor at all?
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/118-goal-advisor-reachability.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, sonnet-5, OAuth) — GOAL DEAD, ADVISOR ALIVE. ──
// GOAL: zero active_goal frames from either dispatch form (plain "/goal …" and the <command-name>
//   wrapper); Wave 2's UI-command-only verdict HOLDS on 0.3.237. D8 goal_status row unreachable.
// ADVISOR — FLIP: with settings {advisorModel:"claude-opus-4-8"}, the turn carried an assistant
//   frame with a `server_tool_use` block (name:"advisor", input:{}) and a follow-up assistant frame
//   with an `advisor_tool_result` block: {type:"advisor_tool_result", tool_use_id:"srvtoolu_…",
//   content:{type:"advisor_result", text:"…"}} — EXACTLY canon's D8 advisor block kind, arriving as
//   ordinary assistant message content (not in init.tools — it is a SERVER tool, so "mounted:false"
//   below is about client tools only). The model consulted it un-prompted-by-config, on request.
//   Cost note: the advisor consult turn billed ~$0.39 equivalent (opus advisor + sonnet main).
// CONSEQUENCE: D8's advisor clickable row is BUILDABLE (render advisor_tool_result blocks; click =
// in-place expand toggle per canon predicate); goal_status stays parked.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-sonnet-5";
setTimeout(() => { console.log("\n!!! WATCHDOG (360s) — wedged, exiting"); process.exit(2); }, 360_000).unref?.();

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("=== PROBE 118 — goal + advisor headless reachability, SDK 0.3.237 ===");

  // ---- Case 1: /goal → active_goal frames ----
  const dirG = mkdtempSync(join(tmpdir(), "probe118g-"));
  const goalFrames: string[] = [];
  const kindsG = new Map<string, number>();
  let results = 0;
  const q = inputQueue();
  const handle: any = query({
    prompt: q.iterable as any,
    options: { model: MODEL, cwd: dirG, permissionMode: "bypassPermissions", maxTurns: 8, settingSources: [] } as any,
  });
  const consume = (async () => {
    for await (const m of handle) {
      const mm = m as any;
      const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
      kindsG.set(lbl, (kindsG.get(lbl) ?? 0) + 1);
      if (mm.type === "active_goal") goalFrames.push(JSON.stringify(mm).slice(0, 400));
      if (mm.type === "result") results++;
    }
  })();
  q.push(userTurn("/goal create a file named done.txt containing DONE"));
  while (results < 1) await sleep(300);
  q.push(userTurn('<command-name>/goal</command-name><command-message>goal</command-message><command-args>create a file named done.txt containing DONE</command-args>'));
  while (results < 2) await sleep(300);
  q.close();
  await Promise.race([consume, sleep(8000)]);
  console.log("\n[goal] frame kinds:", [...kindsG.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
  console.log(`[goal] active_goal frames: ${goalFrames.length}`);
  for (const f of goalFrames) console.log("  ", f);

  // ---- Case 2: advisorModel → advisor tool / frames ----
  const dirA = mkdtempSync(join(tmpdir(), "probe118a-"));
  writeFileSync(join(dirA, "puzzle.md"), "Should we shard by tenant or by region? Constraints: 40 tenants, 3 regions, strict data residency in 1 region, hot-tenant skew 100:1.\n");
  let initTools: string[] = [];
  const advisorHits: string[] = [];
  const kindsA = new Map<string, number>();
  for await (const m of query({
    prompt: "Read puzzle.md and give a one-sentence recommendation. If an advisor tool is available to you, consult it first.",
    options: {
      model: MODEL, cwd: dirA, permissionMode: "bypassPermissions", settingSources: [],
      settings: JSON.stringify({ advisorModel: "claude-opus-4-8" }),
    } as any,
  })) {
    const mm = m as any;
    const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
    kindsA.set(lbl, (kindsA.get(lbl) ?? 0) + 1);
    if (mm.type === "system" && mm.subtype === "init" && Array.isArray(mm.tools)) initTools = mm.tools;
    const raw = JSON.stringify(mm);
    if (/advisor/i.test(raw)) advisorHits.push(`${lbl}: ${raw.slice(0, 300)}`);
  }
  console.log("\n[advisor] frame kinds:", [...kindsA.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
  console.log(`[advisor] init tools (${initTools.length}):`, initTools.join(", "));
  console.log(`[advisor] advisor-named tool mounted: ${initTools.some((t) => /advisor/i.test(t))}`);
  console.log(`[advisor] frames mentioning advisor: ${advisorHits.length}`);
  for (const h of advisorHits.slice(0, 5)) console.log("  ", h);

  console.log("\n================= VERDICT =================");
  console.log(goalFrames.length > 0
    ? "GOAL FLIP: active_goal frames arrive headlessly — D8 goal row becomes buildable off SDKActiveGoalMessage."
    : "GOAL HOLDS DEAD: no active_goal frame from either dispatch form on 0.3.237 — Wave 2 verdict stands; D8 goal_status row stays unreachable.");
  console.log(initTools.some((t) => /advisor/i.test(t)) || advisorHits.length > 0
    ? "ADVISOR: some advisor surface exists headlessly — inspect dumps above before concluding buildability."
    : "ADVISOR DEAD: advisorModel set, yet no advisor tool mounts and no frame mentions advisor — advisor_tool_result blocks cannot occur headlessly; D8 advisor row stays unreachable.");
  process.exit(0);
})();
