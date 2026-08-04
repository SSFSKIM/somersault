// tui/src/diffSource.ts — F4 Task 6: the patch-source LADDER, the one place that answers "what changed, and do
// we know where". Two rungs, in strict order (spec Decision Log "Diff line numbers", P94):
//   1. a RECOGNIZED `tool_use_result.structuredPatch` — absolute hunk positions taken verbatim, disk NEVER read
//      (a re-read observes state NEWER than the completed edit it would be numbering);
//   2. a flat-only Edit — diffed locally from the complete retained input, and anchored against disk ONLY when
//      the expected content is still there EXACTLY once; otherwise the hunks carry no position at all.
// The rule under both: being visibly approximate beats being confidently wrong. `numbering` is the wire that
// carries that admission to the renderer — an unanchored patch never hands out a line number it cannot stand
// behind. Purely a source resolver: it renders nothing, and Task 7 owns every glyph.
import { readFileSync } from "node:fs";
import { structuredPatch } from "diff";
import { editShape, patchLineCounts, writeShape } from "./toolResult.js";

export interface DiffLineRow { kind: "add" | "remove" | "context"; text: string; }
export interface DiffHunk { oldStart: number | undefined; rows: DiffLineRow[]; }
export interface ResolvedPatch { hunks: DiffHunk[]; numbering: "absolute" | "approximate"; added: number; removed: number; }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** A hunk position is only usable when it is a real 1-based line: a 0, a negative, a float or a missing field is
 *  a patch that cannot say where it applies, and this returns `undefined` rather than letting arithmetic invent one. */
const lineNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined);

/** The unified-diff body of one hunk. `\ No newline at end of file` is patch FRAMING, not content — jsdiff emits
 *  it mid-hunk (right after the line it qualifies), so it is dropped here instead of rendering as a context row
 *  reading `" No newline at end of file"`. It carries no `+`/`-`, so dropping it cannot move a count. */
