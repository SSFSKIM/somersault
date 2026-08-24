// test/unit/appserver/dynamic-calls.test.ts — M7 Task 3: the parked-call registry and the result
// conversion. Both halves are PURE — no wire, no server, no engine — which is the point: everything a
// dynamic tool call's lifetime can do is decided here, and Task 4 only has to carry the verdicts.
//
// WHAT THIS FILE PINS.
//
//   THE CALLBACK ALWAYS ANSWERS (D-M4-9). A dynamic tool call is a promise the MODEL is blocked on. Every
//   exit — a client's result, an abort, a reopen, a thread close, a teardown that happened before the park
//   even arrived — has to resolve it, and the cancelled ones resolve with a note naming WHY, because that
//   note is the only thing the model ever learns about the cancellation. A row here for each exit.
//
//   THE callId IS THE AUTHORITY, SO IT IS OPAQUE. `tool/callResult` refuses non-subscribers, but the second
//   belt is that a callId cannot be GUESSED: `dyncall:<randomUUID()>`. The shape row asserts the UUID, and
//   the discrimination rows assert what a wrong id gets told — `unknown` for one that never existed,
//   `alreadySettled` for one this registry really did settle. That difference is a real client's retry
//   logic (retry vs. give up), and the tombstone ring is what preserves it; the 130-call row pins the ring
//   size AND pins what happens past it (the oldest degrades to `unknown`, never to a false `ok`).
//
//   THE CAPS SETTLE, THEY DO NOT REFUSE (plan Global Constraints). An over-cap result is a bad ANSWER, not
//   a bad REQUEST: `toCallResult` turns it into an `isError` result naming the cap, so the model is told
//   its tool misbehaved and the call is gone from the registry. A -32602 would leave the call parked
//   forever. Which is also why `toCallResult` may never throw, and why the last row of that block feeds it
//   something the type system says is impossible.
//
//   BYTES, NOT CHARACTERS. The result budget is UTF-8 bytes of the EMITTED blocks. The Hangul row is the
//   regression guard: 60_000 characters is well under any character-shaped cap and 180_000 bytes is well
//   over the real one, and both numbers are asserted against `Buffer.byteLength` in the row itself so a
//   cap that drifts cannot take the fixture with it.
import { describe, it, expect } from "vitest";
import {
  DynamicCalls,
  cancelledCallResult,
  type CallToolResultLike,
  type DynamicCallEvent,
  type PendingToolCall,
  type ToolCallContentItem,
} from "../../../src/appserver/dynamicCalls.js";
import { toCallResult, MAX_RESULT_ITEMS, MAX_RESULT_PAYLOAD_BYTES } from "../../../src/appserver/dynamicTools.js";
import { parseDataUrl, MAX_DATA_URL_CHARS } from "../../../src/appserver/turnItems.js";

/** The registry plus the event tape its owner (Task 4's server) would be broadcasting from. */
function harness() {
  const events: DynamicCallEvent[] = [];
  const calls = new DynamicCalls((ev) => events.push(ev));
  return { calls, events };
}

const CALL: Omit<PendingToolCall, "callId"> = {
  threadId: "th_1",
  turnId: "turn_1",
  namespace: "ops",
  tool: "lookup",
  arguments: { q: "x" },
  epoch: 1,
};

const OK: CallToolResultLike = { content: [{ type: "text", text: "done" }], isError: false };

/** `dyncall:` + a v4 UUID, asserted in full: the opacity claim is the settlement belt. */
const CALL_ID = /^dyncall:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The one callId a `park()` just minted (the `requested` event is emitted synchronously). */
function mintedId(events: DynamicCallEvent[]): string {
  const last = events[events.length - 1];
  if (last?.kind !== "requested") throw new Error(`expected a requested event, saw ${JSON.stringify(last)}`);
  return last.entry.callId;
}

/** Has this promise settled yet? Two macrotask turns, so a settle scheduled anywhere in microtask-land has
 *  run — the epoch-belt row needs "still parked" to mean something stronger than "not yet this tick". */
