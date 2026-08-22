// harness/src/session/turnInput.ts — F9 T-IMAGE Task 4 (I3a): the public UserTurnInput union and the
// AUTHORITATIVE normalizer, per spec v3.1's "Authoritative validation lives at the Session
// message-builder boundary" (docs/superpowers/specs/2026-08-22-f9-wave-design.md): whatever path a
// turn arrived by — REPL paste-time staging or a direct library call — `normalizeTurnInput` is the
// ONE place every cap is actually enforced. A library caller that never touched the composer's
// paste-time ladder (clipboardImage.ts's `pasteClipboardImage`) gets exactly the same guarantees a
// pasted image does, because this module re-decodes each block's OWN bytes rather than trusting
// anything the caller claims about them — the public `UserContentBlock` carries no dimensions field
// at all, so there is nothing to lie about except the bytes themselves, and the bytes are what gets
// read.
//
// Reused, not reinvented: `pngDimensions`/`jpegDimensions` (the header-only readers) and the two
// shared budget constants (`MAX_DIMENSION`, `POST_PROCESS_BYTE_BUDGET`) come straight from
// `tui/clipboardImage.ts` — Task 2's paste-time ladder and this builder enforce the identical
// per-image ceiling from ONE source of truth, so a raw library submit can never be held to a looser
// bar than a paste went through. Importing a `tui/` leaf from `session/` (core) does invert the
// usual layering, but it is already established precedent in this tree (appserver/workspace.ts,
// sessions/rows.ts, cli/*.ts all import tui/* leaves the same way) and both readers are pure
// Buffer-in/dims-out functions with no UI dependency, so there is no real coupling to avoid by
// duplicating them into a third leaf.
import { pngDimensions, jpegDimensions, MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET } from "../tui/clipboardImage.js";

/** The wire shape canon itself sends (spot-verified at `cli.pretty.js` L371395-371427 and re-proven
 *  live by probe 113): a base64 image block, `media_type` a bare string here (not the Anthropic SDK's
 *  literal union) so this public type never forces a caller to import `@anthropic-ai/sdk` just to
 *  build a turn. `content: text` for strings is what makes an ordinary prompt weightless to send. */
export type UserContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

/** What every submit surface accepts. A bare string is the overwhelmingly common case and stays
 *  free of array/object overhead; the array form is the ONLY way an image reaches a turn. */
export type UserTurnInput = string | UserContentBlock[];

/** A flat text preview of a turn, for surfaces that want one string and don't render blocks (logs, a
 *  CLI echo, a non-REPL caller's own display). Text blocks contribute their own text verbatim; an
 *  image block contributes a numbered `[Image #N]` placeholder (matching the project's established
 *  `imageChipLabel` convention, pasteChips.ts) — ordinal counted across images in THIS turn only, so
 *  a second image is always `#2` regardless of how many text blocks sit between them. Blocks
 *  concatenate directly (no injected separator): the array form is meant to read as one flowing
 *  message, the same as the string form it stands in for. */
export function flattenForDisplay(input: UserTurnInput): string {
  if (typeof input === "string") return input;
  let imageOrdinal = 0;
  return input.map((b) => (b.type === "text" ? b.text : `[Image #${++imageOrdinal}]`)).join("");
}

/** Builds the wire array from separately-tracked text + images: ONE text block first (even when
 *  empty — canon sends the typed text unconditionally), every image block appended after it in
 *  caller order. This is the assembly-order half of canon's shape (L371395-371427); the other half —
 *  actually enforcing the caps on what gets assembled — is `normalizeTurnInput` below, which every
 *  caller of this function's OUTPUT still passes through at the Session builder regardless. */
export function assembleUserContent(text: string, images: { data: string; mediaType: string }[]): UserContentBlock[] {
  const blocks: UserContentBlock[] = [{ type: "text", text }];
  for (const img of images) blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  return blocks;
}

