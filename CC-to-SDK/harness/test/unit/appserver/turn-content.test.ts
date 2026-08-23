// test/unit/appserver/turn-content.test.ts — F10 T-IMGREACH Task 10 (I3d): the wire — `image/stage`
// chunks and `turn/startContent`, both NEGOTIATED methods (schema/index.ts's `experimental: true`): an
// old server answers METHOD_NOT_FOUND for either rather than accepting a widened `turn/start` input it
// cannot honour, which would run a text-only turn with nobody told (the F9 failure this whole track
// exists to end). Driven WIRE-LEVEL end to end (srv.connect + feed, mirroring queue-content-drain.test.ts
// and origin-gate.test.ts's own convention) rather than by calling `turnStartContent` directly — the
// load-bearing claims here are about the GATE ORDER and what actually reaches `submitContent`, and only
// the real dispatch path can prove that.
//
// Fixture note: the brief's illustrative regex for the allowlist-rejection cell was `/unsupported image
// media type/`, but the handler passes parsed params straight to `registry.chunk()` with NO re-mapping
// (imageStage.ts's own contract, and this task's "practical payoff of the two shapes being one") — so the
// refusal a client actually sees is the REGISTRY's own message (`... needs a mediaType in [...]`), proven
// already at Task 7's unit level (image-stage.test.ts). The cells below assert that real message rather
// than inventing a second one the handler would have to re-map.
//
// Task 11 (I3e) extends this file with `turn/steerContent` — the two handlers share ONE gate helper
// (turns.ts's `prepareStagedContent`), so the cells below prove the two substitutions (gate 4: "no turn
// in flight" instead of busy/enqueue; gate 5: `steerContent` instead of `submitContent`) rather than
// re-deriving the fleet/reserve/assemble/aggregate gates a second time — those are already proven above.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { ImageStageRegistry, IMAGE_STAGE_CHUNK_MAX } from "../../../src/appserver/imageStage.js";
import { imageStageParams } from "../../../src/appserver/schema/images.js";
import { turnStartContentParams, turnSteerContentParams } from "../../../src/appserver/schema/turns.js";
import { validateImageBlock, MAX_AGGREGATE_BYTES, type UserContentBlock, type UserTurnInput } from "../../../src/session/turnInput.js";
import { emptyFlagPerms, type EngineSession, type ThreadRecord } from "../../../src/appserver/registry.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "images");
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES_DIR, name));
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = (pred: () => boolean) => vi.waitFor(() => { if (!pred()) throw new Error("condition not yet true"); }, { timeout: 2000 });

/** A minimal request/response JSON-RPC test client over an in-process connection — the same shape the
 *  live suites' `RpcClient` uses, shrunk to what this file needs: notifications are not consumed (no
 *  test here asserts on one), and a rejection carries `code` so the skew/capability/fleet/queue cells can
 *  assert on it rather than on message-substring alone. */
function rpcClient() {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let target!: { feed(chunk: string): void };
  const onLine = (line: string): void => {
    const m = JSON.parse(line) as { id?: number; result?: unknown; error?: { code: number; message: string } };
    if (typeof m.id !== "number") return; // a notification — nothing here awaits one
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) { const e = new Error(m.error.message) as Error & { code: number }; e.code = m.error.code; p.reject(e); }
    else p.resolve(m.result);
  };
  const bind = (t: { feed(chunk: string): void }): void => { target = t; };
  const call = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      target.feed(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  return { onLine, bind, call };
}

/** Boots a real AppServer + one initialized connection, wired to `rpcClient()`. */
function boot(deps: Record<string, unknown> = {}) {
  const c = rpcClient();
  const sink: PeerSink = { write: (l) => c.onLine(l), buffered: () => 0, end: () => {} };
  const srv = new AppServer({}, deps as never);
  const conn = srv.connect(sink);
  c.bind(conn);
  return { srv, conn, call: c.call };
}

