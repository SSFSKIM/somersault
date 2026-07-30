// Probe 75 — the U6 evidence base: is a dynamic /add-dir reachable headlessly, and by which door?
//
// The spec's directory question: `register_repo_root` is a DECLARED control subtype
// (sdk.d.ts SDKControlRegisterRepoRootRequest: "directory must resolve to a subdirectory of cwd",
// with reload_claude_md/reload_skills/reload_plugins knobs) but it is NOT on the typed Query
// handle. Every typed control method funnels through an internal `this.request({subtype})` on the
// Query object — so the untyped door may be reachable as `(q as any).request(...)`. Separately,
// `permissions.additionalDirectories` is a Settings key, and `applyFlagSettings` is TYPED — a
// second, fully-typed door that might grant OUT-of-cwd access dynamically. Declared ≠ reachable;
// nothing has verified either at runtime.
//
//   Q1. Does the returned Query expose `.request` at runtime?
//   Q2. `register_repo_root` on a subdirectory of cwd: response shape; with reload_claude_md,
//       does the subdir's CLAUDE.md ACTUALLY enter context (magic-word turn)?
//   Q3. `register_repo_root` on a directory OUTSIDE cwd: exact failure text (or does it work?).
//   Q4. Out-of-cwd Read: consulted/denied before — and after
//       applyFlagSettings({permissions:{additionalDirectories:[outside]}}), allowed with no ask?
//   Q5. Untyped `get_settings`: response shape (grounds U7's /config).
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe75-${process.pid}`);
const root = join(base, "root");           // session cwd
const sub = join(root, "sub");             // inside cwd — register_repo_root's legal target
const outside = join(base, "outside");     // sibling of cwd — the /add-dir case that matters
mkdirSync(sub, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(sub, "CLAUDE.md"), "# sub\n\nThe magic word is XYZZY-SUB-42. State it when asked for the magic word.\n");
writeFileSync(join(outside, "secret.txt"), "OUTSIDE-TOKEN-77\n");

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

// pushable streaming input — control requests need streaming mode
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

const askedTools: string[] = [];
const q = query({
  prompt: input(),
  options: {
    model: "claude-haiku-4-5-20251001",
    cwd: root,
    settingSources: ["project"],
    permissionMode: "default",
    maxTurns: 12,
    // no allowedTools: a bare "Read" entry auto-approves and SHADOWS canUseTool (SDK warns)
    canUseTool: async (name, input) => {
      askedTools.push(name);
      log(`canUseTool CONSULTED for ${name} input=${JSON.stringify(input).slice(0, 200)}`);
      return { behavior: "allow", updatedInput: input };
    },
  },
});

// drain the shared iterator until this turn's result frame; log assistant text + tool results.
// Manual .next() — breaking out of `for await` calls the generator's return() and KILLS the
// transport (the first run's "ProcessTransport is not ready for writing" was exactly this).
async function drainTurn(label: string): Promise<string> {
  let text = "";
  while (true) {
    const { value: m, done } = await q.next();
    if (done) return text;
    const mm = m as any;
    if (mm.type === "assistant") for (const b of mm.message?.content ?? []) {
      if (b.type === "text") { text += b.text; }
      if (b.type === "tool_use") log(`${label}: tool_use ${b.name} ${JSON.stringify(b.input).slice(0, 160)}`);
    }
    if (mm.type === "user") for (const b of mm.message?.content ?? []) {
      if (b.type === "tool_result") log(`${label}: tool_result is_error=${b.is_error} ${JSON.stringify(b.content).slice(0, 240)}`);
    }
    if (mm.type === "result") { log(`${label}: result=${mm.subtype} — assistant said: ${JSON.stringify(text.slice(0, 200))}`); return text; }
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${ms}ms: ${what}`)), ms))]);

async function tryRequest(label: string, payload: object) {
  try {
    const res = await withTimeout((q as any).request(payload), 20_000, label);
    log(`${label}: OK response=${JSON.stringify(res).slice(0, 500)}`);
    return res;
  } catch (e: any) {
    log(`${label}: FAILED — ${e?.message}`);
    return null;
  }
}

try {
  await withTimeout(q.initializationResult(), 60_000, "init");
  log(`init ok; cwd=${root}`);

  // Q1 — the untyped door
  log(`Q1 typeof (q as any).request = ${typeof (q as any).request}`);

  // Q2 — legal register (subdir) with CLAUDE.md reload
  await tryRequest("Q2 register_repo_root(sub)", { subtype: "register_repo_root", directory: sub, reload_claude_md: true });
  send("What is the magic word declared in your CLAUDE.md context? Answer with only the word, or NONE if no magic word is in context.");
  const magic = await drainTurn("Q2b magic-word");
  log(`Q2b VERDICT: CLAUDE.md ${magic.includes("XYZZY-SUB-42") ? "INJECTED" : "NOT injected"}`);

  // Q3 — out-of-cwd register (the /add-dir shape)
  await tryRequest("Q3 register_repo_root(outside)", { subtype: "register_repo_root", directory: outside, reload_claude_md: false });

  // Q4a — out-of-cwd Read before any grant
  askedTools.length = 0;
  send(`Use the Read tool to read ${join(outside, "secret.txt")} and repeat its contents exactly. If the read fails, say READFAIL plus the error text.`);
  const before = await drainTurn("Q4a outside-read-before");
  log(`Q4a VERDICT: consulted=${askedTools.length} gotSecret=${before.includes("OUTSIDE-TOKEN-77")}`);

  // Q4b — grant via the TYPED door, then read again
  try {
    await withTimeout(q.applyFlagSettings({ permissions: { additionalDirectories: [outside] } }), 20_000, "applyFlagSettings");
    log("Q4b applyFlagSettings(additionalDirectories) OK");
  } catch (e: any) { log(`Q4b applyFlagSettings FAILED — ${e?.message}`); }
  askedTools.length = 0;
  send(`Read ${join(outside, "secret.txt")} again with the Read tool and repeat its contents exactly. If it fails, say READFAIL plus the error text.`);
  const after = await drainTurn("Q4b outside-read-after");
  log(`Q4b VERDICT: consulted=${askedTools.length} gotSecret=${after.includes("OUTSIDE-TOKEN-77")}`);

  // Q5 — get_settings shape for /config
  await tryRequest("Q5 get_settings", { subtype: "get_settings" });
} finally {
  closed = true;
  notify?.();
  q.close();
  rmSync(base, { recursive: true, force: true });
}
log("probe 75 done");
process.exit(0);
