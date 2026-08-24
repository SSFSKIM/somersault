// harness/test/unit/turnInput.test.ts — F9 T-IMAGE Task 4 (I3a): UserTurnInput + the AUTHORITATIVE
// normalizer at the Session message-builder boundary (spec v3.1 "Authoritative validation lives at
// the Session message-builder boundary", plan Global Constraints + Task 4). Boundary cells sit at the
// EXACT values the plan names: 1999/2000/2001px dimensions, 5 MiB ± 1 base64 input, 512,000 ± 1
// decoded bytes, the per-turn aggregate ± one whole block — plus the header-decode "library-bypass"
// cell and the `Session.submit` seam proof that normalization cannot be skipped by any caller.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { z } from "zod/v4";
import {
  flattenForDisplay, assembleUserContent, normalizeTurnInput, syntheticImageLabel, isStrandedTurn,
  normalizeValidatedBlocks, validateImageBlock,
  MAX_BASE64_INPUT_BYTES, MAX_AGGREGATE_BYTES, MAX_CONTENT_BLOCKS, MAX_TOTAL_TEXT,
  SENTINEL_TEXT_RESERVE, TRUNCATION_SUFFIX_RESERVE, TRUNCATION_SUFFIX,
  type UserContentBlock, type UserTurnInput,
} from "../../src/session/turnInput.js";
import { MAX_DIMENSION, POST_PROCESS_BYTE_BUDGET, MAX_IMAGES_PER_PROMPT } from "../../src/media/imageDims.js";
import { Session } from "../../src/session/session.js";
import type { Harness } from "../../src/harness.js";
import type { DaemonClient } from "../../src/daemon/connect.js";
import { turnStartParams } from "../../src/appserver/schema/turns.js";
import { triple } from "./boundaryTriple.js";

