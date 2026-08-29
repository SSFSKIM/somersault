// sessions/rows.ts — content-shape classification of persisted transcript rows (getSessionMessages).
// What THIS READER RETURNS carries no meta flags (probe 68b) — the rows on disk do carry `isMeta` and
// `origin`, and `getSessionMessages` projects a fixed field literal that drops both, so classification
// here has only the content shape to work with: a "user" row can be a real prompt, a tool_result, a CLI
// slash-command echo, local-command stdout/caveat, or a compact continuation summary. Stated as a fact
// about the rows it was false; about the projection it is the whole reason this module exists.
// ONE module so the rewind picker and transcript replay cannot drift.
// A peer-arrival row classifies `prompt` and is NOT a phantom kind — measured over all 170 peer rows on
// one machine (M9 spec, M11). `items/replay.ts` discards phantom kinds before it consults `peerArrival`,
// so that is what lets an arrival row reach the arrival reader at all.
// F4 Task 10a: the tag regexes moved to `tui/species.ts` — the sentinel router that has to know the SAME
// shapes to decide what a user frame is — and are imported back here rather than kept in two places. There
// is exactly one spelling of "this row is a caveat" in the codebase now.
import { CAVEAT_RE, COMMAND_ECHO_RE, COMMAND_OUTPUT_RE, COMPACT_SUMMARY_RE } from "../tui/species.js";
import type { RewindAnchor } from "../session/chatSession.js";

export type RowKind = "prompt" | "tool_result" | "command_echo" | "command_output" | "caveat" | "compact_summary" | "other";

/** First text of a user row (string content, or the first text block). */
export function promptText(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return String(c.find((b: any) => b?.type === "text")?.text ?? "");
  return "";
}

export function rowKind(m: any): RowKind {
  if (m?.type !== "user") return "other";
  const c = m.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result")) return "tool_result";
  const text = promptText(m);
  if (COMMAND_ECHO_RE.test(text)) return "command_echo";
  if (COMMAND_OUTPUT_RE.test(text)) return "command_output";
  if (CAVEAT_RE.test(text)) return "caveat";
  if (COMPACT_SUMMARY_RE.test(text)) return "compact_summary";
  if (!m.uuid) return "other";
  return "prompt";
}

/** The phantom kinds a conversation anchor must never land on (probe 68b: untested resumeAt semantics). */
const PHANTOM: ReadonlySet<RowKind> = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);

/** User-prompt anchors, NEWEST-FIRST. prevUuid = the nearest PRECEDING row with a uuid whose kind is
 *  real (assistant/tool_result/prompt) — phantom rows are walked past, so rewinding also drops them. */
export function rewindAnchorsFrom(messages: any[]): RewindAnchor[] {
  const out: RewindAnchor[] = [];
  messages.forEach((m: any, i: number) => {
    if (rowKind(m) !== "prompt") return;
    let prevUuid: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const p = messages[j] as any;
      if (p?.uuid && !PHANTOM.has(rowKind(p))) { prevUuid = String(p.uuid); break; }
    }
    out.push({ uuid: String(m.uuid), prevUuid, text: promptText(m), index: i, ...(typeof m.timestamp === "string" ? { timestamp: m.timestamp } : {}) });
  });
  return out.reverse();
}

/** A locally-minted assistant frame — an API failure, a session-exit notice, a reconnect notice — rather
 *  than something the model said. TWO spellings because the two read paths carry different ones:
 *  - LIVE wire: `is_api_error_message:true` (probe 96's terminal shape; on disk it is `isApiErrorMessage`).
 *  - DISK via `getSessionMessages`: NEITHER survives. Measured on SDK 0.3.220 against a real session that
 *    holds one: the reader returns exactly {type,uuid,session_id,message,parent_tool_use_id,parent_agent_id,
 *    timestamp} and drops the row-level `isApiErrorMessage`/`error`/`apiErrorStatus` flags. What DOES survive
 *    is `message.model === "<synthetic>"`, the CLI's marker on every locally-minted frame — all four mint
 *    sites in the 2.1.227 bundle are the error factory, the session-exit message, the attestation/reconnect
 *    notices, and a proactive tool_use, none of them a model reply. So the flag alone would be inert here. */
function syntheticAssistant(m: any): boolean {
  return m?.is_api_error_message === true || m?.isApiErrorMessage === true || m?.message?.model === "<synthetic>";
}

/** Depth cap on the recent-assistant-text ring (canon's `sHw`, T-COPY R1 §1.6.1) — /copy N's addressable
 *  range. The cap counts COLLECTED entries, not rows scanned: the walk keeps going past skipped rows. */
export const RECENT_ASSISTANT_CAP = 20;

/** The most recent assistant replies' text, NEWEST FIRST, capped at `cap` (T-COPY: generalized from the old
 *  single-slot `lastAssistantText` so `/copy N` can index into history — N=1 is index 0, matching canon's
 *  `o = N - 1`). Lets a replayed view (resume, rewind) seed /copy with what is actually ON SCREEN — the live
 *  message arm never saw it. Synthetic frames are skipped entirely (not just at the head): /copy hands over
 *  what Claude said, never "API Error: 401 …", at ANY N. Canon `tjh` (T-COPY R1 §1.6): backwards walk, text
 *  blocks joined with "\n\n" (not a bare "\n" — decision 1), and a bare-truthiness non-empty gate on the
 *  joined string (`if(i)`, not `.trim()` — decision 2, so a lone-whitespace-only reply still counts). */
export function recentAssistantTexts(messages: any[], cap = RECENT_ASSISTANT_CAP): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < cap; i--) {
    const m = messages[i] as any;
    if (m?.type !== "assistant" || syntheticAssistant(m)) continue;
    const t = (m.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n\n");
    if (t) out.push(t);
  }
  return out;
}
