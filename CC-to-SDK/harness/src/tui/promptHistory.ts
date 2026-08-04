// tui/promptHistory.ts — CM52/CM53's persisted prompt history (F5 task 6). One JSON object per line in
// `history.jsonl`; the composer's Up-arrow walk (task 7) and the Ctrl-R search (task 12) both read it.
// Transcribed from 2.1.220 rather than invented:
//  · `uu_`  (L317596)  the entry — `{ ...t, pastedContents, timestamp: Date.now(), project, sessionId }`
//  · `uu_`  (L317601)  the paste split — `content.length <= nu_` inlines `content`, else `contentHash`,
//                      and the ELSE arm is the only place a paste body is written to the cache (`DUd`)
//  · `nu_`  (L317645)  1024 · `gDo` (L317645) 100
//  · `cgr`  (L317622)  the gate — `Yt(CLAUDE_CODE_SKIP_PROMPT_HISTORY)`, which wraps the WHOLE append,
//                      cache write included
//  · `UUd`  (L317460)  the read walk — validity guard, scope filter, dedup by display, cap
//  · `iu_`  (L317513)  the resolve — `e.content || (e.contentHash ? load(e.contentHash) : null)`
//  · `hon`/`mP`/`LV` (L236123/L236131/L236136) mode ⇄ the display's `!` prefix
//
// SIX recorded divergences, each one deliberate (5 and 6 added by the t6 review):
//  1. LOCATION. Upstream's file is `~/.claude/history.jsonl`; ours is `history.jsonl` at the ccx fleet
//     root, by the prefs.ts:14 precedent — same format, our root, so `CCX_FLEET_ROOT` isolates tests and
//     we never write into the real Claude Code user's prompt log. (Task 13 carries the note.)
//  2. NO FILE LOCK. Upstream batches pending entries in memory and takes a `proper-lockfile` lock around
//     a coalesced flush (`lu_`, L317540). Ours is one `appendFileSync` per prompt: a single write of a
//     few hundred bytes with `O_APPEND` is atomic on every filesystem we target, and the batching exists
//     upstream to amortise an ASYNC lock we do not take. The cost is that two ccx processes interleaving
//     at >4 KiB lines could in principle tear one; a prompt line is nowhere near that.
//  3. WHOLE-FILE READ. Upstream's `DBn` (L14587) pages BACKWARDS in 4 KiB chunks so a huge history is
//     never fully resident. Ours reads the file and reverses the lines, capping after. At 100 entries of
//     recall the file is measured in tens of KiB; the paging machinery would be more code than the file.
//  4. NO `mode` COLUMN. Upstream does not persist one: the submit site calls `hon(text, mode)` (L548774)
//     and every reader derives the mode back off the `!` prefix (`mP`, e.g. L489529/L489691). The task-6
//     brief sketched a `mode` field; a second source of truth for the same bit is exactly how a recalled
//     "!git status" ends up in prompt mode, so the prefix stays canonical and `displayForMode` /
//     `modeOfDisplay` / `stripModePrefix` below are what task 7 composes with.
//  5. NO `cu_` WRITE SUPPRESSOR. Upstream skips the append when the immediately preceding entry has the
//     same display/project/session and neither carries pastes (L317587–595). Ours writes the duplicate
//     line; `readHistory`'s dedup hides it from every reader, so the only cost is file growth.
//  6. A STRICTER VALIDITY GUARD. `UUd` (L317462) type-checks `project` only; ours also requires a string
//     `display` (our HistoryEntry promises one). Rejects strictly more garbage, changes no valid entry.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fleetRoot } from "../fleet/paths.js";
import { loadPaste, pasteHash, storePaste } from "./pasteCache.js";
import { chipSpans, newlineCount } from "./pasteChips.js";
import type { PastedEntry, PastedMap } from "./editor.js";
import type { HistoryScope } from "./historySearch.js";

/** `gDo`. Post-dedup, so a hundred repetitions of one prompt still leave ninety-nine slots. */
export const HISTORY_CAP = 100;
/** `nu_`. INCLUSIVE — `content.length <= nu_` inlines, so exactly 1024 chars stays in the line. */
export const PASTE_INLINE_MAX = 1024;

/** One persisted paste. Exactly one of `content` / `contentHash` is present (the `nu_` split); the reader
 *  must go through `resolvePastedContent`, never `.content` directly. `mediaType`/`filename` are upstream's
 *  and pass through untouched — our composer never sets them (editor.ts's `PastedEntry` is text-only), but
 *  they cost nothing and keep the line shape honest. `lineCount` is OURS, the same addition editor.ts made,
 *  so re-rendering a `[Pasted text #N +K lines]` label after a recall never re-walks the body. */