// -------------------------------------------------------------------------------------------------
// PNG fixtures — two DELIBERATELY different generators.
//
// `solidPng` is probe 113's own hand-rolled encoder (probes/probes/113-image-content-block.ts): a
// REAL signature + IHDR + zlib-deflated IDAT + IEND, decodable by any real PNG reader. Used for the
// dimension-boundary cells so those specific cells prove the cap against a genuine file, not a
// synthetic header snippet.
//
// `fakePng` is header-only: real signature bytes and a real IHDR field carrying the declared
// width/height, then zero-padded to an EXACT total length — no real IDAT/CRC discipline, because
// `pngDimensions` (clipboardImage.ts) never reads past byte 24 to begin with. This is what makes the
// byte-length boundaries (base64 input cap, post-ceiling, aggregate) exact and cheap to construct,
// and it IS the shape of the header-decode "library-bypass" cell: a small buffer whose header lies
// about its pixel dimensions.
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    raw[o] = 0; // filter: none
    for (let x = 0; x < size; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fakePng(width: number, height: number, totalBytes = 24): Buffer {
  const buf = Buffer.alloc(Math.max(totalBytes, 24)); // 24 = the minimum pngDimensions will even look at
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function imageBlock(buf: Buffer, mediaType = "image/png"): UserContentBlock {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
}
function textBlock(text: string): UserContentBlock { return { type: "text", text }; }
function asText(b: UserContentBlock): string { if (b.type !== "text") throw new Error("expected a degraded text block"); return b.text; }

/** GIF87a/GIF89a: 6-byte tag, then logical screen width/height as two LE uint16s at bytes 6-10.
 *  Mirrors `imageDims.test.ts`'s own builder — `gifDimensions` never reads past byte 10. */
const gifHeader = (w: number, h: number, tag = "GIF89a") => {
  const b = Buffer.alloc(13); b.write(tag, 0, "ascii"); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
};
/** WebP lossless (VP8L): RIFF/WEBP/"VP8L" chunk headers, then the 0x2f signature byte, then width-1/
 *  height-1 packed as 14 bits each into a little-endian 28-bit field. Mirrors `imageDims.test.ts`. */
const webpVp8l = (w: number, h: number) => {
  const b = Buffer.alloc(25); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(17, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii"); b.writeUInt32LE(5, 16); b[20] = 0x2f;
  b.writeUInt32LE((w - 1) & 0x3fff | (((h - 1) & 0x3fff) << 14), 21); return b;
};

// =====================================================================================================
describe("assembleUserContent", () => {
  it("puts the text block first and appends images in caller order (canon L371395-371427)", () => {
    const out = assembleUserContent("hello", [
      { data: "AAAA", mediaType: "image/png" },
      { data: "BBBB", mediaType: "image/jpeg" },
    ]);
    expect(out).toEqual([
      { type: "text", text: "hello" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } },
    ]);
  });
  it("still emits the (empty) text block first when there are no images", () => {
    expect(assembleUserContent("solo", [])).toEqual([{ type: "text", text: "solo" }]);
  });
});

describe("flattenForDisplay", () => {
  it("returns a string input untouched", () => { expect(flattenForDisplay("plain text")).toBe("plain text"); });
  it("numbers image blocks per-turn and concatenates directly with text", () => {
    const input: UserTurnInput = [textBlock("look: "), imageBlock(fakePng(4, 4, 40)), textBlock(" and "), imageBlock(fakePng(4, 4, 40))];
    expect(flattenForDisplay(input)).toBe("look: [Image #1] and [Image #2]");
  });
});

// =====================================================================================================
describe("normalizeTurnInput — string input", () => {
  it("passes a plain string through untouched", () => { expect(normalizeTurnInput("hello world")).toBe("hello world"); });
});

describe("normalizeTurnInput — dimension boundary, exact 2000x2000 (real PNGs, probe-113 pattern)", () => {
  // A leading non-empty text block keeps these cells isolated to the dimension cap alone: a LONE
  // passing image (no text at all) is exactly the F10 T-IMGREACH I1 "stranded turn" shape and now
  // legitimately gets a synthetic label — that behavior has its own tests below, under "I1 stranding
  // rule"; these boundary cells stay about the cap, not about stranding.
  it("passes a 1999x1999 image through untouched", () => {
    const block = imageBlock(solidPng(1999));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("passes a 2000x2000 image through untouched — AT the cap is not OVER it", () => {
    const block = imageBlock(solidPng(2000));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("degrades a 2001x2001 image", () => {
    const out = normalizeTurnInput([imageBlock(solidPng(2001))]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe("[Image could not be processed: dimensions 2001x2001 exceed the 2000x2000px limit]");
  });
});

describe("normalizeTurnInput — the header-decode 'library-bypass' cell", () => {
  it("a TINY buffer whose IHDR claims 3000x3000 is still caught — the check reads the header, not the byte count", () => {
    const tiny = fakePng(3000, 3000, 24); // 24 bytes total: signature + IHDR, nothing else
    const out = normalizeTurnInput([imageBlock(tiny)]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toContain("dimensions 3000x3000 exceed the 2000x2000px limit");
  });
  it("degrades data with no recognizable PNG/JPEG/GIF/WebP header at all", () => {
    const out = normalizeTurnInput([imageBlock(Buffer.from("not an image, just some bytes"))]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe("[Image could not be processed: unreadable image data]");
  });
});

describe("normalizeTurnInput — bl4 T-GIFWEBP: GIF/WebP join the validator chain", () => {
  it("a GIF survives normalization untouched — no longer replaced with the failure text", () => {
    const block = imageBlock(gifHeader(4, 4), "image/gif");
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("a VP8L WebP survives normalization untouched — no longer replaced with the failure text", () => {
    const block = imageBlock(webpVp8l(4, 4), "image/webp");
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("an oversized GIF still degrades — with the DIMENSION reason, not 'unreadable'", () => {
    const out = normalizeTurnInput([imageBlock(gifHeader(2400, 10), "image/gif")]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe("[Image could not be processed: dimensions 2400x10 exceed the 2000x2000px limit]");
  });
});

describe("normalizeTurnInput — base64 input cap (5 MiB), exact boundary + precedence", () => {
  const MAX_BASE64 = 5 * 1024 * 1024;
  // A tiny valid header (safely within the dimension cap) whose base64 form is padded with more
  // valid base64 characters ('A') to an EXACT target string length — decoupling "the base64 string
  // is this many characters" from "a real image of this many raw bytes" (real base64 output only
  // ever lands on multiples of 4, so an exact ±1-character target cannot come from encoding an
  // arbitrary byte buffer directly).
  const header = fakePng(4, 4, 24).toString("base64");
  const dataOfLength = (n: number) => header + "A".repeat(n - header.length);

  it("at exactly the cap, the base64-cap reason does NOT fire (a smaller cap — post-ceiling — still catches it, for a different reason)", () => {
    const data = dataOfLength(MAX_BASE64);
    expect(data.length).toBe(MAX_BASE64);
    const out = normalizeTurnInput([{ type: "image", source: { type: "base64", media_type: "image/png", data } }]) as UserContentBlock[];
    expect(out[0].type).toBe("text"); // still degrades — decoded bytes are ~3.75MB, way over the 512,000 post-ceiling
    expect(asText(out[0])).not.toMatch(/base64 input exceeds/);
    expect(asText(out[0])).toMatch(/512000-byte limit/);
  });
  it("one byte over the cap: the base64-cap reason fires FIRST (checked before the post-ceiling)", () => {
    const data = dataOfLength(MAX_BASE64 + 1);
    expect(data.length).toBe(MAX_BASE64 + 1);
    const out = normalizeTurnInput([{ type: "image", source: { type: "base64", media_type: "image/png", data } }]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toMatch(/base64 input exceeds the 5242880-byte limit/);
  });
  // Final-review finding 1: the cap must fire on `data.length` BEFORE `Buffer.from` ever decodes the
  // string — checking it on the decoded buffer instead defeats the memory-safety intent (the
  // allocation the cap exists to bound would already have happened). This is reorder-proof rather
  // than boundary-proof: `data` here has no PNG/JPEG signature at all, so if the header were ever
  // decoded and read BEFORE this length check, the reason would be "unreadable image data" instead —
  // that would only be possible if the checks ran in the pre-fix order.
  it("garbage bytes over the base64 cap are rejected by length alone — the header is never read first", () => {
    const garbage = "A".repeat(MAX_BASE64 + 1); // valid base64 alphabet, no PNG/JPEG signature
    const out = normalizeTurnInput([{ type: "image", source: { type: "base64", media_type: "image/png", data: garbage } }]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe(`[Image could not be processed: base64 input exceeds the ${MAX_BASE64}-byte limit]`);
  });
});

describe("normalizeTurnInput — post-processing byte ceiling (512,000 decoded bytes), exact boundary", () => {
  // Leading text block, same reason as the dimension-boundary describe above: isolate the byte-ceiling
  // check from I1's stranding rule, which a LONE passing image (no text) now legitimately triggers.
  it("passes at exactly 512,000 decoded bytes", () => {
    const block = imageBlock(fakePng(4, 4, 512_000));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("still passes one byte under (511,999)", () => {
    const block = imageBlock(fakePng(4, 4, 511_999));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toEqual(block);
  });
  it("degrades one byte over (512,001)", () => {
    const out = normalizeTurnInput([imageBlock(fakePng(4, 4, 512_001))]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe("[Image could not be processed: image data exceeds the 512000-byte limit]");
  });
});

describe("normalizeTurnInput — per-turn aggregate ceiling (5 MiB decoded bytes), ± one whole block", () => {
  // 10 blocks at the per-block post-ceiling (512,000) + one more at 122,880 sums to EXACTLY
  // 5,242,880 (the aggregate cap) — every block individually legal, and the running total lands
  // right on the line.
  const atCapSizes = [...Array(10).fill(512_000), 122_880];
  it(`${atCapSizes.length} blocks summing to exactly the aggregate cap all pass`, () => {
    expect(atCapSizes.reduce((a, b) => a + b, 0)).toBe(5 * 1024 * 1024);
    const blocks = atCapSizes.map((n) => imageBlock(fakePng(4, 4, n)));
    // Leading text block: an all-image array with no text is I1's "stranded turn" shape and would
    // otherwise pick up a synthetic label, which is not what this cell is testing.
    const out = normalizeTurnInput([textBlock("hi"), ...blocks]) as UserContentBlock[];
    expect(out[0]).toEqual({ type: "text", text: "hi" });
    blocks.forEach((b, i) => expect(out[i + 1]).toEqual(b));
  });
  it("one more block (any size) pushes the running total over — THAT block degrades, the rest survive", () => {
    const sizes = [...atCapSizes, 24]; // the smallest legal block this file can build
    const blocks = sizes.map((n) => imageBlock(fakePng(4, 4, n)));
    const out = normalizeTurnInput(blocks) as UserContentBlock[];
    for (let i = 0; i < atCapSizes.length; i++) expect(out[i]).toEqual(blocks[i]); // untouched (content-equal: canonical re-encode allocates a new object)
    expect(out[atCapSizes.length].type).toBe("text");
    expect(asText(out[atCapSizes.length])).toMatch(/total image size exceeds the 5242880-byte limit/);
  });
});

describe("normalizeTurnInput — mixed turns: violations degrade in place, everything else survives", () => {
  it("a text block, a good image, and a bad image: only the bad one changes shape", () => {
    const good = imageBlock(fakePng(4, 4, 1_000));
    const bad = imageBlock(fakePng(2001, 2001, 1_000));
    const out = normalizeTurnInput([textBlock("hi"), good, bad]) as UserContentBlock[];
    expect(out[0]).toEqual({ type: "text", text: "hi" });
    expect(out[1]).toEqual(good);
    expect(out[2].type).toBe("text");
    expect(asText(out[2])).toContain("2001x2001");
  });
});

// =====================================================================================================
// Session.submit: the seam that makes normalization unconditional. `captureQuery` mirrors
// test/unit/session.test.ts's own fake-query pattern, capturing exactly what got pushed onto the
// query's prompt stream (i.e., the wire content the builder produced) rather than anything this test
// constructs — proving normalization runs INSIDE the builder, not as a courtesy at some call site.
function captureQuery(sink: unknown[]) {
  return ({ prompt }: { prompt: AsyncIterable<{ uuid: string; message: { content: unknown } }> }) => (async function* () {
    for await (const t of prompt) {
      sink.push(t.message.content);
      yield { type: "result", subtype: "success", is_error: false, result: "ok", user_message_uuid: t.uuid, session_id: "sid", uuid: "r1" };
    }
  })();
}

describe("Session.submit — the builder normalizes regardless of caller (library-bypass, closed)", () => {
  it("an array prompt is normalized at the message builder: a violating block degrades on the wire", async () => {
    const captured: unknown[] = [];
    const session = new Session({ query: captureQuery(captured) as never }, {});
    const bad = imageBlock(fakePng(2001, 2001, 1_000));
    await session.submit([textBlock("hi"), bad]);
    await session.dispose();
    const wire = captured[0] as UserContentBlock[];
    expect(wire[0]).toEqual({ type: "text", text: "hi" });
    expect(wire[1].type).toBe("text");
    expect(asText(wire[1])).toContain("2001x2001");
  });
  it("string callers are completely untouched — content rides through as a plain string", async () => {
    const captured: unknown[] = [];
    const session = new Session({ query: captureQuery(captured) as never }, {});
    await session.submit("plain prompt");
    await session.dispose();
    expect(captured[0]).toBe("plain prompt");
  });
});

// =====================================================================================================
// Type-level scope-cut pins (plan Task 4, spec v3.1 acceptance 6). `harness.run`/`stream` WIDENED to
// `UserTurnInput` in F10 T-IMGREACH Task 3 (I2) — that pin is lifted; the array literal below is now a
// legitimate call, kept here as a positive type-level check rather than a `@ts-expect-error`. The
// daemon-connect and appserver turn/start surfaces are unchanged by Task 3 and stay string-only. These
// lines are never EXECUTED (the enclosing function is never called — only `tsc` reads it, via `npm run
// typecheck`); each remaining `@ts-expect-error` is itself the assertion: if the array literal below it
// ever stopped being a type error, `tsc` would fail on an "unused directive" instead, which is what
// makes this a real, enforced pin rather than a comment.
function _scopeCutTypePins(): void {
  const harness = null as unknown as Harness;
  void harness.run([{ type: "text", text: "hi" }]); // widened, F10 T-IMGREACH Task 3 (I2)

  const daemon = null as unknown as DaemonClient;
  // @ts-expect-error — daemon connect submit stays string-only (F9 T-IMAGE v3.1 scope cut).
  void daemon.submit("id", [{ type: "text", text: "hi" }], () => {});

  // The appserver's `turn/start` is the ONE surface that came back inside the scope line: spec
  // 2026-08-23 widens its `input` to the items union, so the pin here inverts from "this must not
  // typecheck" to "this must". The two above are untouched — the cut still holds for them.
  type TurnStartParams = z.infer<typeof turnStartParams>;
  const params: TurnStartParams = {
    threadId: "t",
    input: [{ type: "text", text: "hi" }, { type: "image", url: "data:image/png;base64,AAAA" }, { type: "localImage", path: "/tmp/a.png" }],
  };
  void params;
  // …and the union is still a UNION: a string is the overwhelmingly common turn and stays free.
  const stringParams: TurnStartParams = { threadId: "t", input: "hi" };
  void stringParams;
  // The item shapes are CLOSED — a fourth kind, or a field the schema never declared, is still a type
  // error, which is what keeps the widening from having quietly become `unknown[]`.
  const bad: TurnStartParams = {
    threadId: "t",
    // @ts-expect-error — `video` is not an input item kind (spec 2026-08-23 "Wire design").
    input: [{ type: "video", url: "data:video/mp4;base64,AAAA" }],
  };
  void bad;
}
void _scopeCutTypePins;

describe("scope-cut type pins (F9 T-IMAGE v3.1 acceptance 6)", () => {
  it("documents that the appserver turn schema and daemon connect stay string-only (harness.run/stream widened, F10 T-IMGREACH Task 3)", () => {
    // The actual enforcement is `_scopeCutTypePins`'s `@ts-expect-error` lines above, checked by
    // `npm run typecheck`; this runtime case exists only so the suite carries a visible assertion.
    expect(typeof _scopeCutTypePins).toBe("function");
  });
});

// =====================================================================================================
// F10 T-IMGREACH Task 1 (I1) — the stranding rule. probe 100 proved (A/C/D/E, all four reachable
// shapes) that a first turn with NO extractable text is absent from `listSessions()`/`getSessionInfo()`
// even though its transcript persists intact — a real, non-recoverable-by-the-UI ccx gesture ("paste a
// screenshot, press enter") stays permanently unfindable. `normalizeTurnInput` is the one seam every
// shape passes through, so it is where the label goes in.
//
// A real 1x1 transparent PNG (68 bytes decoded) — genuinely decodable, well under every cap, so these
// cells exercise the stranding rule in isolation rather than accidentally tripping a degrade check.
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const img = (data = PNG_1X1) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }) as const;

describe("syntheticImageLabel", () => {
  it("numbers ordinals from 1, joined by a single space — imageChipLabel's own form", () => {
    expect(syntheticImageLabel(1)).toBe("[Image #1]");
    expect(syntheticImageLabel(3)).toBe("[Image #1] [Image #2] [Image #3]");
  });
});

describe("isStrandedTurn", () => {
  it("false for text-only input — nothing to strand", () => {
    expect(isStrandedTurn([textBlock("hi")])).toBe(false);
  });
  it("false for an image alongside non-empty text", () => {
    expect(isStrandedTurn([textBlock("look"), imageBlock(fakePng(4, 4, 40))])).toBe(false);
  });
  it("true for an image with no text block at all", () => {
    expect(isStrandedTurn([imageBlock(fakePng(4, 4, 40))])).toBe(true);
  });
  it("true for an image with only an empty text block", () => {
    expect(isStrandedTurn([textBlock(""), imageBlock(fakePng(4, 4, 40))])).toBe(true);
  });
  it("false for an all-text array — no image present, so never stranded", () => {
    expect(isStrandedTurn([textBlock("")])).toBe(false);
  });
});

describe("normalizeTurnInput — I1 stranding rule", () => {
  it("I1: an image-only array (no text block at all) gets the label INSERTED at index 0", () => {
    const out = normalizeTurnInput([img()]) as UserContentBlock[];
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "text", text: "[Image #1]" });
    expect(out[1]!.type).toBe("image");
  });

  it("I1: an empty first text block is SUBSTITUTED, never doubled", () => {
    const out = normalizeTurnInput([{ type: "text", text: "" }, img()]) as UserContentBlock[];
    expect(out).toHaveLength(2);                       // no insertion — the slot already existed
    expect(out[0]).toEqual({ type: "text", text: "[Image #1]" });
  });

  it("I1: multi-image, no text — one label naming every image, at index 0", () => {
    const out = normalizeTurnInput([img(), img()]) as UserContentBlock[];
    expect(out[0]).toEqual({ type: "text", text: "[Image #1] [Image #2]" });
  });

  it("I1: a LATER non-empty text block still counts — nothing is substituted", () => {
    const out = normalizeTurnInput([{ type: "text", text: "" }, img(), { type: "text", text: "look" }]);
    expect(out).toEqual([{ type: "text", text: "" }, img(), { type: "text", text: "look" }]);
  });

  it("I1: an image that FAILED its caps already produced text, so the turn is not stranded", () => {
    const bad = { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("garbage").toString("base64") } } as const;
    const out = normalizeTurnInput([bad]) as UserContentBlock[];
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: "text", text: "[Image could not be processed: unreadable image data]" });
  });

  it("I1: a text-only array and a bare string are untouched", () => {
    expect(normalizeTurnInput("hi")).toBe("hi");
    expect(normalizeTurnInput([{ type: "text", text: "" }])).toEqual([{ type: "text", text: "" }]);
  });

  it("I1: the label form does not drift from the composer's chip label", async () => {
    const { imageChipLabel } = await import("../../src/tui/pasteChips.js");
    expect(syntheticImageLabel(2)).toBe(`${imageChipLabel(1)} ${imageChipLabel(2)}`);
  });
});

// =====================================================================================================
// F10 T-IMGREACH Task 2 (I2) — canonicalization + the shared caps + one output-accounting algorithm.

describe("I2: canonical base64 re-encode", () => {
  it("I2: a passing image's data is re-encoded canonically — padding/whitespace never survive", () => {
    const canonical = PNG_1X1; // 68-byte 1x1 PNG, canonical base64
    const noisy = canonical.replace(/(.{20})/g, "$1\n"); // same bytes, whitespace-padded
    const out = normalizeTurnInput([
      { type: "text", text: "x" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: noisy } },
    ]) as UserContentBlock[];
    expect((out[1] as any).source.data).toBe(canonical);
  });
});

describe("I2: MAX_IMAGES_PER_PROMPT binds at the normalizer", () => {
  it("20 pass, the 21st degrades", () => {
    const twenty = Array.from({ length: 20 }, () => img());
    expect((normalizeTurnInput([{ type: "text", text: "x" }, ...twenty]) as UserContentBlock[]).filter((b) => b.type === "image")).toHaveLength(20);
    const out = normalizeTurnInput([{ type: "text", text: "x" }, ...twenty, img()]) as UserContentBlock[];
    expect(out.filter((b) => b.type === "image")).toHaveLength(20);
    expect(out.at(-1)).toEqual({ type: "text", text: "[Image could not be processed: too many images in one turn (limit 20)]" });
  });

  it("the excess-images literal matches the client's own (no drift)", async () => {
    const src = await readFile(new URL("../../src/client/stagedSubmit.ts", import.meta.url), "utf8");
    expect(src).toContain("too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})");
  });
});

// -------------------------------------------------------------------------------------------------
const textBlocks = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "text", text: `b${i}` }) as const);

describe("I2: MAX_CONTENT_BLOCKS, cap−1 / cap / cap+1", () => {
  it("63 blocks pass untouched", () => { expect(normalizeTurnInput(textBlocks(63))).toHaveLength(63); });
  it("64 blocks pass untouched — the cap is inclusive", () => { expect(normalizeTurnInput(textBlocks(64))).toHaveLength(64); });
  it("65 blocks → 63 survivors + ONE sentinel = 64 out, never 2 fragments", () => {
    const out = normalizeTurnInput(textBlocks(65)) as UserContentBlock[];
    expect(out).toHaveLength(64);
    expect(out[62]).toEqual({ type: "text", text: "b62" });
    expect((out[63] as any).text).toMatch(/^\[\+2 more blocks dropped: /);
  });
  it("200 blocks still collapse to exactly one sentinel", () => {
    const out = normalizeTurnInput(textBlocks(200)) as UserContentBlock[];
    expect(out).toHaveLength(64);
    expect((out[63] as any).text).toMatch(/^\[\+137 more blocks dropped: /);
    expect((out[63] as any).text.length).toBeLessThanOrEqual(SENTINEL_TEXT_RESERVE);
  });
});

// -------------------------------------------------------------------------------------------------
const s = (n: number) => "x".repeat(n);

describe("I2: MAX_TOTAL_TEXT, cap−1 / cap / cap+1, string AND array form", () => {
  it("TRUNCATION_SUFFIX fits its reserve", () => { expect(TRUNCATION_SUFFIX.length).toBeLessThanOrEqual(TRUNCATION_SUFFIX_RESERVE); });

  it("a bare string at cap−1 / cap is untouched; cap+1 truncates to ceiling−suffix reserve", () => {
    expect(normalizeTurnInput(s(MAX_TOTAL_TEXT - 1))).toBe(s(MAX_TOTAL_TEXT - 1));
    expect(normalizeTurnInput(s(MAX_TOTAL_TEXT))).toBe(s(MAX_TOTAL_TEXT));
    const out = normalizeTurnInput(s(MAX_TOTAL_TEXT + 1)) as string;
    expect(out).toBe(s(MAX_TOTAL_TEXT - TRUNCATION_SUFFIX_RESERVE) + TRUNCATION_SUFFIX);
    expect(out.length).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
  });

  it("array text sums across blocks; truncation eats the LAST block first", () => {
    const out = normalizeTurnInput([{ type: "text", text: s(MAX_TOTAL_TEXT - 100) }, { type: "text", text: s(200) }]) as UserContentBlock[];
    expect((out[0] as any).text).toHaveLength(MAX_TOTAL_TEXT - 100); // untouched
    const total = out.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
    expect((out[1] as any).text.endsWith(TRUNCATION_SUFFIX)).toBe(true);
  });

  it("THE JOINT BOUNDARY — 65 blocks whose 63 survivors already sit at exactly the ceiling", () => {
    // 63 blocks summing to exactly MAX_TOTAL_TEXT, plus 2 more so a sentinel is emitted. Without the
    // reserved budgets the sentinel would push the output past the ceiling (round-3 F4).
    const per = Math.floor(MAX_TOTAL_TEXT / 63), rem = MAX_TOTAL_TEXT - per * 63;
    const blocks = Array.from({ length: 63 }, (_, i) => ({ type: "text", text: s(i === 0 ? per + rem : per) }) as const);
    const out = normalizeTurnInput([...blocks, { type: "text", text: "a" }, { type: "text", text: "b" }]) as UserContentBlock[];
    expect(out).toHaveLength(64);
    const total = out.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
    expect((out[63] as any).text).toMatch(/^\[\+2 more blocks dropped: /); // the sentinel survived intact
    expect((out[62] as any).text.endsWith(TRUNCATION_SUFFIX)).toBe(true); // the USER text gave, not it
  });

  it("images are never dropped by the text ceiling", () => {
    const out = normalizeTurnInput([{ type: "text", text: s(MAX_TOTAL_TEXT + 1) }, img()]) as UserContentBlock[];
    expect(out.filter((b) => b.type === "image")).toHaveLength(1);
  });
});

// =====================================================================================================
// Step 3b: THE NORMALIZER'S FULL BOUNDARY MATRIX — every cap this module owns, indexed off its own
// constant (plan-review r2 F-BOUNDS: a cap tested only on its rejecting side is a cap whose comparison
// operator is untested). No literal numbers: every row is derived from the exported constant, so a
// constant change moves the test with it.

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
/** A real, header-readable PNG of EXACTLY `totalBytes` decoded bytes: a genuine 1x1 `solidPng`, padded
 *  with a `tEXt` chunk sized to land on the exact target, so the byte-length cap under test is what
 *  fires (or doesn't) rather than "unreadable image data". */
function pngOfExactSize(totalBytes: number): Buffer {
  const base = solidPng(1);
  const CHUNK_OVERHEAD = 12; // tEXt framing: length(4) + type(4) + crc(4); data IS the padding
  const needed = totalBytes - base.length - CHUNK_OVERHEAD;
  if (needed < 0) throw new Error(`target ${totalBytes} smaller than the base PNG's own ${base.length} bytes`);
  const iendStart = base.length - 12; // IEND is always exactly 12 bytes: len(4)+type(4)+crc(4), no data
  const padded = Buffer.concat([base.subarray(0, iendStart), pngChunk("tEXt", Buffer.alloc(needed, 0x20)), base.subarray(iendStart)]);
  if (padded.length !== totalBytes) throw new Error(`padding arithmetic off: got ${padded.length}, wanted ${totalBytes}`);
  return padded;
}
function imageBlockOfDecodedBytes(n: number): UserContentBlock { return imageBlock(pngOfExactSize(n)); }
/** A base64 STRING of EXACTLY `n` characters that still decodes to a tiny, fully-legal 1x1 PNG: grown
 *  with trailing NEWLINE filler, which the canonicalization cell above already proves the decoder
 *  ignores — so only the base64 STRING-LENGTH check (`data.length`, before decode) can be what fires. */
function imageBlockOfBase64Length(n: number): UserContentBlock {
  if (n < PNG_1X1.length) throw new Error(`target ${n} shorter than the base image's own base64 length ${PNG_1X1.length}`);
  return { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 + "\n".repeat(n - PNG_1X1.length) } };
}

describe("I2 boundary matrix — fixture guard", () => {
  it("imageBlockOfDecodedBytes produces a block that actually validates (the byte cap fires, not a header error)", () => {
    const r = validateImageBlock(imageBlockOfDecodedBytes(1000) as UserContentBlock & { type: "image" });
    expect(r.ok).toBe(true);
  });
});

const survives = (out: UserContentBlock[]) => out.some((b) => b.type === "image");
const failureText = (out: UserContentBlock[]) =>
  out.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");

describe.each([
  // ── source base64 STRING length. Trailing-newline filler is padding-safe: only the LENGTH check
  //    can be what fires; reason must name THIS limit, not a later one.
  { name: "MAX_BASE64_INPUT_BYTES", cap: MAX_BASE64_INPUT_BYTES,
    mk: (n: number) => [imageBlockOfBase64Length(n)], reasonAtOver: /base64 input exceeds/ },
  // ── decoded bytes of ONE image
  { name: "POST_PROCESS_BYTE_BUDGET", cap: POST_PROCESS_BYTE_BUDGET,
    mk: (n: number) => [imageBlockOfDecodedBytes(n)], reasonAtOver: /image data exceeds/ },
  // ── declared PIXEL dimension on the long side (real PNG headers, probe-113 pattern)
  { name: "MAX_DIMENSION", cap: MAX_DIMENSION,
    mk: (n: number) => [imageBlock(solidPng(n))], reasonAtOver: /exceed the .*px limit/ },
])("I2 boundary: $name", ({ cap, mk, reasonAtOver }) => {
  it.each(triple(cap))("$label", ({ at, passes }) => {
    const out = normalizeTurnInput(mk(at)) as UserContentBlock[];
    expect(survives(out)).toBe(passes);
    if (!passes) expect(failureText(out)).toMatch(reasonAtOver);
  });
});

it.each(triple(MAX_AGGREGATE_BYTES))("I2 boundary: MAX_AGGREGATE_BYTES $label", ({ at, passes }) => {
  // EVERY image in this row must be INDIVIDUALLY LEGAL, or the aggregate cap is never what fires
  // (re-review r3): two images of `at/2` are ~2.5 MiB each and trip POST_PROCESS_BYTE_BUDGET (512,000)
  // first, so the cap+1 row would go red for the wrong reason and cap−1/cap could not retain both.
  // Distribute instead: N images at exactly the per-image budget, plus one residual that carries the
  // ±1. At MAX_AGGREGATE_BYTES = 5,242,880 and POST_PROCESS_BYTE_BUDGET = 512,000 that is ten full
  // images (5,120,000 B) + a residual of 122,879 / 122,880 / 122,881 — all eleven under the per-image
  // budget, and eleven is inside MAX_IMAGES_PER_PROMPT (20). Derived, never typed as literals.
  const full = Math.floor(MAX_AGGREGATE_BYTES / POST_PROCESS_BYTE_BUDGET); // 10
  const residual = at - full * POST_PROCESS_BYTE_BUDGET; // 122,879 / 122,880 / 122,881
  expect(residual).toBeGreaterThan(0);
  expect(residual).toBeLessThanOrEqual(POST_PROCESS_BYTE_BUDGET); // guard: the row is legal per-image
  // A leading text block, same reason as elsewhere in this suite: an all-image array with no text is
  // I1's "stranded turn" shape and would otherwise pick up a synthetic `[Image #N]` label, which is not
  // what this cell is testing — "nothing else fired" means nothing beyond this marker.
  const blocks: UserContentBlock[] = [
    { type: "text", text: "x" },
    ...Array.from({ length: full }, () => imageBlockOfDecodedBytes(POST_PROCESS_BYTE_BUDGET)),
    imageBlockOfDecodedBytes(residual),
  ];
  const out = normalizeTurnInput(blocks) as UserContentBlock[];
  // The LAST block is the one that either fits or does not: the walk is in order and the running
  // total is only crossed by the residual.
  expect(out.filter((b) => b.type === "image")).toHaveLength(passes ? full + 1 : full);
  if (!passes) expect(failureText(out)).toMatch(/turn's total image size exceeds/);
  else expect(failureText(out)).toBe("x"); // nothing else fired
});

it.each(triple(MAX_IMAGES_PER_PROMPT))("I2 boundary: MAX_IMAGES_PER_PROMPT $label", ({ at, passes }) => {
  const out = normalizeTurnInput([{ type: "text", text: "x" }, ...Array.from({ length: at }, () => img())]) as UserContentBlock[];
  expect(out.filter((b) => b.type === "image")).toHaveLength(passes ? at : MAX_IMAGES_PER_PROMPT);
  if (!passes) expect(failureText(out)).toContain(`too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})`);
});

it.each(triple(MAX_CONTENT_BLOCKS))("I2 boundary: MAX_CONTENT_BLOCKS $label", ({ at, passes }) => {
  const out = normalizeTurnInput(textBlocks(at)) as UserContentBlock[];
  expect(out).toHaveLength(passes ? at : MAX_CONTENT_BLOCKS);
  // The sentinel reserves its OWN slot (round-3 F4): at cap+1, kept = cap−1 survivors, so the dropped
  // count is always 2 here (the one true overflow block PLUS the slot the sentinel itself displaced),
  // never 1 — matching the "65 blocks → +2 dropped" cells proven above under the same construction.
  if (!passes) expect((out.at(-1) as { text: string }).text).toMatch(/^\[\+2 more blocks dropped: /);
});

it.each(triple(MAX_TOTAL_TEXT))("I2 boundary: MAX_TOTAL_TEXT $label (bare string)", ({ at, passes }) => {
  const out = normalizeTurnInput("x".repeat(at)) as string;
  expect(out.length <= MAX_TOTAL_TEXT).toBe(true);
  expect(out.endsWith(TRUNCATION_SUFFIX)).toBe(!passes);
  if (passes) expect(out).toHaveLength(at);
});

it.each(triple(MAX_TOTAL_TEXT))("I2 boundary: MAX_TOTAL_TEXT $label (array form, summed)", ({ at, passes }) => {
  const half = Math.floor(at / 2);
  const out = normalizeTurnInput([{ type: "text", text: "x".repeat(half) }, { type: "text", text: "x".repeat(at - half) }]) as UserContentBlock[];
  const total = out.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
  expect(total).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
  expect((out.at(-1) as { text: string }).text.endsWith(TRUNCATION_SUFFIX)).toBe(!passes);
});

// =====================================================================================================
// Step 3c: the two new entry points share one implementation.

describe("I2: normalizeValidatedBlocks and validateImageBlock — the staged path shares one implementation", () => {
  it("normalizeValidatedBlocks == normalizeTurnInput minus the decode", () => {
    const blocks = [{ type: "text", text: "" }, img()] as UserContentBlock[];
    const pre = blocks.map((b) => (b.type === "image" ? (validateImageBlock(b) as { ok: true; block: UserContentBlock }).block! : b));
    expect(normalizeValidatedBlocks(pre)).toEqual(normalizeTurnInput(blocks));
  });

  it("normalizeValidatedBlocks does NOT decode — a block whose data is nonsense passes through", () => {
    // The staged path guarantees its blocks were already validated; this function must therefore not
    // re-check them. A cell that asserts the opposite would let an implementation re-decode and still pass.
    const bogus = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } } as const;
    expect(normalizeValidatedBlocks([{ type: "text", text: "x" }, bogus])).toEqual([{ type: "text", text: "x" }, bogus]);
  });

  // F10 fix-wave review finding P2 — the staged normalizer enforced MAX_CONTENT_BLOCKS/MAX_TOTAL_TEXT
  // (`applyOutputCaps`) but never MAX_IMAGES_PER_PROMPT: a stage reservation naming one completed stage
  // 21 times (`ImageStageRegistry.reserve` takes a bare array, no de-dup) sailed every one of those 21
  // blocks through `normalizeValidatedBlocks` untouched, despite the declared 20-image cap. Mirrors the
  // `normalizeTurnInput` boundary matrix above off the SAME constant.
  it.each(triple(MAX_IMAGES_PER_PROMPT))("MAX_IMAGES_PER_PROMPT binds here too: $label", ({ at, passes }) => {
    const blocks = [{ type: "text", text: "x" }, ...Array.from({ length: at }, () => img())] as UserContentBlock[];
    const out = normalizeValidatedBlocks(blocks);
    expect(out.filter((b) => b.type === "image")).toHaveLength(passes ? at : MAX_IMAGES_PER_PROMPT);
    if (!passes) {
      const text = out.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      expect(text).toContain(`too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})`);
    }
  });

  it("validateImageBlock returns the CANONICAL block and its decoded byte count", () => {
    const noisy = PNG_1X1.replace(/(.{20})/g, "$1\n");
    const r = validateImageBlock({ type: "image", source: { type: "base64", media_type: "image/png", data: noisy } });
    expect(r.ok).toBe(true);
    expect((r as any).block.source.data).toBe(PNG_1X1);
    expect((r as any).decodedBytes).toBe(Buffer.from(PNG_1X1, "base64").length);
  });
});
