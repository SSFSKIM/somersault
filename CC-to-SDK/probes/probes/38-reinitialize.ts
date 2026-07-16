// Probe 38 — `reinitialize()` (0.3.211) + `interrupt()` receipt, for Wave 1 daemon control-channel recovery.
//
// Declared surface (sdk.d.ts 0.3.211, Query.reinitialize): "Re-send the `initialize` control request to
// an already-running CLI … the CLI's response carries any can_use_tool / request_user_dialog control
// requests the loop is still blocked on, and the SDK redelivers them to canUseTool / onUserDialog.
// In-flight request_ids are deduped SDK-side, but callbacks should be idempotent per request_id."
//
// Design-blocking questions for the daemon reattach story (supervisor holds ONE Query per session):
//   A. LIVENESS — does reinitialize() resolve mid-session with a fresh init response (what fields?),
//      and does the session keep working afterwards (next turn completes)?
//   B. PARKED-PERMISSION REDELIVERY vs DEDUP — with a can_use_tool parked (broker never resolved),
//      does reinitialize() re-dispatch the SAME request to canUseTool (redelivery), or is it deduped
//      because the first dispatch is still in flight in this same SDK process? Either answer decides
//      the daemon design: dedup ⇒ reinitialize is only useful for a FRESH SDK attach; redelivery ⇒
//      the daemon can use it to re-park lost permission requests after a client gap.
//   C. interrupt() RECEIPT — 0.3.211 changed interrupt() to return a receipt; capture its shape for
//      daemon event absorption.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe38-"));
writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
console.log("=== PROBE 38 reinitialize ===\ncwd:", dir);
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (300s) — probe wedged, exiting"); process.exit(2); }, 300_000).unref?.();

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

// broker that PARKS every call until autoAllow flips (run-1 lesson: a turn can park SEVERAL calls in
// sequence — Read then Edit — so a one-shot "resolve what's parked now" resolver deadlocks the turn)
let autoAllow = false;
const brokerCalls: { toolName: string; ctx: string; at: number; resolve: (v: any) => void }[] = [];
const canUseTool = (toolName: string, _input: unknown, ctx: unknown) =>
  new Promise<any>((resolve) => {
    brokerCalls.push({ toolName, ctx: brief(ctx, 200), at: Date.now(), resolve });
    console.log(`  [broker] call #${brokerCalls.length}: ${toolName} ctx=${brief(ctx, 160)}`);
    if (autoAllow) resolve({ behavior: "allow", updatedInput: undefined });
  });

const q = inputQueue();
const handle: any = query({
  prompt: q.iterable as any,
  options: {
    model: "claude-sonnet-4-6", permissionMode: "default", cwd: dir, maxTurns: 20,
    settingSources: [] as any, canUseTool: canUseTool as any,
  } as any,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let phase = "A1";
let a1done!: () => void; const a1 = new Promise<void>((r) => (a1done = r));
let bdone!: () => void; const b = new Promise<void>((r) => (bdone = r));
let cdone!: () => void; const c = new Promise<void>((r) => (cdone = r));

const consume = (async () => {
  for await (const m of handle) {
    const mm = m as any;
    if (mm.type === "system" && mm.subtype === "init") console.log("[init] session:", mm.session_id, "model:", mm.model);
    if (mm.type === "result") {
      console.log(`[result:${phase}] subtype:`, mm.subtype, "| text:", brief(mm.result, 120));
      if (phase === "A1") a1done();
      else if (phase === "B") bdone();
      else if (phase === "C") cdone();
    }
  }
})().catch((e) => console.log("[stream ended]", brief(String(e), 200)));

// ---- Phase A: liveness — plain turn, then reinitialize(), inspect response ----
q.push(userTurn("Reply with exactly: PONG"));
await a1;
console.log("\n[A] calling reinitialize() on the live query…");
try {
  const init2 = await handle.reinitialize();
  console.log("[A] reinitialize resolved ✅ keys:", Object.keys(init2 ?? {}).join(","), "| full:", brief(init2, 500));
} catch (e) {
  console.log("[A] reinitialize THREW ❌:", brief(String(e), 300));
}

// ---- Phase B: park a permission, reinitialize, watch for redelivery vs dedup ----
phase = "B";
console.log("\n[B] sending an Edit turn under default mode (broker will PARK it)…");
q.push(userTurn("Edit note.txt, replacing ORIGINAL with CHANGED. Do nothing else."));
const t0 = Date.now();
while (brokerCalls.length === 0 && Date.now() - t0 < 60_000) await sleep(200);
const callsBefore = brokerCalls.length;
console.log("[B] parked broker calls:", callsBefore, "— now reinitialize() while parked…");
try {
  const init3 = await handle.reinitialize();
  console.log("[B] reinitialize resolved | pending control requests visible in response?:", brief(init3, 400));
} catch (e) {
  console.log("[B] reinitialize THREW:", brief(String(e), 300));
}
await sleep(4000); // allow any redelivery to dispatch
const redelivered = brokerCalls.length - callsBefore;
console.log(`[B] broker calls after reinitialize: ${brokerCalls.length} (Δ=${redelivered}) → ${redelivered > 0 ? "REDELIVERY ✅ (must be idempotent per request_id)" : "DEDUPED (in-flight request not re-dispatched in-process)"}`);
console.log("[B] resolving ALL parked calls with allow (+ auto-allow any later parks this run)…");
autoAllow = true;
for (const call of brokerCalls) call.resolve({ behavior: "allow", updatedInput: undefined });
await Promise.race([b, sleep(90_000)]);
const noteNow = readFileSync(join(dir, "note.txt"), "utf8");
console.log("[B] note.txt after allow:", brief(noteNow.trim(), 60), "| edit landed:", noteNow.includes("CHANGED"));

// ---- Phase C: interrupt() receipt shape ----
phase = "C";
console.log("\n[C] sending a slow turn, then interrupt() after 3s…");
q.push(userTurn("Write a numbered list of 200 distinct animal species. Do not use any tools."));
await sleep(3000);
try {
  const receipt = await handle.interrupt();
  console.log("[C] interrupt receipt ✅ typeof:", typeof receipt, "| value:", brief(receipt, 400));
} catch (e) {
  console.log("[C] interrupt THREW:", brief(String(e), 300));
}
await Promise.race([c, sleep(15_000)]);

q.close();
await Promise.race([consume, sleep(5000)]);
try { await handle.close?.(); } catch {}
console.log("\n=== VERDICT ===");
console.log("reinitialize liveness:", "see [A]", "| parked-permission redelivery:", redelivered > 0 ? "YES" : "NO (dedup)", "| interrupt receipt:", "see [C]");
process.exit(0);
