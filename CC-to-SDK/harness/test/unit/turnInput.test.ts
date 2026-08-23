// harness/test/unit/turnInput.test.ts — F9 T-IMAGE Task 4 (I3a): UserTurnInput + the AUTHORITATIVE
// normalizer at the Session message-builder boundary (spec v3.1 "Authoritative validation lives at
// the Session message-builder boundary", plan Global Constraints + Task 4). Boundary cells sit at the
// EXACT values the plan names: 1999/2000/2001px dimensions, 5 MiB ± 1 base64 input, 512,000 ± 1
// decoded bytes, the per-turn aggregate ± one whole block — plus the header-decode "library-bypass"
// cell and the `Session.submit` seam proof that normalization cannot be skipped by any caller.
import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { z } from "zod/v4";
import {
  flattenForDisplay, assembleUserContent, normalizeTurnInput, syntheticImageLabel, isStrandedTurn,
  type UserContentBlock, type UserTurnInput,
} from "../../src/session/turnInput.js";
import { Session } from "../../src/session/session.js";
import type { Harness } from "../../src/harness.js";
import type { DaemonClient } from "../../src/daemon/connect.js";
import { turnStartParams } from "../../src/appserver/schema/turns.js";

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
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toBe(block);
  });
  it("passes a 2000x2000 image through untouched — AT the cap is not OVER it", () => {
    const block = imageBlock(solidPng(2000));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toBe(block);
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
  it("degrades data with no recognizable PNG/JPEG header at all", () => {
    const out = normalizeTurnInput([imageBlock(Buffer.from("not an image, just some bytes"))]) as UserContentBlock[];
    expect(out[0].type).toBe("text");
    expect(asText(out[0])).toBe("[Image could not be processed: unreadable image data]");
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
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toBe(block);
  });
  it("still passes one byte under (511,999)", () => {
    const block = imageBlock(fakePng(4, 4, 511_999));
    expect((normalizeTurnInput([textBlock("hi"), block]) as UserContentBlock[])[1]).toBe(block);
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
    blocks.forEach((b, i) => expect(out[i + 1]).toBe(b));
  });
  it("one more block (any size) pushes the running total over — THAT block degrades, the rest survive", () => {
    const sizes = [...atCapSizes, 24]; // the smallest legal block this file can build
    const blocks = sizes.map((n) => imageBlock(fakePng(4, 4, n)));
    const out = normalizeTurnInput(blocks) as UserContentBlock[];
    for (let i = 0; i < atCapSizes.length; i++) expect(out[i]).toBe(blocks[i]); // untouched
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
    expect(out[1]).toBe(good);
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
// Type-level scope-cut pins (plan Task 4, spec v3.1 acceptance 6): every non-REPL surface stays
// string-only. These lines are never EXECUTED (the enclosing function is never called — only `tsc`
// reads it, via `npm run typecheck`); each `@ts-expect-error` is itself the assertion: if the array
// literal below it ever stopped being a type error, `tsc` would fail on an "unused directive" instead,
// which is what makes this a real, enforced pin rather than a comment.
function _scopeCutTypePins(): void {
  const harness = null as unknown as Harness;
  // @ts-expect-error — harness.run/stream stay string-only (F9 T-IMAGE v3.1 scope cut).
  void harness.run([{ type: "text", text: "hi" }]);

  const daemon = null as unknown as DaemonClient;
  // @ts-expect-error — daemon connect submit stays string-only (F9 T-IMAGE v3.1 scope cut).
  void daemon.submit("id", [{ type: "text", text: "hi" }], () => {});

  type TurnStartParams = z.infer<typeof turnStartParams>;
  const params: TurnStartParams = {
    threadId: "t",
    // @ts-expect-error — the appserver turn/start schema's `input` stays string-only (v3.1 scope cut).
    input: [{ type: "text", text: "hi" }],
  };
  void params;
}
void _scopeCutTypePins;

describe("scope-cut type pins (F9 T-IMAGE v3.1 acceptance 6)", () => {
  it("documents that harness.run/stream, the appserver turn schema, and daemon connect stay string-only", () => {
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
