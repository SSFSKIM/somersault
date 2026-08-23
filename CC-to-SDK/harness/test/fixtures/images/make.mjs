// harness/test/fixtures/images/make.mjs — F10 T-IMGREACH Task 4 (I5a): the committed, deterministic
// generator for every synthetic image fixture `imageCodec.ts` is tested against. No `Date.now`, no
// `Math.random` — every byte here is a pure function of the constants below, so `node
// test/fixtures/images/make.mjs` regenerates byte-identical output and a diff against the committed
// fixtures is a real signal, not noise.
//
// Run with plain `node` (this repo's `"type": "module"`, Node >=24, imports `../../src/media/
// imageDims.ts` directly via Node's built-in TS type-stripping — no `tsx`/build step needed).
//
// `clipboard-v5.bmp` is the one fixture this script does NOT produce (a real BI_BITFIELDS/
// BITMAPV5HEADER clipboard capture can't be synthesized byte-for-byte): it was produced once on macOS
// (Darwin 25.5.0) on 2026-08-24 with
//   sips -s format bmp rgba8-64x48.png --out clipboard-v5.bmp
// run from this directory once `rgba8-64x48.png` existed, then committed alongside this generator's
// output. NOTE — verified live, not assumed: on this macOS/sips build, `sips -s format bmp` only
// emits the 124-byte BITMAPV5HEADER/32bpp BI_BITFIELDS shape when the SOURCE PNG carries an alpha
// channel; converting the plain `rgb8-64x48.png` (no alpha) instead silently downgrades to a 40-byte
// BITMAPINFOHEADER/24bpp BI_RGB file — exactly the drift this fixture's guard exists to catch. Using
// the alpha source is safe for the golden cross-check (`clipboard-v5.bmp`'s R/G/B vs `rgb8-64x48.png`'s
// R/G/B): `pixelAt`'s r/g/b formula is identical for both fixtures, only the alpha channel differs.
// `test/unit/imageCodec-decode.test.ts`'s golden BMP cell guards the shape (124-byte header,
// BI_BITFIELDS, negative height) so a re-capture that silently produced a plain BI_RGB bottom-up BMP
// fails loudly instead of quietly weakening the suite.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jpegDimensions } from "../../../src/media/imageDims.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(HERE, name);

// ---------------------------------------------------------------------------------------------
// Shared pixel formula — the SAME table both this generator and the test file read pixels from
// (`import { pixelAt } from "./make.mjs"`), so "expectedTopLeftRgba"/"expectedBottomRightRgba" in the
// test are never a second, independently-typed copy of this gradient that could silently drift.
export const FIXTURE_WIDTH = 64;
export const FIXTURE_HEIGHT = 48;

/** Deterministic RGB(A) gradient: r ramps left→right, g ramps top→bottom, b and the alpha ramp both
 *  ramp along the diagonal — chosen so the corners land on clean values (0,0,0 at top-left;
 *  255,255,255 at bottom-right) with no rounding ambiguity to reason about in the test. */
export function pixelAt(x, y, width = FIXTURE_WIDTH, height = FIXTURE_HEIGHT) {
  const r = Math.round((x * 255) / (width - 1));
  const g = Math.round((y * 255) / (height - 1));
  const diag = Math.round(((x + y) * 255) / (width - 1 + height - 1));
  return { r, g, b: diag, a: diag };
}

// ---------------------------------------------------------------------------------------------
// PNG chunk primitives — exported so both this generator and the test file's own hostile-fixture
// builders (`ihdrOnlyPng`, `pngWithTrailingChunk`) share one CRC/chunk implementation.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}
export function ihdrData({ width, height, bitDepth = 8, colorType = 2, interlace = 0 }) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = bitDepth;
  d[9] = colorType;
  d[10] = 0; // compression method (deflate, always 0)
  d[11] = 0; // filter method (adaptive, always 0)
  d[12] = interlace;
  return d;
}
/** A tiny (2x2 RGB) always-valid PNG, for tests that need a real decodable prefix around a
 *  hand-built hostile tail rather than a whole fixture file. */
export function buildMinimalValidPng() {
  return buildPng({ width: 2, height: 2, colorType: 2, filterMode: 0 });
}

