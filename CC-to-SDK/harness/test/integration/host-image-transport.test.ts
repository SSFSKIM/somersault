// harness/test/integration/host-image-transport.test.ts — F9 T-IMAGE Task 5 (I3b): the negotiated
// stageImage transport, full loopback over the REAL socket pair (spec v3.1 "Transport", plan Task 5's
// required test cells). Mirrors test/integration/host-client.test.ts's `startHost`/`drivable` harness —
// a REAL `SessionHost` + `HostServer` listening on a real UDS, driven by a hand-written fake `session`
// (the ENGINE half only; the HOST half — staging, validation, correlation — is entirely real code under
// test here, unlike `test/helpers/fakeHost.ts`'s modelled-host suites).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SessionHost } from "../../src/host/host.js";
import type { HostSession } from "../../src/host/host.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import { remoteChatSession, IMAGE_VERSION_SKEW_NOTICE } from "../../src/client/chatAdapter.js";
import { hostSocketPath, hostImageStagingDir } from "../../src/fleet/paths.js";
import { POST_PROCESS_BYTE_BUDGET } from "../../src/media/imageDims.js";
import type { UserTurnInput, UserContentBlock } from "../../src/session/turnInput.js";

const fleets: string[] = [];
const tmpFleet = () => { const d = mkdtempSync(join(tmpdir(), "ccx-imgtransport-")); fleets.push(d); return d; };
afterEach(() => { for (const d of fleets.splice(0)) rmSync(d, { recursive: true, force: true }); });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) { if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout"); await delay(5); }
}

// Header-only PNG — a real signature + IHDR carrying width/height, zero-padded to an exact byte count.
// `pngDimensions` (clipboardImage.ts) never reads past byte 24, so this is cheap and sufficient for every
// cell here (none of them exercise the dimension cap — that is Task 4's turnInput.test.ts).
function fakePng(width: number, height: number, totalBytes = 64): Buffer {
  const buf = Buffer.alloc(Math.max(totalBytes, 24));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}
function imageBlock(buf: Buffer, mediaType = "image/png"): UserContentBlock {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
}
/** GIF87a/GIF89a: 6-byte tag, then logical screen width/height as two LE uint16s at bytes 6-10.
 *  Mirrors `imageDims.test.ts`'s own builder. */
function gifHeader(w: number, h: number, tag = "GIF89a"): Buffer {
  const b = Buffer.alloc(13); b.write(tag, 0, "ascii"); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
}

/** A session we drive by hand: EACH `submit()` call captures its content and rebinds `emit`/`finish` to
 *  THAT turn, so sequential turns (busy → drain, or a follow-up submit after release) are supported —
 *  the same shape `client-chat-adapter.test.ts`'s own `drivable()` uses. */
function drivable(sessionId = "sid-transport") {
  let emit: (m: unknown) => void = () => {};
  let finish: (v?: unknown) => void = () => {};
  const submittedContents: UserTurnInput[] = [];
  return {
    sessionId,
    submit(prompt: UserTurnInput, onMessage: (m: unknown) => void) {
      submittedContents.push(prompt);
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = r; });
    },
    dispose: async () => {},
    interrupt: async () => {},
    emit: (m: unknown) => emit(m),
    finish: (v?: unknown) => finish(v),
    submittedContents,
  };
}