/** The default DI engine: `submitContent` records every call's FULL blocks array, in order, onto
 *  `contents` — the assertion surface every positive cell below reads. `steerContent` (Task 11) is the
 *  same recording shape onto `steers`, so the I3e cells below can assert the exact blocks a steer
 *  pushed without a second engine fixture. */
function contentEngine() {
  const contents: UserContentBlock[][] = [];
  const steers: UserContentBlock[][] = [];
  const submit = vi.fn(async () => ({ result: {} }));
  const submitContent = vi.fn(async (i: UserTurnInput) => { contents.push(i as UserContentBlock[]); return { result: "ok" }; });
  const steerContent = vi.fn((i: UserTurnInput) => { steers.push(i as UserContentBlock[]); });
  const session: EngineSession = { submit, submitContent, steerContent, interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {} };
  return { session, contents, steers, submit, submitContent, steerContent };
}

/** Boots a real thread on the given (or default) engine, initializes and subscribes — the positive-path
 *  rig every Step 1/most Step 2 cells share. Returns the raw `conn` too, so the teardown cell can drop it. */
async function realPeerPair(opts: { session?: EngineSession; deps?: Record<string, unknown>; engine?: ReturnType<typeof contentEngine> } = {}) {
  const engine = opts.engine ?? (opts.session ? undefined : contentEngine());
  const session = opts.session ?? engine!.session;
  const { srv, conn, call } = boot({ sessionFactory: () => session as never, ...opts.deps });
  await call("initialize", { clientInfo: { name: "t" } });
  const { thread } = await call("thread/start", {});
  await call("thread/subscribe", { threadId: thread.id });
  return { client: { call }, engine: engine ?? { contents: [] as UserContentBlock[][] }, registry: srv.imageStages, threadId: thread.id as string, srv, conn, session };
}

/** Stages a whole buffer as one complete image, chunked under `IMAGE_STAGE_CHUNK_MAX`, and returns the
 *  final chunk's reply (the one with `complete: true`). */
async function stageWhole(client: { call: (m: string, p?: Record<string, unknown>) => Promise<any> }, stageId: string, buf: Buffer, mediaType: string) {
  const b64 = buf.toString("base64");
  let seq = 0, result: unknown;
  for (let i = 0; i < b64.length; i += IMAGE_STAGE_CHUNK_MAX) {
    const data = b64.slice(i, i + IMAGE_STAGE_CHUNK_MAX);
    const last = i + IMAGE_STAGE_CHUNK_MAX >= b64.length;
    const params: Record<string, unknown> = { stageId, seq, last, bytesTotal: b64.length, data };
    if (seq === 0) params.mediaType = mediaType;
    result = await client.call("image/stage", params);
    seq++;
  }
  return result;
}

/** Registers an `origin:"fleet"` record directly — the only way to get one without a real fleet host
 *  (mirrors origin-gate.test.ts's own `addRecord`). */
function addFleetRecord(srv: AppServer, session: EngineSession): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  const record = {
    id, origin: "fleet", session, unattended: "park", busy: false, turnSeq: 0, interruptRequested: false,
    buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(),
    createdAt: now, updatedAt: now, settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
  } as unknown as ThreadRecord;
  srv.registry.add(record);
  return id;
}

