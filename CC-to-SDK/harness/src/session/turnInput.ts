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
// shared budget constants (`MAX_DIMENSION`, `POST_PROCESS_BYTE_BUDGET`) come from `../media/imageDims.js`
// — a neutral leaf with no imports of its own (F10 T-MAINT item 3 ends the `session/` → `tui/`
// inversion this paragraph used to argue for: Task 2's paste-time ladder and this builder enforce the
// identical per-image ceiling from ONE source of truth, and neither now reaches into the other's
// layer to get it). This builder still re-decodes each block's OWN bytes rather than trusting
// anything a caller claims about them.
import { pngDimensions, jpegDimensions, MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET, MAX_IMAGES_PER_PROMPT } from "../media/imageDims.js";

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
export const MAX_BASE64_INPUT_BYTES = 5 * 1024 * 1024;
/** Per-turn ceiling on the SUM of passing images' decoded byte lengths (not base64 length — the same
 *  unit `POST_PROCESS_BYTE_BUDGET` uses, so roughly ten images can share one turn). Blocks are walked
 *  in order and a block is added to the running total only once it has cleared every per-block check;
 *  a block whose addition would cross this ceiling degrades on its own, and a later, smaller block
 *  that would still fit is still given the chance to. Exported (F10 T-IMGREACH I2) so the aggregate can
 *  be closed from CACHED byte counts by a caller that already validated each image once. */
export const MAX_AGGREGATE_BYTES = 5 * 1024 * 1024;

/** Counts the normalized OUTPUT, sentinel INCLUDED (round-2 F5): when a sentinel is emitted at most 63
 *  input blocks survive, so the output length never exceeds 64 for any input. */
export const MAX_CONTENT_BLOCKS = 64;
/** UTF-16 code units, summed over every text block of the OUTPUT (synthetic failure text, the I1 stranding
 *  label and the sentinel all included). Applies to the BARE-STRING form too — a string is one text block. */
export const MAX_TOTAL_TEXT = 1_048_576;
/** Units reserved out of MAX_TOTAL_TEXT for the block-collapse sentinel; the sentinel is hard-capped at
 *  this and is NEVER truncated. */
export const SENTINEL_TEXT_RESERVE = 256;
/** Units reserved out of MAX_TOTAL_TEXT for the truncation suffix. */
export const TRUNCATION_SUFFIX_RESERVE = 64;
export const TRUNCATION_SUFFIX = "\n[… prompt text truncated to fit the size limit]";

/** Per-block verdict: either the block's own decoded byte count and CANONICAL base64 (folded into the
 *  caller's running aggregate — the per-turn aggregate cap moved to the caller, `normalizeTurnInput`,
 *  because a stage does not know which turn it will join), or the reason it failed — checked in this
 *  exact order, because two of the four checks below are enforced on such different scales (5 MiB of
 *  base64 input vs. 512,000 decoded bytes) that a real image trips the SECOND check even when it clears
 *  the first; order is what makes each reason attributable to the boundary that actually produced it. */
function checkImageBlock(block: UserContentBlock & { type: "image" }): { ok: true; bytes: number; data: string } | { ok: false; reason: string } {
  const data = block.source.data;
  // ORDERING CONSTRAINT (final-review finding 1): this length check MUST run BEFORE `Buffer.from`
  // below, and nothing may move it after. `Buffer.from(data, "base64")` allocates a buffer the size of
  // the DECODED bytes — checking the cap on that buffer instead of on `data.length` first would mean
  // the allocation this cap exists to bound has already happened by the time it fires. A base64
  // string's length is always ≥ its decoded byte count, so bounding the STRING costs nothing to check
  // and bounds the allocation `Buffer.from` is about to make.
  if (data.length > MAX_BASE64_INPUT_BYTES) return { ok: false, reason: `base64 input exceeds the ${MAX_BASE64_INPUT_BYTES}-byte limit` };
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
  if (decoded.length > POST_PROCESS_BYTE_BUDGET) return { ok: false, reason: `image data exceeds the ${POST_PROCESS_BYTE_BUDGET}-byte limit` };
  // Canonical re-encode (round-3 F3): padding and whitespace in the INPUT base64 never survive into the
  // block a caller keeps — the daemon's frame derivation (Task 12) rests on this guarantee.
  return { ok: true, bytes: decoded.length, data: decoded.toString("base64") };
}

/** ONE image, ONE decode. `checkImageBlock`'s four caps, plus the canonical re-encode, minus the
 *  per-turn aggregate (a stage does not know its turn). The decoded length rides out so no caller ever
 *  has to decode a second time to do aggregate accounting. Exported so a caller that validates images
 *  ONE AT A TIME as they arrive — the app-server's stage registry (Task 7), which must validate exactly
 *  once — uses THIS function rather than a second copy of the four caps. */
export function validateImageBlock(
  block: UserContentBlock & { type: "image" },
): { ok: true; block: UserContentBlock & { type: "image" }; decodedBytes: number } | { ok: false; reason: string } {
  const verdict = checkImageBlock(block);
  if (!verdict.ok) return verdict;
  return {
    ok: true as const,
    decodedBytes: verdict.bytes,
    block: { ...block, source: { ...block.source, data: verdict.data } },
  };
}

