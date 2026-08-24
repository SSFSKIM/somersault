// harness/test/live/image-reach.e2e.test.ts — F10 T-IMGREACH Task 14: track verification, live
// discriminating cells for spec acceptance 8 ("no stranded sessions") and 9 ("library images").
//
// Acceptance 8 requires the SAME guarantee — a session born from an image-only turn is never invisible
// to `listSessions()` because it has no text to summarize — proven on THREE independent submit paths, since
// each hands its content to `normalizeTurnInput` through a different call shape (Task 1's stranding fix
// lives at the Session message-builder boundary, `userTurn()` in session.ts, so nothing here should be
// able to bypass it, but "should" is exactly the premise a live acceptance cell exists to burn down):
//   (a) the REAL REPL topology — `SessionHost` + `remoteChatSession`, the same `buildSession` seam
//       `chatMain.tsx` uses (copied from the F9 T-IMAGE Task 6 suite, `image-submit.e2e.test.ts`);
//   (b) a direct `Session.submit([image])` via `openSession()` — the library's stateful multi-turn API;
//   (c) `harness.run([image])` via `createHarness()` — the library's one-shot streaming-input API.
// Each cell submits an IMAGE-ONLY array (no text block at all — the maximally stranding-prone shape) and
// then asserts the resulting session is present in `listSessions({cwd})` with a non-empty `firstPrompt`:
// the synthetic `[Image #N]` label Task 1 inserts at index 0 when no text block survives.
//
// Acceptance 9 is the colour cell: `harness.run([{type:"text",...}, redPng])` must have the model actually
// name the colour, proving image bytes reach the model through the library's one-shot path — not merely
// that a stranded-session label was produced.
//
// Run: set -a; . ../.env; set +a; npx vitest run test/live/image-reach.e2e.test.ts
// Subscription OAuth token — NEVER print/echo/log it; CCX_ALLOW_API_KEY stays unset.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { SessionHost } from "../../src/host/host.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { openSession, createHarness, listSessions } from "../../src/index.js";
import type { UserTurnInput, UserContentBlock } from "../../src/session/turnInput.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
const MODEL = "claude-sonnet-4-6";

// Probe 113's deterministic solid-colour PNG generator, copied verbatim from image-submit.e2e.test.ts — the
// exact bytes the live SDK has already been proven to accept and read.
function solidPng(r: number, g: number, b: number, size = 64): string {
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
    raw[o] = 0;
    for (let x = 0; x < size; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const imageBlock = (base64: string): UserContentBlock =>
  ({ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } });

const RED = solidPng(255, 0, 0);

live("F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths)", () => {
  it("(a) the real REPL topology: an image-only submit through SessionHost + remoteChatSession lands in listSessions with a non-empty firstPrompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f10img-repl-"));
    const fleetRoot = mkdtempSync(join(tmpdir(), "f10img-fleet-"));
    const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot } as NodeJS.ProcessEnv;
    const host = new SessionHost(
      { short: "f10a1b2c", name: "f10-img-repl", cwd, kind: "interactive", detached: false,
        config: { cwd, model: MODEL, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2 } as never,
        env },
    );
    await host.start();
    const socketPath = hostSocketPath(process.pid, env);
    const adapter = remoteChatSession(socketPath);
    let sessionId: string | undefined;
    try {
      const content: UserTurnInput = [imageBlock(RED)]; // IMAGE-ONLY — no text block at all
      await adapter.submit(content, (m) => {
        const mm = m as { session_id?: string };
        if (typeof mm.session_id === "string" && mm.session_id) sessionId = mm.session_id;
      });
      expect(sessionId).toBeTruthy();
      const found = (await listSessions({ cwd })).find((s) => s.sessionId === sessionId);
      expect(found).toBeTruthy();
      expect(found!.firstPrompt).toBeTruthy();
      expect(String(found!.firstPrompt).length).toBeGreaterThan(0);
    } finally {
      adapter.detach();
      await host.stop().catch(() => {});
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fleetRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("(b) a direct Session.submit([image]) lands in listSessions with a non-empty firstPrompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f10img-session-"));
    const session = openSession({ model: MODEL, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2, cwd });
    try {
      const content: UserTurnInput = [imageBlock(RED)]; // IMAGE-ONLY
      await session.submit(content);
      expect(session.sessionId).toBeTruthy();
      const found = (await listSessions({ cwd })).find((s) => s.sessionId === session.sessionId);
      expect(found).toBeTruthy();
      expect(found!.firstPrompt).toBeTruthy();
      expect(String(found!.firstPrompt).length).toBeGreaterThan(0);
    } finally {
      await session.dispose();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);

  it("(c) harness.run([image]) lands in listSessions with a non-empty firstPrompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f10img-harness-"));
    try {
      const h = createHarness({ model: MODEL, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2, cwd });
      const content: UserTurnInput = [imageBlock(RED)]; // IMAGE-ONLY
      const r = await h.run(content);
      expect(r.sessionId).toBeTruthy();
      const found = (await listSessions({ cwd })).find((s) => s.sessionId === r.sessionId);
      expect(found).toBeTruthy();
      expect(found!.firstPrompt).toBeTruthy();
      expect(String(found!.firstPrompt).length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});

live("F10 T-IMGREACH Task 14 — acceptance 9: library images", () => {
  it("harness.run([{type:'text',...}, redPng]) — the model names the colour", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f10img-colour-"));
    try {
      const h = createHarness({ model: MODEL, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2, cwd });
      const content: UserTurnInput = [
        { type: "text", text: "What colour is this image? One word." },
        imageBlock(RED),
      ];
      const r = await h.run(content);
      expect(String(r.result).toLowerCase()).toContain("red");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
