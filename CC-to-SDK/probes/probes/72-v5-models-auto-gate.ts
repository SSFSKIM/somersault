// probes/probes/72-v5-models-auto-gate.ts — the Claude-5 generation vs our two stale model constants.
// Two questions, both settled by a live run (the A1 discipline — `ant models` would name the ids but cannot
// tell us what the INSTALLED sdk+CLI actually accepts, nor whether auto mode engages):
//   Q1  What does supportedModels() report? (Our DEFAULTS.model is claude-opus-4-8 and DEFAULT_AUTO_MODEL is
//       claude-sonnet-4-6; the user says "opus" should mean claude-opus-5 and "sonnet" claude-sonnet-5.)
//   Q2  Which of the v5 models support `auto` permission mode? autoModel.ts's SUPPORTED set lists only
//       4-6/4-7/4-8 — so today claude-fable-5 is treated as UNSUPPORTED and silently downgraded to
//       claude-sonnet-4-6 by resolveAutoModel. The user says fable supports auto.
//
// Q2 reuses probe 18d's discriminator verbatim, because it is the only signal that distinguishes "auto is
// active" from "auto silently fell back to default": with settingSources:[] and NO canUseTool, a benign
// in-cwd file edit is BLOCKED under `default` and AUTO-APPROVED by the classifier under a working `auto`.
// A model where auto ≡ default is a model where auto is unavailable.
//   set -a; . ../../.env; set +a; npx tsx probes/72-v5-models-auto-gate.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"];
const EDIT_PROMPT = "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.";

const userTurn = (text: string) => ({ type: "user" as const, message: { role: "user" as const, content: text }, parent_tool_use_id: null });
function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}

setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (600s) — probe wedged, exiting"); process.exit(2); }, 600_000).unref?.();

// ---------- Q1: the live catalog ----------
async function dumpCatalog() {
  console.log("=== Q1: supportedModels() from the installed SDK ===");
  const inp = inputQueue();
  const q: any = query({ prompt: inp.iterable as any, options: { model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any });
  inp.push(userTurn("Reply with exactly the single word READY."));
  for await (const m of q) { if ((m as any)?.type === "result") break; }
  let models: any = "<<threw>>";
  try { models = (await q.supportedModels?.()) ?? "<<nullish>>"; } catch (e) { models = `<<threw: ${(e as Error).message}>>`; }
  if (Array.isArray(models)) {
    console.log(`${models.length} models:`);
    for (const m of models) console.log(`  ${String(m?.value ?? m).padEnd(26)} ${m?.displayName ?? ""}${m?.description ? "  — " + m.description : ""}`);
  } else console.log(JSON.stringify(models)?.slice(0, 600));
  inp.close();
  await q.interrupt?.().catch(() => {});
  return models;
}

// ---------- Q2: does `auto` actually engage on this model? ----------
function freshDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `probe72-${tag}-`));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  return dir;
}

async function cell(model: string, mode: string) {
  const dir = freshDir(mode);
  const tools: string[] = []; let subtype: string | undefined, err: string | undefined;
  try {
    for await (const m of query({ prompt: EDIT_PROMPT, options: {
      model, cwd: dir, maxTurns: 6, permissionMode: mode as any, settingSources: [] as any,
    } as any })) {
      if ((m as any).type === "assistant") for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") tools.push(b.name);
      if ("result" in (m as any)) subtype = (m as any).subtype;
    }
  } catch (e: any) { err = e.message; }
  const changed = existsSync(join(dir, "note.txt")) && readFileSync(join(dir, "note.txt"), "utf8").includes("CHANGED");
  return { changed, tools: [...new Set(tools)], subtype, err };
}

const catalog = await dumpCatalog();
const names = Array.isArray(catalog) ? catalog.map((m: any) => String(m?.value ?? m)) : [];

console.log("\n=== Q2: auto-mode gate (18d discriminator: default blocks the cwd edit, working auto approves it) ===");
const verdict: Record<string, string> = {};
for (const model of CANDIDATES) {
  const inCatalog = names.length ? (names.includes(model) ? "in catalog" : "NOT in catalog") : "catalog unknown";
  const d = await cell(model, "default");
  const a = await cell(model, "auto");
  const v = d.err || a.err ? `ERR (default:${d.err ?? "-"} auto:${a.err ?? "-"})`
    : !d.changed && a.changed ? "AUTO SUPPORTED ✅"
    : d.changed ? "INCONCLUSIVE — default also edited (control failed)"
    : "auto ≡ default ⇒ AUTO UNSUPPORTED (silent fallback)";
  verdict[model] = v;
  console.log(`  ${model.padEnd(18)} [${inCatalog}]  default:changed=${d.changed} auto:changed=${a.changed}  → ${v}`);
  if (d.err || a.err) console.log(`      default err: ${d.err ?? "-"}\n      auto err:    ${a.err ?? "-"}`);
}

console.log("\n=== VERDICT ===");
for (const [m, v] of Object.entries(verdict)) console.log(`  ${m.padEnd(18)} ${v}`);
console.log("\nImplication for harness/src/config/autoModel.ts SUPPORTED and types.ts DEFAULTS.model:");
console.log("  add every model marked AUTO SUPPORTED; a model that is auto-unsupported must NOT be a default.");
process.exit(0);