const rowsFrom = (lines: readonly string[]): DiffLineRow[] =>
  lines.filter((line) => !line.startsWith("\\")).map((line) => ({ kind: line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context", text: line.slice(1) }));

/** Rung 1. Recognition is DELEGATED WHOLE to `toolResult`: `editShape`/`writeShape` first — the same shape guard
 *  `normalizeToolResult` runs before it sets `structured`, and therefore the same one `editRows`/`writeRows` gate
 *  the header's diff summary on — and only then `patchLineCounts`, whose one-bad-hunk-rejects-the-whole-patch rule
 *  is inherited rather than re-derived (half a diff would read as a real diff on screen). Gating on the counts
 *  ALONE would be strictly looser than the header's gate, and a body that recognizes more than its header does is
 *  a body handing out absolute line numbers for a call the rest of the clone calls unrecognized. Its counts are
 *  used verbatim for the matching reason: header and body can never disagree about how many lines moved.
 *  Positions are all-or-nothing. A recognized patch whose hunks do not ALL carry a usable `oldStart` is still a
 *  faithful diff, but it is no longer an absolutely-numbered one, and it says so — it does not fall through to the
 *  disk rung, because a recognized patch already describes the edit better than a re-read of a newer file could. */
function sidecarPatch(sidecar: Record<string, unknown>, counts: { added: number; removed: number }): ResolvedPatch | undefined {
  const raw = (sidecar.structuredPatch as unknown[]).filter(isRecord);
  if (raw.length === 0) return undefined;                                     // recognized, but describes no change: no diff to show
  const hunks = raw.map((h): DiffHunk => ({ oldStart: lineNumber(h.oldStart), rows: rowsFrom(h.lines as string[]) }));
  const positioned = hunks.every((h) => h.oldStart !== undefined);
  return { hunks: positioned ? hunks : hunks.map((h) => ({ ...h, oldStart: undefined })), numbering: positioned ? "absolute" : "approximate", ...counts };
}

/** The anchor: the 0-based line offset at which the pre-edit snippet still sits in the file on disk, or
 *  `undefined` when we cannot prove it. Every rejection here is deliberate — no path (a Bash-shaped input), a
 *  file that is gone or unreadable, an empty `old_string` (an insertion matches everywhere), content that has
 *  changed since the edit, and a SECOND occurrence (a `replace_all` edit, or the same snippet twice) which makes
 *  "the" position a guess. A guess is exactly what the approximate mode exists to avoid. */
function anchorOffset(oldText: string, filePath: string | undefined, readFile: (p: string) => string | undefined): number | undefined {
  if (filePath === undefined || oldText.length === 0) return undefined;
  const content = readFile(filePath);
  if (content === undefined) return undefined;
  const first = content.indexOf(oldText);
  if (first < 0 || content.indexOf(oldText, first + 1) >= 0) return undefined;
  return content.slice(0, first).split("\n").length - 1;
}

/** Rung 2. jsdiff over the two retained strings with upstream's 3 lines of context; the hunks come back numbered
 *  RELATIVE to the snippet, and the anchor (when we have one) shifts every one of them into file coordinates.
 *  Counts are the `+`/`-` ROWS — the changed-line count, never the input's own line count. That distinction is the
 *  whole reason this rung exists: toolSummaries.ts:106-108 rejected counting the input whole, and this replaces
 *  that missing row with a real diff rather than reviving the dishonest one. */
function derivedPatch(oldText: string, newText: string, filePath: string | undefined, readFile: (p: string) => string | undefined): ResolvedPatch | undefined {
  const raw = structuredPatch("a", "a", oldText, newText, undefined, undefined, { context: 3 }).hunks;
  if (raw.length === 0) return undefined;                                     // old and new are the same text: nothing changed
  const anchor = anchorOffset(oldText, filePath, readFile);
  const hunks = raw.map((h): DiffHunk => ({ oldStart: anchor === undefined ? undefined : anchor + h.oldStart, rows: rowsFrom(h.lines) }));
  let added = 0, removed = 0;
  for (const row of hunks.flatMap((h) => h.rows)) { if (row.kind === "add") added++; else if (row.kind === "remove") removed++; }
  return { hunks, numbering: anchor === undefined ? "approximate" : "absolute", added, removed };
}

const readFromDisk = (path: string): string | undefined => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

/** Resolution is memoized on the RETAINED CALL'S INPUT OBJECT, which `transcriptModel` mints once per `tool_use`
 *  block (`extractCalls`: `input: b.input`) and thereafter only ever hands out again — projections re-read the
 *  same `ToolEvent`s off `toolEvents()`, they never reparse a message. That identity is the load-bearing part:
 *  tool rows are UNCACHED and `useChat` re-projects on a 600 ms cursor blink, so an unmemoized rung 2 would run a
 *  synchronous `readFileSync` about twice a second for every Edit row on screen.
 *  The sidecar is checked by IDENTITY on top of it because the retained call is MUTATED in place: a disk-bootstrapped
 *  call starts sidecar-less and `upgradeDuplicate` later attaches the host's richer copy to the very same object
 *  (`call.result.sidecar = sidecar`). Keying on the input alone would pin the approximate answer forever and the
 *  absolute positions would never appear. */
const memo = new WeakMap<object, { sidecar: unknown; patch: ResolvedPatch | undefined }>();

/** The ladder itself. `undefined` means "nothing diffable here" — no recognized patch and no `old_string`/
 *  `new_string` pair — which is also the Write CREATE answer: a create keeps F3's preview-alone row (census
 *  01#58–62), so it must never be routed through here as an all-add diff. A Write-as-UPDATE reaches rung 1
 *  through its own recognized sidecar, which is the only shape that describes it.
 *  `input` arrives unknown-typed from the wire, so a non-record is ANSWERED rather than thrown on — and answered
 *  first, ahead of the memo, because a primitive is not a legal WeakMap key. Substituting a fresh `{}` for it
 *  would be worse than the throw: every such call would mint a new memo key and re-resolve forever. */
export function resolvePatch(args: { input: Record<string, unknown>; sidecar?: unknown; readFile?: (p: string) => string | undefined }): ResolvedPatch | undefined {
  const { input, sidecar, readFile = readFromDisk } = args;
  if (!isRecord(input)) return undefined;
  const cached = memo.get(input);
  if (cached !== undefined && cached.sidecar === sidecar) return cached.patch;
  const patch = resolve(input, sidecar, readFile);
  memo.set(input, { sidecar, patch });
  return patch;
}

function resolve(input: Record<string, unknown>, sidecar: unknown, readFile: (p: string) => string | undefined): ResolvedPatch | undefined {
  // Write shapes are gated POSITIVELY on `type === "update"` — the same rule `writeRows` applies — so a
  // create renders its preview, never a diff, and an off-census write shape (missing or unknown `type`)
  // cannot produce a body with no header above it (t6 re-review residual). Edit shapes pass unconditionally,
  // mirroring `normalizeToolResult`'s Edit branch, which ignores `type` entirely.
  const written = writeShape(sidecar);
  const recognized = editShape(sidecar) ?? (written?.type === "update" ? written : undefined);
  const counts = recognized === undefined ? undefined : patchLineCounts(recognized);
  if (counts !== undefined && recognized !== undefined) return sidecarPatch(recognized, counts);
  const oldText = str(input.old_string), newText = str(input.new_string);
  if (oldText === undefined || newText === undefined) return undefined;
  return derivedPatch(oldText, newText, str(input.file_path), readFile);
}