async function startHost(session: HostSession = drivable(), opts: {
  readStagedImage?: (path: string) => Promise<Buffer>;
  afterImageValidated?: (stagedId: string) => void;
} = {}) {
  const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
  const host = new SessionHost(
    { short: "1aa6e000", name: "imgtransport", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
    {
      openSession: () => session, procStartOf: async () => "start",
      ...(opts.readStagedImage ? { readStagedImage: opts.readStagedImage } : {}),
      ...(opts.afterImageValidated ? { afterImageValidated: opts.afterImageValidated } : {}),
    });
  await host.start();
  return { host, session, env, path: hostSocketPath(process.pid, env), stagingDir: hostImageStagingDir(process.pid, env) };
}
const stopQuietly = (host: SessionHost) => host.stop().catch(() => {});

/** A minimal server that mimics a PRE-IMAGE host's wire behaviour at exactly the point that matters: it
 *  answers `stageImage` with the same `{ok:false, error:"unknown op"}` a real old host's zod
 *  discriminated union produces for a literal it has never heard of (server.ts's dispatch), and it
 *  RECORDS every `prompt` op it receives so the test can assert none ever arrived. Reproducing this at
 *  the wire level (rather than constructing the literal old schema, which no longer exists in this tree)
 *  is what spec v3.1 means by "an old host's discriminated union does not recognize this literal at all". */
function fakeOldHost() {
  const promptCalls: unknown[] = [];
  const socketPath = join(mkdtempSync(join(tmpdir(), "ccx-oldhost-")), "old.sock");
  const server = createServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        const id = frame.id;
        if (frame.op === "stageImage") { sock.write(JSON.stringify({ id, ok: false, error: "unknown op" }) + "\n"); continue; }
        if (frame.op === "prompt") { promptCalls.push(frame); sock.write(JSON.stringify({ id, ok: true, accepted: true, seq: 1 }) + "\n"); continue; }
        // follow / whenFollowed / anything else the adapter's connect sequence touches: answer generically ok.
        sock.write(JSON.stringify({ id, ok: true, following: true }) + "\n");
      }
    });
  });
  return {
    promptCalls, socketPath,
    listen: () => new Promise<void>((resolve) => server.listen(socketPath, resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("F9 T-IMAGE Task 5 (I3b) — the negotiated stageImage transport, real socket loopback", () => {
  it("structural submission with one image round-trips: Session receives text-first blocks with correct base64", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const adapter = remoteChatSession(path);
    try {
      const png = fakePng(4, 4, 64);
      const content: UserTurnInput = [{ type: "text", text: "look at this" }, imageBlock(png)];
      const seen: unknown[] = [];
      const submitPromise = adapter.submit(content, (m) => seen.push(m));
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(Array.isArray(assembled)).toBe(true);
      expect(assembled[0]).toEqual({ type: "text", text: "look at this" });
      expect(assembled[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    } finally { adapter.detach(); await stopQuietly(host); }
  });

  it("version skew: an old host's stageImage is unknown-op — the client surfaces the notice and sends ZERO prompt frames", async () => {
    // Must FAIL against a silently-stripping implementation: an adapter that dropped the image and sent a
    // text-only `prompt` anyway would leave `old.promptCalls` non-empty and this assertion would catch it.
    const old = fakeOldHost();
    await old.listen();
    const adapter = remoteChatSession(old.socketPath);
    try {
      const content: UserTurnInput = [{ type: "text", text: "hi" }, imageBlock(fakePng(4, 4))];
      await expect(adapter.submit(content, () => {})).rejects.toThrow(IMAGE_VERSION_SKEW_NOTICE);
      expect(old.promptCalls).toHaveLength(0);
    } finally { adapter.detach(); await old.close(); }
  });

  it("hash mismatch degrades to the failure text block; the turn still submits", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const client = await RemoteChatSession.connect(path);
    try {
      const png = fakePng(4, 4, 64);
      const staged = await client.stageImageOp({ mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: png.length, sha256: createHash("sha256").update(png).digest("hex") });
      expect(staged.ok && staged.path).toBeTruthy();
      writeFileSync(staged.path!, Buffer.from("corrupted-in-transit"));   // NOT the bytes the hash was computed from
      const reply = await client.prompt("hi", undefined, [{ stagedId: staged.path!, sha256: createHash("sha256").update(png).digest("hex") }]);
      expect(reply.ok).toBe(true);   // the TURN still submits — degrade, not refusal
      await waitFor(() => session.submittedContents.length === 1);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[0]).toEqual({ type: "text", text: "hi" });
      expect(assembled[1]).toMatchObject({ type: "text", text: expect.stringContaining("Image could not be processed") });
      session.finish({ result: "ok" });
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("a missing staged file degrades to the failure text block; the turn still submits", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const client = await RemoteChatSession.connect(path);
    try {
      // Claim a stagedId that was never minted at all — the "missing" arm never touches the filesystem.
      const reply = await client.prompt("hi", undefined, [{ stagedId: join(path, "..", "never-staged"), sha256: "0".repeat(64) }]);
      expect(reply.ok).toBe(true);
      await waitFor(() => session.submittedContents.length === 1);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[1]).toMatchObject({ type: "text", text: expect.stringContaining("Image could not be processed") });
      session.finish({ result: "ok" });
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("an oversize staged file degrades to the failure text block; the turn still submits", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const client = await RemoteChatSession.connect(path);
    try {
      const oversized = Buffer.alloc(POST_PROCESS_BYTE_BUDGET + 1, 7);
      const sha256 = createHash("sha256").update(oversized).digest("hex");
      const staged = await client.stageImageOp({ mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: oversized.length, sha256 });
      writeFileSync(staged.path!, oversized);
      const reply = await client.prompt("hi", undefined, [{ stagedId: staged.path!, sha256 }]);
      expect(reply.ok).toBe(true);
      await waitFor(() => session.submittedContents.length === 1);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[1]).toMatchObject({ type: "text", text: expect.stringContaining("byte limit") });
      session.finish({ result: "ok" });
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("MAX_IMAGES_PER_PROMPT: the 21st image claim in one prompt degrades to the count-limit text while the first 20 assemble as real images", async () => {
    // Pins the count cap the review flagged as untested: nothing else in this suite ever stages more
    // than a handful of claims, so this guard could regress silently. The bounds below are DELIBERATELY
    // hardcoded literals, not `MAX_IMAGES_PER_PROMPT` itself — importing the constant would make this
    // cell track any future change to the cap instead of pinning the CURRENT spec'd value of 20.
    // Mutation check: bump MAX_IMAGES_PER_PROMPT to 21 in imageStaging.ts and this cell must FAIL (21
    // images assemble, no count-limit text) — restored immediately after confirming.
    const session = drivable();
    const { host, path } = await startHost(session);
    const client = await RemoteChatSession.connect(path);
    try {
      const claims: { stagedId: string; sha256: string }[] = [];
      for (let i = 0; i < 21; i++) {
        const png = fakePng(4, 4, 64);
        const sha256 = createHash("sha256").update(png).digest("hex");
        const staged = await client.stageImageOp({ mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: png.length, sha256 });
        expect(staged.ok && staged.path).toBeTruthy();
        writeFileSync(staged.path!, png);
        claims.push({ stagedId: staged.path!, sha256 });
      }
      const reply = await client.prompt("hi", undefined, claims);
      expect(reply.ok).toBe(true);   // the TURN still submits — degrade the tail, never refuse the whole turn
      await waitFor(() => session.submittedContents.length === 1);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      const imageBlocks = assembled.filter((b) => b.type === "image");
      const textBlocks = assembled.filter((b) => b.type === "text");
      expect(imageBlocks).toHaveLength(20);
      expect(textBlocks.some((b) => (b as { text: string }).text.includes("too many images"))).toBe(true);
      // Every claimed file — including the ones that degraded on count alone — is released, not leaked.
      for (const claim of claims) expect(existsSync(claim.stagedId)).toBe(false);
      session.finish({ result: "ok" });
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("claimed files are deleted in a finally when the staged read fails (a failed-validation verdict, not a thrown exception — readAndValidate catches its own read failure internally)", async () => {
    // NOTE on scope: this cell proves cleanup-on-failed-validation. It does NOT, by itself, prove the
    // `finally` survives a genuine thrown exception — `ImageStaging.readAndValidate` catches this
    // injected read failure internally and returns an `{ok:false}` verdict, so nothing here ever
    // escapes the try block as an exception. Removing the `finally` leaves this cell passing unchanged
    // (confirmed live). The next cell below is the one that forces a REAL throw and discriminates on it.
    const session = drivable();
    const readStagedImage = async (): Promise<Buffer> => { throw new Error("injected read failure"); };
    const { host, path } = await startHost(session, { readStagedImage });
    const client = await RemoteChatSession.connect(path);
    try {
      const png = fakePng(4, 4, 64);
      const sha256 = createHash("sha256").update(png).digest("hex");
      const staged = await client.stageImageOp({ mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: png.length, sha256 });
      writeFileSync(staged.path!, png);
      expect(existsSync(staged.path!)).toBe(true);
      const reply = await client.prompt("hi", undefined, [{ stagedId: staged.path!, sha256 }]);
      expect(reply.ok).toBe(true);
      await waitFor(() => session.submittedContents.length === 1);
      // The turn still ran (degraded, since the injected read never returns bytes)...
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[1]).toMatchObject({ type: "text" });
      // ...and the claimed file is gone regardless of WHY the read failed — the `finally` around
      // assembly, not the specific error branch, is what deletes it.
      expect(existsSync(staged.path!)).toBe(false);
      session.finish({ result: "ok" });
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("claimed files are STILL deleted in a finally when assembly throws a genuine exception AFTER validation succeeds", async () => {
    // The prior cell's "injected read failure" never actually exercises the `finally` under a thrown
    // exception: `ImageStaging.readAndValidate` catches its own read failure internally and returns an
    // `{ok:false}` verdict, so the claim loop never throws at all — removing the `finally` left that
    // cell passing unchanged (review's mutation (c)). This cell forces a REAL throw past a successful
    // validation, via the `afterImageValidated` seam (host.ts), so removing the `finally` around the
    // claim-release loop must fail THIS cell.
    // Mutation check: remove the `finally` wrapping the loop in `assembleStagedContent` (host.ts) and
    // this cell must FAIL (the file survives) — restored immediately after confirming.
    const session = drivable();
    const afterImageValidated = () => { throw new Error("injected assembly failure"); };
    const { host, path } = await startHost(session, { afterImageValidated });
    const client = await RemoteChatSession.connect(path);
    try {
      const png = fakePng(4, 4, 64);
      const sha256 = createHash("sha256").update(png).digest("hex");
      const staged = await client.stageImageOp({ mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: png.length, sha256 });
      writeFileSync(staged.path!, png);
      expect(existsSync(staged.path!)).toBe(true);
      // `prompt`'s reply is synchronous (seq reservation happens before any await, per the sequence-race
      // cell above) — it resolves ok:true regardless of what happens later inside runTask. The injected
      // throw surfaces as runTask's own rejection, which server.ts's dispatch deliberately fires-and-
      // swallows (`void handlers.prompt(...).catch(() => {})`) rather than reflecting on the reply.
      const reply = await client.prompt("hi", undefined, [{ stagedId: staged.path!, sha256 }]);
      expect(reply.ok).toBe(true);
      // The turn never reaches Session.submit at all — the throw happens before content is assembled.
      await waitFor(() => !existsSync(staged.path!));
      expect(session.submittedContents).toHaveLength(0);
    } finally { client.detach(); await stopQuietly(host); }
  });

  it("orphan sweep: a stale file older than the bound is deleted at host start; a fresh one survives", async () => {
    const env = { CCX_FLEET_ROOT: tmpFleet() } as NodeJS.ProcessEnv;
    const stagingDir = hostImageStagingDir(process.pid, env);
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const stalePath = join(stagingDir, "stale-uuid");
    const freshPath = join(stagingDir, "fresh-uuid");
    writeFileSync(stalePath, "old");
    writeFileSync(freshPath, "new");
    const { utimesSync } = await import("node:fs");
    const { ORPHAN_MAX_AGE_MS } = await import("../../src/host/imageStaging.js");
    const oldTime = (Date.now() - ORPHAN_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(stalePath, oldTime, oldTime);   // freshPath keeps its just-written mtime
    const session = drivable();
    const host = new SessionHost(
      { short: "1aa6e001", name: "sweep", cwd: process.cwd(), kind: "bg", detached: true, config: {} as never, env },
      { openSession: () => session, procStartOf: async () => "start" });
    try {
      await host.start();   // sweepOrphans() runs synchronously inside start()
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(freshPath)).toBe(true);
    } finally { await stopQuietly(host); }
  });

  it("sequence race: a delayed staged-file read still reserves and broadcasts the CORRECT seq before the read completes, and the client's end-event wait settles", async () => {
    const delayMs = 150;
    const session = drivable();
    const readStagedImage = async (p: string): Promise<Buffer> => {
      await delay(delayMs);
      const { readFile } = await import("node:fs/promises");
      return readFile(p);
    };
    const { host, path } = await startHost(session, { readStagedImage });
    // A raw second connection watches the turn-start event LAND — this fires synchronously inside
    // runTask, before the delayed read ever begins (host.ts's runTask, "everything above this line is
    // synchronous"). A broken implementation that awaited the read BEFORE reserving/broadcasting the seq
    // would make this event arrive only AFTER `delayMs`, which the timing assertion below catches.
    const follower = await RemoteChatSession.connect(path);
    const starts: number[] = [];
    follower.follow((ev) => { if (ev.kind === "turn" && ev.phase === "start" && ev.seq !== undefined) starts.push(ev.seq); });
    await follower.whenFollowed();
    const adapter = remoteChatSession(path);
    try {
      const png = fakePng(4, 4, 64);
      const content: UserTurnInput = [{ type: "text", text: "hi" }, imageBlock(png)];
      const t0 = Date.now();
      const submitPromise = adapter.submit(content, () => {});
      await waitFor(() => starts.length === 1, 2000);
      const elapsedToStart = Date.now() - t0;
      expect(elapsedToStart).toBeLessThan(delayMs);   // the seq was reserved+broadcast WELL before the read finished
      expect(starts).toEqual([1]);
      // Now let the (still in-flight, artificially delayed) turn actually complete.
      await waitFor(() => session.submittedContents.length === 1, 2000);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;   // the end-event wait SETTLES — the correlation survived the delay
    } finally { adapter.detach(); follower.detach(); await stopQuietly(host); }
  });

  it("busy-host refusal leaves the staged file for the CLIENT to clean up", async () => {
    const session = drivable();
    const { host, path, stagingDir } = await startHost(session);
    void host.runTask("first turn, busies the host");   // held open — drivable() never auto-resolves
    await waitFor(() => session.submittedContents.length === 1);
    const adapter = remoteChatSession(path);
    try {
      const content: UserTurnInput = [{ type: "text", text: "hi" }, imageBlock(fakePng(4, 4))];
      await expect(adapter.submit(content, () => {})).rejects.toThrow(/busy/);
      // The stage op itself succeeded (never busy-gated) and the client wrote real bytes — but the
      // PROMPT was refused, so this client never became the host's problem to clean up (spec v3.1).
      expect(existsSync(stagingDir) ? readdirSync(stagingDir) : []).toHaveLength(0);
    } finally {
      adapter.detach();
      session.finish({ result: "ok" });   // release the held-open first turn so teardown does not hang
      await stopQuietly(host);
    }
  });

  it("final-review finding 2: an image-only prompt (no text block at all) round-trips over the real loopback", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const adapter = remoteChatSession(path);
    try {
      const png = fakePng(4, 4, 64);
      const content: UserTurnInput = [imageBlock(png)];      // no text block at all
      const submitPromise = adapter.submit(content, () => {});
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      const assembled = session.submittedContents[0] as UserContentBlock[];
      // BOUNDARY NOTE (F10 I1): this is the HOST-assembled array, captured at the HostSession seam. The
      // I1 label is minted one layer below, in Session's `userTurn` builder — see
      // test/unit/session.test.ts's "the REPL wire shape" cell. An empty first text block here is correct.
      expect(assembled[0]).toEqual({ type: "text", text: "" });
      expect(assembled[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    } finally { adapter.detach(); await stopQuietly(host); }
  });

  it("final-review finding 3: an unreadable image block degrades to the failure text CLIENT-SIDE — no stageImageOp call at all", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const adapter = remoteChatSession(path);
    const stageSpy = vi.spyOn(RemoteChatSession.prototype, "stageImageOp");
    try {
      const garbage: UserContentBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("not a real image, no PNG/JPEG header").toString("base64") } };
      const content: UserTurnInput = [{ type: "text", text: "hi" }, garbage];
      const submitPromise = adapter.submit(content, () => {});
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      expect(stageSpy).not.toHaveBeenCalled();
      // Nothing survived to stage at all — the wire `prompt` carries pure text (no images claim), so the
      // host never enters `assembleStagedContent` and the turn's content is the plain string it always was.
      expect(session.submittedContents[0]).toBe("hi[Image could not be processed: unreadable image data]");
    } finally { adapter.detach(); await stopQuietly(host); stageSpy.mockRestore(); }
  });

  it("bl4 T-GIFWEBP: GIF/WebP no longer degrade client-side — they stage and reach the host normally", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const adapter = remoteChatSession(path);
    const stageSpy = vi.spyOn(RemoteChatSession.prototype, "stageImageOp");
    try {
      const gif = gifHeader(4, 4);
      const content: UserTurnInput = [{ type: "text", text: "hi" }, imageBlock(gif, "image/gif")];
      const submitPromise = adapter.submit(content, () => {});
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      expect(stageSpy).toHaveBeenCalledTimes(1);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[0]).toEqual({ type: "text", text: "hi" });
      expect(assembled[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/gif", data: gif.toString("base64") } });
    } finally { adapter.detach(); await stopQuietly(host); stageSpy.mockRestore(); }
  });

  it("final-review finding 4: MAX_IMAGES_PER_PROMPT is enforced CLIENT-SIDE before staging — the 21st block never reaches stageImageOp", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const adapter = remoteChatSession(path);
    const stageSpy = vi.spyOn(RemoteChatSession.prototype, "stageImageOp");
    try {
      const blocks: UserContentBlock[] = Array.from({ length: 21 }, () => imageBlock(fakePng(4, 4, 64)));
      const content: UserTurnInput = [{ type: "text", text: "hi" }, ...blocks];
      const submitPromise = adapter.submit(content, () => {});
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      expect(stageSpy).toHaveBeenCalledTimes(20);
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled.filter((b) => b.type === "image")).toHaveLength(20);
      const textBlocks = assembled.filter((b) => b.type === "text") as { type: "text"; text: string }[];
      expect(textBlocks.some((b) => b.text.includes("too many images"))).toBe(true);
    } finally { adapter.detach(); await stopQuietly(host); stageSpy.mockRestore(); }
  });

  it("a second client on the same socket (attach-shaped, real remoteChatSession) stages and submits successfully", async () => {
    const session = drivable();
    const { host, path } = await startHost(session);
    const primary = remoteChatSession(path);
    await primary.whenReady();
    const secondary = remoteChatSession(path);
    try {
      await secondary.whenReady();
      const png = fakePng(4, 4, 64);
      const content: UserTurnInput = [{ type: "text", text: "from the second client" }, imageBlock(png)];
      const submitPromise = secondary.submit(content, () => {});
      await waitFor(() => session.submittedContents.length === 1);
      session.emit({ type: "assistant", n: 1 });
      session.finish({ result: "ok" });
      await submitPromise;
      const assembled = session.submittedContents[0] as UserContentBlock[];
      expect(assembled[0]).toEqual({ type: "text", text: "from the second client" });
      expect(assembled[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    } finally { primary.detach(); secondary.detach(); await stopQuietly(host); }
  });
});