async function settledYet(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return done;
}

const noteOf = (result: CallToolResultLike): string => String(result.content[0]?.text ?? "");

describe("DynamicCalls — park, answer, discriminate", () => {
  it("parks with an opaque callId, announces it, and resolves with the client's own result", async () => {
    const { calls, events } = harness();
    const settled = calls.park(CALL);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("requested");
    const callId = mintedId(events);
    expect(callId).toMatch(CALL_ID);
    expect(calls.pending()).toEqual([{ ...CALL, callId }]);

    expect(calls.respond(callId, 1, OK)).toEqual({ ok: true });
    await expect(settled).resolves.toEqual(OK);
    // A client's answer carries no reason — the answer was the client's own (Task 4's widened event).
    expect(events[1]).toEqual({ kind: "settled", callId, outcome: "answered" });
    expect(calls.pending()).toEqual([]);
  });

  it("mints a distinct id per park and lists both", () => {
    const { calls, events } = harness();
    void calls.park(CALL);
    const first = mintedId(events);
    void calls.park({ ...CALL, tool: "other" });
    const second = mintedId(events);

    expect(first).not.toBe(second);
    expect(calls.pending().map((e) => e.callId)).toEqual([first, second]);
    expect(calls.pending().map((e) => e.tool)).toEqual(["lookup", "other"]);
    calls.teardown("test");
  });

  it("first answer wins; the second is alreadySettled and cannot overwrite it", async () => {
    const { calls, events } = harness();
    const settled = calls.park(CALL);
    const callId = mintedId(events);

    expect(calls.respond(callId, 1, OK)).toEqual({ ok: true });
    expect(calls.respond(callId, 1, { content: [{ type: "text", text: "late" }] })).toEqual({
      ok: false,
      code: "alreadySettled",
    });
    await expect(settled).resolves.toEqual(OK);
    // ONE settled event for one settlement — a second emit would unpair the wire's notifications.
    expect(events.filter((e) => e.kind === "settled")).toHaveLength(1);
  });

  it("a callId this registry never minted is unknown, not alreadySettled", () => {
    const { calls } = harness();
    expect(calls.respond("dyncall:00000000-0000-4000-8000-000000000000", 1, OK)).toEqual({
      ok: false,
      code: "unknown",
    });
  });

  it("the 128-deep tombstone ring keeps the recent settlements and degrades the evicted to unknown", () => {
    const { calls, events } = harness();
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      void calls.park({ ...CALL, tool: `t${i}` });
      const id = mintedId(events);
      ids.push(id);
      expect(calls.respond(id, 1, OK)).toEqual({ ok: true });
    }
    // 130 settled, 128 remembered: ids[2..129] are still discriminable, ids[0] and ids[1] fell off.
    expect(calls.respond(ids[0], 1, OK)).toEqual({ ok: false, code: "unknown" });
    expect(calls.respond(ids[1], 1, OK)).toEqual({ ok: false, code: "unknown" });
    expect(calls.respond(ids[2], 1, OK)).toEqual({ ok: false, code: "alreadySettled" });
    expect(calls.respond(ids[128], 1, OK)).toEqual({ ok: false, code: "alreadySettled" });
    expect(calls.respond(ids[129], 1, OK)).toEqual({ ok: false, code: "alreadySettled" });
  });

  it("answering across an epoch boundary is refused and leaves the call parked for the swap's reset", async () => {
    const { calls, events } = harness();
    const settled = calls.park(CALL);            // epoch 1
    const callId = mintedId(events);

    expect(calls.respond(callId, 2, OK)).toEqual({ ok: false, code: "alreadySettled" });
    expect(await settledYet(settled)).toBe(false);
    expect(calls.pending()).toHaveLength(1);
    // The belt only refuses the STALE answer; the live entry is still answerable on its own epoch.
    expect(calls.respond(callId, 1, OK)).toEqual({ ok: true });
    await expect(settled).resolves.toEqual(OK);
  });
});

