// Probe 82 — ARE THERE PER-BLOCK TIMESTAMPS ON THE THINKING STREAM?
//
// Gates TR33 (a live-ticking `Thought for 12s` duration row) and the F3 collapsed-group elapsed
// suffix (LT2/LT5). If the wire carries real per-block or per-event timestamps the clone renders
// engine-truth durations; if it does not, the clone must clock LOCAL ARRIVAL TIME and the design
// has to say so out loud.
//
// Declared surface (sdk.d.ts 0.3.220) says: SDKPartialAssistantMessage = {type,event,parent_tool_use_id,
// uuid,session_id,ttft_ms?} — no timestamp; SDKAssistantMessage/SDKUserMessage carry an OPTIONAL
// `timestamp?: string` ("older emitters omit it; fall back to receive time"). Declared ≠ reachable,
// so this probe checks what the installed engine actually emits.
//
// Method: one bounded turn with includePartialMessages + thinking enabled + exactly one cheap Read.
// Every frame is stamped with Date.now() at receipt, then walked for ANY time-ish key at ANY depth
// (exact key paths recorded, never paraphrased). Thinking deltas are bucketed by content-block index
// so we can tell whether a per-block timer is even scopeable. Finally the on-disk transcript is
// scanned the same way, since F3's replay path reads it rather than the live stream.
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const MODEL = "claude-sonnet-4-6"; // thinking-capable, cheap
const DEADLINE_MS = 180_000;
const TARGET = "/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/package.json";
// Long enough to produce a multi-second thinking burst (so the duration measurement is not noise),
// but bounded to exactly one cheap tool call.
const PROMPT =
  `Reason step by step through this before answering: three friends — Ana, Ben, Cara — each have a ` +
  `different pet (cat, dog, fish) and a different shirt (red, green, blue). Ana's shirt isn't red. ` +
  `The dog owner wears blue. Cara has the fish. Ben isn't wearing green. Who owns the cat and what ` +
  `colour do they wear? Then use the Read tool exactly once on ${TARGET} and reply with ONE sentence ` +
  `giving both the puzzle answer and the package name. Do not use any other tool.`;

// --- key-path walking -------------------------------------------------------
const TIMEISH = /(time|timestamp|_at$|^at$|date|epoch|elapsed|duration|_ms$|ttft|started|ended|start_time|end_time)/i;

function walk(v: unknown, base = "", out: { paths: string[]; timeish: { path: string; value: string }[] }, depth = 0): void {
  if (depth > 8 || v === null || typeof v !== "object") return;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const path = base ? `${base}.${k}` : k;
    const leaf = val === null || typeof val !== "object";
    if (leaf) {
      out.paths.push(path);
      if (TIMEISH.test(k)) out.timeish.push({ path, value: String(val).slice(0, 60) });
    } else if (Array.isArray(val)) {
      out.paths.push(`${path}[]`);
      // walk only the first two elements; array index is noise for a shape census
      val.slice(0, 2).forEach((el) => walk(el, `${path}[]`, out, depth + 1));
    } else {
      walk(val, path, out, depth + 1);
    }
  }
}

interface ClassRec { n: number; paths: Set<string>; timeish: Map<string, string>; sample?: unknown; firstAtMs: number; lastAtMs: number }
const classes = new Map<string, ClassRec>();

function record(cls: string, frame: unknown, atMs: number): void {
  let rec = classes.get(cls);
  if (!rec) { rec = { n: 0, paths: new Set(), timeish: new Map(), firstAtMs: atMs, lastAtMs: atMs }; classes.set(cls, rec); }
  rec.n++; rec.lastAtMs = atMs;
  const out = { paths: [] as string[], timeish: [] as { path: string; value: string }[] };
  walk(frame, "", out);
  out.paths.forEach((p) => rec!.paths.add(p));
  out.timeish.forEach((t) => { if (!rec!.timeish.has(t.path)) rec!.timeish.set(t.path, t.value); });
  if (!rec.sample) rec.sample = frame;
}

