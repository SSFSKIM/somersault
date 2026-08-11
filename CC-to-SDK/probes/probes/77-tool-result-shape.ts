// Probe 77 — the gating question for the W4 transcript-fidelity work: does the SDK hand a CLIENT
// enough to render upstream's TYPED tool-result summaries, or only raw text?
//
// The bundle research (w4-research/01-live-turn.md) found every upstream result row is built from a
// STRUCTURED payload — `Read 340 lines`, `Found 3 files`, `Added 2 lines, removed 3 lines`,
// `Wrote 42 lines` — and that its diff renderer numbers lines from `structuredPatch[].oldStart`
// (absolute file lines, not snippet-relative). Upstream is the CLI itself, so it sees the tool's own
// return value. We only see what crosses the SDK wire. Declared ≠ reachable: nothing says the wire
// carries more than a text blob.
//
//   Q1. For each tool (Read/Grep/Glob/Bash/Write/Edit/TodoWrite), what EXACTLY is in the tool_result
//       block — string? array of blocks? a typed object? Dump the raw shape, untruncated for small ones.
//   Q2. Does anything carry structuredPatch / line counts / match counts — i.e. can `Read 340 lines`
//       and absolute diff line numbers be COMPUTED, or must they be re-derived by us from the text?
//   Q3. Do any non-message frames (stream_event, system) carry richer per-tool metadata than the
//       assistant/user pair does?
// RESULT (run 2026-07-31, sonnet-4-6, keyed): the wire is FLAT TEXT. Every tool_result block carried
// ONLY `{tool_use_id, type, content, is_error?}` and `content` was a plain string — no structuredPatch,
// no line counts, no match counts, no typed payload of any kind. (Sole exception: ToolSearch returns an
// array of `{type:"tool_reference", tool_name}` — a tool-specific shape, not a general metadata channel.)
// So upstream's typed summaries are NOT handed to us; a client must DERIVE them:
//   * Read   → count lines of the result text (it is the numbered file body)      → `Read 40 lines` ✅
//   * Grep/Glob → count result lines                                              → `Found N files`  ✅
//   * Write  → count lines of tool_use.input.content                              → `Wrote 3 lines`  ✅
//   * Edit   → diff input.old_string vs input.new_string                          → added/removed    ✅
//   * Edit ABSOLUTE file line numbers → NOT derivable from the wire (we never see the file). Our REPL
//     is a LOCAL client sharing the cwd, so reading the file ourselves is the only route — a design
//     choice, not a blocker.
// Also observed, and it changes the collapse-clause vocabulary: this SDK's tool set is NOT upstream's.
// The model reached for Bash to grep/glob, there is no TodoWrite (it is TaskCreate/TaskUpdate, deferred
// behind ToolSearch), and no LS tool exists — so upstream's per-tool clause table cannot be copied 1:1.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe77-${process.pid}`);
mkdirSync(base, { recursive: true });
// A file with a KNOWN line count (40) so we can tell a real count from a coincidence.
writeFileSync(join(base, "target.ts"), Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n");
writeFileSync(join(base, "other.ts"), "export const NEEDLE_ALPHA = 1;\nexport const plain = 2;\n");
writeFileSync(join(base, "third.ts"), "export const NEEDLE_ALPHA = 3;\n");

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
  options: {
    model: "claude-sonnet-4-6",            // tool-heavy turn; haiku picks fewer tools
    cwd: base,
    settingSources: [],
    permissionMode: "bypassPermissions",   // no broker: we want the tool wire, not the ask wire
    maxTurns: 24,
    includePartialMessages: true,          // Q3: does any stream_event carry richer tool metadata?
  },
});

/** Print a value with its TYPE structure intact — the point of the probe is shape, not prose. */
function shape(v: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[\n${v.map((x) => pad + "  " + shape(x, depth + 1)).join(",\n")}\n${pad}]`;
  if (typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>);
    return `{\n${e.map(([k, x]) => `${pad}  ${k}: ${shape(x, depth + 1)}`).join(",\n")}\n${pad}}`;
  }
  if (typeof v === "string") return v.length > 220 ? `"${v.slice(0, 220)}…"(len=${v.length}, lines=${v.split("\n").length})` : JSON.stringify(v);
  return String(v);
}

const seenTools = new Map<string, string>();   // tool_use_id → tool name
const streamEventKinds = new Set<string>();

async function drainTurn(label: string): Promise<void> {
  while (true) {
    const { value: m, done } = await q.next();   // manual .next(): a for-await break kills the transport (probe 75)
    if (done) return;
    const mm = m as any;
    if (mm.type === "stream_event") { streamEventKinds.add(String(mm.event?.type)); continue; }
    if (mm.type === "assistant") {
      for (const b of mm.message?.content ?? []) {
        if (b?.type === "tool_use") { seenTools.set(b.id, b.name); log(`TOOL_USE ${b.name} input=${shape(b.input)}`); }
      }
    }
    if (mm.type === "user") {
      for (const b of mm.message?.content ?? []) {
        if (b?.type !== "tool_result") continue;
        const name = seenTools.get(b.tool_use_id) ?? "?";
        // The whole probe is this line: EVERY key on the result block, with the content's real type.
        log(`TOOL_RESULT ${name} keys=[${Object.keys(b).join(",")}] contentType=${Array.isArray(b.content) ? "array" : typeof b.content}`);
        log(`  block=${shape(b)}`);
      }
    }
    if (mm.type === "result") { log(`${label}: result=${mm.subtype}`); return; }
  }
}

try {
  await q.initializationResult();

  send([
    "Do these steps with tools, no commentary:",
    "1. Read target.ts in full.",
    "2. Grep for NEEDLE_ALPHA across this directory.",
    "3. Glob for *.ts here.",
    "4. Run the shell command: wc -l target.ts",
    "5. Write a new file made.ts containing three export lines.",
    "6. Edit target.ts changing `export const v0 = 0;` to `export const v0 = 999;`.",
    "7. Use TodoWrite to record one completed todo.",
  ].join("\n"));
  await drainTurn("tool sweep");

  log(`Q3 stream_event kinds seen: ${JSON.stringify([...streamEventKinds])}`);
  log(`tools exercised: ${JSON.stringify([...new Set(seenTools.values())])}`);
} finally {
  closed = true;
  notify?.();
  q.close();
  rmSync(base, { recursive: true, force: true });
}
log("probe 77 done");
process.exit(0);
