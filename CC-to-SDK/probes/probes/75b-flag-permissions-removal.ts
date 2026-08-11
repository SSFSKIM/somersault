// Probe 75b — the removal half of the U6 premise (plan-review finding 5): probe 75 proved a
// SECOND applyFlagSettings({permissions}) call is the mutation mechanism, but never re-sent a
// SHORTER array. sdk.d.ts says top-level keys REPLACE — declared, not observed. If the engine
// unions instead, /add-dir removal and /permissions rule deletion silently no-op.
//
//   Q1. Grant outside dir via applyFlagSettings({permissions:{additionalDirectories:[d]}}):
//       Read consults canUseTool? (expect NO — auto-allowed, replicating probe 75 Q4b)
//   Q2. Re-send {permissions:{additionalDirectories:[]}}: does the NEXT Read consult again?
//       (consult returns = the grant was really revoked = replacement, not union)
//   Q3. get_settings.effective after the shrink — does the flag layer show the empty array?
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe75b-${process.pid}`);
const root = join(base, "root");
const outside = join(base, "outside");
mkdirSync(root, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, "secret.txt"), "OUTSIDE-TOKEN-75B\n");

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

let consults = 0;
const q = query({
  prompt: input(),
  options: {
    model: "claude-haiku-4-5-20251001",
    cwd: root,
    settingSources: [],
    permissionMode: "default",
    maxTurns: 8,
    canUseTool: async (name, input) => {
      consults++;
      log(`canUseTool CONSULTED for ${name}`);
      return { behavior: "allow", updatedInput: input };
    },
  },
});

async function drainTurn(label: string): Promise<string> {
  let text = "";
  while (true) {
    const { value: m, done } = await q.next();   // manual .next(): for-await break kills the transport (probe 75)
    if (done) return text;
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b.type === "text") text += b.text;
    if (mm.type === "result") { log(`${label}: result=${mm.subtype}`); return text; }
  }
}

const READ = `Use the Read tool to read ${join(outside, "secret.txt")} and repeat its contents exactly. If the read fails, say READFAIL plus the error text.`;

try {
  await q.initializationResult();
  await q.applyFlagSettings({ permissions: { additionalDirectories: [outside] } });
  log("granted additionalDirectories=[outside]");

  consults = 0;
  send(READ);
  const a = await drainTurn("Q1 read-after-grant");
  log(`Q1 VERDICT: consulted=${consults} gotSecret=${a.includes("OUTSIDE-TOKEN-75B")}`);

  await q.applyFlagSettings({ permissions: { additionalDirectories: [] } });
  log("re-sent additionalDirectories=[] (the shrink)");
  try {
    const s = (await (q as any).request({ subtype: "get_settings" })) as any;
    log(`Q3 effective after shrink: ${JSON.stringify(s?.response?.effective).slice(0, 200)}`);
  } catch (e: any) { log(`Q3 get_settings FAILED — ${e?.message}`); }

  consults = 0;
  send(READ);
  const b = await drainTurn("Q2 read-after-shrink");
  log(`Q2 VERDICT: consulted=${consults} gotSecret=${b.includes("OUTSIDE-TOKEN-75B")} — consult back = REPLACEMENT confirmed; zero consults = UNION (removal broken)`);
} finally {
  closed = true;
  notify?.();
  q.close();
  rmSync(base, { recursive: true, force: true });
}
log("probe 75b done");
process.exit(0);