/** The label form is `imageChipLabel`'s (tui/pasteChips.ts:57), spelled here rather than imported: this
 *  module is `session/` core and pinning the FORM with a test is cheaper than another tui→core import.
 *  Ordinals count images in the normalized OUTPUT, exactly as `flattenForDisplay` numbers them. */
export function syntheticImageLabel(imageCount: number): string {
  return Array.from({ length: imageCount }, (_, i) => `[Image #${i + 1}]`).join(" ");
}

/** probe 100, SDK 0.3.237: line 0 of a persisted session is a `queue-operation` record whose `content`
 *  key carries the first prompt's TEXT. With no text — or with an empty string, which is just as
 *  unextractable — the key is absent entirely and the SDK's metadata extractor declines the session:
 *  no `listSessions()` row, `getSessionInfo()` undefined, transcript intact. Fix forward only (owner
 *  fork): this predicate names the shape, `normalizeTurnInput` gives it a label. */
export function isStrandedTurn(blocks: readonly UserContentBlock[]): boolean {
  if (!blocks.some((b) => b.type === "image")) return false;
  return !blocks.some((b) => b.type === "text" && b.text.length > 0);
}

/** F10 T-IMGREACH Task 1 (I1): a turn that would persist with no extractable first-prompt text (probe
 *  100: excluded from `listSessions()`/`getSessionInfo()` even though its transcript survives intact)
 *  gets exactly ONE synthetic `[Image #N]` label — substituted into the first text block when one
 *  exists, else INSERTED at index 0. A deterministic position, not "wherever": `Session.submit([image])`
 *  with no text block at all is an existing supported shape (pinned by
 *  test/integration/host-image-transport.test.ts:374-388's HOST-assembled capture one layer above this
 *  builder), so there may be no block to substitute into. Extracted to a named function (F10 T-IMGREACH
 *  Task 2) so `normalizeValidatedBlocks` — the staged path, whose blocks never ran through this
 *  builder's own image decode — still gets the identical stranding guarantee. */
function applyStrandingLabel(blocks: UserContentBlock[]): UserContentBlock[] {
  if (!isStrandedTurn(blocks)) return blocks;
  const label = syntheticImageLabel(blocks.filter((b) => b.type === "image").length);
  const first = blocks.findIndex((b) => b.type === "text");
  if (first === -1) return [{ type: "text", text: label }, ...blocks];
  return blocks.map((b, i) => (i === first ? { type: "text", text: label } : b));
}

const sentinelText = (dropped: number) =>
  `[+${dropped} more blocks dropped: prompt exceeded the ${MAX_CONTENT_BLOCKS}-block limit]`;

/** ONE algorithm closes BOTH caps (round-3 F4 — the sentinel and the ceiling otherwise conflict at the
 *  joint boundary, where 63 survivors already sit at exactly the ceiling and the sentinel has nowhere to
 *  go). Three phases, in this order, and the order IS the correctness:
 *    (1) block count. The sentinel RESERVES ITS SLOT: when the input overflows, at most
 *        MAX_CONTENT_BLOCKS-1 = 63 input blocks survive and the sentinel is the 64th, so the output
 *        length is never > MAX_CONTENT_BLOCKS for any input.
 *    (2) the text ceiling is measured over the OUTPUT — user text plus the sentinel's own text.
 *    (3) if that total exceeds the ceiling, the USER's retained text is truncated from the LAST text
 *        block backward to `ceiling − sentinel reserve (when a sentinel exists) − suffix reserve`, and
 *        the suffix is appended to the last text block. The sentinel is never truncated.
 *  The RESERVES are upper bounds spent unconditionally, not measured lengths: that is what keeps this a
 *  single pass whose output is a deterministic function of the input rather than of how the sentinel
 *  happened to render. */
function applyOutputCaps(blocks: UserContentBlock[]): UserContentBlock[] {
  // ── (1) block count
  const overflow = blocks.length > MAX_CONTENT_BLOCKS;
  const kept = overflow ? blocks.slice(0, MAX_CONTENT_BLOCKS - 1) : blocks;
  const sentinel = overflow
    ? sentinelText(blocks.length - (MAX_CONTENT_BLOCKS - 1)).slice(0, SENTINEL_TEXT_RESERVE)
    : undefined;
  const out: UserContentBlock[] = sentinel === undefined ? [...kept] : [...kept, { type: "text", text: sentinel }];

  // ── (2) the ceiling, over the OUTPUT. UTF-16 code units, deliberately: `String#length` is the unit the
  //    cap is stated in, and it is also what bounds the memory a JS string actually holds.
  const userTextIdx: number[] = [];
  let userText = 0;
  for (let i = 0; i < kept.length; i++) {
    const b = out[i]!;
    if (b.type !== "text") continue;
    userTextIdx.push(i); userText += b.text.length;
  }
  if (userText + (sentinel?.length ?? 0) <= MAX_TOTAL_TEXT) return out;
  if (userTextIdx.length === 0) return out;   // nothing of ours to give — the sentinel alone cannot exceed

  // ── (3) truncate from the LAST text block backward
  const target = MAX_TOTAL_TEXT - (sentinel === undefined ? 0 : SENTINEL_TEXT_RESERVE) - TRUNCATION_SUFFIX_RESERVE;
  let excess = userText - target;
  for (let k = userTextIdx.length - 1; k >= 0 && excess > 0; k--) {
    const i = userTextIdx[k]!;
    const text = (out[i] as { type: "text"; text: string }).text;
    const drop = Math.min(excess, text.length);
    out[i] = { type: "text", text: text.slice(0, text.length - drop) };
    excess -= drop;
  }
  const last = userTextIdx[userTextIdx.length - 1]!;
  out[last] = { type: "text", text: (out[last] as { type: "text"; text: string }).text + TRUNCATION_SUFFIX };
  return out;
}