describe("I3d: schema — imageStageParams and turnStartContentParams", () => {
  it("imageStageParams accepts a well-formed chunk and rejects malformed ones", () => {
    expect(imageStageParams.safeParse({ stageId: "s", seq: 0, last: true, bytesTotal: 4, mediaType: "image/png", data: "AAAA" }).success).toBe(true);
    expect(imageStageParams.safeParse({ stageId: "s", seq: 0, last: true, bytesTotal: 4, data: "AAAA" }).success).toBe(true); // mediaType optional AT THE SCHEMA — the handler enforces seq:0
    expect(imageStageParams.safeParse({ seq: 0, last: true, bytesTotal: 4, data: "AAAA" }).success).toBe(false); // missing stageId
    expect(imageStageParams.safeParse({ stageId: "s", seq: -1, last: true, bytesTotal: 4, data: "AAAA" }).success).toBe(false); // negative seq
    expect(imageStageParams.safeParse({ stageId: "s", seq: 0.5, last: true, bytesTotal: 4, data: "AAAA" }).success).toBe(false); // non-integer seq
    expect(imageStageParams.safeParse({ stageId: "s", seq: 0, last: true, bytesTotal: 0, data: "AAAA" }).success).toBe(false); // bytesTotal zero
    expect(imageStageParams.safeParse({ stageId: "s", seq: 0, last: "yes", bytesTotal: 4, data: "AAAA" }).success).toBe(false); // wrong type
    expect(imageStageParams.safeParse({ stageId: "", seq: 0, last: true, bytesTotal: 4, data: "AAAA" }).success).toBe(false); // empty stageId
  });

  it("turnStartContentParams requires threadId and a non-empty stagedImageIds array", () => {
    expect(turnStartContentParams.safeParse({ threadId: "t", stagedImageIds: ["a"] }).success).toBe(true);
    expect(turnStartContentParams.safeParse({ threadId: "t", text: "hi", stagedImageIds: ["a", "b"], queue: true }).success).toBe(true);
    expect(turnStartContentParams.safeParse({ stagedImageIds: ["a"] }).success).toBe(false); // missing threadId
    expect(turnStartContentParams.safeParse({ threadId: "t", stagedImageIds: [] }).success).toBe(false); // empty array
    expect(turnStartContentParams.safeParse({ threadId: "t", stagedImageIds: [""] }).success).toBe(false); // empty string id
    expect(turnStartContentParams.safeParse({ threadId: "t", stagedImageIds: "a" }).success).toBe(false); // wrong type
    expect(turnStartContentParams.safeParse({ threadId: "", stagedImageIds: ["a"] }).success).toBe(false); // empty threadId
  });
});

describe("I3d: the positive end-to-end JSON-RPC cell", () => {
  it("a two-chunk staged PNG reaches submitContent as exact, canonical blocks", async () => {
    const { client, engine, threadId } = await realPeerPair();
    const b64 = fixture("rgb8-64x48.png").toString("base64");
    const [a, b] = [b64.slice(0, 4), b64.slice(4)]; // small fixture — any split under IMAGE_STAGE_CHUNK_MAX proves the ≥2-chunk path
    expect(await client.call("image/stage", { stageId: "s1", seq: 0, last: false, bytesTotal: b64.length, mediaType: "image/png", data: a })).toMatchObject({ complete: false });
    expect(await client.call("image/stage", { stageId: "s1", seq: 1, last: true, bytesTotal: b64.length, data: b })).toMatchObject({ complete: true });

    await client.call("turn/startContent", { threadId, text: "what colour", stagedImageIds: ["s1"] });
    await waitFor(() => engine.contents.length === 1);
    expect(engine.contents[0]).toEqual([
      { type: "text", text: "what colour" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
    ]);
  });

  it("no text -> the I1 label is what the engine sees, not an empty block", async () => {
    const { client, engine, threadId } = await realPeerPair();
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    await client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] });
    await waitFor(() => engine.contents.length === 1);
    expect(engine.contents[0][0]).toEqual({ type: "text", text: "[Image #1]" });
    expect(engine.contents[0]).toHaveLength(2);
  });

  it("several stagedImageIds arrive in the ORDER GIVEN, each with its own media type", async () => {
    const { client, engine, threadId } = await realPeerPair();
    await stageWhole(client, "p", fixture("rgb8-64x48.png"), "image/png");
    await stageWhole(client, "j", fixture("tiny.jpg"), "image/jpeg");
    await client.call("turn/startContent", { threadId, text: "two", stagedImageIds: ["j", "p"] });
    await waitFor(() => engine.contents.length === 1);
    expect(engine.contents[0].slice(1).map((b: any) => b.source.media_type)).toEqual(["image/jpeg", "image/png"]);
  });

  it("a media type outside the allowlist is refused at the first chunk, and nothing is staged", async () => {
    const { client, registry } = await realPeerPair();
    for (const mediaType of ["image/gif", "image/webp"]) {
      await expect(client.call("image/stage", { stageId: mediaType, seq: 0, last: true, bytesTotal: 4, mediaType, data: "AAAA" }))
        .rejects.toThrow(/needs a mediaType in/);
    }
    expect(registry.stats()).toMatchObject({ stageCount: 0, stagedBytes: 0 });
  });
});

