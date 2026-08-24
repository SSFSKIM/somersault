// test/unit/appserver/image-stage.test.ts — F10 T-IMGREACH Task 7 (I3a): the app-server image stage
// REGISTRY, unit-only (no schema, no handler, no wire — those are later tasks). Every cell constructs
// its OWN registry with an injected clock and a spy wrapping the real `validateImageBlock` (Task 2), so
// the validate-once contract is observable rather than inferred, and every deadline is deterministic.
import { describe, it, expect, vi } from "vitest";
import { validateImageBlock, MAX_BASE64_INPUT_BYTES, type UserContentBlock } from "../../../src/session/turnInput.js";
import {
  ImageStageRegistry,
  IMAGE_STAGE_CHUNK_MAX,
  IMAGE_MEDIA_TYPES,
  MAX_STAGES_PER_CONNECTION,
  MAX_STAGES_GLOBAL,
  MAX_STAGED_BYTES_GLOBAL,
  STAGE_IDLE_MS,
  STAGE_ABSOLUTE_MS,
  type ImageStageChunk,
} from "../../../src/appserver/imageStage.js";
import { triple } from "../boundaryTriple.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Two byte-distinct-but-still-header-valid PNGs: `pngDimensions` (imageDims.ts) reads only the first 24
// bytes (signature + IHDR), so appending a distinguishing tail to the same 1x1 base image is enough to
// give the ORDER test two blocks it can tell apart without hand-building real pixel data.
const PNG_RED = Buffer.concat([Buffer.from(PNG_1X1, "base64"), Buffer.from("RED-TAIL")]).toString("base64");
const PNG_BLUE = Buffer.concat([Buffer.from(PNG_1X1, "base64"), Buffer.from("BLUE-TAIL")]).toString("base64");

function harness() {
  let t = 0;
  const decodes: UserContentBlock[] = [];
  const validate = vi.fn((b: any) => { decodes.push(b); return validateImageBlock(b); });
  const reg = new ImageStageRegistry({ now: () => t, validate });
  return { reg, validate, decodes, advance: (ms: number) => { t += ms; }, at: () => t };
}
const chunkOf = (data: string, over: Partial<ImageStageChunk> = {}): ImageStageChunk =>
  ({ stageId: "s1", seq: 0, last: true, bytesTotal: data.length, mediaType: "image/png", data, ...over });

// Fills the registry to EXACTLY `target` staged base64 bytes, spreading the load across as many
// synthetic connections/stages as MAX_STAGES_PER_CONNECTION/MAX_STAGES_GLOBAL require so the byte cap
// is the ONLY thing that can refuse the final chunk. Every stage stays incomplete (`last: false`) —
// this test only cares about bytes held in memory, not decoding. Returns whether the chunk that
// reached `target` was accepted (mirrors `triple()`'s `passes`).
function fillToBytes(reg: ImageStageRegistry, target: number): boolean {
  const STAGE_CAP = MAX_BASE64_INPUT_BYTES; // largest one stage's declared bytesTotal may be
  let staged = 0;
  let connId = 0;
  let stagesOnConn = 0;
  let stageOrdinal = 0;
  let lastOk = true;
  while (staged < target) {
    if (stagesOnConn >= MAX_STAGES_PER_CONNECTION) { connId++; stagesOnConn = 0; }
    const thisStageBytes = Math.min(STAGE_CAP, target - staged);
    const stageId = `fill-${stageOrdinal++}`;
    let sent = 0;
    let seq = 0;
    while (sent < thisStageBytes) {
      const size = Math.min(IMAGE_STAGE_CHUNK_MAX, thisStageBytes - sent);
      const r = reg.chunk(connId, {
        stageId, seq, last: false, bytesTotal: thisStageBytes,
        mediaType: seq === 0 ? "image/png" : undefined,
        data: "A".repeat(size),
      });
      lastOk = r.ok;
      if (!r.ok) return false;
      sent += size;
      seq++;
    }
    staged += thisStageBytes;
    stagesOnConn++;
  }
  return lastOk;
}