/** base64 STRING-length input sanity ceiling: a DoS/memory-safety gate against a caller handing the
 *  builder something wildly oversized, not the real per-image budget (that is `POST_PROCESS_BYTE_BUDGET`,
 *  imported above — roughly 683KB of base64 for a 512,000-byte image, an order of magnitude smaller).
 *  Checked BEFORE decoding: an input this large is rejected on its declared length alone, load-bearing
 *  for the boundary tests, which assert this reason fires ONLY strictly above 5 MiB even though an
 *  in-bounds base64 string this size still fails the (far smaller) post-ceiling check right after —
 *  proving the 5 MiB comparison itself uses the right operator, independent of what else also trips. */
const MAX_BASE64_INPUT_BYTES = 5 * 1024 * 1024;
/** Per-turn ceiling on the SUM of passing images' decoded byte lengths (not base64 length — the same
 *  unit `POST_PROCESS_BYTE_BUDGET` uses, so roughly ten images can share one turn). Blocks are walked
 *  in order and a block is added to the running total only once it has cleared every per-block check;
 *  a block whose addition would cross this ceiling degrades on its own, and a later, smaller block
 *  that would still fit is still given the chance to. */
const MAX_AGGREGATE_BYTES = 5 * 1024 * 1024;

/** Per-block verdict: either the block's own decoded byte count (folded into the caller's running
 *  aggregate), or the reason it failed — checked in this exact order, because two of the four checks
 *  below are enforced on such different scales (5 MiB of base64 input vs. 512,000 decoded bytes) that
 *  a real image trips the SECOND check even when it clears the first; order is what makes each
 *  reason attributable to the boundary that actually produced it. */
function checkImageBlock(block: UserContentBlock & { type: "image" }, aggregateSoFar: number): { ok: true; bytes: number } | { ok: false; reason: string } {
  const data = block.source.data;
  // Header-decode, not caller-trust: read the ACTUAL bytes' own PNG IHDR / JPEG SOF, ignoring both
  // `media_type` and any dimensions a caller might have supplied elsewhere. This is what defeats the
  // "library-bypass" case — a small, cheaply-constructed buffer whose header claims oversized pixel
  // dimensions still gets caught here, because the check reads the header field itself rather than
  // inferring size from byte count.
  const decoded = Buffer.from(data, "base64");
  const dims = pngDimensions(decoded) ?? jpegDimensions(decoded);
  if (!dims) return { ok: false, reason: "unreadable image data" };
  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    return { ok: false, reason: `dimensions ${dims.width}x${dims.height} exceed the ${MAX_DIMENSION}x${MAX_DIMENSION}px limit` };
  }
  if (data.length > MAX_BASE64_INPUT_BYTES) return { ok: false, reason: `base64 input exceeds the ${MAX_BASE64_INPUT_BYTES}-byte limit` };
  if (decoded.length > POST_PROCESS_BYTE_BUDGET) return { ok: false, reason: `image data exceeds the ${POST_PROCESS_BYTE_BUDGET}-byte limit` };
  if (aggregateSoFar + decoded.length > MAX_AGGREGATE_BYTES) return { ok: false, reason: `turn's total image size exceeds the ${MAX_AGGREGATE_BYTES}-byte limit` };
  return { ok: true, bytes: decoded.length };
}

/** AUTHORITATIVE. The one seam every `UserTurnInput` passes through at the Session builder
 *  regardless of caller (see session.ts's `userTurn`) — a string passes through untouched (there is
 *  nothing to validate); an array is walked block-by-block, and any image block that fails ANY of
 *  the four caps above (unreadable header, oversized dimensions, oversized base64 input, oversized
 *  decoded bytes, or pushes the running per-turn total over budget) is replaced IN PLACE with the
 *  failure text block canon's own copy uses. Every other block — text, or an image that passed —
 *  survives untouched at its original index, and the turn is never refused wholesale: a caller who
 *  sent five images and one deliberately-corrupt one still gets four images and one apology line,
 *  not a thrown error. */
export function normalizeTurnInput(input: UserTurnInput): UserTurnInput {
  if (typeof input === "string") return input;
  let aggregate = 0;
  return input.map((block): UserContentBlock => {
    if (block.type !== "image") return block;
    const verdict = checkImageBlock(block, aggregate);
    if (!verdict.ok) return { type: "text", text: `[Image could not be processed: ${verdict.reason}]` };
    aggregate += verdict.bytes;
    return block;
  });
}