export interface HistoryPaste { id: number; type: "text"; content?: string; contentHash?: string; mediaType?: string; filename?: string; lineCount?: number }
/** A line of the file. `timestamp` is a MILLISECOND EPOCH — `Date.now()` at `uu_`:L317606, not an ISO
 *  string; the dedup key upstream builds (`${timestamp}\0${sessionId}`) depends on that. */
export interface HistoryEntry { display: string; timestamp: number; project?: string; sessionId?: string; pastedContents?: Record<number, HistoryPaste> }
/** What a submit site hands us: the FULL paste bodies straight off `EditorState.pastedContents`. The
 *  `nu_` split happens in here, not at the call site, so `appendHistory` is the single cache-write site. */
export interface HistoryAppend {
  display: string; project?: string; sessionId?: string; timestamp?: number;
  pastedContents?: Record<number, { id: number; type: "text"; content: string; lineCount?: number; mediaType?: string; filename?: string }>;
}

export function historyPath(env?: NodeJS.ProcessEnv): string { return join(fleetRoot(env), "history.jsonl"); }

/** `Yt` (L1562). A VOCABULARY, not a presence check: `CLAUDE_CODE_SKIP_PROMPT_HISTORY=0` (or `false`, or
 *  empty) does not skip. Getting this wrong the obvious way — `if (env.X)` — would silently disable the
 *  whole feature for anyone who exports the variable as `0`. */
function envTruthy(v: string | undefined): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase().trim());
}

/** `hon`/`mP`/`LV` MOVED OUT (t7 review, I2) to `promptMode.ts`, a leaf with no imports of any kind: this
 *  module reaches `node:fs`, `node:crypto` and `node:os`, and `editorHistory.ts` needed one `startsWith("!")`
 *  test from here — which pulled that entire graph into the pure reducer's runtime closure. Re-exported so
 *  every existing `from "./promptHistory.js"` import keeps resolving; new callers should take the leaf. */
export { composerMode, displayForMode, modeOfDisplay, stripModePrefix } from "./promptMode.js";

/** `cgr` + `uu_`. Silent on every failure: the caller is the submit path, and a read-only home must cost
 *  the user their history, not their prompt.
 *
 *  `project` defaults to the cwd (upstream's `Ll()` is the project root) because `UUd`'s first guard drops
 *  any line without a STRING project — an entry written without one would be invisible at every scope,
 *  including `everywhere`, which is a silent data-loss trap rather than a degraded read. */