// --- timing ledger ----------------------------------------------------------
const t0 = Date.now();
const rel = () => Date.now() - t0;
// per content-block timeline (arrival ms, relative). NOTE: `event.index` restarts at 0 on every API
// message, so a per-block timer must be keyed by (message ordinal, index) — keying by index alone
// makes a later text block overwrite the earlier thinking block. That is itself a finding.
interface BlockRec { key: string; index: number; msgSeq: number; kind: string; startAt?: number; firstDeltaAt?: number; lastDeltaAt?: number; sigAt?: number; stopAt?: number; deltas: number; chars: number }
const blocks = new Map<string, BlockRec>();
let msgSeq = 0;
const bkey = (i: number) => `${msgSeq}:${i}`;
const toolUseAt = new Map<string, number>();   // tool_use_id -> arrival ms (assistant message)
const toolResultAt = new Map<string, number>(); // tool_use_id -> arrival ms (user message)
let assistantTimestamps: { ts: string | undefined; atMs: number; wallMs: number; kinds: string }[] = [];
let sessionId: string | undefined;
let streamEventHasSession = 0, streamEventHasParent = 0, streamEventHasUuid = 0, streamEventTtft: number | undefined;
let deltaWithIndex = 0, deltaWithoutIndex = 0;

console.log("=== PROBE 82 — per-block timestamps on the thinking stream ===");
console.log(`model=${MODEL} deadline=${DEADLINE_MS}ms includePartialMessages=true thinking=enabled(6000)`);

const ac = new AbortController();
const killer = setTimeout(() => { console.log(`\n!! DEADLINE ${DEADLINE_MS}ms hit — aborting, reporting partial aggregates`); ac.abort(); }, DEADLINE_MS);

let result: any;
let aborted = false;
try {
  for await (const m of query({
    prompt: PROMPT,
    options: {
      model: MODEL,
      permissionMode: "bypassPermissions",
      maxTurns: 3,
      includePartialMessages: true,
      thinking: { type: "enabled", budgetTokens: 6000 } as any,
      allowedTools: ["Read"],
      settingSources: [] as any,
      abortController: ac,
    } as any,
  })) {
    const mm = m as any;
    const atMs = rel();

    if (mm.type === "stream_event") {
      const ev = mm.event ?? {};
      const bt = ev.content_block?.type ?? ev.delta?.type ?? "";
      record(`stream_event:${ev.type}${bt ? `(${bt})` : ""}`, mm, atMs);
      if (typeof mm.session_id === "string") streamEventHasSession++;
      if ("parent_tool_use_id" in mm) streamEventHasParent++;
      if (typeof mm.uuid === "string") streamEventHasUuid++;
      if (typeof mm.ttft_ms === "number" && streamEventTtft === undefined) streamEventTtft = mm.ttft_ms;

      if (ev.type === "message_start") msgSeq++;
      const idx: number | undefined = typeof ev.index === "number" ? ev.index : undefined;
      if (ev.type === "content_block_start" && idx !== undefined) {
        blocks.set(bkey(idx), { key: bkey(idx), index: idx, msgSeq, kind: ev.content_block?.type ?? "?", startAt: atMs, deltas: 0, chars: 0 });
      }
      if (ev.type === "content_block_delta") {
        if (idx === undefined) deltaWithoutIndex++; else deltaWithIndex++;
        if (idx !== undefined) {
          const b = blocks.get(bkey(idx)) ?? { key: bkey(idx), index: idx, msgSeq, kind: "?", deltas: 0, chars: 0 };
          b.deltas++;
          const d = ev.delta ?? {};
          const text: string = d.thinking ?? d.text ?? d.partial_json ?? "";
          b.chars += text.length;
          if (d.type === "thinking_delta" && b.firstDeltaAt === undefined) b.firstDeltaAt = atMs;
          if (d.type === "signature_delta") b.sigAt = atMs;
          b.lastDeltaAt = atMs;
          blocks.set(bkey(idx), b);
        }
      }
      if (ev.type === "content_block_stop" && idx !== undefined) {
        const b = blocks.get(bkey(idx)); if (b) { b.stopAt = atMs; blocks.set(bkey(idx), b); }
      }
      continue;
    }

    if (mm.type === "assistant") {
      const content = mm.message?.content ?? [];
      const kinds = content.map((b: any) => b?.type).join("+") || "-";
      record(`assistant(${kinds})`, mm, atMs);
      assistantTimestamps.push({ ts: mm.timestamp, atMs, wallMs: Date.now(), kinds });
      for (const b of content) if (b?.type === "tool_use") toolUseAt.set(b.id, atMs);
      continue;
    }

    if (mm.type === "user") {
      const content = mm.message?.content;
      const kinds = Array.isArray(content) ? content.map((b: any) => b?.type).join("+") : typeof content;
      record(`user(${kinds})`, mm, atMs);
      if (Array.isArray(content)) for (const b of content) if (b?.type === "tool_result") toolResultAt.set(b.tool_use_id, atMs);
      continue;
    }

    if (mm.type === "system") {
      record(`system:${mm.subtype}`, mm, atMs);
      if (mm.subtype === "init") { sessionId = mm.session_id; console.log(`[init +${atMs}ms] session=${mm.session_id} model=${mm.model}`); }
      continue;
    }

    if (mm.type === "result") { record("result", mm, atMs); result = mm; continue; }
    record(`other:${mm.type}`, mm, atMs);
  }
} catch (e: any) {
  aborted = true;
  console.log(`stream threw: ${e?.message ?? e}`);
}
clearTimeout(killer);
const turnMs = rel();

