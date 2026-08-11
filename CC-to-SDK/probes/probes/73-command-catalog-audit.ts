// probes/probes/73-command-catalog-audit.ts — the full live slash-command catalog, dumped for a coverage
// audit. The REPL merges this list into its palette (probe 30/31), so every name here is something a user
// can TAB-complete and press Enter on — which means every name we do not handle is a promise we break.
// Prints each entry's name + description so they can be classified: engine-side (works as a prompt, e.g. a
// skill) vs CLIENT-side (a real-CLI-only control: /cd, /add-dir, /exit …) vs already-local.
//   set -a; . ../../.env; set +a; npx tsx probes/73-command-catalog-audit.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const userTurn = (text: string) => ({ type: "user" as const, message: { role: "user" as const, content: text }, parent_tool_use_id: null });
function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () { while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); } })();
  return { iterable, push, close };
}

setTimeout(() => { console.log("\n!!! WATCHDOG (240s)"); process.exit(2); }, 240_000).unref?.();

const inp = inputQueue();
const q: any = query({ prompt: inp.iterable as any, options: { model: "claude-sonnet-5", permissionMode: "bypassPermissions" } as any });
inp.push(userTurn("Reply with exactly the single word READY."));
for await (const m of q) { if ((m as any)?.type === "result") break; }

let commands: any = "<<threw>>";
try { commands = (await q.supportedCommands?.()) ?? "<<nullish>>"; } catch (e) { commands = `<<threw: ${(e as Error).message}>>`; }

if (!Array.isArray(commands)) { console.log("catalog unavailable:", JSON.stringify(commands)?.slice(0, 400)); process.exit(1); }
console.log(`=== live slash-command catalog: ${commands.length} entries ===`);
for (const c of commands) {
  const name = String(c?.name ?? c);
  const hint = c?.argumentHint ? ` ${c.argumentHint}` : "";
  const desc = String(c?.description ?? "").split("\n")[0].slice(0, 92);
  console.log(`${name}${hint}\t${desc}`);
}
inp.close();
await q.interrupt?.().catch(() => {});
process.exit(0);
