// harness/test/unit/imageCodec-encode.test.ts — F10 T-IMGREACH Task 5 (I5b): the encode half —
// box-average downscale, ADAPTIVE per-scanline PNG filtering, and `reencodeImage`'s bounded
// downscale-and-retry ladder over the (Task 4) decode union, consumed EXHAUSTIVELY.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  downscale, encodePng, encodePngWithFixedFilter, reencodeImage, RETRY_FLOOR_DIMENSION,
  decodePng, NEVER_EXPIRES,
  type DecodedImage, type DecodedPixels, type CodecResult,
} from "../../src/media/imageCodec.js";
import { pngDimensions } from "../../src/media/imageDims.js";
import { triple } from "./boundaryTriple.js";
import { buildPng } from "../fixtures/images/make.mjs";

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

/** A plain, decodable-to-pixels PNG at the given dimensions — used where only DIMENSIONS matter
 *  (the box-downscale and boundary-matrix cells), sharing `make.mjs`'s own from-scratch PNG writer
 *  rather than a second copy. Same builder Task 4 used for `oversized-3200x1800.png`. */
function syntheticPng(width: number, height: number): Buffer {
  return buildPng({ width, height, colorType: 2, filterMode: "adaptive" });
}
/** A smooth gradient stored with the WORST filter and NO deflate compression (level 0) — large on
 *  disk by construction, so it exercises the "oversized in BYTES, not dimensions" path, while still
 *  being smooth, highly-compressible CONTENT that this module's own adaptive encoder can shrink hard. */
function gradientPng(width: number, height: number): Buffer {
  return buildPng({ width, height, colorType: 2, filterMode: 0, deflateLevel: 0 });
}

// The byte-budget boundary matrix needs the EXACT size this module's own adaptive `encodePng`
// produces for a real fixture's pixel content at full resolution — not formula-derivable (deflate
// output is not a pure function of length), so it is measured here, once, the same way `make.mjs`
// measures its own fixtures: by literally running the encoder and reading the result.
const sizesJson = JSON.parse(readFileSync(join(FIXTURES_DIR, "sizes.json"), "utf8")) as { EXACT_ENCODE_WIDTH: number };
const EXACT_ENCODE_WIDTH = sizesJson.EXACT_ENCODE_WIDTH;
const exactFixturePixels = expectPixels(decodePng(fixture("exactly-512000.png"), NEVER_EXPIRES));
const EXACT_ENCODE_BYTES = (encodePng(exactFixturePixels, NEVER_EXPIRES) as { ok: true; value: Buffer }).value.length;