describe("DynamicCalls — every exit answers the model", () => {
  it("a pre-aborted signal resolves cancelled without ever parking", async () => {
    const { calls, events } = harness();
    const ctrl = new AbortController();
    ctrl.abort();

    // An `abort` listener on an already-aborted signal never fires, so the guard's absence is a park that
    // hangs forever — asserted as "already settled" so that reads as a failure rather than as a timeout.
    const settled = calls.park(CALL, ctrl.signal);
    expect(await settledYet(settled)).toBe(true);
    await expect(settled).resolves.toEqual(cancelledCallResult("aborted"));
    expect(events).toEqual([]);                  // nothing was announced, because nothing parked
    expect(calls.pending()).toEqual([]);
  });

  it("an abort mid-park settles the parked call and closes it to later answers", async () => {
    const { calls, events } = harness();
    const ctrl = new AbortController();
    const settled = calls.park(CALL, ctrl.signal);
    const callId = mintedId(events);

    ctrl.abort();
    const result = await settled;
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toBe("Tool call cancelled: aborted");
    // A cancellation names its reason — the same string the model was handed, so a consumer of the event
    // and a consumer of the result learn the same fact (Task 4's widened event).
    expect(events[1]).toEqual({ kind: "settled", callId, outcome: "cancelled", reason: "aborted" });
    expect(calls.pending()).toEqual([]);
    expect(calls.respond(callId, 1, OK)).toEqual({ ok: false, code: "alreadySettled" });
  });

  it("reset settles everything parked with its reason and does NOT latch", async () => {
    const { calls, events } = harness();
    const first = calls.park(CALL);
    const second = calls.park({ ...CALL, tool: "other" });

    calls.reset("thread reopened");
    expect(noteOf(await first)).toBe("Tool call cancelled: thread reopened");
    expect(noteOf(await second)).toBe("Tool call cancelled: thread reopened");
    expect((await first).isError).toBe(true);
    expect(events.filter((e) => e.kind === "settled")).toEqual([
      { kind: "settled", callId: expect.stringMatching(CALL_ID), outcome: "cancelled", reason: "thread reopened" },
      { kind: "settled", callId: expect.stringMatching(CALL_ID), outcome: "cancelled", reason: "thread reopened" },
    ]);
    expect(calls.pending()).toEqual([]);

    // The whole distinction from teardown: the replacement engine's very next call parks for real.
    const after = calls.park(CALL);
    expect(calls.pending()).toHaveLength(1);
    expect(calls.respond(mintedId(events), 1, OK)).toEqual({ ok: true });
    await expect(after).resolves.toEqual(OK);
  });

  it("a throwing emit cannot strand the rest of reset's loop", async () => {
    // The owner's broadcast guards each notify individually, so this cannot happen through the shipped
    // wiring — but a registry whose D-M4-9 guarantee (every exit answers the model) rests on somebody
    // else's guard has a hang one refactor away, and an unanswered call after `teardown` can never be
    // rescued by anything.
    const events: DynamicCallEvent[] = [];
    const calls = new DynamicCalls((ev) => { events.push(ev); if (ev.kind === "settled") throw new Error("subscriber blew up"); });
    const first = calls.park(CALL);
    const second = calls.park({ ...CALL, tool: "other" });

    calls.reset("engine swapped");
    expect(await settledYet(second)).toBe(true);
    expect(noteOf(await first)).toBe("Tool call cancelled: engine swapped");
    expect(noteOf(await second)).toBe("Tool call cancelled: engine swapped");
    expect(calls.pending()).toEqual([]);
  });

  it("teardown settles, latches, and answers a later park immediately with the same reason", async () => {
    const { calls, events } = harness();
    const parked = calls.park(CALL);

    calls.teardown("thread closed");
    expect(noteOf(await parked)).toBe("Tool call cancelled: thread closed");
    const announced = events.length;

    // A late engine callback after close must not park with nobody left to answer it. Asserted as
    // "already settled", not just "settles eventually" — an unlatched teardown parks it forever, and a
    // bare `await` would pin that as a 120s timeout instead of a failure.
    const late = calls.park({ ...CALL, tool: "late" });
    expect(await settledYet(late)).toBe(true);
    expect(noteOf(await late)).toBe("Tool call cancelled: thread closed");
    expect((await late).isError).toBe(true);
    expect(calls.pending()).toEqual([]);
    expect(events).toHaveLength(announced);      // nothing announced: nothing was ever requested
  });

  it("cancelledCallResult is the one cancelled shape, so Task 4's registry-free cancels match", () => {
    expect(cancelledCallResult("no active turn")).toEqual({
      content: [{ type: "text", text: "Tool call cancelled: no active turn" }],
      isError: true,
    });
  });
});