describe("I3d: first-chunk mediaType enforcement, over the wire", () => {
  it("absent on seq 0 is refused", async () => {
    const { client } = await realPeerPair();
    await expect(client.call("image/stage", { stageId: "s1", seq: 0, last: true, bytesTotal: 4, data: "AAAA" })).rejects.toThrow(/mediaType/);
  });

  it("outside IMAGE_MEDIA_TYPES is refused", async () => {
    const { client } = await realPeerPair();
    await expect(client.call("image/stage", { stageId: "s1", seq: 0, last: true, bytesTotal: 4, mediaType: "image/webp", data: "AAAA" })).rejects.toThrow(/needs a mediaType in/);
  });

  it("present on a later chunk is ignored — the first chunk's mediaType wins", async () => {
    const { client, engine, threadId } = await realPeerPair();
    const b64 = fixture("rgb8-64x48.png").toString("base64");
    const mid = Math.floor(b64.length / 2);
    await client.call("image/stage", { stageId: "s1", seq: 0, last: false, bytesTotal: b64.length, mediaType: "image/png", data: b64.slice(0, mid) });
    await client.call("image/stage", { stageId: "s1", seq: 1, last: true, bytesTotal: b64.length, mediaType: "image/jpeg", data: b64.slice(mid) });
    await client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] });
    await waitFor(() => engine.contents.length === 1);
    expect((engine.contents[0][1] as any).source.media_type).toBe("image/png");
  });
});

describe("I3d: old-server skew — turn/startContent is negotiated, never assumed", () => {
  it("dispatching against a handler map WITHOUT it answers METHOD_NOT_FOUND, and zero turns run", async () => {
    const engine = contentEngine();
    const { client, threadId, srv } = await realPeerPair({ engine });
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    // Simulates the pre-upgrade state a real old server is in: the method key never existed on its
    // dispatch table at all. Reaching into the private map is the only way to prove dispatch's generic
    // METHOD_NOT_FOUND fallback governs THIS method rather than something turnStartContent does itself.
    delete (srv as unknown as { handlers: Record<string, unknown> }).handlers["turn/startContent"];
    await expect(client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] })).rejects.toMatchObject({ code: ERR.METHOD_NOT_FOUND });
    expect(engine.submit).not.toHaveBeenCalled();
    expect(engine.submitContent).not.toHaveBeenCalled();
  });
});

describe("I3d: engine capability — checked before any reservation", () => {
  it("an engine WITHOUT submitContent refuses turn/startContent by name on an idle thread, and the stage stays reservable", async () => {
    const session: EngineSession = { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {} };
    const { client, registry, threadId } = await realPeerPair({ session });
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    await expect(client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] })).rejects.toThrow(/engine does not support content submission/);
    expect(registry.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 }); // the refusal happened before reservation — still reservable
  });
});

describe("I3d: the fleet-origin content gate", () => {
  it("refuses a fleet-origin thread with UNSUPPORTED_FOR_ORIGIN, touches no host op, and leaves the stage reservable", async () => {
    const engine = contentEngine();
    const { srv, conn, call } = boot({ sessionFactory: () => engine.session as never });
    await call("initialize", { clientInfo: { name: "t" } });
    const threadId = addFleetRecord(srv, engine.session);
    // Stage over the SAME connection this call() client speaks on — `image/stage` is keyed by connId.
    await stageWhole({ call }, "s1", fixture("rgb8-64x48.png"), "image/png");
    await expect(call("turn/startContent", { threadId, stagedImageIds: ["s1"] })).rejects.toMatchObject({ code: ERR.UNSUPPORTED_FOR_ORIGIN });
    expect(engine.submit).not.toHaveBeenCalled();
    expect(engine.submitContent).not.toHaveBeenCalled();
    expect(srv.imageStages.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 });
  });
});

