// harness/test/unit/harness-turn-input.test.ts — F10 T-IMGREACH Task 3 (I2, library surface):
// `harness.run`/`stream`, `runStructured` and `Session.stream` all accept `UserTurnInput` and route an
// array through the SAME builder (`Session`'s `userTurn`, exported one-shot as `oneShotUserTurn`) that
// every Session turn already goes through — so a library array turn gets the I1 stranding label and
// every Task 2 cap identically. Also closes the r3 bare-string hole: `userTurn`'s normalize call is now
// UNCONDITIONAL, so MAX_TOTAL_TEXT binds every string surface (submit/steer/run/stream), not just arrays.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createHarness } from "../../src/harness.js";
import { Session } from "../../src/session/session.js";
import { runStructured } from "../../src/structured/run.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";
import { MAX_CONTENT_BLOCKS, MAX_TOTAL_TEXT, TRUNCATION_SUFFIX, type UserContentBlock, type UserTurnInput } from "../../src/session/turnInput.js";
import { MAX_IMAGES_PER_PROMPT } from "../../src/media/imageDims.js";
import { triple } from "./boundaryTriple.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const img = (data = PNG_1X1) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }) as const;
const textBlocks = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "text", text: `b${i}` }) as const);

/** A fake `query()` shaped like the real SDK's: two frames, a FIFO-matchable human-origin result so it
 *  settles both a bare `query()` caller (harness.ts) AND a `Session` waiter identically. */
function oneResult(): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "system", subtype: "init", session_id: "s1" };
    yield { type: "result", subtype: "success", is_error: false, result: "ok", origin: { kind: "human" } };
  })();
}
function structuredResult(structured_output: unknown): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "system", subtype: "init", session_id: "s1" };
    yield { type: "result", subtype: "success", is_error: false, result: "ok", structured_output, origin: { kind: "human" } };
  })();
}
const capture = (sink: unknown[]) => ({ prompt }: any) => { sink.push(prompt); return oneResult(); };
const structuredCapture = (sink: unknown[], out: unknown) => ({ prompt }: any) => { sink.push(prompt); return structuredResult(out); };

/** Drains a one-shot AsyncIterable<SDKUserMessage> and returns its single message's content array. */
async function firstContent(prompt: unknown): Promise<any[]> {
  expect(typeof prompt).not.toBe("string");
  const msgs: any[] = []; for await (const m of prompt as AsyncIterable<any>) msgs.push(m);
  expect(msgs).toHaveLength(1);
  return msgs[0].message.content;
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) { if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

describe("I2: library surfaces accept UserTurnInput", () => {
  it("I2: a STRING prompt still reaches query() as a string — the common path is unchanged", async () => {
    const seen: unknown[] = [];
    const h = createHarness({}, { query: ((a: any) => { seen.push(a.prompt); return oneResult(); }) as any });
    await h.run("hi");
    expect(seen[0]).toBe("hi");
  });

  it("I2: an ARRAY prompt reaches query() as a one-shot AsyncIterable<SDKUserMessage>", async () => {
    const seen: any[] = [];
    const h = createHarness({}, { query: ((a: any) => { seen.push(a.prompt); return oneResult(); }) as any });
    await h.run([{ type: "text", text: "what colour" }, img()]);
    expect(typeof seen[0]).not.toBe("string");
    const msgs: any[] = []; for await (const m of seen[0] as AsyncIterable<any>) msgs.push(m);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("user");
    expect(msgs[0].message.role).toBe("user");
    expect(Array.isArray(msgs[0].message.content)).toBe(true);
    expect(typeof msgs[0].uuid).toBe("string");
  });

  it("I2: a stranded array is LABELLED by the time it reaches query()", async () => {
    const seen: unknown[] = [];
    const h = createHarness({}, { query: capture(seen) as any });
    await h.run([img()]);
    expect(await firstContent(seen[0])).toEqual([
      { type: "text", text: "[Image #1]" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } },
    ]);
  });

  it("I2: a garbage image degrades to the failure block and the bytes never reach query()", async () => {
    const bad = { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("garbage").toString("base64") } } as const;
    const seen: unknown[] = [];
    const h = createHarness({}, { query: capture(seen) as any });
    await h.run([{ type: "text", text: "look" }, bad]);
    const content = await firstContent(seen[0]);
    expect(content.filter((b: any) => b.type === "image")).toHaveLength(0);
    expect(content[1]).toEqual({ type: "text", text: "[Image could not be processed: unreadable image data]" });
  });

  it("I2: harness.stream(array) routes through the SAME builder", async () => {
    const seen: unknown[] = [];
    const h = createHarness({}, { query: capture(seen) as any });
    for await (const _ of h.stream([img()])) { /* drain */ }
    expect((await firstContent(seen[0]))[0]).toEqual({ type: "text", text: "[Image #1]" });
  });

  it("I2: runStructured(schema, array) routes through the SAME builder", async () => {
    const seen: unknown[] = [];
    const schema = z.object({ colour: z.string() });
    await runStructured(schema, [{ type: "text", text: "c" }, img()], {}, { query: structuredCapture(seen, { colour: "red" }) as any });
    expect((await firstContent(seen[0])).filter((b: any) => b.type === "image")).toHaveLength(1);
  });

  it("I2: Session.stream accepts an array and normalizes it", async () => {
    const { turns, query } = framedQuery();
    const s = new Session({ query }, {});
    void (async () => { for await (const _ of s.stream([img()])) { /* drain */ } })();
    await waitFor(() => turns.length === 1);
    expect((turns[0].message.content as UserContentBlock[])[0]).toEqual({ type: "text", text: "[Image #1]" });
  });
});