/** F10 fix-wave review finding P2: `normalizeTurnInput`'s array branch enforces `MAX_IMAGES_PER_PROMPT`
 *  by ordinal as it walks the input, BEFORE ever calling `validateImageBlock` — but the staged path
 *  (`normalizeValidatedBlocks` below) skips straight to `applyOutputCaps`, which caps block COUNT and
 *  TEXT length but has no notion of "this block is an image" at all. A stage reservation can carry the
 *  SAME completed stage id repeated arbitrarily many times (`ImageStageRegistry.reserve` takes a bare
 *  array with no de-dup), and even with distinct ids nothing upstream of this function ever counted
 *  images — so this is the one place the staged path can still enforce the cap without a second decode:
 *  ordinal-only, exactly like the inline check `normalizeTurnInput` already runs. */
function applyImageCountCap(blocks: UserContentBlock[]): UserContentBlock[] {
  let imageOrdinal = 0;
  return blocks.map((block): UserContentBlock => {
    if (block.type !== "image") return block;
    if (++imageOrdinal > MAX_IMAGES_PER_PROMPT) {
      return { type: "text", text: `[Image could not be processed: too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})]` };
    }
    return block;
  });
}

/** The second half of `normalizeTurnInput`: the image-count cap, the I1 stranding pass, and
 *  `applyOutputCaps`, over blocks whose images have ALREADY been validated and canonicalized by
 *  `validateImageBlock`. Exported for exactly one reason (plan-review r2 F-STAGE): re-running the full
 *  normalizer over staged blocks would decode every image a SECOND time, which is the cost the
 *  validate-once contract exists to avoid. Text handling is identical either way, so the two paths
 *  cannot drift on anything but the decode. The image-count cap runs FIRST, before the stranding label:
 *  an over-cap image becomes a non-empty text block, so a turn that strands only because of the excess
 *  images is correctly no longer "stranded" by the time `applyStrandingLabel` looks. */
export function normalizeValidatedBlocks(blocks: UserContentBlock[]): UserContentBlock[] {
  return applyOutputCaps(applyStrandingLabel(applyImageCountCap(blocks)));
}

/** AUTHORITATIVE. The one seam every `UserTurnInput` passes through at the Session builder
 *  regardless of caller (see session.ts's `userTurn`) — a string passes through the text-ceiling half
 *  of the output-accounting algorithm (a bare string is one text block, spec round-2 F5) and nothing
 *  else, since there is no image to validate; an array is walked block-by-block, and any image block
 *  that fails ANY of the caps (unreadable header, oversized dimensions, oversized base64 input,
 *  oversized decoded bytes, too many images in the turn, or pushes the running per-turn aggregate over
 *  budget) is replaced IN PLACE with the failure text block canon's own copy uses. Every other block —
 *  text, or an image that passed (now canonically re-encoded) — survives at its original index, and the
 *  turn is never refused wholesale: a caller who sent five images and one deliberately-corrupt one
 *  still gets four images and one apology line, not a thrown error. Definitionally
 *  `normalizeValidatedBlocks(validateEachImage(array))` — one composition, so every property proven of
 *  the normalizer holds of the staged path too, minus the decode. */
export function normalizeTurnInput(input: UserTurnInput): UserTurnInput {
  if (typeof input === "string") return (applyOutputCaps([{ type: "text", text: input }])[0] as { text: string }).text;
  let aggregate = 0, imageOrdinal = 0;
  const validated = input.map((block): UserContentBlock => {
    if (block.type !== "image") return block;
    if (++imageOrdinal > MAX_IMAGES_PER_PROMPT) {
      return { type: "text", text: `[Image could not be processed: too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})]` };
    }
    const v = validateImageBlock(block);
    if (!v.ok) return { type: "text", text: `[Image could not be processed: ${v.reason}]` };
    if (aggregate + v.decodedBytes > MAX_AGGREGATE_BYTES) {
      return { type: "text", text: `[Image could not be processed: turn's total image size exceeds the ${MAX_AGGREGATE_BYTES}-byte limit]` };
    }
    aggregate += v.decodedBytes;
    return v.block;
  });
  return normalizeValidatedBlocks(validated);
}
