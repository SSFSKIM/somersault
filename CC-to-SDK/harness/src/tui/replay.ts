// tui/src/replay.ts — pure: a resumed session's persisted messages → the ONE retained `TranscriptDocument`
// (F1 Task 4). It RETAINS raw rows — including every `tool_result` and its top-level `tool_use_result`
// sidecar — instead of pre-rendering lines, so a resumed tool row is byte-for-byte the row the live turn
// showed. There is no display-only message cap: retention is source, and how much of it a surface shows is
// the projection's decision. Only the three display frames are local entries, each with a stable identity
// derived from POSITION in the persisted array (never from its text) so replaying the same session twice
// neither duplicates nor silently drops a row.
import { trunc, type RenderLine } from "./render.js";
import { speciesLines } from "./species.js";
import { TranscriptDocument } from "./transcriptModel.js";
import { rowKind, promptText } from "../sessions/rows.js";

/** `width` (F4 Task 8): the terminal column budget the command-echo band is padded to. The prompt rows
 *  themselves are retained SDK frames and get their width from the projection, but a `command_echo` is a
 *  LOCAL entry whose lines are baked here — so it needs the caller's width or it would default to 80 and
 *  wear a narrower band than the prompt above it. `useChat` passes its own `columnsFn()`. */
export interface ReplayOptions { id?: string; label?: string; width?: number }

function firstUserText(messages: readonly any[]): string {
  for (const m of messages) {
    if (m?.type === "user" && Array.isArray(m.message?.content)) {
      const t = m.message.content.find((b: any) => b?.type === "text");
      if (t?.text) return String(t.text);
    }
  }
  return "";
}
const hhmm = (ts: unknown): string => (typeof ts === "string" && ts.length >= 16 && ts[10] === "T" ? ts.slice(11, 16) : "");
const divider = (label: string): RenderLine => ({ text: `─── ${label} ───`, dim: true });

export function replayDocument(messages: readonly unknown[], options: ReplayOptions = {}): TranscriptDocument {
  const rows = messages as readonly any[];
  const document = new TranscriptDocument();
  const session = options.id ?? "session";
  const label = options.label ?? "resumed";
  // Only rows the shared classifier calls a real prompt: a slash-command echo or a compaction summary is
  // not a turn the human took.
  const turns = rows.filter((m) => rowKind(m) === "prompt").length;
  const title = trunc(firstUserText(rows) || (options.id ? options.id.slice(0, 8) : "session"), 40);
  const time = hhmm(rows.at(-1)?.timestamp);
  document.appendLocal({ kind: "resume-divider", lines: [divider(`${label}: ${title} · ${turns} turn${turns === 1 ? "" : "s"}${time ? " · " + time : ""}`)] }, `replay:${session}:head`);
  rows.forEach((m, index) => {
    const kind = rowKind(m);
    // F4 Task 10a: replay no longer decides what a sentinel LOOKS like — `species.ts` does, for the disk path
    // and the live path alike. Two consequences. (1) Local-command output and caveats are no longer dropped on
    // the floor: they are retained like every other row and the router paints them (a caveat still paints
    // nothing — `ERe` exit 6 returns null — but it is now source we kept rather than source we destroyed).
    // (2) The command echo keeps its LOCAL entry, because its position-derived identity is what makes
    // replaying the same session twice idempotent (F1 Task 4), but its LINES come from the router, so the
    // `<command-args>` and `skill-format` shapes a hand-rolled `<command-name>` regex never saw now render.
    if (kind === "command_echo") {
      const lines = speciesLines("command-echo", promptText(m), { width: options.width });
      if (lines) document.appendLocal({ kind: "command-echo", lines }, `replay:${session}:${index}:command_echo`);
      return;
    }
    if (kind === "compact_summary") {
      document.appendLocal({ kind: "resume-divider", lines: [divider("context compacted earlier")] }, `replay:${session}:${index}:compact_summary`);
      return;
    }
    document.appendSdk("disk", m);
  });
  document.appendLocal({ kind: "resume-divider", lines: [divider(`${label} here · live`)] }, `replay:${session}:live`);
  return document;
}
