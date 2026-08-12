// probes/probes/108-live-stream-system-reminder.ts — can raw `<system-reminder>` text reach the LIVE
// message stream as a renderable `user` frame?
//
// Probe 107 settled the DISK side: `getSessionMessages` drops meta rows and projects every row onto a
// fixed shape, so no reminder survives the reader. It closed by NAMING the only surviving vector as a
// hypothesis, not a measurement: "the live host/SDK message stream, where reminders ride along inside
// user/tool-result content". This probe measures that vector.
//
// It matters because of exactly where ccx retains and projects. `TranscriptDocument.appendSdk`
// (harness/src/tui/transcriptModel.ts:96-99) keeps `type:"assistant"` and `type:"user"` and rejects
// everything else, and `projectMessageEntry` (toolRenderer.tsx:578) renders every content block that is
// not `tool_use`/`tool_result` through `renderMessage` → `species.ts`, whose fallthrough species is
// `prompt` — a user-echo band. So a live `user` frame carrying reminder TEXT would be drawn as a prompt
// the human never typed; a reminder riding any other frame type cannot reach the document at all.
//
//   Q1. Does the stream echo the user's OWN prompt back as a `type:"user"` frame? (If it did, ccx would
//       already double-draw every prompt — its own local echo plus the echoed frame.)
//   Q2. Does a `UserPromptSubmit` hook's `additionalContext` come back on the wire as a `user` frame?
//   Q3. Do the CLI's own reminders (the Read/TodoWrite/plan-mode injections) reach the stream as `user`
//       frames with text blocks, or only as `tool_result` content / non-user frame types?
//   Q4. For every frame that mentions `<system-reminder>` anywhere in its JSON: what is its `type`, and
//       WHERE does the marker sit — a text block (renderable), a tool_result block (skipped by the
//       projection), or a field the document never reads?
//
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/108-live-stream-system-reminder.ts
//
// ── ANSWER (live run 2026-08-12, SDK 0.3.220, claude-haiku-4-5, OAuth) — THE VECTOR IS CLOSED TOO. ──
// 25 frames over one Read-then-answer turn. Zero frames mention `<system-reminder>` ANYWHERE in their JSON,
// the injected marker included.
//   A1. The stream does NOT echo the user's prompt. Two `type:"user"` frames arrived and BOTH carried a
//       single `tool_result` block; no user frame anywhere carried a `text` block. So ccx renders only its
//       own composer submission as a user row (useChat.ts `runTurn` → `appendNewLocal({kind:"user-echo"})`),
//       which is also why the local echo has never double-drawn.
//   A2. A `UserPromptSubmit` hook's `additionalContext` never comes back on the wire. It reaches the model
//       and (probe 107 phase 1) lands on disk as a `type:"attachment"` row — a type `appendSdk`
//       (transcriptModel.ts:99) rejects outright, so it cannot enter the document by that route either.
//   A3. Everything else on the wire is `system/*`, `rate_limit_event`, `assistant` and `result`. Of those
//       only `assistant` is retained, and reminder text is not model output.
// CONSEQUENCE: all three inputs to the shared renderer are now measured clean — disk (probe 107: the row is
// dropped and the flag stripped), live user frames (here: tool_result-only, and `projectMessageEntry`
// skips `tool_result`/`tool_use` blocks by construction), and the local echo (ccx's own text). No
// content-based suppression is warranted; adding one would filter a shape nothing produces.
// BOUND ON THE CLAIM, stated because it is the one place a reminder could still surface: a reminder appended
// to a tool_result's CONTENT would render as that tool's output body (`resultBody`), which is a different
// row from the user-frame leak this probe was aimed at. This run saw none — the Read result carried no
// reminder at all — so it stays an unobserved possibility, not a finding.
//
// WHAT REPRODUCES AND WHAT DOES NOT (added after an independent re-run). The headline "zero frames mention
// `<system-reminder>` ANYWHERE" is RUN-DEPENDENT: the model sometimes quotes its own context inside a
// `thinking` block, and one re-run saw a single `assistant` frame whose raw JSON carried the tag for that
// reason. That count is therefore weather, not contract. The LOAD-BEARING claims reproduced in every run:
// zero user frames carrying a text block, zero reminders in a renderable text block, and every `user` frame
// `tool_result`-only. Read the summary that way — the per-question lines, not the raw-JSON tally.
// POSITIVE CONTROL: the hook increments `hookInvocations` and the run prints it. Without it, a hook that
// silently never fired would produce this same all-clean result and the conclusion would be unearned.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const CWD = "/Users/new/.claude/jobs/4b30d1a4/tmp/probe108";
const MARKER = "MU-MARKER-108";
const REMINDER = `<system-reminder>probe-108 injected reminder: ${MARKER}</system-reminder>`;
const MODEL = "claude-haiku-4-5-20251001";

rmSync(CWD, { recursive: true, force: true });
mkdirSync(CWD, { recursive: true });
writeFileSync(join(CWD, "probe.txt"), "hello from probe 108\n");

