// harness/src/media/imageCodec.ts — F10 T-IMGREACH Task 4 (I5a): the bounded PNG/BMP DECODER.
// A LEAF: `node:zlib` plus its own sibling `imageDims.js` (shared budget constants), nothing else —
// no `node:fs`, no `node:child_process`, no import from `src/tui/` (the leaf-hygiene test below pins
// exactly those three exclusions) — callers (Task 5's encoder, Task 6's clipboard wiring) depend on
// this file; it depends on nothing of theirs, which is what lets it be reviewed, tested, and reverted
// on its own (plan-review r2 F19).
//
// THE PROCESSING-BOUND CONTRACT (spec v4.1 §I5, amended at plan review): the binding CPU/allocation
// bound is STRUCTURAL, not the clock. Every `inflateSync` call passes `maxOutputLength` set to the
// EXACT expected scanline total computed from a header already validated against the pixel budget —
// so a hostile stream's work and allocation are both capped by a number this module derived itself,
// and one byte over throws (the zip-bomb arm, `inflate-overrun`). `PROCESSING_BUDGET_MS` is a
// cooperative belt only: a synchronous `inflateSync`/defilter loop cannot be preempted by a clock, so
// this guard is checked between pipeline stages and every 64 scanlines to catch the OTHER shape of
// slowness — a legal, in-budget image on a pathologically slow host — never to interrupt work already
// in progress. Nothing here claims a hang is impossible; what's asserted (and true) is stronger: with
// the deadline stubbed to never expire, every hostile fixture still returns a coded failure, because
// the structural cap is what actually carries the guarantee.
import { inflateSync, deflateSync } from "node:zlib";
import { MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET } from "./imageDims.js";

/** Decode results are a UNION, never one shape with optional fields (plan-review r2 F-CODEC). The
 *  palette / 16-bit / interlaced arm CANNOT produce pixels, so a caller that forgets it must fail to
 *  compile rather than read `undefined` off a `pixels` field that a passthrough never had. */
export interface DecodedPixels { kind: "pixels"; width: number; height: number; pixels: Buffer }
export interface PassthroughImage { kind: "passthrough"; width: number; height: number; data: Buffer; mediaType: string }
export type DecodedImage = DecodedPixels | PassthroughImage;

/** Failures are CODED. Hostile-input cells assert the CODE, so rewording a reason string cannot
 *  quietly turn a boundary assertion into a tautology; `reason` stays for humans and for the
 *  clipboard's user-facing failure text. */
export type CodecFailureCode =
  | "source-too-large"      // refused on buffer length, before any parse
  | "pixel-budget"          // declared width*height over MAX_PIXELS, checked overflow-safe
  | "inflate-overrun"       // the STRUCTURAL bound fired: inflate produced more than the declared total
  | "malformed"             // truncated/overlong chunk, forged BMP offset or stride, bad signature
  | "unsupported-variant"   // Task 5's arm — a palette/16-bit/interlaced passthrough that does not FIT
                            // the caller's budget. Never produced here: fit is not a decode question.
  | "budget-exceeded"       // the cooperative wall belt tripped between stages
  | "encode-floor";         // Task 5's arm — declared here so the union is closed from the start
export type CodecResult<T> = { ok: true; value: T } | { ok: false; code: CodecFailureCode; reason: string };

/** NORMATIVE hostile-input bounds (spec I5). Each is a REFUSAL BEFORE ALLOCATION. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 25_000_000;
/** The COOPERATIVE belt (spec v4.1). Not an interrupt: a synchronous `inflateSync` cannot be
 *  preempted by a clock, and the bound that actually protects this module is `maxOutputLength` on
 *  every inflate. This guard catches the *other* shape of slowness — a legal, in-budget image on a
 *  pathologically slow host — at stage boundaries and every 64 scanlines. Documented here so no
 *  future reader mistakes it for anything stronger than a cooperative checkpoint. */
export const PROCESSING_BUDGET_MS = 2000;

export interface Deadline { expired(): boolean }
export function deadlineFrom(now: () => number = Date.now, budgetMs: number = PROCESSING_BUDGET_MS): Deadline {
  const start = now();
  return { expired: () => now() - start >= budgetMs };
}
/** For tests that must prove the STRUCTURAL bound alone carries a fixture: a belt that never trips. */
export const NEVER_EXPIRES: Deadline = { expired: () => false };

