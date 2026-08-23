// test/unit/imageDims.test.ts — F10 T-MAINT item 3: the neutral media leaf that ends the
// `session/turnInput.ts` → `tui/clipboardImage.ts` inversion (F9 ledger Minor, r4 §3). The dimension
// readers' own behavioural coverage stays in `test/tui/clipboardImage.test.ts` where its PNG/JPEG
// fixtures live; what THIS file pins is the leaf's identity — the exact five exports T-IMGREACH's
// worktree imports by name, their values, and the layering guarantee that gives the module its reason
// to exist.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_DIMENSION, MAX_IMAGES_PER_PROMPT, POST_PROCESS_BYTE_BUDGET, jpegDimensions, pngDimensions,
} from "../../src/media/imageDims.js";

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

describe("src/media/imageDims.ts — the neutral leaf", () => {
  it("reads PNG IHDR dimensions and rejects a non-PNG", () => {
    expect(pngDimensions(pngHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(pngDimensions(Buffer.from([137, 80, 78, 71]))).toBeNull();
  });

  it("reads JPEG SOF dimensions and rejects a non-JPEG", () => {
    expect(jpegDimensions(jpegHeader(320, 240))).toEqual({ width: 320, height: 240 });
    expect(jpegDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("carries the three shared budgets at their canon values", () => {
    expect(MAX_DIMENSION).toBe(2000);                    // canon L8503, per-model image_limits
    expect(POST_PROCESS_BYTE_BUDGET).toBe(512_000);      // canon `v$r`, L174695
    expect(MAX_IMAGES_PER_PROMPT).toBe(20);              // ccx's own per-turn count guard, re-homed here
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