describe("I3d: queue-refusal rollback", () => {
  it("a queue:true call whose assembled entry exceeds MAX_QUEUED_ENTRY_BYTES is refused, the stage stays reservable, and the turn counter is unchanged", async () => {
    // Two boundary-max images (POST_PROCESS_BYTE_BUDGET, 512,000 decoded bytes each — the largest a single
    // image may be) together exceed the 1 MiB per-entry queue cap, even though neither alone would (queue.ts's
    // own header: "one max-sized image plus text fits comfortably; two max-sized images in one entry do not").
    let releaseSubmit!: () => void;
    const parked = new Promise<{ result: unknown }>((r) => { releaseSubmit = () => r({ result: {} }); });
    const session: EngineSession = {
      submit: () => parked,
      submitContent: async () => ({ result: "ok" }),
      interrupt: async () => { releaseSubmit(); return {}; },
      dispose: async () => {},
      onFrame: () => () => {},
    };
    const { client, registry, threadId, srv } = await realPeerPair({ session });
    await client.call("turn/start", { threadId, input: "first" }); // now busy with a turn
    await stageWhole(client, "a", fixture("exactly-512000.png"), "image/png");
    await stageWhole(client, "b", fixture("exactly-512000.png"), "image/png");
    const before = srv.registry.get(threadId)!.turnSeq;
    await expect(client.call("turn/startContent", { threadId, stagedImageIds: ["a", "b"], queue: true }))
      .rejects.toThrow(/turn entry too large/);
    expect(srv.registry.get(threadId)!.turnSeq).toBe(before);
    expect(registry.stats()).toMatchObject({ stageCount: 2, reservedCount: 0 });
  });
});

describe("I3d: the per-turn aggregate cap", () => {
  it("a reservation whose decodedBytes exceed MAX_AGGREGATE_BYTES is refused and aborted, the stage staying reservable", async () => {
    // A cheap way to exercise a cap that the OTHER stage caps (MAX_STAGES_PER_CONNECTION x
    // POST_PROCESS_BYTE_BUDGET = 4 x 512,000 bytes, well under MAX_AGGREGATE_BYTES) make unreachable with
    // real fixtures: inject a validator that reports an oversized `decodedBytes` for a trivially small
    // block. The registry trusts its injected validator's verdict, exactly as I3a's own spy tests do.
    const validate = vi.fn((b: UserContentBlock & { type: "image" }) => ({ ok: true as const, block: b, decodedBytes: MAX_AGGREGATE_BYTES + 1 }));
    const registry = new ImageStageRegistry({ validate });
    const { client, threadId } = await realPeerPair({ deps: { imageStages: registry } });
    await client.call("image/stage", { stageId: "s1", seq: 0, last: true, bytesTotal: 4, mediaType: "image/png", data: "AAAA" });
    await expect(client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] })).rejects.toThrow(/exceeds the/);
    expect(registry.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 });
  });
});

describe("I3d: no second decode", () => {
  it("the injected validator is called exactly once across the whole stage -> startContent flow", async () => {
    const validate = vi.fn(validateImageBlock);
    const registry = new ImageStageRegistry({ validate });
    const { client, engine, threadId } = await realPeerPair({ deps: { imageStages: registry } });
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    expect(validate).toHaveBeenCalledTimes(1); // at stage completion
    await client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] });
    await waitFor(() => engine.contents.length === 1);
    expect(validate).toHaveBeenCalledTimes(1); // still one — normalizeValidatedBlocks never re-decodes
  });
});

describe("I3d: teardown", () => {
  it("dropping the connection mid-stage releases its bytes, and turn/startContent naming that stage later fails with a reason", async () => {
    const { client, registry, threadId, conn } = await realPeerPair();
    await client.call("image/stage", { stageId: "s1", seq: 0, last: false, bytesTotal: 1000, mediaType: "image/png", data: "AAAA" });
    expect(registry.stats().stagedBytes).toBeGreaterThan(0);
    conn.close();
    expect(registry.stats()).toMatchObject({ stagedBytes: 0, stageCount: 0 });
    await expect(client.call("turn/startContent", { threadId, stagedImageIds: ["s1"] })).rejects.toThrow(/unknown or incomplete stage/);
  });
});

