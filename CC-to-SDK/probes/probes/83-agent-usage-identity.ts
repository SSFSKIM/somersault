// Probe 83 — Agent (Task) child-frame usage summability + subagent identity, for F3 LT17/TR39/DG21.
//
// P94 established that a RECOGNIZED top-level Agent sidecar (`SDKUserMessage.tool_use_result`) can carry
// exact `totalToolUseCount`, `totalTokens`, `totalDurationMs`, `toolStats`, `resolvedModel`, and `status`.
// But 2 of 11 canonical Agent calls were flat-only. F3's LT17 fallback row —
//   `Done (7 tool uses · 24.1k tokens · 1m 12s)`
// — must therefore be synthesizable from the CHILD frames alone. P83 asks, live:
//   (1) which frame classes carry `parent_tool_use_id` (assistant / user / stream_event / tool_progress)?
//   (2) do child assistant frames carry their own `message.usage`, and is it per-message or cumulative?
//   (3) does a client-side sum of child usage reproduce the sidecar's `totalTokens`?
//   (4) does counting child `tool_use` blocks reproduce `totalToolUseCount`?
//   (5) is first-child-frame → tool_result arrival a faithful `totalDurationMs` proxy?
//   (6) what identity beyond `parent_tool_use_id` exists on child frames (subagent_type, task_description,
//       model, session_id) and on the `system/task_*` sidechannel?
//
// Passes isolate one variable at a time:
//   A  forwardSubagentText=true,  custom agent (pinned child model), 1 dispatch, 3 child Reads
//   B  forwardSubagentText=false, same agent/prompt              → what the DEFAULT forwarding loses
//   C  forwardSubagentText=true,  general-purpose, 2 PARALLEL dispatches → flat-only hunt + generality
//
// Bounded by construction: synthetic temp fixture, `tools` limited to Agent+Read, child `maxTurns`,
// per-pass abort deadline. Nothing from the host environment is read or printed. Session ids are
// truncated; fixture content is probe-authored, so marker words are safe to echo.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

type UnknownRecord = Record<string, unknown>;
type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};
type ChildGroup = {
  ptid: string;
  assistantFrames: number;
  assistantFramesWithUsage: number;
  userFrames: number;
  streamEvents: number;
  toolProgressFrames: number;
  toolUseBlocks: Map<string, number>;
  toolResultBlocks: number;
  textBlocks: number;
  thinkingBlocks: number;
  messageIds: string[];
  usageByFrame: Usage[];
  usageByMessageId: Map<string, Usage>;
  lastUsageByMessageId: Map<string, Usage>;
  models: Set<string>;
  sessionIds: Set<string>;
  subagentTypes: Set<string>;
  taskDescriptions: Set<string>;
  firstFrameT: number | null;
  lastFrameT: number | null;
  identityKeyPaths: Set<string>;
};
type AgentCall = {
  id: string;
  passLabel: string;
  input: UnknownRecord;
  dispatchT: number;
  resultT: number | null;
  flatContentKind: string | null;
  sidecar: UnknownRecord | null;
};
type TaskFrame = UnknownRecord;

const EXPECTED_SDK_VERSION = "0.3.220";
const PARENT_MODEL = "fable";
const CHILD_MODEL = "sonnet";
const PASS_DEADLINE_MS = 420_000;
const PARENT_MAX_TURNS = 10;
const CHILD_MAX_TURNS = 6;
const IDENTITY_CANDIDATE_KEYS = [
  "parent_tool_use_id", "subagent_type", "task_description", "agent_id", "agentId", "task_id",
  "tool_use_id", "session_id", "uuid", "isSynthetic", "origin", "timestamp",
];