// ── declared-pixel refusal, OVERFLOW-SAFE. Two uint32s multiplied can exceed 2^53 and lose precision
//    as a JS number, so the comparison is done by DIVISION, never multiplication.
function pixelsWithinBudget(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  return width <= Math.floor(MAX_PIXELS / height);
}

/** The ONE inflate call site in this module (the sabotage-guard cell asserts every `inflateSync(`
 *  occurrence carries `maxOutputLength`, and greps the source rather than trusting a review). Exceeding
 *  the cap is distinguished from every other zlib failure by `err.code`: Node's `ERR_BUFFER_TOO_LARGE`
 *  is the structural bound firing (`inflate-overrun`, the zip-bomb arm); anything else — a truncated
 *  or corrupt deflate stream, `Z_BUF_ERROR`/`Z_DATA_ERROR` — is a malformed file, not an oversized one. */
function inflateCapped(data: Buffer, maxOutputLength: number): CodecResult<Buffer> {
  try {
    return { ok: true, value: inflateSync(data, { maxOutputLength }) };
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") {
      return { ok: false, code: "inflate-overrun", reason: "PNG image data expands past its declared size (rejected)" };
    }
    return { ok: false, code: "malformed", reason: "PNG image data stream is corrupt or truncated" };
  }
}

// ---------------------------------------------------------------------------------------------
// PNG unfilter (the inverse of the five standard scanline predictors) — operates on RECONSTRUCTED
// bytes (left/up/upper-left already unfiltered), which is what makes this the decode-side mirror of
// the generator's forward filter, not the same function run backwards.
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function unfilterRow(type: number, filtered: Buffer, prev: Buffer | null, bpp: number): CodecResult<Buffer> {
  const out = Buffer.alloc(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = i >= bpp && prev ? prev[i - bpp] : 0;
    let predictor: number;
    switch (type) {
      case 0: predictor = 0; break;
      case 1: predictor = a; break;
      case 2: predictor = b; break;
      case 3: predictor = (a + b) >> 1; break;
      case 4: predictor = paeth(a, b, c); break;
      default: return { ok: false, code: "malformed", reason: `unrecognized PNG filter type ${type}` };
    }
    out[i] = (filtered[i] + predictor) & 0xff;
  }
  return { ok: true, value: out };
}
function writeRgbaRow(pixels: Buffer, offset: number, row: Buffer, width: number, bpp: number): void {
  for (let x = 0; x < width; x++) {
    const so = x * bpp, po = offset + x * 4;
    pixels[po] = row[so]; pixels[po + 1] = row[so + 1]; pixels[po + 2] = row[so + 2];
    pixels[po + 3] = bpp === 4 ? row[so + 3] : 255;
  }
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

interface PngHeader { width: number; height: number; bitDepth: number; colourType: number; interlace: number }

export function decodePng(buf: Buffer, deadline: Deadline): CodecResult<DecodedImage> {
  // ── source-size refusal, before any parse
  if (buf.length > MAX_SOURCE_BYTES) {
    return { ok: false, code: "source-too-large", reason: `image source exceeds the ${MAX_SOURCE_BYTES}-byte limit` };
  }
  if (deadline.expired()) {
    return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
  }
  if (buf.length < 8 || !PNG_SIG.every((b, i) => buf[i] === b)) {
    return { ok: false, code: "malformed", reason: "not a PNG (bad signature)" };
  }

  let header: PngHeader | null = null;
  let bytesPerPixel = 0;
  const idatParts: Buffer[] = [];
  // F10 fix-wave review finding P2: the passthrough verdict (below) used to RETURN the instant IHDR
  // named a palette/16-bit/interlaced image — before the chunk walk had looked at anything past IHDR,
  // so a 33-byte IHDR-only file with no IDAT and no IEND passed as a valid image on colour type alone.
  // Recording the verdict here and deferring the return until AFTER the loop makes the passthrough arm
  // walk the SAME full structural chunk sequence (bounds-checked per chunk, exactly like the pixel
  // path) before it is trusted.
  let passthrough: { width: number; height: number } | null = null;

  // ── PNG chunk walk: every length is validated against the buffer BEFORE the slice it authorizes.
  //    This one loop finds IHDR, accumulates every IDAT, and ignores everything else (PLTE on a
  //    passthrough-bound file, ancillary chunks, ...) uniformly, without special-casing IEND as a
  //    terminator — a chunk after a logical IEND is still bounds-checked like any other.
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len > MAX_SOURCE_BYTES || off + 12 + len > buf.length) {
      return { ok: false, code: "malformed", reason: "truncated or malformed PNG chunk" };
    }
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      if (len !== 13) return { ok: false, code: "malformed", reason: "IHDR chunk has the wrong length" };
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colourType = data[9];
      const interlace = data[12];
      // ── declared-pixel refusal, checked immediately off the header, before any further chunk is read
      if (!pixelsWithinBudget(width, height)) {
        return { ok: false, code: "pixel-budget", reason: `declared ${width}x${height} exceeds the ${MAX_PIXELS}-pixel budget` };
      }
      // ── the PASSTHROUGH arm for what this decoder does NOT handle: palette (colour type 3), 16-bit
      //    depth, Adam7 interlace — required, not optional (r3) — plus, defensively, any colour type
      //    this module never implements pixel expansion for. NO BUDGET IS APPLIED HERE (re-review r3):
      //    whether a passthrough FITS a caller's budget is Task 5's `reencodeImage` question, not this
      //    decoder's — a decoder that took a budget parameter could not compile standalone. RECORDED,
      //    not returned (review finding P2) — the walk below still has to finish.
      if (colourType === 3 || bitDepth === 16 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
        passthrough = { width, height };
      } else {
        header = { width, height, bitDepth, colourType, interlace };
        bytesPerPixel = colourType === 6 ? 4 : 3;
      }
    } else if (type === "IDAT") {
      idatParts.push(data);
    }
    off += 12 + len; // 4 len + 4 type + len data + 4 CRC
  }

  if (passthrough) {
    // Same structural bar the pixel path clears below: a "PNG" with no IDAT at all never carried image
    // data regardless of colour type, so it is malformed, not a passthrough this caller can trust.
    if (idatParts.length === 0) return { ok: false, code: "malformed", reason: "no IDAT chunk found" };
    return { ok: true, value: { kind: "passthrough", width: passthrough.width, height: passthrough.height, data: buf, mediaType: "image/png" } };
  }
  if (!header) return { ok: false, code: "malformed", reason: "no IHDR chunk found" };
  if (idatParts.length === 0) return { ok: false, code: "malformed", reason: "no IDAT chunk found" };
  // ── the COOPERATIVE belt, checked between pipeline stages. NOT an interrupt — see the
  //    PROCESSING_BUDGET_MS doc comment above.
  if (deadline.expired()) {
    return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
  }

  const { width, height } = header;
  // ── THE STRUCTURAL BOUND. inflate capped at the EXACT expected scanline total: one byte over is a
  //    zip bomb, not a big image. `maxOutputLength` makes zlib itself stop there — the work and the
  //    allocation are both bounded by a number computed from the header already validated above.
  const expected = (1 + width * bytesPerPixel) * height;
  const inflated = inflateCapped(Buffer.concat(idatParts), expected);
  if (!inflated.ok) return inflated;
  const raw = inflated.value;
  if (raw.length !== expected) {
    return { ok: false, code: "malformed", reason: "PNG image data does not match its declared size" };
  }

  const rowBytes = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * 4);
  let prev: Buffer | null = null;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + rowBytes);
    const filterType = raw[rowStart];
    const filtered = raw.subarray(rowStart + 1, rowStart + 1 + rowBytes);
    const recon = unfilterRow(filterType, filtered, prev, bytesPerPixel);
    if (!recon.ok) return recon;
    writeRgbaRow(pixels, y * width * 4, recon.value, width, bytesPerPixel);
    prev = recon.value;
    // ── the COOPERATIVE belt, checked every 64 scanlines inside the defilter loop.
    if (y % 64 === 63 && deadline.expired()) {
      return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
    }
  }
  return { ok: true, value: { kind: "pixels", width, height, pixels } };
}

