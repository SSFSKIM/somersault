// harness/src/client/stagedSubmit.ts — the image-staging loop, extracted from `chatAdapter.submit` so
// every client of the host wire stages through ONE implementation (spec 2026-08-23 "fleet threads"):
// the socket-owning REPL adapter and the app-server's fleet engine. The loop itself is unchanged from
// the version F9 T-IMAGE shipped, minus one named repair — see `stagedPaths.push` below.
import { createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import type { UserContentBlock } from "../session/turnInput.js";
import { MAX_IMAGES_PER_PROMPT, gifDimensions, jpegDimensions, pngDimensions, sniffImageMediaType, webpDimensions } from "../media/imageDims.js";

/** F9 T-IMAGE Task 5 (I3b), spec v3.1: "version skew is LOUD" — the exact message a caller (`useChat.ts`)
 *  matches on to render this as a capability NOTICE rather than a turn-failure error line. Shared as one
 *  constant so the throw site and the render site cannot drift apart. */
export const IMAGE_VERSION_SKEW_NOTICE = "image paste needs a restarted host";

/** The one host capability staging needs: mint a path for an image the caller is about to write. Narrow
 *  by design — a `RemoteChatSession` satisfies it, and so does the fleet engine's raw `sendOp`. */
export interface StagedSubmitOps {
  stageImageOp(d: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
}

/** Stage every image block of `prompt`; fold text (notes into the fold, per the canonical contract).
 *  Throws on stage-op/write failure AFTER cleaning its own staged files. On success the CALLER owns
 *  `cleanup` until the host accepts the prompt. */
export async function stageBlocks(prompt: UserContentBlock[], ops: StagedSubmitOps): Promise<{
  text: string; images: { stagedId: string; sha256: string }[]; cleanup: () => Promise<void>;
}> {
  const images: { stagedId: string; sha256: string }[] = [];
  // CLIENT-owned until the host accepts the prompt (spec v3.1 "Ownership/GC"): every path staged in
  // THIS call that has not yet been claimed by an accepted prompt gets deleted on any failure this
  // function reaches — version skew, a stage-op failure, a write failure. Past a clean return the
  // CALLER owns `cleanup` and fires it on its own failure paths (a busy refusal, a dead connection),
  // dropping it uncalled once the host has accepted the prompt and taken ownership.
  const stagedPaths: string[] = [];
  const cleanup = async (): Promise<void> => { for (const p of stagedPaths.splice(0)) await unlink(p).catch(() => {}); };
  // `assembleUserContent` (session/turnInput.ts) always puts exactly one text block first — joined
  // defensively rather than assumed, so a future multi-text-block caller degrades to concatenation
  // instead of silently dropping every block past the first.
  let text = prompt.filter((b) => b.type === "text").map((b) => b.text).join("");
  // Final-review finding 4: the host's own MAX_IMAGES_PER_PROMPT cap must also gate HERE, before
  // the staging loop — staging every block first and only discovering the excess at the host means
  // this client already paid for (and must then clean up) staged files the host was always going to
  // refuse. Excess blocks degrade the same way an unreadable one does (finding 3): the failure text
  // appended, no `stageImageOp` call at all.
  let imageOrdinal = 0;
  for (const block of prompt) {
    if (block.type !== "image") continue;
    imageOrdinal++;
    if (imageOrdinal > MAX_IMAGES_PER_PROMPT) {
      text += `[Image could not be processed: too many images in one turn (limit ${MAX_IMAGES_PER_PROMPT})]`;
      continue;
    }
    const buf = Buffer.from(block.source.data, "base64");
    // Header-decode, not caller-trust — same posture `session/turnInput.ts`'s builder takes: the
    // wire's `UserContentBlock` carries no dimensions field, so this is the only place a REMOTE
    // submit can report one at all.
    const dims = pngDimensions(buf) ?? jpegDimensions(buf) ?? gifDimensions(buf) ?? webpDimensions(buf);
    if (!dims) {
      // Final-review finding 3: degrade CLIENT-SIDE, before ever staging. `ops.ts`'s `stageImage`
      // schema requires POSITIVE dimensions — sending a 0x0 sentinel for an unreadable image used
      // to reach that schema, get rejected, and have this adapter misread the rejection as version
      // skew (the "unknown op"-vs-"invalid payload" honesty fix lives in server.ts's `dispatch`).
      // Never stage what the schema was never going to accept; degrade to the same failure text
      // block `session/turnInput.ts`'s authoritative normalizer would produce for the same reason.
      text += "[Image could not be processed: unreadable image data]";
      continue;
    }
    // bl5 T-SNIFF task 3: this pre-check must stage the SAME type the authoritative seam
    // (`checkImageBlock`, task 2) will land on, off the SAME buffer — otherwise the wire would carry
    // a label the seam is only going to overwrite a moment later, and the host's minted file would sit
    // under one media type while the canonical block that references it claims another. `sniffImageMediaType`
    // returning `null` here is dead code given the readers above (same argument as turnInput.ts's twin
    // comment: every dims reader requires the identical magic-byte prefix the sniff checks), but the
    // fallback is kept literal — a layout none of today's readers recognize is the existing "unreadable
    // image data" refusal, not a new one.
    const mediaType = sniffImageMediaType(buf);
    if (!mediaType) {
      text += "[Image could not be processed: unreadable image data]";
      continue;
    }
    const sha256 = createHash("sha256").update(buf).digest("hex");
    let stageReply: { ok: boolean; path?: string; error?: string };
    try { stageReply = await ops.stageImageOp({ mediaType, dimensions: dims, size: buf.length, sha256 }); }
    catch (e) { await cleanup(); throw e; }
    if (!stageReply.ok || !stageReply.path) {
      await cleanup();
      // "unknown op" is server.ts's own literal for a discriminated-union parse failure where the OP
      // LITERAL ITSELF is unrecognized — an old host's schema does not know the `stageImage` literal
      // at all. That IS version skew, by construction; a host that recognizes the op but rejects its
      // payload for some OTHER reason now answers "invalid op payload" instead (server.ts), so this
      // check no longer collapses the two together.
      throw new Error(stageReply.error === "unknown op" ? IMAGE_VERSION_SKEW_NOTICE : (stageReply.error ?? "image staging failed"));
    }
    // THE REPAIR (spec rev 2 finding 9): track the minted path the MOMENT the host hands it back, not
    // after the write lands. The pre-extraction ordering pushed only on write success, so a failed
    // write leaked the file it had just minted until the orphan sweep — contradicting this loop's own
    // every-failure-cleans contract.
    stagedPaths.push(stageReply.path);
    try { await writeFile(stageReply.path, buf); }
    catch (e) { await cleanup(); throw e; }
    images.push({ stagedId: stageReply.path, sha256 });
  }
  return { text, images, cleanup };
}