// A Session's own `prompt` (the AsyncQueue it hands `query()` at construction) never terminates on its
// own; these two tests only need to observe what got PUSHED, so they never await a turn's resolution —
// matching test/unit/session.test.ts's own `framedQuery()` exactly (frames stay empty and unclosed).
function framedQuery() {
  const frames = new AsyncQueue<unknown>(), turns: any[] = [];
  const query = ({ prompt }: any) => {
    void (async () => { for await (const turn of prompt) turns.push(turn); })();
    return { [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() };
  };
  return { frames, turns, query };
}

// The boundary matrix's Session.stream cell, by contrast, DOES need its turn to resolve (`drive` awaits
// `s.stream(p)` fully draining) — driven through the same `capture()`/`oneResult()` as the other two
// surfaces. A Session's `prompt` is its own long-lived AsyncQueue (constructed once, pushed to
// per-turn) — unlike harness.ts's array arm, which builds a FRESH one-shot generator per call.
// `capture()`/`firstContent()` assume the one-shot shape, so that cell disposes the session after
// draining: `dispose()` closes the SAME queue object `capture` recorded, so `firstContent` still sees
// exactly one buffered turn and then a clean end, instead of hanging on a queue nothing else will ever
// close (confirmed live: an unclosed AsyncQueue's `for await` blocks forever past its last pushed item).

describe.each([
  { surface: "harness.run", drive: (p: UserTurnInput, q: any) => createHarness({}, { query: q }).run(p) },
  { surface: "harness.stream", drive: async (p: UserTurnInput, q: any) => { for await (const _ of createHarness({}, { query: q }).stream(p)) { /* */ } } },
  {
    surface: "Session.stream",
    drive: async (p: UserTurnInput, q: any) => {
      const s = new Session({ query: q }, {});
      for await (const _ of s.stream(p)) { /* */ }
      await s.dispose(); // closes the queue `capture` recorded — see the comment above framedQuery
    },
  },
])("I2 boundary on $surface", ({ drive }) => {
  it.each(triple(MAX_CONTENT_BLOCKS))("MAX_CONTENT_BLOCKS $label", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await drive(textBlocks(at), capture(seen));
    expect(await firstContent(seen[0])).toHaveLength(passes ? at : MAX_CONTENT_BLOCKS);
  });
  it.each(triple(MAX_IMAGES_PER_PROMPT))("MAX_IMAGES_PER_PROMPT $label", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await drive([{ type: "text", text: "x" }, ...Array.from({ length: at }, () => img())], capture(seen));
    const content = await firstContent(seen[0]);
    expect(content.filter((b: any) => b.type === "image")).toHaveLength(passes ? at : MAX_IMAGES_PER_PROMPT);
  });
});

