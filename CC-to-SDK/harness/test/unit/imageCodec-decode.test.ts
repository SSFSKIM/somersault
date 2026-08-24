// harness/test/unit/imageCodec-decode.test.ts — F10 T-IMGREACH Task 4 (I5a): the bounded PNG/BMP
// decoder. Golden decodes first, then hostile fixtures asserting CODES with the cooperative belt
// stubbed to NEVER expire (only the structural bounds can be what fires), then the boundary matrix.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodePng, decodeBmp, decodeImage, NEVER_EXPIRES,
  MAX_SOURCE_BYTES, MAX_PIXELS,
  type DecodedImage, type DecodedPixels, type PassthroughImage, type CodecResult,
} from "../../src/media/imageCodec.js";
import { triple } from "./boundaryTriple.js";
import { PNG_SIGNATURE, pngChunk, ihdrData, buildMinimalValidPng } from "../fixtures/images/make.mjs";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "images");
function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}
function expectPixels(r: CodecResult<DecodedImage>): DecodedPixels {
  expect(r.ok).toBe(true);
  const v = (r as { ok: true; value: DecodedImage }).value;
  expect(v.kind).toBe("pixels");
  return v as DecodedPixels;
}

/** sig + IHDR only, nothing after — for the MAX_PIXELS boundary sweep (header-only, nothing allocated). */
function ihdrOnlyPng(width: number, height: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdrData({ width, height, colorType: 2 }))]);
}

/** A real, complete, decodable PNG followed by one synthetic chunk whose HEADER declares `declaredLen`
 *  bytes of data while only `tailBytes` bytes physically follow it. The declared-vs-physical gap is
 *  exactly what the chunk walk's `off + 12 + len > buf.length` bound must catch: `declaredLen >
 *  tailBytes` is malformed, `declaredLen <= tailBytes` lets the walk finish (it lands past EOF or
 *  exactly at it either way) and the already-fully-parsed valid image decodes successfully. */
function pngWithTrailingChunk(tailBytes: number, declaredLen: number): Buffer {
  const prefix = buildMinimalValidPng();
  const header = Buffer.alloc(8);
  header.writeUInt32BE(declaredLen, 0);
  header.write("tAIL", 4, "ascii");
  return Buffer.concat([prefix, header, Buffer.alloc(tailBytes + 4)]);
}

