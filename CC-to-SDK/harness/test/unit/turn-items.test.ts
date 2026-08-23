// harness/test/unit/turn-items.test.ts — the app-server turn-input item resolver (spec
// docs/superpowers/specs/2026-08-23-appserver-image-input-design.md rev 3, plan Task 3). Two contracts
// are under test and they are inseparable:
//
//   1. CANONICAL ORDERING — ONE text block carrying the text fold with degrade notes appended to ITS
//      end (in image order), THEN the surviving images in declaration order. Both thread origins ship
//      this exact shape, so an interleaved `text A → image → text B` request is DEFINED (fold `AB`),
//      never origin-dependent.
//   2. THE FULL CAP SUITE LIVES HERE — strict base64, sniffed-bytes media type, MAX_DIMENSION,
//      per-image POST_PROCESS_BYTE_BUDGET, the 5 MiB running aggregate, the image-count gate. Anything
//      left for the downstream `normalizeTurnInput` to degrade would be replaced IN PLACE, splitting
//      the single canonical text block — which is why every row below asserts the whole array shape,
//      not just the failure text.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// The count gate's "before any I/O" claim is only checkable by watching the syscall: a late gate still
// emits the same note (it just discards the read's failure), so no assertion on the OUTPUT can catch it.
// The spy delegates to the real `open`, so every other localImage row below runs against the real fs.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const opens = open as unknown as Mock;
import { resolveInputItems, MAX_INPUT_ITEMS, MAX_DATA_URL_CHARS, type InputItem } from "../../src/appserver/turnItems.js";
import { pngDimensions, MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET } from "../../src/tui/clipboardImage.js";
import { MAX_IMAGES_PER_PROMPT } from "../../src/host/imageStaging.js";
import { flattenForDisplay, type UserContentBlock, type UserTurnInput } from "../../src/session/turnInput.js";

// -------------------------------------------------------------------------------------------------
// Fixtures. `solidPng` is probe 113's hand-rolled encoder (signature + IHDR + deflated IDAT + IEND) —
// a REAL file any decoder accepts, used wherever a row claims "a valid PNG". `fakePng` is header-only
// but padded to an EXACT total length, which is what makes the byte-budget and aggregate boundaries
// cheap to hit; `pngDimensions` never reads past byte 24, so the resolver cannot tell the difference —
// and that is precisely the library-bypass posture the sniff exists to hold.
function solidPng(size: number, r = 10, g = 20, b = 30): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;                                            // 8-bit, truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    for (let x = 0; x < size; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function fakePng(width: number, height: number, totalBytes = 24): Buffer {
  const buf = Buffer.alloc(Math.max(totalBytes, 24));                  // 24 = the least pngDimensions will even look at
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}
/** SOI then one SOF0 segment — the least `jpegDimensions` needs: precision(1) + height(2) + width(2). */
function fakeJpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(21);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xc0;
  buf.writeUInt16BE(17, 4); buf[6] = 8;
  buf.writeUInt16BE(height, 7); buf.writeUInt16BE(width, 9);
  buf[11] = 3;
  return buf;
}

const dataUrl = (buf: Buffer, declared = "image/png") => `data:${declared};base64,${buf.toString("base64")}`;
const img = (buf: Buffer, declared?: string): InputItem => ({ type: "image", url: dataUrl(buf, declared) });
const txt = (text: string): InputItem => ({ type: "text", text });
const note = (reason: string) => `[Image could not be processed: ${reason}]`;
const imageBlock = (buf: Buffer, mediaType = "image/png"): UserContentBlock =>
  ({ type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } });

/** Every row goes through these: the resolver's public contract is the ARRAY shape, always — never a
 *  bare string, even when no image survived (row (k) pins that, and Task 4's echo path depends on it). */
