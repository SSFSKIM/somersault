// probes/probes/27-supported-models-headless.ts — A1 for Increment B (#8 /model picker): does the SDK query
// control handle expose a USABLE model list headlessly? The dashboard m-cycle bug (Increment C) was traced to
// q.supportedModels?.() returning empty headless, but that was a code trace, not a live run. This probe calls
// supportedModels() (and supportedCommands() for context) on a real streaming query and prints what comes back.
// Decides the picker's source: a LIVE list (if non-empty + useful) vs a CURATED constant (if empty/undefined).
//   set -a; . ../../.env; set +a; npx tsx probes/27-supported-models-headless.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const userTurn = (text: string) => ({ type: "user" as const, message: { role: "user" as const, content: text }, parent_tool_use_id: null });

function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}

(async () => {
  console.log("=== probe 27: supportedModels() headless reachability ===");
  const inp = inputQueue();
  const q: any = query({ prompt: inp.iterable as any, options: { model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any });

  // Pump one tiny turn so the control handle is fully initialized (mirrors probe 24's pattern).
  inp.push(userTurn("Reply with exactly the single word READY."));
  let inited = false;
  const pump = (async () => { for await (const m of q) { const mm = m as any; if (mm?.type === "system" && mm?.subtype === "init") inited = true; if (mm?.type === "result") break; } })();
  await pump;
  console.log(`init frame seen: ${inited}`);

  // The decisive calls.
  let models: unknown = "<<threw>>", commands: unknown = "<<threw>>";
  try { models = (await q.supportedModels?.()) ?? "<<undefined (method absent or returned nullish)>>"; }
  catch (e) { models = `<<threw: ${(e as Error).message}>>`; }
  try { commands = (await q.supportedCommands?.()) ?? "<<undefined>>"; }
  catch (e) { commands = `<<threw: ${(e as Error).message}>>`; }

  console.log("\n--- supportedModels() ---");
  console.log("type:", Array.isArray(models) ? `array(len=${(models as unknown[]).length})` : typeof models);
  console.log(JSON.stringify(models, null, 2)?.slice(0, 2000));
  console.log("\n--- supportedCommands() (context) ---");
  console.log("type:", Array.isArray(commands) ? `array(len=${(commands as unknown[]).length})` : typeof commands);
  console.log(JSON.stringify(commands, null, 2)?.slice(0, 1200));

  console.log("\n--- verdict ---");
  if (Array.isArray(models) && models.length > 0) console.log("LIVE LIST USABLE: supportedModels() returns a non-empty array headless → /model picker can use it");
  else console.log("EMPTY/UNREACHABLE: supportedModels() is empty/absent headless → /model picker must use a CURATED list (matches the dashboard m-bug trace)");

  inp.close();
  await q.interrupt?.().catch(() => {});
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
