// tui/src/historySearch.ts — pure helpers for the Ctrl-R prompt-history search (bundle HistorySearch
// context). Scopes cycle session → project → everywhere (bundle SDo, initial "everywhere"); ranking is
// the bundle's two-class rule: substring matches first, then subsequence matches (its oDb helper),
// order preserved within each class. Entries come from persisted transcripts via rows.ts — the same
// prompt classifier the rewind picker and replay use, so "what counts as a prompt" cannot drift.
import { rowKind, promptText } from "../sessions/rows.js";

export const HISTORY_SCOPES = ["session", "project", "everywhere"] as const;
export type HistoryScope = (typeof HISTORY_SCOPES)[number];
export function nextScope(s: HistoryScope): HistoryScope { return HISTORY_SCOPES[(HISTORY_SCOPES.indexOf(s) + 1) % HISTORY_SCOPES.length]; }

export interface HistEntry { text: string; ts: number }

/** Prompt rows of one persisted transcript, NEWEST-FIRST. Row timestamps when present, else fallbackTs. */
export function promptEntries(msgs: any[], fallbackTs: number): HistEntry[] {
  const out: HistEntry[] = [];
  for (const m of msgs) {
    if (rowKind(m) !== "prompt") continue;
    const text = promptText(m).trim();
    if (!text) continue;
    const ts = m.timestamp ? Date.parse(m.timestamp) || fallbackTs : fallbackTs;
    out.push({ text, ts });
  }
  return out.reverse();
}

/** Merge per-session lists newest-first, deduping exact texts (the newest occurrence wins). */
export function mergeEntries(lists: HistEntry[][]): HistEntry[] {
  const all = lists.flat().sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>(); const out: HistEntry[] = [];
  for (const e of all) { if (seen.has(e.text)) continue; seen.add(e.text); out.push(e); }
  return out;
}

function isSubsequence(hay: string, needle: string): boolean {
  let r = 0;
  for (let i = 0; i < hay.length && r < needle.length; i++) if (hay[i] === needle[r]) r++;
  return r === needle.length;
}

/** Substring matches first, then subsequence matches, order preserved within each class. */
export function rankHistory(entries: HistEntry[], query: string): HistEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const sub: HistEntry[] = [], seq: HistEntry[] = [];
  for (const e of entries) {
    const lower = e.text.toLowerCase();
    if (lower.includes(q)) sub.push(e);
    else if (isSubsequence(lower, q)) seq.push(e);
  }
  return sub.concat(seq);
}

export function ageLabel(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