function blocks(out: UserTurnInput): UserContentBlock[] {
  if (typeof out === "string") throw new Error(`expected the canonical block array, got a string: ${out}`);
  return out;
}
function foldText(out: UserTurnInput): string {
  const first = blocks(out)[0];
  if (!first || first.type !== "text") throw new Error("expected a leading text block");
  return first.text;
}

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-items-")); opens.mockClear(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// =====================================================================================================
describe("resolveInputItems — canonical ordering", () => {
  it("folds interleaved text and emits images after it, in declaration order", async () => {
    // (a) The interleave the spec had to DEFINE: `text A → image → text B` has no faithful shape on the
    // host wire (which folds every text block into its single leading `text`), so the contract is the
    // one shape both wires carry — fold `AB`, then the images.
    const p1 = solidPng(2), p2 = solidPng(3);
    const out = await resolveInputItems([txt("A"), img(p1), txt("B"), img(p2)]);
    expect(out).toEqual([{ type: "text", text: "AB" }, imageBlock(p1), imageBlock(p2)]);
  });

  it("puts a degrade note INSIDE the single text block, never between the images", async () => {
    // (c) The mixed-success interleave. An in-place replacement (what `normalizeTurnInput` does for its
    // own callers) would emit text/text/text/image here — two text blocks, and a shape the host wire
    // cannot reproduce. The note belongs at the FOLD's end.
    const good = solidPng(2);
    const out = await resolveInputItems([txt("A"), img(Buffer.from("not an image at all")), txt("B"), img(good)]);
    expect(out).toEqual([{ type: "text", text: `AB${note("unreadable image data")}` }, imageBlock(good)]);
  });

  it("returns the fold-plus-notes block array even when NO image survived", async () => {
    // (k) One shape, always — a bare string here would make `flattenForDisplay` and the queue's echo
    // path branch on whether the turn happened to have a good image.
    const out = await resolveInputItems([txt("A"), img(Buffer.from("nope")), txt("B")]);
    expect(out).toEqual([{ type: "text", text: `AB${note("unreadable image data")}` }]);
    expect(flattenForDisplay(out)).toBe(`AB${note("unreadable image data")}`);
  });

  it("publishes the wire bounds Task 4's schema enforces", async () => {
    expect(MAX_INPUT_ITEMS).toBe(64);
    expect(MAX_DATA_URL_CHARS).toBe(240_000);
  });
});

// =====================================================================================================
describe("resolveInputItems — data: URLs", () => {
  it("derives media_type from the SNIFFED BYTES, not the declaration", async () => {
    // (b) A valid PNG labelled `application/pdf` passes every local check and then fails the WHOLE
    // engine request against the SDK's media-type union — one wrong label killing a turn that carried
    // four good images. The bytes are the fact; the label is a claim.
    const png = solidPng(2);
    expect(await resolveInputItems([img(png, "application/pdf")])).toEqual([{ type: "text", text: "" }, imageBlock(png)]);
    const jpg = fakeJpeg(4, 4);
    expect(await resolveInputItems([img(jpg, "image/png")])).toEqual([{ type: "text", text: "" }, imageBlock(jpg, "image/jpeg")]);
  });

  it("validates the base64 alphabet BEFORE decoding, where Node would decode anyway", async () => {
    // (d) THE DISCRIMINATING HALF: `Buffer.from(s, "base64")` silently SKIPS characters outside the
    // alphabet, so the smuggled payload below decodes to a byte-identical valid PNG. Only a check that
    // runs before the decode can tell the two apart — the first assertion proves the decode cannot.
    const b64 = solidPng(2).toString("base64");
    const smuggled = `${b64.slice(0, 8)}*${b64.slice(8)}`;
    expect(pngDimensions(Buffer.from(smuggled, "base64"))).toEqual({ width: 2, height: 2 });
    expect(await resolveInputItems([{ type: "image", url: `data:image/png;base64,${smuggled}` }]))
      .toEqual([{ type: "text", text: note("malformed base64 payload") }]);
  });

  it("requires whole base64 quanta (padding), not a truncated tail", async () => {
    const b64 = solidPng(2).toString("base64");
    const truncated = b64.slice(0, -1);
    expect(truncated.length % 4).not.toBe(0);
    expect(foldText(await resolveInputItems([{ type: "image", url: `data:image/png;base64,${truncated}` }]))).toBe(note("malformed base64 payload"));
  });

  it("degrades a data: URL that is not base64-encoded at all", async () => {
    expect(foldText(await resolveInputItems([{ type: "image", url: "data:image/png,%89PNG" }]))).toBe(note("not a base64 data: URL"));
    expect(foldText(await resolveInputItems([{ type: "image", url: "data:image/png;base64" }]))).toBe(note("not a base64 data: URL"));
  });

  it("degrades a PNG whose IHDR declares dimensions over MAX_DIMENSION", async () => {
    // (e) The library-bypass cell: 70 bytes on the wire, a header claiming 2001px. Caught because the
    // resolver reads the IHDR field itself rather than inferring size from byte count.
    const over = Buffer.from(solidPng(2));
    over.writeUInt32BE(MAX_DIMENSION + 1, 16);
    expect(foldText(await resolveInputItems([img(over)])))
      .toBe(note(`dimensions ${MAX_DIMENSION + 1}x2 exceed the ${MAX_DIMENSION}x${MAX_DIMENSION}px limit`));
    const atCap = Buffer.from(solidPng(2));
    atCap.writeUInt32BE(MAX_DIMENSION, 16); atCap.writeUInt32BE(MAX_DIMENSION, 20);
    expect(blocks(await resolveInputItems([img(atCap)]))).toHaveLength(2);   // the cap itself passes
  });
});

