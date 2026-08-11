// Probe 76 — U7's output-style question: is /output-style implementable headlessly, mid-session?
//
// The init response DECLARES `output_style` + `available_output_styles`, and `outputStyle` is a
// Settings key — so `applyFlagSettings({outputStyle})` is the candidate lever. Declared ≠ reachable:
// nothing says the CLI re-derives the system prompt mid-session when the flag layer changes.
//
//   Q1. What does available_output_styles actually list at init (and what is the default)?
//   Q2. Is applyFlagSettings({outputStyle:"Explanatory"}) accepted, and does get_settings.effective
//       reflect it?
//   Q3. Does it take effect MID-SESSION — does the model's next turn see the style's injected
//       instructions? (Explanatory's fingerprint: the "★ Insight" block convention.)
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

const pending: SDKUserMessage[] = [];
let notify: (() => void) | null = null;
let closed = false;
async function* input(): AsyncIterable<SDKUserMessage> {
  while (!closed) {
    while (pending.length) yield pending.shift()!;
    await new Promise<void>((r) => (notify = r));
  }
}
function send(text: string) {
  pending.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" } as SDKUserMessage);
  notify?.();
}

const q = query({
  prompt: input(),
  options: { model: "claude-haiku-4-5-20251001", settingSources: [], permissionMode: "default", maxTurns: 8, cwd: process.cwd() },
});

async function drainTurn(label: string): Promise<string> {
  let text = "";
  while (true) {
    const { value: m, done } = await q.next();   // manual .next(): for-await break kills the transport (probe 75)
    if (done) return text;
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b.type === "text") text += b.text;
    if (mm.type === "result") { log(`${label}: result=${mm.subtype} said=${JSON.stringify(text.slice(0, 300))}`); return text; }
  }
}

const STYLE_PROBE = "Answer in one short sentence: according to your current system instructions, are you required to include any specially formatted 'Insight' blocks or educational explanations in your responses? Quote the marker if so.";

try {
  const init = await q.initializationResult();
  log(`Q1 output_style=${JSON.stringify((init as any).output_style)} available=${JSON.stringify((init as any).available_output_styles)}`);

  send(STYLE_PROBE);
  const before = await drainTurn("Q3a before-style");

  try {
    await q.applyFlagSettings({ outputStyle: "Explanatory" } as any);
    log("Q2 applyFlagSettings({outputStyle:'Explanatory'}) OK");
  } catch (e: any) { log(`Q2 applyFlagSettings FAILED — ${e?.message}`); }
  try {
    const s = await (q as any).request({ subtype: "get_settings" });
    log(`Q2 get_settings.effective=${JSON.stringify(s?.response?.effective ?? s).slice(0, 300)}`);
  } catch (e: any) { log(`Q2 get_settings FAILED — ${e?.message}`); }

  send(STYLE_PROBE);
  const after = await drainTurn("Q3b after-style");
  const fp = (s: string) => /insight|★/i.test(s) && !/no|not required|don't/i.test(s.slice(0, 60));
  log(`Q3 VERDICT: before mentions insight-marker=${/★|insight/i.test(before)} after=${/★|insight/i.test(after)} (read the two answers above — the fingerprint is the style's injected ★ Insight convention)`);
  void fp;
} finally {
  closed = true;
  notify?.();
  q.close();
}
log("probe 76 done");
process.exit(0);