// MAX_TOTAL_TEXT's "bare string stays a string" cell is deliberately NOT run against Session.stream
// here: `capture`'s query fn is invoked once, at Session CONSTRUCTION, with `{prompt: this.input}` —
// Session's own long-lived queue object, never the literal per-turn string — because a Session always
// wraps every turn into an SDKUserMessage before pushing it, whatever the input's type. So `seen[0]` is
// never a string for this surface; the assertion this cell makes would be checking the wrong seam.
// Session's builder-side string cap is real and IS proven, correctly, by the dedicated
// `Session.submit(string)`/`Session.steer(string)` cells below (reading the pushed turn's own
// `message.content`, not the query-fn argument).
describe.each([
  { surface: "harness.run", drive: (p: UserTurnInput, q: any) => createHarness({}, { query: q }).run(p) },
  { surface: "harness.stream", drive: async (p: UserTurnInput, q: any) => { for await (const _ of createHarness({}, { query: q }).stream(p)) { /* */ } } },
])("I2 boundary on $surface", ({ drive }) => {
  it.each(triple(MAX_TOTAL_TEXT))("MAX_TOTAL_TEXT $label (bare string stays a string)", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await drive("x".repeat(at), capture(seen));
    expect(typeof seen[0]).toBe("string"); // the string path must NOT become streaming-input
    expect((seen[0] as string).length).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
    expect((seen[0] as string).endsWith(TRUNCATION_SUFFIX)).toBe(!passes);
  });
});

describe("I2 boundary on runStructured", () => {
  const schema = z.object({ colour: z.string() });
  it.each(triple(MAX_CONTENT_BLOCKS))("MAX_CONTENT_BLOCKS $label", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await runStructured(schema, textBlocks(at), {}, { query: structuredCapture(seen, { colour: "red" }) as any });
    expect(await firstContent(seen[0])).toHaveLength(passes ? at : MAX_CONTENT_BLOCKS);
  });
  it.each(triple(MAX_IMAGES_PER_PROMPT))("MAX_IMAGES_PER_PROMPT $label", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await runStructured(schema, [{ type: "text", text: "x" }, ...Array.from({ length: at }, () => img())], {}, { query: structuredCapture(seen, { colour: "red" }) as any });
    const content = await firstContent(seen[0]);
    expect(content.filter((b: any) => b.type === "image")).toHaveLength(passes ? at : MAX_IMAGES_PER_PROMPT);
  });
  it.each(triple(MAX_TOTAL_TEXT))("MAX_TOTAL_TEXT $label (bare string stays a string)", async ({ at, passes }) => {
    const seen: unknown[] = [];
    await runStructured(schema, "x".repeat(at), {}, { query: structuredCapture(seen, { colour: "red" }) as any });
    expect(typeof seen[0]).toBe("string");
    expect((seen[0] as string).length).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
    expect((seen[0] as string).endsWith(TRUNCATION_SUFFIX)).toBe(!passes);
  });
});

describe("I2: the r3 bare-string hole — Session's builder normalizes strings UNCONDITIONALLY", () => {
  it.each(triple(MAX_TOTAL_TEXT))("MAX_TOTAL_TEXT $label — Session.submit(string) is capped by the builder", async ({ at, passes }) => {
    const { turns, query } = framedQuery();
    const s = new Session({ query }, {});
    void s.submit("x".repeat(at));
    await waitFor(() => turns.length === 1);
    const content = turns[0].message.content;
    expect(typeof content).toBe("string"); // the string wire form is PRESERVED
    expect((content as string).length).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
    expect((content as string).endsWith(TRUNCATION_SUFFIX)).toBe(!passes);
  });

  it("MAX_TOTAL_TEXT: Session.steer(string) goes through the SAME builder, so it is capped too", async () => {
    // steer shares `userTurn` with submit; a conditional normalize would leave this one uncapped.
    const { turns, query } = framedQuery();
    const s = new Session({ query }, {});
    void s.submit("hi");
    await waitFor(() => turns.length === 1);
    s.steer("y".repeat(MAX_TOTAL_TEXT + 1));
    await waitFor(() => turns.length === 2);
    expect((turns[1].message.content as string).length).toBeLessThanOrEqual(MAX_TOTAL_TEXT);
  });
});
