// probes/probes/26-context-1m-header.ts — A1: is the CC-faithful 1M-context mechanism reachable headlessly?
// CC enables 1M only when the model id carries [1m]: it sends the `anthropic-beta: context-1m-2025-08-07`
// header and strips [1m] from the model. The Agent SDK passes custom headers via ANTHROPIC_CUSTOM_HEADERS,
// which the harness wires from `customHeaders`. This probe opens two sessions on the SAME bare model — one
// with the beta header, one without — and compares getContextUsage().maxTokens (the practical signal for the
// effective window). Run keyed:  set -a; . ../../.env; set +a; npx tsx probes/26-context-1m-header.ts
import { openSession } from "../../harness/dist/index.js";   // probes workspace has no cc-harness dep; import built dist directly

const BETA = "context-1m-2025-08-07";
const MODEL = "claude-opus-4-8";                       // bare id; [1m] is stripped before the SDK sees it
const ping = "Reply with exactly the single word OK.";

async function windowFor(label: string, customHeaders?: Record<string, string>): Promise<unknown> {
  const session = openSession({ model: MODEL, permissionMode: "bypassPermissions", ...(customHeaders ? { customHeaders } : {}) } as any);
  try {
    await session.submit(ping, () => {});             // one tiny turn so usage is populated
    const usage = await session.getContextUsage();
    console.log(`\n[${label}] getContextUsage =`, JSON.stringify(usage));
    return (usage as any)?.maxTokens ?? (usage as any)?.max_tokens;
  } catch (e) {
    console.log(`\n[${label}] ERROR:`, (e as Error).message);
    return null;
  } finally {
    await session.dispose();
  }
}

(async () => {
  console.log("=== probe 26: context-1m header reachability ===");
  const plain = await windowFor("plain (no beta)");
  const beta = await windowFor("beta (context-1m)", { "anthropic-beta": BETA });
  console.log("\n--- verdict ---");
  console.log(`plain maxTokens = ${plain}`);
  console.log(`beta  maxTokens = ${beta}`);
  if (beta && plain && Number(beta) > Number(plain) * 2) console.log("REACHABLE: beta header expands the window (1M mechanism works headlessly)");
  else if (beta && plain && Number(beta) === Number(plain)) console.log("INCONCLUSIVE/UNREACHABLE: header accepted but maxTokens unchanged (entitlement? or usage doesn't reflect window)");
  else console.log("CHECK ABOVE: error or unexpected — interpret the raw getContextUsage dumps");
})();