describe("I3a: chunk assembly and completion", () => {
  it("ordered chunks assemble into the exact original base64; completion replies complete:true", () => {
    const { reg } = harness();
    const mid = Math.floor(PNG_1X1.length / 2);
    const r1 = reg.chunk(1, chunkOf(PNG_1X1.slice(0, mid), { seq: 0, last: false, bytesTotal: PNG_1X1.length }));
    expect(r1).toEqual({ ok: true, complete: false });
    const r2 = reg.chunk(1, chunkOf(PNG_1X1.slice(mid), { seq: 1, last: true, bytesTotal: PNG_1X1.length }));
    expect(r2).toEqual({ ok: true, complete: true });
    const res = reg.reserve(1, ["s1"]);
    expect(res.ok).toBe(true);
    expect((res as any).reservation.blocks[0].source.data).toBe(PNG_1X1);
  });

  it("a duplicate seq is refused", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1, { last: false, bytesTotal: PNG_1X1.length + 4 }));
    const dup = reg.chunk(1, chunkOf("AAAA", { seq: 0, last: true, bytesTotal: PNG_1X1.length + 4 }));
    expect(dup).toMatchObject({ ok: false });
  });

  it("an out-of-order seq is refused", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1, { last: false, bytesTotal: PNG_1X1.length + 8 }));
    const skip = reg.chunk(1, chunkOf("AAAA", { seq: 2, last: true, bytesTotal: PNG_1X1.length + 8 }));
    expect(skip).toMatchObject({ ok: false });
  });

  it("a missing `last` leaves the stage incomplete and unreservable, naming the incomplete stage", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1, { last: false, bytesTotal: PNG_1X1.length }));
    const r = reg.reserve(1, ["s1"]);
    expect(r).toMatchObject({ ok: false });
    expect((r as any).message).toMatch(/s1/);
  });

  it("assembled bytes exceeding bytesTotal are refused", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf("AAAAAA", { last: false, bytesTotal: 10 }));
    const over = reg.chunk(1, chunkOf("AAAAAA", { seq: 1, last: true, bytesTotal: 10 }));
    expect(over).toMatchObject({ ok: false });
  });

  it("a missing mediaType on seq 0 is refused", () => {
    const { reg } = harness();
    const r = reg.chunk(1, chunkOf(PNG_1X1, { mediaType: undefined }));
    expect(r).toMatchObject({ ok: false });
  });

  it("a mediaType outside IMAGE_MEDIA_TYPES is refused", () => {
    const { reg } = harness();
    const r = reg.chunk(1, chunkOf(PNG_1X1, { mediaType: "image/gif" }));
    expect(r).toMatchObject({ ok: false });
    expect(IMAGE_MEDIA_TYPES).not.toContain("image/gif");
  });

  it("a mediaType on a later chunk is ignored — the first chunk's is authoritative", () => {
    const { reg } = harness();
    const mid = Math.floor(PNG_1X1.length / 2);
    reg.chunk(1, chunkOf(PNG_1X1.slice(0, mid), { last: false, bytesTotal: PNG_1X1.length }));
    reg.chunk(1, chunkOf(PNG_1X1.slice(mid), { seq: 1, last: true, bytesTotal: PNG_1X1.length, mediaType: "image/jpeg" }));
    const r = reg.reserve(1, ["s1"]);
    expect((r as any).reservation.blocks[0].source.media_type).toBe("image/png");
  });

  it("a stage whose assembled bytes are not a decodable image fails at completion, and its slot is freed", () => {
    const { reg, validate } = harness();
    const r = reg.chunk(1, chunkOf(Buffer.from("not a real image").toString("base64")));
    expect(r).toMatchObject({ ok: false });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(reg.stats().stageCount).toBe(0);
  });

  it("dropConnection deletes that connection's stages and releases their bytes", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1, { stageId: "a" }));
    reg.chunk(1, chunkOf(PNG_1X1, { stageId: "b" }));
    expect(reg.stats().stagedBytes).toBeGreaterThan(0);
    reg.dropConnection(1);
    expect(reg.stats()).toMatchObject({ stagedBytes: 0, stageCount: 0, connections: 0 });
  });
});

