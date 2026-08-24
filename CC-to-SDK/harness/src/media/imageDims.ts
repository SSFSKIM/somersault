// harness/src/media/imageDims.ts — F10 T-MAINT item 3: the pure image facts BOTH sides of the
// session/tui boundary need. Extracted from `tui/clipboardImage.ts`, where they were the whole of
// `session/turnInput.ts:21`'s reason to import a UI module (F9 ledger Minor, r4 §3): two Buffer-in/
// dims-out header readers and three shared budgets, none of which has ever had a UI dependency.
//
// THIS MODULE IMPORTS NOTHING, deliberately — not even a Node builtin. That is what makes it safely
// importable from `session/` (the authoritative turn normalizer), `host/`, `client/` and `tui/` alike,
// and `test/unit/imageDims.test.ts` asserts it rather than trusting the convention to hold.
//
// The three precedent inversions r4 found alongside this one (`sessions/rows.ts:8`,
// `appserver/workspace.ts:30-32`) are deliberately NOT touched: the spec scopes this cut to the site
// the ledger actually flagged.

/** PNG: 8-byte signature, then the IHDR chunk — length(4) + "IHDR"(4) + width(4 BE) + height(4 BE) at
 *  bytes 16-24. IHDR is always the first chunk in a well-formed PNG, so no chunk walk is needed. */
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** JPEG: walk markers from the SOI until a Start-Of-Frame segment (0xC0-0xCF, excluding the
 *  non-frame DHT/JPG/DAC markers 0xC4/0xC8/0xCC), whose payload is precision(1) + height(2) + width(2).
 *  Standalone markers (RST0-7, SOI/EOI, TEM) carry no length field and are skipped as bare 2 bytes;
 *  every other marker's segment is skipped by its own declared length. */
export function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; } // resync on stray fill bytes
    const marker = buf[offset + 1];
    if (marker === 0xff) { offset++; continue; } // padding fill byte before the real marker
    const isStandalone = marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);
    if (isStandalone) { offset += 2; continue; }
    if (offset + 3 >= buf.length) return null;
    const length = buf.readUInt16BE(offset + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (offset + 9 >= buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/** canon `v$r`, L174695: the byte ceiling every resized image block must fit under. */
export const POST_PROCESS_BYTE_BUDGET = 512_000;
/** canon's per-model `image_limits` (L8503), universal across the current model catalog. */
export const MAX_DIMENSION = 2000;
/** ccx's own defensive ceiling on how many images ONE prompt may stage — a DoS guard, no canon twin
 *  (canon has no transport step to guard against). Comfortably above any real paste: the per-turn
 *  aggregate byte budget (`session/turnInput.ts`'s MAX_AGGREGATE_BYTES) already makes more than a
 *  handful impractical before this cap would ever bind. Re-homed from `host/imageStaging.ts` at F10
 *  T-MAINT (spec I2): the normalizer enforces it for EVERY surface now, not only host staging, so it
 *  cannot live in the host's staging module.  */
export const MAX_IMAGES_PER_PROMPT = 20;