const args = new Set(process.argv.slice(2));
const selectedPasses = (() => {
  const flag = [...args].find((a) => a.startsWith("--passes="));
  const raw = flag ? flag.slice("--passes=".length) : "a,b,c";
  return new Set(raw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
})();

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shortId(value: unknown): string {
  return typeof value === "string" && value.length ? `…${value.slice(-6)}` : "—";
}

function zeroUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

function readUsage(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (typeof value.input_tokens !== "number" && typeof value.output_tokens !== "number") return null;
  return {
    input_tokens: num(value.input_tokens),
    output_tokens: num(value.output_tokens),
    cache_creation_input_tokens: num(value.cache_creation_input_tokens),
    cache_read_input_tokens: num(value.cache_read_input_tokens),
  };
}

function addUsage(into: Usage, from: Usage): Usage {
  into.input_tokens += from.input_tokens;
  into.output_tokens += from.output_tokens;
  into.cache_creation_input_tokens += from.cache_creation_input_tokens;
  into.cache_read_input_tokens += from.cache_read_input_tokens;
  return into;
}

function sumUsage(list: Usage[]): Usage {
  return list.reduce((acc, u) => addUsage(acc, u), zeroUsage());
}

function allFour(u: Usage): number {
  return u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
}

// Candidate client-side reconstructions of the sidecar's `totalTokens`. Summing across child messages
// and taking the final message's footprint are different hypotheses (child context is cumulative, so
// cache_read grows every turn and a naive sum multiplies the context). The probe reports which — if
// any — matches exactly, so F3 never guesses the aggregation rule.
function candidateSet(g: ChildGroup | undefined): Record<string, number> {
  if (!g) return {};
  const firstPerMessage = [...g.usageByMessageId.values()];
  const lastPerMessage = [...g.lastUsageByMessageId.values()];
  const sumFirst = sumUsage(firstPerMessage);
  const sumFrames = sumUsage(g.usageByFrame);
  const finalFirstFrame = firstPerMessage.at(-1) ?? zeroUsage();
  const finalLastFrame = lastPerMessage.at(-1) ?? zeroUsage();
  return {
    sum_dedup_output_only: sumFirst.output_tokens,
    sum_dedup_input_plus_output: sumFirst.input_tokens + sumFirst.output_tokens,
    sum_dedup_all_four: allFour(sumFirst),
    sum_perFrame_all_four: allFour(sumFrames),
    finalMessage_all_four: allFour(finalLastFrame),
    finalMessage_all_four_firstFrame: allFour(finalFirstFrame),
    finalMessage_context_only: finalLastFrame.input_tokens + finalLastFrame.cache_creation_input_tokens + finalLastFrame.cache_read_input_tokens,
    maxMessage_all_four: lastPerMessage.length ? Math.max(...lastPerMessage.map(allFour)) : 0,
  };
}

function newGroup(ptid: string): ChildGroup {
  return {
    ptid,
    assistantFrames: 0,
    assistantFramesWithUsage: 0,
    userFrames: 0,
    streamEvents: 0,
    toolProgressFrames: 0,
    toolUseBlocks: new Map(),
    toolResultBlocks: 0,
    textBlocks: 0,
    thinkingBlocks: 0,
    messageIds: [],
    usageByFrame: [],
    usageByMessageId: new Map(),
    lastUsageByMessageId: new Map(),
    models: new Set(),
    sessionIds: new Set(),
    subagentTypes: new Set(),
    taskDescriptions: new Set(),
    firstFrameT: null,
    lastFrameT: null,
    identityKeyPaths: new Set(),
  };
}

function createFixture(): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), "p83-agent-usage-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  const markers = ["ALPHAMARK", "BETAMARK", "GAMMAMARK", "DELTAMARK"];
  const files = markers.map((marker, index) => {
    const path = join(root, "notes", `note-${index + 1}.txt`);
    writeFileSync(path, `marker: ${marker}\nthis file exists only for probe 83.\n`);
    return path;
  });
  return { root, files };
}

function childPrompt(files: string[]): string {
  return `Use the Read tool on exactly these ${files.length} files, one Read call each, in this order: `
    + files.map((f) => `\`${f}\``).join(", ")
    + `. Use no other tool. Then reply with only the marker words you found, comma separated, and stop.`;
}

function parentPrompt(files: string[], agentType: string, dispatches: 1 | 2): string {
  if (dispatches === 1) {
    return `Make exactly one Agent tool call with subagent_type "${agentType}". Its \`prompt\` must be exactly this text:\n`
      + childPrompt(files)
      + `\nDo not use the Read tool yourself and do not call any other tool. When the agent returns, reply with only the marker words it reported, and stop.`;
  }
  const [a, b, c, d] = files;
  return `In a single message, make exactly two parallel Agent tool calls, both with subagent_type "${agentType}".\n`
    + `First call \`prompt\` exactly: ${childPrompt([a!, b!])}\n`
    + `Second call \`prompt\` exactly: ${childPrompt([c!, d!])}\n`
    + `Do not use the Read tool yourself and do not call any other tool. When both agents return, reply with only the marker words they reported, and stop.`;
}