const trunc = (s: string, n = 220): string => (s.length > n ? `${s.slice(0, n)}…(len=${s.length})` : s);
const blocks = (m: any): any[] => (Array.isArray(m?.message?.content) ? m.message.content : typeof m?.message?.content === "string" ? [{ type: "text", text: m.message.content }] : []);

interface Row { i: number; type: string; subtype?: string; isMeta?: unknown; parent?: unknown; blockTypes: string[]; mentionsReminder: boolean; rawHasMarker: boolean; where: string[]; texts: string[] }
const rows: Row[] = [];
// POSITIVE CONTROL (see the header note): counted inside the hook body, so an all-clean result cannot be
// confused with a hook that never ran.
let hookInvocations = 0;

async function* input() {
  yield { type: "user" as const, message: { role: "user" as const, content: `Read probe.txt with the Read tool, then reply with exactly one word: DELTA` }, parent_tool_use_id: null, session_id: "x" };
}

let i = 0;
for await (const m of query({
  prompt: input(),
  options: {
    model: MODEL, cwd: CWD, settingSources: [], permissionMode: "bypassPermissions",
    hooks: {
      UserPromptSubmit: [{ hooks: [async () => { hookInvocations++; return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER } }; }] }],
    },
  },
})) {
  const any = m as any;
  const raw = JSON.stringify(any);
  const bs = blocks(any);
  const where: string[] = [];
  for (const b of bs) {
    const t = typeof b?.text === "string" ? b.text : "";
    const c = typeof b?.content === "string" ? b.content : Array.isArray(b?.content) ? JSON.stringify(b.content) : "";
    // A `thinking` block keeps its prose on `b.thinking`, NOT `b.text` — without this arm the classifier is
    // blind to the one block type that actually quotes the context back, and files such a frame under
    // "elsewhere in the frame", which reads like an unexplained leak when it is the model reasoning aloud.
    const th = typeof b?.thinking === "string" ? b.thinking : "";
    if (b?.type === "text" && t.includes("<system-reminder>")) where.push("TEXT BLOCK (RENDERABLE)");
    if (b?.type === "tool_result" && c.includes("<system-reminder>")) where.push("tool_result block (projection skips)");
    if (b?.type === "thinking" && th.includes("<system-reminder>")) where.push("thinking block (model quoting its context, not a leak)");
  }
  if (raw.includes("<system-reminder>") && where.length === 0) where.push("elsewhere in the frame (not a content block)");
  rows.push({
    i: i++, type: String(any.type), subtype: any.subtype, isMeta: any.isMeta, parent: any.parent_tool_use_id,
    blockTypes: bs.map((b) => String(b?.type)),
    mentionsReminder: raw.includes("<system-reminder>"),
    rawHasMarker: raw.includes(MARKER),
    where,
    texts: bs.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => trunc(b.text)),
  });
}

console.log("=== PROBE 108 — live stream frames ===");
for (const r of rows) {
  console.log(`#${r.i} type=${r.type}${r.subtype ? `/${r.subtype}` : ""} isMeta=${String(r.isMeta)} parent=${String(r.parent)} blocks=[${r.blockTypes.join(",")}]${r.mentionsReminder ? `  ⚠ reminder: ${r.where.join(" | ")}` : ""}`);
  for (const t of r.texts) console.log(`     text: ${t}`);
}

const users = rows.filter((r) => r.type === "user");
const userTextFrames = users.filter((r) => r.blockTypes.includes("text"));
console.log("\n=== SUMMARY ===");
console.log(`>>> CONTROL hook invocations              : ${hookInvocations}   (0 would void every clean result below)`);
console.log(`total frames                              : ${rows.length}`);
console.log(`type:"user" frames                        : ${users.length}  (block shapes: ${users.map((r) => `[${r.blockTypes.join(",")}]`).join(" ") || "(none)"})`);
console.log(`Q1 user frames carrying a TEXT block      : ${userTextFrames.length}`);
console.log(`Q2/Q3 frames mentioning <system-reminder> : ${rows.filter((r) => r.mentionsReminder).length}   (RAW JSON — run-dependent; a thinking block may quote it)`);
console.log(`Q4 reminder in a RENDERABLE text block    : ${rows.filter((r) => r.where.includes("TEXT BLOCK (RENDERABLE)")).length}`);
console.log(`   …of those, on a user frame (reaches the document): ${rows.filter((r) => r.type === "user" && r.where.includes("TEXT BLOCK (RENDERABLE)")).length}`);
// TWO lines, because they answer different questions: the first is what the RENDERER could ever draw (text
// blocks only, and those are truncated to 220 chars for display); the second is the whole wire.
console.log(`marker ${MARKER} seen in TEXT blocks : ${rows.some((r) => r.texts.some((t) => t.includes(MARKER)))}`);
console.log(`marker ${MARKER} seen in RAW JSON    : ${rows.some((r) => r.rawHasMarker)}`);