// ---------------------------------------------------------------------------------------------
// BMP: every offset/stride/mask range validated against the ACTUAL buffer length before any read.
// Real clipboard BMPs are 32bpp BI_BITFIELDS with a 124-byte BITMAPV5HEADER, channel masks at offsets
// 54/58/62/66, and a NEGATIVE height meaning top-down rows — a BI_RGB-only bottom-up decoder fails on
// exactly the BMPs this arm exists to rescue, so both compression modes and both orientations are
// handled generically via the header's own masks rather than hardcoding a byte order.
function maskShiftAndMax(mask: number): { shift: number; max: number } | null {
  if (mask === 0) return null;
  let shift = 0;
  let m = mask >>> 0;
  while ((m & 1) === 0) { m >>>= 1; shift++; }
  let width = 0;
  while (m) { width += m & 1; m >>>= 1; }
  return { shift, max: (1 << width) - 1 };
}
function extractChannel(pixelValue: number, mask: number): number {
  const info = maskShiftAndMax(mask);
  if (!info) return 255; // no mask for this channel (e.g. no alpha) — treat as fully opaque
  const raw = (pixelValue & mask) >>> info.shift;
  return info.max === 255 ? raw : Math.round((raw / info.max) * 255);
}

export function decodeBmp(buf: Buffer, deadline: Deadline): CodecResult<DecodedImage> {
  if (buf.length > MAX_SOURCE_BYTES) {
    return { ok: false, code: "source-too-large", reason: `image source exceeds the ${MAX_SOURCE_BYTES}-byte limit` };
  }
  if (deadline.expired()) {
    return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
  }
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
    return { ok: false, code: "malformed", reason: "not a BMP (bad signature)" };
  }

  const dibHeaderSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const absHeight = Math.abs(heightRaw);
  const topDown = heightRaw < 0;
  const bitsPerPixel = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);

  if (!pixelsWithinBudget(width, absHeight)) {
    return { ok: false, code: "pixel-budget", reason: `declared ${width}x${absHeight} exceeds the ${MAX_PIXELS}-pixel budget` };
  }

  const dataOffset = buf.readUInt32LE(10);
  const stride = ((width * bitsPerPixel + 31) >> 5) << 2; // rows are 4-byte aligned
  if (dataOffset >= buf.length || stride <= 0 || dataOffset + stride * absHeight > buf.length) {
    return { ok: false, code: "malformed", reason: "BMP pixel data runs past the end of the buffer" };
  }
  if (bitsPerPixel !== 32) {
    return { ok: false, code: "malformed", reason: `unsupported BMP bit depth ${bitsPerPixel}` };
  }
  if (compression !== 0 && compression !== 3) {
    return { ok: false, code: "malformed", reason: `unsupported BMP compression ${compression}` };
  }

  let maskR = 0x00ff0000, maskG = 0x0000ff00, maskB = 0x000000ff, maskA = 0xff000000;
  if (compression === 3 && dibHeaderSize >= 108) {
    // The masks live at offsets 54-70 (4 fields x 4 bytes) — a region the earlier `buf.length < 54`
    // signature check does NOT cover. Bound it against the ACTUAL buffer length before reading, same
    // as every other read in this function, rather than trusting `dibHeaderSize`'s own claim.
    if (buf.length < 70) {
      return { ok: false, code: "malformed", reason: "BMP declares a BITMAPV5HEADER but the buffer ends before its color masks" };
    }
    maskR = buf.readUInt32LE(54);
    maskG = buf.readUInt32LE(58);
    maskB = buf.readUInt32LE(62);
    maskA = buf.readUInt32LE(66);
  }

  const pixels = Buffer.alloc(width * absHeight * 4);
  for (let outY = 0; outY < absHeight; outY++) {
    const srcRow = topDown ? outY : absHeight - 1 - outY;
    const rowOffset = dataOffset + srcRow * stride;
    for (let x = 0; x < width; x++) {
      const pv = buf.readUInt32LE(rowOffset + x * 4);
      const po = (outY * width + x) * 4;
      pixels[po] = extractChannel(pv, maskR);
      pixels[po + 1] = extractChannel(pv, maskG);
      pixels[po + 2] = extractChannel(pv, maskB);
      pixels[po + 3] = extractChannel(pv, maskA);
    }
    // ── the COOPERATIVE belt, checked every 64 rows.
    if (outY % 64 === 63 && deadline.expired()) {
      return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
    }
  }
  return { ok: true, value: { kind: "pixels", width, height: absHeight, pixels } };
}

