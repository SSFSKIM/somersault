// tui/src/commandComplete.ts — pure slash-command catalog completion: entry type, normalize, merge, fuzzy rank.
// Mirrors fileComplete.ts (the @-mention ranker) so editor.ts can drive a / command popup the same way.
import { rankCandidates } from "./fileComplete.js";

export interface CommandEntry { name: string; description: string; argumentHint?: string; source: "local" | "catalog"; aliases?: string[] }

/** Normalize a raw capabilities().commands entry (object or bare string) to a CommandEntry; null on bad shape. */
export function toCatalogEntry(raw: unknown): CommandEntry | null {
  const r = raw as any;
  const name = typeof r === "string" ? r : r?.name;
  if (!name || typeof name !== "string") return null;
  const aliases = Array.isArray(r?.aliases) ? r.aliases.filter((a: unknown): a is string => typeof a === "string" && a.length > 0) : [];
  return { name, description: typeof r?.description === "string" ? r.description : "", argumentHint: r?.argumentHint || undefined, source: "catalog", ...(aliases.length ? { aliases } : {}) };
}

/** Merge local commands with the live catalog; local wins on a name collision; local-first order then catalog. */
export function mergeCommands(local: CommandEntry[], catalog: CommandEntry[]): CommandEntry[] {
  const seen = new Set(local.map((c) => c.name));
  return [...local, ...catalog.filter((c) => !seen.has(c.name))];
}

/** Fuzzy-rank entries by query on the name; empty query → catalog order; reuses fileComplete's scorer.
 *  `cap` defaults to NO truncation on purpose. The popup renders a scrolling 8-row window and arrow
 *  selection ranges over the whole of `items`, so a cap here does not merely shorten the view — it makes the
 *  tail of the catalog UNREACHABLE. With ~105 live commands, the old cap of 8 hid 90+ of them. */
/** ALIASES ARE SEARCH KEYS, NOT ROWS (upstream `eRb`, L489928: `aliasKey: n.aliases` is one more weighted key
 *  on the SAME fuse record). So every alias is scored as its own candidate string and then folded back onto
 *  the entry that owns it: typing `undo` surfaces the one `/rewind` row, never a second row called `/undo`.
 *  One candidate string can belong to more than one entry (two commands may claim the same alias, or a name
 *  may equal another's alias), so the fold is one-to-many and every owner is surfaced. Ranking is NOT capped
 *  before the fold — an alias hit and its own canonical row would each consume a slot there and the caller
 *  would get fewer ROWS than it asked for; the cap applies to the deduped output, where the count is real. */
export function rankCommands(entries: CommandEntry[], query: string, cap = entries.length): CommandEntry[] {
  if (!query) return entries.slice(0, cap);
  const owners = new Map<string, CommandEntry[]>();
  const add = (key: string, e: CommandEntry) => { const at = owners.get(key); if (at) at.push(e); else owners.set(key, [e]); };
  for (const e of entries) { add(e.name, e); for (const a of e.aliases ?? []) add(a, e); }
  const out: CommandEntry[] = [];
  // `candidates.length`, EXPLICITLY: `rankCandidates`' own default cap is 50, and inheriting it would make
  // the tail of a >50-command catalog unreachable — the exact failure this function's doc comment above is
  // about. Caught by test, after the t10 review asked for a sharper cap fixture.
  const candidates = [...owners.keys()];
  for (const c of rankCandidates(candidates, query, candidates.length)) {
    for (const e of owners.get(c.path) ?? []) if (!out.includes(e)) out.push(e);
    if (out.length >= cap) break;
  }
  return out.slice(0, cap);
}

/** CM28's honest mapping of upstream's Enter rule onto `CommandEntry`, which has no `type`. `XJa`
 *  (bundle L490110) inserts `/name ` and then executes it only when
 *  `a.type !== "prompt" || (a.argNames ?? []).length === 0` — i.e. a slash command that is a PROMPT TEMPLATE
 *  taking named arguments gets inserted and left for the user to fill in; everything else runs on the spot.
 *
 *  Our `CommandEntry` carries no `type` and no `argNames`, so the proxy (T6's catalog reality): a `local`
 *  entry is one of our own built-ins, which are never prompt templates, so it always runs; a `catalog` entry
 *  IS an SDK prompt command, and `argumentHint` is the only argument evidence it carries, so it runs unless
 *  it declares one. Recorded as a mapping rather than a transcription because that is what it is. */
export function executesOnEnter(e: CommandEntry): boolean {
  return e.source === "local" || !e.argumentHint;
}