export function appendHistory(e: HistoryAppend, env: NodeJS.ProcessEnv = process.env): void {
  if (envTruthy(env.CLAUDE_CODE_SKIP_PROMPT_HISTORY)) return;
  const pastedContents: Record<number, HistoryPaste> = {};
  for (const [key, p] of Object.entries(e.pastedContents ?? {})) {
    // Upstream also skips `type === "image" | "audio"` here; our PastedMap is text-only by construction
    // (editor.ts:16), so that arm would be unreachable code. Restore it the day images land.
    const inline = p.content.length <= PASTE_INLINE_MAX;
    const contentHash = inline ? undefined : pasteHash(p.content);
    pastedContents[Number(key)] = { id: p.id, type: p.type, ...(inline ? { content: p.content } : { contentHash }), mediaType: p.mediaType, filename: p.filename, lineCount: p.lineCount };
    // `DUd` (L317608) — the ONLY paste-cache write in the product, and it lives inside the skip gate.
    if (!inline) storePaste(p.content, env);
  }
  const entry: HistoryEntry = { display: e.display, pastedContents, timestamp: e.timestamp ?? Date.now(), project: e.project ?? process.cwd(), sessionId: e.sessionId };
  try {
    mkdirSync(fleetRoot(env), { recursive: true });
    // 0o600 applies on creation only, which is the moment that matters — a prompt log is at least as
    // sensitive as the paste cache it points into.
    appendFileSync(historyPath(env), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch { /* best-effort, exactly like upstream's `Failed to write prompt history` log-and-continue. */ }
}

/** `UUd`, newest-first. Order of operations is load-bearing and is upstream's: validity guard → scope
 *  filter → dedup → cap. Filtering BEFORE dedup is why a prompt shadowed by a newer identical one in
 *  another project still surfaces when you scope to its own project; deduping first would eat it. The cap
 *  counts KEPT entries, not scanned lines, so a hundred repeats of `ls` do not exhaust the window. */
export function readHistory(opts: { scope: HistoryScope; project?: string; sessionId?: string; limit?: number }, env: NodeJS.ProcessEnv = process.env): HistoryEntry[] {
  let raw: string;
  try { raw = readFileSync(historyPath(env), "utf8"); } catch { return []; }   // ENOENT on first run, EISDIR on a hand-mangled root
  const project = opts.project ?? process.cwd();
  // `limit` is a DEFAULT-onlier, clamped: upstream's `gDo` is an unconditional ceiling, so a caller asking
  // for 500 still gets at most 100 (t6 review). `scope:"session"` with no sessionId matches only the
  // sessionless entries — no current caller does it; T7/T12 must pass a real id.
  const limit = Math.min(opts.limit ?? HISTORY_CAP, HISTORY_CAP);
  const lines = raw.split("\n");
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    if (!lines[i]) continue;
    let o: unknown;
    try { o = JSON.parse(lines[i]); } catch { continue; }   // one torn line must not cost the other ninety-nine
    const e = o as HistoryEntry;
    // Upstream's guard, and it is a TYPE check, not a presence check: `typeof o.project !== "string"`
    // also rejects `null`, a number, and every non-object line in one go.
    if (!e || typeof e !== "object" || typeof e.project !== "string" || typeof e.display !== "string") continue;
    if (opts.scope === "project" && e.project !== project) continue;
    if (opts.scope === "session" && e.sessionId !== opts.sessionId) continue;
    if (seen.has(e.display)) continue;
    seen.add(e.display);
    out.push(e);
  }
  return out;
}

/** `iu_`, minus its async. `||` NOT `??`, transcribed: an empty inlined `content` is treated as absent and
 *  falls through to the hash arm — which for a zero-length paste has nothing behind it, so the caller gets
 *  `null` and renders upstream's `[Pasted text #N — content no longer available]` (`ou_`, L317398).
 *  Resolution is deliberately NOT done by `readHistory`: a scroll through a hundred recalls would otherwise
 *  read a hundred files off disk to render labels that never expand. */
export function resolvePastedContent(rec: HistoryPaste, env?: NodeJS.ProcessEnv): string | null {
  return rec.content || (rec.contentHash ? loadPaste(rec.contentHash, env) : null);
}

/** `ou_` (L317398), the `[Pasted text` arm verbatim — an EM DASH (U+2014), not a hyphen. (Its
 *  `[...Truncated text` arm needs a truncation species this port has no producer for.) */
export function lostPasteLabel(id: number): string { return `[Pasted text #${id} — content no longer available]`; }

/** `au_` (L317525): rewrite every placeholder whose id is in `lost` to `ou_`'s text, right to left so each
 *  replacement leaves the earlier match indices valid. `[Image` labels are skipped, upstream's own filter.
 *  Applied per LINE because a label never contains a newline (`chipSpans` is line-scoped). */
export function rewriteLostChips(display: string, lost: ReadonlySet<number>): string {
  if (lost.size === 0) return display;
  return display.split("\n").map((line) => {
    const spans = chipSpans(line);
    let out = line;
    for (let i = spans.length - 1; i >= 0; i--) {
      if (!lost.has(spans[i].id) || line.slice(spans[i].start).startsWith("[Image")) continue;
      out = out.slice(0, spans[i].start) + lostPasteLabel(spans[i].id) + out.slice(spans[i].end);
    }
    return out;
  }).join("\n");
}

/** `yDo` (L317537), the per-entry hydration upstream runs INSIDE its read walk (`yield await yDo(o)`,
 *  L317510) — resolve every paste body, and rewrite the labels of the ones that are gone. Kept out of
 *  `readHistory` for the reason that function's header gives (a Ctrl-R scroll must not read a hundred files
 *  to render labels that never expand); ChatComposer calls it once per entry at SEED time instead, which is
 *  what lets the editor's history walk stay pure — by the time a recall happens every body is already in
 *  memory as a plain `PastedEntry`.
 *
 *  `lineCount` is recomputed when the line did not carry one, so a `[Pasted text #N +K lines]` label rebuilt
 *  against a fresh id (editorHistory's `rebuildChips`) can never print a different K than it went in with. */
export function hydrateEntry(e: HistoryEntry, env?: NodeJS.ProcessEnv): { display: string; pastedContents: PastedMap } {
  const pastedContents: PastedMap = {};
  const lost = new Set<number>();
  for (const [key, rec] of Object.entries(e.pastedContents ?? {})) {
    const id = Number(key);
    const content = resolvePastedContent(rec, env);
    if (content === null) { if (rec.type === "text") lost.add(id); continue; }
    const entry: PastedEntry = { id: rec.id, type: "text", content, lineCount: rec.lineCount ?? newlineCount(content) };
    pastedContents[id] = entry;
  }
  return { display: rewriteLostChips(e.display, lost), pastedContents };
}