// ---------------------------------------------------------------------------------------------
describe("I5a leaf hygiene", () => {
  it("imports node:zlib only — no fs, no child_process, no tui", () => {
    const src = readFileSync(new URL("../../src/media/imageCodec.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "node:(fs|child_process)"/);
    expect(src).not.toMatch(/from "\.\.\/tui\//);
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5a golden decodes", () => {
  it("8-bit truecolour PNG decodes to exact RGBA pixels", () => {
    const r = decodePng(fixture("rgb8-64x48.png"), NEVER_EXPIRES);
    expect(r.ok).toBe(true);
    const v = (r as { ok: true; value: DecodedImage }).value;
    expect(v.kind).toBe("pixels");
    const px = v as DecodedPixels;
    expect(px.width).toBe(64);
    expect(px.height).toBe(48);
    expect(px.pixels).toHaveLength(64 * 48 * 4);
    expect([...px.pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255]); // top-left: pixelAt(0,0) is all-zero
    expect([...px.pixels.subarray(px.pixels.length - 4)]).toEqual([255, 255, 255, 255]); // bottom-right
  });

  it("8-bit RGBA PNG keeps its alpha ramp", () => {
    const px = expectPixels(decodePng(fixture("rgba8-64x48.png"), NEVER_EXPIRES));
    expect(px.pixels[3]).toBe(0);
    expect(px.pixels[px.pixels.length - 1]).toBe(255);
  });

  it("every one of the five PNG filter types round-trips to the same pixels", () => {
    const golden = expectPixels(decodePng(fixture("filters-0.png"), NEVER_EXPIRES)).pixels;
    for (const n of [1, 2, 3, 4]) {
      expect(expectPixels(decodePng(fixture(`filters-${n}.png`), NEVER_EXPIRES)).pixels).toEqual(golden);
    }
  });

  it("a real 32bpp BI_BITFIELDS / BITMAPV5HEADER / negative-height BMP decodes top-down and correct", () => {
    const bmp = fixture("clipboard-v5.bmp");
    expect(bmp.readInt32LE(22)).toBeLessThan(0); // guard: the fixture really is top-down
    const px = expectPixels(decodeBmp(bmp, NEVER_EXPIRES));
    const src = expectPixels(decodePng(fixture("rgb8-64x48.png"), NEVER_EXPIRES));
    expect(px.width).toBe(src.width);
    expect(px.height).toBe(src.height);
    expect([...px.pixels.subarray(0, 3)]).toEqual([...src.pixels.subarray(0, 3)]); // TOP-left, not bottom
  });

  it("palette and interlaced PNGs return the PASSTHROUGH arm, not pixels", () => {
    for (const f of ["palette-64x48.png", "interlaced-64x48.png"]) {
      const r = decodeImage(fixture(f), "image/png", NEVER_EXPIRES);
      expect(r.ok).toBe(true);
      const v = (r as { ok: true; value: DecodedImage }).value;
      expect(v.kind).toBe("passthrough");
      expect((v as PassthroughImage).data).toEqual(fixture(f));
    }
  });

  it("the DECODER takes no byte budget — whether a passthrough FITS is the caller's question", () => {
    expect(decodePng.length).toBe(2);
    expect(decodeBmp.length).toBe(2);
    expect(decodeImage.length).toBe(3);
  });

  it("decodeImage sniffs, and a non-image buffer fails `malformed`", () => {
    expect(decodeImage(fixture("clipboard-v5.bmp"), "image/png", NEVER_EXPIRES).ok).toBe(true);
    expect(decodeImage(Buffer.from("GIF89a not really"), "image/gif", NEVER_EXPIRES))
      .toMatchObject({ ok: false, code: "malformed" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5a hostile input — the deadline is stubbed to NEVER expire, so only the structural bounds can be what fires", () => {
  it("a zip-bomb IDAT (one byte past the exact scanline total) fails `inflate-overrun`", () => {
    expect(decodePng(fixture("bomb.png"), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "inflate-overrun" });
  });
  it("an IHDR declaring 25,000,001 pixels fails `pixel-budget` — overflow-safe, before allocation", () => {
    expect(decodePng(fixture("huge-header.png"), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "pixel-budget" });
  });
  it("a truncated IDAT fails `malformed`", () => {
    expect(decodePng(fixture("truncated-idat.png"), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "malformed" });
  });
  it("an overlong chunk length fails `malformed` on the chunk walk, before the slice", () => {
    expect(decodePng(fixture("overlong-chunk.png"), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "malformed" });
  });
  it.each(["forged-bmp-offset.bmp", "forged-bmp-stride.bmp"])("a forged BMP %s fails `malformed`", (f) => {
    expect(decodeBmp(fixture(f), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "malformed" });
  });
  it("a 58-byte BITMAPV5HEADER BMP whose buffer ends exactly where the color masks would start fails `malformed`, not a RangeError crash", () => {
    expect(decodeBmp(fixture("short-v5-masks.bmp"), NEVER_EXPIRES)).toMatchObject({ ok: false, code: "malformed" });
  });

  // F10 fix-wave review finding P2: the palette/16-bit/interlaced PASSTHROUGH arm returned right after
  // parsing IHDR, before the chunk walk continued — so a 33-byte IHDR-only file (sig + one IHDR chunk,
  // no IDAT, no IEND, nothing else) passed as a valid image purely because its declared colour type
  // routes to passthrough. The pixel-decode arm never had this hole (the boundary-matrix cell above
  // already proves an IHDR-only, colorType:2 file fails `malformed` — "no IDAT chunk found"); this cell
  // proves the passthrough arm now gets the identical treatment.
  it("an IHDR-only palette PNG (colorType 3, no IDAT, no IEND) fails `malformed`, not a bare passthrough", () => {
    const hostile = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", ihdrData({ width: 64, height: 48, colorType: 3 }))]);
    expect(hostile).toHaveLength(33); // sig(8) + len(4) + type(4) + IHDR data(13) + crc(4) = 33
    expect(decodePng(hostile, NEVER_EXPIRES)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("SABOTAGE GUARD: dropping maxOutputLength must turn the bomb cell red", () => {
    const src = readFileSync(new URL("../../src/media/imageCodec.ts", import.meta.url), "utf8");
    const calls = src.match(/inflateSync\(/g) ?? [];
    const capped = src.match(/inflateSync\([^)]*maxOutputLength/gs) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(capped).toHaveLength(calls.length);
  });

  it("the cooperative belt is documented as a belt, not as an interrupt", () => {
    const src = readFileSync(new URL("../../src/media/imageCodec.ts", import.meta.url), "utf8");
    expect(src).toMatch(/cooperative/i);
    expect(src).not.toMatch(/cannot hang|guarantees? termination/i);
  });
});

it("an EXPIRED belt trips between stages with `budget-exceeded` — a cooperative check, nothing more", () => {
  const r = decodePng(fixture("rgb8-64x48.png"), { expired: () => true });
  expect(r).toMatchObject({ ok: false, code: "budget-exceeded" });
});

// ---------------------------------------------------------------------------------------------
describe("I5a boundary matrix", () => {
  it.each(triple(MAX_SOURCE_BYTES))("MAX_SOURCE_BYTES $label", ({ at, passes }) => {
    const r = decodePng(Buffer.alloc(at), NEVER_EXPIRES);
    const code = r.ok ? undefined : r.code;
    expect(code === "source-too-large").toBe(!passes);
  });

  it.each(triple(MAX_PIXELS))("MAX_PIXELS $label", ({ at, passes }) => {
    const r = decodePng(ihdrOnlyPng(at, 1), NEVER_EXPIRES);
    const code = r.ok ? undefined : r.code;
    expect(code === "pixel-budget").toBe(!passes);
    if (passes) expect(code).toBe("malformed"); // the header is all there is — it got past the gate
  });

  it.each(triple(64))("a chunk declaring $label bytes against a 64-byte tail", ({ at, passes }) => {
    const r = decodePng(pngWithTrailingChunk(64, at), NEVER_EXPIRES);
    const code = r.ok ? undefined : r.code;
    expect(code === "malformed").toBe(!passes);
  });
});