// ---------------------------------------------------------------------------------------------
// PNG scanline filters (forward, for the generator) — the five standard PNG predictors.
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function filterByte(type, x, cur, prev, bpp) {
  const raw = cur[x];
  const a = x >= bpp ? cur[x - bpp] : 0;
  const b = prev ? prev[x] : 0;
  const c = x >= bpp && prev ? prev[x - bpp] : 0;
  switch (type) {
    case 0: return raw;
    case 1: return (raw - a) & 0xff;
    case 2: return (raw - b) & 0xff;
    case 3: return (raw - ((a + b) >> 1)) & 0xff;
    case 4: return (raw - paethPredictor(a, b, c)) & 0xff;
    default: throw new Error(`bad PNG filter type ${type}`);
  }
}
function costOf(row) {
  let sum = 0;
  for (const b of row) sum += b < 128 ? b : 256 - b;
  return sum;
}
/** `mode`: 0-4 forces that filter on every scanline; "adaptive" picks, per row, the filter with the
 *  smallest sum-of-signed-magnitude (the standard libpng heuristic) — used for the two "realistic"
 *  fixtures so the decoder is exercised against a mixed-filter image, not just a single-filter one. */
function filterImage(raw, width, height, bpp, mode) {
  const rowBytes = width * bpp;
  const out = Buffer.alloc((1 + rowBytes) * height);
  let prev = null;
  for (let y = 0; y < height; y++) {
    const cur = raw.subarray(y * rowBytes, (y + 1) * rowBytes);
    let chosenType = mode;
    let filtered;
    if (mode === "adaptive") {
      let bestCost = Infinity;
      filtered = null;
      for (let t = 0; t <= 4; t++) {
        const f = Buffer.alloc(rowBytes);
        for (let x = 0; x < rowBytes; x++) f[x] = filterByte(t, x, cur, prev, bpp);
        const cost = costOf(f);
        if (cost < bestCost) { bestCost = cost; filtered = f; chosenType = t; }
      }
    } else {
      filtered = Buffer.alloc(rowBytes);
      for (let x = 0; x < rowBytes; x++) filtered[x] = filterByte(mode, x, cur, prev, bpp);
    }
    const o = y * (1 + rowBytes);
    out[o] = chosenType;
    filtered.copy(out, o + 1);
    prev = cur;
  }
  return out;
}
function buildRaw(width, height, bpp, withAlpha) {
  const rowBytes = width * bpp;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = pixelAt(x, y, width, height);
      const o = y * rowBytes + x * bpp;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
      if (bpp === 4) raw[o + 3] = withAlpha ? a : 255;
    }
  }
  return raw;
}
function buildPng({ width, height, colorType, bitDepth = 8, interlace = 0, filterMode = "adaptive", withAlpha = false, deflateLevel }) {
  const bpp = colorType === 6 ? 4 : 3;
  const raw = buildRaw(width, height, bpp, withAlpha);
  const filtered = filterImage(raw, width, height, bpp, filterMode);
  const idat = deflateSync(filtered, deflateLevel != null ? { level: deflateLevel } : undefined);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData({ width, height, bitDepth, colorType, interlace })),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Adam7 interlacing (forward, real pass geometry — filter type 0 on every pass scanline; the pixel
// content is never actually decoded by Task 4, since interlace!=0 always takes the passthrough arm,
// but a fixture that CLAIMS to be interlaced should really be one).
const ADAM7 = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
];
function buildInterlacedPng(width, height) {
  const bpp = 3;
  const parts = [];
  for (const { x0, y0, dx, dy } of ADAM7) {
    const passWidth = Math.max(0, Math.ceil((width - x0) / dx));
    const passHeight = Math.max(0, Math.ceil((height - y0) / dy));
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = passWidth * bpp;
    for (let j = 0; j < passHeight; j++) {
      const filtered = Buffer.alloc(1 + rowBytes); // filter type 0 (None)
      for (let i = 0; i < passWidth; i++) {
        const { r, g, b } = pixelAt(x0 + i * dx, y0 + j * dy, width, height);
        const o = 1 + i * bpp;
        filtered[o] = r; filtered[o + 1] = g; filtered[o + 2] = b;
      }
      parts.push(filtered);
    }
  }
  const idat = deflateSync(Buffer.concat(parts));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData({ width, height, colorType: 2, interlace: 1 })),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildPalettePng(width, height) {
  const PALETTE_SIZE = 8;
  const palette = Buffer.alloc(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    palette[i * 3] = Math.round((i * 255) / (PALETTE_SIZE - 1));
    palette[i * 3 + 1] = 255 - palette[i * 3];
    palette[i * 3 + 2] = 128;
  }
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * width + x] = (x + y) % PALETTE_SIZE;
  const filtered = filterImage(raw, width, height, 1, 0);
  const idat = deflateSync(filtered);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData({ width, height, colorType: 3, interlace: 0 })),
    pngChunk("PLTE", palette),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildBombPng(width, height) {
  const bpp = 3;
  const expected = (1 + width * bpp) * height;
  const garbage = Buffer.alloc(expected + 1, 0x42); // one byte past the exact scanline total
  const idat = deflateSync(garbage);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData({ width, height, colorType: 2 })),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildTruncatedIdatPng(width, height) {
  const bpp = 3;
  const raw = buildRaw(width, height, bpp, false);
  const filtered = filterImage(raw, width, height, bpp, "adaptive");
  const fullIdat = deflateSync(filtered);
  const half = fullIdat.subarray(0, Math.floor(fullIdat.length / 2)); // the chunk's declared length
  return Buffer.concat([                                             // matches this SHORTER buffer
    PNG_SIGNATURE,                                                   // exactly — the deflate STREAM
    pngChunk("IHDR", ihdrData({ width, height, colorType: 2 })),      // itself is what's incomplete.
    pngChunk("IDAT", half),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function buildOverlongChunkPng(width, height) {
  const ihdr = pngChunk("IHDR", ihdrData({ width, height, colorType: 2 }));
  const badHeader = Buffer.alloc(8);
  badHeader.writeUInt32BE(5_000_000, 0); // under MAX_SOURCE_BYTES, but nothing this big follows
  badHeader.write("bAD1", 4, "ascii");
  return Buffer.concat([PNG_SIGNATURE, ihdr, badHeader]); // buffer ends right here — no data, no CRC
}

function buildHugeHeaderPng() {
  const ihdr = pngChunk("IHDR", ihdrData({ width: 25_000_001, height: 1, colorType: 2 }));
  return Buffer.concat([PNG_SIGNATURE, ihdr]); // nothing after IHDR — the budget gate must fire first
}

function buildOversizedPng(width, height) {
  return buildPng({ width, height, colorType: 2, filterMode: "adaptive" });
}

function buildExactly512000Png() {
  const TARGET = 512_000;
  const width = 64, height = 48, bpp = 3;
  const raw = buildRaw(width, height, bpp, false);
  const filtered = filterImage(raw, width, height, bpp, "adaptive");
  // level 0 (stored blocks): the compressed size is a deterministic function of the raw length alone,
  // independent of zlib version/build — the property this exact-byte-count fixture depends on.
  const idat = deflateSync(filtered, { level: 0 });
  const withoutPad = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdrData({ width, height, colorType: 2 })),
    pngChunk("IDAT", idat),
  ]);
  const iend = pngChunk("IEND", Buffer.alloc(0));
  // Pad to the exact target with one private ancillary chunk (lowercase first letter: a conforming
  // reader must skip what it doesn't recognize). The pad size is computed from ACTUAL buffer lengths,
  // never a hand-derived formula, so this stays correct regardless of zlib's exact stored-block framing.
  const padDataLen = TARGET - withoutPad.length - 12 - iend.length;
  if (padDataLen < 0) throw new Error(`exactly-512000 fixture: base image already exceeds ${TARGET} bytes`);
  const full = Buffer.concat([withoutPad, pngChunk("spVD", Buffer.alloc(padDataLen)), iend]);
  if (full.length !== TARGET) throw new Error(`exactly-512000 fixture: got ${full.length}, wanted ${TARGET}`);
  return { buf: full, width, height };
}