describe("I3d: the sweep interval", () => {
  it("is unref'd — a staged image can never hold the process open", () => {
    const srv = new AppServer({}, {});
    expect(srv.imageStageSweepTimer.hasRef()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// I3e (Task 11): `turn/steerContent` — the mid-turn twin of `turn/startContent`. Both handlers run
// `prepareStagedContent` (turns.ts), so every gate proven above (fleet origin, reserve, assemble via
// normalizeValidatedBlocks, the aggregate cap, no second decode) already covers this method too; the
// cells below exercise only what genuinely differs: gate 4 ("no turn in flight" instead of busy/enqueue)
// and gate 5 (`steerContent` instead of `submitContent`).
// ---------------------------------------------------------------------------------------------------

/** An engine whose `submit` is PARKED (never resolves until `releaseSubmit` fires) — the same shape the
 *  I3d queue-refusal cell above uses to get a thread genuinely mid-turn, extended with `submitContent`
 *  and `steerContent` spies so a steer cell can assert BOTH what was pushed and what was NOT reached. */
function parkedContentEngine() {
  let releaseSubmit!: () => void;
  const parked = new Promise<{ result: unknown }>((r) => { releaseSubmit = () => r({ result: {} }); });
  const contents: UserContentBlock[][] = [];
  const steers: UserContentBlock[][] = [];
  const submit = vi.fn(() => parked);
  const submitContent = vi.fn(async (i: UserTurnInput) => { contents.push(i as UserContentBlock[]); return { result: "ok" }; });
  const steerContent = vi.fn((i: UserTurnInput) => { steers.push(i as UserContentBlock[]); });
  const session: EngineSession = {
    submit, submitContent, steerContent,
    interrupt: async () => { releaseSubmit(); return {}; },
    dispose: async () => {}, onFrame: () => () => {},
  };
  return { session, contents, steers, submit, submitContent, steerContent };
}

describe("I3e: schema — turnSteerContentParams", () => {
  it("requires threadId and a non-empty stagedImageIds array, and carries no `queue` (a steer never enqueues)", () => {
    expect(turnSteerContentParams.safeParse({ threadId: "t", stagedImageIds: ["a"] }).success).toBe(true);
    expect(turnSteerContentParams.safeParse({ threadId: "t", text: "hi", stagedImageIds: ["a", "b"] }).success).toBe(true);
    expect(turnSteerContentParams.safeParse({ stagedImageIds: ["a"] }).success).toBe(false); // missing threadId
    expect(turnSteerContentParams.safeParse({ threadId: "t", stagedImageIds: [] }).success).toBe(false); // empty array
    expect(turnSteerContentParams.safeParse({ threadId: "t", stagedImageIds: [""] }).success).toBe(false); // empty string id
    expect(turnSteerContentParams.safeParse({ threadId: "t", stagedImageIds: "a" }).success).toBe(false); // wrong type
    expect(turnSteerContentParams.safeParse({ threadId: "", stagedImageIds: ["a"] }).success).toBe(false); // empty threadId
    // `queue` is not part of this method's shape at all — passing it is simply an unrecognized extra key,
    // which zod's default (non-strict) object schema ignores rather than rejects.
    expect(turnSteerContentParams.safeParse({ threadId: "t", stagedImageIds: ["a"], queue: true }).success).toBe(true);
  });
});

describe("I3e: the positive mid-turn cell", () => {
  it("a staged PNG reaches steerContent as exact, canonical blocks — no new turn starts", async () => {
    const engine = parkedContentEngine();
    const { client, threadId, srv } = await realPeerPair({ session: engine.session });
    await client.call("turn/start", { threadId, input: "first" }); // now busy WITH A TURN
    const before = srv.registry.get(threadId)!.currentTurnId;
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    await client.call("turn/steerContent", { threadId, text: "look", stagedImageIds: ["s1"] });
    expect(engine.steers).toHaveLength(1);
    const b64 = fixture("rgb8-64x48.png").toString("base64");
    expect(engine.steers[0]).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
    ]);
    expect(engine.submitContent).not.toHaveBeenCalled(); // a steer never starts a new turn
    expect(srv.registry.get(threadId)!.currentTurnId).toBe(before); // the running turn is unchanged
  });
});

describe("I3e: gate 4 — eligibility is a property of the thread, not the engine build", () => {
  it("on an idle thread, turn/steerContent answers \"no turn in flight\" and the stage stays reservable", async () => {
    const engine = contentEngine();
    const { client, registry, threadId } = await realPeerPair({ engine });
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    await expect(client.call("turn/steerContent", { threadId, stagedImageIds: ["s1"] })).rejects.toThrow(/no turn in flight/);
    expect(registry.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 }); // never reserved — gate 4 runs before reserve
    expect(engine.submitContent).not.toHaveBeenCalled();
  });
});

describe("I3e: gate 5 — steerContent is its OWN capability, never a submitContent fallback", () => {
  it("an engine WITH submitContent but WITHOUT steerContent still refuses steering — a mis-route would start a new turn", async () => {
    const parked = new Promise<{ result: unknown }>(() => {}); // never resolves — keeps the thread busy for the whole test
    const submitContent = vi.fn(async () => ({ result: "ok" }));
    const session: EngineSession = {
      submit: () => parked, submitContent, interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {},
    }; // no steerContent member at all
    const { client, registry, threadId } = await realPeerPair({ session });
    await client.call("turn/start", { threadId, input: "first" }); // busy with a turn — gate 4 passes
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    await expect(client.call("turn/steerContent", { threadId, stagedImageIds: ["s1"] })).rejects.toThrow(/engine does not support content steering/);
    expect(registry.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 }); // refused before reservation
    expect(submitContent).not.toHaveBeenCalled(); // never routed through the wrong capability
  });
});

describe("I3e: old-server skew — turn/steerContent is negotiated, never assumed", () => {
  it("dispatching against a handler map WITHOUT it answers METHOD_NOT_FOUND, and zero turns/steers run", async () => {
    const engine = parkedContentEngine();
    const { client, threadId, srv } = await realPeerPair({ session: engine.session });
    await client.call("turn/start", { threadId, input: "first" });
    await stageWhole(client, "s1", fixture("rgb8-64x48.png"), "image/png");
    delete (srv as unknown as { handlers: Record<string, unknown> }).handlers["turn/steerContent"];
    await expect(client.call("turn/steerContent", { threadId, stagedImageIds: ["s1"] })).rejects.toMatchObject({ code: ERR.METHOD_NOT_FOUND });
    expect(engine.submit).toHaveBeenCalledTimes(1); // only the original turn/start — the deleted method never ran
    expect(engine.submitContent).not.toHaveBeenCalled();
    expect(engine.steerContent).not.toHaveBeenCalled();
  });
});

describe("I3e: the fleet-origin content gate", () => {
  it("refuses a fleet-origin thread with UNSUPPORTED_FOR_ORIGIN, touches no host op, and leaves the stage reservable", async () => {
    const engine = contentEngine();
    const { srv, call } = boot({ sessionFactory: () => engine.session as never });
    await call("initialize", { clientInfo: { name: "t" } });
    const threadId = addFleetRecord(srv, engine.session);
    await stageWhole({ call }, "s1", fixture("rgb8-64x48.png"), "image/png");
    await expect(call("turn/steerContent", { threadId, stagedImageIds: ["s1"] })).rejects.toMatchObject({ code: ERR.UNSUPPORTED_FOR_ORIGIN });
    expect(engine.submit).not.toHaveBeenCalled();
    expect(engine.submitContent).not.toHaveBeenCalled();
    expect(engine.steerContent).not.toHaveBeenCalled();
    expect(srv.imageStages.stats()).toMatchObject({ stageCount: 1, reservedCount: 0 });
  });
});
