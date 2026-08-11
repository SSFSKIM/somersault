// tui/src/diffSource.ts — F4 Task 6: the patch-source LADDER, the one place that answers "what changed, and do
// we know where". Two rungs, in strict order (spec Decision Log "Diff line numbers", P94):
//   1. a RECOGNIZED `tool_use_result.structuredPatch` — absolute hunk positions taken verbatim, disk NEVER read
//      (a re-read observes state NEWER than the completed edit it would be numbering);
//   2. a flat-only Edit — diffed locally from the complete retained input, and anchored against disk ONLY when
//      one of the two sides of the edit (pre-edit `old_string`, else post-edit `new_string`) is still there
//      EXACTLY once; otherwise the hunks carry no position at all.
// The rule under both: being visibly approximate beats being confidently wrong. `numbering` is the wire that
// carries that admission to the renderer — an unanchored patch never hands out a line number it cannot stand
// behind. Purely a source resolver: it renders nothing, and Task 7 owns every glyph.
import { readFileSync } from "node:fs";
import { structuredPatch } from "diff";
import { editShape, patchLineCounts, writeShape } from "./toolResult.js";

export interface DiffLineRow { kind: "add" | "remove" | "context"; text: string; }
export interface DiffHunk { oldStart: number | undefined; rows: DiffLineRow[]; }
/** `filePath` is the diff's LANGUAGE seam (EP-R5): `diffRender` highlights a body by extension/filename, and it
 *  receives nothing but the patch — so the path the edit was made against has to ride here or no body can ever be
 *  detected. Optional because rung 2 reaches a pathless flat Edit (a synthetic input, a Bash-shaped call), and
 *  populated INSIDE the resolver rather than by a caller: the memo hands the same object out on every projection,
 *  so a `{...patch, filePath}` at the call site would drop it on a cache hit AND mint a new object per repaint,
 *  which is exactly the identity `renderDiff`'s own memo keys on. */
export interface ResolvedPatch { hunks: DiffHunk[]; numbering: "absolute" | "approximate"; added: number; removed: number; filePath?: string; }

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
  // The RESULT's own `filePath` is the ONLY answer, and it always exists: reaching this rung at all means
  // `editShape` or `writeShape` accepted, and both require `typeof filePath === "string"`. It is also the
  // right one — the path the tool reports having written, where the input's is the path it was asked to
  // write — which is the same result-is-authoritative rule the counts follow. (A `?? inputPath` fallback
  // stood here through t10; the guards make it dead code, so it is gone rather than left implying that a
  // sidecar can arrive pathless.) `str` stays for the narrowing, not for the guard.
  return { hunks: positioned ? hunks : hunks.map((h) => ({ ...h, oldStart: undefined })), numbering: positioned ? "absolute" : "approximate", ...counts, filePath: str(sidecar.filePath) };
}

/** The anchor: the 0-based line offset at which the edited span sits in the file on disk, or `undefined` when
 *  we cannot prove it. TWO needles, in this order, because the disk we read is not always the disk the edit was
 *  computed against:
 *    · `old_string` — right when the file is still PRE-edit: a failed, rejected or interrupted Edit, or a file
 *      reverted behind us. Then the snippet is literally still there and names its own position.
 *    · `new_string` — right when the file is POST-edit, which is the ORDINARY case on the very path this rung
 *      exists for. A SUCCESSFUL Edit leaves `new_string` on disk, so `indexOf(old_string)` can only miss; and
 *      rung 2 is reached exactly when there is no recognized sidecar, which is the disk-replay shape
 *      (`getSessionMessages` strips sidecars). Without this fallback every ordinary flat-only Edit was stuck
 *      approximate forever — it could never once anchor.
 *  THE ARITHMETIC IS THE SAME IN BOTH DIRECTIONS. An Edit replaces ONE contiguous span and touches nothing
 *  ahead of it, so the bytes before the replacement are byte-identical pre- and post-edit: the line offset of
 *  the `new_string` match in the post-edit file IS the line offset of the `old_string` match in the pre-edit
 *  file, which is the pre-edit coordinate system `oldStart` is expressed in. Nothing after the span is read.
 *  Every rejection is deliberate — no path (a Bash-shaped input), a file that is gone or unreadable, an empty
 *  needle (which matches everywhere, so it is skipped PER NEEDLE rather than failing the whole anchor), and a
 *  SECOND occurrence (a `replace_all` edit, or the same snippet twice) which makes "the" position a guess. A
 *  guess is exactly what the approximate mode exists to avoid.
 *  CONTAINMENT settles the one case where both needles resolve: an `old_string` that survives INSIDE the
 *  `new_string` match — `old:"bar"` → `new:"foo\nbar"`, i.e. an insertion above an anchor line, the commonest
 *  Edit shape there is — is the post-edit file quoting itself, and its offset is short by exactly the lines
 *  inserted ahead of it. The enclosing (new) match wins there; everywhere else `old_string` leads. */
function anchorOffset(oldText: string, newText: string, filePath: string | undefined, readFile: (p: string) => string | undefined): number | undefined {
  if (filePath === undefined) return undefined;
  const content = readFile(filePath);
  if (content === undefined) return undefined;
  const once = (needle: string): number | undefined => {
    if (needle.length === 0) return undefined;
    const first = content.indexOf(needle);
    return first < 0 || content.indexOf(needle, first + 1) >= 0 ? undefined : first;
  };
  const pre = once(oldText), post = once(newText);
  const at = pre === undefined ? post
    : post !== undefined && post <= pre && pre + oldText.length <= post + newText.length ? post
    : pre;
  return at === undefined ? undefined : content.slice(0, at).split("\n").length - 1;
}

/** Rung 2. jsdiff over the two retained strings with upstream's 3 lines of context; the hunks come back numbered
 *  RELATIVE to the snippet, and the anchor (when we have one) shifts every one of them into file coordinates.
 *  Counts are the `+`/`-` ROWS — the changed-line count, never the input's own line count. That distinction is the
 *  whole reason this rung exists: toolSummaries.ts:106-108 rejected counting the input whole, and this replaces
 *  that missing row with a real diff rather than reviving the dishonest one. */
function derivedPatch(oldText: string, newText: string, filePath: string | undefined, readFile: (p: string) => string | undefined): ResolvedPatch | undefined {
  const raw = structuredPatch("a", "a", oldText, newText, undefined, undefined, { context: 3 }).hunks;
  if (raw.length === 0) return undefined;                                     // old and new are the same text: nothing changed
  const anchor = anchorOffset(oldText, newText, filePath, readFile);
  const hunks = raw.map((h): DiffHunk => ({ oldStart: anchor === undefined ? undefined : anchor + h.oldStart, rows: rowsFrom(h.lines) }));
  let added = 0, removed = 0;
  for (const row of hunks.flatMap((h) => h.rows)) { if (row.kind === "add") added++; else if (row.kind === "remove") removed++; }
  return { hunks, numbering: anchor === undefined ? "approximate" : "absolute", added, removed, filePath };
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
  const inputPath = str(input.file_path);
  if (counts !== undefined && recognized !== undefined) return sidecarPatch(recognized, counts);
  const oldText = str(input.old_string), newText = str(input.new_string);
  if (oldText === undefined || newText === undefined) return undefined;
  return derivedPatch(oldText, newText, inputPath, readFile);
}