async function* originatingPrompt(text: string): AsyncIterable<any> {
  yield {
    type: "user",
    uuid: randomUUID(),
    origin: { kind: "human" },
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

type PassSpec = {
  label: string;
  forwardSubagentText: boolean;
  agentType: string;
  custom: boolean;
  dispatches: 1 | 2;
  partials: boolean;
};

const PASSES: PassSpec[] = [
  { label: "A", forwardSubagentText: true, agentType: "probe-reader", custom: true, dispatches: 1, partials: true },
  { label: "B", forwardSubagentText: false, agentType: "probe-reader", custom: true, dispatches: 1, partials: false },
  { label: "C", forwardSubagentText: true, agentType: "general-purpose", custom: false, dispatches: 2, partials: false },
  // D isolates "parallel dispatch" from "built-in agent type" as the cause of C's async_launched sidecar.
  { label: "D", forwardSubagentText: true, agentType: "general-purpose", custom: false, dispatches: 1, partials: false },
];

async function runPass(spec: PassSpec): Promise<void> {
  console.log(`\n================ PASS ${spec.label} — forwardSubagentText=${spec.forwardSubagentText} · agentType=${spec.agentType} · dispatches=${spec.dispatches} ================`);
  const fixture = createFixture();
  const files = spec.dispatches === 1 ? fixture.files.slice(0, 3) : fixture.files;
  const groups = new Map<string, ChildGroup>();
  const agentCalls = new Map<string, AgentCall>();
  const taskFrames: TaskFrame[] = [];
  const taskChannelTotals = new Map<string, { progress: UnknownRecord[]; notification: UnknownRecord | null; notificationT: number | null }>();
  const frameClassPtid = new Map<string, { withPtid: number; withoutPtid: number }>();
  const topLevelUsage: Usage[] = [];
  let parentSessionId = "";
  let resolvedModel = "";
  let apiProvider = "missing";
  let resultFrame: UnknownRecord | null = null;
  let timedOut = false;

  const abortController = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, PASS_DEADLINE_MS);

  const noteFrame = (type: string, ptid: unknown) => {
    const entry = frameClassPtid.get(type) ?? { withPtid: 0, withoutPtid: 0 };
    if (typeof ptid === "string" && ptid.length) entry.withPtid += 1;
    else entry.withoutPtid += 1;
    frameClassPtid.set(type, entry);
  };

  const group = (ptid: string, t: number): ChildGroup => {
    let g = groups.get(ptid);
    if (!g) {
      g = newGroup(ptid);
      groups.set(ptid, g);
    }
    if (g.firstFrameT === null) g.firstFrameT = t;
    g.lastFrameT = t;
    return g;
  };

  let q: ReturnType<typeof query> | undefined;
  try {
    q = query({
      prompt: originatingPrompt(parentPrompt(files, spec.agentType, spec.dispatches)),
      options: {
        model: PARENT_MODEL,
        cwd: fixture.root,
        settingSources: [],
        tools: ["Agent", "Read"],
        permissionMode: "bypassPermissions",
        persistSession: false,
        maxTurns: PARENT_MAX_TURNS,
        includePartialMessages: spec.partials,
        forwardSubagentText: spec.forwardSubagentText,
        abortController,
        skills: [],
        ...(spec.custom
          ? {
              agents: {
                [spec.agentType]: {
                  description: "Reads a fixed list of probe fixture files and reports their marker words.",
                  prompt: "You read the exact files you are given with the Read tool and report their marker words. Never use another tool.",
                  tools: ["Read"],
                  model: CHILD_MODEL,
                  maxTurns: CHILD_MAX_TURNS,
                },
              },
            }
          : {}),
      } as any,
    });

    const init = await q.initializationResult();
    const account = isRecord(init) && isRecord((init as UnknownRecord).account) ? ((init as UnknownRecord).account as UnknownRecord) : undefined;
    apiProvider = typeof account?.apiProvider === "string" ? account.apiProvider : "missing";

    for await (const raw of q) {
      const m = raw as unknown as UnknownRecord;
      const t = Date.now();
      const ptid = typeof m.parent_tool_use_id === "string" && m.parent_tool_use_id.length ? m.parent_tool_use_id : null;
      const frameClass = m.type === "system" ? `system/${String(m.subtype)}` : String(m.type);
      noteFrame(frameClass, ptid);

      if (typeof m.session_id === "string" && !parentSessionId && !ptid) parentSessionId = m.session_id;

      if (m.type === "system" && m.subtype === "init" && typeof m.model === "string") resolvedModel = m.model;

      if (m.type === "system" && typeof m.subtype === "string" && m.subtype.startsWith("task_")) {
        // The task sidechannel is keyed by the Agent tool_use id, so it is an identity/totals route
        // that does not depend on the tool_result sidecar arriving at all.
        if (typeof m.tool_use_id === "string" && isRecord(m.usage)) {
          const entry = taskChannelTotals.get(m.tool_use_id) ?? { progress: [], notification: null, notificationT: null };
          if (m.subtype === "task_notification") {
            entry.notification = m.usage;
            entry.notificationT = t;
          } else entry.progress.push(m.usage);
          taskChannelTotals.set(m.tool_use_id, entry);
        }
        taskFrames.push({
          subtype: m.subtype,
          task_id: shortId(m.task_id),
          tool_use_id: shortId(m.tool_use_id),
          subagent_type: m.subagent_type ?? null,
          task_type: m.task_type ?? null,
          description: typeof m.description === "string" ? m.description.slice(0, 60) : null,
          status: m.status ?? null,
          usage: m.usage ?? null,
          patch: m.patch ?? null,
        });
      }

      if (m.type === "tool_progress") {
        const owner = ptid;
        if (owner) group(owner, t).toolProgressFrames += 1;
        taskFrames.push({
          subtype: "tool_progress",
          tool_use_id: shortId(m.tool_use_id),
          tool_name: m.tool_name ?? null,
          parent_tool_use_id: shortId(m.parent_tool_use_id),
          subagent_type: m.subagent_type ?? null,
          task_id: shortId(m.task_id),
          elapsed_time_seconds: m.elapsed_time_seconds ?? null,
        });
      }

      if (m.type === "stream_event" && ptid) group(ptid, t).streamEvents += 1;

      if (m.type === "assistant") {
        const inner = isRecord(m.message) ? m.message : {};
        const content = Array.isArray(inner.content) ? inner.content : [];
        const usage = readUsage(inner.usage);
        if (!ptid) {
          if (usage) topLevelUsage.push(usage);
          for (const block of content) {
            if (isRecord(block) && block.type === "tool_use" && block.name === "Agent" && typeof block.id === "string") {
              agentCalls.set(block.id, {
                id: block.id,
                passLabel: spec.label,
                input: isRecord(block.input) ? block.input : {},
                dispatchT: t,
                resultT: null,
                flatContentKind: null,
                sidecar: null,
              });
            }
          }
          continue;
        }
        const g = group(ptid, t);
        g.assistantFrames += 1;
        if (usage) {
          g.assistantFramesWithUsage += 1;
          g.usageByFrame.push(usage);
          const messageId = typeof inner.id === "string" ? inner.id : `anon-${g.usageByFrame.length}`;
          g.messageIds.push(messageId);
          // Several assistant frames can share one message.id (split content blocks). Dedupe so a
          // naive per-frame sum cannot silently double-count one API turn.
          if (!g.usageByMessageId.has(messageId)) g.usageByMessageId.set(messageId, usage);
          g.lastUsageByMessageId.set(messageId, usage);
        }
        if (typeof inner.model === "string") g.models.add(inner.model);
        if (typeof m.session_id === "string") g.sessionIds.add(m.session_id);
        if (typeof m.subagent_type === "string") g.subagentTypes.add(m.subagent_type);
        if (typeof m.task_description === "string") g.taskDescriptions.add(m.task_description);
        for (const key of IDENTITY_CANDIDATE_KEYS) {
          if (Object.hasOwn(m, key) && m[key] !== null && m[key] !== undefined) g.identityKeyPaths.add(`assistant.${key}`);
        }
        for (const key of ["model", "id", "usage", "stop_reason"]) {
          if (Object.hasOwn(inner, key) && inner[key] !== null && inner[key] !== undefined) g.identityKeyPaths.add(`assistant.message.${key}`);
        }
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === "tool_use") {
            const name = typeof block.name === "string" ? block.name : "Unknown";
            g.toolUseBlocks.set(name, (g.toolUseBlocks.get(name) ?? 0) + 1);
          } else if (block.type === "text") g.textBlocks += 1;
          else if (block.type === "thinking") g.thinkingBlocks += 1;
        }
        continue;
      }

      if (m.type === "user") {
        const inner = isRecord(m.message) ? m.message : {};
        const content = Array.isArray(inner.content) ? inner.content : [];
        if (ptid) {
          const g = group(ptid, t);
          g.userFrames += 1;
          for (const key of IDENTITY_CANDIDATE_KEYS) {
            if (Object.hasOwn(m, key) && m[key] !== null && m[key] !== undefined) g.identityKeyPaths.add(`user.${key}`);
          }
          if (typeof m.session_id === "string") g.sessionIds.add(m.session_id);
          for (const block of content) if (isRecord(block) && block.type === "tool_result") g.toolResultBlocks += 1;
          continue;
        }
        // Top-level user frame: this is where an Agent tool_result (and its optional sidecar) lands.
        const toolResults = content.filter((b): b is UnknownRecord => isRecord(b) && b.type === "tool_result");
        for (const block of toolResults) {
          const call = typeof block.tool_use_id === "string" ? agentCalls.get(block.tool_use_id) : undefined;
          if (!call) continue;
          call.resultT = t;
          call.flatContentKind = Array.isArray(block.content) ? `array(len=${block.content.length})` : typeof block.content;
          if (toolResults.length === 1 && Object.hasOwn(m, "tool_use_result") && m.tool_use_result !== undefined) {
            call.sidecar = isRecord(m.tool_use_result) ? m.tool_use_result : { "<non-object>": typeof m.tool_use_result };
          }
        }
        continue;
      }

      if (m.type === "result") resultFrame = m;
    }
  } catch (error) {
    console.log(`  !! pass aborted: ${timedOut ? "deadline" : (error as Error)?.message ?? "unknown"}`);
  } finally {
    clearTimeout(timer);
    q?.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }

  // ---- report -------------------------------------------------------------
  console.log(`  runtime: model=${resolvedModel || "?"} apiProvider=${apiProvider} parentSession=${shortId(parentSessionId)}`);
  console.log(`  result: subtype=${resultFrame?.subtype ?? "(none)"} turns=${resultFrame?.num_turns ?? "?"} cost_usd=${typeof resultFrame?.total_cost_usd === "number" ? (resultFrame.total_cost_usd as number).toFixed(4) : "?"}`);

  console.log("\n  [1] frame classes × parent_tool_use_id");
  for (const [cls, counts] of [...frameClassPtid.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`      ${cls.padEnd(26)} ptid-set=${String(counts.withPtid).padStart(4)}  ptid-null=${String(counts.withoutPtid).padStart(4)}`);
  }

  console.log("\n  [2] child groups (keyed by parent_tool_use_id)");
  for (const g of groups.values()) {
    const frameSum = sumUsage(g.usageByFrame);
    const dedupSum = sumUsage([...g.usageByMessageId.values()]);
    const toolUses = [...g.toolUseBlocks.entries()].map(([n, c]) => `${n}×${c}`).join(" ") || "(none)";
    console.log(`      ptid=${shortId(g.ptid)}`);
    console.log(`        frames: assistant=${g.assistantFrames} (withUsage=${g.assistantFramesWithUsage}, distinct message.id=${g.usageByMessageId.size}) user=${g.userFrames} stream_event=${g.streamEvents} tool_progress=${g.toolProgressFrames}`);
    console.log(`        blocks: tool_use[${toolUses}] tool_result=${g.toolResultBlocks} text=${g.textBlocks} thinking=${g.thinkingBlocks}`);
    console.log(`        identity: subagent_type=${[...g.subagentTypes].join("|") || "(absent)"} task_description=${[...g.taskDescriptions].map((d) => `"${d.slice(0, 48)}"`).join("|") || "(absent)"}`);
    console.log(`        identity: message.model=${[...g.models].join("|") || "(absent)"} session_id=${[...g.sessionIds].map(shortId).join("|")} sameAsParent=${[...g.sessionIds].every((s) => s === parentSessionId)}`);
    console.log(`        identity key paths present: ${[...g.identityKeyPaths].sort().join(", ")}`);
    console.log(`        usage per-frame sum:   ${JSON.stringify(frameSum)}`);
    console.log(`        usage dedup-by-id sum: ${JSON.stringify(dedupSum)}`);
    console.log(`        per-message input_tokens sequence: ${JSON.stringify([...g.usageByMessageId.values()].map((u) => u.input_tokens))}`);
    console.log(`        per-message output_tokens sequence: ${JSON.stringify([...g.usageByMessageId.values()].map((u) => u.output_tokens))}`);
    console.log(`        per-message cache_read sequence:    ${JSON.stringify([...g.usageByMessageId.values()].map((u) => u.cache_read_input_tokens))}`);
    console.log(`        per-message cache_creation seq:     ${JSON.stringify([...g.usageByMessageId.values()].map((u) => u.cache_creation_input_tokens))}`);
    console.log(`        final message usage (last frame):   ${JSON.stringify([...g.lastUsageByMessageId.values()].at(-1) ?? null)}`);
    console.log(`        token candidates: ${JSON.stringify(candidateSet(g))}`);
    console.log(`        wall-clock first child frame → last child frame: ${g.firstFrameT !== null && g.lastFrameT !== null ? g.lastFrameT - g.firstFrameT : "?"} ms`);
  }
  if (!groups.size) console.log("      (no frames carried parent_tool_use_id)");

  console.log("\n  [3] Agent calls: sidecar vs client-side reconstruction");
  for (const call of agentCalls.values()) {
    const g = groups.get(call.id);
    const sidecar = call.sidecar;
    console.log(`      Agent#${shortId(call.id)} input.keys=[${Object.keys(call.input).sort().join(",")}] subagent_type=${String(call.input.subagent_type ?? "(absent)")} run_in_background=${String(call.input.run_in_background ?? "(absent)")}`);
    console.log(`        flat tool_result content: ${call.flatContentKind ?? "(never arrived)"}`);
    if (!sidecar) {
      console.log(`        SIDECAR: ABSENT → flat-only Agent call (this is the LT17 fallback case)`);
    } else {
      console.log(`        SIDECAR keys: [${Object.keys(sidecar).sort().join(",")}]`);
      console.log(`        SIDECAR status=${String(sidecar.status)} agentId=${shortId(sidecar.agentId)} agentType=${String(sidecar.agentType ?? "(absent)")} resolvedModel=${String(sidecar.resolvedModel ?? "(absent)")}`);
      console.log(`        SIDECAR totalToolUseCount=${String(sidecar.totalToolUseCount)} totalTokens=${String(sidecar.totalTokens)} totalDurationMs=${String(sidecar.totalDurationMs)}`);
      console.log(`        SIDECAR usage=${JSON.stringify(sidecar.usage)}`);
      console.log(`        SIDECAR toolStats=${JSON.stringify(sidecar.toolStats)}`);
    }
    const observedToolUses = g ? [...g.toolUseBlocks.values()].reduce((a, b) => a + b, 0) : 0;
    const proxyDuration = g && g.firstFrameT !== null && call.resultT !== null ? call.resultT - g.firstFrameT : null;
    const dispatchToResult = call.resultT !== null ? call.resultT - call.dispatchT : null;
    console.log(`        CLIENT toolUseBlocks=${observedToolUses}${sidecar ? ` (sidecar ${String(sidecar.totalToolUseCount)} → ${observedToolUses === sidecar.totalToolUseCount ? "MATCH" : "MISMATCH"})` : ""}`);
    const cands = candidateSet(g);
    const matches = sidecar && typeof sidecar.totalTokens === "number"
      ? Object.entries(cands).filter(([, v]) => v === sidecar.totalTokens).map(([k]) => k)
      : [];
    console.log(`        CLIENT token candidate matching sidecar.totalTokens: ${matches.length ? matches.join(",") : "(none exact)"}`);
    if (sidecar && typeof sidecar.totalTokens === "number") {
      for (const [name, value] of Object.entries(cands)) {
        const delta = value - (sidecar.totalTokens as number);
        console.log(`          ${name.padEnd(26)} ${String(value).padStart(8)}  Δ=${delta >= 0 ? "+" : ""}${delta} (${((delta / (sidecar.totalTokens as number)) * 100).toFixed(1)}%)`);
      }
    }
    const channel = taskChannelTotals.get(call.id);
    if (channel) {
      const note = channel.notification;
      console.log(`        TASK-CHANNEL notification usage=${JSON.stringify(note)}`);
      console.log(`        TASK-CHANNEL last progress usage=${JSON.stringify(channel.progress.at(-1) ?? null)} (${channel.progress.length} progress frames)`);
      console.log(`        TASK-CHANNEL notification arrival vs tool_result: ${channel.notificationT !== null && call.resultT !== null ? `${channel.notificationT - call.resultT >= 0 ? "+" : ""}${channel.notificationT - call.resultT}ms (${channel.notificationT >= call.resultT ? "AFTER" : "BEFORE"})` : "?"}`);
      if (note && sidecar) {
        const dt = typeof note.total_tokens === "number" && typeof sidecar.totalTokens === "number" ? note.total_tokens - sidecar.totalTokens : null;
        const dd = typeof note.duration_ms === "number" && typeof sidecar.totalDurationMs === "number" ? note.duration_ms - sidecar.totalDurationMs : null;
        console.log(`        TASK-CHANNEL vs SIDECAR: tool_uses ${String(note.tool_uses)} vs ${String(sidecar.totalToolUseCount)} | total_tokens Δ=${dt} | duration_ms Δ=${dd}`);
      }
    } else {
      console.log(`        TASK-CHANNEL: no usage-bearing task frame keyed by this tool_use_id`);
    }
    console.log(`        CLIENT duration proxies: firstChildFrame→result=${proxyDuration ?? "?"}ms dispatch→result=${dispatchToResult ?? "?"}ms`
      + (sidecar && typeof sidecar.totalDurationMs === "number"
        ? ` | sidecar=${sidecar.totalDurationMs}ms Δ(firstChild)=${proxyDuration !== null ? proxyDuration - (sidecar.totalDurationMs as number) : "?"}ms Δ(dispatch)=${dispatchToResult !== null ? dispatchToResult - (sidecar.totalDurationMs as number) : "?"}ms`
        : ""));
  }
  if (!agentCalls.size) console.log("      (no Agent tool_use fired)");

  console.log("\n  [4] task/tool_progress sidechannel frames");
  if (!taskFrames.length) console.log("      (none)");
  for (const frame of taskFrames) console.log(`      ${JSON.stringify(frame)}`);

  console.log(`\n  [5] top-level assistant usage frames: ${topLevelUsage.length}; sum=${JSON.stringify(sumUsage(topLevelUsage))}`);
  console.log(`      result.usage=${JSON.stringify(resultFrame?.usage ?? null)}`);
  console.log(`      result.modelUsage keys=${resultFrame && isRecord(resultFrame.modelUsage) ? JSON.stringify(Object.keys(resultFrame.modelUsage)) : "null"}`);
  if (resultFrame && isRecord(resultFrame.modelUsage)) {
    for (const [model, usage] of Object.entries(resultFrame.modelUsage)) {
      console.log(`      result.modelUsage[${model}]=${JSON.stringify(usage)}`);
    }
  }
}

