// harness/test/unit/stageImage.test.ts — F9 T-IMAGE Task 5 (I3b): op schema + server dispatch matrix for
// the negotiated staging protocol (spec v3.1 "Transport"), plus unit coverage for `ImageStaging`
// (src/host/imageStaging.ts) in isolation — mint/read/release/sweep, no socket involved. The full
// real-socket round trip (client staging → host validation → Session content) lives in
// test/integration/host-image-transport.test.ts; this file is the schema + module layer underneath it.
import { describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { mkdtempSync, existsSync, statSync, writeFileSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HostServer } from "../../src/host/server.js";
import type { HostHandlers } from "../../src/host/server.js";
import { hostOp } from "../../src/host/ops.js";
import type { HostEvent } from "../../src/host/wire.js";
import { ImageStaging, ORPHAN_MAX_AGE_MS } from "../../src/host/imageStaging.js";

const sockPath = () => join(mkdtempSync(join(tmpdir(), "ccx-stage-")), "h.sock");
const tmpDir = () => mkdtempSync(join(tmpdir(), "ccx-imgstage-"));

/** Send lines, collect frames — same tiny harness `host-ops.test.ts` uses. */
function client(path: string) {
  const frames: any[] = [];
  const sock = connect(path);
  let buf = "";
  sock.on("data", (c) => {
    buf += c.toString();
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) frames.push(JSON.parse(line));
    }
  });
  return {
    frames,
    ready: new Promise<void>((r) => sock.once("connect", () => r())),
    send: (o: unknown) => sock.write(JSON.stringify(o) + "\n"),
    end: () => sock.destroy(),
    async waitFor(pred: (f: any) => boolean, ms = 1000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = frames.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no frame matched within ${ms}ms; saw ${JSON.stringify(frames)}`);
    },
  };
}

const handlers = (over: Partial<HostHandlers> = {}): HostHandlers => ({
  status: () => ({ state: "working", status: "busy" }),
  busy: () => false,
  stop: async () => {},
  pending: () => [],
  answer: () => ({ ok: true }),
  prompt: async () => {},
  interrupt: async () => {},
  follow: (_deliver: (ev: HostEvent) => void) => () => {},
  control: async () => ({ ok: true }),
  resume: async () => {},
  clear: async () => {},
  turnSeq: () => 0,
  tasks: () => [],
  background: async () => true,
  stopTask: async () => {},
  rewindAnchors: async () => [],
  rewindDryRun: async () => ({ canRewind: false }),
  rewind: async () => {},
  getSettings: async () => ({}),
  listDirs: () => [],
  addDir: async () => {},
  removeDir: async () => {},
  setOutputStyle: async () => {}, setEffort: async () => {},
  addRule: async () => {},
  removeRule: async () => {},
  stageImage: () => ({ path: "/fake/staged/path" }),
  ...over,
});

const validDescriptor = { mediaType: "image/png", dimensions: { width: 4, height: 4 }, size: 128, sha256: "a".repeat(64) };

describe("hostOp schema — stageImage + prompt.images", () => {
  it("accepts a well-formed stageImage op", () => {
    expect(hostOp.safeParse({ op: "stageImage", ...validDescriptor }).success).toBe(true);
  });
  it.each(["mediaType", "dimensions", "size", "sha256"])("rejects a stageImage op missing %s", (key) => {
    const bad: Record<string, unknown> = { op: "stageImage", ...validDescriptor };
    delete bad[key];
    expect(hostOp.safeParse(bad).success).toBe(false);
  });
  it("rejects non-positive dimensions (a client that computed a bogus header)", () => {
    expect(hostOp.safeParse({ op: "stageImage", ...validDescriptor, dimensions: { width: 0, height: 4 } }).success).toBe(false);
  });
  it("accepts a prompt op with NO images (every existing string-only caller stays valid)", () => {
    const r = hostOp.safeParse({ op: "prompt", text: "hi" });
    expect(r.success).toBe(true);
  });
  it("accepts a prompt op WITH images (stagedId + sha256 per claim)", () => {
    const r = hostOp.safeParse({ op: "prompt", text: "hi", images: [{ stagedId: "/x/y", sha256: "deadbeef" }] });
    expect(r.success).toBe(true);
  });
  it("rejects a prompt op whose images entry is missing sha256", () => {
    const r = hostOp.safeParse({ op: "prompt", text: "hi", images: [{ stagedId: "/x/y" }] });
    expect(r.success).toBe(false);
  });
  it("an UNKNOWN op (simulating a pre-image host asked a NEW op) fails the discriminated union — the exact 'unknown op' signal version skew keys off", () => {
    const r = hostOp.safeParse({ op: "notARealOp" });
    expect(r.success).toBe(false);
  });
});

describe("HostServer dispatch — stageImage + prompt.images wiring", () => {
  it("stageImage: dispatches to handlers.stageImage and replies { ok:true, path }", async () => {
    const stageImage = vi.fn(() => ({ path: "/staged/img/abc" }));
    const p = sockPath();
    const s = new HostServer(handlers({ stageImage }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "stageImage", ...validDescriptor });
    const reply = await c.waitFor((f) => f.id === 1);
    expect(reply).toMatchObject({ ok: true, path: "/staged/img/abc" });
    expect(stageImage).toHaveBeenCalledWith(validDescriptor);
    c.end(); await s.close();
  });

  it("prompt: forwards `images` through to handlers.prompt as a third argument", async () => {
    const promptCalls: unknown[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({
      busy: () => false,
      prompt: async (text, uuid, images) => { promptCalls.push({ text, uuid, images }); },
      turnSeq: () => 7,
    }), p);
    await s.listen();
    const c = client(p); await c.ready;
    const images = [{ stagedId: "/staged/img/abc", sha256: "deadbeef" }];
    c.send({ id: 2, op: "prompt", text: "look at this", images });
    const reply = await c.waitFor((f) => f.id === 2);
    expect(reply).toMatchObject({ ok: true, accepted: true, seq: 7 });
    expect(promptCalls).toEqual([{ text: "look at this", uuid: undefined, images }]);
    c.end(); await s.close();
  });

  it("prompt: a plain text prompt (no images) still forwards undefined for images — no behaviour drift for string-only callers", async () => {
    const promptCalls: unknown[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ prompt: async (text, uuid, images) => { promptCalls.push({ text, uuid, images }); } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 3, op: "prompt", text: "hello" });
    await c.waitFor((f) => f.id === 3);
    expect(promptCalls).toEqual([{ text: "hello", uuid: undefined, images: undefined }]);
    c.end(); await s.close();
  });

  it("stageImage is never busy-gated — it can be dispatched even while the host reports busy", async () => {
    const stageImage = vi.fn(() => ({ path: "/staged/img/xyz" }));
    const p = sockPath();
    const s = new HostServer(handlers({ busy: () => true, stageImage }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 4, op: "stageImage", ...validDescriptor });
    const reply = await c.waitFor((f) => f.id === 4);
    expect(reply.ok).toBe(true);
    c.end(); await s.close();
  });
});

describe("ImageStaging — mint / validate / release / sweep, in isolation", () => {
  it("stage(): mints a 0600 file inside a 0700 directory and remembers the descriptor", () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    expect(existsSync(path)).toBe(true);
    // & 0o777 masks the file-type bits statSync's mode carries alongside the permission bits.
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("readAndValidate(): succeeds when the actual bytes match the claimed hash, returning base64 + the staged mediaType", async () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    const bytes = Buffer.from("hello image bytes");
    writeFileSync(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const verdict = await staging.readAndValidate(path, sha256, 1_000_000);
    expect(verdict).toEqual({ ok: true, data: bytes.toString("base64"), mediaType: "image/png" });
  });

  it("readAndValidate(): hash mismatch — actual bytes differ from the claimed sha256", async () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    writeFileSync(path, Buffer.from("corrupted-in-transit"));
    const verdict = await staging.readAndValidate(path, "0".repeat(64), 1_000_000);
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("integrity check") });
  });

  it("readAndValidate(): missing file — never staged at all (a forged stagedId)", async () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const verdict = await staging.readAndValidate(join(dir, "never-minted"), "0".repeat(64), 1_000_000);
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("missing") });
  });

  it("readAndValidate(): missing file — staged, but the bytes never arrived (or were unlinked) before the claim", async () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    // stage() creates an EMPTY placeholder; simulate the write never landing by deleting it outright.
    const { unlinkSync } = await import("node:fs");
    unlinkSync(path);
    const verdict = await staging.readAndValidate(path, "0".repeat(64), 1_000_000);
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("missing") });
  });

  it("readAndValidate(): oversize — actual bytes exceed the caller's budget even with a correct hash", async () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    const bytes = Buffer.from("x".repeat(100));
    writeFileSync(path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const verdict = await staging.readAndValidate(path, sha256, 50);
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("50-byte limit") });
  });

  it("release(): unclaims and deletes a file this instance minted", () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path } = staging.stage(validDescriptor);
    staging.release(path);
    expect(existsSync(path)).toBe(false);
  });

  it("release(): a path never minted by this instance is NOT deleted — a forged stagedId cannot reach unlink", () => {
    const dir = tmpDir();
    const decoy = join(dir, "not-mine");
    writeFileSync(decoy, "do not delete me");
    const staging = new ImageStaging(join(dir, "img"));
    staging.release(decoy);   // never staged here
    expect(existsSync(decoy)).toBe(true);
  });

  it("sweepOrphans(): deletes a stale file, keeps a fresh one", () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    const { path: stale } = staging.stage(validDescriptor);
    const { path: fresh } = staging.stage(validDescriptor);
    const oldTime = (Date.now() - ORPHAN_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(stale, oldTime, oldTime);   // backdate ONLY the stale one
    staging.sweepOrphans();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("sweepOrphans(): a directory that does not exist yet is a safe no-op", () => {
    const staging = new ImageStaging(join(tmpDir(), "never-created"));
    expect(() => staging.sweepOrphans()).not.toThrow();
  });

  it("startPeriodicSweep(): arms a timer that runs sweepOrphans on the interval, and the returned disarm stops it", async () => {
    vi.useFakeTimers();
    try {
      const dir = join(tmpDir(), "img");
      const staging = new ImageStaging(dir);
      const { path: stale } = staging.stage(validDescriptor);
      const oldTime = (Date.now() - ORPHAN_MAX_AGE_MS - 60_000) / 1000;
      utimesSync(stale, oldTime, oldTime);
      const stop = staging.startPeriodicSweep(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(existsSync(stale)).toBe(false);
      stop();
      const { path: afterStop } = staging.stage(validDescriptor);
      utimesSync(afterStop, oldTime, oldTime);
      await vi.advanceTimersByTimeAsync(5000);
      expect(existsSync(afterStop)).toBe(true);   // the timer no longer fires — disarm actually stopped it
    } finally { vi.useRealTimers(); }
  });

  it("a fresh directory has nothing to sweep and readdir stays empty until the first stage()", () => {
    const dir = join(tmpDir(), "img");
    const staging = new ImageStaging(dir);
    staging.sweepOrphans();   // no directory yet — must not throw (covered above) and must not create one
    expect(existsSync(dir)).toBe(false);
    staging.stage(validDescriptor);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
