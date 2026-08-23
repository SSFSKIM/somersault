// harness/src/appserver/turnItems.ts — the ONE conversion from the app-server wire's `turn/start`
// input ITEMS to the engine's `UserTurnInput` blocks (spec 2026-08-23 rev 3, "Item → engine delivery").
//
// TWO CONTRACTS, and the second exists to protect the first:
//
//   CANONICAL ORDERING. One text block carrying the text fold (text items concatenated in declaration
//   order) with degrade notes appended to ITS end in image order, then the surviving images in
//   declaration order. This is the only shape BOTH origins can carry: the host wire folds every text
//   block into its single leading `text` and reassembles text-then-images, so an inProcess turn and a
//   fleet turn deliver the model the same input byte for byte only if the in-process assembly is this
//   same shape. `assembleUserContent` builds exactly it.
//
//   THE FULL CAP SUITE LIVES HERE. `normalizeTurnInput` (session/turnInput.ts) stays authoritative for
//   ITS callers, but it degrades a failing image IN PLACE — a text block at the image's index, which
//   would split the canonical text block and make the two origins differ. So this resolver enforces
//   every cap that seam enforces (strict base64 before decode, sniffed-bytes media type, MAX_DIMENSION,
//   per-image POST_PROCESS_BYTE_BUDGET, the running per-turn aggregate) using the SAME reason strings —
//   plus its own MAX_DATA_URL_CHARS bound on the payload it is about to decode, stricter than the seam's
//   and so still leaving it nothing to find. That is a contract requirement, not an optimization, and
//   turn-items.test.ts states it directly: `normalizeTurnInput` on this resolver's own output, with the
//   aggregate saturated, must return that output unchanged.
//
// Runs inside the turn's execution slot, never before admission (see the spec's "Admission and the
// queue"): everything here is async, and no admission decision may sit on the far side of that await.
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { assembleUserContent, type UserTurnInput } from "../session/turnInput.js";
import { pngDimensions, jpegDimensions, MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET } from "../tui/clipboardImage.js";
import { MAX_IMAGES_PER_PROMPT } from "../host/imageStaging.js";

/** Schema-level bound on the items array (Task 4's `turnStartParams` enforces it; published here so the
 *  wire's cap and the resolver's caps read from one file). A violation is a shape error → -32602, not a
 *  degrade: an array this long is a malformed request, not a request with a bad image in it. */
export const MAX_INPUT_ITEMS = 64;
/** Bound on ONE `image.url`, in characters — Task 4's schema rejects a longer one as a shape error, and
 *  `parseDataUrl` enforces it AGAIN on the payload it is about to decode, so the decode is bounded for
 *  every caller and not only for the ones that came in through the schema. THIS cap is the binding number:
 *  240,000 base64 characters decode to exactly 180,000 bytes. The app-server's 256 KiB inbound frame cap
 *  (`peer.ts` MAX_IN) is the REASON the cap sits where it does — one framed image plus its JSON envelope
 *  has to fit — not itself a measure of what an image may weigh.
 *  The honest v1 bound, published rather than discovered in production — a bigger image travels by
 *  `localImage` (shared filesystem), and a REMOTE client with one has no v1 path (named follow-up). */
export const MAX_DATA_URL_CHARS = 240_000;
/** Per-turn ceiling on the SUM of surviving images' decoded bytes. Deliberately the same value as
 *  `session/turnInput.ts`'s own MAX_AGGREGATE_BYTES, which is module-private there — the two must stay
 *  equal or the downstream seam would find something to degrade in place (see the header). */
const MAX_AGGREGATE_BYTES = 5 * 1024 * 1024;

/** The public wire's input item, mirroring Codex's `UserInput` list. `image` is a `data:` URL only —
 *  which is Codex parity, not a shortfall (its own app-server refuses remote image URLs) — and
 *  `localImage` is an ABSOLUTE path, because a relative one would resolve against THIS process's cwd, a
 *  third cwd that is neither the thread's nor the client's. Both rules are schema-enforced (Task 4). */
export type InputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

const noteFor = (reason: string) => `[Image could not be processed: ${reason}]`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Names the kind a refused non-regular file actually was — a client can act on "FIFO" where it cannot
 *  act on a bare "not a regular file". `fstat` follows nothing, so no symlink case appears. */
const kindOf = (st: Stats): string =>
  st.isDirectory() ? "directory"
  : st.isFIFO() ? "FIFO"
  : st.isSocket() ? "socket"
  : st.isCharacterDevice() ? "character device"
  : st.isBlockDevice() ? "block device"
  : "unknown kind";

type ByteVerdict = { ok: true; buf: Buffer } | { ok: false; reason: string };

/** STRICT base64, checked BEFORE `Buffer.from` — the whole point of the row. Node's decoder silently
 *  SKIPS characters outside the alphabet and tolerates a short final quantum, so a payload carrying an
 *  illegal byte or a truncated tail decodes to a perfectly valid PNG and every later check passes. Only
 *  a pre-decode check can tell "the client sent this image" from "the client sent something that happens
 *  to decode to this image". */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type DataUrlParse = { ok: true; payload: string; mimeType: string } | { ok: false; reason: string };