async function main(): Promise<void> {
  const sdkVersion = (() => {
    try {
      const manifest = JSON.parse(readFileSync(new URL("../node_modules/@anthropic-ai/claude-agent-sdk/package.json", import.meta.url), "utf8"));
      return typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
      return undefined;
    }
  })();
  console.log("=== PROBE 83 — Agent child-frame usage summability + subagent identity ===");
  console.log(`sdk=${sdkVersion ?? "?"} (expected ${EXPECTED_SDK_VERSION}) node=${process.version} parentModel=${PARENT_MODEL} childModel=${CHILD_MODEL}`);
  if (sdkVersion && sdkVersion !== EXPECTED_SDK_VERSION) console.log("!! SDK VERSION DRIFT — findings below are for the installed version, not the recorded one.");
  for (const spec of PASSES) {
    if (!selectedPasses.has(spec.label.toLowerCase())) continue;
    await runPass(spec);
  }
  console.log("\nINTERPRETATION: [2] answers whether child usage exists and whether it is per-message or cumulative;");
  console.log("[3] answers whether a client-side sum/count/duration reproduces the sidecar totals (LT17 fallback fidelity);");
  console.log("[2]/[4] answer what identity exists beyond parent_tool_use_id (TR39 teammate attribution).");
}

await main();
