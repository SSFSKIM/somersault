// src/appserver/searchScan.ts — pure search primitives (spec D-M5-15/16/17 rev 3). ONE tuple ordering
// shared by the sort and the cursor resume — the rev-1 plan let them diverge and the review caught a
// session locator masquerading as a keyset (F8). Two cursor codecs live beside it for the same reason.
import { rowKind, promptText } from "../sessions/index.js";

export const SEARCH_CAPS = { maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50, defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500 } as const;
export type SortKey = "created_at" | "updated_at" | "recency_at";

export function sortValueOf(info: { createdAt?: number; lastModified: number }, key: SortKey): number | null {
  if (key === "created_at") return info.createdAt ?? null;
  return info.lastModified; // updated_at ≡ recency_at ≡ lastModified on this store (D-M5-6)
}

export function compareTuple(a: { v: number | null; s: string }, b: { v: number | null; s: string }, dir: "asc" | "desc"): number {
  if (a.v === null && b.v === null) return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
  if (a.v === null) return 1; // nulls last in BOTH directions
  if (b.v === null) return -1;
  if (a.v !== b.v) return dir === "asc" ? a.v - b.v : b.v - a.v;
  return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
}

export function sortForSearch<T extends { sessionId: string }>(rows: T[], dir: "asc" | "desc", valueOf: (r: T) => number | null): T[] {
  return [...rows].sort((a, b) => compareTuple({ v: valueOf(a), s: a.sessionId }, { v: valueOf(b), s: b.sessionId }, dir));
}

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const unb64 = (s: string): unknown => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { return null; } };

export function encodeSearchCursor(c: { v: number | null; s: string; r: number }): string { return b64(c); }
export function decodeSearchCursor(s: string): { v: number | null; s: string; r: number } | null {
  const p = unb64(s) as { v?: unknown; s?: unknown; r?: unknown; c?: unknown } | null;
  if (!p || (typeof p.v !== "number" && p.v !== null) || typeof p.s !== "string" || typeof p.r !== "number" || "c" in p) return null;
  return { v: p.v, s: p.s, r: p.r };
}
export function encodeOccCursor(c: { s: string; r: number; c: number; e: number | null }): string { return b64(c); }
export function decodeOccCursor(s: string): { s: string; r: number; c: number; e: number | null } | null {
  const p = unb64(s) as { s?: unknown; r?: unknown; c?: unknown; e?: unknown; v?: unknown } | null;
  if (!p || typeof p.s !== "string" || typeof p.r !== "number" || typeof p.c !== "number" || (typeof p.e !== "number" && p.e !== null) || "v" in p) return null;
  return { s: p.s, r: p.r, c: p.c, e: p.e };
}

/** The corpus (spec: Codex's "visible user messages and final assistant messages", via OUR classifier
 *  so search and replay cannot drift): user rows rows.ts classifies `prompt`, and assistant rows' text
 *  blocks. Everything else returns null. */
export function rowSearchText(m: unknown): string | null {
  const row = m as { type?: string; message?: { content?: unknown } };
  if (row?.type === "assistant") {
    const c = row.message?.content;
    if (!Array.isArray(c)) return null;
    const texts = c.filter((b: any) => b?.type === "text").map((b: any) => String(b.text ?? ""));
    return texts.length ? texts.join("\n") : null;
  }
  if (row?.type === "user") return rowKind(m) === "prompt" ? promptText(m) : null;
  return null;
}

export function makeSnippet(text: string, start: number, len: number): { snippet: string; snippetMatchRange: { start: number; end: number } } {
  const max = Math.max(SEARCH_CAPS.snippetMax, len); // a term longer than 200 units still fits its own snippet
  const pad = Math.max(0, Math.floor((max - len) / 2));
  const from = Math.max(0, start - pad);
  const snippet = text.slice(from, from + max);
  return { snippet, snippetMatchRange: { start: start - from, end: start - from + len } };
}