/** `data:<mediaType>;base64,<payload>` → the still-encoded payload and the DECLARED media type, validated
 *  but not decoded. Two callers with opposite needs for that media type, which is why the split exists:
 *
 *    THIS MODULE READS PAST IT (`decodeDataUrl` below). A declared type is a claim, and `admitBytes`
 *    derives the real one from the header bytes — a PNG labelled `application/pdf` would otherwise fail
 *    the WHOLE engine request against the SDK's media-type union.
 *
 *    M7's TOOL RESULTS KEEP IT (`dynamicTools.ts`'s `toCallResult`). An MCP image/audio block carries a
 *    `mimeType`, and audio has no sniffer here to derive one from — so the declaration is all there is,
 *    and the check that can still be made is the FAMILY (`image/*` vs `audio/*`), which lives there.
 *
 *  Everything else is shared and unchanged, including the payload bound below. */
export function parseDataUrl(url: string): DataUrlParse {
  const comma = url.indexOf(",");
  const header = comma < 0 ? "" : url.slice(0, comma);
  if (comma < 0 || !header.startsWith("data:") || !/;base64$/i.test(header)) return { ok: false, reason: "not a base64 data: URL" };
  const payload = url.slice(comma + 1);
  // CHECK BEFORE ALLOCATE, the ordering `session/turnInput.ts` documents as load-bearing: `Buffer.from`
  // allocates the DECODED size, so a cap measured on the decoded buffer fires only once the allocation it
  // exists to bound has already happened. A base64 string is never shorter than what it decodes to, so
  // bounding the payload's LENGTH costs nothing and bounds that allocation. Measured on the payload
  // rather than the whole URL — laxer than Task 4's schema bound on `image.url` by exactly the `data:`
  // header, so nothing the schema admits is refused here, and a caller reaching this module directly
  // still cannot hand it an unbounded string. (M7's result caps bind long before this one does: the
  // payload is charged to `MAX_RESULT_PAYLOAD_BYTES` verbatim, character for byte.)
  if (payload.length > MAX_DATA_URL_CHARS) return { ok: false, reason: `data: URL exceeds the ${MAX_DATA_URL_CHARS}-character limit` };
  if (payload.length % 4 !== 0 || !BASE64.test(payload)) return { ok: false, reason: "malformed base64 payload" };
  // `data:` … `;base64` — everything between is the declared type, parameters and all, verbatim.
  return { ok: true, payload, mimeType: header.slice("data:".length, header.length - ";base64".length) };
}

/** `data:<mediaType>;base64,<payload>` → bytes. */
function decodeDataUrl(url: string): ByteVerdict {
  const parsed = parseDataUrl(url);
  if (!parsed.ok) return parsed;
  return { ok: true, buf: Buffer.from(parsed.payload, "base64") };
}

/** The ONE-DESCRIPTOR bounded read (`appserver/workspace.ts`'s `fs/read` established it): open once,
 *  `fstat` THAT descriptor, guard on it, read from the fd. Never `stat`-then-`readFile` — the second
 *  path resolution reopens a possibly-different inode, so a file swapped for a FIFO or a device between
 *  the calls escapes both the kind guard and the cap, and the read then blocks forever or grows without
 *  end. `O_NONBLOCK` so opening a writer-less FIFO returns instead of blocking inside `open(2)` (the
 *  hang the kind guard exists to prevent); `?? 0` because Windows has neither the flag nor FIFOs.
 *
 *  The cap is the SMALLER of the per-image budget and what the turn's aggregate has left, so an
 *  over-budget file is refused rather than materialized — the read stops one byte past the cap, which is
 *  all it takes to prove the file is over it. The fstat size is a fast refusal only, never the boundary:
 *  a regular file can grow between the fstat and the read. */
async function readLocalImage(path: string, aggregateSoFar: number): Promise<ByteVerdict> {
  const cap = Math.min(POST_PROCESS_BYTE_BUDGET, MAX_AGGREGATE_BYTES - aggregateSoFar);
  // Attribution: a file over the per-image budget is over it whatever the aggregate says; anything else
  // that passed `cap` did so because the TURN has no room left, which is a different fact for a client.
  const overReason = (n: number) => n > POST_PROCESS_BYTE_BUDGET
    ? `image data exceeds the ${POST_PROCESS_BYTE_BUDGET}-byte limit`
    : `turn's total image size exceeds the ${MAX_AGGREGATE_BYTES}-byte limit`;
  let fh;
  // The fs message verbatim (`ENOENT: no such file...`): it names the errno and the client's OWN path,
  // the whole of what a client can act on. The path is client-owned information, so echoing it leaks
  // nothing of this server's.
  try { fh = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); }
  catch (e) { return { ok: false, reason: msg(e) }; }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { ok: false, reason: `not a regular file (${kindOf(st)})` };
    if (st.size > cap) return { ok: false, reason: overReason(st.size) };
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const want = Math.min(64 * 1024, cap + 1 - total);   // 64 KiB chunks: a tiny file costs one, the over-cap probe survives
      const chunk = Buffer.allocUnsafe(want);
      const { bytesRead } = await fh.read(chunk, 0, want, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > cap) return { ok: false, reason: overReason(total) };
      chunks.push(bytesRead === want ? chunk : chunk.subarray(0, bytesRead));
    }
    return { ok: true, buf: Buffer.concat(chunks, total) };
  } catch (e) {
    return { ok: false, reason: msg(e) };
  } finally {
    await fh.close().catch(() => {});                      // one descriptor, released on every path
  }
}