// ---------------------------------------------------------------------------------------------
describe("I5b(a) downscale — box average", () => {
  it("an oversized-DIMENSION image comes back SMALLER IN PIXELS, not merely in bytes", () => {
    const src = syntheticPng(3200, 1800); // > maxDimension on the long side
    const r = reencodeImage({ data: src, mediaType: "image/png" }, { maxDimension: 2000, byteBudget: 512_000 });
    expect(r.ok).toBe(true);
    const dims = (r as any).value.dimensions;
    expect(dims.width).toBeLessThanOrEqual(2000);
    expect(dims.height).toBeLessThanOrEqual(2000);
    expect(dims.width).toBeLessThan(3200); // NOT just "fewer bytes"
    expect(pngDimensions((r as any).value.data)).toEqual(dims); // the header agrees with the report
    expect(dims.width / dims.height).toBeCloseTo(3200 / 1800, 1); // aspect ratio preserved
  });

  it("downscale is a NO-OP when the image is already inside maxDimension", () => {
    const px = expectPixels(decodePng(fixture("rgb8-64x48.png"), NEVER_EXPIRES));
    expect(downscale(px, 2000)).toBe(px); // identity, not a copy
  });

  it("the box average is a real average, not nearest-neighbour", () => {
    // A 2x1 image of pure red and pure blue, downscaled to 1x1, must be the MEAN, not either source pixel.
    const px = { kind: "pixels", width: 2, height: 1,
                 pixels: Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]) } as DecodedPixels;
    expect([...downscale(px, 1).pixels]).toEqual([128, 0, 128, 255]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5b(b) byte-only recompression and the adaptive-filter sabotage guard", () => {
  it("an in-dimension but oversized-BYTES image recompresses under budget at FULL resolution", () => {
    const src = gradientPng(1200, 900); // large on disk, inside maxDimension
    const r = reencodeImage({ data: src, mediaType: "image/png" }, { maxDimension: 2000, byteBudget: 512_000 });
    expect(r.ok).toBe(true);
    expect((r as any).value.data.length).toBeLessThanOrEqual(512_000);
    expect((r as any).value.dimensions).toEqual({ width: 1200, height: 900 }); // dimensions UNCHANGED
  });

  it("adaptive filtering is doing the work — filter-0 output is orders larger", () => {
    const px = expectPixels(decodePng(gradientPng(1200, 900), NEVER_EXPIRES));
    const adaptive = (encodePng(px, NEVER_EXPIRES) as any).value as Buffer;
    const flat = (encodePngWithFixedFilter(px, 0, NEVER_EXPIRES) as any).value as Buffer;
    expect(adaptive.length).toBeLessThan(flat.length / 10); // r3 measured 193x; 10x is the guard
  });

  it("encode→decode round-trips pixel-exactly", () => {
    const px = expectPixels(decodePng(fixture("rgba8-64x48.png"), NEVER_EXPIRES));
    const out = (encodePng(px, NEVER_EXPIRES) as any).value as Buffer;
    expect(expectPixels(decodePng(out, NEVER_EXPIRES)).pixels).toEqual(px.pixels);
  });

  it("the retry ladder halves and stops at the floor rather than looping", () => {
    // A byteBudget no PNG of this content can meet: the ladder must terminate with `encode-floor`,
    // having tried each rung exactly once. `syntheticPng`, not `gradientPng`: the latter's
    // uncompressed level-0 encoding of a 2000x2000 image would itself exceed `MAX_SOURCE_BYTES`
    // before the ladder is ever reached — a decode-side concern, not what this cell tests.
    const r = reencodeImage({ data: syntheticPng(2000, 2000), mediaType: "image/png" },
                            { maxDimension: 2000, byteBudget: 100 });
    expect(r).toMatchObject({ ok: false, code: "encode-floor" });
    expect((r as any).reason).toContain(String(RETRY_FLOOR_DIMENSION));
  });

  // F10 fix-wave review finding P2: a plain halving of the CURRENT long side can jump straight past
  // `RETRY_FLOOR_DIMENSION` without ever trying it — 400 -> floor(400/2) = 200, which skips 256
  // entirely. The cell above never caught this because it never inspects which widths the ladder
  // actually tried, only that it eventually gives up; this one reads the `onRung` seam.
  it("the ladder always tries the floor itself before giving up — a halving step never jumps past it", () => {
    const seen: number[] = [];
    const r = reencodeImage({ data: syntheticPng(400, 400), mediaType: "image/png" },
                            { maxDimension: 400, byteBudget: 1, onRung: (w: number) => seen.push(w) });
    expect(r).toMatchObject({ ok: false, code: "encode-floor" });
    expect(seen).toContain(RETRY_FLOOR_DIMENSION);           // the floor itself was one of the tried rungs
    expect(Math.min(...seen)).toBe(RETRY_FLOOR_DIMENSION);   // and nothing tried ever went BELOW it
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5b(c) the decode union, consumed exhaustively", () => {
  it("a palette PNG under budget passes through UNCHANGED — same bytes out", () => {
    const src = fixture("palette-64x48.png");
    const r = reencodeImage({ data: src, mediaType: "image/png" }, { maxDimension: 2000, byteBudget: 512_000 });
    expect((r as any).value.data).toEqual(src);
    expect((r as any).value.dimensions).toEqual({ width: 64, height: 48 });
  });

  it("a passthrough variant that needs resizing fails `unsupported-variant`, never silently ships oversized", () => {
    const r = reencodeImage({ data: fixture("interlaced-64x48.png"), mediaType: "image/png" },
                            { maxDimension: 32, byteBudget: 512_000 });
    expect(r).toMatchObject({ ok: false, code: "unsupported-variant" });
  });

  it("decode failures propagate their CODE through the ladder unchanged", () => {
    expect(reencodeImage({ data: fixture("bomb.png"), mediaType: "image/png" }))
      .toMatchObject({ ok: false, code: "inflate-overrun" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("I5b boundary matrix", () => {
  it.each(triple(2000))("maxDimension $label on the long side", ({ at, passes }) => {
    const r = reencodeImage({ data: syntheticPng(at, 100), mediaType: "image/png" },
                            { maxDimension: 2000, byteBudget: 5_000_000 });
    expect((r as any).value.dimensions.width).toBe(passes ? at : 2000); // at/below: untouched; above: clamped
  });

  it.each([
    // `byteBudget` is a FIT test, not a reject test, so its three rows are written out rather than
    // derived from `passes`: the budget is compared against a fixture whose full-resolution encode
    // is a real, measured number (`EXACT_ENCODE_BYTES`, above). Below it the ladder must take ONE
    // rung; at and above it, none. Byte counts alone cannot tell "fit at full resolution" from "fit
    // after a halving", so the assertion is on the RUNG COUNT, read from the injected `onRung` seam.
    { budgetOffset: -1, rungs: 1, label: "cap−1 → one downscale rung" },
    { budgetOffset: 0, rungs: 0, label: "cap → fits at full resolution" },
    { budgetOffset: 1, rungs: 0, label: "cap+1 → fits at full resolution" },
  ])("byteBudget $label", ({ budgetOffset, rungs }) => {
    const budget = EXACT_ENCODE_BYTES + budgetOffset;
    const seen: number[] = [];
    const r = reencodeImage({ data: fixture("exactly-512000.png"), mediaType: "image/png" },
                            { maxDimension: 4000, byteBudget: budget, onRung: (w: number) => seen.push(w) });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(rungs);
    expect((r as any).value.data.length).toBeLessThanOrEqual(budget);
    if (rungs === 0) expect((r as any).value.dimensions.width).toBe(EXACT_ENCODE_WIDTH);
  });
});
