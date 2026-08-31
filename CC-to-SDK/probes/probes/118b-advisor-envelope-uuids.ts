// probes/probes/118b-advisor-envelope-uuids.ts — R-ADVISOR's pre-design gate for bl7 T-ADVISOR:
// do the advisor frames survive ccx's transcript dedupe?
//
// P118 proved the blocks arrive (server_tool_use name:"advisor", then advisor_tool_result) but its
// dumps truncated before the ENVELOPE fields. ccx `transcriptModel.ts:100-102` dedupes appended SDK
// frames on uuid-then-message-id — and P118's two advisor frames shared one `message.id`
// (msg_011CeXJ2Mwc…). If they also share a uuid (or lack one), the SECOND frame — the result block,
// the one the renderer needs — is dropped before projection and the bl7 design must add a merge
// rule instead of a plain append. This probe records, for EVERY frame of one advisor turn:
// type, top-level uuid, message.id, content block types, plus the exact (uuid, message.id)
// collision that the dedupe would act on.
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/118b-advisor-envelope-uuids.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, sonnet-5 + opus advisor, OAuth) — SAFE. ──
// 14 frames; the advisor turn split one API message (msg_011CeXNERV…) across FOUR assistant frames
// (thinking / server_tool_use / advisor_tool_result / text) and EVERY frame carried a distinct
// top-level uuid. identityOf() is uuid-first (transcriptModel.ts:50-56) — the message-id arm never
// runs when a uuid is present — so appendSdk retains all advisor frames as ordinary appends.
// CONSEQUENCE for bl7 T-ADVISOR: no merge rule, no dedupe change; the renderer just needs the two
// new block kinds. (Also confirms the SDK's frame-per-content-block streaming shape generally.)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setTimeout(() => { console.log("\n!!! WATCHDOG (240s) — wedged, exiting"); process.exit(2); }, 240_000).unref?.();

const dir = mkdtempSync(join(tmpdir(), "probe118b-"));
writeFileSync(join(dir, "puzzle.md"), "Shard by tenant or by region? 40 tenants, 3 regions, residency in 1, hot-tenant skew 100:1.\n");

(async () => {
  console.log("=== PROBE 118b — advisor frame envelopes vs the uuid/message-id dedupe ===");
  const rows: { i: number; type: string; uuid: string; msgId: string; blocks: string[] }[] = [];
  let i = 0;
  for await (const m of query({
    prompt: "Read puzzle.md and give a one-sentence recommendation. If an advisor tool is available to you, consult it first.",
    options: {
      model: "claude-sonnet-5", cwd: dir, permissionMode: "bypassPermissions", settingSources: [],
      settings: JSON.stringify({ advisorModel: "claude-opus-4-8" }),
    } as any,
  })) {
    const mm = m as any;
    rows.push({
      i: i++,
      type: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type),
      uuid: String(mm.uuid ?? "(none)"),
      msgId: String(mm.message?.id ?? "-"),
      blocks: (Array.isArray(mm.message?.content) ? mm.message.content : []).map((b: any) => String(b?.type)),
    });
  }
  for (const r of rows) console.log(`#${r.i}  ${r.type}  uuid=${r.uuid}  msg=${r.msgId}  blocks=[${r.blocks.join(",")}]`);

  const advisorRows = rows.filter((r) => r.blocks.some((b) => b === "server_tool_use" || b === "advisor_tool_result"));
  console.log("\nadvisor-bearing frames:", advisorRows.map((r) => `#${r.i}(uuid=${r.uuid.slice(0, 8)}…,msg=${r.msgId.slice(0, 14)}…)`).join("  "));
  const uuids = new Set(advisorRows.map((r) => r.uuid));
  const assistants = rows.filter((r) => r.type === "assistant");
  const dupUuid = assistants.length !== new Set(assistants.map((r) => r.uuid)).size;
  console.log("\n================= VERDICT =================");
  if (advisorRows.length < 2) console.log("INCONCLUSIVE: advisor did not fire this run (consult is model-judged) — rerun.");
  else if (uuids.size === advisorRows.length && !dupUuid)
    console.log("SAFE: every assistant frame has a DISTINCT uuid — ccx's uuid-first dedupe keeps all advisor frames; shared message.id is irrelevant (the message-id arm only runs when uuid is absent). Plain append works; design needs no merge rule.");
  else
    console.log(`COLLISION: duplicate/absent uuids among assistant frames (advisor uuids distinct: ${uuids.size === advisorRows.length}) — the second advisor frame WILL be dropped at transcriptModel.ts:100-102; the bl7 design must merge same-message frames instead of appending.`);
})();
