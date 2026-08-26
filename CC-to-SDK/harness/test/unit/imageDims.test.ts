// test/unit/imageDims.test.ts — F10 T-MAINT item 3: the neutral media leaf that ends the
// `session/turnInput.ts` → `tui/clipboardImage.ts` inversion (F9 ledger Minor, r4 §3). The dimension
// readers' own behavioural coverage stays in `test/tui/clipboardImage.test.ts` where its PNG/JPEG
// fixtures live; what THIS file pins is the leaf's identity — the exact five exports T-IMGREACH's
// worktree imports by name, their values, and the layering guarantee that gives the module its reason
// to exist.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_DIMENSION, MAX_IMAGES_PER_PROMPT, POST_PROCESS_BYTE_BUDGET, gifDimensions, jpegDimensions,
  pngDimensions, sniffImageMediaType, webpDimensions,
} from "../../src/media/imageDims.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");

/** A 1x1-shaped PNG header: 8-byte signature, then a length+`IHDR` chunk whose width/height sit at
 *  bytes 16-24. `pngDimensions` never reads past byte 24, so nothing else has to be real. */
const pngHeader = (width: number, height: number): Buffer => {
  const buf = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

/** SOI, then a SOF0 segment: marker(2) + length(2) + precision(1) + height(2) + width(2). */
const jpegHeader = (width: number, height: number): Buffer => {
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(0xffd8, 0);
  buf.writeUInt16BE(0xffc0, 2);
  buf.writeUInt16BE(11, 4);
  buf.writeUInt8(8, 6);
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
};

/** GIF87a/GIF89a: 6-byte tag, then logical screen width/height as two LE uint16s at bytes 6-10. */
const gifHeader = (w: number, h: number, tag = "GIF89a") => {
  const b = Buffer.alloc(13); b.write(tag, 0, "ascii"); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
};
/** WebP lossy (VP8 ): RIFF/WEBP/"VP8 " chunk headers, then the 3-byte sync code 0x9d 0x01 0x2a at
 *  bytes 23-26, then width/height as 14-bit-packed LE uint16s at bytes 26-30. */
const webpVp8 = (w: number, h: number) => {
  const b = Buffer.alloc(30); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii"); b.writeUInt32LE(10, 16); b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w & 0x3fff, 26); b.writeUInt16LE(h & 0x3fff, 28); return b;
};
/** WebP lossless (VP8L): RIFF/WEBP/"VP8L" chunk headers, then the 0x2f signature byte, then width-1/
 *  height-1 packed as 14 bits each into a little-endian 28-bit field. */
const webpVp8l = (w: number, h: number) => {
  const b = Buffer.alloc(25); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(17, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii"); b.writeUInt32LE(5, 16); b[20] = 0x2f;
  b.writeUInt32LE((w - 1) & 0x3fff | (((h - 1) & 0x3fff) << 14), 21); return b;
};
/** WebP extended (VP8X): RIFF/WEBP/"VP8X" chunk headers, then width-1/height-1 as two 24-bit LE
 *  little-endian integers at bytes 24-30. */
const webpVp8x = (w: number, h: number) => {
  const b = Buffer.alloc(30); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii"); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
};

describe("src/media/imageDims.ts — the neutral leaf", () => {
  it("reads PNG IHDR dimensions and rejects a non-PNG", () => {
    expect(pngDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(pngDimensions(Buffer.from([137, 80, 78, 71]))).toBeNull();
  });

  it("reads JPEG SOF dimensions and rejects a non-JPEG", () => {
    expect(jpegDimensions(jpegHeader(320, 240))).toEqual({ width: 320, height: 240 });
    expect(jpegDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("reads GIF87a and GIF89a dimensions and rejects a bad tag", () => {
    expect(gifDimensions(gifHeader(800, 600, "GIF87a"))).toEqual({ width: 800, height: 600 });
    expect(gifDimensions(gifHeader(800, 600, "GIF89a"))).toEqual({ width: 800, height: 600 });
    expect(gifDimensions(gifHeader(33, 47, "GIF89a"))).toEqual({ width: 33, height: 47 });
    expect(gifDimensions(Buffer.from("GIF9garbage", "ascii"))).toBeNull();
    // Truncated below the 10-byte descriptor `gifDimensions` needs (bytes 6-10 hold height) — a
    // shorter cut than "builder length minus one" would still carry a complete descriptor here,
    // since `gifHeader`'s 13-byte alloc has 3 trailing bytes the reader never touches.
    expect(gifDimensions(gifHeader(800, 600).subarray(0, 9))).toBeNull();
  });

  it("reads WebP VP8/VP8L/VP8X dimensions and rejects malformed chunks", () => {
    expect(webpDimensions(webpVp8(800, 600))).toEqual({ width: 800, height: 600 });
    expect(webpDimensions(webpVp8(33, 47))).toEqual({ width: 33, height: 47 });
    expect(webpDimensions(webpVp8l(800, 600))).toEqual({ width: 800, height: 600 });
    expect(webpDimensions(webpVp8l(33, 47))).toEqual({ width: 33, height: 47 });
    expect(webpDimensions(webpVp8x(800, 600))).toEqual({ width: 800, height: 600 });
    expect(webpDimensions(webpVp8x(33, 47))).toEqual({ width: 33, height: 47 });

    const noWebp = Buffer.alloc(16); noWebp.write("RIFF", 0, "ascii"); noWebp.write("AVI ", 8, "ascii");
    expect(webpDimensions(noWebp)).toBeNull();

    const badSync = webpVp8(800, 600); badSync[23] = 0x00;
    expect(webpDimensions(badSync)).toBeNull();

    const badSig = webpVp8l(800, 600); badSig[20] = 0x00;
    expect(webpDimensions(badSig)).toBeNull();

    const unknownFourcc = Buffer.alloc(16); unknownFourcc.write("RIFF", 0, "ascii");
    unknownFourcc.write("WEBP", 8, "ascii"); unknownFourcc.write("ICCP", 12, "ascii");
    expect(webpDimensions(unknownFourcc)).toBeNull();

    expect(webpDimensions(webpVp8(800, 600).subarray(0, 29))).toBeNull();
    expect(webpDimensions(webpVp8l(800, 600).subarray(0, 24))).toBeNull();
    expect(webpDimensions(webpVp8x(800, 600).subarray(0, 29))).toBeNull();
  });

  it("carries the three shared budgets at their canon values", () => {
    expect(MAX_DIMENSION).toBe(2000);                    // canon L8503, per-model image_limits
    expect(POST_PROCESS_BYTE_BUDGET).toBe(512_000);      // canon `v$r`, L174695
    expect(MAX_IMAGES_PER_PROMPT).toBe(20);              // ccx's own per-turn count guard, re-homed here
  });

  // T-SNIFF task 1: `sniffImageMediaType` — a VERBATIM transcription of canon's `b()`
  // (research-sniff.md offset 184,082,132). Prefix-only: it must sniff off the same few leading bytes
  // the dimension readers above need a full, well-formed header for, and it must NOT delegate to them
  // — a truncated-but-recognizable header sniffs correctly even when its dims are unreadable.
  describe("sniffImageMediaType — canon b() verbatim", () => {
    it("sniffs each real fixture to its true type", () => {
      const png = readFileSync(join(FIXTURES, "rgb8-64x48.png"));
      const jpeg = readFileSync(join(FIXTURES, "tiny.jpg"));
      const gif = readFileSync(join(FIXTURES, "live-purple-64x64.gif"));
      const webp = readFileSync(join(FIXTURES, "live-orange-64x64-lossy.webp"));
      expect(sniffImageMediaType(png)).toBe("image/png");
      expect(sniffImageMediaType(jpeg)).toBe("image/jpeg");
      expect(sniffImageMediaType(gif)).toBe("image/gif");
      expect(sniffImageMediaType(webp)).toBe("image/webp");
    });

    it("sniffs minimal canonical prefixes, including a header too short to read dims", () => {
      // 4-byte PNG signature only — no IHDR, so `pngDimensions` would reject this outright.
      expect(sniffImageMediaType(Buffer.from([137, 80, 78, 71]))).toBe("image/png");
      // A 4-byte JPEG SOI+marker prefix — one byte past the 3 the SOI+marker signature itself needs,
      // because canon's `e.length<4` floor at the top of `b()` is UNCONDITIONAL: it gates every
      // branch, JPEG included, not just PNG's own 4-byte signature. See the misses test below for the
      // 3-byte case this floor actually rejects.
      expect(sniffImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
      // A 9-byte GIF89a prefix: the sniff's own length floor (>=6) is satisfied, but this is well
      // short of the 10 bytes `gifDimensions` needs to read the Logical Screen Descriptor — proving
      // the sniff does NOT delegate to the dims reader as a discriminator.
      const gifPrefix = Buffer.from("GIF89aXXX", "ascii");
      expect(gifPrefix.length).toBe(9);
      expect(gifDimensions(gifPrefix)).toBeNull();
      expect(sniffImageMediaType(gifPrefix)).toBe("image/gif");
      // 12-byte RIFF/WEBP container header only — no VP8/VP8L/VP8X payload, so `webpDimensions`
      // (which needs >=16 bytes) would reject this outright.
      const webpPrefix = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);
      expect(webpPrefix.length).toBe(12);
      expect(webpDimensions(webpPrefix)).toBeNull();
      expect(sniffImageMediaType(webpPrefix)).toBe("image/webp");
    });

    it("misses to null rather than throwing", () => {
      expect(sniffImageMediaType(Buffer.alloc(0))).toBeNull();
      // Below the sniff's own 4-byte floor — one byte short of the PNG signature it would otherwise match.
      expect(sniffImageMediaType(Buffer.from([137, 80, 78]))).toBeNull();
      // The FULL 3-byte JPEG SOI+marker signature — but canon's `e.length<4` floor is UNCONDITIONAL,
      // checked before any branch runs, so even a byte-perfect JPEG signature misses below 4 bytes.
      expect(sniffImageMediaType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
      // reviewer mutation gap: FF D8 followed by a non-FF third byte must NOT sniff as JPEG — this is
      // the only cell that dies if the signature check is widened to a bare FF D8.
      expect(sniffImageMediaType(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
      // `GIF87x`: satisfies `GIF8` and the length floor, but byte 5 is neither `7` nor `9`.
      expect(sniffImageMediaType(Buffer.from("GIF87x", "ascii"))).toBeNull();
      // RIFF container present, but the fourcc at bytes 8-11 is WAVE, not WEBP.
      const riffWave = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE", "ascii")]);
      expect(sniffImageMediaType(riffWave)).toBeNull();
      expect(sniffImageMediaType(Buffer.from("plain text, not an image at all", "ascii"))).toBeNull();
    });
  });

  // THE LAYERING GUARANTEE ITSELF, and the only assertion here that could not be written against the
  // old home. A leaf both `session/` and `tui/` import must depend on neither of them — and on nothing
  // at all, as it happens. A future edit that reaches back into `../tui/` re-creates the exact inversion
  // this task removed, and a typecheck would be perfectly happy with it.
  it("imports nothing — not `tui/`, not React, not Ink", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/media/imageDims.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toContain("../tui/");
  });
});
