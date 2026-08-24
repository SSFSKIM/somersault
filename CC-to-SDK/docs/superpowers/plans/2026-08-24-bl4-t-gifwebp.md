# T-GIFWEBP Implementation Plan — GIF/WebP dimension readers + staged allowlist

> **For agentic workers:** REQUIRED SUB-SKILL: doperpowers:subagent-driven-development, task-by-task.
> Spec: `docs/superpowers/specs/2026-08-24-bl4-clickgate-gifwebp-design.md` (Ticket 2). Steps use `- [ ]`.

**Goal:** GIF and WebP images pass ccx's staged-image pipeline end to end — dimension readers in the
shared substrate, allowlist widened, both validator chains updated — with real-file fixtures and keyed
live proof.

**Architecture:** two new pure readers in `src/media/imageDims.ts` (zero-import contract preserved);
the validator chain in `src/session/turnInput.ts` and its duplicate in `src/client/chatAdapter.ts`
widened; `IMAGE_MEDIA_TYPES` in `src/appserver/imageStage.ts` grown to four; codec untouched.

**Tech stack:** TypeScript ESM (`.js` specifiers), vitest. Commands from `CC-to-SDK/harness/`:
`npm run typecheck`, `npm run test:unit`, targeted `npx vitest run test/unit/<file>`.

## Global Constraints

- `src/media/imageDims.ts` must keep **zero imports** (guard cell in `test/unit/imageDims.test.ts:58-62`).
- Readers return `{ width: number; height: number } | null` — null on ANY failure; no throws, no error codes.
- `imageCodec.ts` is NOT touched. No sniff-vs-declared media-type cross-check (spec D8). No downscale for GIF/WebP (spec D9).
- House style: dense hand-style, no Prettier; DI-by-deps; never `git add -A`; commit per task, no Co-Authored-By.
- Live tests: gate on `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` from `CC-to-SDK/.env`; never print either.

---

### Task 1: the two readers + unit cells

**Files:** Modify `src/media/imageDims.ts`, `test/unit/imageDims.test.ts`.

**Interfaces produced:** `gifDimensions(buf: Buffer)`, `webpDimensions(buf: Buffer)` — same shape as
`pngDimensions`/`jpegDimensions`.

- [ ] **Step 1: failing tests.** In `test/unit/imageDims.test.ts`, mirror the existing `pngHeader`/`jpegHeader`
  builder pattern with in-file builders:

```ts
const gifHeader = (w: number, h: number, tag = "GIF89a") => {
  const b = Buffer.alloc(13); b.write(tag, 0, "ascii"); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
};
const webpVp8 = (w: number, h: number) => {
  const b = Buffer.alloc(30); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii"); b.writeUInt32LE(10, 16); b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w & 0x3fff, 26); b.writeUInt16LE(h & 0x3fff, 28); return b;
};
const webpVp8l = (w: number, h: number) => {
  const b = Buffer.alloc(25); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(17, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii"); b.writeUInt32LE(5, 16); b[20] = 0x2f;
  b.writeUInt32LE((w - 1) & 0x3fff | (((h - 1) & 0x3fff) << 14), 21); return b;
};
const webpVp8x = (w: number, h: number) => {
  const b = Buffer.alloc(30); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii"); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
};
```

  Cells: GIF87a + GIF89a read `{w,h}`; VP8/VP8L/VP8X each read `{w,h}` (use 800×600 and an asymmetric
  pair like 33×47 to catch packed-bit mistakes); null for: `GIF9`-prefixed garbage, a `RIFF` without
  `WEBP`, a `VP8 ` without the `0x9d012a` sync, a `VP8L` without the `0x2f` signature, an unknown fourcc
  (`"ICCP"`), and every builder truncated to length−1. Constants cell and the zero-import guard unchanged.
- [ ] **Step 2:** `npx vitest run test/unit/imageDims.test.ts` — expect the new cells FAIL (functions undefined).
- [ ] **Step 3: implement** in `src/media/imageDims.ts`, matching the file's existing comment density:

```ts
export function gifDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  const tag = buf.toString("ascii", 0, 6);
  if (tag !== "GIF87a" && tag !== "GIF89a") return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}
export function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 16 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8 ") {
    if (buf.length < 30 || buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === "VP8L") {
    if (buf.length < 25 || buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    if (buf.length < 30) return null;
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}
```

- [ ] **Step 4:** `npx vitest run test/unit/imageDims.test.ts` — PASS (including zero-import guard).
- [ ] **Step 5:** `npm run typecheck`, then commit: `bl4(gifwebp): GIF + WebP (VP8/VP8L/VP8X) dimension readers`.

### Task 2: widen both validator chains + the allowlist; invert the refusal cells

**Files:** Modify `src/session/turnInput.ts` (~L107), `src/client/chatAdapter.ts` (~L157),
`src/appserver/imageStage.ts` (~L18-24), `test/unit/turnInput.test.ts`,
`test/unit/appserver/image-stage.test.ts` (~L121-126), `test/unit/appserver/turn-content.test.ts`
(~L205-226), `test/unit/chat-adapter.test.ts` (or wherever the adapter degrade cell lives — find it with
`grep -rn "unreadable image data" test/`).

