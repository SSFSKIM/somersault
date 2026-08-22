// harness/test/live/image-submit.e2e.test.ts — F9 T-IMAGE Task 6: track verification, live discriminating
// cell. Through the REAL REPL topology — a real `SessionHost` plus a `remoteChatSession` loopback client,
// the exact seam `chatMain` builds its session with (`tui/chatMain.tsx`'s `buildSession`) — not a bare
// `Session.submit()` call: a text-only control turn, then a red PNG (image-then-text), then a blue PNG
// (text-then-image), all on ONE session. This is probe 113's discrimination pattern
// (`probes/probes/113-image-content-block.ts`, PNG generator copied verbatim below) run through ccx's own
// submit chain — the negotiated `stageImage` transport, the host's header-decoding normalizer, the real
// wire — rather than a bare SDK call, so the whole chain gets to fail if any hop drops or mangles the block.
//
// Pass criteria (spec T-IMAGE acceptance 5, v3.1): the control turn is healthy AND the two image turns name
// their OWN distinct colours (a single red cell can pass on a colour-guessing model riding a broken chain)
// AND every turn's result across all three turns is `is_error:false` (observed off a raw second connection
// on the same socket — see the `observer` comment below for why: the high-level `remoteChatSession.submit()`
// does not itself surface the SDK result object to its caller).
//
// THEN (review-mandated): re-read the session from disk via `getSessionMessages`, confirm the image blocks
// actually persisted, and project them through both the live transcript renderer (`replayDocument` +
// `projectCompact`, the species-router stack) and the resume-view model (`transcriptItems`/`previewMessageCount`,
// what the `/resume` picker's preview pane draws) — asserting `[Image #N]` rows on both, and a preview count
// of exactly 1 for an image-only slice built from the real persisted block (not a synthetic fixture).
//
// Run: set -a; . ../.env; set +a; npx vitest run test/live/image-submit.e2e.test.ts
// Subscription OAuth token — NEVER print/echo/log it; CCX_ALLOW_API_KEY stays unset so the API key (which
// shadows the token and bills metered credits) is not picked up.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { SessionHost } from "../../src/host/host.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import type { HostEvent } from "../../src/host/wire.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { getSessionMessages } from "../../src/sessions/index.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, type ProjectionOptions } from "../../src/tui/toolRenderer.js";
import { transcriptItems, previewMessageCount } from "../../src/tui/sessionPickerModel.js";
import type { UserTurnInput, UserContentBlock } from "../../src/session/turnInput.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

// ---------------------------------------------------------------------------------------------
// Probe 113's deterministic solid-colour PNG generator, copied verbatim: a 64x64 solid RGB PNG, hand-rolled
// IHDR/IDAT/IEND with zlib. No fixture file, no image dependency, and the exact bytes probe 113 already
// proved the live SDK accepts and the model actually reads.
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
    raw[o] = 0; // filter: none
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

type Frame = Record<string, unknown>;
const assistantText = (frames: readonly Frame[]): string =>
  frames
    .filter((m) => m.type === "assistant")
    .flatMap((m) => (((m.message as Frame)?.content as Frame[]) ?? []).filter((b) => b.type === "text").map((b) => String(b.text)))
    .join(" ")
    .toLowerCase();

const PROMPT = "Reply with only the dominant color of this image, one word.";