// --- on-disk transcript (the F3 replay path) --------------------------------
let diskScan = "not read";
if (sessionId) {
  try {
    const ms: any[] = await getSessionMessages(sessionId);
    const out = { paths: [] as string[], timeish: [] as { path: string; value: string }[] };
    ms.forEach((e) => walk(e, "", out));
    const uniq = [...new Map(out.timeish.map((t) => [t.path, t.value])).values()];
    const uniqPaths = [...new Set(out.timeish.map((t) => t.path))];
    diskScan = `${ms.length} entries; time-ish paths: ${uniqPaths.length ? uniqPaths.join(", ") : "(none)"}` +
      (uniq.length ? ` | sample values: ${uniq.slice(0, 4).join(" , ")}` : "");
    const first = ms[0], last = ms[ms.length - 1];
    if (first || last) diskScan += `\n  first entry keys: ${Object.keys(first ?? {}).join(",")}\n  last  entry keys: ${Object.keys(last ?? {}).join(",")}`;
  } catch (e: any) { diskScan = `THREW: ${e?.message}`; }
}

// --- report -----------------------------------------------------------------
console.log(`\n--- FRAME CLASS CENSUS (turn ${turnMs}ms${aborted ? ", ABORTED" : ""}) ---`);
for (const [cls, r] of classes) {
  const t = [...r.timeish.entries()];
  console.log(`\n[${cls}] n=${r.n} first=+${r.firstAtMs}ms last=+${r.lastAtMs}ms`);
  console.log(`  time-ish key paths: ${t.length ? t.map(([p, v]) => `${p}=${v}`).join(" | ") : "NONE"}`);
  console.log(`  all leaf key paths: ${[...r.paths].join(", ")}`);
}

console.log("\n--- REPRESENTATIVE DUMPS (trimmed to 700 chars) ---");
for (const [cls, r] of classes) {
  console.log(`\n[${cls}]\n${JSON.stringify(r.sample, (k, v) => (typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v)).slice(0, 700)}`);
}

