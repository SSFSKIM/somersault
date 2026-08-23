// harness/src/media/imageCodec.ts — F10 T-IMGREACH Task 4 (I5a): the bounded PNG/BMP DECODER.
// A LEAF: `node:zlib` only. No `node:fs`, no `node:child_process`, no import from `src/tui/` —
// callers (Task 5's encoder, Task 6's clipboard wiring) depend on this file; it depends on nothing
// of theirs, which is what lets it be reviewed, tested, and reverted on its own (plan-review r2 F19).
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
import { inflateSync } from "node:zlib";

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
      //    decoder's — a decoder that took a budget parameter could not compile standalone.
      if (colourType === 3 || bitDepth === 16 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
        return { ok: true, value: { kind: "passthrough", width, height, data: buf, mediaType: "image/png" } };
      }
      header = { width, height, bitDepth, colourType, interlace };
      bytesPerPixel = colourType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idatParts.push(data);
    }
    off += 12 + len; // 4 len + 4 type + len data + 4 CRC
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