/** Sniffs PNG (`\x89PNG`) / BMP (`BM`) and routes; anything else fails `malformed`. Sniffing wins
 *  over the caller-supplied `mediaType` — a clipboard hint is metadata, not proof. */
export function decodeImage(buf: Buffer, mediaType: string, deadline: Deadline): CodecResult<DecodedImage> {
  void mediaType;
  if (buf.length >= 8 && PNG_SIG.every((b, i) => buf[i] === b)) return decodePng(buf, deadline);
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return decodeBmp(buf, deadline);
  return { ok: false, code: "malformed", reason: "unrecognized image signature (not PNG or BMP)" };
}

// ===============================================================================================
// ENCODE (F10 T-IMGREACH Task 5 / I5b) — box-average downscale, ADAPTIVE per-scanline PNG
// filtering, and the bounded downscale-and-retry ladder `reencodeImage` walks to fit a caller's
// byte budget. Always emits colourType 6 (RGBA)/bitDepth 8: `DecodedPixels.pixels` is ALWAYS RGBA
// regardless of source (the decoder's `writeRgbaRow` guarantees it), so round-tripping through this
// encoder can never lose or reinterpret a channel.

/** Integer BOX average down to `maxDimension` on the longer side; a no-op (same object, not a copy)
 *  when already within it. Each output pixel is the ROUNDED MEAN of an integer-bounded box of source
 *  pixels — box edges are computed by `floor(i * srcLen / dstLen)` per axis, the standard exact-
 *  coverage area-resize partition, which is what lets the long side land on `maxDimension` EXACTLY
 *  (a fixed NxN factor cannot: 2001px at maxDimension 2000 needs a box just over 1px wide). */