describe("I3a: validate-once and the reservation lifecycle", () => {
  it("I3a: a completed stage is validated EXACTLY ONCE, at completion — reservations reuse the cache", () => {
    const { reg, validate } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    expect(validate).toHaveBeenCalledTimes(1);

    const a = reg.reserve(1, ["s1"]); expect(a.ok).toBe(true);
    reg.abort((a as any).reservation.token);
    const b = reg.reserve(1, ["s1"]); expect(b.ok).toBe(true);
    reg.abort((b as any).reservation.token);
    const c = reg.reserve(1, ["s1"]); reg.commit((c as any).reservation.token);

    expect(validate).toHaveBeenCalledTimes(1);          // three reservations, still ONE decode
  });

  it("I3a: a reservation is EXCLUSIVE — a second reserve of the same stage fails while the first is open", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    const first = reg.reserve(1, ["s1"]);
    expect(reg.reserve(1, ["s1"])).toMatchObject({ ok: false });
    expect(reg.stats().reservedCount).toBe(1);
    reg.abort((first as any).reservation.token);
    expect(reg.reserve(1, ["s1"]).ok).toBe(true);       // released, back in circulation
  });

  it("I3a: abort RESTORES the stage with its original deadlines — it does not restart the clock", () => {
    const { reg, advance } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    advance(STAGE_IDLE_MS - 1);
    const r = reg.reserve(1, ["s1"]);
    reg.abort((r as any).reservation.token);
    advance(2); reg.sweep();
    expect(reg.reserve(1, ["s1"])).toMatchObject({ ok: false });   // idle deadline still applied
  });

  it("I3a: a RESERVED stage is not swept out from under its holder", () => {
    const { reg, advance } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    const r = reg.reserve(1, ["s1"]);
    advance(STAGE_ABSOLUTE_MS + 1); reg.sweep();
    expect(reg.stats().reservedCount).toBe(1);
    reg.commit((r as any).reservation.token);                       // the turn it belongs to still completes
    expect(reg.stats()).toMatchObject({ stageCount: 0, stagedBytes: 0, reservedCount: 0 });
  });

  it("I3a: ATOMIC — reserving [a, expired-b] takes NEITHER, and `a` is still reservable", () => {
    const { reg, advance } = harness();
    reg.chunk(1, chunkOf(PNG_1X1, { stageId: "a" }));
    advance(STAGE_IDLE_MS + 1);
    reg.chunk(1, chunkOf(PNG_1X1, { stageId: "b" }));
    reg.sweep();                                                     // `a` is gone, `b` is fresh
    expect(reg.reserve(1, ["b", "a"])).toMatchObject({ ok: false });
    expect(reg.reserve(1, ["b"]).ok).toBe(true);                     // nothing was taken by the failed call
  });

  it("F10-T7 fix: dropConnection purges reservations opened on that connection, not just their stage entries", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    const r = reg.reserve(1, ["s1"]);
    expect(r.ok).toBe(true);
    expect(reg.stats().reservationCount).toBe(1);
    reg.dropConnection(1);
    expect(reg.stats().reservationCount).toBe(0);          // no leaked ReservationRecord for the dead connection
    expect(() => reg.commit((r as any).reservation.token)).toThrow();  // token is truly dead, not just its stages
  });

  it("I3a: commit releases the bytes; abort does not", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    const before = reg.stats().stagedBytes;
    const r = reg.reserve(1, ["s1"]);
    reg.abort((r as any).reservation.token);
    expect(reg.stats().stagedBytes).toBe(before);
    const r2 = reg.reserve(1, ["s1"]);
    reg.commit((r2 as any).reservation.token);
    expect(reg.stats().stagedBytes).toBe(0);
  });

  it("I3a: `blocks` come back in the ORDER THE IDS WERE GIVEN, not insertion order", () => {
    const { reg } = harness();
    reg.chunk(1, chunkOf(PNG_RED, { stageId: "x" }));
    reg.chunk(1, chunkOf(PNG_BLUE, { stageId: "y" }));
    const r = reg.reserve(1, ["y", "x"]);
    const data = (r as any).reservation.blocks.map((b: any) => b.source.data);
    expect(data).toEqual([PNG_BLUE, PNG_RED]);
  });
});