**Interfaces consumed:** Task 1's readers. Verify every line anchor with grep before editing.

- [ ] **Step 1: failing tests first.**
  - `turnInput.test.ts`: a GIF (use `gifHeader(4,4)`-style builder or the Task 3 fixture) and a VP8L WebP
    survive normalization — block passes through, NOT replaced with `[Image could not be processed…]`;
    an oversized GIF (`gifHeader(2400,10)`) degrades with the DIMENSION reason string.
  - `image-stage.test.ts`: flip `expect(IMAGE_MEDIA_TYPES).not.toContain("image/gif")` to accept cells
    for `image/gif` + `image/webp`; the refusal cell now uses `image/tiff`.
  - `turn-content.test.ts` L205-226 loop: `["image/gif","image/webp"]` now ACCEPTED over the wire;
    `image/tiff` keeps the `/needs a mediaType in/` refusal.
  - chatAdapter: GIF/WebP no longer degrade client-side.
- [ ] **Step 2:** run those four files — expect FAIL.
- [ ] **Step 3: implement.** In `checkImageBlock`:
  `pngDimensions(decoded) ?? jpegDimensions(decoded) ?? gifDimensions(decoded) ?? webpDimensions(decoded)`;
  same chain at the `chatAdapter.ts` duplicate. `IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;`
  and REWRITE the L18-23 docstring — it currently argues for the narrowing; it should now say the list
  tracks exactly the formats `imageDims.ts` can read and the Claude API accepts, and name `image/tiff`/
  `image/bmp` as the still-out set. Update the host stage descriptor doc if it enumerates types
  (`grep -rn "image/png" src/host/ src/daemon/ docs/` and fix any stale enumeration).
- [ ] **Step 4:** re-run the four files — PASS. Then `npm run test:unit` (full unit suite) — PASS.
- [ ] **Step 5:** `npm run typecheck`; commit: `bl4(gifwebp): staged allowlist + both validator chains accept GIF/WebP`.

### Task 3: real-file fixtures + keyed live cells

**Files:** Modify `test/fixtures/images/make.mjs`; create `test/fixtures/images/live-red-64x64.gif`,
`test/fixtures/images/live-red-64x64.webp` (VP8L), `test/fixtures/images/live-red-64x64-lossy.webp`
(VP8); modify `test/live/image-submit.e2e.test.ts`; update `test/fixtures/images/sizes.json` if make.mjs
maintains it.

- [ ] **Step 1: generate the binaries once** (they are committed, like `clipboard-v5.bmp`; record the
  exact commands as a comment in `make.mjs` next to a self-assert):

```bash
python3 -c "from PIL import Image; Image.new('RGB',(64,64),(255,0,0)).save('test/fixtures/images/live-red-64x64.gif')"
python3 -c "from PIL import Image; Image.new('RGB',(64,64),(255,0,0)).save('/tmp/bl4-red.png')"
cwebp -lossless /tmp/bl4-red.png -o test/fixtures/images/live-red-64x64.webp
cwebp -q 80 /tmp/bl4-red.png -o test/fixtures/images/live-red-64x64-lossy.webp
```

- [ ] **Step 2: self-asserts in make.mjs** (pattern of `make.mjs:418`): read each committed file, assert
  `gifDimensions`/`webpDimensions` returns 64×64, and assert the two webps hit DIFFERENT variants
  (`VP8L` vs `VP8 ` fourcc at bytes 12-16) so a regenerated fixture can't silently collapse to one arm.
  Run `node test/fixtures/images/make.mjs` — asserts pass, existing fixtures byte-identical
  (`git status` shows only the new files).
- [ ] **Step 3: live cells.** In `test/live/image-submit.e2e.test.ts`, mirror the existing keyed image
  cell: one turn per fixture (GIF, VP8L webp) attaching the block with the correct `media_type`, prompt
  "One word: what color is this image?", assert `/red/i`. Keyless: `describe.skipIf` exactly as the
  file's existing gate.
- [ ] **Step 4: run keyed** — `set -a; . ../.env; set +a; npx vitest run test/live/image-submit.e2e.test.ts`
  — the two new cells PASS (paste the two model replies into the task report). Then unset the env vars.
- [ ] **Step 5:** `npm run typecheck && npm run test:unit`; commit fixtures + tests:
  `bl4(gifwebp): committed real GIF/WebP fixtures + keyed live proof`.

### Task 4: verification — run the spec's acceptance as written

- [ ] G1-G5: `npm run typecheck && npm run test:unit` green; name the cell for each of G1-G5 in the report.
- [ ] G6: the Task 3 Step 4 keyed run output (fresh, not re-quoted from memory).
- [ ] `npm run test:tui` (clickgate ticket may not have merged yet; this ticket must not disturb it).
- [ ] Report per-acceptance-cell evidence; no commit unless something needed fixing.