export function downscale(img: DecodedPixels, maxDimension: number): DecodedPixels {
  const { width, height, pixels } = img;
  if (Math.max(width, height) <= maxDimension) return img;
  const scale = maxDimension / Math.max(width, height);
  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(newWidth * newHeight * 4);
  for (let oy = 0; oy < newHeight; oy++) {
    const y0 = Math.floor((oy * height) / newHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / newHeight));
    for (let ox = 0; ox < newWidth; ox++) {
      const x0 = Math.floor((ox * width) / newWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / newWidth));
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const so = (sy * width + sx) * 4;
          r += pixels[so]; g += pixels[so + 1]; b += pixels[so + 2]; a += pixels[so + 3];
          count++;
        }
      }
      const po = (oy * newWidth + ox) * 4;
      out[po] = Math.round(r / count);
      out[po + 1] = Math.round(g / count);
      out[po + 2] = Math.round(b / count);
      out[po + 3] = Math.round(a / count);
    }
  }
  return { kind: "pixels", width: newWidth, height: newHeight, pixels: out };
}

// ── the CRC32 this module's own PNG chunk WRITER needs (decode never checks a CRC, but a real
//    consumer — the clipboard, a browser, `sips` — does; a self-authored PNG that only OUR decoder
//    can read back is not a PNG). Independent of `test/fixtures/images/make.mjs`'s copy — that file
//    builds hostile/golden fixtures for testing this module and must stay usable standalone even if
//    this module were reverted, so it is not imported here (leaf hygiene, plan-review r2 F19).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodedPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

/** The forward mirror of `unfilterRow`'s five predictors, operating on RAW (unfiltered) neighbour
 *  bytes — which is always what's available when filtering forward, unlike decode's cumulative
 *  reconstruction. Shares `paeth` with the decoder; the predictor itself is direction-agnostic. */
function filterByte(type: 0 | 1 | 2 | 3 | 4, cur: Buffer, prev: Buffer | null, x: number, bpp: number): number {
  const raw = cur[x];
  const a = x >= bpp ? cur[x - bpp] : 0;
  const b = prev ? prev[x] : 0;
  const c = x >= bpp && prev ? prev[x - bpp] : 0;
  switch (type) {
    case 0: return raw;
    case 1: return (raw - a) & 0xff;
    case 2: return (raw - b) & 0xff;
    case 3: return (raw - ((a + b) >> 1)) & 0xff;
    case 4: return (raw - paeth(a, b, c)) & 0xff;
  }
}
/** The ADAPTIVE selector's heuristic: sum of each filtered byte's magnitude treated as a signed
 *  residual mod 256 (the standard libpng "minimum sum of absolute differences" heuristic) — a cheap
 *  proxy for post-deflate size that does not require actually compressing all five candidates. */