describe("toCallResult — the three kinds", () => {
  const pngUrl = "data:image/png;base64,AAAA";
  const wavUrl = "data:audio/wav;base64,BBBB";

  it("converts text, image and audio items into MCP blocks in declaration order", () => {
    const items: ToolCallContentItem[] = [
      { type: "inputText", text: "hello" },
      { type: "inputImage", imageUrl: pngUrl },
      { type: "inputAudio", audioUrl: wavUrl },
    ];
    expect(toCallResult(items, true)).toEqual({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "audio", data: "BBBB", mimeType: "audio/wav" },
      ],
      isError: false,
    });
  });

  it("success:false is the client's own error result, content intact", () => {
    const result = toCallResult([{ type: "inputText", text: "boom" }], false);
    expect(result).toEqual({ content: [{ type: "text", text: "boom" }], isError: true });
  });

  it("an empty item list is a legal empty result", () => {
    expect(toCallResult([], true)).toEqual({ content: [], isError: false });
  });
});

describe("toCallResult — the caps settle instead of refusing", () => {
  const text = (n: number, ch = "a"): ToolCallContentItem => ({ type: "inputText", text: ch.repeat(n) });

  it("accepts exactly the item cap and settles isError one over, naming it", () => {
    expect(toCallResult(Array.from({ length: MAX_RESULT_ITEMS }, () => text(1)), true).isError).toBe(false);

    const over = toCallResult(Array.from({ length: MAX_RESULT_ITEMS + 1 }, () => text(1)), true);
    expect(over.isError).toBe(true);
    expect(over.content).toHaveLength(1);
    expect(noteOf(over)).toContain(String(MAX_RESULT_ITEMS + 1));
    expect(noteOf(over)).toContain(String(MAX_RESULT_ITEMS));
  });

  it("budgets UTF-8 BYTES, not characters: 130_000 ASCII passes, 60_000 Hangul does not", () => {
    const ascii = "a".repeat(130_000);
    expect(Buffer.byteLength(ascii, "utf8")).toBe(130_000);
    expect(Buffer.byteLength(ascii, "utf8")).toBeLessThanOrEqual(MAX_RESULT_PAYLOAD_BYTES);
    expect(toCallResult([{ type: "inputText", text: ascii }], true).isError).toBe(false);

    const hangul = "가".repeat(60_000);
    expect(hangul.length).toBe(60_000);
    expect(Buffer.byteLength(hangul, "utf8")).toBe(180_000);
    expect(Buffer.byteLength(hangul, "utf8")).toBeGreaterThan(MAX_RESULT_PAYLOAD_BYTES);
    const over = toCallResult([{ type: "inputText", text: hangul }], true);
    expect(over.isError).toBe(true);
    expect(noteOf(over)).toContain("180000");
    expect(noteOf(over)).toContain(String(MAX_RESULT_PAYLOAD_BYTES));
  });

  it("counts a media block's data AND mimeType toward the same budget", () => {
    // 12 bytes of headroom, spent by an 8-character base64 payload plus the 9 bytes of "image/png". The
    // payload ALONE still fits — which is the whole assertion: a budget that forgot `mimeType` passes here.
    const filler = text(MAX_RESULT_PAYLOAD_BYTES - 12);
    expect(toCallResult([filler, text(8)], true).isError).toBe(false);

    const over = toCallResult([filler, { type: "inputImage", imageUrl: `data:image/png;base64,${"A".repeat(8)}` }], true);
    expect(over.isError).toBe(true);
    expect(noteOf(over)).toContain(String(MAX_RESULT_PAYLOAD_BYTES + 5));   // -12 + 8 + 9, measured
    expect(noteOf(over)).toContain(String(MAX_RESULT_PAYLOAD_BYTES));
  });
});