/** The shared suite both item kinds run, in `normalizeTurnInput`'s exact order and with its exact reason
 *  strings. `media_type` comes from WHICH sniffer matched, never from the declaration: a valid PNG
 *  labelled `application/pdf` would pass local validation and then fail the WHOLE engine request against
 *  the SDK's media-type union — one wrong label killing a turn that carried four good images, where a
 *  derived type degrades nothing at all. */
function admitBytes(buf: Buffer, aggregateSoFar: number): { ok: true; data: string; mediaType: string; bytes: number } | { ok: false; reason: string } {
  const png = pngDimensions(buf);
  const dims = png ?? jpegDimensions(buf);
  if (!dims) return { ok: false, reason: "unreadable image data" };
  // BOTH bounds, not only the upper one. A crafted header declaring width or height 0 sniffs perfectly
  // well and looks like an ordinary small image from here on — but on the fleet origin those same
  // dimensions ride the `stageImage` op, whose schema (host/ops.ts) requires a POSITIVE int for each, so
  // the op is refused as invalid payload and the WHOLE turn fails where ONE image should have degraded.
  // A dims-specific reason rather than the sniffer's "unreadable image data": these bytes DID parse, and
  // naming the offending numbers is what a client can act on — the same shape the over-limit reason has.
  if (dims.width < 1 || dims.height < 1) {
    return { ok: false, reason: `dimensions ${dims.width}x${dims.height} are below the 1x1px minimum` };
  }
  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    return { ok: false, reason: `dimensions ${dims.width}x${dims.height} exceed the ${MAX_DIMENSION}x${MAX_DIMENSION}px limit` };
  }
  if (buf.length > POST_PROCESS_BYTE_BUDGET) return { ok: false, reason: `image data exceeds the ${POST_PROCESS_BYTE_BUDGET}-byte limit` };
  if (aggregateSoFar + buf.length > MAX_AGGREGATE_BYTES) return { ok: false, reason: `turn's total image size exceeds the ${MAX_AGGREGATE_BYTES}-byte limit` };
  return { ok: true, data: buf.toString("base64"), mediaType: png ? "image/png" : "image/jpeg", bytes: buf.length };
}

/** Canonical contract (spec rev 3): ONE text block = fold + notes, then surviving images in order. */
export async function resolveInputItems(items: InputItem[]): Promise<UserTurnInput> {
  let fold = "";
  const notes: string[] = [];
  const images: { data: string; mediaType: string }[] = [];
  let aggregate = 0;
  let imageOrdinal = 0;
  for (const item of items) {
    if (item.type === "text") { fold += item.text; continue; }
    imageOrdinal++;
    // COUNT FIRST, before a single byte is read (the amplification guard): an over-limit declaration
    // must cost nothing to refuse, and reading twenty-one files to discover the twenty-first was always
    // going to be dropped is exactly the amplification. Same wording the staging client uses for the
    // same cap, so a fleet turn and an inProcess turn read identically.
    if (imageOrdinal > MAX_IMAGES_PER_PROMPT) { notes.push(noteFor(`too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})`)); continue; }
    const bytes = item.type === "image" ? decodeDataUrl(item.url) : await readLocalImage(item.path, aggregate);
    // A localImage failure names the client's own path — with several files in one turn, "not a regular
    // file (FIFO)" alone does not say WHICH. A data: URL has no such name to give. ONCE, though: an fs
    // errno message already ends in `open '<path>'`, so labelling THAT would print the path twice in one
    // note; the kind and cap reasons carry no path at all and need the label.
    const path = item.type === "localImage" ? item.path : "";
    const labelled = (reason: string) => (path && !reason.includes(path) ? `${path}: ${reason}` : reason);
    if (!bytes.ok) { notes.push(noteFor(labelled(bytes.reason))); continue; }
    const verdict = admitBytes(bytes.buf, aggregate);
    if (!verdict.ok) { notes.push(noteFor(labelled(verdict.reason))); continue; }
    // Only a block that cleared EVERY check is charged to the aggregate, so a later, smaller image that
    // still fits in what is left is given its chance rather than dropped behind a bigger one's failure.
    aggregate += verdict.bytes;
    images.push({ data: verdict.data, mediaType: verdict.mediaType });
  }
  // ONE shape, always — including "no image survived", where this is a single text block rather than a
  // bare string, so no caller (the queue's echo, `flattenForDisplay`, the engine submit) has to branch
  // on whether the turn happened to carry a good image.
  return assembleUserContent(fold + notes.join(""), images);
}