live("F9 T-IMAGE Task 6 — live discrimination through the real REPL submit chain", () => {
  it("control turn healthy, red/blue turns name distinct colours, every result is_error:false, and the persisted image blocks project as [Image #N] on both the transcript renderer and the resume-view model", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f9img-live-"));
    const fleetRoot = mkdtempSync(join(tmpdir(), "f9img-fleet-"));
    const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot } as NodeJS.ProcessEnv;
    const host = new SessionHost(
      { short: "f9101ade", name: "f9-image-live", cwd, kind: "interactive", detached: false,
        config: { cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 8 } as never,
        env },
    );
    await host.start();
    const socketPath = hostSocketPath(process.pid, env);
    const adapter = remoteChatSession(socketPath);
    let sessionId: string | undefined;
    const captureId = (m: Frame): void => { const sid = m.session_id; if (typeof sid === "string" && sid) sessionId = sid; };

    // A raw SECOND client on the SAME socket (attach-shaped, the same pattern Task 5's own transport suite
    // uses), purely to observe each turn's is_error verdict. host.ts's runTask is explicit that a turn's
    // `result` frame is consumed internally by `Session.submit` and never forwarded through the `message`
    // feed to any follower (P106 measured zero `result`-typed frames on a following client out of 88) — the
    // ONLY route a turn's outcome has to a follower is the `{kind:"turn", phase:"end", result, failure}`
    // broadcast, which the high-level `remoteChatSession` adapter consumes for its own turn-waiter but does
    // not surface it to a `submit()` caller. Reading it off a second raw connection is the real wire truth,
    // not a workaround — it is the exact frame every attached client (and a resumed `/status`) would see.
    // `failure` (session.ts's `turnFailureOf`, keyed on the SDK's own `is_error`) is present ONLY when the
    // terminal result frame reported `is_error:true` — its absence on a completed turn IS `is_error:false`
    // (session.ts/turnResult.ts: "undefined means the turn genuinely succeeded"). `result` on this event is
    // the outcome's final text (session.ts's `mm.result`), not a boolean.
    const observer = await RemoteChatSession.connect(socketPath);
    const turnEnds: Array<{ result?: unknown; failure?: unknown; error?: string }> = [];
    observer.follow((ev: HostEvent) => { if (ev.kind === "turn" && ev.phase === "end") turnEnds.push({ result: ev.result, failure: ev.failure, error: ev.error }); });
    await observer.whenFollowed();
    const nextTurnEnd = async (): Promise<{ result?: unknown; failure?: unknown; error?: string }> => {
      const deadline = Date.now() + 5000;
      while (turnEnds.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      const end = turnEnds.shift();
      if (!end) throw new Error("no turn-end event observed within 5s of the submit settling");
      return end;
    };

    try {
      // TURN 0 — CONTROL, a plain string, through the exact same submit chain. Without this, any failure
      // (expired credential, rate limit, transport fault) is indistinguishable from "the image block was
      // rejected" — the control turn is what makes the image verdicts attributable.
      const frames0: Frame[] = [];
      await adapter.submit("Reply with only the word: ok", (m) => { frames0.push(m as Frame); captureId(m as Frame); });
      const end0 = await nextTurnEnd();
      expect(end0.error).toBeUndefined();
      expect(end0.failure).toBeUndefined();   // is_error:false

      const RED = solidPng(255, 0, 0);
      const BLUE = solidPng(0, 0, 255);

      // TURN 1 — image-then-text (red).
      const frames1: Frame[] = [];
      const content1: UserTurnInput = [imageBlock(RED), { type: "text", text: PROMPT }];
      await adapter.submit(content1, (m) => { frames1.push(m as Frame); captureId(m as Frame); });
      const end1 = await nextTurnEnd();
      expect(end1.error).toBeUndefined();
      expect(end1.failure).toBeUndefined();   // is_error:false
      const text1 = assistantText(frames1);
      expect(text1).toContain("red");

      // TURN 2 — text-then-image (blue), same live session — the block ORDER also varies, so an
      // order-sensitivity in the assembly path would show up here.
      const frames2: Frame[] = [];
      const content2: UserTurnInput = [{ type: "text", text: PROMPT }, imageBlock(BLUE)];
      await adapter.submit(content2, (m) => { frames2.push(m as Frame); captureId(m as Frame); });
      const end2 = await nextTurnEnd();
      expect(end2.error).toBeUndefined();
      expect(end2.failure).toBeUndefined();   // is_error:false
      const text2 = assistantText(frames2);
      expect(text2).toContain("blue");

      // The load-bearing discriminator: the two turns must name DIFFERENT colours. A model guessing from
      // the prompt text alone (no real pixel read) could say "red" or "blue" on ANY turn, but flipping its
      // answer to match a DIFFERENT block each time is only explained by actually reading the image.
      expect(text1).not.toEqual(text2);
      expect(sessionId).toBeTruthy();

      // ---- review-mandated: re-read the session, confirm persistence, project through both surfaces ----
      const messages = await getSessionMessages(sessionId!, { cwd });
      expect(messages.length).toBeGreaterThan(0);

      const imageUserMessages = (messages as Frame[]).filter((m) => {
        const content = (m.message as Frame | undefined)?.content;
        return m.type === "user" && Array.isArray(content) && (content as Frame[]).some((b) => b.type === "image");
      });
      // Both image turns (red, blue) persisted their image block on disk — the engine's own transcript
      // persistence, unmodified by this wave, is what makes a resumed session render these at all.
      expect(imageUserMessages.length).toBe(2);

      // The FULL transcript through the real replay + species-router stack — the same pipeline a live
      // resumed session renders through — must show numbered [Image #N] rows.
      const doc = replayDocument(messages, { width: 100 });
      const ctx: ProjectionOptions = { cwd, home: process.env.HOME ?? "/tmp", platform: process.platform, columns: 100, projection: "compact", now: 0, verbose: false };
      const projected = projectCompact(doc, ctx);
      const projectedTexts = projected.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));
      expect(projectedTexts).toContain("[Image #1]");

      // The resume-view model — `transcriptItems`/`previewMessageCount`, exactly what the `/resume`
      // transcript view draws post-T-RESUME (the old previewItems/previewWidth pane API was replaced by
      // the D-W9 takeover; width 98 = the old previewWidth(100) arithmetic, budget 200 = the classic cap).
      const fullPane = transcriptItems(messages, { width: 98, id: sessionId, cwd, budget: 200 });
      const fullPaneTexts = fullPane.items.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));
      expect(fullPaneTexts.some((t) => t.includes("[Image #1]"))).toBe(true);
      expect(previewMessageCount(messages)).toBeGreaterThanOrEqual(imageUserMessages.length);

      // An IMAGE-ONLY slice, built from the REAL persisted image block (not a synthetic fixture): the
      // resume-view model's count predicate must count it as exactly one message, and the pane must
      // project a visible, numbered [Image #1] row for it — closing the "image-only session empty state"
      // gap (I4) against real, on-disk data rather than a hand-written test fixture.
      const firstImageBlock = ((imageUserMessages[0]!.message as Frame).content as Frame[]).find((b) => b.type === "image");
      expect(firstImageBlock).toBeTruthy();
      const imageOnlySlice = [{ type: "user", message: { content: [firstImageBlock] } }];
      expect(previewMessageCount(imageOnlySlice)).toBe(1);
      const onlyPane = transcriptItems(imageOnlySlice, { width: 98, budget: 200 });
      const onlyPaneTexts = onlyPane.items.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));
      expect(onlyPaneTexts).toContain("[Image #1]");
    } finally {
      adapter.detach();
      observer.detach();
      await host.stop().catch(() => {});
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fleetRoot, { recursive: true, force: true });
    }
  }, 300_000);
});