function filterCost(row: Buffer): number {
  let sum = 0;
  for (const byte of row) sum += byte < 128 ? byte : 256 - byte;
  return sum;
}

/** The one encoder body behind both `encodePng` and the test-only `encodePngWithFixedFilter`:
 *  `fixedFilter === null` is the real ADAPTIVE path (try all five per scanline, keep the lowest
 *  `filterCost`); a non-null value pins every scanline to that filter, for the sabotage guard that
 *  proves adaptive selection is load-bearing (measured 193x smaller than filter-0, r3 §2). */
function encodeCore(img: DecodedPixels, deadline: Deadline, fixedFilter: 0 | 1 | 2 | 3 | 4 | null): CodecResult<Buffer> {
  if (deadline.expired()) {
    return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
  }
  const { width, height, pixels } = img;
  const bpp = 4;
  const rowBytes = width * bpp;
  const filtered = Buffer.alloc((1 + rowBytes) * height);
  let prev: Buffer | null = null;
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    let bestType: 0 | 1 | 2 | 3 | 4 = fixedFilter ?? 0;
    let bestRow: Buffer;
    if (fixedFilter !== null) {
      bestRow = Buffer.alloc(rowBytes);
      for (let x = 0; x < rowBytes; x++) bestRow[x] = filterByte(fixedFilter, cur, prev, x, bpp);
    } else {
      let bestCost = Infinity;
      bestRow = Buffer.alloc(rowBytes);
      for (let t = 0 as 0 | 1 | 2 | 3 | 4; t <= 4; t++) {
        const candidate = Buffer.alloc(rowBytes);
        for (let x = 0; x < rowBytes; x++) candidate[x] = filterByte(t, cur, prev, x, bpp);
        const cost = filterCost(candidate);
        if (cost < bestCost) { bestCost = cost; bestRow = candidate; bestType = t; }
      }
    }
    const o = y * (1 + rowBytes);
    filtered[o] = bestType;
    bestRow.copy(filtered, o + 1);
    prev = cur;
    // ── the COOPERATIVE belt, same shape and cadence as the decoder's (see PROCESSING_BUDGET_MS doc).
    if (y % 64 === 63 && deadline.expired()) {
      return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
    }
  }
  const idat = deflateSync(filtered);
  if (deadline.expired()) {
    return { ok: false, code: "budget-exceeded", reason: `image processing exceeded the ${PROCESSING_BUDGET_MS}ms budget` };
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: truecolour with alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression / filter method / interlace: always 0
  const png = Buffer.concat([
    Buffer.from(PNG_SIG),
    encodedPngChunk("IHDR", ihdr),
    encodedPngChunk("IDAT", idat),
    encodedPngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { ok: true, value: png };
}

/** PNG encode with ADAPTIVE per-scanline filtering (try all five, pick the lowest sum-of-absolute-
 *  differences). Not a refinement — measured 193x smaller than filter-0 on the same input (r3 §2),
 *  which is the whole reason the pure-JS floor is viable at all. */
export function encodePng(img: DecodedPixels, deadline: Deadline): CodecResult<Buffer> {
  return encodeCore(img, deadline, null);
}
/** TEST-ONLY seam for the sabotage guard: the same encoder with the adaptive selector pinned to
 *  filter 0. */
export function encodePngWithFixedFilter(img: DecodedPixels, filter: 0 | 1 | 2 | 3 | 4, deadline: Deadline): CodecResult<Buffer> {
  return encodeCore(img, deadline, filter);
}

/** The floor `reencodeImage`'s retry ladder halves down to before giving up. Below this, a resized
 *  image stops being a useful attachment regardless of whether it would fit the byte budget. */
export const RETRY_FLOOR_DIMENSION = 256;

/** The downscale-and-retry ladder: encode at the current size; if it still exceeds `byteBudget`,
 *  halve the CURRENT actual long side (not the caller's `maxDimension` — an image already smaller
 *  than `maxDimension`, or than `RETRY_FLOOR_DIMENSION`, still gets exactly this same one halving
 *  per failed attempt) and retry. `downscale` always resamples from the ORIGINAL decoded pixels, so
 *  quality never compounds across rungs. Termination: once a TRIED rung's long side is already at or
 *  below `RETRY_FLOOR_DIMENSION` and it still doesn't fit, there is nowhere further to go.
 *  `onRung` is a real, optional lifeline for a ladder whose rung count would otherwise be
 *  unobservable — see the byte-budget boundary cells. */
function encodeLadder(
  px: DecodedPixels,
  maxDimension: number,
  byteBudget: number,
  deadline: Deadline,
  onRung: ((width: number) => void) | undefined,
): CodecResult<{ data: Buffer; mediaType: "image/png"; dimensions: { width: number; height: number } }> {
  let current = downscale(px, maxDimension);
  let encoded = encodePng(current, deadline);
  if (!encoded.ok) return encoded;
  while (encoded.value.length > byteBudget) {
    const long = Math.max(current.width, current.height);
    const halved = Math.floor(long / 2);
    // Clamp the target UP to the floor ONLY when this halving step would otherwise CROSS it in one
    // jump — starting ABOVE the floor and landing strictly below it (review finding P2: 400 -> 200
    // skips 256 entirely, so the floor itself is never a tried rung). A rung that is already at or
    // below the floor before this halving keeps halving further exactly as it always did — that
    // regime is not the bug this closes, and the post-check below still terminates it correctly.
    const target = long > RETRY_FLOOR_DIMENSION && halved < RETRY_FLOOR_DIMENSION ? RETRY_FLOOR_DIMENSION : halved;
    current = downscale(px, target);
    onRung?.(current.width);
    encoded = encodePng(current, deadline);
    if (!encoded.ok) return encoded;
    if (encoded.value.length > byteBudget && Math.max(current.width, current.height) <= RETRY_FLOOR_DIMENSION) {
      return {
        ok: false, code: "encode-floor",
        reason: `image could not be reencoded under the ${byteBudget}-byte budget even at the ${RETRY_FLOOR_DIMENSION}px floor`,
      };
    }
  }
  return { ok: true, value: { data: encoded.value, mediaType: "image/png", dimensions: { width: current.width, height: current.height } } };
}

/** The ladder the clipboard path calls: decode → (downscale to `maxDimension` if needed) → encode
 *  PNG → if still over `byteBudget`, halve the long side and retry, down to `RETRY_FLOOR_DIMENSION`.
 *  Always PNG out. Consumes the decode union EXHAUSTIVELY (plan-review r2 F-CODEC: the fallback arm
 *  and the declared result type once contradicted each other — the fix is a `switch` the compiler
 *  can check, so a new `DecodedImage` member breaks the BUILD, not a runtime fallback). */
export function reencodeImage(
  input: { data: Buffer; mediaType: string },
  opts?: {
    maxDimension?: number; byteBudget?: number; now?: () => number; budgetMs?: number;
    onRung?: (width: number) => void;
  },
): CodecResult<{ data: Buffer; mediaType: "image/png"; dimensions: { width: number; height: number } }> {
  const maxDimension = opts?.maxDimension ?? MAX_DIMENSION;
  const byteBudget = opts?.byteBudget ?? POST_PROCESS_BYTE_BUDGET;
  const deadline = deadlineFrom(opts?.now ?? Date.now, opts?.budgetMs ?? PROCESSING_BUDGET_MS);
  const decoded = decodeImage(input.data, input.mediaType, deadline);
  if (!decoded.ok) return decoded; // codes propagate unchanged
  switch (decoded.value.kind) {
    case "passthrough": {
      // We never decoded these pixels, so we cannot resize them. Under budget, hand the ORIGINAL
      // bytes back untouched (r3: passing a palette PNG through is strictly better than refusing
      // it); over budget, fail with the variant code — there is no ladder rung available.
      const v = decoded.value;
      return v.data.length <= byteBudget && Math.max(v.width, v.height) <= maxDimension
        ? { ok: true, value: { data: v.data, mediaType: "image/png", dimensions: { width: v.width, height: v.height } } }
        : { ok: false, code: "unsupported-variant",
            reason: `image uses a PNG variant this build cannot resize (${v.width}x${v.height}, ${v.data.length} bytes)` };
    }
    case "pixels":
      return encodeLadder(decoded.value, maxDimension, byteBudget, deadline, opts?.onRung);
    default: {
      const _exhaustive: never = decoded.value; // a new union member must break the BUILD, not runtime
      return _exhaustive;
    }
  }
}