describe("toCallResult — malformed media settles, never throws", () => {
  it("refuses an image whose declared MIME is not image/*, naming the item index", () => {
    const result = toCallResult(
      [{ type: "inputText", text: "ok" }, { type: "inputImage", imageUrl: "data:text/plain;base64,AAAA" }],
      true,
    );
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toContain("content item 1");
    expect(noteOf(result)).toContain("text/plain");
    expect(noteOf(result)).toContain("image/");
  });

  it("refuses audio whose declared MIME is not audio/*", () => {
    const result = toCallResult([{ type: "inputAudio", audioUrl: "data:image/png;base64,AAAA" }], true);
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toContain("content item 0");
    expect(noteOf(result)).toContain("audio/");
  });

  it("refuses a malformed audio payload with the parse reason and the index", () => {
    const result = toCallResult([{ type: "inputAudio", audioUrl: "data:audio/wav;base64,not!base64" }], true);
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toContain("content item 0");
    expect(noteOf(result)).toContain("malformed base64 payload");
  });

  it("refuses a plain URL that is not a data: URL at all", () => {
    const result = toCallResult([{ type: "inputImage", imageUrl: "https://example.com/cat.png" }], true);
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toContain("not a base64 data: URL");
  });

  it("answers rather than throwing on an item the type system says cannot exist", () => {
    // D-M4-9: a throw here would surface as -32603 and leave the model's call parked forever, so the
    // totality is not allowed to rest on the caller's zod alone.
    const result = toCallResult([null as unknown as ToolCallContentItem], true);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
  });
});

describe("parseDataUrl", () => {
  it("keeps the DECLARED media type — M7's audio cannot be sniffed the way an image can", () => {
    expect(parseDataUrl("data:audio/wav;base64,BBBB")).toEqual({ ok: true, payload: "BBBB", mimeType: "audio/wav" });
  });

  it("is case-insensitive about the ;base64 marker and keeps the type verbatim", () => {
    expect(parseDataUrl("data:image/svg+xml;BASE64,AAAA")).toEqual({
      ok: true,
      payload: "AAAA",
      mimeType: "image/svg+xml",
    });
  });

  it("refuses anything that is not a base64 data: URL", () => {
    expect(parseDataUrl("https://example.com/a.png")).toEqual({ ok: false, reason: "not a base64 data: URL" });
    expect(parseDataUrl("data:image/png,AAAA")).toEqual({ ok: false, reason: "not a base64 data: URL" });
    expect(parseDataUrl("nonsense")).toEqual({ ok: false, reason: "not a base64 data: URL" });
  });

  it("refuses a payload outside the strict base64 alphabet or quantum", () => {
    expect(parseDataUrl("data:image/png;base64,AA!A")).toEqual({ ok: false, reason: "malformed base64 payload" });
    expect(parseDataUrl("data:image/png;base64,AAA")).toEqual({ ok: false, reason: "malformed base64 payload" });
  });

  it("bounds the payload BEFORE the caller allocates from it", () => {
    const parsed = parseDataUrl(`data:image/png;base64,${"A".repeat(MAX_DATA_URL_CHARS + 4)}`);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.reason).toContain(String(MAX_DATA_URL_CHARS));
  });
});
