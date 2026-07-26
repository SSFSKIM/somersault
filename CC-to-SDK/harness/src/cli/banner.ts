import { isShortId } from "../fleet/paths.js";

// MUST stay byte-exact: doperpowers parses it with
// `sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p'`, and the separator is U+00B7.
// (Line comments, not a /** */ block — the sed pattern's `.*/` would close the block early.)
export function formatBanner(short: string): string {
  if (!isShortId(short)) throw new Error(`short id must be exactly 8 lowercase hex, got ${JSON.stringify(short)}`);
  return `backgrounded · ${short}`;
}