describe("I3a: the full cap boundary matrix", () => {
  it.each(triple(IMAGE_STAGE_CHUNK_MAX))("I3a boundary: chunk data length $label", ({ at, passes }) => {
    const { reg } = harness();
    const r = reg.chunk(1, chunkOf("A".repeat(at), { last: false, bytesTotal: MAX_BASE64_INPUT_BYTES }));
    expect(r.ok).toBe(passes);
    if (!passes) expect(reg.stats().stagedBytes).toBe(0);            // refused BEFORE retention
  });

  it.each(triple(MAX_BASE64_INPUT_BYTES))("I3a boundary: bytesTotal $label", ({ at, passes }) => {
    const { reg } = harness();
    const r = reg.chunk(1, chunkOf("A".repeat(16), { last: false, bytesTotal: at }));
    expect(r.ok).toBe(passes);
    if (!passes) expect(reg.stats().stagedBytes).toBe(0);            // refused on the FIRST chunk
  });

  it.each(triple(MAX_STAGES_PER_CONNECTION))("I3a boundary: stages on ONE connection $label", ({ at, passes }) => {
    const { reg } = harness();
    const results = Array.from({ length: at }, (_, i) => reg.chunk(1, chunkOf(PNG_1X1, { stageId: `s${i}` })));
    expect(results.every((r) => r.ok)).toBe(passes);
    expect(reg.stats().stageCount).toBe(Math.min(at, MAX_STAGES_PER_CONNECTION));
  });

  it.each(triple(MAX_STAGES_GLOBAL))("I3a boundary: stages across DIFFERENT connections $label", ({ at, passes }) => {
    // one stage per connection: a per-connection-only implementation passes every row and MUST fail here
    const { reg } = harness();
    const results = Array.from({ length: at }, (_, i) => reg.chunk(i, chunkOf(PNG_1X1)));
    expect(results.every((r) => r.ok)).toBe(passes);
  });

  it.each(triple(MAX_STAGED_BYTES_GLOBAL))("I3a boundary: total staged bytes $label", ({ at, passes }) => {
    // fill with whole chunks from distinct connections until the last one crosses `at`
    const { reg } = harness();
    expect(fillToBytes(reg, at)).toBe(passes);
  });

  it.each(triple(STAGE_IDLE_MS))("I3a boundary: idle expiry at $label ms since the last chunk", ({ at, passes }) => {
    const { reg, advance } = harness();
    reg.chunk(1, chunkOf(PNG_1X1));
    advance(at); reg.sweep();
    expect(reg.reserve(1, ["s1"]).ok).toBe(passes);
  });

  it.each(triple(STAGE_ABSOLUTE_MS))("I3a boundary: absolute expiry at $label ms since the FIRST chunk", ({ at, passes }) => {
    // fed a chunk every 30 s so it never goes idle — the held-open-abandoned shape
    const { reg, advance } = harness();
    reg.chunk(1, chunkOf("A".repeat(16), { last: false, bytesTotal: 4096 }));
    for (let seq = 1, elapsed = 0; elapsed + 30_000 <= at; seq++, elapsed += 30_000) {
      advance(30_000);
      reg.chunk(1, chunkOf("A".repeat(16), { seq, last: false, bytesTotal: 4096 }));
    }
    advance(at % 30_000); reg.sweep();
    expect(reg.stats().stageCount).toBe(passes ? 1 : 0);
  });
});