console.log("\n--- ASSISTANT MESSAGE .timestamp FIELD ---");
if (!assistantTimestamps.length) console.log("  (no assistant messages)");
assistantTimestamps.forEach((a, i) => {
  const skew = a.ts ? a.wallMs - Date.parse(a.ts) : undefined;
  console.log(`  msg${i} kinds=${a.kinds} arrivedAt=+${a.atMs}ms timestamp=${a.ts === undefined ? "ABSENT" : a.ts}` +
    (skew === undefined ? "" : ` | localArrival - wireTimestamp = ${skew}ms`));
});
if (assistantTimestamps.length >= 2 && assistantTimestamps.every((a) => a.ts)) {
  const f = assistantTimestamps[0]!, l = assistantTimestamps[assistantTimestamps.length - 1]!;
  console.log(`  wire span first→last = ${Date.parse(l.ts!) - Date.parse(f.ts!)}ms | local arrival span = ${l.atMs - f.atMs}ms (agreement check)`);
}

console.log("\n--- PER-BLOCK ARRIVAL TIMELINE (local Date.now deltas, ms since first frame) ---");
console.log("  (keyed msgSeq:index — event.index RESTARTS at 0 per API message)");
for (const b of [...blocks.values()]) {
  const spanFirstToStop = b.firstDeltaAt !== undefined && b.stopAt !== undefined ? b.stopAt - b.firstDeltaAt : undefined;
  const spanStartToStop = b.startAt !== undefined && b.stopAt !== undefined ? b.stopAt - b.startAt : undefined;
  console.log(`  block[${b.key}] kind=${b.kind} start=+${b.startAt ?? "-"} firstDelta=+${b.firstDeltaAt ?? "-"} lastDelta=+${b.lastDeltaAt ?? "-"} signature=+${b.sigAt ?? "-"} stop=+${b.stopAt ?? "-"} deltas=${b.deltas} chars=${b.chars}`);
  console.log(`            → start→stop=${spanStartToStop ?? "n/a"}ms  firstThinkingDelta→stop=${spanFirstToStop ?? "n/a"}ms`);
}

console.log("\n--- TOOL CALL ARRIVAL SPANS ---");
if (!toolUseAt.size) console.log("  (no tool_use blocks)");
for (const [id, useAt] of toolUseAt) {
  const resAt = toolResultAt.get(id);
  console.log(`  ${id}: tool_use@+${useAt}ms  tool_result@${resAt !== undefined ? `+${resAt}ms` : "MISSING"}  span=${resAt !== undefined ? resAt - useAt : "n/a"}ms`);
}

console.log("\n--- STREAM_EVENT ATTRIBUTION ---");
console.log(`  frames with session_id: ${streamEventHasSession} | with parent_tool_use_id key: ${streamEventHasParent} | with uuid: ${streamEventHasUuid}`);
console.log(`  ttft_ms observed: ${streamEventTtft ?? "ABSENT"}`);
console.log(`  content_block_delta with numeric .index: ${deltaWithIndex} | without: ${deltaWithoutIndex}`);

console.log("\n--- ON-DISK TRANSCRIPT SCAN (F3 replay path) ---");
console.log(`  ${diskScan}`);

const anyWireTimestamp = [...classes.values()].some((r) => r.timeish.size > 0);
const thinkingBlock = [...blocks.values()].find((b) => b.kind === "thinking");
console.log("\n=== VERDICT ===");
console.log(`  any time-ish key on ANY live frame: ${anyWireTimestamp ? "YES (see census above)" : "NO"}`);
console.log(`  assistant .timestamp present:       ${assistantTimestamps.some((a) => a.ts !== undefined) ? "YES" : "NO (all ABSENT)"}`);
console.log(`  thinking block measurable locally:  ${thinkingBlock ? `YES (block[${thinkingBlock.key}] ${thinkingBlock.startAt !== undefined && thinkingBlock.stopAt !== undefined ? thinkingBlock.stopAt - thinkingBlock.startAt : "?"}ms of arrival span, ${thinkingBlock.deltas} deltas)` : "NO thinking block observed"}`);
console.log(`RESULT: ${thinkingBlock && result && !result.is_error ? "PASS (measured)" : aborted ? "PARTIAL (deadline/abort)" : "INCOMPLETE — no thinking block or errored result"}`);
process.exit(0);