// ---------------------------------------------------------------------------------------------
// BMP builders — only the two hostile (never-decoded-to-pixels) fixtures; the one real, pixel-
// correct BMP (`clipboard-v5.bmp`) is a genuine macOS capture, not synthesized.
function buildForgedOffsetBmp() {
  const dibHeaderSize = 124;
  const buf = Buffer.alloc(14 + dibHeaderSize); // header only — no pixel data exists at all
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(999_999, 10); // dataOffset forged past EOF
  buf.writeUInt32LE(dibHeaderSize, 14);
  buf.writeInt32LE(64, 18);
  buf.writeInt32LE(-48, 22); // top-down
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(32, 28);
  buf.writeUInt32LE(3, 30); // BI_BITFIELDS
  buf.writeUInt32LE(0x00ff0000, 54);
  buf.writeUInt32LE(0x0000ff00, 58);
  buf.writeUInt32LE(0x000000ff, 62);
  buf.writeUInt32LE(0xff000000, 66);
  return buf;
}
function buildForgedStrideBmp() {
  const dibHeaderSize = 124;
  const dataOffset = 14 + dibHeaderSize; // valid offset...
  const buf = Buffer.alloc(dataOffset + 16); // ...but only 16 bytes of pixel data exist
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(dataOffset, 10);
  buf.writeUInt32LE(dibHeaderSize, 14);
  buf.writeInt32LE(100_000, 18); // ...and a stride*height this width implies runs far past EOF
  buf.writeInt32LE(-48, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(32, 28);
  buf.writeUInt32LE(3, 30);
  buf.writeUInt32LE(0x00ff0000, 54);
  buf.writeUInt32LE(0x0000ff00, 58);
  buf.writeUInt32LE(0x000000ff, 62);
  buf.writeUInt32LE(0xff000000, 66);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// tiny.jpg — the same hand-rolled baseline-JPEG shape as `fakeJpeg` in `test/tui/clipboardImage.
// test.ts:68-84` (SOI + one SOF0 carrying width/height + EOI). Second media type for Task 10's
// ordering cell; JPEG not GIF because `validateImageBlock` only reads PNG/JPEG headers (re-review r3).
function buildTinyJpeg(width, height) {
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1 + 3);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(11, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 1;
  sof[10] = 1; sof[11] = 0x11; sof[12] = 0;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const w = FIXTURE_WIDTH, h = FIXTURE_HEIGHT;

  writeFileSync(out("rgb8-64x48.png"), buildPng({ width: w, height: h, colorType: 2, filterMode: "adaptive" }));
  writeFileSync(out("rgba8-64x48.png"), buildPng({ width: w, height: h, colorType: 6, filterMode: "adaptive", withAlpha: true }));
  for (let t = 0; t <= 4; t++) {
    writeFileSync(out(`filters-${t}.png`), buildPng({ width: w, height: h, colorType: 2, filterMode: t }));
  }
  writeFileSync(out("palette-64x48.png"), buildPalettePng(w, h));
  writeFileSync(out("interlaced-64x48.png"), buildInterlacedPng(w, h));
  writeFileSync(out("bomb.png"), buildBombPng(w, h));
  writeFileSync(out("truncated-idat.png"), buildTruncatedIdatPng(w, h));
  writeFileSync(out("overlong-chunk.png"), buildOverlongChunkPng(w, h));
  writeFileSync(out("huge-header.png"), buildHugeHeaderPng());
  writeFileSync(out("forged-bmp-offset.bmp"), buildForgedOffsetBmp());
  writeFileSync(out("forged-bmp-stride.bmp"), buildForgedStrideBmp());
  writeFileSync(out("oversized-3200x1800.png"), buildOversizedPng(3200, 1800));
  writeFileSync(out("tiny.jpg"), buildTinyJpeg(8, 8));

  const exact = buildExactly512000Png();
  writeFileSync(out("exactly-512000.png"), exact.buf);
  await writeFile(
    out("sizes.json"),
    JSON.stringify({ EXACT_ENCODE_BYTES: exact.buf.length, EXACT_ENCODE_WIDTH: exact.width, EXACT_ENCODE_HEIGHT: exact.height }, null, 2) + "\n",
  );

  // Generation-time self-checks: a malformed fixture must fail HERE, not inside a later task's suite.
  if (jpegDimensions(buildTinyJpeg(8, 8)) === null) throw new Error("tiny.jpg: jpegDimensions could not resolve its own generated fixture");
  if (exact.buf.length !== 512_000) throw new Error("exactly-512000.png: size assertion failed");

  console.log("wrote all synthetic fixtures to", HERE);
  console.log("NOTE: clipboard-v5.bmp is not written by this script — see the header comment.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