// =====================================================================================================
describe("resolveInputItems — localImage bounded reads", () => {
  it("reads a real file and emits it as a sniffed block", async () => {
    // (f) Happy path. The 190 KB frame cap makes `localImage` the only route for a real screenshot, so
    // this is the path that carries most of the feature's actual traffic.
    const png = solidPng(4);
    const path = join(root, "shot.png");
    writeFileSync(path, png);
    expect(await resolveInputItems([txt("look: "), { type: "localImage", path }])).toEqual([{ type: "text", text: "look: " }, imageBlock(png)]);
  });

  it.skipIf(process.platform === "win32")("degrades a FIFO promptly instead of blocking in open(2)", async () => {
    // (g) The hang class the one-descriptor pattern exists to close: a path-`stat` sizes a FIFO at 0, the
    // budget waves it through, and `readFile` then blocks forever waiting for a writer that never comes —
    // a turn that never settles. O_NONBLOCK + the fstat kind guard turn it into one note. The wall clock
    // is the real assertion here; a hang would fail as a timeout, so bound it explicitly.
    const path = join(root, "pipe.png");
    execFileSync("mkfifo", [path]);
    const started = Date.now();
    const out = await resolveInputItems([{ type: "localImage", path }]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(foldText(out)).toBe(note(`${path}: not a regular file (FIFO)`));
  });

  it("degrades a directory and a missing file, naming the client's own path", async () => {
    expect(foldText(await resolveInputItems([{ type: "localImage", path: root }]))).toBe(note(`${root}: not a regular file (directory)`));
    const missing = join(root, "gone.png");
    expect(foldText(await resolveInputItems([{ type: "localImage", path: missing }]))).toContain(missing);
    expect(foldText(await resolveInputItems([{ type: "localImage", path: missing }]))).toContain("ENOENT");
  });

  it("refuses a file over POST_PROCESS_BYTE_BUDGET and admits one exactly at it", async () => {
    // (h) The boundary sits on the bytes, and the over-budget file is never materialized — the read stops
    // at cap+1 rather than pulling 512 KB of a file it has already decided to refuse.
    const over = join(root, "over.png"), at = join(root, "at.png");
    writeFileSync(over, fakePng(2, 2, POST_PROCESS_BYTE_BUDGET + 1));
    writeFileSync(at, fakePng(2, 2, POST_PROCESS_BYTE_BUDGET));
    expect(foldText(await resolveInputItems([{ type: "localImage", path: over }])))
      .toBe(note(`${over}: image data exceeds the ${POST_PROCESS_BYTE_BUDGET}-byte limit`));
    expect(blocks(await resolveInputItems([{ type: "localImage", path: at }]))).toHaveLength(2);
  });

  it("never MATERIALIZES an over-budget file — the fstat refusal precedes the first read", async () => {
    // The reason string alone cannot prove this: a resolver that read all 512 KB and then refused on the
    // buffer's length produces the identical note. Count the reads on the descriptor itself.
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let reads = 0;
    const counting = (async (p: string, flags: number) => {
      const fh = await actual.open(p, flags);
      const real = fh.read.bind(fh);
      (fh as { read: unknown }).read = (...a: unknown[]) => { reads++; return (real as (...x: unknown[]) => unknown)(...a); };
      return fh;
    }) as unknown as typeof open;
    const over = join(root, "over.png"), at = join(root, "at.png");
    writeFileSync(over, fakePng(2, 2, POST_PROCESS_BYTE_BUDGET + 1));
    writeFileSync(at, fakePng(2, 2, POST_PROCESS_BYTE_BUDGET));
    opens.mockImplementationOnce(counting);
    await resolveInputItems([{ type: "localImage", path: over }]);
    expect(reads).toBe(0);
    opens.mockImplementationOnce(counting);                                    // the control: an admissible file IS read
    await resolveInputItems([{ type: "localImage", path: at }]);
    expect(reads).toBeGreaterThan(0);
  });
});

// =====================================================================================================
describe("resolveInputItems — turn-wide budgets", () => {
  it("gates the image COUNT before any I/O", async () => {
    // (i) The amplification guard: an over-limit declaration must cost nothing to refuse. Asserted on
    // the SYSCALL, not the note — a gate that ran after the read would emit the identical note, having
    // simply thrown the read's failure away, so the output alone cannot tell the two apart.
    const png = solidPng(2);
    const items: InputItem[] = Array.from({ length: MAX_IMAGES_PER_PROMPT }, () => img(png));
    items.push({ type: "localImage", path: join(root, "never-opened.png") });
    const out = await resolveInputItems(items);
    expect(opens).not.toHaveBeenCalled();
    expect(blocks(out)).toHaveLength(1 + MAX_IMAGES_PER_PROMPT);
    expect(foldText(out)).toBe(note(`too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})`));
  });

  it("proves the open spy is wired to the resolver's own read", async () => {
    // The control for the row above: the same spy DOES fire for an in-limit localImage, so "never
    // called" there is a fact about the gate and not about a mock that was never connected.
    const path = join(root, "one.png");
    writeFileSync(path, solidPng(2));
    await resolveInputItems([{ type: "localImage", path }]);
    expect(opens).toHaveBeenCalledTimes(1);
  });

  it("degrades the image that crosses the 5 MiB aggregate, and still admits a later one that fits", async () => {
    // (j) Ten at the per-image ceiling sit just under the turn aggregate; the eleventh crosses it and
    // degrades ALONE — a turn is never refused wholesale — and the twelfth, which still fits in what is
    // left, is given its chance. Both halves matter: a bare running total would have dropped it too.
    const AGGREGATE = 5 * 1024 * 1024;
    const big = fakePng(2, 2, POST_PROCESS_BYTE_BUDGET);
    const bigUrl = dataUrl(big);
    const fits = fakePng(2, 2, AGGREGATE - POST_PROCESS_BYTE_BUDGET * 10);
    const items: InputItem[] = Array.from({ length: 10 }, () => ({ type: "image", url: bigUrl } as InputItem));
    items.push({ type: "image", url: bigUrl }, img(fits));
    const out = await resolveInputItems(items);
    expect(blocks(out)).toHaveLength(1 + 11);                                  // ten big + the exact-fit one
    expect(foldText(out)).toBe(note(`turn's total image size exceeds the ${AGGREGATE}-byte limit`));
    expect(blocks(out).at(-1)).toEqual(imageBlock(fits));
  });

  it("charges localImage reads against the same aggregate, refusing before the read", async () => {
    const AGGREGATE = 5 * 1024 * 1024;
    const bigUrl = dataUrl(fakePng(2, 2, POST_PROCESS_BYTE_BUDGET));
    const path = join(root, "tail.png");
    writeFileSync(path, fakePng(2, 2, POST_PROCESS_BYTE_BUDGET));               // 512,000 > the 122,880 left
    const items: InputItem[] = Array.from({ length: 10 }, () => ({ type: "image", url: bigUrl } as InputItem));
    items.push({ type: "localImage", path });
    const out = await resolveInputItems(items);
    expect(blocks(out)).toHaveLength(1 + 10);
    expect(foldText(out)).toBe(note(`${path}: turn's total image size exceeds the ${AGGREGATE}-byte limit`));
  });
});
