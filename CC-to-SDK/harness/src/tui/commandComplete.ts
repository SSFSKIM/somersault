// tui/src/commandComplete.ts — pure slash-command catalog completion: entry type, normalize, merge, fuzzy rank.
// Mirrors fileComplete.ts (the @-mention ranker) so editor.ts can drive a / command popup the same way.
import { rankCandidates } from "./fileComplete.js";

export interface CommandEntry { name: string; description: string; argumentHint?: string; source: "local" | "catalog" }

/** Normalize a raw capabilities().commands entry (object or bare string) to a CommandEntry; null on bad shape. */
export function toCatalogEntry(raw: unknown): CommandEntry | null {
  const r = raw as any;
  const name = typeof r === "string" ? r : r?.name;
  if (!name || typeof name !== "string") return null;
  return { name, description: typeof r?.description === "string" ? r.description : "", argumentHint: r?.argumentHint || undefined, source: "catalog" };
}

/** Merge local commands with the live catalog; local wins on a name collision; local-first order then catalog. */
export function mergeCommands(local: CommandEntry[], catalog: CommandEntry[]): CommandEntry[] {
  const seen = new Set(local.map((c) => c.name));
  return [...local, ...catalog.filter((c) => !seen.has(c.name))];
}

/** Fuzzy-rank entries by query on the name; empty query → catalog order; reuses fileComplete's scorer.
 *  `cap` defaults to NO truncation on purpose. The popup renders a scrolling 8-row window and arrow
 *  selection is clamped to `items.length`, so a cap here does not merely shorten the view — it makes the
 *  tail of the catalog UNREACHABLE. With ~105 live commands, the old cap of 8 hid 90+ of them. */
export function rankCommands(entries: CommandEntry[], query: string, cap = entries.length): CommandEntry[] {
  if (!query) return entries.slice(0, cap);
  const byName = new Map(entries.map((e) => [e.name, e]));
  return rankCandidates(entries.map((e) => e.name), query, cap).map((c) => byName.get(c.path)).filter((e): e is CommandEntry => !!e);
}
