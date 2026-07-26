import { describe, expect, it } from "vitest";
import { decodeFrame, encodeEvent, encodeReply } from "../../src/host/wire.js";

describe("host wire", () => {
  it("a reply keeps the A1 top-level shape so a pre-upgrade client still parses it", () => {
    const line = encodeReply(undefined, { ok: true, state: "working", status: "busy" });
    const parsed = JSON.parse(line.trim());
    expect(parsed).toEqual({ ok: true, state: "working", status: "busy" });   // no `t`, no `id`
  });

  it("echoes the id when the request carried one", () => {
    expect(JSON.parse(encodeReply(7, { ok: true }).trim())).toEqual({ ok: true, id: 7 });
  });

  it("an event is discriminated and never mistaken for a reply", () => {
    const parsed = JSON.parse(encodeEvent({ kind: "state", status: { state: "blocked", status: "idle" } }).trim());
    expect(parsed.t).toBe("event");
    expect(parsed.kind).toBe("state");
  });

  it("every frame ends in exactly one newline", () => {
    for (const l of [encodeReply(1, { ok: true }), encodeEvent({ kind: "message", data: { a: 1 } })]) {
      expect(l.endsWith("\n")).toBe(true);
      expect(l.slice(0, -1)).not.toContain("\n");
    }
  });

  it("decodeFrame rejects junk rather than throwing", () => {
    expect(decodeFrame("not json")).toBeUndefined();
    expect(decodeFrame("[1,2,3]")).toBeUndefined();
    expect(decodeFrame(JSON.stringify({ t: "event", kind: "message", data: 1 }))?.t).toBe("event");
  });
});
